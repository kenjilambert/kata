import { t, onLangChange } from '../core/i18n.js';
import { withViewTransition } from './viewTransition.js';

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

  // pílula ativa — UM elemento só (não mais uma bolha própria por botão
  // que só cresce/some), reposicionado e recolorido em cima do botão
  // certo a cada troca (ver moveActiveIndicator). É isso que deixa o
  // View Transitions MORFAR ela deslizando e mudando de cor de uma aba
  // pra outra — como o segmented control do iOS/Safari — em vez de só
  // sumir aqui e aparecer ali.
  const activeIndicator = document.createElement('div');
  activeIndicator.className = 'tab-active-indicator';
  activeIndicator.setAttribute('aria-hidden', 'true');
  tabs.appendChild(activeIndicator);

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

  // 2 cores só (--accent/--accent-2, as mesmas de sempre no resto do
  // app), revezando por posição — dá pra ter mais abas do que cores sem
  // repetir cor em vizinhas na maioria dos casos, sem inventar tom novo
  // nenhum fora da paleta da marca.
  function colorForIndex(index) {
    return index % 2 === 0 ? 'var(--accent)' : 'var(--accent-2)';
  }

  function moveActiveIndicator(mod) {
    const btn = tabs.querySelector(`[data-id="${mod.id}"]`);
    if (!btn) return;
    activeIndicator.style.left = `${btn.offsetLeft}px`;
    activeIndicator.style.top = `${btn.offsetTop}px`;
    activeIndicator.style.width = `${btn.offsetWidth}px`;
    activeIndicator.style.height = `${btn.offsetHeight}px`;
    activeIndicator.style.background = colorForIndex(modules.indexOf(mod));
  }

  function markActiveTab(mod) {
    tabs.querySelectorAll('[role="tab"]').forEach((b) => {
      const isActive = b.dataset.id === mod.id;
      b.classList.toggle('active', isActive);
      b.setAttribute('aria-selected', String(isActive));
      b.tabIndex = isActive ? 0 : -1;
    });
    moveActiveIndicator(mod);
    content.setAttribute('aria-labelledby', `module-tab-${mod.id}`);
    // no mobile a fileira de abas rola na horizontal (ver .module-tabs no
    // media query de style.css) — sem isso, abrir o site numa aba que está
    // fora da parte visível da fileira não mostrava qual está selecionada.
    if (tabs.scrollWidth > tabs.clientWidth) {
      tabs
        .querySelector('[role="tab"].active')
        ?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    }
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
    // direção do slide (ver .module-content[view-transition-name] no
    // style.css) — igual ao segmented control do iOS: aba mais pra
    // DIREITA na barra desliza entrando pela direita (o conteúdo velho
    // sai pela esquerda), e vice-versa. Antes da PRIMEIRA aba (current
    // ainda null) cai em "forward" por padrão, sem sentido nenhum já que
    // não existe conteúdo anterior pra cross-fade contra.
    const fromIndex = current ? modules.indexOf(current) : -1;
    const toIndex = modules.indexOf(mod);
    document.documentElement.dataset.moduleTransitionDir = toIndex >= fromIndex ? 'forward' : 'backward';
    try {
      // troca de ABA — cross-fade + slide do CONTEÚDO via View Transition
      // (ver ui/viewTransition.js). A pílula ativa NÃO entra nessa lista:
      // ela morfa por transition CSS comum (ver .tab-active-indicator em
      // style.css) — um View Transition renderiza a peça numa camada por
      // cima de tudo, sem respeitar o formato/recorte do trilho por baixo,
      // e dava a impressão dela "saindo do trilho e voltando" no meio do
      // movimento. markActiveTab (chamado já no início, fora do VT) muda
      // left/top/width/height/background dela direto — a transition CSS
      // cuida do resto sozinha, sem VT nenhum.
      markActiveTab(mod);
      await withViewTransition(
        async () => {
          if (current?.unmount) current.unmount();
          content.innerHTML = '';
          current = mod;
          await mod.mount(content);
        },
        { element: content, name: 'module-content' }
      );
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
