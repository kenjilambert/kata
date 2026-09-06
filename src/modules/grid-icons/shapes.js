// fill e stroke são independentes (ver patternState.js) — cada um só entra
// no atributo se estiver ligado, e os dois podem estar juntos na MESMA tag
// (algo novo: antes "outline" era só stroke, nunca fill+stroke ao mesmo
// tempo). paintStrokeWidth (quando presente) é a espessura do TRAÇO
// desenhado em px ABSOLUTOS (já vem pronta de renderGridToSvg, escalada pela
// referência de tamanho do ícone — não pela célula), separada do strokeWidth
// "geométrico" que formas como cruz/anel/xis usam pra decidir a própria forma
// (espessura da barra/anel, essa sim proporcional à célula) — sem essa
// separação, o traço decorativo ficava mais grosso ou mais fino conforme a
// resolução da grade, em vez de sempre parecer do mesmo tamanho.
// espessura NOMINAL (a que realmente aparece) a partir do valor que chega em
// style.paintStrokeWidth — vindo de renderGridToSvg esse valor já é o DOBRO
// do nominal (pensado pro esquema antigo de "risca dobrado e recorta pela
// metade de dentro"); formas circulares (arco, disco...) não usam mais esse
// esquema pra suas curvas — desenham o próprio arco/círculo já encolhido pra
// dentro no raio certo, então só precisam da metade. Sem paintStrokeWidth
// (chamada direta, fora do pipeline do gerador) o valor já é o nominal.
function nominalStrokeWidth(size, style) {
  return style?.paintStrokeWidth != null
    ? Math.max(0.25, style.paintStrokeWidth / 2)
    : Math.max(1, size * (style?.strokeWidth ?? 0.22) * 0.4);
}

function paintAttrs(size, color, style) {
  const fillOn = style?.fillEnabled ?? true;
  const strokeOn = style?.strokeEnabled ?? false;
  const parts = [fillOn ? `fill="${style?.gradientFillId ? `url(#${style.gradientFillId})` : color}"` : 'fill="none"'];
  if (strokeOn) {
    const strokeColor = style?.strokeColor ?? color;
    const sw =
      style?.paintStrokeWidth != null
        ? Math.max(0.5, style.paintStrokeWidth)
        : Math.max(1, size * (style?.strokeWidth ?? 0.22) * 0.4);
    parts.push(`stroke="${strokeColor}" stroke-width="${sw}"`);
  }
  return parts.join(' ');
}

function square(size, color, style) {
  return `<rect x="0" y="0" width="${size}" height="${size}" ${paintAttrs(size, color, style)} />`;
}

const TRIANGLE_POINTS = {
  tl: (s) => `0,0 ${s},0 0,${s}`,
  tr: (s) => `${s},0 ${s},${s} 0,0`,
  br: (s) => `${s},${s} 0,${s} ${s},0`,
  bl: (s) => `0,${s} 0,0 ${s},${s}`,
};

function triangle(size, color, orientation = 'tl', style) {
  return `<polygon points="${TRIANGLE_POINTS[orientation](size)}" ${paintAttrs(size, color, style)} />`;
}

function diamond(size, color, style) {
  const p = size / 2;
  return `<path d="M ${p} 0 L ${size} ${p} L ${p} ${size} L 0 ${p} Z" ${paintAttrs(size, color, style)} />`;
}

const QUARTER_ARC = {
  tl: (s) => `M 0 0 L ${s} 0 A ${s} ${s} 0 0 1 0 ${s} Z`,
  tr: (s) => `M ${s} 0 L ${s} ${s} A ${s} ${s} 0 0 1 0 0 Z`,
  br: (s) => `M ${s} ${s} L 0 ${s} A ${s} ${s} 0 0 1 ${s} 0 Z`,
  bl: (s) => `M 0 ${s} L 0 0 A ${s} ${s} 0 0 1 ${s} ${s} Z`,
};

// centro (um dos 4 cantos da célula) e os dois pontos-extremos (a raio = size
// desse centro) que definem o arco de cada orientação — usado só pra desenhar
// o TRAÇO da curva já no raio certo (ver insetArcPath), em vez do esquema
// antigo (arco no raio ORIGINAL, dobrado de largura, recortado por fora): os
// dois raios (interno/externo do traço dobrado) e o raio do recorte coincidiam
// exatamente um em cima do outro, e o navegador tem que suavizar (anti-alias)
// DUAS bordas curvas sobrepostas na mesma linha — o resultado media pra uma
// faixa bem mais grossa e borrada que um traço reto do mesmo tamanho nominal.
// Desenhando o arco já no raio final (encolhido/esticado pela metade da
// espessura, sem nenhum recorte em cima) evita essa sobreposição.
const CORNER_CENTER = { tl: [0, 0], tr: [1, 0], bl: [0, 1], br: [1, 1] };
const CORNER_ENDPOINTS = {
  tl: [[1, 0], [0, 1]],
  tr: [[1, 1], [0, 0]],
  br: [[0, 1], [1, 0]],
  bl: [[0, 0], [1, 1]],
};
function insetArcPath(size, orientation, radius) {
  const [cx, cy] = CORNER_CENTER[orientation].map((v) => v * size);
  const [[x1, y1], [x2, y2]] = CORNER_ENDPOINTS[orientation].map(([x, y]) => [x * size, y * size]);
  const scale = radius / size;
  const p1 = [cx + (x1 - cx) * scale, cy + (y1 - cy) * scale];
  const p2 = [cx + (x2 - cx) * scale, cy + (y2 - cy) * scale];
  return `M ${p1[0]} ${p1[1]} A ${radius} ${radius} 0 0 1 ${p2[0]} ${p2[1]}`;
}

// só os dois lados retos do "contorno" do arco invertido (sem a curva) — a curva do traço
// é desenhada à parte por insetArcPath, no raio certo (ver comentário ali).
const QUARTER_INVERSE_STRAIGHT = {
  tl: (s) => `M ${s} 0 L ${s} ${s} L 0 ${s}`,
  tr: (s) => `M ${s} ${s} L 0 ${s} L 0 0`,
  br: (s) => `M ${s} 0 L 0 0 L 0 ${s}`,
  bl: (s) => `M 0 0 L ${s} 0 L ${s} ${s}`,
};

// arco e arco invertido têm geometria de contorno própria (só a curva/aresta
// que faz sentido, não o quadrado da célula inteira) — por isso, diferente
// das outras formas, fill e stroke aqui são DOIS <path> separados (cada um
// só entra se o respectivo toggle estiver ligado), em vez de um paintAttrs()
// só numa tag. O recorte/dobra de largura que dá o efeito "traço pra dentro"
// continua sendo feito de fora (generator.js), igual pra qualquer forma —
// só a GEOMETRIA do traço (curva em vez de contorno inteiro) é especial aqui.
function quarterCircle(size, color, orientation = 'tl', style) {
  const fillOn = style?.fillEnabled ?? true;
  const strokeOn = style?.strokeEnabled ?? false;
  let markup = '';
  if (fillOn) {
    const fillPaint = style?.gradientFillId ? `url(#${style.gradientFillId})` : color;
    markup += `<path d="${QUARTER_ARC[orientation](size)}" fill="${fillPaint}" />`;
  }
  if (strokeOn) {
    const strokeColor = style?.strokeColor ?? color;
    const sw = nominalStrokeWidth(size, style);
    // arco desenhado no raio final (encolhido pra dentro por metade da
    // espessura) em vez do raio original + recorte externo — ver comentário
    // em CORNER_CENTER/insetArcPath.
    markup += `<path d="${insetArcPath(size, orientation, size - sw / 2)}" fill="none" stroke="${strokeColor}" stroke-width="${sw}" />`;
  }
  return markup;
}

function quarterCircleInverse(size, color, orientation = 'tl', style) {
  const fillOn = style?.fillEnabled ?? true;
  const strokeOn = style?.strokeEnabled ?? false;
  let markup = '';
  if (fillOn) {
    const fillPaint = style?.gradientFillId ? `url(#${style.gradientFillId})` : color;
    const outer = `M 0 0 L ${size} 0 L ${size} ${size} L 0 ${size} Z`;
    const inner = QUARTER_ARC[orientation](size);
    markup += `<path d="${outer} ${inner}" fill-rule="evenodd" fill="${fillPaint}" />`;
  }
  if (strokeOn) {
    const strokeColor = style?.strokeColor ?? color;
    const sw = nominalStrokeWidth(size, style);
    // lados retos: continuam no esquema antigo (dobro da espessura, recorte
    // externo cuida de encolher pra dentro) — não têm o problema de curva,
    // já que o recorte ali é feito por generator.js em cima da silhueta
    // inteira, não numa borda coincidente com o próprio traço reto.
    const straightSw = style?.paintStrokeWidth != null ? Math.max(0.5, style.paintStrokeWidth) : sw;
    markup += `<path d="${QUARTER_INVERSE_STRAIGHT[orientation](size)}" fill="none" stroke="${strokeColor}" stroke-width="${straightSw}" />`;
    // a curva do "corte" fica FORA do círculo original (a fatia sobrando é a
    // parte de fora do arco) — por isso o raio aqui cresce em vez de encolher.
    markup += `<path d="${insetArcPath(size, orientation, size + sw / 2)}" fill="none" stroke="${strokeColor}" stroke-width="${sw}" />`;
  }
  return markup;
}

function cross(size, color, style) {
  // +0.1 fixo por cima do controle compartilhado de espessura: a cruz sempre foi
  // desenhada mais grossa que um traço fino comum, e ficou fina "do nada" quando
  // passou a usar o mesmo strokeWidth sem esse reforço. 0.22 de fallback (não
  // 0.24) só por consistência com o resto do arquivo (paintAttrs, ring) —
  // na prática strokeWidth sempre vem preenchido de renderGridToSvg.
  const thickness = size * ((style?.strokeWidth ?? 0.22) + 0.1);
  const offset = (size - thickness) / 2;
  const attrs = paintAttrs(size, color, style);
  return (
    `<rect x="0" y="${offset}" width="${size}" height="${thickness}" ${attrs} />` +
    `<rect x="${offset}" y="0" width="${thickness}" height="${size}" ${attrs} />`
  );
}

function ring(size, color, style) {
  const t = size * (style?.strokeWidth ?? 0.22);
  return `<path d="M0,0 H${size} V${size} H0 Z M${t},${t} H${size - t} V${size - t} H${t} Z" fill-rule="evenodd" ${paintAttrs(size, color, style)} />`;
}

function dot(size, color, style) {
  const c = size / 2;
  const r = size * 0.22;
  return `<circle cx="${c}" cy="${c}" r="${r}" ${paintAttrs(size, color, style)} />`;
}

function diagonalCross(size, color, style) {
  const c = size / 2;
  const thickness = size * (style?.strokeWidth ?? 0.2);
  // comprimento size*sqrt2 faz a LINHA DE CENTRO da barra encostar no canto,
  // mas a barra tem espessura — os CANTOS do retângulo (não a linha de centro)
  // ficam um pouco mais longe do que a linha de centro, e com sqrt2 cheio isso
  // já era o suficiente pra passar da borda da célula depois de girar 45°.
  // Descontar metade da espessura do comprimento traz o canto do retângulo de
  // volta pra exatamente em cima da borda, sem estourar.
  const barLength = size * Math.SQRT2 - thickness;
  const attrs = paintAttrs(size, color, style);
  const rect = `x="${c - barLength / 2}" y="${c - thickness / 2}" width="${barLength}" height="${thickness}" ${attrs}`;
  return `<rect ${rect} transform="rotate(45 ${c} ${c})" /><rect ${rect} transform="rotate(-45 ${c} ${c})" />`;
}

// círculo cheio, tocando as 4 bordas da célula (igual ao quadrado, só que
// redondo) — não confundir com "Ponto" (dot), que é um círculo pequeno
// flutuando no meio, nem com "Círculo" (circle), que é um quadrado com um
// buraco circular vazado.
function disc(size, color, style) {
  const c = size / 2;
  const fillOn = style?.fillEnabled ?? true;
  const strokeOn = style?.strokeEnabled ?? false;
  let markup = '';
  if (fillOn) {
    const fillPaint = style?.gradientFillId ? `url(#${style.gradientFillId})` : color;
    markup += `<circle cx="${c}" cy="${c}" r="${c}" fill="${fillPaint}" />`;
  }
  if (strokeOn) {
    // círculo já encolhido pra dentro por metade da espessura, em vez de um
    // único círculo no raio cheio com fill+stroke juntos (o traço nesse caso
    // metade fica pra fora, recortado depois — mesmo problema de borda curva
    // coincidente com o recorte que afetava o arco, ver insetArcPath).
    const strokeColor = style?.strokeColor ?? color;
    const sw = nominalStrokeWidth(size, style);
    markup += `<circle cx="${c}" cy="${c}" r="${Math.max(0.1, c - sw / 2)}" fill="none" stroke="${strokeColor}" stroke-width="${sw}" />`;
  }
  return markup;
}

function bowtie(size, color, style) {
  const c = size / 2;
  const attrs = paintAttrs(size, color, style);
  return (
    `<polygon points="0,0 ${size},0 ${c},${c}" ${attrs} />` +
    `<polygon points="0,${size} ${size},${size} ${c},${c}" ${attrs} />`
  );
}

function lens(size, color, style) {
  // pontas exatamente nos cantos (não mais com respiro de 10%) — igual às outras
  // formas, que encostam na borda da célula em vez de flutuar por dentro.
  const p1 = [0, 0];
  const p2 = [size, size];
  const r = size * 0.95;
  return `<path d="M ${p1[0]} ${p1[1]} A ${r} ${r} 0 0 1 ${p2[0]} ${p2[1]} A ${r} ${r} 0 0 1 ${p1[0]} ${p1[1]} Z" ${paintAttrs(size, color, style)} />`;
}

const CORNER_TRIANGLE = {
  tl: (s) => `M 0 0 L ${s * 0.5} 0 L 0 ${s * 0.5} Z`,
  tr: (s) => `M ${s} 0 L ${s} ${s * 0.5} L ${s * 0.5} 0 Z`,
  br: (s) => `M ${s} ${s} L ${s * 0.5} ${s} L ${s} ${s * 0.5} Z`,
  bl: (s) => `M 0 ${s} L 0 ${s * 0.5} L ${s * 0.5} ${s} Z`,
};

function cornerNotch(size, color, orientation = 'tl', style) {
  const outer = `M 0 0 L ${size} 0 L ${size} ${size} L 0 ${size} Z`;
  const bite = CORNER_TRIANGLE[orientation](size);
  return `<path d="${outer} ${bite}" fill-rule="evenodd" ${paintAttrs(size, color, style)} />`;
}

// estrela de 4 pontas com "cintura" côncava perto do centro — o clássico
// brilho/sparkle. Cintura mais fechada (k menor) deixa o preenchimento maior
// perto do centro, sem perder as pontas que já tocam as 4 bordas.
function sparkle(size, color, style) {
  const c = size / 2;
  const k = size * 0.11;
  const d = `M ${c} 0 C ${c + k} ${c - k} ${c + k} ${c - k} ${size} ${c} C ${c + k} ${c + k} ${c + k} ${c + k} ${c} ${size} C ${c - k} ${c + k} ${c - k} ${c + k} 0 ${c} C ${c - k} ${c - k} ${c - k} ${c - k} ${c} 0 Z`;
  return `<path d="${d}" ${paintAttrs(size, color, style)} />`;
}

// quadrado cheio com um losango vazado (girado 45°) no meio — efeito de
// prisma/gema, com fill-rule evenodd criando o "buraco" que deixa o fundo
// aparecer em forma de losango. O losango vai ponta a ponta até o meio de
// cada borda do quadrado (metade do tamanho da célula, não menor).
function prism(size, color, style) {
  const c = size / 2;
  const half = c;
  const outer = `M 0 0 L ${size} 0 L ${size} ${size} L 0 ${size} Z`;
  const inner = `M ${c} ${c - half} L ${c + half} ${c} L ${c} ${c + half} L ${c - half} ${c} Z`;
  return `<path d="${outer} ${inner}" fill-rule="evenodd" ${paintAttrs(size, color, style)} />`;
}

// estrela pontuda de várias pontas (raio externo/interno alternado) — efeito
// de explosão/estouro tipo quadrinho. Menos pontas e um raio interno maior
// deixam o desenho mais "gordo", preenchendo a célula em vez de parecer uma
// estrelinha fina flutuando no meio de um quadrado vazio.
function burst(size, color, style) {
  const c = size / 2;
  const outerR = size * 0.5;
  const innerR = size * 0.34;
  const points = 8;
  const pts = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = (Math.PI / points) * i - Math.PI / 2;
    pts.push(`${c + r * Math.cos(angle)},${c + r * Math.sin(angle)}`);
  }
  return `<polygon points="${pts.join(' ')}" ${paintAttrs(size, color, style)} />`;
}

// pontos exatos do asterisco de referência (recorte de tela do usuário),
// digitalizados de um viewBox 86x86 — 4 pontas na diagonal + 4 "forquilhas"
// de 2 pontas cada nas bordas (topo/base/esquerda/direita), com reentrâncias
// côncavas puxando pro centro entre cada ponta. Escalado proporcionalmente
// pra qualquer tamanho de célula, sem tentar recriar a fórmula à mão.
const ASTERISK_VIEWBOX = 86;
const ASTERISK_POINTS = [
  [12.5, 9.72827],
  [35, 38.7283],
  [0.5, 34.7283],
  [0.5, 52.2283],
  [35, 46.7283],
  [12.5, 76.2283],
  [27.5, 84.7283],
  [41.5, 51.2283],
  [57.5, 84.7283],
  [72, 76.2283],
  [48, 46.7283],
  [85, 52.2283],
  [85, 34.7283],
  [48, 38.7283],
  [72, 9.72827],
  [57.5, 0.728271],
  [42.5, 34.7283],
  [27.5, 0.728271],
];

function asterisk(size, color, style) {
  const k = size / ASTERISK_VIEWBOX;
  const points = ASTERISK_POINTS.map(([x, y]) => `${x * k},${y * k}`).join(' ');
  return `<polygon points="${points}" ${paintAttrs(size, color, style)} />`;
}

// ampulheta: dois semicírculos — um com a borda plana em cima (bojando pra
// baixo) e outro com a borda plana embaixo (bojando pra cima) — cada um tem
// raio igual à metade da célula, então o bojo de cada um alcança exatamente
// o ponto central, onde os dois se encontram.
function hourglass(size, color, style) {
  const c = size / 2;
  const attrs = paintAttrs(size, color, style);
  const top = `M 0 0 L ${size} 0 A ${c} ${c} 0 0 1 0 0 Z`;
  const bottom = `M ${size} ${size} L 0 ${size} A ${c} ${c} 0 0 1 ${size} ${size} Z`;
  return `<path d="${top} ${bottom}" ${attrs} />`;
}

// dois picos: dois triângulos lado a lado, cada um ocupando metade da
// largura, base na parte de baixo e ponta esticando até a borda de cima.
function twinPeaks(size, color, style) {
  const c = size / 2;
  const attrs = paintAttrs(size, color, style);
  const left = `M 0 ${size} L ${c / 2} 0 L ${c} ${size} Z`;
  const right = `M ${c} ${size} L ${c + c / 2} 0 L ${size} ${size} Z`;
  return `<path d="${left} ${right}" ${attrs} />`;
}

// quadrado cheio com um círculo vazado no meio (fill-rule evenodd) — deixa o
// fundo aparecer em forma de círculo, com os 4 cantos do quadrado sobrando
// (diferente do "Ponto", que é só um círculo cheio pequeno).
function circle(size, color, style) {
  const c = size / 2;
  const outer = `M 0 0 L ${size} 0 L ${size} ${size} L 0 ${size} Z`;
  const inner = `M ${size} ${c} A ${c} ${c} 0 0 0 0 ${c} A ${c} ${c} 0 0 0 ${size} ${c} Z`;
  return `<path d="${outer} ${inner}" fill-rule="evenodd" ${paintAttrs(size, color, style)} />`;
}

// agrupado por parentesco visual (não ordem alfabética/de criação): formas
// básicas → família de canto cortado (reto/arco/arco invertido) → família de
// "moldura vazada" (círculo/prisma/anel, todas quadrado-cheio-com-buraco) →
// família de marca/acento pequeno (asterisco/estouro/brilho/ponto/cruz/xis/
// gravata) → o resto.
export const SHAPES = {
  square: { label: 'Quadrado', oriented: false, draw: (size, color, o, style) => square(size, color, style) },
  disc: {
    label: 'Disco',
    oriented: false,
    draw: (size, color, o, style) => disc(size, color, style),
  },
  triangle: { label: 'Triângulo', oriented: true, draw: (size, color, o, style) => triangle(size, color, o, style) },
  diamond: { label: 'Losango', oriented: false, draw: (size, color, o, style) => diamond(size, color, style) },

  cornerNotch: {
    label: 'Canto cortado',
    oriented: true,
    draw: (size, color, o, style) => cornerNotch(size, color, o, style),
  },
  quarterCircle: {
    label: 'Arco',
    oriented: true,
    draw: (size, color, o, style) => quarterCircle(size, color, o, style),
  },
  quarterCircleInverse: {
    label: 'Arco invertido',
    oriented: true,
    draw: (size, color, o, style) => quarterCircleInverse(size, color, o, style),
  },

  circle: { label: 'Círculo', oriented: false, draw: (size, color, o, style) => circle(size, color, style) },
  prism: { label: 'Prisma', oriented: false, draw: (size, color, o, style) => prism(size, color, style) },
  ring: { label: 'Anel', oriented: false, draw: (size, color, o, style) => ring(size, color, style) },

  asterisk: { label: 'Asterisco', oriented: false, draw: (size, color, o, style) => asterisk(size, color, style) },
  burst: { label: 'Estouro', oriented: false, draw: (size, color, o, style) => burst(size, color, style) },
  sparkle: { label: 'Brilho', oriented: false, draw: (size, color, o, style) => sparkle(size, color, style) },
  dot: { label: 'Ponto', oriented: false, draw: (size, color, o, style) => dot(size, color, style) },
  cross: { label: 'Cruz', oriented: false, draw: (size, color, o, style) => cross(size, color, style) },
  diagonalCross: {
    label: 'Xis',
    oriented: false,
    draw: (size, color, o, style) => diagonalCross(size, color, style),
  },
  bowtie: { label: 'Gravata', oriented: false, draw: (size, color, o, style) => bowtie(size, color, style) },

  lens: { label: 'Lente', oriented: false, draw: (size, color, o, style) => lens(size, color, style) },
  hourglass: {
    label: 'Ampulheta',
    oriented: false,
    draw: (size, color, o, style) => hourglass(size, color, style),
  },
  twinPeaks: {
    label: 'Dois picos',
    oriented: false,
    draw: (size, color, o, style) => twinPeaks(size, color, style),
  },
};

export const SHAPE_KEYS = Object.keys(SHAPES);

// que lados da célula uma forma cobre de PONTA A PONTA (não só toca num
// pontinho ou num trecho parcial) — usado só pra decidir se é seguro
// suprimir o traço entre duas células vizinhas (o truque que faz duas formas
// grudadas parecerem uma peça só, sem risco de linha dupla). Suprimir um lado
// que a forma só toca parcialmente (ex.: a ponta do losango, o braço da cruz,
// os picos do asterisco) arranca um pedaço do contorno bem na ponta e expõe o
// preenchimento cru ali — por isso o padrão é NENHUM lado seguro, e só as
// formas realmente conferidas entram na lista. Valor pode ser um objeto fixo
// (formas sem orientação) ou uma função de orientação → objeto (triângulo,
// arco... cobrem lados DIFERENTES dependendo de pra onde apontam).
const FULL_EDGES = { top: true, bottom: true, left: true, right: true };
const OPPOSITE_CORNER = { tl: 'br', tr: 'bl', br: 'tl', bl: 'tr' };
// triângulo e arco preenchem o canto todo na direção da orientação — os dois
// lados retos que formam aquele canto ficam cheios de ponta a ponta (a
// hipotenusa/curva é a aresta interna, não encosta em nenhuma borda da
// célula).
function cornerEdges(orientation) {
  return {
    top: orientation === 'tl' || orientation === 'tr',
    bottom: orientation === 'bl' || orientation === 'br',
    left: orientation === 'tl' || orientation === 'bl',
    right: orientation === 'tr' || orientation === 'br',
  };
}
export const SHAPE_EDGE_COVERAGE = {
  square: () => FULL_EDGES,
  circle: () => FULL_EDGES,
  ring: () => FULL_EDGES,
  prism: () => FULL_EDGES,
  hourglass: () => ({ top: true, bottom: true, left: false, right: false }),
  triangle: (orientation) => cornerEdges(orientation),
  quarterCircle: (orientation) => cornerEdges(orientation),
  // a fatia sobrando do "arco invertido" fica no canto OPOSTO ao da
  // orientação (ela é o que sobra depois de cortar o arco daquele canto).
  quarterCircleInverse: (orientation) => cornerEdges(OPPOSITE_CORNER[orientation]),
  // "canto cortado" é o quadrado inteiro com uma mordida pequena só num
  // canto — os dois lados que tocam esse canto ficam parcialmente mordidos,
  // só os dois lados do canto OPOSTO continuam cheios de ponta a ponta.
  cornerNotch: (orientation) => cornerEdges(OPPOSITE_CORNER[orientation]),
};

export function shapeCoversEdge(shapeKey, edge, orientation) {
  return SHAPE_EDGE_COVERAGE[shapeKey]?.(orientation)?.[edge] ?? false;
}
