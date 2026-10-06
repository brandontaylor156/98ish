"""Writes client/public/emu/flash/98ish-spinner.swf: a tiny original Flash movie (ours, no
third-party content) so Shockwave Arcade has something to play out of the box. Four colored
squares (the 98 logo colors) spin and pulse in a loop. Plain SWF 6, uncompressed.

  python tools/lanparty/make_demo_swf.py
"""
import math
import os
import struct

W, H = 400, 300
TW = 20  # twips per pixel
FRAMES = 96
FPS = 24


class Bits:
    def __init__(self):
        self.bits = []

    def u(self, v, n):
        for i in range(n - 1, -1, -1):
            self.bits.append((v >> i) & 1)

    def s(self, v, n):
        self.u(v & ((1 << n) - 1), n)

    def bytes(self):
        b = self.bits + [0] * (-len(self.bits) % 8)
        return bytes(int("".join(map(str, b[i:i + 8])), 2) for i in range(0, len(b), 8))


def sbits(*vals):
    m = max(abs(int(v)) for v in vals) if vals else 0
    return max(2, m.bit_length() + 2)


def rect(x0, x1, y0, y1):
    b = Bits()
    n = sbits(x0, x1, y0, y1)
    b.u(n, 5)
    for v in (x0, x1, y0, y1):
        b.s(int(v), n)
    return b.bytes()


def fixed16(v):
    return int(round(v * 65536))


def matrix(sx, r0, r1, sy, tx, ty):
    b = Bits()
    b.u(1, 1)
    vals = [fixed16(sx), fixed16(sy)]
    n = sbits(*vals)
    b.u(n, 5)
    for v in vals:
        b.s(v, n)
    b.u(1, 1)
    vals = [fixed16(r0), fixed16(r1)]
    n = sbits(*vals)
    b.u(n, 5)
    for v in vals:
        b.s(v, n)
    n = sbits(tx, ty)
    b.u(n, 5)
    b.s(int(tx), n)
    b.s(int(ty), n)
    return b.bytes()


def tag(code, body):
    if len(body) < 0x3F:
        return struct.pack("<H", (code << 6) | len(body)) + body
    return struct.pack("<HI", (code << 6) | 0x3F, len(body)) + body


def square_shape(cid, rgb, half):
    h = half * TW
    body = struct.pack("<H", cid) + rect(-h, h, -h, h)
    body += bytes([1, 0x00]) + bytes(rgb)  # one solid fill style
    body += bytes([0])  # no line styles
    b = Bits()
    b.u(1, 4)  # fill bits
    b.u(0, 4)  # line bits
    # style change: moveTo + fillStyle0
    b.u(0, 1)
    b.u(0, 1)  # new styles
    b.u(0, 1)  # line style
    b.u(0, 1)  # fill1
    b.u(1, 1)  # fill0
    b.u(1, 1)  # moveTo
    n = sbits(h, h)
    b.u(n, 5)
    b.s(-h, n)
    b.s(-h, n)
    b.u(1, 1)  # fill0 index
    for dx, dy in ((2 * h, 0), (0, 2 * h), (-2 * h, 0), (0, -2 * h)):
        b.u(1, 1)  # edge
        b.u(1, 1)  # straight
        n = sbits(dx, dy)
        b.u(n - 2, 4)
        if dx and dy:
            b.u(1, 1)
            b.s(dx, n)
            b.s(dy, n)
        else:
            b.u(0, 1)
            b.u(1 if dx == 0 else 0, 1)  # vertical?
            b.s(dy if dx == 0 else dx, n)
    b.u(0, 6)  # end of shape
    body += b.bytes()
    return tag(2, body)


def place(depth, cid, m, new):
    flags = 0x04 | (0x02 if new else 0) | (0x01 if not new else 0)
    body = bytes([flags]) + struct.pack("<H", depth)
    if new:
        body += struct.pack("<H", cid)
    body += m
    return tag(26, body)


def main():
    colors = [(0xF0, 0x3E, 0x2F), (0x2D, 0xA4, 0x4E), (0x1E, 0x6F, 0xD9), (0xF9, 0xC2, 0x1A)]
    tags = [tag(9, bytes([0x00, 0x80, 0x80]))]  # teal desktop background
    for i, c in enumerate(colors):
        tags.append(square_shape(i + 1, c, 40))
    for f in range(FRAMES):
        t = f / FRAMES * 2 * math.pi
        for i in range(4):
            a = t * (1 if i % 2 == 0 else -1) + i * math.pi / 2
            s = 0.8 + 0.25 * math.sin(t * 2 + i)
            cx = W / 2 + math.cos(t + i * math.pi / 2) * 90
            cy = H / 2 + math.sin(t + i * math.pi / 2) * 70
            m = matrix(math.cos(a) * s, math.sin(a) * s, -math.sin(a) * s, math.cos(a) * s, cx * TW, cy * TW)
            tags.append(place(i + 1, i + 1, m, f == 0))
        tags.append(tag(1, b""))
    tags.append(tag(0, b""))
    body = rect(0, W * TW, 0, H * TW) + struct.pack("<HH", FPS << 8, FRAMES) + b"".join(tags)
    data = b"FWS" + bytes([6]) + struct.pack("<I", 8 + len(body)) + body
    here = os.path.dirname(os.path.abspath(__file__))
    out = os.path.join(here, "..", "..", "client", "public", "emu", "flash")
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, "98ish-spinner.swf"), "wb") as fh:
        fh.write(data)
    print(len(data), "bytes")


if __name__ == "__main__":
    main()
