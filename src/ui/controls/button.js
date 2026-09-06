export function createButton({ label, variant = 'default', icon, onClick }) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `control-button control-button-${variant}`;
  // ícone opcional (svg cru) antes do texto — só um enfeite visual, o
  // texto sozinho já identifica o botão (aria-hidden na span do ícone).
  if (icon) {
    const iconSpan = document.createElement('span');
    iconSpan.className = 'control-button-icon';
    iconSpan.setAttribute('aria-hidden', 'true');
    iconSpan.innerHTML = icon;
    btn.appendChild(iconSpan);
  }
  const labelSpan = document.createElement('span');
  labelSpan.className = 'control-button-label';
  labelSpan.textContent = label;
  btn.appendChild(labelSpan);
  btn.addEventListener('click', onClick);
  return { el: btn };
}

// troca só o texto (troca de idioma, mensagem de erro temporária etc.) sem
// apagar o ícone — .textContent direto no botão zerava a span do ícone
// junto, já que os dois moram dentro do mesmo elemento.
export function setButtonLabel(el, text) {
  const labelSpan = el.querySelector('.control-button-label');
  if (labelSpan) labelSpan.textContent = text;
  else el.textContent = text;
}

// "preenche" o botão de branco da esquerda pra direita e desaparece — só
// uma confirmação visual de que a exportação aconteceu (ver .export-flash
// em style.css). Tira e recoloca a classe (com um reflow forçado no meio)
// pra reiniciar a animação do zero mesmo se a pessoa clicar de novo antes
// da anterior terminar.
export function flashExportSuccess(el) {
  el.classList.remove('export-flash');
  void el.offsetWidth;
  el.classList.add('export-flash');
  el.addEventListener(
    'animationend',
    () => el.classList.remove('export-flash'),
    { once: true }
  );
}
