// slider customizado (era um <input type="range"> nativo) — resolve de
// vez o cursor do sistema (mãozinha) que insistia em aparecer por cima da
// bolinha/trilho nativos mesmo com cursor:none explícito nos pseudo-
// elementos (parte do controle é desenhada pelo SO, fora do alcance do
// CSS em alguns navegadores). De quebra, ganha um toque "elástico" — ao
// arrastar além do mínimo/máximo, o trilho estica um pouco (com
// resistência) e volta com uma mola ao soltar, em vez de travar seco na
// borda (inspirado no ElasticSlider do React Bits, adaptado sem
// depender de nenhuma lib de animação).
const MAX_OVERFLOW = 14; // px — o quanto no máximo o trilho "estica" além da borda.

// resistência: quanto mais longe do limite, menos cada pixel extra de
// arraste realmente estica (nunca estica infinitamente) — mesma curva
// (tangente hiperbólica normalizada) do componente original.
function dampen(px) {
  const ratio = px / (MAX_OVERFLOW * 3);
  return MAX_OVERFLOW * Math.tanh(ratio);
}

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
  }

  function setOverflow(px) {
    // só o VISUAL estica (transform no grupo trilho+bolinha) — o valor de
    // verdade nunca passa de min/max, só a sensação de "mola" ao puxar
    // além da borda.
    inner.style.transform = px ? `translateX(${px}px)` : '';
  }

  function valueFromClientX(clientX) {
    const rect = track.getBoundingClientRect();
    const ratio = rect.width === 0 ? 0 : (clientX - rect.left) / rect.width;
    return stepify(clamp(min + ratio * (max - min)));
  }

  function overflowFromClientX(clientX) {
    const rect = track.getBoundingClientRect();
    if (clientX < rect.left) return -dampen(rect.left - clientX);
    if (clientX > rect.right) return dampen(clientX - rect.right);
    return 0;
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
    setOverflow(overflowFromClientX(e.clientX));
  }

  function handlePointerUp(e) {
    if (!dragging) return;
    dragging = false;
    trackWrap.classList.remove('dragging');
    // releasePointerCapture pode lançar (ex.: captura já foi liberada
    // sozinha pelo navegador antes, tipo o ponteiro saindo da janela) —
    // sem o try/catch, isso interrompia a função ANTES do setOverflow(0)
    // logo abaixo, e o trilho ficava "grudado" esticado pra sempre.
    try {
      trackWrap.releasePointerCapture?.(e.pointerId);
    } catch {
      /* ignora — o importante é resetar o overflow visual abaixo. */
    }
    // volta com uma mola (--ease-expressive já tem o "overshoot" certo)
    // em vez de simplesmente sumir — só entra a transição AGORA, pra não
    // deixar o arraste em si com atraso (ver CSS: .dragging desliga a
    // transição do inner).
    setOverflow(0);
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
    setOverflow(overflowFromClientX(e.clientX));
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
