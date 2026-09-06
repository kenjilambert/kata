// slider customizado (era um <input type="range"> nativo) — resolve de
// vez o cursor do sistema (mãozinha) que insistia em aparecer por cima da
// bolinha/trilho nativos mesmo com cursor:none explícito nos pseudo-
// elementos (parte do controle é desenhada pelo SO, fora do alcance do
// CSS em alguns navegadores). O toque "elástico" (estica ao arrastar além
// do mínimo/máximo) foi removido de novo — não pegou bem, voltou pro
// comportamento simples de travar na borda.

export function createSlider({ label, min, max, step = 1, value, onChange, formatValue = (v) => String(v) }) {
  const wrap = document.createElement('div');
  wrap.className = 'control control-slider';

  const labelSpan = document.createElement('span');
  labelSpan.className = 'control-label';
  labelSpan.textContent = label;

  const row = document.createElement('div');
  row.className = 'slider-row';

  const trackWrap = document.createElement('div');
  trackWrap.className = 'slider-track-wrap';
  trackWrap.tabIndex = 0;
  trackWrap.setAttribute('role', 'slider');
  trackWrap.setAttribute('aria-valuemin', String(min));
  trackWrap.setAttribute('aria-valuemax', String(max));
  trackWrap.setAttribute('aria-label', label);

  const inner = document.createElement('div');
  inner.className = 'slider-track-inner';

  const track = document.createElement('div');
  track.className = 'slider-track';

  const fill = document.createElement('div');
  fill.className = 'slider-fill';

  const thumb = document.createElement('div');
  thumb.className = 'slider-thumb';

  track.appendChild(fill);
  inner.appendChild(track);
  inner.appendChild(thumb);
  trackWrap.appendChild(inner);

  const valueBox = document.createElement('span');
  valueBox.className = 'slider-value-box';

  let currentValue = clamp(value);
  let dragging = false;

  function clamp(v) {
    return Math.min(max, Math.max(min, v));
  }

  function stepify(v) {
    const stepped = Math.round((v - min) / step) * step + min;
    return Math.round(stepped * 1e6) / 1e6; // evita sobra de ponto flutuante (0.1+0.2 etc.)
  }

  function percentFor(v) {
    return max === min ? 0 : ((v - min) / (max - min)) * 100;
  }

  function updateVisual() {
    const pct = percentFor(currentValue);
    fill.style.width = `${pct}%`;
    thumb.style.left = `${pct}%`;
    trackWrap.setAttribute('aria-valuenow', String(currentValue));
  }

  function updateValueLabel() {
    valueBox.textContent = formatValue(currentValue);
    // quanto mais perto do máximo, mais o fundo da caixinha do valor vira
    // vermelho (--accent) e o número fica preto — só um reforço visual de
    // "tá quase no teto". --value-proximity vai de 0 (no mínimo) a 1 (no
    // máximo); o resto é feito em CSS (ver .slider-value-box).
    valueBox.style.setProperty('--value-proximity', String(percentFor(currentValue) / 100));
  }

  function valueFromClientX(clientX) {
    const rect = track.getBoundingClientRect();
    const ratio = rect.width === 0 ? 0 : (clientX - rect.left) / rect.width;
    return stepify(clamp(min + ratio * (max - min)));
  }

  function commit(v, { silent = false } = {}) {
    const next = clamp(v);
    if (next === currentValue) return;
    currentValue = next;
    updateVisual();
    updateValueLabel();
    if (!silent) onChange(currentValue);
  }

  function handlePointerMove(e) {
    if (!dragging) return;
    commit(valueFromClientX(e.clientX));
  }

  function handlePointerUp(e) {
    if (!dragging) return;
    dragging = false;
    trackWrap.classList.remove('dragging');
    // releasePointerCapture pode lançar (ex.: captura já foi liberada
    // sozinha pelo navegador antes, tipo o ponteiro saindo da janela) —
    // sem o try/catch descartando o erro, isso quebrava o resto do
    // handler (inofensivo agora que não há mais nada depois, mas mantido
    // por segurança).
    try {
      trackWrap.releasePointerCapture?.(e.pointerId);
    } catch {
      /* ignora */
    }
  }

  trackWrap.addEventListener('pointerdown', (e) => {
    dragging = true;
    trackWrap.classList.add('dragging');
    try {
      trackWrap.setPointerCapture(e.pointerId);
    } catch {
      /* mesma cautela do releasePointerCapture no pointerup — o arraste
         em si (via clientX no pointermove) funciona mesmo sem captura
         garantida, só perde o "segue mesmo saindo da área" em algum
         browser raro. */
    }
    commit(valueFromClientX(e.clientX));
  });
  trackWrap.addEventListener('pointermove', handlePointerMove);
  trackWrap.addEventListener('pointerup', handlePointerUp);
  trackWrap.addEventListener('pointercancel', handlePointerUp);

  trackWrap.addEventListener('keydown', (e) => {
    const bigStep = (max - min) / 10 || step;
    const actions = {
      ArrowRight: step,
      ArrowUp: step,
      ArrowLeft: -step,
      ArrowDown: -step,
      PageUp: bigStep,
      PageDown: -bigStep,
      Home: min - currentValue,
      End: max - currentValue,
    };
    if (!(e.key in actions)) return;
    e.preventDefault();
    commit(stepify(currentValue + actions[e.key]));
  });

  updateVisual();
  updateValueLabel();

  row.appendChild(trackWrap);
  row.appendChild(valueBox);

  wrap.appendChild(labelSpan);
  wrap.appendChild(row);

  return {
    el: wrap,
    set value(v) {
      currentValue = clamp(v);
      updateVisual();
      updateValueLabel();
    },
    get value() {
      return currentValue;
    },
  };
}
