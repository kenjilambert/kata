// (8) color.js — ida e volta hex↔hsl, contraste (se existir)
import test from 'node:test';
import assert from 'node:assert/strict';
import { hexToHsl, hslToHex, lightenDarkenHex, generateHarmoniousPalette } from '../src/core/color.js';
import { PRESETS } from '../src/core/palette.js';
import { HEX_RE } from './_helpers.mjs';

function channels(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function maxChannelDiff(a, b) {
  const ca = channels(a);
  const cb = channels(b);
  return Math.max(...ca.map((v, i) => Math.abs(v - cb[i])));
}

const SAMPLE_HEX = [
  '#000000', '#ffffff', '#f2601c', '#f3f0e6', '#808080', '#ff0000', '#00ff00', '#0000ff',
  '#123456', '#abcdef', '#010101', '#fefefe', '#7f7f80',
  ...Object.values(PRESETS).flatMap((p) => [p.background, ...p.colors.map((c) => c.color)]),
];

test('hexToHsl devolve h∈[0,360), s,l∈[0,100]', () => {
  for (const hex of SAMPLE_HEX) {
    const { h, s, l } = hexToHsl(hex);
    assert.ok(h >= 0 && h < 360, `${hex} h=${h}`);
    assert.ok(s >= 0 && s <= 100, `${hex} s=${s}`);
    assert.ok(l >= 0 && l <= 100, `${hex} l=${l}`);
  }
  assert.deepEqual(hexToHsl('#000000'), { h: 0, s: 0, l: 0 });
  assert.deepEqual(hexToHsl('#ffffff'), { h: 0, s: 0, l: 100 });
  assert.equal(hexToHsl('#ff0000').h, 0);
  assert.equal(hexToHsl('#00ff00').h, 120);
  assert.equal(hexToHsl('#0000ff').h, 240);
});

test('hslToHex(hexToHsl(x)) ≈ x (tolerância de 1 por canal)', () => {
  for (const hex of SAMPLE_HEX) {
    const { h, s, l } = hexToHsl(hex);
    const back = hslToHex(h, s, l);
    assert.match(back, HEX_RE);
    assert.ok(maxChannelDiff(back, hex.toLowerCase()) <= 1, `${hex} → ${back}`);
  }
});

test('hslToHex normaliza matiz fora de [0,360) e sempre devolve hex de 6 dígitos', () => {
  assert.equal(hslToHex(360, 50, 50), hslToHex(0, 50, 50));
  assert.equal(hslToHex(-120, 50, 50), hslToHex(240, 50, 50));
  assert.equal(hslToHex(500, 50, 50), hslToHex(140, 50, 50));
  for (let h = 0; h < 360; h += 15) {
    for (const l of [0, 10, 50, 90, 100]) assert.match(hslToHex(h, 70, l), HEX_RE);
  }
});

test('lightenDarkenHex: amount>0 clareia, <0 escurece, 0 preserva (≈), extremos saturam', () => {
  for (const hex of ['#f2601c', '#3aa1d8', '#808080']) {
    const l0 = hexToHsl(hex).l;
    assert.ok(hexToHsl(lightenDarkenHex(hex, 0.5)).l > l0, `${hex} não clareou`);
    assert.ok(hexToHsl(lightenDarkenHex(hex, -0.5)).l < l0, `${hex} não escureceu`);
    assert.ok(maxChannelDiff(lightenDarkenHex(hex, 0), hex) <= 1);
  }
  assert.equal(lightenDarkenHex('#f2601c', 1), '#ffffff');
  assert.equal(lightenDarkenHex('#f2601c', -1), '#000000');
});

test('generateHarmoniousPalette: base primeiro, N cores extras, todas hex válidas e distintas', () => {
  for (const n of [0, 1, 3, 6, 12]) {
    const pal = generateHarmoniousPalette('#f2601c', n);
    assert.equal(pal.length, n + 1);
    assert.equal(pal[0].color, '#f2601c');
    for (const e of pal) {
      assert.match(e.color, HEX_RE);
      assert.ok(e.weight > 0);
    }
    assert.equal(new Set(pal.map((e) => e.color)).size, pal.length, 'cores repetidas');
  }
  assert.deepEqual(generateHarmoniousPalette('#3aa1d8', 4), generateHarmoniousPalette('#3aa1d8', 4));
});

// contrastRatio pode ainda não existir (color.js em edição) — import
// dinâmico pra suíte não quebrar se sumir/renomear.
test('contrastRatio (se existir): #000/#fff = 21, simétrico, mesma cor = 1', async () => {
  const mod = await import('../src/core/color.js').catch(() => null);
  const fn = mod?.contrastRatio;
  if (typeof fn !== 'function') {
    console.log('  [info] contrastRatio não exportado por color.js — teste pulado');
    return;
  }
  assert.ok(Math.abs(fn('#000000', '#ffffff') - 21) < 1e-6, `veio ${fn('#000000', '#ffffff')}`);
  assert.ok(Math.abs(fn('#ffffff', '#000000') - 21) < 1e-6, 'não é simétrico');
  assert.ok(Math.abs(fn('#808080', '#808080') - 1) < 1e-6);
  for (const [a, b] of [['#f2601c', '#f3f0e6'], ['#3aa1d8', '#0a0a0a'], ['#111111', '#ffffff']]) {
    const r = fn(a, b);
    assert.ok(r >= 1 && r <= 21, `${a}/${b} = ${r}`);
    assert.ok(Math.abs(r - fn(b, a)) < 1e-9);
  }
});
