export function createCheckboxGroup({ label, options, value, onChange }) {
  const wrap = document.createElement('div');
  wrap.className = 'control control-checkbox-group';

  const labelSpan = document.createElement('span');
  labelSpan.className = 'control-label';
  labelSpan.textContent = label;
  wrap.appendChild(labelSpan);

  const row = document.createElement('div');
  row.className = 'checkbox-row';
  wrap.appendChild(row);

  let selected = new Set(value);

  options.forEach((opt) => {
    const chip = document.createElement('label');
    chip.className = 'checkbox-chip';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = selected.has(opt.value);
    input.addEventListener('change', () => {
      if (input.checked) {
        selected.add(opt.value);
      } else if (selected.size > 1) {
        selected.delete(opt.value);
      } else {
        input.checked = true;
        return;
      }
      onChange([...selected]);
    });

    chip.appendChild(input);
    chip.append(opt.label);
    row.appendChild(chip);
  });

  return { el: wrap };
}
