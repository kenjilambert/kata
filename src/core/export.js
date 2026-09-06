export function serializeSvgDocument(svgString) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${svgString}`;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// "moldura" de exportação (proporção W:H) — o preview em si é sempre
// quadrado, mas pra usar como wallpaper/post/story às vezes faz sentido
// exportar num formato retangular. null/1 = sem moldura, exporta o
// quadrado puro (comportamento de sempre).
export const EXPORT_FRAME_RATIOS = {
  square: 1,
  portrait: 4 / 5,
  story: 9 / 16,
  landscape: 16 / 9,
};

// export em tamanho fixo (não múltiplo do ICON_SIZE interno de 420px) —
// resolução baixa o suficiente pra sair pixelada quando colada em qualquer
// lugar que não seja a tela pequena do preview. 1500px cobre uso em pôster/
// impressão sem ficar gigante. O SVG usa essa mesma unidade de referência
// só pra calcular a moldura (é vetor — "1500" ali vira unidade de viewBox,
// não pixel fixo, então o arquivo continua escalando sem perder qualidade).
export const DEFAULT_PNG_TARGET_SIZE = 1500;

// as 4 opções de formato já são frações pequenas conhecidas (1:1, 4:5,
// 9:16, 16:9) — usar o próprio numerador/denominador como CONTAGEM de
// ladrilhos (4x5, 9x16, 16x9...) reproduz a proporção pedida com precisão
// exata (não uma aproximação por arredondamento) e garante ladrilhos
// sempre INTEIROS — nunca um pedaço cortado de ícone na borda da moldura.
// Antes a conta era feita em cima de um tamanho de referência (420px) que
// raramente dava um número inteiro de ladrilhos pra qualquer proporção que
// não fosse quadrada — sobrava sempre uma fatia cortada na borda.
const TILE_COUNTS_BY_RATIO = [
  { ratio: 1, tiles: [1, 1] },
  { ratio: 4 / 5, tiles: [4, 5] },
  { ratio: 9 / 16, tiles: [9, 16] },
  { ratio: 16 / 9, tiles: [16, 9] },
];

// exportada — o overlay do controle de blocos (grid-icons/index.js)
// também precisa saber quantos ladrilhos cabem em cada eixo pra saber o
// tamanho de UM ladrilho só (o que ele edita), não mais assumir "1 eixo
// sempre tem exatamente 1 ladrilho" (isso deixou de ser verdade — ver
// comentário acima de TILE_COUNTS_BY_RATIO).
export function tileCountsForRatio(ratio) {
  const known = TILE_COUNTS_BY_RATIO.find((entry) => Math.abs(entry.ratio - ratio) < 0.001);
  if (known) return known.tiles;
  // só cai aqui se o app ganhar uma proporção nova que não esteja na
  // lista acima — não é exato, mas ainda garante ladrilhos inteiros.
  return ratio >= 1 ? [Math.max(1, Math.round(ratio)), 1] : [1, Math.max(1, Math.round(1 / ratio))];
}

// mesma conta que frameSvgString faz por dentro pra decidir o tamanho do
// canvas — exposta separada pra UI conseguir mostrar "vai sair
// 1500×1875px" no seletor de formato sem duplicar (e sem dessincronizar)
// essa matemática.
export function frameCanvasSize(ratio, targetSize = DEFAULT_PNG_TARGET_SIZE) {
  if (!ratio || ratio === 1) return { width: targetSize, height: targetSize };
  const [tilesW, tilesH] = tileCountsForRatio(ratio);
  const exactRatio = tilesW / tilesH;
  if (exactRatio >= 1) return { width: Math.round(targetSize * exactRatio), height: targetSize };
  return { width: targetSize, height: Math.round(targetSize / exactRatio) };
}

// aplica a "moldura" de exportação — quando a proporção pedida não é
// quadrada, o espaço extra NUNCA fica vazio: em vez de centralizar o
// ícone com barras de cor de fundo do lado, ele se REPETE (como um
// azulejo de verdade) até preencher o retângulo inteiro, sempre em
// ladrilhos INTEIROS (ver tileCountsForRatio acima — nunca um ladrilho
// cortado na borda). Como o ícone é vetor, isso é só um <pattern> do SVG
// repetindo o ícone original — nenhuma rasterização, nenhuma distorção.
export function frameSvgString(svgString, ratio, background) {
  if (!ratio || ratio === 1) return svgString;
  const width = Number(svgString.match(/width="(\d+(\.\d+)?)"/)?.[1] || 800);
  const height = Number(svgString.match(/height="(\d+(\.\d+)?)"/)?.[1] || 800);
  const [tilesW, tilesH] = tileCountsForRatio(ratio);
  const canvasW = width * tilesW;
  const canvasH = height * tilesH;
  const patternId = `kata-frame-tile-${Math.random().toString(36).slice(2, 9)}`;
  const bgRect = background ? `<rect x="0" y="0" width="${canvasW}" height="${canvasH}" fill="${background}" />` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasW}" height="${canvasH}" viewBox="0 0 ${canvasW} ${canvasH}"><defs><pattern id="${patternId}" width="${width}" height="${height}" patternUnits="userSpaceOnUse">${svgString}</pattern></defs>${bgRect}<rect x="0" y="0" width="${canvasW}" height="${canvasH}" fill="url(#${patternId})" /></svg>`;
}

export function exportSvgString(svgString, filename = 'padrao.svg', { ratio = null, background = null } = {}) {
  const framed = frameSvgString(svgString, ratio, background);
  const blob = new Blob([serializeSvgDocument(framed)], { type: 'image/svg+xml' });
  downloadBlob(blob, filename);
}

export function exportPngFromSvgString(
  svgString,
  filename = 'padrao.png',
  { targetSize = DEFAULT_PNG_TARGET_SIZE, ratio = null, background = null } = {}
) {
  return new Promise((resolve, reject) => {
    const width = Number(svgString.match(/width="(\d+(\.\d+)?)"/)?.[1] || 800);
    const height = Number(svgString.match(/height="(\d+(\.\d+)?)"/)?.[1] || 800);
    // sem moldura (ou moldura igual à proporção da própria arte): rasteriza
    // o ícone original direto, sem passar pelo pattern. Com moldura,
    // frameSvgString já devolve o SVG inteiro (repetido, do tamanho certo)
    // pronto pra virar imagem — só desenhar ele preenchendo o canvas todo.
    const noFrame = !ratio || Math.abs(ratio - width / height) < 0.001;
    const canvasSize = noFrame
      ? { width: Math.round(width * (targetSize / Math.max(width, height))), height: Math.round(height * (targetSize / Math.max(width, height))) }
      : frameCanvasSize(ratio, targetSize);
    const finalSvg = noFrame ? svgString : frameSvgString(svgString, ratio, background);

    const blob = new Blob([finalSvg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = canvasSize.width;
      canvas.height = canvasSize.height;
      const ctx = canvas.getContext('2d');
      if (noFrame && background) {
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((pngBlob) => {
        if (!pngBlob) {
          reject(new Error('Falha ao gerar PNG'));
          return;
        }
        downloadBlob(pngBlob, filename);
        resolve();
      }, 'image/png');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Falha ao carregar SVG para rasterizar'));
    };
    img.src = url;
  });
}
