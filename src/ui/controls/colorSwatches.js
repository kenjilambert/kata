import { t } from '../../core/i18n.js';
import { hslToHex } from '../../core/color.js';

function randomColor() {
  return hslToHex(Math.floor(Math.random() * 360), 65, 55);
}

export function createColorSwatches({ label, colors, onChange }) {
  const wrap = document.createElement('div');
  wrap.className = 'control control-swatches';

  const labelSpan = document.createElement('span');
  labelSpan.className = 'control-label';
  labelSpan.textContent = label;
  wrap.appendChild(labelSpan);

  const row = document.createElement('div');
  row.className = 'swatch-row';
  wrap.appendChild(row);

  let currentColors = colors;

  function render() {
    row.innerHTML = '';
    currentColors.forEach((entry, i) => {
      const chip = document.createElement('div');
      chip.className = 'swatch-chip';

      const input = document.createElement('input');
      input.type = 'color';
      input.value = entry.color;
      input.title = entry.color;
      input.addEventListener('input', () => {
        // recolorir zera o peso herdado do preset original — sem isso, duas
        // cores escolhidas à mão podiam ter chances bem desiguais de aparecer
        // (ex: 3x mais chance) sem nenhum jeito de perceber ou ajustar isso.
        currentColors[i] = { color: input.value, weight: 1 };
        input.title = input.value;
        onChange(currentColors);
      });
      chip.appendChild(input);

      if (currentColors.length > 1) {
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'swatch-remove';
        removeBtn.textContent = '×';
        removeBtn.title = t('removeColor');
        removeBtn.addEventListener('click', () => {
          currentColors = currentColors.filter((_, idx) => idx !== i);
          render();
          onChange(currentColors);
        });
        chip.appendChild(removeBtn);
      }

      row.appendChild(chip);
    });

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'swatch-add';
    addBtn.title = t('addColor');
    addBtn.textContent = '+';
    addBtn.addEventListener('click', () => {
      currentColors = [...currentColors, { color: randomColor(), weight: 1 }];
      render();
      onChange(currentColors);
    });
    row.appendChild(addBtn);
  }

  render();

  return {
    el: wrap,
    setColors(newColors) {
      currentColors = newColors;
      render();
    },
  };
}
