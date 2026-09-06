import { PRESETS, clonePreset } from '../../core/palette.js';
import { hexToHsl, hslToHex, generateHarmoniousPalette } from '../../core/color.js';
import { randomSeed } from '../../core/seed.js';
import {
  patternState,
  patternHistory,
  isPatternStateInitialized,
  markPatternStateInitialized,
} from '../../core/patternState.js';
import { SYMMETRY_VALUES } from '../../core/symmetry.js';
import { exportSvgString, exportPngFromSvgString, EXPORT_FRAME_RATIOS } from '../../core/export.js';
import { listenForPaste, loadImageAsset } from '../../core/clipboard-input.js';
import { openDrawCanvas } from '../../ui/drawCanvas.js';
import { extractPaletteFromBlob } from '../../core/imagePalette.js';
import { sampleImageGrid } from '../../core/imageSampling.js';
import { t, onLangChange } from '../../core/i18n.js';
import { createSlider } from '../../ui/controls/slider.js';
import { createSelect } from '../../ui/controls/select.js';
import { createIconSelect } from '../../ui/controls/iconSelect.js';
import { createColorSwatches } from '../../ui/controls/colorSwatches.js';
import { createShapeToggleGrid } from '../../ui/controls/shapeToggleGrid.js';
import { createToggleSwitch } from '../../ui/controls/toggleSwitch.js';
import { createButton, setButtonLabel } from '../../ui/controls/button.js';
import { createPressButton } from '../../ui/controls/pressButton.js';
import { createSection } from '../../ui/controls/section.js';
import { createFrameTilePicker } from '../../ui/controls/frameTilePicker.js';
import { CATEGORY_ICONS } from '../../ui/categoryIcons.js';
import { TOOLBAR_ICONS } from '../../ui/toolbarIcons.js';
import { SHAPES } from './shapes.js';
import {
  generateIcon,
  generateFramedIcon,
  framedGridDims,
  buildIconGrid,
  renderGridToSvg,
  buildCustomShapeDefs as buildCustomShapeDefsFromList,
} from './generator.js';
import { sanitizeSvgForRecolor } from './svgVectorShape.js';

const LINEAR_GRADIENT_DIRECTIONS = [
  'left-to-right',
  'right-to-left',
  'top-to-bottom',
  'bottom-to-top',
  'tl-to-br',
  'br-to-tl',
  'tr-to-bl',
  'bl-to-tr',
];

const ICON_SIZE = 420;
const VARIATION_SIZE = 96;
const VARIATION_COUNT = 6;
const HISTORY_THUMB_SIZE = 88;
const HISTORY_LIMIT = 24;
const THEMES_URL = new URL('./themes.json', import.meta.url);
const PRESETS_STORAGE_KEY = 'gpg-grid-icons-presets';

function loadSavedPresets() {
  try {
    const raw = localStorage.getItem(PRESETS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

function persistSavedPresets(list) {
  try {
    localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(list));
  } catch (err) {
    // localStorage cheio ou indisponível — preset só não persiste, sem travar a UI
  }
}

let cleanupPaste = null;
let cleanupLang = null;
let cleanupThemeDropdown = null;
let cleanupColorMenu = null;
let cleanupPaletteSwapSelect = null;
let cleanupKeyboardShortcuts = null;
let cleanupFrameResize = null;

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min, max) {
  return Math.random() * (max - min) + min;
}

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export const gridIconsModule = {
  id: 'grid-icons',
  label: () => t('tabGridIcons'),

  async mount(container) {
    const fetchedThemes = await fetch(THEMES_URL).then((res) => res.json());
    // "Limpo" não é um tema visual como os outros (não tem curadoria de
    // cor/forma/simetria) — é o ponto de partida zerado que o usuário pediu,
    // por isso vive aqui como entrada sintética em vez de mais uma linha no
    // themes.json.
    const themes = {
      blank: {
        label: 'Limpo',
        preset: 'blank',
        shapes: ['square', 'disc'],
        resolution: 2,
        symmetry: 'none',
        fillDensity: 1,
        subdivisionChance: 0,
        detailGradient: 'uniform',
        fillMode: 'solid',
        strokeWidth: 0.24,
        rotation: 0,
      },
      ...fetchedThemes,
    };
    const themeKeys = Object.keys(themes);

    // state/history vivem em core/patternState.js (singleton de módulo) —
    // sobrevivem a mount()/unmount() repetidos (trocar de aba e voltar) e são
    // lidos ao vivo pelo módulo Mosaico. Aliasar pra `state`/`history` aqui
    // evita ter que renomear as centenas de usos existentes no resto do arquivo.
    const state = patternState;
    const history = patternHistory;
    // tudo aberto por padrão ao entrar/voltar pra aba, em qualquer tamanho
    // de tela — a ideia de começar tudo recolhido (só pra descobrir
    // clicando) acabou escondendo os próprios ajustes de quem visita o
    // site pela primeira vez; melhor deixar tudo à vista de cara. No
    // mobile isso já valia (calculado 1x no mount — não muda se a pessoa
    // girar a tela ou redimensionar depois); agora vale igual no desktop.
    const isMobileViewport = window.matchMedia('(max-width: 768px)').matches;
    const collapsedSections = {
      reference: false,
      grid: false,
      detail: false,
      fill: false,
      gradient: false,
      shapes: false,
      colors: false,
      harmony: false,
      appearance: false,
      presets: false,
      share: false,
    };
    let savedPresets = loadSavedPresets();
    let themeDropdownOpen = false;
    let selectedGradientStopIndex = 0;
    // formato de exportação do PNG (o SVG sempre sai quadrado) — só
    // interessa na hora de exportar, não faz parte da "receita" do ícone,
    // então fica fora do state/snapshot (não polui presets nem histórico).
    let exportFrame = 'square';
    // guarda o ícone "cru" (sempre quadrado 1:1, o resultado editável de
    // sempre) — nunca muda com o "Formato de exportação".
    let currentIconSvg = '';
    // já com o "Formato de exportação" aplicado — igual a currentIconSvg
    // quando o formato é quadrado; nos outros formatos é uma composição
    // própria gerada por generateFramedIcon (ver updatePreviewFrame). É o
    // que os botões de exportar (SVG/PNG) usam de verdade.
    let currentFramedIconSvg = '';
    // barra de categorias do mobile (Tema/Grade/Detalhe/...) — só existe
    // depois de buildSidebar() rodar; guardada aqui pra computePreviewBoxSize
    // medir a altura real dela (o "bottom sheet" fixo reserva só esse
    // tanto de espaço pro preview, não o painel de ajustes inteiro).
    let mobileCategoryTabsEl = null;
    // qual categoria (id da seção) está aberta no "bottom sheet" mobile —
    // null = nenhuma (painel fechado). buildSidebar() roda de novo a
    // QUALQUER mudança de estado (mover um slider, trocar uma cor...), e
    // sem guardar isso aqui fora, cada rebuild recriava os inputs do zero
    // e voltava tudo pra "nenhuma marcada" (ou, antes, sempre pra
    // "Formato", a primeira) — na prática, o painel fechava (ou pulava de
    // volta pro Formato) sozinho no meio do uso, cada vez que você mexia
    // em qualquer coisa.
    let mobileActiveCategoryId = null;
    // input (radio) escondido que controla o painel de Exportar no
    // mobile — vive fora da barra de categorias visível (é uma AÇÃO, tem
    // seu próprio ícone na trilha do preview, ver toggleMobileExportPanel),
    // mas reaproveita o mesmo :has() em style.css pra aparecer/sumir.
    let mobileExportInputEl = null;

    function handleDocumentClickForThemeDropdown(e) {
      if (!themeDropdownOpen) return;
      const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
      const insideCombo = path.some((node) => node instanceof Element && node.classList?.contains('theme-combo'));
      if (!insideCombo) {
        themeDropdownOpen = false;
        buildSidebar();
      }
    }

    // Esc fecha o dropdown de tema aberto — sem isso, um usuário de
    // teclado só conseguia fechar clicando fora (o clique fora já é
    // tratado acima), sem atalho nenhum pra quem não usa mouse.
    function handleDocumentKeydownForThemeDropdown(e) {
      if (e.key === 'Escape' && themeDropdownOpen) {
        themeDropdownOpen = false;
        buildSidebar();
      }
    }

    function savePreset(name) {
      const preset = {
        id: `preset-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        name,
        snapshot: buildBaseSnapshot(),
      };
      savedPresets = [preset, ...savedPresets];
      persistSavedPresets(savedPresets);
      buildSidebar();
    }

    // presets salvos (localStorage) ou histórico de sessões antigas (antes do
    // fill/stroke virarem independentes) só têm `fillMode` — Object.assign
    // não zera fillEnabled/strokeEnabled/strokeColor sozinho, então sem isso
    // o valor ATUAL (de antes de aplicar o preset) vazaria por cima.
    function normalizeFillStrokeFields(snapshot) {
      if (!('strokeOutlineWidth' in snapshot)) state.strokeOutlineWidth = 1;
      // presets/histórico antigos podiam ter espessura de até 6 (faixa antiga
      // do controle) — o controle atual vai só até 1.5, então recorta pra não
      // deixar um valor fora do alcance do slider parado no estado.
      state.strokeOutlineWidth = Math.min(1.5, state.strokeOutlineWidth ?? 1);
      if (!('gradientStops' in snapshot)) {
        state.gradientStops = [
          { position: 0, color: '#c1502e' },
          { position: 1, color: '#e0a458' },
        ];
      }
      if (!('grainColor' in snapshot)) state.grainColor = '#000000';
      if ('fillEnabled' in snapshot) return;
      state.fillEnabled = true;
      state.strokeEnabled = snapshot.fillMode === 'outline';
      state.strokeColor = state.strokeColor || '#000000';
      state.gradientFillEnabled = false;
      state.grainEnabled = false;
    }

    // usado tanto por presets salvos (applyPreset) quanto pelo código
    // compartilhável (ver seção "Compartilhar") — os dois carregam o mesmo
    // formato de snapshot (buildBaseSnapshot), só a origem dele muda.
    function applySnapshot(snapshot) {
      pushToHistory();
      Object.assign(state, snapshot);
      state.colors = snapshot.colors.map((c) => ({ ...c }));
      state.shapesAllowed = [...snapshot.shapesAllowed];
      state.customShapes = snapshot.customShapes.map((s) => ({ ...s }));
      normalizeFillStrokeFields(snapshot);
      refreshGridOverrideIfEditing();
      buildSidebar();
      render();
    }

    function applyPreset(preset) {
      applySnapshot(preset.snapshot);
    }

    function deletePreset(id) {
      savedPresets = savedPresets.filter((p) => p.id !== id);
      persistSavedPresets(savedPresets);
      buildSidebar();
    }

    function sectionOptions(id, onRandomize) {
      return {
        id,
        // no mobile a seção não colapsa mais sozinha — ver
        // .gi-mobile-category-tabs: lá é a aba de categoria que decide
        // qual seção aparece, não o chevron de cada uma.
        collapsed: isMobileViewport ? false : !!collapsedSections[id],
        onToggleCollapse: (collapsed) => {
          collapsedSections[id] = collapsed;
        },
        onRandomize,
      };
    }

    function applyTheme(themeKey) {
      const theme = themes[themeKey];
      const preset = clonePreset(PRESETS[theme.preset]);
      state.themeKey = themeKey;
      state.background = preset.background;
      state.colors = preset.colors;
      state.shapesAllowed = theme.shapes;
      // só "Limpo" define resolution (quer sempre abrir na menor grade) —
      // os outros temas nunca mexeram nisso, então o fallback mantém a
      // resolução atual intocada pra eles.
      state.resolution = theme.resolution ?? state.resolution;
      state.symmetry = theme.symmetry;
      state.fillDensity = theme.fillDensity;
      state.subdivisionChance = theme.subdivisionChance ?? 0;
      state.detailGradient = theme.detailGradient ?? 'uniform';
      // themes.json só chegou a definir fillMode (nunca fillEnabled/
      // strokeEnabled) — reconstrói o equivalente a partir dele.
      state.fillEnabled = theme.fillEnabled ?? true;
      state.strokeEnabled = theme.strokeEnabled ?? theme.fillMode === 'outline';
      state.strokeColor = theme.strokeColor ?? state.strokeColor ?? '#000000';
      state.strokeWidth = theme.strokeWidth ?? 0.24;
      state.strokeOutlineWidth = theme.strokeOutlineWidth ?? 1;
      state.gradientFillEnabled = theme.gradientFillEnabled ?? false;
      state.gradientFillAngle = theme.gradientFillAngle ?? 45;
      // sem receita definida no tema: usa as 2 primeiras cores da paleta dele
      // como ponto de partida (a pessoa edita livremente depois, no editor
      // de degradê — ver seção Preenchimento).
      state.gradientStops = theme.gradientStops ?? [
        { position: 0, color: preset.colors[0]?.color ?? '#c1502e' },
        { position: 1, color: preset.colors[1]?.color ?? preset.colors[0]?.color ?? '#e0a458' },
      ];
      state.grainEnabled = theme.grainEnabled ?? false;
      state.grainIntensity = theme.grainIntensity ?? 0.6;
      state.grainSize = theme.grainSize ?? 0.5;
      state.grainColor = theme.grainColor ?? '#000000';
      state.rotation = theme.rotation ?? 0;
      // trocar de tema deve mostrar as cores de verdade do tema — "inverter
      // cores"/"ícone preto" ligados de uma randomização anterior ("Estou com
      // sorte") ficavam grudados e o tema parecia estar com a paleta errada.
      state.invertColors = false;
      state.blackIcon = false;
      // trocar de tema não deve religar a simetria por cima do guia de imagem —
      // isso é o que causava o padrão "parar de seguir" o desenho/foto de referência.
      if (state.useImageGuide) {
        state.symmetryBeforeImageGuide = state.symmetry;
        state.symmetry = 'none';
      }
      refreshGridOverrideIfEditing();
    }

    function applyPaletteOnly(key) {
      // "Personalizado" no dropdown é só o status atual, não uma paleta de
      // verdade — selecionar ela nesse estado não deve fazer nada.
      if (key === 'custom') return;
      const preset = clonePreset(PRESETS[key]);
      pushToHistory();
      state.themeKey = 'custom';
      state.background = preset.background;
      state.colors = preset.colors;
      // mesma razão do applyTheme: escolher uma paleta com nome deve mostrar
      // as cores dela de verdade, não uma versão invertida/silhueta que
      // ficou ligada de antes.
      state.invertColors = false;
      state.blackIcon = false;
      buildSidebar();
      render();
    }

    // --- randomização por seção: cada uma mexe só nos próprios campos de
    // state, sem histórico/render — quem chama decide quando aplicar isso
    // (botão "Estou com sorte" chama todas, cada seção chama só a sua).

    function randomizeGridSettings() {
      state.resolution = randomInt(4, 10);
      state.fillDensity = randomFloat(0.35, 1);
      state.rotation = randomChoice([0, 90, 180, 270]);
      if (!state.useImageGuide && state.densityGradient === 'none') {
        state.symmetry = randomChoice(SYMMETRY_VALUES);
        state.symmetryBeforeImageGuide = state.symmetry;
      }
    }

    function randomizeDetailSettings() {
      state.subdivisionChance = randomFloat(0, 0.4);
      state.detailGradient = randomChoice(['uniform', 'edge', 'center']);
    }

    function randomizeFillSettings() {
      // nunca sorteia os dois desligados — pelo menos um sempre fica ligado.
      const mode = randomChoice(['fill', 'stroke', 'both']);
      state.fillEnabled = mode !== 'stroke';
      state.strokeEnabled = mode !== 'fill';
      state.strokeWidth = randomFloat(0.1, 0.36);
      if (state.strokeEnabled) {
        state.strokeColor = hslToHex(randomFloat(0, 360), randomInt(20, 90), randomInt(10, 40));
        state.strokeOutlineWidth = randomFloat(0.3, 1.5);
      }
      state.gradientFillEnabled = state.fillEnabled && Math.random() < 0.5;
      if (state.gradientFillEnabled) {
        state.gradientFillAngle = randomInt(0, 23) * 15;
        // sorteia de 2 a 4 stops (posições espalhadas + uma cor aleatória da
        // paleta cada) pra receita de degradê.
        const palette = state.colors.map((c) => c.color);
        const stopCount = Math.min(palette.length, randomInt(2, 4));
        state.gradientStops = Array.from({ length: stopCount }, (_, i) => ({
          position: stopCount === 1 ? 0 : i / (stopCount - 1),
          color: randomChoice(palette),
        }));
      }
    }

    function randomizeGradientSettings() {
      if (state.useImageGuide) return;
      state.densityGradient = randomChoice(['none', 'linear', 'linear', 'radial']);
      state.gradientDirection =
        state.densityGradient === 'radial'
          ? randomChoice(['center-out', 'edge-out'])
          : randomChoice(LINEAR_GRADIENT_DIRECTIONS);
      state.gradientStrength = randomFloat(0.5, 1);
    }

    function randomizeShapesSettings() {
      const nativeKeys = Object.keys(SHAPES);
      const shuffledNative = [...nativeKeys].sort(() => Math.random() - 0.5);
      const pickCount = randomInt(3, Math.min(6, nativeKeys.length));
      const customKeys = state.customShapes.map((s) => s.key).filter(() => Math.random() < 0.5);
      state.shapesAllowed = [...shuffledNative.slice(0, pickCount), ...customKeys];
      if (state.shapesAllowed.length === 0) state.shapesAllowed = [randomChoice(nativeKeys)];
    }

    function randomizeColorSettings() {
      const baseHue = randomFloat(0, 360);
      const baseColor = hslToHex(baseHue, randomInt(50, 85), randomInt(45, 60));
      state.colors = generateHarmoniousPalette(baseColor, randomInt(2, 6));
      state.harmonyBaseColor = baseColor;
      const bgIsDark = Math.random() < 0.5;
      state.background = hslToHex(baseHue, randomInt(15, 35), bgIsDark ? randomInt(8, 16) : randomInt(90, 97));
      state.themeKey = 'custom';
      // mesma razão do applyTheme/applyPaletteOnly — ver comentário lá. Em
      // "Estou com sorte" isso roda antes de randomizeAppearanceSettings, que
      // pode religar invertColors por conta própria, então não conflita.
      state.invertColors = false;
      state.blackIcon = false;
    }

    function randomizeAppearanceSettings() {
      state.transparentBg = Math.random() < 0.15;
      state.blackIcon = Math.random() < 0.15;
      state.invertColors = Math.random() < 0.2;
    }

    function randomizeSection(randomizeFn) {
      pushToHistory();
      randomizeFn();
      refreshGridOverrideIfEditing();
      buildSidebar();
      render();
    }

    function randomizeAll() {
      pushToHistory();
      randomizeGridSettings();
      randomizeDetailSettings();
      randomizeFillSettings();
      randomizeGradientSettings();
      randomizeShapesSettings();
      randomizeColorSettings();
      randomizeAppearanceSettings();
      state.seed = randomSeed();
      refreshGridOverrideIfEditing();
      buildSidebar();
      render();
    }

    // só aplica o tema padrão na primeiríssima montagem — em remontagens
    // (voltar da aba Mosaico, por exemplo) o patternState já tem tudo que o
    // usuário configurou, e reaplicar o tema por cima apagaria isso.
    if (!isPatternStateInitialized()) {
      markPatternStateInitialized();
      // "Limpo" é o primeiro do array (pra aparecer primeiro no dropdown/
      // ciclo de setas), mas não deve ser o tema que a pessoa vê na
      // primeiríssima visita — pula pro primeiro tema "de verdade".
      applyTheme(themeKeys.find((key) => key !== 'blank') ?? themeKeys[0]);
    }

    const root = document.createElement('div');
    root.className = 'gi-layout';

    const sidebar = document.createElement('div');
    sidebar.className = 'gi-controls';

    const stage = document.createElement('div');
    stage.className = 'gi-stage';

    const resultTitle = document.createElement('div');
    resultTitle.className = 'gi-result-title';
    resultTitle.textContent = t('resultTitle');

    const previewWrap = document.createElement('div');
    previewWrap.className = 'gi-preview-wrap';

    const preview = document.createElement('div');
    preview.className = 'gi-preview';
    previewWrap.appendChild(preview);

    // botão de pressionar (não switch, não pílula) — precisa ser
    // visivelmente diferente das abas Resultado/Variações/Histórico (que
    // ficam do lado dele agora, na mesma linha) pra não confundir os dois
    // tipos de controle. "Editar" sempre curto (a explicação completa do
    // gesto de arraste continua acessível via aria-label/title).
    const gridEditToggleRow = createPressButton({
      label: t('fineControlLabelShort'),
      value: state.gridEditEnabled,
      onChange: setGridEditEnabled,
    });
    gridEditToggleRow.el.classList.add('gi-grid-edit-toggle');
    gridEditToggleRow.el.title = t('fineControlLabel');
    gridEditToggleRow.el.setAttribute('aria-label', t('fineControlLabel'));

    function createCollapsibleGallerySection(labelKey, row) {
      const header = document.createElement('div');
      header.className = 'gi-gallery-header';

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'gi-gallery-toggle';
      const chevron = document.createElement('span');
      chevron.className = 'gi-gallery-chevron';
      chevron.textContent = '▾';
      const label = document.createElement('span');
      label.className = 'gi-section-label';
      label.textContent = t(labelKey);
      toggle.appendChild(chevron);
      toggle.appendChild(label);

      let collapsed = false;
      toggle.addEventListener('click', () => {
        collapsed = !collapsed;
        row.style.display = collapsed ? 'none' : '';
        toggle.classList.toggle('collapsed', collapsed);
      });

      header.appendChild(toggle);
      return { header, label };
    }

    const variationsRow = document.createElement('div');
    variationsRow.className = 'gi-variations';
    const variationsSection = createCollapsibleGallerySection('variationsLabel', variationsRow);

    const historyRow = document.createElement('div');
    historyRow.className = 'gi-history';
    const historySection = createCollapsibleGallerySection('historyLabel', historyRow);
    const historyLabel = historySection.label;
    const variationsLabel = variationsSection.label;

    // agrupados num wrapper cada (em vez de soltos direto dentro de
    // .gi-gallery) só pra ter um seletor estável — no mobile, cada bloco
    // vira o conteúdo de uma aba própria (Variações / Histórico), ver
    // .gi-mobile-tabs em style.css.
    const variationsBlock = document.createElement('div');
    variationsBlock.className = 'gi-gallery-block gi-gallery-block--variations';
    variationsBlock.appendChild(variationsSection.header);
    variationsBlock.appendChild(variationsRow);

    const historyBlock = document.createElement('div');
    historyBlock.className = 'gi-gallery-block gi-gallery-block--history';
    historyBlock.appendChild(historySection.header);
    historyBlock.appendChild(historyRow);

    const gallery = document.createElement('div');
    gallery.className = 'gi-gallery';
    gallery.appendChild(variationsBlock);
    gallery.appendChild(historyBlock);

    const stageToolbar = document.createElement('div');
    stageToolbar.className = 'gi-stage-toolbar';

    // nomeadas (em vez de inline) pra poder reaproveitar a MESMA ação nos
    // dois formatos de botão: a pílula com texto (.gi-stage-toolbar, ainda
    // como está no desktop) e a trilha de ícones (.gi-stage-toolbar-rail,
    // só no mobile — ver mais abaixo).
    function handleRegenerate() {
      pushToHistory();
      state.seed = randomSeed();
      refreshGridOverrideIfEditing();
      render();
    }
    function handleShowVariations() {
      renderVariations();
    }
    function handleLucky() {
      randomizeAll();
    }

    // abre/fecha o painel de exportar no mobile — mesmo mecanismo de
    // radio+:has() das outras categorias (ver buildSidebar, perto de
    // mobileExportInputEl), só que o gatilho é o 4º ícone da trilha do
    // preview, não um ícone na barra de categorias (exportar é uma AÇÃO,
    // não um ajuste — não faz sentido misturado com Tema/Grade/Cores).
    function toggleMobileExportPanel() {
      if (!mobileExportInputEl) return;
      const opening = !mobileExportInputEl.checked;
      mobileExportInputEl.checked = opening;
      mobileActiveCategoryId = opening ? 'export' : null;
      if (opening) {
        mobileExportInputEl
          .closest('.gi-controls')
          ?.querySelector('[data-section-id="export"]')
          ?.scrollTo?.({ top: 0, behavior: 'smooth' });
      }
    }

    const regenerateButton = createButton({
      label: t('regenerateButton'),
      variant: 'primary',
      // mesmos ícones do trio de ícones do mobile (seta circular/quadrados
      // sobrepostos/estrela) — não o coração/quadrados empilhados que
      // usei antes; o pedido era pra igualar no sentido contrário (o
      // desktop seguir o que o mobile já usava, não o oposto).
      icon: TOOLBAR_ICONS.regenerate,
      onClick: handleRegenerate,
    });
    const variationsButton = createButton({
      label: t('variationsButton'),
      icon: TOOLBAR_ICONS.variations,
      onClick: handleShowVariations,
    });
    const luckyButton = createButton({ label: t('luckyButton'), icon: TOOLBAR_ICONS.lucky, onClick: handleLucky });

    stageToolbar.appendChild(regenerateButton.el);
    stageToolbar.appendChild(variationsButton.el);
    stageToolbar.appendChild(luckyButton.el);

    // no mobile, os mesmos 3 botões viram ícones numa trilha vertical à
    // ESQUERDA do preview (em vez de pílulas com texto embaixo dele) — dá
    // mais altura livre pro painel de ajustes logo abaixo (ver
    // .gi-stage-toolbar-rail/.gi-preview-row em style.css; a pílula com
    // texto continua existindo no DOM pro desktop, só fica display:none
    // no mobile).
    function createToolbarRailButton(iconSvg, label, variant, onClick) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'gi-toolbar-rail-button' + (variant === 'primary' ? ' gi-toolbar-rail-button-primary' : '');
      btn.innerHTML = iconSvg;
      btn.title = label;
      btn.setAttribute('aria-label', label);
      btn.addEventListener('click', onClick);
      return btn;
    }

    const toolbarRail = document.createElement('div');
    toolbarRail.className = 'gi-stage-toolbar-rail';
    // mesmos ícones que a pílula com texto do desktop agora usa também
    // (seta circular/quadrados sobrepostos/estrela) — os dois tamanhos de
    // tela usam o mesmo jogo de ícones pra mesma ação.
    const regenerateRailButton = createToolbarRailButton(
      TOOLBAR_ICONS.regenerate,
      t('regenerateButton'),
      'primary',
      handleRegenerate
    );
    const variationsRailButton = createToolbarRailButton(
      TOOLBAR_ICONS.variations,
      t('variationsButton'),
      'default',
      handleShowVariations
    );
    const luckyRailButton = createToolbarRailButton(TOOLBAR_ICONS.lucky, t('luckyButton'), 'default', handleLucky);
    // 4º ícone, só existe no mobile (ver toggleMobileExportPanel acima) —
    // exportar. No desktop os botões de exportar continuam soltos no fim
    // da sidebar, do jeito de sempre; aqui viram um atalho igual aos
    // outros 3, ao lado deles, que abre o mesmo painel de exportar como
    // um "bottom sheet" por cima do preview.
    const exportRailButton = createToolbarRailButton(TOOLBAR_ICONS.export, t('exportSectionTitle'), 'default', () =>
      toggleMobileExportPanel()
    );
    toolbarRail.appendChild(regenerateRailButton);
    toolbarRail.appendChild(variationsRailButton);
    toolbarRail.appendChild(luckyRailButton);
    toolbarRail.appendChild(exportRailButton);

    // aba "Resultado / Variações / Histórico" — no desktop vira uma trilha
    // vertical à direita do preview; no mobile, uma barra de pílulas em
    // cima (ver .gi-stage-tabs em style.css — mesmo markup, só a posição/
    // orientação muda por CSS). Só um dos 3 blocos aparece por vez, via
    // :has() (ver .gi-stage:has(#gi-stage-tab-... :checked) em style.css) —
    // funciona independente de onde a trilha esteja no DOM.
    const stageTabs = document.createElement('div');
    stageTabs.className = 'gi-stage-tabs';

    function createStageTabInput(id, checked) {
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'gi-stage-tab';
      input.id = id;
      input.className = 'gi-stage-tabs-input';
      input.checked = checked;
      return input;
    }

    function createStageTabLabel(forId, text) {
      const label = document.createElement('label');
      label.htmlFor = forId;
      label.className = 'gi-stage-tabs-label';
      label.textContent = text;
      return label;
    }

    const resultTabInput = createStageTabInput('gi-stage-tab-result', true);
    const variationsTabInput = createStageTabInput('gi-stage-tab-variations', false);
    const historyTabInput = createStageTabInput('gi-stage-tab-history', false);

    const resultTabLabel = createStageTabLabel(resultTabInput.id, t('resultTitle'));
    const variationsTabLabel = createStageTabLabel(variationsTabInput.id, t('variationsLabel'));
    const historyTabLabel = createStageTabLabel(historyTabInput.id, t('historyLabel'));

    stageTabs.append(
      resultTabInput,
      resultTabLabel,
      variationsTabInput,
      variationsTabLabel,
      historyTabInput,
      historyTabLabel
    );

    // trilha de abas + botão "Editar" numa linha só — Editar sempre à
    // ESQUERDA de tudo (não à direita), então vem primeiro no DOM.
    const stageTabsRow = document.createElement('div');
    stageTabsRow.className = 'gi-stage-tabs-row';
    stageTabsRow.appendChild(gridEditToggleRow.el);
    stageTabsRow.appendChild(stageTabs);

    // "Resultado" (preview + botões) agrupado num wrapper próprio — junto
    // com .gi-gallery, são os 2 "conteúdos" possíveis da área principal; a
    // aba decide qual dos dois aparece.
    const previewRow = document.createElement('div');
    previewRow.className = 'gi-preview-row';
    previewRow.appendChild(previewWrap);

    const resultBlock = document.createElement('div');
    resultBlock.className = 'gi-result-block';
    resultBlock.appendChild(resultTitle);
    // pílula "Novo azulejo/Criar variações/Estou com sorte" ABAIXO do
    // preview (Editar/Resultado/Variações/Histórico ficam ACIMA, ver
    // stageTabsRow — faz mais sentido a navegação entre resultado/
    // variações/histórico vir primeiro, as ações de gerar vêm depois,
    // junto do que elas afetam). No mobile a pílula vira a trilha de
    // ícones (toolbarRail), também embaixo do preview (não mais ao lado,
    // tomando espaço horizontal da própria arte) — por isso appendada
    // logo depois de stageToolbar, os dois nunca aparecem juntos.
    resultBlock.appendChild(previewRow);
    resultBlock.appendChild(stageToolbar);
    resultBlock.appendChild(toolbarRail);

    const stageContent = document.createElement('div');
    stageContent.className = 'gi-stage-content';
    stageContent.appendChild(resultBlock);
    stageContent.appendChild(gallery);

    stage.appendChild(stageTabsRow);
    stage.appendChild(stageContent);

    function buildCustomShapeDefs() {
      return buildCustomShapeDefsFromList(state.customShapes);
    }

    function iconParams(seed, size = ICON_SIZE) {
      const imageGuide =
        state.useImageGuide && state.structureImageEl
          ? { grid: sampleImageGrid(state.structureImageEl, state.resolution) }
          : null;
      // simetria espelha/rotaciona a partir de uma única célula-semente — isso
      // confinaria o gradiente a um quadrante e o resultado pareceria "quebrado"
      // em vez de uma varredura única pela grade inteira.
      const effectiveSymmetry = state.densityGradient !== 'none' ? 'none' : state.symmetry;
      return {
        seed,
        size: state.resolution,
        iconSize: size,
        symmetry: effectiveSymmetry,
        fillDensity: state.fillDensity,
        subdivisionChance: state.subdivisionChance,
        detailGradient: state.detailGradient,
        fillEnabled: state.fillEnabled,
        strokeEnabled: state.strokeEnabled,
        strokeColor: state.strokeColor,
        strokeWidth: state.strokeWidth,
        strokeOutlineWidth: state.strokeOutlineWidth,
        gradientFillEnabled: state.gradientFillEnabled,
        gradientFillAngle: state.gradientFillAngle,
        gradientStops: state.gradientStops,
        grainEnabled: state.grainEnabled,
        grainIntensity: state.grainIntensity,
        grainSize: state.grainSize,
        grainColor: state.grainColor,
        rotation: state.rotation,
        shapesAllowed: state.shapesAllowed,
        background: state.background,
        colors: state.colors,
        imageGuide,
        customShapeDefs: buildCustomShapeDefs(),
        densityGradient: state.densityGradient,
        gradientDirection: state.gradientDirection,
        gradientStrength: state.gradientStrength,
        appearance: {
          transparentBackground: state.transparentBg || state.blackIcon,
          silhouette: state.blackIcon,
          invert: state.invertColors,
          inkColor: '#000000',
        },
      };
    }

    function iconSvg(seed, size = ICON_SIZE) {
      return generateIcon(iconParams(seed, size));
    }

    // "impressão digital" dos ajustes que afetam a geração — se qualquer um
    // deles mudar depois que a grade foi congelada pra edição manual, a edição
    // deixa de fazer sentido (ex: resolução mudou, a grade nem tem mais o mesmo
    // tamanho) e a gente descarta o congelamento pra voltar a gerar ao vivo.
    // Rotação fica de fora de propósito: só gira o resultado editado junto,
    // não invalida a edição.
    function generationSignature() {
      return JSON.stringify({
        resolution: state.resolution,
        fillDensity: state.fillDensity,
        subdivisionChance: state.subdivisionChance,
        detailGradient: state.detailGradient,
        fillEnabled: state.fillEnabled,
        strokeEnabled: state.strokeEnabled,
        strokeColor: state.strokeColor,
        strokeWidth: state.strokeWidth,
        strokeOutlineWidth: state.strokeOutlineWidth,
        gradientFillEnabled: state.gradientFillEnabled,
        gradientFillAngle: state.gradientFillAngle,
        gradientStops: state.gradientStops,
        grainEnabled: state.grainEnabled,
        grainIntensity: state.grainIntensity,
        grainSize: state.grainSize,
        grainColor: state.grainColor,
        symmetry: state.symmetry,
        shapesAllowed: state.shapesAllowed,
        background: state.background,
        colors: state.colors,
        densityGradient: state.densityGradient,
        gradientDirection: state.gradientDirection,
        gradientStrength: state.gradientStrength,
        useImageGuide: state.useImageGuide,
        structureImageUrl: state.structureImageUrl,
        customShapes: state.customShapes.map((s) => s.key),
        transparentBg: state.transparentBg,
        blackIcon: state.blackIcon,
        invertColors: state.invertColors,
      });
    }

    // core/symmetry.js reaproveita o MESMO objeto de célula entre cópias
    // espelhadas/rotacionadas sempre que ela não tem orientação (ex: quadrado,
    // círculo, prisma) — economiza trabalho na geração normal (que nunca muta
    // uma célula depois de desenhada), mas quebra a edição manual: recolorir
    // ou girar um bloco mutava o objeto e todo mundo que compartilhava aquela
    // referência mudava junto. Clonar tudo ao congelar garante que cada
    // posição da grade editável seja um objeto independente.
    function cloneGridCell(cell) {
      if (cell.shape === 'subdivided') {
        const subCells = {};
        for (const corner of Object.keys(cell.subCells)) subCells[corner] = cloneGridCell(cell.subCells[corner]);
        return { ...cell, subCells };
      }
      return { ...cell };
    }

    function cloneGrid(grid) {
      return grid.map((row) => row.map((cell) => cloneGridCell(cell)));
    }

    function freezeGridOverride() {
      state.gridOverride = cloneGrid(buildIconGrid(iconParams(state.seed, ICON_SIZE)).grid);
      state.gridOverrideSignature = generationSignature();
    }

    function clearGridOverride() {
      state.gridOverride = null;
      state.gridOverrideSignature = null;
    }

    // congela (ou descongela) a grade atual pra edição manual — chamada toda
    // vez que o resultado muda de direção (novo seed, tema, preset, variação).
    function refreshGridOverrideIfEditing() {
      if (state.gridEditEnabled) freezeGridOverride();
      else clearGridOverride();
    }

    function setGridEditEnabled(value) {
      state.gridEditEnabled = value;
      // desligar só esconde a grade de arrastar — o resultado editado continua
      // sendo o que aparece na tela até uma ação de "nova direção" descartá-lo.
      if (value && !state.gridOverride) freezeGridOverride();
      render();
    }

    function swapGridCells(r1, c1, r2, c2, rotationDelta) {
      if (!state.gridOverride) return;
      const a = state.gridOverride[r1][c1];
      if (r1 === r2 && c1 === c2) {
        if (rotationDelta) a.manualRotation = ((a.manualRotation || 0) + rotationDelta + 360) % 360;
        render();
        return;
      }
      const b = state.gridOverride[r2][c2];
      a.manualRotation = ((a.manualRotation || 0) + rotationDelta + 360) % 360;
      state.gridOverride[r1][c1] = b;
      state.gridOverride[r2][c2] = a;
      render();
    }

    // pré-visualização do bloco sendo arrastado: renderiza só essa célula
    // isolada (com a rotação acumulada do mouse) num SVG minúsculo à parte.
    function ghostCellSvg(cell, rotationDelta, boxSize) {
      const base = iconParams(state.seed, boxSize);
      const rotatedCell = { ...cell, manualRotation: ((cell.manualRotation || 0) + rotationDelta + 360) % 360 };
      // mantém a rotação global do ícone (state.rotation) igual ao resto da
      // grade — sem isso o bloco fantasma aparecia "virado" em relação a como
      // a mesma peça é exibida no ícone (que já está rotacionado como um todo).
      return renderGridToSvg({
        ...base,
        size: 1,
        grid: [[rotatedCell]],
        background: 'transparent',
        appearance: { ...base.appearance, transparentBackground: true },
      });
    }

    function recolorGridCell(r, c, color) {
      if (!state.gridOverride) return;
      const cell = state.gridOverride[r][c];
      if (cell.shape === 'subdivided') {
        Object.values(cell.subCells).forEach((sub) => {
          if (sub.shape !== 'blank') sub.color = color;
        });
      } else if (cell.shape !== 'blank') {
        cell.color = color;
      }
      render();
    }

    // troca a forma do bloco (vira sempre um bloco simples, não subdividido)
    // mantendo a cor que ele já tinha.
    function reshapeGridCell(r, c, shapeKey, shapeDef) {
      if (!state.gridOverride) return;
      const cell = state.gridOverride[r][c];
      const previousColor =
        cell.shape === 'subdivided'
          ? Object.values(cell.subCells).find((s) => s.shape !== 'blank')?.color
          : cell.color;
      state.gridOverride[r][c] = {
        shape: shapeKey,
        color: previousColor ?? state.colors[0]?.color ?? '#000000',
        orientation: shapeDef.oriented ? 'tl' : undefined,
      };
      render();
    }

    function shapePreviewMarkup(def, size) {
      const inner = def.maskDataUrl
        ? `<defs><mask id="${def.maskId}-menu" maskContentUnits="objectBoundingBox"><image href="${def.maskDataUrl}" x="0" y="0" width="1" height="1" preserveAspectRatio="none" /></mask></defs>` +
          `<rect x="0" y="0" width="${size}" height="${size}" fill="currentColor" mask="url(#${def.maskId}-menu)" />`
        : def.draw(size, 'currentColor', 'tl');
      return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${inner}</svg>`;
    }

    let colorMenuEl = null;
    cleanupColorMenu = () => closeColorMenu();

    function handleColorMenuOutsideClick(e) {
      if (colorMenuEl && !colorMenuEl.contains(e.target)) closeColorMenu();
    }

    // Esc fecha o menu de cor/forma (aberto com botão direito ou toque
    // longo num bloco) — antes só fechava clicando fora.
    function handleColorMenuKeydown(e) {
      if (e.key === 'Escape') closeColorMenu();
    }

    function closeColorMenu() {
      if (!colorMenuEl) return;
      colorMenuEl.remove();
      colorMenuEl = null;
      document.removeEventListener('pointerdown', handleColorMenuOutsideClick, true);
      document.removeEventListener('keydown', handleColorMenuKeydown, true);
    }

    // botão direito num bloco (com o controle de blocos ligado) abre um
    // mini-menu com as cores da paleta atual (recolorir) e todas as formas
    // disponíveis (trocar a forma daquele bloco só).
    function openColorMenu(x, y, r, c) {
      closeColorMenu();
      const menu = document.createElement('div');
      menu.className = 'gi-color-menu';

      const colorRow = document.createElement('div');
      colorRow.className = 'gi-color-menu-row';
      state.colors.forEach((entry) => {
        const swatch = document.createElement('button');
        swatch.type = 'button';
        swatch.className = 'gi-color-menu-swatch';
        swatch.style.background = entry.color;
        swatch.title = entry.color;
        swatch.addEventListener('click', () => {
          recolorGridCell(r, c, entry.color);
          closeColorMenu();
        });
        colorRow.appendChild(swatch);
      });
      menu.appendChild(colorRow);

      const divider = document.createElement('div');
      divider.className = 'gi-color-menu-divider';
      menu.appendChild(divider);

      const shapeRow = document.createElement('div');
      shapeRow.className = 'gi-color-menu-row';
      const allShapeDefs = { ...SHAPES, ...buildCustomShapeDefs() };
      Object.entries(allShapeDefs).forEach(([key, def]) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'gi-color-menu-shape';
        btn.title = key.startsWith('custom:') ? t('customShapeLabel') : t(`shape_${key}`);
        btn.innerHTML = shapePreviewMarkup(def, 20);
        btn.addEventListener('click', () => {
          reshapeGridCell(r, c, key, def);
          closeColorMenu();
        });
        shapeRow.appendChild(btn);
      });
      menu.appendChild(shapeRow);

      menu.style.left = `${x}px`;
      menu.style.top = `${y}px`;
      document.body.appendChild(menu);
      colorMenuEl = menu;

      // em telas estreitas o menu (aberto na posição do toque/clique) pode
      // estourar a borda da viewport — reposiciona pra dentro sem mudar o
      // transform que centraliza ele no ponto de abertura.
      const margin = 8;
      const rect = menu.getBoundingClientRect();
      let dx = 0;
      let dy = 0;
      if (rect.left < margin) dx = margin - rect.left;
      else if (rect.right > window.innerWidth - margin) dx = window.innerWidth - margin - rect.right;
      if (rect.top < margin) dy = margin - rect.top;
      else if (rect.bottom > window.innerHeight - margin) dy = window.innerHeight - margin - rect.bottom;
      if (dx || dy) {
        menu.style.left = `${x + dx}px`;
        menu.style.top = `${y + dy}px`;
      }

      // adia um tick pra não fechar o menu com o mesmo clique que abriu ele
      setTimeout(() => document.addEventListener('pointerdown', handleColorMenuOutsideClick, true), 0);
      document.addEventListener('keydown', handleColorMenuKeydown, true);
    }

    let gridEditorOverlayEl = null;

    function buildGridEditorOverlay() {
      const overlay = document.createElement('div');
      overlay.className = 'gi-grid-editor';
      const size = state.resolution;
      overlay.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
      overlay.style.gridTemplateRows = `repeat(${size}, 1fr)`;
      // acompanha a rotação global do ícone (0/90/180/270°) pra que cada
      // divisão clicável continue exatamente sobre o bloco que ela representa.
      if (state.rotation) overlay.style.transform = `rotate(${state.rotation}deg)`;

      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          const cellEl = document.createElement('div');
          cellEl.className = 'gi-grid-editor-cell';
          cellEl.addEventListener('pointerdown', (e) => startBlockDrag(e, r, c));
          cellEl.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            openColorMenu(e.clientX, e.clientY, r, c);
          });
          overlay.appendChild(cellEl);
        }
      }

      function startBlockDrag(e, r, c) {
        e.preventDefault();
        if (!state.gridOverride) return;
        const sourceCell = state.gridOverride[r][c];
        const boxSize = overlay.clientWidth / size;
        let rotationDelta = 0;
        let ghost = null;
        let dragStarted = false;
        let longPressTimer = null;
        const startX = e.clientX;
        const startY = e.clientY;
        // no touch não existe botão direito pra abrir o menu de cor/forma —
        // um toque longo parado (sem arrastar) abre o mesmo menu do
        // contextmenu. No mouse o arraste começa no primeiro movimento, sem
        // essa espera (DRAG_THRESHOLD abaixo cobre os dois casos).
        const isTouch = e.pointerType === 'touch';
        const DRAG_THRESHOLD = 6;
        const LONG_PRESS_MS = 450;

        function beginDrag() {
          if (dragStarted) return;
          dragStarted = true;
          clearLongPress();
          ghost = document.createElement('div');
          ghost.className = 'gi-grid-drag-ghost';
          ghost.style.width = `${boxSize}px`;
          ghost.style.height = `${boxSize}px`;
          ghost.innerHTML = ghostCellSvg(sourceCell, rotationDelta, boxSize);
          document.body.appendChild(ghost);
          moveGhost(startX, startY);
        }

        function moveGhost(x, y) {
          if (!ghost) return;
          ghost.style.left = `${x}px`;
          ghost.style.top = `${y}px`;
        }
        function clearLongPress() {
          if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
          }
        }
        function onMove(ev) {
          if (!dragStarted) {
            const dx = ev.clientX - startX;
            const dy = ev.clientY - startY;
            if (Math.hypot(dx, dy) <= DRAG_THRESHOLD) return;
            beginDrag();
          }
          moveGhost(ev.clientX, ev.clientY);
        }
        function onWheel(ev) {
          if (!dragStarted) return;
          ev.preventDefault();
          // giros inteiros de 90° só — em ângulos quebrados a forma (quadrada)
          // estoura a caixa da célula e o SVG corta as pontas na borda do viewBox.
          rotationDelta += ev.deltaY > 0 ? 90 : -90;
          ghost.innerHTML = ghostCellSvg(sourceCell, rotationDelta, boxSize);
        }
        function cleanup() {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          window.removeEventListener('pointercancel', onUp);
          window.removeEventListener('wheel', onWheel);
          clearLongPress();
          if (ghost) ghost.remove();
        }
        function onUp(ev) {
          cleanup();
          if (!dragStarted) return;
          const target = document.elementFromPoint(ev.clientX, ev.clientY);
          const targetCellEl = target && target.closest('.gi-grid-editor-cell');
          if (targetCellEl) {
            const cells = Array.from(overlay.children);
            const targetIndex = cells.indexOf(targetCellEl);
            const tr = Math.floor(targetIndex / size);
            const tc = targetIndex % size;
            swapGridCells(r, c, tr, tc, rotationDelta);
          }
        }
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
        window.addEventListener('wheel', onWheel, { passive: false });

        if (isTouch) {
          longPressTimer = setTimeout(() => {
            if (dragStarted) return;
            cleanup();
            openColorMenu(startX, startY, r, c);
          }, LONG_PRESS_MS);
        }
      }

      return overlay;
    }

    function syncGridEditorOverlay() {
      closeColorMenu();
      if (gridEditorOverlayEl) {
        gridEditorOverlayEl.remove();
        gridEditorOverlayEl = null;
      }
      // o controle de blocos edita células da grade QUADRADA (state.
      // gridOverride, sempre resolution×resolution) — num formato não-
      // quadrado o preview mostra uma composição GERADA fresca, do
      // tamanho certo (ver generateFramedIcon em generator.js), não mais
      // aquela grade repetida; não tem mais um "bloco" 1-pra-1 pra editar
      // ali. Só mostra o overlay no formato quadrado.
      if (!state.gridEditEnabled || exportFrame !== 'square') return;
      gridEditorOverlayEl = buildGridEditorOverlay();
      previewWrap.appendChild(gridEditorOverlayEl);
      updateGridEditorOverlayGeometry();
    }

    // o controle de blocos só existe no formato quadrado (ver
    // syncGridEditorOverlay — formatos não-quadrados mostram uma
    // composição GERADA fresca, sem um "bloco" 1-pra-1 editável), então
    // aqui o overlay sempre cobre o preview inteiro. boxW/boxH (opcionais)
    // são o tamanho ALVO que updatePreviewFrame acabou de calcular — .gi-
    // preview-wrap tem transition de width/height (0.35s), então ler
    // getBoundingClientRect() logo depois de mudar o estilo pega o
    // tamanho NO MEIO da animação, não o final; sem os parâmetros, a
    // geometria do overlay ficava um passo atrasada. Só cai no
    // getBoundingClientRect() (settled) quando chamada fora de
    // updatePreviewFrame — ver syncGridEditorOverlay, ao ligar o controle.
    function updateGridEditorOverlayGeometry(boxW, boxH) {
      if (!gridEditorOverlayEl) return;
      const wrapRect =
        boxW != null && boxH != null ? { width: boxW, height: boxH } : previewWrap.getBoundingClientRect();
      gridEditorOverlayEl.style.top = '0px';
      gridEditorOverlayEl.style.left = '0px';
      gridEditorOverlayEl.style.width = `${wrapRect.width}px`;
      gridEditorOverlayEl.style.height = `${wrapRect.height}px`;
    }

    function render() {
      // qualquer ajuste (resolução, densidade, formas, cores...) feito depois
      // de congelar a grade invalida a edição manual — sem isso os sliders
      // pareciam "parar de funcionar" porque o render ignorava tudo e sempre
      // reexibia a grade congelada.
      if (state.gridOverride && generationSignature() !== state.gridOverrideSignature) {
        // se o controle de blocos ainda está ligado, recongela com os novos
        // ajustes na hora — sem isso, a grade ficava nula e arrastar parecia
        // "travado" até a pessoa desligar e ligar o controle de novo.
        if (state.gridEditEnabled) freezeGridOverride();
        else clearGridOverride();
      }
      if (state.gridOverride) {
        currentIconSvg = renderGridToSvg({ ...iconParams(state.seed, ICON_SIZE), grid: state.gridOverride });
      } else {
        currentIconSvg = iconSvg(state.seed);
      }
      preview.innerHTML = currentIconSvg;
      syncGridEditorOverlay();
      updatePreviewFrame();
    }

    // tamanho (em px) que o preview pode ocupar sem estourar a tela — nunca
    // só um teto de largura (540px): numa proporção alta/estreita (Story
    // 9:16, por ex.) um preview de 540px de largura ia querer 960px de
    // altura, o que sobrava pra fora da viewport e escondia Variações/
    // Histórico embaixo. Mede a posição real do preview na tela (depois do
    // layout) e limita pela altura que ainda cabe até o fim da viewport,
    // encolhendo a largura junto (mantendo a proporção) quando precisa.
    function computePreviewBoxSize(ratio) {
      // .gi-stage agora tem moldura própria (padding:24px dos 4 lados,
      // igual ao Mosaico) — clientWidth INCLUI esse padding, então o
      // espaço de verdade disponível pros filhos é clientWidth menos ele
      // (senão o preview calculado ficava largo demais e vazava pra fora
      // da moldura).
      const stageStyle = getComputedStyle(stage);
      const stagePadX = parseFloat(stageStyle.paddingLeft) + parseFloat(stageStyle.paddingRight);
      const stagePadBottom = parseFloat(stageStyle.paddingBottom) || 0;
      // a trilha de ícones (Novo azulejo/Criar variações/Estou com sorte)
      // não disputa mais LARGURA com o preview em tamanho nenhum de tela —
      // no mobile ela ficava ao lado (tomando espaço da própria arte),
      // agora fica embaixo (ver appendChild em index.js); no desktop os
      // mesmos 3 botões (pílula com texto) viraram uma linha própria ACIMA.
      // SEM teto fixo de 540px — numa janela larga a moldura (.gi-stage)
      // fica bem maior que isso, e o preview precisa crescer proporcional
      // até o limite real (largura do stage, ou altura da tela via maxH
      // logo abaixo), não sobrar pequeno com um vão vazio gigante em volta.
      const maxW = Math.max(160, (stage.clientWidth || 540) - stagePadX);

      const top = previewWrap.getBoundingClientRect().top || 0;
      // abaixo do preview fica a pílula de ação — no desktop a pílula com
      // texto (.gi-stage-toolbar), no mobile a trilha de ícones
      // (toolbarRail) — margem generosa (não só a altura atual): o
      // conteúdo pode crescer depois desse cálculo (troca de idioma,
      // fonte terminando de carregar), e sem folga sobrava só o
      // suficiente pro tamanho de ANTES, cortando o que vem embaixo do
      // preview quando aquilo cresce.
      const belowReserved =
        (isMobileViewport ? toolbarRail.offsetHeight + 20 : stageToolbar.offsetHeight + 80) + stagePadBottom;
      // no mobile (.gi-layout em coluna) o preview e a sidebar de ajustes
      // disputam a MESMA altura de tela — sem reservar um mínimo pra
      // sidebar aqui, um preview quadrado grande podia tomar quase a tela
      // inteira num celular com pouca altura (ou navegador "baixo"), e o
      // painel de ajustes (com o menu de categorias, ver .gi-mobile-
      // category-tabs) sobrava espremido a uns 40-50px de altura — sticky
      // não ajuda se o CONTAINER dele já não tem altura nenhuma: o menu
      // ficava parcialmente (ou totalmente) fora da tela, sem como rolar
      // até ele (body é overflow:hidden). No desktop a sidebar é uma
      // coluna ao LADO do stage inteiro (não compete por altura).
      // O painel de ajustes virou um "bottom sheet" (position:fixed, ver
      // .gi-controls no mobile) que flutua POR CIMA do preview quando
      // aberto, em vez de empurrá-lo — só reserva a altura da barra de
      // categorias sempre visível (fechada), não o painel inteiro; isso
      // já é reservado sozinho por causa do overlay, não precisa de mais
      // altura reservada aqui.
      const controlsMinHeight = isMobileViewport ? (mobileCategoryTabsEl?.offsetHeight ?? 90) + 12 : 0;
      const maxH = Math.max(160, window.innerHeight - top - belowReserved - controlsMinHeight);
      let w = maxW;
      let h = w / ratio;
      if (h > maxH) {
        h = maxH;
        w = h * ratio;
      }
      return { w: Math.round(w), h: Math.round(h) };
    }

    // reflete o "Formato de exportação" no preview de verdade, ao vivo — o
    // espaço extra NUNCA fica vazio, mas também não é preenchido repetindo
    // (ladrilhando) o ícone quadrado: isso deixava uma "costura" visível a
    // cada repetição e cortava forma ao meio sempre que a proporção não
    // batia com um múltiplo exato do ícone (o pedido explícito era "os
    // shapes sempre têm que estar INTEIROS"). Em vez disso, formatos não-
    // quadrados geram uma composição PRÓPRIA, do tamanho certo, esticando
    // a MESMA grade em mais colunas (paisagem) ou mais linhas (retrato) —
    // ver generateFramedIcon em generator.js. A transição suave de
    // tamanho é só CSS (ver .gi-preview-wrap em style.css).
    function updatePreviewFrame() {
      const nominalRatio = EXPORT_FRAME_RATIOS[exportFrame] ?? 1;
      // a proporção pedida (nominalRatio, ex.: 4:5 exato) quase nunca cai
      // num número inteiro de colunas/linhas — a composição de verdade
      // (ver generateFramedIcon) usa a proporção REAL que sobra depois de
      // arredondar pra célula inteira (ex.: 0.75, não 0.8). Dimensionar a
      // caixa do preview pela nominal cortava um lado (ou sobrava vazio
      // do outro) porque a caixa e o conteúdo tinham proporções
      // ligeiramente diferentes — aqui sempre usa a REAL, então a caixa
      // bate exatamente com o que a composição realmente é.
      const ratio = nominalRatio === 1 ? 1 : (() => {
        const { cols, rows } = framedGridDims(state.resolution, nominalRatio);
        return cols / rows;
      })();
      const { w, h } = computePreviewBoxSize(ratio);
      previewWrap.style.width = `${w}px`;
      previewWrap.style.height = `${h}px`;
      // a pílula de botões embaixo do preview (Novo azulejo/Criar
      // variações/Estou com sorte) tinha um max-width fixo (540px),
      // independente do preview de verdade — quando o preview encolhia
      // (janela baixa, formato retrato/story, etc.) a pílula continuava do
      // tamanho de sempre e ficava enorme/desproporcional do lado de um
      // preview pequeno. Essa variável deixa a largura MÁXIMA da pílula
      // sempre acompanhando a largura atual do preview (ver
      // .gi-stage-toolbar em style.css).
      stage.style.setProperty('--gi-preview-w', `${w}px`);
      previewWrap.style.background = state.transparentBg ? '' : state.background || '';
      preview.style.width = '100%';
      preview.style.height = '100%';
      currentFramedIconSvg =
        ratio === 1 ? currentIconSvg : generateFramedIcon(iconParams(state.seed, ICON_SIZE), ratio);
      preview.innerHTML = currentFramedIconSvg;
      // o controle de blocos só existe no formato quadrado (ver
      // syncGridEditorOverlay) — se essa condição mudou desde a última vez
      // (trocou de/para quadrado), precisa criar ou remover o overlay de
      // verdade; senão (só o tamanho mudou, ex. redimensionar a janela)
      // basta reposicionar o que já existe, sem recriar.
      const shouldShowOverlay = state.gridEditEnabled && exportFrame === 'square';
      if (shouldShowOverlay !== !!gridEditorOverlayEl) {
        syncGridEditorOverlay();
      } else {
        updateGridEditorOverlayGeometry(w, h);
      }
    }

    // opções do seletor de formato — usadas pela seção "Formato" (sempre a
    // primeira da sidebar, ver mais abaixo, perto de onde ela é montada).
    function frameTileOptions() {
      return [
        { value: 'square', ratio: EXPORT_FRAME_RATIOS.square, label: t('exportFrame_square'), caption: '1:1' },
        { value: 'portrait', ratio: EXPORT_FRAME_RATIOS.portrait, label: t('exportFrame_portrait'), caption: '4:5' },
        { value: 'story', ratio: EXPORT_FRAME_RATIOS.story, label: t('exportFrame_story'), caption: '9:16' },
        { value: 'landscape', ratio: EXPORT_FRAME_RATIOS.landscape, label: t('exportFrame_landscape'), caption: '16:9' },
      ];
    }

    function onFrameChange(value) {
      exportFrame = value;
      updatePreviewFrame();
    }

    function renderVariations() {
      variationsRow.innerHTML = '';
      for (let i = 0; i < VARIATION_COUNT; i++) {
        const variationSeed = randomSeed();
        const thumb = document.createElement('button');
        thumb.type = 'button';
        thumb.className = 'gi-variation-thumb';
        thumb.innerHTML = iconSvg(variationSeed, VARIATION_SIZE);
        thumb.addEventListener('click', () => {
          pushToHistory();
          state.seed = variationSeed;
          refreshGridOverrideIfEditing();
          render();
        });
        variationsRow.appendChild(thumb);
      }
    }

    function renderHistory() {
      historyRow.innerHTML = '';
      history.forEach((entry) => {
        const thumb = document.createElement('button');
        thumb.type = 'button';
        thumb.className = 'gi-history-thumb';
        thumb.innerHTML = entry.svg;
        thumb.addEventListener('click', () => restoreHistoryEntry(entry));
        historyRow.appendChild(thumb);
      });
    }

    // campos que dá pra guardar em JSON (localStorage) — exclui imagem de
    // referência (Blob/Image não serializam) e é reaproveitado pelo histórico
    // (que ainda guarda a imagem, em memória) e pelos presets salvos.
    function buildBaseSnapshot() {
      return {
        themeKey: state.themeKey,
        seed: state.seed,
        resolution: state.resolution,
        fillDensity: state.fillDensity,
        subdivisionChance: state.subdivisionChance,
        detailGradient: state.detailGradient,
        fillEnabled: state.fillEnabled,
        strokeEnabled: state.strokeEnabled,
        strokeColor: state.strokeColor,
        strokeWidth: state.strokeWidth,
        strokeOutlineWidth: state.strokeOutlineWidth,
        gradientFillEnabled: state.gradientFillEnabled,
        gradientFillAngle: state.gradientFillAngle,
        gradientStops: state.gradientStops.map((s) => ({ ...s })),
        grainEnabled: state.grainEnabled,
        grainIntensity: state.grainIntensity,
        grainSize: state.grainSize,
        grainColor: state.grainColor,
        rotation: state.rotation,
        symmetry: state.symmetry,
        background: state.background,
        colors: state.colors.map((c) => ({ ...c })),
        shapesAllowed: [...state.shapesAllowed],
        customShapes: state.customShapes.map((s) => ({ ...s })),
        customShapeCounter: state.customShapeCounter,
        densityGradient: state.densityGradient,
        gradientDirection: state.gradientDirection,
        gradientStrength: state.gradientStrength,
        transparentBg: state.transparentBg,
        blackIcon: state.blackIcon,
        invertColors: state.invertColors,
      };
    }

    // "código" compartilhável = o mesmo snapshot dos presets, só que
    // codificado como texto (base64 de um JSON) em vez de salvo no
    // localStorage — dá pra copiar/colar/mandar por mensagem sem precisar
    // de link nem servidor (o app inteiro já roda só no navegador).
    function encodeShareCode(snapshot) {
      try {
        return btoa(encodeURIComponent(JSON.stringify(snapshot)));
      } catch (err) {
        return null;
      }
    }

    function decodeShareCode(code) {
      try {
        const snapshot = JSON.parse(decodeURIComponent(atob(code.trim())));
        // checagem mínima — um texto qualquer colado ali não deveria
        // conseguir passar por "snapshot válido" e quebrar o resto do app.
        if (!snapshot || typeof snapshot !== 'object' || !Array.isArray(snapshot.colors)) return null;
        return snapshot;
      } catch (err) {
        return null;
      }
    }

    function revokeUrlUnlessInHistory(url) {
      if (!url) return;
      const stillReferenced = history.some(
        (entry) => entry.snapshot.structureImageUrl === url || entry.snapshot.colorImageUrl === url,
      );
      if (!stillReferenced) URL.revokeObjectURL(url);
    }

    function pushToHistory() {
      const snapshot = {
        ...buildBaseSnapshot(),
        structureImageUrl: state.structureImageUrl,
        structureImageEl: state.structureImageEl,
        structureImageBlob: state.structureImageBlob,
        useImageGuide: state.useImageGuide,
        colorImageUrl: state.colorImageUrl,
        colorImageEl: state.colorImageEl,
        useSameImageForColor: state.useSameImageForColor,
      };
      history.unshift({ svg: iconSvg(state.seed, HISTORY_THUMB_SIZE), snapshot });
      if (history.length > HISTORY_LIMIT) history.length = HISTORY_LIMIT;
      renderHistory();
    }

    function restoreHistoryEntry(entry) {
      Object.assign(state, entry.snapshot);
      state.colors = entry.snapshot.colors.map((c) => ({ ...c }));
      state.shapesAllowed = [...entry.snapshot.shapesAllowed];
      state.customShapes = entry.snapshot.customShapes.map((s) => ({ ...s }));
      normalizeFillStrokeFields(entry.snapshot);
      refreshGridOverrideIfEditing();
      buildSidebar();
      render();
    }


    function rasterizeCustomShape(blob, size = 128) {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      return new Promise((resolve, reject) => {
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext('2d');
          const scale = Math.min(size / img.naturalWidth, size / img.naturalHeight);
          const w = img.naturalWidth * scale;
          const h = img.naturalHeight * scale;
          ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);

          // extrai uma máscara de silhueta: pixel opaco+escuro = parte do ícone,
          // pixel transparente ou claro = fundo. Assim o ícone pode ser
          // repintado com qualquer cor da paleta, igual as formas nativas.
          const { data } = ctx.getImageData(0, 0, size, size);
          const maskCanvas = document.createElement('canvas');
          maskCanvas.width = size;
          maskCanvas.height = size;
          const maskCtx = maskCanvas.getContext('2d');
          const maskImageData = maskCtx.createImageData(size, size);
          for (let i = 0; i < data.length; i += 4) {
            const luminance = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
            const alpha = data[i + 3] / 255;
            const maskAlpha = alpha * (1 - luminance);
            maskImageData.data[i] = 255;
            maskImageData.data[i + 1] = 255;
            maskImageData.data[i + 2] = 255;
            maskImageData.data[i + 3] = Math.round(maskAlpha * 255);
          }
          maskCtx.putImageData(maskImageData, 0, 0);

          URL.revokeObjectURL(url);
          resolve(maskCanvas.toDataURL('image/png'));
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error('Falha ao carregar imagem'));
        };
        img.src = url;
      });
    }

    async function handleCustomShapeUpload(file) {
      const isSvg = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name || '');

      let vectorShape = null;
      if (isSvg) {
        try {
          const text = await file.text();
          vectorShape = sanitizeSvgForRecolor(text);
        } catch (err) {
          vectorShape = null;
        }
      }

      let entry;
      if (vectorShape) {
        entry = { kind: 'vector', viewBox: vectorShape.viewBox, innerMarkup: vectorShape.innerMarkup };
      } else {
        let maskDataUrl;
        try {
          maskDataUrl = await rasterizeCustomShape(file);
        } catch (err) {
          return;
        }
        entry = { kind: 'mask', maskDataUrl };
      }

      pushToHistory();
      const key = `custom:${state.customShapeCounter++}`;
      state.customShapes = [...state.customShapes, { key, ...entry }];
      state.shapesAllowed = [...state.shapesAllowed, key];
      buildSidebar();
      render();
    }

    function removeCustomShape(key) {
      pushToHistory();
      state.customShapes = state.customShapes.filter((s) => s.key !== key);
      state.shapesAllowed = state.shapesAllowed.filter((k) => k !== key);
      buildSidebar();
      render();
    }

    async function applyPaletteFrom(blob) {
      let palette;
      try {
        palette = await extractPaletteFromBlob(blob);
      } catch (err) {
        return false;
      }
      if (!palette.length) return false;
      state.themeKey = 'custom';
      state.background = palette[0].color;
      state.colors = palette.length > 1 ? palette.slice(1) : palette;
      // mesma razão do applyTheme/applyPaletteOnly: a paleta extraída da
      // imagem deve aparecer de verdade, não invertida/silhueta por causa de
      // um toggle que ficou ligado de antes.
      state.invertColors = false;
      state.blackIcon = false;
      return true;
    }

    async function handleStructureImage(blob, { extractPalette = true, guideStructure = false } = {}) {
      let asset;
      try {
        asset = await loadImageAsset(blob);
      } catch (err) {
        return;
      }

      pushToHistory();
      revokeUrlUnlessInHistory(state.structureImageUrl);
      state.structureImageBlob = blob;
      state.structureImageUrl = asset.url;
      state.structureImageEl = asset.img;
      if (extractPalette && state.useSameImageForColor) {
        await applyPaletteFrom(blob);
      }
      if (guideStructure) {
        state.symmetryBeforeImageGuide = state.symmetry;
        state.symmetry = 'none';
        if (state.fillDensity > 0.7) state.fillDensity = 0.5;
        state.useImageGuide = true;
      }
      buildSidebar();
      render();
    }

    async function handleColorImage(blob) {
      let asset;
      try {
        asset = await loadImageAsset(blob);
      } catch (err) {
        return;
      }

      pushToHistory();
      revokeUrlUnlessInHistory(state.colorImageUrl);
      state.colorImageUrl = asset.url;
      state.colorImageEl = asset.img;
      state.useSameImageForColor = false;
      await applyPaletteFrom(blob);
      buildSidebar();
      render();
    }

    function removeStructureImage() {
      pushToHistory();
      revokeUrlUnlessInHistory(state.structureImageUrl);
      state.structureImageUrl = null;
      state.structureImageEl = null;
      state.structureImageBlob = null;
      state.useImageGuide = false;
      state.symmetry = state.symmetryBeforeImageGuide || 'rotational';
      buildSidebar();
      render();
    }

    function removeColorImage() {
      pushToHistory();
      revokeUrlUnlessInHistory(state.colorImageUrl);
      state.colorImageUrl = null;
      state.colorImageEl = null;
      state.useSameImageForColor = true;
      buildSidebar();
      render();
    }

    function setUseSameImageForColor(value) {
      pushToHistory();
      state.useSameImageForColor = value;
      if (value && state.structureImageBlob) {
        applyPaletteFrom(state.structureImageBlob).then(() => {
          buildSidebar();
          render();
        });
      } else {
        buildSidebar();
        render();
      }
    }

    function setUseImageGuide(value) {
      pushToHistory();
      if (value) {
        state.symmetryBeforeImageGuide = state.symmetry;
        state.symmetry = 'none';
        // em densidade alta o recorte por percentil preenche quase tudo e a
        // imagem de origem some — um valor mais baixo deixa a silhueta legível.
        if (state.fillDensity > 0.7) state.fillDensity = 0.5;
      } else {
        state.symmetry = state.symmetryBeforeImageGuide || 'rotational';
      }
      state.useImageGuide = value;
      buildSidebar();
      render();
    }

    function hexLerp(hexA, hexB, t) {
      const a = parseInt(hexA.slice(1), 16);
      const b = parseInt(hexB.slice(1), 16);
      const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
      const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
      const mix = (x, y) => Math.round(x + (y - x) * t);
      const toHex = (n) => n.toString(16).padStart(2, '0');
      return `#${toHex(mix(ar, br))}${toHex(mix(ag, bg))}${toHex(mix(ab, bb))}`;
    }

    // editor de degradê tipo Photoshop: uma barra com os stops (posição 0-1 +
    // cor) marcados por handles arrastáveis. Clicar na barra (fora de um
    // handle) adiciona um stop novo na posição clicada, com cor interpolada
    // entre os dois vizinhos mais próximos — clicar num handle já existente
    // seleciona ele (mostra o seletor de cor livre + botão de remover).
    function buildGradientStopsEditor() {
      const wrap = document.createElement('div');
      wrap.className = 'control control-gradient-stops';
      const label = document.createElement('span');
      label.className = 'control-label';
      label.textContent = t('gradientStopsLabel');
      wrap.appendChild(label);

      const stops = state.gradientStops;
      if (selectedGradientStopIndex >= stops.length) selectedGradientStopIndex = stops.length - 1;

      const bar = document.createElement('div');
      bar.className = 'gradient-stops-bar';
      const sorted = [...stops].sort((a, b) => a.position - b.position);
      bar.style.background = `linear-gradient(90deg, ${sorted
        .map((s) => `${s.color} ${Math.round(s.position * 100)}%`)
        .join(', ')})`;

      function colorForNewStopAt(position) {
        const sortedStops = [...stops].sort((a, b) => a.position - b.position);
        const after = sortedStops.find((s) => s.position >= position);
        const before = [...sortedStops].reverse().find((s) => s.position <= position);
        if (before && after && before !== after) {
          const span = after.position - before.position;
          const t = span > 0 ? (position - before.position) / span : 0;
          return hexLerp(before.color, after.color, t);
        }
        return (before ?? after ?? sortedStops[0]).color;
      }

      bar.addEventListener('click', (e) => {
        if (e.target !== bar) return; // clique num handle não deve criar stop novo
        const rect = bar.getBoundingClientRect();
        const position = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const color = colorForNewStopAt(position);
        stops.push({ position, color });
        selectedGradientStopIndex = stops.length - 1;
        buildSidebar();
        render();
      });

      stops.forEach((stop, index) => {
        const handle = document.createElement('button');
        handle.type = 'button';
        handle.className = 'gradient-stop-handle';
        handle.classList.toggle('selected', index === selectedGradientStopIndex);
        handle.style.left = `${stop.position * 100}%`;
        handle.style.background = stop.color;
        handle.title = stop.color;

        handle.addEventListener('mousedown', (e) => {
          e.preventDefault();
          selectedGradientStopIndex = index;
          const rect = bar.getBoundingClientRect();
          function onMove(moveEvent) {
            const position = Math.max(0, Math.min(1, (moveEvent.clientX - rect.left) / rect.width));
            stop.position = position;
            handle.style.left = `${position * 100}%`;
            bar.style.background = `linear-gradient(90deg, ${[...stops]
              .sort((a, b) => a.position - b.position)
              .map((s) => `${s.color} ${Math.round(s.position * 100)}%`)
              .join(', ')})`;
          }
          function onUp() {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            render();
          }
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        });
        handle.addEventListener('click', (e) => {
          e.stopPropagation();
          selectedGradientStopIndex = index;
          buildSidebar();
        });
        bar.appendChild(handle);
      });
      wrap.appendChild(bar);

      const editorRow = document.createElement('div');
      editorRow.className = 'gradient-stop-editor';
      const selectedStop = stops[selectedGradientStopIndex];
      if (selectedStop) {
        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.className = 'stroke-color-input';
        colorInput.value = selectedStop.color;
        colorInput.addEventListener('input', () => {
          selectedStop.color = colorInput.value;
          render();
        });
        editorRow.appendChild(colorInput);

        const removeButton = document.createElement('button');
        removeButton.type = 'button';
        removeButton.className = 'gradient-stop-remove';
        removeButton.textContent = t('gradientStopRemove');
        removeButton.disabled = stops.length <= 2;
        removeButton.addEventListener('click', () => {
          if (stops.length <= 2) return;
          stops.splice(selectedGradientStopIndex, 1);
          selectedGradientStopIndex = Math.max(0, selectedGradientStopIndex - 1);
          buildSidebar();
          render();
        });
        editorRow.appendChild(removeButton);
      }
      wrap.appendChild(editorRow);

      return wrap;
    }

    function buildSidebar() {
      sidebar.innerHTML = '';

      // --- Tema ---
      function themePreviewColorsFor(key) {
        if (key === 'custom') return [state.background, ...state.colors.map((c) => c.color)];
        const preset = PRESETS[key];
        return preset ? [preset.background, ...preset.colors.map((c) => c.color)] : [];
      }

      function buildPreviewDots(colors, max = 4) {
        const wrap = document.createElement('span');
        wrap.className = 'theme-combo-preview';
        colors.slice(0, max).forEach((color) => {
          const dot = document.createElement('span');
          dot.className = 'theme-combo-dot';
          dot.style.background = color;
          wrap.appendChild(dot);
        });
        return wrap;
      }

      function themeDisplayLabel(key) {
        return key === 'custom' ? t('customThemeLabel') : t(`theme_${key}`);
      }

      function cycleTheme(direction) {
        const baseIndex = themeKeys.indexOf(state.themeKey);
        const nextIndex = (baseIndex + direction + themeKeys.length) % themeKeys.length;
        pushToHistory();
        applyTheme(themeKeys[nextIndex]);
        buildSidebar();
        render();
      }

      const themePrevButton = document.createElement('button');
      themePrevButton.type = 'button';
      themePrevButton.className = 'theme-arrow-button';
      themePrevButton.textContent = '‹';
      themePrevButton.title = t('previousTheme');
      themePrevButton.addEventListener('click', () => cycleTheme(-1));

      const themeNextButton = document.createElement('button');
      themeNextButton.type = 'button';
      themeNextButton.className = 'theme-arrow-button';
      themeNextButton.textContent = '›';
      themeNextButton.title = t('nextTheme');
      themeNextButton.addEventListener('click', () => cycleTheme(1));

      const themeCombo = document.createElement('div');
      themeCombo.className = 'theme-combo';

      const themeTrigger = document.createElement('button');
      themeTrigger.type = 'button';
      themeTrigger.className = 'theme-combo-trigger';
      themeTrigger.appendChild(buildPreviewDots(themePreviewColorsFor(state.themeKey)));
      const themeTriggerLabel = document.createElement('span');
      themeTriggerLabel.className = 'theme-combo-label';
      themeTriggerLabel.textContent = themeDisplayLabel(state.themeKey);
      themeTrigger.appendChild(themeTriggerLabel);
      const themeTriggerChevron = document.createElement('span');
      themeTriggerChevron.className = 'theme-combo-chevron';
      themeTriggerChevron.textContent = '▾';
      themeTrigger.appendChild(themeTriggerChevron);
      themeTrigger.addEventListener('click', () => {
        themeDropdownOpen = !themeDropdownOpen;
        buildSidebar();
      });
      themeCombo.appendChild(themeTrigger);

      if (themeDropdownOpen) {
        const panelOptions =
          state.themeKey === 'custom' ? [{ value: 'custom' }, ...themeKeys.map((k) => ({ value: k }))] : themeKeys.map((k) => ({ value: k }));

        const panel = document.createElement('div');
        panel.className = 'theme-combo-panel';

        panelOptions.forEach((opt) => {
          const row = document.createElement('button');
          row.type = 'button';
          row.className = 'theme-combo-row';
          row.classList.toggle('active', opt.value === state.themeKey);
          row.appendChild(buildPreviewDots(themePreviewColorsFor(opt.value)));
          const rowLabel = document.createElement('span');
          rowLabel.textContent = themeDisplayLabel(opt.value);
          row.appendChild(rowLabel);
          row.addEventListener('click', () => {
            themeDropdownOpen = false;
            if (opt.value !== 'custom') {
              pushToHistory();
              applyTheme(opt.value);
            }
            buildSidebar();
            render();
          });
          panel.appendChild(row);
        });

        themeCombo.appendChild(panel);
      }

      const themeRow = document.createElement('div');
      themeRow.className = 'theme-row';
      themeRow.appendChild(themePrevButton);
      themeRow.appendChild(themeCombo);
      themeRow.appendChild(themeNextButton);

      sidebar.appendChild(createSection(t('themeSectionTitle'), [themeRow], sectionOptions('theme')));

      // --- Referência de imagem (estrutura) ---
      const structureWrap = document.createElement('div');
      structureWrap.className = 'control control-reference';
      const structureLabel = document.createElement('span');
      structureLabel.className = 'control-label';
      structureLabel.textContent = t('referenceImageLabel');
      structureWrap.appendChild(structureLabel);

      const structureRow = document.createElement('div');
      structureRow.className = 'reference-row';

      if (state.structureImageUrl) {
        const thumb = document.createElement('img');
        thumb.className = 'reference-thumb';
        thumb.src = state.structureImageUrl;
        thumb.alt = t('referenceImageLabel');
        structureRow.appendChild(thumb);
      }

      const structureFileInput = document.createElement('input');
      structureFileInput.type = 'file';
      structureFileInput.accept = 'image/*';
      structureFileInput.style.display = 'none';
      structureFileInput.addEventListener('change', () => {
        const file = structureFileInput.files?.[0];
        if (file) handleStructureImage(file);
        structureFileInput.value = '';
      });

      const structureUploadButton = createButton({
        label: state.structureImageUrl ? t('changeImage') : t('uploadImage'),
        onClick: () => structureFileInput.click(),
      });

      const structureDrawButton = createButton({
        label: t('drawButton'),
        onClick: () =>
          openDrawCanvas({
            onConfirm: (blob) =>
              handleStructureImage(blob, { extractPalette: false, guideStructure: true }),
          }),
      });

      structureRow.appendChild(structureUploadButton.el);
      structureRow.appendChild(structureDrawButton.el);
      structureRow.appendChild(structureFileInput);

      if (state.structureImageUrl) {
        const structureRemoveButton = createButton({
          label: t('removeImageButton'),
          onClick: () => removeStructureImage(),
        });
        structureRow.appendChild(structureRemoveButton.el);
      }

      structureWrap.appendChild(structureRow);

      const structureHint = document.createElement('span');
      structureHint.className = 'control-hint';
      structureHint.textContent = t('pasteHintStructure');
      structureWrap.appendChild(structureHint);

      const structureImageElements = [structureWrap];

      if (state.structureImageEl) {
        const imageGuideToggle = createToggleSwitch({
          label: t('useImageGuide'),
          value: state.useImageGuide,
          onChange: (checked) => setUseImageGuide(checked),
        });
        structureImageElements.push(imageGuideToggle.el);
      }

      sidebar.appendChild(
        createSection(t('referenceImageLabel'), structureImageElements, sectionOptions('reference'))
      );

      // --- Estrutura ---
      const resolutionSlider = createSlider({
        label: t('resolutionLabel'),
        min: 2,
        max: 10,
        step: 1,
        value: state.resolution,
        formatValue: (v) => `${v}×${v}`,
        onChange: (value) => {
          state.resolution = value;
          render();
        },
      });

      const densitySlider = createSlider({
        label: t('densityLabel'),
        min: 10,
        max: 100,
        step: 5,
        value: Math.round(state.fillDensity * 100),
        formatValue: (v) => `${v}%`,
        onChange: (value) => {
          state.fillDensity = value / 100;
          render();
        },
      });

      const detailSlider = createSlider({
        label: t('detailLabel'),
        min: 0,
        max: 100,
        step: 5,
        value: Math.round(state.subdivisionChance * 100),
        formatValue: (v) => `${v}%`,
        onChange: (value) => {
          state.subdivisionChance = value / 100;
          render();
        },
      });

      const rotationSelect = createSelect({
        label: t('rotationLabel'),
        options: [0, 90, 180, 270].map((value) => ({ value: String(value), label: `${value}°` })),
        value: String(state.rotation),
        onChange: (value) => {
          state.rotation = Number(value);
          render();
        },
      });

      const gridElements = [resolutionSlider.el, densitySlider.el, rotationSelect.el];

      if (state.useImageGuide || state.densityGradient !== 'none') {
        const note = document.createElement('p');
        note.className = 'control-hint';
        note.textContent = state.useImageGuide
          ? t('symmetryDisabledNote')
          : t('symmetryDisabledGradientNote');
        gridElements.push(note);
      } else {
        const symmetryOn = state.symmetry !== 'none';
        const symmetryToggle = createToggleSwitch({
          label: t('symmetryLabel'),
          value: symmetryOn,
          onChange: (checked) => {
            if (checked) {
              state.symmetry =
                state.symmetryBeforeImageGuide && state.symmetryBeforeImageGuide !== 'none'
                  ? state.symmetryBeforeImageGuide
                  : 'mirror-full';
              state.symmetryBeforeImageGuide = state.symmetry;
            } else {
              if (state.symmetry !== 'none') state.symmetryBeforeImageGuide = state.symmetry;
              state.symmetry = 'none';
            }
            buildSidebar();
            render();
          },
        });
        gridElements.push(symmetryToggle.el);

        if (symmetryOn) {
          const symmetryTypeSelect = createSelect({
            label: t('symmetryTypeLabel'),
            options: SYMMETRY_VALUES.filter((value) => value !== 'none').map((value) => ({
              value,
              label: t(`symmetry_${value}`),
            })),
            value: state.symmetry,
            onChange: (value) => {
              state.symmetry = value;
              state.symmetryBeforeImageGuide = value;
              render();
            },
          });
          gridElements.push(symmetryTypeSelect.el);
        }
      }

      sidebar.appendChild(
        createSection(
          t('structureSection'),
          gridElements,
          sectionOptions('grid', () => randomizeSection(randomizeGridSettings))
        )
      );

      // --- Detalhe (subdivisão em formas menores) ---
      const detailGradientSelect = createSelect({
        label: t('detailGradientLabel'),
        options: ['uniform', 'edge', 'center'].map((value) => ({
          value,
          label: t(`detailGradient${value.charAt(0).toUpperCase()}${value.slice(1)}`),
        })),
        value: state.detailGradient,
        onChange: (value) => {
          state.detailGradient = value;
          render();
        },
      });

      sidebar.appendChild(
        createSection(
          t('detailSectionTitle'),
          [detailSlider.el, detailGradientSelect.el],
          sectionOptions('detail', () => randomizeSection(randomizeDetailSettings))
        )
      );

      // --- Preenchimento (fill e stroke independentes, tipo Illustrator) ---
      const fillElements = [];

      const fillToggle = createToggleSwitch({
        label: t('fillToggleLabel'),
        value: state.fillEnabled,
        onChange: (checked) => {
          state.fillEnabled = checked;
          // nunca deixa os dois desligados — religa o outro sozinho.
          if (!state.fillEnabled && !state.strokeEnabled) state.strokeEnabled = true;
          buildSidebar();
          render();
        },
      });
      fillElements.push(fillToggle.el);

      const strokeToggle = createToggleSwitch({
        label: t('strokeToggleLabel'),
        value: state.strokeEnabled,
        onChange: (checked) => {
          state.strokeEnabled = checked;
          if (!state.strokeEnabled && !state.fillEnabled) state.fillEnabled = true;
          buildSidebar();
          render();
        },
      });
      fillElements.push(strokeToggle.el);

      if (state.strokeEnabled) {
        const strokeColorWrap = document.createElement('div');
        strokeColorWrap.className = 'control control-stroke-color';
        const strokeColorLabel = document.createElement('span');
        strokeColorLabel.className = 'control-label';
        strokeColorLabel.textContent = t('strokeColorLabel');
        const strokeColorInput = document.createElement('input');
        strokeColorInput.type = 'color';
        strokeColorInput.className = 'stroke-color-input';
        strokeColorInput.value = state.strokeColor;
        strokeColorInput.addEventListener('input', () => {
          state.strokeColor = strokeColorInput.value;
          render();
        });
        strokeColorWrap.appendChild(strokeColorLabel);
        strokeColorWrap.appendChild(strokeColorInput);
        fillElements.push(strokeColorWrap);

        const strokeWidthSlider = createSlider({
          label: t('strokeWidthLabel'),
          min: 0.3,
          max: 1.5,
          step: 0.1,
          value: state.strokeOutlineWidth,
          formatValue: (v) => `${v}px`,
          onChange: (value) => {
            state.strokeOutlineWidth = value;
            render();
          },
        });
        fillElements.push(strokeWidthSlider.el);
      }

      if (state.fillEnabled) {
        const gradientFillToggle = createToggleSwitch({
          label: t('gradientFillToggleLabel'),
          value: state.gradientFillEnabled,
          onChange: (checked) => {
            state.gradientFillEnabled = checked;
            buildSidebar();
            render();
          },
        });
        fillElements.push(gradientFillToggle.el);

        if (state.gradientFillEnabled) {
          const gradientFillAngleSlider = createSlider({
            label: t('gradientFillAngleLabel'),
            min: 0,
            max: 345,
            step: 15,
            value: state.gradientFillAngle,
            formatValue: (v) => `${v}°`,
            onChange: (value) => {
              state.gradientFillAngle = value;
              render();
            },
          });
          fillElements.push(gradientFillAngleSlider.el);

          fillElements.push(buildGradientStopsEditor());

          // grão só existe amarrado ao gradiente interno (decisão do
          // usuário) — some da UI quando o gradiente está desligado.
          const grainToggle = createToggleSwitch({
            label: t('grainToggleLabel'),
            value: state.grainEnabled,
            onChange: (checked) => {
              state.grainEnabled = checked;
              buildSidebar();
              render();
            },
          });
          fillElements.push(grainToggle.el);

          if (state.grainEnabled) {
            const grainIntensitySlider = createSlider({
              label: t('grainIntensityLabel'),
              min: 0,
              max: 100,
              step: 5,
              value: Math.round(state.grainIntensity * 100),
              formatValue: (v) => `${v}%`,
              onChange: (value) => {
                state.grainIntensity = value / 100;
                render();
              },
            });
            fillElements.push(grainIntensitySlider.el);

            const grainSizeSlider = createSlider({
              label: t('grainSizeLabel'),
              min: 0,
              max: 100,
              step: 5,
              value: Math.round(state.grainSize * 100),
              formatValue: (v) => `${v}%`,
              onChange: (value) => {
                state.grainSize = value / 100;
                render();
              },
            });
            fillElements.push(grainSizeSlider.el);

            const grainColorWrap = document.createElement('div');
            grainColorWrap.className = 'control control-stroke-color';
            const grainColorLabel = document.createElement('span');
            grainColorLabel.className = 'control-label';
            grainColorLabel.textContent = t('grainColorLabel');
            const grainColorInput = document.createElement('input');
            grainColorInput.type = 'color';
            grainColorInput.className = 'stroke-color-input';
            grainColorInput.value = state.grainColor;
            grainColorInput.addEventListener('input', () => {
              state.grainColor = grainColorInput.value;
              render();
            });
            grainColorWrap.appendChild(grainColorLabel);
            grainColorWrap.appendChild(grainColorInput);
            fillElements.push(grainColorWrap);

            // atalho pra usar uma das cores do tema em vez de escolher no
            // seletor livre — clicar num swatch da paleta seta o grão pra ela.
            const grainColorRow = document.createElement('div');
            grainColorRow.className = 'color-toggle-row';
            state.colors.map((c) => c.color).forEach((hex) => {
              const swatch = document.createElement('button');
              swatch.type = 'button';
              swatch.className = 'color-toggle-swatch';
              swatch.classList.toggle('active', hex.toLowerCase() === state.grainColor.toLowerCase());
              swatch.style.background = hex;
              swatch.title = hex;
              swatch.addEventListener('click', () => {
                state.grainColor = hex;
                buildSidebar();
                render();
              });
              grainColorRow.appendChild(swatch);
            });
            fillElements.push(grainColorRow);
          }
        }
      }

      sidebar.appendChild(
        createSection(
          t('fillSectionTitle'),
          fillElements,
          sectionOptions('fill', () => randomizeSection(randomizeFillSettings))
        )
      );

      // --- Gradiente ---
      if (state.useImageGuide) {
        const gradientNote = document.createElement('p');
        gradientNote.className = 'control-hint';
        gradientNote.textContent = t('gradientDisabledNote');
        sidebar.appendChild(
          createSection(t('gradientSectionTitle'), [gradientNote], sectionOptions('gradient'))
        );
      } else {
        const gradientTypeSelect = createSelect({
          label: t('gradientTypeLabel'),
          options: [
            { value: 'none', label: t('gradientTypeNone') },
            { value: 'linear', label: t('gradientTypeLinear') },
            { value: 'radial', label: t('gradientTypeRadial') },
          ],
          value: state.densityGradient,
          onChange: (value) => {
            state.densityGradient = value;
            state.gradientDirection = value === 'radial' ? 'center-out' : 'left-to-right';
            buildSidebar();
            render();
          },
        });

        const gradientElements = [gradientTypeSelect.el];

        if (state.densityGradient !== 'none') {
          const directionOptions =
            state.densityGradient === 'radial'
              ? [
                  { value: 'center-out', label: t('gradientRadial_center-out') },
                  { value: 'edge-out', label: t('gradientRadial_edge-out') },
                ]
              : LINEAR_GRADIENT_DIRECTIONS.map((dir) => ({ value: dir, label: t(`gradientDir_${dir}`) }));

          const directionSelect = createSelect({
            label: t('gradientDirectionLabel'),
            options: directionOptions,
            value: state.gradientDirection,
            onChange: (value) => {
              state.gradientDirection = value;
              render();
            },
          });
          gradientElements.push(directionSelect.el);

          const strengthSlider = createSlider({
            label: t('gradientStrengthLabel'),
            min: 10,
            max: 100,
            step: 5,
            value: Math.round(state.gradientStrength * 100),
            formatValue: (v) => `${v}%`,
            onChange: (value) => {
              state.gradientStrength = value / 100;
              render();
            },
          });
          gradientElements.push(strengthSlider.el);
        }

        sidebar.appendChild(
          createSection(
            t('gradientSectionTitle'),
            gradientElements,
            sectionOptions('gradient', () => randomizeSection(randomizeGradientSettings))
          )
        );
      }

      // --- Formas ---
      const shapesGrid = createShapeToggleGrid({
        label: t('shapesSection'),
        shapes: { ...SHAPES, ...buildCustomShapeDefs() },
        value: state.shapesAllowed,
        onChange: (value) => {
          state.shapesAllowed = value;
          render();
        },
        onRemoveCustom: removeCustomShape,
      });

      const shapeFileInput = document.createElement('input');
      shapeFileInput.type = 'file';
      shapeFileInput.accept = 'image/*';
      shapeFileInput.style.display = 'none';
      shapeFileInput.addEventListener('change', () => {
        const file = shapeFileInput.files?.[0];
        if (file) handleCustomShapeUpload(file);
        shapeFileInput.value = '';
      });

      const uploadShapeButton = createButton({
        label: t('uploadShapeButton'),
        onClick: () => shapeFileInput.click(),
      });

      const shapeHint = document.createElement('span');
      shapeHint.className = 'control-hint';
      shapeHint.textContent = t('customShapeHint');

      sidebar.appendChild(
        createSection(
          t('shapesSection'),
          [shapesGrid.el, uploadShapeButton.el, shapeFileInput, shapeHint],
          sectionOptions('shapes', () => randomizeSection(randomizeShapesSettings))
        )
      );

      // --- Cores ---
      // mesmo combo com prévia de cores do seletor de tema (buildPreviewDots
      // já definido acima), só que genérico via createIconSelect — dá pra ver
      // as cores de cada paleta salva sem precisar abrir e testar uma a uma.
      if (cleanupPaletteSwapSelect) {
        cleanupPaletteSwapSelect();
        cleanupPaletteSwapSelect = null;
      }
      const paletteSwapSelect = createIconSelect({
        label: t('paletteSwapLabel'),
        options: [
          { value: 'custom', label: t('customThemeLabel'), renderIcon: () => buildPreviewDots(themePreviewColorsFor('custom')) },
          ...Object.keys(PRESETS).map((key) => ({
            value: key,
            label: t(themeKeys.includes(key) ? `theme_${key}` : `palette_${key}`),
            renderIcon: () => buildPreviewDots(themePreviewColorsFor(key)),
          })),
        ],
        value: state.themeKey === 'custom' || !PRESETS[state.themeKey] ? 'custom' : state.themeKey,
        onChange: (value) => applyPaletteOnly(value),
      });
      cleanupPaletteSwapSelect = paletteSwapSelect.destroy;

      const colorSwatches = createColorSwatches({
        label: t('paletteLabel'),
        colors: state.colors,
        onChange: (colors) => {
          state.colors = colors;
          // escolher cor manualmente descola do preset — sem isso o dropdown
          // "Preset palette" ficava mostrando o tema antigo mesmo depois de
          // trocar as cores, dando a impressão de que a mudança não "colou".
          state.themeKey = 'custom';
          paletteSwapSelect.value = 'custom';
          render();
        },
      });

      // gira o matiz de cada cor da paleta atual por um passo fixo — uma
      // variação rápida de 1 clique só, sem abrir seletor de cor nenhum
      // (diferente de "gerar paleta a partir de 1 cor", que troca tudo).
      const ROTATE_COLORS_HUE_STEP = 30;
      const rotateColorsButton = createButton({
        label: t('rotateColorsButton'),
        onClick: () => {
          pushToHistory();
          state.colors = state.colors.map((entry) => {
            const { h, s, l } = hexToHsl(entry.color);
            return { ...entry, color: hslToHex(h + ROTATE_COLORS_HUE_STEP, s, l) };
          });
          state.themeKey = 'custom';
          buildSidebar();
          render();
        },
      });

      const backgroundColorWrap = document.createElement('div');
      backgroundColorWrap.className = 'control control-background-color';
      const backgroundColorLabel = document.createElement('span');
      backgroundColorLabel.className = 'control-label';
      backgroundColorLabel.textContent = t('backgroundColorLabel');
      const backgroundColorInput = document.createElement('input');
      backgroundColorInput.type = 'color';
      backgroundColorInput.className = 'background-color-input';
      backgroundColorInput.value = state.background || '#ffffff';
      backgroundColorInput.addEventListener('input', () => {
        state.background = backgroundColorInput.value;
        state.themeKey = 'custom';
        paletteSwapSelect.value = 'custom';
        render();
      });
      backgroundColorWrap.appendChild(backgroundColorLabel);
      backgroundColorWrap.appendChild(backgroundColorInput);

      const colorsSectionElements = [
        paletteSwapSelect.el,
        colorSwatches.el,
        rotateColorsButton.el,
        backgroundColorWrap,
      ];

      if (state.structureImageEl) {
        const sameImageToggle = createToggleSwitch({
          label: t('useSameImageLabel'),
          value: state.useSameImageForColor,
          onChange: (checked) => setUseSameImageForColor(checked),
        });
        colorsSectionElements.push(sameImageToggle.el);
      }

      if (!state.useSameImageForColor || !state.structureImageEl) {
        const colorImageWrap = document.createElement('div');
        colorImageWrap.className = 'control control-reference';
        const colorImageLabelEl = document.createElement('span');
        colorImageLabelEl.className = 'control-label';
        colorImageLabelEl.textContent = t('colorImageLabel');
        colorImageWrap.appendChild(colorImageLabelEl);

        const colorImageRow = document.createElement('div');
        colorImageRow.className = 'reference-row';

        if (state.colorImageUrl) {
          const thumb = document.createElement('img');
          thumb.className = 'reference-thumb';
          thumb.src = state.colorImageUrl;
          thumb.alt = t('colorImageLabel');
          colorImageRow.appendChild(thumb);
        }

        const colorFileInput = document.createElement('input');
        colorFileInput.type = 'file';
        colorFileInput.accept = 'image/*';
        colorFileInput.style.display = 'none';
        colorFileInput.addEventListener('change', () => {
          const file = colorFileInput.files?.[0];
          if (file) handleColorImage(file);
          colorFileInput.value = '';
        });

        const colorUploadButton = createButton({
          label: state.colorImageUrl ? t('changeImage') : t('uploadImage'),
          onClick: () => colorFileInput.click(),
        });

        colorImageRow.appendChild(colorUploadButton.el);
        colorImageRow.appendChild(colorFileInput);

        if (state.colorImageUrl) {
          const colorRemoveButton = createButton({
            label: t('removeImageButton'),
            onClick: () => removeColorImage(),
          });
          colorImageRow.appendChild(colorRemoveButton.el);
        }

        colorImageWrap.appendChild(colorImageRow);
        colorsSectionElements.push(colorImageWrap);
      }

      sidebar.appendChild(
        createSection(
          t('colorsSection'),
          colorsSectionElements,
          sectionOptions('colors', () => randomizeSection(randomizeColorSettings))
        )
      );

      // --- Gerar paleta a partir de 1 cor ---
      const harmonyRow = document.createElement('div');
      harmonyRow.className = 'harmony-row';

      const harmonyColorInput = document.createElement('input');
      harmonyColorInput.type = 'color';
      harmonyColorInput.title = t('harmonyBaseColorLabel');
      harmonyColorInput.value = state.harmonyBaseColor;
      harmonyColorInput.addEventListener('input', () => {
        state.harmonyBaseColor = harmonyColorInput.value;
      });

      const harmonyCountSlider = createSlider({
        label: t('harmonyCountLabel'),
        min: 1,
        max: 8,
        step: 1,
        value: state.harmonyCount,
        formatValue: (v) => `${v}`,
        onChange: (value) => {
          state.harmonyCount = value;
        },
      });

      const generateHarmonyButton = createButton({
        label: t('generateHarmonyButton'),
        onClick: () => {
          pushToHistory();
          state.colors = generateHarmoniousPalette(state.harmonyBaseColor, state.harmonyCount);
          state.themeKey = 'custom';
          // mesma razão do applyTheme/applyPaletteOnly — ver comentário lá.
          state.invertColors = false;
          state.blackIcon = false;
          buildSidebar();
          render();
        },
      });

      harmonyRow.appendChild(harmonyColorInput);
      harmonyRow.appendChild(generateHarmonyButton.el);

      sidebar.appendChild(
        createSection(
          t('harmonySectionTitle'),
          [harmonyRow, harmonyCountSlider.el],
          sectionOptions('harmony')
        )
      );

      // --- Aparência ---
      const transparentBgToggle = createToggleSwitch({
        label: t('transparentBgLabel'),
        value: state.transparentBg,
        onChange: (checked) => {
          state.transparentBg = checked;
          render();
        },
      });
      const blackIconToggle = createToggleSwitch({
        label: t('blackIconLabel'),
        value: state.blackIcon,
        onChange: (checked) => {
          state.blackIcon = checked;
          render();
        },
      });
      const invertColorsToggle = createToggleSwitch({
        label: t('invertColorsLabel'),
        value: state.invertColors,
        onChange: (checked) => {
          state.invertColors = checked;
          render();
        },
      });
      sidebar.appendChild(
        createSection(
          t('appearanceSection'),
          [transparentBgToggle.el, blackIconToggle.el, invertColorsToggle.el],
          sectionOptions('appearance', () => randomizeSection(randomizeAppearanceSettings))
        )
      );

      // --- Presets salvos ---
      const presetNameInput = document.createElement('input');
      presetNameInput.type = 'text';
      presetNameInput.className = 'preset-name-input';
      presetNameInput.placeholder = t('presetNamePlaceholder');

      const savePresetButton = createButton({
        label: t('savePresetButton'),
        onClick: () => {
          const name = presetNameInput.value.trim();
          if (!name) return;
          savePreset(name);
        },
      });

      const presetSaveRow = document.createElement('div');
      presetSaveRow.className = 'preset-save-row';
      presetSaveRow.appendChild(presetNameInput);
      presetSaveRow.appendChild(savePresetButton.el);

      const presetElements = [presetSaveRow];

      if (savedPresets.length) {
        const presetList = document.createElement('div');
        presetList.className = 'preset-list';
        savedPresets.forEach((preset) => {
          const row = document.createElement('div');
          row.className = 'preset-row';

          const loadButton = document.createElement('button');
          loadButton.type = 'button';
          loadButton.className = 'preset-load-button';
          loadButton.textContent = preset.name;
          loadButton.addEventListener('click', () => applyPreset(preset));

          const deleteButton = document.createElement('button');
          deleteButton.type = 'button';
          deleteButton.className = 'preset-delete-button';
          deleteButton.textContent = '×';
          deleteButton.title = t('deletePreset');
          deleteButton.addEventListener('click', (e) => {
            e.stopPropagation();
            deletePreset(preset.id);
          });

          row.appendChild(loadButton);
          row.appendChild(deleteButton);
          presetList.appendChild(row);
        });
        presetElements.push(presetList);
      }

      sidebar.appendChild(
        createSection(t('presetsSectionTitle'), presetElements, sectionOptions('presets'))
      );

      // --- Compartilhar (código copiável, mesmo "conteúdo" de um preset,
      // sem precisar salvar nada — bom pra mandar uma composição específica
      // pra alguém sem precisar exportar arquivo) ---
      function flashButtonText(button, text, revertTo) {
        setButtonLabel(button.el, text);
        setTimeout(() => {
          setButtonLabel(button.el, revertTo);
        }, 1500);
      }

      const copyCodeButton = createButton({
        label: t('copyCodeButton'),
        onClick: async () => {
          const code = encodeShareCode(buildBaseSnapshot());
          if (!code) return;
          try {
            await navigator.clipboard.writeText(code);
            flashButtonText(copyCodeButton, t('copyCodeButtonCopied'), t('copyCodeButton'));
          } catch (err) {
            flashButtonText(copyCodeButton, t('copyCodeButtonError'), t('copyCodeButton'));
          }
        },
      });

      const pasteCodeInput = document.createElement('input');
      pasteCodeInput.type = 'text';
      pasteCodeInput.className = 'preset-name-input';
      pasteCodeInput.placeholder = t('pasteCodePlaceholder');

      const loadCodeButton = createButton({
        label: t('loadCodeButton'),
        onClick: () => {
          const snapshot = decodeShareCode(pasteCodeInput.value);
          if (!snapshot) {
            flashButtonText(loadCodeButton, t('loadCodeButtonError'), t('loadCodeButton'));
            return;
          }
          applySnapshot(snapshot);
          pasteCodeInput.value = '';
        },
      });

      const pasteCodeRow = document.createElement('div');
      pasteCodeRow.className = 'preset-save-row';
      pasteCodeRow.appendChild(pasteCodeInput);
      pasteCodeRow.appendChild(loadCodeButton.el);

      sidebar.appendChild(
        createSection(
          t('shareCodeSectionTitle'),
          [copyCodeButton.el, pasteCodeRow],
          sectionOptions('share')
        )
      );

      // --- Ações (exportar) — continua no fim da sidebar, do jeito de
      // sempre. ---
      const exportSvgButton = createButton({
        label: t('exportSvgButton'),
        variant: 'primary',
        onClick: () =>
          // currentFramedIconSvg já é a composição final (quadrada OU a
          // gerada pro formato escolhido, ver updatePreviewFrame) — não
          // precisa mais nenhuma moldura/repetição aplicada por cima aqui.
          exportSvgString(currentFramedIconSvg, `icone-${state.themeKey}.svg`, {
            background: state.transparentBg ? null : state.background,
          }),
      });

      const exportPngButton = createButton({
        label: t('exportPngButton'),
        variant: 'primary',
        onClick: async () => {
          try {
            await exportPngFromSvgString(currentFramedIconSvg, `icone-${state.themeKey}.png`, {
              background: state.transparentBg ? null : state.background,
            });
          } catch (err) {
            // sem isso, uma falha (ex.: navegador bloqueando canvas/blob)
            // não dava sinal nenhum pra quem clicou — parecia que o botão
            // simplesmente não fazia nada.
            const original = t('exportPngButton');
            setButtonLabel(exportPngButton.el, t('copyCodeButtonError'));
            setTimeout(() => {
              setButtonLabel(exportPngButton.el, original);
            }, 2000);
          }
        },
      });

      // no mobile os botões de exportar viram só mais uma categoria de
      // ajuste (igual "Formato") — antes ficavam soltos direto na sidebar
      // (fora do sistema de abas), então apareciam repetidos embaixo de
      // TODA categoria aberta, não só quando fazia sentido. No desktop
      // continuam soltos no fim da sidebar, do jeito de sempre.
      if (isMobileViewport) {
        sidebar.appendChild(
          createSection(t('exportSectionTitle'), [exportSvgButton.el, exportPngButton.el], sectionOptions('export'))
        );
      } else {
        const actions = document.createElement('div');
        actions.className = 'gi-actions';
        actions.appendChild(exportSvgButton.el);
        actions.appendChild(exportPngButton.el);
        sidebar.appendChild(actions);
      }

      // --- Formato --- sempre uma seção normal da sidebar agora (era uma
      // barra própria fora dela, só no desktop, tentando ficar alinhada
      // com o topo do preview do lado — nunca bateu certo em toda largura
      // de tela). Vira a PRIMEIRA seção, igual as outras (chevron
      // colapsável no desktop, aba de categoria no mobile — ver mais
      // abaixo), sem precisar alinhar nada com mais nada.
      const formatPicker = createFrameTilePicker({
        options: frameTileOptions(),
        value: exportFrame,
        onChange: onFrameChange,
      });
      const formatSection = createSection(t('formatSectionTitle'), [formatPicker.el], sectionOptions('format'));
      sidebar.insertBefore(formatSection, sidebar.firstChild);

      // --- aba de categorias (só no mobile) ---
      // no desktop cada seção continua com seu próprio chevron colapsável
      // (inalterado). No mobile isso virava uma lista enorme de acordeões
      // todos abertos — em vez disso, uma barra de abas (nome de cada
      // categoria, com scroll horizontal) decide qual seção aparece por
      // vez, do jeito Lightroom mobile resolve isso (Light/Color/Effects
      // etc., um de cada vez). Mesmo truque de CSS :has() das outras abas
      // do app — sem isso, .control-section[data-section-id] (setado em
      // ui/controls/section.js) não teria como saber qual delas mostrar.
      if (isMobileViewport) {
        const allCategorySections = Array.from(sidebar.querySelectorAll('.control-section[data-section-id]'));
        // "Exportar" sai da barra de categorias — vira o 4º ícone da
        // trilha do preview (ver toolbarRail/exportRailButton), não mais
        // misturado com Tema/Grade/Cores etc. (é uma ação, não um ajuste).
        const exportSection = allCategorySections.find((s) => s.dataset.sectionId === 'export');
        const categorySections = allCategorySections.filter((s) => s.dataset.sectionId !== 'export');
        if (exportSection) {
          const exportInput = document.createElement('input');
          exportInput.type = 'radio';
          exportInput.name = 'gi-category-tab';
          exportInput.id = 'gi-cat-export';
          exportInput.className = 'gi-mobile-category-tabs-input';
          exportInput.checked = mobileActiveCategoryId === 'export';
          sidebar.insertBefore(exportInput, exportSection);
          mobileExportInputEl = exportInput;
        }
        if (categorySections.length) {
          const categoryTabs = document.createElement('div');
          categoryTabs.className = 'gi-mobile-category-tabs';
          categorySections.forEach((section) => {
            const sectionId = section.dataset.sectionId;
            const title = section.querySelector('.control-section-title')?.textContent ?? sectionId;
            const inputId = `gi-cat-${sectionId}`;

            const input = document.createElement('input');
            input.type = 'radio';
            input.name = 'gi-category-tab';
            input.id = inputId;
            input.className = 'gi-mobile-category-tabs-input';
            // reflete o que estava aberto ANTES desse rebuild (buildSidebar
            // roda de novo a cada mudança de estado — ver comentário em
            // mobileActiveCategoryId) — sem isso, mexer em qualquer ajuste
            // fechava o painel (ou pulava pra "Formato") sozinho. Sem
            // categoria nenhuma guardada (primeira montagem), começa
            // fechado: o "bottom sheet" só aparece depois de tocar num
            // ícone, não já ocupando a tela de cara.
            input.checked = sectionId === mobileActiveCategoryId;

            const tabLabel = document.createElement('label');
            tabLabel.htmlFor = inputId;
            tabLabel.className = 'gi-mobile-category-tabs-label';
            // ícone em cima, nome embaixo — estilo Lightroom mobile (Luz/
            // Cor/Efeitos etc.), bem mais fácil de reconhecer de relance
            // rolando a barra horizontal do que só texto pequeno.
            const iconMarkup = CATEGORY_ICONS[sectionId];
            tabLabel.innerHTML =
              (iconMarkup ? `<span class="gi-mobile-category-tabs-icon">${iconMarkup}</span>` : '') +
              `<span class="gi-mobile-category-tabs-text">${title}</span>`;

            // tocar de novo no ícone já ativo FECHA o painel (radio nativo
            // não desmarca sozinho ao clicar de novo) — sem isso, uma vez
            // aberta, a única forma de "ver mais preview" de novo era
            // escolher outra categoria, nunca voltar a não ter nenhuma.
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
          // vai pro fim da sidebar (depois de todas as categorias de
          // ajuste — "Exportar" não é mais uma delas, ver exportSection
          // acima) — não referencia mais a antiga div "actions" (só existe
          // no desktop agora).
          sidebar.appendChild(categoryTabs);
          mobileCategoryTabsEl = categoryTabs;

          // trocar de categoria com a seção anterior já rolada pra baixo
          // (dentro de uma seção grande, tipo Cores) deixava a próxima
          // aberta "no meio", sem mostrar o topo dela. Quem rola agora é a
          // própria seção (ver overflow-y no .control-section[data-
          // section-id] mobile), não mais a sidebar inteira (que virou um
          // "bottom sheet" fixo, não rola como painel único).
          categoryTabs.addEventListener('change', () => {
            const checkedInput = categoryTabs.querySelector('.gi-mobile-category-tabs-input:checked');
            // fonte da verdade final de qual categoria está aberta — cobre
            // troca por teclado/setas entre os radios (não passa pelo
            // clique no <label>, que já seta isso na hora, ver acima).
            mobileActiveCategoryId = checkedInput ? checkedInput.id.replace('gi-cat-', '') : null;
            if (!checkedInput) return;
            sidebar.querySelector(`[data-section-id="${mobileActiveCategoryId}"]`)?.scrollTo?.({ top: 0, behavior: 'smooth' });
          });
        }
      }
    }

    buildSidebar();
    // "Formato" já entra dentro da sidebar (primeira seção, ver
    // buildSidebar) — sem barra própria solta aqui em cima tentando ficar
    // alinhada com o preview do lado, nunca batia certo em toda largura.
    const sidebarColumn = document.createElement('div');
    sidebarColumn.className = 'gi-sidebar-column';
    sidebarColumn.appendChild(sidebar);

    root.appendChild(sidebarColumn);
    root.appendChild(stage);
    container.appendChild(root);

    render();
    renderHistory();

    cleanupPaste = listenForPaste(window, { onImage: (file) => handleStructureImage(file) });

    // atalho de teclado — espaço gera um azulejo novo (igual ao "Novo
    // azulejo"), inspirado no playgrnd.tools. Ignora se o foco tá num
    // campo de texto/select (senão rouba o espaço de quem tá digitando um
    // nome de preset ou colando um código) ou se tem modificador junto
    // (evita brigar com atalho do navegador/SO).
    function handleKeyboardShortcut(e) {
      if (e.key !== ' ' && e.code !== 'Space') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (document.activeElement?.isContentEditable) return;
      e.preventDefault();
      pushToHistory();
      state.seed = randomSeed();
      refreshGridOverrideIfEditing();
      render();
    }
    window.addEventListener('keydown', handleKeyboardShortcut);
    cleanupKeyboardShortcuts = () => window.removeEventListener('keydown', handleKeyboardShortcut);

    // a largura disponível pro preview muda com o tamanho da tela — sem
    // isso, redimensionar a janela deixava o quadrado contido dentro da
    // moldura com o tamanho errado (calculado só 1x, na largura antiga).
    window.addEventListener('resize', updatePreviewFrame);
    // recalcula também se a toolbar (Novo azulejo/Criar variações/Estou
    // com sorte) ou a trilha de abas mudar de tamanho por qualquer outro
    // motivo que não seja resize da janela — texto de botão que troca de
    // idioma e fica maior/menor, ou a fonte (Space Grotesk) terminando de
    // carregar depois do primeiro render (o texto pode quebrar linha
    // diferente do fallback do sistema). Sem isso, o preview ficava com o
    // tamanho calculado pra uma toolbar que já não existe mais daquele
    // jeito, sobrando pouco (ou espaço demais) embaixo e cortando os
    // botões ou a trilha de abas.
    const frameSizeObserver = new ResizeObserver(() => updatePreviewFrame());
    frameSizeObserver.observe(stageToolbar);
    frameSizeObserver.observe(stageTabsRow);
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => updatePreviewFrame());
    }
    cleanupFrameResize = () => {
      window.removeEventListener('resize', updatePreviewFrame);
      frameSizeObserver.disconnect();
    };

    document.addEventListener('click', handleDocumentClickForThemeDropdown);
    document.addEventListener('keydown', handleDocumentKeydownForThemeDropdown);
    cleanupThemeDropdown = () => {
      document.removeEventListener('click', handleDocumentClickForThemeDropdown);
      document.removeEventListener('keydown', handleDocumentKeydownForThemeDropdown);
    };
    cleanupLang = onLangChange(() => {
      // "Formato" mora dentro da sidebar (primeira seção) — buildSidebar()
      // (chamado embaixo) já refaz ela com os textos traduzidos junto de
      // tudo mais, sem precisar de nada especial aqui.
      resultTitle.textContent = t('resultTitle');
      resultTabLabel.textContent = t('resultTitle');
      variationsLabel.textContent = t('variationsLabel');
      variationsTabLabel.textContent = t('variationsLabel');
      historyLabel.textContent = t('historyLabel');
      historyTabLabel.textContent = t('historyLabel');
      setButtonLabel(regenerateButton.el, t('regenerateButton'));
      setButtonLabel(variationsButton.el, t('variationsButton'));
      setButtonLabel(luckyButton.el, t('luckyButton'));
      gridEditToggleRow.el.textContent = t('fineControlLabelShort');
      gridEditToggleRow.el.setAttribute('aria-label', t('fineControlLabel'));
      gridEditToggleRow.el.title = t('fineControlLabel');
      buildSidebar();
    });
  },

  unmount() {
    if (cleanupPaste) {
      cleanupPaste();
      cleanupPaste = null;
    }
    if (cleanupThemeDropdown) {
      cleanupThemeDropdown();
      cleanupThemeDropdown = null;
    }
    if (cleanupLang) {
      cleanupLang();
      cleanupLang = null;
    }
    // fecha o menu de cor/forma se ficar aberto na hora de trocar de aba —
    // closeColorMenu() já não faz nada se nenhum menu estiver aberto.
    if (cleanupColorMenu) {
      cleanupColorMenu();
      cleanupColorMenu = null;
    }
    if (cleanupPaletteSwapSelect) {
      cleanupPaletteSwapSelect();
      cleanupPaletteSwapSelect = null;
    }
    if (cleanupKeyboardShortcuts) {
      cleanupKeyboardShortcuts();
      cleanupKeyboardShortcuts = null;
    }
    if (cleanupFrameResize) {
      cleanupFrameResize();
      cleanupFrameResize = null;
    }
  },
};
