"""The real skyline around each venue, from free elevation tiles.

For every degree of compass bearing it marches outward from the courts' middle (0.6 to 60 km)
over the terrain and keeps what an eye 1.7 m above the ground there would actually see: each
stretch of hills that rises above everything nearer, grouped into near (< 3 km), mid (3-12 km)
and far (> 12 km) land, plus open sea where the ray reaches the ocean unblocked (Newport).
Each group stores per degree [bottom, top] elevation angles (hundredths of a degree) and the
distance (km) of its top, so the game can draw them as hazy bands on a ring (horizon.js).

Elevation: the AWS Open Data "Terrain Tiles" (terrarium PNGs, s3 elevation-tiles-prod; free,
no key; sources SRTM, USGS 3DEP/NED, GMTED, ETOPO1; see https://registry.opendata.aws/terrain-tiles/).
Earth curvature and normal refraction (k = 0.13) are applied.

    python tools/venues/horizon.py [id ...]     (no ids: every venue in venues.config.json)

Writes tools/venues/horizon/<id>.json; build-venues.mjs puts it in the spec as `horizon`.
Tiles are cached in tools/venues/horizon/.tiles (git-ignored).
"""
import io, json, math, os, sys, time, urllib.request

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "horizon")
CACHE = os.path.join(OUT, ".tiles")
SPECS = os.path.join(HERE, "..", "..", "client", "src", "components", "applets", "pickleball", "park", "venues")
URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
UA = "98ish-venue-build/1.0 (Pickleball 98 My Park; https://98ish.vercel.app)"
R_EARTH = 6371000.0
K_REFR = 0.13
EYE = 1.7
START, END = 600.0, 60000.0
BANDS = [("near", 3000.0), ("mid", 12000.0), ("far", 1e9)]

_tiles = {}


def tile(z, x, y):
    key = (z, x, y)
    if key in _tiles:
        return _tiles[key]
    os.makedirs(CACHE, exist_ok=True)
    p = os.path.join(CACHE, f"{z}_{x}_{y}.png")
    if not os.path.exists(p):
        req = urllib.request.Request(URL.format(z=z, x=x, y=y), headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read()
        with open(p, "wb") as f:
            f.write(data)
        time.sleep(0.2)
    a = np.asarray(Image.open(p).convert("RGB"), dtype=np.float64)
    e = a[:, :, 0] * 256 + a[:, :, 1] + a[:, :, 2] / 256 - 32768
    _tiles[key] = e
    return e


def elev(lat, lon, z):
    n = 2 ** z
    fx = (lon + 180) / 360 * n * 256
    s = math.sin(math.radians(lat))
    fy = (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * n * 256
    fx -= 0.5
    fy -= 0.5
    x0, y0 = math.floor(fx), math.floor(fy)
    tx, ty = fx - x0, fy - y0

    def px(X, Y):
        e = tile(z, X // 256, Y // 256)
        return e[Y % 256, X % 256]

    a = px(x0, y0) * (1 - tx) + px(x0 + 1, y0) * tx
    b = px(x0, y0 + 1) * (1 - tx) + px(x0 + 1, y0 + 1) * tx
    return a * (1 - ty) + b * ty


def dest(lat, lon, brg, d):
    # small-angle step on the sphere (fine to 60 km)
    dn = d * math.cos(brg) / R_EARTH
    de = d * math.sin(brg) / (R_EARTH * math.cos(math.radians(lat)))
    return lat + math.degrees(dn), lon + math.degrees(de)


def profile(lat0, lon0):
    h0 = elev(lat0, lon0, 13) + EYE
    groups = {name: [None] * 360 for name, _ in BANDS}
    groups["sea"] = [None] * 360
    for deg in range(360):
        brg = math.radians(deg)
        run = -90.0
        first = True
        d = START
        while d <= END:
            z = 12 if d < 10000 else 10
            la, lo = dest(lat0, lon0, brg, d)
            h = elev(la, lo, z)
            sea = h <= 0.5 and d > 1500
            if sea:
                h = 0.0
            drop = d * d / (2 * R_EARTH) * (1 - K_REFR)
            ang = math.degrees(math.atan2(h - drop - h0, d))
            if ang > run:
                g = "sea" if sea else next(n for n, lim in BANDS if d < lim)
                bottom = -6.0 if first else run
                cur = groups[g][deg]
                if cur is None:
                    groups[g][deg] = [bottom, ang, d / 1000]
                else:
                    cur[0] = min(cur[0], bottom)
                    if ang > cur[1]:
                        cur[1], cur[2] = ang, d / 1000
                run = ang
                first = False
            d += 25 if d < 3000 else (60 if d < 12000 else 150)
    out = {}
    for g, cols in groups.items():
        if not any(cols):
            continue
        out[g] = [None if c is None else [round(c[0] * 100), round(c[1] * 100), round(c[2], 1)] for c in cols]
    return round(h0 - EYE, 1), out


def main():
    cfg = json.load(open(os.path.join(HERE, "venues.config.json"), encoding="utf-8"))
    ids = sys.argv[1:] or [v["id"] for v in cfg["venues"]]
    os.makedirs(OUT, exist_ok=True)
    for vid in ids:
        spec = json.load(open(os.path.join(SPECS, f"{vid}.json"), encoding="utf-8"))
        lat0, lon0 = spec["origin"]
        t0 = time.time()
        ground, groups = profile(lat0, lon0)
        tops = [c[1] for g in groups.values() for c in g if c]
        rec = {
            "_": "the real skyline (horizon.py): per compass degree 0..359 (0 = north, clockwise), [bottom, top] elevation angle in 1/100 degree and the top's distance in km, by group",
            "source": "AWS Terrain Tiles (terrarium; SRTM, USGS 3DEP, GMTED, ETOPO1), curvature + refraction k=0.13",
            "origin": [lat0, lon0],
            "ground": ground,
            "eye": EYE,
            "groups": groups,
        }
        json.dump(rec, open(os.path.join(OUT, f"{vid}.json"), "w", encoding="utf-8"), separators=(",", ":"))
        print(f"{vid}: ground {ground} m, highest {max(tops) / 100:.2f} deg, groups {sorted(groups)}, {time.time() - t0:.0f} s")


if __name__ == "__main__":
    main()
