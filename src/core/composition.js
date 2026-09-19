import { contrastRatio } from './color.js';

// Avaliação de composição de uma grade gerada por buildIconGrid
// (grid-icons/generator.js) — função PURA: sem DOM, sem rng, sem efeito
// colateral. Recebe a grade já decidida e devolve um número 0..1 que resume
// "isso parece uma composição intencional?" a partir de cinco critérios
// independentes (ver WEIGHTS). Serve pra UI ordenar variações, avisar quando
// um ícone saiu "salada" ou "apagado", ou pra um futuro "gerar N e ficar com
// o melhor" — por isso NÃO altera a grade nem sorteia nada (a geração
// continua determinística e o score é só uma leitura dela).
//
// Estrutura de célula (ver cellFactory em buildIconGrid):
//   { shape: 'blank' }                                      → vazia
//   { shape: 'subdivided', subCells: { tl, tr, br, bl } }  → 4 sub-células
//                                                            (cada uma vazia ou
//                                                            com forma/cor)
//   { shape: '<key>', orientation?, color }                → forma preenchida
// Uma sub-célula ocupa 1/4 da área da célula — em tudo que é "por área"
// (distribuição de cor, centroide) ela pesa 0.25 e fica no seu quadrante.

// Pesos dos sub-scores (somam 1). Cor e contraste pesam mais porque são o
// que mais salta aos olhos num ícone pequeno; centralização pesa menos
// porque qualquer simetria já garante centroide perfeito (vira quase um
// bônus só pra 'none' e pras grades retangulares do quadro de exportação).
export const WEIGHTS = {
  colorBalance: 0.25,
  contrast: 0.25,
  shapeVariety: 0.15,
  centering: 0.15,
  adjacency: 0.2,
};

const CORNER_OFFSET = { tl: [0.25, 0.25], tr: [0.25, 0.75], bl: [0.75, 0.25], br: [0.75, 0.75] };
// pares de sub-células que se tocam ortogonalmente dentro da mesma célula
const SUB_PAIRS = [
  ['tl', 'tr'],
  ['bl', 'br'],
  ['tl', 'bl'],
  ['tr', 'br'],
];

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function isLeaf(cell) {
  return cell && cell.shape !== 'blank' && cell.shape !== 'subdivided';
}

// Achata a grade em "folhas" (formas de fato pintadas) com posição em
// coordenadas de célula (centro da forma) e área relativa.
function collectLeaves(grid) {
  const leaves = [];
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];
    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      if (!cell || cell.shape === 'blank') continue;
      if (cell.shape === 'subdivided') {
        for (const corner of Object.keys(cell.subCells || {})) {
          const sub = cell.subCells[corner];
          if (!isLeaf(sub)) continue;
          const [dr, dc] = CORNER_OFFSET[corner] || [0.5, 0.5];
          leaves.push({ shape: sub.shape, color: sub.color, r: r + dr, c: c + dc, area: 0.25 });
        }
        continue;
      }
      leaves.push({ shape: cell.shape, color: cell.color, r: r + 0.5, c: c + 0.5, area: 1 });
    }
  }
  return leaves;
}

function normalizeHex(hex) {
  return typeof hex === 'string' ? hex.trim().toLowerCase() : '';
}

// (a) equilíbrio de cor: metade "fidelidade aos pesos da paleta" (distância
// de variação total entre a distribuição observada por área e a distribuição
// alvo weight/Σweight — 1 = idêntica, 0 = disjunta) e metade "dominância"
// (a cor mais usada deveria cobrir ~50% da área: 100% é monotonia, 1/n é
// salada — as duas pontas descem até 0). Cores fora da paleta (silhueta/
// inverter cores mudam o hex real) caem num balde "outro", que só conta
// contra a fidelidade — o score não quebra, só desce.
function scoreColorBalance(leaves, colors) {
  const palette = (colors || []).map((c) => ({ key: normalizeHex(c.color), weight: c.weight ?? 1 }));
  const totalArea = leaves.reduce((s, l) => s + l.area, 0);
  if (totalArea === 0) return { score: 0, observed: {}, target: {}, dominant: 0 };

  const observed = {};
  for (const leaf of leaves) {
    const key = normalizeHex(leaf.color);
    observed[key] = (observed[key] || 0) + leaf.area / totalArea;
  }
  const shares = Object.values(observed);
  const dominant = Math.max(...shares);

  // paleta de 1 cor (ou vazia): não há o que equilibrar — só a dominância
  // é trivialmente 1 (uma cor só = monotonia por definição, mas foi escolha
  // de quem montou a paleta, não falha da composição).
  if (palette.length <= 1) return { score: 1, observed, target: {}, dominant };

  const totalWeight = palette.reduce((s, p) => s + p.weight, 0) || 1;
  const target = {};
  for (const p of palette) target[p.key] = (target[p.key] || 0) + p.weight / totalWeight;

  const keys = new Set([...Object.keys(observed), ...Object.keys(target)]);
  let tv = 0;
  for (const key of keys) tv += Math.abs((observed[key] || 0) - (target[key] || 0));
  const fidelity = 1 - tv / 2;

  const dominance = 1 - clamp01(Math.abs(dominant - 0.5) / 0.5);
  return { score: clamp01(0.5 * fidelity + 0.5 * dominance), observed, target, dominant };
}

// (b) contraste figura/fundo: média da razão WCAG de cada cor DISTINTA usada
// contra o fundo; 1.0 (invisível) → 0, 4.5 (AA texto normal) ou mais → 1.
// Cor/fundo não-hex (NaN) é ignorada; se nada sobrar, 0.
function scoreContrast(leaves, background) {
  const used = [...new Set(leaves.map((l) => normalizeHex(l.color)))];
  const ratios = used.map((hex) => contrastRatio(hex, background)).filter((r) => !Number.isNaN(r));
  if (ratios.length === 0) return { score: 0, mean: NaN, ratios: {} };
  const mean = ratios.reduce((s, r) => s + r, 0) / ratios.length;
  const byColor = {};
  for (const hex of used) byColor[hex] = contrastRatio(hex, background);
  return { score: clamp01((mean - 1) / (4.5 - 1)), mean, ratios: byColor };
}

// (c) variedade de formas: entropia de Shannon da distribuição de formas
// (por contagem de folhas) normalizada pelo máximo possível — log de quantas
// formas estão permitidas, limitado ao nº de folhas (com 3 formas pintadas
// não dá pra exibir 14 diferentes). Só 1 forma permitida → 1 (não havia
// escolha). Sem `shapesAllowed`, usa as formas distintas que apareceram.
function scoreShapeVariety(leaves, shapesAllowed) {
  if (leaves.length === 0) return { score: 0, entropy: 0, distinct: 0, allowed: 0 };
  const counts = {};
  for (const leaf of leaves) counts[leaf.shape] = (counts[leaf.shape] || 0) + 1;
  const distinct = Object.keys(counts).length;
  const allowed = Array.isArray(shapesAllowed) && shapesAllowed.length ? new Set(shapesAllowed).size : distinct;
  const maxDistinct = Math.min(allowed, leaves.length);
  if (maxDistinct <= 1) return { score: 1, entropy: 0, distinct, allowed };
  let entropy = 0;
  for (const n of Object.values(counts)) {
    const p = n / leaves.length;
    entropy -= p * Math.log(p);
  }
  return { score: clamp01(entropy / Math.log(maxDistinct)), entropy, distinct, allowed };
}

// (d) peso visual centrado: centroide (por área) das folhas vs. centro da
// grade, normalizado pela distância centro→canto. Um desvio de metade do
// caminho até o canto já zera — meio caminho é visivelmente torto num ícone.
function scoreCentering(leaves, rows, cols) {
  const totalArea = leaves.reduce((s, l) => s + l.area, 0);
  if (totalArea === 0) return { score: 0, offset: [NaN, NaN] };
  let cr = 0;
  let cc = 0;
  for (const leaf of leaves) {
    cr += leaf.r * leaf.area;
    cc += leaf.c * leaf.area;
  }
  cr /= totalArea;
  cc /= totalArea;
  const dr = cr - rows / 2;
  const dc = cc - cols / 2;
  const maxDist = Math.sqrt((rows / 2) ** 2 + (cols / 2) ** 2) || 1;
  const dist = Math.sqrt(dr * dr + dc * dc) / maxDist;
  return { score: clamp01(1 - 2 * dist), offset: [dr, dc] };
}

// (e) repetição adjacente: entre pares ortogonalmente vizinhos de formas
// pintadas (célula↔célula no nível de cima, e sub-célula↔sub-célula dentro
// de uma célula subdividida — uma subdividida não tem "uma forma" própria,
// então não pareia com a vizinha de nível de cima, mesmo critério do
// renderizador em neighborInfo), a fração com a MESMA forma E a MESMA cor.
// Fração 0 → 1; 2/3 ou mais dos pares repetidos → 0 (a inclinação 1.5 faz
// repetição em escala de "padrão de azulejo" pesar mais que linear).
function scoreAdjacency(grid) {
  let pairs = 0;
  let same = 0;
  const check = (a, b) => {
    if (!isLeaf(a) || !isLeaf(b)) return;
    pairs += 1;
    if (a.shape === b.shape && normalizeHex(a.color) === normalizeHex(b.color)) same += 1;
  };
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];
    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      if (!cell) continue;
      if (cell.shape === 'subdivided') {
        for (const [p, q] of SUB_PAIRS) check(cell.subCells?.[p], cell.subCells?.[q]);
        continue;
      }
      if (c + 1 < row.length) check(cell, row[c + 1]);
      if (r + 1 < grid.length) check(cell, grid[r + 1][c]);
    }
  }
  const ratio = pairs ? same / pairs : 0;
  return { score: clamp01(1 - 1.5 * ratio), pairs, same, ratio };
}

// Devolve tudo aberto (sub-scores + estatísticas que os geraram) — pra
// depurar/expor na UI. `shapesAllowed` é opcional (ver scoreShapeVariety).
export function explainComposition({ grid, colors, background, shapesAllowed } = {}) {
  const rows = Array.isArray(grid) ? grid.length : 0;
  const cols = rows ? grid[0].length : 0;
  if (!rows || !cols) {
    return { score: 0, weights: WEIGHTS, sub: {}, detail: {}, filled: 0 };
  }
  const leaves = collectLeaves(grid);
  const colorBalance = scoreColorBalance(leaves, colors);
  const contrast = scoreContrast(leaves, background);
  const shapeVariety = scoreShapeVariety(leaves, shapesAllowed);
  const centering = scoreCentering(leaves, rows, cols);
  const adjacency = scoreAdjacency(grid);

  const sub = {
    colorBalance: colorBalance.score,
    contrast: contrast.score,
    shapeVariety: shapeVariety.score,
    centering: centering.score,
    adjacency: adjacency.score,
  };
  // grade sem nenhuma forma pintada não é uma composição — 0 direto, em vez
  // de somar sub-scores que "acidentalmente" dão 1 (ex.: adjacência sem pares).
  const score = leaves.length === 0 ? 0 : clamp01(Object.keys(WEIGHTS).reduce((s, k) => s + WEIGHTS[k] * sub[k], 0));

  return {
    score,
    weights: WEIGHTS,
    sub,
    detail: { colorBalance, contrast, shapeVariety, centering, adjacency },
    filled: leaves.length,
  };
}

export function scoreComposition(input) {
  return explainComposition(input).score;
}
