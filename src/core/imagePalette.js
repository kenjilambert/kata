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

// ---------------------------------------------------------------------------
// Espaço de cor pra medir distância: CIE Lab (D65), calculado UMA vez por
// pixel. Distância euclidiana em RGB trata "dois pretos quase iguais" e
// "vermelho vs. laranja" com a mesma régua, então o k-means em RGB tende a
// gastar clusters separando sombras de uma mesma área escura e fundir matizes
// que a gente vê como cores diferentes. Em Lab a distância euclidiana já
// aproxima a diferença percebida (ΔE76) — bom o bastante pra extrair uma
// paleta, sem o custo/complexidade de ΔE2000. Como a imagem já chega reduzida
// (sampleSize² pixels, ver extractPaletteFromBlob), a conversão custa nada.
// A cor de saída de cada cluster é a média em RGB dos pixels dele — assim não
// precisa da conversão inversa Lab→sRGB (com clamp e tudo).
function srgbToLinear(v8) {
  const v = v8 / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function labF(t) {
  return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
}

function rgbToLab(r, g, b) {
  const rl = srgbToLinear(r);
  const gl = srgbToLinear(g);
  const bl = srgbToLinear(b);
  // sRGB → XYZ (D65), já dividido pelo branco de referência (0.9505, 1, 1.089)
  const x = (0.4124 * rl + 0.3576 * gl + 0.1805 * bl) / 0.95047;
  const y = 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
  const z = (0.0193 * rl + 0.1192 * gl + 0.9505 * bl) / 1.08883;
  const fx = labF(x);
  const fy = labF(y);
  const fz = labF(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function labDistSq(a, b) {
  const dl = a[0] - b[0];
  const da = a[1] - b[1];
  const db = a[2] - b[2];
  return dl * dl + da * da + db * db;
}

const toHex2 = (n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');

// k-means de verdade sobre pixels RGBA (o `data` de um ImageData, ou qualquer
// array plano r,g,b,a,r,g,b,a...). Função PURA — sem canvas/DOM — pra poder
// ser testada em Node com pixels sintéticos.
//
// Por que não só a quantização por bucket que existia antes: o bucket
// arredonda cada canal pra `levels` degraus fixos, então uma cor que cai
// exatamente na fronteira entre dois degraus se divide em dois buckets
// vizinhos (cada um com metade da contagem, os dois com quase a mesma média)
// e uma imagem com 3 cores nítidas + ruído voltava 5 "cores" em que duas
// eram praticamente repetidas. Aqui os buckets servem só pra INICIALIZAR os
// centros (os mais populosos, pulando os que estão perto demais de um já
// escolhido — determinístico, sem sorteio, então a mesma imagem sempre dá a
// mesma paleta), e o k-means depois puxa cada centro pro centro de massa
// real do agrupamento.
//
// Retorna [{ color: '#rrggbb', weight: 1..10 }], ordenado da cor mais
// frequente pra menos — o mesmo formato que extractPaletteFromBlob sempre
// devolveu (grid-icons/index.js usa palette[0] como fundo e o resto como cores).
export function kMeansPalette(
  pixels,
  k = 5,
  { levels = 6, iterations = 6, alphaThreshold = 128, seedDistance = 18, dedupeDistance = 12 } = {}
) {
  // 1) pixels opacos → Lab (uma vez só) + RGB cru (pra média de saída)
  const labs = [];
  const rgbs = [];
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] < alphaThreshold) continue; // quase transparente: ignora
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    rgbs.push([r, g, b]);
    labs.push(rgbToLab(r, g, b));
  }
  const n = labs.length;
  if (n === 0 || k <= 0) return [];

  // 2) inicialização determinística: buckets (como antes) ordenados por
  //    população; desempate por chave pra não depender da ordem do Map.
  const buckets = new Map();
  for (let i = 0; i < n; i++) {
    const [r, g, b] = rgbs[i];
    const key =
      Math.round((r / 255) * (levels - 1)) * levels * levels +
      Math.round((g / 255) * (levels - 1)) * levels +
      Math.round((b / 255) * (levels - 1));
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { key, count: 0, l: 0, a: 0, b: 0 };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    bucket.l += labs[i][0];
    bucket.a += labs[i][1];
    bucket.b += labs[i][2];
  }
  const seeds = [...buckets.values()]
    .sort((p, q) => q.count - p.count || p.key - q.key)
    .map((s) => [s.l / s.count, s.a / s.count, s.b / s.count]);
  // Uma cor dominante com ruído se espalha por vários buckets vizinhos, e
  // esses acabam sendo justamente os mais populosos — pegar os k primeiros
  // "cegamente" semearia 2-3 centros na MESMA cor e o k-means (que só move
  // centros, nunca funde) devolveria vermelho, vermelho-quase-igual, azul...
  // Por isso cada semente nova precisa estar a pelo menos seedDistance (ΔE)
  // de todas as já escolhidas. Se isso não completar k, NÃO completa com as
  // populosas restantes: a imagem simplesmente tem menos cores distintas
  // que k, e devolver menos é a resposta honesta (completar semearia de
  // novo dois centros na mesma cor, o k-means dividiria aquela nuvem em
  // duas metades e os dois centros acabariam longe demais pro dedupe final
  // fundir de volta).
  let centers = [];
  for (const s of seeds) {
    if (centers.length >= k) break;
    if (centers.every((c) => labDistSq(c, s) >= seedDistance * seedDistance)) centers.push(s);
  }

  // 3) iterações de Lloyd: atribui cada pixel ao centro mais perto, recalcula
  //    os centros. Poucas iterações bastam porque a inicialização já cai
  //    perto das cores dominantes; um centro que ficar sem pixel algum é
  //    descartado (aconteceria se dois buckets iniciais descrevessem a mesma
  //    cor de verdade — o mais forte "rouba" tudo do outro).
  const assignment = new Int32Array(n);
  for (let iter = 0; iter < iterations; iter++) {
    const kc = centers.length;
    const sums = Array.from({ length: kc }, () => [0, 0, 0, 0]);
    let moved = false;
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let j = 0; j < kc; j++) {
        const d = labDistSq(labs[i], centers[j]);
        if (d < bestD) {
          bestD = d;
          best = j;
        }
      }
      if (assignment[i] !== best) moved = true;
      assignment[i] = best;
      const s = sums[best];
      s[0] += labs[i][0];
      s[1] += labs[i][1];
      s[2] += labs[i][2];
      s[3] += 1;
    }
    const next = [];
    const remap = new Int32Array(kc);
    for (let j = 0; j < kc; j++) {
      if (sums[j][3] === 0) {
        remap[j] = -1;
        continue;
      }
      remap[j] = next.length;
      next.push([sums[j][0] / sums[j][3], sums[j][1] / sums[j][3], sums[j][2] / sums[j][3]]);
    }
    if (next.length !== kc) {
      for (let i = 0; i < n; i++) assignment[i] = remap[assignment[i]];
    }
    centers = next;
    if (!moved && iter > 0) break; // convergiu antes do limite de iterações
  }

  // 4) clusters finais: contagem + média RGB de saída
  const clusters = centers.map((lab) => ({ lab, count: 0, r: 0, g: 0, b: 0 }));
  for (let i = 0; i < n; i++) {
    const cl = clusters[assignment[i]];
    cl.count += 1;
    cl.r += rgbs[i][0];
    cl.g += rgbs[i][1];
    cl.b += rgbs[i][2];
  }

  // 5) dedupe: dois centros mais perto que dedupeDistance (ΔE76 ≈ 12 — abaixo
  //    disso, lado a lado numa paleta de swatches, parecem "a mesma cor")
  //    são fundidos no mais populoso. Varre do maior pro menor pra a cor
  //    dominante sempre absorver a satélite, nunca o contrário.
  clusters.sort((p, q) => q.count - p.count);
  const merged = [];
  for (const cl of clusters) {
    if (cl.count === 0) continue;
    const host = merged.find((m) => labDistSq(m.lab, cl.lab) < dedupeDistance * dedupeDistance);
    if (host) {
      host.count += cl.count;
      host.r += cl.r;
      host.g += cl.g;
      host.b += cl.b;
    } else {
      merged.push(cl);
    }
  }
  merged.sort((p, q) => q.count - p.count);

  const total = merged.reduce((sum, m) => sum + m.count, 0) || 1;
  return merged.map((m) => ({
    color: `#${toHex2(m.r / m.count)}${toHex2(m.g / m.count)}${toHex2(m.b / m.count)}`,
    weight: Math.max(1, Math.round((m.count / total) * 10)),
  }));
}

// Mesma assinatura/retorno de sempre. A imagem é reduzida pra sampleSize×
// sampleSize no canvas ANTES de ler os pixels (64² = 4096 pixels), então o
// k-means roda em bem menos de um frame mesmo pra uma foto grande colada.
export async function extractPaletteFromBlob(
  blob,
  { maxColors = 5, sampleSize = 64, levels = 6, iterations = 6 } = {}
) {
  const bitmap = await loadBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = sampleSize;
  canvas.height = sampleSize;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, sampleSize, sampleSize);
  const { data } = ctx.getImageData(0, 0, sampleSize, sampleSize);
  return kMeansPalette(data, maxColors, { levels, iterations });
}
