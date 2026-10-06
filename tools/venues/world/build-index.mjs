// Builds Venue Finder's index: every pickleball venue in OpenStreetMap, worldwide, as small
// static shards the phone searches offline (client/public/venues/idx/). Pure logic lives in
// client/.../pickleball/park/live/finder.js (shared with the app, the server and the tests).
// Data © OpenStreetMap contributors, ODbL 1.0: the index is a derivative database under the
// same licence (client/public/venues/idx/LICENSE.txt says so).
//
//   node tools/venues/world/build-index.mjs [--cache DIR] [--refresh] [--region us|world]
//
// Three Overpass queries, one at a time, 30 s apart (polite: identify the app, back off on
// 429/504, cache the raw answers in --cache so a rebuild doesn't ask again unless --refresh):
//   1. every feature tagged pickleball (courts, tennis courts with lines, halls, clubs), centres
//   2. named parks, sports centres, clubs and schools within 150 m of those (for names)
//   3. cities, towns and suburbs (for "Pickleball courts, <town>" and town search)
// Monthly from GitHub Actions (.github/workflows/venue-index.yml) or by hand.

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, "../../..")
const OUT = path.join(ROOT, "client/public/venues/idx")
const F = await import(pathToFileURL(path.join(ROOT, "client/src/components/applets/pickleball/park/live/finder.js")).href)

const arg = (k, d = null) => {
  const i = process.argv.indexOf(k)
  return i > 0 ? process.argv[i + 1] : d
}
const CACHE = arg("--cache", path.join(HERE, ".cache"))
const REFRESH = process.argv.includes("--refresh")
const REGION = arg("--region", "world")
const ENDPOINT = process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter"
const UA = "98ish-venue-index/1.0 (Pickleball 98 Venue Finder; https://98ish.vercel.app)"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// the area a query covers: the whole world, or a box
const AREAS = {
  world: "",
  us: "(18.5,-179.9,71.6,-66.5)",
  ca: "(32.4,-124.6,42.1,-114.0)",
}
const box = AREAS[REGION] ?? ""

const QUERIES = {
  features: `[out:json][timeout:900][maxsize:1073741824];(
nwr["sport"~"pickleball"]${box};
nwr["leisure"~"^(pitch|court)$"]["pickleball"="yes"]${box};
);out center tags qt;`,
  places: `[out:json][timeout:900][maxsize:1073741824];
nwr["sport"~"pickleball"]${box}->.pb;
(
nwr(around.pb:150)["name"]["leisure"~"^(park|sports_centre|recreation_ground|sports_hall|fitness_centre|playground|common)$"];
nwr(around.pb:150)["name"]["club"];
nwr(around.pb:150)["name"]["amenity"~"^(school|college|university|community_centre)$"];
nwr(around.pb:150)["name"]["landuse"="recreation_ground"];
);out center tags qt;`,
  towns: `[out:json][timeout:900][maxsize:1073741824];
node["place"~"^(city|town|suburb)$"]["name"]${box};
out tags qt;`,
}

let lastAsk = 0
const ask = async (name) => {
  fs.mkdirSync(CACHE, { recursive: true })
  const file = path.join(CACHE, `${REGION}-${name}.json`)
  if (!REFRESH && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"))
  for (let attempt = 0; attempt < 5; attempt++) {
    const wait = 30_000 - (Date.now() - lastAsk)
    if (lastAsk && wait > 0) await sleep(wait)
    lastAsk = Date.now()
    const t0 = Date.now()
    console.log(`asking Overpass: ${name} (${REGION})...`)
    const res = await fetch(ENDPOINT, { method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" }, body: "data=" + encodeURIComponent(QUERIES[name]) })
    if (res.status === 429 || res.status === 504) {
      console.log(`  HTTP ${res.status}: waiting 120 s`)
      await sleep(120_000)
      continue
    }
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`)
    const text = await res.text()
    const data = JSON.parse(text)
    if (data.remark && /runtime error|timed out|out of memory/i.test(data.remark)) throw new Error(`${name}: ${data.remark}`)
    fs.writeFileSync(file, text)
    console.log(`  ${data.elements.length} elements, ${(text.length / 1e6).toFixed(1)} MB in ${((Date.now() - t0) / 1000).toFixed(0)} s`)
    return data
  }
  throw new Error(`${name}: gave up`)
}

const features = await ask("features")
const placesRaw = await ask("places")
const townsRaw = await ask("towns")

// places for names
const kindOfPlace = (t) => (t.amenity && /school|college|university/.test(t.amenity) ? "school" : t.leisure === "sports_centre" || t.leisure === "sports_hall" || t.leisure === "fitness_centre" ? "sports" : t.club ? "club" : "park")
const places = placesRaw.elements
  .map((e) => {
    const ll = e.center ? [e.center.lat, e.center.lon] : e.lat !== undefined ? [e.lat, e.lon] : null
    return ll && e.tags?.name ? { name: e.tags.name, lat: ll[0], lon: ll[1], kind: kindOfPlace(e.tags) } : null
  })
  .filter(Boolean)
// a grid so each venue only looks at places near it
const PCELL = 0.01
const pgrid = new Map()
for (const p of places) {
  const k = `${Math.floor(p.lat / PCELL)},${Math.floor(p.lon / PCELL)}`
  if (!pgrid.has(k)) pgrid.set(k, [])
  pgrid.get(k).push(p)
}
const placesNear = (lat, lon) => {
  const i = Math.floor(lat / PCELL)
  const j = Math.floor(lon / PCELL)
  const out = []
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) out.push(...(pgrid.get(`${i + a},${j + b}`) || []))
  return out
}
const towns = townsRaw.elements.map((e) => ({ name: e.tags.name, lat: e.lat, lon: e.lon, pop: parseInt(String(e.tags.population || "").replace(/\D/g, ""), 10) || (e.tags.place === "city" ? 100000 : e.tags.place === "town" ? 10000 : 3000) }))
const townOf = F.townIndex(towns)

// cluster and describe
const clusters = F.clusterFeatures(features.elements)
const shards = new Map()
const townCount = new Map()
const named = []
let courtTotal = 0
const seen = new Set()
for (const c of clusters) {
  let id = F.venueId(c)
  if (seen.has(id)) id += "b"
  seen.add(id)
  const { courts, onTennis } = F.countCourts(c)
  const flags = F.flagsOf(c)
  const town = townOf(c.lat, c.lon)
  const name = F.nameVenue(c, placesNear(c.lat, c.lon))
  const row = F.makeRow({ id, lat: c.lat, lon: c.lon, r: c.r, courts, onTennis, flags, name, town: town?.name })
  const gh = F.geohash(c.lat, c.lon, 2)
  if (!shards.has(gh)) shards.set(gh, [])
  const rows = shards.get(gh)
  rows.push(row)
  courtTotal += courts + onTennis * 2
  if (town) {
    const k = `${town.name}|${F.geohash(town.lat, town.lon, 2)}`
    const cur = townCount.get(k) || { name: town.name, lat: town.lat, lon: town.lon, gh: F.geohash(town.lat, town.lon, 2), n: 0, shards: new Set() }
    cur.n++
    cur.shards.add(gh)
    townCount.set(k, cur)
  }
}
// sort each shard (biggest venues first: they come up first when nothing else ranks them)
for (const [gh, rows] of shards) rows.sort((a, b) => b[4] + b[5] * 2 - (a[4] + a[5] * 2))
for (const [gh, rows] of shards) rows.forEach((row, i) => row[7] && named.push([row[7], gh, i]))

fs.mkdirSync(OUT, { recursive: true })
for (const f of fs.readdirSync(OUT)) if (/^[0-9a-z]{2}\.json$/.test(f)) fs.rmSync(path.join(OUT, f))
let bytes = 0
for (const [gh, rows] of shards) {
  const text = JSON.stringify({ v: 1, rows })
  bytes += text.length
  fs.writeFileSync(path.join(OUT, `${gh}.json`), text)
}
const r4 = (v) => Math.round(v * 1e4) / 1e4
// towns: the town's own shard is where it is; a town on a shard edge points at its venues' main shard
const townRows = [...townCount.values()].map((t) => [t.name, t.shards.has(t.gh) ? t.gh : [...t.shards][0], r4(t.lat), r4(t.lon), t.n]).sort((a, b) => b[4] - a[4])
const search = { v: 1, towns: townRows, named }
const searchText = JSON.stringify(search)
fs.writeFileSync(path.join(OUT, "search.json"), searchText)
const meta = { v: 1, built: new Date().toISOString().slice(0, 10), region: REGION, venues: clusters.length, courts: courtTotal, shards: shards.size, osm_base: features.osm3s?.timestamp_osm_base || null, attribution: F.ATTRIBUTION, license: "ODbL 1.0 (https://opendatacommons.org/licenses/odbl/1-0/)" }
fs.writeFileSync(path.join(OUT, "meta.json"), JSON.stringify(meta, null, 1))
fs.writeFileSync(path.join(OUT, "LICENSE.txt"), "Pickleball 98 Venue Finder index.\nData © OpenStreetMap contributors (https://www.openstreetmap.org/copyright).\nThis index is a derivative database of OpenStreetMap and is made available under the Open Database License 1.0 (https://opendatacommons.org/licenses/odbl/1-0/).\nBuilt by tools/venues/world/build-index.mjs.\n")
console.log(`${features.elements.length} features -> ${clusters.length} venues (${courtTotal} courts) in ${shards.size} shards, ${(bytes / 1024).toFixed(0)} KB; search.json ${(searchText.length / 1024).toFixed(0)} KB (${townRows.length} towns, ${named.length} named)`)
