// "Runtime" do Gradiente: tudo que roda a cada quadro (laço, acumulador de
// tempo, pausa, captura de GIF) em cima de UM canvas — sem saber se esse
// canvas é o <canvas> da página (fallback na main thread) ou um
// OffscreenCanvas dentro de um Web Worker. É importado pelos dois lados:
//
//   engine.js (fallback)  ──▶ createGradientRuntime(canvasDaPagina)
//   render.worker.js      ──▶ createGradientRuntime(offscreenCanvas, { present })
//
// `present(canvas)` é chamado depois de cada quadro pintado — no worker é
// quem manda o ImageBitmap pra tela (ver createBitmapPresenter em
// offscreen.js); no fallback não existe, o canvas JÁ É a tela.
//
// O que NÃO mora aqui, de propósito, é o que só existe na main thread:
// framedGridDims/tamanho do canvas de saída (o engine calcula e passa
// pronto em setOptions), MediaRecorder (captureStream do <canvas> da
// página) e document.visibilityState (o engine escuta e avisa via
// setVisible).
import { createGifRecorder, scanFramesPalette } from '../../core/gifEncoder.js';
import { createGradientPainter, GIF_FPS, GIF_MAX_SECONDS, RENDER_MIN_DT } from './draw.js';

// Na main thread o laço é o requestAnimationFrame de sempre (pausa sozinho
// em aba oculta, alinha com o refresh). Num worker, rAF até existe, mas —
// observado no Chrome 152 — só cicla quando o worker tem um canvas
// placeholder associado (transferControlToOffscreen), que aqui não temos
// (ver offscreen.js pro porquê); sem isso ele dispara UMA vez e para. Então
// no worker o laço é um setTimeout no ritmo de RENDER_MIN_DT — dá o mesmo
// resultado, já que o laço se limita a 24fps de qualquer jeito.
const inWorker = typeof document === 'undefined';
const scheduleFrame = inWorker
  ? (fn) => setTimeout(() => fn(performance.now()), RENDER_MIN_DT * 1000)
  : (fn) => requestAnimationFrame(fn);
const cancelFrame = inWorker ? clearTimeout : cancelAnimationFrame;

export function createGradientRuntime(canvas, { onGifCaptureEnd, present } = {}) {
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  const painter = createGradientPainter();

  let options = null; // snapshot vindo do engine (ver setOptions)
  let gifSize = { width: 1, height: 1 };
  let frameId = null;
  let running = false; // start() foi chamado e stop() ainda não
  let visible = true; // document.visibilityState, repassado pelo engine
  let lastFrameTime = null;
  let time = 0; // acumulador avançado por options.speed — é o que "flui" o gradiente
  let paused = false;

  // o engine já calculou cols/rows e o tamanho do canvas — aqui só aplica
  // (o canvas de trabalho é NOSSO, seja o da página ou o offscreen).
  function setOptions(next, size) {
    options = next;
    if (canvas.width !== size.width) canvas.width = size.width;
    if (canvas.height !== size.height) canvas.height = size.height;
    gifSize = { width: size.gifWidth, height: size.gifHeight };
  }

  function renderFrame() {
    if (!options) return;
    painter.paint(ctx, canvas.width, canvas.height, options, time);
    present?.(canvas);
  }

  function loop(now) {
    frameId = null;
    if (lastFrameTime == null) lastFrameTime = now;
    const dt = Math.min(0.1, (now - lastFrameTime) / 1000); // trava dt (aba em segundo plano etc.)
    // tolerância de 10% no piso: com o laço por timer (worker), o tick chega
    // às vezes em 41,5ms em vez de 41,7 — sem a folga, esse quadro seria
    // pulado e o seguinte viria com o dobro do intervalo (soluço visível).
    if (dt >= RENDER_MIN_DT * 0.9) {
      lastFrameTime = now;
      if (!paused) {
        time += dt * options.speed;
        renderFrame();
      }
    }
    schedule();
  }

  // só agenda o próximo quadro se estiver rodando E a aba visível — com a
  // aba oculta, rAF já pararia sozinho na main thread, mas num worker (laço
  // por timer) ele continuaria queimando CPU/bateria desenhando pra ninguém.
  function schedule() {
    if (!running || !visible || frameId != null) return;
    frameId = scheduleFrame(loop);
  }

  function unschedule() {
    if (frameId != null) cancelFrame(frameId);
    frameId = null;
  }

  function start() {
    stop();
    running = true;
    renderFrame();
    lastFrameTime = null;
    schedule();
  }

  function stop() {
    running = false;
    unschedule();
  }

  function setPaused(value) {
    paused = value;
    if (!paused) lastFrameTime = null; // evita um "salto" de dt gigante ao retomar
  }

  function setVisible(value) {
    visible = value;
    if (!visible) {
      unschedule();
    } else {
      lastFrameTime = null; // mesmo motivo do setPaused: não "pular" o tempo que ficou oculto
      schedule();
    }
  }

  // --- GIF ---------------------------------------------------------------
  // paleta do GIF: o gradiente é uma faixa CONTÍNUA de cores (interpolação),
  // então escaneia uma amostra dos quadros capturados pra montar a paleta —
  // mesma técnica do modo "gradiente"/"cores do vídeo" do Espelho.
  const gif = createGifRecorder({
    source: () => canvas,
    getSize: () => gifSize,
    fps: GIF_FPS,
    maxSeconds: GIF_MAX_SECONDS,
    buildPalette: (frames) => scanFramesPalette(frames, options.background),
    onCaptureEnd: onGifCaptureEnd,
  });

  function destroy() {
    stop();
    gif.destroy();
  }

  return {
    setOptions,
    start,
    stop,
    renderFrame,
    setPaused,
    setVisible,
    startGif: gif.start,
    stopGif: gif.stop, // síncrono: Blob | null
    destroy,
  };
}
