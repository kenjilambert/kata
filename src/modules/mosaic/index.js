import { t, onLangChange } from '../../core/i18n.js';
import { createSlider } from '../../ui/controls/slider.js';
import { createSelect } from '../../ui/controls/select.js';
import { createIconSelect } from '../../ui/controls/iconSelect.js';
import { createToggleSwitch } from '../../ui/controls/toggleSwitch.js';
import { createButton } from '../../ui/controls/button.js';
import { createSection } from '../../ui/controls/section.js';
import { exportSvgString, exportPngFromSvgString } from '../../core/export.js';
import { exportSeamlessPatternAsAi } from '../../core/aiPatternExport.js';
import { listenForPaste, loadImageAsset } from '../../core/clipboard-input.js';
import { openDrawCanvas } from '../../ui/drawCanvas.js';
import { randomSeed } from '../../core/seed.js';
import { patternState } from '../../core/patternState.js';
import { gradientPreviewBackground } from '../../core/gradient.js';
import { buildMosaicSvg } from './generator.js';

const GRADIENT_SHAPES = ['linear', 'radial', 'reflected'];
// direção/ângulo faz sentido pra linear e refletido; só o radial usa um
// centro fixo em vez disso.
const SHAPES_WITH_ANGLE = ['linear', 'reflected'];

function renderGradientShapeIcon(shape) {
  const icon = document.createElement('span');
  icon.className = 'mo-gradient-icon';
  icon.style.background = gradientPreviewBackground(shape);
  return icon;
}

const TILE_SIZE = 80;
const MIN_TILES = 2;
const MAX_TILES = 16;

// estado só do Mosaico (tamanho da grade, máscara de densidade) — igual ao
// patternState do Azulejo, vive no escopo do módulo (não dentro de mount())
// pra sobreviver a trocar de aba e voltar, em vez de resetar toda vez.
const mosaicState = {
  tilesX: 8,
  tilesY: 6,
  gap: 0,
  mosaicSeed: randomSeed(),
  // por padrão o mosaico é uniforme (mesma densidade em todo tile, só
  // escalando o fillDensity do Azulejo pra cima ou pra baixo). O gradiente
  // de densidade (variação por posição) é opt-in via densityMask.enabled.
  uniformDensity: 1,
  densityMask: {
    enabled: false,
    source: 'gradient',
    shape: 'linear',
    angleDeg: 0,
    centerX: 0.5,
    centerY: 0.5,
    mode: 'center-out',
    smoothness: 0.5,
  },
  maskImageUrl: null,
  maskImageEl: null,
  // "Padrão sem emenda": trava gap em 0 (o espaçamento não tem margem espelhada
  // na borda externa da imagem, então repetir a imagem lado a lado mostraria
  // um espaçamento inconsistente bem na emenda) e restringe a máscara de
  // densidade a formas que realmente casam nos dois lados (ver
  // core/gradient.js: linear pula de 1 pra 0 na emenda; refletido só casa
  // se o eixo for 0°/90°; radial já é seguro pois esta UI não expõe
  // centerX/centerY, então o centro fica sempre travado em 0.5/0.5).
  // Os valores anteriores ficam guardados aqui pra restaurar ao desligar.
  seamless: false,
  gapBeforeSeamless: 0,
  densityMaskBeforeSeamless: null,
};

let cleanupPaste = null;
let cleanupLang = null;
let cleanupGradientShapeSelect = null;

export const mosaicModule = {
  id: 'mosaic',
  label: () => t('tabMosaic'),

  async mount(container) {
    // pattern = a "receita" do Azulejo, sempre lida ao vivo (é o mesmo
    // objeto compartilhado — qualquer mudança feita na aba Azulejo aparece
    // aqui na próxima vez que esta aba for montada, e vice-versa).
    const pattern = patternState;
    const state = mosaicState;

    // toda vez que entra na aba (não só na primeira vez) volta pro mínimo —
    // evita abrir o Mosaico já com uma grade grande/densa de uma sessão
    // anterior, sem querer.
    state.tilesX = MIN_TILES;
    state.tilesY = MIN_TILES;
    state.uniformDensity = 0.5;

    const root = document.createElement('div');
    root.className = 'mo-layout';

    const sidebar = document.createElement('div');
    sidebar.className = 'mo-controls';

    const stage = document.createElement('div');
    stage.className = 'mo-stage';

    const resultTitle = document.createElement('div');
    resultTitle.className = 'mo-result-title';
    resultTitle.textContent = t('mosaicResultTitle');

    const previewWrap = document.createElement('div');
    previewWrap.className = 'mo-preview-wrap';
    const preview = document.createElement('div');
    preview.className = 'mo-preview';
    previewWrap.appendChild(preview);

    // igual ao Azulejo: o botão de regenerar fica no stage, logo abaixo do
    // resultado, não na sidebar — construído uma vez em mount() (não a cada
    // buildSidebar) e só o texto é atualizado na troca de idioma.
    const stageToolbar = document.createElement('div');
    stageToolbar.className = 'mo-stage-toolbar';
    const shuffleButton = createButton({
      label: t('mosaicShuffleButton'),
      variant: 'primary',
      onClick: () => {
        state.mosaicSeed = randomSeed();
        render();
      },
    });
    stageToolbar.appendChild(shuffleButton.el);

    // ao estilo da prévia de padrão do Illustrator: 3x3 cópias do mesmo
    // tile, a do meio em opacidade cheia (é o resultado real) e as 8 ao
    // redor em 50% (mostram a repetição sem chamar mais atenção que o
    // próprio padrão) — em vez de um background-repeat genérico, deixa
    // claro que aquilo ali é a mesma arte se repetindo.
    const repeatPreviewWrap = document.createElement('div');
    repeatPreviewWrap.className = 'mo-repeat-preview-wrap';
    const repeatPreviewTitle = document.createElement('div');
    repeatPreviewTitle.className = 'mo-repeat-preview-title';
    repeatPreviewTitle.textContent = t('mosaicRepeatPreviewTitle');
    const repeatPreview = document.createElement('div');
    repeatPreview.className = 'mo-repeat-preview';
    const repeatPreviewCells = Array.from({ length: 9 }, (_, i) => {
      const cell = document.createElement('div');
      cell.className = 'mo-repeat-preview-cell';
      if (i === 4) cell.classList.add('mo-repeat-preview-cell-center');
      repeatPreview.appendChild(cell);
      return cell;
    });
    repeatPreviewWrap.appendChild(repeatPreviewTitle);
    repeatPreviewWrap.appendChild(repeatPreview);

    // data URI em vez de blob URL — precisa ser síncrono (render() roda a
    // cada slider) e não deixar URLs pra revogar depois de cada geração.
    function svgToDataUri(svgString) {
      return `data:image/svg+xml,${encodeURIComponent(svgString)}`;
    }

    function render() {
      const svg = buildMosaicSvg({
        pattern,
        tilesX: state.tilesX,
        tilesY: state.tilesY,
        tileSize: TILE_SIZE,
        gap: state.gap,
        mosaicSeed: state.mosaicSeed,
        uniformDensity: state.uniformDensity,
        densityMask: state.densityMask,
        maskImageEl: state.maskImageEl,
      });
      preview.innerHTML = svg;

      repeatPreviewWrap.style.display = state.seamless ? '' : 'none';
      if (state.seamless) {
        const dataUri = svgToDataUri(svg);
        repeatPreview.style.aspectRatio = `${state.tilesX} / ${state.tilesY}`;
        repeatPreviewCells.forEach((cell) => {
          cell.style.backgroundImage =
            `url("${dataUri}"), repeating-conic-gradient(#eee 0% 25%, #fff 0% 50%)`;
        });
      }
    }

    // chamada sempre que seamless+máscara estão ativos ao mesmo tempo,
    // não só ao ligar o toggle — assim qualquer caminho que deixe a máscara
    // numa forma incompatível (ex.: ativar o gradiente DEPOIS de já estar em
    // modo Sem Costura, quando o padrão inicial da forma é 'linear') se
    // autocorrige no próximo render, em vez de só no momento do toggle.
    function sanitizeDensityMaskForSeamless() {
      if (state.densityMask.source === 'image' || state.densityMask.source === 'draw') {
        state.densityMask.source = 'gradient';
        state.densityMask.shape = 'reflected';
        state.densityMask.angleDeg = 0;
      } else if (state.densityMask.shape === 'linear') {
        state.densityMask.shape = 'reflected';
        state.densityMask.angleDeg = 0;
      } else if (state.densityMask.shape === 'reflected' && state.densityMask.angleDeg !== 0 && state.densityMask.angleDeg !== 90) {
        // refletido é simétrico a cada 180° — só existem dois eixos
        // possíveis que casam nas duas bordas, então trava no mais perto.
        const mod = state.densityMask.angleDeg % 180;
        state.densityMask.angleDeg = mod < 45 || mod >= 135 ? 0 : 90;
      }
      // radial: nada a fazer — já é seguro (sem controle de
      // centerX/centerY nesta UI, o centro fica sempre em 0.5/0.5).
    }

    function setSeamless(value) {
      if (value) {
        state.gapBeforeSeamless = state.gap;
        state.gap = 0;

        if (state.densityMask.enabled) {
          state.densityMaskBeforeSeamless = {
            source: state.densityMask.source,
            shape: state.densityMask.shape,
            angleDeg: state.densityMask.angleDeg,
          };
          sanitizeDensityMaskForSeamless();
        }
      } else {
        state.gap = state.gapBeforeSeamless;
        if (state.densityMaskBeforeSeamless) {
          Object.assign(state.densityMask, state.densityMaskBeforeSeamless);
          state.densityMaskBeforeSeamless = null;
        }
      }
      state.seamless = value;
      buildSidebar();
      render();
    }

    async function handleMaskImage(blob) {
      let asset;
      try {
        asset = await loadImageAsset(blob);
      } catch (err) {
        return;
      }
      if (state.maskImageUrl) URL.revokeObjectURL(state.maskImageUrl);
      state.maskImageUrl = asset.url;
      state.maskImageEl = asset.img;
      // no modo desenho a sidebar mostra uma miniatura + botão de remover
      // que dependem de maskImageUrl — precisa reconstruir pra eles aparecerem.
      buildSidebar();
      render();
    }

    function buildSidebar() {
      sidebar.innerHTML = '';

      const gridElements = [
        createSlider({
          label: t('mosaicColumnsLabel'),
          min: MIN_TILES,
          max: MAX_TILES,
          step: 1,
          value: state.tilesX,
          formatValue: (v) => `${v}`,
          onChange: (value) => {
            state.tilesX = value;
            render();
          },
        }).el,
        createSlider({
          label: t('mosaicRowsLabel'),
          min: MIN_TILES,
          max: MAX_TILES,
          step: 1,
          value: state.tilesY,
          formatValue: (v) => `${v}`,
          onChange: (value) => {
            state.tilesY = value;
            render();
          },
        }).el,
      ];
      if (state.seamless) {
        const gapHint = document.createElement('p');
        gapHint.className = 'control-hint';
        gapHint.textContent = t('mosaicSeamlessGapHint');
        gridElements.push(gapHint);
      } else {
        gridElements.push(
          createSlider({
            label: t('mosaicGapLabel'),
            min: 0,
            max: 24,
            step: 1,
            value: state.gap,
            formatValue: (v) => `${v}px`,
            onChange: (value) => {
              state.gap = value;
              render();
            },
          }).el
        );
      }
      sidebar.appendChild(createSection(t('mosaicGridSection'), gridElements));

      // recriado a cada rebuild da sidebar — sempre limpa o listener do
      // combo anterior antes de montar de novo (ou de trocar pro modo
      // imagem, que nem mostra esse combo), senão acumula um listener de
      // "clicar fora" por rebuild.
      if (cleanupGradientShapeSelect) {
        cleanupGradientShapeSelect();
        cleanupGradientShapeSelect = null;
      }

      // sempre visível, independente do gradiente estar ligado ou não —
      // escala pra cima ou pra baixo o fillDensity já configurado no
      // Azulejo, uniformemente em todo tile; o gradiente (se ligado) varia
      // em cima dessa base, não substitui ela.
      const densityElements = [
        createSlider({
          label: t('mosaicUniformDensityLabel'),
          min: 0,
          max: 200,
          step: 5,
          value: Math.round(state.uniformDensity * 100),
          formatValue: (v) => `${v}%`,
          onChange: (value) => {
            state.uniformDensity = value / 100;
            render();
          },
        }).el,
      ];
      sidebar.appendChild(createSection(t('mosaicDensitySection'), densityElements));

      const maskElements = [];
      maskElements.push(
        createToggleSwitch({
          label: t('mosaicEnableGradientLabel'),
          value: state.densityMask.enabled,
          onChange: (checked) => {
            state.densityMask.enabled = checked;
            buildSidebar();
            render();
          },
        }).el
      );

      if (state.densityMask.enabled) {
        if (state.seamless) {
          sanitizeDensityMaskForSeamless();
          const maskSourceHint = document.createElement('p');
          maskSourceHint.className = 'control-hint';
          maskSourceHint.textContent = t('mosaicSeamlessMaskSourceHint');
          maskElements.push(maskSourceHint);
        } else {
          maskElements.push(
            createToggleSwitch({
              label: t('mosaicUseImageMaskLabel'),
              value: state.densityMask.source === 'image',
              onChange: (checked) => {
                state.densityMask.source = checked ? 'image' : 'gradient';
                buildSidebar();
                render();
              },
            }).el
          );
          maskElements.push(
            createToggleSwitch({
              label: t('mosaicDrawMaskLabel'),
              value: state.densityMask.source === 'draw',
              onChange: (checked) => {
                state.densityMask.source = checked ? 'draw' : 'gradient';
                buildSidebar();
                render();
              },
            }).el
          );
        }

        if (state.densityMask.source === 'image') {
          const hint = document.createElement('p');
          hint.className = 'control-hint';
          hint.textContent = t('mosaicImageMaskHint');
          maskElements.push(hint);

          const uploadInput = document.createElement('input');
          uploadInput.type = 'file';
          uploadInput.accept = 'image/*';
          uploadInput.className = 'mo-file-input';
          uploadInput.addEventListener('change', () => {
            const file = uploadInput.files?.[0];
            if (file) handleMaskImage(file);
          });
          maskElements.push(uploadInput);
        } else if (state.densityMask.source === 'draw') {
          const drawRow = document.createElement('div');
          drawRow.className = 'reference-row';

          if (state.maskImageUrl) {
            const thumb = document.createElement('img');
            thumb.className = 'reference-thumb';
            thumb.src = state.maskImageUrl;
            thumb.alt = t('mosaicDrawMaskLabel');
            drawRow.appendChild(thumb);
          }

          const drawMaskButton = createButton({
            label: t('drawButton'),
            onClick: () =>
              openDrawCanvas({
                initialImageEl: state.maskImageEl,
                onConfirm: (blob) => handleMaskImage(blob),
              }),
          });
          drawRow.appendChild(drawMaskButton.el);

          if (state.maskImageUrl) {
            const removeDrawButton = createButton({
              label: t('removeImageButton'),
              onClick: () => {
                if (state.maskImageUrl) URL.revokeObjectURL(state.maskImageUrl);
                state.maskImageUrl = null;
                state.maskImageEl = null;
                buildSidebar();
                render();
              },
            });
            drawRow.appendChild(removeDrawButton.el);
          }

          maskElements.push(drawRow);
        } else {
          // Linear sempre pula de cheio pra vazio na emenda — não tem jeito
          // de fazer casar, então some do seletor enquanto Sem Costura
          // está ativo (ver core/gradient.js: signedLinearProjection não
          // tem wraparound nenhum).
          const availableShapes = state.seamless
            ? GRADIENT_SHAPES.filter((shape) => shape !== 'linear')
            : GRADIENT_SHAPES;
          const shapeSelect = createIconSelect({
            label: t('mosaicShapeLabel'),
            options: availableShapes.map((shape) => ({
              value: shape,
              label: t(`mosaicShape_${shape}`),
              renderIcon: () => renderGradientShapeIcon(shape),
            })),
            value: state.densityMask.shape,
            onChange: (value) => {
              state.densityMask.shape = value;
              buildSidebar();
              render();
            },
          });
          cleanupGradientShapeSelect = shapeSelect.destroy;
          maskElements.push(shapeSelect.el);

          if (state.seamless) {
            const shapeHint = document.createElement('p');
            shapeHint.className = 'control-hint';
            shapeHint.textContent = t('mosaicSeamlessMaskShapeHint');
            maskElements.push(shapeHint);
          }

          if (state.seamless && state.densityMask.shape === 'reflected') {
            // refletido só casa nas duas bordas se o eixo de reflexão for
            // exatamente horizontal ou vertical — um ângulo livre quebraria
            // a costura em uma das duas direções.
            maskElements.push(
              createSelect({
                label: t('mosaicSeamlessAxisLabel'),
                options: [
                  { value: '0', label: t('mosaicSeamlessAxisHorizontal') },
                  { value: '90', label: t('mosaicSeamlessAxisVertical') },
                ],
                value: String(state.densityMask.angleDeg),
                onChange: (value) => {
                  state.densityMask.angleDeg = Number(value);
                  render();
                },
              }).el
            );
          } else if (SHAPES_WITH_ANGLE.includes(state.densityMask.shape)) {
            maskElements.push(
              createSlider({
                label: t('mosaicAngleLabel'),
                min: 0,
                max: 359,
                step: 1,
                value: state.densityMask.angleDeg,
                formatValue: (v) => `${v}°`,
                onChange: (value) => {
                  state.densityMask.angleDeg = value;
                  render();
                },
              }).el
            );
          }
          if (state.densityMask.shape === 'radial') {
            maskElements.push(
              createSelect({
                label: t('mosaicRadialModeLabel'),
                options: [
                  { value: 'center-out', label: t('mosaicRadialCenterOut') },
                  { value: 'edge-out', label: t('mosaicRadialEdgeOut') },
                ],
                value: state.densityMask.mode,
                onChange: (value) => {
                  state.densityMask.mode = value;
                  render();
                },
              }).el
            );
          }
        }

        maskElements.push(
          createSlider({
            label: t('mosaicSmoothnessLabel'),
            min: 0,
            max: 100,
            step: 5,
            value: Math.round(state.densityMask.smoothness * 100),
            formatValue: (v) => `${v}%`,
            onChange: (value) => {
              state.densityMask.smoothness = value / 100;
              render();
            },
          }).el
        );
      }

      sidebar.appendChild(createSection(t('mosaicMaskSection'), maskElements));

      const seamlessElements = [
        createToggleSwitch({
          label: t('mosaicSeamlessLabel'),
          value: state.seamless,
          onChange: (checked) => setSeamless(checked),
        }).el,
      ];
      if (state.seamless) {
        const aiHint = document.createElement('p');
        aiHint.className = 'control-hint';
        aiHint.textContent = t('mosaicExportAiHint');
        seamlessElements.push(aiHint);
      }
      sidebar.appendChild(createSection(t('mosaicSeamlessSectionTitle'), seamlessElements));

      const exportSvgButton = createButton({
        label: t('exportSvgButton'),
        variant: 'primary',
        onClick: () => exportSvgString(preview.innerHTML, 'mosaico.svg'),
      });
      const exportPngButton = createButton({
        label: t('exportPngButton'),
        variant: 'primary',
        onClick: () => exportPngFromSvgString(preview.innerHTML, 'mosaico.png'),
      });
      const actions = document.createElement('div');
      actions.className = 'mo-actions';
      if (state.seamless) {
        const exportAiButton = createButton({
          label: t('mosaicExportAiButton'),
          variant: 'primary',
          onClick: () => exportSeamlessPatternAsAi(preview.innerHTML, 'padrao.ai'),
        });
        actions.appendChild(exportAiButton.el);
      }
      actions.appendChild(exportSvgButton.el);
      actions.appendChild(exportPngButton.el);
      sidebar.appendChild(actions);
    }

    buildSidebar();
    stage.appendChild(resultTitle);
    stage.appendChild(previewWrap);
    stage.appendChild(stageToolbar);
    stage.appendChild(repeatPreviewWrap);
    root.appendChild(sidebar);
    root.appendChild(stage);
    container.appendChild(root);

    render();

    cleanupPaste = listenForPaste(window, { onImage: (file) => handleMaskImage(file) });
    cleanupLang = onLangChange(() => {
      resultTitle.textContent = t('mosaicResultTitle');
      repeatPreviewTitle.textContent = t('mosaicRepeatPreviewTitle');
      shuffleButton.el.textContent = t('mosaicShuffleButton');
      buildSidebar();
    });
  },

  unmount() {
    if (cleanupPaste) {
      cleanupPaste();
      cleanupPaste = null;
    }
    if (cleanupLang) {
      cleanupLang();
      cleanupLang = null;
    }
    if (cleanupGradientShapeSelect) {
      cleanupGradientShapeSelect();
      cleanupGradientShapeSelect = null;
    }
  },
};
