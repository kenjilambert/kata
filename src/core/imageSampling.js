export function sampleImageGrid(imgEl, size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  const side = Math.min(imgEl.naturalWidth, imgEl.naturalHeight);
  const sx = (imgEl.naturalWidth - side) / 2;
  const sy = (imgEl.naturalHeight - side) / 2;
  ctx.drawImage(imgEl, sx, sy, side, side, 0, 0, size, size);

  const { data } = ctx.getImageData(0, 0, size, size);
  const grid = [];
  for (let r = 0; r < size; r++) {
    const row = [];
    for (let c = 0; c < size; c++) {
      const i = (r * size + c) * 4;
      const r8 = data[i];
      const g8 = data[i + 1];
      const b8 = data[i + 2];
      row.push({ r: r8, g: g8, b: b8, luminance: (0.299 * r8 + 0.587 * g8 + 0.114 * b8) / 255 });
    }
    grid.push(row);
  }
  return grid;
}

// mesma técnica de sampleImageGrid, mas sem recortar pro quadrado central —
// estica a imagem pra caber exatamente numa grade cols×rows. Usado pela
// máscara de densidade do Mosaico (grade de tiles nem sempre é quadrada).
export function sampleImageGridRect(imgEl, cols, rows) {
  const canvas = document.createElement('canvas');
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(imgEl, 0, 0, imgEl.naturalWidth, imgEl.naturalHeight, 0, 0, cols, rows);

  const { data } = ctx.getImageData(0, 0, cols, rows);
  const grid = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      const i = (r * cols + c) * 4;
      const r8 = data[i];
      const g8 = data[i + 1];
      const b8 = data[i + 2];
      row.push({ r: r8, g: g8, b: b8, luminance: (0.299 * r8 + 0.587 * g8 + 0.114 * b8) / 255 });
    }
    grid.push(row);
  }
  return grid;
}

export function nearestPaletteColor(rgb, colors) {
  let best = colors[0]?.color || '#000000';
  let bestDist = Infinity;
  for (const entry of colors) {
    const n = parseInt(entry.color.slice(1), 16);
    const cr = (n >> 16) & 255;
    const cg = (n >> 8) & 255;
    const cb = n & 255;
    const dist = (cr - rgb.r) ** 2 + (cg - rgb.g) ** 2 + (cb - rgb.b) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = entry.color;
    }
  }
  return best;
}
