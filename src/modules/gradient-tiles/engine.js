import { randomSeed } from '../../core/seed.js';
import { framedGridDims } from '../grid-icons/generator.js';
import { canUseOffscreenWorker, connectOffscreenWorker, createDeferredBackend, watchVisibility } from '../video-tiles/offscreen.js';
import { clampOutputDim, computeOutputSize, GIF_MAX_DIM } from './draw.js';
import { createGradientRuntime } from './runtime.js';

// Motor da aba Gradiente: sem fonte nenhuma (nem vídeo nem webcam) — o
// "quadro" de cada célula vem inteiramente do campo de ruído animado (ver
// draw.js/warpedPattern). Mesmo formato de objeto devolvido do Espelho
// (setOptions/start/stop/gravação), pra reaproveitar o mesmo jeito de montar
// a UI (ver index.js).
//
// Onde o desenho roda (decidido uma vez, na criação):
//   - Web Worker + OffscreenCanvas, quando o navegador suporta — o laço, o
//     ruído, a rasterização das formas E a codificação do GIF saem da main
//     thread, que fica só com a UI. É o caminho normal em Chrome/Edge/Firefox
//     /Safari recentes.
//   - fallback na main thread (como sempre foi), quando falta OffscreenCanvas
//     /transferControlToOffscreen/Worker, ou pra depuração com
//     localStorage.KATA_FORCE_MAIN_THREAD = '1' (ver offscreen.js).
// Os dois caminhos rodam o MESMO runtime.js/draw.js — o que muda é só se as
// chamadas viram postMessage ou chamadas diretas (ver os createXBackend
// abaixo). A API pública deste objeto é idêntica nos dois casos.
export function createGradientTilesEngine(outputCanvas) {
  const options = {
    resolution: 40,
    ratio: 1,
    // lado maior do canvas de saída; vazio = OUTPUT_MAX_DIM (ver clampOutputDim)
    maxDim: null,
    cols: 0,
    rows: 0,
    shapeScale: 1,
    // "tamanho das manchas": maior = manchas menores/mais numerosas (mais
    // frequência espacial), menor = manchas maiores.
    scale: 1,
    // 0-1: o quanto o ruído principal é empenado (ver warpedPattern) — 0 já
    // fica organicamente ondulado (tem um piso mínimo de empeno, ver
    // draw.js), perto de 1 fica bem mais retorcido/líquido.
    turbulence: 0.5,
    direction: 135, // graus — pra onde o gradiente "flui"
    speed: 1, // 0 = parado (congelado no campo do instante), 3 = bem rápido
    colors: [], // paradas do gradiente, EM ORDEM (ver interpolateGradient)
    shapesAllowed: [],
    background: '#141210',
    seed: randomSeed(),
  };

  let paused = false;

  // --- backend: worker ou main thread -------------------------------------
  // Interface interna igual nos dois: setOptions(snapshot, size), start,
  // stop, renderFrame, setPaused, setVisible, startGif, stopGif() → Blob|null,
  // destroy. isGifRecording fica AQUI (síncrono na API pública; no worker o
  // estado real mora do outro lado): vira true no startGif, false quando a
  // gente manda parar OU quando o runtime avisa que bateu no teto de duração.
  let gifRecording = false;
  const onGifCaptureEnd = () => {
    gifRecording = false;
  };

  function createWorkerBackend(link) {
    link.on('gif-capture-ended', onGifCaptureEnd);
    return {
      setOptions: (snapshot, size) => {
        // o worker desenha no OffscreenCanvas DELE e manda bitmaps; o canvas
        // da página (contexto bitmaprenderer, ver offscreen.js) precisa ter o
        // mesmo tamanho pra captureStream/toBlob e o layout ficarem certos.
        if (outputCanvas.width !== size.width) outputCanvas.width = size.width;
        if (outputCanvas.height !== size.height) outputCanvas.height = size.height;
        link.post({ type: 'options', options: snapshot, size });
      },
      start: () => link.post({ type: 'start' }),
      stop: () => link.post({ type: 'stop' }),
      renderFrame: () => link.post({ type: 'frame' }),
      setPaused: (value) => link.post({ type: 'paused', value }),
      setVisible: (value) => link.post({ type: 'visible', value }),
      startGif: () => link.post({ type: 'gif-start' }),
      stopGif: () => link.request({ type: 'gif-stop' }, 'gif-blob').then((reply) => reply.blob),
      destroy: () => link.destroy(),
    };
  }

  function createMainThreadBackend() {
    return createGradientRuntime(outputCanvas, { onGifCaptureEnd });
  }

  // o handshake com o worker é assíncrono (ver connectOffscreenWorker) e a
  // UI chama setOptions/start logo depois de criar o motor — por isso o
  // backend começa "adiado": enfileira e repassa quando o real existir.
  const backend = createDeferredBackend(['setOptions', 'start', 'stop', 'renderFrame', 'setPaused', 'setVisible', 'startGif', 'stopGif', 'destroy']);
  if (canUseOffscreenWorker()) {
    connectOffscreenWorker(new URL('./render.worker.js', import.meta.url), outputCanvas).then((link) => {
      backend.resolveWith(link ? createWorkerBackend(link) : createMainThreadBackend());
    });
  } else {
    backend.resolveWith(createMainThreadBackend());
  }
  const stopWatchingVisibility = watchVisibility(backend.setVisible);

  function setOptions(partial) {
    Object.assign(options, partial);
    const { cols, rows } = framedGridDims(options.resolution, options.ratio);
    options.cols = cols;
    options.rows = rows;
    // maxDim é opcional: o formato "Tela cheia" passa um valor calculado a
    // partir do tamanho real da caixa na tela (ver computeFullBox em
    // index.js), pra forma não sair borrada de tanto ser esticada por CSS
    // num monitor grande. Os formatos fixos seguem no padrão.
    const out = computeOutputSize(cols, rows, clampOutputDim(options.maxDim));
    const gifOut = computeOutputSize(cols, rows, GIF_MAX_DIM);
    // snapshot raso: no worker vira uma cópia estrutural de qualquer jeito;
    // no fallback o pintor só lê. Quem dimensiona o canvas é o runtime (no
    // modo worker o <canvas> daqui nem aceita mais width/height).
    backend.setOptions({ ...options }, { width: out.width, height: out.height, gifWidth: gifOut.width, gifHeight: gifOut.height });
  }
  setOptions({});

  // --- gravação em vídeo ------------------------------------------------
  // MediaRecorder sobre canvas.captureStream() — tenta MP4 (H.264) primeiro
  // quando o navegador sabe codificar isso direto (Safari sempre soube;
  // Chrome/Edge mais recentes também, via codec avc1), caindo pra WebM nos
  // navegadores que só sabem gravar isso (Firefox e Chrome mais antigos).
  // O nome do arquivo baixado (ver index.js) usa a extensão certa conforme
  // o mimeType que REALMENTE foi usado, não um fixo. Fica na main thread
  // nos dois modos: captureStream é do <canvas> da página — que no modo
  // worker recebe cada quadro via bitmaprenderer (ver offscreen.js) e
  // continua sendo um canvas normal pra gravação e pro "Baixar quadro".
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

  function destroy() {
    backend.stop();
    if (isRecording()) recorder.stop();
    stopWatchingVisibility();
    backend.destroy(); // no modo worker: terminate()
  }

  return {
    setOptions,
    start: backend.start,
    stop: backend.stop,
    setPaused: (value) => {
      paused = value;
      backend.setPaused(value);
    },
    isPaused: () => paused,
    startRecording,
    stopRecording,
    isRecording,
    startGifRecording: () => {
      if (gifRecording) return;
      gifRecording = true;
      backend.startGif();
    },
    // Promise<Blob|null> nos dois modos (no worker, o Blob já vem codificado
    // de lá; no fallback, codifica aqui como sempre)
    stopGifRecording: () => {
      gifRecording = false;
      return backend.stopGif();
    },
    isGifRecording: () => gifRecording,
    renderFrame: backend.renderFrame,
    destroy,
    getCanvas: () => outputCanvas,
    getGridSize: () => ({ cols: options.cols, rows: options.rows }),
  };
}
