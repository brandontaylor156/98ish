"""The ground's real shape round a venue, from free elevation tiles (Bouquet Canyon's hillside).

A square grid of heights (metres above the courts' middle) out to R m, every STEP m, sampled
from the AWS Open Data "Terrain Tiles" (terrarium z15; USGS 3DEP in the US) with the same
reader as horizon.py. build-venues.mjs puts it in the spec as `terrain` when the venue's
override asks for it (`terrain: true`); scenery.js lifts the far ground, the surroundings'
buildings and trees onto it (the walkable crop stays flat, blended at its edge).

    python tools/venues/terrain.py <id> [R=450] [STEP=15]

Writes tools/venues/terrain/<id>.json. Tiles are cached with horizon.py's (horizon/.tiles).
"""
import json, math, os, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from horizon import elev, SPECS, HERE  # noqa: E402

M = 111320.0


def main():
    vid = sys.argv[1]
    R = float(sys.argv[2]) if len(sys.argv) > 2 else 450.0
    STEP = float(sys.argv[3]) if len(sys.argv) > 3 else 15.0
    spec = json.load(open(os.path.join(SPECS, f"{vid}.json"), encoding="utf-8"))
    lat0, lon0 = spec["origin"]
    K = math.cos(math.radians(lat0))
    h0 = elev(lat0, lon0, 15)
    n = int(round(2 * R / STEP)) + 1
    t0 = time.time()
    hs = []
    for j in range(n):
        z = -R + j * STEP
        for i in range(n):
            x = -R + i * STEP
            hs.append(int(round((elev(lat0 - z / M, lon0 + x / (M * K), 15) - h0) * 10)))
    rec = {
        "_": "heights in decimetres above the courts' middle, row by row (z = south from -r, x = east from -r), every step m",
        "source": "AWS Terrain Tiles (terrarium z15; USGS 3DEP, SRTM)",
        "origin": [lat0, lon0],
        "ground": round(h0, 1),
        "r": R,
        "step": STEP,
        "n": n,
        "h": hs,
    }
    out = os.path.join(HERE, "terrain")
    os.makedirs(out, exist_ok=True)
    json.dump(rec, open(os.path.join(out, f"{vid}.json"), "w", encoding="utf-8"), separators=(",", ":"))
    print(f"{vid}: {n}x{n} heights, {min(hs) / 10:.1f}..{max(hs) / 10:.1f} m, {time.time() - t0:.0f} s")


if __name__ == "__main__":
    main()
