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
import { hexToHsl, hslToHex } from '../../core/color.js';
import { loadThemes, applyTheme, themePreviewColorsFor } from '../../core/themes.js';
import { SHAPES } from '../grid-icons/shapes.js';
import { framedGridDims, buildCustomShapeDefs } from '../grid-icons/generator.js';
import { CATEGORY_ICONS } from '../../ui/categoryIcons.js';
import { withViewTransition } from '../../ui/viewTransition.js';
import { createSoundTilesEngine } from './engine.js';

// mesmas 4 proporções do Espelho/Gradiente + "Tela cheia" (ver frameOptions
// em gradient-tiles/index.js) — "full" não tem proporção fixa: o ratio aqui
// só serve pro ícone do seletor (usa a proporção da própria janela), o
// tamanho de verdade vem de computeFullBox() medindo o espaço na tela.
function frameOptions() {
  return [
    {
      value: 'full',
      ratio: Math.max(0.4, Math.min(2.5, window.innerWidth / Math.max(1, window.innerHeight))),
      label: t('gradientFrameFull'),
      caption: 'FULL',
    },
    { value: 'square', ratio: EXPORT_FRAME_RATIOS.square, label: t('exportFrame_square'), caption: '1:1' },
    { value: 'portrait', ratio: EXPORT_FRAME_RATIOS.portrait, label: t('exportFrame_portrait'), caption: '4:5' },
    { value: 'story', ratio: EXPORT_FRAME_RATIOS.story, label: t('exportFrame_story'), caption: '9:16' },
    { value: 'landscape', ratio: EXPORT_FRAME_RATIOS.landscape, label: t('exportFrame_landscape'), caption: '16:9' },
  ];
}

// estado só da aba Som — mesmo espírito de videoState/gradientState: formas
// vêm do patternState compartilhado (igual Espelho/Gradiente), o resto é
// próprio daqui.
const soundState = {
  resolution: 32,
  format: 'full',
  ratio: EXPORT_FRAME_RATIOS.square,
  shapeScale: 1,
  colorMode: 'palette', // 'grayscale' | 'palette' | 'custom' | 'gradient' (sem 'source' — não existe "cor do áudio")
  inkColor: '#f5efe4',
  customPaletteColors: [
    { color: '#ea4530', weight: 1 },
    { color: '#3aa1d8', weight: 1 },
  ],
  gradientColors: [
    { color: '#141210', weight: 1 },
    { color: '#ea4530', weight: 1 },
    { color: '#f5efe4', weight: 1 },
  ],
  invert: false,
  trail: 0,
  symmetry: 'none',
  barsAxis: 'vertical',
  sensitivity: 1.4,
  smoothing: 0.75,
  colorResponse: 0.6,
};

let cleanupLang = null;
let engine = null;
let recordTimerId = null;
let gifTimerId = null;
let cleanupThemeSelect = null;
let cleanupResize = null;

function formatSeconds(totalMs) {
  const s = Math.floor(totalMs / 1000);
  const mm = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

export const soundTilesModule = {
  id: 'sound',
  label: () => t('tabSound'),

  async mount(container) {
    const themes = await loadThemes();
    const themeKeys = Object.keys(themes);
    const isMobileViewport = window.matchMedia('(max-width: 768px)').matches;
    let mobileActiveCategoryId = null;

    const root = document.createElement('div');
    root.className = 'mo-layout';

    const sidebar = document.createElement('div');
    // reaproveita EXATAMENTE o mesmo mecanismo de "bottom sheet + abas de
    // categoria no mobile" do Espelho/Gradiente (ver .vt-controls no
    // style.css) — os ids das abas usam prefixo st-cat-* (ver mais abaixo)
    // pra não colidir com vt-cat-*/gt-cat-* dos outros dois.
    sidebar.className = 'mo-controls vt-controls';

    const stage = document.createElement('div');
    stage.className = 'mo-stage';

    const resultTitle = document.createElement('div');
    resultTitle.className = 'mo-result-title';
    resultTitle.textContent = t('soundResultTitle');

    const previewWrap = document.createElement('div');
    previewWrap.className = 'vt-preview-wrap';
    const canvas = document.createElement('canvas');
    canvas.className = 'vt-canvas';
    previewWrap.appendChild(canvas);

    const sourceHint = document.createElement('div');
    sourceHint.className = 'vt-source-hint';
    sourceHint.textContent = t('soundSourceHint');
    previewWrap.appendChild(sourceHint);

    const errorMsg = document.createElement('p');
    errorMsg.className = 'control-hint vt-error';
    errorMsg.hidden = true;

    engine = createSoundTilesEngine(canvas);
    engine.setOptions(soundState);

    // espaço que sobra na tela pro preview no formato "Tela cheia" — MESMA
    // conta de computeFullBox em gradient-tiles/index.js (largura útil do
    // stage, altura daqui até onde os controles começam/o bottom sheet do
    // mobile cobre). Ver o comentário lá pro porquê de zerar as dimensões
    // ANTES de medir (evita o laço de realimentação de o preview esticar
    // pra largura da janela toda).
    function computeFullBox() {
      previewWrap.style.width = '';
      previewWrap.style.height = '';
      void stage.offsetWidth; // força o reflow antes de ler as medidas
      const cs = getComputedStyle(stage);
      const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
      const padBottom = parseFloat(cs.paddingBottom) || 0;
      const w = Math.max(160, (stage.clientWidth || window.innerWidth) - padX);
      const top = previewWrap.getBoundingClientRect().top;
      const sheetH = isMobileViewport ? sidebar.getBoundingClientRect().height + 14 : 0;
      const h = Math.max(160, window.innerHeight - top - sheetH - padBottom - 12);
      return { w: Math.round(w), h: Math.round(h) };
    }

    function applyOptionsAndMaybePalette() {
      const isFull = soundState.format === 'full';
      const box = isFull ? computeFullBox() : null;
      engine.setOptions({
        ...soundState,
        ratio: isFull ? box.w / box.h : soundState.ratio,
        maxDim: isFull ? Math.max(box.w, box.h) * Math.min(2, window.devicePixelRatio || 1) : null,
        background: patternState.background || '#141210',
        paletteColors: patternState.colors,
        shapesAllowed: patternState.shapesAllowed,
      });
      const { cols, rows } = engine.getGridSize();
      if (isFull) {
        // largura/altura em px explícitas — a ideia é ocupar a caixa toda,
        // não manter uma proporção fixa (aspect-ratio não serve aqui).
        previewWrap.style.aspectRatio = '';
        previewWrap.style.maxWidth = '';
        previewWrap.style.width = `${box.w}px`;
        previewWrap.style.height = `${box.h}px`;
      } else {
        previewWrap.style.width = '';
        previewWrap.style.height = '';
        previewWrap.style.aspectRatio = `${cols} / ${rows}`;
        const maxWidthFromHeight = window.innerHeight * 0.78 * (cols / rows);
        previewWrap.style.maxWidth = `${Math.round(maxWidthFromHeight)}px`;
      }
    }

    function updateSourceHint() {
      sourceHint.hidden = engine.hasSource();
    }

    let recordButton;
    let gifButton;
    let freezeButton;
    let playButton;
    let micButton;

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
          downloadBlob(blob, 'kata-som.webm');
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

    async function stopGif() {
      stopGifTimer();
      const blob = await engine.stopGifRecording();
      gifButton.el.querySelector('.control-button-label').textContent = t('videoGifButton');
      gifButton.el.classList.remove('vt-recording');
      if (blob) {
        downloadBlob(blob, 'kata-som.gif');
        flashExportSuccess(gifButton.el);
      }
    }
    function startGif() {
      if (!engine.hasSource()) return;
      engine.startGifRecording();
      gifButton.el.classList.add('vt-recording');
      const startedAt = Date.now();
      const labelEl = gifButton.el.querySelector('.control-button-label');
      labelEl.textContent = `${t('videoStopGifButton')} · 0:00`;
      stopGifTimer();
      gifTimerId = setInterval(() => {
        labelEl.textContent = `${t('videoStopGifButton')} · ${formatSeconds(Date.now() - startedAt)}`;
        if (!engine.isGifRecording()) stopGif();
      }, 500);
    }
    function handleGifClick() {
      if (engine.isGifRecording() || gifTimerId) stopGif();
      else startGif();
    }

    function buildSidebar() {
      if (cleanupThemeSelect) {
        cleanupThemeSelect();
        cleanupThemeSelect = null;
      }
      sidebar.innerHTML = '';

      const uploadInput = document.createElement('input');
      uploadInput.type = 'file';
      uploadInput.accept = 'audio/*';
      uploadInput.className = 'mo-file-input vt-file-input';
      uploadInput.addEventListener('change', async () => {
        const file = uploadInput.files?.[0];
        if (!file) return;
        errorMsg.hidden = true;
        micButton.el.querySelector('.control-button-label').textContent = t('soundMicButton');
        await engine.loadFile(file);
        updateSourceHint();
        playButton.el.hidden = false;
        playButton.el.querySelector('.control-button-label').textContent = t('soundPauseButton');
      });
      const uploadButton = createButton({
        label: t('soundUploadButton'),
        variant: 'accent2',
        onClick: () => uploadInput.click(),
      });

      micButton = createButton({
        label: t('soundMicButton'),
        variant: 'primary',
        onClick: async () => {
          const labelEl = micButton.el.querySelector('.control-button-label');
          if (engine.isMicActive()) {
            engine.stopMic();
            labelEl.textContent = t('soundMicButton');
            updateSourceHint();
            return;
          }
          try {
            errorMsg.hidden = true;
            await engine.enableMic();
            labelEl.textContent = t('soundMicStopButton');
            playButton.el.hidden = true;
            updateSourceHint();
          } catch (err) {
            errorMsg.textContent = `${t('soundMicError')} (${err?.name || err?.message || err})`;
            errorMsg.hidden = false;
          }
        },
      });

      playButton = createButton({
        label: t('soundPauseButton'),
        onClick: () => {
          engine.toggleFilePlayback();
          playButton.el.querySelector('.control-button-label').textContent = engine.isFilePlaying() ? t('soundPauseButton') : t('soundPlayButton');
        },
      });
      playButton.el.hidden = !engine.hasSource() || engine.isMicActive();

      const sourceRow = document.createElement('div');
      sourceRow.className = 'vt-source-row';
      sourceRow.appendChild(uploadButton.el);
      sourceRow.appendChild(micButton.el);
      sourceRow.appendChild(playButton.el);
      sidebar.appendChild(createSection(t('soundSourceSection'), [sourceRow, uploadInput, errorMsg], { id: 'source' }));

      const framePicker = createFrameTilePicker({
        options: frameOptions(),
        value: soundState.format,
        onChange: (value) => {
          soundState.format = value;
          soundState.ratio = EXPORT_FRAME_RATIOS[value];
          buildSidebar();
          withViewTransition(applyOptionsAndMaybePalette, { element: previewWrap, name: 'format-preview' });
        },
      });
      sidebar.appendChild(createSection(t('formatSectionTitle'), [framePicker.el], { id: 'format' }));

      const gridElements = [
        createSlider({
          label: t('videoResolutionLabel'),
          min: 8,
          max: 96,
          step: 1,
          value: soundState.resolution,
          formatValue: (v) => {
            const { cols, rows } = framedGridDims(v, soundState.ratio);
            return `${cols}×${rows}`;
          },
          onChange: (value) => {
            soundState.resolution = value;
            applyOptionsAndMaybePalette();
          },
        }).el,
        createSlider({
          label: t('videoShapeScaleLabel'),
          min: 20,
          max: 140,
          step: 5,
          value: Math.round(soundState.shapeScale * 100),
          formatValue: (v) => `${v}%`,
          onChange: (value) => {
            soundState.shapeScale = value / 100;
            applyOptionsAndMaybePalette();
          },
        }).el,
        createToggleSwitch({
          label: t('invertColorsLabel'),
          value: soundState.invert,
          onChange: (checked) => {
            soundState.invert = checked;
            applyOptionsAndMaybePalette();
          },
        }).el,
      ];
      sidebar.appendChild(createSection(t('videoGridSection'), gridElements, { id: 'grid' }));

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

      // controles próprios do áudio — sensibilidade (o microfone quase
      // sempre chega baixo), resposta das cores (quão cedo a cor troca —
      // ver comentário grandão em engine.js sobre colorResponse), suavização
      // (repassada direto pro AnalyserNode.smoothingTimeConstant — sem isso
      // o padrão "treme" quadro a quadro) e o eixo das barras.
      const audioElements = [
        createSlider({
          label: t('soundSensitivityLabel'),
          min: 50,
          max: 300,
          step: 5,
          value: Math.round(soundState.sensitivity * 100),
          formatValue: (v) => `${v}%`,
          onChange: (value) => {
            soundState.sensitivity = value / 100;
            applyOptionsAndMaybePalette();
          },
        }).el,
        createSlider({
          label: t('soundColorResponseLabel'),
          min: 20,
          max: 150,
          step: 5,
          // quanto do gradiente base→ponta a barra percorre — MENOR = fica
          // mais perto da cor da base o tempo todo (pouca variação),
          // MAIOR = a ponta da barra chega mais longe no gradiente, mesmo
          // numa barra curta (mais variação, mais cedo).
          value: Math.round(soundState.colorResponse * 100),
          formatValue: (v) => `${v}%`,
          onChange: (value) => {
            soundState.colorResponse = value / 100;
            applyOptionsAndMaybePalette();
          },
        }).el,
        createSlider({
          label: t('soundSmoothingLabel'),
          min: 0,
          max: 90,
          step: 5,
          value: Math.round(soundState.smoothing * 100),
          formatValue: (v) => `${v}%`,
          onChange: (value) => {
            soundState.smoothing = value / 100;
            applyOptionsAndMaybePalette();
          },
        }).el,
        createSelect({
          label: t('soundScrollAxisLabel'),
          options: [
            { value: 'vertical', label: t('soundScrollAxisVertical') },
            { value: 'horizontal', label: t('soundScrollAxisHorizontal') },
          ],
          value: soundState.barsAxis,
          onChange: (value) => {
            soundState.barsAxis = value;
            applyOptionsAndMaybePalette();
          },
        }).el,
        createSlider({
          label: t('videoTrailLabel'),
          min: 0,
          max: 95,
          step: 5,
          value: Math.round(soundState.trail * 100),
          formatValue: (v) => `${v}%`,
          onChange: (value) => {
            soundState.trail = value / 100;
            applyOptionsAndMaybePalette();
          },
        }).el,
        createSelect({
          label: t('symmetryTypeLabel'),
          options: ['none', 'mirror-h', 'mirror-full'].map((value) => ({ value, label: t(`symmetry_${value}`) })),
          value: soundState.symmetry,
          onChange: (value) => {
            soundState.symmetry = value;
            applyOptionsAndMaybePalette();
          },
        }).el,
      ];
      sidebar.appendChild(createSection(t('soundAudioSection'), audioElements, { id: 'audio' }));

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
      cleanupThemeSelect = themeSelect.destroy;
      sidebar.appendChild(createSection(t('themeSectionTitle'), [themeSelect.el], { id: 'theme' }));

      const colorElements = [
        createSelect({
          label: t('videoColorModeLabel'),
          options: [
            { value: 'grayscale', label: t('videoColorModeGrayscale') },
            { value: 'palette', label: t('videoColorModePalette') },
            { value: 'custom', label: t('videoColorModeCustom') },
            { value: 'gradient', label: t('videoColorModeGradient') },
          ],
          value: soundState.colorMode,
          onChange: (value) => {
            soundState.colorMode = value;
            buildSidebar();
            applyOptionsAndMaybePalette();
          },
        }).el,
      ];
      if (soundState.colorMode === 'grayscale') {
        const inkRow = document.createElement('div');
        inkRow.className = 'control control-stroke-color';
        const inkLabel = document.createElement('span');
        inkLabel.className = 'control-label';
        inkLabel.textContent = t('videoInkColorLabel');
        const inkInput = document.createElement('input');
        inkInput.type = 'color';
        inkInput.className = 'stroke-color-input';
        inkInput.value = soundState.inkColor;
        inkInput.addEventListener('input', () => {
          soundState.inkColor = inkInput.value;
          applyOptionsAndMaybePalette();
        });
        inkRow.appendChild(inkLabel);
        inkRow.appendChild(inkInput);
        colorElements.push(inkRow);
      }
      if (soundState.colorMode === 'palette') {
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
      if (soundState.colorMode === 'custom') {
        const customSwatches = createColorSwatches({
          label: t('videoColorModeCustom'),
          colors: soundState.customPaletteColors,
          onChange: (colors) => {
            soundState.customPaletteColors = colors;
            applyOptionsAndMaybePalette();
          },
        });
        colorElements.push(customSwatches.el);
      }
      if (soundState.colorMode === 'gradient') {
        const gradientSwatches = createColorSwatches({
          label: t('videoGradientLabel'),
          colors: soundState.gradientColors,
          onChange: (colors) => {
            soundState.gradientColors = colors;
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
            if (blob) downloadBlob(blob, 'kata-som-quadro.png');
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

      // aba de categorias no mobile — mesmo mecanismo do Espelho/Gradiente,
      // ids st-cat-* (ver bloco :has() correspondente em style.css).
      if (isMobileViewport) {
        const categorySections = Array.from(sidebar.querySelectorAll('.control-section[data-section-id]'));
        if (categorySections.length) {
          const categoryTabs = document.createElement('div');
          categoryTabs.className = 'gi-mobile-category-tabs';
          categorySections.forEach((section) => {
            const sectionId = section.dataset.sectionId;
            const title = section.querySelector('.control-section-title')?.textContent ?? sectionId;
            const inputId = `st-cat-${sectionId}`;

            const input = document.createElement('input');
            input.type = 'radio';
            input.name = 'st-category-tab';
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
            mobileActiveCategoryId = checkedInput ? checkedInput.id.replace('st-cat-', '') : null;
            if (!checkedInput) return;
            sidebar.querySelector(`[data-section-id="${mobileActiveCategoryId}"]`)?.scrollTo?.({ top: 0, behavior: 'smooth' });
          });
        }
      }
    }

    buildSidebar();
    updateSourceHint();

    stage.appendChild(resultTitle);
    stage.appendChild(previewWrap);
    root.appendChild(sidebar);
    root.appendChild(stage);
    container.appendChild(root);

    // SÓ depois de inserir na página: o formato "Tela cheia" mede o espaço
    // disponível de verdade (computeFullBox) — antes disso, com o elemento
    // ainda fora do documento, toda medida é 0 (ver mesmo comentário em
    // gradient-tiles/index.js).
    applyOptionsAndMaybePalette();

    engine.start();

    // "Tela cheia" precisa remedir quando a janela muda de tamanho (ou o
    // celular gira) — mesma lógica do Gradiente: passa por rAF pra não
    // recalcular a grade repetidas vezes durante o arraste do canto da
    // janela, e é removido no unmount (listener de window sobrevive a
    // trocar de aba sozinho, senão).
    let resizeRaf = null;
    const onResize = () => {
      if (soundState.format !== 'full') return;
      if (resizeRaf != null) return;
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = null;
        applyOptionsAndMaybePalette();
      });
    };
    window.addEventListener('resize', onResize);
    cleanupResize = () => {
      window.removeEventListener('resize', onResize);
      if (resizeRaf != null) cancelAnimationFrame(resizeRaf);
      resizeRaf = null;
    };

    cleanupLang = onLangChange(() => {
      resultTitle.textContent = t('soundResultTitle');
      sourceHint.textContent = t('soundSourceHint');
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
    if (cleanupResize) {
      cleanupResize();
      cleanupResize = null;
    }
    if (cleanupThemeSelect) {
      cleanupThemeSelect();
      cleanupThemeSelect = null;
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
