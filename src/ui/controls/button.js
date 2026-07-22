export function createButton({ label, variant = 'default', onClick }) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `control-button control-button-${variant}`;
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return { el: btn };
}
