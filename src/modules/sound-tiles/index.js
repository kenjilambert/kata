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
let cleanupAudioProgress = null;
let cleanupVolumePopover = null;

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
    let micSelectSlot;

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

    // enumerateDevices() só devolve deviceId/label de verdade depois de já
    // ter permissão de microfone concedida ao menos uma vez nesta sessão —
    // mesma regra do refreshCameraSelect do Espelho (video-tiles/index.js),
    // só que pra microfone. Some sozinho se só existir 1 (nada pra
    // escolher).
    async function refreshMicSelect() {
      micSelectSlot.innerHTML = '';
      // .control-section-body-inner usa `gap` (não margin) entre os filhos
      // — um <div> vazio ainda CONTA pro gap dos dois lados dele, mesmo
      // sem conteúdo nenhum (só `display:none`/[hidden] tira do fluxo de
      // verdade). Sem isso aqui, esse slot ficava 0px de altura mas ainda
      // "roubava" 2x o gap da seção (antes E depois dele) sempre que não
      // tinha 2+ microfones pra listar — era esse o "espaço desnecessário"
      // enorme entre a fileira de botões e o cartão do player.
      micSelectSlot.hidden = true;
      if (!engine.isMicActive()) return;
      const mics = await engine.listMics();
      if (mics.length < 2) return;
      const select = createSelect({
        label: t('soundMicDeviceLabel'),
        options: mics.map((mic, i) => ({ value: mic.deviceId, label: mic.label || `${t('soundMicDeviceLabel')} ${i + 1}` })),
        value: engine.getActiveMicDeviceId() || mics[0].deviceId,
        onChange: async (deviceId) => {
          try {
            await engine.enableMic(deviceId);
          } catch (err) {
            errorMsg.textContent = `${t('soundMicError')} (${err?.name || err?.message || err})`;
            errorMsg.hidden = false;
          }
        },
      });
      micSelectSlot.appendChild(select.el);
      micSelectSlot.hidden = false;
    }

    function buildSidebar() {
      if (cleanupThemeSelect) {
        cleanupThemeSelect();
        cleanupThemeSelect = null;
      }
      if (cleanupAudioProgress) {
        cleanupAudioProgress();
        cleanupAudioProgress = null;
      }
      if (cleanupVolumePopover) {
        cleanupVolumePopover();
        cleanupVolumePopover = null;
      }
      sidebar.innerHTML = '';

      // botões de ícone só (sem rótulo de texto) — mesmo componente de
      // sempre (createButton), só que sem `label` nenhum de sobra: o ícone
      // sozinho já é claro (rebobinar/avançar/repetir), igual qualquer
      // player de música de verdade (ver referência que a Kenji mandou).
      function iconButton({ icon, ariaLabel, onClick, extraClass = '' }) {
        const btn = createButton({ label: '', icon, onClick });
        btn.el.className += ` sound-player-icon-button ${extraClass}`.trimEnd();
        btn.el.setAttribute('aria-label', ariaLabel);
        btn.el.querySelector('.control-button-label').remove();
        return btn;
      }

      // toda `icon` aqui precisa vir com o <svg> já em volta — createButton
      // (ui/controls/button.js) só joga a string crua dentro de uma <span>
      // via innerHTML; um <path>/<rect> sozinho, sem o elemento <svg> pai,
      // não é um elemento SVG de verdade (o navegador ignora, invisível) —
      // foi exatamente esse bug na primeira versão daqui (ícones sumidos).
      function svgIcon(inner) {
        return `<svg viewBox="0 0 24 24">${inner}</svg>`;
      }

      let hasFileLoaded = engine.hasSource() && !engine.isMicActive();

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
        refreshMicSelect();
        playButton.el.setAttribute('aria-label', t('soundPauseButton'));
        playButton.el.querySelector('.control-button-icon').innerHTML = PAUSE_ICON;
        playerBlock.hidden = false;
        fileNameEl.textContent = engine.getFileName();
        updatePlayerProgress();
        hasFileLoaded = true;
        updateUploadButtonAppearance();
      });
      // "Enviar áudio" vira "Cancelar" enquanto há um arquivo carregado —
      // MESMO botão, não dois; clicar cancela em vez de abrir o seletor de
      // arquivo de novo (só faz sentido enviar um novo depois de tirar o
      // atual, um clique só nunca faz as duas coisas). No estado
      // "Cancelar" o botão troca de visual (ver .sound-player-cancel-
      // button em style.css) pro mesmo tom do cartão azul do player —
      // sinaliza "isso desfaz o que já foi enviado", não mais uma ação
      // "principal" tipo enviar de novo.
      function updateUploadButtonAppearance() {
        uploadButton.el.querySelector('.control-button-label').textContent = hasFileLoaded
          ? t('soundCancelButton')
          : t('soundUploadButton');
        uploadButton.el.classList.toggle('sound-player-cancel-button', hasFileLoaded);
      }
      const uploadButton = createButton({
        label: t('soundUploadButton'),
        variant: 'accent2',
        onClick: () => {
          if (hasFileLoaded) {
            engine.clearFile();
            hasFileLoaded = false;
            updateUploadButtonAppearance();
            playerBlock.hidden = true;
            updateSourceHint();
            return;
          }
          uploadInput.click();
        },
      });
      updateUploadButtonAppearance();

      micButton = createButton({
        label: t('soundMicButton'),
        variant: 'primary',
        onClick: async () => {
          const labelEl = micButton.el.querySelector('.control-button-label');
          if (engine.isMicActive()) {
            engine.stopMic();
            labelEl.textContent = t('soundMicButton');
            updateSourceHint();
            refreshMicSelect();
            return;
          }
          try {
            errorMsg.hidden = true;
            await engine.enableMic();
            labelEl.textContent = t('soundMicStopButton');
            // microfone não tem arquivo/duração/posição pra arrastar nem
            // volume próprio (é o ambiente, não tem "tocar mais alto") — o
            // player (nome/progresso/volume) só faz sentido pra uma fonte
            // 'file', some enquanto o mic estiver ativo. hasFileLoaded some
            // junto (engine.enableMic já chama clearSource por baixo) — o
            // botão Enviar áudio volta a dizer isso mesmo, não "Cancelar".
            hasFileLoaded = false;
            updateUploadButtonAppearance();
            playerBlock.hidden = true;
            updateSourceHint();
            refreshMicSelect();
          } catch (err) {
            errorMsg.textContent = `${t('soundMicError')} (${err?.name || err?.message || err})`;
            errorMsg.hidden = false;
          }
        },
      });

      const sourceRow = document.createElement('div');
      sourceRow.className = 'vt-source-row';
      sourceRow.appendChild(uploadButton.el);
      sourceRow.appendChild(micButton.el);
      micSelectSlot = document.createElement('div');
      micSelectSlot.hidden = true;

      // player — layout de player de música de verdade (nome da faixa em
      // cima, barra de progresso com tempo nas PONTAS, transporte com botão
      // de tocar grande no centro), dentro de um cartão próprio (ver
      // .sound-player em style.css) que engloba tudo visualmente, separado
      // da fileira Enviar/Ativar. Só existe (visível) enquanto a fonte é um
      // ARQUIVO enviado, nunca com o microfone.
      const fileNameEl = document.createElement('div');
      fileNameEl.className = 'sound-player-title';
      fileNameEl.textContent = engine.getFileName();

      // slider trabalha em FRAÇÃO (0-1), não segundos — a duração real só
      // fica disponível depois de 'loadedmetadata' (às vezes depois do
      // slider já criado), e createSlider não permite mudar min/max depois
      // de criado; fração evita esse problema por completo (nunca precisa
      // mudar o teto). Rótulo/caixinha de valor escondidos (ver hideLabel/
      // hideValueBox em ui/controls/slider.js) — o tempo aparece nas PONTAS
      // da trilha (timeCurrentEl/timeDurationEl), não como um label+valor
      // de slider comum.
      let playerCurrentSec = 0;
      let playerDurationSec = 0;
      const progressSlider = createSlider({
        label: t('soundProgressLabel'),
        min: 0,
        max: 1,
        step: 0.001,
        value: 0,
        formatValue: () => '',
        hideLabel: true,
        hideValueBox: true,
        onChange: (fraction) => engine.seekTo(fraction * engine.getDuration()),
      });

      const timeCurrentEl = document.createElement('span');
      timeCurrentEl.className = 'sound-player-time';
      const timeDurationEl = document.createElement('span');
      timeDurationEl.className = 'sound-player-time';

      const progressRow = document.createElement('div');
      progressRow.className = 'sound-player-progress';
      progressRow.appendChild(timeCurrentEl);
      progressRow.appendChild(progressSlider.el);
      progressRow.appendChild(timeDurationEl);

      function updatePlayerProgress() {
        playerDurationSec = engine.getDuration();
        playerCurrentSec = engine.getCurrentTime();
        progressSlider.value = playerDurationSec > 0 ? playerCurrentSec / playerDurationSec : 0;
        timeCurrentEl.textContent = formatSeconds(playerCurrentSec * 1000);
        timeDurationEl.textContent = formatSeconds(playerDurationSec * 1000);
      }
      cleanupAudioProgress = engine.onAudioProgress(updatePlayerProgress);

      // rebobinar/avançar 15s — o "skip 15" clássico de qualquer player de
      // podcast/música: seta circular com o número dentro, não uma seta
      // dupla genérica.
      function skip15Icon({ mirrored }) {
        const arrow = mirrored
          ? '<path d="M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z" fill="currentColor"/>'
          : '<path d="M12 5V2L17 6l-5 4V7a5 5 0 1 0 5 5H19a7 7 0 1 1-7-7z" fill="currentColor"/>';
        return svgIcon(
          `${arrow}<text x="12" y="16.5" font-size="7.5" font-weight="700" text-anchor="middle" fill="currentColor">15</text>`
        );
      }

      const rewindButton = iconButton({
        icon: skip15Icon({ mirrored: true }),
        ariaLabel: t('soundRewindButton'),
        onClick: () => engine.seekTo(Math.max(0, engine.getCurrentTime() - 15)),
      });

      const forwardButton = iconButton({
        icon: skip15Icon({ mirrored: false }),
        ariaLabel: t('soundForwardButton'),
        onClick: () => engine.seekTo(Math.min(engine.getDuration(), engine.getCurrentTime() + 15)),
      });

      const PLAY_ICON = svgIcon('<path d="M8 5v14l11-7z" fill="currentColor"/>');
      const PAUSE_ICON = svgIcon(
        '<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/>'
      );
      playButton = iconButton({
        icon: engine.isFilePlaying() ? PAUSE_ICON : PLAY_ICON,
        ariaLabel: t('soundPauseButton'),
        extraClass: 'sound-player-play-button',
        onClick: () => {
          engine.toggleFilePlayback();
          const playing = engine.isFilePlaying();
          playButton.el.setAttribute('aria-label', playing ? t('soundPauseButton') : t('soundPlayButton'));
          playButton.el.querySelector('.control-button-icon').innerHTML = playing ? PAUSE_ICON : PLAY_ICON;
        },
      });

      // repetir — alterna audio.loop (padrão ligado, ver engine.js); estado
      // ativo marcado por cor (.sound-player-icon-button.active), não por
      // texto (o botão não tem rótulo nenhum). Fica na PONTA ESQUERDA da
      // fileira (position:absolute, ver .sound-player-repeat em style.css)
      // — espelhando o volume na ponta direita, já que o grupo central
      // (voltar/tocar/avançar) sozinho deixava aquele lado vazio à toa.
      const repeatButton = iconButton({
        icon: svgIcon(
          '<path d="M17 2l4 4-4 4" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 11V9a4 4 0 0 1 4-4h14" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 22l-4-4 4-4" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 13v2a4 4 0 0 1-4 4H3" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
        ),
        ariaLabel: t('soundRepeatButton'),
        extraClass: 'sound-player-repeat',
        onClick: () => {
          engine.setLoop(!engine.getLoop());
          repeatButton.el.classList.toggle('active', engine.getLoop());
        },
      });
      repeatButton.el.classList.toggle('active', engine.getLoop());

      // volume — NÃO é mais um slider horizontal gigante sempre visível: é
      // um botão de alto-falante que abre um popover flutuante com um
      // FADER VERTICAL comprido do lado (ver createSlider orientation:
      // 'vertical'), igual volume de player de música/mesa de som de
      // verdade. Sem rótulo "Volume" nem caixinha de porcentagem — só o
      // fader (ver hideLabel/hideValueBox). O botão de alto-falante DENTRO
      // do popover (não o de fora, que só abre/fecha) muta/desmuta.
      const MUTE_ICON = svgIcon(
        '<path d="M4 9v6h4l5 5V4L8 9H4z" fill="currentColor"/><path d="M16 9l6 6M22 9l-6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'
      );
      const VOLUME_ICON = svgIcon(
        '<path d="M4 9v6h4l5 5V4L8 9H4z" fill="currentColor"/><path d="M16.5 8.5a5 5 0 0 1 0 7" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/><path d="M19 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>'
      );

      const volumeSlider = createSlider({
        label: t('soundVolumeLabel'),
        min: 0,
        max: 100,
        step: 1,
        value: Math.round((engine.getVolume() ?? 1) * 100),
        formatValue: (v) => `${v}%`,
        hideLabel: true,
        hideValueBox: true,
        orientation: 'vertical',
        onChange: (v) => {
          engine.setVolume(v / 100);
          muteButton.el.querySelector('.control-button-icon').innerHTML = v > 0 ? VOLUME_ICON : MUTE_ICON;
        },
      });

      let volumeBeforeMute = engine.getVolume() || 1;
      const muteButton = iconButton({
        icon: engine.getVolume() > 0 ? VOLUME_ICON : MUTE_ICON,
        ariaLabel: t('soundVolumeButton'),
        extraClass: 'sound-player-mute-button',
        onClick: () => {
          const muting = engine.getVolume() > 0;
          if (muting) volumeBeforeMute = engine.getVolume();
          const next = muting ? 0 : volumeBeforeMute || 1;
          engine.setVolume(next);
          volumeSlider.value = Math.round(next * 100);
          muteButton.el.querySelector('.control-button-icon').innerHTML = next > 0 ? VOLUME_ICON : MUTE_ICON;
        },
      });

      const volumePopover = document.createElement('div');
      volumePopover.className = 'sound-player-volume-popover';
      volumePopover.appendChild(muteButton.el);
      volumePopover.appendChild(volumeSlider.el);
      volumePopover.hidden = true;

      let closeVolumePopoverOnOutsideClick = null;
      function closeVolumePopover() {
        volumePopover.hidden = true;
        if (closeVolumePopoverOnOutsideClick) {
          document.removeEventListener('pointerdown', closeVolumePopoverOnOutsideClick);
          closeVolumePopoverOnOutsideClick = null;
        }
      }
      // guardado no nível de módulo (ver cleanupVolumePopover no topo do
      // arquivo) — sem isso, reconstruir a sidebar (troca de idioma, tema
      // etc.) enquanto o popover está aberto deixava um listener de
      // 'pointerdown' órfão no document, referenciando nós já removidos.
      cleanupVolumePopover = closeVolumePopover;
      const volumeWrap = document.createElement('div');
      volumeWrap.className = 'sound-player-volume';
      const volumeButton = iconButton({
        icon: VOLUME_ICON,
        ariaLabel: t('soundVolumeButton'),
        onClick: () => {
          if (!volumePopover.hidden) {
            closeVolumePopover();
            return;
          }
          volumePopover.hidden = false;
          // fecha ao clicar fora — registrado só enquanto aberto (não um
          // listener permanente no documento a troca de aba toda).
          closeVolumePopoverOnOutsideClick = (e) => {
            if (!volumeWrap.contains(e.target)) closeVolumePopover();
          };
          // setTimeout 0: o MESMO clique que abriu o popover não pode
          // também ser lido como "clique fora" pelo listener que acabou de
          // ser registrado (pointerdown já disparou, mas o listener só
          // entra depois desse handler terminar — sem o atraso, tudo bem
          // na prática, mas o 0ms aqui deixa a intenção explícita).
          setTimeout(() => document.addEventListener('pointerdown', closeVolumePopoverOnOutsideClick), 0);
        },
      });
      volumeWrap.appendChild(volumeButton.el);
      volumeWrap.appendChild(volumePopover);

      // grupo central (voltar/tocar/avançar) — mesma proporção nos 3;
      // repetir e volume ficam FORA do grupo, cada um na sua ponta (ver
      // .sound-player-repeat/.sound-player-volume em style.css), não
      // disputando espaço com o trio central.
      const playerCenterGroup = document.createElement('div');
      playerCenterGroup.className = 'sound-player-center-group';
      playerCenterGroup.appendChild(rewindButton.el);
      playerCenterGroup.appendChild(playButton.el);
      playerCenterGroup.appendChild(forwardButton.el);

      const playerTransportRow = document.createElement('div');
      playerTransportRow.className = 'sound-player-transport';
      playerTransportRow.appendChild(repeatButton.el);
      playerTransportRow.appendChild(playerCenterGroup);
      playerTransportRow.appendChild(volumeWrap);

      const playerBlock = document.createElement('div');
      playerBlock.className = 'sound-player';
      playerBlock.appendChild(fileNameEl);
      playerBlock.appendChild(progressRow);
      playerBlock.appendChild(playerTransportRow);
      playerBlock.hidden = !hasFileLoaded;
      updatePlayerProgress();

      sidebar.appendChild(
        createSection(t('soundSourceSection'), [sourceRow, micSelectSlot, uploadInput, errorMsg, playerBlock], {
          id: 'source',
        })
      );
      // reconstrói o seletor de microfones a cada rebuild da sidebar também
      // (troca de idioma, tema...) — mesmo padrão do refreshCameraSelect no
      // Espelho.
      refreshMicSelect();

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
    if (cleanupAudioProgress) {
      cleanupAudioProgress();
      cleanupAudioProgress = null;
    }
    if (cleanupVolumePopover) {
      cleanupVolumePopover();
      cleanupVolumePopover = null;
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
