export function createSelect({ label, options, value, onChange }) {
  const wrap = document.createElement('label');
  wrap.className = 'control control-select';

  const labelSpan = document.createElement('span');
  labelSpan.className = 'control-label';
  labelSpan.textContent = label;

  const select = document.createElement('select');
  options.forEach((opt) => {
    const optionEl = document.createElement('option');
    optionEl.value = opt.value;
    optionEl.textContent = opt.label;
    select.appendChild(optionEl);
  });
  select.value = value;

  select.addEventListener('change', () => onChange(select.value));

  wrap.appendChild(labelSpan);
  wrap.appendChild(select);

  return {
    el: wrap,
    set value(v) {
      select.value = v;
    },
    get value() {
      return select.value;
    },
  };
}
