// scroll da roda do mouse com inércia suave (some do "pulo seco" padrão do
// navegador) — em vez de aplicar o delta da rodinha direto no scrollTop,
// acumula num alvo e anima até lá com um pouco de atraso/suavização a cada
// frame. Sem lib nenhuma (o projeto não usa build step/dependências) —
// só requestAnimationFrame com uma interpolação simples (lerp).
export function enableSmoothScroll(el, { multiplier = 0.7, ease = 0.18 } = {}) {
  if (!el) return;
  let targetY = el.scrollTop;
  let raf = null;

  function step() {
    const current = el.scrollTop;
    const diff = targetY - current;
    if (Math.abs(diff) < 0.5) {
      el.scrollTop = targetY;
      raf = null;
      return;
    }
    el.scrollTop = current + diff * ease;
    raf = requestAnimationFrame(step);
  }

  el.addEventListener(
    'wheel',
    (e) => {
      // só assume o controle se o conteúdo realmente rola mais do que
      // cabe — senão o preventDefault travava a página inteira sempre
      // que o mouse passasse por cima de um painel já totalmente visível
      // (ex.: sidebar curta numa tela alta).
      const maxScroll = el.scrollHeight - el.clientHeight;
      if (maxScroll <= 0) return;
      e.preventDefault();
      targetY = Math.min(Math.max(targetY + e.deltaY * multiplier, 0), maxScroll);
      if (!raf) raf = requestAnimationFrame(step);
    },
    { passive: false }
  );

  // outra coisa (scrollTo programático, arrastar a barra) pode mudar o
  // scrollTop sem passar pela roda — realinha o alvo pra não "puxar de
  // volta" pro valor antigo no próximo wheel.
  el.addEventListener('scroll', () => {
    if (!raf) targetY = el.scrollTop;
  });
}
