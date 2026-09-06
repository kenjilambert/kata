// dropdown customizado (era um <select> nativo) — o popup de opções de um
// select nativo é desenhado pelo sistema operacional, então não dava pra
// estilizar (cantos arredondados que "abrem" pro painel, item selecionado
// colorido) nem fazer o cursor customizado do site aparecer por cima dele.
// Mesmo visual/mecânica do combo de tema (ver applyTheme/themeDropdown em
// grid-icons/index.js), só que genérico — qualquer lista de opções.
export function createSelect({ label, options, value, onChange }) {
  const wrap = document.createElement('div');
  wrap.className = 'control control-select';

  const labelSpan = document.createElement('span');
  labelSpan.className = 'control-label';
  labelSpan.textContent = label;

  const combo = document.createElement('div');
  combo.className = 'control-select-combo';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'control-select-trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');

  const triggerLabel = document.createElement('span');
  triggerLabel.className = 'control-select-trigger-label';

  const chevron = document.createElement('span');
  chevron.className = 'control-select-chevron';
  chevron.textContent = '▾';

  trigger.appendChild(triggerLabel);
  trigger.appendChild(chevron);

  const panel = document.createElement('div');
  panel.className = 'control-select-panel';
  panel.setAttribute('role', 'listbox');

  let currentValue = value;
  let isOpen = false;
  let outsideClickHandler = null;
  let scrollHandler = null;

  // o painel de ajustes rola por dentro (.gi-controls tem overflow-y:auto)
  // — um painel position:absolute comum fica CORTADO quando o dropdown
  // abre perto do fim do que já rolou (o ancestral com overflow corta
  // filho absoluto também, mesmo ele "escapando" do fluxo normal).
  // position:fixed com coordenada calculada na hora escapa desse corte —
  // sem isso, dropdown mais embaixo na sidebar (Rotação, Detalhe, etc.)
  // aparecia com o painel cortado pela metade, sem cantos nem opções de
  // baixo visíveis.
  function positionPanel() {
    const rect = trigger.getBoundingClientRect();
    panel.style.position = 'fixed';
    panel.style.top = `${rect.bottom}px`;
    panel.style.left = `${rect.left}px`;
    panel.style.right = 'auto';
    panel.style.width = `${rect.width}px`;
  }

  function findOption(v) {
    return options.find((opt) => String(opt.value) === String(v));
  }

  function updateTriggerLabel() {
    triggerLabel.textContent = findOption(currentValue)?.label ?? '';
  }

  function renderOptions() {
    panel.innerHTML = '';
    options.forEach((opt, index) => {
      const isActive = String(opt.value) === String(currentValue);
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'control-select-option';
      row.classList.toggle('active', isActive);
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(isActive));
      row.textContent = opt.label;
      // cascata rápida começando do primeiro item (ver @keyframes control-
      // select-option-in) — rápido o bastante pra não enrolar mesmo com
      // uma lista grande (25ms * índice, sem acumular além disso).
      row.style.animationDelay = `${index * 25}ms`;
      row.addEventListener('click', () => {
        currentValue = opt.value;
        updateTriggerLabel();
        renderOptions();
        close();
        onChange(currentValue);
      });
      panel.appendChild(row);
    });
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    wrap.classList.remove('open');
    trigger.setAttribute('aria-expanded', 'false');
    if (outsideClickHandler) {
      document.removeEventListener('click', outsideClickHandler);
      document.removeEventListener('keydown', handleEscape);
      outsideClickHandler = null;
    }
    if (scrollHandler) {
      // captura:true pra pegar o scroll de dentro de .gi-controls também
      // (scroll não borbulha até o document sem capture).
      document.removeEventListener('scroll', scrollHandler, true);
      scrollHandler = null;
    }
  }

  function handleEscape(e) {
    if (e.key === 'Escape') close();
  }

  function open() {
    if (isOpen) return;
    isOpen = true;
    wrap.classList.add('open');
    trigger.setAttribute('aria-expanded', 'true');
    positionPanel();
    // adicionado DEPOIS do clique que abriu (mesmo ciclo de eventos, mas
    // o handler confere wrap.contains antes de fechar — o próprio clique
    // que abriu nunca fecha de novo na hora).
    outsideClickHandler = (e) => {
      if (!wrap.contains(e.target)) close();
    };
    document.addEventListener('click', outsideClickHandler);
    document.addEventListener('keydown', handleEscape);
    // fecha ao rolar em vez de tentar seguir grudado (painel fixo não se
    // move sozinho com o scroll do pai) — mais simples e previsível do
    // que reposicionar em todo scroll.
    scrollHandler = (e) => {
      if (e.target === panel) return;
      close();
    };
    document.addEventListener('scroll', scrollHandler, true);
  }

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isOpen) close();
    else open();
  });

  updateTriggerLabel();
  renderOptions();

  combo.appendChild(trigger);
  combo.appendChild(panel);

  wrap.appendChild(labelSpan);
  wrap.appendChild(combo);

  return {
    el: wrap,
    set value(v) {
      currentValue = v;
      updateTriggerLabel();
      renderOptions();
    },
    get value() {
      return currentValue;
    },
  };
}
