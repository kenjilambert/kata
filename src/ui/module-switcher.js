import { t, onLangChange } from '../core/i18n.js';

function resolveLabel(mod) {
  return typeof mod.label === 'function' ? mod.label() : mod.label;
}

export function createModuleSwitcher(container, modules, tabsContainer) {
  let current = null;

  const tabs = document.createElement('div');
  tabs.className = 'module-tabs';
  const content = document.createElement('div');
  content.className = 'module-content';
  // as abas moraram dentro do próprio #app antes — agora vivem no header,
  // do lado do logo (ver index.html/main.js), então quem chama decide onde
  // elas entram. Sem tabsContainer, cai de volta pro jeito antigo.
  (tabsContainer ?? container).appendChild(tabs);
  container.appendChild(content);

  function activate(mod) {
    if (current?.unmount) current.unmount();
    content.innerHTML = '';
    tabs.querySelectorAll('button').forEach((b) => {
      b.classList.toggle('active', b.dataset.id === mod.id);
    });
    current = mod;
    mod.mount(content);
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
    const { circle, label } = createPillLabel(resolveLabel(mod));
    btn.appendChild(circle);
    btn.appendChild(label);
    btn.addEventListener('click', () => activate(mod));
    tabs.appendChild(btn);
    return { mod, btn, label };
  });

  const comingSoonTab = document.createElement('button');
  comingSoonTab.type = 'button';
  comingSoonTab.className = 'module-tab-disabled';
  comingSoonTab.disabled = true;
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
