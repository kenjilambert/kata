// (6) i18n.js — pt e en com o mesmo conjunto de chaves, nada vazio,
// e chaves derivadas (theme_/shape_/symmetry_) cobrindo o catálogo real
import test from 'node:test';
import assert from 'node:assert/strict';
import { t, setLang, getLang, AVAILABLE_LANGS, onLangChange } from '../src/core/i18n.js';
import { PRESETS } from '../src/core/palette.js';
import { SHAPE_KEYS } from '../src/modules/grid-icons/shapes.js';
import { SYMMETRY_VALUES } from '../src/core/symmetry.js';
import { loadI18nStrings, loadThemesJson } from './_helpers.mjs';

// STRINGS não é exportado — extraído do fonte (ver _helpers.mjs)
const STRINGS = loadI18nStrings();

test('AVAILABLE_LANGS = pt e en; idioma inicial em Node é pt', () => {
  assert.deepEqual([...AVAILABLE_LANGS].sort(), ['en', 'pt']);
  assert.deepEqual(Object.keys(STRINGS).sort(), ['en', 'pt']);
  assert.equal(getLang(), 'pt');
});

test('STRINGS.pt e STRINGS.en têm exatamente o mesmo conjunto de chaves', () => {
  const pt = Object.keys(STRINGS.pt).sort();
  const en = Object.keys(STRINGS.en).sort();
  const onlyPt = pt.filter((k) => !(k in STRINGS.en));
  const onlyEn = en.filter((k) => !(k in STRINGS.pt));
  assert.deepEqual(onlyPt, [], `só em pt: ${onlyPt}`);
  assert.deepEqual(onlyEn, [], `só em en: ${onlyEn}`);
  assert.deepEqual(pt, en);
  assert.ok(pt.length > 100, 'dicionário suspeitamente pequeno');
});

test('nenhum valor vazio ou não-string em pt/en', () => {
  for (const lang of ['pt', 'en']) {
    for (const [k, v] of Object.entries(STRINGS[lang])) {
      assert.equal(typeof v, 'string', `${lang}.${k} não é string`);
      assert.ok(v.trim().length > 0, `${lang}.${k} vazio`);
    }
  }
});

test('theme_<key> existe pra todo preset de paleta e todo tema do themes.json', () => {
  const themes = loadThemesJson();
  for (const key of [...Object.keys(PRESETS), ...Object.keys(themes), 'blank']) {
    assert.ok(STRINGS.pt[`theme_${key}`], `pt falta theme_${key}`);
    assert.ok(STRINGS.en[`theme_${key}`], `en falta theme_${key}`);
  }
});

test('shape_<key> existe pra toda forma de SHAPE_KEYS; symmetry_<v> pra todo SYMMETRY_VALUES', () => {
  for (const key of SHAPE_KEYS) {
    assert.ok(STRINGS.pt[`shape_${key}`], `pt falta shape_${key}`);
    assert.ok(STRINGS.en[`shape_${key}`], `en falta shape_${key}`);
  }
  for (const v of SYMMETRY_VALUES) {
    assert.ok(STRINGS.pt[`symmetry_${v}`], `pt falta symmetry_${v}`);
    assert.ok(STRINGS.en[`symmetry_${v}`], `en falta symmetry_${v}`);
  }
});

test('t() traduz conforme setLang, cai pra pt e depois pra chave; listeners disparam', () => {
  const events = [];
  const off = onLangChange((lang) => events.push(lang));
  try {
    assert.equal(t('appTitle'), STRINGS.pt.appTitle);
    assert.equal(t('chave-que-nao-existe'), 'chave-que-nao-existe');

    setLang('en');
    assert.equal(getLang(), 'en');
    assert.equal(t('appTitle'), STRINGS.en.appTitle);
    // toda chave traduz pra algo diferente da própria chave, nas duas línguas
    for (const k of Object.keys(STRINGS.en)) assert.notEqual(t(k), k, `en: ${k} sem tradução`);

    setLang('xx'); // inválido: ignorado
    assert.equal(getLang(), 'en');
    setLang('en'); // igual ao atual: não notifica
    setLang('pt');
    for (const k of Object.keys(STRINGS.pt)) assert.notEqual(t(k), k, `pt: ${k} sem tradução`);
    assert.deepEqual(events, ['en', 'pt']);
  } finally {
    off();
    setLang('pt');
  }
});
