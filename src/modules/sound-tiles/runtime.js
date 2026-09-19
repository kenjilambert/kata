// "Runtime" do Som: o que roda por quadro em cima de UM canvas (pintar os
// níveis, capturar GIF) — sem saber se esse canvas é o <canvas> da página
// (fallback na main thread) ou um OffscreenCanvas dentro de um Web Worker:
//
//   engine.js (fallback)  ──▶ createSoundRuntime(canvasDaPagina)
//   render.worker.js      ──▶ createSoundRuntime(offscreenCanvas, { present })
//
// Diferente do Gradiente, NÃO tem laço aqui: quem dita o ritmo é o engine na
// main thread, porque a fonte dos quadros é o AnalyserNode (Web Audio não
// roda em worker) — a cada quadro ele lê o espectro, suaviza (attack/
// release) e chama paintLevels(levels) com um Float32Array pequeno (uma
// entrada por barra). O desenho pesado (cols×rows formas) é o que fica aqui.
import { createGifRecorder, scanFramesPalette } from '../../core/gifEncoder.js';
import { buildSoundGifPalette, createSoundPainter, GIF_FPS, GIF_MAX_SECONDS } from './draw.js';

export function createSoundRuntime(canvas, { onGifCaptureEnd, present } = {}) {
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  const painter = createSoundPainter();

  let options = null; // snapshot vindo do engine (ver setOptions)
  let gifSize = { width: 1, height: 1 };

  // o engine já calculou cols/rows e o tamanho do canvas — aqui só aplica
  // (o canvas de trabalho é NOSSO, seja o da página ou o offscreen).
  function setOptions(next, size) {
    options = next;
    if (canvas.width !== size.width) canvas.width = size.width;
    if (canvas.height !== size.height) canvas.height = size.height;
    gifSize = { width: size.gifWidth, height: size.gifHeight };
  }

  function paintLevels(levels) {
    if (!options) return;
    painter.paint(ctx, canvas.width, canvas.height, options, levels);
    present?.(canvas);
  }

  const gif = createGifRecorder({
    source: () => canvas,
    getSize: () => gifSize,
    fps: GIF_FPS,
    maxSeconds: GIF_MAX_SECONDS,
    buildPalette: (frames) => buildSoundGifPalette(options, frames, scanFramesPalette),
    onCaptureEnd: onGifCaptureEnd,
  });

  return {
    setOptions,
    paintLevels,
    startGif: gif.start,
    stopGif: gif.stop, // síncrono: Blob | null
    destroy: gif.destroy,
  };
}
