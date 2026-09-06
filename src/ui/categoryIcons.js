// Ícones da barra de categorias do mobile (ver .gi-mobile-category-tabs em
// style.css e o builder em grid-icons/index.js) — estilo Lightroom mobile:
// cada categoria de ajuste é um ícone com nome embaixo, não só texto. Traço
// fino (currentColor), sem preenchimento, mesmo peso visual em todos pra
// não que nenhum "pese" mais que os outros na barra.
const STROKE = 'stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"';

function icon(inner) {
  return `<svg viewBox="0 0 24 24" width="20" height="20" ${STROKE}>${inner}</svg>`;
}

export const CATEGORY_ICONS = {
  // paleta: 3 gotas de cor + a "escolhida" maior — remete ao seletor de
  // tema (que já mostra bolinhas de cor).
  theme: icon(
    '<circle cx="8" cy="9" r="3"/><circle cx="16" cy="9" r="3"/><circle cx="12" cy="17" r="3.5"/>'
  ),
  // moldura com sol/montanha — ícone clássico de "imagem" usado como guia.
  reference: icon(
    '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="M4 16l5-5 4 4 3-3 4 4"/>'
  ),
  // grade 2x2 — a própria grade de células do gerador.
  grid: icon(
    '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/>'
  ),
  // faísca/estrela de 4 pontas — "detalhe" fino, subdivisão.
  detail: icon('<path d="M12 3l1.8 6.2L20 11l-6.2 1.8L12 19l-1.8-6.2L4 11l6.2-1.8z"/>'),
  // gota — preenchimento (balde de tinta simplificado).
  fill: icon('<path d="M12 3s6 6.2 6 10.5a6 6 0 0 1-12 0C6 9.2 12 3 12 3z"/>'),
  // retângulo com um traço tracejado no meio — degradê. Era um traço com
  // opacity:0.4 (deixava esse ícone com peso visual mais fraco que os
  // outros do conjunto, todos em traço cheio); tracejado passa a mesma
  // ideia de "transição gradual" sem depender de opacidade reduzida.
  gradient: icon('<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M12 6v12" stroke-dasharray="2.5 2.5"/>'),
  // trio de formas nativas do app — losango/círculo/triângulo.
  shapes: icon(
    '<rect x="3" y="13" width="7" height="7" rx="1"/><circle cx="17.5" cy="16.5" r="3.6"/><path d="M12 3l4.5 8h-9z"/>'
  ),
  // 3 swatches em fileira.
  colors: icon('<circle cx="6" cy="12" r="3.2"/><circle cx="12" cy="12" r="3.2"/><circle cx="18" cy="12" r="3.2"/>'),
  // 3 círculos sobrepostos (venn) — harmonia de cor.
  harmony: icon('<circle cx="9" cy="10" r="5"/><circle cx="15" cy="10" r="5"/><circle cx="12" cy="15" r="5"/>'),
  // olho — aparência/visual do resultado.
  appearance: icon(
    '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.6"/>'
  ),
  // marcador/estrela — presets salvos.
  presets: icon('<path d="M12 3l2.6 5.6 6 .7-4.4 4.1 1.2 6-5.4-3-5.4 3 1.2-6-4.4-4.1 6-.7z"/>'),
  // seta saindo de uma caixa — compartilhar.
  share: icon('<path d="M12 3v11"/><path d="M8 7l4-4 4 4"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>'),
  // retângulo com cantos marcados — formato/proporção de exportação.
  format: icon(
    '<path d="M4 8V5a1 1 0 0 1 1-1h3"/><path d="M20 8V5a1 1 0 0 0-1-1h-3"/><path d="M4 16v3a1 1 0 0 0 1 1h3"/><path d="M20 16v3a1 1 0 0 1-1 1h-3"/><rect x="8" y="8" width="8" height="8" rx="1"/>'
  ),
  // seta pra baixo entrando numa bandeja — exportar/baixar arquivo.
  export: icon('<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 19h16"/>'),
};
