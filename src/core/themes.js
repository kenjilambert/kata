// Temas (paleta + forma + estrutura pré-configuradas) — extraído de
// grid-icons/index.js pra poder ser reaproveitado por qualquer módulo que
// edite o mesmo patternState (hoje: Azulejo e Espelho). themes.json continua
// morando dentro de grid-icons/ (é "dado" do Azulejo, o módulo original),
// só a LÓGICA de carregar/aplicar um tema virou compartilhada.
import { PRESETS, clonePreset } from './palette.js';
import { patternState } from './patternState.js';

const THEMES_URL = new URL('../modules/grid-icons/themes.json', import.meta.url);

// "Limpo" não é um tema visual como os outros (não tem curadoria de
// cor/forma/simetria) — é o ponto de partida zerado, por isso vive aqui
// como entrada sintética em vez de mais uma linha no themes.json.
const BLANK_THEME = {
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
};

// devolve o dicionário completo de temas (chave → receita) — cada módulo
// que precisa chama isso, em vez de depender de um módulo já ter carregado
// antes.
//
// Cache de módulo: o themes.json é estático e nunca muda em runtime, mas isso
// é chamado a cada montagem de aba (Azulejo, Espelho, Gradiente) — sem cache,
// cada troca de aba refazia um fetch de verdade, deixando o mount() async por
// vários milissegundos sem necessidade; era justamente essa janela que
// permitia a corrida de troca de abas (ver o comentário em
// ui/module-switcher.js). Guarda a PROMESSA (não o resultado) pra duas
// montagens simultâneas compartilharem o mesmo fetch em vez de disparar dois.
let themesPromise = null;

export function loadThemes() {
  if (!themesPromise) {
    themesPromise = fetch(THEMES_URL)
      .then((res) => res.json())
      .then((fetchedThemes) => ({ blank: BLANK_THEME, ...fetchedThemes }))
      .catch((err) => {
        // uma falha de rede não pode virar cache permanente de erro — zera
        // pra próxima tentativa poder buscar de novo.
        themesPromise = null;
        throw err;
      });
  }
  return themesPromise;
}

// aplica um tema no patternState (compartilhado — qualquer módulo que leia
// esses campos ao vivo, Mosaico e Espelho incluídos, vê a troca na hora).
// Não mexe em nada específico de UI de um módulo só (ex.: o modo de edição
// manual de blocos do Azulejo) — quem chama cuida disso depois, se precisar.
export function applyTheme(themeKey, themes) {
  const theme = themes[themeKey];
  if (!theme) return;
  const state = patternState;
  const preset = clonePreset(PRESETS[theme.preset]);
  state.themeKey = themeKey;
  state.background = preset.background;
  state.colors = preset.colors;
  state.shapesAllowed = theme.shapes;
  // só "Limpo" define resolution (quer sempre abrir na menor grade) — os
  // outros temas nunca mexeram nisso, então o fallback mantém a resolução
  // atual intocada pra eles.
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
  // como ponto de partida (a pessoa edita livremente depois, no editor de
  // degradê do Azulejo).
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
  // isso é o que causava o padrão "parar de seguir" o desenho/foto de
  // referência.
  if (state.useImageGuide) {
    state.symmetryBeforeImageGuide = state.symmetry;
    state.symmetry = 'none';
  }
}

// cores de prévia (bolinhas) de um tema ou de "Personalizado" — usado nos
// combos de tema (Azulejo e Espelho).
export function themePreviewColorsFor(key, themes) {
  if (key === 'custom') return [patternState.background, ...patternState.colors.map((c) => c.color)];
  const preset = PRESETS[themes[key]?.preset];
  return preset ? [preset.background, ...preset.colors.map((c) => c.color)] : [];
}
