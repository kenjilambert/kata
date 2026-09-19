// Desenho PURO do modo Som — só matemática + chamadas de Canvas 2D num
// contexto que recebe de fora. Não toca em `document`/`window` de propósito:
// é importado tanto pelo engine.js (fallback na main thread) quanto pelo
// render.worker.js (Web Worker + OffscreenCanvas) — a MESMA função desenha
// nos dois caminhos.
//
// MESMA lógica de desenho do Espelho (video-tiles) — forma fixa por célula,
// tamanho/cor reagindo a um valor 0-1 por célula — só que a fonte do valor
// por célula não é luminância de um quadro de vídeo — é a MAGNITUDE de uma
// faixa de frequência do áudio (Web Audio API AnalyserNode), que chega aqui
// já amostrada e suavizada (`levels`, ver engine.js).
//
// NÃO é um espectrograma rolando o histórico (1ª versão, corrigida) — é um
// espectrômetro PARADO, tipo equalizador de rádio/hi-fi: cada banda de
// frequência tem uma posição FIXA na grade (uma "barra"), e só a ALTURA
// dessa barra reage ao som agora, subindo/descendo no lugar — igual a
// qualquer visualizador de áudio clássico.
import { createRng } from '../../core/seed.js';
import { nearestPaletteColor } from '../../core/imageSampling.js';
import { drawVideoShape, VIDEO_SHAPES } from '../video-tiles/shapes.js';

export const GIF_MAX_DIM = 360;
export const GIF_FPS = 12;
export const GIF_MAX_SECONDS = 8;
export const OUTPUT_MAX_DIM = 900;

// teto de quadros/s do próprio DESENHO (não da análise de áudio, que
// acompanha o hardware) — rAF livre roda a 60fps sem necessidade nenhuma
// pra esse efeito (o ouvido/olho não percebe diferença acima disso), e
// cada quadro a menos é uma grade cols×rows inteira a menos pra redesenhar.
export const RENDER_MIN_DT = 1000 / 30;

// teto/piso do lado maior do canvas de saída no formato "Tela cheia" (ver
// gradient-tiles/draw.js, mesma função) — a caixa medida na tela pode ser
// bem maior ou menor que OUTPUT_MAX_DIM, mas sem deixar o canvas virar
// gigante (custo de redesenhar cresce com a área) nem minúsculo demais.
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

function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// idêntica à do Espelho (video-tiles) — duplicada de propósito, não
// importada: cada motor é autocontido (mesma convenção já usada entre
// Espelho/Gradiente), evita um acoplamento cruzado só por causa de uma
// função pequena.
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

const CORNERS = ['tl', 'tr', 'br', 'bl'];

// idêntico em espírito ao remapSampleCoord do Espelho (video-tiles/draw.js)
// — só mirror-h/mirror-full aqui (sem 'rotational': um eixo é frequência e
// o outro é altura da barra, então girar 90° trocaria banda por altura, o
// que não faz sentido nenhum pro efeito). "mirror-h" aqui é o clássico
// visualizador simétrico (grave no centro, agudo pras 2 pontas, ou o
// inverso) — espelha de onde vem a ALTURA da barra, não a forma/orientação
// da célula (essas continuam fixas, ver rebuildCellShapesIfNeeded).
function remapGridCoord(r, c, cols, rows, symmetry) {
  if (symmetry === 'none') return [r, c];
  const hc = Math.floor(cols / 2);
  const hr = Math.floor(rows / 2);
  if (symmetry === 'mirror-h') return [r, c < hc ? c : cols - 1 - c];
  if (symmetry === 'mirror-full') return [r < hr ? r : rows - 1 - r, c < hc ? c : cols - 1 - c];
  return [r, c];
}

// número de barras (bandas) e de células por barra, conforme o eixo — o
// engine usa o mesmo pra dimensionar `levels`.
export function bandCount(options) {
  return options.barsAxis === 'vertical' ? options.cols : options.rows;
}
export function heightCount(options) {
  return options.barsAxis === 'vertical' ? options.rows : options.cols;
}

// "pintor": guarda o cache de formas por célula e expõe paint(). É um
// objeto (não uma função solta) por causa desse cache — quem desenha
// (runtime.js) cria UM pintor e chama paint() a cada quadro.
export function createSoundPainter() {
  let cellAssignments = null;
  let cellAssignmentsKey = '';

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

  // desenha UM quadro inteiro em `ctx` (outW×outH px). `levels` = nível
  // ATUAL (0-1, já suavizado) de cada barra, na ordem das bandas.
  function paint(ctx, outW, outH, options, levels) {
    const { cols, rows } = options;

    // rastro/eco: em vez de apagar o quadro anterior por completo, cobre
    // com o fundo em opacidade parcial — o que sobrar "por baixo" só desbota
    // aos poucos. trail=0 mantém a limpeza total de sempre.
    ctx.globalAlpha = 1 - Math.min(0.95, Math.max(0, options.trail));
    ctx.fillStyle = options.background;
    ctx.fillRect(0, 0, outW, outH);
    ctx.globalAlpha = 1;

    const cellSize = outW / cols;
    const hCount = heightCount(options);
    rebuildCellShapesIfNeeded(options);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        // mapeia (linha,coluna) da grade pra (banda,altura-dentro-da-barra),
        // conforme o eixo escolhido — depois de aplicar a simetria (espelha
        // de ONDE lê a barra, não a célula em si).
        const [sr, sc] = remapGridCoord(r, c, cols, rows, options.symmetry);
        const band = options.barsAxis === 'vertical' ? sc : sr;
        // posição dentro da barra, 0 = base (rodapé/esquerda) subindo —
        // 'vertical': a LINHA 0 é o topo da grade, mas a barra cresce do
        // RODAPÉ, então inverte (rows-1-linha); 'horizontal': a barra
        // cresce da ESQUERDA, então a própria coluna já é a posição.
        const heightIndex = options.barsAxis === 'vertical' ? rows - 1 - sr : sc;
        const level = levels[band] || 0; // 0-1, já suavizado

        // célula "acesa" (dentro da altura ATUAL da barra) ou não. A cor
        // segue um gradiente da base (1) até a ponta da barra, normalizado
        // pela altura ATUAL da barra (barHeight), não pela altura máxima da
        // grade (hCount). Essa era a "sensibilidade zuada": uma barra curta
        // (som baixo) media a posição contra o teto INTEIRO da grade, então
        // toda célula acesa caía sempre pertinho de 1 — só uma barra quase
        // no talo alcançava esticar até o fim do gradiente. Agora TODA
        // barra, curta ou alta, percorre o gradiente inteiro na sua própria
        // altura — o quanto disso realmente aparece (`colorResponse`) é o
        // slider "Resposta das cores".
        const barHeight = Math.max(1, Math.round(level * hCount));
        const filled = heightIndex < barHeight;
        const value = filled ? Math.max(0, 1 - (heightIndex / barHeight) * options.colorResponse) : 0;

        const base = options.invert ? 1 - value : value;
        const scale = options.colorMode === 'gradient' ? options.shapeScale : base * options.shapeScale;

        let color;
        if (options.colorMode === 'gradient') {
          color = interpolateGradient(base, options.gradientColors);
        } else if (options.colorMode === 'palette' && options.paletteColors.length) {
          color = nearestPaletteColor({ r: Math.round(value * 255), g: Math.round(value * 255), b: Math.round(value * 255) }, options.paletteColors);
        } else if (options.colorMode === 'custom' && options.customPaletteColors.length) {
          color = nearestPaletteColor({ r: Math.round(value * 255), g: Math.round(value * 255), b: Math.round(value * 255) }, options.customPaletteColors);
        } else {
          color = options.inkColor;
        }

        const { shapeKey, orientation } = cellAssignments[r * cols + c];
        const cx = c * cellSize + cellSize / 2;
        const cy = r * cellSize + cellSize / 2;
        drawVideoShape(ctx, shapeKey, orientation, cx, cy, cellSize, scale, color);
      }
    }
  }

  return { paint };
}

// paleta do GIF: nos modos "cor única"/"paleta" o motor já desenha com um
// conjunto bem pequeno e conhecido de cores — usar essas cores DIRETO como
// paleta do GIF (em vez de escanear pixel por pixel) é exato e instantâneo.
// Só o modo "gradiente" (faixa contínua) precisa escanear os quadros —
// quem chama passa `scanFrames` (ver scanFramesPalette em gifEncoder.js).
export function buildSoundGifPalette(options, frames, scanFrames) {
  if (options.colorMode === 'gradient') return scanFrames(frames, options.background);
  if (options.colorMode === 'palette' && options.paletteColors.length) {
    return [options.background, ...options.paletteColors.map((c) => c.color)];
  }
  if (options.colorMode === 'custom' && options.customPaletteColors.length) {
    return [options.background, ...options.customPaletteColors.map((c) => c.color)];
  }
  return [options.background, options.inkColor];
}
