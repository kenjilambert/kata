export function createSlider({ label, min, max, step = 1, value, onChange, formatValue = (v) => String(v) }) {
  const wrap = document.createElement('label');
  wrap.className = 'control control-slider';

  const labelSpan = document.createElement('span');
  labelSpan.className = 'control-label';
  labelSpan.textContent = label;

  const row = document.createElement('div');
  row.className = 'slider-row';

  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);

  const valueBox = document.createElement('span');
  valueBox.className = 'slider-value-box';

  function updateFill() {
    const pct = ((Number(input.value) - min) / (max - min)) * 100;
    input.style.setProperty('--fill-percent', `${pct}%`);
  }

  function updateValueLabel() {
    valueBox.textContent = formatValue(Number(input.value));
  }

  updateValueLabel();
  updateFill();

  input.addEventListener('input', () => {
    updateValueLabel();
    updateFill();
    onChange(Number(input.value));
  });

  row.appendChild(input);
  row.appendChild(valueBox);

  wrap.appendChild(labelSpan);
  wrap.appendChild(row);

  return {
    el: wrap,
    set value(v) {
      input.value = String(v);
      updateValueLabel();
      updateFill();
    },
    get value() {
      return Number(input.value);
    },
  };
}
