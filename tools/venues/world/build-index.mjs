// Builds Venue Finder's index: every pickleball venue in OpenStreetMap, worldwide, as small
// static shards the phone searches offline (client/public/venues/idx/). Pure logic lives in
// client/.../pickleball/park/live/finder.js (shared with the app, the server and the tests) and
// tools/venues/world/tiles.mjs (which boxes are asked, resume/coverage).
// Data © OpenStreetMap contributors, ODbL 1.0: the index is a derivative database under the
// same licence (client/public/venues/idx/LICENSE.txt says so).
//
//   node tools/venues/world/build-index.mjs [--cache DIR] [--region world|us-west,us-east,canada,
//        europe,oceania,rest,us,uk,spain,australia,california] [--names] [--zips Gaz_zcta_national.txt]
//        [--fetch-only] [--partial] [--deadline MINUTES] [--refresh] [--force]
//
// Resumable: every answer is cached in --cache, and a run only asks for what's missing, so a run
// that stops (deadline, Ctrl+C, a 6-hour CI limit) picks up where it left off.
//   --fetch-only   ask, don't write the index (one CI job per region; a final job merges)
//   --partial      don't ask at all: build from whatever the cache holds (any region)
//   --names        the names pass: for venues still unnamed, ask which named park/club/school
//                  they stand inside (OSM is_in, a few hundred venues per query, cached)
//   --deadline M   stop asking after M minutes (still builds from what landed; exit 0)
//   --force        write the index even when it's much smaller than the one it replaces
//
// Polite to Overpass (https://wiki.openstreetmap.org/wiki/Overpass_API): one request in flight,
// at least 10 s apart, identified (User-Agent), a busy instance (429/5xx/timeout) rests (1 min,
// doubling to 20) and the next public instance is asked; everything cached. Per tile:
//   1. "all":   every feature tagged pickleball (courts, tennis courts with lines, halls, clubs)
//               with centres, and named parks/sports centres/clubs/schools within 150 m
//   2. "towns": cities, towns, suburbs and villages (name, place, population as CSV) in the
//               1-degree cells that hold courts, padded 0.5 degrees (for "Pickleball courts,
//               <town>" and town search). (The old combined query asked for towns within 25 km
//               of every court, which ran out of memory on the server for most US tiles.)
// --zips: the US Census ZCTA Gazetteer (public domain) -> idx/zip/NN.json for ZIP code search.
// Monthly from GitHub Actions (.github/workflows/venue-index.yml: one job per region, the raw
// answers kept in the Actions cache, then a merge job) or by hand.

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { planTiles, quarters, isCovered, townBoxes, SMALL_LAT } from "./tiles.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, "../../..")
// (--out DIR: write the index somewhere else, e.g. to look at a build before it ships)
const OUT = process.argv.includes("--out") ? path.resolve(process.argv[process.argv.indexOf("--out") + 1]) : path.join(ROOT, "client/public/venues/idx")
const F = await import(pathToFileURL(path.join(ROOT, "client/src/components/applets/pickleball/park/live/finder.js")).href)

const arg = (k, d = null) => {
  const i = process.argv.indexOf(k)
  return i > 0 ? process.argv[i + 1] : d
}
const has = (k) => process.argv.includes(k)
const CACHE = arg("--cache", path.join(HERE, ".cache"))
const REFRESH = has("--refresh")
const PARTIAL = has("--partial")
const NAMES = has("--names")
const FETCH_ONLY = has("--fetch-only")
const FORCE = has("--force")
const REGION = arg("--region", "world")
const DEADLINE = arg("--deadline") ? Date.now() + Number(arg("--deadline")) * 60_000 : Infinity
const pastDeadline = () => Date.now() > DEADLINE
// Public Overpass instances, in the order tried. Each one's policy allows an app's occasional
// index build at one request at a time (https://wiki.openstreetmap.org/wiki/Overpass_API#Public_Overpass_API_instances).
const ENDPOINTS = process.env.OVERPASS_URL
  ? process.env.OVERPASS_URL.split(",")
  : ["https://overpass-api.de/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
const REST0 = 60_000
const rest = ENDPOINTS.map(() => ({ until: 0, ms: REST0 }))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pickEndpoint = async () => {
  for (;;) {
    const now = Date.now()
    const i = rest.findIndex((x) => x.until <= now)
    if (i >= 0) return i
    const soonest = Math.min(...rest.map((x) => x.until))
    if (soonest > DEADLINE) return -1
    console.log(`  every Overpass instance is resting; waiting ${Math.round((soonest - now) / 1000)} s`)
    await sleep(soonest - now + 1000)
  }
}
const tired = (i) => {
  rest[i].until = Date.now() + rest[i].ms
  rest[i].ms = Math.min(rest[i].ms * 2, 20 * 60_000)
}
const fine = (i) => (rest[i].ms = REST0)
const UA = "98ish-venue-index/1.1 (Pickleball 98 Venue Finder; https://98ish.vercel.app; github.com/brandontaylor156/98ish)"
const bboxOf = (t) => `(${t.join(",")})`
const NEAR = (set) => `(
nwr(around.${set}:150)["name"]["leisure"~"^(park|sports_centre|recreation_ground|sports_hall|fitness_centre|playground|common)$"];
nwr(around.${set}:150)["name"]["club"];
nwr(around.${set}:150)["name"]["amenity"~"^(school|college|university|community_centre)$"];
nwr(around.${set}:150)["name"]["landuse"="recreation_ground"];
)->.pl;`

// (small declared [timeout]/[maxsize]: a busy server admits a query by what it declares, so a
// modest ask gets in where a [timeout:180] one is turned away with "Dispatcher ... timeout";
// a box that really needs more answers "timed out"/"out of memory" and is split in four)
const QUERIES = {
  // the pickleball scan plus the named places round it, in one query
  all: (t) => `[out:json][timeout:100][maxsize:268435456];
(
nwr["sport"~"pickleball"]${bboxOf(t)};
nwr["leisure"~"^(pitch|court)$"]["pickleball"="yes"]${bboxOf(t)};
)->.pb;
.pb out center tags qt;
${NEAR("pb")}
(.pl; - .pb;)->.pl;
.pl out center tags qt;`,
  // (older caches held "features-" tiles; --names fills in their places)
  places: (t) => `[out:json][timeout:100][maxsize:268435456];
nwr["sport"~"pickleball"]${bboxOf(t)}->.pb;
${NEAR("pb")}
.pl out center tags qt;`,
  // towns as CSV (a city's name in 200 languages isn't needed): boxes = townBoxes(courts)
  towns: (boxes) => `[out:csv(::id,::lat,::lon,name,place,population;false;"\\t")][timeout:90][maxsize:67108864];
(
${boxes.map((b) => `node["place"~"^(city|town|suburb|village)$"]["name"]${bboxOf(b)};`).join("\n")}
);
out qt;
make end name="__end__";
out;`,
  // the names pass: for each point, a marker and the named areas it stands inside
  isin: (pts) => `[out:json][timeout:120][maxsize:134217728];
${pts
  .map(
    ([i, lat, lon]) => `make m i=${i};out;
is_in(${lat},${lon})->.a;
(area.a["leisure"~"^(park|sports_centre|recreation_ground|sports_hall|fitness_centre|playground|common|golf_course|beach_resort|resort)$"]["name"];area.a["amenity"~"^(school|college|university|community_centre)$"]["name"];area.a["club"]["name"];area.a["landuse"="recreation_ground"]["name"];);
out tags qt;`,
  )
  .join("\n")}`,
}
const csvTowns = (text) => {
  const elements = []
  for (const line of text.split(/\r?\n/)) {
    const [id, lat, lon, name, place, population] = line.split("\t")
    if (!id || !name || !Number.isFinite(Number(lat))) continue
    const tags = { name, place }
    if (population) tags.population = population
    elements.push({ type: "node", id: Number(id), lat: Number(lat), lon: Number(lon), tags })
  }
  return { elements }
}

let lastAsk = 0
let asked = 0
const GAP = Number(process.env.OVERPASS_GAP_MS) || 10_000
const failed = []
const DEFERRED = Symbol("deferred")
// ask once (with retries over the instances); returns the answer, null (too big: split it) or
// DEFERRED (the deadline passed). A busy instance (429, 5xx, "too busy") never counts as a try:
// the box isn't too big, the server is, so it waits its turn; only answers that look too big
// (no answer in 240 s, `tries` times) give up so the caller splits the box.
const ask = async (name, file, query, tries = 2) => {
  fs.mkdirSync(CACHE, { recursive: true })
  if (!REFRESH && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"))
  for (let slow = 0, busy = 0; slow < tries; ) {
    if (pastDeadline()) return DEFERRED
    // (busy a dozen times in a row, over the instances: maybe it's the box after all)
    if (busy++ >= 12) return null
    const wait = GAP - (Date.now() - lastAsk)
    if (lastAsk && wait > 0) await sleep(wait)
    const ep = await pickEndpoint()
    if (ep < 0) return DEFERRED
    lastAsk = Date.now()
    asked++
    const host = new URL(ENDPOINTS[ep]).host
    const t0 = Date.now()
    const label = `${name} ${path.basename(file, ".json").replace(/^[a-z]+-/, "")}`
    let res
    let text
    try {
      res = await fetch(ENDPOINTS[ep], { method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" }, body: "data=" + encodeURIComponent(query), signal: AbortSignal.timeout(240_000) })
      text = await res.text()
    } catch (error) {
      tired(ep)
      lastAsk = Date.now()
      if (error.name === "TimeoutError") slow++
      console.log(`  ${label} @${host}: ${error.name === "TimeoutError" ? "no answer in 240 s" : error.message}; resting it`)
      continue
    }
    lastAsk = Date.now()
    const remark = /runtime error[^<\n]*/i.exec(text)?.[0] || ""
    if (res.status === 429 || res.status >= 500) {
      // (a box too big for the server comes back as a 504 with "timed out"/"out of memory" too)
      if (/timed out|out of memory/i.test(remark) && !/Dispatcher/i.test(remark)) {
        console.log(`  ${label} @${host}: ${remark.slice(0, 110)}`)
        return null
      }
      tired(ep)
      console.log(`  ${label} @${host}: HTTP ${res.status}${remark ? ` (${remark.slice(0, 80)})` : ""}; resting it`)
      continue
    }
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status} @${host}`)
    let data
    if (name === "towns") {
      // (CSV has no room for an error: an answer counts only with its closing "__end__" row)
      if (remark || /<html|<\?xml/i.test(text.slice(0, 200)) || !text.includes("__end__")) {
        // (cut off at its 90 s: too many towns in one ask, so the caller halves it)
        if (Date.now() - t0 > 85_000 && !/Dispatcher/i.test(remark)) {
          console.log(`  ${label} @${host}: cut off after ${((Date.now() - t0) / 1000).toFixed(0)} s`)
          return null
        }
        tired(ep)
        console.log(`  ${label} @${host}: ${remark.slice(0, 110) || "not CSV"}; resting it`)
        continue
      }
      data = csvTowns(text)
    } else {
      try {
        data = JSON.parse(text)
      } catch {
        tired(ep)
        console.log(`  ${label} @${host}: not JSON; resting it`)
        continue
      }
      if (data.remark && /runtime error|timed out|out of memory|too busy/i.test(data.remark)) {
        console.log(`  ${label} @${host}: ${data.remark.slice(0, 120)}`)
        // (a box too big for the server: give up on it, so the caller splits it)
        if (/timed out|out of memory/i.test(data.remark) && !/Dispatcher/i.test(data.remark)) return null
        tired(ep)
        continue
      }
    }
    fine(ep)
    const out = JSON.stringify(data)
    fs.writeFileSync(file, out)
    console.log(`  ${label} @${host}: ${data.elements.length} elements, ${(out.length / 1e6).toFixed(1)} MB in ${((Date.now() - t0) / 1000).toFixed(0)} s`)
    return data
  }
  return null
}
const cacheFile = (name, tile) => path.join(CACHE, `${name}-${tile.join("_")}.json`)
const cached = (name, tile) => fs.existsSync(cacheFile(name, tile))
// a tile the server turns down splits into four (to 1.25 degrees), and those are asked instead.
// Returns the features asked (for the towns), or DEFERRED.
const askTile = async (tile) => {
  // (a tile answered through its quarters on an earlier run isn't asked whole again)
  if (!cached("all", tile) && tile[2] - tile[0] > SMALL_LAT && quarters(tile).some((q) => isCovered(q, (t) => cached("all", t)))) return askQuarters(tile)
  const small = tile[2] - tile[0] <= SMALL_LAT
  const d = await ask("all", cacheFile("all", tile), QUERIES.all(tile), small ? 3 : 1)
  if (d === DEFERRED) return DEFERRED
  if (d) return d.elements
  if (small) {
    failed.push(`${tile}`)
    return []
  }
  console.log(`  all ${tile}: splitting`)
  return askQuarters(tile)
}
const askQuarters = async (tile) => {
  const out = []
  for (const q of quarters(tile)) {
    const els = await askTile(q)
    if (els === DEFERRED) return DEFERRED
    out.push(...els)
  }
  return out
}
// the towns for a tile's courts (one CSV query; none when the tile has no courts)
// (a busy area's towns that don't fit one ask are asked in halves: towns-<tile>_a, _ab, ...)
const askTowns = async (tile, elements, part = "") => {
  const pts = (part ? elements : elements.filter((e) => F.indexKind(e) === "features").map((e) => (e.center ? [e.center.lat, e.center.lon] : [e.lat, e.lon]))).filter(([a]) => Number.isFinite(a))
  if (!pts.length) return
  const name = tile.join("_") + (part ? `_${part}` : "")
  const file = path.join(CACHE, `towns-${name}.json`)
  // (asked in halves on an earlier run: the halves carry on, the whole isn't asked again)
  const child = (k) => path.join(CACHE, `towns-${tile.join("_")}_${part}${k}.json`)
  const begunInHalves = !REFRESH && !fs.existsSync(file) && fs.readdirSync(CACHE).some((f) => f.startsWith(path.basename(child("a"), ".json")))
  if (!begunInHalves) {
    const d = fs.existsSync(file) && !REFRESH ? true : await ask("towns", file, QUERIES.towns(townBoxes(pts)), 1)
    if (d !== null) return d
    if (townBoxes(pts).length < 2 || part.length >= 4) {
      failed.push(`towns ${name}`)
      return d
    }
  }
  // halves by longitude
  pts.sort((x, y) => x[1] - y[1])
  const mid = Math.ceil(pts.length / 2)
  for (const [k, half] of [["a", pts.slice(0, mid)], ["b", pts.slice(mid)]]) if ((await askTowns(tile, half, part + k)) === DEFERRED) return DEFERRED
  return true
}

const plan = planTiles(REGION)
let deferred = 0
if (!PARTIAL) {
  console.log(`${plan.length} tiles planned (${REGION}); ${plan.filter((t) => isCovered(t, (x) => cached("all", x))).length} already cached`)
  for (const t of plan) {
    const els = await askTile(t)
    if (els === DEFERRED) {
      deferred++
      continue
    }
    if ((await askTowns(t, els)) === DEFERRED) deferred++
  }
  if (deferred) console.log(`deadline: ${deferred} tiles left for the next run (the cache keeps what landed)`)
  console.log(`${asked} Overpass requests this run`)
}
if (FETCH_ONLY && !NAMES) process.exit(0)

// ---------- build from the whole cache ----------
// every cached answer of one kind, whatever region or tile size asked it: the combined "all-"
// answers (split by their tags), "towns-" and the older one-kind files ("features-", "places-")
const readCache = () => (fs.existsSync(CACHE) ? fs.readdirSync(CACHE).filter((f) => /^(all|features|places|towns)-.*\.json$/.test(f)) : [])
const cachedAll = () => {
  const out = { features: [], places: [], towns: [], osm3s: null }
  for (const f of readCache()) {
    const d = JSON.parse(fs.readFileSync(path.join(CACHE, f), "utf8"))
    const kind = f.slice(0, f.indexOf("-"))
    for (const e of d.elements) {
      const k = kind === "all" ? F.indexKind(e) : kind
      out[k]?.push(e)
    }
    if (kind === "all" || kind === "features") out.osm3s ??= d.osm3s
  }
  return out
}
const coveredTiles = readCache()
  .filter((f) => /^(all|features)-/.test(f))
  .map((f) => f.replace(/^[a-z]+-/, "").slice(0, -5).split("_").map(Number))
const coveredSet = new Set(coveredTiles.map((t) => t.join(",")))
const isDone = (t) => isCovered(t, (x) => coveredSet.has(x.join(",")))
// older caches: places for feature tiles that have courts
if (NAMES && !PARTIAL)
  for (const f of readCache().filter((f) => f.startsWith("features-"))) {
    const d = JSON.parse(fs.readFileSync(path.join(CACHE, f), "utf8"))
    if (!d.elements.length) continue
    const tile = f.slice(9, -5).split("_").map(Number)
    await ask("places", cacheFile("places", tile), QUERIES.places(tile), 4)
    await askTowns(tile, d.elements)
  }
const raw = cachedAll()
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
const featureEls = dedupe(raw.features)
const placeEls = dedupe(raw.places)
const townEls = dedupe(raw.towns)
console.log(`${featureEls.length} features, ${placeEls.length} places, ${townEls.length} towns from ${coveredTiles.length} cached tiles`)

// places for names
const kindOfPlace = (t) => (t.amenity && /school|college|university/.test(t.amenity) ? "school" : t.leisure === "sports_centre" || t.leisure === "sports_hall" || t.leisure === "fitness_centre" ? "sports" : t.club ? "club" : "park")
const places = placeEls
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
const towns = townEls.filter((e) => Number.isFinite(e.lat) && e.tags?.name).map((e) => ({ name: e.tags.name, lat: e.lat, lon: e.lon, pop: parseInt(String(e.tags.population || "").replace(/\D/g, ""), 10) || (e.tags.place === "city" ? 100000 : e.tags.place === "town" ? 10000 : e.tags.place === "village" ? 800 : 3000) }))
const townOf = F.townIndex(towns)

// cluster and name
const clusters = F.clusterFeatures(featureEls)
const ids = new Set()
for (const c of clusters) {
  let id = F.venueId(c)
  if (ids.has(id)) id += "b"
  ids.add(id)
  c.id = id
  c.name = F.nameVenue(c, placesNear(c.lat, c.lon))
}
const namedBefore = clusters.filter((c) => c.name).length

// the names pass: which named park/club/school an unnamed venue stands inside (is_in), cached
// per venue id in names.json ({ id: name | "" }) so a rerun only asks for new venues
const NAMES_FILE = path.join(CACHE, "names.json")
const enclosing = fs.existsSync(NAMES_FILE) ? JSON.parse(fs.readFileSync(NAMES_FILE, "utf8")) : {}
if (NAMES) {
  const todo = clusters.filter((c) => !c.name && !(c.id in enclosing))
  const BATCH = 250
  console.log(`names pass: ${clusters.length - namedBefore} unnamed venues, ${todo.length} not asked yet (${Math.ceil(todo.length / BATCH)} queries)`)
  for (let i = 0; i < todo.length && !pastDeadline(); i += BATCH) {
    const batch = todo.slice(i, i + BATCH)
    const pts = batch.map((c, k) => [k, Math.round(c.lat * 1e6) / 1e6, Math.round(c.lon * 1e6) / 1e6])
    const file = path.join(CACHE, `isin-${batch[0].id}-${batch.length}.json`)
    const d = await ask("isin", file, QUERIES.isin(pts), 4)
    if (!d || d === DEFERRED) {
      if (d === null) failed.push(`names ${batch[0].id}+${batch.length}`)
      continue
    }
    const split = F.splitIsIn(d.elements)
    batch.forEach((c, k) => (enclosing[c.id] = F.pickEnclosing(split.get(String(k)) || []) || ""))
    fs.writeFileSync(NAMES_FILE, JSON.stringify(enclosing))
    fs.rmSync(file, { force: true })
  }
}
for (const c of clusters) if (!c.name && enclosing[c.id]) c.name = F.nameVenue(c, [], enclosing[c.id])
if (FETCH_ONLY) process.exit(0)

const shards = new Map()
const townCount = new Map()
const named = []
let courtTotal = 0
let namedCount = 0
for (const c of clusters) {
  const { courts, onTennis } = F.countCourts(c)
  const flags = F.flagsOf(c)
  const town = townOf(c.lat, c.lon)
  const row = F.makeRow({ id: c.id, lat: c.lat, lon: c.lon, r: c.r, courts, onTennis, flags, name: c.name, town: town?.name })
  if (c.name) namedCount++
  const gh = F.geohash(c.lat, c.lon, 2)
  if (!shards.has(gh)) shards.set(gh, [])
  shards.get(gh).push(row)
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
for (const [, rows] of shards) rows.sort((a, b) => b[4] + b[5] * 2 - (a[4] + a[5] * 2))
for (const [gh, rows] of shards) rows.forEach((row, i) => row[7] && named.push([row[7], gh, i]))
console.log(`named: ${namedBefore} of ${clusters.length} before the names pass (${((100 * namedBefore) / Math.max(1, clusters.length)).toFixed(1)}%), ${namedCount} after (${((100 * namedCount) / Math.max(1, clusters.length)).toFixed(1)}%)`)

// what this build covers: the planned tiles (for --partial: the whole world plan) the cache answers
const fullPlan = planTiles("world")
const missing = fullPlan.filter((t) => !isDone(t))
const complete = !missing.length && !failed.length
// (a run that lost too many tiles keeps the index it had rather than shipping holes)
if (!PARTIAL && failed.length > Math.max(2, plan.length * 0.03)) {
  console.error(`${failed.length} tiles failed (${failed.slice(0, 8).join("; ")}): the index is left as it was. Run again later.`)
  process.exit(2)
}
let oldMeta = null
try {
  oldMeta = JSON.parse(fs.readFileSync(path.join(OUT, "meta.json"), "utf8"))
} catch {}
if (!FORCE && oldMeta?.venues && clusters.length < oldMeta.venues * 0.9) {
  console.error(`this build has ${clusters.length} venues, the shipped index ${oldMeta.venues}: left as it was (--force to write it anyway)`)
  process.exit(FETCH_ONLY ? 0 : 3)
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
// search: one file per first letter of a word (idx/search/<k>.json, finder.js searchKeysOf), so
// a search loads the names that can match it, not the whole world's
const buckets = new Map()
const into = (name, kind, row) => {
  for (const k of F.searchKeysOf(name)) {
    if (!buckets.has(k)) buckets.set(k, { v: 1, towns: [], named: [] })
    buckets.get(k)[kind].push(row)
  }
}
townRows.forEach((t) => into(t[0], "towns", t))
named.forEach((n) => into(n[0], "named", n))
const searchDir = path.join(OUT, "search")
fs.rmSync(searchDir, { recursive: true, force: true })
fs.rmSync(path.join(OUT, "search.json"), { force: true })
fs.mkdirSync(searchDir, { recursive: true })
let searchBytes = 0
let searchMax = 0
for (const [k, b] of buckets) {
  const text = JSON.stringify(b)
  searchBytes += text.length
  searchMax = Math.max(searchMax, text.length)
  fs.writeFileSync(path.join(searchDir, `${k}.json`), text)
}
const searchText = { length: searchBytes }
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
// covered: the tiles of the world plan this index answers (whole, or through their quarters)
const covered = fullPlan.filter(isDone)
const meta = {
  v: 1,
  zips: zipCount || oldMeta?.zips || undefined,
  partial: complete ? undefined : true,
  covered,
  missingTiles: missing.length ? missing : undefined,
  failedTiles: failed,
  built: new Date().toISOString().slice(0, 10),
  venues: clusters.length,
  courts: courtTotal,
  named: namedCount,
  towns: townRows.length,
  shards: shards.size,
  osm_base: raw.osm3s?.timestamp_osm_base || null,
  attribution: F.ATTRIBUTION,
  license: "ODbL 1.0 (https://opendatacommons.org/licenses/odbl/1-0/)",
}
fs.writeFileSync(path.join(OUT, "meta.json"), JSON.stringify(meta))
fs.writeFileSync(path.join(OUT, "LICENSE.txt"), "Pickleball 98 Venue Finder index.\nData © OpenStreetMap contributors (https://www.openstreetmap.org/copyright).\nThis index is a derivative database of OpenStreetMap and is made available under the Open Database License 1.0 (https://opendatacommons.org/licenses/odbl/1-0/).\nBuilt by tools/venues/world/build-index.mjs.\n")
console.log(`${featureEls.length} features -> ${clusters.length} venues (${courtTotal} courts) in ${shards.size} shards, ${(bytes / 1024).toFixed(0)} KB; search/ ${buckets.size} files, ${(searchText.length / 1024).toFixed(0)} KB, largest ${(searchMax / 1024).toFixed(0)} KB (${townRows.length} towns, ${named.length} named); ${covered.length}/${fullPlan.length} world tiles covered${complete ? "" : " (partial)"}`)
