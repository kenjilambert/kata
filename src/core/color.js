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
