// Tenta transformar um SVG enviado pelo usuário numa forma vetorial de verdade
// (recolorível, editável no export) — só aceita SVGs "simples": sem gradiente,
// padrão, filtro, imagem embutida ou referências externas, e com um número
// razoável de elementos. Qualquer coisa fora disso retorna null, e quem chamou
// deve cair de volta pro método de máscara/raster (funciona com qualquer arquivo).

const MAX_ELEMENTS = 500;

// Allowlist, não blocklist: só elementos puramente geométricos passam. Isso barra
// <script>, <foreignObject>, <use>/<image> (referências externas), <a> (href
// javascript:), animações SMIL (onbegin/onend) e qualquer outra superfície de
// injeção sem precisar prever cada vetor de ataque individualmente.
const ALLOWED_TAGS = new Set(['g', 'path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'line', 'title', 'desc']);

const ALLOWED_ATTRS = new Set([
  'd', 'x', 'y', 'width', 'height', 'cx', 'cy', 'r', 'rx', 'ry', 'x1', 'y1', 'x2', 'y2', 'points',
  'transform', 'fill', 'stroke', 'stroke-width', 'fill-rule', 'clip-rule', 'opacity', 'fill-opacity',
  'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'style',
]);

function parseViewBox(root) {
  const vb = root.getAttribute('viewBox');
  if (vb) {
    const parts = vb.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n)) && parts[2] > 0 && parts[3] > 0) {
      return { minX: parts[0], minY: parts[1], width: parts[2], height: parts[3] };
    }
  }
  const w = parseFloat(root.getAttribute('width'));
  const h = parseFloat(root.getAttribute('height'));
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    return { minX: 0, minY: 0, width: w, height: h };
  }
  return null;
}

function sanitizeColorAttr(el, attr) {
  const value = el.getAttribute(attr);
  if (value === null) return;
  if (value.trim().toLowerCase() === 'none') return;
  el.removeAttribute(attr);
}

function sanitizeStyleAttr(el) {
  const style = el.getAttribute('style');
  if (!style) return;
  const kept = style
    .split(';')
    .map((decl) => decl.trim())
    .filter(Boolean)
    .filter((decl) => {
      const [prop, val] = decl.split(':').map((s) => (s || '').trim().toLowerCase());
      if (prop === 'fill' || prop === 'stroke') return val === 'none';
      return true;
    });
  if (kept.length) el.setAttribute('style', kept.join('; '));
  else el.removeAttribute('style');
}

export function sanitizeSvgForRecolor(svgText) {
  let doc;
  try {
    doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  } catch (err) {
    return null;
  }
  if (doc.querySelector('parsererror')) return null;

  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg') return null;

  const allElements = root.querySelectorAll('*');
  if (allElements.length === 0 || allElements.length > MAX_ELEMENTS) return null;
  if (Array.from(allElements).some((el) => !ALLOWED_TAGS.has(el.nodeName.toLowerCase()))) return null;

  const viewBox = parseViewBox(root);
  if (!viewBox) return null;

  allElements.forEach((el) => {
    Array.from(el.attributes).forEach((attr) => {
      if (!ALLOWED_ATTRS.has(attr.name.toLowerCase())) el.removeAttribute(attr.name);
    });
    sanitizeColorAttr(el, 'fill');
    sanitizeColorAttr(el, 'stroke');
    sanitizeStyleAttr(el);
  });

  return { viewBox, innerMarkup: root.innerHTML };
}
