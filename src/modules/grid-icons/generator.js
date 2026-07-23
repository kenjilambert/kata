import { createRng } from '../../core/seed.js';
import { pickWeighted } from '../../core/palette.js';
import { generateSymmetricGrid } from '../../core/symmetry.js';
import { nearestPaletteColor } from '../../core/imageSampling.js';
import { buildGrainFilterMarkup } from '../../core/textures.js';
import { SHAPES } from './shapes.js';

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
function gradientFactorFor(r, c, size, densityGradient, gradientDirection) {
  const denom = Math.max(1, size - 1);
  const nx = c / denom;
  const ny = r / denom;

  if (densityGradient === 'radial') {
    const center = denom / 2;
    const maxDist = Math.sqrt(2) * center || 1;
    const dist = Math.sqrt((r - center) ** 2 + (c - center) ** 2) / maxDist;
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
  const rng = createRng(seed);
  const center = (size - 1) / 2;
  const maxRing = Math.max(1, Math.floor((size - 1) / 2));
  // grade 2x2 (ver comentário em pickFamily): toda célula cai no anel 0,
  // não existe variedade de anel de verdade pra curar por família.
  const ringsCollapse = Math.floor((size - 1) / 2) === 0;
  const shapeDefs = { ...SHAPES, ...customShapeDefs };
  const { silhouette, invert, inkColor } = { ...DEFAULT_APPEARANCE, ...appearance };
  const luminanceThreshold = imageGuide ? luminanceThresholdFor(imageGuide.grid, fillDensity) : null;
  const useDensityGradient = densityGradient !== 'none' && !imageGuide;

  // t=1 é a ponta "cheia" do gradiente, t=0 a ponta "vazia" (ver gradientFactorFor).
  // Interpola entre a densidade base (sem gradiente) e o extremo 0↔1 conforme a
  // intensidade escolhida — com intensidade máxima o próprio t vira a densidade,
  // então uma ponta fica praticamente sólida e a outra praticamente vazia.
  function effectiveDensityFor(r, c) {
    if (!useDensityGradient) return fillDensity;
    const t = gradientFactorFor(r, c, size, densityGradient, gradientDirection);
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
      const outward = outwardCorner(r, c, center);
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

    const ring = Math.floor(Math.max(Math.abs(r - center), Math.abs(c - center)));
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

  const grid = generateSymmetricGrid({ size, symmetry, cellFactory });

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

  return { grid, size };
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
  const cellSize = iconSize / size;
  const style = { fillEnabled, strokeEnabled, strokeColor, strokeWidth };
  // traço decorativo (contorno): px "de referência" pra uma célula de
  // primeiro nível (não varia com a resolução — 2x2 e 10x10 têm células de
  // tamanhos bem diferentes, mas o contorno deve parecer igual). Escalado
  // pela referência de tamanho do ÍCONE pra miniaturas menores (variações/
  // histórico) mostrarem o traço proporcionalmente mais fino, não gigante.
  // Células SUBDIVIDIDAS (detalhe) desenham em metade do tamanho — usar essa
  // mesma largura ali faria o traço parecer bem mais grosso relativo à forma
  // menor; outlineWidthForBox() abaixo escala pra baixo proporcionalmente ao
  // tamanho real da caixa sendo desenhada, mantendo o peso visual igual em
  // qualquer nível de subdivisão.
  const outlineWidthPx = Math.max(0.5, strokeOutlineWidth * (iconSize / OUTLINE_REFERENCE_ICON_SIZE));
  function outlineWidthForBox(cellBoxSize) {
    return Math.max(0.5, outlineWidthPx * (cellBoxSize / cellSize));
  }
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

  // cor "efetiva" de uma célula vizinha, só pra decidir se o traço entre elas
  // deve sumir (ver suppressedEdges abaixo) — vizinha fora da grade, vazia ou
  // subdividida (sem uma cor única própria) nunca "casa", então a borda com
  // ela sempre mostra traço normalmente.
  function neighborColor(r, c) {
    if (r < 0 || r >= size || c < 0 || c >= size) return null;
    const n = grid[r][c];
    if (!n || n.shape === 'blank' || n.shape === 'subdivided') return null;
    return n.color;
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
      const localOutlineWidthPx = outlineWidthForBox(cellBoxSize);
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

      // sem traço entre duas células vizinhas da MESMA cor — só nas bordas
      // onde a cor realmente muda (ou encosta no fundo/vazio). Recorta uma
      // segunda vez (interseção com o primeiro clip) removendo uma faixa nas
      // bordas da célula que "casam" com a vizinha; como o clip de cima já
      // deixou só a metade de dentro do traço (largura nominal) colada
      // exatamente nessas bordas, uma faixa de ~1.5x a largura nominal cobre
      // toda ela com folga. Só afeta strokeGroup — o fill acima fica de fora.
      if (neighbors) {
        const suppressed = {
          top: neighbors.top != null && neighbors.top === cell.color,
          bottom: neighbors.bottom != null && neighbors.bottom === cell.color,
          left: neighbors.left != null && neighbors.left === cell.color,
          right: neighbors.right != null && neighbors.right === cell.color,
        };
        if (suppressed.top || suppressed.bottom || suppressed.left || suppressed.right) {
          // máscara (branco=mostra, preto=esconde) em vez de um único path
          // evenodd somando os retângulos de faixa: quando DUAS faixas
          // perpendiculares se suprimem ao mesmo tempo (ex.: topo + esquerda),
          // elas se sobrepõem no cantinho compartilhado — evenodd conta essa
          // sobreposição como "dentro" de novo (par vira ímpar), reabrindo uma
          // lasquinha de traço bem no canto que deveria ficar escondido. Faixas
          // pretas numa máscara só se somam (preto sobre preto continua
          // preto), então sobreposição nunca reabre nada.
          const band = Math.max(1, localOutlineWidthPx * 1.5);
          let bands = '';
          if (suppressed.top) bands += `<rect x="0" y="0" width="${cellBoxSize}" height="${band}" fill="#000" />`;
          if (suppressed.bottom) bands += `<rect x="0" y="${cellBoxSize - band}" width="${cellBoxSize}" height="${band}" fill="#000" />`;
          if (suppressed.left) bands += `<rect x="0" y="0" width="${band}" height="${cellBoxSize}" fill="#000" />`;
          if (suppressed.right) bands += `<rect x="${cellBoxSize - band}" y="0" width="${band}" height="${cellBoxSize}" fill="#000" />`;
          const holeMaskId = `cell-edge-hole-${globalClipCounter++}`;
          clipDefsMarkup += `<mask id="${holeMaskId}"><rect x="0" y="0" width="${cellBoxSize}" height="${cellBoxSize}" fill="#fff" />${bands}</mask>\n`;
          strokeGroup = `<g mask="url(#${holeMaskId})">${strokeGroup}</g>`;
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
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const neighbors = style.strokeEnabled
        ? {
            top: neighborColor(r - 1, c),
            bottom: neighborColor(r + 1, c),
            left: neighborColor(r, c - 1),
            right: neighborColor(r, c + 1),
          }
        : null;
      cellsMarkup += drawCell(grid[r][c], c * cellSize, r * cellSize, cellSize, neighbors);
    }
  }

  const bgColor = silhouette ? (invert ? inkColor : background) : invert ? invertHex(background) : background;
  const backgroundMarkup = transparentBackground
    ? ''
    : `<g id="background"><rect width="${iconSize}" height="${iconSize}" fill="${bgColor}" /></g>\n  `;

  const rotationAttr = rotation ? ` transform="rotate(${rotation} ${iconSize / 2} ${iconSize / 2})"` : '';

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

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${iconSize} ${iconSize}" width="${iconSize}" height="${iconSize}">
  <g${rotationAttr}>
  ${defsMarkup}${backgroundMarkup}<g id="icon"${iconFilterAttr}>
${cellsMarkup}  </g>
  </g>
</svg>`;
}

export function generateIcon(params) {
  const { grid, size } = buildIconGrid(params);
  return renderGridToSvg({ ...params, grid, size });
}
