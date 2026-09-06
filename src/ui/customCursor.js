// Cursor customizado (inspirado no kenjilambert.com, que troca a seta por
// uma bolinha que segue o mouse) — aqui é uma setinha geométrica sólida
// (só a forma, sem nó/âncora nenhum), que reage com um leve encolhe no
// clique. Só liga em telas com mouse de verdade (pointer:fine) — em touch
// não existe cursor pra substituir.
//
// Importante: cursor:none só é aplicado via classe adicionada por JS
// (depois que este módulo confirma que vai desenhar o substituto) — nunca
// direto no CSS, senão um erro de JS deixaria a pessoa sem cursor nenhum.
export function initCustomCursor() {
  if (!window.matchMedia('(pointer: fine)').matches) return;

  const cursor = document.createElement('div');
  cursor.className = 'custom-cursor';
  cursor.innerHTML = `
    <svg viewBox="0 0 24 24" width="24" height="24">
      <path class="custom-cursor-shape" d="M1 1 L21 10 L11 12.5 L8.5 21 Z" />
    </svg>
  `;
  document.body.appendChild(cursor);
  document.documentElement.classList.add('custom-cursor-active');

  let visible = false;
  let pressed = false;
  let lastX = 0;
  let lastY = 0;

  function show() {
    if (visible) return;
    visible = true;
    cursor.classList.add('visible');
  }

  function hide() {
    visible = false;
    cursor.classList.remove('visible');
  }

  function applyTransform() {
    // a ponta da seta (vértice 1,1 no viewBox) é o "hotspot" — fica
    // exatamente onde o ponteiro de verdade estaria, sem perder precisão
    // nenhuma pra clicar/arrastar coisas.
    const scale = pressed ? 'scale(0.85)' : '';
    cursor.style.transform = `translate(${lastX - 1}px, ${lastY - 1}px) ${scale}`;
  }

  function onMove(e) {
    show();
    lastX = e.clientX;
    lastY = e.clientY;
    applyTransform();
  }

  function onDown() {
    pressed = true;
    applyTransform();
  }

  function onUp() {
    pressed = false;
    applyTransform();
  }

  window.addEventListener('mousemove', onMove);
  window.addEventListener('mousedown', onDown);
  window.addEventListener('mouseup', onUp);
  document.addEventListener('mouseleave', hide);
  window.addEventListener('blur', hide);
}
