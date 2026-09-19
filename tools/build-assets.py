#!/usr/bin/env python3
"""
build-assets.py — versionamento por hash SEM bundler.

O site é HTML/CSS/JS puro com ES modules nativos. Sem bundler não existe
"main.abc123.js"; o que existe é a URL do arquivo, e o navegador (e o
Cloudflare) fazem cache por URL. Este script dá a cada asset de src/ uma URL
única por conteúdo (`/src/x.js?v=HASH`) pra poder servir tudo sob /src com
`Cache-Control: immutable` (ver _headers): mudou o conteúdo, muda o hash,
muda a URL — ninguém nunca recebe versão velha de cache.

Como o `?v=` chega até os imports relativos (`../core/x.js`) que estão
espalhados pelo código? Via IMPORT MAP: o navegador resolve o especificador
relativo pra URL absoluta (`/src/core/x.js`) e só então consulta o mapa, que
troca por `/src/core/x.js?v=HASH`. Vale pra import estático e pra `import()`
dinâmico, então o código-fonte não precisa saber de hash nenhum.

O que este script faz (idempotente — rodar 2x não muda nada):
  1. gera src/generated/asset-versions.js com o hash dos assets NÃO-JS
     (hoje só themes.json) — fetch() não passa pelo import map, então quem
     faz fetch monta a URL com ?v= lendo desse objeto (ver core/themes.js);
  2. calcula o hash (8 hex de sha256) de src/**/*.js, src/**/*.json e
     src/style.css;
  3. em index.html: reescreve o <script type="importmap"> entre os
     marcadores, a lista de <link rel="modulepreload"> (grafo ESTÁTICO de
     imports a partir de PRELOAD_ENTRIES — import() dinâmico não é seguido,
     de propósito) e o ?v= do style.css e do main.js;
  4. em sw.js: injeta ASSET_VERSION (hash agregado — muda se QUALQUER asset
     mudar, o que faz o navegador instalar o service worker novo e descartar
     o cache antigo) e a lista de pré-cache.

Só stdlib. Rodar da raiz do repo ou de qualquer lugar: `py tools/build-assets.py`.
"""

import base64
import hashlib
import json
import posixpath
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'src'
INDEX_HTML = ROOT / 'index.html'
SW_JS = ROOT / 'sw.js'
HEADERS = ROOT / '_headers'
GENERATED_JS = SRC / 'generated' / 'asset-versions.js'

# Pontos de entrada do modulepreload. main.js é o óbvio; grid-icons/index.js
# entra porque é a PRIMEIRA aba: apesar de vir por import() dinâmico (pra
# seguir o mesmo mecanismo de carga das outras abas), ela é carregada em
# TODA visita, imediatamente — então não há por que esperar main.js baixar
# e rodar pra só então descobrir a cadeia dela. As outras abas (Mosaico,
# Gradiente, Som, Espelho) ficam de fora: são sob demanda de verdade.
PRELOAD_ENTRIES = ['/src/main.js', '/src/modules/grid-icons/index.js']

# arquivos que entram no cache do service worker já na instalação (além do
# style.css versionado, que é adicionado pelo script). Fontes e manifest não
# têm hash na URL, mas entram no hash agregado (ASSET_VERSION) — se mudarem,
# o SW novo refaz o pré-cache.
STATIC_PRECACHE = [
    '/',
    '/manifest.json',
    '/fonts/space-grotesk-latin.woff2',
    '/fonts/space-grotesk-latin-ext.woff2',
]

IMPORTMAP_START = '<!-- assets:importmap:start -->'
IMPORTMAP_END = '<!-- assets:importmap:end -->'
PRELOAD_START = '<!-- assets:preload:start -->'
PRELOAD_END = '<!-- assets:preload:end -->'
PRECACHE_START = '// assets:precache:start'
PRECACHE_END = '// assets:precache:end'
WORKER_CHAIN_START = '# assets:worker-chain:start'
WORKER_CHAIN_END = '# assets:worker-chain:end'


def short_hash(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:8]


def url_path(path: Path) -> str:
    """Caminho absoluto de URL (`/src/core/x.js`) a partir de um Path."""
    return '/' + path.relative_to(ROOT).as_posix()


def detect_eol(text: str) -> str:
    return '\r\n' if '\r\n' in text else '\n'


def read_text(path: Path) -> str:
    # newline='' preserva CRLF/LF do jeito que estão no arquivo
    return path.read_text(encoding='utf-8', newline='')


def write_if_changed(path: Path, new_text: str, changed: list) -> None:
    old = read_text(path) if path.exists() else None
    if old == new_text:
        print(f'  sem mudanças: {path.relative_to(ROOT).as_posix()}')
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(new_text, encoding='utf-8', newline='')
    changed.append(path)
    print(f'  {"criado" if old is None else "atualizado"}: {path.relative_to(ROOT).as_posix()}')


def replace_between(text: str, start: str, end: str, body: str, where: str) -> str:
    """Troca o que está entre os marcadores (exclusivo) por `body`."""
    i = text.find(start)
    j = text.find(end)
    if i == -1 or j == -1 or j < i:
        sys.exit(f'ERRO: marcadores "{start}" / "{end}" não encontrados em {where}')
    i += len(start)
    return text[:i] + body + text[j:]


# ---------------------------------------------------------------------------
# parsing dos imports
# ---------------------------------------------------------------------------

def strip_comments(code: str) -> str:
    """Remove comentários // e /* */ sem mexer no que está dentro de strings
    (uma URL 'http://x' dentro de aspas não pode virar "comentário")."""
    out = []
    i = 0
    n = len(code)
    while i < n:
        c = code[i]
        if c in ('"', "'", '`'):
            quote = c
            j = i + 1
            while j < n and code[j] != quote:
                if code[j] == '\\':
                    j += 1
                j += 1
            out.append(code[i:j + 1])
            i = j + 1
        elif code.startswith('//', i):
            j = code.find('\n', i)
            i = n if j == -1 else j
        elif code.startswith('/*', i):
            j = code.find('*/', i + 2)
            i = n if j == -1 else j + 2
        else:
            out.append(c)
            i += 1
    return ''.join(out)


# `import x from '...'`, `import { a, b } from '...'`, `export { a } from '...'`,
# `export * from '...'`. O [^'"`;]*? impede o casamento de pular pra outra
# instrução: entre a palavra import/export e o `from` não pode haver aspas
# nem ponto-e-vírgula.
RE_STATIC_FROM = re.compile(r"""\b(?:import|export)\b[^'"`;]*?\bfrom\s*(['"])([^'"]+)\1""")
# `import '...'` (só efeito colateral)
RE_STATIC_BARE = re.compile(r"""\bimport\s*(['"])([^'"]+)\1""")
# `import('...')`
RE_DYNAMIC = re.compile(r"""\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)""")


def find_imports(code: str):
    """Devolve (estáticos, dinâmicos) — listas de especificadores."""
    clean = strip_comments(code)
    static = [m.group(2) for m in RE_STATIC_FROM.finditer(clean)]
    static += [m.group(2) for m in RE_STATIC_BARE.finditer(clean)]
    dynamic = [m.group(2) for m in RE_DYNAMIC.finditer(clean)]
    return static, dynamic


def resolve_spec(importer: str, spec: str) -> str:
    """Resolve um especificador relativo/absoluto pra caminho de URL, do
    mesmo jeito que o navegador faz antes de consultar o import map."""
    if spec.startswith('/'):
        return posixpath.normpath(spec)
    if spec.startswith('.'):
        return posixpath.normpath(posixpath.join(posixpath.dirname(importer), spec))
    sys.exit(f'ERRO: {importer} importa especificador "bare" ({spec!r}) — sem bundler não há como resolver')


def main() -> int:
    # console do Windows por padrão não é UTF-8 — sem isso "mudanças" sai
    # com caractere quebrado.
    sys.stdout.reconfigure(encoding='utf-8')
    changed: list = []
    print('build-assets: versionando assets de src/')

    # 1. assets NÃO-JS -> src/generated/asset-versions.js -------------------
    json_files = sorted(p for p in SRC.rglob('*.json'))
    versions = {url_path(p): short_hash(p.read_bytes()) for p in json_files}
    generated_lines = [
        '// GERADO por tools/build-assets.py — NÃO editar à mão (é sobrescrito a',
        '// cada build). Hash de conteúdo dos assets que NÃO passam pelo import',
        '// map (fetch() de .json etc.) — quem busca esses arquivos monta a URL',
        '// com ?v= a partir daqui, pra cair no mesmo cache imutável dos .js.',
        'export const ASSET_VERSIONS = ' + json.dumps(versions, indent=2, ensure_ascii=False) + ';',
        '',
    ]
    write_if_changed(GENERATED_JS, '\n'.join(generated_lines), changed)

    # 2. hash de tudo sob src/ (já incluindo o arquivo gerado) ---------------
    js_files = sorted(p for p in SRC.rglob('*.js'))
    style_css = SRC / 'style.css'
    hashes = {url_path(p): short_hash(p.read_bytes()) for p in js_files + json_files + [style_css]}

    def versioned(url: str) -> str:
        return f'{url}?v={hashes[url]}'

    # 3. grafo de imports: valida TODOS (estáticos e dinâmicos) e monta a
    #    cadeia estática pro modulepreload -----------------------------------
    graph_static: dict = {}
    for p in js_files:
        importer = url_path(p)
        static, dynamic = find_imports(p.read_text(encoding='utf-8'))
        resolved_static = []
        for spec in static + dynamic:
            target = resolve_spec(importer, spec)
            if target not in hashes:
                sys.exit(f'ERRO: {importer} importa {spec!r} -> {target}, que não existe em src/')
            if spec in static:
                resolved_static.append(target)
        graph_static[importer] = resolved_static

    preload: set = set()
    stack = list(PRELOAD_ENTRIES)
    while stack:
        mod = stack.pop()
        if mod in preload:
            continue
        if mod not in graph_static:
            sys.exit(f'ERRO: ponto de entrada {mod} não existe')
        preload.add(mod)
        stack.extend(graph_static[mod])

    # 4. index.html ----------------------------------------------------------
    html = read_text(INDEX_HTML)
    eol = detect_eol(html)

    importmap = {'imports': {url: versioned(url) for url in sorted(hashes) if url.endswith('.js')}}
    # JSON compacto numa linha só, SEM quebra de linha dentro do <script>: o
    # CSP (script-src 'self') bloqueia script inline — e um <script
    # type="importmap"> é script inline — a menos que o hash sha256 do
    # conteúdo exato esteja na política. Se houvesse quebras de linha aqui, o
    # hash mudaria conforme LF/CRLF (o git reescreve quebras no checkout) e a
    # política deixaria de casar com o arquivo servido.
    importmap_text = json.dumps(importmap, separators=(',', ':'), sort_keys=True)
    importmap_hash = 'sha256-' + base64.b64encode(hashlib.sha256(importmap_text.encode('utf-8')).digest()).decode('ascii')
    importmap_body = eol + '<script type="importmap">' + importmap_text + '</script>' + eol
    html = replace_between(html, IMPORTMAP_START, IMPORTMAP_END, importmap_body, 'index.html')

    preload_body = eol + eol.join(
        f'<link rel="modulepreload" href="{versioned(url)}" />' for url in sorted(preload)
    ) + eol
    html = replace_between(html, PRELOAD_START, PRELOAD_END, preload_body, 'index.html')

    def set_version_attr(text: str, pattern: str, url: str, label: str) -> str:
        new_text, n = re.subn(pattern, lambda m: m.group(1) + versioned(url) + m.group(3), text)
        if n != 1:
            sys.exit(f'ERRO: esperava exatamente 1 {label} em index.html, achei {n}')
        return new_text

    html = set_version_attr(
        html, r'(<link rel="stylesheet" href=")\.?(/src/style\.css)(?:\?v=[0-9a-f]+)?(")',
        '/src/style.css', '<link rel="stylesheet"> do style.css',
    )
    html = set_version_attr(
        html, r'(<script type="module" src=")\.?(/src/main\.js)(?:\?v=[0-9a-f]+)?(")',
        '/src/main.js', '<script type="module"> do main.js',
    )
    write_if_changed(INDEX_HTML, html, changed)

    # 5. sw.js ---------------------------------------------------------------
    if SW_JS.exists():
        sw = read_text(SW_JS)
        sw_eol = detect_eol(sw)
        # hash agregado: qualquer asset mudou -> string nova -> o navegador vê
        # um sw.js diferente byte a byte e instala a versão nova.
        agg = hashlib.sha256()
        for url in sorted(hashes):
            agg.update(f'{url}={hashes[url]}\n'.encode())
        for extra in STATIC_PRECACHE:
            if extra == '/':
                continue
            f = ROOT / extra.lstrip('/')
            if f.exists():
                agg.update(f'{extra}={short_hash(f.read_bytes())}\n'.encode())
        asset_version = agg.hexdigest()[:12]

        sw, n = re.subn(r"const ASSET_VERSION = '[^']*';", f"const ASSET_VERSION = '{asset_version}';", sw)
        if n != 1:
            sys.exit(f'ERRO: esperava exatamente 1 "const ASSET_VERSION = ..." em sw.js, achei {n}')

        precache_urls = STATIC_PRECACHE + [versioned('/src/style.css')]
        precache_body = sw_eol + sw_eol.join(f"  '{u}'," for u in precache_urls) + sw_eol + '  '
        sw = replace_between(sw, PRECACHE_START, PRECACHE_END, precache_body, 'sw.js')
        write_if_changed(SW_JS, sw, changed)
    else:
        print('  aviso: sw.js não existe, pulando')

    # 6. _headers: cadeia dos Web Workers NÃO pode ser imutável ---------------
    # Um worker (new Worker(new URL('./x.worker.js', import.meta.url))) e tudo
    # que ele importa por dentro NÃO passam pelo import map da página: chegam
    # sem ?v=. Com "/src/* immutable" isso deixaria o navegador com uma cópia
    # velha do worker por 1 ano depois de um deploy. Então todo arquivo
    # alcançável a partir de um *.worker.js ganha uma regra própria aqui que
    # DESLIGA o immutable e volta pro must-revalidate (revalida por ETag —
    # barato, e sempre fresco). Gerado a partir do grafo real de imports:
    # um import novo dentro do worker entra sozinho na próxima build.
    worker_entries = sorted(url for url in graph_static if url.endswith('.worker.js'))
    worker_chain: set = set()
    stack = list(worker_entries)
    while stack:
        mod = stack.pop()
        if mod in worker_chain:
            continue
        worker_chain.add(mod)
        stack.extend(graph_static.get(mod, []))
    if HEADERS.exists():
        headers_text = read_text(HEADERS)
        h_eol = detect_eol(headers_text)
        # hash do import map inline no CSP — sem ele o navegador bloqueia o
        # mapa (erro "Executing inline script violates ... script-src"), os
        # imports resolvem SEM ?v= e o site baixa tudo duas vezes (uma pelo
        # modulepreload versionado, outra pelo import real), caindo ainda no
        # cache imutável sem versão. Mantém exatamente 1 hash na diretiva.
        headers_text, n = re.subn(
            r"script-src 'self'(?: 'sha256-[A-Za-z0-9+/=]+')*",
            f"script-src 'self' '{importmap_hash}'",
            headers_text,
        )
        if n != 1:
            sys.exit(f'ERRO: esperava exatamente 1 "script-src \'self\'" no _headers, achei {n}')
        rules = []
        for url in sorted(worker_chain):
            rules.append(url)
            rules.append('  ! Cache-Control')
            rules.append('  Cache-Control: public, max-age=0, must-revalidate')
            rules.append('')
        body = h_eol + h_eol.join(rules) if rules else h_eol
        headers_text = replace_between(headers_text, WORKER_CHAIN_START, WORKER_CHAIN_END, body, '_headers')
        write_if_changed(HEADERS, headers_text, changed)
    elif worker_chain:
        print('  aviso: _headers não existe; a cadeia dos workers ficaria imutável')

    print(f'pronto: {len(hashes)} assets, {len(preload)} no modulepreload, '
          f'{len(worker_chain)} na cadeia de workers, {len(changed)} arquivo(s) alterado(s)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
