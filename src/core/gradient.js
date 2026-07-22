// Resolve um "fator de gradiente" (0 a 1) pra qualquer ponto normalizado
// (nx, ny) num quadrado unitário — usado hoje pela máscara de densidade do
// Mosaico, sobre coordenadas de TILE em vez de célula. É a mesma ideia do
// gradientFactorFor() que já existe em modules/grid-icons/generator.js (que
// só cobre 8 direções pré-definidas), mas com ângulo contínuo pra dar
// controle mais preciso de direção. Escrito como função pura e independente
// de onde nx/ny vêm, pra caber tanto célula quanto tile — e extensível: um
// novo "shape" é só mais um caso no switch, sem precisar mudar quem chama.
function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

// projeta o ponto (centralizado em 0) na direção do ângulo e normaliza pela
// maior projeção possível (a de um dos 4 cantos do quadrado) — devolve um
// valor de -1 a 1 (não normalizado pra 0..1 ainda), reaproveitado tanto pelo
// linear (que remapeia pra 0..1 de ponta a ponta) quanto pelo refletido (que
// usa o valor absoluto, espelhando as duas pontas).
function signedLinearProjection(angleDeg, nx, ny) {
  const rad = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  const proj = (nx - 0.5) * dx + (ny - 0.5) * dy;
  const maxProj = 0.5 * (Math.abs(dx) + Math.abs(dy)) || 1;
  return proj / maxProj;
}

function resolveLinearFactor(angleDeg, nx, ny) {
  return clamp01((signedLinearProjection(angleDeg, nx, ny) + 1) / 2);
}

// espelha o gradiente linear nas duas pontas a partir do centro — igual ao
// "reflected gradient" do Photoshop: 0 bem no meio (na linha perpendicular
// à direção, passando pelo centro), subindo pra 1 nas duas bordas opostas.
function resolveReflectedFactor(angleDeg, nx, ny) {
  return clamp01(Math.abs(signedLinearProjection(angleDeg, nx, ny)));
}

function resolveRadialFactor(centerX, centerY, mode, nx, ny) {
  const corners = [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ];
  const maxDist = Math.max(...corners.map(([cx, cy]) => Math.hypot(cx - centerX, cy - centerY))) || 1;
  const dist = clamp01(Math.hypot(nx - centerX, ny - centerY) / maxDist);
  // 'edge-out': o valor alto fica na borda, baixo no centro (irradia "pra dentro").
  // 'center-out' (padrão): o valor alto fica no centro, baixo na borda (irradia "pra fora").
  return mode === 'edge-out' ? dist : 1 - dist;
}

export function resolveGradientFactor(config, nx, ny) {
  const { shape = 'linear', angleDeg = 0, centerX = 0.5, centerY = 0.5, mode = 'center-out' } = config ?? {};
  switch (shape) {
    case 'radial':
      return resolveRadialFactor(centerX, centerY, mode, nx, ny);
    case 'reflected':
      return resolveReflectedFactor(angleDeg, nx, ny);
    case 'linear':
    default:
      return resolveLinearFactor(angleDeg, nx, ny);
  }
}

// representação visual (CSS background) de cada forma de gradiente, pra
// mostrar um ícone de prévia no seletor — mesmo espírito das bolinhas de cor
// no combo de temas do Azulejo, só que aqui é a FORMA do gradiente, não a
// paleta.
export function gradientPreviewBackground(shape) {
  switch (shape) {
    case 'radial':
      return 'radial-gradient(circle, var(--accent) 0%, transparent 75%)';
    case 'reflected':
      return 'linear-gradient(90deg, var(--accent), transparent, var(--accent))';
    case 'linear':
    default:
      return 'linear-gradient(90deg, transparent, var(--accent))';
  }
}
