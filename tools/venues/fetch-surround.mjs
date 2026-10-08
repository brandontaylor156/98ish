// Fetches what really stands around each venue, out to SURROUND_R (500 m), from the public
// Overpass API: buildings (with their height / building:levels when mapped), parks, golf
// courses (fairways, greens, bunkers), woods and water, single trees and tree rows, rail lines
// (bridges included) and the bigger roads. Saved in osm/<id>.surround.json; build-venues.mjs
// turns it into the spec's `surround` (only what lies outside the walkable crop).
// Data © OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright).
//
//   node tools/venues/fetch-surround.mjs [id ...]      (no ids: all venues)
//
// Polite like fetch-osm.mjs: one query at a time, 25 s apart, a User-Agent, 90 s back-off on
// HTTP 429/504. Run it rarely: the saved files are what the build uses.

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CONFIG = JSON.parse(fs.readFileSync(path.join(HERE, "venues.config.json"), "utf8"))
const OUT = path.join(HERE, "osm")
// (the main instance first; its mirrors when it is busy: 429/504 move on to the next)
const ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://lz4.overpass-api.de/api/interpreter", "https://z.overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"]
const UA = "98ish-venue-build/1.0 (Pickleball 98 My Park; https://98ish.vercel.app)"
export const SURROUND_R = 500
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const KEEP = new Set(["building", "building:levels", "height", "roof:shape", "roof:colour", "building:colour", "name", "leisure", "golf", "natural", "landuse", "railway", "bridge", "layer", "highway", "water", "leaf_type", "genus", "denotation"])

const queryFor = (v) => {
  const a = `around:${SURROUND_R},${v.lat},${v.lon}`
  return `[out:json][timeout:150];(
way(${a})[building];
relation(${a})[building];
nwr(${a})[leisure~"^(park|golf_course|nature_reserve|garden|pitch)$"];
nwr(${a})[golf~"^(fairway|green|bunker|tee|rough|water_hazard|lateral_water_hazard)$"];
nwr(${a})[natural~"^(wood|scrub|water|grassland|tree_row|beach|sand|wetland)$"];
nwr(${a})[landuse~"^(forest|grass|meadow|recreation_ground|cemetery|village_green|orchard)$"];
node(${a})[natural=tree];
way(${a})[railway~"^(rail|light_rail|subway|tram)$"];
way(${a})[highway~"^(motorway|trunk|primary|secondary|tertiary|motorway_link|trunk_link)$"];
);out tags geom qt;`
}

const r6 = (x) => Math.round(x * 1e6) / 1e6
const compact = (el) => {
  const tags = {}
  for (const [k, val] of Object.entries(el.tags || {})) if (KEEP.has(k)) tags[k] = val
  const o = { t: el.type[0], id: el.id, tags }
  if (el.type === "node") o.p = [r6(el.lat), r6(el.lon)]
  else if (el.type === "way" && el.geometry) o.g = el.geometry.filter(Boolean).map((p) => [r6(p.lat), r6(p.lon)])
  else if (el.type === "relation" && el.members) o.m = el.members.filter((m) => m.type === "way" && m.geometry).map((m) => ({ role: m.role, g: m.geometry.filter(Boolean).map((p) => [r6(p.lat), r6(p.lon)]) }))
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
    return res.json()
  }
  throw new Error(`${v.id}: gave up after retries`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ids = process.argv.slice(2)
  const list = CONFIG.venues.filter((v) => !ids.length || ids.includes(v.id))
  fs.mkdirSync(OUT, { recursive: true })
  for (let i = 0; i < list.length; i++) {
    const v = list[i]
    if (i) await sleep(25_000)
    const data = await fetchOne(v)
    const els = (data.elements || []).map(compact).filter((e) => e.p || e.g?.length || e.m?.length)
    const out = { id: v.id, center: [v.lat, v.lon], radius: SURROUND_R, osm_base: data.osm3s?.timestamp_osm_base || null, license: "© OpenStreetMap contributors, ODbL 1.0", elements: els }
    fs.writeFileSync(path.join(OUT, `${v.id}.surround.json`), JSON.stringify(out))
    console.log(`${v.id}: ${els.length} elements, ${(JSON.stringify(out).length / 1024).toFixed(0)} KB`)
  }
}
