// Seletor visual de proporção de exportação — cada opção mostra um
// retangulozinho do jeito que ela realmente fica (quadrado, retrato,
// story...) em vez de só um texto num <select>, e o rótulo embaixo mostra
// o tamanho final em pixels. Inspirado no seletor de formato do
// playgrnd.tools, no estilo visual do Kata (pílulas, cores do tema).
const TILE_BOX = 20;

// sem título "Formato de exportação" nem legenda de tamanho embaixo — só
// os ícones mesmo (cada um já vem com a proporção escrita, ex. "4:5", pra
// dar pra diferenciar retrato de story só de olhar).
export function createFrameTilePicker({ options, value, onChange }) {
  const wrap = document.createElement('div');
  wrap.className = 'control control-frame-picker';

  const row = document.createElement('div');
  row.className = 'frame-picker-row';
  wrap.appendChild(row);

  let selected = value;
  const tiles = new Map();

  options.forEach((opt) => {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'frame-picker-tile';
    tile.title = opt.label;

    const shape = document.createElement('span');
    shape.className = 'frame-picker-shape';
    const w = opt.ratio >= 1 ? TILE_BOX : TILE_BOX * opt.ratio;
    const h = opt.ratio >= 1 ? TILE_BOX / opt.ratio : TILE_BOX;
    shape.style.width = `${Math.round(w)}px`;
    shape.style.height = `${Math.round(h)}px`;
    tile.appendChild(shape);

    const caption = document.createElement('span');
    caption.className = 'frame-picker-caption';
    // só a proporção (ex. "4:5") — o nome (Retrato, Story...) já vai no
    // title/tooltip do botão, não precisa repetir escrito embaixo do ícone.
    caption.textContent = opt.caption ?? opt.label;
    tile.appendChild(caption);

    tile.classList.toggle('active', opt.value === selected);
    tile.addEventListener('click', () => {
      selected = opt.value;
      tiles.forEach((el, key) => el.classList.toggle('active', key === selected));
      onChange(selected);
    });

    tiles.set(opt.value, tile);
    row.appendChild(tile);
  });

  return { el: wrap };
}
