import { t, onLangChange } from '../core/i18n.js';

function resolveLabel(mod) {
  return typeof mod.label === 'function' ? mod.label() : mod.label;
}

export function createModuleSwitcher(container, modules, tabsContainer, { onActivate } = {}) {
  let current = null;

  const tabs = document.createElement('div');
  tabs.className = 'module-tabs';
  // semântica de tabs (ARIA Tabs pattern) — antes eram <button> soltos com
  // só uma classe .active visual, sem nada pra leitor de tela entender que
  // é um seletor de view.
  tabs.setAttribute('role', 'tablist');
  const content = document.createElement('div');
  content.className = 'module-content';
  content.setAttribute('role', 'tabpanel');
  content.id = 'module-content-panel';
  // as abas moraram dentro do próprio #app antes — agora vivem no header,
  // do lado do logo (ver index.html/main.js), então quem chama decide onde
  // elas entram. Sem tabsContainer, cai de volta pro jeito antigo.
  (tabsContainer ?? container).appendChild(tabs);
  container.appendChild(content);

  // troca de aba é SERIALIZADA. mount() pode ser async (o Espelho espera o
  // themes.json, por ex.) e antes isso rodava sem await: clicar em duas abas
  // rápido fazia o mount da primeira terminar DEPOIS do da segunda e injetar
  // a interface dela dentro do painel da outra — dava duas sidebars/dois
  // canvas na tela ao mesmo tempo, e o motor da aba abandonada ficava rodando
  // pra sempre sem ninguém poder pará-lo (unmount() dela já tinha rodado
  // antes do motor existir). Agora, um clique que chega durante um mount fica
  // guardado em `pending` e só é aplicado quando o anterior termina —
  // guardando só o ÚLTIMO pedido (rajada de cliques não empilha montagens).
  let busy = false;
  let pending = null;

  function markActiveTab(mod) {
    tabs.querySelectorAll('[role="tab"]').forEach((b) => {
      const isActive = b.dataset.id === mod.id;
      b.classList.toggle('active', isActive);
      b.setAttribute('aria-selected', String(isActive));
      b.tabIndex = isActive ? 0 : -1;
    });
    content.setAttribute('aria-labelledby', `module-tab-${mod.id}`);
  }

  async function activate(mod) {
    if (busy) {
      // marca a aba clicada na hora (resposta visual imediata), mas só troca
      // de verdade quando a montagem em curso terminar.
      pending = mod;
      markActiveTab(mod);
      return;
    }
    busy = true;
    try {
      if (current?.unmount) current.unmount();
      content.innerHTML = '';
      markActiveTab(mod);
      current = mod;
      await mod.mount(content);
      onActivate?.(mod.id);
    } finally {
      busy = false;
    }
    const next = pending;
    pending = null;
    if (next && next !== current) await activate(next);
  }

  // pílula "PillNav" (inspirado no componente React Bits do mesmo nome,
  // reimplementado aqui em CSS/JS puro — o projeto não usa build step nem
  // dependências, então em vez de puxar React+GSAP pro site inteiro só
  // por causa de 1 componente, a ideia visual foi recriada com o que já
  // temos, em CSS: um círculo que "sobe" de baixo da pílula ao passar o
  // mouse/ativar, cobrindo o botão com uma cor sólida (ver
  // .pill-hover-circle em style.css) — o texto (acima do círculo, via
  // z-index) já troca de cor sozinho pelas mesmas classes .active/:hover,
  // sem precisar de uma segunda cópia do texto por cima.
  function createPillLabel(text) {
    const circle = document.createElement('span');
    circle.className = 'pill-hover-circle';
    circle.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.className = 'pill-label';
    label.textContent = text;
    return { circle, label };
  }

  const buttons = modules.map((mod) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.id = mod.id;
    btn.id = `module-tab-${mod.id}`;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', 'false');
    btn.setAttribute('aria-controls', content.id);
    btn.tabIndex = -1;
    const { circle, label } = createPillLabel(resolveLabel(mod));
    btn.appendChild(circle);
    btn.appendChild(label);
    btn.addEventListener('click', () => activate(mod));
    tabs.appendChild(btn);
    return { mod, btn, label };
  });

  // ARIA Tabs pattern: setinhas esquerda/direita movem o foco entre as
  // abas habilitadas (roving tabindex — só a aba ativa fica no fluxo do
  // Tab normal do teclado).
  tabs.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const enabled = buttons.map((b) => b.btn);
    const from = enabled.indexOf(document.activeElement);
    if (from === -1) return;
    e.preventDefault();
    const dir = e.key === 'ArrowRight' ? 1 : -1;
    const next = enabled[(from + dir + enabled.length) % enabled.length];
    next.focus();
    next.click();
  });

  const comingSoonTab = document.createElement('button');
  comingSoonTab.type = 'button';
  comingSoonTab.className = 'module-tab-disabled';
  comingSoonTab.disabled = true;
  comingSoonTab.setAttribute('role', 'tab');
  comingSoonTab.setAttribute('aria-disabled', 'true');
  comingSoonTab.textContent = t('comingSoonTab');
  tabs.appendChild(comingSoonTab);

  onLangChange(() => {
    buttons.forEach(({ mod, label }) => {
      label.textContent = resolveLabel(mod);
    });
    comingSoonTab.textContent = t('comingSoonTab');
  });

  if (modules.length) activate(modules[0]);
}
