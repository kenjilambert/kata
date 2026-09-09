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

// logo da aba Som — em vez do padrão aleatório de sempre (que não lembra
// nada de áudio), uma grade 3x3 fixa onde cada COLUNA é uma barrinha de
// espectrômetro (quadrados empilhados de baixo pra cima, o resto da
// coluna em branco) — a mesma ideia visual do próprio módulo (ver
// sound-tiles/engine.js), só reduzida a um ícone de 3 barras "subindo e
// descendo". Altura de cada barra sorteada a cada chamada (mesmo espírito
// de variar a cada troca de aba que o resto do logo já tem), sempre pelo
// menos 1 célula cheia — uma barra zerada pareceria célula vazia/quebrada.
export function renderSoundLogo() {
  const rng = createRng(randomSeed());
  const size = 3;
  const heights = Array.from({ length: size }, () => 1 + Math.floor(rng() * size));
  const grid = Array.from({ length: size }, (_, r) =>
    Array.from({ length: size }, (_, c) => {
      const barHeight = heights[c];
      // linha 0 = topo da grade — uma coluna com barHeight=2 preenche as
      // 2 células de BAIXO (linhas size-1 e size-2), deixando o topo em
      // branco, igual a barra de um equalizador de verdade.
      const filledFromBottom = size - r <= barHeight;
      if (!filledFromBottom) return { shape: 'blank' };
      return { shape: 'square', color: LOGO_COLORS[c % LOGO_COLORS.length].color };
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
