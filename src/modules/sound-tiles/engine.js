// Motor do modo Som: MESMA lógica de desenho do Espelho (video-tiles) —
// forma fixa por célula, tamanho/cor reagindo a um valor 0-1 por célula,
// GIF/vídeo gravados do próprio canvas de saída — só que a fonte do valor
// por célula não é luminância de um quadro de vídeo — é a MAGNITUDE de uma
// faixa de frequência do áudio (Web Audio API AnalyserNode). O desenho em
// si (espectrômetro parado, attack/release etc.) está comentado em draw.js.
//
// Onde cada coisa roda:
//   - main thread (sempre): AudioContext/AnalyserNode/microfone (Web Audio
//     não existe em worker), o laço de rAF que lê o espectro a cada quadro,
//     agrupa em bandas e suaviza (`levels`), e o MediaRecorder da gravação.
//   - Web Worker + OffscreenCanvas (quando o navegador suporta): a pintura
//     da grade — a parte cara (até 96×96 formas por quadro) — e a
//     codificação do GIF. A cada quadro só atravessa um Float32Array com uma
//     entrada por barra (transferido), e volta um ImageBitmap pronto (ver
//     offscreen.js).
//   - fallback na main thread (como sempre foi): sem OffscreenCanvas/Worker,
//     ou com localStorage.KATA_FORCE_MAIN_THREAD = '1' (depuração).
// Os dois caminhos usam o MESMO runtime.js/draw.js; a API pública deste
// objeto é idêntica nos dois.
import { randomSeed } from '../../core/seed.js';
import { framedGridDims } from '../grid-icons/generator.js';
import { canUseOffscreenWorker, connectOffscreenWorker, createDeferredBackend } from '../video-tiles/offscreen.js';
import { bandCount as bandCountOf, clampOutputDim, computeOutputSize, GIF_MAX_DIM, RENDER_MIN_DT } from './draw.js';
import { createSoundRuntime } from './runtime.js';

export function createSoundTilesEngine(outputCanvas) {
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
  let currentFileName = '';
  let activeMicDeviceId = null;

  let rafId = null;
  let paused = false;
  let lastRenderAt = 0;

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
    // alcance do gradiente base→ponta DENTRO da própria barra (ver draw.js)
    // — 0 = toda célula acesa fica na cor da base (sem variação nenhuma);
    // 1 = a ponta da barra chega no fim total do gradiente (0), mesmo numa
    // barra curta.
    colorResponse: 0.6,
    // opcional: só o formato "Tela cheia" passa um valor (calculado a
    // partir da caixa medida na tela, ver index.js/computeFullBox) — os
    // outros formatos deixam null e caem no OUTPUT_MAX_DIM fixo de sempre.
    maxDim: null,
  };

  function bandCount() {
    return bandCountOf(options);
  }

  function rebuildLevels() {
    levels = new Float32Array(bandCount());
  }

  // --- backend: worker ou main thread -------------------------------------
  // Interface interna igual nos dois: setOptions(snapshot, size),
  // drawFrame(levels), startGif, stopGif() → Blob|null, destroy.
  let gifRecording = false;
  const onGifCaptureEnd = () => {
    gifRecording = false;
  };

  function createWorkerBackend(link) {
    link.on('gif-capture-ended', onGifCaptureEnd);
    // backpressure: só manda um quadro novo depois que o anterior voltou
    // pintado (a mensagem 'frame' do worker). Sem isso, numa resolução alta
    // em celular fraco, a main thread mandaria 30 quadros/s e o worker
    // pintaria 15 — a fila só cresceria e a imagem ficaria segundos
    // atrasada em relação ao som. Descartar o quadro é o certo aqui: o
    // próximo já vem com o nível atual.
    let inFlightSince = 0;
    link.on('frame', () => {
      inFlightSince = 0;
    });
    return {
      setOptions: (snapshot, size) => {
        // o canvas da página (contexto bitmaprenderer) precisa ter o mesmo
        // tamanho do offscreen pra captureStream/toBlob e layout ficarem certos
        if (outputCanvas.width !== size.width) outputCanvas.width = size.width;
        if (outputCanvas.height !== size.height) outputCanvas.height = size.height;
        link.post({ type: 'options', options: snapshot, size });
      },
      drawFrame: (current) => {
        const now = performance.now();
        // 1s de tolerância: se o worker engasgar de verdade, não fica
        // travado pra sempre esperando um 'frame' que não vem
        if (inFlightSince && now - inFlightSince < 1000) return;
        inFlightSince = now;
        const copy = new Float32Array(current); // `levels` continua vivo aqui; vai uma cópia, transferida
        link.post({ type: 'levels', levels: copy }, [copy.buffer]);
      },
      startGif: () => link.post({ type: 'gif-start' }),
      stopGif: () => link.request({ type: 'gif-stop' }, 'gif-blob').then((reply) => reply.blob),
      destroy: () => link.destroy(),
    };
  }

  function createMainThreadBackend() {
    const runtime = createSoundRuntime(outputCanvas, { onGifCaptureEnd });
    return {
      setOptions: runtime.setOptions,
      drawFrame: runtime.paintLevels,
      startGif: runtime.startGif,
      stopGif: runtime.stopGif,
      destroy: runtime.destroy,
    };
  }

  // o handshake com o worker é assíncrono (ver connectOffscreenWorker) e a
  // UI chama setOptions logo depois de criar o motor — por isso o backend
  // começa "adiado": enfileira e repassa quando o real existir. drawFrame
  // não enfileira (quadro velho não serve pra nada, ver createDeferredBackend).
  const backend = createDeferredBackend(['setOptions', 'drawFrame', 'startGif', 'stopGif', 'destroy'], { dropWhilePending: ['drawFrame'] });
  if (canUseOffscreenWorker()) {
    connectOffscreenWorker(new URL('./render.worker.js', import.meta.url), outputCanvas).then((link) => {
      backend.resolveWith(link ? createWorkerBackend(link) : createMainThreadBackend());
    });
  } else {
    backend.resolveWith(createMainThreadBackend());
  }

  function setOptions(partial) {
    const prevBandCount = levels?.length ?? -1;
    Object.assign(options, partial);
    const { cols, rows } = framedGridDims(options.resolution, options.ratio);
    options.cols = cols;
    options.rows = rows;
    const out = computeOutputSize(cols, rows, clampOutputDim(options.maxDim));
    const gifOut = computeOutputSize(cols, rows, GIF_MAX_DIM);
    if (bandCount() !== prevBandCount) rebuildLevels();
    if (analyser) analyser.smoothingTimeConstant = Math.min(0.95, Math.max(0, options.smoothing));
    // snapshot raso: no worker vira uma cópia estrutural de qualquer jeito;
    // no fallback o pintor só lê. Quem dimensiona o canvas de desenho é o
    // runtime (ver runtime.js).
    backend.setOptions({ ...options }, { width: out.width, height: out.height, gifWidth: gifOut.width, gifHeight: gifOut.height });
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
    activeMicDeviceId = null;
  }

  function clearSource() {
    disconnectMic();
    audio.pause();
    if (sourceUrl) {
      URL.revokeObjectURL(sourceUrl);
      sourceUrl = null;
    }
    activeSource = null;
    currentFileName = '';
  }

  function loadFile(file) {
    ensureAudioGraph();
    disconnectMic();
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    sourceUrl = URL.createObjectURL(file);
    audio.src = sourceUrl;
    currentFileName = file.name || '';
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

  // --- controles do player (progresso/volume) ----------------------------
  // só fazem sentido pra fonte 'file' (o microfone não tem duração/posição
  // pra arrastar, nem volume — é o próprio ambiente, não tem "tocar mais
  // alto"). getDuration pode voltar NaN antes do metadata carregar — quem
  // usa isso (index.js) já trata isso mostrando 0 até o 'loadedmetadata'.
  function getFileName() {
    return currentFileName;
  }
  function getCurrentTime() {
    return audio.currentTime || 0;
  }
  function getDuration() {
    return Number.isFinite(audio.duration) ? audio.duration : 0;
  }
  function seekTo(time) {
    if (activeSource !== 'file') return;
    audio.currentTime = Math.max(0, Math.min(getDuration() || time, time));
  }
  function setVolume(v) {
    audio.volume = Math.max(0, Math.min(1, v));
  }
  function getVolume() {
    return audio.volume;
  }
  function setLoop(value) {
    audio.loop = value;
  }
  function getLoop() {
    return audio.loop;
  }
  // 'timeupdate' sozinho já cobre a barra andando durante a reprodução;
  // 'loadedmetadata' é o único jeito de saber a duração assim que ela fica
  // disponível (às vezes só depois do play já ter começado) sem esperar o
  // primeiro tick de 'timeupdate'. Devolve a função de limpeza (padrão do
  // projeto pra listener registrado sob demanda, ver cleanupResize em
  // index.js) — quem chama guarda e roda no unmount.
  function onAudioProgress(cb) {
    audio.addEventListener('timeupdate', cb);
    audio.addEventListener('loadedmetadata', cb);
    return () => {
      audio.removeEventListener('timeupdate', cb);
      audio.removeEventListener('loadedmetadata', cb);
    };
  }

  async function enableMic(deviceId) {
    ensureAudioGraph();
    clearSource();
    // erro (permissão negada, sem microfone...) é responsabilidade de quem
    // chamou tratar — mesma decisão do enableWebcam do Espelho.
    const audioConstraints = deviceId ? { deviceId: { exact: deviceId } } : true;
    micStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false });
    activeMicDeviceId = deviceId ?? micStream.getAudioTracks()[0]?.getSettings?.().deviceId ?? null;
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

  // enumerateDevices() só devolve label/deviceId de verdade DEPOIS de já
  // ter tido permissão de microfone concedida uma vez nesta sessão — mesma
  // regra do listCameras do Espelho (video-tiles/engine.js), só que pra
  // 'audioinput' em vez de 'videoinput'.
  async function listMics() {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'audioinput');
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

  // lê o espectro, suaviza e manda pintar — barato (512 bins + uma dezena
  // de barras); o desenho da grade, que é o que pesa, fica com o backend.
  function renderFrame(timestamp) {
    if (!hasSource()) return;
    if (timestamp && timestamp - lastRenderAt < RENDER_MIN_DT) return;
    lastRenderAt = timestamp || 0;
    applyAttackRelease(sampleBands(bandCount()));
    backend.drawFrame(levels);
  }

  // rAF na main thread nos dois modos — é aqui que o AnalyserNode mora. Em
  // aba oculta o próprio rAF para (document.visibilityState), então nem o
  // worker recebe quadro nenhum.
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
  // não sabe nem precisa saber que a fonte agora é áudio; no modo worker o
  // canvas recebe cada quadro via bitmaprenderer e segue gravável) ---------
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

  function destroy() {
    stop();
    clearSource();
    if (isRecording()) recorder.stop();
    backend.destroy(); // no modo worker: terminate()
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
    listMics,
    getActiveMicDeviceId: () => activeMicDeviceId,
    hasSource,
    isFilePlaying,
    toggleFilePlayback,
    getFileName,
    getCurrentTime,
    getDuration,
    seekTo,
    setVolume,
    getVolume,
    setLoop,
    getLoop,
    onAudioProgress,
    // "Cancelar" o arquivo carregado (botão Enviar áudio vira Cancelar
    // enquanto há um arquivo — ver sound-tiles/index.js) — reaproveita a
    // MESMA limpeza que já existe pra quando o microfone assume a fonte.
    clearFile: clearSource,
    setPaused: (value) => { paused = value; },
    isPaused: () => paused,
    start,
    stop,
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
      return Promise.resolve(backend.stopGif());
    },
    isGifRecording: () => gifRecording,
    destroy,
    getCanvas: () => outputCanvas,
    getGridSize: () => ({ cols: options.cols, rows: options.rows }),
  };
}
