import { t, onLangChange } from '../../core/i18n.js';
import { createSlider } from '../../ui/controls/slider.js';
import { createShapeToggleGrid } from '../../ui/controls/shapeToggleGrid.js';
import { createColorSwatches } from '../../ui/controls/colorSwatches.js';
import { createFrameTilePicker } from '../../ui/controls/frameTilePicker.js';
import { createButton, flashExportSuccess } from '../../ui/controls/button.js';
import { createSection } from '../../ui/controls/section.js';
import { downloadBlob, EXPORT_FRAME_RATIOS } from '../../core/export.js';
import { patternState } from '../../core/patternState.js';
import { SHAPES } from '../grid-icons/shapes.js';
import { framedGridDims, buildCustomShapeDefs } from '../grid-icons/generator.js';
import { CATEGORY_ICONS } from '../../ui/categoryIcons.js';
import { createGradientTilesEngine } from './engine.js';

// mesmas 4 opções de Formato do Espelho/Azulejo (ver frameOptions em
// video-tiles/index.js) — função (não lista fixa) pra ler t() de novo a
// cada troca de idioma.
function frameOptions() {
  return [
    // "Tela cheia" não tem proporção fixa: ela é MEDIDA do espaço que sobra
    // na tela (ver computeFullBox) e reage a redimensionar a janela/girar o
    // celular. O ratio aqui serve só pro desenho do iconezinho do seletor —
    // usa a proporção da própria janela pra prévia parecer com o resultado.
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

// estado só da aba Gradiente — mesmo espírito do videoState (video-tiles/
// index.js): formas vêm do patternState compartilhado (igual ao Espelho),
// mas as CORES do gradiente são próprias daqui (a ordem delas É o
// gradiente, não pesos de sorteio como as cores do Azulejo) — paleta
// inspirada nas cores de referência (fundo bem escuro → ciano → roxo →
// vermelho), parecida com o vídeo de referência que o Kenji mandou.
const gradientState = {
  resolution: 40,
  // padrão é "Tela cheia": é o formato com mais impacto visual, e é o que
  // faz a aba parecer uma peça inteira em vez de um quadradinho no meio do
  // vazio. Os formatos fixos continuam ali pra exportar em proporção certa.
  format: 'full',
  ratio: EXPORT_FRAME_RATIOS.square,
  shapeScale: 1,
  scale: 1,
  turbulence: 0.5,
  direction: 135,
  speed: 1,
  colors: [
    { color: '#150a22', weight: 1 },
    { color: '#2fb6e0', weight: 1 },
    { color: '#8a5cf0', weight: 1 },
    { color: '#ff5d4a', weight: 1 },
  ],
};

let cleanupLang = null;
let cleanupResize = null;
let engine = null;
let recordTimerId = null;
let gifTimerId = null;

function formatSeconds(totalMs) {
  const s = Math.floor(totalMs / 1000);
  const mm = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

// extensão certa conforme o mimeType que o MediaRecorder realmente usou
// (ver pickMimeType em engine.js — tenta MP4 antes de cair pra WebM).
function extensionForMimeType(mimeType) {
  return mimeType?.startsWith('video/mp4') ? 'mp4' : 'webm';
}

export const gradientTilesModule = {
  id: 'gradient',
  label: () => t('tabGradient'),

  async mount(container) {
    const isMobileViewport = window.matchMedia('(max-width: 768px)').matches;
    let mobileActiveCategoryId = null;

    const root = document.createElement('div');
    root.className = 'mo-layout';

    const sidebar = document.createElement('div');
    // .vt-controls (reaproveitado do Espelho) já dá o "bottom sheet" fixo +
    // aba de categorias no mobile — mesmo mecanismo, ids gt-cat-* aqui.
    sidebar.className = 'mo-controls vt-controls';

    const stage = document.createElement('div');
    stage.className = 'mo-stage';

    const resultTitle = document.createElement('div');
    resultTitle.className = 'mo-result-title';
    resultTitle.textContent = t('tabGradient');

    // mesmo shell de preview do Espelho (fundo quadriculado, canvas 100%,
    // aspect-ratio ajustado por JS conforme o formato) — reaproveitado ao
    // pé da letra, ver .vt-preview-wrap/.vt-canvas em style.css.
    const previewWrap = document.createElement('div');
    previewWrap.className = 'vt-preview-wrap';
    const canvas = document.createElement('canvas');
    canvas.className = 'vt-canvas';
    previewWrap.appendChild(canvas);

    engine = createGradientTilesEngine(canvas);

    // espaço que sobra na tela pro preview no formato "Tela cheia": largura
    // útil do stage e altura daqui (topo do preview) até onde os controles
    // começam. No mobile a sidebar é um "bottom sheet" fixo POR CIMA do
    // conteúdo (ver .vt-controls no media query), então desconta a altura
    // dela + uma folga; no desktop ela é uma coluna ao lado e não disputa
    // altura nenhuma. Mesma ideia do computePreviewBoxSize do Azulejo.
    function computeFullBox() {
      // zera as dimensões aplicadas ANTES de medir. O preview é item flex
      // dentro do stage, então a largura dele influencia a largura do próprio
      // stage — medir com o valor da rodada anterior ainda aplicado criava um
      // laço de realimentação (o preview esticava pra largura da janela toda
      // e o stage encolhia embaixo dele). Com as dimensões limpas, o preview
      // volta pro width:100% do CSS e quem manda na largura é o layout.
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

    function applyOptions() {
      const isFull = gradientState.format === 'full';
      const box = isFull ? computeFullBox() : null;
      engine.setOptions({
        ...gradientState,
        // no "Tela cheia" a proporção vem da caixa medida, não da lista fixa
        ratio: isFull ? box.w / box.h : gradientState.ratio,
        // e o canvas acompanha o tamanho real (limitado no motor) pra forma
        // não sair borrada esticada por CSS num monitor grande
        maxDim: isFull ? Math.max(box.w, box.h) * Math.min(2, window.devicePixelRatio || 1) : null,
        background: patternState.background || '#141210',
        shapesAllowed: patternState.shapesAllowed,
      });
      const { cols, rows } = engine.getGridSize();
      if (isFull) {
        // largura/altura em px explícitas: aspect-ratio não serve aqui, a
        // ideia é justamente ocupar a caixa toda, não manter proporção.
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

    let recordButton;
    let gifButton;
    let freezeButton;

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
        const result = await engine.stopRecording();
        recordButton.el.querySelector('.control-button-label').textContent = t('videoRecordButton');
        recordButton.el.classList.remove('vt-recording');
        if (result?.blob) {
          downloadBlob(result.blob, `kata-gradiente.${extensionForMimeType(result.mimeType)}`);
          flashExportSuccess(recordButton.el);
        }
        return;
      }
      engine.startRecording();
      recordButton.el.classList.add('vt-recording');
      const startedAt = Date.now();
      const labelEl = recordButton.el.querySelector('.control-button-label');
      labelEl.textContent = `${t('videoStopRecordButton')} · 0:00`;
      recordTimerId = setInterval(() => {
        labelEl.textContent = `${t('videoStopRecordButton')} · ${formatSeconds(Date.now() - startedAt)}`;
      }, 500);
    }

    // start e stop separados de propósito. Antes era uma função só e o timer
    // chamava ELA quando o motor batia no teto de 8s — mas nesse instante
    // isGifRecording() já era false, então a chamada caía no ramo de INICIAR:
    // a gravação recomeçava sozinha, um setInterval novo sobrescrevia o
    // anterior sem limpá-lo (acumulando um por ciclo de 8s, pra sempre) e o
    // GIF nunca era baixado. Agora o timer só sabe PARAR.
    async function stopGif() {
      stopGifTimer();
      const blob = await engine.stopGifRecording();
      gifButton.el.querySelector('.control-button-label').textContent = t('videoGifButton');
      gifButton.el.classList.remove('vt-recording');
      if (blob) {
        downloadBlob(blob, 'kata-gradiente.gif');
        flashExportSuccess(gifButton.el);
      }
    }

    function startGif() {
      engine.startGifRecording();
      gifButton.el.classList.add('vt-recording');
      const startedAt = Date.now();
      const labelEl = gifButton.el.querySelector('.control-button-label');
      labelEl.textContent = `${t('videoStopGifButton')} · 0:00`;
      stopGifTimer();
      gifTimerId = setInterval(() => {
        labelEl.textContent = `${t('videoStopGifButton')} · ${formatSeconds(Date.now() - startedAt)}`;
        // o motor para de capturar sozinho no teto de duração (ver
        // GIF_MAX_SECONDS em engine.js) — aqui só finaliza e baixa.
        if (!engine.isGifRecording()) stopGif();
      }, 500);
    }

    function handleGifClick() {
      if (engine.isGifRecording() || gifTimerId) stopGif();
      else startGif();
    }

    function buildSidebar() {
      sidebar.innerHTML = '';

      const framePicker = createFrameTilePicker({
        options: frameOptions(),
        value: gradientState.format,
        onChange: (value) => {
          gradientState.format = value;
          gradientState.ratio = EXPORT_FRAME_RATIOS[value];
          buildSidebar();
          applyOptions();
        },
      });
      sidebar.appendChild(createSection(t('formatSectionTitle'), [framePicker.el], { id: 'format' }));

      const gridElements = [
        createSlider({
          label: t('videoResolutionLabel'),
          min: 8,
          max: 96,
          step: 1,
          value: gradientState.resolution,
          formatValue: (v) => {
            const { cols, rows } = framedGridDims(v, gradientState.ratio);
            return `${cols}×${rows}`;
          },
          onChange: (value) => {
            gradientState.resolution = value;
            applyOptions();
          },
        }).el,
        createSlider({
          label: t('videoShapeScaleLabel'),
          min: 20,
          max: 140,
          step: 5,
          value: Math.round(gradientState.shapeScale * 100),
          formatValue: (v) => `${v}%`,
          onChange: (value) => {
            gradientState.shapeScale = value / 100;
            applyOptions();
          },
        }).el,
      ];
      sidebar.appendChild(createSection(t('videoGridSection'), gridElements, { id: 'grid' }));

      // EXATAMENTE o mesmo catálogo/mecanismo do Espelho — liga/desliga aqui
      // reflete no patternState compartilhado (Azulejo/Espelho também veem).
      const shapesGrid = createShapeToggleGrid({
        label: t('shapesSection'),
        shapes: { ...SHAPES, ...buildCustomShapeDefs(patternState.customShapes) },
        value: patternState.shapesAllowed,
        onChange: (value) => {
          patternState.shapesAllowed = value;
          applyOptions();
        },
      });
      sidebar.appendChild(createSection(t('shapesSection'), [shapesGrid.el], { id: 'shapes' }));

      const gradientElements = [
        createSlider({
          label: t('gradientScaleLabel'),
          min: 20,
          max: 220,
          step: 5,
          value: Math.round(gradientState.scale * 100),
          formatValue: (v) => `${v}%`,
          onChange: (value) => {
            gradientState.scale = value / 100;
            applyOptions();
          },
        }).el,
        createSlider({
          label: t('gradientTurbulenceLabel'),
          min: 0,
          max: 100,
          step: 5,
          value: Math.round(gradientState.turbulence * 100),
          formatValue: (v) => `${v}%`,
          onChange: (value) => {
            gradientState.turbulence = value / 100;
            applyOptions();
          },
        }).el,
        createSlider({
          label: t('gradientDirectionLabel'),
          min: 0,
          max: 359,
          step: 1,
          value: gradientState.direction,
          formatValue: (v) => `${v}°`,
          onChange: (value) => {
            gradientState.direction = value;
            applyOptions();
          },
        }).el,
        createSlider({
          label: t('gradientSpeedLabel'),
          min: 0,
          max: 300,
          step: 10,
          value: Math.round(gradientState.speed * 100),
          formatValue: (v) => `${v}%`,
          onChange: (value) => {
            gradientState.speed = value / 100;
            applyOptions();
          },
        }).el,
      ];
      sidebar.appendChild(createSection(t('gradientSectionTitle'), gradientElements, { id: 'gradient' }));

      const gradientSwatches = createColorSwatches({
        label: t('videoGradientLabel'),
        colors: gradientState.colors,
        onChange: (colors) => {
          gradientState.colors = colors;
          applyOptions();
        },
      });
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
        // mesmo fundo compartilhado do Azulejo/Espelho — não um separado só
        // da aba Gradiente.
        patternState.background = bgInput.value;
        patternState.themeKey = 'custom';
        applyOptions();
      });
      bgRow.appendChild(bgLabel);
      bgRow.appendChild(bgInput);
      sidebar.appendChild(createSection(t('colorsSection'), [gradientSwatches.el, bgRow], { id: 'colors' }));

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
            if (blob) downloadBlob(blob, 'kata-gradiente-quadro.png');
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

      // aba de categorias no mobile — mesmo mecanismo do Espelho (ver
      // comentário grandão em video-tiles/index.js / grid-icons/index.js),
      // ids gt-cat-* pra escopar só essa aba (ver style.css).
      if (isMobileViewport) {
        const categorySections = Array.from(sidebar.querySelectorAll('.control-section[data-section-id]'));
        if (categorySections.length) {
          const categoryTabs = document.createElement('div');
          categoryTabs.className = 'gi-mobile-category-tabs';
          categorySections.forEach((section) => {
            const sectionId = section.dataset.sectionId;
            const title = section.querySelector('.control-section-title')?.textContent ?? sectionId;
            const inputId = `gt-cat-${sectionId}`;

            const input = document.createElement('input');
            input.type = 'radio';
            input.name = 'gt-category-tab';
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
            mobileActiveCategoryId = checkedInput ? checkedInput.id.replace('gt-cat-', '') : null;
            if (!checkedInput) return;
            sidebar.querySelector(`[data-section-id="${mobileActiveCategoryId}"]`)?.scrollTo?.({ top: 0, behavior: 'smooth' });
          });
        }
      }
    }

    buildSidebar();

    stage.appendChild(resultTitle);
    stage.appendChild(previewWrap);
    root.appendChild(sidebar);
    root.appendChild(stage);
    container.appendChild(root);

    // applyOptions() SÓ depois de inserir na página: o formato "Tela cheia"
    // mede o espaço disponível de verdade (computeFullBox), e num elemento
    // ainda fora do documento toda medida é 0 — o preview saía do tamanho da
    // janela inteira, estourando o stage.
    applyOptions();

    engine.start();

    // "Tela cheia" precisa remedir quando a janela muda de tamanho (ou o
    // celular gira). Passa por rAF pra não recalcular a grade dezenas de
    // vezes durante o arraste do canto da janela; e é removido no unmount —
    // listener de window sobrevive à troca de aba se ninguém tirar.
    let resizeRaf = null;
    const onResize = () => {
      if (gradientState.format !== 'full') return;
      if (resizeRaf != null) return;
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = null;
        applyOptions();
      });
    };
    window.addEventListener('resize', onResize);
    cleanupResize = () => {
      window.removeEventListener('resize', onResize);
      if (resizeRaf != null) cancelAnimationFrame(resizeRaf);
      resizeRaf = null;
    };

    cleanupLang = onLangChange(() => {
      resultTitle.textContent = t('tabGradient');
      buildSidebar();
    });
  },

  unmount() {
    if (recordTimerId) {
      clearInterval(recordTimerId);
      recordTimerId = null;
    }
    if (gifTimerId) {
      clearInterval(gifTimerId);
      gifTimerId = null;
    }
    if (engine) {
      engine.destroy();
      engine = null;
    }
    if (cleanupResize) {
      cleanupResize();
      cleanupResize = null;
    }
    if (cleanupLang) {
      cleanupLang();
      cleanupLang = null;
    }
  },
};
