import { createModuleSwitcher } from './ui/module-switcher.js';
import { gridIconsModule } from './modules/grid-icons/index.js';
import { mosaicModule } from './modules/mosaic/index.js';
import { videoTilesModule } from './modules/video-tiles/index.js';
import { gradientTilesModule } from './modules/gradient-tiles/index.js';
import { soundTilesModule } from './modules/sound-tiles/index.js';
import { initCustomCursor } from './ui/customCursor.js';
import { renderDynamicLogo, renderSoundLogo } from './ui/dynamicLogo.js';
import { getLang, setLang, onLangChange, AVAILABLE_LANGS } from './core/i18n.js';

initCustomCursor();

const logoEl = document.getElementById('app-logo');
const langSwitcherEl = document.getElementById('lang-switcher');

// mesmo SVG do logo do header vira o favicon — mesma composição gerada
// (seed nova a cada carregamento/troca de módulo), só reaproveitada como
// imagem da aba também. SVG cru como data URI: navegador moderno já lê
// favicon em SVG direto, sem precisar converter pra PNG/canvas.
// Grade muda com o módulo ativo (2x2 no Azulejo, 3x3 no Mosaico) — mesmo
// tamanho em pixels sempre (ver LOGO_ICON_SIZE em dynamicLogo.js), só a
// densidade da grade sinaliza qual dos dois tá aberto.
let currentModuleId = null;

function updateLogoAndFavicon(moduleId) {
  if (moduleId) currentModuleId = moduleId;
  const gridSize = currentModuleId === 'mosaic' ? 3 : 2;
  // aba Som: em vez da grade aleatória de sempre, 3 barrinhas de
  // espectrômetro (ver renderSoundLogo em dynamicLogo.js) — lembra o
  // próprio módulo, não é só mais um padrão de formas soltas.
  const logoSvg = currentModuleId === 'sound' ? renderSoundLogo() : renderDynamicLogo(gridSize);
  logoEl.innerHTML = logoSvg;
  // aba Gradiente: logo fica girando de cor sozinho (ver @keyframes
  // logo-hue-cycle em style.css) — as outras abas não ganham essa classe,
  // continuam do jeito de sempre.
  logoEl.classList.toggle('logo-hue-cycle', currentModuleId === 'gradient');

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
}

// logo/favicon regeneram sozinhos enquanto a aba Espelho (id 'video') está
// ativa — nas outras abas o logo continua do jeito de sempre (só muda ao
// trocar de módulo/aba, nunca sozinho). renderDynamicLogo já sorteia uma
// seed nova a cada chamada (ver ui/dynamicLogo.js), então só precisa ser
// chamado nesse intervalo; moduleId omitido reaproveita currentModuleId
// (não muda o tamanho da grade, só gera outra composição).
setInterval(() => {
  if (currentModuleId !== 'video') return;
  updateLogoAndFavicon();
}, 1000);

// Som troca num ritmo próprio — 1s dava um "pulo" esquisito, mas rápido
// demais (a primeira tentativa, 140ms) ficou caótico com 3 barras
// independentes. Agora é uma onda de verdade (ver soundLogoPhase em
// dynamicLogo.js), então o movimento em si já é ordeiro — esse intervalo só
// controla a velocidade que ela desliza, não pulos aleatórios.
setInterval(() => {
  if (currentModuleId !== 'sound') return;
  updateLogoAndFavicon();
}, 198);

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
createModuleSwitcher(app, [gridIconsModule, mosaicModule, gradientTilesModule, soundTilesModule, videoTilesModule], moduleTabsSlot, { onActivate: updateLogoAndFavicon });
