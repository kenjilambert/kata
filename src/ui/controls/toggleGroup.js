export function createToggleGroup({ label, options, onChange }) {
  const wrap = document.createElement('div');
  wrap.className = 'control control-toggle-group';

  if (label) {
    const labelSpan = document.createElement('span');
    labelSpan.className = 'control-label';
    labelSpan.textContent = label;
    wrap.appendChild(labelSpan);
  }

  const row = document.createElement('div');
  row.className = 'checkbox-row';
  wrap.appendChild(row);

  options.forEach((opt) => {
    const chip = document.createElement('label');
    chip.className = 'checkbox-chip';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!opt.value;
    input.addEventListener('change', () => onChange(opt.key, input.checked));

    chip.appendChild(input);
    chip.append(opt.label);
    row.appendChild(chip);
  });

  return { el: wrap };
}
