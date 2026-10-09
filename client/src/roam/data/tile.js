// Roam: one map tile, compact. Pure; Node-tested (roam.test.js).
//
// buildTile (the tile function and the offline builder): Overpass elements (osm.js
// compactElement) + an elevation sampler -> a small JSON tile:
//   { v, z, x, y, n: [names], h: { n, d } (heights, dm, delta-coded rows),
//     r: [[cls, width dm, flags, name, layer, ...line]],      roads, paths, rail
//     b: [[kind, height dm, min dm, levels, roof, name, ...ring]],  buildings (by centroid)
//     a: [[cls, ...ring]],                                     land use, parks, water, parking
//     t: [u, v, ...],                                          mapped trees
//     s: [kind, u, v, ...],                                    street lamps, signals, stop signs (STREET)
//     p: [[kind, name, u, v]] }                                named places
// Coordinates are tile units (geo.js EXTENT across), delta-coded ([u0, v0, du1, dv1, ...]);
// lines and areas are clipped to the tile plus a small margin; buildings belong to the tile
// their middle is in.
//
// decodeTile (the browser): a tile -> features in town metres, with real widths and heights
// (defaults by kind when the map doesn't say; docs/open-world.md).

import { EXTENT, fromTileUnits, tileBounds, toTileUnits } from "../geo.js"
import { stitchRings } from "./osm.js"

export const TILE_VERSION = 1
export const GRID = 33 // height samples per side (32 cells, ~16 m at z16)
const MARGIN = 96 // tile units beyond the edges kept when clipping (~12 m)

// ---------- classes ----------
// roads: name, default carriageway width (m), lanes default, drawn order
export const ROAD_CLASSES = [
  ["motorway", 11.5],
  ["trunk", 14],
  ["primary", 16],
  ["secondary", 14],
  ["tertiary", 11],
  ["residential", 10],
  ["unclassified", 8],
  ["service", 6],
  ["living_street", 7],
  ["link", 5.5],
  ["pedestrian", 4],
  ["footway", 2],
  ["path", 1.8],
  ["cycleway", 2.5],
  ["steps", 2],
  ["track", 3],
  ["rail", 3.2],
  ["driveway", 3.5],
  ["aisle", 6.5],
  ["river", 14],
  ["stream", 3],
]
export const ROAD = Object.fromEntries(ROAD_CLASSES.map(([n], i) => [n, i]))
export const DRIVABLE = new Set(["motorway", "trunk", "primary", "secondary", "tertiary", "residential", "unclassified", "service", "living_street", "link", "driveway", "aisle"].map((n) => ROAD[n]))
export const FOOT = new Set(["pedestrian", "footway", "path", "cycleway", "steps", "track"].map((n) => ROAD[n]))
export const F = { oneway: 1, bridge: 2, tunnel: 4, walkL: 8, walkR: 16, lit: 32, sidewalk: 64 }

export const AREA_CLASSES = ["res", "com", "ind", "farm", "dirt", "dry", "scrub", "grass", "park", "wood", "cemetery", "school", "sand", "golf", "golfgreen", "parking", "plaza", "pitch", "track", "playground", "water", "pool"]
export const AREA = Object.fromEntries(AREA_CLASSES.map((n, i) => [n, i]))

// what stands at a street node (the map's highway=street_lamp / traffic_signals / stop)
export const STREET = { lamp: 0, signals: 1, stop: 2 }
export const streetKindOf = (t) => (t.highway === "street_lamp" ? STREET.lamp : t.highway === "traffic_signals" ? STREET.signals : t.highway === "stop" ? STREET.stop : -1)
export const BUILDING_KINDS = ["yes", "house", "residential", "apartments", "commercial", "retail", "industrial", "warehouse", "school", "garage", "garages", "shed", "roof", "church", "office", "hospital", "hotel", "civic", "public", "parking", "service", "detached", "semidetached_house", "terrace", "carport", "university", "college", "supermarket", "fire_station", "library", "stadium", "grandstand", "other"]
export const ROOF_SHAPES = ["", "flat", "gabled", "hipped", "pyramidal", "skillion", "dome", "half-hipped", "gambrel", "mansard", "round"]

// ---------- tags -> classes ----------
const num = (v) => {
  if (v === undefined || v === null) return NaN
  const s = String(v).trim().toLowerCase()
  const ft = s.match(/^(\d+(?:\.\d+)?)\s*(?:'|ft|feet)/)
  if (ft) return Number(ft[1]) * 0.3048
  const m = s.match(/^(\d+(?:\.\d+)?)/)
  return m ? Number(m[1]) : NaN
}

export const roadClassOf = (t) => {
  const h = t.highway
  if (t.railway === "rail" || t.railway === "light_rail") return ROAD.rail
  if (t.waterway === "river") return ROAD.river
  if (t.waterway === "stream" || t.waterway === "canal") return ROAD.stream
  if (!h || t.area === "yes") return -1
  if (h === "motorway") return ROAD.motorway
  if (/_link$/.test(h)) return ROAD.link
  if (h === "service") return t.service === "driveway" ? ROAD.driveway : t.service === "parking_aisle" ? ROAD.aisle : ROAD.service
  if (h === "bridleway") return ROAD.path
  if (h in ROAD && !["rail", "link", "driveway", "aisle", "river", "stream"].includes(h)) return ROAD[h]
  if (h === "road" || h === "busway") return ROAD.unclassified
  return -1
}
// carriageway width in metres
export const roadWidth = (cls, t) => {
  const w = num(t.width)
  if (w >= 1 && w <= 40) return w
  const lanes = Math.round(num(t.lanes))
  const name = ROAD_CLASSES[cls][0]
  if (lanes >= 1 && lanes <= 10 && DRIVABLE.has(cls)) {
    const laneW = name === "motorway" || name === "trunk" ? 3.7 : 3.4
    const shoulder = name === "motorway" ? 3.5 : name === "trunk" || name === "primary" || name === "secondary" ? 2.5 : 1.2
    return lanes * laneW + shoulder
  }
  // (one direction of a divided road: about half)
  const def = ROAD_CLASSES[cls][1]
  return t.oneway === "yes" && ["primary", "secondary", "trunk", "tertiary"].includes(name) ? def * 0.55 : def
}
export const roadFlags = (t) => {
  let f = 0
  if (t.oneway === "yes" || t.oneway === "1" || t.highway === "motorway") f |= F.oneway
  if (t.bridge && t.bridge !== "no") f |= F.bridge
  if (t.tunnel && t.tunnel !== "no") f |= F.tunnel
  const sw = t.sidewalk || (t["sidewalk:both"] === "yes" ? "both" : "")
  if (sw === "both" || sw === "left" || t["sidewalk:left"] === "yes") f |= F.walkL
  if (sw === "both" || sw === "right" || t["sidewalk:right"] === "yes") f |= F.walkR
  if (t.lit === "yes") f |= F.lit
  if (t.footway === "sidewalk") f |= F.sidewalk
  return f
}

export const areaClassOf = (t) => {
  if (t.building) return -1
  if (t.natural === "water" || t.waterway === "riverbank" || t.landuse === "reservoir" || t.landuse === "basin") return AREA.water
  if (t.leisure === "swimming_pool") return AREA.pool
  if (t.amenity === "parking" && t.parking !== "underground" && t.parking !== "multi-storey" && t.location !== "underground") return AREA.parking
  if (t.golf === "green" || t.golf === "tee") return AREA.golfgreen
  if (t.golf === "fairway") return AREA.golf
  if (t.golf === "bunker") return AREA.sand
  if (t.leisure === "pitch") return AREA.pitch
  if (t.leisure === "track") return AREA.track
  if (t.leisure === "playground") return AREA.playground
  if (t.leisure === "golf_course") return AREA.golf
  if (["park", "garden", "dog_park", "recreation_ground", "common"].includes(t.leisure)) return AREA.park
  if (t.highway === "pedestrian" && t.area === "yes") return AREA.plaza
  if (t.amenity === "school" || t.amenity === "college" || t.amenity === "university" || t.amenity === "kindergarten") return AREA.school
  if (t.landuse === "cemetery" || t.amenity === "grave_yard") return AREA.cemetery
  if (t.natural === "wood" || t.landuse === "forest") return AREA.wood
  if (t.natural === "scrub" || t.natural === "heath") return AREA.scrub
  if (t.natural === "grassland") return AREA.dry
  if (["sand", "beach", "bare_rock", "scree", "shingle"].includes(t.natural)) return AREA.sand
  if (["grass", "meadow", "village_green", "recreation_ground"].includes(t.landuse)) return AREA.grass
  if (["farmland", "orchard", "vineyard", "plant_nursery", "farmyard"].includes(t.landuse)) return AREA.farm
  if (["construction", "brownfield", "greenfield", "landfill", "quarry"].includes(t.landuse)) return AREA.dirt
  if (t.landuse === "residential") return AREA.res
  if (["commercial", "retail"].includes(t.landuse) || t.amenity === "hospital") return AREA.com
  if (["industrial", "railway", "garages"].includes(t.landuse)) return AREA.ind
  return -1
}

export const buildingOf = (t) => {
  if (!t.building || t.building === "no") return null
  const kind = BUILDING_KINDS.indexOf(t.building)
  const h = num(t.height)
  const min = num(t.min_height)
  const levels = Math.round(num(t["building:levels"]))
  const roof = Math.max(0, ROOF_SHAPES.indexOf(t["roof:shape"] || ""))
  return { kind: kind < 0 ? BUILDING_KINDS.length - 1 : kind, h: h > 0 && h < 400 ? Math.round(h * 10) : 0, min: min > 0 && min < 300 ? Math.round(min * 10) : 0, levels: levels > 0 && levels < 120 ? levels : 0, roof }
}

const POI_KEYS = ["amenity", "shop", "tourism", "leisure", "historic", "office", "railway", "natural"]
const POI_SKIP = new Set(["bench", "waste_basket", "bicycle_parking", "parking_space", "parking_entrance", "vending_machine", "post_box", "drinking_water", "toilets", "tree", "hydrant", "recycling", "bus_stop"])
export const poiKindOf = (t) => {
  for (const k of POI_KEYS) {
    const v = t[k]
    if (!v || POI_SKIP.has(v)) continue
    if (k === "natural" && v !== "peak") continue
    if (k === "railway" && v !== "station") continue
    return v
  }
  return null
}

// ---------- geometry helpers ----------
// Douglas-Peucker on [[u, v], ...]
export const simplify = (pts, tol) => {
  if (pts.length <= 2 || tol <= 0) return pts
  // (a closed ring: split at the point farthest from the start, each half on its own)
  const f = pts[0]
  const l = pts[pts.length - 1]
  if (pts.length > 3 && f[0] === l[0] && f[1] === l[1]) {
    let k = 1
    let far = -1
    for (let i = 1; i < pts.length - 1; i++) {
      const d = Math.hypot(pts[i][0] - f[0], pts[i][1] - f[1])
      if (d > far) {
        far = d
        k = i
      }
    }
    return simplify(pts.slice(0, k + 1), tol).concat(simplify(pts.slice(k), tol).slice(1))
  }
  const keep = new Uint8Array(pts.length)
  keep[0] = keep[pts.length - 1] = 1
  const stack = [[0, pts.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()
    const [ax, ay] = pts[a]
    const [bx, by] = pts[b]
    const dx = bx - ax
    const dy = by - ay
    const L = Math.hypot(dx, dy) || 1e-9
    let best = -1
    let bestD = tol
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / L
      if (d > bestD) {
        bestD = d
        best = i
      }
    }
    if (best > 0) {
      keep[best] = 1
      stack.push([a, best], [best, b])
    }
  }
  return pts.filter((_, i) => keep[i])
}

// a line clipped to a box -> pieces [[[u, v], ...], ...] (Liang-Barsky per segment)
export const clipLine = (pts, lo, hi) => {
  const out = []
  let cur = null
  for (let i = 0; i + 1 < pts.length; i++) {
    let [x0, y0] = pts[i]
    let [x1, y1] = pts[i + 1]
    const dx = x1 - x0
    const dy = y1 - y0
    let t0 = 0
    let t1 = 1
    let ok = true
    for (const [p, q] of [[-dx, x0 - lo], [dx, hi - x0], [-dy, y0 - lo], [dy, hi - y0]]) {
      if (p === 0) {
        if (q < 0) ok = false
      } else {
        const r = q / p
        if (p < 0) t0 = Math.max(t0, r)
        else t1 = Math.min(t1, r)
      }
    }
    if (!ok || t0 > t1) {
      if (cur) out.push(cur)
      cur = null
      continue
    }
    const a = [x0 + dx * t0, y0 + dy * t0]
    const b = [x0 + dx * t1, y0 + dy * t1]
    if (!cur) cur = [a]
    cur.push(b)
    if (t1 < 1) {
      out.push(cur)
      cur = null
    }
  }
  if (cur) out.push(cur)
  return out.filter((p) => p.length >= 2)
}

// a polygon clipped to a box (Sutherland-Hodgman) -> ring (open) or []
export const clipPolygon = (pts, lo, hi) => {
  let poly = pts.slice()
  if (poly.length > 1 && poly[0][0] === poly[poly.length - 1][0] && poly[0][1] === poly[poly.length - 1][1]) poly.pop()
  const edges = [
    (p) => p[0] >= lo,
    (p) => p[0] <= hi,
    (p) => p[1] >= lo,
    (p) => p[1] <= hi,
  ]
  const cross = [
    (a, b) => [lo, a[1] + ((b[1] - a[1]) * (lo - a[0])) / (b[0] - a[0])],
    (a, b) => [hi, a[1] + ((b[1] - a[1]) * (hi - a[0])) / (b[0] - a[0])],
    (a, b) => [a[0] + ((b[0] - a[0]) * (lo - a[1])) / (b[1] - a[1]), lo],
    (a, b) => [a[0] + ((b[0] - a[0]) * (hi - a[1])) / (b[1] - a[1]), hi],
  ]
  for (let e = 0; e < 4 && poly.length; e++) {
    const inside = edges[e]
    const next = []
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]
      const b = poly[(i + 1) % poly.length]
      const ai = inside(a)
      const bi = inside(b)
      if (ai) next.push(a)
      if (ai !== bi) next.push(cross[e](a, b))
    }
    poly = next
  }
  return poly.length >= 3 ? poly : []
}

export const ringArea = (r) => {
  let a = 0
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1])
  return a / 2
}
export const centroid = (r) => {
  let x = 0
  let y = 0
  for (const p of r) {
    x += p[0]
    y += p[1]
  }
  return [x / r.length, y / r.length]
}

// rounded to whole units, repeats dropped (what delta() keeps, point for point)
const roundPts = (pts) => {
  const out = []
  for (const [u, v] of pts) {
    const p = [Math.round(u), Math.round(v)]
    const q = out[out.length - 1]
    if (!q || q[0] !== p[0] || q[1] !== p[1]) out.push(p)
  }
  return out
}
const delta = (pts) => {
  const out = []
  let pu = 0
  let pv = 0
  for (const [u, v] of pts) {
    const iu = Math.round(u)
    const iv = Math.round(v)
    if (out.length && iu === pu && iv === pv) continue
    out.push(iu - pu, iv - pv)
    pu = iu
    pv = iv
  }
  return out
}
export const undelta = (arr, from = 0) => {
  const pts = []
  let u = 0
  let v = 0
  for (let i = from; i + 1 < arr.length; i += 2) {
    u += arr[i]
    v += arr[i + 1]
    pts.push([u, v])
  }
  return pts
}

// ---------- building a tile ----------
// elements: compact Overpass elements; elevation(lat, lon) -> metres (or null: flat)
export const buildTile = ({ z, x, y, elements, elevation = null }) => {
  const b = tileBounds(z, x, y)
  const toU = (p) => toTileUnits(b, p[0], p[1])
  const lo = -MARGIN
  const hi = EXTENT + MARGIN
  const names = []
  const nameIdx = (s) => {
    if (!s) return -1
    let i = names.indexOf(s)
    if (i < 0) {
      i = names.length
      names.push(s)
    }
    return i
  }
  const roads = []
  const decks = [] // [road index, deck height dm at each of its points]
  const buildings = []
  const areas = []
  const trees = []
  const pois = []
  const street = []
  const seen = new Set()
  const inTile = ([u, v]) => u >= 0 && u < EXTENT && v >= 0 && v < EXTENT
  const bboxOverlaps = (pts) => {
    let a = Infinity
    let c = -Infinity
    let d = Infinity
    let e = -Infinity
    for (const [u, v] of pts) {
      if (u < a) a = u
      if (u > c) c = u
      if (v < d) d = v
      if (v > e) e = v
    }
    return c >= lo && a <= hi && e >= lo && d <= hi
  }
  for (const el of elements) {
    if (!el) continue
    const key = `${el.type[0]}${el.id}`
    if (seen.has(key)) continue
    seen.add(key)
    const t = el.tags || {}
    if (el.type === "node") {
      const p = toU([el.lat, el.lon])
      if (!inTile(p)) continue
      if (t.natural === "tree") trees.push(Math.round(p[0]), Math.round(p[1]))
      const sk = streetKindOf(t)
      if (sk >= 0) street.push(sk, Math.round(p[0]), Math.round(p[1]))
      const kind = poiKindOf(t)
      if (kind && t.name) pois.push([kind, nameIdx(t.name), Math.round(p[0]), Math.round(p[1])])
      continue
    }
    // rings (closed ways, multipolygon outers) and lines
    const rings = el.type === "relation" ? stitchRings(el.members.filter((m) => m.role !== "inner").map((m) => m.geom)) : null
    const geomU = el.type === "way" ? el.geom.map(toU) : null
    const closed = el.type === "way" && el.geom.length >= 4 && el.geom[0][0] === el.geom[el.geom.length - 1][0] && el.geom[0][1] === el.geom[el.geom.length - 1][1]
    // buildings
    const bd = buildingOf(t)
    if (bd) {
      const ring = rings ? (rings[0] || []).map(toU) : closed ? geomU : null
      if (!ring || ring.length < 4) continue
      const c = centroid(ring.slice(0, -1))
      if (!inTile(c)) continue
      const r = ring.slice(0, -1)
      if (ringArea(r) < 0) r.reverse() // (one winding: clockwise in u/v, counter-clockwise seen from above in x/z)
      buildings.push([bd.kind, bd.h, bd.min, bd.levels, bd.roof, nameIdx(t.name), ...delta(r)])
      if (t.name && poiKindOf(t)) pois.push([poiKindOf(t), nameIdx(t.name), Math.round(c[0]), Math.round(c[1])])
      continue
    }
    // roads, paths, rail
    const rc = el.type === "way" ? roadClassOf(t) : -1
    if (rc >= 0 && !(closed && t.area === "yes")) {
      const pieces = clipLine(geomU, lo, hi)
      const w = roadWidth(rc, t)
      const flags = roadFlags(t)
      // a bridge's deck: straight from the ground at one end to the ground at the other (along
      // the whole bridge, not just this tile's piece), a footbridge arched to clear the road
      let deckAt = null
      if (flags & F.bridge && elevation) {
        const cum = [0]
        for (let i = 1; i < geomU.length; i++) cum.push(cum[i - 1] + Math.hypot(geomU[i][0] - geomU[i - 1][0], geomU[i][1] - geomU[i - 1][1]))
        const total = cum[cum.length - 1] || 1
        const hA = elevation(el.geom[0][0], el.geom[0][1]) ?? 0
        const hB = elevation(el.geom[el.geom.length - 1][0], el.geom[el.geom.length - 1][1]) ?? 0
        const metres = (total / EXTENT) * 504
        const hump = FOOT.has(rc) && metres > 14 ? Math.min(5.5, metres * 0.18) : 0
        deckAt = ([u, v]) => {
          let best = Infinity
          let along = 0
          for (let i = 0; i + 1 < geomU.length; i++) {
            const [ax, ay] = geomU[i]
            const dx = geomU[i + 1][0] - ax
            const dy = geomU[i + 1][1] - ay
            const L2 = dx * dx + dy * dy || 1e-9
            const k = Math.max(0, Math.min(1, ((u - ax) * dx + (v - ay) * dy) / L2))
            const d = Math.hypot(u - ax - dx * k, v - ay - dy * k)
            if (d < best) {
              best = d
              along = cum[i] + Math.sqrt(L2) * k
            }
          }
          const f = along / total
          return Math.round((hA + (hB - hA) * f + hump * Math.pow(Math.sin(Math.PI * f), 0.6)) * 10)
        }
      }
      for (const piece of pieces) {
        let s = roundPts(simplify(piece, 2))
        if (s.length < 2) continue
        // (a bridge gets a point every ~8 m, so its deck can arch and follow its ends)
        if (deckAt) {
          const dense = [s[0]]
          for (let i = 1; i < s.length; i++) {
            const [ax, ay] = s[i - 1]
            const [bx, by] = s[i]
            const n = Math.ceil(Math.hypot(bx - ax, by - ay) / 65)
            for (let k = 1; k <= n; k++) dense.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n])
          }
          s = roundPts(dense)
        }
        if (deckAt) decks.push([roads.length, ...s.map(deckAt)])
        roads.push([rc, Math.round(w * 10), flags, nameIdx(t.name || t.ref), Number(t.layer) | 0, ...delta(s)])
      }
      continue
    }
    // tree rows: a tree every ~9 m along
    if (el.type === "way" && t.natural === "tree_row") {
      const step = (9 / 504) * EXTENT
      for (let i = 0; i + 1 < geomU.length; i++) {
        const [a0, a1] = geomU[i]
        const [b0, b1] = geomU[i + 1]
        const L = Math.hypot(b0 - a0, b1 - a1)
        for (let s = 0; s < L; s += step) {
          const p = [a0 + ((b0 - a0) * s) / L, a1 + ((b1 - a1) * s) / L]
          if (inTile(p)) trees.push(Math.round(p[0]), Math.round(p[1]))
        }
      }
      continue
    }
    // areas
    const ac = areaClassOf(t)
    if (ac >= 0) {
      const list = rings ? rings.map((r) => r.map(toU)) : closed ? [geomU] : []
      for (const ring of list) {
        if (!bboxOverlaps(ring)) continue
        const clipped = clipPolygon(simplify(ring, 3), lo, hi)
        if (clipped.length >= 3 && Math.abs(ringArea(clipped)) > 40) areas.push([ac, ...delta(clipped)])
      }
      if (t.name && poiKindOf(t) && list[0]) {
        const c = centroid(list[0])
        if (inTile(c)) pois.push([poiKindOf(t), nameIdx(t.name), Math.round(c[0]), Math.round(c[1])])
      }
    }
  }
  // the ground's height: a GRID x GRID lattice over the tile, edges shared with the neighbours
  let h = null
  if (elevation) {
    const d = []
    let prev = 0
    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        const ll = fromTileUnits(b, (i / (GRID - 1)) * EXTENT, (j / (GRID - 1)) * EXTENT)
        const m = elevation(ll.lat, ll.lon)
        const dm = Math.round((Number.isFinite(m) ? m : 0) * 10)
        d.push(dm - prev)
        prev = dm
      }
    }
    h = { n: GRID, d }
  }
  // (areas drawn bottom-up by class; roads by class)
  areas.sort((p, q) => p[0] - q[0])
  const out = { v: TILE_VERSION, z, x, y, n: names, h, r: roads, k: decks, b: buildings, a: areas, t: trees, p: pois }
  if (street.length) out.s = street
  return out
}

// ---------- reading a tile (the browser) ----------
// default heights (m) when the map gives neither a height nor levels
const DEFAULT_H = { house: 6.5, residential: 7, detached: 6.5, semidetached_house: 7, terrace: 8, apartments: 11, commercial: 8, retail: 7, industrial: 9, warehouse: 9, school: 7.5, garage: 3.2, garages: 3, shed: 2.6, roof: 4.5, carport: 3, church: 10, office: 12, hospital: 14, hotel: 14, civic: 9, public: 8, parking: 9, service: 3.5, university: 12, college: 10, supermarket: 8, fire_station: 8, library: 8, stadium: 14, grandstand: 8 }
export const buildingHeight = (kind, hDm, levels, area) => {
  if (hDm > 0) return hDm / 10
  if (levels > 0) return levels * 3.1 + (levels === 1 ? 1.2 : 1.5)
  const name = BUILDING_KINDS[kind] || "yes"
  if (DEFAULT_H[name]) return DEFAULT_H[name]
  // "yes": by size (a house, a shop, a big box)
  return area < 60 ? 3.2 : area < 320 ? 6.2 : area < 2500 ? 8 : 10
}
export const isHouse = (kind) => ["house", "residential", "detached", "semidetached_house", "terrace", "garage", "garages", "shed"].includes(BUILDING_KINDS[kind])

// tile -> { rect, heights: Float32Array (m above the town's base), grid, roads, buildings,
// areas, trees, pois } in town metres. frame: geo.js townFrame; base: the town's base
// elevation (m)
export const decodeTile = (tile, frame, base = 0) => {
  const b = tileBounds(tile.z, tile.x, tile.y)
  const rect = frame.tileRect(tile)
  const sx = (rect.x1 - rect.x0) / EXTENT
  const sz = (rect.z1 - rect.z0) / EXTENT
  const pt = ([u, v]) => ({ x: rect.x0 + u * sx, z: rect.z0 + v * sz })
  const names = tile.n || []
  let heights = null
  let grid = 0
  if (tile.h?.d) {
    grid = tile.h.n
    heights = new Float32Array(grid * grid)
    let acc = 0
    for (let i = 0; i < tile.h.d.length && i < heights.length; i++) {
      acc += tile.h.d[i]
      heights[i] = acc / 10 - base
    }
  }
  const roads = (tile.r || []).map((r) => {
    const [cls, w, flags, name, layer] = r
    return { cls, width: w / 10, flags, name: names[name] || "", layer, pts: undelta(r, 5).map(pt), deck: null }
  })
  // (bridges: the deck's height at each point, above the town's base)
  for (const k of tile.k || []) {
    const road = roads[k[0]]
    if (road && k.length - 1 === road.pts.length) road.deck = k.slice(1).map((d) => d / 10 - base)
  }
  const buildings = (tile.b || []).map((r) => {
    const [kind, h, min, levels, roof, name] = r
    const ring = undelta(r, 6).map(pt)
    let area = 0
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) area += (ring[j].x + ring[i].x) * (ring[j].z - ring[i].z)
    area = Math.abs(area / 2)
    return { kind, height: buildingHeight(kind, h, levels, area), min: min / 10, levels, roof, name: names[name] || "", ring, area }
  })
  const areas = (tile.a || []).map((r) => ({ cls: r[0], ring: undelta(r, 1).map(pt) }))
  const trees = []
  for (let i = 0; i + 1 < (tile.t || []).length; i += 2) trees.push(pt([tile.t[i], tile.t[i + 1]]))
  const pois = (tile.p || []).map(([kind, name, u, v]) => ({ kind, name: names[name] || "", ...pt([u, v]) }))
  const street = []
  for (let i = 0; i + 2 < (tile.s || []).length; i += 3) street.push({ kind: tile.s[i], ...pt([tile.s[i + 1], tile.s[i + 2]]) })
  return { key: `${tile.z}/${tile.x}/${tile.y}`, z: tile.z, x: tile.x, y: tile.y, bounds: b, rect, heights, grid, roads, buildings, areas, trees, pois, street }
}

// the ground's height inside a decoded tile (bilinear on the lattice) -> m, or null outside
export const tileHeightAt = (t, x, z) => {
  if (!t.heights) return 0
  const { x0, x1, z0, z1 } = t.rect
  if (x < x0 - 0.01 || x > x1 + 0.01 || z < z0 - 0.01 || z > z1 + 0.01) return null
  const n = t.grid - 1
  const fu = Math.max(0, Math.min(n - 1e-6, ((x - x0) / (x1 - x0)) * n))
  const fv = Math.max(0, Math.min(n - 1e-6, ((z - z0) / (z1 - z0)) * n))
  const i = Math.floor(fu)
  const j = Math.floor(fv)
  const a = fu - i
  const c = fv - j
  const g = t.grid
  const h00 = t.heights[j * g + i]
  const h10 = t.heights[j * g + i + 1]
  const h01 = t.heights[(j + 1) * g + i]
  const h11 = t.heights[(j + 1) * g + i + 1]
  // (the same two triangles the ground mesh draws: split along the cell's diagonal)
  if (a + c <= 1) return h00 + (h10 - h00) * a + (h01 - h00) * c
  return h11 + (h01 - h11) * (1 - a) + (h10 - h11) * (1 - c)
}
