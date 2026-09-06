// Logo do Kata — em vez de uma imagem fixa, é o próprio gerador do Azulejo
// rodando uma vez: grade 2x2 (ou 3x3 no Mosaico, ver main.js), tema
// Terracota, fundo transparente, seed aleatória a cada carregamento (como
// se a pessoa tivesse acabado de clicar em "Novo azulejo" assim que abre o
// site). Cada visita mostra uma composição diferente, sempre dentro da
// mesma "família" visual.
import { generateIcon } from '../modules/grid-icons/generator.js';
import { randomSeed } from '../core/seed.js';

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
