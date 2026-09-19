# Kata

Site estático (ES modules nativos, sem bundler; Node só pra testes; funciona em qualquer hospedagem estática — hoje Cloudflare Pages).

## Rodar localmente

```
py -m http.server 5543
```

Depois abra `http://localhost:5543`.

Se o navegador insistir em servir arquivos antigos em cache depois de uma edição, troque a porta (em `.claude/launch.json` e no comando acima) — o cache do `http.server` é por origem, então mudar a porta força tudo a vir fresco.

## Antes de commitar: `py tools/build-assets.py`

Não tem bundler, então o cache-busting é por URL: cada arquivo de `src/` é servido como `/src/x.js?v=HASH` (hash do conteúdo) e `/src/*` vai com `Cache-Control: immutable` (ver `_headers`). O script regenera, em `index.html`, o `<script type="importmap">` (que traduz os imports relativos do código pras URLs com `?v=`) e a lista de `<link rel="modulepreload">`; grava `src/generated/asset-versions.js` (hash dos `.json`, usado por quem faz `fetch`) e injeta a versão do cache em `sw.js`. É idempotente e só toca no que mudou.

Se esquecer de rodar, o site não quebra — mas o arquivo editado continua com o `?v=` antigo e o Cloudflare/navegador podem servir a versão velha por até 1 ano. Não edite à mão o que está entre os marcadores `assets:*`.

Ícones do PWA (`icons/`) são gerados uma vez por `py tools/make-icons.py`; só rodar de novo se quiser mudar o desenho.

## Estrutura

- `src/core/` — núcleo compartilhado: seed, paletas, temas, cor (`color.js`, com contraste WCAG), composição (`composition.js`, nota de qualidade de uma grade), simetria, estado compartilhado, exportação SVG/PNG/.ai/GIF, paleta por k-means de imagem, i18n.
- `src/ui/` — abas (`module-switcher.js`, com carregamento sob demanda), toasts, logo dinâmico, cursor, controles reutilizáveis.
- `src/modules/` — um módulo por pasta: `grid-icons` (Azulejo), `mosaic` (Mosaico), `gradient-tiles` (Gradiente), `sound-tiles` (Som), `video-tiles` (Espelho).
- `tests/` — `npm test` (Node 24, `node --test`, sem dependências).
- `tools/` — `build-assets.py` e `make-icons.py`.

## Módulos

- **Azulejo** — ícone geométrico único a partir de grade, densidade, simetria, formas, cores, imagem de referência; histórico com Ctrl+Z; presets; código/link compartilhável; export SVG e PNG (1x/2x/4x); "Estou com sorte" escolhe a melhor composição entre 12 sorteios.
- **Mosaico** — repete o azulejo em grade com variações; padrão sem emenda; exporta `.ai` com pattern nativo.
- **Gradiente**, **Som**, **Espelho** — módulos animados em canvas (dither sobre gradiente, espectrômetro reativo, webcam/vídeo em azulejos), com GIF/gravação.

Para adicionar um módulo: criar a pasta em `src/modules/`, expor `{ id, label, mount(container), unmount() }`, adicionar um cartão `{ id, label, load: () => import(...) }` ao array `MODULES` em `src/main.js` e rodar `py tools/build-assets.py`.
