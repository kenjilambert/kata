import { createRng } from '../../core/seed.js';
import { pickWeighted } from '../../core/palette.js';
import { generateSymmetricGrid } from '../../core/symmetry.js';
import { nearestPaletteColor } from '../../core/imageSampling.js';
import { buildGrainFilterMarkup } from '../../core/textures.js';
import { SHAPES, shapeCoversEdge } from './shapes.js';

// monta os shapeDefs de ícones customizados (SVG colado ou imagem/máscara
// enviada) a partir da lista salva em state.customShapes — exportado (não só
// usado internamente pelo Azulejo) pra o módulo Mosaico poder desenhar os
// mesmos ícones customizados nos tiles, sem duplicar essa lógica.
export function buildCustomShapeDefs(customShapes) {
  const defs = {};
  for (const shape of customShapes) {
    if (shape.kind === 'vector') {
      const { minX, minY, width, height } = shape.viewBox;
      defs[shape.key] = {
        oriented: false,
        draw: (size, color, orientation, style) => {
          const sx = size / width;
          const sy = size / height;
          const fillOn = style?.fillEnabled ?? true;
          const strokeOn = style?.strokeEnabled ?? false;
          const strokeColor = style?.strokeColor ?? color;
          const sw =
            style?.paintStrokeWidth != null
              ? Math.max(0.5, style.paintStrokeWidth)
              : Math.max(1, size * (style?.strokeWidth ?? 0.22) * 0.4);
          const fillAttr = fillOn ? `fill="${color}"` : 'fill="none"';
          const strokeAttr = strokeOn ? `stroke="${strokeColor}" stroke-width="${sw}"` : '';
          return `<g ${fillAttr} ${strokeAttr} transform="scale(${sx} ${sy}) translate(${-minX} ${-minY})">${shape.innerMarkup}</g>`;
        },
      };
      continue;
    }
    const maskId = `shape-mask-${shape.key.replace(':', '-')}`;
    defs[shape.key] = {
      oriented: false,
      maskId,
      maskDataUrl: shape.maskDataUrl,
      draw: (size, color) => `<rect x="0" y="0" width="${size}" height="${size}" fill="${color}" mask="url(#${maskId})" />`,
    };
  }
  return defs;
}

const OPPOSITE_CORNER = { tl: 'br', tr: 'bl', br: 'tl', bl: 'tr' };
const ALL_CORNERS = ['tl', 'tr', 'br', 'bl'];

// ids de <clipPath> precisam ser únicos na página INTEIRA, não só dentro de
// um <svg> — a página sempre tem vários ícones renderizados ao mesmo tempo
// (preview principal, variações, histórico, o fantasma do arrastar), e um
// contador que reiniciasse a cada chamada faria "cell-clip-0" de um ícone
// roubar o clip-path de "cell-clip-0" de outro ícone completamente diferente.
let globalClipCounter = 0;

// Famílias de forma por "anel" (distância ao centro do ícone), cíclicas para
// qualquer resolução — é o que dá intenção/ordem em vez de sorteio uniforme puro.
// Anéis 3 e 4 só existem em grades grandes (resolução ~8+) — qualquer forma
// que devesse aparecer em grades pequenas também precisa estar num anel 0-2.
const RING_FAMILIES = [
  ['dot', 'cross', 'diamond', 'disc', 'sparkle', 'burst', 'circle', 'asterisk'],
  ['triangle', 'quarterCircle', 'diamond', 'lens', 'prism'],
  ['square', 'ring', 'quarterCircleInverse', 'cornerNotch', 'burst', 'twinPeaks', 'hourglass'],
  ['triangle', 'square', 'quarterCircle', 'cornerNotch', 'burst', 'asterisk'],
  ['diagonalCross', 'bowtie', 'diamond', 'dot', 'prism', 'hourglass'],
];

function pickFamily(ring, shapesAllowed, ringsCollapse) {
  // grade 2x2: todas as células ficam a exatamente a mesma distância do
  // centro (não existe um índice de célula "central" de verdade), então TODA
  // célula sempre cai no anel 0 — filtrar pela família do anel 0 nesse caso
  // eliminaria silenciosamente qualquer forma permitida que não pertença a
  // ela (ex.: só "quadrado" e "disco" ativos gerava só disco, porque
  // "quadrado" só existe nas famílias dos anéis 2/3). Sem uma variedade real
  // de anéis pra justificar a curadoria por distância, usa a lista permitida
  // inteira direto.
  if (ringsCollapse) return shapesAllowed;
  const preferred = RING_FAMILIES[ring % RING_FAMILIES.length].filter((s) => shapesAllowed.includes(s));
  // ícones enviados pelo usuário não pertencem a nenhuma família de anel —
  // entram na roda de sorteio de todo anel pra terem chance de aparecer.
  const custom = shapesAllowed.filter((s) => s.startsWith('custom:'));
  const combined = [...preferred, ...custom];
  return combined.length ? combined : shapesAllowed;
}

function outwardCorner(r, c, center) {
  const vertical = r < center ? 't' : 'b';
  const horizontal = c < center ? 'l' : 'r';
  return vertical + horizontal;
}

function invertHex(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = 255 - ((n >> 16) & 255);
  const g = 255 - ((n >> 8) & 255);
  const b = 255 - (n & 255);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function luminanceThresholdFor(grid, fillDensity) {
  const flat = grid.flat().map((px) => px.luminance).sort((a, b) => a - b);
  const idx = Math.min(flat.length - 1, Math.floor(fillDensity * flat.length));
  return flat[idx];
}

// gradiente de densidade/tamanho: 0 = extremidade "vazia" do gradiente, 1 = extremidade
// "cheia". Direções lineares varrem a grade de ponta a ponta; radiais usam distância
// ao centro. Isso é independente do detailGradient acima (que só afeta subdivisão).
// Recebe o centro/contagem de cada eixo em separado (não um único "size") pra
// funcionar igual numa grade quadrada (centerRow===centerCol, gridRows===
// gridCols — dá exatamente a mesma conta de antes) ou numa retangular (ver
// buildIconGrid: composição do "quadro" de exportação não-quadrado).
function gradientFactorFor(r, c, centerRow, centerCol, gridRows, gridCols, densityGradient, gradientDirection) {
  const denomX = Math.max(1, gridCols - 1);
  const denomY = Math.max(1, gridRows - 1);
  const nx = c / denomX;
  const ny = r / denomY;

  if (densityGradient === 'radial') {
    const maxDist = Math.sqrt(centerRow * centerRow + centerCol * centerCol) || 1;
    const dist = Math.sqrt((r - centerRow) ** 2 + (c - centerCol) ** 2) / maxDist;
    return gradientDirection === 'edge-out' ? dist : 1 - dist;
  }

  switch (gradientDirection) {
    case 'right-to-left':
      return 1 - nx;
    case 'top-to-bottom':
      return ny;
    case 'bottom-to-top':
      return 1 - ny;
    case 'tl-to-br':
      return (nx + ny) / 2;
    case 'br-to-tl':
      return 1 - (nx + ny) / 2;
    case 'tr-to-bl':
      return (ny + (1 - nx)) / 2;
    case 'bl-to-tr':
      return 1 - (ny + (1 - nx)) / 2;
    case 'left-to-right':
    default:
      return nx;
  }
}

// gradiente de densidade de detalhe: 'edge' deixa a subdivisão mais provável
// perto da borda do ícone, 'center' o inverso, 'uniform' não varia por anel.
function detailMultiplierFor(ring, maxRing, detailGradient) {
  if (maxRing <= 0) return 1;
  const t = ring / maxRing;
  if (detailGradient === 'edge') return 0.4 + 1.6 * t;
  if (detailGradient === 'center') return 0.4 + 1.6 * (1 - t);
  return 1;
}

const DEFAULT_APPEARANCE = { transparentBackground: false, silhouette: false, invert: false, inkColor: '#000000' };

// Construção da grade (decide forma/orientação/cor de cada célula via RNG) e
// renderização em SVG (só desenha o que já foi decidido) são etapas separadas
// de propósito: o modo de edição manual (arrastar/girar blocos) precisa poder
// re-renderizar a mesma grade repetidas vezes sem re-sortear nada.
export function buildIconGrid({
  seed,
  size,
  cols,
  rows,
  symmetry,
  fillDensity,
  shapesAllowed,
  background,
  colors,
  subdivisionChance = 0,
  detailGradient = 'uniform',
  imageGuide = null,
  appearance = DEFAULT_APPEARANCE,
  customShapeDefs = {},
  densityGradient = 'none',
  gradientDirection = 'left-to-right',
  gradientStrength = 0.6,
}) {
  // cols/rows (opcionais) permitem uma grade RETANGULAR — usada só pelo
  // "quadro" de exportação não-quadrado (ver buildFramedIconGrid mais
  // abaixo e updatePreviewFrame em grid-icons/index.js): em vez de repetir
  // (ladrilhar) o mesmo ícone quadrado pra preencher um formato 4:5/9:16/
  // 16:9 — o que sempre deixava uma "costura" visível entre repetições —
  // a composição inteira é gerada de uma vez só, do tamanho certo, sem
  // repetição nenhuma. Sem cols/rows (o caso de sempre, ícone 1:1), o
  // comportamento é EXATAMENTE o de antes: grade quadrada size×size, com
  // toda a simetria disponível.
  const gridCols = cols ?? size;
  const gridRows = rows ?? size;
  const isRect = gridCols !== gridRows;
  const rng = createRng(seed);
  const centerRow = (gridRows - 1) / 2;
  const centerCol = (gridCols - 1) / 2;
  const maxRing = Math.max(1, Math.floor((Math.max(gridRows, gridCols) - 1) / 2));
  // grade 2x2 (ver comentário em pickFamily): toda célula cai no anel 0,
  // não existe variedade de anel de verdade pra curar por família.
  const ringsCollapse = !isRect && Math.floor((size - 1) / 2) === 0;
  const shapeDefs = { ...SHAPES, ...customShapeDefs };
  const { silhouette, invert, inkColor } = { ...DEFAULT_APPEARANCE, ...appearance };
  // guia de imagem é amostrado numa grade QUADRADA (size×size) em outro
  // lugar — não se aplica à composição retangular do quadro de exportação
  // (o "quadro" pede uma imageGuide=null explícito pra isso).
  const luminanceThreshold = imageGuide ? luminanceThresholdFor(imageGuide.grid, fillDensity) : null;
  const useDensityGradient = densityGradient !== 'none' && !imageGuide;

  function outwardCorner(r, c) {
    const vertical = r < centerRow ? 't' : 'b';
    const horizontal = c < centerCol ? 'l' : 'r';
    return vertical + horizontal;
  }

  function ringFor(r, c) {
    return Math.floor(Math.max(Math.abs(r - centerRow), Math.abs(c - centerCol)));
  }

  // t=1 é a ponta "cheia" do gradiente, t=0 a ponta "vazia" (ver gradientFactorFor).
  // Interpola entre a densidade base (sem gradiente) e o extremo 0↔1 conforme a
  // intensidade escolhida — com intensidade máxima o próprio t vira a densidade,
  // então uma ponta fica praticamente sólida e a outra praticamente vazia.
  function effectiveDensityFor(r, c) {
    if (!useDensityGradient) return fillDensity;
    const t = gradientFactorFor(r, c, centerRow, centerCol, gridRows, gridCols, densityGradient, gradientDirection);
    return fillDensity + gradientStrength * (t - fillDensity);
  }

  function resolveCellColor(pickedColor) {
    if (silhouette) return invert ? background : inkColor;
    return invert ? invertHex(pickedColor) : pickedColor;
  }

  function pickShapeAndOrientation(ring, r, c) {
    const family = pickFamily(ring, shapesAllowed, ringsCollapse);
    const shapeKey = family[Math.floor(rng() * family.length)];
    const shapeDef = shapeDefs[shapeKey];
    let orientation;
    if (shapeDef.oriented) {
      const outward = outwardCorner(r, c);
      const preferred = ring === 0 ? OPPOSITE_CORNER[outward] : outward;
      orientation = rng() < 0.75 ? preferred : ALL_CORNERS[Math.floor(rng() * ALL_CORNERS.length)];
    }
    return { shapeKey, orientation };
  }

  function pickColorFor(r, c) {
    if (imageGuide) return resolveCellColor(nearestPaletteColor(imageGuide.grid[r][c], colors));
    return resolveCellColor(pickWeighted(rng, colors));
  }

  function isFilled(r, c) {
    if (shapesAllowed.length === 0) return false;
    if (imageGuide) return imageGuide.grid[r][c].luminance <= luminanceThreshold;
    const density = Math.max(0, Math.min(1, effectiveDensityFor(r, c)));
    return rng() <= density;
  }

  function cellFactory(r, c) {
    if (!isFilled(r, c)) return { shape: 'blank' };

    const ring = ringFor(r, c);
    const effectiveSubdivision = subdivisionChance * detailMultiplierFor(ring, maxRing, detailGradient);

    if (effectiveSubdivision > 0 && rng() < effectiveSubdivision) {
      const subCells = {};
      for (const corner of ALL_CORNERS) {
        if (rng() > fillDensity) {
          subCells[corner] = { shape: 'blank' };
          continue;
        }
        const { shapeKey, orientation } = pickShapeAndOrientation(ring, r, c);
        subCells[corner] = { shape: shapeKey, orientation, color: pickColorFor(r, c) };
      }
      return { shape: 'subdivided', subCells };
    }

    const { shapeKey, orientation } = pickShapeAndOrientation(ring, r, c);
    return { shape: shapeKey, orientation, color: pickColorFor(r, c) };
  }

  let grid;
  if (isRect) {
    // grade retangular: sem simetria (espelhar/girar um recorte não-
    // quadrado em torno de um centro comum não tem uma definição única) —
    // cada célula é gerada direto, mas com as MESMAS regras de forma/cor/
    // densidade/anel de sempre, então continua parecendo a mesma
    // "família" visual do ícone quadrado, só que como uma composição
    // própria do tamanho certo.
    grid = Array.from({ length: gridRows }, (_, r) => Array.from({ length: gridCols }, (_, c) => cellFactory(r, c)));
  } else {
    grid = generateSymmetricGrid({ size, symmetry, cellFactory });

    // caso extremo: espelho-total/rotacional com resolução 2 ou 3 tem só 1
    // célula-semente (o resto da grade INTEIRA é cópia dela — ver symmetry.js/
    // remapCell) — cor incluída, não só forma, deixando o ícone de uma cor só.
    // Resoluções maiores têm várias células-semente diferentes se misturando,
    // então não sofrem disso; por isso a correção mira só esse caso (h===1),
    // sem mudar o comportamento geral de simetria (que intencionalmente também
    // espelha cor, não só forma, nas demais resoluções).
    const isDegenerateSeedSymmetry =
      (symmetry === 'mirror-full' || symmetry === 'rotational') && Math.floor(size / 2) === 1;
    if (isDegenerateSeedSymmetry) {
      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          if (r === 0 && c === 0) continue; // célula-semente original, mantém
          const cell = grid[r][c];
          if (cell.shape !== 'blank' && cell.shape !== 'subdivided') {
            grid[r][c] = { ...cell, color: pickColorFor(r, c) };
          }
        }
      }
    }
  }

  return { grid, size, cols: gridCols, rows: gridRows };
}

// tamanho de ícone "de referência" pro traço em px fazer sentido como valor
// absoluto (ver strokeOutlineWidth abaixo) — é o ICON_SIZE do preview
// principal em index.js; miniaturas (variações/histórico, menores) escalam
// o traço proporcionalmente a essa referência, não à resolução da grade.
const OUTLINE_REFERENCE_ICON_SIZE = 420;

// Segunda etapa: só desenha uma grade já decidida (vinda de buildIconGrid, ou
// editada manualmente depois) — nenhum sorteio acontece aqui.
export function renderGridToSvg({
  grid,
  size,
  cols,
  rows,
  iconSize,
  background,
  fillEnabled = true,
  strokeEnabled = false,
  strokeColor = '#000000',
  strokeWidth = 0.22,
  strokeOutlineWidth = 2,
  gradientFillEnabled = false,
  gradientFillAngle = 45,
  gradientStops = [
    { position: 0, color: '#c1502e' },
    { position: 1, color: '#e0a458' },
  ],
  grainEnabled = false,
  grainIntensity = 0.3,
  grainSize = 0.5,
  grainColor = '#000000',
  rotation = 0,
  appearance = DEFAULT_APPEARANCE,
  customShapeDefs = {},
}) {
  // cellSize sempre vem do par (size, iconSize) — a referência "quadrada"
  // de sempre (ex.: 420/resolução) — mesmo quando a grade de verdade
  // (gridCols×gridRows) é retangular (quadro de exportação não-quadrado):
  // é o que faz uma célula ocupar o MESMO tamanho físico em ambos os
  // casos, em vez de esticar/encolher célula ao mudar de formato.
  const cellSize = iconSize / size;
  const gridCols = cols ?? size;
  const gridRows = rows ?? size;
  const iconWidth = gridCols * cellSize;
  const iconHeight = gridRows * cellSize;
  const style = { fillEnabled, strokeEnabled, strokeColor, strokeWidth };
  // traço decorativo (contorno): px "de referência" pra uma célula de
  // primeiro nível (não varia com a resolução — 2x2 e 10x10 têm células de
  // tamanhos bem diferentes, mas o contorno deve parecer igual). Escalado
  // pela referência de tamanho do ÍCONE pra miniaturas menores (variações/
  // histórico) mostrarem o traço proporcionalmente mais fino, não gigante.
  // Espessura ABSOLUTA e igual pra qualquer célula, inclusive as SUBDIVIDIDAS
  // (detalhe, desenhadas em metade do tamanho) — escalar pra baixo ali (como
  // antes) fazia o traço de uma célula subdividida ficar mais fino que o da
  // vizinha não-subdividida bem na linha que as separa, e como as duas
  // desenham seu próprio traço voltado pra dentro, a costura ficava com duas
  // espessuras diferentes lado a lado em vez de uma linha só uniforme.
  const outlineWidthPx = Math.max(0.5, strokeOutlineWidth * (iconSize / OUTLINE_REFERENCE_ICON_SIZE));
  const shapeDefs = { ...SHAPES, ...customShapeDefs };
  const { transparentBackground, silhouette, invert, inkColor } = { ...DEFAULT_APPEARANCE, ...appearance };

  // degradê interno: UMA receita só (lista de stops posição+cor, editada
  // livremente pela pessoa — tipo o editor de degradê do Photoshop), a MESMA
  // aplicada em toda forma preenchida. gradientUnits é objectBoundingBox por
  // padrão, então a mesma receita se ajusta à caixa de cada forma sozinha —
  // só precisa de UM <linearGradient> compartilhado, não um por célula/cor.
  const sharedGradientId = gradientFillEnabled ? `grad-fill-${globalClipCounter++}` : null;
  const gradientDefMarkup = sharedGradientId
    ? `<linearGradient id="${sharedGradientId}" gradientTransform="rotate(${gradientFillAngle} 0.5 0.5)">${[...gradientStops]
        .sort((a, b) => a.position - b.position)
        .map((stop) => `<stop offset="${stop.position}" stop-color="${stop.color}" />`)
        .join('')}</linearGradient>`
    : '';

  // grão só existe amarrado ao degradê interno (decisão do usuário) — mesmo
  // que o mecanismo (filtro SVG) funcionasse igual sobre fill sólido.
  const grainActive = gradientFillEnabled && grainEnabled;

  // <clipPath> de cada célula vai pro <defs> do topo (junto com as máscaras
  // customizadas), não solto dentro do <g> da própria célula — leitores de SVG
  // mais rígidos que o navegador (Figma/Illustrator, que é justamente pra onde
  // esse SVG é exportado) podem descartar ou interpretar errado um clipPath
  // fora de <defs>.
  let clipDefsMarkup = '';

  // célula vizinha, só pra decidir se o traço na borda compartilhada deve
  // sumir de UM dos dois lados (ver suppressed abaixo) — vizinha fora da
  // grade, vazia ou subdividida (sem uma forma única própria) nunca conta,
  // então a borda com ela sempre mostra o traço normalmente.
  function neighborInfo(r, c) {
    if (r < 0 || r >= gridRows || c < 0 || c >= gridCols) return null;
    const n = grid[r][c];
    if (!n || n.shape === 'blank' || n.shape === 'subdivided') return null;
    return n;
  }

  // traço "pra dentro": em vez de recortar pela caixa da célula (o que dava
  // metade da espessura nas bordas encostadas na célula e o dobro nas bordas
  // internas, como a diagonal de um triângulo — uma linha irregular), desenha
  // o dobro da espessura e recorta pela própria silhueta preenchida da forma.
  // Isso garante espessura consistente em qualquer borda, esteja ela colada
  // na borda da célula ou totalmente por dentro, e nunca vaza pra célula
  // vizinha (a forma em si já não ultrapassa sua própria caixa). Vale pra
  // TODA forma, inclusive as de canto (arco/arco invertido) — antes elas
  // tinham um recorte à parte (só a caixa da célula, não a própria silhueta),
  // o que deixava metade do traço mais fina bem onde a aresta reta encosta na
  // borda da célula e cheia no resto da curva; unificar os dois casos corrige
  // essa espessura inconsistente.
  function drawCell(cell, x, y, cellBoxSize, neighbors = null) {
    if (cell.shape === 'blank') return '';
    if (cell.shape === 'subdivided') {
      const half = cellBoxSize / 2;
      const positions = { tl: [0, 0], tr: [half, 0], bl: [0, half], br: [half, half] };
      const inner = Object.entries(cell.subCells)
        .map(([corner, subCell]) => drawCell(subCell, positions[corner][0], positions[corner][1], half, null))
        .join('');
      return wrapCellGroup(inner, x, y, cellBoxSize, cell.manualRotation);
    }
    const shapeDef = shapeDefs[cell.shape];
    const paintStyle = { ...style, gradientFillId: sharedGradientId };
    let inner;
    if (style.strokeEnabled) {
      const localOutlineWidthPx = outlineWidthPx;
      const clipId = `cell-clip-${globalClipCounter++}`;
      // algumas formas (cruz, anel, xis) usam strokeWidth pra decidir a
      // própria geometria (espessura da barra/anel), não só a
      // espessura do traço — por isso strokeWidth aqui continua sendo o valor
      // REAL (igual ao do preenchimento sólido, pra silhueta do recorte bater
      // com a forma), e o traço dobrado vai num campo separado
      // (paintStrokeWidth, em px absolutos) que só afeta a espessura da linha
      // desenhada.
      const solidMarkup = shapeDef.draw(cellBoxSize, cell.color, cell.orientation, {
        fillEnabled: true,
        strokeEnabled: false,
      });
      clipDefsMarkup += `<clipPath id="${clipId}">${solidMarkup}</clipPath>\n`;

      // fill desenhado SEPARADO do traço (não numa única tag) e NUNCA passa
      // por nenhum clip extra — ele já coincide exatamente com a própria
      // silhueta, então recortar por cima só serviria pra encolher a forma
      // por engano. Isso é o que dava a impressão de forma "encolhendo" e
      // fundo vazando: o recorte de supressão de borda (abaixo) estava
      // sendo aplicado em cima do fill também, não só do traço.
      const fillMarkup = style.fillEnabled
        ? shapeDef.draw(cellBoxSize, cell.color, cell.orientation, { ...paintStyle, strokeEnabled: false })
        : '';

      // só o traço passa pelos dois recortes: primeiro pela própria
      // silhueta (garante espessura pra dentro, nunca vazando pra célula
      // vizinha), depois — só quando aplicável — pela supressão de borda
      // entre vizinhas da mesma cor.
      const strokeOnlyMarkup = shapeDef.draw(cellBoxSize, cell.color, cell.orientation, {
        ...paintStyle,
        fillEnabled: false,
        strokeEnabled: true,
        paintStrokeWidth: localOutlineWidthPx * 2,
      });
      let strokeGroup = `<g clip-path="url(#${clipId})">${strokeOnlyMarkup}</g>`;

      // nunca duas células desenham o traço da MESMA borda compartilhada —
      // isso é o que dava linha dupla (e de espessura inconsistente) toda vez
      // que duas formas se tocavam. Convenção: cada célula sempre desenha seu
      // próprio traço embaixo/à direita; suprime em cima/à esquerda sempre
      // que a vizinha ali (de cima/esquerda) for cobrir essa MESMA borda pelo
      // lado dela — assim a linha compartilhada é desenhada uma única vez
      // (pela célula de cima/esquerda), nunca duas. Só suprime se a PRÓPRIA
      // forma cobrir aquele lado de ponta a ponta (ver shapeCoversEdge) —
      // senão a faixa cortada arrancaria um pedaço do contorno bem na ponta
      // de formas menores que a célula (losango, cruz, asterisco...),
      // expondo o preenchimento cru ali. Não depende mais da cor da vizinha
      // bater: a ideia agora é sempre uma linha só em qualquer costura, não
      // só quando as cores coincidem.
      if (neighbors) {
        const suppressed = {
          top:
            neighbors.top != null &&
            shapeCoversEdge(cell.shape, 'top', cell.orientation) &&
            shapeCoversEdge(neighbors.top.shape, 'bottom', neighbors.top.orientation),
          left:
            neighbors.left != null &&
            shapeCoversEdge(cell.shape, 'left', cell.orientation) &&
            shapeCoversEdge(neighbors.left.shape, 'right', neighbors.left.orientation),
        };
        if (suppressed.top || suppressed.left) {
          // um <clipPath> aninhado POR LADO suprimido (interseção natural de
          // clips), em vez de <mask> — <mask> depende de um passo extra de
          // composição (rasterizar luminância à parte e multiplicar) que se
          // mostrou instável quando o ícone divide a página com outros SVGs
          // (histórico, variações): o traço daquele lado podia sumir inteiro,
          // sem motivo aparente, só nesses casos. Clip-path é resolvido na
          // hora de desenhar o próprio traço, sem essa etapa a parte, e cada
          // clip aqui corta só UMA faixa (evenodd sem sobreposição possível),
          // então não tem o problema antigo de duas faixas se cancelando no
          // canto compartilhado — aninhar dois clips (topo E esquerda) já
          // faz a interseção certa sozinho.
          const band = Math.max(1, localOutlineWidthPx * 1.5);
          if (suppressed.top) {
            const id = `cell-edge-hole-${globalClipCounter++}`;
            const bandRect = `M 0 0 H ${cellBoxSize} V ${band} H 0 Z`;
            clipDefsMarkup += `<clipPath id="${id}"><path d="M 0 0 H ${cellBoxSize} V ${cellBoxSize} H 0 Z ${bandRect}" fill-rule="evenodd" /></clipPath>\n`;
            strokeGroup = `<g clip-path="url(#${id})">${strokeGroup}</g>`;
          }
          if (suppressed.left) {
            const id = `cell-edge-hole-${globalClipCounter++}`;
            const bandRect = `M 0 0 V ${cellBoxSize} H ${band} V 0 Z`;
            clipDefsMarkup += `<clipPath id="${id}"><path d="M 0 0 H ${cellBoxSize} V ${cellBoxSize} H 0 Z ${bandRect}" fill-rule="evenodd" /></clipPath>\n`;
            strokeGroup = `<g clip-path="url(#${id})">${strokeGroup}</g>`;
          }
        }
      }
      inner = fillMarkup + strokeGroup;
    } else {
      inner = shapeDef.draw(cellBoxSize, cell.color, cell.orientation, paintStyle);
    }
    const wrapped = `<g class="cell" data-shape="${cell.shape}">${inner}</g>`;
    return wrapCellGroup(wrapped, x, y, cellBoxSize, cell.manualRotation);
  }

  // edição manual (arrastar/girar um bloco) gira só aquele bloco inteiro em
  // torno do próprio centro, independente da rotação global do ícone.
  function wrapCellGroup(inner, x, y, cellBoxSize, manualRotation) {
    const rotateAttr = manualRotation ? ` rotate(${manualRotation} ${cellBoxSize / 2} ${cellBoxSize / 2})` : '';
    return `<g transform="translate(${x}, ${y})${rotateAttr}">${inner}</g>\n`;
  }

  let cellsMarkup = '';
  for (let r = 0; r < gridRows; r++) {
    for (let c = 0; c < gridCols; c++) {
      const neighbors = style.strokeEnabled
        ? {
            top: neighborInfo(r - 1, c),
            left: neighborInfo(r, c - 1),
          }
        : null;
      cellsMarkup += drawCell(grid[r][c], c * cellSize, r * cellSize, cellSize, neighbors);
    }
  }

  const bgColor = silhouette ? (invert ? inkColor : background) : invert ? invertHex(background) : background;
  const backgroundMarkup = transparentBackground
    ? ''
    : `<g id="background"><rect width="${iconWidth}" height="${iconHeight}" fill="${bgColor}" /></g>\n  `;

  // rotação (0/90/180/270°) só se aplica de verdade numa grade QUADRADA —
  // numa retangular, girar 90/270 trocaria largura por altura e o
  // conteúdo vazaria pra fora do viewBox fixo. O quadro de exportação
  // não-quadrado sempre chama esta função com rotation=0 por causa disso
  // (ver buildFramedIconSvg em grid-icons/index.js); o ícone 1:1 normal
  // continua girando livremente, sem mudança nenhuma aqui.
  const rotationAttr = rotation ? ` transform="rotate(${rotation} ${iconWidth / 2} ${iconHeight / 2})"` : '';

  // máscaras dos ícones customizados: um único <mask> por ícone enviado,
  // reaproveitado por todas as células que o usam (maskContentUnits em
  // objectBoundingBox faz o mesmo <image> caber em qualquer tamanho de célula).
  const customMasksMarkup = Object.values(customShapeDefs)
    .filter((def) => def.maskDataUrl)
    .map(
      (def) =>
        `<mask id="${def.maskId}" maskContentUnits="objectBoundingBox"><image href="${def.maskDataUrl}" x="0" y="0" width="1" height="1" preserveAspectRatio="none" /></mask>`
    )
    .join('\n');
  const grainFilterId = grainActive ? `grain-${globalClipCounter++}` : null;
  const grainDefsMarkup = grainFilterId
    ? buildGrainFilterMarkup(grainFilterId, { intensity: grainIntensity, grainSize, color: grainColor })
    : '';
  const allDefsMarkup = customMasksMarkup + clipDefsMarkup + gradientDefMarkup + grainDefsMarkup;
  const defsMarkup = allDefsMarkup ? `<defs>\n${allDefsMarkup}</defs>\n  ` : '';
  const iconFilterAttr = grainFilterId ? ` filter="url(#${grainFilterId})"` : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${iconWidth} ${iconHeight}" width="${iconWidth}" height="${iconHeight}">
  <g${rotationAttr}>
  ${defsMarkup}${backgroundMarkup}<g id="icon"${iconFilterAttr}>
${cellsMarkup}  </g>
  </g>
</svg>`;
}

export function generateIcon(params) {
  const { grid, size, cols, rows } = buildIconGrid(params);
  return renderGridToSvg({ ...params, grid, size, cols, rows });
}

// gera a composição INTEIRA do "quadro" de exportação não-quadrado numa
// passada só — sem repetir/ladrilhar o ícone 1:1 (isso deixava uma
// "costura" visível a cada repetição, e cortava formas ao meio na borda
// do quadro sempre que a proporção não batia com um múltiplo exato do
// ícone). Em vez disso, a MESMA grade é só esticada em colunas ou linhas
// (o eixo que cresce pra alcançar a proporção pedida) — a resolução, o
// tamanho de célula e todas as regras de forma/cor/densidade continuam
// as mesmas de sempre, só aparece mais grade (mais colunas numa
// paisagem, mais linhas num retrato), como se o próprio padrão
// continuasse. Sem guia de imagem (amostrada só em grade quadrada) e sem
// rotação global (giraria o retângulo pra fora do próprio viewBox) — as
// duas coisas continuam funcionando normalmente no ícone 1:1 em si.
// colunas/linhas da composição — exportada separada da função de baixo
// porque quem monta o preview (grid-icons/index.js) precisa saber a
// proporção REAL que vai sair (cols/rows) ANTES de decidir o tamanho da
// caixa do preview. A proporção pedida (ex.: 4:5 exato) quase nunca cai
// num número inteiro de colunas/linhas — arredondar pra cima/baixo aqui é
// o que garante células sempre INTEIRAS, mas isso desvia um pouco da
// proporção nominal (0.8 vira, por ex., 0.75). Se a caixa do preview
// fosse dimensionada pela proporção NOMINAL em vez da REAL (cols/rows), a
// composição saía cortada de um lado ou sobrando vazio do outro — daí a
// caixa do preview tem que sempre seguir esta conta, não o rótulo do
// formato.
export function framedGridDims(size, ratio) {
  const cols = ratio >= 1 ? Math.max(1, Math.round(size * ratio)) : size;
  const rows = ratio >= 1 ? size : Math.max(1, Math.round(size / ratio));
  return { cols, rows };
}

export function generateFramedIcon(params, ratio) {
  const { cols, rows } = framedGridDims(params.size, ratio);
  const { grid } = buildIconGrid({ ...params, cols, rows, imageGuide: null });
  return renderGridToSvg({ ...params, grid, cols, rows, rotation: 0 });
}
