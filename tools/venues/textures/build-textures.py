# Builds Pickleball 98's venue surface textures (client/public/assets/venue-tex/*.webp) from
# CC0 ambientCG materials (https://ambientcg.com, CC0 1.0: free to redistribute, no credit
# required; we credit them anyway in CREDITS.txt).
#
#   python tools/venues/textures/build-textures.py <folder with the unzipped 1K-JPG sets>
#
# Each surface becomes ONE small RGBA texture the shader (park/surfaces.js) samples in world
# space, so the venue's own paint colors (matched to photos) stay as they are:
#   R = luminance detail, normalized to a mean of 0.5 (the shader multiplies the paint by it)
#   G, B = the normal map's X and Y (OpenGL convention), Z is rebuilt in the shader
#   A = ambient occlusion / cavity (from the set's AO map, else from its displacement)
# 512 px, tileable (the sources are), lossy WebP: ~40-120 KB each, 1.4 MB of GPU memory each.
import os
import sys

import numpy as np
from PIL import Image

SIZE = 512
# surface -> (ambientCG set, detail contrast, normal strength)
SETS = {
    "asphalt": ("Asphalt031", 1.0, 1.0),
    "concrete": ("Concrete034", 1.0, 0.8),
    "grass": ("Grass004", 1.0, 1.0),
    "stucco": ("Plaster001", 1.2, 1.0),
    "roof": ("RoofingTiles006", 1.0, 1.0),
    "wood": ("WoodFloor041", 1.0, 0.8),
    "deck": ("Planks037A", 1.0, 1.0),
    "carpet": ("Carpet016", 1.0, 0.7),
    "rubber": ("Rubber004", 1.0, 0.8),
    "metal": ("Metal049A", 1.0, 0.6),
    "tile": ("Tiles107", 1.0, 1.0),
    "fabric": ("Fabric030", 1.0, 0.8),
}


def load(folder, name, kind, mode="RGB"):
    for f in os.listdir(folder):
        if f.endswith(f"_{kind}.jpg"):
            return Image.open(os.path.join(folder, f)).convert(mode).resize((SIZE, SIZE), Image.LANCZOS)
    return None


def pack(lum, nrm, ao):
    l = np.asarray(lum, dtype=np.float32) / 255.0
    l = l - l.mean() + 0.5  # mean 0.5: the paint's average color is kept
    n = np.asarray(nrm, dtype=np.float32) / 255.0
    a = np.asarray(ao, dtype=np.float32) / 255.0
    out = np.stack([l, n[..., 0], n[..., 1], a], axis=-1)
    return Image.fromarray((np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA")


def build(src, name, setid, contrast, nstrength):
    folder = os.path.join(src, setid)
    color = load(folder, setid, "Color")
    lum = color.convert("L")
    if contrast != 1.0:
        a = np.asarray(lum, dtype=np.float32)
        a = (a - a.mean()) * contrast + a.mean()
        lum = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "L")
    nrm = load(folder, setid, "NormalGL")
    if nstrength != 1.0:
        n = np.asarray(nrm, dtype=np.float32) / 127.5 - 1.0
        n[..., :2] *= nstrength
        nrm = Image.fromarray(((n + 1.0) * 127.5).clip(0, 255).astype(np.uint8), "RGB")
    ao = load(folder, setid, "AmbientOcclusion", "L")
    if ao is None:
        d = np.asarray(load(folder, setid, "Displacement", "L"), dtype=np.float32) / 255.0
        ao = Image.fromarray((np.clip(0.55 + d * 0.6, 0, 1) * 255).astype(np.uint8), "L")
    return pack(lum, nrm, ao)


def acrylic(seed=7, N=256):
    # a court's acrylic coat: sand in the paint, a fine stipple (made here, not from a photo)
    rng = np.random.default_rng(seed)
    h = rng.random((N, N)).astype(np.float32)
    k = np.ones((3, 3), np.float32) / 9.0
    # a touch of blur so it reads as grain, not noise
    hp = np.pad(h, 1, mode="wrap")
    h = sum(hp[i : i + N, j : j + N] * k[i, j] for i in range(3) for j in range(3))
    # slow blotches (tileable): sampled again at a far bigger scale by the shader, they become
    # metres-wide sun fade and wear on a court
    def blobs(cells):
        g = rng.random((cells, cells)).astype(np.float32)
        t = np.linspace(0, cells, N, endpoint=False)
        i0 = np.floor(t).astype(int) % cells
        f = t - np.floor(t)
        f = f * f * (3 - 2 * f)
        rows = g[i0][:, :] * (1 - f)[:, None] + g[(i0 + 1) % cells] * f[:, None]
        return rows[:, i0] * (1 - f)[None, :] + rows[:, (i0 + 1) % cells] * f[None, :]
    macro = blobs(4) * 0.6 + blobs(9) * 0.4
    lum = 0.5 + (h - h.mean()) * 0.45 + (macro - macro.mean()) * 0.55
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 2.5
    gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 2.5
    nx, ny = 0.5 - gx * 0.5, 0.5 + gy * 0.5
    ao = np.clip(0.85 + (h - 0.5) * 0.4, 0, 1)
    out = np.stack([lum, nx, ny, ao], -1)
    return Image.fromarray((np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA")


def main():
    src = sys.argv[1]
    out = os.path.join(os.path.dirname(__file__), "..", "..", "..", "client", "public", "assets", "venue-tex")
    os.makedirs(out, exist_ok=True)
    total = 0
    for name, (setid, c, n) in SETS.items():
        img = build(src, name, setid, c, n)
        p = os.path.join(out, f"{name}.webp")
        img.save(p, "WEBP", quality=72 if name in ("grass", "carpet", "fabric", "asphalt") else 80, method=6)
        total += os.path.getsize(p)
        print(f"{name:9s} {setid:16s} {os.path.getsize(p) // 1024} KB")
    p = os.path.join(out, "acrylic.webp")
    acrylic().save(p, "WEBP", quality=80, method=6)
    total += os.path.getsize(p)
    print(f"acrylic   (generated)      {os.path.getsize(p) // 1024} KB")
    with open(os.path.join(out, "CREDITS.txt"), "w") as f:
        f.write("Surface textures derived from ambientCG materials (CC0 1.0, https://ambientcg.com):\n")
        for name, (setid, _, _) in SETS.items():
            f.write(f"  {name}.webp  <- {setid}  https://ambientcg.com/view?id={setid}\n")
        f.write("acrylic.webp is generated (tools/venues/textures/build-textures.py).\n")
    print(f"total {total // 1024} KB")


if __name__ == "__main__":
    main()
