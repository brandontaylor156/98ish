// Builds a Roam town's map tiles ahead of time (docs/open-world.md "Data pipeline"):
// OpenStreetMap from the public Overpass API (a few big boxes, one at a time, 20 s apart,
// our own User-Agent, backing off on 429/504) and the ground from the AWS Terrain Tiles,
// cut into z16 tiles by the same code as the live tile function (client/api/town.js) and
// written to client/public/roam/<town>/16/<x>/<y>.json plus an index.json.
// Data © OpenStreetMap contributors, ODbL 1.0; terrain: AWS Open Data Terrain Tiles (USGS 3DEP).
//
//   node tools/roam/build-town.mjs valencia [--refetch]
//
// Raw answers are cached in tools/roam/cache/ (not committed): rebuilding is offline.

import fs from "node:fs"
import path from "node:path"
import zlib from "node:zlib"
import { fileURLToPath } from "node:url"
import { townById } from "../../client/src/roam/towns/index.js"
import { townQuery, compactElement } from "../../client/src/roam/data/osm.js"
import { buildTile } from "../../client/src/roam/data/tile.js"
import { TERRAIN_URL, decodePng, terrainSampler, terrainTilesFor } from "../../client/src/roam/data/terrain.js"
import { TILE_ZOOM, lat2y, lon2x, tileBounds, tilesInBox } from "../../client/src/roam/geo.js"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, "..", "..")
const UA = "98ish-roam-build/1.0 (98ish open world; https://98ish.vercel.app)"
const ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://z.overpass-api.de/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const id = process.argv[2] || "valencia"
const refetch = process.argv.includes("--refetch")
const town = townById(id)
if (!town) throw new Error(`no town ${id}`)
const CACHE = path.join(HERE, "cache", id)
const TCACHE = path.join(HERE, "cache", "terrain")
fs.mkdirSync(CACHE, { recursive: true })
fs.mkdirSync(TCACHE, { recursive: true })
const OUT = path.join(ROOT, "client", "public", town.prebuilt.replace(/^\//, ""))

// ---- 1. OpenStreetMap, in boxes of about 2.7 km ----
const N = 4
const { south, west, north, east } = town.bbox
const boxes = []
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) boxes.push({ south: south + ((north - south) * j) / N, north: south + ((north - south) * (j + 1)) / N, west: west + ((east - west) * i) / N, east: west + ((east - west) * (i + 1)) / N })

const fetchBox = async (box, k) => {
  const file = path.join(CACHE, `osm-${k}.json`)
  if (!refetch && fs.existsSync(file)) return { cached: true, data: JSON.parse(fs.readFileSync(file, "utf8")) }
  const query = townQuery(box, 180)
  for (let attempt = 0; attempt < 6; attempt++) {
    const endpoint = ENDPOINTS[attempt % ENDPOINTS.length]
    try {
      const t0 = Date.now()
      const res = await fetch(endpoint, { method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" }, body: "data=" + encodeURIComponent(query) })
      if (res.status === 429 || res.status === 504 || res.status === 503) {
        console.log(`  box ${k}: ${res.status} from ${endpoint}, waiting 60 s`)
        await sleep(60000)
        continue
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      const elements = (json.elements || []).map(compactElement).filter(Boolean)
      const data = { osm_base: json.osm3s?.timestamp_osm_base || null, elements }
      fs.writeFileSync(file, JSON.stringify(data))
      console.log(`  box ${k}: ${elements.length} elements in ${((Date.now() - t0) / 1000).toFixed(1)} s`)
      return { cached: false, data }
    } catch (e) {
      console.log(`  box ${k}: ${e.message} (${endpoint}), retrying in 30 s`)
      await sleep(30000)
    }
  }
  throw new Error(`box ${k} failed`)
}

console.log(`${town.name}: ${boxes.length} boxes`)
const all = new Map()
let osmBase = null
for (let k = 0; k < boxes.length; k++) {
  const { cached, data } = await fetchBox(boxes[k], k)
  osmBase = osmBase || data.osm_base
  for (const el of data.elements) all.set(`${el.type[0]}${el.id}`, el)
  if (!cached && k < boxes.length - 1) await sleep(20000)
}
// (the street furniture, fetched by add-street-nodes.mjs, if it's been fetched)
const streetFile = path.join(CACHE, "street.json")
if (fs.existsSync(streetFile)) for (const el of JSON.parse(fs.readFileSync(streetFile, "utf8")).elements) all.set(`${el.type[0]}${el.id}`, compactElement(el) || el)
console.log(`${all.size} elements (OSM base ${osmBase})`)

// ---- 2. the terrain ----
const tilesNeeded = terrainTilesFor(town.bbox)
const pngs = new Map()
for (const t of tilesNeeded) {
  const file = path.join(TCACHE, `${t.z}_${t.x}_${t.y}.png`)
  if (!fs.existsSync(file)) {
    const res = await fetch(TERRAIN_URL(t.z, t.x, t.y), { headers: { "User-Agent": UA } })
    if (!res.ok) throw new Error(`terrain ${t.x}/${t.y}: ${res.status}`)
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()))
    await sleep(80)
  }
  pngs.set(`${t.z}/${t.x}/${t.y}`, decodePng(fs.readFileSync(file), (b) => new Uint8Array(zlib.inflateSync(b))))
}
const elevation = terrainSampler((z, x, y) => pngs.get(`${z}/${x}/${y}`) || null)
console.log(`${tilesNeeded.length} terrain tiles`)

// ---- 3. cut into tiles ----
const tiles = tilesInBox(town.bbox, TILE_ZOOM)
const buckets = new Map(tiles.map((t) => [`${t.x}/${t.y}`, []]))
const pad = 0.0003
for (const el of all.values()) {
  let la0 = Infinity
  let la1 = -Infinity
  let lo0 = Infinity
  let lo1 = -Infinity
  const take = (lat, lon) => {
    if (lat < la0) la0 = lat
    if (lat > la1) la1 = lat
    if (lon < lo0) lo0 = lon
    if (lon > lo1) lo1 = lon
  }
  if (el.type === "node") take(el.lat, el.lon)
  else if (el.type === "way") for (const [a, b] of el.geom) take(a, b)
  else for (const m of el.members) for (const [a, b] of m.geom) take(a, b)
  const x0 = Math.floor(lon2x(lo0 - pad, TILE_ZOOM))
  const x1 = Math.floor(lon2x(lo1 + pad, TILE_ZOOM))
  const y0 = Math.floor(lat2y(la1 + pad, TILE_ZOOM))
  const y1 = Math.floor(lat2y(la0 - pad, TILE_ZOOM))
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) buckets.get(`${x}/${y}`)?.push(el)
}
fs.rmSync(OUT, { recursive: true, force: true })
let bytes = 0
let biggest = { k: "", n: 0 }
const index = []
let counts = { roads: 0, buildings: 0, areas: 0, trees: 0, pois: 0 }
for (const t of tiles) {
  const tile = buildTile({ z: t.z, x: t.x, y: t.y, elements: buckets.get(`${t.x}/${t.y}`), elevation })
  const text = JSON.stringify(tile)
  const dir = path.join(OUT, String(t.z), String(t.x))
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${t.y}.json`), text)
  bytes += text.length
  if (text.length > biggest.n) biggest = { k: `${t.x}/${t.y}`, n: text.length }
  index.push([t.x, t.y, text.length])
  counts.roads += tile.r.length
  counts.buildings += tile.b.length
  counts.areas += tile.a.length
  counts.trees += tile.t.length / 2
  counts.pois += tile.p.length
}
// the town's base: the ground at its origin (heights in the tiles are above it in the browser)
const base = Math.round(elevation(town.origin[0], town.origin[1]) * 10) / 10
const xs = tiles.map((t) => t.x)
const ys = tiles.map((t) => t.y)
fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify({ town: town.id, z: TILE_ZOOM, base, osm_base: osmBase, built: new Date().toISOString().slice(0, 10), x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), tiles: index.length, bytes, counts, source: "© OpenStreetMap contributors (ODbL); AWS Terrain Tiles (USGS 3DEP)" }))
console.log(`${tiles.length} tiles, ${(bytes / 1024 / 1024).toFixed(1)} MB, biggest ${biggest.k} ${(biggest.n / 1024).toFixed(0)} KB, base ${base} m`, counts)
void tileBounds
