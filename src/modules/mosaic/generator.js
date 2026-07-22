import { buildIconGrid, renderGridToSvg, buildCustomShapeDefs } from '../grid-icons/generator.js';
import { hashStringToSeed } from '../../core/seed.js';
import { resolveGradientFactor } from '../../core/gradient.js';
import { sampleImageGridRect } from '../../core/imageSampling.js';
import { buildGrainFilterMarkup } from '../../core/textures.js';

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

// uniformDensity vai de 0 a 2 (0-200% no slider). Multiplicar direto
// (base*uniformDensity) e só depois grudar no clamp01 fazia o slider "parar
// de fazer efeito" bem antes de 200% sempre que base já era média/alta (ex.:
// base=0.7 satura em uniformDensity=1.43, ou seja quase metade do range de
// 100-200% virava um no-op). Em vez disso, trata 100% como "densidade do
// Azulejo sem alteração" e interpola LINEARMENTE dali até 1.0 (preenchimento
// total) conforme uniformDensity vai de 1 a 2 — garante que o slider inteiro
// (0 a 200%) sempre tem efeito visível, não importa a densidade base.
function scaleDensity(base, uniformDensity) {
  if (uniformDensity <= 1) return base * uniformDensity;
  return base + (1 - base) * (uniformDensity - 1);
}

// renderGridToSvg devolve um <svg>...</svg> completo (viewBox/width/height
// próprios) — pra colar vários lado a lado num mosaico só, cada tile entra
// como um <g transform="translate(...)"> com só o conteúdo de dentro do svg.
function stripSvgWrapper(svgString) {
  return svgString.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
}

// "t" de cada tile (0..1) — ou via gradiente procedural (linear/radial, ver
// core/gradient.js) ou amostrando a luminância de uma imagem colada/enviada
// ou desenhada como máscara preto-e-branco (mesma técnica de
// core/imageSampling.js já usada pelo guia de imagem do Azulejo, só que numa
// grade retangular). No modo "imagem", branco = preenchido (convenção de
// máscara comum). No modo "desenho", é invertido: o traço (escuro) é o que
// vira tile preenchido — mais intuitivo pra quem desenha num canvas branco
// esperando ver o desenho "aparecer" em tiles.
function computeMaskGrid({ tilesX, tilesY, densityMask, maskImageEl }) {
  if ((densityMask.source === 'image' || densityMask.source === 'draw') && maskImageEl) {
    const luminanceGrid = sampleImageGridRect(maskImageEl, tilesX, tilesY);
    return luminanceGrid.map((row) =>
      row.map((px) => (densityMask.source === 'draw' ? 1 - px.luminance : px.luminance))
    );
  }
  const grid = [];
  const denomX = Math.max(1, tilesX - 1);
  const denomY = Math.max(1, tilesY - 1);
  for (let r = 0; r < tilesY; r++) {
    const row = [];
    for (let c = 0; c < tilesX; c++) {
      row.push(resolveGradientFactor(densityMask, c / denomX, r / denomY));
    }
    grid.push(row);
  }
  return grid;
}

// smoothness (0..1, controlado pelo slider) vira um expoente de curva — sem
// nenhum limiar/degrau nem sobreposição de opacidade, só puxando a curva de
// densidade pra ficar mais gradual perto do lado cheio. smoothness=0 é uma
// curva linear (t^1); mais smoothness curva a função pra cima (t^gamma com
// gamma<1), fazendo mais tiles ficarem "razoavelmente cheios" antes de
// chegar no máximo — em vez de pular de um bloco cheio pra variações do
// nada, a densidade desce aos poucos, tile a tile.
function densityCurve(t, smoothness) {
  const gamma = 1 - clamp01(smoothness) * 0.7;
  return Math.pow(clamp01(t), gamma);
}

// stripSvgWrapper joga fora o <svg> de cada tile pra virar um <g> — mas com
// isso perde o clip de viewport que o <svg> dava de graça. Sem esse clip,
// qualquer coisa que vaze do quadrado do ícone (rotação do ícone inteiro
// embutida sem viewport, futuras extensões) vazaria visualmente pro tile
// vizinho, o que arruinaria a repetição sem costura. Um único clipPath
// compartilhado (mesmo tileSize pra todos os tiles) resolve isso de graça.
let globalTileClipCounter = 0;

// monta UM SVG grande com tilesX×tilesY ícones, cada um variação (seed
// derivada de forma determinística) da MESMA receita vinda do patternState
// compartilhado (formas, paleta, resolução, tema, modo de preenchimento
// etc. — só fillDensity e seed mudam por tile). A máscara de densidade
// controla, por posição, o quanto cada tile é preenchido — nada de cor
// sólida sobreposta por cima: o "100% preenchido" e o "vazio" vêm só de
// variar a quantidade de ícones/preenchimento de cada tile, igual a receita
// já configurada no Azulejo, só que numa curva contínua (sem degraus).
export function buildMosaicSvg({ pattern, tilesX, tilesY, tileSize, gap, mosaicSeed, densityMask, maskImageEl, uniformDensity = 1 }) {
  const maskGrid = densityMask.enabled ? computeMaskGrid({ tilesX, tilesY, densityMask, maskImageEl }) : null;
  const customShapeDefs = buildCustomShapeDefs(pattern.customShapes);
  const appearance = {
    transparentBackground: pattern.transparentBg || pattern.blackIcon,
    silhouette: pattern.blackIcon,
    invert: pattern.invertColors,
    inkColor: '#000000',
  };
  // cada TILE renderiza sempre com fundo transparente, mesmo quando o
  // mosaico inteiro não é transparente — o retângulo de fundo "de verdade"
  // é só o do mosaico (bgRect, mais abaixo), pintado uma única vez atrás de
  // tudo. Sem isso, cada tile pintava seu PRÓPRIO fundo opaco por baixo das
  // células vazias — redundante quando gap=0, mas também significava que o
  // filtro de grão (aplicado uma vez sobre todos os tiles) escurecia esses
  // retângulos de fundo repetidos, não só as formas com degradê, fazendo o
  // grão parecer que cobria o mosaico inteiro em vez de só os ícones.
  const tileAppearance = { ...appearance, transparentBackground: true };

  const tileClipId = `mosaic-tile-clip-${globalTileClipCounter++}`;
  const tileClipDefs = `<clipPath id="${tileClipId}"><rect x="0" y="0" width="${tileSize}" height="${tileSize}" /></clipPath>`;

  let tilesMarkup = '';
  for (let r = 0; r < tilesY; r++) {
    for (let c = 0; c < tilesX; c++) {
      const x = c * (tileSize + gap);
      const y = r * (tileSize + gap);

      const gradientFactor = maskGrid ? densityCurve(maskGrid[r][c], densityMask.smoothness) : 1;
      const tileFillDensity = clamp01(scaleDensity(pattern.fillDensity, uniformDensity) * gradientFactor);
      const seed = hashStringToSeed(`${pattern.seed}-${mosaicSeed}-${r}-${c}`);
      const { grid, size } = buildIconGrid({
        seed,
        size: pattern.resolution,
        symmetry: pattern.symmetry,
        fillDensity: tileFillDensity,
        shapesAllowed: pattern.shapesAllowed,
        background: pattern.background,
        colors: pattern.colors,
        subdivisionChance: pattern.subdivisionChance,
        detailGradient: pattern.detailGradient,
        appearance,
        customShapeDefs,
      });
      const tileSvg = renderGridToSvg({
        grid,
        size,
        iconSize: tileSize,
        background: pattern.background,
        fillEnabled: pattern.fillEnabled,
        strokeEnabled: pattern.strokeEnabled,
        strokeColor: pattern.strokeColor,
        strokeWidth: pattern.strokeWidth,
        strokeOutlineWidth: pattern.strokeOutlineWidth,
        gradientFillEnabled: pattern.gradientFillEnabled,
        gradientFillAngle: pattern.gradientFillAngle,
        gradientStops: pattern.gradientStops,
        // grão NÃO entra aqui de propósito — um filtro feTurbulence por tile
        // (até 100+ tiles num mosaico grande) custaria caro e cada tile teria
        // um grão independente, com costura visível na fronteira entre eles.
        // É aplicado uma vez só, por cima do mosaico inteiro, mais abaixo.
        rotation: pattern.rotation,
        appearance: tileAppearance,
        customShapeDefs,
      });

      tilesMarkup += `<g transform="translate(${x}, ${y})" clip-path="url(#${tileClipId})">${stripSvgWrapper(tileSvg)}</g>\n`;
    }
  }

  const width = tilesX * tileSize + Math.max(0, tilesX - 1) * gap;
  const height = tilesY * tileSize + Math.max(0, tilesY - 1) * gap;
  const bgRect = pattern.transparentBg ? '' : `<rect width="${width}" height="${height}" fill="${pattern.background}" />\n`;

  // grão aplicado UMA VEZ, por cima do mosaico inteiro (não por tile — ver
  // comentário acima) — só existe amarrado ao degradê interno, mesma regra
  // do Azulejo.
  const grainActive = pattern.gradientFillEnabled && pattern.grainEnabled;
  const grainFilterId = grainActive ? `mosaic-grain-${globalTileClipCounter++}` : null;
  const grainDefs = grainFilterId
    ? buildGrainFilterMarkup(grainFilterId, {
        intensity: pattern.grainIntensity,
        grainSize: pattern.grainSize,
        color: pattern.grainColor,
      })
    : '';
  const grainAttr = grainFilterId ? ` filter="url(#${grainFilterId})"` : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
<defs>${tileClipDefs}${grainDefs}</defs>
${bgRect}<g${grainAttr}>${tilesMarkup}</g></svg>`;
}
