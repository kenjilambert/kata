import { createModuleSwitcher } from './ui/module-switcher.js';
import { gridIconsModule } from './modules/grid-icons/index.js';
import { mosaicModule } from './modules/mosaic/index.js';
import { initCustomCursor } from './ui/customCursor.js';
import { renderDynamicLogo } from './ui/dynamicLogo.js';
import { getLang, setLang, onLangChange, AVAILABLE_LANGS } from './core/i18n.js';

initCustomCursor();

const logoEl = document.getElementById('app-logo');
const langSwitcherEl = document.getElementById('lang-switcher');

logoEl.innerHTML = renderDynamicLogo();
document.title = 'Kata';

function renderLangSwitcher() {
  langSwitcherEl.innerHTML = '';
  AVAILABLE_LANGS.forEach((lang) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'lang-button';
    btn.textContent = lang.toUpperCase();
    btn.classList.toggle('active', lang === getLang());
    btn.addEventListener('click', () => setLang(lang));
    langSwitcherEl.appendChild(btn);
  });
}

renderLangSwitcher();
onLangChange(renderLangSwitcher);

const app = document.getElementById('app');
const moduleTabsSlot = document.getElementById('module-tabs-slot');
createModuleSwitcher(app, [gridIconsModule, mosaicModule], moduleTabsSlot);
