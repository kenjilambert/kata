// (7) palette.js — presets válidos e pickWeighted respeita pesos
import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, pickWeighted, clonePreset } from '../src/core/palette.js';
import { createRng } from '../src/core/seed.js';
import { HEX_RE } from './_helpers.mjs';

test('todo preset tem label, background hex e ≥1 cor hex com weight > 0', () => {
  const keys = Object.keys(PRESETS);
  assert.ok(keys.length >= 2);
  for (const key of keys) {
    const p = PRESETS[key];
    assert.equal(typeof p.label, 'string');
    assert.ok(p.label.length > 0, `${key}: label vazio`);
    assert.match(p.background, HEX_RE, `${key}: background ${p.background}`);
    assert.ok(Array.isArray(p.colors) && p.colors.length >= 1, `${key}: sem cores`);
    for (const entry of p.colors) {
      assert.match(entry.color, HEX_RE, `${key}: cor ${entry.color}`);
      assert.ok(typeof entry.weight === 'number' && entry.weight > 0, `${key}: weight ${entry.weight}`);
      assert.notEqual(entry.color.toLowerCase(), p.background.toLowerCase(), `${key}: cor igual ao fundo`);
    }
  }
});

test('pickWeighted só devolve cores da lista e é determinístico com o mesmo rng', () => {
  for (const key of Object.keys(PRESETS)) {
    const colors = PRESETS[key].colors;
    const allowed = new Set(colors.map((c) => c.color));
    const a = createRng(99);
    const b = createRng(99);
    for (let i = 0; i < 500; i++) {
      const pa = pickWeighted(a, colors);
      assert.ok(allowed.has(pa), `${key}: ${pa} fora da paleta`);
      assert.equal(pa, pickWeighted(b, colors));
    }
  }
});

test('pickWeighted respeita os pesos (estatístico, rng determinístico)', () => {
  const entries = [
    { color: '#aaaaaa', weight: 3 },
    { color: '#bbbbbb', weight: 1 },
    { color: '#cccccc', weight: 6 },
  ];
  const rng = createRng(2024);
  const N = 30000;
  const counts = {};
  for (let i = 0; i < N; i++) {
    const c = pickWeighted(rng, entries);
    counts[c] = (counts[c] ?? 0) + 1;
  }
  const total = 10;
  for (const e of entries) {
    const expected = e.weight / total;
    const got = (counts[e.color] ?? 0) / N;
    assert.ok(Math.abs(got - expected) < 0.02, `${e.color}: esperado ~${expected}, veio ${got}`);
  }
});

test('pickWeighted: weight ausente conta como 1; peso zero nunca sai', () => {
  const rng = createRng(5);
  const entries = [{ color: '#111111' }, { color: '#222222', weight: 0 }, { color: '#333333' }];
  const seen = new Set();
  for (let i = 0; i < 2000; i++) seen.add(pickWeighted(rng, entries));
  assert.ok(seen.has('#111111') && seen.has('#333333'));
  assert.ok(!seen.has('#222222'), 'cor de peso 0 foi sorteada');
});

test('clonePreset devolve cópia profunda (editar a cópia não mexe no PRESET)', () => {
  const clone = clonePreset(PRESETS.kata);
  assert.deepEqual(clone, {
    label: PRESETS.kata.label,
    background: PRESETS.kata.background,
    colors: PRESETS.kata.colors,
  });
  assert.notEqual(clone.colors, PRESETS.kata.colors);
  assert.notEqual(clone.colors[0], PRESETS.kata.colors[0]);
  clone.colors[0].color = '#000000';
  assert.notEqual(PRESETS.kata.colors[0].color, '#000000');
});
