import { t } from '../../core/i18n.js';

export function createShapeToggleGrid({ label, shapes, value, onChange, onRemoveCustom }) {
  const wrap = document.createElement('div');
  wrap.className = 'control control-shape-grid';

  const labelSpan = document.createElement('span');
  labelSpan.className = 'control-label';
  labelSpan.textContent = label;
  wrap.appendChild(labelSpan);

  const row = document.createElement('div');
  row.className = 'shape-toggle-row';
  wrap.appendChild(row);

  const selected = new Set(value);
  const ICON_SIZE = 26;

  Object.entries(shapes).forEach(([key, def]) => {
    const isCustom = key.startsWith('custom:');

    const chip = document.createElement('div');
    chip.className = 'shape-toggle-chip';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'shape-toggle';
    btn.title = isCustom ? t('customShapeLabel') : t(`shape_${key}`);
    btn.classList.toggle('active', selected.has(key));
    const previewInner = def.maskDataUrl
      ? `<defs><mask id="${def.maskId}-preview" maskContentUnits="objectBoundingBox"><image href="${def.maskDataUrl}" x="0" y="0" width="1" height="1" preserveAspectRatio="none" /></mask></defs>` +
        `<rect x="0" y="0" width="${ICON_SIZE}" height="${ICON_SIZE}" fill="currentColor" mask="url(#${def.maskId}-preview)" />`
      : def.draw(ICON_SIZE, 'currentColor', 'tl');
    btn.innerHTML = `<svg viewBox="0 0 ${ICON_SIZE} ${ICON_SIZE}" width="${ICON_SIZE}" height="${ICON_SIZE}">${previewInner}</svg>`;

    btn.addEventListener('click', () => {
      if (selected.has(key)) {
        if (selected.size <= 1) return;
        selected.delete(key);
      } else {
        selected.add(key);
      }
      btn.classList.toggle('active', selected.has(key));
      onChange([...selected]);
    });

    chip.appendChild(btn);

    if (isCustom && onRemoveCustom) {
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'swatch-remove';
      removeBtn.textContent = '×';
      removeBtn.title = t('removeCustomShape');
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        onRemoveCustom(key);
      });
      chip.appendChild(removeBtn);
    }

    row.appendChild(chip);
  });

  return { el: wrap };
}
