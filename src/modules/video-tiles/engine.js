import { createRng, randomSeed } from '../../core/seed.js';
import { nearestPaletteColor } from '../../core/imageSampling.js';
import { encodeGif } from '../../core/gifEncoder.js';
import { framedGridDims } from '../grid-icons/generator.js';
import { drawVideoShape, VIDEO_SHAPES } from './shapes.js';

// tamanho/duração do GIF deliberadamente menores que os do vídeo gravado
// (.webm): um GIF decodifica TODOS os quadros crus na memória do
// navegador/app de quem for abrir depois (sem streaming como vídeo de
// verdade), então cada segundo a mais ou pixel a mais custa proporcionalmente
// muito mais no arquivo final. 12fps/8s/(até 360px no lado maior) já dá um
// GIF fluido o suficiente pro efeito, num tamanho de arquivo razoável de
// compartilhar.
const GIF_MAX_DIM = 360;
const GIF_FPS = 12;
const GIF_MAX_SECONDS = 8;

// tamanho "de referência" do canvas de saída, no lado MAIOR (o menor segue o
// formato escolhido — ver computeOutputSize) — a tela mostra ele esticado
// via CSS width:100%, igual ao <svg> dos outros módulos. Fixo em vez de
// acompanhar o tamanho real na tela: mudar o tamanho do elemento não deveria
// mudar a nitidez/framerate da renderização.
const OUTPUT_MAX_DIM = 900;

// cols×rows a partir de uma "resolução" (densidade, eixo menor) + a
// proporção pedida (1 = quadrado, 16/9 = paisagem, 9/16 = story...) — MESMA
// conta de framedGridDims (Azulejo), pros formatos ficarem fiéis às
// proporções de vídeo de verdade em vez de espremer tudo num quadrado.
function computeGrid(resolution, ratio) {
  return framedGridDims(resolution, ratio);
}

// canvas final: o lado MAIOR sempre com maxDim px, o lado menor encolhido
// na mesma proporção de cols/rows — assim uma célula sempre tem o mesmo
// tamanho físico não importa o formato escolhido (mesma ideia do cellSize
// em renderGridToSvg, grid-icons/generator.js).
function computeOutputSize(cols, rows, maxDim) {
  if (cols >= rows) {
    return { width: maxDim, height: Math.max(1, Math.round((maxDim * rows) / cols)) };
  }
  return { width: Math.max(1, Math.round((maxDim * cols) / rows)), height: maxDim };
}

const CORNERS = ['tl', 'tr', 'br', 'bl'];

// motor do modo Espelho: cuida da fonte (arquivo ou webcam), da amostragem de
// cada quadro numa grade pequena (igual em espírito a sampleImageGrid, só
// que rodando a cada quadro em vez de uma vez só numa imagem parada) e do
// laço de desenho no canvas de saída. Devolvido como um objeto com métodos
// (não uma classe) pra combinar com o resto do projeto (ver createSlider,
// createSelect etc.) — só este arquivo tem estado mutável de verdade
// (vídeo/stream/loop), o resto (index.js) só chama os métodos.
export function createVideoTilesEngine(outputCanvas) {
  const ctx = outputCanvas.getContext('2d', { willReadFrequently: false });

  // <video> nunca entra no DOM visível — só serve de fonte de quadros pro
  // canvas (arquivo enviado OU stream da webcam, nunca os dois ao mesmo
  // tempo). playsInline evita o Safari/iOS abrir em tela cheia sozinho.
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.loop = true;

  // canvas de amostragem: um quadro do vídeo inteiro vira UMA imagem
  // pixelizada cols×rows (o próprio drawImage faz a redução/média de todos
  // os pixels — é essencialmente um blur/mip barato, exatamente a base que
  // um efeito de dithering precisa). Reaproveitado entre quadros (só o
  // tamanho muda quando a resolução/formato muda) em vez de recriado toda hora.
  const sampleCanvas = document.createElement('canvas');
  const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });

  // canvas da gravação em GIF — sempre bem menor que o de exibição (ver
  // GIF_MAX_DIM), mas seguindo o MESMO formato (cols/rows), então o GIF sai
  // com a mesma proporção do preview, só menor.
  const gifCanvas = document.createElement('canvas');
  const gifCtx = gifCanvas.getContext('2d', { willReadFrequently: true });

  let sourceUrl = null;
  let webcamStream = null;
  let rafId = null;
  let videoFrameCallbackId = null;
  let paused = false;
  let activeDeviceId = null;

  let cellAssignments = null; // grade fixa de {shapeKey, orientation} por célula — ver rebuildCellShapesIfNeeded
  let cellAssignmentsKey = ''; // "assinatura" (cols/rows + pool de formas) da última grade construída

  const options = {
    resolution: 32, // densidade no eixo menor da grade — ver computeGrid
    ratio: 1, // 1 = quadrado, 16/9 = paisagem, 9/16 = story... (ver EXPORT_FRAME_RATIOS, core/export.js)
    cols: 0,
    rows: 0,
    shapeScale: 1,
    shapeMode: 'mixed', // uma forma do catálogo (ver VIDEO_SHAPES), ou 'mixed'
    colorMode: 'palette', // 'grayscale' | 'source' | 'palette'
    inkColor: '#f5efe4',
    background: '#141210',
    invert: false,
    paletteColors: [],
    shapesAllowed: [], // pool do modo "Variado" — normalmente as formas ativas no Azulejo (ver index.js)
    seed: randomSeed(),
    // rastro/eco: 0 = limpa o quadro anterior por completo (comportamento de
    // sempre); mais perto de 1 = o quadro anterior só desbota aos poucos em
    // vez de sumir na hora, deixando um rastro de movimento. Ver o
    // ctx.globalAlpha na limpeza, dentro de renderFrame.
    trail: 0,
    // caleidoscópio: dobra a AMOSTRA do vídeo (não a grade de formas em si)
    // pelos mesmos 4 modos de simetria do Azulejo — ver remapSampleCoord.
    symmetry: 'none',
  };

  function rebuildCellShapesIfNeeded() {
    const pool = options.shapeMode === 'mixed' ? (options.shapesAllowed.length ? options.shapesAllowed : VIDEO_SHAPES) : [options.shapeMode];
    // assinatura barata (não precisa de JSON.stringify pesado): tamanho da
    // grade + o próprio pool, junto — muda sempre que a resolução/formato
    // muda OU o conjunto de formas disponível muda (troca de forma única,
    // ou o Azulejo liga/desliga alguma forma enquanto o modo é "Variado").
    const key = `${options.cols}x${options.rows}|${pool.join(',')}`;
    if (cellAssignments && cellAssignmentsKey === key) return;
    // fixo por célula (não sorteado de novo a cada quadro) — sorteio por
    // quadro faria cada célula "piscar" de forma diferente 30x/s, sem
    // relação nenhuma com o que o vídeo está mostrando; fixar forma e
    // orientação e só deixar TAMANHO/COR reagirem ao vídeo é o que dá o
    // efeito de "dithering com ícones" (mesma ideia do meio-tom clássico, só
    // que a textura de fundo é decidida uma vez, geometricamente — igual ao
    // Azulejo decidir forma/orientação de cada célula uma vez só, ver
    // buildIconGrid em grid-icons/generator.js).
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
    sampleCanvas.width = cols;
    sampleCanvas.height = rows;
    const out = computeOutputSize(cols, rows, OUTPUT_MAX_DIM);
    outputCanvas.width = out.width;
    outputCanvas.height = out.height;
    const gifOut = computeOutputSize(cols, rows, GIF_MAX_DIM);
    gifCanvas.width = gifOut.width;
    gifCanvas.height = gifOut.height;
    rebuildCellShapesIfNeeded();
  }
  setOptions({}); // aplica os tamanhos iniciais dos canvas

  function stopStream() {
    if (webcamStream) {
      webcamStream.getTracks().forEach((track) => track.stop());
      webcamStream = null;
    }
  }

  function clearSource() {
    stopStream();
    if (sourceUrl) {
      URL.revokeObjectURL(sourceUrl);
      sourceUrl = null;
    }
    video.pause();
    video.removeAttribute('src');
    video.srcObject = null;
    video.load();
  }

  function loadFile(file) {
    clearSource();
    sourceUrl = URL.createObjectURL(file);
    video.srcObject = null;
    video.src = sourceUrl;
    video.play().catch(() => {
      /* autoplay pode falhar sem gesto do usuário — o próprio clique no
         botão de enviar já conta como gesto na prática, então isso não
         costuma disparar; ignorado de propósito. */
    });
  }

  async function enableWebcam(deviceId) {
    clearSource();
    const videoConstraints = deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'user' };
    // erro daqui pra frente é responsabilidade de quem chamou (ver index.js)
    // mostrar pra pessoa — não colocamos um try/catch aqui pra não esconder
    // o tipo do erro (NotAllowedError, NotFoundError, NotReadableError...),
    // que é justamente o que ajuda a diagnosticar por que a câmera não abriu
    // num navegador específico (ex.: Brave com Shields bloqueando).
    webcamStream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: false });
    activeDeviceId = deviceId ?? webcamStream.getVideoTracks()[0]?.getSettings?.().deviceId ?? null;
    video.srcObject = webcamStream;
    video.src = '';
    await video.play();
  }

  // enumerateDevices() só devolve label/deviceId de verdade DEPOIS de já ter
  // tido permissão de câmera concedida uma vez nesta sessão (antes disso,
  // devolve entradas "em branco", por privacidade) — por isso só faz sentido
  // chamar depois de já ter ligado a webcam ao menos uma vez.
  async function listCameras() {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'videoinput');
  }

  function hasSource() {
    return Boolean(sourceUrl || webcamStream);
  }

  // dobra a amostra pelos mesmos 4 modos de simetria do Azulejo (ver
  // core/symmetry.js) — só que aqui em cima de uma grade de PIXELS já
  // amostrada (não de células sorteadas), então em vez de "espelhar a
  // decisão" é "espelhar de onde vem a cor": toda célula fora do quadrante
  // canônico (metade/quadrante superior-esquerdo) lê a cor de sua
  // equivalente DENTRO dele, em vez da própria posição — efeito
  // caleidoscópio em cima do vídeo ao vivo. "rotational" só gira de verdade
  // numa grade QUADRADA (cols===rows) — trocar linha por coluna não faz
  // sentido geométrico num retângulo, então formatos não-quadrados caem de
  // volta pro mesmo resultado de "mirror-full" nesse modo.
  function remapSampleCoord(r, c, cols, rows, symmetry) {
    if (symmetry === 'none') return [r, c];
    const hc = Math.floor(cols / 2);
    const hr = Math.floor(rows / 2);
    if (symmetry === 'mirror-h') return [r, c < hc ? c : cols - 1 - c];
    if (symmetry === 'mirror-full') return [r < hr ? r : rows - 1 - r, c < hc ? c : cols - 1 - c];
    if (symmetry === 'rotational') {
      if (cols !== rows) return [r < hr ? r : rows - 1 - r, c < hc ? c : cols - 1 - c];
      const h = hc;
      if (r < h && c < h) return [r, c];
      if (r < h) { const cp = c - h; return [h - 1 - cp, r]; }
      if (c < h) { const rp = r - h; return [c, h - 1 - rp]; }
      const rp = r - h;
      const cp = c - h;
      return [h - 1 - rp, h - 1 - cp];
    }
    return [r, c];
  }

  function renderFrame() {
    const { cols, rows } = options;
    if (!hasSource() || video.readyState < 2 || !video.videoWidth) return;

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    // recorte central que casa com o formato pedido (cols/rows) — igual ao
    // "object-fit: cover": se o vídeo é mais largo que o formato, corta dos
    // lados (mantém a altura inteira); se é mais alto, corta em cima/embaixo.
    const targetRatio = cols / rows;
    const videoRatio = vw / vh;
    let cw;
    let ch;
    if (videoRatio > targetRatio) {
      ch = vh;
      cw = vh * targetRatio;
    } else {
      cw = vw;
      ch = vw / targetRatio;
    }
    const sx = (vw - cw) / 2;
    const sy = (vh - ch) / 2;
    // espelha horizontalmente só a AMOSTRAGEM da webcam (não o arquivo
    // enviado) — sem isso a pessoa vê o próprio reflexo "invertido" (levanta
    // a mão direita, a tela mostra levantando a esquerda), que é
    // desorientador em qualquer preview de câmera ao vivo.
    if (webcamStream) {
      sampleCtx.save();
      sampleCtx.translate(cols, 0);
      sampleCtx.scale(-1, 1);
      sampleCtx.drawImage(video, sx, sy, cw, ch, 0, 0, cols, rows);
      sampleCtx.restore();
    } else {
      sampleCtx.drawImage(video, sx, sy, cw, ch, 0, 0, cols, rows);
    }

    const { data } = sampleCtx.getImageData(0, 0, cols, rows);

    const outW = outputCanvas.width;
    const outH = outputCanvas.height;

    // rastro/eco: em vez de apagar o quadro anterior por completo, cobre com
    // o fundo em opacidade parcial — o que sobrar "por baixo" (o desenho do
    // quadro passado) só desbota aos poucos em vez de sumir na hora. trail=0
    // mantém o comportamento de sempre (opacidade 1 = limpeza total).
    ctx.globalAlpha = 1 - Math.min(0.95, Math.max(0, options.trail));
    ctx.fillStyle = options.background;
    ctx.fillRect(0, 0, outW, outH);
    ctx.globalAlpha = 1;

    const cellSize = outW / cols; // === outH / rows, já que o canvas de saída segue a mesma proporção da grade
    rebuildCellShapesIfNeeded();

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const [sr, sc] = remapSampleCoord(r, c, cols, rows, options.symmetry);
        const i = (sr * cols + sc) * 4;
        const r8 = data[i];
        const g8 = data[i + 1];
        const b8 = data[i + 2];
        const luminance = (0.299 * r8 + 0.587 * g8 + 0.114 * b8) / 255;

        // meio-tom clássico: célula ESCURA = forma GRANDE (mais "tinta"),
        // célula clara = forma pequena/nenhuma. invert troca essa lógica.
        const base = options.invert ? luminance : 1 - luminance;
        const scale = base * options.shapeScale;

        let color;
        if (options.colorMode === 'source') {
          color = `rgb(${r8}, ${g8}, ${b8})`;
        } else if (options.colorMode === 'palette' && options.paletteColors.length) {
          color = nearestPaletteColor({ r: r8, g: g8, b: b8 }, options.paletteColors);
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

  function loop() {
    // congelado: continua "vivo" (segue reagendando o próximo quadro,
    // pronto pra retomar na hora) mas para de redesenhar — o último quadro
    // desenhado no canvas fica parado na tela, sem precisar pausar o
    // <video>/webcam em si (senão descongelar teria que re-buffar o stream).
    if (!paused) renderFrame();
    // requestVideoFrameCallback (quando disponível) só acorda de novo
    // quando o <video> realmente decodificou um quadro novo — evita
    // redesenhar o canvas inteiro várias vezes por um MESMO quadro de
    // vídeo (o vídeo quase sempre roda a menos de 60fps, rAF puro sempre
    // roda a 60fps). Sem suporte (Firefox/Safari mais antigos), cai de
    // volta pro requestAnimationFrame normal — funciona igual, só um pouco
    // menos eficiente.
    if (video.requestVideoFrameCallback) {
      videoFrameCallbackId = video.requestVideoFrameCallback(loop);
    } else {
      rafId = requestAnimationFrame(loop);
    }
  }

  function start() {
    stop();
    loop();
  }

  function stop() {
    if (rafId != null) cancelAnimationFrame(rafId);
    if (videoFrameCallbackId != null && video.cancelVideoFrameCallback) {
      video.cancelVideoFrameCallback(videoFrameCallbackId);
    }
    rafId = null;
    videoFrameCallbackId = null;
  }

  // --- gravação -------------------------------------------------------
  // MediaRecorder direto sobre canvas.captureStream() — nenhuma lib de
  // vídeo/GIF: o navegador já sabe codificar WebM sozinho, e o projeto não
  // usa dependências externas (ver CLAUDE.md/comentários do projeto).
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

  // --- gravação em GIF --------------------------------------------------
  // captura periódica de quadros JÁ REDUZIDOS (gifCanvas, bem menor que o
  // canvas de exibição) — bem mais barato que guardar quadros no tamanho de
  // tela inteiro, e o resultado final é um GIF, que nunca precisou da
  // resolução cheia mesmo. Guarda também as dimensões DO MOMENTO em que a
  // gravação começou (gifRecordingSize) — se a pessoa trocar de formato no
  // meio da gravação, os quadros já capturados continuam consistentes entre
  // si em vez de misturar tamanhos diferentes no mesmo GIF.
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

  // paleta do GIF: nos modos "cor única"/"paleta" o motor já desenha com um
  // conjunto bem pequeno e conhecido de cores (fundo + tinta, ou fundo +
  // paleta do Azulejo) — usar essas cores DIRETO como paleta do GIF (em vez
  // de escanear pixel por pixel) é exato e instantâneo. Só o modo "cores do
  // vídeo" (RGB livre, quase contínuo) precisa de verdade escanear uma
  // amostra de pixels pra montar uma paleta que represente bem o que foi
  // capturado.
  function buildGifPalette() {
    if (options.colorMode === 'source') {
      const buckets = new Map();
      const sampleFrames = [gifFrames[0], gifFrames[Math.floor(gifFrames.length / 2)], gifFrames[gifFrames.length - 1]].filter(Boolean);
      for (const frame of sampleFrames) {
        for (let i = 0; i < frame.length; i += 4 * 7) {
          // amostra 1 a cada ~7 pixels — de sobra pra representar as cores
          // predominantes sem escanear TODO pixel de TODO quadro amostrado.
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
    return [options.background, options.inkColor];
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
    clearSource();
    if (isRecording()) recorder.stop();
    if (isGifRecording()) clearInterval(gifTimerId);
  }

  return {
    video,
    setOptions,
    loadFile,
    enableWebcam,
    listCameras,
    getActiveDeviceId: () => activeDeviceId,
    stopWebcam: () => {
      clearSource();
      renderIdleFrame();
    },
    hasSource,
    isWebcamActive: () => Boolean(webcamStream),
    setPaused: (value) => {
      paused = value;
    },
    isPaused: () => paused,
    start,
    stop,
    startRecording,
    stopRecording,
    isRecording,
    startGifRecording,
    stopGifRecording,
    isGifRecording,
    renderFrame,
    destroy,
    getCanvas: () => outputCanvas,
    // cols/rows reais da grade AGORA (depois de framedGridDims já ter
    // arredondado) — quem monta a UI usa isso pra ajustar o aspect-ratio do
    // preview certinho, em vez de recalcular a mesma conta duas vezes.
    getGridSize: () => ({ cols: options.cols, rows: options.rows }),
  };

  // quadro "vazio" (só o fundo) — mostrado assim que a fonte é removida, em
  // vez de deixar o último quadro do vídeo congelado no canvas pra sempre.
  function renderIdleFrame() {
    ctx.fillStyle = options.background;
    ctx.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
  }
}
