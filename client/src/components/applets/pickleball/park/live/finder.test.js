// Venue Finder: the index logic (finder.js) and the live spec builder (osmspec.js) on made-up
// and saved OpenStreetMap data.
//   node --test client/src/components/applets/pickleball/park/live/finder.test.js
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import * as F from "./finder.js"
import { specFromOsm, compactElements, venueQuery, makeProj } from "./osmspec.js"
import { generateVenue } from "../venuegen.js"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OSM = path.join(HERE, "../../../../../../../tools/venues/osm")

// a court way at (lat, lon), as Overpass `out center tags` gives it
let nextId = 1
const court = (lat, lon, tags = {}) => ({ type: "way", id: nextId++, center: { lat, lon }, tags: { leisure: "pitch", sport: "pickleball", ...tags } })
const M = 111320

test("geohash: known cells, boxes contain their points, near cells include neighbours", () => {
  assert.equal(F.geohash(33.714, -117.924, 2), "9m")
  assert.equal(F.geohash(51.5, -0.12, 2), "gc")
  const [a, b, c, d] = F.geohashBox("9m")
  assert.ok(33.714 >= a && 33.714 <= c && -117.924 >= b && -117.924 <= d)
  // a point near a cell edge pulls in the neighbour
  const near = F.cellsNear(33.7, -112.55, 80)
  assert.equal(near[0], F.geohash(33.7, -112.55, 2))
  assert.ok(near.length >= 2)
})

test("clustering: courts within 60 m are one venue, a hall pulls in its courts, far courts stay apart", () => {
  const k = Math.cos((33.7 * Math.PI) / 180)
  const els = [
    // a row of 4 courts 8.5 m apart
    ...[0, 1, 2, 3].map((i) => court(33.7, -117.9 + (i * 8.5) / (M * k))),
    // 300 m away: another venue of 2
    court(33.7 + 300 / M, -117.9),
    court(33.7 + 300 / M, -117.9 + 8.5 / (M * k)),
    // a lone tennis court with lines 1 km away
    court(33.71, -117.88, { sport: "tennis;pickleball" }),
    // a hall tagged pickleball 120 m from a court that's inside it on the map
    { type: "way", id: nextId++, center: { lat: 33.75, lon: -117.95 }, tags: { leisure: "sports_centre", sport: "pickleball", name: "Dink Hall" } },
    court(33.75 + 110 / M, -117.95, { indoor: "yes" }),
    // not pickleball: ignored
    { type: "way", id: nextId++, center: { lat: 33.7, lon: -117.9 }, tags: { leisure: "pitch", sport: "tennis" } },
  ]
  const cl = F.clusterFeatures(els)
  assert.equal(cl.length, 4)
  const sizes = cl.map((c) => c.els.length).sort()
  assert.deepEqual(sizes, [1, 2, 2, 4])
  const hall = cl.find((c) => c.kinds.includes("hall"))
  assert.equal(F.nameVenue(hall), "Dink Hall")
  assert.ok(F.flagsOf(hall) & F.FLAG.indoor)
  const tennis = cl.find((c) => c.kinds[0] === "tennis")
  assert.deepEqual(F.countCourts(tennis), { courts: 0, onTennis: 1 })
  assert.equal(F.courtCount(F.readRow(F.makeRow({ id: "ow1", lat: 1, lon: 1, r: 0, courts: 0, onTennis: 1, flags: 0 }))), 2)
  // ids: the first court's way, stable
  assert.match(F.venueId(cl[0]), /^ow\d+$/)
  assert.deepEqual(F.parseVenueId("ow123"), { type: "way", osm: 123 })
  assert.deepEqual(F.parseVenueId("on9b"), { type: "node", osm: 9 })
  assert.equal(F.parseVenueId("ow12;drop"), null)
})

test("naming: own name, a nearby park/club/school, the operator; generic names skipped", () => {
  const c = { els: [{ type: "way", id: 1, tags: { name: "Pickleball Courts" } }], kinds: ["court"], lat: 33.7, lon: -117.9, r: 10 }
  const places = [
    { name: "Mile Square Park", lat: 33.7 + 100 / M, lon: -117.9, kind: "park" },
    { name: "Far Away Park", lat: 33.7 + 2000 / M, lon: -117.9, kind: "park" },
  ]
  assert.equal(F.nameVenue(c, places), "Mile Square Park")
  // a sports centre slightly further wins over a park (it's the real host)
  assert.equal(F.nameVenue(c, [...places, { name: "Racquet Club", lat: 33.7 + 130 / M, lon: -117.9, kind: "club" }]), "Racquet Club")
  assert.equal(F.nameVenue({ ...c, els: [{ type: "way", id: 2, tags: { name: "Sunset Courts" } }] }, places), "Sunset Courts")
  assert.equal(F.nameVenue({ ...c, els: [{ type: "way", id: 3, tags: { operator: "City of Irvine" } }] }, []), "City of Irvine")
  assert.equal(F.nameVenue(c, []), null)
  // the names pass: the park the courts stand inside, after a nearby place, before the operator
  assert.equal(F.nameVenue(c, [], "Central Park"), "Central Park")
  assert.equal(F.nameVenue(c, places, "Central Park"), "Mile Square Park")
  assert.equal(F.nameVenue({ ...c, els: [{ type: "way", id: 3, tags: { operator: "City of Irvine" } }] }, [], "Heritage Park"), "Heritage Park")
  assert.equal(F.nameVenue(c, [], "Tennis Courts"), null)
  const answer = [
    { type: "m", id: 1, tags: { i: "0" } },
    { type: "area", id: 1, tags: { amenity: "school", name: "Lincoln Elementary" } },
    { type: "area", id: 2, tags: { leisure: "park", name: "Lincoln Park" } },
    { type: "m", id: 2, tags: { i: "1" } },
    { type: "m", id: 3, tags: { i: "2" } },
    { type: "area", id: 3, tags: { landuse: "recreation_ground", name: "Rec Ground" } },
    { type: "area", id: 4, tags: { club: "sport", name: "Dink Club" } },
  ]
  const split = F.splitIsIn(answer)
  assert.equal(F.pickEnclosing(split.get("0")), "Lincoln Park")
  assert.equal(F.pickEnclosing(split.get("1")), null)
  assert.equal(F.pickEnclosing(split.get("2")), "Dink Club")
  assert.equal(F.pickEnclosing([{ tags: { boundary: "administrative", name: "Irvine" } }]), null)
  // the title falls back to the town
  assert.equal(F.readRow(F.makeRow({ id: "ow1", lat: 1, lon: 1, r: 5, courts: 2, onTennis: 0, flags: 0, name: "", town: "Simi Valley" })).title, "Pickleball courts, Simi Valley")
  const townOf = F.townIndex([
    { name: "Fountain Valley", lat: 33.709, lon: -117.954, pop: 55000 },
    { name: "Los Angeles", lat: 34.05, lon: -118.24, pop: 3800000 },
  ])
  assert.equal(townOf(33.714, -117.924).name, "Fountain Valley")
  assert.equal(townOf(10, 10), null)
})

test("search: towns and names, accents and case folded; nearest sorts by distance", () => {
  const idx = {
    towns: [
      ["Fountain Valley", "9m", 33.709, -117.954, 3],
      ["Valencia", "9q", 34.44, -118.56, 2],
      ["São Paulo", "6g", -23.55, -46.63, 9],
    ],
    named: [
      ["Los Caballeros Sports Village", "9m", 0],
      ["Mile Square Park", "9m", 1],
    ],
  }
  assert.deepEqual(
    F.searchIndex(idx, "valley").towns.map((t) => t.name),
    ["Fountain Valley"]
  )
  assert.equal(F.searchIndex(idx, "sao paulo").towns[0].name, "São Paulo")
  assert.equal(F.searchIndex(idx, "los cab").named[0].name, "Los Caballeros Sports Village")
  assert.equal(F.searchIndex(idx, "x").towns.length, 0)
  // the per-letter search files: a name is in the file of each of its words' first letters,
  // and a query reads its first word's file (so every word-prefix match is there)
  assert.deepEqual(F.searchKeysOf("São Paulo"), ["s", "p"])
  assert.deepEqual(F.searchKeysOf("Mile Square Park"), ["m", "s"])
  assert.deepEqual(F.searchKeysOf("Park Avenue Courts"), ["p", "a"])
  assert.equal(F.searchKey("park ave"), "a")
  assert.equal(F.searchKey("park"), "p")
  assert.deepEqual(F.searchKeysOf("24 Hour Fitness"), ["0", "h", "f"])
  assert.deepEqual(F.searchKeysOf("東京"), ["_"])
  assert.equal(F.searchKey("Forté"), "f")
  assert.equal(F.searchKey("  sao"), "s")
  assert.equal(F.searchKey(""), null)
  for (const [q, name] of [["sq park", "Mile Square Park"], ["paulo", "São Paulo"], ["los cab", "Los Caballeros Sports Village"]]) assert.ok(F.searchKeysOf(name).includes(F.searchKey(q)), q)
  assert.equal(F.matchScore("mile square park", "Mile Square Park"), 3)
  assert.equal(F.matchScore("sq park", "Mile Square Park"), 2)
  const rows = [F.readRow(["ow1", 33.7, -117.9, 60, 4, 0, 0, "A", ""]), F.readRow(["ow2", 34.2, -118.5, 60, 4, 0, 0, "B", ""])]
  const n = F.nearest(rows, 34.1, -118.4)
  assert.deepEqual(n.map((v) => v.id), ["ow2", "ow1"])
  assert.ok(n[0].km < n[1].km)
})

// a compact OSM element (fetch-osm.mjs form) for a rectangle of w x d meters at (x, z) from the venue
const rectEl = (proj, id, x, z, w, d, tags, deg = 0) => {
  const a = (deg * Math.PI) / 180
  const pts = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
    [-1, -1],
  ].map(([i, j]) => proj.ll([x + Math.cos(a) * i * (w / 2) - Math.sin(a) * j * (d / 2), z + Math.sin(a) * i * (w / 2) + Math.cos(a) * j * (d / 2)]))
  return { t: "w", id, tags, g: pts }
}

test("live spec: courts at their real size/angle, missing tags get defaults, the generator builds it", () => {
  const lat = 34
  const lon = -118
  const proj = makeProj(lat, lon)
  const els = [0, 1, 2].map((i) => rectEl(proj, 10 + i, i * 8.5, 0, 6.1, 13.4, { leisure: "pitch", sport: "pickleball" }, 30))
  els.push(rectEl(proj, 20, 30, 0, 10.97, 23.77, { leisure: "pitch", sport: "tennis;pickleball", surface: "clay" }))
  els.push(rectEl(proj, 21, 200, 200, 10.97, 23.77, { leisure: "pitch", sport: "tennis" })) // far plain tennis: dropped
  els.push(rectEl(proj, 30, 0, 40, 20, 12, { building: "yes", "building:levels": "2" }))
  els.push({ t: "n", id: 40, tags: { natural: "tree" }, p: proj.ll([10, -20]) })
  const spec = specFromOsm({ elements: els, osm_base: "2026-10-01" }, { id: "ow10", lat, lon, r: 40, name: "", town: "Pasadena", courts: 3, onTennis: 1, flags: 0 })
  assert.equal(spec.courts.filter((c) => c.s === "p").length, 3)
  const t = spec.courts.find((c) => c.s === "t")
  assert.equal(t.pb, 2)
  assert.ok(spec.palettes[t.col].clay)
  // the court's long axis: built at 30 deg off the z axis -> the spec angle (x east, z south)
  assert.ok(spec.courts.filter((c) => c.s === "p").every((c) => Math.abs(Math.abs(c.a) - 60) < 1.5), JSON.stringify(spec.courts.map((c) => c.a)))
  assert.equal(spec.name, "Pickleball courts, Pasadena")
  assert.equal(spec.buildings[0].h, 7.4) // 2 levels
  assert.equal(spec.indoor, false)
  assert.equal(spec.trees.length >= 1, true)
  const g = generateVenue(spec)
  assert.ok(g.layoutSpec.courts.length >= 3)
  assert.ok(Number.isFinite(g.layoutSpec.bounds.x0))
})

test("live spec: a sports centre tagged pickleball with nothing inside gets courts in its footprint (indoor)", () => {
  const lat = 40
  const lon = -75
  const proj = makeProj(lat, lon)
  const els = [rectEl(proj, 1, 0, 0, 60, 38, { building: "yes", leisure: "sports_centre", sport: "pickleball", name: "Dink Barn" })]
  els.push(rectEl(proj, 2, 0, 50, 50, 20, { amenity: "parking" }))
  const spec = specFromOsm({ elements: els }, { id: "ow1", lat, lon, r: 30, name: "Dink Barn", town: "", courts: 6, onTennis: 0, flags: 1 })
  assert.equal(spec.indoor, true)
  assert.equal(spec.halls.length, 1)
  assert.equal(spec.courts.length, 6)
  assert.ok(spec.buildings.some((b) => b.hall))
  // the door faces the parking (south of the hall: z > 0)
  assert.ok(spec.halls[0].door[1] > 0, JSON.stringify(spec.halls[0].door))
  const g = generateVenue(spec)
  assert.ok(g.layoutSpec.courts.length >= 1)
})

test("live spec: only pickleball lines on tennis courts -> 2 playable courts across each", () => {
  const lat = 36
  const lon = -115
  const proj = makeProj(lat, lon)
  const els = [0, 1, 2].map((i) => rectEl(proj, 50 + i, i * 18, 0, 17, 34.7, { leisure: "pitch", sport: "tennis;pickleball" }))
  const spec = specFromOsm({ elements: els }, { id: "ow50", lat, lon, r: 30, courts: 0, onTennis: 3, flags: 0 })
  assert.equal(spec.courts.filter((c) => c.s === "p").length, 6)
  assert.equal(spec.courts.filter((c) => c.s === "t").length, 0)
  const g = generateVenue(spec)
  assert.ok(g.layoutSpec.courts.length >= 4, `live ${g.layoutSpec.courts.length}`)
})

test("live spec: a bare pin (no courts mapped) still builds a small open slab", () => {
  const spec = specFromOsm({ elements: [] }, { id: "on5", lat: 1, lon: 1, r: 0, courts: 3, onTennis: 0, flags: 2 })
  assert.equal(spec.courts.length, 3)
  assert.ok(spec.lit)
  const g = generateVenue(spec)
  assert.ok(g.layoutSpec.courts.length >= 1)
})

test("live spec on saved real data (no overrides): Los Cab and Sinaloa build with every court", () => {
  for (const [id, lat, lon, min] of [
    ["loscab", 33.714, -117.924, 38],
    ["sinaloa", 34.2654, -118.7846, 12],
  ]) {
    const file = path.join(OSM, `${id}.json`)
    if (!fs.existsSync(file)) continue
    const raw = JSON.parse(fs.readFileSync(file, "utf8"))
    const t0 = performance.now()
    const spec = specFromOsm(raw, { id: "ow1", lat, lon, r: 200, courts: 0 })
    const g = generateVenue(spec)
    const ms = performance.now() - t0
    assert.ok(spec.courts.filter((c) => c.s === "p").length >= min, `${id}: ${spec.courts.length}`)
    assert.ok(g.layoutSpec.courts.length >= 4, id)
    assert.ok(ms < 3000, `${id} took ${ms} ms`)
    assert.ok(JSON.stringify(spec).length < 160 * 1024)
  }
})

test("the Overpass side: a bounded query and the compact form", () => {
  const q = venueQuery(33.7, -117.9, 9999)
  assert.match(q, /around:320,33\.700000,-117\.900000/)
  assert.match(venueQuery(33.7, -117.9, 10), /around:80,/)
  const c = compactElements([
    { type: "node", id: 1, lat: 1.1234567, lon: 2, tags: { natural: "tree", secret: "x" } },
    { type: "way", id: 2, geometry: [{ lat: 1, lon: 2 }, null, { lat: 3, lon: 4 }], tags: { building: "yes" } },
    { type: "relation", id: 3, members: [{ type: "way", role: "outer", geometry: [{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }, { lat: 1, lon: 2 }] }], tags: { leisure: "park" } },
  ])
  assert.deepEqual(c[0], { t: "n", id: 1, tags: { natural: "tree" }, p: [1.123457, 2] })
  assert.equal(c[1].g.length, 2)
  assert.equal(c[2].g.length, 3)
})

test("index build: a combined answer splits into features, towns and places; towns keep coordinates", () => {
  const els = [
    { type: "way", id: 1, center: { lat: 1, lon: 1 }, tags: { leisure: "pitch", sport: "tennis;pickleball" } },
    { type: "node", id: 2, lat: 1, lon: 1, tags: { leisure: "pitch", pickleball: "yes" } },
    { type: "node", id: 3, lat: 33.7, lon: -117.9, tags: { place: "town", name: "Fountain Valley" } },
    { type: "way", id: 4, center: { lat: 1, lon: 1 }, tags: { leisure: "park", name: "Mile Square Park" } },
    { type: "way", id: 5, center: { lat: 1, lon: 1 }, tags: { place: "neighbourhood", name: "Not a node" } },
  ]
  assert.deepEqual(els.map(F.indexKind), ["features", "features", "towns", "places", "places"])
  // a village counts as a town for the nearest-town name, and a city reaches further
  const townOf = F.townIndex([
    { name: "Smallville", lat: 34.0, lon: -118.0, pop: 800 },
    { name: "Big City", lat: 34.05, lon: -118.0, pop: 100000 },
  ])
  assert.equal(townOf(34.001, -118.0)?.name, "Smallville")
  assert.equal(townOf(34.03, -118.0)?.name, "Big City")
  assert.equal(townOf(36, -118.0), null)
})

test("ZIP search: a US ZIP code (with or without +4) is recognized, nothing else is", () => {
  assert.equal(F.zipOf("92708"), "92708")
  assert.equal(F.zipOf(" 92708-1234 "), "92708")
  for (const q of ["9270", "927081", "Fountain Valley", "92708 courts", "", null]) assert.equal(F.zipOf(q), null)
})
