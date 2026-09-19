// Desenho PURO da aba Gradiente — só matemática + chamadas de Canvas 2D num
// contexto que recebe de fora. Não toca em `document`/`window` de propósito:
// este módulo é importado tanto pelo engine.js (quando o desenho roda na
// main thread, fallback) quanto pelo render.worker.js (quando roda num Web
// Worker em cima de um OffscreenCanvas) — a MESMA função desenha nos dois
// caminhos, então não tem risco de o worker e o fallback divergirem
// visualmente com o tempo.
import { createRng } from '../../core/seed.js';
import { drawVideoShape, VIDEO_SHAPES } from '../video-tiles/shapes.js';

// mesmo catálogo de desenho em Canvas 2D do Espelho (ver video-tiles/shapes.js
// — porta do catálogo de formas do Azulejo) — reaproveitado ao pé da letra,
// já que a técnica de desenhar "1 forma por célula, do tamanho que a célula
// manda" é idêntica aqui, só que quem manda no tamanho/cor não é mais um
// pixel de vídeo, é o valor do campo de gradiente animado (ver warpedPattern).

export const GIF_MAX_DIM = 360;
export const GIF_FPS = 12;
export const GIF_MAX_SECONDS = 8;
export const OUTPUT_MAX_DIM = 900;

// teto de quadros pro RECÁLCULO do campo (não pro desenho em si) — o
// campo de ruído (fbm aninhado, 4 oitavas × 5 amostras por célula, ver
// warpedPattern) é caro o bastante pra, rodando a 60fps de verdade (o
// que requestAnimationFrame faria sem essa trava), pesar na aba inteira
// do navegador (mouse com atraso perceptível reportado com a aba
// Gradiente aberta) — um gradiente que flui devagar nem precisa de
// 60fps pra parecer suave; 24 já fica indistinguível a olho nu e corta
// ~60% do trabalho. Vale igual no worker: mesmo fora da main thread, cada
// quadro a menos é bateria a menos no celular.
export const RENDER_MIN_DT = 1 / 24;

// teto de amostras do campo de ruído por eixo (ver paint) — acima disso
// o campo é interpolado em vez de amostrado célula por célula. 52 cobre a
// resolução padrão (40) sem interpolar quase nada e segura o custo na
// resolução máxima (96).
const FIELD_MAX_SAMPLES = 52;

// passos da tabela de cores pré-calculada do gradiente (ver colorLut)
const COLOR_LUT_STEPS = 128;

// teto e piso do lado maior do canvas de saída — o "Tela cheia" pede um
// tamanho conforme a caixa real, mas sem deixar virar um canvas gigante
// (custo de rasterizar 9216 formas cresce com a área).
export function clampOutputDim(requested) {
  if (!requested) return OUTPUT_MAX_DIM;
  return Math.max(480, Math.min(1400, Math.round(requested)));
}

export function computeOutputSize(cols, rows, maxDim) {
  if (cols >= rows) {
    return { width: maxDim, height: Math.max(1, Math.round((maxDim * rows) / cols)) };
  }
  return { width: Math.max(1, Math.round((maxDim * cols) / rows)), height: maxDim };
}

// hexToRgb/interpolateGradient — MESMA implementação de video-tiles/engine.js
// (não importada de lá de propósito: são só ~15 linhas, e duplicar aqui evita
// qualquer risco de mexer num arquivo do Espelho que já está validado/no ar).
function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function interpolateGradient(t, colors) {
  if (!colors.length) return '#000000';
  if (colors.length === 1) return colors[0].color;
  const clamped = Math.min(1, Math.max(0, t));
  const scaled = clamped * (colors.length - 1);
  const i = Math.min(colors.length - 2, Math.floor(scaled));
  const frac = scaled - i;
  const [r1, g1, b1] = hexToRgb(colors[i].color);
  const [r2, g2, b2] = hexToRgb(colors[i + 1].color);
  const r = Math.round(r1 + (r2 - r1) * frac);
  const g = Math.round(g1 + (g2 - g1) * frac);
  const b = Math.round(b1 + (b2 - b1) * frac);
  return `rgb(${r}, ${g}, ${b})`;
}

// --- campo de gradiente animado (ruído de valor com "domain warp") --------
// Mesma ideia por trás de ferramentas tipo playgrnd.tools/aura (estilo
// "Nuvens"): 4 oitavas de ruído de valor (bilinear sobre uma grade de
// hashes, bem mais barato que Perlin/simplex de verdade) somadas em fbm(),
// e o resultado empena (warp) a amostragem de outro fbm — 2 vezes seguidas
// (ver warpedPattern mais abaixo) — é o "domain warping" clássico que
// transforma ruído genérico em manchas orgânicas que fluem (efeito "lava
// lamp"/nuvem/mármore), em vez de faixas regulares e previsíveis. `seed`
// participa do hash pra cada composição sortear um campo diferente (mesmo
// espírito de createRng).
//
// IMPORTANTE (ruído 3D, não 2D): o tempo entra como uma 3ª coordenada de
// verdade do ruído (z), não como um deslocamento somado a x/y. A 1ª versão
// disso só somava um vetor de "arrasto" (tempo × direção) direto em x/y —
// ou seja, empurrava a MESMA textura inteira pro mesmo lado, rígida, sempre
// pra "um lugar pré-determinado" (foi exatamente o que ficou estranho:
// "indo numa mesma direção sem mudar"). Com z de verdade, cada região do
// campo evolui/morfa por conta própria (uma mancha pode crescer enquanto
// outra encolhe ou vira outra coisa do lado), que é o que dá o efeito de
// líquido/nuvem respirando, em vez de uma foto deslizando por cima de outra.
function hash3(ix, iy, iz, seed) {
  let h =
    Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(iz, 1274126177) + Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return ((h >>> 0) % 65536) / 65536;
}

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

// interpolação trilinear (8 cantos de um cubo, em vez dos 4 de um quadrado).
function valueNoise3D(x, y, z, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const sx = smoothstep(x - x0);
  const sy = smoothstep(y - y0);
  const sz = smoothstep(z - z0);
  const n000 = hash3(x0, y0, z0, seed);
  const n100 = hash3(x0 + 1, y0, z0, seed);
  const n010 = hash3(x0, y0 + 1, z0, seed);
  const n110 = hash3(x0 + 1, y0 + 1, z0, seed);
  const n001 = hash3(x0, y0, z0 + 1, seed);
  const n101 = hash3(x0 + 1, y0, z0 + 1, seed);
  const n011 = hash3(x0, y0 + 1, z0 + 1, seed);
  const n111 = hash3(x0 + 1, y0 + 1, z0 + 1, seed);
  const a0 = n000 + (n100 - n000) * sx;
  const b0 = n010 + (n110 - n010) * sx;
  const c0 = a0 + (b0 - a0) * sy;
  const a1 = n001 + (n101 - n001) * sx;
  const b1 = n011 + (n111 - n011) * sx;
  const c1 = a1 + (b1 - a1) * sy;
  return c0 + (c1 - c0) * sz;
}

function fbm(x, y, z, seed) {
  let sum = 0;
  let total = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < 4; i++) {
    sum += amp * valueNoise3D(x * freq, y * freq, z * freq, seed + i * 131);
    total += amp;
    amp *= 0.5;
    freq *= 2.03; // não exatamente 2x — evita as oitavas caírem em pontos
    // "alinhados" da anterior, que dava um leve padrão repetitivo visível.
  }
  return sum / total; // ~0..1
}

// "domain warp" ANINHADO (2 níveis) — mesma técnica clássica usada em
// shaders de fumaça/mármore (Inigo Quilez, "warp"): em vez de só deslocar a
// amostragem do ruído principal por UM campo auxiliar (o que ainda saía
// parecido com faixas/degradê, principalmente num domínio pequeno como o
// nosso — poucos "períodos" de ruído cabendo na grade), aqui o próprio
// campo de deslocamento (qx/qy) é RE-deslocado por um segundo par de ruídos
// (rx/ry) antes de amostrar o resultado final — cada nível de empeno soma
// dobras/redemoinhos por cima do anterior, e é isso que dá o efeito de
// líquido/nuvem fluindo (bem mais perto da referência) em vez de uma faixa
// diagonal "computada" e previsível. Cada camada usa um z levemente
// deslocado (não o mesmo z cru) — sem isso as 2 camadas de empeno
// evoluiriam perfeitamente em sincronia, meio "robótico" de novo.
function warpedPattern(x, y, z, warpAmt, seed) {
  const qx = fbm(x, y, z, seed + 11);
  const qy = fbm(x + 5.2, y + 1.3, z + 3.7, seed + 53);
  const rx = fbm(x + warpAmt * qx + 1.7, y + warpAmt * qy + 9.2, z + 2.3, seed + 97);
  const ry = fbm(x + warpAmt * qx + 8.3, y + warpAmt * qy + 2.8, z - 1.9, seed + 149);
  return fbm(x + warpAmt * rx, y + warpAmt * ry, z, seed + 191);
}

const CORNERS = ['tl', 'tr', 'br', 'bl'];

// "pintor": guarda os caches que só valem entre quadros (grade de formas
// por célula, tabela de cores, buffer do campo) e expõe paint(). É um objeto
// (não uma função solta) justamente por causa desses caches — quem desenha
// (runtime.js) cria UM pintor e chama paint() a cada quadro.
export function createGradientPainter() {
  let cellAssignments = null;
  let cellAssignmentsKey = '';
  // buffer reaproveitado entre quadros da grade de amostras do campo (ver
  // FIELD_MAX_SAMPLES e o comentário em paint) — realocar um Float32Array
  // 24x por segundo só daria trabalho pro coletor de lixo.
  let field = null;
  // tabela de cores do gradiente pré-calculada (ver rebuildColorLutIfNeeded):
  // interpolateGradient montava uma STRING `rgb(...)` nova por célula — 9216
  // strings por quadro na resolução máxima, que o navegador ainda tinha que
  // reinterpretar a cada fillStyle. Medido: só as trocas de fillStyle custavam
  // ~3,6ms dos ~21ms do quadro. Com a tabela são 128 strings por quadro, e o
  // fillStyle passa a receber sempre a MESMA referência de string (cache de
  // parsing do navegador). 128 passos num gradiente é imperceptível a olho.
  let colorLut = null;
  let colorLutKey = '';

  function rebuildCellShapesIfNeeded(options) {
    const pool = options.shapesAllowed.length ? options.shapesAllowed : VIDEO_SHAPES;
    const key = `${options.cols}x${options.rows}|${pool.join(',')}`;
    if (cellAssignments && cellAssignmentsKey === key) return;
    const rng = createRng(options.seed);
    cellAssignmentsKey = key;
    cellAssignments = Array.from({ length: options.cols * options.rows }, () => ({
      shapeKey: pool[Math.floor(rng() * pool.length)],
      orientation: CORNERS[Math.floor(rng() * CORNERS.length)],
    }));
  }

  function rebuildColorLutIfNeeded(options) {
    const key = options.colors.map((c) => c.color).join(',');
    if (colorLut && colorLutKey === key) return;
    colorLutKey = key;
    colorLut = new Array(COLOR_LUT_STEPS);
    for (let i = 0; i < COLOR_LUT_STEPS; i++) {
      colorLut[i] = interpolateGradient(i / (COLOR_LUT_STEPS - 1), options.colors);
    }
  }

  // desenha UM quadro inteiro em `ctx` (outW×outH px) no instante `time`.
  // `options` é o snapshot de opções do motor (cols/rows já calculados).
  function paint(ctx, outW, outH, options, time) {
    const { cols, rows } = options;

    ctx.fillStyle = options.background;
    ctx.fillRect(0, 0, outW, outH);

    const cellSize = outW / cols;
    rebuildCellShapesIfNeeded(options);
    rebuildColorLutIfNeeded(options);

    // frequência espacial em unidades de CÉLULA (não normalizada por
    // cols/rows) — assim o tamanho físico das manchas fica igual não
    // importa o formato escolhido (mesma lógica de cellSize ser sempre
    // físico, não relativo, em todo o resto do app). scale=100% (padrão) dá
    // ~6 "períodos" de ruído cabendo na grade — domínio pequeno demais (era
    // o bug do visual "linear/faixa única" antes) faz o empeno quase não
    // variar de célula pra célula, então precisa de espaço o bastante pro
    // ruído auxiliar (qx/qy/rx/ry) também ter onde variar.
    const cellFreq = options.scale * 0.15;
    const angleRad = (options.direction * Math.PI) / 180;
    const dx = Math.cos(angleRad);
    const dy = Math.sin(angleRad);
    // piso de 0.5 — mesmo com Turbulência no mínimo (0%), ainda tem empeno
    // suficiente pra não cair de volta no visual "linear" que motivou essa
    // reescrita; 100% chega a ~2.3, bem retorcido/líquido.
    const warp = 0.5 + options.turbulence * 1.8;
    // z = tempo de verdade (ver comentário grandão em cima de hash3/fbm) —
    // é ISSO que faz o campo inteiro morfar/respirar (não só escorregar).
    // "Direção" ainda existe, mas só como um leve vento por cima (peso
    // reduzido, driftWeight) — sem ele dominar o efeito, senão volta a
    // parecer uma textura sendo arrastada rígida de novo.
    const z = time * 0.6;
    const driftWeight = 0.05;
    const driftX = dx * time * driftWeight;
    const driftY = dy * time * driftWeight;

    // O campo é amostrado numa grade PRÓPRIA, no máximo FIELD_MAX_SAMPLES por
    // eixo, e interpolado (bilinear) pras células — não uma amostra de
    // warpedPattern por célula. Na resolução máxima (96×96 = 9216 células)
    // era ~1,5 milhão de operações de hash por quadro: 20-35ms de main thread
    // travada por render, que é exatamente o que fazia o mouse arrastar com
    // essa aba aberta. Amostrando 53×53 e interpolando, cai ~3,3x. Dá no
    // mesmo visualmente porque o campo é SUAVE por construção (fbm) — entre
    // duas amostras vizinhas ele não tem detalhe nenhum pra perder.
    const fw = Math.min(cols, FIELD_MAX_SAMPLES);
    const fh = Math.min(rows, FIELD_MAX_SAMPLES);
    if (!field || field.length < (fw + 1) * (fh + 1)) field = new Float32Array((fw + 1) * (fh + 1));
    const colSpan = Math.max(1, cols - 1);
    const rowSpan = Math.max(1, rows - 1);
    for (let j = 0; j <= fh; j++) {
      for (let i = 0; i <= fw; i++) {
        const sampleCol = (i / fw) * colSpan;
        const sampleRow = (j / fh) * rowSpan;
        field[j * (fw + 1) + i] = warpedPattern(
          sampleCol * cellFreq + driftX,
          sampleRow * cellFreq + driftY,
          z,
          warp,
          options.seed
        );
      }
    }

    for (let r = 0; r < rows; r++) {
      // posição desta linha na grade de amostras + peso da interpolação
      const v = (r / rowSpan) * fh;
      const j0 = Math.min(fh - 1, Math.floor(v));
      const tv = v - j0;
      for (let c = 0; c < cols; c++) {
        const u = (c / colSpan) * fw;
        const i0 = Math.min(fw - 1, Math.floor(u));
        const tu = u - i0;
        const row0 = j0 * (fw + 1);
        const row1 = row0 + (fw + 1);
        const a = field[row0 + i0];
        const b = field[row0 + i0 + 1];
        const cc = field[row1 + i0];
        const dd = field[row1 + i0 + 1];
        const raw = (a + (b - a) * tu) + ((cc + (dd - cc) * tu) - (a + (b - a) * tu)) * tv;
        // realça o contraste (fbm de ruído de valor tende a ficar
        // concentrado perto de 0.5) — sem isso quase toda célula saía com
        // forma parecida, sem o "respiro" de vazio/cheio que dá o efeito
        // de dithering de verdade.
        const value = Math.min(1, Math.max(0, 0.5 + (raw - 0.5) * 1.9));

        const color = colorLut[(value * (COLOR_LUT_STEPS - 1)) | 0];
        const scale = value * options.shapeScale;

        const { shapeKey, orientation } = cellAssignments[r * cols + c];
        const cx = c * cellSize + cellSize / 2;
        const cy = r * cellSize + cellSize / 2;
        drawVideoShape(ctx, shapeKey, orientation, cx, cy, cellSize, scale, color);
      }
    }
  }

  return { paint };
}
