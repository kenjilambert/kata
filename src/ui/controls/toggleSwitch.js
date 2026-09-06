export function createToggleSwitch({ label, value, onChange }) {
  const wrap = document.createElement('div');
  wrap.className = 'control control-toggle-switch';

  const labelSpan = document.createElement('span');
  labelSpan.className = 'control-label';
  labelSpan.textContent = label;

  const switchBtn = document.createElement('button');
  switchBtn.type = 'button';
  switchBtn.className = 'toggle-switch';
  switchBtn.setAttribute('role', 'switch');
  switchBtn.setAttribute('aria-checked', String(!!value));
  // o rótulo visível (labelSpan) pode ficar escondido em telas estreitas
  // (ver .gi-grid-edit-toggle no mobile) — o aria-label garante que o
  // switch continue com nome acessível mesmo sem o texto na tela.
  switchBtn.setAttribute('aria-label', label);
  switchBtn.classList.toggle('on', !!value);

  const knob = document.createElement('span');
  knob.className = 'toggle-switch-knob';
  switchBtn.appendChild(knob);

  switchBtn.addEventListener('click', () => {
    const next = !switchBtn.classList.contains('on');
    switchBtn.classList.toggle('on', next);
    switchBtn.setAttribute('aria-checked', String(next));
    onChange(next);
  });

  wrap.appendChild(labelSpan);
  wrap.appendChild(switchBtn);

  return { el: wrap };
}
