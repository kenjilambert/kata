// botão de "pressionar" — parece levantado (sombra por baixo) quando
// desligado e afunda (sem sombra, ligeiramente pra baixo/pra dentro) quando
// ligado, em vez de um switch com bolinha ou uma pílula que só troca de cor
// (essas já são usadas por Resultado/Variações/Histórico e pelos outros
// toggles — este precisa parecer outra coisa, um botão físico de verdade).
export function createPressButton({ label, value, onChange }) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'press-button';
  btn.setAttribute('aria-pressed', String(!!value));
  btn.classList.toggle('pressed', !!value);
  btn.textContent = label;

  btn.addEventListener('click', () => {
    const next = !btn.classList.contains('pressed');
    btn.classList.toggle('pressed', next);
    btn.setAttribute('aria-pressed', String(next));
    onChange(next);
  });

  return { el: btn };
}
