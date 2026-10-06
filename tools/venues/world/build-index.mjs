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
// --partial: no asking at all; build the index from every tile already in --cache (any region,
// any tile size). Resumable: a normal run skips tiles it has cached, so it fills in what's missing.
const PARTIAL = process.argv.includes("--partial")
const REGION = arg("--region", "world")
// the main Overpass address, then its sister servers (same operator) when one answers 429/504
const ENDPOINTS = process.env.OVERPASS_URL ? [process.env.OVERPASS_URL] : ["https://overpass-api.de/api/interpreter", "https://z.overpass-api.de/api/interpreter", "https://lz4.overpass-api.de/api/interpreter"]
let ep = 0
const UA = "98ish-venue-index/1.0 (Pickleball 98 Venue Finder; https://98ish.vercel.app)"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// the world in tiles (20 x 30 degrees), asked one at a time: the public Overpass instance
// turns one worldwide query down (HTTP 504), small boxes go through. --region narrows it.
const REGIONS = { world: [-60, -180, 80, 180], us: [24, -125, 50, -65], ca: [32, -125, 43, -114] }
// (the US: the lower 48 in tiles, plus Hawaii and southern Alaska as one box each)
const EXTRA = { us: [[18, -161, 23, -154], [55, -155, 65, -140]] }
const [la0, lo0, la1, lo1] = REGIONS[REGION] || REGIONS.world
const tiles = []
// (--tile N: N-degree tiles; 5 goes through a busy server, bigger boxes get 504s)
const TILE = Number(arg("--tile", 5))
for (let la = la0; la < la1; la += TILE) for (let lo = lo0; lo < lo1; lo += TILE) tiles.push([la, lo, Math.min(la + TILE, la1), Math.min(lo + TILE, lo1)])
tiles.push(...(EXTRA[REGION] || []))
const bboxOf = (t) => `(${t.join(",")})`

const QUERIES = {
  features: (b) => `[out:json][timeout:90];(
nwr["sport"~"pickleball"]${b};
nwr["leisure"~"^(pitch|court)$"]["pickleball"="yes"]${b};
);out center tags qt;`,
  places: (b) => `[out:json][timeout:90];
nwr["sport"~"pickleball"]${b}->.pb;
(
nwr(around.pb:150)["name"]["leisure"~"^(park|sports_centre|recreation_ground|sports_hall|fitness_centre|playground|common)$"];
nwr(around.pb:150)["name"]["club"];
nwr(around.pb:150)["name"]["amenity"~"^(school|college|university|community_centre)$"];
nwr(around.pb:150)["name"]["landuse"="recreation_ground"];
);out center tags qt;`,
  towns: (b) => `[out:json][timeout:90];
node["place"~"^(city|town|suburb)$"]["name"]${b};
out tags qt;`,
}

let lastAsk = 0
const GAP = Number(process.env.OVERPASS_GAP_MS) || 5_000
const failed = []
const ask = async (name, tile, tries = 4) => {
  fs.mkdirSync(CACHE, { recursive: true })
  const file = path.join(CACHE, `${name}-${tile.join("_")}.json`)
  if (!REFRESH && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"))
  for (let attempt = 0; attempt < tries; attempt++) {
    const wait = GAP - (Date.now() - lastAsk)
    if (lastAsk && wait > 0) await sleep(wait)
    lastAsk = Date.now()
    const t0 = Date.now()
    let res
    try {
      res = await fetch(ENDPOINTS[ep % ENDPOINTS.length], { method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" }, body: "data=" + encodeURIComponent(QUERIES[name](bboxOf(tile))) })
    } catch (error) {
      console.log(`  ${name} ${tile}: ${error.message}; waiting 60 s`)
      await sleep(60_000)
      continue
    }
    if (res.status === 429 || res.status === 504 || res.status === 502) {
      ep++
      console.log(`  ${name} ${tile}: HTTP ${res.status}, waiting 20 s (next: ${ENDPOINTS[ep % ENDPOINTS.length]})`)
      await sleep(20_000)
      continue
    }
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`)
    const text = await res.text()
    const data = JSON.parse(text)
    if (data.remark && /runtime error|timed out|out of memory/i.test(data.remark)) {
      console.log(`  ${name} ${tile}: ${data.remark.slice(0, 120)}; waiting 60 s`)
      await sleep(60_000)
      continue
    }
    fs.writeFileSync(file, text)
    if (data.elements.length) console.log(`  ${name} ${tile}: ${data.elements.length} elements, ${(text.length / 1e6).toFixed(1)} MB in ${((Date.now() - t0) / 1000).toFixed(0)} s`)
    return data
  }
  return null
}
// a tile the server turns down splits into four (to 2.5 degrees), and those are asked instead
const askTile = async (name, tile) => {
  const small = tile[2] - tile[0] <= 0.7
  const d = await ask(name, tile, small ? 4 : 2)
  if (d) return d
  if (small) {
    failed.push(`${name} ${tile}`)
    return { elements: [] }
  }
  const [a, b, c, e] = tile
  const ml = (a + c) / 2
  const mo = (b + e) / 2
  console.log(`  ${name} ${tile}: splitting`)
  const out = { elements: [], osm3s: null }
  for (const t of [[a, b, ml, mo], [a, mo, ml, e], [ml, b, c, mo], [ml, mo, c, e]]) {
    const q = await askTile(name, t)
    out.elements.push(...q.elements)
    out.osm3s ??= q.osm3s
  }
  return out
}
const askAll = async (name, only = null) => {
  const out = { elements: [], osm3s: null }
  for (const t of tiles) {
    if (only && !only.has(t.join(","))) continue
    const d = await askTile(name, t)
    out.elements.push(...d.elements)
    out.osm3s ??= d.osm3s
  }
  return out
}

// every cached answer of one kind, whatever region or tile size asked it
const cachedAll = (name) => {
  const out = { elements: [], osm3s: null }
  if (!fs.existsSync(CACHE)) return out
  for (const f of fs.readdirSync(CACHE)) {
    if (!f.startsWith(`${name}-`)) continue
    const d = JSON.parse(fs.readFileSync(path.join(CACHE, f), "utf8"))
    out.elements.push(...d.elements)
    out.osm3s ??= d.osm3s
  }
  return out
}
const coveredTiles = PARTIAL && fs.existsSync(CACHE) ? fs.readdirSync(CACHE).filter((f) => f.startsWith("features-")).map((f) => f.slice(9, -5).split("_").map(Number)) : null
const features = PARTIAL ? cachedAll("features") : await askAll("features")
// (names and towns only where there are courts)
const withCourts = new Set(tiles.filter((t) => features.elements.some((e) => { const ll = e.center || e; return ll.lat >= t[0] && ll.lat < t[2] && ll.lon >= t[1] && ll.lon < t[3] })).map((t) => t.join(",")))
console.log(`${features.elements.length} features in ${withCourts.size} of ${tiles.length} tiles`)
const placesRaw = PARTIAL ? cachedAll("places") : await askAll("places", withCourts)
const townsRaw = PARTIAL ? cachedAll("towns") : await askAll("towns", withCourts)
// (a feature on a tile edge can come back from both tiles)
const dedupe = (list) => {
  const seen = new Set()
  return list.filter((e) => {
    const k = `${e.type}${e.id}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}
features.elements = dedupe(features.elements)
placesRaw.elements = dedupe(placesRaw.elements)
townsRaw.elements = dedupe(townsRaw.elements)

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

// (a run that lost too many tiles keeps the index it had rather than shipping holes)
if (!PARTIAL && failed.length > Math.max(2, tiles.length * 0.03)) {
  console.error(`${failed.length} tiles failed (${failed.slice(0, 8).join("; ")}): the index is left as it was. Run again later.`)
  process.exit(2)
}
if (failed.length) console.warn(`missing tiles: ${failed.join("; ")}`)
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
const meta = { v: 1, partial: PARTIAL || undefined, covered: coveredTiles || undefined, failedTiles: failed, built: new Date().toISOString().slice(0, 10), region: REGION, venues: clusters.length, courts: courtTotal, shards: shards.size, osm_base: features.osm3s?.timestamp_osm_base || null, attribution: F.ATTRIBUTION, license: "ODbL 1.0 (https://opendatacommons.org/licenses/odbl/1-0/)" }
fs.writeFileSync(path.join(OUT, "meta.json"), JSON.stringify(meta, null, 1))
fs.writeFileSync(path.join(OUT, "LICENSE.txt"), "Pickleball 98 Venue Finder index.\nData © OpenStreetMap contributors (https://www.openstreetmap.org/copyright).\nThis index is a derivative database of OpenStreetMap and is made available under the Open Database License 1.0 (https://opendatacommons.org/licenses/odbl/1-0/).\nBuilt by tools/venues/world/build-index.mjs.\n")
console.log(`${features.elements.length} features -> ${clusters.length} venues (${courtTotal} courts) in ${shards.size} shards, ${(bytes / 1024).toFixed(0)} KB; search.json ${(searchText.length / 1024).toFixed(0)} KB (${townRows.length} towns, ${named.length} named)`)
