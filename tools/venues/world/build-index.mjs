// Builds Venue Finder's index: every pickleball venue in OpenStreetMap, worldwide, as small
// static shards the phone searches offline (client/public/venues/idx/). Pure logic lives in
// client/.../pickleball/park/live/finder.js (shared with the app, the server and the tests).
// Data © OpenStreetMap contributors, ODbL 1.0: the index is a derivative database under the
// same licence (client/public/venues/idx/LICENSE.txt says so).
//
//   node tools/venues/world/build-index.mjs [--cache DIR] [--refresh] [--region us,canada,...|world]
//                                           [--tile 5x10] [--zips Gaz_zcta_national.txt] [--partial]
//
// One Overpass query per tile, one at a time, at least 10 s apart (polite: identify the app,
// one request in flight, back off and move to another public instance on 429/504/timeouts,
// cache every answer in --cache so a rebuild only asks for what's missing). Each answer holds:
//   1. every feature tagged pickleball (courts, tennis courts with lines, halls, clubs), centres
//   2. named parks, sports centres, clubs and schools within 150 m of those (for names)
//   3. cities, towns, suburbs and villages within 25 km of them (for "Pickleball courts, <town>"
//      and town search), with their coordinates
// --zips: the US Census ZCTA Gazetteer (public domain) -> idx/zip/NN.json for ZIP code search.
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
// --names: ask only for places and towns, on the cached feature tiles that have courts (then build)
const NAMES = process.argv.includes("--names")
const REGION = arg("--region", "world")
// Public Overpass instances, in the order tried. Each one's policy allows an app's occasional
// index build at one request at a time (https://wiki.openstreetmap.org/wiki/Overpass_API#Public_Overpass_API_instances):
// a busy one (429/5xx/timeout) rests a while (5 min, doubling to 40) and the next is asked.
const ENDPOINTS = process.env.OVERPASS_URL
  ? process.env.OVERPASS_URL.split(",")
  : ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"]
const rest = ENDPOINTS.map(() => ({ until: 0, ms: 5 * 60_000 }))
const pickEndpoint = async () => {
  for (;;) {
    const now = Date.now()
    const i = rest.findIndex((x) => x.until <= now)
    if (i >= 0) return i
    const soonest = Math.min(...rest.map((x) => x.until))
    console.log(`  every Overpass instance is resting; waiting ${Math.round((soonest - now) / 1000)} s`)
    await sleep(soonest - now + 1000)
  }
}
const tired = (i) => {
  rest[i].until = Date.now() + rest[i].ms
  rest[i].ms = Math.min(rest[i].ms * 2, 40 * 60_000)
}
const fine = (i) => (rest[i].ms = 5 * 60_000)
const UA = "98ish-venue-index/1.0 (Pickleball 98 Venue Finder; https://98ish.vercel.app)"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// The world in tiles asked one at a time (one worldwide query is turned down; 5 x 10 degree
// boxes go through even a busy server, and a box that's still too big splits in four).
// --region takes one or more of these, comma-separated ("world" is everything).
const REGIONS = {
  // the lower 48, Hawaii, southern Alaska
  us: [[24, -125, 50, -65], [18, -161, 23, -154], [55, -155, 65, -140]],
  canada: [[41, -141, 50, -52], [50, -141, 62, -52]],
  australia: [[-44, 112, -10, 154]],
  uk: [[49, -9, 61, 2]],
  spain: [[35, -10, 44, 5]],
  california: [[32, -125, 43, -114]],
  // everywhere else, in big tiles (mostly empty; a busy one splits itself in four)
  world: { boxes: [[-60, -180, 80, 180]], tile: [20, 30] },
}
const [TLA, TLO] = String(arg("--tile", "5x10")).split("x").map(Number)
const tiles = []
for (const name of REGION.split(",")) {
  const reg = REGIONS[name.trim()] || REGIONS.world
  const boxes = Array.isArray(reg) ? reg : reg.boxes
  const [TILE_LA, TILE_LO] = Array.isArray(reg) ? [TLA || 5, TLO || (TLA || 5) * 2] : reg.tile
  for (const [la0, lo0, la1, lo1] of boxes) {
    if (la1 - la0 <= TILE_LA && lo1 - lo0 <= TILE_LO) tiles.push([la0, lo0, la1, lo1])
    else for (let la = la0; la < la1; la += TILE_LA) for (let lo = lo0; lo < lo1; lo += TILE_LO) tiles.push([la, lo, Math.min(la + TILE_LA, la1), Math.min(lo + TILE_LO, lo1)])
  }
}
const bboxOf = (t) => `(${t.join(",")})`

const QUERIES = {
  // everything a tile needs in one query (the pickleball scan, the slow part, runs once)
  all: (b) => `[out:json][timeout:180];
(
nwr["sport"~"pickleball"]${b};
nwr["leisure"~"^(pitch|court)$"]["pickleball"="yes"]${b};
)->.pb;
.pb out center tags qt;
(
nwr(around.pb:150)["name"]["leisure"~"^(park|sports_centre|recreation_ground|sports_hall|fitness_centre|playground|common)$"];
nwr(around.pb:150)["name"]["club"];
nwr(around.pb:150)["name"]["amenity"~"^(school|college|university|community_centre)$"];
nwr(around.pb:150)["name"]["landuse"="recreation_ground"];
)->.pl;
(.pl; - .pb;)->.pl;
.pl out center tags qt;
node(around.pb:25000)["place"~"^(city|town|suburb|village)$"]["name"];
out qt;`,
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
node["place"~"^(city|town|suburb|village)$"]["name"]${b};
out qt;`,
}

let lastAsk = 0
const GAP = Number(process.env.OVERPASS_GAP_MS) || 10_000
const failed = []
const ask = async (name, tile, tries = 4) => {
  fs.mkdirSync(CACHE, { recursive: true })
  const file = path.join(CACHE, `${name}-${tile.join("_")}.json`)
  if (!REFRESH && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"))
  for (let attempt = 0; attempt < tries; attempt++) {
    const wait = GAP - (Date.now() - lastAsk)
    if (lastAsk && wait > 0) await sleep(wait)
    lastAsk = Date.now()
    const ep = await pickEndpoint()
    const host = new URL(ENDPOINTS[ep]).host
    const t0 = Date.now()
    let res
    let text
    try {
      res = await fetch(ENDPOINTS[ep], { method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" }, body: "data=" + encodeURIComponent(QUERIES[name](bboxOf(tile))), signal: AbortSignal.timeout(240_000) })
      text = res.ok ? await res.text() : ""
    } catch (error) {
      tired(ep)
      console.log(`  ${name} ${tile} @${host}: ${error.name === "TimeoutError" ? "no answer in 240 s" : error.message}; resting it`)
      continue
    }
    if (res.status === 429 || res.status >= 500) {
      tired(ep)
      console.log(`  ${name} ${tile} @${host}: HTTP ${res.status}; resting it`)
      continue
    }
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status} @${host}`)
    let data
    try {
      data = JSON.parse(text)
    } catch {
      tired(ep)
      console.log(`  ${name} ${tile} @${host}: not JSON; resting it`)
      continue
    }
    if (data.remark && /runtime error|timed out|out of memory|too busy/i.test(data.remark)) {
      console.log(`  ${name} ${tile} @${host}: ${data.remark.slice(0, 120)}`)
      // (a box too big for the server: give up on it, so the caller splits it)
      if (/timed out|out of memory/i.test(data.remark)) return null
      tired(ep)
      continue
    }
    fine(ep)
    fs.writeFileSync(file, text)
    console.log(`  ${name} ${tile} @${host}: ${data.elements.length} elements, ${(text.length / 1e6).toFixed(1)} MB in ${((Date.now() - t0) / 1000).toFixed(0)} s`)
    return data
  }
  return null
}
// a tile the server turns down splits into four (to 2.5 degrees), and those are asked instead
const askTile = async (name, tile) => {
  const small = tile[2] - tile[0] <= 1.25
  const d = await ask(name, tile, small ? 6 : 3)
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

// every cached answer of one kind, whatever region or tile size asked it: the combined
// "all-" answers (split by their tags) and the older one-kind files ("features-", ...)
const kindOf = F.indexKind
let cacheFiles = null
const cachedAll = (name) => {
  const out = { elements: [], osm3s: null }
  if (!fs.existsSync(CACHE)) return out
  cacheFiles ??= fs.readdirSync(CACHE).map((f) => ({ f, d: JSON.parse(fs.readFileSync(path.join(CACHE, f), "utf8")) }))
  for (const { f, d } of cacheFiles) {
    if (f.startsWith(`${name}-`)) out.elements.push(...d.elements)
    else if (f.startsWith("all-")) out.elements.push(...d.elements.filter((e) => kindOf(e) === name))
    else continue
    out.osm3s ??= d.osm3s
  }
  return out
}
const cachedTiles = () => (fs.existsSync(CACHE) ? fs.readdirSync(CACHE).filter((f) => /^(all|features)-/.test(f)).map((f) => f.replace(/^[a-z]+-/, "").slice(0, -5).split("_").map(Number)) : [])
// ask for every tile not cached yet (one combined query each), then build from the whole cache
if (!PARTIAL && !NAMES) await askAll("all")
if (NAMES) {
  // older caches: places and towns for the feature tiles that have courts
  for (const f of fs.readdirSync(CACHE).filter((f) => f.startsWith("features-"))) {
    const d = JSON.parse(fs.readFileSync(path.join(CACHE, f), "utf8"))
    if (!d.elements.length) continue
    const tile = f.slice(9, -5).split("_").map(Number)
    await askTile("places", tile)
    await askTile("towns", tile)
  }
}
const coveredTiles = cachedTiles()
const features = cachedAll("features")
const placesRaw = cachedAll("places")
const townsRaw = cachedAll("towns")
console.log(`${features.elements.length} features from ${coveredTiles.length} cached tiles`)
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
const towns = townsRaw.elements.filter((e) => Number.isFinite(e.lat) && e.tags?.name).map((e) => ({ name: e.tags.name, lat: e.lat, lon: e.lon, pop: parseInt(String(e.tags.population || "").replace(/\D/g, ""), 10) || (e.tags.place === "city" ? 100000 : e.tags.place === "town" ? 10000 : e.tags.place === "village" ? 800 : 3000) }))
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
if (!PARTIAL && !NAMES && failed.length > Math.max(2, tiles.length * 0.03)) {
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
// ZIP codes (US Census ZCTA Gazetteer, public domain): idx/zip/NN.json { v, z: { "92708": [lat, lon] } }
// by the first two digits, so a ZIP search loads one ~7 KB file. Without --zips the old ones stay.
const ZIPS = arg("--zips")
let zipCount = 0
if (ZIPS) {
  const byPrefix = new Map()
  for (const line of fs.readFileSync(ZIPS, "utf8").split(/\r?\n/).slice(1)) {
    const c = line.split("\t").map((x) => x.trim())
    if (!/^\d{5}$/.test(c[0])) continue
    const lat = Number(c[5])
    const lon = Number(c[6])
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
    const k = c[0].slice(0, 2)
    if (!byPrefix.has(k)) byPrefix.set(k, {})
    byPrefix.get(k)[c[0]] = [Math.round(lat * 1e3) / 1e3, Math.round(lon * 1e3) / 1e3]
    zipCount++
  }
  const dir = path.join(OUT, "zip")
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  for (const [k, z] of byPrefix) fs.writeFileSync(path.join(dir, `${k}.json`), JSON.stringify({ v: 1, z }))
  console.log(`${zipCount} ZIP codes in ${byPrefix.size} files`)
}
const meta = { v: 1, zips: zipCount || (fs.existsSync(path.join(OUT, "zip")) ? undefined : 0), partial: PARTIAL || NAMES || undefined, covered: coveredTiles, failedTiles: failed, built: new Date().toISOString().slice(0, 10), region: REGION, venues: clusters.length, courts: courtTotal, shards: shards.size, osm_base: features.osm3s?.timestamp_osm_base || null, attribution: F.ATTRIBUTION, license: "ODbL 1.0 (https://opendatacommons.org/licenses/odbl/1-0/)" }
fs.writeFileSync(path.join(OUT, "meta.json"), JSON.stringify(meta, null, 1))
fs.writeFileSync(path.join(OUT, "LICENSE.txt"), "Pickleball 98 Venue Finder index.\nData © OpenStreetMap contributors (https://www.openstreetmap.org/copyright).\nThis index is a derivative database of OpenStreetMap and is made available under the Open Database License 1.0 (https://opendatacommons.org/licenses/odbl/1-0/).\nBuilt by tools/venues/world/build-index.mjs.\n")
console.log(`${features.elements.length} features -> ${clusters.length} venues (${courtTotal} courts) in ${shards.size} shards, ${(bytes / 1024).toFixed(0)} KB; search.json ${(searchText.length / 1024).toFixed(0)} KB (${townRows.length} towns, ${named.length} named)`)
