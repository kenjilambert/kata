// (9) mosaic/generator.js — buildMosaicSvg determinístico, bem formado, e o
// que "Padrão sem emenda" garante: com gap=0 os tiles encostam exatamente
// (largura = tilesX×tileSize, translate em múltiplos de tileSize, cada tile
// recortado pelo mesmo clipPath), o conteúdo de um tile depende só de
// (seed, mosaicSeed, r, c) — não do tamanho do mosaico — e as máscaras de
// densidade permitidas nesse modo (refletido 0°/90°, radial centrado) têm o
// MESMO valor nas duas bordas opostas (core/gradient.js), enquanto a linear
// (escondida pela UI nesse modo) salta de 0 pra 1.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMosaicSvg } from '../src/modules/mosaic/generator.js';
import { resolveGradientFactor } from '../src/core/gradient.js';
import { PRESETS } from '../src/core/palette.js';
import { loadThemesJson, normalizeSvgIds, analyzeSvg, collectAttr, HEX_RE } from './_helpers.mjs';

const themes = loadThemesJson();
const TILE = 120;

function patternFromTheme(key, overrides = {}) {
  const theme = themes[key];
  const preset = PRESETS[theme.preset];
  return {
    seed: 12345,
    resolution: 4,
    symmetry: theme.symmetry,
    fillDensity: theme.fillDensity,
    shapesAllowed: theme.shapes,
    background: preset.background,
    colors: preset.colors,
    subdivisionChance: theme.subdivisionChance ?? 0,
    detailGradient: theme.detailGradient ?? 'uniform',
    fillEnabled: true,
    strokeEnabled: false,
    strokeColor: '#000000',
    strokeWidth: theme.strokeWidth ?? 0.24,
    strokeOutlineWidth: 2,
    gradientFillEnabled: false,
    gradientFillAngle: 45,
    gradientStops: [
      { position: 0, color: preset.colors[0].color },
      { position: 1, color: preset.colors[1]?.color ?? preset.colors[0].color },
    ],
    grainEnabled: false,
    grainIntensity: 0.6,
    grainSize: 0.5,
    grainColor: '#000000',
    rotation: theme.rotation ?? 0,
    transparentBg: false,
    blackIcon: false,
    invertColors: false,
    customShapes: [],
    ...overrides,
  };
}

const NO_MASK = { enabled: false, source: 'gradient', shape: 'linear', angleDeg: 0, centerX: 0.5, centerY: 0.5, mode: 'center-out', smoothness: 0.5 };

function mosaic(overrides = {}) {
  return buildMosaicSvg({
    pattern: patternFromTheme('terracota'),
    tilesX: 3,
    tilesY: 2,
    tileSize: TILE,
    gap: 0,
    mosaicSeed: 7,
    densityMask: NO_MASK,
    maskImageEl: null,
    uniformDensity: 1,
    ...overrides,
  });
}

// divide o SVG do mosaico nos conteúdos de cada tile (na ordem r,c) — o
// abridor de tile é o único <g> com clip-path do tile.
function tileContents(svg) {
  const parts = svg.split(/<g transform="translate\([^)]*\)" clip-path="url\(#mosaic-tile-clip-\d+\)">/);
  // o último pedaço ainda carrega o fechamento do grupo externo + </svg>
  return parts.slice(1).map((p) => normalizeSvgIds(p.replace(/<\/g><\/svg>$/, '')));
}

function tileTranslates(svg) {
  return [...svg.matchAll(/<g transform="translate\(([^,]+), ([^)]+)\)" clip-path="url\(#mosaic-tile-clip-\d+\)">/g)].map((m) => [Number(m[1]), Number(m[2])]);
}

function assertWellFormed(svg, label) {
  const { roots, errors } = analyzeSvg(svg);
  assert.equal(roots, 1, `${label}: ${roots} raízes <svg>`);
  assert.deepEqual(errors, [], `${label}: ${errors.join('; ')}`);
  assert.equal((svg.match(/<svg\b/g) ?? []).length, 1, `${label}: tile deixou <svg> aninhado`);
  const head = svg.slice(0, svg.indexOf('>') + 1);
  const [w] = collectAttr(head, 'width');
  const [h] = collectAttr(head, 'height');
  const [vb] = collectAttr(head, 'viewBox');
  assert.ok(w && h && vb, `${label}: width/height/viewBox ausentes`);
  assert.equal(vb, `0 0 ${w} ${h}`);
}

test('buildMosaicSvg é determinístico (a menos dos ids por contador) e sensível a mosaicSeed/seed', () => {
  for (const key of Object.keys(themes)) {
    const pattern = patternFromTheme(key);
    const a = normalizeSvgIds(mosaic({ pattern }));
    assert.equal(a, normalizeSvgIds(mosaic({ pattern })), key);
    assert.notEqual(a, normalizeSvgIds(mosaic({ pattern, mosaicSeed: 8 })), `${key}: mosaicSeed não mudou nada`);
    assert.notEqual(a, normalizeSvgIds(mosaic({ pattern: { ...pattern, seed: 54321 } })), `${key}: seed não mudou nada`);
  }
});

test('SVG do mosaico: bem formado, dimensões = tiles×tileSize + gaps, um grupo por tile, fills da paleta ∪ fundo', () => {
  for (const key of Object.keys(themes)) {
    const pattern = patternFromTheme(key);
    const preset = PRESETS[themes[key].preset];
    const allowed = new Set([preset.background, ...preset.colors.map((c) => c.color)]);
    for (const [tilesX, tilesY, gap] of [[1, 1, 0], [3, 2, 0], [2, 4, 10], [5, 5, 3]]) {
      const svg = mosaic({ pattern, tilesX, tilesY, gap });
      const label = `${key} ${tilesX}x${tilesY} gap ${gap}`;
      assertWellFormed(svg, label);
      const head = svg.slice(0, svg.indexOf('>') + 1);
      assert.equal(Number(collectAttr(head, 'width')[0]), tilesX * TILE + (tilesX - 1) * gap, `${label}: width`);
      assert.equal(Number(collectAttr(head, 'height')[0]), tilesY * TILE + (tilesY - 1) * gap, `${label}: height`);
      const translates = tileTranslates(svg);
      assert.equal(translates.length, tilesX * tilesY, `${label}: contagem de tiles`);
      let i = 0;
      for (let r = 0; r < tilesY; r++) {
        for (let c = 0; c < tilesX; c++, i++) assert.deepEqual(translates[i], [c * (TILE + gap), r * (TILE + gap)], `${label}: tile ${i}`);
      }
      for (const fill of collectAttr(svg, 'fill')) {
        if (fill === 'none' || fill.startsWith('url(#')) continue;
        assert.match(fill, HEX_RE);
        assert.ok(allowed.has(fill), `${label}: fill ${fill}`);
      }
      // tiles nunca pintam o próprio fundo — só o retângulo único do mosaico
      assert.equal((svg.match(/id="background"/g) ?? []).length, 0, `${label}: tile com fundo próprio`);
      assert.equal((svg.match(new RegExp(`fill="${preset.background}"`, 'g')) ?? []).length, 1, `${label}: fundo do mosaico deve aparecer 1 vez`);
    }
  }
});

test('sem emenda (gap 0): tiles encostam exatamente e são recortados por um único clipPath de tileSize', () => {
  const svg = mosaic({ tilesX: 4, tilesY: 3, gap: 0 });
  const head = svg.slice(0, svg.indexOf('>') + 1);
  assert.equal(Number(collectAttr(head, 'width')[0]), 4 * TILE);
  assert.equal(Number(collectAttr(head, 'height')[0]), 3 * TILE);
  for (const [x, y] of tileTranslates(svg)) {
    assert.equal(x % TILE, 0);
    assert.equal(y % TILE, 0);
  }
  const clipIds = [...svg.matchAll(/clip-path="url\(#(mosaic-tile-clip-\d+)\)"/g)].map((m) => m[1]);
  assert.equal(new Set(clipIds).size, 1, 'todos os tiles devem usar o mesmo clipPath');
  const clipDef = svg.match(new RegExp(`<clipPath id="${clipIds[0]}"><rect x="0" y="0" width="([^"]+)" height="([^"]+)" /></clipPath>`));
  assert.ok(clipDef, 'clipPath do tile não definido em <defs>');
  assert.equal(Number(clipDef[1]), TILE);
  assert.equal(Number(clipDef[2]), TILE);
});

test('conteúdo do tile (r,c) depende só de seed/mosaicSeed/r/c — não do tamanho do mosaico', () => {
  const pattern = patternFromTheme('kata');
  const small = tileContents(mosaic({ pattern, tilesX: 2, tilesY: 2 }));
  const big = tileContents(mosaic({ pattern, tilesX: 4, tilesY: 3 }));
  assert.equal(small.length, 4);
  assert.equal(big.length, 12);
  // (0,0) e (0,1) estão em ambos; (1,0) e (1,1) também
  assert.equal(small[0], big[0]);
  assert.equal(small[1], big[1]);
  assert.equal(small[2], big[4]);
  assert.equal(small[3], big[5]);
  // tiles distintos não são cópias uns dos outros (variação por tile)
  assert.ok(new Set(big).size >= 10, 'tiles demais iguais entre si');
});

test('uniformDensity: 0 → nenhum ícone; 2 → todas as células preenchidas (sem subdivisão)', () => {
  const pattern = patternFromTheme('nordico', { subdivisionChance: 0, fillDensity: 0.6 });
  const empty = mosaic({ pattern, tilesX: 3, tilesY: 3, uniformDensity: 0 });
  assertWellFormed(empty, 'uniformDensity 0');
  assert.equal((empty.match(/data-shape="/g) ?? []).length, 0);
  const full = mosaic({ pattern, tilesX: 3, tilesY: 3, uniformDensity: 2 });
  assert.equal((full.match(/data-shape="/g) ?? []).length, 3 * 3 * pattern.resolution * pattern.resolution);
});

test('máscara de densidade: modo radial center-out esvazia as bordas antes do centro; mesma receita → mesmo SVG', () => {
  const pattern = patternFromTheme('floresta', { subdivisionChance: 0, fillDensity: 1 });
  const mask = { ...NO_MASK, enabled: true, shape: 'radial', mode: 'center-out', smoothness: 0 };
  const a = mosaic({ pattern, tilesX: 5, tilesY: 5, densityMask: mask });
  assert.equal(normalizeSvgIds(a), normalizeSvgIds(mosaic({ pattern, tilesX: 5, tilesY: 5, densityMask: mask })));
  const tiles = tileContents(a);
  const count = (s) => (s.match(/data-shape="/g) ?? []).length;
  const cells = pattern.resolution ** 2;
  assert.equal(count(tiles[12]), cells, 'tile central deveria estar 100% cheio (fator 1)');
  for (const corner of [0, 4, 20, 24]) assert.equal(count(tiles[corner]), 0, `canto ${corner} deveria estar vazio (fator 0)`);
});

test('gradient.js: refletido a 0°/90° e radial centrado casam nas bordas opostas; linear não (por isso a UI o esconde)', () => {
  const samples = Array.from({ length: 21 }, (_, i) => i / 20);
  const EPS = 1e-9;
  for (const v of samples) {
    // refletido 0°: borda esquerda = borda direita, e não varia com ny
    const r0 = { shape: 'reflected', angleDeg: 0 };
    assert.ok(Math.abs(resolveGradientFactor(r0, 0, v) - resolveGradientFactor(r0, 1, v)) < EPS);
    assert.ok(Math.abs(resolveGradientFactor(r0, v, 0) - resolveGradientFactor(r0, v, 1)) < EPS);
    // refletido 90°: borda de cima = borda de baixo
    const r90 = { shape: 'reflected', angleDeg: 90 };
    assert.ok(Math.abs(resolveGradientFactor(r90, v, 0) - resolveGradientFactor(r90, v, 1)) < EPS);
    assert.ok(Math.abs(resolveGradientFactor(r90, 0, v) - resolveGradientFactor(r90, 1, v)) < EPS);
    // radial com centro 0.5/0.5: simétrico nos dois eixos
    for (const mode of ['center-out', 'edge-out']) {
      const rad = { shape: 'radial', centerX: 0.5, centerY: 0.5, mode };
      assert.ok(Math.abs(resolveGradientFactor(rad, 0, v) - resolveGradientFactor(rad, 1, v)) < EPS);
      assert.ok(Math.abs(resolveGradientFactor(rad, v, 0) - resolveGradientFactor(rad, v, 1)) < EPS);
    }
    // tudo em [0,1]
    for (const cfg of [r0, r90, { shape: 'linear', angleDeg: 37 }, { shape: 'radial' }]) {
      const f = resolveGradientFactor(cfg, v, 1 - v);
      assert.ok(f >= 0 && f <= 1, `${cfg.shape}: ${f}`);
    }
  }
  // linear: salta de 0 (esquerda) pra 1 (direita) — emenda visível
  const lin = { shape: 'linear', angleDeg: 0 };
  assert.ok(Math.abs(resolveGradientFactor(lin, 0, 0.5) - 0) < EPS);
  assert.ok(Math.abs(resolveGradientFactor(lin, 1, 0.5) - 1) < EPS);
  // refletido a 45° NÃO casa nas bordas — por isso a UI trava o eixo em 0°/90°
  const r45 = { shape: 'reflected', angleDeg: 45 };
  assert.ok(Math.abs(resolveGradientFactor(r45, 0, 0.25) - resolveGradientFactor(r45, 1, 0.25)) > 0.1);
});

test('aparência do mosaico: transparentBg omite o retângulo de fundo; blackIcon pinta só com preto', () => {
  const pattern = patternFromTheme('oceano', { fillDensity: 1 });
  const transparent = mosaic({ pattern: { ...pattern, transparentBg: true } });
  assertWellFormed(transparent, 'transparentBg');
  assert.ok(!transparent.includes(`fill="${pattern.background}"`));

  const black = mosaic({ pattern: { ...pattern, blackIcon: true } });
  assertWellFormed(black, 'blackIcon');
  const fills = collectAttr(black, 'fill').filter((f) => f !== 'none');
  assert.ok(fills.length > 0);
  for (const f of fills) assert.ok(f === '#000000' || f === pattern.background, `blackIcon: fill ${f}`);
});

test('contorno e degradê no mosaico: SVG bem formado, toda url(#id) resolve, grão só com degradê ligado', () => {
  const pattern = patternFromTheme('cromado', { strokeEnabled: true, strokeColor: '#ff00ff', gradientFillEnabled: true, grainEnabled: true });
  const svg = mosaic({ pattern, tilesX: 2, tilesY: 2 });
  assertWellFormed(svg, 'stroke+gradient+grain');
  const ids = new Set(collectAttr(svg, 'id'));
  for (const ref of [...svg.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1])) assert.ok(ids.has(ref), `url(#${ref}) sem definição`);
  for (const s of collectAttr(svg, 'stroke')) assert.equal(s, '#ff00ff');
  assert.equal((svg.match(/<filter /g) ?? []).length, 1, 'grão deve ser UM filtro pro mosaico inteiro, não por tile');

  const noGradient = mosaic({ pattern: { ...pattern, gradientFillEnabled: false } });
  assert.equal((noGradient.match(/<filter /g) ?? []).length, 0, 'grão sem degradê não deve existir');
});
