import { t } from '../core/i18n.js';

// Aviso curto no canto da tela ("toast") — pra falhas que antes só
// apareciam no console (imagem que não carregou, PNG que não gerou, aba
// que não baixou) ou pra confirmar uma ação sem elemento próprio pra
// piscar (link copiado). Um único contêiner `role="status"` + aria-live
// no <body>, criado na primeira chamada: leitor de tela anuncia o texto
// sem roubar o foco de onde a pessoa está.
//
// kind: 'error' (vermelho da marca) | 'success' (azul) | 'info' (neutro).
// Some sozinho depois de `duration` ms; passar o mouse em cima segura.
let region = null;

function ensureRegion() {
  if (region) return region;
  region = document.createElement('div');
  region.className = 'toast-region';
  region.setAttribute('role', 'status');
  region.setAttribute('aria-live', 'polite');
  document.body.appendChild(region);
  return region;
}

export function showToast(message, { kind = 'info', duration = 4200 } = {}) {
  if (!message) return;
  const host = ensureRegion();
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.textContent = message;

  // no máximo 3 na tela — o mais velho sai pra entrar o novo (uma rajada
  // de erros iguais não empilha uma coluna inteira).
  while (host.children.length >= 3) host.firstChild.remove();
  host.appendChild(el);

  let timer = null;
  const dismiss = () => {
    if (!el.isConnected) return;
    el.classList.add('toast-leaving');
    // .toast-leaving anima a saída (ver style.css); remove depois da
    // animação, ou na hora se prefers-reduced-motion cortar a animação.
    el.addEventListener('animationend', () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 400);
  };
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(dismiss, duration);
  };
  el.addEventListener('mouseenter', () => clearTimeout(timer));
  el.addEventListener('mouseleave', arm);
  el.addEventListener('click', dismiss);
  arm();
}

// atalho pros erros — mensagem amigável (chave i18n) + detalhe técnico
// curto entre parênteses, quando houver (err.name costuma dizer mais que a
// mensagem: NotAllowedError, SecurityError...).
export function showError(i18nKey, err) {
  const detail = err?.name && err.name !== 'Error' ? err.name : err?.message;
  showToast(detail ? `${t(i18nKey)} (${String(detail).slice(0, 60)})` : t(i18nKey), { kind: 'error', duration: 6000 });
}
