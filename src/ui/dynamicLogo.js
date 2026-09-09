// Logo do Kata — em vez de uma imagem fixa, é o próprio gerador do Azulejo
// rodando uma vez: grade 2x2 (ou 3x3 no Mosaico, ver main.js), tema
// Terracota, fundo transparente, seed aleatória a cada carregamento (como
// se a pessoa tivesse acabado de clicar em "Novo azulejo" assim que abre o
// site). Cada visita mostra uma composição diferente, sempre dentro da
// mesma "família" visual.
import { generateIcon, renderGridToSvg } from '../modules/grid-icons/generator.js';
import { randomSeed, createRng } from '../core/seed.js';

const LOGO_ICON_SIZE = 40;

// só as 3 cores oficiais do site (--accent, --accent-2, --text) — nunca a
// paleta de verdade do preset Terracota (que tem mais tons, tipo marrom e
// verde oliva, que não fazem parte da identidade visual do site).
const LOGO_COLORS = [
  { color: '#ea4530', weight: 2 },
  { color: '#3aa1d8', weight: 2 },
  { color: '#f1eec0', weight: 1 },
];

// grade (2x2 ou 3x3) — mesmo tamanho em pixels no site sempre (LOGO_ICON_
// SIZE não muda), só a densidade da grade; usado pra diferenciar visualmente
// qual módulo está ativo (Azulejo = 2x2, Mosaico = 3x3, ver main.js).
export function renderDynamicLogo(size = 2) {
  return generateIcon({
    seed: randomSeed(),
    size,
    iconSize: LOGO_ICON_SIZE,
    symmetry: 'mirror-full',
    // o tema Terracota usa 0.85 de densidade — numa grade 2x2 (só 4
    // células) isso às vezes sorteava uma célula vazia e o logo saía "sem
    // nada". Forçado em 1 aqui: o logo nunca pode aparecer em branco.
    fillDensity: 1,
    // 0 aqui (o tema usa 0.2) — subdivisão quebra uma célula em formas
    // menores dentro dela, o que num logo de 40px só deixa tudo poluído/
    // grande demais pro tamanho, mesmo na versão 3x3 (mais células já
    // bastam pra diferenciar, não precisa de subdivisão em cima).
    subdivisionChance: 0,
    detailGradient: 'center',
    shapesAllowed: ['diamond', 'square', 'triangle', 'quarterCircleInverse', 'disc'],
    colors: LOGO_COLORS,
    fillEnabled: true,
    strokeEnabled: false,
    appearance: { transparentBackground: true },
  });
}

// formas que ainda dão pra reconhecer numa célula de ~13px (ícone de 40px
// ÷ grade 3x3) — nada com detalhe fino (anel, asterisco...) que vira uma
// mancha nesse tamanho; 'quarterCircleInverse' é orientável (canto),
// escolhido junto do resto pra dar uma variação de silhueta, não só cor.
const SOUND_LOGO_SHAPES = ['square', 'disc', 'diamond', 'quarterCircleInverse'];

// cor fixa por LINHA (não por altura/valor calculado, não por coluna) —
// de cima pra baixo: creme, azul, vermelho. Sempre as 3 cores JÁ usadas no
// site (LOGO_COLORS), nunca uma mistura/intermediária.
const SOUND_LOGO_ROW_COLORS = ['#f1eec0', '#3aa1d8', '#ea4530'];

// fase da onda — anda um passo pequeno por chamada (ver PHASE_STEP), nunca
// reseta: é o que faz a onda continuar deslizando pra direita indefinidamente
// em vez de reiniciar/pular toda hora. Módulo (não closure) pelo mesmo
// motivo do comentário antigo aqui: chamado do nível de módulo (main.js).
let soundLogoPhase = 0;

// passo da fase por chamada — pequeno o bastante (com o intervalo de
// main.js) pra parecer uma onda deslizando suave, não um "pulo" de estado
// aleatório em estado a cada troca (era esse o defeito da versão anterior,
// com alturas independentes sorteadas por coluna).
const PHASE_STEP = 0.35;

// logo da aba Som — em vez do padrão aleatório de sempre (que não lembra
// nada de áudio), uma grade 3x3 fixa onde cada COLUNA é uma barrinha de
// espectrômetro (formas empilhadas de baixo pra cima, o resto da coluna em
// branco). A altura de cada coluna segue uma senoide deslocada pelo ÍNDICE
// da coluna — uma onda de verdade viajando da esquerda pra direita (fase
// da coluna 0 sempre um passo à frente da 1, que fica um passo à frente da
// 2), não 3 barras subindo/descendo cada uma por conta própria (isso é que
// parecia caótico). A forma de cada coluna é fixa (1 por coluna, não
// sorteada célula a célula) — dá a variedade de silhueta pedida sem virar
// ruído visual a cada quadro.
export function renderSoundLogo() {
  const size = 3;
  soundLogoPhase += PHASE_STEP;
  const heights = Array.from({ length: size }, (_, c) => {
    // seno vai de -1 a 1; mapeado pra 1..size (nunca uma barra totalmente
    // vazia, mesma regra de antes). Defasagem de ~1.4 rad por coluna é o
    // que separa visualmente uma onda "viajando" de todas as barras
    // subindo/descendo juntas em uníssono.
    const wave = Math.sin(soundLogoPhase - c * 1.4);
    return 1 + Math.round(((wave + 1) / 2) * (size - 1));
  });
  const columnShapes = [SOUND_LOGO_SHAPES[0], SOUND_LOGO_SHAPES[1], SOUND_LOGO_SHAPES[2]];
  const grid = Array.from({ length: size }, (_, r) =>
    Array.from({ length: size }, (_, c) => {
      const barHeight = heights[c];
      // linha 0 = topo da grade — uma coluna com barHeight=2 preenche as
      // 2 células de BAIXO (linhas size-1 e size-2), deixando o topo em
      // branco, igual a barra de um equalizador de verdade.
      const filledFromBottom = size - r <= barHeight;
      if (!filledFromBottom) return { shape: 'blank' };
      // r é a LINHA (0 = topo da grade) — SOUND_LOGO_ROW_COLORS[r] já é
      // exatamente creme/azul/vermelho nessa ordem.
      return { shape: columnShapes[c], orientation: 'br', color: SOUND_LOGO_ROW_COLORS[r] };
    })
  );
  return renderGridToSvg({
    grid,
    size,
    iconSize: LOGO_ICON_SIZE,
    fillEnabled: true,
    strokeEnabled: false,
    appearance: { transparentBackground: true },
  });
}
