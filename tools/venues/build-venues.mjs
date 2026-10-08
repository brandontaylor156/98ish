// Builds the compact venue specs Pickleball 98's My Park loads (client/.../park/venues/<id>.json)
// from the saved OpenStreetMap data (osm/<id>.json, fetch-osm.mjs) plus our own per-venue
// corrections (overrides/<id>.json). Also writes the venue index the picker reads and the
// table the server checks (court counts and bounds per venue).
// Data © OpenStreetMap contributors, ODbL 1.0; the specs are a derivative database under the
// same licence (see docs/pickleball-venues.md).
//
//   node tools/venues/build-venues.mjs [id ...]
//
// Spec coordinates: meters, x east, z south, (0, 0) at the middle of the venue's courts.
// Angles: degrees, the direction of a court's length (0 = east, 90 = south).

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { buildSurround } from "./surround.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, "../..")
const PARK = path.join(ROOT, "client/src/components/applets/pickleball/park")
const OUT = path.join(PARK, "venues")
const SERVER_OUT = path.join(ROOT, "server/park/venues.json")
const CONFIG = JSON.parse(fs.readFileSync(path.join(HERE, "venues.config.json"), "utf8"))
const M = 111320
const r1 = (v) => Math.round(v * 10) / 10

// ---------- geometry helpers ----------
const makeProj = (lat0, lon0) => {
  const k = Math.cos((lat0 * Math.PI) / 180)
  return {
    xz: ([la, lo]) => [(lo - lon0) * M * k, -(la - lat0) * M],
    ll: ([x, z]) => [lat0 - z / M, lon0 + x / (M * k)],
  }
}
// the smallest rectangle round a polygon: center, length, width, angle of the length (rad)
export const minRect = (pts) => {
  let best = null
  const n = pts.length
  for (let i = 0; i < n; i++) {
    const p = pts[i]
    const q = pts[(i + 1) % n]
    if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.3) continue
    const a = Math.atan2(q[1] - p[1], q[0] - p[0])
    const c = Math.cos(a)
    const s = Math.sin(a)
    let u0 = Infinity
    let u1 = -Infinity
    let v0 = Infinity
    let v1 = -Infinity
    for (const [x, z] of pts) {
      const u = x * c + z * s
      const v = -x * s + z * c
      u0 = Math.min(u0, u)
      u1 = Math.max(u1, u)
      v0 = Math.min(v0, v)
      v1 = Math.max(v1, v)
    }
    const area = (u1 - u0) * (v1 - v0)
    if (!best || area < best.area) {
      const cu = (u0 + u1) / 2
      const cv = (v0 + v1) / 2
      const long = u1 - u0 >= v1 - v0
      best = { area, x: cu * c - cv * s, z: cu * s + cv * c, len: Math.max(u1 - u0, v1 - v0), wid: Math.min(u1 - u0, v1 - v0), a: long ? a : a + Math.PI / 2 }
    }
  }
  return best
}
const normDeg = (deg) => {
  // (a court looks the same turned half round: keep the angle in (-90, 90])
  let d = ((deg % 180) + 180) % 180
  if (d > 90) d -= 180
  return r1(d)
}
const area = (pts) => {
  let A = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    const q = pts[(i + 1) % pts.length]
    A += p[0] * q[1] - q[0] * p[1]
  }
  return A / 2
}
const dropClosing = (pts) => (pts.length > 2 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1] ? pts.slice(0, -1) : pts)
// polygon clipped to a rectangle (Sutherland-Hodgman)
const clipPoly = (pts, { x0, x1, z0, z1 }) => {
  const edges = [
    [(p) => p[0] >= x0, (a, b) => { const t = (x0 - a[0]) / (b[0] - a[0]); return [x0, a[1] + t * (b[1] - a[1])] }],
    [(p) => p[0] <= x1, (a, b) => { const t = (x1 - a[0]) / (b[0] - a[0]); return [x1, a[1] + t * (b[1] - a[1])] }],
    [(p) => p[1] >= z0, (a, b) => { const t = (z0 - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), z0] }],
    [(p) => p[1] <= z1, (a, b) => { const t = (z1 - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), z1] }],
  ]
  let out = pts
  for (const [inside, cut] of edges) {
    const src = out
    out = []
    for (let i = 0; i < src.length; i++) {
      const a = src[i]
      const b = src[(i + 1) % src.length]
      if (inside(b)) {
        if (!inside(a)) out.push(cut(a, b))
        out.push(b)
      } else if (inside(a)) out.push(cut(a, b))
    }
    if (!out.length) break
  }
  return out
}
// a polyline cut to a rectangle (keeps the runs inside; endpoints moved onto the edge)
const clipLine = (pts, box) => {
  const inside = (p) => p[0] >= box.x0 && p[0] <= box.x1 && p[1] >= box.z0 && p[1] <= box.z1
  const runs = []
  let run = []
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    if (inside(p)) run.push(p)
    else {
      if (run.length) {
        run.push(p)
        runs.push(run)
        run = []
      } else if (i + 1 < pts.length && inside(pts[i + 1])) run.push(p)
    }
  }
  if (run.length > 1) runs.push(run)
  return runs.filter((r) => r.length > 1)
}
// fewer points: drop ones within tol of the line through their neighbours
const simplify = (pts, tol = 0.25, closed = false) => {
  if (pts.length < 4) return pts
  const keep = [pts[0]]
  for (let i = 1; i < pts.length - 1; i++) {
    const a = keep[keep.length - 1]
    const b = pts[i]
    const c = pts[i + 1]
    const L = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1
    const d = Math.abs((c[0] - a[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (c[1] - a[1])) / L
    if (d > tol) keep.push(b)
  }
  keep.push(pts[pts.length - 1])
  return closed && keep.length < 3 ? pts : keep
}
const pr = (pts) => pts.map(([x, z]) => [r1(x), r1(z)])

// where an override gives a point: { ll: [lat, lon] } or { xz: [x, z] } (meters from the
// venue's anchor; converted later to the courts' middle)
const at = (o, proj) => (o.ll ? proj.xz(o.ll) : o.xz ? [...o.xz] : null)

const HEIGHTS = { house: 5, residential: 6, apartments: 10, school: 5, industrial: 7.5, warehouse: 8, commercial: 6.5, retail: 6, roof: 3.5, garage: 3, hotel: 14, office: 10, yes: 5.5, clubhouse: 5.5, hall: 9 }

// a building's look (overrides: buildings.style by id, rules, add): roof (color), roofStyle
// ("flat" | "gable" | "hip" | "mansard"), color (walls), h, kind, tile (clay-tile texture on
// sloped roofs), parapet (m), hvac (rooftop units: true or a count), band (mansard band m),
// rise (m), windows ("rows" | "none" | "ribs"), trim (a color band at the top of the walls)
const styleBuilding = (b, o) => {
  if (o.color) b.c = o.color
  if (o.roof) b.r = o.roof
  if (o.roofStyle) b.rs = o.roofStyle
  if (o.kind) b.k = o.kind
  if (o.h) b.h = o.h
  for (const k of ["tile", "parapet", "hvac", "band", "rise", "windows", "trim", "top"]) if (o[k] !== undefined) b[k] = o[k]
}

// two override layers: objects merge key by key (the top one wins), lists join (base first)
const mergeOv = (base, top) => {
  if (top === undefined) return base
  if (Array.isArray(base) && Array.isArray(top)) return [...base, ...top]
  if (base && top && typeof base === "object" && typeof top === "object" && !Array.isArray(base) && !Array.isArray(top)) {
    const o = { ...base }
    for (const k of Object.keys(top)) o[k] = mergeOv(base[k], top[k])
    return o
  }
  return top
}

const buildOne = (v) => {
  const raw = JSON.parse(fs.readFileSync(path.join(HERE, "osm", `${v.id}.json`), "utf8"))
  const ovPath = path.join(HERE, "overrides", `${v.id}.json`)
  // the hand-written corrections over the layer measured from references (ingest-refs.mjs)
  const refsPath = path.join(HERE, "overrides", `${v.id}.refs.json`)
  const refsOv = fs.existsSync(refsPath) ? JSON.parse(fs.readFileSync(refsPath, "utf8")) : {}
  const ov = mergeOv(refsOv, fs.existsSync(ovPath) ? JSON.parse(fs.readFileSync(ovPath, "utf8")) : {})
  const proj = makeProj(v.lat, v.lon)
  // (a dossier's coordinates: { en: [east, north] } in meters from its own anchor)
  const dproj = ov.anchor ? makeProj(ov.anchor[0], ov.anchor[1]) : proj
  const P = (o) => (o.ll ? proj.xz(o.ll) : o.en ? proj.xz(dproj.ll([o.en[0], -o.en[1]])) : o.xz ? [...o.xz] : null)
  // an angle: deg (0 = east, 90 = south) or a compass bearing of the long axis (0 = north-south)
  const degOf = (o, d = 0) => (o.bearing !== undefined ? o.bearing - 90 : o.deg ?? d)
  const rectPoly = (o) => {
    const [cx, cz] = P(o)
    const a = (degOf(o, 0) * Math.PI) / 180
    const u = [Math.cos(a), Math.sin(a)]
    const w = [-u[1], u[0]]
    return [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([i, j]) => [cx + u[0] * i * (o.w / 2) + w[0] * j * (o.d / 2), cz + u[1] * i * (o.w / 2) + w[1] * j * (o.d / 2)])
  }
  const polyOfO = (o) => (o.rect ? rectPoly(o.rect) : (o.poly || []).map((q) => P(q)))
  // (the courts' middle becomes (0, 0) further down: these shift when they're used, sh())
  // a door: a point on a wall, its width and kind (propkit.js)
  const doorOf = (d) => {
    const q = sh(P(d))
    return { x: r1(q[0]), z: r1(q[1]), w: d.w || 1.8, kind: d.kind || "glass", ...(d.gender ? { gender: d.gender } : {}), ...(d.color ? { color: d.color } : {}), ...(d.sign ? { sign: 1 } : {}) }
  }
  // a prop: its type and params; face = the compass bearing its front looks toward; line: a row
  // of them from -> to every N metres
  const yawOfFace = (o) => (o.face !== undefined ? Math.round(Math.atan2(Math.sin((o.face * Math.PI) / 180), -Math.cos((o.face * Math.PI) / 180)) * 1000) / 1000 : o.a || 0)
  const propsOf = (o) => {
    const { en, ll, xz, face, line, ...rest } = o
    if (line) {
      const a = sh(P(line.from))
      const b = sh(P(line.to))
      const L = Math.hypot(b[0] - a[0], b[1] - a[1])
      const n = Math.max(1, Math.floor(L / (line.every || 3)) + 1)
      return Array.from({ length: n }, (_, k) => ({ ...rest, x: r1(a[0] + ((b[0] - a[0]) * k) / Math.max(1, n - 1)), z: r1(a[1] + ((b[1] - a[1]) * k) / Math.max(1, n - 1)), a: yawOfFace(o) }))
    }
    const q = sh(P(o))
    return [{ ...rest, x: r1(q[0]), z: r1(q[1]), a: yawOfFace(o) }]
  }
  const els = raw.elements
  const polyOf = (e) => (e.g ? dropClosing(e.g.map(proj.xz)) : null)
  const oc = ov.courts || {}
  const keepSports = new Set(oc.sports || ["pickleball", "tennis"])
  const drop = new Set((oc.drop || []).map(String))
  const retag = oc.retag || {}
  const pbOn = oc.pbOnTennis || {}
  // where the courts are (the crop): an override's area, else all kept pitches
  const area0 = ov.area ? { ...ov.area } : null

  // ---------- courts ----------
  const courts = []
  for (const e of els) {
    const t = e.tags
    if (oc.osm === false || t.leisure !== "pitch" || !e.g || drop.has(String(e.id))) continue
    let sport = retag[e.id] || (t.sport || "").split(";").find((s) => keepSports.has(s)) || null
    if (!sport) continue
    const pts = polyOf(e)
    const r = minRect(pts)
    if (!r) continue
    if (area0) {
      const [ax, az] = P(area0)
      if (Math.abs(r.x - ax) > area0.hw || Math.abs(r.z - az) > area0.hd) continue
    }
    // (a tennis court tagged pickleball too: tennis with pickleball lines)
    const both = /pickleball/.test(t.sport || "") && /tennis/.test(t.sport || "")
    if (sport === "pickleball" && r.len > 18) sport = "tennis"
    const pb = sport === "tennis" ? pbOn[e.id] ?? pbOn.all ?? (both ? 2 : 0) : 0
    if ((oc.dropNear || []).some((d) => (!d.sport || d.sport === sport) && Math.hypot(P(d)[0] - r.x, P(d)[1] - r.z) < (d.r || 4))) continue
    courts.push({ id: e.id, x: r.x, z: r.z, a: (r.a * 180) / Math.PI, s: sport, pb, lit: t.lit === "yes" ? 1 : 0, surface: t.surface || null })
  }
  for (const add of oc.add || []) {
    const p = P(add)
    const paint = {}
    for (const k of ["court", "kitchen", "surround", "alley", "lines", "clay", "art"]) if (add[k] !== undefined) paint[k] = add[k]
    courts.push({ id: add.id || `add${courts.length}`, x: p[0], z: p[1], a: degOf(add), s: add.sport || "pickleball", pb: add.pb || 0, pbLayout: add.pbLayout, lit: add.lit ? 1 : 0, paint: Object.keys(paint).length ? paint : null, num: add.num || null })
  }
  for (const g of oc.grid || []) {
    const p0 = P(g)
    const a = (degOf(g) * Math.PI) / 180
    const ux = Math.cos(a)
    const uz = Math.sin(a)
    for (let r = 0; r < (g.rows || 1); r++)
      for (let c = 0; c < (g.cols || 1); c++) {
        // cols step across the courts (perpendicular to their length), rows along them
        const x = p0[0] + -uz * c * (g.dx || 8) + ux * r * (g.dz || 18)
        const z = p0[1] + ux * c * (g.dx || 8) + uz * r * (g.dz || 18)
        courts.push({ id: `grid${courts.length}`, x, z, a: degOf(g), s: g.sport || "pickleball", pb: g.pb || 0, lit: g.lit ? 1 : 0 })
      }
  }
  if (!courts.length) throw new Error(`${v.id}: no courts`)
  // per-court paint (feature courts, red clay ...): rules by where the court is; pbOnTennis by place too
  for (const rule of oc.paint || []) {
    const [px, pz] = P(rule)
    for (const c of courts) {
      if (rule.sport && rule.sport !== c.s) continue
      if (Math.hypot(c.x - px, c.z - pz) > (rule.r || 4)) continue
      c.paint = { ...(c.paint || {}), ...(rule.court ? { court: rule.court } : {}), ...(rule.kitchen ? { kitchen: rule.kitchen } : {}), ...(rule.surround ? { surround: rule.surround } : {}), ...(rule.alley ? { alley: rule.alley } : {}), ...(rule.lines ? { lines: rule.lines } : {}), ...(rule.art ? { art: rule.art } : {}), ...(rule.clay ? { clay: true } : {}) }
    }
  }
  // per-court paint by OSM id (colors measured off the aerial: court, kitchen, surround, alley, lines)
  const PAINT_KEYS = ["court", "kitchen", "surround", "alley", "lines", "clay", "art"]
  for (const c of courts) {
    const by = oc.byId?.[String(c.id)]
    if (!by) continue
    c.paint = { ...(c.paint || {}) }
    for (const k of PAINT_KEYS) if (by[k] !== undefined) c.paint[k] = by[k]
  }
  for (const rule of oc.pbNear || []) {
    const [px, pz] = P(rule)
    for (const c of courts) if (c.s === "tennis" && Math.hypot(c.x - px, c.z - pz) < (rule.r || 4)) {
      c.pb = rule.pb ?? 2
      if (rule.pbLayout) c.pbLayout = rule.pbLayout
    }
  }
  // the courts' middle becomes (0, 0)
  const cx0 = courts.reduce((s, c) => s + c.x, 0) / courts.length
  const cz0 = courts.reduce((s, c) => s + c.z, 0) / courts.length
  const sh = ([x, z]) => [x - cx0, z - cz0]
  const originLL = proj.ll([cx0, cz0])
  for (const c of courts) {
    c.x -= cx0
    c.z -= cz0
  }
  const cb = { x0: Math.min(...courts.map((c) => c.x)) - 15, x1: Math.max(...courts.map((c) => c.x)) + 15, z0: Math.min(...courts.map((c) => c.z)) - 15, z1: Math.max(...courts.map((c) => c.z)) + 15 }
  const crop = ov.crop ?? 85
  const box = { x0: cb.x0 - crop, x1: cb.x1 + crop, z0: cb.z0 - crop, z1: cb.z1 + crop }
  const nearBox = (pts) => pts.some(([x, z]) => x >= box.x0 && x <= box.x1 && z >= box.z0 && z <= box.z1)

  // ---------- buildings, areas, roads, trees, fences ----------
  const ob = ov.buildings || {}
  const bDrop = new Set((ob.drop || []).map(String))
  const buildings = []
  const areas = []
  const roads = []
  const trees = []
  const fences = []
  const lamps = []
  const hallOvs = ov.halls || (ov.hall ? [ov.hall] : [])
  const hallIds = new Map(hallOvs.map((h, k) => [String(h.building || ""), k]))
  const hallPolys = []
  for (const e of els) {
    const t = e.tags
    if (e.p) {
      const p = sh(proj.xz(e.p))
      if (!nearBox([p])) continue
      if (t.natural === "tree") trees.push([r1(p[0]), r1(p[1]), 1, ov.trees?.default || (t.leaf_type === "needleleaved" ? "conifer" : "broadleaf")])
      else if (t.man_made === "lamp_post" || t.highway === "street_lamp") lamps.push([r1(p[0]), r1(p[1])])
      continue
    }
    const pts0 = polyOf(e)
    if (!pts0 || pts0.length < 2) continue
    const pts = pts0.map(sh)
    if (!nearBox(pts)) continue
    if (hallIds.has(String(e.id))) hallPolys[hallIds.get(String(e.id))] = pts
    if (t.building && ob.toArea?.[e.id]) {
      const c = clipPoly(pts, box)
      if (c.length > 2) areas.push({ k: ob.toArea[e.id], p: pr(simplify(c, 0.3, true)) })
      continue
    }
    if (t.building && !bDrop.has(String(e.id))) {
      if (pts.length < 3 || Math.abs(area(pts)) < 12) continue
      const kind = ob.kind?.[e.id] || (t.building === "yes" ? (t.amenity === "school" ? "school" : "yes") : t.building)
      const levels = parseFloat(t["building:levels"])
      const h = ob.height?.[e.id] ?? (parseFloat(t.height) || (levels ? levels * 3.4 + 0.6 : HEIGHTS[kind] || 5.5))
      const b = { id: e.id, p: pr(simplify(pts, 0.3, true)), h: r1(h), k: kind }
      if (ob.color?.[e.id]) b.c = ob.color[e.id]
      if (ob.roof?.[e.id]) b.r = ob.roof[e.id]
      // style rules: every building whose middle is within r of a point
      const mid = [pts.reduce((s2, q) => s2 + q[0], 0) / pts.length, pts.reduce((s2, q) => s2 + q[1], 0) / pts.length]
      for (const rule of ob.rules || []) {
        const [px, pz] = P(rule)
        if (Math.hypot(mid[0] - px, mid[1] - pz) > (rule.r || 10)) continue
        if (rule.color) b.c = rule.color
        if (rule.roof) b.r = rule.roof
        if (rule.roofStyle) b.rs = rule.roofStyle
        if (rule.kind) b.k = rule.kind
        if (rule.h) b.h = rule.h
        styleBuilding(b, rule)
      }
      if (ob.style?.[e.id]) styleBuilding(b, ob.style[e.id])
      if (ob.doors?.[e.id]) b.doors = ob.doors[e.id].map(doorOf)
      if (hallIds.has(String(e.id))) {
        b.hall = 1
        b.hallK = hallIds.get(String(e.id))
      }
      if (t.name && ob.showName?.includes(e.id)) b.n = t.name
      buildings.push(b)
      continue
    }
    if (t.barrier && e.t === "w") {
      for (const run of clipLine(pts, box)) fences.push({ k: t.barrier, p: pr(simplify(run, 0.2)) })
      continue
    }
    if (t.natural === "tree_row") {
      for (const run of clipLine(pts, box)) {
        // (a tree every 7 m along the row)
        for (let i = 0; i < run.length - 1; i++) {
          const [ax, az] = run[i]
          const [bx, bz] = run[i + 1]
          const L = Math.hypot(bx - ax, bz - az)
          for (let d = 0; d < L; d += 7) trees.push([r1(ax + ((bx - ax) * d) / L), r1(az + ((bz - az) * d) / L), 1, ov.trees?.default || "broadleaf"])
        }
      }
      continue
    }
    if (t.highway) {
      const kind = /^(footway|path|pedestrian|steps)$/.test(t.highway) ? "foot" : t.highway === "cycleway" ? "cycle" : t.highway === "service" ? (t.service === "parking_aisle" ? "aisle" : "service") : /^(primary|secondary|trunk|primary_link|secondary_link)$/.test(t.highway) ? "major" : "road"
      if (t.area === "yes") {
        const c = clipPoly(pts, box)
        if (c.length > 2) areas.push({ k: "paved", p: pr(simplify(c, 0.3, true)) })
        continue
      }
      const w = parseFloat(t.width) || { foot: 2, cycle: 2.5, aisle: 6, service: 5.5, road: 9, major: 16 }[kind]
      for (const run of clipLine(pts, box)) roads.push({ k: kind, w: r1(w), p: pr(simplify(run, 0.3)) })
      continue
    }
    if (pts.length < 3) continue
    let k = null
    if (t.amenity === "parking") k = "parking"
    else if (t.leisure === "swimming_pool") k = "pool"
    else if (t.natural === "water" || t.water) k = "water"
    else if (t.natural === "wood" || t.natural === "scrub") k = "wood"
    else if (t.landuse === "grass" || t.leisure === "park" || t.leisure === "garden" || t.natural === "grassland" || t.landuse === "recreation_ground" || t.leisure === "golf_course" || t.landuse === "meadow") k = t.landuse === "recreation_ground" ? "rec" : "grass"
    else if (t.leisure === "playground") k = "play"
    else if (t.landuse === "residential" || t.landuse === "commercial" || t.landuse === "industrial" || t.landuse === "retail") k = "urban"
    else if (t.amenity === "school") k = "school"
    if (!k) continue
    const c = clipPoly(pts, box)
    if (c.length > 2 && Math.abs(area(c)) > 15) areas.push({ k, p: pr(simplify(c, 0.4, true)) })
  }
  // areas.drop: OSM's areas of those kinds go (the ones added below stay)
  if (ov.areas?.drop) for (const k of ov.areas.drop) for (let i = areas.length - 1; i >= 0; i--) if (areas[i].k === k) areas.splice(i, 1)
  for (const a of ov.areas?.add || []) {
    const pts = polyOfO(a).map(sh)
    // (a lot's stall rows traced off the aerial: { from, to, toward (a point on the stalls'
    // side), depth } -> { a, b, d }, d < 0 when the stalls are right of a -> b: scenery.js
    // lotStalls; `full`: the share of stalls taken)
    const rows = (a.rows || []).map((r) => {
      const A = sh(P(r.from))
      const B = sh(P(r.to))
      const T = sh(P(r.toward))
      const L = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1
      const side = Math.sign((T[0] - A[0]) * ((B[1] - A[1]) / L) - (T[1] - A[1]) * ((B[0] - A[0]) / L)) || 1
      return { a: [r1(A[0]), r1(A[1])], b: [r1(B[0]), r1(B[1])], d: side * (r.depth || 5.4) }
    })
    if (pts.length > 2) areas.push({ k: a.kind || "paved", p: pr(pts), ...(a.color ? { c: a.color } : {}), ...(a.lanes ? { lanes: a.lanes } : {}), ...(a.coping ? { coping: a.coping } : {}), ...(rows.length ? { rows } : {}), ...(a.full !== undefined ? { full: a.full } : {}) })
  }
  // trees from overrides
  for (const tr of ov.trees?.add || []) {
    const p = sh(P(tr))
    trees.push([r1(p[0]), r1(p[1]), tr.s ?? 1, tr.kind || "palm"])
  }
  for (const row of ov.trees?.rows || []) {
    const a = sh(P(row.from))
    const b = sh(P(row.to))
    const L = Math.hypot(b[0] - a[0], b[1] - a[1])
    const every = row.every || 8
    for (let d = 0; d <= L + 0.01; d += every) trees.push([r1(a[0] + ((b[0] - a[0]) * d) / L), r1(a[1] + ((b[1] - a[1]) * d) / L), row.s ?? 1, row.kind || "palm"])
  }
  // trees.clear: areas (rect/poly) where no tree stands (a reference pack's tree finder can
  // read open lawn as canopy); trees added by hand after it still count
  for (const area of ov.trees?.clear || []) {
    const q = polyOfO(area).map(sh)
    const inside = ([x, z]) => {
      let o = false
      for (let i = 0, j = q.length - 1; i < q.length; j = i++) if (q[i][1] > z !== q[j][1] > z && x < ((q[j][0] - q[i][0]) * (z - q[i][1])) / (q[j][1] - q[i][1]) + q[i][0]) o = !o
      return o
    }
    for (let i = trees.length - 1; i >= 0; i--) if (inside(trees[i]) && !trees[i].keep) trees.splice(i, 1)
  }
  for (const tr of ov.trees?.after || []) {
    const p = sh(P(tr))
    trees.push([r1(p[0]), r1(p[1]), tr.s ?? 1, tr.kind || "palm"])
  }
  for (const add of ob.add || []) {
    const pts = polyOfO(add).map(sh)
    const b = { p: pr(pts), h: add.h || 5.5, k: add.kind || "yes" }
    styleBuilding(b, add)
    if (add.y0) b.y0 = add.y0
    if (add.doors) b.doors = add.doors.map(doorOf)
    if (add.hall) b.hall = 1
    buildings.push(b)
  }
  for (const f of ov.fences?.add || []) fences.push({ k: f.kind || "fence", p: pr(f.line.map((p) => sh(P(p)))), h: f.h })

  // ---------- the halls (indoor venues) ----------
  const halls = hallOvs.map((h, k) => {
    const poly = h.poly || h.rect ? polyOfO(h).map(sh) : hallPolys[k]
    if (!poly) throw new Error(`${v.id}: hall building ${h.building} not found`)
    if (h.poly || h.rect) buildings.push({ p: pr(poly), h: h.height || 9, k: "hall", hall: 1, ...(h.roof ? { r: h.roof } : {}), ...(h.outside ? { c: h.outside } : {}) })
    // (a nearly rectangular building: its rectangle; OSM outlines are a little jagged)
    const mr = minRect(poly)
    const square = mr && Math.abs(area(poly)) / mr.area > 0.9
    const ring = square
      ? [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ].map(([i, j]) => [mr.x + Math.cos(mr.a) * i * (mr.len / 2) - Math.sin(mr.a) * j * (mr.wid / 2), mr.z + Math.sin(mr.a) * i * (mr.len / 2) + Math.cos(mr.a) * j * (mr.wid / 2)])
      : simplify(poly, 0.3, true)
    for (const b of buildings) if (b.hallK === k && square) b.p = pr(ring)
    const hall = { p: pr(ring), h: h.height || 9, wall: h.wall || "#d9d4c8", floor: h.floor || "#3d4552", pads: h.pads || "#1d2f5a", ceiling: h.ceiling || "#c8ccd2", lights: h.lights || "#fff8e8" }
    if (h.door) hall.door = pr([sh(P(h.door))])[0]
    if (h.bar) {
      const b = h.bar
      const p = sh(P(b))
      hall.bar = { x: r1(p[0]), z: r1(p[1]), deg: degOf(b, 0), len: b.len || 10, depth: b.depth || 3, tables: b.tables ?? 6, stools: b.stools ?? 8, tv: b.tv ?? 3, raised: b.raised ?? 0, color: b.color || "#6b4a2b" }
    }
    if (h.extra) hall.extra = h.extra
    for (const b of buildings) if (b.hallK === k) b.h = hall.h
    if (h.doorW) hall.doorW = h.doorW
    // more doors: to the street, to the next hall (a door on a shared wall opens both)
    if (h.doors) hall.doors = h.doors.map(doorOf)
    if (h.doorKind) hall.doorKind = h.doorKind
    for (const key of ["padH", "beams", "ducts", "slats", "living", "murals", "lightsStyle", "outside", "wallTex", "padTex", "ceilingStyle", "lightsColor", "trusses", "name"]) if (h[key] !== undefined) hall[key] = h[key]
    // a row of steel columns: from / to in any of the point forms
    if (h.columns) hall.columns = { from: pr([sh(P(h.columns.from))])[0], to: pr([sh(P(h.columns.to))])[0], n: h.columns.n || 4 }
    return hall
  })

  const palettes = []
  const spec = {
    id: v.id,
    name: ov.name || v.id,
    short: ov.short || ov.name || v.id,
    city: ov.city || "",
    indoor: !!ov.indoor,
    access: ov.access || "public",
    note: ov.note || "",
    origin: originLL.map((x) => Math.round(x * 1e6) / 1e6),
    osm_base: raw.osm_base,
    lit: ov.lit ?? courts.some((c) => c.lit),
    live: ov.live || 6,
    colors: ov.colors || {},
    ...(ov.light ? { light: ov.light } : {}),
    ...(ov.groundStyle ? { groundStyle: ov.groundStyle } : {}),
    fence: ov.fence || {},
    backdrop: ov.backdrop || {},
    courts: courts.map((c) => {
      const o = { x: r1(c.x), z: r1(c.z), a: normDeg(c.a), s: c.s[0] }
      if (c.pb) o.pb = c.pb
      if (c.pbLayout) o.pl = c.pbLayout
      if (c.num) o.n = c.num
      if (c.lit) o.lit = 1
      if (c.paint) {
        const key = JSON.stringify(c.paint)
        let k = palettes.findIndex((q) => JSON.stringify(q) === key)
        if (k < 0) k = palettes.push(c.paint) - 1
        o.col = k
      }
      return o
    }),
    palettes,
    extras: (ov.extras || []).map((x) => {
      const p = P(x) ? sh(P(x)) : [0, 0]
      const out = { ...x, x: r1(p[0]), z: r1(p[1]), deg: degOf(x, 0) }
      delete out.en
      delete out.ll
      delete out.xz
      delete out.bearing
      if (x.to) {
        const q = sh(P(x.to))
        out.to = [r1(q[0]), r1(q[1])]
      }
      if (x.poly) out.poly = pr(x.poly.map((pt) => sh(P(pt))))
      if (x.line) out.line = pr(x.line.map((pt) => sh(P(pt))))
      return out
    }),
    buildings,
    areas,
    roads,
    trees,
    fences,
    lamps,
  }
  if (halls.length) spec.halls = halls
  // the room kit: rooms (propkit.js furnishes them by type), and the venue's own props
  if (ov.rooms?.length)
    spec.rooms = ov.rooms.map((r, k) => {
      const out = { id: r.id || `room${k}`, type: r.type || "hall", p: pr(polyOfO(r).map(sh)) }
      for (const key of ["name", "h", "floor", "wall", "ceiling", "wainscot", "furnish", "gender", "accent", "sofa", "chairs", "proshop", "shell", "outside", "roof", "benches", "partition", "top", "floorStyle", "ceilingStyle", "wallTex", "art", "trim", "level", "y", "open"]) if (r[key] !== undefined) out[key] = r[key]
      if (r.doors) out.doors = r.doors.map(doorOf)
      if (r.props) out.props = r.props.flatMap(propsOf)
      return out
    })
  if (ov.props?.length) spec.props = ov.props.flatMap(propsOf)
  // roof-only parts (drawn, not walked into) over a building whose roofStyle is "none": a
  // clubhouse's wings at their own heights; y0 starts a short wall under a raised part
  if (ov.roofs?.length)
    spec.roofs = ov.roofs.map((r) => {
      const out = { p: pr(polyOfO(r).map(sh)), h: r.h }
      styleBuilding(out, r)
      if (r.y0 !== undefined) out.y0 = r.y0
      return out
    })
  // floors above the ground: decks (a rooftop terrace, a mezzanine: a polygon at a height) and
  // the stairs up to them (from the bottom step's middle to the top's, rising y0 -> y1)
  if (ov.decks?.length)
    spec.decks = ov.decks.map((d) => {
      const out = { y: d.y, p: pr(polyOfO(d).map(sh)) }
      for (const key of ["name", "rail", "railColor", "slab", "color"]) if (d[key] !== undefined) out[key] = d[key]
      if (d.openings) out.openings = d.openings.map((o) => [...sh(P(o)).map(r1), o.w || 1.6])
      return out
    })
  if (ov.stairs?.length)
    spec.stairs = ov.stairs.map((s) => {
      const a = sh(P(s.from))
      const b = sh(P(s.to))
      return { a: [r1(a[0]), r1(a[1])], b: [r1(b[0]), r1(b[1])], w: s.w || 1.6, y0: s.y0 || 0, y1: s.y1, ...(s.color ? { color: s.color } : {}), ...(s.rail ? { rail: s.rail } : {}) }
    })
  if (ov.spawn) {
    const p = sh(P(ov.spawn))
    spec.spawn = { x: r1(p[0]), z: r1(p[1]), deg: ov.spawn.deg ?? null }
  }
  if (ov.liveCourts) spec.liveCourts = ov.liveCourts
  if (ov.gates) spec.gates = ov.gates
  // the real surroundings (docs/venue-provenance.md): mapped buildings, parks, golf, roads, rails
  // and trees out to ~450 m beyond the crop (surround.mjs), and the terrain's skyline from free
  // elevation tiles (horizon.py). Nothing made up: what isn't mapped isn't drawn.
  const surround = buildSurround({ id: v.id, proj, sh, box, cropIds: new Set(els.map((e) => e.id)), defaultTree: ov.trees?.default === "palm" ? "palm" : "broadleaf" })
  if (surround) spec.surround = surround
  const hzPath = path.join(HERE, "horizon", `${v.id}.json`)
  if (fs.existsSync(hzPath)) {
    const hz = JSON.parse(fs.readFileSync(hzPath, "utf8"))
    spec.horizon = { ground: hz.ground, eye: hz.eye, groups: hz.groups, src: hz.source }
  }
  return spec
}

// ---------- run ----------
const ids = process.argv.slice(2)
fs.mkdirSync(OUT, { recursive: true })
const { generateVenue } = await import(pathToFileURL(path.join(PARK, "venuegen.js")).href)
const { RIVERSIDE_LAYOUT } = await import(pathToFileURL(path.join(PARK, "layout.js")).href)
const index = []
const server = { riverside: { courts: RIVERSIDE_LAYOUT.COURTS.length, bounds: RIVERSIDE_LAYOUT.BOUNDS } }
for (const v of CONFIG.venues) {
  const file = path.join(OUT, `${v.id}.json`)
  let spec
  if (!ids.length || ids.includes(v.id)) {
    spec = buildOne(v)
    // (the courts the generator had to swap out: saved, so the browser skips that check)
    const ex = generateVenue(spec).info.exclude
    if (ex.length) spec.genExclude = ex
    fs.writeFileSync(file, JSON.stringify(spec))
  } else spec = JSON.parse(fs.readFileSync(file, "utf8"))
  // (the generator, as the browser runs it: how many courts have live games, the walkable bounds)
  const gen = generateVenue(spec, spec.genExclude ? { exclude: spec.genExclude, noCheck: true } : {})
  const b = gen.layoutSpec.bounds
  server[v.id] = { courts: gen.layoutSpec.courts.length, bounds: { x0: Math.floor(b.x0), x1: Math.ceil(b.x1), z0: Math.floor(b.z0), z1: Math.ceil(b.z1) } }
  const pb = spec.courts.filter((c) => c.s === "p").length + spec.courts.reduce((s, c) => s + (c.pb || 0), 0)
  index.push({ id: v.id, name: spec.name, short: spec.short, city: spec.city, indoor: spec.indoor, access: spec.access, lat: spec.origin?.[0], lon: spec.origin?.[1], lit: !!spec.lit || !!spec.indoor, courts: pb, tennis: spec.courts.filter((c) => c.s === "t").length, live: gen.layoutSpec.courts.length, kb: Math.round(JSON.stringify(spec).length / 102.4) / 10 })
  console.log(`${v.id}: ${spec.courts.length} courts (${pb} pickleball), ${spec.buildings.length} buildings, ${spec.trees.length} trees, ${gen.layoutSpec.courts.length} live, ${index[index.length - 1].kb} KB`)
}
// the picker's list (small, bundled) and lazy loaders for the specs
const lines = [
  "// Generated by tools/venues/build-venues.mjs: the real venues My Park can load (each spec lazy-loaded).",
  "// Venue data © OpenStreetMap contributors (ODbL 1.0), with 98ish corrections.",
  `export const VENUE_LIST = ${JSON.stringify(index, null, 2)}`,
  "export const loadVenueSpec = (id) => {",
  "  switch (id) {",
  ...CONFIG.venues.map((v) => `    case ${JSON.stringify(v.id)}:\n      return import("./${v.id}.json").then((m) => m.default || m)`),
  "    default:",
  "      return Promise.resolve(null)",
  "  }",
  "}",
  "",
]
fs.writeFileSync(path.join(OUT, "index.js"), lines.join("\n"))
fs.writeFileSync(SERVER_OUT, JSON.stringify(server, null, 2) + "\n")
console.log("wrote", path.relative(ROOT, path.join(OUT, "index.js")), "and", path.relative(ROOT, SERVER_OUT))
