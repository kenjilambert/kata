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
const ALL_CORNERS = ['tl', 'tr', 'bl', 'br'];

// altura (em células) de cada barra entre uma chamada e a próxima — só
// anda 1 célula por vez (nunca pula de 1 pra 3 direto) — é isso que faz
// a variação parecer uma barra "reagindo" ao som de verdade (como o
// ataque/alívio suave do próprio motor de Som, ver ATTACK/RELEASE em
// sound-tiles/engine.js) em vez de 3 números aleatórios diferentes surgindo
// do nada a cada troca — coeficiente sobrevive entre chamadas (módulo, não
// closure) porque é chamado de nível de módulo (main.js), sem instância.
let soundLogoHeights = null;

// logo da aba Som — em vez do padrão aleatório de sempre (que não lembra
// nada de áudio), uma grade 3x3 fixa onde cada COLUNA é uma barrinha de
// espectrômetro (formas empilhadas de baixo pra cima, o resto da coluna em
// branco) — a mesma ideia visual do próprio módulo (ver sound-tiles/
// engine.js), só reduzida a um ícone de 3 barras "subindo e descendo".
export function renderSoundLogo() {
  const rng = createRng(randomSeed());
  const size = 3;
  if (!soundLogoHeights) soundLogoHeights = Array.from({ length: size }, () => 1 + Math.floor(rng() * size));
  soundLogoHeights = soundLogoHeights.map((h) => {
    const target = 1 + Math.floor(rng() * size);
    if (target === h) return h;
    return target > h ? h + 1 : h - 1;
  });
  const grid = Array.from({ length: size }, (_, r) =>
    Array.from({ length: size }, (_, c) => {
      const barHeight = soundLogoHeights[c];
      // linha 0 = topo da grade — uma coluna com barHeight=2 preenche as
      // 2 células de BAIXO (linhas size-1 e size-2), deixando o topo em
      // branco, igual a barra de um equalizador de verdade.
      const filledFromBottom = size - r <= barHeight;
      if (!filledFromBottom) return { shape: 'blank' };
      const shape = SOUND_LOGO_SHAPES[Math.floor(rng() * SOUND_LOGO_SHAPES.length)];
      const orientation = ALL_CORNERS[Math.floor(rng() * ALL_CORNERS.length)];
      return { shape, orientation, color: LOGO_COLORS[c % LOGO_COLORS.length].color };
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
