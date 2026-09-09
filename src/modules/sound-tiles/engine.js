// Motor do modo Som: MESMA lógica de desenho do Espelho (video-tiles/engine.js
// — forma fixa por célula, tamanho/cor reagindo a um valor 0-1 por célula,
// GIF/vídeo gravados do próprio canvas de saída) só que a fonte do valor por
// célula não é luminância de um quadro de vídeo — é a MAGNITUDE de uma faixa
// de frequência do áudio (Web Audio API AnalyserNode).
//
// NÃO é um espectrograma rolando o histórico (1ª versão, corrigida) — é um
// espectrômetro PARADO, tipo equalizador de rádio/hi-fi: cada banda de
// frequência tem uma posição FIXA na grade (uma "barra"), e só a ALTURA
// dessa barra reage ao som agora, subindo/descendo no lugar — igual a
// qualquer visualizador de áudio clássico (ver referência mandada na
// conversa). "Ataque rápido, decaimento lento" (attack/release, ver
// ATTACK/RELEASE abaixo) é o que dá aquele movimento "vivo" — sem isso a
// barra pisca crua a cada quadro em vez de subir na hora e descer suave.
import { createRng, randomSeed } from '../../core/seed.js';
import { nearestPaletteColor } from '../../core/imageSampling.js';
import { encodeGif } from '../../core/gifEncoder.js';
import { framedGridDims } from '../grid-icons/generator.js';
import { drawVideoShape, VIDEO_SHAPES } from '../video-tiles/shapes.js';

const GIF_MAX_DIM = 360;
const GIF_FPS = 12;
const GIF_MAX_SECONDS = 8;
const OUTPUT_MAX_DIM = 900;

// teto/piso do lado maior do canvas de saída no formato "Tela cheia" (ver
// gradient-tiles/engine.js, mesma função) — a caixa medida na tela pode ser
// bem maior ou menor que OUTPUT_MAX_DIM, mas sem deixar o canvas virar
// gigante (custo de redesenhar cresce com a área) nem minúsculo demais.
function clampOutputDim(requested) {
  if (!requested) return OUTPUT_MAX_DIM;
  return Math.max(480, Math.min(1400, Math.round(requested)));
}
// teto de quadros/s do próprio DESENHO (não da análise de áudio, que
// acompanha o hardware) — rAF livre roda a 60fps sem necessidade nenhuma
// pra esse efeito (o ouvido/olho não percebe diferença acima disso), e
// cada quadro a menos é uma grade cols×rows inteira a menos pra redesenhar.
const RENDER_MIN_DT = 1000 / 30;

function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// idêntica à do Espelho (video-tiles/engine.js) — duplicada de propósito,
// não importada: cada motor é autocontido (mesma convenção já usada entre
// Espelho/Gradiente), evita um acoplamento cruzado só por causa de uma
// função pequena.
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

function computeOutputSize(cols, rows, maxDim) {
  if (cols >= rows) {
    return { width: maxDim, height: Math.max(1, Math.round((maxDim * rows) / cols)) };
  }
  return { width: Math.max(1, Math.round((maxDim * cols) / rows)), height: maxDim };
}

const CORNERS = ['tl', 'tr', 'br', 'bl'];

// idêntico em espírito ao remapSampleCoord do Espelho (video-tiles/engine.js)
// — só mirror-h/mirror-full aqui (sem 'rotational': um eixo é frequência e
// o outro é altura da barra, então girar 90° trocaria banda por altura, o
// que não faz sentido nenhum pro efeito). "mirror-h" aqui é o clássico
// visualizador simétrico (grave no centro, agudo pras 2 pontas, ou o
// inverso) — espelha de onde vem a ALTURA da barra, não a forma/orientação
// da célula (essas continuam fixas, ver rebuildCellShapesIfNeeded).
function remapGridCoord(r, c, cols, rows, symmetry) {
  if (symmetry === 'none') return [r, c];
  const hc = Math.floor(cols / 2);
  const hr = Math.floor(rows / 2);
  if (symmetry === 'mirror-h') return [r, c < hc ? c : cols - 1 - c];
  if (symmetry === 'mirror-full') return [r < hr ? r : rows - 1 - r, c < hc ? c : cols - 1 - c];
  return [r, c];
}

export function createSoundTilesEngine(outputCanvas) {
  const ctx = outputCanvas.getContext('2d', { willReadFrequently: false });

  const gifCanvas = document.createElement('canvas');
  const gifCtx = gifCanvas.getContext('2d', { willReadFrequently: true });

  // <audio> nunca aparece no DOM visível — só toca o arquivo enviado (o
  // microfone não passa por aqui, ver enableMic). Ao contrário do <video>
  // do Espelho, este FICA COM SOM (muted=false) — a pessoa quer ouvir o
  // que está vendo transformado em padrão.
  const audio = document.createElement('audio');
  audio.loop = true;
  audio.muted = false;

  let audioCtx = null;
  let analyser = null;
  let fileSourceNode = null; // criado 1x só pro elemento <audio> (a API não deixa criar 2x pro mesmo elemento)
  let micSourceNode = null;
  let micStream = null;
  let sourceUrl = null;
  let activeSource = null; // 'file' | 'mic' | null

  let rafId = null;
  let paused = false;
  let lastRenderAt = 0;

  let cellAssignments = null;
  let cellAssignmentsKey = '';

  // nível ATUAL (já suavizado) de cada barra — uma posição fixa por banda de
  // frequência, redimensionado sempre que o número de barras muda (ver
  // setOptions/bandCount). Isso é o que fica "no mesmo lugar reagindo ao
  // som" — nunca é substituído inteiro a cada quadro, só empurrado na
  // direção do valor novo (ver applyAttackRelease).
  let levels = null;

  // sobe quase instantâneo (o pico do som já aparece no quadro seguinte),
  // desce devagar (senão a barra "pisca" a cada quadro em vez de balançar
  // suave) — o comportamento clássico de qualquer equalizador/VU-meter.
  const ATTACK = 0.6;
  const RELEASE = 0.12;

  const options = {
    resolution: 32,
    ratio: 1,
    cols: 0,
    rows: 0,
    shapeScale: 1,
    colorMode: 'palette', // 'grayscale' | 'palette' | 'custom' | 'gradient'
    inkColor: '#f5efe4',
    background: '#141210',
    invert: false,
    paletteColors: [],
    customPaletteColors: [],
    gradientColors: [],
    shapesAllowed: [],
    seed: randomSeed(),
    trail: 0,
    symmetry: 'none',
    // eixo das barras — 'vertical' (barra clássica, sobe do rodapé; banda de
    // frequência = COLUNA) ou 'horizontal' (barra deitada, cresce da
    // esquerda; banda de frequência = LINHA).
    barsAxis: 'vertical',
    sensitivity: 1.4, // ganho aplicado à magnitude lida (o microfone costuma vir baixo)
    smoothing: 0.75, // repassado direto pro AnalyserNode.smoothingTimeConstant
    // alcance do gradiente base→ponta DENTRO da própria barra (ver
    // renderFrame) — 0 = toda célula acesa fica na cor da base (sem
    // variação nenhuma); 1 = a ponta da barra chega no fim total do
    // gradiente (0), mesmo numa barra curta.
    colorResponse: 0.6,
    // opcional: só o formato "Tela cheia" passa um valor (calculado a
    // partir da caixa medida na tela, ver index.js/computeFullBox) — os
    // outros formatos deixam null e caem no OUTPUT_MAX_DIM fixo de sempre.
    maxDim: null,
  };

  function bandCount() {
    return options.barsAxis === 'vertical' ? options.cols : options.rows;
  }
  function heightCount() {
    return options.barsAxis === 'vertical' ? options.rows : options.cols;
  }

  function rebuildLevels() {
    levels = new Float32Array(bandCount());
  }

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
    const prevBandCount = levels?.length ?? -1;
    Object.assign(options, partial);
    const { cols, rows } = framedGridDims(options.resolution, options.ratio);
    options.cols = cols;
    options.rows = rows;
    const out = computeOutputSize(cols, rows, clampOutputDim(options.maxDim));
    outputCanvas.width = out.width;
    outputCanvas.height = out.height;
    const gifOut = computeOutputSize(cols, rows, GIF_MAX_DIM);
    gifCanvas.width = gifOut.width;
    gifCanvas.height = gifOut.height;
    if (bandCount() !== prevBandCount) rebuildLevels();
    if (analyser) analyser.smoothingTimeConstant = Math.min(0.95, Math.max(0, options.smoothing));
    rebuildCellShapesIfNeeded();
  }
  setOptions({});

  // --- fonte de áudio ---------------------------------------------------
  // AudioContext só pode ser criado/retomado depois de um gesto do usuário
  // (clicar em "Enviar áudio" ou "Microfone" conta) — por isso é criado sob
  // demanda aqui, nunca no topo do módulo.
  function ensureAudioGraph() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = Math.min(0.95, Math.max(0, options.smoothing));
  }

  function disconnectMic() {
    if (micSourceNode) {
      micSourceNode.disconnect();
      micSourceNode = null;
    }
    if (micStream) {
      micStream.getTracks().forEach((t) => t.stop());
      micStream = null;
    }
  }

  function clearSource() {
    disconnectMic();
    audio.pause();
    if (sourceUrl) {
      URL.revokeObjectURL(sourceUrl);
      sourceUrl = null;
    }
    activeSource = null;
  }

  function loadFile(file) {
    ensureAudioGraph();
    disconnectMic();
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    sourceUrl = URL.createObjectURL(file);
    audio.src = sourceUrl;
    // só pode ser criado UMA VEZ pro mesmo elemento <audio> — reaproveitado
    // entre arquivos diferentes (trocar audio.src não invalida o node já
    // criado, ele continua captando o que quer que esteja tocando agora).
    if (!fileSourceNode) {
      fileSourceNode = audioCtx.createMediaElementSource(audio);
      fileSourceNode.connect(analyser);
      fileSourceNode.connect(audioCtx.destination); // continua audível — diferente do Espelho, aqui o som importa
    }
    activeSource = 'file';
    return audio.play().then(() => audioCtx.resume());
  }

  async function enableMic() {
    ensureAudioGraph();
    clearSource();
    // erro (permissão negada, sem microfone...) é responsabilidade de quem
    // chamou tratar — mesma decisão do enableWebcam do Espelho.
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    micSourceNode = audioCtx.createMediaStreamSource(micStream);
    // NUNCA conectado a audioCtx.destination — ligar o microfone direto na
    // saída criaria um eco/feedback imediato (a pessoa ouvindo a própria
    // voz com um delay). Só alimenta o analisador.
    micSourceNode.connect(analyser);
    activeSource = 'mic';
    await audioCtx.resume();
  }

  function stopMic() {
    if (activeSource !== 'mic') return;
    disconnectMic();
    activeSource = null;
  }

  function hasSource() {
    return activeSource === 'file' || activeSource === 'mic';
  }
  function isMicActive() {
    return activeSource === 'mic';
  }
  function isFilePlaying() {
    return activeSource === 'file' && !audio.paused;
  }
  function toggleFilePlayback() {
    if (activeSource !== 'file') return;
    if (audio.paused) audio.play();
    else audio.pause();
  }

  // --- amostragem do áudio -----------------------------------------------
  // agrupa os N bins crus do FFT em `bands` faixas em escala LOGARÍTMICA
  // (não linear) — um agrupamento linear jogaria quase toda energia grave
  // nas primeiras faixas (é assim que áudio real se comporta: a maior
  // parte da energia perceptível mora nas oitavas graves/médias), deixando
  // o padrão inteiro reagindo só numa pontinha da grade. Log espalha oitavas
  // de forma mais parecida com como o ouvido percebe frequência.
  let freqData = null;
  function sampleBands(bands) {
    const n = analyser.frequencyBinCount;
    if (!freqData || freqData.length !== n) freqData = new Uint8Array(n);
    analyser.getByteFrequencyData(freqData);
    const out = new Float32Array(bands);
    for (let b = 0; b < bands; b++) {
      const lo = Math.floor(Math.pow(n, b / bands));
      const hi = Math.max(lo + 1, Math.floor(Math.pow(n, (b + 1) / bands)));
      let sum = 0;
      let count = 0;
      for (let i = lo; i < Math.min(hi, n); i++) {
        sum += freqData[i];
        count++;
      }
      const avg = count ? sum / count / 255 : 0;
      out[b] = Math.min(1, avg * options.sensitivity);
    }
    return out;
  }

  // sobe rápido/desce devagar em direção ao valor novo — ver ATTACK/RELEASE.
  function applyAttackRelease(rawValues) {
    for (let b = 0; b < levels.length; b++) {
      const rate = rawValues[b] > levels[b] ? ATTACK : RELEASE;
      levels[b] += (rawValues[b] - levels[b]) * rate;
    }
  }

  function renderFrame(timestamp) {
    if (!hasSource()) return;
    if (timestamp && timestamp - lastRenderAt < RENDER_MIN_DT) return;
    lastRenderAt = timestamp || 0;

    applyAttackRelease(sampleBands(bandCount()));

    const { cols, rows } = options;
    const outW = outputCanvas.width;
    const outH = outputCanvas.height;

    ctx.globalAlpha = 1 - Math.min(0.95, Math.max(0, options.trail));
    ctx.fillStyle = options.background;
    ctx.fillRect(0, 0, outW, outH);
    ctx.globalAlpha = 1;

    const cellSize = outW / cols;
    const hCount = heightCount();
    rebuildCellShapesIfNeeded();

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        // mapeia (linha,coluna) da grade pra (banda,altura-dentro-da-barra),
        // conforme o eixo escolhido — depois de aplicar a simetria (espelha
        // de ONDE lê a barra, não a célula em si).
        const [sr, sc] = remapGridCoord(r, c, cols, rows, options.symmetry);
        const band = options.barsAxis === 'vertical' ? sc : sr;
        // posição dentro da barra, 0 = base (rodapé/esquerda) subindo —
        // 'vertical': a LINHA 0 é o topo da grade, mas a barra cresce do
        // RODAPÉ, então inverte (rows-1-linha); 'horizontal': a barra
        // cresce da ESQUERDA, então a própria coluna já é a posição.
        const heightIndex = options.barsAxis === 'vertical' ? rows - 1 - sr : sc;
        const level = levels[band]; // 0-1, já suavizado

        // célula "acesa" (dentro da altura ATUAL da barra) ou não. A cor
        // segue a MESMA lógica de sempre — um gradiente da base (1) até a
        // ponta da barra — só que agora normalizado pela altura ATUAL da
        // barra (barHeight), não pela altura máxima da grade (hCount) como
        // antes. Essa era a "sensibilidade zuada": uma barra curta (som
        // baixo) media a posição contra o teto INTEIRO da grade, então toda
        // célula acesa caía sempre pertinho de 1 — só uma barra quase no
        // talo alcançava esticar até o fim do gradiente. Agora TODA barra,
        // curta ou alta, percorre o gradiente inteiro na sua própria
        // altura — o quanto disso realmente aparece (`colorResponse`) é o
        // slider "Resposta das cores".
        const barHeight = Math.max(1, Math.round(level * hCount));
        const filled = heightIndex < barHeight;
        const value = filled ? Math.max(0, 1 - (heightIndex / barHeight) * options.colorResponse) : 0;

        const base = options.invert ? 1 - value : value;
        const scale = options.colorMode === 'gradient' ? options.shapeScale : base * options.shapeScale;

        let color;
        if (options.colorMode === 'gradient') {
          color = interpolateGradient(base, options.gradientColors);
        } else if (options.colorMode === 'palette' && options.paletteColors.length) {
          color = nearestPaletteColor({ r: Math.round(value * 255), g: Math.round(value * 255), b: Math.round(value * 255) }, options.paletteColors);
        } else if (options.colorMode === 'custom' && options.customPaletteColors.length) {
          color = nearestPaletteColor({ r: Math.round(value * 255), g: Math.round(value * 255), b: Math.round(value * 255) }, options.customPaletteColors);
        } else {
          color = options.inkColor;
        }

        const { shapeKey, orientation } = cellAssignments[r * cols + c];
        const cx = c * cellSize + cellSize / 2;
        const cy = r * cellSize + cellSize / 2;
        drawVideoShape(ctx, shapeKey, orientation, cx, cy, cellSize, scale, color);
      }
    }
  }

  function loop(timestamp) {
    if (!paused) renderFrame(timestamp);
    rafId = requestAnimationFrame(loop);
  }

  function start() {
    stop();
    loop();
  }
  function stop() {
    if (rafId != null) cancelAnimationFrame(rafId);
    rafId = null;
  }

  // --- gravação (idêntico ao Espelho — opera só sobre o canvas de saída,
  // não sabe nem precisa saber que a fonte agora é áudio) ----------------
  let recorder = null;
  let recordedChunks = [];

  function pickMimeType() {
    const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    return candidates.find((type) => window.MediaRecorder?.isTypeSupported?.(type)) || 'video/webm';
  }
  function isRecording() {
    return recorder?.state === 'recording';
  }
  function startRecording() {
    if (isRecording()) return;
    const stream = outputCanvas.captureStream(30);
    recordedChunks = [];
    recorder = new MediaRecorder(stream, { mimeType: pickMimeType() });
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
      recorder.onstop = () => resolve(new Blob(recordedChunks, { type: 'video/webm' }));
      recorder.stop();
    });
  }

  let gifTimerId = null;
  let gifFrames = null;
  let gifRecordingSize = null;

  function captureGifFrame() {
    const { width, height } = gifRecordingSize;
    gifCtx.drawImage(outputCanvas, 0, 0, width, height);
    gifFrames.push(gifCtx.getImageData(0, 0, width, height).data);
    if (gifFrames.length >= GIF_FPS * GIF_MAX_SECONDS) stopGifCapture();
  }
  function stopGifCapture() {
    if (gifTimerId != null) clearInterval(gifTimerId);
    gifTimerId = null;
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
  function buildGifPalette() {
    if (options.colorMode === 'gradient') {
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
    if (options.colorMode === 'palette' && options.paletteColors.length) {
      return [options.background, ...options.paletteColors.map((c) => c.color)];
    }
    if (options.colorMode === 'custom' && options.customPaletteColors.length) {
      return [options.background, ...options.customPaletteColors.map((c) => c.color)];
    }
    return [options.background, options.inkColor];
  }
  function stopGifRecording() {
    stopGifCapture();
    if (!gifFrames || !gifFrames.length) {
      gifFrames = null;
      return Promise.resolve(null);
    }
    const palette = buildGifPalette();
    const { width, height } = gifRecordingSize;
    const blob = encodeGif({ width, height, frames: gifFrames, palette, delayCs: Math.round(100 / GIF_FPS) });
    gifFrames = null;
    return Promise.resolve(blob);
  }

  function destroy() {
    stop();
    clearSource();
    if (isRecording()) recorder.stop();
    stopGifCapture();
    if (audioCtx) {
      audioCtx.close().catch(() => {});
      audioCtx = null;
      analyser = null;
      fileSourceNode = null;
    }
  }

  return {
    setOptions,
    loadFile,
    enableMic,
    stopMic,
    isMicActive,
    hasSource,
    isFilePlaying,
    toggleFilePlayback,
    setPaused: (value) => { paused = value; },
    isPaused: () => paused,
    start,
    stop,
    startRecording,
    stopRecording,
    isRecording,
    startGifRecording,
    stopGifRecording,
    isGifRecording,
    destroy,
    getCanvas: () => outputCanvas,
    getGridSize: () => ({ cols: options.cols, rows: options.rows }),
  };
}
