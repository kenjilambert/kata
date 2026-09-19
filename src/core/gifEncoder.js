// Encoder de GIF animado (GIF89a) escrito do zero — sem nenhuma lib externa
// (gif.js e afins costumam vir com worker próprio + várias dependências;
// como o projeto não usa bundler nem dependências, um encoder próprio,
// mesmo que mais simples, encaixa melhor). Cobre só o necessário pro modo
// Vídeo: 1 tabela de cores GLOBAL (compartilhada por todos os quadros — o
// modo Vídeo já usa uma paleta pequena e fixa na prática, então não precisa
// de tabela de cores por quadro), sem entrelaçamento, sem transparência.

// escreve códigos de tamanho VARIÁVEL (2 a 12 bits) num fluxo de bytes,
// bit a bit, do menos significativo pro mais significativo — é exatamente
// como o formato LZW do GIF empacota os códigos (nunca alinhado a byte
// entre um código e o próximo).
function createBitWriter() {
  let bitBuf = 0;
  let bitCount = 0;
  const bytes = [];
  return {
    write(code, size) {
      bitBuf |= code << bitCount;
      bitCount += size;
      while (bitCount >= 8) {
        bytes.push(bitBuf & 0xff);
        bitBuf >>= 8;
        bitCount -= 8;
      }
    },
    flush() {
      if (bitCount > 0) {
        bytes.push(bitBuf & 0xff);
        bitBuf = 0;
        bitCount = 0;
      }
    },
    bytes,
  };
}

// LZW variante "baseada em código" (o dicionário mapeia código-atual + o
// próximo índice de cor pro próximo código, em vez de concatenar strings) —
// bem mais rápido que a versão didática com strings, importante aqui porque
// roda em cima de dezenas de quadros × dezenas de milhares de pixels.
function lzwEncodeIndices(indices, minCodeSize) {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = endCode + 1;
  let dict = new Map();

  const writer = createBitWriter();
  writer.write(clearCode, codeSize);

  let w = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = w * 256 + k;
    const existing = dict.get(key);
    if (existing !== undefined) {
      w = existing;
      continue;
    }
    writer.write(w, codeSize);
    dict.set(key, nextCode);
    nextCode++;
    // aumenta o tamanho do código UM código mais tarde que a regra "de
    // livro" (nextCode > 2^codeSize - 1): o decodificador só consegue
    // adicionar sua própria entrada no dicionário DEPOIS de ler o código
    // seguinte (ele aprende o "próximo símbolo" um passo atrasado em
    // relação a quem codifica), então o número de entradas dele fica
    // sempre 1 atrás do nosso na mesma posição do fluxo — se a gente
    // aumentasse o tamanho no mesmo instante "de livro", o decodificador
    // ainda leria o próximo código com o tamanho ANTIGO (poucos bits
    // demais), embaralhando tudo dali em diante. Usar > (2^codeSize), não
    // -1, atrasa nosso aumento em exatamente 1 código, alinhando com esse
    // atraso — confirmado por teste de ida-e-volta antes de fechar isso.
    if (nextCode > (1 << codeSize) && codeSize < 12) codeSize++;
    // dicionário cheio (4096 entradas, o teto de um código de 12 bits):
    // reseta do zero, avisando com um código de limpeza.
    if (nextCode >= 4096) {
      writer.write(clearCode, codeSize);
      dict = new Map();
      codeSize = minCodeSize + 1;
      nextCode = endCode + 1;
    }
    w = k;
  }
  writer.write(w, codeSize);
  writer.write(endCode, codeSize);
  writer.flush();
  return writer.bytes;
}

// dados de imagem de um quadro = [tamanho mínimo de código] + N sub-blocos
// (1 byte de tamanho 1-255 + esse tanto de bytes), terminados por um
// sub-bloco de tamanho 0 — formato de sempre do GIF pra qualquer bloco de
// dados "longo" (também usado nas extensões de aplicativo).
function packSubBlocks(bytes) {
  const out = [];
  for (let i = 0; i < bytes.length; i += 255) {
    const chunk = bytes.slice(i, i + 255);
    out.push(chunk.length, ...chunk);
  }
  out.push(0);
  return out;
}

function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// mapeia cada pixel RGBA do quadro pro índice de cor mais próximo da
// paleta (distância euclidiana simples em RGB — a paleta do modo Vídeo é
// sempre pequena, então uma busca linear por pixel é barata o bastante).
function quantizeFrame(rgba, paletteRgb) {
  const pixelCount = rgba.length / 4;
  const indices = new Uint8Array(pixelCount);
  for (let p = 0; p < pixelCount; p++) {
    const i = p * 4;
    const r = rgba[i];
    const g = rgba[i + 1];
    const b = rgba[i + 2];
    let best = 0;
    let bestDist = Infinity;
    for (let c = 0; c < paletteRgb.length; c++) {
      const [pr, pg, pb] = paletteRgb[c];
      const dist = (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2;
      if (dist < bestDist) {
        bestDist = dist;
        best = c;
      }
    }
    indices[p] = best;
  }
  return indices;
}

// palette: array de cores hex ('#rrggbb'), até 256. frames: array de
// Uint8ClampedArray/Uint8Array RGBA (mesma largura×altura pra todos).
// delayCs: duração de cada quadro em centésimos de segundo (unidade nativa
// do GIF) — 10 = 100ms = 10fps.
export function encodeGif({ width, height, frames, palette, delayCs = 10 }) {
  const bitsNeeded = Math.max(2, Math.ceil(Math.log2(Math.max(2, palette.length))));
  const tableSize = 1 << bitsNeeded;
  const paletteRgb = palette.map(hexToRgb);
  while (paletteRgb.length < tableSize) paletteRgb.push([0, 0, 0]);

  const bytes = [];
  const push = (...vals) => bytes.push(...vals);
  const push16 = (v) => bytes.push(v & 0xff, (v >> 8) & 0xff);

  // Header
  for (const ch of 'GIF89a') bytes.push(ch.charCodeAt(0));

  // Logical Screen Descriptor
  push16(width);
  push16(height);
  push(0x80 | ((bitsNeeded - 1) << 4) | (bitsNeeded - 1)); // tabela global presente, mesma profundidade pra resolução de cor e tamanho da tabela
  push(0); // cor de fundo (índice)
  push(0); // pixel aspect ratio (quadrado)

  // Global Color Table
  for (const [r, g, b] of paletteRgb) push(r, g, b);

  // Netscape Application Extension — faz o GIF repetir para sempre em vez
  // de tocar uma única vez.
  push(0x21, 0xff, 0x0b);
  for (const ch of 'NETSCAPE2.0') bytes.push(ch.charCodeAt(0));
  push(0x03, 0x01, 0x00, 0x00, 0x00);

  for (const frame of frames) {
    const indices = quantizeFrame(frame, paletteRgb);

    // Graphic Control Extension (duração deste quadro)
    push(0x21, 0xf9, 0x04, 0x04); // disposal method 1 = "não descartar" (o próximo quadro pode ser desenhado direto por cima)
    push16(delayCs);
    push(0x00); // índice de cor transparente (não usado)
    push(0x00);

    // Image Descriptor
    push(0x2c);
    push16(0);
    push16(0);
    push16(width);
    push16(height);
    push(0x00); // sem tabela de cores local, sem entrelaçamento

    // Image Data
    push(bitsNeeded);
    const lzwBytes = lzwEncodeIndices(indices, bitsNeeded);
    bytes.push(...packSubBlocks(lzwBytes));
  }

  push(0x3b); // Trailer

  return new Blob([new Uint8Array(bytes)], { type: 'image/gif' });
}

// --- gravador periódico de quadros → GIF ---------------------------------
// A mesma rotina de captura estava triplicada em Espelho/Som/Gradiente
// (setInterval → drawImage do canvas de saída reduzido → getImageData →
// teto de duração). Aqui ela vira um único objeto que funciona com QUALQUER
// canvas de origem (HTMLCanvasElement OU OffscreenCanvas) — por isso não
// toca em `document` quando OffscreenCanvas existe: precisa rodar dentro de
// um Web Worker (ver render.worker.js de cada módulo), onde não há DOM.
//
// - `source()`: devolve o canvas de onde copiar cada quadro
// - `getSize()`: {width, height} do GIF NO MOMENTO em que a gravação começa —
//   guardado até o fim (trocar de formato no meio não mistura tamanhos)
// - `buildPalette(frames)`: até 256 cores hex — quem conhece o modo de cor
//   (o motor) decide se é uma lista fixa ou um scan dos quadros
// - `onCaptureEnd()`: chamado quando bate no teto de duração. Os quadros
//   ficam GUARDADOS até stop() — quem chamar depois ainda recebe o GIF
//   (antes, GIF que batia no teto era descartado sem aviso).
export function createGifRecorder({ source, getSize, fps, maxSeconds, buildPalette, onCaptureEnd }) {
  let canvas = null;
  let ctx = null;
  let timerId = null;
  let frames = null;
  let size = null;

  function ensureCanvas(width, height) {
    if (!canvas) {
      canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : document.createElement('canvas');
      ctx = canvas.getContext('2d', { willReadFrequently: true });
    }
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
  }

  function capture() {
    const { width, height } = size;
    ctx.drawImage(source(), 0, 0, width, height);
    frames.push(ctx.getImageData(0, 0, width, height).data);
    if (frames.length >= fps * maxSeconds) {
      stopCapture();
      onCaptureEnd?.();
    }
  }

  function stopCapture() {
    if (timerId != null) clearInterval(timerId);
    timerId = null;
  }

  function start() {
    if (timerId != null) return;
    size = getSize();
    ensureCanvas(size.width, size.height);
    frames = [];
    timerId = setInterval(capture, 1000 / fps);
  }

  // síncrono e pesado (quantização + LZW de todos os quadros) — quem chama
  // decide onde isso roda: no worker, quando o desenho já está lá, ou na
  // main thread no fallback (como sempre foi).
  function stop() {
    stopCapture();
    if (!frames || !frames.length) {
      frames = null;
      return null;
    }
    const blob = encodeGif({
      width: size.width,
      height: size.height,
      frames,
      palette: buildPalette(frames),
      delayCs: Math.round(100 / fps),
    });
    frames = null;
    return blob;
  }

  return {
    start,
    stop,
    stopCapture,
    isCapturing: () => timerId != null,
    destroy: stopCapture,
  };
}

// paleta por VARREDURA dos quadros (modos de cor contínua: gradiente, "cores
// do vídeo") — amostra 1 a cada ~7 pixels de 3 quadros (primeiro/meio/último),
// agrupa em baldes de 4 bits por canal e fica com os 250 mais frequentes,
// mais o fundo na frente. Antes esse mesmo bloco vivia copiado nos 3 motores.
export function scanFramesPalette(frames, background) {
  const buckets = new Map();
  const sampleFrames = [frames[0], frames[Math.floor(frames.length / 2)], frames[frames.length - 1]].filter(Boolean);
  for (const frame of sampleFrames) {
    for (let i = 0; i < frame.length; i += 4 * 7) {
      const key = `${frame[i] >> 4}-${frame[i + 1] >> 4}-${frame[i + 2] >> 4}`;
      buckets.set(key, (buckets.get(key) || 0) + 1);
    }
  }
  const toHex = (v) => v.toString(16).padStart(2, '0');
  const sorted = [...buckets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 250);
  const colors = sorted.map(([key]) => {
    const [r, g, b] = key.split('-').map((v) => Number(v) * 16 + 8);
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  });
  return [background, ...colors];
}
