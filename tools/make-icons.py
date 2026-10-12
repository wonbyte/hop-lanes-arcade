#!/usr/bin/env python3
"""Generate PWA icons (pixel-art frog) into icons/. Requires Pillow."""
import os
from PIL import Image, ImageDraw

ROWS = ['............', '..WWW..WWW..', '..WKW..WKW..', '.GGGGGGGGGG.',
        '.GGGGGGGGGG.', '.GRRRRRRRRG.', '.GGGGGGGGGG.', '.GLLLLLLLLG.',
        '.GLLLLLLLLG.', '.DD.DD.DD.DD', '............', '............']
PAL = {'W': '#ffffff', 'K': '#111111', 'G': '#4cbf3f', 'R': '#e0453a',
       'L': '#a6e37a', 'D': '#2d7a25'}
BG = '#10131c'
# Visible bounds of the art inside the 12x12 grid: cols 0-11, rows 1-9.
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'icons')


def frog():
    img = Image.new('RGBA', (12, 12), (0, 0, 0, 0))
    for y, row in enumerate(ROWS):
        for x, c in enumerate(row):
            if c in PAL:
                img.putpixel((x, y), Image.new('RGB', (1, 1), PAL[c]).getpixel((0, 0)) + (255,))
    return img


def make(size, frac, rounded, name):
    """frac = fraction of canvas the 12x12 grid occupies."""
    cell = max(1, int(size * frac) // 12)
    art = frog().resize((cell * 12, cell * 12), Image.NEAREST)
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(canvas)
    if rounded:
        d.rounded_rectangle([0, 0, size - 1, size - 1], radius=size // 5, fill=BG)
    else:
        d.rectangle([0, 0, size, size], fill=BG)
    off = (size - cell * 12) // 2
    canvas.alpha_composite(art, (off, off))
    canvas.save(os.path.join(OUT, name))


os.makedirs(OUT, exist_ok=True)
make(192, 0.72, True, 'icon-192.png')
make(512, 0.72, True, 'icon-512.png')
make(180, 0.72, False, 'icon-180.png')  # iOS applies its own mask; keep opaque
make(512, 0.70, False, 'icon-512-maskable.png')  # full-bleed, art within central 80%
