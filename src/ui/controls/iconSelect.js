// Select com prévia visual em cada opção do dropdown — mesmo espírito do
// combo de temas do Azulejo (bolinhas de cor por opção), só que genérico:
// cada option manda seu próprio `renderIcon()` (qualquer elemento DOM).
// Diferente de um <select> nativo (que não deixa customizar o conteúdo de
// cada <option>), este é um combo próprio (trigger + painel), então também
// cuida do próprio listener de "clicar fora fecha" — por isso devolve
// `destroy()`, que quem usar precisa chamar antes de recriar o controle
// (cada rebuild de sidebar) e no unmount do módulo, senão o listener vaza.
export function createIconSelect({ label, options, value, onChange }) {
  const wrap = document.createElement('div');
  wrap.className = 'control control-icon-select';

  const labelSpan = document.createElement('span');
  labelSpan.className = 'control-label';
  labelSpan.textContent = label;
  wrap.appendChild(labelSpan);

  const combo = document.createElement('div');
  combo.className = 'icon-select-combo';
  wrap.appendChild(combo);

  let currentValue = value;
  let isOpen = false;

  function optionFor(v) {
    return options.find((o) => o.value === v) || options[0];
  }

  function renderCombo() {
    combo.innerHTML = '';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'icon-select-trigger';
    const opt = optionFor(currentValue);
    trigger.appendChild(opt.renderIcon());
    const triggerLabel = document.createElement('span');
    triggerLabel.className = 'icon-select-label';
    triggerLabel.textContent = opt.label;
    trigger.appendChild(triggerLabel);
    const chevron = document.createElement('span');
    chevron.className = 'icon-select-chevron';
    chevron.textContent = '▾';
    trigger.appendChild(chevron);
    trigger.addEventListener('click', () => {
      isOpen = !isOpen;
      renderCombo();
    });
    combo.appendChild(trigger);

    if (isOpen) {
      const panel = document.createElement('div');
      panel.className = 'icon-select-panel';
      options.forEach((o) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'icon-select-row';
        row.classList.toggle('active', o.value === currentValue);
        row.appendChild(o.renderIcon());
        const rowLabel = document.createElement('span');
        rowLabel.textContent = o.label;
        row.appendChild(rowLabel);
        row.addEventListener('click', () => {
          currentValue = o.value;
          isOpen = false;
          renderCombo();
          onChange(o.value);
        });
        panel.appendChild(row);
      });
      combo.appendChild(panel);
    }
  }

  function handleOutsideClick(e) {
    if (!isOpen) return;
    if (!wrap.contains(e.target)) {
      isOpen = false;
      renderCombo();
    }
  }
  document.addEventListener('pointerdown', handleOutsideClick, true);

  renderCombo();

  return {
    el: wrap,
    // espelha o setter/getter de createSelect (ui/controls/select.js) — quem
    // usa precisa poder sincronizar o valor mostrado sem forçar um rebuild
    // inteiro da sidebar (ex.: arrastar um color picker dispara "input" a
    // cada frame, e um rebuild completo a cada evento seria bem mais caro).
    set value(v) {
      currentValue = v;
      renderCombo();
    },
    get value() {
      return currentValue;
    },
    destroy: () => document.removeEventListener('pointerdown', handleOutsideClick, true),
  };
}
