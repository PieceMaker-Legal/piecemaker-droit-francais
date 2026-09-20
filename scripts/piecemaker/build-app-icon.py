#!/usr/bin/env python3
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
SOURCE_LOGO = ROOT / 'public' / 'logo-sources' / 'logo-black.png'
ASSETS = ROOT / 'server' / 'piecemaker' / 'vendor' / 'installer' / 'assets'
ICNS = ASSETS / 'piecemaker.icns'
ICO = ASSETS / 'piecemaker.ico'

CANVAS = 1024
PLATE_INSET = 90
PLATE_RADIUS_RATIO = 0.2237
PLATE_FILL = (255, 255, 255, 255)
PLATE_EDGE = (203, 213, 225, 255)
LOGO_RATIO = 0.66
SUPERSAMPLE = 4

ICONSET_SIZES = [
    ('icon_16x16.png', 16),
    ('icon_16x16@2x.png', 32),
    ('icon_32x32.png', 32),
    ('icon_32x32@2x.png', 64),
    ('icon_128x128.png', 128),
    ('icon_128x128@2x.png', 256),
    ('icon_256x256.png', 256),
    ('icon_256x256@2x.png', 512),
    ('icon_512x512.png', 512),
    ('icon_512x512@2x.png', 1024),
]
ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]


def render_master() -> Image.Image:
    scale = SUPERSAMPLE
    canvas = Image.new('RGBA', (CANVAS * scale, CANVAS * scale), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)

    plate = [
        PLATE_INSET * scale,
        PLATE_INSET * scale,
        (CANVAS - PLATE_INSET) * scale,
        (CANVAS - PLATE_INSET) * scale,
    ]
    plate_size = plate[2] - plate[0]
    radius = int(plate_size * PLATE_RADIUS_RATIO)
    draw.rounded_rectangle(plate, radius=radius, fill=PLATE_FILL, outline=PLATE_EDGE, width=3 * scale)

    logo = Image.open(SOURCE_LOGO).convert('RGBA')
    target = int(plate_size * LOGO_RATIO)
    logo = logo.resize((target, target), Image.LANCZOS)
    offset = (CANVAS * scale - target) // 2
    canvas.alpha_composite(logo, (offset, offset))

    return canvas.resize((CANVAS, CANVAS), Image.LANCZOS)


def build_icns(master: Image.Image, workdir: Path) -> None:
    iconset = workdir / 'piecemaker.iconset'
    iconset.mkdir(parents=True, exist_ok=True)
    for name, size in ICONSET_SIZES:
        master.resize((size, size), Image.LANCZOS).save(iconset / name)
    subprocess.run(['iconutil', '-c', 'icns', str(iconset), '-o', str(ICNS)], check=True)


def build_ico(master: Image.Image) -> None:
    master.save(ICO, format='ICO', sizes=[(size, size) for size in ICO_SIZES])


def main() -> int:
    if not SOURCE_LOGO.exists():
        print(f'Logo source introuvable : {SOURCE_LOGO}', file=sys.stderr)
        return 1
    workdir = ROOT / '.desktop-build' / 'icon'
    workdir.mkdir(parents=True, exist_ok=True)
    master = render_master()
    master.save(workdir / 'piecemaker-1024.png')
    build_icns(master, workdir)
    build_ico(master)
    print(f'Icônes générées : {ICNS.relative_to(ROOT)}, {ICO.relative_to(ROOT)}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
