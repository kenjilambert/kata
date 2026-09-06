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
