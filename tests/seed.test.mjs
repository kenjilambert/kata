// (2) seed.js — hash estável e LCG dentro de [0,1)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng, hashStringToSeed, randomSeed } from '../src/core/seed.js';

test('hashStringToSeed é estável pra strings fixas (FNV-1a 32 bits)', () => {
  // valores de referência calculados uma vez — se mudarem, a seed de todo
  // link/mosaico salvo muda junto (hashStringToSeed alimenta os tiles).
  assert.equal(hashStringToSeed(''), 2166136261);
  assert.equal(hashStringToSeed('a'), 3826002220);
  assert.equal(hashStringToSeed('kata'), 1452468346);
  assert.equal(hashStringToSeed('KATA'), 36253434);
  assert.equal(hashStringToSeed('Team Liquid'), 2307088188);
  assert.equal(hashStringToSeed('12345-7-0-0'), 3772535968);
});

test('hashStringToSeed devolve inteiro sem sinal de 32 bits e é determinístico', () => {
  for (const s of ['', 'x', 'ícone ção ✓', 'a'.repeat(500), String(Math.PI)]) {
    const a = hashStringToSeed(s);
    assert.equal(a, hashStringToSeed(s));
    assert.ok(Number.isInteger(a) && a >= 0 && a <= 0xffffffff, `fora de uint32: ${a}`);
  }
  assert.notEqual(hashStringToSeed('abc'), hashStringToSeed('abd'));
});

test('createRng: mesma seed → mesma sequência; sempre em [0,1)', () => {
  for (const seed of [0, 1, 2, 42, 123456789, 0xffffffff, -5, 3.7]) {
    const a = createRng(seed);
    const b = createRng(seed);
    for (let i = 0; i < 5000; i++) {
      const v = a();
      assert.equal(v, b(), `seed ${seed} divergiu no passo ${i}`);
      assert.ok(v >= 0 && v < 1, `seed ${seed} fora de [0,1): ${v}`);
    }
  }
});

test('createRng: seeds diferentes dão sequências diferentes e distribuição razoável', () => {
  const a = createRng(1);
  const b = createRng(2);
  const first = Array.from({ length: 10 }, () => a());
  const second = Array.from({ length: 10 }, () => b());
  assert.notDeepEqual(first, second);

  const rng = createRng(777);
  const N = 20000;
  let sum = 0;
  const buckets = new Array(10).fill(0);
  for (let i = 0; i < N; i++) {
    const v = rng();
    sum += v;
    buckets[Math.floor(v * 10)]++;
  }
  const mean = sum / N;
  assert.ok(Math.abs(mean - 0.5) < 0.02, `média ${mean}`);
  for (const b of buckets) assert.ok(b > N * 0.07 && b < N * 0.13, `bucket desbalanceado: ${buckets}`);
});

test('randomSeed devolve inteiro em [0, 2^32)', () => {
  for (let i = 0; i < 100; i++) {
    const s = randomSeed();
    assert.ok(Number.isInteger(s) && s >= 0 && s < 4294967296);
  }
});
