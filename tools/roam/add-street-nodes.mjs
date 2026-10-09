// Adds the street furniture the map has (highway=street_lamp, traffic_signals, stop) to a
// town's prebuilt tiles without rebuilding them (docs/open-world.md "Data pipeline"): one
// Overpass query for the town's box (our User-Agent; cached in tools/roam/cache/<town>/street.json,
// not committed), each node put in the tile it stands in as the tile's `s` list.
// build-town.mjs reads the same cache, so a later rebuild keeps them.
// Data © OpenStreetMap contributors, ODbL 1.0.
//
//   node tools/roam/add-street-nodes.mjs valencia [--refetch]

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { townById } from "../../client/src/roam/towns/index.js"
import { compactElement } from "../../client/src/roam/data/osm.js"
import { streetKindOf } from "../../client/src/roam/data/tile.js"
import { TILE_ZOOM, tileBounds, tileOf, toTileUnits } from "../../client/src/roam/geo.js"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, "..", "..")
const UA = "98ish-roam-build/1.0 (98ish open world; https://98ish.vercel.app)"
const id = process.argv[2] || "valencia"
const town = townById(id)
if (!town) throw new Error(`no town ${id}`)
const CACHE = path.join(HERE, "cache", id)
fs.mkdirSync(CACHE, { recursive: true })
const file = path.join(CACHE, "street.json")
const OUT = path.join(ROOT, "client", "public", town.prebuilt.replace(/^\//, ""))

export const streetQuery = ({ south, west, north, east }) => `[out:json][timeout:90];node["highway"~"^(street_lamp|traffic_signals|stop)$"](${[south, west, north, east].map((v) => v.toFixed(6)).join(",")});out qt;`

if (process.argv.includes("--refetch") || !fs.existsSync(file)) {
  const res = await fetch("https://overpass-api.de/api/interpreter", { method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" }, body: "data=" + encodeURIComponent(streetQuery(town.bbox)) })
  if (!res.ok) throw new Error(`Overpass ${res.status}`)
  fs.writeFileSync(file, await res.text())
}
const data = JSON.parse(fs.readFileSync(file, "utf8"))
const byTile = new Map()
const counts = { lamps: 0, signals: 0, stops: 0 }
for (const raw of data.elements) {
  const el = compactElement(raw)
  if (!el || el.type !== "node") continue
  const kind = streetKindOf(el.tags)
  if (kind < 0) continue
  const t = tileOf(el.lat, el.lon, TILE_ZOOM)
  const k = `${t.x}/${t.y}`
  const [u, v] = toTileUnits(tileBounds(TILE_ZOOM, t.x, t.y), el.lat, el.lon)
  if (!byTile.has(k)) byTile.set(k, [])
  byTile.get(k).push(kind, Math.round(u), Math.round(v))
  counts[["lamps", "signals", "stops"][kind]]++
}
let tiles = 0
let bytes = 0
const dir = path.join(OUT, String(TILE_ZOOM))
for (const x of fs.readdirSync(dir)) {
  for (const f of fs.readdirSync(path.join(dir, x))) {
    const p = path.join(dir, x, f)
    const tile = JSON.parse(fs.readFileSync(p, "utf8"))
    const s = byTile.get(`${x}/${f.replace(/\.json$/, "")}`)
    if (s) tile.s = s
    else delete tile.s
    const text = JSON.stringify(tile)
    fs.writeFileSync(p, text)
    bytes += text.length
    if (s) tiles++
  }
}
const indexFile = path.join(OUT, "index.json")
const index = JSON.parse(fs.readFileSync(indexFile, "utf8"))
index.bytes = bytes
index.counts = { ...index.counts, ...counts }
fs.writeFileSync(indexFile, JSON.stringify(index))
console.log(`${town.name}: ${counts.lamps} lamps, ${counts.signals} signals, ${counts.stops} stop signs in ${tiles} tiles; ${(bytes / 1024 / 1024).toFixed(2)} MB`)
