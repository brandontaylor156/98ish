// Builds a town's getting-around data (docs/open-world.md "Getting around"): from OpenStreetMap
// (one Overpass query for the town's box: the drivable roads with their nodes, bus routes and
// stops, rail lines, train routes and stations; our User-Agent, back-off on 429/504; cached in
// tools/roam/cache/<town>/nav-osm.json, not committed) and the town's prebuilt tiles (the
// named places), it writes three files next to the tiles:
//
//   client/public/roam/<town>/nav.json      the road graph (for the phone's GPS, the ride app)
//   client/public/roam/<town>/places.json   named places to search (the phone's map, Rides)
//   client/public/roam/<town>/transit.json  bus routes with their stops, train lines with their
//                                           stations (the map's own route relations)
//
// Data © OpenStreetMap contributors, ODbL 1.0. Coordinates are whole metres in the town's frame.
//
//   node tools/roam/build-nav.mjs valencia [--refetch]

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { townById } from "../../client/src/roam/towns/index.js"
import { decodeTile } from "../../client/src/roam/data/tile.js"
import { townFrame } from "../../client/src/roam/geo.js"
import { buildGraph, encodeGraph, buildTransit, buildPlaces } from "../../client/src/roam/nav/navdata.js"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, "..", "..")
const UA = "98ish-roam-build/1.0 (98ish open world; https://98ish.vercel.app)"
const ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://z.overpass-api.de/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const id = process.argv[2] || "valencia"
const town = townById(id)
if (!town) throw new Error(`no town ${id}`)
const CACHE = path.join(HERE, "cache", id)
fs.mkdirSync(CACHE, { recursive: true })
const OUT = path.join(ROOT, "client", "public", town.prebuilt.replace(/^\//, ""))
const frame = townFrame(town.origin)

const { south, west, north, east } = town.bbox
const b = [south, west, north, east].map((v) => v.toFixed(6)).join(",")
// (the roads with node ids for the graph; route relations with their members' geometry)
const query = `[out:json][timeout:240][maxsize:536870912];
(
way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"](${b});
way["railway"~"^(rail|light_rail|subway)$"](${b});
node["railway"~"^(station|halt)$"](${b});
node["public_transport"="station"]["train"="yes"](${b});
node["highway"="bus_stop"](${b});
relation["route"~"^(bus|train|light_rail)$"](${b});
);
out body geom qt;`

const file = path.join(CACHE, "nav-osm.json")
if (process.argv.includes("--refetch") || !fs.existsSync(file)) {
  let ok = false
  for (let attempt = 0; attempt < 6 && !ok; attempt++) {
    const endpoint = ENDPOINTS[attempt % ENDPOINTS.length]
    try {
      const t0 = Date.now()
      const res = await fetch(endpoint, { method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" }, body: "data=" + encodeURIComponent(query) })
      if (res.status === 429 || res.status === 504 || res.status === 503) {
        console.log(`  ${res.status} from ${endpoint}, waiting 60 s`)
        await sleep(60000)
        continue
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const text = await res.text()
      fs.writeFileSync(file, text)
      console.log(`  ${(text.length / 1e6).toFixed(1)} MB in ${((Date.now() - t0) / 1000).toFixed(0)} s`)
      ok = true
    } catch (e) {
      console.log(`  ${e.message} (${endpoint}), retrying in 30 s`)
      await sleep(30000)
    }
  }
  if (!ok) throw new Error("Overpass failed")
}
const osm = JSON.parse(fs.readFileSync(file, "utf8"))
const elements = osm.elements || []
console.log(`${town.name}: ${elements.length} elements (OSM base ${osm.osm3s?.timestamp_osm_base || "?"})`)

// the road graph
const graph = buildGraph(elements, frame)
const navText = JSON.stringify({ v: 1, town: town.id, ...encodeGraph(graph), source: "© OpenStreetMap contributors (ODbL)" })
fs.writeFileSync(path.join(OUT, "nav.json"), navText)
console.log(`  nav: ${graph.nodes.length} nodes, ${graph.edges.length} edges, ${(navText.length / 1024).toFixed(0)} KB`)

// transit
const transit = buildTransit(elements, frame, town.bbox)
const trText = JSON.stringify({ v: 1, town: town.id, ...transit, source: "© OpenStreetMap contributors (ODbL)" })
fs.writeFileSync(path.join(OUT, "transit.json"), trText)
console.log(`  transit: ${transit.buses.length} bus routes (${transit.buses.reduce((n, r) => n + r.stops.length, 0)} stops on them), ${transit.trains.length} train lines, ${transit.stations.length} stations, ${(trText.length / 1024).toFixed(0)} KB`)

// places from the prebuilt tiles
const ix = JSON.parse(fs.readFileSync(path.join(OUT, "index.json"), "utf8"))
const tiles = []
for (const x of fs.readdirSync(path.join(OUT, "16"))) for (const f of fs.readdirSync(path.join(OUT, "16", x))) tiles.push(decodeTile(JSON.parse(fs.readFileSync(path.join(OUT, "16", x, f), "utf8")), frame, ix.base))
const places = buildPlaces(tiles, transit)
const plText = JSON.stringify({ v: 1, town: town.id, places, source: "© OpenStreetMap contributors (ODbL)" })
fs.writeFileSync(path.join(OUT, "places.json"), plText)
console.log(`  places: ${places.length}, ${(plText.length / 1024).toFixed(0)} KB`)
