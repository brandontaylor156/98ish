// Marks the dry rivers in a town's prebuilt tiles (docs/open-world.md "Water") without
// rebuilding them: one Overpass query for the box's water that's dry most of the year (tagged
// intermittent=yes or seasonal=yes: Valencia's Santa Clara River, the washes, the debris and
// retention basins), and every tile's water area that lies in one becomes a `wash` (drawn as
// sand, gravel and scrub, not a blue lake). New builds get the same from data/tile.js
// areaClassOf (the tags are kept now). Our User-Agent; cached in
// tools/roam/cache/<town>/washes.json (not committed). Data © OpenStreetMap contributors, ODbL 1.0.
//
//   node tools/roam/mark-washes.mjs valencia [--refetch]

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { townById } from "../../client/src/roam/towns/index.js"
import { compactElement, stitchRings } from "../../client/src/roam/data/osm.js"
import { AREA, decodeTile, isWash } from "../../client/src/roam/data/tile.js"
import { TILE_ZOOM, townFrame } from "../../client/src/roam/geo.js"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, "..", "..")
const UA = "98ish-roam-build/1.0 (98ish open world; https://98ish.vercel.app)"
const id = process.argv[2] || "valencia"
const town = townById(id)
if (!town) throw new Error(`no town ${id}`)
const CACHE = path.join(HERE, "cache", id)
fs.mkdirSync(CACHE, { recursive: true })
const file = path.join(CACHE, "washes.json")
const OUT = path.join(ROOT, "client", "public", town.prebuilt.replace(/^\//, ""))

export const washQuery = ({ south, west, north, east }) => {
  const b = [south, west, north, east].map((v) => v.toFixed(6)).join(",")
  return `[out:json][timeout:120];(
way["natural"="water"]["intermittent"="yes"](${b});relation["natural"="water"]["intermittent"="yes"](${b});
way["natural"="water"]["seasonal"="yes"](${b});relation["natural"="water"]["seasonal"="yes"](${b});
way["waterway"="riverbank"]["intermittent"="yes"](${b});way["landuse"="basin"]["intermittent"="yes"](${b});
);out geom qt;`
}

if (process.argv.includes("--refetch") || !fs.existsSync(file)) {
  const MIRRORS = ["https://overpass-api.de/api/interpreter", "https://z.overpass-api.de/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"]
  let text = null
  for (let attempt = 0; attempt < 6 && !text; attempt++) {
    const url = MIRRORS[attempt % MIRRORS.length]
    try {
      const res = await fetch(url, { method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" }, body: "data=" + encodeURIComponent(washQuery(town.bbox)) })
      if (!res.ok) throw new Error(`Overpass ${res.status}`)
      text = await res.text()
    } catch (e) {
      console.log(`  ${url}: ${e.message}; waiting 20 s`)
      await new Promise((r) => setTimeout(r, 20000))
    }
  }
  if (!text) throw new Error("Overpass failed")
  fs.writeFileSync(file, text)
}
const frame = townFrame(town.origin)
const data = JSON.parse(fs.readFileSync(file, "utf8"))
// the washes as rings in town metres (outer rings; a hole in a wash is still the riverbed's)
const washes = []
for (const raw of data.elements) {
  const el = compactElement(raw)
  if (!el || !isWash(el.tags)) continue
  const rings = el.type === "relation" ? stitchRings(el.members.filter((m) => m.role !== "inner").map((m) => m.geom)) : [el.geom]
  for (const r of rings) {
    if (r.length < 4) continue
    const ring = r.map(([lat, lon]) => frame.toXZ(lat, lon))
    let x0 = Infinity
    let x1 = -Infinity
    let z0 = Infinity
    let z1 = -Infinity
    for (const p of ring) {
      x0 = Math.min(x0, p.x)
      x1 = Math.max(x1, p.x)
      z0 = Math.min(z0, p.z)
      z1 = Math.max(z1, p.z)
    }
    washes.push({ ring, box: { x0: x0 - 6, x1: x1 + 6, z0: z0 - 6, z1: z1 + 6 } })
  }
}
const inRing = (r, x, z) => {
  let ins = false
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) if (r[i].z > z !== r[j].z > z && x < ((r[j].x - r[i].x) * (z - r[i].z)) / (r[j].z - r[i].z) + r[i].x) ins = !ins
  return ins
}
const nearEdge = (r, x, z, m) => {
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[j]
    const b = r[i]
    const dx = b.x - a.x
    const dz = b.z - a.z
    const L2 = dx * dx + dz * dz || 1e-9
    const k = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2))
    if (Math.hypot(x - a.x - dx * k, z - a.z - dz * k) < m) return true
  }
  return false
}
// is a point in (or on the edge of) a wash?
const inWash = (x, z) => washes.some((w) => x >= w.box.x0 && x <= w.box.x1 && z >= w.box.z0 && z <= w.box.z1 && (inRing(w.ring, x, z) || nearEdge(w.ring, x, z, 5)))

const index = JSON.parse(fs.readFileSync(path.join(OUT, "index.json"), "utf8"))
const dir = path.join(OUT, String(TILE_ZOOM))
let tiles = 0
let marked = 0
let bytes = 0
for (const x of fs.readdirSync(dir))
  for (const f of fs.readdirSync(path.join(dir, x))) {
    const p = path.join(dir, x, f)
    const raw = JSON.parse(fs.readFileSync(p, "utf8"))
    const d = decodeTile(raw, frame, index.base)
    let changed = false
    d.areas.forEach((a, i) => {
      if (a.cls !== AREA.water && a.cls !== AREA.wash) return
      // (most of the outline in a mapped wash: clipped pieces too, their tile-edge corners count)
      const pts = a.ring
      const n = pts.filter((q) => inWash(q.x, q.z)).length
      const wash = n / pts.length >= 0.6
      const cls = wash ? AREA.wash : AREA.water
      if (cls !== raw.a[i][0]) {
        raw.a[i][0] = cls
        changed = true
      }
      if (wash) marked++
    })
    if (changed) {
      raw.a.sort((p, q) => p[0] - q[0])
      fs.writeFileSync(p, JSON.stringify(raw))
      tiles++
    }
    bytes += fs.statSync(p).size
  }
index.bytes = bytes
index.washes = { source: "OpenStreetMap natural=water|waterway=riverbank|landuse=basin with intermittent=yes|seasonal=yes", built: new Date().toISOString().slice(0, 10), areas: marked }
fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify(index))
console.log(`${town.name}: ${washes.length} dry water rings; ${marked} tile areas marked as washes in ${tiles} tiles`)
