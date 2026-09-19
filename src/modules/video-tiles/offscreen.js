// Ponte comum entre um motor (main thread) e seu render.worker.js — usada
// por Gradiente, Som e Espelho. Mora em video-tiles/ pelo mesmo motivo que
// shapes.js: o Espelho foi o primeiro motor em Canvas 2D e os outros dois
// já importam daqui.
//
// COMO os quadros chegam na tela (e por que não é transferControlToOffscreen):
// o worker desenha num OffscreenCanvas PRÓPRIO e, a cada quadro, manda um
// ImageBitmap pronto (transferToImageBitmap → postMessage com transferência,
// zero cópia) pra main thread, que só faz transferFromImageBitmap() num
// contexto 'bitmaprenderer' do <canvas> da página — medido em ~0,1ms por
// quadro. A alternativa "clássica" (canvas.transferControlToOffscreen(),
// worker desenha direto no canvas da página) foi a 1ª versão disto e caiu
// por um motivo empírico: no Chrome 152, o <canvas> placeholder que sobra
// na página NÃO alimenta captureStream() (MediaRecorder gravava um WebM de
// 110 bytes, zero quadros) nem toBlob()/toDataURL() (PNG em branco) — ou
// seja, quebrava "Gravar" e "Baixar quadro". Com o bitmaprenderer o canvas
// da página continua um canvas normal: gravação e PNG funcionam exatamente
// como no fallback, sem mudar nada nos index.js.
//
// Handshake: o motor só passa a usar o worker DEPOIS dele avisar
// {type:'ready'} (imports avaliados, contexto 2D em OffscreenCanvas testado).
// Se o script falhar antes (offline sem os arquivos do worker no cache do
// SW — eles não têm ?v= porque worker não lê o import map da página —,
// deploy quebrado, Safari antigo), o motor desenha na main thread como
// sempre, no mesmo canvas, sem tela preta. Enquanto isso, as chamadas da UI
// ficam numa fila (ver createDeferredBackend).

// flag só pra depuração: `localStorage.KATA_FORCE_MAIN_THREAD = '1'` força
// o fallback (desenho na main thread) mesmo em navegador com suporte — pra
// comparar os dois caminhos lado a lado sem trocar de navegador. Não tem
// UI pra isso de propósito; é ferramenta de quem desenvolve.
function forcedMainThread() {
  try {
    return localStorage.getItem('KATA_FORCE_MAIN_THREAD') === '1';
  } catch {
    return false;
  }
}

export function canUseOffscreenWorker() {
  if (typeof OffscreenCanvas === 'undefined') return false;
  if (typeof Worker === 'undefined') return false;
  if (typeof ImageBitmapRenderingContext === 'undefined') return false;
  return !forcedMainThread();
}

// cria o module worker (os render.worker.js importam o mesmo draw.js/
// runtime.js do fallback via `import`), espera o `ready`, liga o contexto
// 'bitmaprenderer' no canvas da página e resolve com um objeto pequeno pra
// conversar com o worker — ou com null se não deu (aí quem chamou usa o
// fallback; o canvas segue intocado, getContext('2d') ainda funciona nele):
//   post(msg, transfer?)         — dispara e esquece
//   request(msg, replyType)      — Promise resolvida com a 1ª resposta desse
//                                  tipo com o mesmo `id` (ex.: gif-stop → gif-blob)
//   on(type, fn)                 — escuta mensagens espontâneas do worker
//   destroy()                    — terminate() + solta os listeners
// Mensagens {type:'frame', bitmap} são consumidas aqui mesmo (vão pra tela)
// e TAMBÉM repassadas aos listeners de 'frame' (o motor de Som/Espelho usa
// isso como "pode mandar o próximo", ver backpressure nos engines).
export function connectOffscreenWorker(workerUrl, canvasEl) {
  return new Promise((resolve) => {
    const worker = new Worker(workerUrl, { type: 'module' });
    const listeners = new Map();
    const pending = new Map();
    let presenter = null;
    let nextId = 1;
    let settled = false;

    const fail = (reason) => {
      if (settled) return;
      settled = true;
      console.warn('[kata] render worker indisponível, desenhando na main thread:', reason);
      worker.terminate();
      resolve(null);
    };

    worker.onerror = (e) => {
      if (!settled) fail(e.message || 'erro ao carregar o script');
      else console.error('[kata] render worker:', e.message || e);
    };

    worker.onmessage = (e) => {
      const msg = e.data;
      if (!settled) {
        if (msg.type === 'ready') {
          // um canvas só aceita UM tipo de contexto — se alguém já pediu
          // '2d' nele (não acontece nos engines, mas por segurança), isto
          // devolve null e caímos no fallback.
          presenter = canvasEl.getContext('bitmaprenderer');
          if (!presenter) {
            fail('canvas sem contexto bitmaprenderer');
            return;
          }
          settled = true;
          worker.postMessage({ type: 'init' });
          resolve(link);
        } else if (msg.type === 'unsupported') {
          fail(msg.reason);
        }
        return;
      }
      if (msg.type === 'frame') {
        // o bitmap anterior é liberado pelo próprio contexto ao ser trocado
        presenter.transferFromImageBitmap(msg.bitmap);
      }
      if (msg.id != null && pending.has(msg.id)) {
        const { resolve: done, replyType } = pending.get(msg.id);
        if (msg.type === replyType) {
          pending.delete(msg.id);
          done(msg);
          return;
        }
      }
      listeners.get(msg.type)?.forEach((fn) => fn(msg));
    };

    const link = {
      post(msg, transfer) {
        worker.postMessage(msg, transfer || []);
      },
      request(msg, replyType) {
        const id = nextId++;
        return new Promise((done) => {
          pending.set(id, { resolve: done, replyType });
          worker.postMessage({ ...msg, id });
        });
      },
      on(type, fn) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(fn);
      },
      destroy() {
        worker.terminate();
        listeners.clear();
        pending.clear();
      },
    };
  });
}

// lado do WORKER do handshake acima: chamado no topo do render.worker.js,
// depois dos imports. Testa de verdade se dá pra desenhar 2D num
// OffscreenCanvas neste navegador (a classe existir não garante o contexto
// — Safari antigo tinha só WebGL) e avisa a main thread.
export function announceWorkerReady() {
  let ok = false;
  try {
    ok = Boolean(new OffscreenCanvas(1, 1).getContext('2d'));
  } catch {
    ok = false;
  }
  self.postMessage(ok ? { type: 'ready' } : { type: 'unsupported', reason: 'OffscreenCanvas sem contexto 2D' });
  return ok;
}

// lado do WORKER da apresentação: devolve uma função present(canvas) que
// copia o canvas de trabalho pra um segundo OffscreenCanvas e manda o
// ImageBitmap dele pra main thread. Por que dois canvases e não
// transferToImageBitmap() direto no de trabalho: transferir DESTACA o bitmap
// (o canvas volta transparente), o que mataria o efeito "Rastro" do Som/
// Espelho, que depende do quadro anterior continuar lá embaixo. O drawImage
// extra é uma cópia GPU→GPU, barata.
export function createBitmapPresenter() {
  const out = new OffscreenCanvas(1, 1);
  const outCtx = out.getContext('2d');
  return function present(canvas) {
    if (out.width !== canvas.width) out.width = canvas.width;
    if (out.height !== canvas.height) out.height = canvas.height;
    outCtx.drawImage(canvas, 0, 0);
    const bitmap = out.transferToImageBitmap();
    self.postMessage({ type: 'frame', bitmap }, [bitmap]);
  };
}

// backend "adiado": enquanto o handshake não termina (alguns ms), o motor
// já recebe setOptions/start da UI — as chamadas ficam na fila, em ordem, e
// são repassadas de uma vez pro backend real (worker ou main thread) quando
// ele existe. Toda chamada devolve Promise (quem não precisa do valor
// ignora; stopGif espera o Blob). `dropWhilePending`: métodos por-quadro
// (drawFrame do Som/Espelho) que não fazem sentido acumular — enfileirar
// 30 quadros/s de níveis de áudio só despejaria uma rajada de quadros
// velhos quando o worker subisse.
export function createDeferredBackend(methodNames, { dropWhilePending = [] } = {}) {
  let real = null;
  const queue = [];
  const api = {};
  for (const name of methodNames) {
    const droppable = dropWhilePending.includes(name);
    api[name] = (...args) => {
      if (real) return real[name](...args);
      if (droppable) return undefined;
      return new Promise((resolve) => queue.push({ name, args, resolve }));
    };
  }
  api.resolveWith = (backend) => {
    real = backend;
    for (const { name, args, resolve } of queue.splice(0)) resolve(real[name](...args));
  };
  api.isResolved = () => real != null;
  return api;
}

// avisa `cb(visible)` já com o estado atual e a cada mudança — o runtime
// para de agendar quadros com a aba oculta (ver setVisible em runtime.js).
// Devolve a função de limpeza (padrão do projeto pra listener registrado
// sob demanda, ver cleanupResize nos index.js).
export function watchVisibility(cb) {
  if (typeof document === 'undefined') return () => {};
  const handler = () => cb(document.visibilityState !== 'hidden');
  document.addEventListener('visibilitychange', handler);
  handler();
  return () => document.removeEventListener('visibilitychange', handler);
}
