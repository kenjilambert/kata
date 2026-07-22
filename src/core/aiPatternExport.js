import { downloadBlob } from './export.js';

// Converte o SVG do mosaico (já gerado, "Padrão sem emenda" ligado) num PDF
// com um Tiling Pattern DE VERDADE (PatternType 1 do PDF puro — a mesma
// estrutura que o próprio Illustrator usa por baixo dos panos quando salva
// um pattern com "Create PDF Compatible File" ligado). Abrindo esse arquivo
// no Illustrator, o preenchimento do retângulo já deve aparecer como pattern
// reconhecido, pronto pra virar swatch.
//
// Suporta só o que o Kata realmente desenha (visto direto em shapes.js/
// generator.js): <rect>/<polygon>/<circle>/<path> com M/L/H/V/C/A/Z,
// fill OU stroke direto (nunca herdado de um <g> ancestral), fill-rule
// evenodd, e transform="translate(...)"/"rotate(...)" (nada de scale/skew,
// que o Kata não emite pros ícones nativos). Formas customizadas (ícone
// colado/enviado pelo usuário, que usa <mask>/<image>) não são suportadas
// aqui — a célula fica em branco no PDF nesse caso.

const IDENTITY = [1, 0, 0, 1, 0, 0];

// formas com "buraco" (anel, círculo, prisma, canto cortado, arco invertido)
// desenham um contorno externo (bate exato com a célula vizinha) + um
// recorte interno subtraído via evenodd. O antialiasing de renderizadores
// vetoriais (Illustrator incluso) pode deixar escapar uma fresta do fundo
// bem em cima da curva do recorte — um traço "reforçando por dentro" não
// resolve (só repinta área que já era preenchida, nunca chega na fresta,
// que fica do lado de FORA do recorte). A correção real é encolher o
// recorte em si por uma fração mínima, em direção ao próprio centro, pra o
// preenchimento cobrir um pouco além da linha teórica.
const HOLE_SHRINK_FACTOR = 0.985;

function matMul(A, B) {
  const [a1, b1, c1, d1, e1, f1] = A;
  const [a2, b2, c2, d2, e2, f2] = B;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

function applyMatrix([a, b, c, d, e, f], x, y) {
  return { x: a * x + c * y + e, y: b * x + d * y + f };
}

function translateMatrix(tx, ty) {
  return [1, 0, 0, 1, tx, ty];
}

function rotateMatrix(deg, cx = 0, cy = 0) {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rot = [cos, sin, -sin, cos, 0, 0];
  if (!cx && !cy) return rot;
  return matMul(matMul(translateMatrix(cx, cy), rot), translateMatrix(-cx, -cy));
}

// só translate()/rotate() — o único subconjunto de `transform` que o Kata
// emite pros ícones nativos (conferido em shapes.js e generator.js).
function parseTransform(str) {
  let m = IDENTITY;
  if (!str) return m;
  const re = /(\w+)\(([^)]*)\)/g;
  let match;
  while ((match = re.exec(str))) {
    const args = match[2]
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    if (match[1] === 'translate') {
      m = matMul(m, translateMatrix(args[0] || 0, args[1] || 0));
    } else if (match[1] === 'rotate') {
      m = matMul(m, rotateMatrix(args[0] || 0, args[1] || 0, args[2] || 0));
    }
  }
  return m;
}

function parseColor(str) {
  if (!str || str === 'none') return null;
  const m6 = /^#([0-9a-f]{6})$/i.exec(str.trim());
  if (m6) {
    const n = parseInt(m6[1], 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  const m3 = /^#([0-9a-f]{3})$/i.exec(str.trim());
  if (m3) {
    return m3[1].split('').map((c) => parseInt(c + c, 16) / 255);
  }
  return [0, 0, 0];
}

// o degradê interno de cada forma (ver src/modules/grid-icons/generator.js)
// usa fill="url(#id)" referenciando um <linearGradient> — este exportador
// não suporta gradientes/sombreamento de verdade em PDF (Shading Patterns
// ficam de fora de propósito, escopo grande demais). Em vez de a forma
// sumir (parseColor retornaria null pra um valor "url(...)"), usa a cor do
// PRIMEIRO stop como aproximação sólida — a forma continua visível no
// pattern exportado, só sem o degradê.
function resolveFillColor(fillStr, doc) {
  if (!fillStr) return null;
  const m = /^url\(#([^)]+)\)$/.exec(fillStr.trim());
  if (!m) return parseColor(fillStr);
  const gradEl = doc.querySelector(`[id="${m[1]}"]`);
  const firstStop = gradEl?.querySelector('stop');
  return parseColor(firstStop?.getAttribute('stop-color') || null);
}

// arco elíptico do SVG (parametrização por extremos, apêndice F.6 da spec)
// convertido em curvas de Bézier cúbicas — PDF não tem operador de arco.
function arcToBeziers(x1, y1, rx, ry, xAxisRotationDeg, largeArcFlag, sweepFlag, x2, y2) {
  if (rx === 0 || ry === 0) return [{ x1, y1, x2: x2, y2: y2, x: x2, y: y2 }];
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const phi = (xAxisRotationDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  const dx2 = (x1 - x2) / 2;
  const dy2 = (y1 - y2) / 2;
  const x1p = cosPhi * dx2 + sinPhi * dy2;
  const y1p = -sinPhi * dx2 + cosPhi * dy2;

  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }

  const sign = largeArcFlag !== sweepFlag ? 1 : -1;
  const num_ = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const co = sign * Math.sqrt(Math.max(0, num_ / den));
  const cxp = (co * rx * y1p) / ry;
  const cyp = (-co * ry * x1p) / rx;

  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;

  function angleBetween(ux, uy, vx, vy) {
    const dot = ux * vx + uy * vy;
    const len = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy));
    let ang = Math.acos(Math.min(1, Math.max(-1, dot / len)));
    if (ux * vy - uy * vx < 0) ang = -ang;
    return ang;
  }

  const ux = (x1p - cxp) / rx;
  const uy = (y1p - cyp) / ry;
  const vx = (-x1p - cxp) / rx;
  const vy = (-y1p - cyp) / ry;
  let theta1 = angleBetween(1, 0, ux, uy);
  let dtheta = angleBetween(ux, uy, vx, vy);
  if (!sweepFlag && dtheta > 0) dtheta -= 2 * Math.PI;
  if (sweepFlag && dtheta < 0) dtheta += 2 * Math.PI;

  const segCount = Math.max(1, Math.ceil(Math.abs(dtheta) / (Math.PI / 2)));
  const delta = dtheta / segCount;
  const beziers = [];
  let theta = theta1;
  for (let i = 0; i < segCount; i++) {
    const theta2 = theta + delta;
    const t = Math.tan(delta / 2);
    const alpha = (Math.sin(delta) * (Math.sqrt(4 + 3 * t * t) - 1)) / 3;

    const p1 = { x: Math.cos(theta), y: Math.sin(theta) };
    const p2 = { x: Math.cos(theta2), y: Math.sin(theta2) };
    const q1 = { x: p1.x - alpha * Math.sin(theta), y: p1.y + alpha * Math.cos(theta) };
    const q2 = { x: p2.x + alpha * Math.sin(theta2), y: p2.y - alpha * Math.cos(theta2) };

    const toEllipse = (p) => ({
      x: cosPhi * rx * p.x - sinPhi * ry * p.y + cx,
      y: sinPhi * rx * p.x + cosPhi * ry * p.y + cy,
    });
    const c1 = toEllipse(q1);
    const c2 = toEllipse(q2);
    const end = toEllipse(p2);
    beziers.push({ x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y, x: end.x, y: end.y });
    theta = theta2;
  }
  return beziers;
}

// só M/L/H/V/C/A/Z, todos absolutos (é tudo que shapes.js emite) — cada
// arco (A) já sai desta função convertido em uma ou mais curvas (C).
function parsePathD(d) {
  const tokens = d.match(/[MLCAZHV]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || [];
  const subpaths = [];
  let current = null;
  let cx = 0;
  let cy = 0;
  let startX = 0;
  let startY = 0;
  let i = 0;
  let cmd = null;

  function startSubpath(x, y) {
    current = [{ op: 'm', x, y }];
    subpaths.push(current);
    startX = x;
    startY = y;
    cx = x;
    cy = y;
  }
  function lineTo(x, y) {
    current.push({ op: 'l', x, y });
    cx = x;
    cy = y;
  }
  function curveTo(x1, y1, x2, y2, x, y) {
    current.push({ op: 'c', x1, y1, x2, y2, x, y });
    cx = x;
    cy = y;
  }

  while (i < tokens.length) {
    if (/^[MLCAZHV]$/i.test(tokens[i])) {
      cmd = tokens[i].toUpperCase();
      i++;
    }
    switch (cmd) {
      case 'M':
        startSubpath(+tokens[i], +tokens[i + 1]);
        i += 2;
        break;
      case 'L':
        lineTo(+tokens[i], +tokens[i + 1]);
        i += 2;
        break;
      case 'H':
        lineTo(+tokens[i], cy);
        i += 1;
        break;
      case 'V':
        lineTo(cx, +tokens[i]);
        i += 1;
        break;
      case 'C':
        curveTo(+tokens[i], +tokens[i + 1], +tokens[i + 2], +tokens[i + 3], +tokens[i + 4], +tokens[i + 5]);
        i += 6;
        break;
      case 'A': {
        const rx = +tokens[i];
        const ry = +tokens[i + 1];
        const rot = +tokens[i + 2];
        const large = +tokens[i + 3];
        const sweep = +tokens[i + 4];
        const ex = +tokens[i + 5];
        const ey = +tokens[i + 6];
        i += 7;
        arcToBeziers(cx, cy, rx, ry, rot, large, sweep, ex, ey).forEach((b) =>
          curveTo(b.x1, b.y1, b.x2, b.y2, b.x, b.y)
        );
        break;
      }
      case 'Z':
        if (current) current.push({ op: 'h' });
        cx = startX;
        cy = startY;
        break;
      default:
        i++;
    }
  }
  return subpaths;
}

function rectToSubpaths(el) {
  const x = parseFloat(el.getAttribute('x')) || 0;
  const y = parseFloat(el.getAttribute('y')) || 0;
  const w = parseFloat(el.getAttribute('width')) || 0;
  const h = parseFloat(el.getAttribute('height')) || 0;
  return [
    [
      { op: 'm', x, y },
      { op: 'l', x: x + w, y },
      { op: 'l', x: x + w, y: y + h },
      { op: 'l', x, y: y + h },
      { op: 'h' },
    ],
  ];
}

function polygonToSubpaths(el) {
  const pts = (el.getAttribute('points') || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((pair) => {
      const [px, py] = pair.split(',').map(Number);
      return { x: px, y: py };
    });
  if (!pts.length) return [];
  const sub = [{ op: 'm', x: pts[0].x, y: pts[0].y }];
  for (let i = 1; i < pts.length; i++) sub.push({ op: 'l', x: pts[i].x, y: pts[i].y });
  sub.push({ op: 'h' });
  return [sub];
}

function circleToSubpaths(el) {
  const cx = parseFloat(el.getAttribute('cx')) || 0;
  const cy = parseFloat(el.getAttribute('cy')) || 0;
  const r = parseFloat(el.getAttribute('r')) || 0;
  const k = 0.5522847498;
  return [
    [
      { op: 'm', x: cx + r, y: cy },
      { op: 'c', x1: cx + r, y1: cy + r * k, x2: cx + r * k, y2: cy + r, x: cx, y: cy + r },
      { op: 'c', x1: cx - r * k, y1: cy + r, x2: cx - r, y2: cy + r * k, x: cx - r, y: cy },
      { op: 'c', x1: cx - r, y1: cy - r * k, x2: cx - r * k, y2: cy - r, x: cx, y: cy - r },
      { op: 'c', x1: cx + r * k, y1: cy - r, x2: cx + r, y2: cy - r * k, x: cx + r, y: cy },
      { op: 'h' },
    ],
  ];
}

function centroidOf(subpath) {
  let sx = 0;
  let sy = 0;
  let n = 0;
  subpath.forEach((seg) => {
    if (seg.op === 'h') return;
    sx += seg.x;
    sy += seg.y;
    n++;
    if (seg.op === 'c') {
      sx += seg.x1 + seg.x2;
      sy += seg.y1 + seg.y2;
      n += 2;
    }
  });
  return n ? { x: sx / n, y: sy / n } : { x: 0, y: 0 };
}

function scaleSubpathToward(subpath, factor, center) {
  const scalePt = (px, py) => ({ x: center.x + (px - center.x) * factor, y: center.y + (py - center.y) * factor });
  return subpath.map((seg) => {
    if (seg.op === 'h') return seg;
    if (seg.op === 'c') {
      const p1 = scalePt(seg.x1, seg.y1);
      const p2 = scalePt(seg.x2, seg.y2);
      const p = scalePt(seg.x, seg.y);
      return { op: 'c', x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, x: p.x, y: p.y };
    }
    const p = scalePt(seg.x, seg.y);
    return { op: seg.op, x: p.x, y: p.y };
  });
}

function shapeElementToSubpaths(el) {
  switch (el.tagName.toLowerCase()) {
    case 'rect':
      return rectToSubpaths(el);
    case 'polygon':
      return polygonToSubpaths(el);
    case 'circle':
      return circleToSubpaths(el);
    case 'path':
      return parsePathD(el.getAttribute('d') || '');
    default:
      return [];
  }
}

function transformSubpaths(subpaths, m) {
  return subpaths.map((sp) =>
    sp.map((seg) => {
      if (seg.op === 'h') return seg;
      if (seg.op === 'c') {
        const p1 = applyMatrix(m, seg.x1, seg.y1);
        const p2 = applyMatrix(m, seg.x2, seg.y2);
        const p = applyMatrix(m, seg.x, seg.y);
        return { op: 'c', x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, x: p.x, y: p.y };
      }
      const p = applyMatrix(m, seg.x, seg.y);
      return { op: seg.op, x: p.x, y: p.y };
    })
  );
}

function num(n) {
  return n.toFixed(3);
}

// SVG cresce pra baixo, PDF cresce pra cima — inverter Y é o suficiente pra
// manter a orientação certa desde que TODO ponto (incluindo pontos de
// controle de curva) passe por aqui, o que subpathsToPdfOps garante.
function subpathsToPdfOps(subpaths, tileH) {
  const flip = (y) => tileH - y;
  const lines = [];
  subpaths.forEach((sp) => {
    sp.forEach((seg) => {
      if (seg.op === 'm') lines.push(`${num(seg.x)} ${num(flip(seg.y))} m`);
      else if (seg.op === 'l') lines.push(`${num(seg.x)} ${num(flip(seg.y))} l`);
      else if (seg.op === 'c') {
        lines.push(
          `${num(seg.x1)} ${num(flip(seg.y1))} ${num(seg.x2)} ${num(flip(seg.y2))} ${num(seg.x)} ${num(flip(seg.y))} c`
        );
      } else if (seg.op === 'h') lines.push('h');
    });
  });
  return lines.join('\n');
}

function drawLeaf(el, matrix, ops, tileH) {
  const fill = el.getAttribute('fill');
  const stroke = el.getAttribute('stroke');
  const strokeWidth = parseFloat(el.getAttribute('stroke-width')) || 1;
  const evenOdd = el.getAttribute('fill-rule') === 'evenodd';

  let localSubpaths = shapeElementToSubpaths(el);
  // subpath 0 é sempre o contorno externo (bate exato com a célula vizinha
  // — não pode mudar); subpaths seguintes são o recorte vazado (o "buraco").
  // Encolhe só o recorte, em direção ao próprio centro, pra fechar a fresta
  // de antialiasing na curva (ver comentário de HOLE_SHRINK_FACTOR).
  if (evenOdd && localSubpaths.length > 1) {
    localSubpaths = localSubpaths.map((sp, idx) =>
      idx === 0 ? sp : scaleSubpathToward(sp, HOLE_SHRINK_FACTOR, centroidOf(sp))
    );
  }

  const subpaths = transformSubpaths(localSubpaths, matrix);
  if (!subpaths.length) return;
  const pathOps = subpathsToPdfOps(subpaths, tileH);

  if (fill === 'none' && stroke && stroke !== 'none') {
    const color = parseColor(stroke) || [0, 0, 0];
    ops.push('q');
    ops.push(`${num(color[0])} ${num(color[1])} ${num(color[2])} RG`);
    ops.push(`${num(strokeWidth)} w`);
    ops.push(pathOps);
    ops.push('S');
    ops.push('Q');
    return;
  }

  const color = resolveFillColor(fill, el.ownerDocument);
  if (!color) return; // sem fill nem stroke usável (ex.: forma customizada não suportada aqui)
  ops.push('q');
  ops.push(`${num(color[0])} ${num(color[1])} ${num(color[2])} rg`);
  ops.push(pathOps);
  ops.push(evenOdd ? 'f*' : 'f');
  ops.push('Q');
}

// clip-path é sempre ignorado de propósito nesta exportação — ele existe no
// SVG só como proteção defensiva contra vazamento em rotações arbitrárias
// (que a UI atual nem permite: pattern.rotation trava em 0/90/180/270°, e o
// clip por célula do mosaico é redundante sob essa restrição). Recortar
// (clip) introduz a PRÓPRIA costura de antialiasing na borda do recorte em
// renderizadores vetoriais como o Illustrator — sem nenhum ganho real hoje,
// só pioraria a repetição sem emenda. Se a UI algum dia expuser rotação
// livre, revisitar isso (precisaria de um recorte que não vaze).
function walk(el, matrix, ops, tileH) {
  const tag = el.tagName ? el.tagName.toLowerCase() : '';
  if (tag === 'defs' || tag === 'clippath' || tag === 'mask') return;

  const own = parseTransform(el.getAttribute && el.getAttribute('transform'));
  const effective = matMul(matrix, own);

  if (['rect', 'polygon', 'circle', 'path'].includes(tag)) {
    drawLeaf(el, effective, ops, tileH);
  } else {
    Array.from(el.children || []).forEach((child) => walk(child, effective, ops, tileH));
  }
}

function buildPatternContentStream(svgDoc, tileH) {
  const ops = [];
  Array.from(svgDoc.documentElement.children).forEach((child) => walk(child, IDENTITY, ops, tileH));
  return ops.join('\n');
}

function buildPdf(contentStream, tileW, tileH) {
  const W = num(tileW);
  const H = num(tileH);
  const pageContentStream = `q\n/Pattern cs /P0 scn\n0 0 ${W} ${H} re\nf\nQ`;

  let pdf = '%PDF-1.4\n';
  const offsets = {};

  function addDictObject(n, dictBody) {
    offsets[n] = pdf.length;
    pdf += `${n} 0 obj\n${dictBody}\nendobj\n`;
  }
  function addStreamObject(n, dictOpenBody, streamText) {
    offsets[n] = pdf.length;
    const dict = `${dictOpenBody} /Length ${streamText.length} >>`;
    pdf += `${n} 0 obj\n${dict}\nstream\n${streamText}\nendstream\nendobj\n`;
  }

  addDictObject(1, '<< /Type /Catalog /Pages 2 0 R >>');
  addDictObject(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  addDictObject(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Pattern << /P0 5 0 R >> >> /Contents 4 0 R >>`
  );
  addStreamObject(4, '<<', pageContentStream);
  addStreamObject(
    5,
    `<< /Type /Pattern /PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 ${W} ${H}] /XStep ${W} /YStep ${H} /Resources <<>>`,
    contentStream
  );

  const xrefOffset = pdf.length;
  const count = 6; // objetos 1..5 + a entrada 0 (cabeça da lista livre)
  let xref = `xref\n0 ${count}\n0000000000 65535 f\r\n`;
  for (let n = 1; n < count; n++) {
    xref += `${String(offsets[n]).padStart(10, '0')} 00000 n\r\n`;
  }
  pdf += xref;
  pdf += `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return pdf;
}

export function exportSeamlessPatternAsAi(svgString, filename = 'padrao.ai') {
  const doc = new DOMParser().parseFromString(svgString, 'image/svg+xml');
  const root = doc.documentElement;
  const tileW = parseFloat(root.getAttribute('width'));
  const tileH = parseFloat(root.getAttribute('height'));

  const contentStream = buildPatternContentStream(doc, tileH);
  const pdfText = buildPdf(contentStream, tileW, tileH);

  const blob = new Blob([pdfText], { type: 'application/pdf' });
  downloadBlob(blob, filename);
}
