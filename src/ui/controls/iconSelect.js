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
      options.forEach((o, index) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'icon-select-row';
        row.classList.toggle('active', o.value === currentValue);
        // cascata rápida ao abrir, mesma mecânica do outro dropdown (ver
        // .control-select-option-in em style.css).
        row.style.animationDelay = `${index * 20}ms`;
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
      // escapa do corte de overflow:hidden da seção que contém esse
      // controle (.control-section-body-inner — precisa disso pro
      // colapso animado das seções funcionar, ver style.css) — sem isso,
      // um position:absolute comum ficava invisível (existia no DOM, mas
      // era pintado por baixo do resto da sidebar). Só dá pra medir a
      // posição real do gatilho DEPOIS dele estar no DOM, por isso aqui,
      // não antes. Mesma solução do combo de tema e do select
      // customizado (ver grid-icons/index.js e ui/controls/select.js).
      const rect = trigger.getBoundingClientRect();
      panel.style.position = 'fixed';
      panel.style.top = `${rect.bottom + 4}px`;
      panel.style.left = `${rect.left}px`;
      panel.style.right = 'auto';
      panel.style.width = `${rect.width}px`;
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

  // Esc fecha o painel aberto — sem isso só dava pra fechar clicando fora,
  // sem atalho nenhum pra quem navega só de teclado.
  function handleKeydown(e) {
    if (e.key === 'Escape' && isOpen) {
      isOpen = false;
      renderCombo();
    }
  }
  document.addEventListener('keydown', handleKeydown);

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
    destroy: () => {
      document.removeEventListener('pointerdown', handleOutsideClick, true);
      document.removeEventListener('keydown', handleKeydown);
    },
  };
}
