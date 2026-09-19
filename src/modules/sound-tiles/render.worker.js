// Web Worker do Som: pinta a grade de formas (a parte cara — até 96×96
// células por quadro) num OffscreenCanvas próprio a partir dos níveis de
// áudio que a main thread manda a cada quadro, e devolve cada quadro pronto
// como ImageBitmap (ver createBitmapPresenter em offscreen.js). O áudio em
// si (AudioContext/AnalyserNode/microfone) fica na main thread — Web Audio
// não existe em worker — e o que atravessa é só um Float32Array com uma
// entrada por barra (transferido, não copiado).
//
// Este arquivo é só um adaptador mensagem → chamada; toda a lógica está em
// runtime.js (compartilhado com o fallback na main thread, ver engine.js).
//
// Protocolo (main → worker):
//   init                                        — 1x, depois do nosso `ready`
//   options   {options, size}                   — snapshot completo de opções
//   levels    {levels: Float32Array}            — 1 quadro pra pintar
//   gif-start          gif-stop {id}
// (worker → main):
//   ready | unsupported {reason}                — handshake (ver offscreen.js)
//   frame     {bitmap}                          — quadro pronto (também serve
//                                                 de "pode mandar o próximo")
//   gif-capture-ended                           — bateu no teto de duração
//   gif-blob  {id, blob}                        — resposta de gif-stop
import { announceWorkerReady, createBitmapPresenter } from '../video-tiles/offscreen.js';
import { createSoundRuntime } from './runtime.js';

let runtime = null;

announceWorkerReady();

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    runtime = createSoundRuntime(new OffscreenCanvas(1, 1), {
      present: createBitmapPresenter(),
      onGifCaptureEnd: () => self.postMessage({ type: 'gif-capture-ended' }),
    });
    return;
  }
  if (!runtime) return;
  switch (msg.type) {
    case 'options':
      runtime.setOptions(msg.options, msg.size);
      break;
    case 'levels':
      runtime.paintLevels(msg.levels);
      break;
    case 'gif-start':
      runtime.startGif();
      break;
    case 'gif-stop':
      // codificação do GIF roda aqui, fora da main thread (ver Gradiente)
      self.postMessage({ type: 'gif-blob', id: msg.id, blob: runtime.stopGif() });
      break;
    default:
      break;
  }
};
