const GLYPHS = {
  K: ['10001', '10010', '11100', '10010', '10001'],
  A: ['01110', '10001', '11111', '10001', '10001'],
  T: ['11111', '00100', '00100', '00100', '00100'],
};

// Gera o wordmark como uma grade de pixels pretos, com poeira/ruído espalhado
// nas bordas — imita a textura "quebrada"/dither das referências, em vez de
// blocos perfeitamente limpos.
export function renderPixelWordmark(text, { cell = 15, gapCols = 1, color = '#111111', noise = 22 } = {}) {
  const letters = text.toUpperCase().split('');
  const cols = letters.reduce((sum, _ch, i) => sum + 5 + (i < letters.length - 1 ? gapCols : 0), 0);
  const rows = 5;
  const bleed = 2; // linhas de folga acima/abaixo pro ruído poder "vazar" da letra
  const width = cols * cell;
  const height = (rows + bleed * 2) * cell;
  const pad = cell * 0.12;

  const occupied = new Set();
  let squares = '';

  function drawCell(col, row, size, opacity = 1) {
    const x = col * cell + (cell - size) / 2;
    const y = (row + bleed) * cell + (cell - size) / 2;
    squares += `<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="${color}" opacity="${opacity}" />`;
  }

  let colOffset = 0;
  letters.forEach((ch) => {
    const glyph = GLYPHS[ch];
    if (glyph) {
      glyph.forEach((rowBits, r) => {
        rowBits.split('').forEach((bit, c) => {
          if (bit === '1') {
            const col = colOffset + c;
            occupied.add(`${col},${r}`);
            drawCell(col, r, cell - pad * 2);
          }
        });
      });
    }
    colOffset += 5 + gapCols;
  });

  // ruído espalhado: pontos menores e irregulares perto das letras, mais denso
  // colado nelas e se dissipando pra fora — mesma lógica visual do halftone
  // das referências.
  for (let i = 0; i < noise; i++) {
    const col = Math.floor(Math.random() * cols);
    const row = Math.floor(Math.random() * rows) - bleed + Math.round((Math.random() - 0.5) * 2);
    const key = `${col},${row}`;
    if (occupied.has(key)) continue;
    const size = cell * (0.2 + Math.random() * 0.35);
    const opacity = 0.35 + Math.random() * 0.5;
    drawCell(col, row, size, opacity);
  }

  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${text}">${squares}</svg>`;
}
