import { t } from '../core/i18n.js';

const CANVAS_SIZE = 480;
const DEFAULT_BRUSH = 14;
const MAX_BRUSH = 96;

export function openDrawCanvas({ onConfirm, initialImageEl }) {
  const overlay = document.createElement('div');
  overlay.className = 'draw-overlay';

  const modal = document.createElement('div');
  modal.className = 'draw-modal';

  const header = document.createElement('div');
  header.className = 'draw-modal-header';
  const title = document.createElement('span');
  title.className = 'draw-modal-title';
  title.textContent = t('drawModalTitle');
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'draw-close-btn';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', close);
  header.appendChild(title);
  header.appendChild(closeBtn);

  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;
  canvas.className = 'draw-canvas';
  const ctx = canvas.getContext('2d');

  function clearCanvas() {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  }
  clearCanvas();
  // permite continuar em cima de um desenho já feito (em vez de sempre
  // começar do zero) — quem chama passa a própria imagem/máscara atual.
  if (initialImageEl) {
    ctx.drawImage(initialImageEl, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = DEFAULT_BRUSH;

  let drawing = false;
  let lastX = 0;
  let lastY = 0;

  function pointFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_SIZE / rect.width;
    const scaleY = CANVAS_SIZE / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }

  function handlePointerDown(e) {
    drawing = true;
    const p = pointFromEvent(e);
    lastX = p.x;
    lastY = p.y;
    ctx.beginPath();
    ctx.arc(p.x, p.y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fill();
    canvas.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e) {
    if (!drawing) return;
    const p = pointFromEvent(e);
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    lastX = p.x;
    lastY = p.y;
  }

  function handlePointerUp() {
    drawing = false;
  }

  canvas.addEventListener('pointerdown', handlePointerDown);
  canvas.addEventListener('pointermove', handlePointerMove);
  canvas.addEventListener('pointerup', handlePointerUp);
  canvas.addEventListener('pointerleave', handlePointerUp);

  const brushRow = document.createElement('div');
  brushRow.className = 'draw-brush-row';
  const brushLabel = document.createElement('span');
  brushLabel.className = 'control-label';
  brushLabel.textContent = t('brushSizeLabel');
  const brushInput = document.createElement('input');
  brushInput.type = 'range';
  brushInput.min = '4';
  brushInput.max = String(MAX_BRUSH);
  brushInput.value = String(DEFAULT_BRUSH);
  brushInput.addEventListener('input', () => {
    ctx.lineWidth = Number(brushInput.value);
  });
  brushRow.appendChild(brushLabel);
  brushRow.appendChild(brushInput);

  const actions = document.createElement('div');
  actions.className = 'draw-actions';

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'control-button control-button-default';
  clearBtn.textContent = t('clearDrawingButton');
  clearBtn.addEventListener('click', clearCanvas);

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'control-button control-button-default';
  cancelBtn.textContent = t('cancelButton');
  cancelBtn.addEventListener('click', close);

  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'button';
  confirmBtn.className = 'control-button control-button-primary';
  confirmBtn.textContent = t('useDrawingButton');
  confirmBtn.addEventListener('click', () => {
    canvas.toBlob((blob) => {
      if (blob) onConfirm(blob);
      close();
    }, 'image/png');
  });

  actions.appendChild(clearBtn);
  actions.appendChild(cancelBtn);
  actions.appendChild(confirmBtn);

  modal.appendChild(header);
  modal.appendChild(canvas);
  modal.appendChild(brushRow);
  modal.appendChild(actions);
  overlay.appendChild(modal);

  function handleKeydown(e) {
    if (e.key === 'Escape') close();
  }

  function close() {
    document.removeEventListener('keydown', handleKeydown);
    overlay.remove();
  }

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener('keydown', handleKeydown);

  document.body.appendChild(overlay);
}
