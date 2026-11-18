"""Run's bark texture (assets/bark.png), drawn by hand and made to repeat.

The game repeats one square tile both ways over every branch: across the
picture is round the branch, up and down is along it (so grooves run up and
down), and in Run a tile covers 6 units each way (run.js BARK_TILE).

To draw one that repeats perfectly (Procreate or anything else):

  python3 tools/bark/bark.py guide            # tools/bark/bark-guide.png, 2048 px
    In Procreate: a 2048 x 2048 px canvas; insert bark-guide.png as the top
    layer, lock it. Paint the bark on a layer under it, edge to edge. Hide the
    guide and export a PNG.

  python3 tools/bark/bark.py offset drawing.png
    Writes drawing-offset.png: the tile moved half its size each way, so its
    edges now meet in a cross through the middle (where the guide's dashed
    lines are). Open it in Procreate and paint over that cross; leave the
    outer edges as they are. Export again. That picture repeats perfectly.

  python3 tools/bark/bark.py preview drawing-offset.png
    Writes drawing-offset-preview.png: 3 x 3 tiles, to look for seams.

  python3 tools/bark/bark.py install drawing-offset.png
    Puts it in the game: assets/bark.png, 512 px.
"""

import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
GAME_SIZE = 512
GUIDE_SIZE = 2048


def guide():
    n = GUIDE_SIZE
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    edge = (255, 0, 170, 255)
    seam = (0, 160, 255, 255)
    font = ImageFont.load_default(size=44)
    small = ImageFont.load_default(size=34)

    # The tile's edges: what's past one side comes back on the other.
    d.rectangle([0, 0, n - 1, n - 1], outline=edge, width=8)
    # Where the edges will meet after the offset: the cross to paint over then.
    for i in range(0, n, 48):
        d.line([(n // 2, i), (n // 2, i + 24)], fill=seam, width=5)
        d.line([(i, n // 2), (i + 24, n // 2)], fill=seam, width=5)
    # Quarter lines, faint, to judge spacing so the tile doesn't look like one.
    for q in (n // 4, 3 * n // 4):
        d.line([(q, 0), (q, n)], fill=(255, 255, 255, 70), width=2)
        d.line([(0, q), (n, q)], fill=(255, 255, 255, 70), width=2)

    def label(xy, text, f=font, fill=(255, 255, 255, 255)):
        d.text(xy, text, font=f, fill=fill, stroke_width=4, stroke_fill=(0, 0, 0, 255))

    # Which way the branch goes.
    ax = 140
    d.line([(ax, n - 360), (ax, 360)], fill=(255, 255, 255, 230), width=10)
    d.polygon([(ax, 300), (ax - 34, 380), (ax + 34, 380)], fill=(255, 255, 255, 230))
    label((ax + 40, 330), "along the branch\n(grooves run this way)")
    ay = n - 140
    d.line([(360, ay), (n - 360, ay)], fill=(255, 255, 255, 230), width=10)
    d.polygon([(n - 300, ay), (n - 380, ay - 34), (n - 380, ay + 34)], fill=(255, 255, 255, 230))
    label((n // 2 - 260, ay - 110), "around the branch")

    label((60, 50), "Bark tile · 2048 px · repeats every way", small)
    label((60, 100), "Pink: the edges, paint right up to them", small, (255, 120, 210, 255))
    label((60, 150), "Blue dashes: where the seams land after  bark.py offset", small, (120, 200, 255, 255))
    out = HERE / "bark-guide.png"
    img.save(out)
    print(out)


def offset(src):
    img = Image.open(src)
    w, h = img.size
    out = Path(src).with_name(Path(src).stem + "-offset.png")
    ImageChops.offset(img, w // 2, h // 2).save(out)
    print(out)


def preview(src):
    img = Image.open(src).convert("RGB")
    w, h = img.size
    sheet = Image.new("RGB", (3 * w, 3 * h))
    for i in range(3):
        for j in range(3):
            sheet.paste(img, (i * w, j * h))
    if sheet.width > 3072:
        sheet = sheet.resize((3072, 3072 * sheet.height // sheet.width), Image.LANCZOS)
    out = Path(src).with_name(Path(src).stem + "-preview.png")
    sheet.save(out)
    print(out)


def install(src):
    img = Image.open(src).convert("RGB")
    if img.width != img.height:
        sys.exit(f"{src} is {img.width} x {img.height}: the tile has to be square")
    out = HERE.parent.parent / "assets" / "bark.png"
    img.resize((GAME_SIZE, GAME_SIZE), Image.LANCZOS).save(out, optimize=True)
    print(out)


if __name__ == "__main__":
    cmds = {"guide": guide, "offset": offset, "preview": preview, "install": install}
    if len(sys.argv) < 2 or sys.argv[1] not in cmds or (sys.argv[1] != "guide" and len(sys.argv) != 3):
        sys.exit(__doc__)
    cmds[sys.argv[1]](*sys.argv[2:])
