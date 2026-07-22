function loadBitmap(blob) {
  if (window.createImageBitmap) return createImageBitmap(blob);
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = reject;
    img.src = url;
  });
}

export async function extractPaletteFromBlob(blob, { maxColors = 5, sampleSize = 64, levels = 6 } = {}) {
  const bitmap = await loadBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = sampleSize;
  canvas.height = sampleSize;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, sampleSize, sampleSize);
  const { data } = ctx.getImageData(0, 0, sampleSize, sampleSize);

  const buckets = new Map();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const key = [r, g, b].map((v) => Math.round((v / 255) * (levels - 1))).join('-');
    const bucket = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0 };
    bucket.count += 1;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    buckets.set(key, bucket);
  }

  const sorted = [...buckets.values()].sort((a, b) => b.count - a.count).slice(0, maxColors);
  const total = sorted.reduce((sum, b) => sum + b.count, 0) || 1;
  const toHex = (n) => Math.round(n).toString(16).padStart(2, '0');

  return sorted.map((bucket) => ({
    color: `#${toHex(bucket.r / bucket.count)}${toHex(bucket.g / bucket.count)}${toHex(bucket.b / bucket.count)}`,
    weight: Math.max(1, Math.round((bucket.count / total) * 10)),
  }));
}
