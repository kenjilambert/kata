#!/usr/bin/env python3
"""
make-icons.py — ícones do PWA (icons/icon-192.png, icon-512.png,
icon-maskable.svg), gerados proceduralmente.

Não existe ícone estático do Kata (o do header/favicon é sorteado a cada
carregamento, ver ui/dynamicLogo.js), e o manifest precisa de PNG fixo. Então
o ícone é uma versão "congelada" da mesma linguagem: fundo #0a0a0a e três
formas nas cores da marca numa grade 2x2 — quadrado (vermelho), círculo
(azul), triângulo (creme) — cantos retos, sem borda arredondada; a quarta
célula fica vazia de propósito (a assimetria é parte da identidade, os
padrões gerados nunca são grades cheias e simétricas).

PIL não está instalado nesta máquina, então o PNG é escrito na mão com
zlib + struct (RGB 8 bits, sem alpha — o fundo é sólido). Bordas das formas
com antialias por distância assinada (1px de transição), pra não ficar
serrilhado no tamanho pequeno.

Rodar uma vez (ou quando quiser mudar o desenho): `py tools/make-icons.py`.
"""

import math
import struct
import sys
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'icons'

BG = (0x0A, 0x0A, 0x0A)
RED = (0xEA, 0x45, 0x30)
BLUE = (0x3A, 0xA1, 0xD8)
CREAM = (0xF1, 0xEE, 0xC0)


def png_bytes(width: int, height: int, rows) -> bytes:
    """rows: iterável de bytes (RGB por linha). PNG mínimo: IHDR + IDAT + IEND."""

    def chunk(tag: bytes, data: bytes) -> bytes:
        body = tag + data
        return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body) & 0xFFFFFFFF)

    raw = b''.join(b'\x00' + row for row in rows)  # filtro 0 (None) em cada linha
    ihdr = struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)  # 8 bits, color type 2 = RGB
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')


def coverage(sdf: float) -> float:
    """distância assinada (negativo = dentro) -> cobertura 0..1 com 1px de antialias."""
    return min(1.0, max(0.0, 0.5 - sdf))


def sdf_square(x, y, cx, cy, half):
    return max(abs(x - cx), abs(y - cy)) - half


def sdf_circle(x, y, cx, cy, r):
    return math.hypot(x - cx, y - cy) - r


def sdf_triangle(x, y, x0, y0, x1, y1, x2, y2):
    """triângulo por interseção de 3 semiplanos (vértices em sentido horário)."""

    def edge(ax, ay, bx, by):
        ex, ey = bx - ax, by - ay
        length = math.hypot(ex, ey)
        # normal apontando pra FORA. Com y crescendo pra baixo (tela), pra um
        # polígono percorrido em sentido horário o lado de fora é à direita
        # da aresta -> (ey, -ex).
        nx, ny = ey / length, -ex / length
        return (x - ax) * nx + (y - ay) * ny

    return max(edge(x0, y0, x1, y1), edge(x1, y1, x2, y2), edge(x2, y2, x0, y0))


def render(size: int):
    pad = size * 0.14
    gap = size * 0.07
    cell = (size - 2 * pad - gap) / 2
    # centros das 3 células usadas (linha, coluna): quadrado TL, círculo TR, triângulo BL
    c0 = pad + cell / 2
    c1 = pad + cell + gap + cell / 2
    half = cell / 2
    # vértices em sentido horário (y cresce pra baixo): base-esq, topo, base-dir
    top = pad + cell + gap
    tri = (pad, top + cell, pad + cell / 2, top, pad + cell, top + cell)

    shapes = (
        (RED, lambda x, y: sdf_square(x, y, c0, c0, half)),
        (BLUE, lambda x, y: sdf_circle(x, y, c1, c0, half)),
        (CREAM, lambda x, y: sdf_triangle(x, y, *tri)),
    )

    for py in range(size):
        row = bytearray()
        y = py + 0.5
        for px in range(size):
            x = px + 0.5
            r, g, b = BG
            for color, sdf in shapes:
                a = coverage(sdf(x, y))
                if a > 0:
                    r = r + (color[0] - r) * a
                    g = g + (color[1] - g) * a
                    b = b + (color[2] - b) * a
                    break
            row += bytes((round(r), round(g), round(b)))
        yield bytes(row)


# versão vetorial "maskable": o sistema recorta num círculo/quadrado
# arredondado, então o desenho fica dentro da zona segura (círculo central
# de 80% do lado) — mesma grade, só mais pra dentro.
MASKABLE_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" shape-rendering="geometricPrecision">
  <rect width="100" height="100" fill="#0a0a0a"/>
  <rect x="24" y="24" width="23" height="23" fill="#ea4530"/>
  <circle cx="64.5" cy="35.5" r="11.5" fill="#3aa1d8"/>
  <polygon points="24,76 35.5,53 47,76" fill="#f1eec0"/>
</svg>
"""


def main() -> int:
    OUT.mkdir(exist_ok=True)
    for size in (192, 512):
        path = OUT / f'icon-{size}.png'
        path.write_bytes(png_bytes(size, size, render(size)))
        print(f'  gerado: {path.relative_to(ROOT).as_posix()} ({path.stat().st_size} bytes)')
    svg = OUT / 'icon-maskable.svg'
    svg.write_text(MASKABLE_SVG, encoding='utf-8', newline='\n')
    print(f'  gerado: {svg.relative_to(ROOT).as_posix()}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
