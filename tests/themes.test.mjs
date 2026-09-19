// (5) themes.json — referências válidas pra PRESETS/SHAPES/SYMMETRY_VALUES,
// densidades em [0,1]; applyTheme aplica no patternState sem inventar valor
import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS } from '../src/core/palette.js';
import { SHAPES, SHAPE_KEYS } from '../src/modules/grid-icons/shapes.js';
import { SYMMETRY_VALUES } from '../src/core/symmetry.js';
import { applyTheme, themePreviewColorsFor } from '../src/core/themes.js';
import { patternState } from '../src/core/patternState.js';
import { loadThemesJson, HEX_RE } from './_helpers.mjs';

const themes = loadThemesJson();
const DETAIL_GRADIENTS = ['uniform', 'edge', 'center'];
const FILL_MODES = ['solid', 'outline'];

test('themes.json tem ≥6 temas com chave e label não vazios', () => {
  const keys = Object.keys(themes);
  assert.ok(keys.length >= 6, `só ${keys.length} temas`);
  for (const key of keys) {
    assert.match(key, /^[a-z][a-z0-9_-]*$/i);
    assert.equal(typeof themes[key].label, 'string');
    assert.ok(themes[key].label.trim().length > 0);
  }
});

test('todo preset referenciado existe em PRESETS', () => {
  for (const [key, theme] of Object.entries(themes)) {
    assert.ok(PRESETS[theme.preset], `${key}: preset "${theme.preset}" não existe`);
  }
});

test('toda forma referenciada existe em SHAPES/SHAPE_KEYS, sem repetição, ≥1 por tema', () => {
  for (const [key, theme] of Object.entries(themes)) {
    assert.ok(Array.isArray(theme.shapes) && theme.shapes.length >= 1, `${key}: shapes vazio`);
    assert.equal(new Set(theme.shapes).size, theme.shapes.length, `${key}: forma repetida`);
    for (const s of theme.shapes) {
      assert.ok(SHAPES[s] && SHAPE_KEYS.includes(s), `${key}: forma "${s}" não existe`);
    }
  }
});

test('symmetry ∈ SYMMETRY_VALUES; fillDensity e subdivisionChance em [0,1]', () => {
  for (const [key, theme] of Object.entries(themes)) {
    assert.ok(SYMMETRY_VALUES.includes(theme.symmetry), `${key}: symmetry "${theme.symmetry}"`);
    assert.ok(
      typeof theme.fillDensity === 'number' && theme.fillDensity >= 0 && theme.fillDensity <= 1,
      `${key}: fillDensity ${theme.fillDensity}`
    );
    if (theme.subdivisionChance !== undefined) {
      assert.ok(
        theme.subdivisionChance >= 0 && theme.subdivisionChance <= 1,
        `${key}: subdivisionChance ${theme.subdivisionChance}`
      );
    }
  }
});

test('campos opcionais, quando presentes, têm valores do domínio esperado', () => {
  for (const [key, theme] of Object.entries(themes)) {
    if (theme.detailGradient !== undefined) {
      assert.ok(DETAIL_GRADIENTS.includes(theme.detailGradient), `${key}: detailGradient`);
    }
    if (theme.fillMode !== undefined) assert.ok(FILL_MODES.includes(theme.fillMode), `${key}: fillMode`);
    if (theme.strokeWidth !== undefined) assert.ok(theme.strokeWidth > 0 && theme.strokeWidth <= 1, `${key}: strokeWidth`);
    if (theme.rotation !== undefined) assert.ok([0, 90, 180, 270].includes(theme.rotation), `${key}: rotation`);
    if (theme.resolution !== undefined) {
      assert.ok(Number.isInteger(theme.resolution) && theme.resolution >= 2 && theme.resolution <= 10, `${key}: resolution`);
    }
  }
});

test('applyTheme copia preset/formas/simetria pro patternState e reseta invert/blackIcon', () => {
  for (const [key, theme] of Object.entries(themes)) {
    patternState.invertColors = true;
    patternState.blackIcon = true;
    patternState.useImageGuide = false;
    applyTheme(key, themes);
    const preset = PRESETS[theme.preset];
    assert.equal(patternState.themeKey, key);
    assert.equal(patternState.background, preset.background);
    assert.deepEqual(patternState.colors, preset.colors);
    assert.notEqual(patternState.colors, preset.colors, 'colors deve ser cópia, não a referência do PRESET');
    assert.deepEqual(patternState.shapesAllowed, theme.shapes);
    assert.equal(patternState.symmetry, theme.symmetry);
    assert.equal(patternState.fillDensity, theme.fillDensity);
    assert.equal(patternState.strokeEnabled, theme.fillMode === 'outline');
    assert.equal(patternState.invertColors, false);
    assert.equal(patternState.blackIcon, false);
    assert.equal(patternState.gradientStops.length, 2);
    for (const stop of patternState.gradientStops) assert.match(stop.color, HEX_RE);
  }
  // tema inexistente: no-op
  const before = patternState.themeKey;
  applyTheme('nao-existe', themes);
  assert.equal(patternState.themeKey, before);
});

test('applyTheme com guia de imagem ativo mantém symmetry=none e guarda a anterior', () => {
  patternState.useImageGuide = true;
  applyTheme('terracota', themes);
  assert.equal(patternState.symmetry, 'none');
  assert.equal(patternState.symmetryBeforeImageGuide, themes.terracota.symmetry);
  patternState.useImageGuide = false;
});

test('themePreviewColorsFor devolve [fundo, ...cores] hex do preset do tema', () => {
  for (const [key, theme] of Object.entries(themes)) {
    const colors = themePreviewColorsFor(key, themes);
    const preset = PRESETS[theme.preset];
    assert.equal(colors.length, preset.colors.length + 1);
    assert.equal(colors[0], preset.background);
    for (const c of colors) assert.match(c, HEX_RE);
  }
  assert.deepEqual(themePreviewColorsFor('inexistente', themes), []);
});
