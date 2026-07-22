import { t, onLangChange } from '../core/i18n.js';

function resolveLabel(mod) {
  return typeof mod.label === 'function' ? mod.label() : mod.label;
}

export function createModuleSwitcher(container, modules) {
  let current = null;

  const tabs = document.createElement('div');
  tabs.className = 'module-tabs';
  const content = document.createElement('div');
  content.className = 'module-content';
  container.appendChild(tabs);
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

  const buttons = modules.map((mod) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = resolveLabel(mod);
    btn.dataset.id = mod.id;
    btn.addEventListener('click', () => activate(mod));
    tabs.appendChild(btn);
    return { mod, btn };
  });

  const comingSoonTab = document.createElement('button');
  comingSoonTab.type = 'button';
  comingSoonTab.className = 'module-tab-disabled';
  comingSoonTab.disabled = true;
  comingSoonTab.textContent = t('comingSoonTab');
  tabs.appendChild(comingSoonTab);

  onLangChange(() => {
    buttons.forEach(({ mod, btn }) => {
      btn.textContent = resolveLabel(mod);
    });
    comingSoonTab.textContent = t('comingSoonTab');
  });

  if (modules.length) activate(modules[0]);
}
