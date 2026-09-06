// Porta pra Canvas 2D do MESMO catálogo de formas do Azulejo
// (src/modules/grid-icons/shapes.js, que desenha em markup SVG) — é o que
// deixa o modo Vídeo parecer de verdade "o mesmo azulejo, só que animado",
// em vez de um conjunto à parte e mais pobre de formas. A lista de chaves
// (SHAPE_KEYS) vem direto de lá — se um dia entrar uma forma nova no
// Azulejo, o Vídeo ganha ela automaticamente, sem precisar editar aqui.
//
// Por que reimplementar o desenho em vez de reaproveitar direto: o Azulejo
// desenha gerando uma STRING de markup SVG por célula; o modo Vídeo redesenha
// a grade inteira a cada quadro de vídeo (até ~30x por segundo) — gerar e
// descartar uma string SVG nesse ritmo (multiplicado por até 96×96 células)
// seria caro demais. Aqui cada forma é só um punhado de chamadas ctx.fill()
// diretas, bem mais barato. Cada função assume que o contexto já foi
// transladado pro canto superior-esquerdo de uma caixa local `s`×`s` (ver
// drawCatalogShape, no fim do arquivo, que cuida da translação/escala) — as
// coordenadas usadas são as MESMAS (0..s) do arquivo original; só a técnica
// de desenho (ctx em vez de atributo SVG) muda. Sem contorno/degradê (o modo
// Vídeo só usa preenchimento sólido — tempo real não sobra pra isso).
import { SHAPE_KEYS } from '../grid-icons/shapes.js';

export const VIDEO_SHAPES = SHAPE_KEYS;

function square(ctx, s) {
  ctx.fillRect(0, 0, s, s);
}

function disc(ctx, s) {
  const c = s / 2;
  ctx.beginPath();
  ctx.arc(c, c, c, 0, Math.PI * 2);
  ctx.fill();
}

const TRIANGLE_POINTS = {
  tl: (s) => [[0, 0], [s, 0], [0, s]],
  tr: (s) => [[s, 0], [s, s], [0, 0]],
  br: (s) => [[s, s], [0, s], [s, 0]],
  bl: (s) => [[0, s], [0, 0], [s, s]],
};
function triangle(ctx, s, orientation = 'tl') {
  const [p0, p1, p2] = TRIANGLE_POINTS[orientation](s);
  ctx.beginPath();
  ctx.moveTo(p0[0], p0[1]);
  ctx.lineTo(p1[0], p1[1]);
  ctx.lineTo(p2[0], p2[1]);
  ctx.closePath();
  ctx.fill();
}

function diamond(ctx, s) {
  const p = s / 2;
  ctx.beginPath();
  ctx.moveTo(p, 0);
  ctx.lineTo(s, p);
  ctx.lineTo(p, s);
  ctx.lineTo(0, p);
  ctx.closePath();
  ctx.fill();
}

// "pizza" de 90° ancorada em cada canto — mesma matemática do CORNER_CENTER/
// CORNER_ENDPOINTS do arquivo original (ali usados só pro TRAÇO do arco),
// só que aqui vira o preenchimento inteiro: centro no canto, raio = lado da
// célula, varrendo 90° até o canto "adjacente" nos dois eixos. Ver
// quarterCircle()/quarterCircleInverse()/cornerNotch() abaixo, que reusam
// isso pras 3 formas ancoradas em canto do catálogo.
const CORNER_CENTER_FRAC = { tl: [0, 0], tr: [1, 0], br: [1, 1], bl: [0, 1] };
const CORNER_ANGLES = {
  tl: [0, Math.PI / 2],
  tr: [Math.PI / 2, Math.PI],
  br: [Math.PI, 1.5 * Math.PI],
  bl: [1.5 * Math.PI, 2 * Math.PI],
};

function quarterCircle(ctx, s, orientation = 'tl') {
  const [fx, fy] = CORNER_CENTER_FRAC[orientation];
  const cx = fx * s;
  const cy = fy * s;
  const [a0, a1] = CORNER_ANGLES[orientation];
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, s, a0, a1, false);
  ctx.closePath();
  ctx.fill();
}

// complemento do arco (quadrado cheio menos a mesma fatia de 90°) — mesmo
// truque de fill-rule evenodd do original, só que via 2 subcaminhos no
// mesmo path em vez do atributo fill-rule do SVG.
function quarterCircleInverse(ctx, s, orientation = 'tl') {
  const [fx, fy] = CORNER_CENTER_FRAC[orientation];
  const cx = fx * s;
  const cy = fy * s;
  const [a0, a1] = CORNER_ANGLES[orientation];
  ctx.beginPath();
  ctx.rect(0, 0, s, s);
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, s, a0, a1, false);
  ctx.closePath();
  ctx.fill('evenodd');
}

function cross(ctx, s) {
  // mesmo reforço de espessura do original: 0.22 (strokeWidth de referência)
  // + 0.1 fixo, senão a cruz sai fina demais.
  const thickness = s * 0.32;
  const offset = (s - thickness) / 2;
  ctx.fillRect(0, offset, s, thickness);
  ctx.fillRect(offset, 0, thickness, s);
}

// "Anel" no catálogo do Azulejo é uma moldura QUADRADA (quadrado cheio menos
// um quadrado menor concêntrico), não um anel circular — reproduzido aqui do
// mesmo jeito, não o círculo que seria mais "óbvio" pro nome.
function ring(ctx, s) {
  const t = s * 0.22;
  ctx.beginPath();
  ctx.rect(0, 0, s, s);
  ctx.rect(t, t, s - t * 2, s - t * 2);
  ctx.fill('evenodd');
}

function dot(ctx, s) {
  const c = s / 2;
  ctx.beginPath();
  ctx.arc(c, c, s * 0.22, 0, Math.PI * 2);
  ctx.fill();
}

function diagonalCross(ctx, s) {
  const c = s / 2;
  const thickness = s * 0.2;
  const barLength = s * Math.SQRT2 - thickness;
  ctx.save();
  ctx.translate(c, c);
  ctx.rotate(Math.PI / 4);
  ctx.fillRect(-barLength / 2, -thickness / 2, barLength, thickness);
  ctx.rotate(-Math.PI / 2); // -45° a partir dos +45° já aplicados = -45° no total
  ctx.fillRect(-barLength / 2, -thickness / 2, barLength, thickness);
  ctx.restore();
}

function bowtie(ctx, s) {
  const c = s / 2;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(s, 0);
  ctx.lineTo(c, c);
  ctx.closePath();
  ctx.moveTo(0, s);
  ctx.lineTo(s, s);
  ctx.lineTo(c, c);
  ctx.closePath();
  ctx.fill();
}

// aproximação do "vesica"/lente original (2 arcos raio 0.95×s centrados fora
// da célula): aqui os 2 arcos usam raio = s, centrados nos 2 cantos QUE NÃO
// ficam na diagonal usada (tr/bl) — cada um passa exatamente pelos outros 2
// cantos (tl/br), então o resultado é uma lente/olho quase idêntica (um
// pouquinho mais cheia que a original), sem precisar da álgebra genérica de
// "achar o centro de um arco SVG dados 2 pontos + raio + sweep flag".
function lens(ctx, s) {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(s, 0, s, Math.PI, Math.PI / 2, true);
  ctx.arc(0, s, s, 0, -Math.PI / 2, true);
  ctx.closePath();
  ctx.fill();
}

const CORNER_TRIANGLE_PTS = {
  tl: (s) => [[0, 0], [s * 0.5, 0], [0, s * 0.5]],
  tr: (s) => [[s, 0], [s, s * 0.5], [s * 0.5, 0]],
  br: (s) => [[s, s], [s * 0.5, s], [s, s * 0.5]],
  bl: (s) => [[0, s], [0, s * 0.5], [s * 0.5, s]],
};
function cornerNotch(ctx, s, orientation = 'tl') {
  const [p0, p1, p2] = CORNER_TRIANGLE_PTS[orientation](s);
  ctx.beginPath();
  ctx.rect(0, 0, s, s);
  ctx.moveTo(p0[0], p0[1]);
  ctx.lineTo(p1[0], p1[1]);
  ctx.lineTo(p2[0], p2[1]);
  ctx.closePath();
  ctx.fill('evenodd');
}

// estrela de 4 pontas com cintura côncava — bezier cúbica idêntica à do
// original (os 2 pontos de controle de cada trecho são sempre o mesmo
// ponto no SVG original, portado igual aqui).
function sparkle(ctx, s) {
  const c = s / 2;
  const k = s * 0.11;
  ctx.beginPath();
  ctx.moveTo(c, 0);
  ctx.bezierCurveTo(c + k, c - k, c + k, c - k, s, c);
  ctx.bezierCurveTo(c + k, c + k, c + k, c + k, c, s);
  ctx.bezierCurveTo(c - k, c + k, c - k, c + k, 0, c);
  ctx.bezierCurveTo(c - k, c - k, c - k, c - k, c, 0);
  ctx.closePath();
  ctx.fill();
}

function prism(ctx, s) {
  const c = s / 2;
  ctx.beginPath();
  ctx.rect(0, 0, s, s);
  ctx.moveTo(c, 0);
  ctx.lineTo(s, c);
  ctx.lineTo(c, s);
  ctx.lineTo(0, c);
  ctx.closePath();
  ctx.fill('evenodd');
}

function burst(ctx, s) {
  const c = s / 2;
  const outerR = s * 0.5;
  const innerR = s * 0.34;
  const points = 8;
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = (Math.PI / points) * i - Math.PI / 2;
    const x = c + r * Math.cos(angle);
    const y = c + r * Math.sin(angle);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

// mesmos pontos digitalizados do original (viewBox 86×86), só escalados.
const ASTERISK_VIEWBOX = 86;
const ASTERISK_POINTS = [
  [12.5, 9.72827], [35, 38.7283], [0.5, 34.7283], [0.5, 52.2283], [35, 46.7283],
  [12.5, 76.2283], [27.5, 84.7283], [41.5, 51.2283], [57.5, 84.7283], [72, 76.2283],
  [48, 46.7283], [85, 52.2283], [85, 34.7283], [48, 38.7283], [72, 9.72827],
  [57.5, 0.728271], [42.5, 34.7283], [27.5, 0.728271],
];
function asterisk(ctx, s) {
  const k = s / ASTERISK_VIEWBOX;
  ctx.beginPath();
  ASTERISK_POINTS.forEach(([x, y], i) => {
    if (i === 0) ctx.moveTo(x * k, y * k);
    else ctx.lineTo(x * k, y * k);
  });
  ctx.closePath();
  ctx.fill();
}

function hourglass(ctx, s) {
  const c = s / 2;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(s, 0);
  ctx.arc(c, 0, c, 0, Math.PI, false);
  ctx.closePath();
  ctx.moveTo(s, s);
  ctx.lineTo(0, s);
  ctx.arc(c, s, c, Math.PI, Math.PI * 2, false);
  ctx.closePath();
  ctx.fill();
}

function twinPeaks(ctx, s) {
  const c = s / 2;
  ctx.beginPath();
  ctx.moveTo(0, s);
  ctx.lineTo(c / 2, 0);
  ctx.lineTo(c, s);
  ctx.closePath();
  ctx.moveTo(c, s);
  ctx.lineTo(c + c / 2, 0);
  ctx.lineTo(s, s);
  ctx.closePath();
  ctx.fill();
}

// "Círculo" no catálogo é um quadrado cheio com um furo circular no meio
// (diferente de "Disco", que é o círculo cheio) — mesma troca de nomes do
// original preservada aqui.
function circleHole(ctx, s) {
  const c = s / 2;
  ctx.beginPath();
  ctx.rect(0, 0, s, s);
  ctx.moveTo(s, c);
  ctx.arc(c, c, c, 0, Math.PI * 2, false);
  ctx.closePath();
  ctx.fill('evenodd');
}

const SHAPE_DRAWERS = {
  square,
  disc,
  triangle,
  diamond,
  cornerNotch,
  quarterCircle,
  quarterCircleInverse,
  circle: circleHole,
  prism,
  ring,
  asterisk,
  burst,
  sparkle,
  dot,
  cross,
  diagonalCross,
  bowtie,
  lens,
  hourglass,
  twinPeaks,
};

// desenha UMA célula do catálogo, centrada em (cx, cy) — `cellSize` é o lado
// da célula no canvas de saída, `scale` (0-1, dirigido pela luminância
// amostrada do vídeo quadro a quadro) encolhe a caixa de desenho pra dentro
// dela SEM distorcer a forma (mesma técnica de "meio-tom": célula escura =
// forma grande, célula clara = forma pequena/nenhuma). Encolher a CAIXA (em
// vez de só o traço) funciona igual pra formas cheias e formas com buraco
// (anel, círculo, prisma...) — as duas escalam por igual.
export function drawVideoShape(ctx, shapeKey, orientation, cx, cy, cellSize, scale, color) {
  const clamped = Math.min(1, Math.max(0, scale));
  if (clamped <= 0.02) return;
  const s = cellSize * clamped;
  const draw = SHAPE_DRAWERS[shapeKey] || SHAPE_DRAWERS.disc;
  ctx.fillStyle = color;
  ctx.save();
  ctx.translate(cx - s / 2, cy - s / 2);
  draw(ctx, s, orientation);
  ctx.restore();
}
