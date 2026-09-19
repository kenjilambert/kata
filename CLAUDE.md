# Kata — Gerador Procedural Geométrico

Site estático (sem backend, sem build de JS) que funciona como um "estúdio" de geração procedural: vários módulos independentes (abas), cada um com um algoritmo diferente, compartilhando um núcleo comum (seed, paleta, temas, exportação, i18n). Público-alvo: designers/ilustradores, não programadores — a UI evita jargão técnico e prioriza colar (Ctrl+V) como fluxo de entrada de imagem.

Identidade visual (espelhada no kenjilambert.com, dark-only): fundo `#0a0a0a`, painéis `#141414`, texto creme `#f1eec0`, acentos vermelho `#ea4530` e azul `#3aa1d8`, tipografia Space Grotesk (auto-hospedada em `/fonts/`, fonte variável), cantos arredondados (tokens `--radius-*`), logo/favicon gerado dinamicamente a cada carga (`ui/dynamicLogo.js`). Tokens em `:root` no topo de `src/style.css`.

**Regra do dono: nada pago no site.** Sem API de IA, sem backend com custo, sem serviço externo cobrado. "Mais inteligente" = algoritmo melhor (ver `core/composition.js`), nunca chamada a modelo.

## Stack e como rodar

HTML/CSS/JS puro com ES modules nativos, sem bundler. Node 24 existe na máquina (`C:\Program Files\nodejs`, fora do PATH do Git Bash) e é usado só pra testes e `node --check`; Python 3 (`py`) roda o servidor local e o script de build de assets.

```
py -m http.server 5543
```
Depois abrir `http://localhost:5543`. Cache do `http.server`: se o navegador servir versão antiga, use `?nocache=<n>` na URL ou troque a porta.

**Antes de commitar: `py tools/build-assets.py`.** Não há bundler, então o cache-busting é por URL: cada arquivo de `src/` é servido como `/src/x.js?v=HASH` via `<script type="importmap">` gerado no `index.html` (imports relativos no código continuam sem hash — o mapa traduz), e `/src/*` vai com `Cache-Control: immutable` (ver `_headers`). O script também regenera a lista de `modulepreload` (grafo estático a partir de `main.js` + a cadeia do Azulejo), `src/generated/asset-versions.js` (hash dos `.json` buscados via `fetch`) e a versão do cache do `sw.js`. Idempotente. Ver README.

**Testes:** `npm test` (ou `node --test tests/`) — propriedades do gerador (determinismo, simetria, SVG bem formado, cores na paleta), temas, i18n, paletas, cor. Sem dependências.

**Deploy:** Cloudflare Pages (projeto `kata`, `.wrangler/` só cache local), push em `main` publica. `_headers` tem CSP fechado em `'self'` (fontes locais), cache imutável pra `/src/*` e `/fonts/*`, `no-cache` pra `sw.js`/`manifest.json`.

## Arquitetura de carga

- `src/main.js` só conhece "cartões" `{ id, label, load: () => import(...) }` (array `MODULES`); o `ui/module-switcher.js` resolve `load()` na primeira ativação, pré-busca ao passar o mouse/focar a aba e mantém a aba atual se a rede falhar. Só o Azulejo desce na carga inicial.
- `index.html`: metadados (description/OG/theme-color), preload da fonte, importmap + modulepreload gerados, manifest PWA, `<noscript>`.
- `sw.js` (raiz): cache-first pra URLs com `?v=` e `/fonts/`, network-first pra navegação; registrado em `main.js` só fora de `localhost`.
- Gradiente e Som desenham num Web Worker (`render.worker.js` + `runtime.js` + `draw.js` por módulo, infra em `video-tiles/offscreen.js`): o worker pinta num OffscreenCanvas e devolve um ImageBitmap por quadro (não usa `transferControlToOffscreen`, que quebrava `captureStream`/`toBlob`). Fallback automático pra main thread se o worker falhar; debug com `localStorage.KATA_FORCE_MAIN_THREAD = '1'`. Imports dentro do worker não passam pelo importmap, por isso a cadeia deles recebe regras `must-revalidate` geradas em `_headers` pelo build.
- Erros não tratados (`error`/`unhandledrejection`) viram um toast genérico (`ui/toast.js`), no máximo 1 a cada 8s.

## Estrutura

```
/core
  seed.js            — LCG PRNG com seed, hashStringToSeed, randomSeed
  palette.js         — PRESETS nomeados (background + colors com weight) + pickWeighted
  color.js           — hsl<->hex, paleta harmônica, relativeLuminance, contrastRatio (WCAG)
  composition.js     — scoreComposition/explainComposition: nota 0..1 de uma grade (equilíbrio de
                        cor, contraste com o fundo, variedade de formas, peso centrado, repetição
                        vizinha) — usada pelo "Estou com sorte" curado (melhor de 12 seeds)
  symmetry.js        — generateSymmetricGrid (none / mirror-h / mirror-full / rotational)
  themes.js          — loadThemes (fetch de themes.json, versionado) + applyTheme no patternState
  patternState.js    — state/histórico compartilhados entre Azulejo, Mosaico e Espelho
  export.js          — SVG (grupos nomeados, cores diretas) e PNG (canvas; targetSize = 1500 × escala)
  aiPatternExport.js — Mosaico "sem emenda" → PDF com Tiling Pattern nativo (abre no Illustrator)
  gifEncoder.js      — GIF pros módulos animados
  imagePalette.js    — extractPaletteFromBlob: k-means em Lab (kMeansPalette exportado)
  imageSampling.js   — sampleImageGrid (brilho em grade NxN) + nearestPaletteColor
  clipboard-input.js — listenForPaste / loadImageAsset
  i18n.js            — STRINGS pt/en, t(), setLang (também sincroniza <html lang>), onLangChange
  gradient.js, textures.js, layer-stack.js — utilitários/stubs
/ui
  module-switcher.js — abas ARIA (tablist/roving tabindex), pílula ativa, View Transitions,
                        carregamento sob demanda dos módulos
  toast.js           — showToast/showError (role=status, aria-live)
  dynamicLogo.js, customCursor.js, viewTransition.js, drawCanvas.js, categoryIcons.js, toolbarIcons.js
  controls/          — slider (customizado, role=slider), select, iconSelect, colorSwatches,
                        shapeToggleGrid, toggleSwitch, toggleGroup, checkboxGroup, button,
                        pressButton, section, frameTilePicker
/modules
  grid-icons/        — "Azulejo" (id grid-icons): ícone único; generator.js (RING_FAMILIES, viés
                        radial, subdivisão, imagem-guia, regras de cor `colorRules`), shapes.js
                        (catálogo), svgVectorShape.js (ícone SVG enviado), themes.json (16 temas),
                        index.js (UI: buildSidebar reconstrói o painel preservando scroll/foco;
                        histórico + Ctrl+Z/Ctrl+Shift+Z; presets em localStorage com nome sugerido;
                        código/link compartilhável `#k=<base64>`; export SVG/PNG 1x/2x/4x)
  mosaic/            — "Mosaico": repete o azulejo em grade com variações, padrão sem emenda, .ai
  gradient-tiles/    — "Gradiente": dither animado sobre gradiente fluido (canvas)
  sound-tiles/       — "Som": espectrômetro reativo (mic/arquivo), player, GIF
  video-tiles/       — "Espelho": webcam/vídeo virando azulejos em tempo real, GIF/gravação
/tests               — node --test, só propriedades (sem snapshots de SVG)
/tools               — build-assets.py (importmap/preload/versões/sw), make-icons.py (ícones PWA)
```

Ao adicionar um módulo novo: criar pasta em `src/modules/`, expor `{ id, label, mount(container), unmount() }`, adicionar um cartão com `load: () => import(...)` ao array `MODULES` em `src/main.js` e rodar `py tools/build-assets.py`.

Layout: header com logo + abas + PT/EN; conteúdo em painel duplo (sidebar de ajustes com scroll próprio + stage com preview); no mobile (≤768px) a sidebar vira "bottom sheet" com barra de categorias e o preview fica em cima. `prefers-reduced-motion` respeitado; alvos de toque ≥ 28px no header.

## Preferências e decisões do usuário (não óbvias pelo código)

- Gosta de ter **muita opção de forma/parâmetro** ("poder de escolha") — ao expandir o
  catálogo de formas ou controles, prefira adicionar mais do que consolidar.
- UI deve remeter à estética de referência: pôsteres gráficos tipo bloco/pixel (ver conversa
  original), não flat-design genérico. Cantos retos, cores fortes, tipografia mono.
- Não sabe o hex exato do laranja de referência — usei `#f2601c` como estimativa; ajustar se
  o usuário trouxer um valor exato.
- Está usando isso, entre outras coisas, pra gerar um ícone temático "MIRA" pra Team Liquid —
  o fluxo pensado pra isso é: colar referências visuais reais (não busca automática — inviável
  sem backend/API paga) e extrair paleta/estrutura delas.
- Site será eventualmente mostrado a stakeholders que só falam inglês — por isso o i18n, não
  uma tradução avulsa.

## Roadmap (não implementado ainda)

Fases do brief original, na ordem sugerida:
1. ~~Ícones em grade~~ (feito, módulo 1 acima)
2. Alfabeto de padrões binários (matriz N×N liga/desliga, simetria, primitivas de desenho)
3. Padrão disperso com paleta (ícones espalhados livremente, rotação/escala aleatórias)
4. Regiões orgânicas + textura (subdivisão recursiva irregular + `core/textures.js` de verdade)
5. Biblioteca de formas (forma × estilo de preenchimento desacoplados)
6. Imagem → padrão (halftone estruturado — dither de verdade, diferente do modo imagem-guia
   simplificado que já existe no módulo 1)
7. Rabisco/foto → formas ao longo do caminho
8. Cybersigilo (hash de texto → crescimento recursivo de galhos)
9. Vídeo → frames fragmentados

**Mosaico** (repetir vários ícones gerados numa grade, com variações entre eles) é o "plus"
que falta no próprio módulo 1 — foi explicitamente adiado pelo usuário até o gerador de ícone
único ficar redondo. Retomar isso antes de avançar pros módulos 2+, se fizer sentido.

Ao adicionar um módulo novo: criar pasta em `src/modules/`, expor
`{ id, label, mount(container), unmount() }`, adicionar ao array em `src/main.js`. Reaproveitar
`core/` sempre que possível (especialmente `symmetry.js` pro módulo 2, `textures.js` pro
módulo 4/5).
