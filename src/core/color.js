export function hexToHsl(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s: s * 100, l: l * 100 };
}

export function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const hue = ((h % 360) + 360) % 360;
  const k = (n) => (n + hue / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (n) => Math.round(255 * f(n)).toString(16).padStart(2, '0');
  return `#${toHex(0)}${toHex(8)}${toHex(4)}`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// amount > 0 clareia (interpola a luminosidade em direção a 100), amount < 0
// escurece (interpola em direção a 0) — usado pelo degradê interno de cada
// forma (2º stop = a mesma cor da célula, só que clareada/escurecida).
export function lightenDarkenHex(hex, amount) {
  const { h, s, l } = hexToHsl(hex);
  const target = amount >= 0 ? l + (100 - l) * amount : l + l * amount;
  return hslToHex(h, s, clamp(target, 0, 100));
}

// Distribui matizes ao redor da roda de cores usando o ângulo dourado
// (137.508°) a partir da cor base — evita que as cores geradas fiquem
// agrupadas perto umas das outras, mesmo pra contagens pequenas ou grandes.
// Saturação/luminosidade recebem uma variação determinística por índice
// (não aleatória) pra não ficar tudo com o mesmo "peso" visual.
const GOLDEN_ANGLE = 137.508;

export function generateHarmoniousPalette(baseHex, additionalCount) {
  const { h, s, l } = hexToHsl(baseHex);
  const colors = [{ color: baseHex, weight: 1 }];
  for (let i = 1; i <= additionalCount; i++) {
    const hue = h + GOLDEN_ANGLE * i;
    const sat = clamp(s + (((i * 37) % 21) - 10), 35, 90);
    const light = clamp(l + (((i * 53) % 41) - 20), 22, 82);
    colors.push({ color: hslToHex(hue, sat, light), weight: 1 });
  }
  return colors;
}

// Aceita "#rgb" ou "#rrggbb" (com ou sem '#') e devolve os 3 canais em 0..255,
// ou null se a string não for um hex reconhecível — quem chama decide o que
// fazer (as regras de cor do gerador, por ex., simplesmente pulam a checagem
// em vez de quebrar a geração por causa de uma cor malformada).
function parseHexRgb(hex) {
  if (typeof hex !== 'string') return null;
  let s = hex.trim();
  if (s.startsWith('#')) s = s.slice(1);
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  if (s.length !== 6 || /[^0-9a-fA-F]/.test(s)) return null;
  const n = parseInt(s, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

// sRGB (com a curva gamma) → linear, canal por canal — a fórmula exata da
// WCAG 2.x, não a aproximação por potência 2.2.
function srgbChannelToLinear(v8) {
  const v = v8 / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

// Luminância relativa WCAG 2.x (0 = preto, 1 = branco). Base do contrastRatio
// abaixo e reaproveitável por quem quiser ordenar cores por "claridade" de
// verdade (a L do HSL de hexToHsl não é perceptual — #0000ff e #ffff00 têm
// a mesma L=50 mas luminâncias 0.07 e 0.93).
export function relativeLuminance(hex) {
  const rgb = parseHexRgb(hex);
  if (!rgb) return NaN;
  return 0.2126 * srgbChannelToLinear(rgb.r) + 0.7152 * srgbChannelToLinear(rgb.g) + 0.0722 * srgbChannelToLinear(rgb.b);
}

// Razão de contraste WCAG 2.x: 1 (cores idênticas) a 21 (#000 vs #fff).
// Simétrica — a ordem dos argumentos não importa. Devolve NaN se alguma das
// cores não for hex válido.
export function contrastRatio(hexA, hexB) {
  const la = relativeLuminance(hexA);
  const lb = relativeLuminance(hexB);
  if (Number.isNaN(la) || Number.isNaN(lb)) return NaN;
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}
