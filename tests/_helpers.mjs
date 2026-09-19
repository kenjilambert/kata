// Utilitários compartilhados pelos testes — sem dependência externa.
// Tudo aqui é PROPRIEDADE (estrutura/invariante), nunca snapshot de SVG
// exato: generator.js/color.js estão em edição ativa por outras pessoas.
import { readFileSync } from 'node:fs';
import { PRESETS } from '../src/core/palette.js';

const ROOT = new URL('../', import.meta.url);

export function loadThemesJson() {
  return JSON.parse(readFileSync(new URL('src/modules/grid-icons/themes.json', ROOT), 'utf8'));
}

// STRINGS não é exportado por i18n.js — extrai o literal do fonte e avalia
// (só strings, sem código) pra comparar os dicionários pt/en por completo.
export function loadI18nStrings() {
  const src = readFileSync(new URL('src/core/i18n.js', ROOT), 'utf8');
  const start = src.indexOf('const STRINGS = ');
  const end = src.indexOf('\n};', start);
  if (start < 0 || end < 0) throw new Error('não achei o literal STRINGS em i18n.js');
  const literal = src.slice(start + 'const STRINGS = '.length, end + 2);
  return new Function(`return (${literal});`)();
}

// receita mínima de ícone a partir de um tema (mesmo que a UI monta a partir
// de themes.json + PRESETS) — sem stroke/degradê por padrão (ids globais
// incrementais tornariam o SVG diferente a cada chamada).
export function paramsFromTheme(themeKey, theme, overrides = {}) {
  const preset = PRESETS[theme.preset];
  return {
    seed: 1,
    size: 6,
    symmetry: theme.symmetry,
    fillDensity: theme.fillDensity,
    shapesAllowed: theme.shapes,
    background: preset.background,
    colors: preset.colors,
    subdivisionChance: theme.subdivisionChance ?? 0,
    detailGradient: theme.detailGradient ?? 'uniform',
    iconSize: 420,
    rotation: theme.rotation ?? 0,
    strokeWidth: theme.strokeWidth ?? 0.24,
    ...overrides,
  };
}

// ids gerados por contador global (clip/gradiente/grão) mudam a cada chamada
// — normaliza pra comparar dois SVGs "iguais a menos de ids".
export function normalizeSvgIds(svg) {
  return svg.replace(/(cell-clip|cell-edge-hole|grad-fill|grain|mosaic-tile-clip|mosaic-grain)-\d+/g, '$1-N');
}

export const HEX_RE = /^#[0-9a-f]{6}$/i;

// Tokeniza tags de um SVG e verifica balanceamento. Devolve { roots, tags,
// errors } — roots = quantas tags <svg de nível 0.
export function analyzeSvg(svg) {
  const tagRe = /<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^'">])*?)(\/?)>/g;
  const stack = [];
  const errors = [];
  const tags = [];
  let roots = 0;
  let m;
  while ((m = tagRe.exec(svg))) {
    const [, closing, name, , selfClose] = m;
    tags.push(m[0]);
    if (closing) {
      const top = stack.pop();
      if (top !== name) errors.push(`fechou </${name}> mas esperava </${top}>`);
    } else if (!selfClose) {
      if (name === 'svg' && stack.length === 0) roots++;
      stack.push(name);
    }
  }
  if (stack.length) errors.push(`tags sem fechamento: ${stack.join(', ')}`);
  return { roots, tags, errors };
}

export function collectAttr(svg, attr) {
  // (?<![\w-]) em vez de \b: "stroke-width" não pode contar como "width"
  const re = new RegExp(`(?<![\\w-])${attr}="([^"]*)"`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(svg))) out.push(m[1]);
  return out;
}

export const CORNERS = ['tl', 'tr', 'br', 'bl'];
