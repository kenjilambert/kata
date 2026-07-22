const ROT90 = { tl: 'tr', tr: 'br', br: 'bl', bl: 'tl' };
const MIRROR_H = { tl: 'tr', tr: 'tl', bl: 'br', br: 'bl' };
const MIRROR_V = { tl: 'bl', bl: 'tl', tr: 'br', br: 'tr' };
const MIRROR_BOTH = { tl: 'br', tr: 'bl', br: 'tl', bl: 'tr' };

// Repositions a cell's own orientation (if any) AND, recursively, any sub-cells
// it carries (from the "detalhe/subdivisão" feature) — a sub-cell grid is keyed
// by corner exactly like orientation, so the same corner map remaps both.
function remapCell(cell, map) {
  if (!cell.orientation && !cell.subCells) return cell;
  const next = { ...cell };
  if (cell.orientation) next.orientation = map[cell.orientation];
  if (cell.subCells) {
    const remapped = {};
    for (const corner of Object.keys(cell.subCells)) {
      remapped[map[corner]] = remapCell(cell.subCells[corner], map);
    }
    next.subCells = remapped;
  }
  return next;
}

function rotateQuadrant90(quadrant) {
  const h = quadrant.length;
  const out = Array.from({ length: h }, () => new Array(h));
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < h; c++) {
      out[r][c] = remapCell(quadrant[h - 1 - c][r], ROT90);
    }
  }
  return out;
}

// symmetry: 'none' | 'mirror-h' | 'mirror-full' | 'rotational'
// cellFactory(row, col) is only called for the minimal seed region needed;
// the rest of the grid is derived by reflection/rotation.
export function generateSymmetricGrid({ size, symmetry, cellFactory }) {
  const grid = Array.from({ length: size }, () => new Array(size));

  if (symmetry === 'none') {
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) grid[r][c] = cellFactory(r, c);
    }
    return grid;
  }

  if (symmetry === 'mirror-h') {
    const w = Math.ceil(size / 2);
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < w; c++) {
        const cell = cellFactory(r, c);
        grid[r][c] = cell;
        const mirrorC = size - 1 - c;
        if (mirrorC !== c) grid[r][mirrorC] = remapCell(cell, MIRROR_H);
      }
    }
    return grid;
  }

  const h = Math.floor(size / 2);
  const seedQuadrant = Array.from({ length: h }, (_, r) =>
    Array.from({ length: h }, (_, c) => cellFactory(r, c))
  );

  let tl = seedQuadrant;
  let tr;
  let bl;
  let br;

  if (symmetry === 'rotational') {
    tr = rotateQuadrant90(tl);
    br = rotateQuadrant90(tr);
    bl = rotateQuadrant90(br);
  } else {
    tr = seedQuadrant.map((row) => row.slice().reverse().map((cell) => remapCell(cell, MIRROR_H)));
    bl = seedQuadrant.slice().reverse().map((row) => row.map((cell) => remapCell(cell, MIRROR_V)));
    br = seedQuadrant
      .slice()
      .reverse()
      .map((row) => row.slice().reverse().map((cell) => remapCell(cell, MIRROR_BOTH)));
  }

  for (let r = 0; r < h; r++) {
    for (let c = 0; c < h; c++) {
      grid[r][c] = tl[r][c];
      grid[r][size - 1 - c] = tr[r][c];
      grid[size - 1 - r][c] = bl[r][c];
      grid[size - 1 - r][size - 1 - c] = br[r][c];
    }
  }

  if (size % 2 === 1) {
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (!grid[r][c]) grid[r][c] = cellFactory(r, c);
      }
    }
  }

  return grid;
}

// Rótulos de exibição ficam no dicionário de i18n (chave `symmetry_<value>`),
// não aqui — esta lista é só a identidade estável dos modos de simetria.
export const SYMMETRY_VALUES = ['none', 'mirror-h', 'mirror-full', 'rotational'];
