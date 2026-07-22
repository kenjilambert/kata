import { randomSeed } from './seed.js';

// Estado "receita de ícone" compartilhado entre módulos (hoje: Azulejo e
// Mosaico). É um singleton de módulo ES (avaliado uma única vez, não importa
// quantos arquivos importem isso) — por isso sobrevive a mount()/unmount()
// de qualquer módulo, e qualquer módulo que leia estes campos sempre vê o
// valor mais recente, sem precisar de um botão de "importar" ou cópia.
//
// themeKey começa null de propósito: o tema padrão só é aplicado uma vez, na
// primeira montagem do Azulejo (quando os temas terminam de carregar) — ver
// isPatternStateInitialized()/markPatternStateInitialized() abaixo. Sem essa
// trava, remontar o Azulejo (ex.: voltar da aba Mosaico) reaplicaria o tema
// padrão por cima de qualquer customização já feita.
export const patternState = {
  themeKey: null,
  seed: randomSeed(),
  resolution: 6,
  fillDensity: 0.7,
  subdivisionChance: 0.15,
  detailGradient: 'uniform',
  // fill e stroke são independentes (tipo Illustrator/Figma): dá pra ter só
  // fill, só stroke, ou os dois juntos — nunca os dois desligados ao mesmo
  // tempo (a UI força religar um deles antes de deixar desligar o outro).
  fillEnabled: true,
  strokeEnabled: false,
  strokeColor: '#000000',
  strokeWidth: 0.24,
  // espessura do CONTORNO decorativo (traço do fill+stroke), em px absolutos
  // (não proporcional à célula, ao contrário de strokeWidth acima, que também
  // é usado como espessura GEOMÉTRICA de formas como cruz/anel/xis) — assim
  // o traço parece do mesmo tamanho em qualquer resolução de grade.
  strokeOutlineWidth: 2,
  // degradê interno: UMA receita só (lista de stops posição+cor, tipo editor
  // de degradê do Photoshop), a MESMA aplicada em toda forma preenchida —
  // não confundir com densityGradient/gradientDirection abaixo, que varia
  // QUANTIDADE de forma pela grade, não a cor de dentro de cada uma.
  gradientFillEnabled: false,
  gradientFillAngle: 45,
  gradientStops: [
    { position: 0, color: '#c1502e' },
    { position: 1, color: '#e0a458' },
  ],
  // grão granulado por cima do degradê interno (filtro SVG feTurbulence,
  // multiply blend, cor livre — preto por padrão)
  grainEnabled: false,
  grainIntensity: 0.6,
  grainSize: 0.5,
  grainColor: '#000000',
  rotation: 0,
  symmetry: 'rotational',
  symmetryBeforeImageGuide: 'rotational',
  background: '',
  colors: [],
  shapesAllowed: [],
  customShapes: [],
  customShapeCounter: 0,
  harmonyBaseColor: '#f2601c',
  harmonyCount: 4,
  densityGradient: 'none',
  gradientDirection: 'left-to-right',
  gradientStrength: 0.9,
  transparentBg: false,
  blackIcon: false,
  invertColors: false,
  // imagem usada para guiar a estrutura (forma/preenchimento) do ícone
  structureImageUrl: null,
  structureImageEl: null,
  structureImageBlob: null,
  useImageGuide: false,
  // imagem usada só para extrair paleta de cor (pode ser a mesma da estrutura)
  colorImageUrl: null,
  colorImageEl: null,
  useSameImageForColor: true,
  // edição manual: arrastar um bloco pra outro lugar da grade, girando com
  // a rodinha do mouse — congela a grade atual pra poder mexer nela direto.
  gridEditEnabled: false,
  gridOverride: null,
};

// galeria de histórico ("regenerar"/trocar tema/variação/aplicar imagem) —
// também um singleton de módulo, pelo mesmo motivo do objeto acima.
export const patternHistory = [];

let initialized = false;

export function isPatternStateInitialized() {
  return initialized;
}

export function markPatternStateInitialized() {
  initialized = true;
}

// pub/sub simples (mesmo padrão de onLangChange em core/i18n.js) — não é
// usado ainda pra reatividade automática (só um módulo fica montado por vez),
// mas deixa a porta aberta pra isso sem precisar mudar a forma do estado.
const listeners = new Set();

export function onPatternChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function notifyPatternChange() {
  listeners.forEach((cb) => cb());
}
