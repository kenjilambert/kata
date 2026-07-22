# Kata — Gerador Procedural Geométrico

Site estático (sem backend, sem build) que funciona como um "estúdio" de geração procedural: vários módulos independentes, cada um com um algoritmo geométrico diferente, compartilhando um núcleo comum (seed, paleta, exportação, i18n). Público-alvo: designers/ilustradores, não programadores — por isso a UI evita jargão técnico ("seed", "RNG") e prioriza colar (Ctrl+V) como fluxo de entrada de imagem.

Identidade visual: fundo cream (`#f3f0e6`), linhas/acentos laranja (`#f2601c`), tipografia IBM Plex Mono, cantos retos (sem `border-radius` exceto o botão circular de remover cor), logo "KATA" pixelado em preto (gerado via `src/ui/pixelLogo.js`, com ruído/dither propositalmente "quebrado").

## Stack e como rodar

**Sem Node/npm nesta máquina** — por isso o stack é HTML/CSS/JS puro com ES modules nativos (`<script type="module">`), sem bundler. Isso foi um desvio deliberado do plano original (que sugeria Vite); funciona igual em qualquer hospedagem estática.

```
py -m http.server 5501
```
Depois abrir `http://localhost:5501`.

**Cuidado com cache do navegador**: o `http.server` do Python não manda headers de no-cache. Depois de editar arquivos, se o navegador insistir em servir versão antiga (mesmo com hard reload), a solução que funcionou foi trocar a porta (em `.claude/launch.json` e no comando acima) — isso força tudo a vir fresco por ser uma origem nova.

## Estrutura

```
/core
  seed.js            — LCG PRNG com seed, hashStringToSeed, randomSeed
  palette.js          — PRESETS nomeados (background + colors com weight) + pickWeighted
  symmetry.js         — generateSymmetricGrid: aplica mirror-h/mirror-full/rotational a partir
                         de uma "seed region" mínima; remapCell lida com orientação E subCells
                         (subdivisão) genericamente via os mesmos mapas de canto (tl/tr/br/bl)
  textures.js         — stub de fill styles (só 'solid' até agora; não usado ainda por nenhum módulo)
  export.js           — exportação SVG (grupos nomeados, cores diretas — cola direto no
                         Figma/Illustrator) e PNG (rasteriza via canvas)
  clipboard-input.js  — listenForPaste(target, {onImage, onSvgText}) — colar Ctrl+V
  imagePalette.js     — extractPaletteFromBlob: paleta dominante por quantização de bucket
  imageSampling.js    — sampleImageGrid (amostra imagem em grade NxN p/ brilho) +
                         nearestPaletteColor (snap de cor pra paleta atual)
  layer-stack.js      — stub para empilhar módulos (fundo + camada por cima) — não usado ainda
  i18n.js             — dicionário PT/EN (STRINGS), t(key), setLang/getLang, onLangChange
                         (pub/sub — cada módulo se inscreve e chama buildSidebar() de novo)
/ui
  module-switcher.js  — abas; mod.label pode ser função (i18n-aware) ou string
  pixelLogo.js        — renderPixelWordmark(text) — gera o logo "KATA" em SVG (bitmap font
                         5x5 hardcoded para K/A/T + ruído aleatório espalhado nas bordas)
  controls/           — slider (com formatValue), select, colorSwatches (add/remove dinâmico),
                         shapeToggleGrid (ícones visuais em vez de checkbox+texto), toggleGroup
                         (checkboxes independentes, sem mínimo), checkboxGroup (genérico, não
                         usado atualmente mas mantido), button, section (agrupamento com título)
/modules/grid-icons/  — único módulo implementado até agora ("Ícones em grade" no roadmap original)
  shapes.js           — 14 formas (square, triangle, diamond, quarterCircle,
                         quarterCircleInverse, cross, ring, dot, notch, diagonalCross,
                         smallSquare, bowtie, lens, cornerNotch), cada uma com paintAttrs()
                         pra suportar modo solid/outline + strokeWidth compartilhado
  generator.js        — o algoritmo principal: RING_FAMILIES (famílias de forma por distância
                         ao centro — dá "ordem" em vez de sorteio uniforme puro), viés radial de
                         orientação (aponta pra dentro/fora dependendo do anel), subdivisão em
                         2x2 com gradiente de detalhe (uniform/edge/center), modo imagem-guia
                         (amostra luminância pra decidir preenchido/vazio + cor mais próxima da
                         paleta), rotação do ícone inteiro, aparência (fundo transparente/
                         silhueta preta/inverter cores)
  themes.json         — 6 temas (tropical, nordico, terracota, oceano, monocromatico, neon),
                         cada um define preset de paleta + formas permitidas + simetria +
                         densidade + subdivisão + gradiente + fillMode/strokeWidth/rotation
  index.js            — UI do módulo: state, buildSidebar() (reconstrói tudo a cada mudança
                         relevante), histórico (snapshot antes de qualquer "nova direção":
                         regenerar, trocar tema, variação, aplicar imagem), duas entradas de
                         imagem (estrutura no topo / cor em Cores, com toggle "mesma imagem")
```

## O que já está pronto (módulo 1 — Ícones em grade)

Gera **um único ícone geométrico** (não mosaico ainda — ver Roadmap) a partir de:
- **Estrutura**: resolução (3x3 a 10x10), densidade de preenchimento (%), detalhe/subdivisão (%)
  + gradiente de detalhe (uniforme/borda/centro), simetria (nenhuma/espelho h/espelho total/
  rotacional — desativada automaticamente no modo imagem-guia), preenchimento (sólido/contorno)
  + espessura de traço, rotação (0/90/180/270°)
- **Formas**: 14 disponíveis, seleção via grid de ícones visuais (não checkbox+texto)
- **Cores**: paleta com número arbitrário de cores (+ pra adicionar, × pra remover)
- **Referência de imagem**: cola/upload no topo → pode só extrair paleta OU também guiar a
  estrutura (amostra brilho da imagem pra decidir forma/vazio por célula); segunda entrada de
  imagem em Cores, independente, com opção de reusar a do topo
- **Aparência**: fundo transparente, ícone preto (silhueta), inverter cores
- **Histórico**: galeria que acumula cada geração "significativa" (não a cada slider), clicável
  pra restaurar; Variações: 6 alternativas ad-hoc da configuração atual
- **Exportação**: SVG (Figma/Illustrator-friendly) e PNG
- **i18n**: PT/EN, seletor no header, persiste em localStorage

Layout: painel duplo com scroll independente — o preview do ícone nunca sai da tela mesmo
rolando os controles (era um bug real, corrigido fazendo sidebar e stage rolarem cada um por
conta própria dentro de um shell de altura fixa, `body { overflow: hidden }` + flexbox).

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
