#!/usr/bin/env python3
"""Generate the parallax demo's layers (docs/sliders/demos/parallax-hills.md).

Every layer is a full 1280x720 frame and TILES horizontally — each ridge is a sum of
sines whose periods divide the width — so `motion: scroll_infinite_left` loops without
a seam. Transparent above the ridge, so the layers stack.

    python3 e2e/fixtures/make-parallax.py
"""
import math
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'assets')
os.makedirs(OUT, exist_ok=True)

W, H = 1280, 720


def save(img, name):
    path = os.path.join(OUT, name)
    img.save(path, optimize=True)
    print(f'  {name}  {img.size[0]}x{img.size[1]}  {os.path.getsize(path)}b')


def sky():
    img = Image.new('RGB', (W, H))
    d = ImageDraw.Draw(img)
    top, bottom = (58, 92, 160), (250, 196, 140)
    for y in range(H):
        t = y / (H - 1)
        d.line([(0, y), (W, y)], fill=tuple(int(a + (b - a) * t) for a, b in zip(top, bottom)))
    # The sun, low and warm.
    d.ellipse([820, 330, 980, 490], fill=(255, 236, 190))
    return img


def ridge(base, waves, colour, shade):
    """A tiling ridge: y = base + sum(amp * sin(2*pi*k*x/W + phase))."""
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    px = img.load()
    for x in range(W):
        y0 = base + sum(a * math.sin(2 * math.pi * k * x / W + p) for a, k, p in waves)
        y0 = int(max(0, min(H - 1, y0)))
        for y in range(y0, H):
            # A little darker with depth into the hill, so it reads as a shape.
            t = (y - y0) / max(1, H - y0)
            c = tuple(int(a + (b - a) * min(1, t * 1.6)) for a, b in zip(colour, shade))
            px[x, y] = c + (255,)
    return img


def clouds():
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    puffs = [(120, 110), (430, 70), (760, 140), (1080, 90)]
    for cx, cy in puffs:
        for dx, dy, r in [(0, 0, 46), (40, 10, 38), (-42, 12, 34), (18, -18, 32)]:
            for wrap in (-W, 0, W):
                x, y = cx + dx + wrap, cy + dy
                d.ellipse([x - r, y - r, x + r, y + r], fill=(255, 250, 245, 210))
    return img


if __name__ == '__main__':
    print('Generating parallax layers ->', OUT)
    save(sky(), 'parallax-sky.png')
    save(clouds(), 'parallax-clouds.png')
    save(ridge(430, [(40, 1, 0.3), (22, 3, 1.1), (10, 7, 2.0)], (122, 132, 170), (96, 104, 140)), 'parallax-far.png')
    save(ridge(520, [(34, 2, 0.8), (18, 5, 0.2), (8, 11, 1.4)], (86, 140, 96), (60, 104, 70)), 'parallax-mid.png')
    save(ridge(610, [(28, 1, 2.2), (20, 4, 0.5), (6, 13, 0.9)], (58, 104, 52), (36, 70, 34)), 'parallax-near.png')
