// Fetches the OpenStreetMap data around each real venue (venues.config.json) from the public
// Overpass API and saves a compact copy in osm/<id>.json for build-venues.mjs.
// Data © OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright).
//
//   node tools/venues/fetch-osm.mjs [id ...]      (no ids: all venues)
//
// Polite by design (Overpass usage policy): one query at a time, 25 s apart, a User-Agent
// that says who we are, 90 s back-off on HTTP 429. Run it rarely: the saved files are what
// the build uses.

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CONFIG = JSON.parse(fs.readFileSync(path.join(HERE, "venues.config.json"), "utf8"))
const OUT = path.join(HERE, "osm")
// (the main instance first; its mirrors when it is busy: 429/504 move on to the next)
const ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://lz4.overpass-api.de/api/interpreter", "https://z.overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"]
const UA = "98ish-venue-build/1.0 (Pickleball 98 My Park; https://98ish.vercel.app)"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// the tags the generator reads (everything else is dropped to keep the files small)
const KEEP = new Set(["leisure", "sport", "surface", "lit", "covered", "indoor", "access", "name", "building", "building:levels", "height", "roof:shape", "amenity", "barrier", "natural", "landuse", "highway", "service", "man_made", "water", "leaf_type", "genus", "species", "colour", "surface:colour", "parking", "layer", "area", "width", "operator", "club"])

const bboxOf = ({ lat, lon, radius }) => {
  const dLat = radius / 111320
  const dLon = radius / (111320 * Math.cos((lat * Math.PI) / 180))
  return [lat - dLat, lon - dLon, lat + dLat, lon + dLon].map((v) => v.toFixed(6)).join(",")
}
const queryFor = (v) => {
  const a = `around:${v.radius},${v.lat},${v.lon}`
  return `[out:json][timeout:120];(
nwr(${a})[leisure];
nwr(${a})[building];
way(${a})[barrier~"^(fence|wall|hedge|retaining_wall)$"];
nwr(${a})[natural~"^(tree|tree_row|wood|scrub|water|grassland)$"];
nwr(${a})[landuse];
nwr(${a})[amenity~"^(parking|restaurant|bar|cafe|toilets|bench|shelter|school|drinking_water)$"];
way(${a})[highway];
node(${a})[man_made~"^(lamp_post|flagpole|mast)$"];
node(${a})[highway=street_lamp];
);out tags geom(${bboxOf(v)}) qt;`
}

const compact = (el) => {
  const tags = {}
  for (const [k, v] of Object.entries(el.tags || {})) if (KEEP.has(k)) tags[k] = v
  const o = { t: el.type[0], id: el.id, tags }
  const r6 = (x) => Math.round(x * 1e6) / 1e6
  if (el.type === "node") o.p = [r6(el.lat), r6(el.lon)]
  else if (el.type === "way" && el.geometry) o.g = el.geometry.filter(Boolean).map((p) => [r6(p.lat), r6(p.lon)])
  else if (el.type === "relation" && el.members) {
    o.m = el.members.filter((m) => m.type === "way" && m.geometry).map((m) => ({ role: m.role, g: m.geometry.filter(Boolean).map((p) => [r6(p.lat), r6(p.lon)]) }))
  }
  return o
}

const fetchOne = async (v) => {
  for (let attempt = 0; attempt < 8; attempt++) {
    const res = await fetch(ENDPOINTS[attempt % ENDPOINTS.length], { method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" }, body: "data=" + encodeURIComponent(queryFor(v)) })
    if (res.status === 429 || res.status === 504) {
      console.log(`  ${v.id}: HTTP ${res.status}, waiting 90 s`)
      await sleep(90_000)
      continue
    }
    if (!res.ok) throw new Error(`${v.id}: HTTP ${res.status}`)
    const data = await res.json()
    return data
  }
  throw new Error(`${v.id}: gave up after retries`)
}

const ids = process.argv.slice(2)
const list = CONFIG.venues.filter((v) => !ids.length || ids.includes(v.id))
fs.mkdirSync(OUT, { recursive: true })
for (let i = 0; i < list.length; i++) {
  const v = list[i]
  if (i) await sleep(25_000)
  const t0 = Date.now()
  const data = await fetchOne(v)
  const els = data.elements.map(compact).filter((e) => e.p || (e.g && e.g.length) || (e.m && e.m.length))
  const out = { venue: v.id, anchor: [v.lat, v.lon], radius: v.radius, osm_base: data.osm3s?.timestamp_osm_base || null, license: "Data © OpenStreetMap contributors, ODbL 1.0", elements: els }
  fs.writeFileSync(path.join(OUT, `${v.id}.json`), JSON.stringify(out))
  console.log(`${v.id}: ${els.length} elements, ${Math.round(JSON.stringify(out).length / 1024)} KB, ${Date.now() - t0} ms`)
}
