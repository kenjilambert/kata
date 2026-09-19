// (3) symmetry.js — a grade gerada respeita a simetria declarada
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSymmetricGrid, SYMMETRY_VALUES } from '../src/core/symmetry.js';
import { CORNERS } from './_helpers.mjs';

// Mesmos mapas de canto de symmetry.js (não exportados) — a regra de remap
// que os testes verificam.
const ROT90 = { tl: 'tr', tr: 'br', br: 'bl', bl: 'tl' };
const MIRROR_H = { tl: 'tr', tr: 'tl', bl: 'br', br: 'bl' };
const MIRROR_V = { tl: 'bl', bl: 'tl', tr: 'br', br: 'tr' };
const MIRROR_BOTH = { tl: 'br', tr: 'bl', br: 'tl', bl: 'tr' };

// célula com orientação e (às vezes) subCells, pra exercitar o remap recursivo
function makeFactory() {
  return (r, c) => {
    const id = `${r},${c}`;
    const orientation = CORNERS[(r * 7 + c * 3) % 4];
    const cell = { id, orientation };
    if ((r + c) % 3 === 0) {
      cell.subCells = {};
      CORNERS.forEach((corner, i) => {
        cell.subCells[corner] = { id: `${id}/${corner}`, orientation: CORNERS[(i + r) % 4] };
      });
    }
    return cell;
  };
}

function remap(cell, map) {
  if (!cell) return cell;
  const next = { ...cell };
  if (cell.orientation) next.orientation = map[cell.orientation];
  if (cell.subCells) {
    next.subCells = {};
    for (const k of Object.keys(cell.subCells)) next.subCells[map[k]] = remap(cell.subCells[k], map);
  }
  return next;
}

const SIZES = [2, 3, 4, 5, 6, 7, 8, 10];

test('SYMMETRY_VALUES contém os 4 modos e nada mais', () => {
  assert.deepEqual([...SYMMETRY_VALUES].sort(), ['mirror-full', 'mirror-h', 'none', 'rotational']);
});

test('toda simetria devolve grade size×size totalmente preenchida', () => {
  for (const symmetry of SYMMETRY_VALUES) {
    for (const size of SIZES) {
      const grid = generateSymmetricGrid({ size, symmetry, cellFactory: makeFactory() });
      assert.equal(grid.length, size);
      for (const row of grid) {
        assert.equal(row.length, size);
        for (const cell of row) assert.ok(cell && typeof cell === 'object', `${symmetry} ${size}: célula vazia`);
      }
    }
  }
});

test('none: cellFactory chamada exatamente uma vez por célula, sem remap', () => {
  for (const size of SIZES) {
    const calls = [];
    const grid = generateSymmetricGrid({
      size,
      symmetry: 'none',
      cellFactory: (r, c) => {
        calls.push(`${r},${c}`);
        return { id: `${r},${c}`, orientation: 'tl' };
      },
    });
    assert.equal(calls.length, size * size);
    assert.equal(new Set(calls).size, size * size);
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) assert.deepEqual(grid[r][c], { id: `${r},${c}`, orientation: 'tl' });
    }
  }
});

test('mirror-h: célula (r,c) ≡ MIRROR_H(célula (r, size-1-c)); coluna central (ímpar) fica livre', () => {
  for (const size of SIZES) {
    const grid = generateSymmetricGrid({ size, symmetry: 'mirror-h', cellFactory: makeFactory() });
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const mc = size - 1 - c;
        if (mc === c) continue;
        assert.deepEqual(grid[r][mc], remap(grid[r][c], MIRROR_H), `size ${size} (${r},${c})↔(${r},${mc})`);
      }
    }
  }
});

test('mirror-h: só a metade esquerda é sorteada (cellFactory ⌈size/2⌉ vezes por linha)', () => {
  for (const size of SIZES) {
    let calls = 0;
    generateSymmetricGrid({
      size,
      symmetry: 'mirror-h',
      cellFactory: (r, c) => {
        calls++;
        return { id: `${r},${c}` };
      },
    });
    assert.equal(calls, size * Math.ceil(size / 2));
  }
});

test('mirror-full / rotational: só o quadrante-semente (+ cruz central em ímpar) é sorteado', () => {
  for (const symmetry of ['mirror-full', 'rotational']) {
    for (const size of SIZES) {
      const h = Math.floor(size / 2);
      const calls = [];
      generateSymmetricGrid({
        size,
        symmetry,
        cellFactory: (r, c) => {
          calls.push(`${r},${c}`);
          return { id: `${r},${c}` };
        },
      });
      const expected = size % 2 === 0 ? h * h : h * h + (2 * size - 1);
      assert.equal(calls.length, expected, `${symmetry} ${size}`);
      for (let r = 0; r < h; r++) {
        for (let c = 0; c < h; c++) assert.ok(calls.includes(`${r},${c}`));
      }
    }
  }
});

test('remap recursivo: orientação E subCells (por canto) seguem o mesmo mapa', () => {
  // mirror-h é o único modo cuja geometria hoje é uma reflexão de verdade
  // (ver testes marcados abaixo); usa ele pra checar que subCells também
  // trocam de canto, não só a orientação.
  const size = 4;
  const grid = generateSymmetricGrid({ size, symmetry: 'mirror-h', cellFactory: makeFactory() });
  const left = grid[0][0];
  const right = grid[0][3];
  assert.ok(left.subCells, 'fixture precisa de subCells em (0,0)');
  assert.equal(right.orientation, MIRROR_H[left.orientation]);
  for (const corner of CORNERS) {
    assert.deepEqual(right.subCells[MIRROR_H[corner]], remap(left.subCells[corner], MIRROR_H));
  }
});

test('células sem orientação nem subCells são reaproveitadas por referência (não clonadas)', () => {
  const grid = generateSymmetricGrid({ size: 4, symmetry: 'mirror-h', cellFactory: () => ({ shape: 'blank' }) });
  assert.equal(grid[0][0], grid[0][3]);
});

// ---------------------------------------------------------------------------
// Estes dois testes descrevem a propriedade geométrica exata de cada modo.
// Já pegaram um bug real: até 2026-09-18, os quadrantes derivados eram
// colocados com o índice invertido DUAS vezes (reverse() + grid[r][size-1-c]),
// virando uma cópia transladada em vez de espelho/rotação — corrigido em
// symmetry.js (encaixe por deslocamento direto).
test(
  'mirror-full: (r,c) ≡ MIRROR_H(r, size-1-c) ≡ MIRROR_V(size-1-r, c) ≡ MIRROR_BOTH(size-1-r, size-1-c)',
  () => {
    for (const size of SIZES) {
      const grid = generateSymmetricGrid({ size, symmetry: 'mirror-full', cellFactory: makeFactory() });
      const mid = (size - 1) / 2;
      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          if (r === mid || c === mid) continue; // cruz central (ímpar) não tem par
          const mr = size - 1 - r;
          const mc = size - 1 - c;
          assert.deepEqual(grid[r][mc], remap(grid[r][c], MIRROR_H), `size ${size} H (${r},${c})`);
          assert.deepEqual(grid[mr][c], remap(grid[r][c], MIRROR_V), `size ${size} V (${r},${c})`);
          assert.deepEqual(grid[mr][mc], remap(grid[r][c], MIRROR_BOTH), `size ${size} BOTH (${r},${c})`);
        }
      }
    }
  }
);

test('rotational: (r,c) girado 90° horário ≡ ROT90(célula em (c, size-1-r))', () => {
  for (const size of SIZES) {
    const grid = generateSymmetricGrid({ size, symmetry: 'rotational', cellFactory: makeFactory() });
    const mid = (size - 1) / 2;
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (r === mid || c === mid) continue;
        // rotação 90° horária: (r,c) → (c, size-1-r)
        assert.deepEqual(grid[c][size - 1 - r], remap(grid[r][c], ROT90), `size ${size} (${r},${c})`);
      }
    }
  }
});

// Propriedade mais fraca que VALE hoje e continuaria valendo depois do
// conserto: em mirror-full/rotational o conjunto de ids de célula em cada
// quadrante derivado é exatamente o do quadrante-semente (só a posição/
// orientação muda) — garante que nada é sorteado fora da semente.
test('mirror-full / rotational: cada quadrante derivado é permutação do quadrante-semente', () => {
  for (const symmetry of ['mirror-full', 'rotational']) {
    for (const size of SIZES) {
      const h = Math.floor(size / 2);
      const grid = generateSymmetricGrid({ size, symmetry, cellFactory: makeFactory() });
      const ids = (r0, c0) => {
        const out = [];
        for (let r = r0; r < r0 + h; r++) for (let c = c0; c < c0 + h; c++) out.push(grid[r][c].id);
        return out.sort();
      };
      const seed = ids(0, 0);
      assert.deepEqual(ids(0, size - h), seed, `${symmetry} ${size} tr`);
      assert.deepEqual(ids(size - h, 0), seed, `${symmetry} ${size} bl`);
      assert.deepEqual(ids(size - h, size - h), seed, `${symmetry} ${size} br`);
      for (const row of grid) for (const cell of row) assert.ok(CORNERS.includes(cell.orientation));
    }
  }
});
