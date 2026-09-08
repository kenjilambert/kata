import { createRng, randomSeed } from '../../core/seed.js';
import { encodeGif } from '../../core/gifEncoder.js';
import { framedGridDims } from '../grid-icons/generator.js';
import { drawVideoShape, VIDEO_SHAPES } from '../video-tiles/shapes.js';

// mesmo catálogo de desenho em Canvas 2D do Espelho (ver video-tiles/shapes.js
// — porta do catálogo de formas do Azulejo) — reaproveitado ao pé da letra,
// já que a técnica de desenhar "1 forma por célula, do tamanho que a célula
// manda" é idêntica aqui, só que quem manda no tamanho/cor não é mais um
// pixel de vídeo, é o valor do campo de gradiente animado (ver warpedPattern).

const GIF_MAX_DIM = 360;
const GIF_FPS = 12;
const GIF_MAX_SECONDS = 8;
const OUTPUT_MAX_DIM = 900;

function computeGrid(resolution, ratio) {
  return framedGridDims(resolution, ratio);
}

function computeOutputSize(cols, rows, maxDim) {
  if (cols >= rows) {
    return { width: maxDim, height: Math.max(1, Math.round((maxDim * rows) / cols)) };
  }
  return { width: Math.max(1, Math.round((maxDim * cols) / rows)), height: maxDim };
}

// hexToRgb/interpolateGradient — MESMA implementação de video-tiles/engine.js
// (não importada de lá de propósito: são só ~15 linhas, e duplicar aqui evita
// qualquer risco de mexer num arquivo do Espelho que já está validado/no ar).
function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function interpolateGradient(t, colors) {
  if (!colors.length) return '#000000';
  if (colors.length === 1) return colors[0].color;
  const clamped = Math.min(1, Math.max(0, t));
  const scaled = clamped * (colors.length - 1);
  const i = Math.min(colors.length - 2, Math.floor(scaled));
  const frac = scaled - i;
  const [r1, g1, b1] = hexToRgb(colors[i].color);
  const [r2, g2, b2] = hexToRgb(colors[i + 1].color);
  const r = Math.round(r1 + (r2 - r1) * frac);
  const g = Math.round(g1 + (g2 - g1) * frac);
  const b = Math.round(b1 + (b2 - b1) * frac);
  return `rgb(${r}, ${g}, ${b})`;
}

// --- campo de gradiente animado (ruído de valor com "domain warp") --------
// Mesma ideia por trás de ferramentas tipo playgrnd.tools/aura (estilo
// "Nuvens"): 4 oitavas de ruído de valor (bilinear sobre uma grade de
// hashes, bem mais barato que Perlin/simplex de verdade) somadas em fbm(),
// e o resultado empena (warp) a amostragem de outro fbm — 2 vezes seguidas
// (ver warpedPattern mais abaixo) — é o "domain warping" clássico que
// transforma ruído genérico em manchas orgânicas que fluem (efeito "lava
// lamp"/nuvem/mármore), em vez de faixas regulares e previsíveis. `seed`
// participa do hash pra cada composição sortear um campo diferente (mesmo
// espírito de createRng).
//
// IMPORTANTE (ruído 3D, não 2D): o tempo entra como uma 3ª coordenada de
// verdade do ruído (z), não como um deslocamento somado a x/y. A 1ª versão
// disso só somava um vetor de "arrasto" (tempo × direção) direto em x/y —
// ou seja, empurrava a MESMA textura inteira pro mesmo lado, rígida, sempre
// pra "um lugar pré-determinado" (foi exatamente o que ficou estranho:
// "indo numa mesma direção sem mudar"). Com z de verdade, cada região do
// campo evolui/morfa por conta própria (uma mancha pode crescer enquanto
// outra encolhe ou vira outra coisa do lado), que é o que dá o efeito de
// líquido/nuvem respirando, em vez de uma foto deslizando por cima de outra.
function hash3(ix, iy, iz, seed) {
  let h =
    Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(iz, 1274126177) + Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return ((h >>> 0) % 65536) / 65536;
}

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

// interpolação trilinear (8 cantos de um cubo, em vez dos 4 de um quadrado).
function valueNoise3D(x, y, z, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const sx = smoothstep(x - x0);
  const sy = smoothstep(y - y0);
  const sz = smoothstep(z - z0);
  const n000 = hash3(x0, y0, z0, seed);
  const n100 = hash3(x0 + 1, y0, z0, seed);
  const n010 = hash3(x0, y0 + 1, z0, seed);
  const n110 = hash3(x0 + 1, y0 + 1, z0, seed);
  const n001 = hash3(x0, y0, z0 + 1, seed);
  const n101 = hash3(x0 + 1, y0, z0 + 1, seed);
  const n011 = hash3(x0, y0 + 1, z0 + 1, seed);
  const n111 = hash3(x0 + 1, y0 + 1, z0 + 1, seed);
  const a0 = n000 + (n100 - n000) * sx;
  const b0 = n010 + (n110 - n010) * sx;
  const c0 = a0 + (b0 - a0) * sy;
  const a1 = n001 + (n101 - n001) * sx;
  const b1 = n011 + (n111 - n011) * sx;
  const c1 = a1 + (b1 - a1) * sy;
  return c0 + (c1 - c0) * sz;
}

function fbm(x, y, z, seed) {
  let sum = 0;
  let total = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < 4; i++) {
    sum += amp * valueNoise3D(x * freq, y * freq, z * freq, seed + i * 131);
    total += amp;
    amp *= 0.5;
    freq *= 2.03; // não exatamente 2x — evita as oitavas caírem em pontos
    // "alinhados" da anterior, que dava um leve padrão repetitivo visível.
  }
  return sum / total; // ~0..1
}

// "domain warp" ANINHADO (2 níveis) — mesma técnica clássica usada em
// shaders de fumaça/mármore (Inigo Quilez, "warp"): em vez de só deslocar a
// amostragem do ruído principal por UM campo auxiliar (o que ainda saía
// parecido com faixas/degradê, principalmente num domínio pequeno como o
// nosso — poucos "períodos" de ruído cabendo na grade), aqui o próprio
// campo de deslocamento (qx/qy) é RE-deslocado por um segundo par de ruídos
// (rx/ry) antes de amostrar o resultado final — cada nível de empeno soma
// dobras/redemoinhos por cima do anterior, e é isso que dá o efeito de
// líquido/nuvem fluindo (bem mais perto da referência) em vez de uma faixa
// diagonal "computada" e previsível. Cada camada usa um z levemente
// deslocado (não o mesmo z cru) — sem isso as 2 camadas de empeno
// evoluiriam perfeitamente em sincronia, meio "robótico" de novo.
function warpedPattern(x, y, z, warpAmt, seed) {
  const qx = fbm(x, y, z, seed + 11);
  const qy = fbm(x + 5.2, y + 1.3, z + 3.7, seed + 53);
  const rx = fbm(x + warpAmt * qx + 1.7, y + warpAmt * qy + 9.2, z + 2.3, seed + 97);
  const ry = fbm(x + warpAmt * qx + 8.3, y + warpAmt * qy + 2.8, z - 1.9, seed + 149);
  return fbm(x + warpAmt * rx, y + warpAmt * ry, z, seed + 191);
}

const CORNERS = ['tl', 'tr', 'br', 'bl'];

// motor da aba Gradiente: sem fonte nenhuma (nem vídeo nem webcam) — o
// "quadro" de cada célula vem inteiramente de warpedPattern(), avançando no
// tempo (arrastado na direção escolhida) a cada laço de animação. Mesmo
// formato de objeto devolvido do Espelho (setOptions/start/stop/gravação),
// pra reaproveitar o mesmo jeito de montar a UI (ver index.js).
export function createGradientTilesEngine(outputCanvas) {
  const ctx = outputCanvas.getContext('2d', { willReadFrequently: false });

  const gifCanvas = document.createElement('canvas');
  const gifCtx = gifCanvas.getContext('2d', { willReadFrequently: true });

  let rafId = null;
  let lastFrameTime = null;
  let time = 0; // acumulador avançado por options.speed — é o que "flui" o gradiente
  let paused = false;

  let cellAssignments = null;
  let cellAssignmentsKey = '';

  const options = {
    resolution: 40,
    ratio: 1,
    cols: 0,
    rows: 0,
    shapeScale: 1,
    // "tamanho das manchas": maior = manchas menores/mais numerosas (mais
    // frequência espacial), menor = manchas maiores.
    scale: 1,
    // 0-1: o quanto o ruído principal é empenado (ver warpedPattern) — 0 já
    // fica organicamente ondulado (tem um piso mínimo de empeno, ver
    // renderFrame), perto de 1 fica bem mais retorcido/líquido.
    turbulence: 0.5,
    direction: 135, // graus — pra onde o gradiente "flui"
    speed: 1, // 0 = parado (congelado no campo do instante), 3 = bem rápido
    colors: [], // paradas do gradiente, EM ORDEM (ver interpolateGradient)
    shapesAllowed: [],
    background: '#141210',
    seed: randomSeed(),
  };

  function rebuildCellShapesIfNeeded() {
    const pool = options.shapesAllowed.length ? options.shapesAllowed : VIDEO_SHAPES;
    const key = `${options.cols}x${options.rows}|${pool.join(',')}`;
    if (cellAssignments && cellAssignmentsKey === key) return;
    const rng = createRng(options.seed);
    cellAssignmentsKey = key;
    cellAssignments = Array.from({ length: options.cols * options.rows }, () => ({
      shapeKey: pool[Math.floor(rng() * pool.length)],
      orientation: CORNERS[Math.floor(rng() * CORNERS.length)],
    }));
  }

  function setOptions(partial) {
    Object.assign(options, partial);
    const { cols, rows } = computeGrid(options.resolution, options.ratio);
    options.cols = cols;
    options.rows = rows;
    const out = computeOutputSize(cols, rows, OUTPUT_MAX_DIM);
    outputCanvas.width = out.width;
    outputCanvas.height = out.height;
    const gifOut = computeOutputSize(cols, rows, GIF_MAX_DIM);
    gifCanvas.width = gifOut.width;
    gifCanvas.height = gifOut.height;
    rebuildCellShapesIfNeeded();
  }
  setOptions({});

  function renderFrame() {
    const { cols, rows } = options;
    const outW = outputCanvas.width;
    const outH = outputCanvas.height;

    ctx.fillStyle = options.background;
    ctx.fillRect(0, 0, outW, outH);

    const cellSize = outW / cols;
    rebuildCellShapesIfNeeded();

    // frequência espacial em unidades de CÉLULA (não normalizada por
    // cols/rows) — assim o tamanho físico das manchas fica igual não
    // importa o formato escolhido (mesma lógica de cellSize ser sempre
    // físico, não relativo, em todo o resto do app). scale=100% (padrão) dá
    // ~6 "períodos" de ruído cabendo na grade — domínio pequeno demais (era
    // o bug do visual "linear/faixa única" antes) faz o empeno quase não
    // variar de célula pra célula, então precisa de espaço o bastante pro
    // ruído auxiliar (qx/qy/rx/ry) também ter onde variar.
    const cellFreq = options.scale * 0.15;
    const angleRad = (options.direction * Math.PI) / 180;
    const dx = Math.cos(angleRad);
    const dy = Math.sin(angleRad);
    // piso de 0.5 — mesmo com Turbulência no mínimo (0%), ainda tem empeno
    // suficiente pra não cair de volta no visual "linear" que motivou essa
    // reescrita; 100% chega a ~2.3, bem retorcido/líquido.
    const warp = 0.5 + options.turbulence * 1.8;
    // z = tempo de verdade (ver comentário grandão em cima de hash3/fbm) —
    // é ISSO que faz o campo inteiro morfar/respirar (não só escorregar).
    // "Direção" ainda existe, mas só como um leve vento por cima (peso
    // reduzido, driftWeight) — sem ele dominar o efeito, senão volta a
    // parecer uma textura sendo arrastada rígida de novo.
    const z = time * 0.6;
    const driftWeight = 0.05;
    const driftX = dx * time * driftWeight;
    const driftY = dy * time * driftWeight;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const nx = c * cellFreq + driftX;
        const ny = r * cellFreq + driftY;
        const raw = warpedPattern(nx, ny, z, warp, options.seed);
        // realça o contraste (fbm de ruído de valor tende a ficar
        // concentrado perto de 0.5) — sem isso quase toda célula saía com
        // forma parecida, sem o "respiro" de vazio/cheio que dá o efeito
        // de dithering de verdade.
        const value = Math.min(1, Math.max(0, 0.5 + (raw - 0.5) * 1.9));

        const color = interpolateGradient(value, options.colors);
        const scale = value * options.shapeScale;

        const { shapeKey, orientation } = cellAssignments[r * cols + c];
        const cx = c * cellSize + cellSize / 2;
        const cy = r * cellSize + cellSize / 2;
        drawVideoShape(ctx, shapeKey, orientation, cx, cy, cellSize, scale, color);
      }
    }
  }

  // teto de quadros pro RECÁLCULO do campo (não pro desenho em si) — o
  // campo de ruído (fbm aninhado, 4 oitavas × 5 amostras por célula, ver
  // warpedPattern) é caro o bastante pra, rodando a 60fps de verdade (o
  // que requestAnimationFrame faria sem essa trava), pesar na aba inteira
  // do navegador (mouse com atraso perceptível reportado com a aba
  // Gradiente aberta) — um gradiente que flui devagar nem precisa de
  // 60fps pra parecer suave; 24 já fica indistinguível a olho nu e corta
  // ~60% do trabalho.
  const RENDER_MIN_DT = 1 / 24;

  function loop(now) {
    if (lastFrameTime == null) lastFrameTime = now;
    const dt = Math.min(0.1, (now - lastFrameTime) / 1000); // trava dt (aba em segundo plano etc.)
    if (dt >= RENDER_MIN_DT) {
      lastFrameTime = now;
      if (!paused) {
        time += dt * options.speed;
        renderFrame();
      }
    }
    rafId = requestAnimationFrame(loop);
  }

  function start() {
    stop();
    renderFrame();
    lastFrameTime = null;
    rafId = requestAnimationFrame(loop);
  }

  function stop() {
    if (rafId != null) cancelAnimationFrame(rafId);
    rafId = null;
  }

  // --- gravação em vídeo ------------------------------------------------
  // MediaRecorder sobre canvas.captureStream() — tenta MP4 (H.264) primeiro
  // quando o navegador sabe codificar isso direto (Safari sempre soube;
  // Chrome/Edge mais recentes também, via codec avc1), caindo pra WebM nos
  // navegadores que só sabem gravar isso (Firefox e Chrome mais antigos).
  // O nome do arquivo baixado (ver index.js) usa a extensão certa conforme
  // o mimeType que REALMENTE foi usado, não um fixo.
  let recorder = null;
  let recordedChunks = [];

  function pickMimeType() {
    const candidates = [
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'video/mp4;codecs=avc1',
      'video/mp4',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
    ];
    return candidates.find((type) => window.MediaRecorder?.isTypeSupported?.(type)) || 'video/webm';
  }

  function isRecording() {
    return recorder?.state === 'recording';
  }

  function startRecording() {
    if (isRecording()) return;
    const stream = outputCanvas.captureStream(30);
    recordedChunks = [];
    const mimeType = pickMimeType();
    recorder = new MediaRecorder(stream, { mimeType });
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunks.push(e.data);
    };
    recorder.start();
  }

  function stopRecording() {
    return new Promise((resolve) => {
      if (!recorder || recorder.state === 'inactive') {
        resolve(null);
        return;
      }
      const mimeType = recorder.mimeType || 'video/webm';
      recorder.onstop = () => resolve({ blob: new Blob(recordedChunks, { type: mimeType }), mimeType });
      recorder.stop();
    });
  }

  // --- gravação em GIF ----------------------------------------------------
  let gifTimerId = null;
  let gifFrames = null;
  let gifRecordingSize = null;

  function captureGifFrame() {
    const { width, height } = gifRecordingSize;
    gifCtx.drawImage(outputCanvas, 0, 0, width, height);
    gifFrames.push(gifCtx.getImageData(0, 0, width, height).data);
    if (gifFrames.length >= GIF_FPS * GIF_MAX_SECONDS) stopGifRecording();
  }

  function isGifRecording() {
    return gifTimerId != null;
  }

  function startGifRecording() {
    if (isGifRecording()) return;
    gifFrames = [];
    gifRecordingSize = { width: gifCanvas.width, height: gifCanvas.height };
    gifTimerId = setInterval(captureGifFrame, 1000 / GIF_FPS);
  }

  // paleta do GIF: o gradiente é uma faixa CONTÍNUA de cores (interpolação),
  // então escaneia uma amostra dos quadros capturados pra montar a paleta —
  // mesma técnica do modo "gradiente"/"cores do vídeo" do Espelho.
  function buildGifPalette() {
    const buckets = new Map();
    const sampleFrames = [gifFrames[0], gifFrames[Math.floor(gifFrames.length / 2)], gifFrames[gifFrames.length - 1]].filter(Boolean);
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
    return [options.background, ...colors];
  }

  function stopGifRecording() {
    if (!isGifRecording()) return Promise.resolve(null);
    clearInterval(gifTimerId);
    gifTimerId = null;
    if (!gifFrames.length) return Promise.resolve(null);
    const palette = buildGifPalette();
    const { width, height } = gifRecordingSize;
    const blob = encodeGif({ width, height, frames: gifFrames, palette, delayCs: Math.round(100 / GIF_FPS) });
    gifFrames = null;
    return Promise.resolve(blob);
  }

  function destroy() {
    stop();
    if (isRecording()) recorder.stop();
    if (isGifRecording()) clearInterval(gifTimerId);
  }

  return {
    setOptions,
    start,
    stop,
    setPaused: (value) => {
      paused = value;
      if (!paused) lastFrameTime = null; // evita um "salto" de dt gigante ao retomar
    },
    isPaused: () => paused,
    startRecording,
    stopRecording,
    isRecording,
    startGifRecording,
    stopGifRecording,
    isGifRecording,
    renderFrame,
    destroy,
    getCanvas: () => outputCanvas,
    getGridSize: () => ({ cols: options.cols, rows: options.rows }),
  };
}
