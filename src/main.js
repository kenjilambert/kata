import { createModuleSwitcher } from './ui/module-switcher.js';
import { gridIconsModule } from './modules/grid-icons/index.js';
import { mosaicModule } from './modules/mosaic/index.js';
import { renderPixelWordmark } from './ui/pixelLogo.js';
import { getLang, setLang, onLangChange, AVAILABLE_LANGS } from './core/i18n.js';

const logoEl = document.getElementById('app-logo');
const langSwitcherEl = document.getElementById('lang-switcher');

logoEl.innerHTML = renderPixelWordmark('Kata');
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
createModuleSwitcher(app, [gridIconsModule, mosaicModule]);
