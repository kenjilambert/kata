// Web Worker do Gradiente: roda o runtime inteiro aqui — laço, ruído,
// rasterização das formas e captura/codificação do GIF — num OffscreenCanvas
// próprio, e manda cada quadro pronto pra main thread como ImageBitmap (ver
// createBitmapPresenter em offscreen.js). A main thread fica só com a UI
// (sliders, abas, cursor), que é o que engasgava em celular fraco quando os
// ~10-40ms de desenho por quadro disputavam a mesma thread.
//
// Este arquivo é só um adaptador mensagem → chamada; toda a lógica está em
// runtime.js (compartilhado com o fallback na main thread, ver engine.js),
// então não tem nada aqui que possa divergir do que o fallback faz.
//
// Protocolo (main → worker), todas as mensagens são {type, ...}:
//   init                                        — 1x, depois do nosso `ready`
//   options   {options, size}                   — snapshot completo de opções
//   start | stop | frame                        — laço / 1 quadro avulso
//   paused    {value}   visible {value}
//   gif-start          gif-stop {id}
// (worker → main):
//   ready | unsupported {reason}                — handshake (ver offscreen.js)
//   frame     {bitmap}                          — 1 quadro pronto pra tela
//   gif-capture-ended                           — bateu no teto de duração
//   gif-blob  {id, blob}                        — resposta de gif-stop
import { announceWorkerReady, createBitmapPresenter } from '../video-tiles/offscreen.js';
import { createGradientRuntime } from './runtime.js';

let runtime = null;

// só chega aqui se todos os imports acima avaliaram — é isso que o `ready`
// garante pra main thread antes dela passar a depender do worker.
announceWorkerReady();

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    runtime = createGradientRuntime(new OffscreenCanvas(1, 1), {
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
    case 'start':
      runtime.start();
      break;
    case 'stop':
      runtime.stop();
      break;
    case 'frame':
      runtime.renderFrame();
      break;
    case 'paused':
      runtime.setPaused(msg.value);
      break;
    case 'visible':
      runtime.setVisible(msg.value);
      break;
    case 'gif-start':
      runtime.startGif();
      break;
    case 'gif-stop':
      // a codificação (quantização + LZW de até 96 quadros) roda AQUI, não
      // na main thread — antes era o único momento em que a UI congelava de
      // verdade (segundos, no GIF de 8s). Blob é clonável por postMessage.
      self.postMessage({ type: 'gif-blob', id: msg.id, blob: runtime.stopGif() });
      break;
    default:
      break;
  }
};
