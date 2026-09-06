import { t, onLangChange } from '../../core/i18n.js';
import { createSlider } from '../../ui/controls/slider.js';
import { createSelect } from '../../ui/controls/select.js';
import { createToggleSwitch } from '../../ui/controls/toggleSwitch.js';
import { createFrameTilePicker } from '../../ui/controls/frameTilePicker.js';
import { createButton, flashExportSuccess } from '../../ui/controls/button.js';
import { createSection } from '../../ui/controls/section.js';
import { downloadBlob, EXPORT_FRAME_RATIOS } from '../../core/export.js';
import { patternState } from '../../core/patternState.js';
import { SYMMETRY_VALUES } from '../../core/symmetry.js';
import { SHAPES } from '../grid-icons/shapes.js';
import { framedGridDims } from '../grid-icons/generator.js';
import { VIDEO_SHAPES } from './shapes.js';
import { createVideoTilesEngine } from './engine.js';

// mesmas 4 opções do seletor "Formato" do Azulejo (ver frameTileOptions em
// grid-icons/index.js) — reaproveitadas ao pé da letra (mesmo componente
// visual, createFrameTilePicker) pra ficar fiel às proporções reais de
// vídeo mais comuns (quadrado, retrato de feed, story/reels, paisagem).
// Função (não uma lista fixa) pelo mesmo motivo de lá: os rótulos (label)
// precisam ler t() de novo a cada troca de idioma, não travar no que
// existia quando o módulo carregou.
function frameOptions() {
  return [
    { value: 'square', ratio: EXPORT_FRAME_RATIOS.square, label: t('exportFrame_square'), caption: '1:1' },
    { value: 'portrait', ratio: EXPORT_FRAME_RATIOS.portrait, label: t('exportFrame_portrait'), caption: '4:5' },
    { value: 'story', ratio: EXPORT_FRAME_RATIOS.story, label: t('exportFrame_story'), caption: '9:16' },
    { value: 'landscape', ratio: EXPORT_FRAME_RATIOS.landscape, label: t('exportFrame_landscape'), caption: '16:9' },
  ];
}

// prévia de cada forma na grade de "Forma" — mesmo espírito da grade de
// ícones do Azulejo (shapeToggleGrid.js): cada opção mostra o próprio
// desenho SVG real da forma (não um nome sozinho), fill="currentColor" pra
// seguir a cor do texto do botão (cinza normal, creme quando .active — ver
// .shape-toggle no style.css). "Variado" ganha uma prévia própria (2x2 de 4
// formas diferentes), já que não existe um SHAPES['mixed'] de verdade.
const SHAPE_PREVIEW_SIZE = 22;
const MIXED_PREVIEW_KEYS = ['square', 'disc', 'diamond', 'triangle'];
function renderShapePreviewSvg(shapeKey) {
  if (shapeKey === 'mixed') {
    const half = SHAPE_PREVIEW_SIZE / 2;
    const cells = MIXED_PREVIEW_KEYS.map((key, i) => {
      const x = (i % 2) * half;
      const y = Math.floor(i / 2) * half;
      return `<g transform="translate(${x}, ${y})">${SHAPES[key].draw(half, 'currentColor', 'tl')}</g>`;
    }).join('');
    return `<svg viewBox="0 0 ${SHAPE_PREVIEW_SIZE} ${SHAPE_PREVIEW_SIZE}" width="${SHAPE_PREVIEW_SIZE}" height="${SHAPE_PREVIEW_SIZE}">${cells}</svg>`;
  }
  const inner = SHAPES[shapeKey].draw(SHAPE_PREVIEW_SIZE, 'currentColor', 'tl');
  return `<svg viewBox="0 0 ${SHAPE_PREVIEW_SIZE} ${SHAPE_PREVIEW_SIZE}" width="${SHAPE_PREVIEW_SIZE}" height="${SHAPE_PREVIEW_SIZE}">${inner}</svg>`;
}

// estado só do modo Vídeo — mesmo espírito do mosaicState (mosaic/index.js):
// vive no escopo do módulo, sobrevive a trocar de aba e voltar.
const videoState = {
  resolution: 32,
  // formato/proporção real — 'square' por padrão, mesmas 4 opções do
  // seletor de Formato do Azulejo (ver frameOptions acima).
  format: 'square',
  ratio: EXPORT_FRAME_RATIOS.square,
  shapeScale: 1,
  // "mixed" + "palette" por padrão — replica de cara o mesmo azulejo (formas
  // e cores) que já está configurado na aba Azulejo, igual o Mosaico faz,
  // em vez de começar com um visual genérico à parte (ver applyOptionsAndMaybePalette,
  // que também manda o shapesAllowed do Azulejo pro motor).
  shapeMode: 'mixed',
  colorMode: 'palette',
  inkColor: '#f5efe4',
  background: '#141210',
  invert: false,
  trail: 0,
  symmetry: 'none',
};

let cleanupLang = null;
let engine = null;
let recordTimerId = null;
let gifTimerId = null;

function shapeLabel(shape) {
  return shape === 'mixed' ? t('videoShapeMixed') : t(`shape_${shape}`);
}

function formatSeconds(totalMs) {
  const s = Math.floor(totalMs / 1000);
  const mm = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

export const videoTilesModule = {
  id: 'video',
  label: () => t('tabVideo'),

  async mount(container) {
    const root = document.createElement('div');
    root.className = 'mo-layout';

    const sidebar = document.createElement('div');
    sidebar.className = 'mo-controls';

    const stage = document.createElement('div');
    stage.className = 'mo-stage';

    const resultTitle = document.createElement('div');
    resultTitle.className = 'mo-result-title';
    resultTitle.textContent = t('videoResultTitle');

    const previewWrap = document.createElement('div');
    previewWrap.className = 'vt-preview-wrap';
    const canvas = document.createElement('canvas');
    canvas.className = 'vt-canvas';
    previewWrap.appendChild(canvas);

    const sourceHint = document.createElement('div');
    sourceHint.className = 'vt-source-hint';
    sourceHint.textContent = t('videoSourceHint');
    previewWrap.appendChild(sourceHint);

    const errorMsg = document.createElement('p');
    errorMsg.className = 'control-hint vt-error';
    errorMsg.hidden = true;

    engine = createVideoTilesEngine(canvas);
    engine.setOptions(videoState);
    // o <video> nunca é exibido (o canvas é o que aparece) mas precisa
    // existir no DOM mesmo assim — alguns navegadores pausam/desaceleram a
    // decodificação de um <video> totalmente fora da árvore (nunca
    // inserido), mesmo sem display:none.
    engine.video.className = 'vt-source-video';
    previewWrap.appendChild(engine.video);

    function applyOptionsAndMaybePalette() {
      // shapesAllowed/colors vêm sempre ao vivo do patternState (a mesma
      // "receita" que a aba Azulejo edita) — não uma cópia tirada uma vez só
      // no mount, então mudar as formas/cores lá enquanto já se está na aba
      // Vídeo reflete aqui na hora, do mesmo jeito que o Mosaico já faz.
      engine.setOptions({
        ...videoState,
        paletteColors: patternState.colors,
        shapesAllowed: patternState.shapesAllowed,
      });
      // o preview segue o formato ESCOLHIDO (retrato/story/paisagem não são
      // quadrados) — cols/rows já vêm arredondados pelo motor (framedGridDims),
      // então o aspect-ratio do preview usa exatamente os mesmos números da
      // grade, sem repetir a conta aqui.
      const { cols, rows } = engine.getGridSize();
      previewWrap.style.aspectRatio = `${cols} / ${rows}`;
      // limita a LARGURA (não só a altura) num formato bem vertical (story
      // 9:16): só travar max-height deixaria width:100% esticando/cortando
      // o canvas, já que aspect-ratio sozinho não "encolhe de volta" a
      // largura quando a altura bate no teto. Calculando o max-width em px
      // a partir da altura disponível (78% da viewport) as duas travas
      // (largura do stage E altura da tela) valem ao mesmo tempo.
      const maxWidthFromHeight = window.innerHeight * 0.78 * (cols / rows);
      previewWrap.style.maxWidth = `${Math.round(maxWidthFromHeight)}px`;
    }

    function updateSourceHint() {
      sourceHint.hidden = engine.hasSource();
    }

    let recordButton;
    let gifButton;
    let freezeButton;
    let webcamButton;
    let cameraSelectSlot;

    function stopRecordTimer() {
      if (recordTimerId) {
        clearInterval(recordTimerId);
        recordTimerId = null;
      }
    }

    function stopGifTimer() {
      if (gifTimerId) {
        clearInterval(gifTimerId);
        gifTimerId = null;
      }
    }

    async function handleRecordClick() {
      if (engine.isRecording()) {
        stopRecordTimer();
        const blob = await engine.stopRecording();
        recordButton.el.querySelector('.control-button-label').textContent = t('videoRecordButton');
        recordButton.el.classList.remove('vt-recording');
        if (blob) {
          downloadBlob(blob, 'kata-video.webm');
          flashExportSuccess(recordButton.el);
        }
        return;
      }
      if (!engine.hasSource()) return;
      engine.startRecording();
      recordButton.el.classList.add('vt-recording');
      const startedAt = Date.now();
      const labelEl = recordButton.el.querySelector('.control-button-label');
      labelEl.textContent = `${t('videoStopRecordButton')} · 0:00`;
      recordTimerId = setInterval(() => {
        labelEl.textContent = `${t('videoStopRecordButton')} · ${formatSeconds(Date.now() - startedAt)}`;
      }, 500);
    }

    async function handleGifClick() {
      if (engine.isGifRecording()) {
        stopGifTimer();
        const blob = await engine.stopGifRecording();
        gifButton.el.querySelector('.control-button-label').textContent = t('videoGifButton');
        gifButton.el.classList.remove('vt-recording');
        if (blob) {
          downloadBlob(blob, 'kata-video.gif');
          flashExportSuccess(gifButton.el);
        }
        return;
      }
      if (!engine.hasSource()) return;
      engine.startGifRecording();
      gifButton.el.classList.add('vt-recording');
      const startedAt = Date.now();
      const labelEl = gifButton.el.querySelector('.control-button-label');
      labelEl.textContent = `${t('videoStopGifButton')} · 0:00`;
      gifTimerId = setInterval(() => {
        labelEl.textContent = `${t('videoStopGifButton')} · ${formatSeconds(Date.now() - startedAt)}`;
        // o motor para sozinho ao bater no teto de duração do GIF (ver
        // GIF_MAX_SECONDS em engine.js) — sem isso o timer visual continuaria
        // contando mesmo depois da gravação de verdade já ter parado.
        if (!engine.isGifRecording()) handleGifClick();
      }, 500);
    }

    // enumerateDevices() só devolve os deviceId/label de verdade depois de
    // uma permissão de câmera já concedida — por isso só monta esse seletor
    // depois de ligar a webcam ao menos uma vez, nunca antes.
    async function refreshCameraSelect() {
      cameraSelectSlot.innerHTML = '';
      if (!engine.isWebcamActive()) return;
      const cameras = await engine.listCameras();
      if (cameras.length < 2) return;
      const select = createSelect({
        label: t('videoCameraLabel'),
        options: cameras.map((cam, i) => ({ value: cam.deviceId, label: cam.label || `${t('videoCameraLabel')} ${i + 1}` })),
        value: engine.getActiveDeviceId() || cameras[0].deviceId,
        onChange: async (deviceId) => {
          try {
            await engine.enableWebcam(deviceId);
          } catch (err) {
            errorMsg.textContent = `${t('videoWebcamError')} (${err?.name || err?.message || err})`;
            errorMsg.hidden = false;
          }
        },
      });
      cameraSelectSlot.appendChild(select.el);
    }

    function buildSidebar() {
      sidebar.innerHTML = '';

      const uploadInput = document.createElement('input');
      uploadInput.type = 'file';
      uploadInput.accept = 'video/*';
      uploadInput.className = 'mo-file-input vt-file-input';
      uploadInput.addEventListener('change', () => {
        const file = uploadInput.files?.[0];
        if (!file) return;
        errorMsg.hidden = true;
        engine.stopWebcam();
        webcamButton.el.querySelector('.control-button-label').textContent = t('videoWebcamButton');
        engine.loadFile(file);
        updateSourceHint();
        refreshCameraSelect();
      });
      const uploadButton = createButton({
        label: t('videoUploadButton'),
        variant: 'accent2',
        onClick: () => uploadInput.click(),
      });

      webcamButton = createButton({
        label: t('videoWebcamButton'),
        variant: 'primary',
        onClick: async () => {
          const labelEl = webcamButton.el.querySelector('.control-button-label');
          if (engine.isWebcamActive()) {
            engine.stopWebcam();
            labelEl.textContent = t('videoWebcamButton');
            updateSourceHint();
            refreshCameraSelect();
            return;
          }
          try {
            errorMsg.hidden = true;
            await engine.enableWebcam();
            labelEl.textContent = t('videoWebcamStopButton');
            updateSourceHint();
            refreshCameraSelect();
          } catch (err) {
            // mostra o motivo REAL (err.name — NotAllowedError, NotFoundError,
            // NotReadableError, SecurityError...) junto da mensagem, não só um
            // "não foi possível" genérico — é o que ajuda a diferenciar
            // "permissão negada" de "nenhuma câmera encontrada" de "outro app
            // já está usando a câmera", que pedem soluções bem diferentes
            // (alguns navegadores, como o Brave, bloqueiam por padrão via
            // Shields, mesmo depois de aceitar o prompt do site).
            errorMsg.textContent = `${t('videoWebcamError')} (${err?.name || err?.message || err})`;
            errorMsg.hidden = false;
          }
        },
      });

      const sourceRow = document.createElement('div');
      sourceRow.className = 'vt-source-row';
      sourceRow.appendChild(uploadButton.el);
      sourceRow.appendChild(webcamButton.el);
      cameraSelectSlot = document.createElement('div');
      sidebar.appendChild(createSection(t('videoSourceSection'), [sourceRow, cameraSelectSlot, uploadInput, errorMsg]));
      // reconstrói o seletor de câmeras a cada rebuild da sidebar também
      // (troca de idioma, etc.) — sem isso ele sumiria (a sidebar inteira é
      // reconstruída do zero) mesmo com a webcam continuando ativa por trás.
      refreshCameraSelect();

      const framePicker = createFrameTilePicker({
        options: frameOptions(),
        value: videoState.format,
        onChange: (value) => {
          videoState.format = value;
          videoState.ratio = EXPORT_FRAME_RATIOS[value];
          // reconstrói a sidebar inteira (não só aplica as opções) — o
          // rótulo do slider de Resolução mostra "colsxrows" calculado a
          // partir do ratio (ver formatValue mais abaixo); sem recriar o
          // slider, ele ficava mostrando o par antigo até a próxima vez que
          // a pessoa arrastasse o próprio slider.
          buildSidebar();
          applyOptionsAndMaybePalette();
        },
      });
      sidebar.appendChild(createSection(t('formatSectionTitle'), [framePicker.el]));

      const gridElements = [
        createSlider({
          label: t('videoResolutionLabel'),
          min: 8,
          max: 96,
          step: 1,
          value: videoState.resolution,
          // calcula cols×rows na hora (mesma conta do motor, framedGridDims)
          // em vez de ler o que o motor já aplicou — assim o número mostrado
          // acompanha o dedo arrastando o slider sem ficar 1 passo atrasado
          // (onChange só dispara depois que o rótulo já foi atualizado).
          formatValue: (v) => {
            const { cols, rows } = framedGridDims(v, videoState.ratio);
            return `${cols}×${rows}`;
          },
          onChange: (value) => {
            videoState.resolution = value;
            applyOptionsAndMaybePalette();
          },
        }).el,
        createSlider({
          label: t('videoShapeScaleLabel'),
          min: 20,
          max: 140,
          step: 5,
          value: Math.round(videoState.shapeScale * 100),
          formatValue: (v) => `${v}%`,
          onChange: (value) => {
            videoState.shapeScale = value / 100;
            applyOptionsAndMaybePalette();
          },
        }).el,
        createToggleSwitch({
          label: t('invertColorsLabel'),
          value: videoState.invert,
          onChange: (checked) => {
            videoState.invert = checked;
            applyOptionsAndMaybePalette();
          },
        }).el,
      ];
      sidebar.appendChild(createSection(t('videoGridSection'), gridElements));

      // só as formas que já estão ATIVAS no Azulejo (patternState.shapesAllowed)
      // + "Variado" — herda a escolha de lá em vez de oferecer o catálogo
      // inteiro (20 formas) independente do que a pessoa já configurou.
      // Vazio (Azulejo nunca montado ainda) cai de volta pro catálogo
      // inteiro, só pra nunca mostrar a grade de opções vazia.
      const availableShapes = patternState.shapesAllowed.length ? patternState.shapesAllowed : VIDEO_SHAPES;
      const shapeChipOptions = [...availableShapes, 'mixed'];
      // se a forma selecionada não está mais disponível (a pessoa desligou
      // ela no Azulejo enquanto isso), volta pro "Variado" em vez de ficar
      // com uma seleção que não aparece mais na grade.
      if (videoState.shapeMode !== 'mixed' && !availableShapes.includes(videoState.shapeMode)) {
        videoState.shapeMode = 'mixed';
      }

      const shapeWrap = document.createElement('div');
      shapeWrap.className = 'control control-shape-grid';
      const shapeLabelSpan = document.createElement('span');
      shapeLabelSpan.className = 'control-label';
      shapeLabelSpan.textContent = t('videoShapeLabel');
      shapeWrap.appendChild(shapeLabelSpan);
      const shapeRow = document.createElement('div');
      shapeRow.className = 'shape-toggle-row';
      shapeChipOptions.forEach((shapeKey) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'shape-toggle';
        btn.title = shapeLabel(shapeKey);
        btn.classList.toggle('active', videoState.shapeMode === shapeKey);
        btn.innerHTML = renderShapePreviewSvg(shapeKey);
        btn.addEventListener('click', () => {
          videoState.shapeMode = shapeKey;
          applyOptionsAndMaybePalette();
          shapeRow.querySelectorAll('.shape-toggle').forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
        });
        shapeRow.appendChild(btn);
      });
      shapeWrap.appendChild(shapeRow);
      sidebar.appendChild(createSection(t('videoShapeSection'), [shapeWrap]));

      const effectsElements = [
        createSlider({
          label: t('videoTrailLabel'),
          min: 0,
          max: 95,
          step: 5,
          value: Math.round(videoState.trail * 100),
          formatValue: (v) => `${v}%`,
          onChange: (value) => {
            videoState.trail = value / 100;
            applyOptionsAndMaybePalette();
          },
        }).el,
        createSelect({
          label: t('symmetryTypeLabel'),
          options: SYMMETRY_VALUES.map((value) => ({ value, label: t(`symmetry_${value}`) })),
          value: videoState.symmetry,
          onChange: (value) => {
            videoState.symmetry = value;
            applyOptionsAndMaybePalette();
          },
        }).el,
      ];
      sidebar.appendChild(createSection(t('videoEffectsSection'), effectsElements));

      const colorElements = [
        createSelect({
          label: t('videoColorModeLabel'),
          options: [
            { value: 'grayscale', label: t('videoColorModeGrayscale') },
            { value: 'source', label: t('videoColorModeSource') },
            { value: 'palette', label: t('videoColorModePalette') },
          ],
          value: videoState.colorMode,
          onChange: (value) => {
            videoState.colorMode = value;
            buildSidebar();
            applyOptionsAndMaybePalette();
          },
        }).el,
      ];
      if (videoState.colorMode === 'grayscale') {
        const inkRow = document.createElement('div');
        inkRow.className = 'control control-stroke-color';
        const inkLabel = document.createElement('span');
        inkLabel.className = 'control-label';
        inkLabel.textContent = t('videoInkColorLabel');
        const inkInput = document.createElement('input');
        inkInput.type = 'color';
        inkInput.className = 'stroke-color-input';
        inkInput.value = videoState.inkColor;
        inkInput.addEventListener('input', () => {
          videoState.inkColor = inkInput.value;
          applyOptionsAndMaybePalette();
        });
        inkRow.appendChild(inkLabel);
        inkRow.appendChild(inkInput);
        colorElements.push(inkRow);
      }
      const bgRow = document.createElement('div');
      bgRow.className = 'control control-background-color';
      const bgLabel = document.createElement('span');
      bgLabel.className = 'control-label';
      bgLabel.textContent = t('backgroundColorLabel');
      const bgInput = document.createElement('input');
      bgInput.type = 'color';
      bgInput.className = 'background-color-input';
      bgInput.value = videoState.background;
      bgInput.addEventListener('input', () => {
        videoState.background = bgInput.value;
        applyOptionsAndMaybePalette();
      });
      bgRow.appendChild(bgLabel);
      bgRow.appendChild(bgInput);
      colorElements.push(bgRow);
      sidebar.appendChild(createSection(t('videoColorSection'), colorElements));

      freezeButton = createButton({
        label: engine.isPaused() ? t('videoUnfreezeButton') : t('videoFreezeButton'),
        onClick: () => {
          const next = !engine.isPaused();
          engine.setPaused(next);
          freezeButton.el.querySelector('.control-button-label').textContent = next ? t('videoUnfreezeButton') : t('videoFreezeButton');
        },
      });
      recordButton = createButton({
        label: t('videoRecordButton'),
        variant: 'primary',
        onClick: handleRecordClick,
      });
      gifButton = createButton({
        label: t('videoGifButton'),
        variant: 'primary',
        onClick: handleGifClick,
      });
      const frameButton = createButton({
        label: t('videoDownloadFrameButton'),
        onClick: () => {
          canvas.toBlob((blob) => {
            if (blob) downloadBlob(blob, 'kata-video-quadro.png');
            flashExportSuccess(frameButton.el);
          }, 'image/png');
        },
      });
      const actions = document.createElement('div');
      actions.className = 'mo-actions';
      actions.appendChild(freezeButton.el);
      actions.appendChild(recordButton.el);
      actions.appendChild(gifButton.el);
      actions.appendChild(frameButton.el);
      sidebar.appendChild(createSection(t('videoRecordSection'), [actions]));
    }

    buildSidebar();
    updateSourceHint();
    applyOptionsAndMaybePalette();

    stage.appendChild(resultTitle);
    stage.appendChild(previewWrap);
    root.appendChild(sidebar);
    root.appendChild(stage);
    container.appendChild(root);

    engine.start();

    cleanupLang = onLangChange(() => {
      resultTitle.textContent = t('videoResultTitle');
      sourceHint.textContent = t('videoSourceHint');
      buildSidebar();
      updateSourceHint();
    });
  },

  unmount() {
    stopRecordTimerCleanup();
    stopGifTimerCleanup();
    if (engine) {
      engine.destroy();
      engine = null;
    }
    if (cleanupLang) {
      cleanupLang();
      cleanupLang = null;
    }
  },
};

function stopRecordTimerCleanup() {
  if (recordTimerId) {
    clearInterval(recordTimerId);
    recordTimerId = null;
  }
}

function stopGifTimerCleanup() {
  if (gifTimerId) {
    clearInterval(gifTimerId);
    gifTimerId = null;
  }
}
