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
  // coração — "novo azulejo" (começar peça do zero, de novo).
  heart: icon(
    '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>'
  ),
  // 2 quadrados empilhados (um em cima do outro) — "criar variações" (mais
  // de uma opção, uma embaixo da outra).
  stacked: icon('<rect x="6" y="4" width="12" height="7" rx="1.5"/><rect x="6" y="13" width="12" height="7" rx="1.5"/>'),
};
