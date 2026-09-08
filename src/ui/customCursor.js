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
  // 2 formas no mesmo SVG, só uma visível por vez (ver .custom-cursor.
  // pressed em style.css) — a seta normal vira uma bolinha cheia enquanto
  // segura o clique (arrastando um slider, por ex.), mesmo hotspot (perto
  // de 1,1) pras duas, então a troca não "pula" o cursor de lugar.
  cursor.innerHTML = `
    <svg viewBox="0 0 24 24" width="24" height="24">
      <path class="custom-cursor-shape custom-cursor-arrow" d="M1 1 L21 10 L11 12.5 L8.5 21 Z" />
      <circle class="custom-cursor-shape custom-cursor-dot" cx="7" cy="7" r="7" />
    </svg>
  `;
  document.body.appendChild(cursor);
  document.documentElement.classList.add('custom-cursor-active');

  let visible = false;
  let pressed = false;
  let hovering = false;
  let lastX = 0;
  let lastY = 0;

  // "clicável" — cobre os elementos nativos de sempre (link/botão/input)
  // mais os controles próprios do app (que são <div>/<label> com onClick,
  // não têm semântica nativa nenhuma pro navegador reconhecer sozinho).
  // Curada explicitamente (em vez de tentar ler `cursor:pointer` computado)
  // porque cursor:none já está forçado em TUDO (.custom-cursor-active *),
  // então não sobra nenhum jeito de perguntar ao navegador "isso seria um
  // ponteirinho por padrão?" — a resposta sempre viria "none".
  const HOVER_SELECTOR = [
    'a',
    'button',
    'input',
    'select',
    'textarea',
    'label',
    '[role="button"]',
    '[role="tab"]',
    '[role="slider"]',
    '[tabindex]',
  ].join(', ');

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
    // delegação em cima do próprio mousemove (não um listener 'mouseover'
    // à parte) — o app troca o conteúdo da sidebar inteiro toda hora
    // (buildSidebar() reconstrói do zero a cada ajuste, ver os módulos),
    // então um listener por elemento ficaria "furando" toda vez que algo
    // clicável reaparecesse com outra referência de nó; checar a cada
    // movimento de mouse (via closest, barato) sempre acerta o elemento que
    // está de verdade sob o cursor AGORA, sem precisar reconectar nada.
    const isHovering = Boolean(e.target.closest?.(HOVER_SELECTOR));
    if (isHovering !== hovering) {
      hovering = isHovering;
      cursor.classList.toggle('hover', hovering);
    }
  }

  function onDown() {
    pressed = true;
    // vermelho (--accent) no clique — só o scale(0.85) sozinho passava
    // meio despercebido; a cor confirma bem mais claro "isso registrou o
    // clique".
    cursor.classList.add('pressed');
    applyTransform();
  }

  function onUp() {
    pressed = false;
    cursor.classList.remove('pressed');
    applyTransform();
  }

  window.addEventListener('mousemove', onMove);
  window.addEventListener('mousedown', onDown);
  window.addEventListener('mouseup', onUp);
  document.addEventListener('mouseleave', hide);
  window.addEventListener('blur', hide);
}
