#!/usr/bin/env python3
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os, glob

RES = '/root/gitstore/android/app/src/main/res'
C1 = (95, 139, 255)
C2 = (126, 226, 184)
FONT_BOLD = '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'
FONT_REG = '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'


def gradient(size, c1=C1, c2=C2, steps=96):
    small = Image.new('RGB', (steps, steps))
    px = small.load()
    for y in range(steps):
        for x in range(steps):
            t = (x + y) / (2 * (steps - 1))
            px[x, y] = tuple(round(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))
    return small.resize((size, size), Image.BICUBIC)


def rounded_mask(size, radius_ratio=0.22):
    mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, size - 1, size - 1], radius=max(2, round(size * radius_ratio)), fill=255)
    return mask


def circle_mask(size):
    mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, size - 1, size - 1], fill=255)
    return mask


def draw_glyph(img, cx, cy, s, color=(255, 255, 255, 255)):
    d = ImageDraw.Draw(img)
    lw = max(2, round(s * 0.135))
    r = lw / 2
    shaft_top = cy - s * 0.37
    shaft_bottom = cy + s * 0.09
    d.rounded_rectangle([cx - lw / 2, shaft_top, cx + lw / 2, shaft_bottom],
                        radius=r, fill=color)
    d.polygon([(cx - s * 0.29, cy + s * 0.01),
               (cx + s * 0.29, cy + s * 0.01),
               (cx, cy + s * 0.31)], fill=color)
    x1, x2 = cx - s * 0.39, cx + s * 0.39
    y1, y2 = cy + s * 0.35, cy + s * 0.47
    d.line([(x1, y1), (x1, y2), (x2, y2), (x2, y1)], fill=color, width=lw, joint='curve')
    for x, y in ((x1, y1), (x2, y1)):
        d.ellipse([x - r, y - r, x + r, y + r], fill=color)


def icon(size, round_icon=False):
    base = gradient(size)
    base.putalpha(rounded_mask(size) if not round_icon else circle_mask(size))
    draw_glyph(base, size / 2, size * 0.49, size * 0.64)
    return base


def foreground(size):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw_glyph(img, size / 2, size / 2, size * 0.52)
    return img


def radial_glow(w, h):
    glow = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(glow)
    cx, cy = w / 2, h * 0.42
    rad = min(w, h) * 0.55
    steps = 48
    for i in range(steps, 0, -1):
        rr = rad * i / steps
        a = int(28 * (1 - i / steps) ** 1.6)
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=(95, 139, 255, a))
    return glow.filter(ImageFilter.GaussianBlur(min(w, h) * 0.02))


def splash(w, h):
    img = Image.new('RGB', (w, h), (10, 13, 20))
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = y / max(1, h - 1)
        d.line([(0, y), (w, y)], fill=(round(14 + 2 * t), round(19 + 3 * t), round(31 + 5 * t)))
    img = img.convert('RGBA')
    img.alpha_composite(radial_glow(w, h))
    side = round(min(w, h) * 0.30)
    cx, cy = w / 2, h * 0.42
    logo = icon(side)
    img.alpha_composite(logo, (round(cx - side / 2), round(cy - side / 2)))
    d = ImageDraw.Draw(img)
    f1 = ImageFont.truetype(FONT_BOLD, max(12, round(min(w, h) * 0.085)))
    f2 = ImageFont.truetype(FONT_REG, max(10, round(min(w, h) * 0.038)))
    ty = cy + side / 2 + min(w, h) * 0.055
    d.text((cx, ty), 'GitStore', font=f1, fill=(245, 248, 255), anchor='ma')
    ty2 = ty + min(w, h) * 0.095
    d.text((cx, ty2), 'apps straight from GitHub', font=f2, fill=(148, 163, 190), anchor='ma')
    return img.convert('RGB')


for path in glob.glob(os.path.join(RES, 'mipmap-*', 'ic_launcher.png')):
    size = Image.open(path).size[0]
    icon(size).save(path)
for path in glob.glob(os.path.join(RES, 'mipmap-*', 'ic_launcher_round.png')):
    size = Image.open(path).size[0]
    icon(size, round_icon=True).save(path)
for path in glob.glob(os.path.join(RES, 'mipmap-*', 'ic_launcher_foreground.png')):
    size = Image.open(path).size[0]
    foreground(size).save(path)
for path in glob.glob(os.path.join(RES, 'drawable*', 'splash.png')):
    w, h = Image.open(path).size
    splash(w, h).save(path)

open(os.path.join(RES, 'drawable', 'ic_launcher_bg.xml'), 'w').write('''<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <gradient android:type="linear" android:angle="135"
        android:startColor="#5F8BFF" android:endColor="#7EE2B8" />
</shape>
''')
for name in ('ic_launcher', 'ic_launcher_round'):
    open(os.path.join(RES, 'mipmap-anydpi-v26', name + '.xml'), 'w').write('''<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_launcher_bg" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
''')
print('assets generated')
