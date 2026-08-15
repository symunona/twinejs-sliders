#!/usr/bin/env python3
"""Generate demo assets for the Sliders E2E suite.

Deliberately includes an ANIMATED gif so the asset store's animation sniffing
(and its "do not flatten to WebP" branch) is actually exercised.

    python3 e2e/fixtures/make-assets.py
"""
import math
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'assets')
os.makedirs(OUT, exist_ok=True)

BG_W, BG_H = 1280, 720
CH_W, CH_H = 512, 1024


def save(img, name):
    path = os.path.join(OUT, name)
    img.save(path)
    print(f'  {name}  {img.size[0]}x{img.size[1]}  {os.path.getsize(path)}b')
    return path


def gradient(w, h, top, bottom):
    img = Image.new('RGB', (w, h))
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = y / max(1, h - 1)
        d.line(
            [(0, y), (w, y)],
            fill=tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)),
        )
    return img


def tavern_night():
    img = gradient(BG_W, BG_H, (28, 20, 34), (12, 9, 16))
    d = ImageDraw.Draw(img)
    # floor
    d.rectangle([0, int(BG_H * 0.72), BG_W, BG_H], fill=(46, 32, 26))
    # back wall planks
    for x in range(0, BG_W, 96):
        d.line([(x, int(BG_H * 0.2)), (x, int(BG_H * 0.72))], fill=(38, 27, 30), width=3)
    # warm window glow
    for cx, cy, r in ((240, 210, 90), (1040, 190, 70)):
        for i in range(r, 0, -6):
            a = int(90 * (1 - i / r))
            d.ellipse([cx - i, cy - i, cx + i, cy + i], fill=(60 + a, 40 + a // 2, 18))
    d.text((24, 24), 'TAVERN / NIGHT', fill=(200, 170, 120))
    return img


def street_dusk():
    img = gradient(BG_W, BG_H, (44, 52, 82), (96, 68, 62))
    d = ImageDraw.Draw(img)
    d.rectangle([0, int(BG_H * 0.75), BG_W, BG_H], fill=(34, 32, 38))
    # silhouetted buildings
    for x, hgt in ((60, 0.42), (260, 0.55), (470, 0.36), (700, 0.60), (960, 0.45)):
        top = int(BG_H * (0.75 - hgt))
        d.rectangle([x, top, x + 170, int(BG_H * 0.75)], fill=(24, 22, 30))
        for wy in range(top + 20, int(BG_H * 0.75) - 20, 46):
            for wx in range(x + 18, x + 150, 44):
                d.rectangle([wx, wy, wx + 18, wy + 24], fill=(180, 150, 90))
    d.text((24, 24), 'STREET / DUSK', fill=(220, 210, 200))
    return img


def figure(coat, skin, pose, label):
    """A crude but unmistakable character sprite on transparency."""
    img = Image.new('RGBA', (CH_W, CH_H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    cx = CH_W // 2
    # legs
    d.rectangle([cx - 70, 700, cx - 16, 990], fill=(40, 40, 52))
    d.rectangle([cx + 16, 700, cx + 70, 990], fill=(40, 40, 52))
    # boots
    d.rectangle([cx - 78, 960, cx - 8, 1000], fill=(26, 24, 30))
    d.rectangle([cx + 8, 960, cx + 78, 1000], fill=(26, 24, 30))
    # torso
    d.rounded_rectangle([cx - 105, 360, cx + 105, 720], 40, fill=coat)
    # head
    d.ellipse([cx - 66, 180, cx + 66, 330], fill=skin)
    # hair
    d.chord([cx - 70, 165, cx + 70, 300], 180, 360, fill=(48, 32, 26))

    if pose == 'arms-crossed':
        d.rounded_rectangle([cx - 120, 470, cx + 120, 540], 30, fill=coat)
        d.rounded_rectangle([cx - 95, 455, cx + 95, 500], 22, fill=tuple(
            max(0, c - 22) for c in coat))
    elif pose == 'angry':
        d.rounded_rectangle([cx - 150, 380, cx - 95, 620], 26, fill=coat)
        d.rounded_rectangle([cx + 95, 330, cx + 150, 570], 26, fill=coat)
        # brow
        d.line([cx - 40, 232, cx - 10, 248], fill=(30, 20, 18), width=9)
        d.line([cx + 40, 232, cx + 10, 248], fill=(30, 20, 18), width=9)
    else:  # idle
        d.rounded_rectangle([cx - 145, 380, cx - 95, 650], 26, fill=coat)
        d.rounded_rectangle([cx + 95, 380, cx + 145, 650], 26, fill=coat)

    # eyes
    if pose != 'angry':
        d.ellipse([cx - 34, 236, cx - 16, 258], fill=(30, 26, 24))
        d.ellipse([cx + 16, 236, cx + 34, 258], fill=(30, 26, 24))
    else:
        d.ellipse([cx - 34, 244, cx - 16, 262], fill=(30, 26, 24))
        d.ellipse([cx + 16, 244, cx + 34, 262], fill=(30, 26, 24))

    d.text((12, 12), label, fill=(255, 255, 255, 200))
    return img


def candle_frames(n=8):
    """Animated candle — this is the file that must NOT be flattened on upload."""
    frames = []
    for i in range(n):
        img = Image.new('RGBA', (128, 256), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        d.rectangle([48, 140, 80, 240], fill=(226, 220, 196))
        d.ellipse([44, 232, 84, 250], fill=(200, 194, 170))
        wob = math.sin(i / n * math.tau) * 7
        d.ellipse([56 + wob, 96, 72 + wob, 144], fill=(255, 176, 60))
        d.ellipse([60 + wob, 110, 68 + wob, 138], fill=(255, 238, 170))
        frames.append(img)
    return frames


def table():
    img = Image.new('RGBA', (640, 300), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 40, 640, 110], 14, fill=(92, 62, 40))
    d.rectangle([60, 110, 100, 300], fill=(70, 46, 30))
    d.rectangle([540, 110, 580, 300], fill=(70, 46, 30))
    return img


print('generating demo assets ->', OUT)
save(tavern_night(), 'tavern-night.png')
save(street_dusk(), 'street-dusk.png')
save(figure((120, 60, 82), (232, 194, 168), 'idle', 'MIRA idle'), 'mira-idle.png')
save(figure((120, 60, 82), (232, 194, 168), 'arms-crossed', 'MIRA arms'), 'mira-arms-crossed.png')
save(figure((120, 60, 82), (232, 194, 168), 'angry', 'MIRA angry'), 'mira-angry.png')
save(figure((54, 74, 110), (214, 178, 150), 'idle', 'JOREN idle'), 'joren-idle.png')
save(table(), 'table.png')

frames = candle_frames()
gif_path = os.path.join(OUT, 'candle-flicker.gif')
frames[0].save(
    gif_path, save_all=True, append_images=frames[1:], duration=90, loop=0, disposal=2
)
print(f'  candle-flicker.gif  ANIMATED {len(frames)} frames  '
      f'{os.path.getsize(gif_path)}b')
print('done')
