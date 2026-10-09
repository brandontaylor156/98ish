"""What covers the ground round a venue, read off an aerial (Bouquet Canyon's hillside).

The terrain grid (terrain.py) gives the hills their shape; this gives them their skin. Over the
terrain's square (out to its r) it reads a georeferenced aerial (Esri World Imagery z18, the
reference pack's `wide/aerial.jpg`, north-up; reference only, never shipped) and writes only
numbers and letters:
- `cover`: one letter per CELL m cell, row by row from (-r, -r) (z south, x east): g grass,
  s scrub (chaparral, the dark patches on the slopes), b bare (trails, dirt), . anything built
  or paved (the surroundings' own painting shows there);
- `shrubs`: [x, z, size] of the scrub clumps big enough to stand up, SHRUB m apart at most,
  where no mapped building or tree is near; each is a dark blob on the aerial.
The aerial's season doesn't decide the colours (it's green in spring, gold by summer): the
spec's colours come from the owner's photos; the aerial only says where each kind is.

    python tools/venues/terrain-cover.py <id> <aerial dir with aerial.jpg + aerial.json>

Writes tools/venues/terrain/<id>.cover.json; build-venues.mjs adds it to spec.terrain.
"""
import json, math, os, sys

import numpy as np
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
SPECS = os.path.join(HERE, "..", "..", "client", "src", "components", "applets", "pickleball", "park", "venues")
CELL = 7.5
SHRUB = 6.0
MAX_SHRUBS = 4000


def main():
    vid, adir = sys.argv[1], sys.argv[2]
    spec = json.load(open(os.path.join(SPECS, f"{vid}.json"), encoding="utf-8"))
    T = spec["terrain"]
    R = T["r"]
    meta = json.load(open(os.path.join(adir, "aerial.json"), encoding="utf-8"))
    img = Image.open(os.path.join(adir, "aerial.jpg")).convert("RGB")
    im = np.asarray(img, dtype=np.float64)
    H, W = im.shape[:2]
    mpp = meta["m_per_px"]
    cu, cv = meta["anchor"]["px"]
    lat0, lon0 = spec["origin"]
    K = math.cos(math.radians(lat0))
    ax = (meta["anchor"]["lon"] - lon0) * 111320 * K
    az = -(meta["anchor"]["lat"] - lat0) * 111320
    px = lambda x, z: (cu + (x - ax) / mpp, cv + (z - az) / mpp)
    # per-pixel classes: lightness, greenness, saturation
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    L = 0.299 * r + 0.587 * g + 0.114 * b
    mx = im.max(axis=2)
    mn = im.min(axis=2)
    sat = (mx - mn) / np.maximum(mx, 1)
    # (the hillside's own grass sets the scale: scrub is clearly darker than it)
    grassL = np.median(L[(g > r) & (g > b)])
    dark = L < grassL * 0.72
    bare = (L > grassL * 1.35) & (r >= g) & (sat < 0.35)
    # built: grey, unsaturated pixels that aren't bare dirt (roofs, roads, lots) in clusters
    grey = (sat < 0.12) & ~dark
    # small bushes: specks darker than the ground round them (a 7 m neighbourhood)
    Lloc = np.asarray(Image.fromarray(np.clip(L, 0, 255).astype(np.uint8)).filter(ImageFilter.BoxBlur(7)), dtype=np.float64)
    dots = L < Lloc * 0.8
    built = np.asarray(Image.fromarray((grey * 255).astype(np.uint8)).filter(ImageFilter.BoxBlur(6))) > 90
    # mapped things: no scrub near buildings or the venue's own crop
    bld = [bb["p"] for bb in spec.get("surround", {}).get("buildings", [])] + [bb["p"] for bb in spec.get("buildings", [])]
    centres = [(sum(p[0] for p in q) / len(q), sum(p[1] for p in q) / len(q), max(math.hypot(p[0] - sum(pp[0] for pp in q) / len(q), p[1] - sum(pp[1] for pp in q) / len(q)) for p in q)) for q in bld]
    xs = [c["x"] for c in spec["courts"]]
    zs = [c["z"] for c in spec["courts"]]
    crop = (min(xs) - 40, max(xs) + 40, min(zs) - 40, max(zs) + 40)

    trees = [(t[0], t[1]) for t in spec.get("trees", [])] + [(t[0], t[1]) for t in spec.get("surround", {}).get("trees", [])]

    # (scrub only on the slopes: flat dark patches in the park are its trees, not shrubs)
    hn, hstep, hr = T["n"], T["step"], T["r"]
    def hat(x, z):
        i = min(hn - 1, max(0, int(round((x + hr) / hstep))))
        j = min(hn - 1, max(0, int(round((z + hr) / hstep))))
        return T["h"][j * hn + i] / 10

    def slope(x, z):
        return max(abs(hat(x + hstep, z) - hat(x - hstep, z)), abs(hat(x, z + hstep) - hat(x, z - hstep))) / (2 * hstep)

    def hillside(x, z):
        return hat(x, z) > 4 or slope(x, z) > 0.12

    def near_tree(x, z, m):
        return any(abs(x - tx) < m and abs(z - tz) < m and math.hypot(x - tx, z - tz) < m for tx, tz in trees)

    def near_built(x, z, m):
        if crop[0] < x < crop[1] and crop[2] < z < crop[3]:
            return True
        return any(math.hypot(x - cx, z - cz) < rr + m for cx, cz, rr in centres)

    n = int(round(2 * R / CELL)) + 1
    rows = []
    dens = []
    stats = {"g": 0, "s": 0, "b": 0, ".": 0}
    half = CELL / 2 / mpp
    for j in range(n):
        row = []
        drow = []
        z = -R + j * CELL
        for i in range(n):
            x = -R + i * CELL
            u, v = px(x, z)
            u0, u1, v0, v1 = int(u - half), int(u + half) + 1, int(v - half), int(v + half) + 1
            if u0 < 0 or v0 < 0 or u1 > W or v1 > H:
                row.append(".")
                drow.append("0")
                stats["."] += 1
                continue
            win = (slice(v0, v1), slice(u0, u1))
            fb = built[win].mean()
            fd = dark[win].mean()
            fr = bare[win].mean()
            if fb > 0.45 or near_built(x, z, 4):
                c = "."
            elif fd > 0.45 and hillside(x, z) and not near_tree(x, z, 8):
                c = "s"
            elif fr > 0.4:
                c = "b"
            else:
                c = "g"
            stats[c] += 1
            row.append(c)
            fdot = dots[win].mean() if c in "gb" and hillside(x, z) else 0
            drow.append(str(min(9, int(round(fdot * 45)))))
        rows.append("".join(row))
        dens.append("".join(drow))
    # shrubs: dark clumps on the slopes, SHRUB m apart, sized by how much of the cell is dark
    shrubs = []
    step = SHRUB
    hs = step / 2 / mpp
    rng = np.random.default_rng(7)
    m = int(2 * R / step)
    for j in range(m):
        for i in range(m):
            x = -R + (i + 0.5) * step + (rng.random() - 0.5) * step * 0.6
            z = -R + (j + 0.5) * step + (rng.random() - 0.5) * step * 0.6
            u, v = px(x, z)
            u0, u1, v0, v1 = int(u - hs), int(u + hs) + 1, int(v - hs), int(v + hs) + 1
            if u0 < 0 or v0 < 0 or u1 > W or v1 > H:
                continue
            win = (slice(v0, v1), slice(u0, u1))
            fd = max(dark[win].mean(), dots[win].mean() * 1.6)
            jj, ii = int(round((z + R) / CELL)), int(round((x + R) / CELL))
            hood = [rows[b][a] for b in range(max(0, jj - 2), min(n, jj + 3)) for a in range(max(0, ii - 2), min(n, ii + 3))]
            if fd < 0.16 or built[win].mean() > 0.3 or "." in hood or near_built(x, z, 6) or near_tree(x, z, 7) or not hillside(x, z):
                continue
            shrubs.append([round(x, 1), round(z, 1), round(1.0 + 3.0 * min(1, fd), 1)])
    if len(shrubs) > MAX_SHRUBS:
        idx = rng.choice(len(shrubs), MAX_SHRUBS, replace=False)
        shrubs = [shrubs[k] for k in sorted(idx)]
    rec = {
        "_": "cover per cell (g grass, s scrub, b bare, . built/paved), row by row from (-r, -r), z south; dots: bush specks per cell 0-9 (hillside grass); shrubs [x, z, size m]",
        "source": meta.get("source", "aerial") + " (classes only)",
        "r": R,
        "cell": CELL,
        "n": n,
        "cover": rows,
        "dots": dens,
        "shrubs": shrubs,
    }
    out = os.path.join(HERE, "terrain", f"{vid}.cover.json")
    json.dump(rec, open(out, "w", encoding="utf-8"), separators=(",", ":"))
    print(f"{vid}: {n}x{n} cells {stats}, {len(shrubs)} shrubs -> {out}")


if __name__ == "__main__":
    main()
