import { createModuleSwitcher } from './ui/module-switcher.js';
import { gridIconsModule } from './modules/grid-icons/index.js';
import { mosaicModule } from './modules/mosaic/index.js';
import { initCustomCursor } from './ui/customCursor.js';
import { renderDynamicLogo } from './ui/dynamicLogo.js';
import { getLang, setLang, onLangChange, AVAILABLE_LANGS } from './core/i18n.js';

initCustomCursor();

const logoEl = document.getElementById('app-logo');
const langSwitcherEl = document.getElementById('lang-switcher');

// mesmo SVG do logo do header vira o favicon — mesma composição gerada
// (2x2, seed nova a cada carregamento), só reaproveitada como imagem da
// aba também. SVG cru como data URI: navegador moderno já lê favicon em
// SVG direto, sem precisar converter pra PNG/canvas.
const logoSvg = renderDynamicLogo();
logoEl.innerHTML = logoSvg;

// troca o <link> inteiro (tira o antigo, bota um novo) em vez de só
// mudar o href do que já existe — alguns navegadores (esp. Chrome) não
// refazem o ícone da aba se só o href muda, mas sempre pegam um <link>
// novo inserido no <head>.
document.querySelectorAll('link[rel="icon"]').forEach((el) => el.remove());
const faviconEl = document.createElement('link');
faviconEl.rel = 'icon';
faviconEl.type = 'image/svg+xml';
faviconEl.href = `data:image/svg+xml,${encodeURIComponent(logoSvg)}`;
document.head.appendChild(faviconEl);

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
