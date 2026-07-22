export function createSection(title, elements, { collapsed = false, onToggleCollapse, onRandomize } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'control-section';

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
  elements.forEach((el) => body.appendChild(el));

  wrap.appendChild(header);
  wrap.appendChild(body);

  let isCollapsed = collapsed;
  function applyCollapsed() {
    body.style.display = isCollapsed ? 'none' : '';
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
