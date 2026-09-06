export function createSection(title, elements, { collapsed = false, onToggleCollapse, onRandomize, id } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'control-section';
  // id estável usado no mobile pra montar a aba de categorias (ver
  // .gi-mobile-category-tabs em style.css e grid-icons/index.js) — sem
  // isso o CSS não teria como mostrar só a seção da aba ativa.
  if (id) wrap.dataset.sectionId = id;

  const header = document.createElement('div');
  header.className = 'control-section-header';

  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'control-section-toggle';

  const chevron = document.createElement('span');
  chevron.className = 'control-section-chevron';
  chevron.textContent = '▾';

  const heading = document.createElement('h3');
  heading.className = 'control-section-title';
  heading.textContent = title;

  toggleBtn.appendChild(chevron);
  toggleBtn.appendChild(heading);
  header.appendChild(toggleBtn);

  if (onRandomize) {
    const randomizeBtn = document.createElement('button');
    randomizeBtn.type = 'button';
    randomizeBtn.className = 'control-section-randomize';
    randomizeBtn.title = 'Randomizar';
    randomizeBtn.textContent = '⇄';
    randomizeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onRandomize();
    });
    header.appendChild(randomizeBtn);
  }

  const body = document.createElement('div');
  body.className = 'control-section-body';
  // conteúdo de verdade fica num wrapper à parte (.control-section-body-
  // inner) — é ele que corta (overflow:hidden) enquanto .control-section-
  // body anima a "altura automática" via grid-template-rows (ver
  // style.css); sem esse wrapper o grid não tem uma única linha pra
  // encolher, só os filhos soltos.
  const bodyInner = document.createElement('div');
  bodyInner.className = 'control-section-body-inner';
  elements.forEach((el) => bodyInner.appendChild(el));
  body.appendChild(bodyInner);

  wrap.appendChild(header);
  wrap.appendChild(body);

  let isCollapsed = collapsed;
  function applyCollapsed() {
    // era body.style.display = 'none'/'' — some/aparece na hora, sem
    // transição nenhuma. A classe sozinha já basta agora: quem "esconde"
    // de verdade é o CSS (grid-template-rows 0fr + overflow:hidden no
    // wrapper interno), com uma animação suave em vez de um corte seco.
    wrap.classList.toggle('collapsed', isCollapsed);
  }
  applyCollapsed();

  toggleBtn.addEventListener('click', () => {
    isCollapsed = !isCollapsed;
    applyCollapsed();
    if (onToggleCollapse) onToggleCollapse(isCollapsed);
  });

  return wrap;
}
