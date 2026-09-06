// Ícones da trilha de ações do preview no mobile (Novo azulejo / Criar
// variações / Estou com sorte — ver .gi-stage-toolbar-rail em style.css e
// o builder em grid-icons/index.js). Mesmo estilo de traço fino que
// ui/categoryIcons.js, pra parecer a mesma família visual.
const STROKE = 'stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"';

function icon(inner) {
  return `<svg viewBox="0 0 24 24" width="20" height="20" ${STROKE}>${inner}</svg>`;
}

export const TOOLBAR_ICONS = {
  // seta circular — "gerar de novo" (regenerar o azulejo com outra seed).
  regenerate: icon(
    '<path d="M20 11a8 8 0 0 0-14.93-4"/><path d="M4 4v5h5"/><path d="M4 13a8 8 0 0 0 14.93 4"/><path d="M20 20v-5h-5"/>'
  ),
  // quadrados sobrepostos — várias cópias/opções (as variações).
  variations: icon('<rect x="7" y="7" width="12" height="12" rx="1.5"/><path d="M5 15V6a1 1 0 0 1 1-1h9"/>'),
  // estrela de 5 pontas — "sorte".
  lucky: icon('<path d="M12 3l2.2 5.6 6 .5-4.5 4 1.3 5.9L12 15.9 6.9 19l1.3-5.9-4.5-4 6-.5z"/>'),
  // seta pra cima saindo de uma bandeja — "exportar" (ícone clássico de
  // share/export, ex.: iOS). 4º ícone da trilha do preview, só no mobile.
  export: icon(
    '<path d="M12 16V4"/><path d="M7 9l5-5 5 5"/><path d="M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"/>'
  ),
};
