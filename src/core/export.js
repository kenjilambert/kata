export function serializeSvgDocument(svgString) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${svgString}`;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportSvgString(svgString, filename = 'padrao.svg') {
  const blob = new Blob([serializeSvgDocument(svgString)], { type: 'image/svg+xml' });
  downloadBlob(blob, filename);
}

export function exportPngFromSvgString(svgString, filename = 'padrao.png', scale = 2) {
  return new Promise((resolve, reject) => {
    const width = Number(svgString.match(/width="(\d+(\.\d+)?)"/)?.[1] || 800);
    const height = Number(svgString.match(/height="(\d+(\.\d+)?)"/)?.[1] || 800);
    const blob = new Blob([svgString], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((pngBlob) => {
        if (!pngBlob) {
          reject(new Error('Falha ao gerar PNG'));
          return;
        }
        downloadBlob(pngBlob, filename);
        resolve();
      }, 'image/png');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Falha ao carregar SVG para rasterizar'));
    };
    img.src = url;
  });
}
