export const FILL_STYLES = {
  solid: {
    label: 'Sólido',
    fillAttr(color) {
      return `fill="${color}"`;
    },
  },
};

// Próximos estilos a entrar aqui conforme os módulos que os usam forem construídos:
// grade de pontos (halftone), scanline/hachura, chuvisco/stipple.

// filtro SVG de grão granulado: feTurbulence vira uma MÁSCARA de alpha (não
// um cinza opaco) via feColorMatrix, feComponentTransfer controla o
// contraste/intensidade dessa máscara, feFlood pinta a cor do grão (preta por
// padrão, mas livre) e feComposite "in" recorta essa cor pela máscara —
// resultado: manchinhas da cor escolhida, com opacidade variável seguindo o
// ruído. Isso é multiply-blendado por cima do que já foi desenhado (escurece
// em vez de clarear/saturar como "overlay" fazia) e o feComposite final
// recorta pelo alpha do SourceGraphic — sem ele, qualquer área vazia/
// transparente do ícone (célula em branco, espaço entre formas) virava ruído
// TOTALMENTE OPACO (feBlend trata origem transparente + máscara opaca como
// "mostra a máscara inteira"), fazendo o grão parecer que só aparecia por
// cima do fundo em vez de por cima das formas com degradê. intensity=0
// colapsa a máscara numa opacidade quase uniforme (grão bem sutil);
// intensity=1 dá contraste máximo. grainSize 0..1 mapeia (invertido) pra
// baseFrequency do feTurbulence — 0 = grão bem fino, 1 = manchas grandes.
export function buildGrainFilterMarkup(id, { intensity, grainSize, color = '#000000' }) {
  const baseFrequency = Math.max(0.01, 0.9 - grainSize * 0.85);
  const mid = 0.5 - intensity / 2;
  return `<filter id="${id}" x="-5%" y="-5%" width="110%" height="110%">
    <feTurbulence type="fractalNoise" baseFrequency="${baseFrequency}" numOctaves="2" seed="7" stitchTiles="stitch" result="noise" />
    <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.33 0.33 0.33 0 0" result="noiseAlpha" />
    <feComponentTransfer in="noiseAlpha" result="grainMask">
      <feFuncA type="linear" slope="${intensity}" intercept="${mid}" />
    </feComponentTransfer>
    <feFlood flood-color="${color}" result="grainColor" />
    <feComposite in="grainColor" in2="grainMask" operator="in" result="coloredGrain" />
    <feBlend in="SourceGraphic" in2="coloredGrain" mode="multiply" result="blended" />
    <feComposite in="blended" in2="SourceGraphic" operator="in" />
  </filter>`;
}
