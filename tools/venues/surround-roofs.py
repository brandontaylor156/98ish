"""Roof shapes and colours of a venue's mapped surroundings, read off an aerial.

OSM gives each building round a venue its footprint and height; this reads the roof over each
footprint in a georeferenced aerial (Esri World Imagery, the reference pack's `wide/aerial.jpg`,
north-up, centred on the spec's origin; reference only, never shipped):
- the colour: the median of the footprint (shrunk 1 px so the walls' edges and shadows stay out);
- pitched or flat: a pitched roof shows its two slopes in two tones (one toward the sun, one
  away), so the footprint is split along its long axis and the halves' mean brightness compared;
  more than PITCH apart (0..255) and a small enough footprint = a hip roof, else flat.
Only numbers are written (tools/venues/surround-roofs/<id>.json, keyed by the footprint's first
corner): surround.mjs adds them to the spec's surroundings (r, rc, rise) and surround.js draws
them. Venues without the file build exactly as before.

    python tools/venues/surround-roofs.py <id> <aerial dir with aerial.jpg + aerial.json>
"""
import json, math, os, sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
SPECS = os.path.join(HERE, "..", "..", "client", "src", "components", "applets", "pickleball", "park", "venues")
PITCH = 9.0
MAX_AREA = 1500.0


def main():
    vid, adir = sys.argv[1], sys.argv[2]
    spec = json.load(open(os.path.join(SPECS, f"{vid}.json"), encoding="utf-8"))
    meta = json.load(open(os.path.join(adir, "aerial.json"), encoding="utf-8"))
    im = np.asarray(Image.open(os.path.join(adir, "aerial.jpg")).convert("RGB"), dtype=np.float64)
    H, W = im.shape[:2]
    mpp = meta["m_per_px"]
    cu, cv = meta["anchor"]["px"]
    lat0, lon0 = spec["origin"]
    # the aerial's anchor in the spec's metres (x east, z south)
    K = math.cos(math.radians(lat0))
    ax = (meta["anchor"]["lon"] - lon0) * 111320 * K
    az = -(meta["anchor"]["lat"] - lat0) * 111320
    lum = im @ np.array([0.299, 0.587, 0.114])
    out = {}
    n_hip = n_flat = 0
    for b in spec.get("surround", {}).get("buildings", []):
        p = b["p"]
        pix = [(cu + (x - ax) / mpp, cv + (z - az) / mpp) for x, z in p]
        if any(u < 2 or v < 2 or u > W - 3 or v > H - 3 for u, v in pix):
            continue
        mask = Image.new("L", (W, H), 0)
        ImageDraw.Draw(mask).polygon(pix, fill=255)
        mask = mask.filter(ImageFilter.MinFilter(3))
        m = np.asarray(mask) > 0
        if m.sum() < 12:
            continue
        col = np.median(im[m], axis=0)
        # area and the long axis (the longest edge)
        area = 0.0
        best = None
        for i in range(len(p)):
            x0, z0 = p[i]
            x1, z1 = p[(i + 1) % len(p)]
            area += x0 * z1 - x1 * z0
            L = math.hypot(x1 - x0, z1 - z0)
            if best is None or L > best[0]:
                best = (L, (x1 - x0) / L, (z1 - z0) / L)
        area = abs(area) / 2
        _, ux, uz = best
        vs, us = np.nonzero(m)
        xs = ax + (us - cu) * mpp
        zs = az + (vs - cv) * mpp
        w = -xs * uz + zs * ux
        wm = np.median(w)
        L = lum[vs, us]
        d = abs(L[w < wm].mean() - L[w >= wm].mean()) if (w < wm).any() and (w >= wm).any() else 0
        ws = np.percentile(w, 95) - np.percentile(w, 5)
        hip = d > PITCH and area < MAX_AREA
        key = f"{p[0][0]},{p[0][1]}"
        rec = {"rc": "#%02x%02x%02x" % tuple(int(min(255, c * 1.12)) for c in col)}
        if hip:
            rec["r"] = "hip"
            rec["rise"] = round(min(3.0, 0.21 * ws), 1)
            n_hip += 1
        else:
            n_flat += 1
        out[key] = rec
    os.makedirs(os.path.join(HERE, "surround-roofs"), exist_ok=True)
    json.dump({"_": "per surround building (key: its footprint's first corner in the spec's metres): rc = roof colour off the aerial, r = hip when its two slopes read in two tones, rise = 5:12 pitch over its width (surround-roofs.py)", "source": meta.get("source", "aerial"), "roofs": out}, open(os.path.join(HERE, "surround-roofs", f"{vid}.json"), "w", encoding="utf-8"), separators=(",", ":"))
    print(f"{vid}: {n_hip} hip roofs, {n_flat} flat, {len(spec.get('surround', {}).get('buildings', [])) - n_hip - n_flat} outside the aerial")


if __name__ == "__main__":
    main()
