// (1) determinismo e (4) SVG bem formado — grid-icons/generator.js
// Só PROPRIEDADES: nenhum snapshot de SVG exato (arquivo em edição ativa).
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIconGrid, generateIcon, generateFramedIcon, framedGridDims, renderGridToSvg } from '../src/modules/grid-icons/generator.js';
import { SHAPES, SHAPE_KEYS } from '../src/modules/grid-icons/shapes.js';
import { PRESETS } from '../src/core/palette.js';
import { loadThemesJson, paramsFromTheme, normalizeSvgIds, analyzeSvg, collectAttr, HEX_RE, CORNERS } from './_helpers.mjs';

const themes = loadThemesJson();
const THEME_ENTRIES = Object.entries(themes);
const SEEDS = Array.from({ length: 20 }, (_, i) => (i + 1) * 7919 + 13);
const SIZES = [2, 3, 4, 6, 8, 10];

function invertHex(hex) {
  const n = parseInt(hex.slice(1), 16);
  return `#${[255 - ((n >> 16) & 255), 255 - ((n >> 8) & 255), 255 - (n & 255)]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`;
}

function leafCells(grid) {
  const out = [];
  for (const row of grid) {
    for (const cell of row) {
      if (cell.shape === 'subdivided') out.push(...Object.values(cell.subCells));
      else out.push(cell);
    }
  }
  return out;
}

// --------------------------------------------------------------- determinismo

test('buildIconGrid: mesma receita + mesma seed → grade idêntica (todos os temas × resoluções × 20 seeds)', () => {
  for (const [key, theme] of THEME_ENTRIES) {
    for (const size of SIZES) {
      for (const seed of SEEDS) {
        const params = paramsFromTheme(key, theme, { seed, size });
        assert.deepEqual(buildIconGrid(params), buildIconGrid(params), `${key} size ${size} seed ${seed}`);
      }
    }
  }
});

test('generateIcon: mesma receita + mesma seed → SVG idêntico (string igual, sem stroke/degradê)', () => {
  for (const [key, theme] of THEME_ENTRIES) {
    for (const size of [3, 6, 10]) {
      for (const seed of SEEDS) {
        const params = paramsFromTheme(key, theme, { seed, size });
        assert.equal(generateIcon(params), generateIcon(params), `${key} size ${size} seed ${seed}`);
      }
    }
  }
});

test('generateIcon com contorno/degradê: idêntico a menos dos ids gerados por contador global', () => {
  const [key, theme] = THEME_ENTRIES[0];
  for (const seed of SEEDS.slice(0, 5)) {
    const withStroke = paramsFromTheme(key, theme, { seed, size: 6, strokeEnabled: true, strokeColor: '#000000' });
    assert.equal(normalizeSvgIds(generateIcon(withStroke)), normalizeSvgIds(generateIcon(withStroke)));
    const withGradient = paramsFromTheme(key, theme, { seed, size: 6, gradientFillEnabled: true });
    assert.equal(normalizeSvgIds(generateIcon(withGradient)), normalizeSvgIds(generateIcon(withGradient)));
  }
});

test('seeds diferentes → grades diferentes na maioria (≥15 de 20 distintas)', () => {
  for (const [key, theme] of THEME_ENTRIES) {
    const distinct = new Set(SEEDS.map((seed) => JSON.stringify(buildIconGrid(paramsFromTheme(key, theme, { seed, size: 6 })).grid)));
    assert.ok(distinct.size >= 15, `${key}: só ${distinct.size} grades distintas em 20 seeds`);
  }
});

test('parâmetros diferentes (resolução, simetria) com a mesma seed → grades diferentes', () => {
  const [key, theme] = ['terracota', themes.terracota];
  const base = buildIconGrid(paramsFromTheme(key, theme, { seed: 42, size: 6 }));
  assert.notDeepEqual(buildIconGrid(paramsFromTheme(key, theme, { seed: 42, size: 7 })), base);
  assert.notDeepEqual(buildIconGrid(paramsFromTheme(key, theme, { seed: 42, size: 6, symmetry: 'none' })), base);
});

test('framedGridDims / generateFramedIcon: dimensões coerentes e determinístico', () => {
  for (const size of [4, 6, 8]) {
    for (const ratio of [1, 4 / 5, 9 / 16, 16 / 9, 2]) {
      const { cols, rows } = framedGridDims(size, ratio);
      assert.ok(Number.isInteger(cols) && Number.isInteger(rows) && cols >= 1 && rows >= 1);
      if (ratio >= 1) {
        assert.equal(rows, size);
        assert.equal(cols, Math.round(size * ratio));
      } else {
        assert.equal(cols, size);
        assert.equal(rows, Math.round(size / ratio));
      }
      const params = paramsFromTheme('kata', themes.kata, { seed: 9, size });
      const a = generateFramedIcon(params, ratio);
      assert.equal(a, generateFramedIcon(params, ratio));
      const cell = 420 / size;
      assert.match(a, new RegExp(`viewBox="0 0 ${cols * cell} ${rows * cell}"`));
    }
  }
});

// ------------------------------------------------------------ estrutura da grade

test('toda célula tem forma válida, cor da paleta, orientação só quando a forma é orientada', () => {
  for (const [key, theme] of THEME_ENTRIES) {
    const palette = new Set(PRESETS[theme.preset].colors.map((c) => c.color));
    for (const size of SIZES) {
      const { grid, cols, rows } = buildIconGrid(paramsFromTheme(key, theme, { seed: 31337, size }));
      assert.equal(cols, size);
      assert.equal(rows, size);
      assert.equal(grid.length, size);
      for (const row of grid) {
        assert.equal(row.length, size);
        for (const cell of row) {
          if (cell.shape === 'subdivided') {
            for (const k of Object.keys(cell.subCells)) assert.ok(CORNERS.includes(k), `${key}: subCell "${k}"`);
          } else {
            assert.ok(cell.shape === 'blank' || SHAPE_KEYS.includes(cell.shape), `${key}: forma "${cell.shape}"`);
          }
        }
      }
      for (const cell of leafCells(grid)) {
        if (cell.shape === 'blank') continue;
        assert.ok(theme.shapes.includes(cell.shape), `${key}: "${cell.shape}" não está nas formas permitidas do tema`);
        assert.ok(palette.has(cell.color), `${key}: cor ${cell.color} fora da paleta`);
        if (SHAPES[cell.shape].oriented) assert.ok(CORNERS.includes(cell.orientation), `${key}: orientação ${cell.orientation}`);
        else assert.equal(cell.orientation, undefined, `${key}: forma não orientada com orientação`);
      }
    }
  }
});

test('mirror-h em buildIconGrid: (r,c) e (r,size-1-c) casam em forma, cor e orientação espelhada', () => {
  const MIRROR_H = { tl: 'tr', tr: 'tl', bl: 'br', br: 'bl' };
  const remap = (cell) => {
    if (!cell || (!cell.orientation && !cell.subCells)) return cell;
    const next = { ...cell };
    if (cell.orientation) next.orientation = MIRROR_H[cell.orientation];
    if (cell.subCells) {
      next.subCells = {};
      for (const k of Object.keys(cell.subCells)) next.subCells[MIRROR_H[k]] = remap(cell.subCells[k]);
    }
    return next;
  };
  for (const seed of SEEDS) {
    for (const size of [4, 5, 8]) {
      const { grid } = buildIconGrid(paramsFromTheme('urbano', themes.urbano, { seed, size, symmetry: 'mirror-h', subdivisionChance: 0.5 }));
      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          const mc = size - 1 - c;
          if (mc === c) continue;
          assert.deepEqual(grid[r][mc], remap(grid[r][c]), `seed ${seed} size ${size} (${r},${c})`);
        }
      }
    }
  }
});

test('fillDensity 0 → tudo vazio; fillDensity 1 → nada vazio; shapesAllowed=[] → tudo vazio', () => {
  for (const seed of SEEDS.slice(0, 5)) {
    for (const symmetry of ['none', 'mirror-h', 'mirror-full', 'rotational']) {
      const base = paramsFromTheme('kata', themes.kata, { seed, size: 6, symmetry, subdivisionChance: 0.3 });
      const empty = buildIconGrid({ ...base, fillDensity: 0 }).grid;
      assert.ok(empty.flat().every((c) => c.shape === 'blank'), `${symmetry}: densidade 0 gerou forma`);
      const full = buildIconGrid({ ...base, fillDensity: 1 }).grid;
      assert.ok(leafCells(full).every((c) => c.shape !== 'blank'), `${symmetry}: densidade 1 deixou vazio`);
      const noShapes = buildIconGrid({ ...base, fillDensity: 1, shapesAllowed: [] }).grid;
      assert.ok(noShapes.flat().every((c) => c.shape === 'blank'));
    }
  }
});

test('subdivisionChance 0 → nenhuma célula subdividida; subdivisionChance 1 + densidade 1 → todas', () => {
  const base = paramsFromTheme('monocromatico', themes.monocromatico, { seed: 5, size: 8, symmetry: 'none', fillDensity: 1 });
  assert.ok(buildIconGrid({ ...base, subdivisionChance: 0 }).grid.flat().every((c) => c.shape !== 'subdivided'));
  assert.ok(buildIconGrid({ ...base, subdivisionChance: 1 }).grid.flat().every((c) => c.shape === 'subdivided'));
});

test('aparência: silhueta pinta tudo com inkColor; inverter usa o negativo da paleta', () => {
  const palette = PRESETS.tropical.colors.map((c) => c.color);
  const inverted = new Set(palette.map(invertHex));
  for (const seed of SEEDS.slice(0, 5)) {
    const base = paramsFromTheme('tropical', themes.tropical, { seed, size: 6, fillDensity: 1 });
    const sil = buildIconGrid({ ...base, appearance: { silhouette: true, inkColor: '#123456' } }).grid;
    for (const cell of leafCells(sil)) assert.equal(cell.color, '#123456');
    const inv = buildIconGrid({ ...base, appearance: { invert: true } }).grid;
    for (const cell of leafCells(inv)) assert.ok(inverted.has(cell.color), `cor invertida inesperada ${cell.color}`);
  }
});

// ---------------------------------------------------------------- SVG bem formado

function assertWellFormed(svg, label) {
  const { roots, errors } = analyzeSvg(svg);
  assert.equal(roots, 1, `${label}: ${roots} raízes <svg>`);
  assert.deepEqual(errors, [], `${label}: ${errors.join('; ')}`);
  assert.equal((svg.match(/<svg\b/g) ?? []).length, 1, `${label}: mais de um <svg`);
  assert.equal((svg.match(/<\/svg>/g) ?? []).length, 1);
  const width = collectAttr(svg.slice(0, svg.indexOf('>') + 1), 'width');
  const height = collectAttr(svg.slice(0, svg.indexOf('>') + 1), 'height');
  const viewBox = collectAttr(svg.slice(0, svg.indexOf('>') + 1), 'viewBox');
  assert.equal(width.length, 1, `${label}: width ausente na raiz`);
  assert.equal(height.length, 1, `${label}: height ausente na raiz`);
  assert.equal(viewBox.length, 1, `${label}: viewBox ausente na raiz`);
  assert.equal(viewBox[0], `0 0 ${width[0]} ${height[0]}`, `${label}: viewBox não bate com width/height`);
  assert.ok(Number(width[0]) > 0 && Number(height[0]) > 0);
}

test('SVG do ícone: raiz única, tags balanceadas, width/height/viewBox, fills válidos e da paleta ∪ fundo', () => {
  for (const [key, theme] of THEME_ENTRIES) {
    const preset = PRESETS[theme.preset];
    const allowed = new Set([preset.background, ...preset.colors.map((c) => c.color)]);
    for (const size of [2, 3, 6, 10]) {
      for (const seed of SEEDS.slice(0, 4)) {
        const params = paramsFromTheme(key, theme, { seed, size, subdivisionChance: 0.4 });
        const svg = generateIcon(params);
        const label = `${key} size ${size} seed ${seed}`;
        assertWellFormed(svg, label);
        assert.equal(collectAttr(svg, 'width')[0], String(420), `${label}: width`);
        assert.ok(svg.includes('<g id="icon"'), `${label}: sem grupo #icon`);
        assert.ok(svg.includes('<g id="background">'), `${label}: sem fundo`);
        for (const fill of collectAttr(svg, 'fill')) {
          if (fill === 'none' || fill.startsWith('url(#')) continue;
          assert.match(fill, HEX_RE, `${label}: fill "${fill}" não é hex`);
          assert.ok(allowed.has(fill), `${label}: fill ${fill} fora de paleta ∪ fundo`);
        }
        // uma <g class="cell"> por célula-folha preenchida
        const { grid } = buildIconGrid(params);
        const filledLeaves = leafCells(grid).filter((c) => c.shape !== 'blank').length;
        assert.equal((svg.match(/data-shape="/g) ?? []).length, filledLeaves, `${label}: contagem de células`);
        for (const shape of collectAttr(svg, 'data-shape')) assert.ok(theme.shapes.includes(shape));
      }
    }
  }
});

test('SVG com contorno: bem formado, stroke sempre na cor do contorno, clipPaths dentro de <defs>', () => {
  for (const [key, theme] of THEME_ENTRIES.slice(0, 6)) {
    const preset = PRESETS[theme.preset];
    const allowed = new Set([preset.background, ...preset.colors.map((c) => c.color)]);
    for (const fillEnabled of [true, false]) {
      const svg = generateIcon(paramsFromTheme(key, theme, { seed: 77, size: 6, strokeEnabled: true, fillEnabled, strokeColor: '#ff00ff', fillDensity: 1 }));
      const label = `${key} fill=${fillEnabled}`;
      assertWellFormed(svg, label);
      const strokes = collectAttr(svg, 'stroke');
      assert.ok(strokes.length > 0, `${label}: nenhum stroke`);
      for (const s of strokes) assert.equal(s, '#ff00ff', `${label}: stroke ${s}`);
      for (const fill of collectAttr(svg, 'fill')) {
        if (fill === 'none' || fill.startsWith('url(#')) continue;
        assert.ok(allowed.has(fill), `${label}: fill ${fill}`);
      }
      const defsEnd = svg.indexOf('</defs>');
      assert.ok(defsEnd > 0, `${label}: sem <defs>`);
      assert.equal(svg.indexOf('<clipPath', defsEnd), -1, `${label}: clipPath fora de <defs>`);
      // toda referência url(#id) aponta pra um id definido
      const ids = new Set(collectAttr(svg, 'id'));
      for (const ref of [...svg.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1])) assert.ok(ids.has(ref), `${label}: url(#${ref}) sem definição`);
    }
  }
});

test('SVG com degradê interno: um <linearGradient> compartilhado, formas preenchem via url(#...), stops da receita', () => {
  const stops = [
    { position: 1, color: '#112233' },
    { position: 0, color: '#445566' },
  ];
  const svg = generateIcon(paramsFromTheme('oceano', themes.oceano, { seed: 3, size: 6, fillDensity: 1, gradientFillEnabled: true, gradientStops: stops }));
  assertWellFormed(svg, 'gradient');
  assert.equal((svg.match(/<linearGradient/g) ?? []).length, 1);
  const gradId = collectAttr(svg.slice(svg.indexOf('<linearGradient')), 'id')[0];
  assert.ok(gradId);
  const fills = collectAttr(svg, 'fill');
  const shapeFills = fills.filter((f) => f.startsWith('url(#'));
  assert.ok(shapeFills.length > 0);
  for (const f of shapeFills) assert.equal(f, `url(#${gradId})`);
  // stops ordenados por posição
  assert.match(svg, /<stop offset="0" stop-color="#445566" \/><stop offset="1" stop-color="#112233" \/>/);
});

test('aparência no SVG: fundo transparente omite #background; silhueta/inversão refletem nos fills; rotação aplica transform', () => {
  const base = paramsFromTheme('neon', themes.neon, { seed: 11, size: 5, fillDensity: 1 });
  const transparent = generateIcon({ ...base, appearance: { transparentBackground: true } });
  assertWellFormed(transparent, 'transparent');
  assert.ok(!transparent.includes('id="background"'));

  const sil = generateIcon({ ...base, appearance: { silhouette: true, inkColor: '#010203' } });
  assertWellFormed(sil, 'silhouette');
  for (const fill of collectAttr(sil, 'fill')) {
    if (fill === 'none') continue;
    assert.ok(fill === '#010203' || fill === PRESETS.neon.background, `silhueta: fill ${fill}`);
  }

  const inv = generateIcon({ ...base, appearance: { invert: true } });
  assertWellFormed(inv, 'invert');
  const negatives = new Set([PRESETS.neon.background, ...PRESETS.neon.colors.map((c) => c.color)].map(invertHex));
  for (const fill of collectAttr(inv, 'fill')) {
    if (fill === 'none') continue;
    assert.ok(negatives.has(fill), `inversão: fill ${fill}`);
  }

  for (const rotation of [90, 180, 270]) {
    const rot = generateIcon({ ...base, rotation });
    assertWellFormed(rot, `rotation ${rotation}`);
    assert.ok(rot.includes(`rotate(${rotation} 210 210)`), `rotação ${rotation} ausente`);
  }
  assert.ok(!generateIcon({ ...base, rotation: 0 }).includes('rotate('));
});

test('renderGridToSvg não sorteia: re-renderizar a mesma grade dá o mesmo SVG', () => {
  const params = paramsFromTheme('vintage', themes.vintage, { seed: 8, size: 6 });
  const { grid, size } = buildIconGrid(params);
  const a = renderGridToSvg({ ...params, grid, size });
  const b = renderGridToSvg({ ...params, grid, size });
  assert.equal(a, b);
  assert.equal(a, generateIcon(params));
});
