"""
Tegner NABE-figuren som ikon og som bilder til installasjonsprogrammet.

Ren Python, ingen bildebiblioteker: hver piksel er gjennomsnittet av 4x4
prøver mot de samme figurene som SVG-en i appen er laget av, i det samme
32x32-rutenettet. Lager nabe.ico (16-256 px), veiviser.bmp og veiviser-liten.bmp.
"""
import math
import struct
import zlib
from pathlib import Path

HER = Path(__file__).parent
LYS = (236, 236, 238)
MORK = (17, 17, 19)
LED = (255, 201, 0)


def i_avrundet_rekt(x, y, x0, y0, b, h, r):
    if not (x0 <= x <= x0 + b and y0 <= y <= y0 + h):
        return False
    cx = min(max(x, x0 + r), x0 + b - r)
    cy = min(max(y, y0 + r), y0 + h - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def i_sirkel(x, y, cx, cy, r):
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def i_linje(x, y, x1, y1, x2, y2, bredde):
    dx, dy = x2 - x1, y2 - y1
    t = max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)))
    px, py = x1 + t * dx, y1 + t * dy
    return (x - px) ** 2 + (y - py) ** 2 <= (bredde / 2) ** 2


def farge_ved(x, y):
    """Øverste figur som dekker punktet, i 32x32-koordinater. Bakfra og fram."""
    f = None
    if i_linje(x, y, 16, 7, 16, 2.6, 2.6):
        f = MORK
    if i_linje(x, y, 16, 7, 16, 2.6, 1.6):
        f = LYS
    if i_sirkel(x, y, 16, 2.4, 2.6):
        f = MORK
    if i_sirkel(x, y, 16, 2.4, 1.8):
        f = LED
    # A dark rim, so the light body still has an edge on a light taskbar.
    if i_avrundet_rekt(x, y, 2.2, 5.2, 27.6, 24.6, 7.2):
        f = MORK
    if i_avrundet_rekt(x, y, 3, 6, 26, 23, 6.5):
        f = LYS
    for ex in (11.2, 20.8):
        if i_sirkel(x, y, ex, 15.6, 4.6):
            f = MORK
        if i_sirkel(x, y, ex, 12.9, 2.1):     # rolled up at the ceiling: bored
            f = LYS
    if i_linje(x, y, 12.6, 23.4, 19.4, 23.4, 2.0):
        f = MORK
    return f


def tegn(storrelse, bakgrunn=None, skala=1.0, forskyv=(0, 0)):
    """RGBA-rader. Figuren fyller storrelse*skala, sentrert, pluss forskyv i px."""
    n = 4
    ut = []
    figur = storrelse * skala
    ox = (storrelse - figur) / 2 + forskyv[0]
    oy = (storrelse - figur) / 2 + forskyv[1]
    for py in range(storrelse if isinstance(storrelse, int) else storrelse[1]):
        rad = []
        for px in range(storrelse):
            r = g = b = a = 0.0
            for sy in range(n):
                for sx in range(n):
                    x = ((px + (sx + .5) / n) - ox) / figur * 32
                    y = ((py + (sy + .5) / n) - oy) / figur * 32
                    f = farge_ved(x, y)
                    if f:
                        r += f[0]; g += f[1]; b += f[2]; a += 255
            k = n * n
            if bakgrunn:
                dekning = a / 255 / k
                rad.append(tuple(round((c / (a / 255) if a else 0) * dekning + bg * (1 - dekning))
                                 for c, bg in zip((r, g, b), bakgrunn)) + (255,))
            else:
                rad.append((round(r / max(a / 255, 1e-9)) if a else 0,
                            round(g / max(a / 255, 1e-9)) if a else 0,
                            round(b / max(a / 255, 1e-9)) if a else 0,
                            round(a / k)))
        ut.append(rad)
    return ut


def png(rader):
    h, b = len(rader), len(rader[0])
    raw = b"".join(b"\x00" + bytes(c for px in rad for c in px) for rad in rader)

    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", b, h, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def ico(storrelser):
    bilder = [png(tegn(s, skala=.94)) for s in storrelser]
    hode = struct.pack("<HHH", 0, 1, len(bilder))
    pos = 6 + 16 * len(bilder)
    katalog = b""
    for s, data in zip(storrelser, bilder):
        katalog += struct.pack("<BBBBHHII", s % 256, s % 256, 0, 0, 1, 32, len(data), pos)
        pos += len(data)
    return hode + katalog + b"".join(bilder)


def bmp(b, h, bakgrunn, skala, forskyv_y=0):
    """24-bits BMP med figuren på en flat bakgrunn (Inno vil ha BMP)."""
    side = max(b, h)
    rader = tegn(side, bakgrunn=bakgrunn, skala=skala * min(b, h) / side,
                 forskyv=(0, forskyv_y))
    x0, y0 = (side - b) // 2, (side - h) // 2
    utsnitt = [rad[x0:x0 + b] for rad in rader[y0:y0 + h]]
    pad = (4 - (b * 3) % 4) % 4
    data = b"".join(bytes(c for px in rad for c in (px[2], px[1], px[0])) + b"\x00" * pad
                    for rad in reversed(utsnitt))
    return (b"BM" + struct.pack("<IHHI", 54 + len(data), 0, 0, 54)
            + struct.pack("<IiiHHIIiiII", 40, b, h, 1, 24, 0, len(data), 2835, 2835, 0, 0) + data)


if __name__ == "__main__":
    (HER / "nabe.ico").write_bytes(ico([16, 24, 32, 48, 64, 256]))
    (HER / "veiviser.bmp").write_bytes(bmp(164, 314, MORK, .62, -40))
    (HER / "veiviser-liten.bmp").write_bytes(bmp(55, 55, (255, 255, 255), .92))
    print("nabe.ico, veiviser.bmp, veiviser-liten.bmp")
