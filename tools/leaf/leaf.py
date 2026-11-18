"""The leaf's picture (assets/leaf.png): a guide for painting it, and putting
a painting into the game.

Every leaf (assets/leaf.glb, and each leaf of the trees, copies of it) is
coloured by paint on its corners, times a square picture laid flat on it from
the front, tip at the top, as tall as the square (MARGIN and the leaf's own
size say where; the back shows it through). Only what's inside the leaf's
outline is ever seen, so a painting can fill the whole square.

So that a leaf keeps the colour its paint gives it, the picture is stored as
each colour over the painting's average (then over K, to fit; the models'
paint is K times brighter to make up): the painting's brushwork shows as
lighter and darker, not its overall colour.

  python3 tools/leaf/leaf.py guide
    writes, here, both 2048 px:
      leaf-guide.png    the outline (transparent, to lay over the painting as
                        a locked top layer), with the folds marked
      leaf-current.png  the leaf's paint, in the same place

  python3 tools/leaf/leaf.py install painting.png
    puts it in the game: assets/leaf.png, 512 px.
"""

import json
import struct
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).resolve().parent
N = 2048
MARGIN = 96  # clear above the tip and below the stem
K = 1.5  # the models' paint is this much brighter than it shows, the picture as much darker
GAME_SIZE = 512


def leaf():
    b = (HERE.parent.parent / "assets" / "leaf.glb").read_bytes()
    jl = struct.unpack_from("<I", b, 12)[0]
    j = json.loads(b[20 : 20 + jl])
    binc = b[28 + jl :]

    def acc(i):
        a = j["accessors"][i]
        bv = j["bufferViews"][a["bufferView"]]
        n = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[a["type"]]
        dt = {5126: "<f4", 5123: "<u2", 5125: "<u4"}[a["componentType"]]
        off = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
        return np.frombuffer(binc, dtype=dt, count=a["count"] * n, offset=off).reshape(a["count"], n)

    p = j["meshes"][0]["primitives"][0]
    at = p["attributes"]
    return acc(at["POSITION"]), acc(at["COLOR_0"]), acc(p["indices"]).reshape(-1, 3)


def install(src):
    im = Image.open(src).convert("RGB").resize((GAME_SIZE, GAME_SIZE), Image.LANCZOS)
    a = np.asarray(im).astype(float) / 255
    light = np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)  # as light, not as screen colours
    rel = np.clip(light / light.reshape(-1, 3).mean(axis=0) / K, 0, 1)
    out = np.where(rel <= 0.0031308, rel * 12.92, 1.055 * rel ** (1 / 2.4) - 0.055)
    dst = HERE.parent.parent / "assets" / "leaf.png"
    Image.fromarray((out * 255 + 0.5).astype(np.uint8), "RGB").save(dst, optimize=True)
    print(dst)


def guide():
    pos, col, tri = leaf()
    col = col / K
    # Flat from the front: x across, y up the picture, the leaf's length
    # filling the square between the margins, centred.
    lo, hi = pos.min(axis=0), pos.max(axis=0)
    k = (N - 2 * MARGIN) / (hi[1] - lo[1])
    px = np.stack([N / 2 + (pos[:, 0] - (lo[0] + hi[0]) / 2) * k, MARGIN + (hi[1] - pos[:, 1]) * k], axis=1)

    # The paint as it is: each triangle filled, its corners' colours blended,
    # the nearest (the front) kept.
    img = np.zeros((N, N, 3))
    depth = np.full((N, N), -np.inf)
    ys, xs = np.mgrid[0:N, 0:N]
    for t in tri:
        (x0, y0), (x1, y1), (x2, y2) = px[t]
        lo_x, hi_x = int(max(0, min(x0, x1, x2))), int(min(N - 1, max(x0, x1, x2)) + 1)
        lo_y, hi_y = int(max(0, min(y0, y1, y2))), int(min(N - 1, max(y0, y1, y2)) + 1)
        den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
        if abs(den) < 1e-9:
            continue
        X, Y = xs[lo_y:hi_y, lo_x:hi_x] + 0.5, ys[lo_y:hi_y, lo_x:hi_x] + 0.5
        w0 = ((y1 - y2) * (X - x2) + (x2 - x1) * (Y - y2)) / den
        w1 = ((y2 - y0) * (X - x2) + (x0 - x2) * (Y - y2)) / den
        w2 = 1 - w0 - w1
        z = w0 * pos[t[0], 2] + w1 * pos[t[1], 2] + w2 * pos[t[2], 2]
        m = (w0 >= -1e-4) & (w1 >= -1e-4) & (w2 >= -1e-4) & (z > depth[lo_y:hi_y, lo_x:hi_x])
        c = w0[..., None] * col[t[0]] + w1[..., None] * col[t[1]] + w2[..., None] * col[t[2]]
        img[lo_y:hi_y, lo_x:hi_x][m] = c[m]
        depth[lo_y:hi_y, lo_x:hi_x][m] = z[m]
    hit = np.isfinite(depth)
    srgb = np.where(img <= 0.0031308, img * 12.92, 1.055 * np.clip(img, 0, 1) ** (1 / 2.4) - 0.055)  # the paint's stored as light, not as screen colours
    Image.fromarray(np.dstack([np.clip(srgb * 255, 0, 255), hit * 255]).astype(np.uint8), "RGBA").save(HERE / "leaf-current.png")

    # The guide: the leaf's edge, how far past it to paint, and its folds.
    mask = Image.fromarray((hit * 255).astype(np.uint8), "L")
    ring = lambda m, w: ImageChops.subtract(m.filter(ImageFilter.MaxFilter(w)), m.filter(ImageFilter.MinFilter(w)))
    guide = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    d = ImageDraw.Draw(guide)
    normal = np.cross(pos[tri[:, 1]] - pos[tri[:, 0]], pos[tri[:, 2]] - pos[tri[:, 0]])
    for t in tri[normal[:, 2] > 0]:  # the front's
        for a, b in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])):
            d.line([tuple(px[a]), tuple(px[b])], fill=(255, 255, 255, 80), width=2)
    out = mask.filter(ImageFilter.MaxFilter(49))  # 24 px out all round
    guide.paste(Image.new("RGBA", (N, N), (0, 160, 255, 255)), mask=ring(out, 5))
    guide.paste(Image.new("RGBA", (N, N), (255, 0, 170, 255)), mask=ring(mask, 7))

    font = ImageFont.load_default(size=44)
    small = ImageFont.load_default(size=34)

    def label(xy, text, f=font, fill=(255, 255, 255, 255)):
        d.text(xy, text, font=f, fill=fill, stroke_width=4, stroke_fill=(0, 0, 0, 255))

    tip, stem = px[pos[:, 1].argmax()], px[pos[:, 1].argmin()]
    label((tip[0] + 90, tip[1] - 20), "tip")
    label((stem[0] + 90, stem[1] - 50), "stem")
    label((40, 40), "Leaf · 2048 px", small)
    label((40, 90), "Pink: the leaf's edge", small, (255, 120, 210, 255))
    label((40, 140), "Blue: paint out to here", small, (120, 200, 255, 255))
    label((40, 190), "White: its folds", small)
    guide.save(HERE / "leaf-guide.png")
    print(HERE / "leaf-guide.png")
    print(HERE / "leaf-current.png")


if __name__ == "__main__":
    if sys.argv[1:] == ["guide"]:
        guide()
    elif len(sys.argv) == 3 and sys.argv[1] == "install":
        install(sys.argv[2])
    else:
        sys.exit(__doc__)
