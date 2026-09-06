import { t, onLangChange } from '../../core/i18n.js';
import { createSlider } from '../../ui/controls/slider.js';
import { createSelect } from '../../ui/controls/select.js';
import { createIconSelect } from '../../ui/controls/iconSelect.js';
import { createShapeToggleGrid } from '../../ui/controls/shapeToggleGrid.js';
import { createColorSwatches } from '../../ui/controls/colorSwatches.js';
import { createToggleSwitch } from '../../ui/controls/toggleSwitch.js';
import { createFrameTilePicker } from '../../ui/controls/frameTilePicker.js';
import { createButton, flashExportSuccess } from '../../ui/controls/button.js';
import { createSection } from '../../ui/controls/section.js';
import { downloadBlob, EXPORT_FRAME_RATIOS } from '../../core/export.js';
import { patternState } from '../../core/patternState.js';
import { SYMMETRY_VALUES } from '../../core/symmetry.js';
import { hexToHsl, hslToHex } from '../../core/color.js';
import { loadThemes, applyTheme, themePreviewColorsFor } from '../../core/themes.js';
import { SHAPES } from '../grid-icons/shapes.js';
import { framedGridDims, buildCustomShapeDefs } from '../grid-icons/generator.js';
import { CATEGORY_ICONS } from '../../ui/categoryIcons.js';
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

// estado só do modo Espelho — mesmo espírito do mosaicState (mosaic/index.js):
// vive no escopo do módulo, sobrevive a trocar de aba e voltar. Formas,
// cores, fundo e tema NÃO moram aqui — vêm direto do patternState
// (compartilhado com o Azulejo, ver applyOptionsAndMaybePalette), pelo mesmo
// motivo do Mosaico: editar aqui deve refletir lá e vice-versa, sem cópia
// nenhuma pra dessincronizar.
const videoState = {
  resolution: 32,
  // formato/proporção real — 'square' por padrão, mesmas 4 opções do
  // seletor de Formato do Azulejo (ver frameOptions acima).
  format: 'square',
  ratio: EXPORT_FRAME_RATIOS.square,
  shapeScale: 1,
  colorMode: 'palette',
  inkColor: '#f5efe4',
  // paleta própria do Espelho (modo "Paleta personalizada") — independente
  // do patternState.colors do Azulejo, pra quem quiser uma paleta só pra
  // esse efeito sem mexer na do Azulejo. Mesmo formato de patternState.colors
  // ({color, weight}) só pra reaproveitar createColorSwatches sem adaptar nada.
  customPaletteColors: [
    { color: '#ea4530', weight: 1 },
    { color: '#3aa1d8', weight: 1 },
  ],
  // paradas do modo "Gradiente", em ORDEM (a ordem é o que define o
  // gradiente — ver interpolateGradient em engine.js). Padrão usa as
  // próprias cores da marca (fundo escuro → vermelho → creme).
  gradientColors: [
    { color: '#141210', weight: 1 },
    { color: '#ea4530', weight: 1 },
    { color: '#f5efe4', weight: 1 },
  ],
  invert: false,
  trail: 0,
  symmetry: 'none',
};

let cleanupLang = null;
let engine = null;
let recordTimerId = null;
let gifTimerId = null;

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
    // mesmo dicionário de temas do Azulejo (ver core/themes.js) — carregado
    // de novo aqui (fetch é barato/cacheado) em vez de depender da aba
    // Azulejo já ter carregado antes.
    const themes = await loadThemes();
    const themeKeys = Object.keys(themes);
    // aba de categorias (ícone em cima, nome embaixo) só no mobile — mesmo
    // mecanismo do Azulejo (ver .vt-controls/.gi-mobile-category-tabs no
    // style.css), calculado 1x no mount (não muda se girar a tela depois,
    // mesma decisão já tomada no Azulejo).
    const isMobileViewport = window.matchMedia('(max-width: 768px)').matches;
    // qual categoria está aberta AGORA no mobile — precisa sobreviver a um
    // buildSidebar() (rebuild completo a cada ajuste), senão mexer em
    // qualquer coisa fechava o painel sozinho.
    let mobileActiveCategoryId = null;

    const root = document.createElement('div');
    root.className = 'mo-layout';

    const sidebar = document.createElement('div');
    // .vt-controls (além de .mo-controls) só entra em ação dentro do
    // media query mobile (ver style.css) — vira o "bottom sheet" fixo com
    // aba de categorias; no desktop não muda nada (.mo-controls sozinho já
    // dá conta).
    sidebar.className = 'mo-controls vt-controls';

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
        background: patternState.background || '#141210',
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
      sidebar.appendChild(createSection(t('videoSourceSection'), [sourceRow, cameraSelectSlot, uploadInput, errorMsg], { id: 'source' }));
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
      sidebar.appendChild(createSection(t('formatSectionTitle'), [framePicker.el], { id: 'format' }));

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
      sidebar.appendChild(createSection(t('videoGridSection'), gridElements, { id: 'grid' }));

      // EXATAMENTE o mesmo seletor de formas do Azulejo (mesmo componente,
      // mesmo catálogo inteiro — incluindo ícones personalizados enviados
      // por lá) — não um recorte só das ativas. `value` começa com as que
      // já estão ligadas no Azulejo (patternState.shapesAllowed), mas dali
      // pra frente é um multi-seleção de verdade: liga/desliga aqui muda o
      // patternState direto, então volta refletido no Azulejo também (a
      // mesma "receita" compartilhada, igual cores/tema abaixo).
      const shapesGrid = createShapeToggleGrid({
        label: t('shapesSection'),
        shapes: { ...SHAPES, ...buildCustomShapeDefs(patternState.customShapes) },
        value: patternState.shapesAllowed,
        onChange: (value) => {
          patternState.shapesAllowed = value;
          applyOptionsAndMaybePalette();
        },
      });
      sidebar.appendChild(createSection(t('shapesSection'), [shapesGrid.el], { id: 'shapes' }));

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
      sidebar.appendChild(createSection(t('videoEffectsSection'), effectsElements, { id: 'effects' }));

      // "Tema" — mesmo dicionário/lógica do Azulejo (core/themes.js):
      // aplica direto no patternState compartilhado, então troca de tema
      // aqui também aparece se voltar pro Azulejo (e vice-versa). Prévia
      // com bolinhas de cor, igual ao combo de lá — só o mecanismo do
      // dropdown em si é o genérico (createIconSelect) em vez do combo
      // com posicionamento próprio do Azulejo, pra não duplicar aquele
      // tanto de código só pra isso.
      function renderThemeDots(key) {
        const wrap = document.createElement('span');
        wrap.className = 'theme-combo-preview';
        themePreviewColorsFor(key, themes)
          .slice(0, 4)
          .forEach((color) => {
            const dot = document.createElement('span');
            dot.className = 'theme-combo-dot';
            dot.style.background = color;
            wrap.appendChild(dot);
          });
        return wrap;
      }
      const themeSelect = createIconSelect({
        label: t('themeLabel'),
        options: [
          ...(patternState.themeKey === 'custom' ? [{ value: 'custom', label: t('customThemeLabel'), renderIcon: () => renderThemeDots('custom') }] : []),
          ...themeKeys.map((key) => ({ value: key, label: t(`theme_${key}`), renderIcon: () => renderThemeDots(key) })),
        ],
        value: patternState.themeKey ?? themeKeys[0],
        onChange: (value) => {
          if (value === 'custom') return;
          applyTheme(value, themes);
          buildSidebar();
          applyOptionsAndMaybePalette();
        },
      });
      sidebar.appendChild(createSection(t('themeSectionTitle'), [themeSelect.el], { id: 'theme' }));

      const colorElements = [
        createSelect({
          label: t('videoColorModeLabel'),
          options: [
            { value: 'grayscale', label: t('videoColorModeGrayscale') },
            { value: 'source', label: t('videoColorModeSource') },
            { value: 'palette', label: t('videoColorModePalette') },
            { value: 'custom', label: t('videoColorModeCustom') },
            { value: 'gradient', label: t('videoColorModeGradient') },
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
      if (videoState.colorMode === 'palette') {
        // MESMOS controles de cor do Azulejo (createColorSwatches + girar
        // matiz), editando o patternState.colors compartilhado direto —
        // não uma paleta separada só do Espelho.
        const colorSwatches = createColorSwatches({
          label: t('paletteLabel'),
          colors: patternState.colors,
          onChange: (colors) => {
            patternState.colors = colors;
            patternState.themeKey = 'custom';
            applyOptionsAndMaybePalette();
          },
        });
        colorElements.push(colorSwatches.el);

        const ROTATE_COLORS_HUE_STEP = 30;
        const rotateColorsButton = createButton({
          label: t('rotateColorsButton'),
          onClick: () => {
            patternState.colors = patternState.colors.map((entry) => {
              const { h, s, l } = hexToHsl(entry.color);
              return { ...entry, color: hslToHex(h + ROTATE_COLORS_HUE_STEP, s, l) };
            });
            patternState.themeKey = 'custom';
            buildSidebar();
            applyOptionsAndMaybePalette();
          },
        });
        colorElements.push(rotateColorsButton.el);
      }
      if (videoState.colorMode === 'custom') {
        // paleta própria do Espelho — mesmo controle (createColorSwatches),
        // mas editando videoState.customPaletteColors, não o patternState
        // compartilhado do Azulejo.
        const customSwatches = createColorSwatches({
          label: t('videoColorModeCustom'),
          colors: videoState.customPaletteColors,
          onChange: (colors) => {
            videoState.customPaletteColors = colors;
            applyOptionsAndMaybePalette();
          },
        });
        colorElements.push(customSwatches.el);
      }
      if (videoState.colorMode === 'gradient') {
        // mesmo controle de sempre, mas aqui a ORDEM das cores É o gradiente
        // (não pesos de sorteio) — célula escura puxa pra primeira cor,
        // clara puxa pra última, o meio interpola (ver interpolateGradient
        // em engine.js). "Tamanho das formas" para de reagir à luminância
        // nesse modo — quem reage é só a cor.
        const gradientSwatches = createColorSwatches({
          label: t('videoGradientLabel'),
          colors: videoState.gradientColors,
          onChange: (colors) => {
            videoState.gradientColors = colors;
            applyOptionsAndMaybePalette();
          },
        });
        colorElements.push(gradientSwatches.el);
      }
      const bgRow = document.createElement('div');
      bgRow.className = 'control control-background-color';
      const bgLabel = document.createElement('span');
      bgLabel.className = 'control-label';
      bgLabel.textContent = t('backgroundColorLabel');
      const bgInput = document.createElement('input');
      bgInput.type = 'color';
      bgInput.className = 'background-color-input';
      bgInput.value = patternState.background || '#141210';
      bgInput.addEventListener('input', () => {
        // mesmo fundo do Azulejo (patternState.background) — não um separado
        // só do Espelho.
        patternState.background = bgInput.value;
        patternState.themeKey = 'custom';
        applyOptionsAndMaybePalette();
      });
      bgRow.appendChild(bgLabel);
      bgRow.appendChild(bgInput);
      colorElements.push(bgRow);
      sidebar.appendChild(createSection(t('videoColorSection'), colorElements, { id: 'colors' }));

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
      sidebar.appendChild(createSection(t('videoRecordSection'), [actions], { id: 'record' }));

      // --- aba de categorias (só no mobile) --- mesmo mecanismo de
      // :has() + radio escondido do Azulejo (ver comentário grandão em
      // grid-icons/index.js) — ícone por seção (ui/categoryIcons.js),
      // reaproveitando as MESMAS classes CSS (.gi-mobile-category-tabs*),
      // só que a visibilidade é controlada por .vt-controls (não
      // .gi-controls), escopado só pro Espelho.
      if (isMobileViewport) {
        const categorySections = Array.from(sidebar.querySelectorAll('.control-section[data-section-id]'));
        if (categorySections.length) {
          const categoryTabs = document.createElement('div');
          categoryTabs.className = 'gi-mobile-category-tabs';
          categorySections.forEach((section) => {
            const sectionId = section.dataset.sectionId;
            const title = section.querySelector('.control-section-title')?.textContent ?? sectionId;
            const inputId = `vt-cat-${sectionId}`;

            const input = document.createElement('input');
            input.type = 'radio';
            input.name = 'vt-category-tab';
            input.id = inputId;
            input.className = 'gi-mobile-category-tabs-input';
            input.checked = sectionId === mobileActiveCategoryId;

            const tabLabel = document.createElement('label');
            tabLabel.htmlFor = inputId;
            tabLabel.className = 'gi-mobile-category-tabs-label';
            const iconMarkup = CATEGORY_ICONS[sectionId];
            tabLabel.innerHTML =
              (iconMarkup ? `<span class="gi-mobile-category-tabs-icon">${iconMarkup}</span>` : '') +
              `<span class="gi-mobile-category-tabs-text">${title}</span>`;

            // tocar de novo no ícone já ativo FECHA o painel (mesmo truque
            // do Azulejo — radio nativo não desmarca sozinho ao clicar de
            // novo nele).
            tabLabel.addEventListener('click', (e) => {
              if (input.checked) {
                e.preventDefault();
                input.checked = false;
                mobileActiveCategoryId = null;
                categoryTabs.dispatchEvent(new Event('change', { bubbles: true }));
              } else {
                mobileActiveCategoryId = sectionId;
              }
            });

            categoryTabs.appendChild(input);
            categoryTabs.appendChild(tabLabel);
          });
          sidebar.appendChild(categoryTabs);

          categoryTabs.addEventListener('change', () => {
            const checkedInput = categoryTabs.querySelector('.gi-mobile-category-tabs-input:checked');
            mobileActiveCategoryId = checkedInput ? checkedInput.id.replace('vt-cat-', '') : null;
            if (!checkedInput) return;
            sidebar.querySelector(`[data-section-id="${mobileActiveCategoryId}"]`)?.scrollTo?.({ top: 0, behavior: 'smooth' });
          });
        }
      }
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
