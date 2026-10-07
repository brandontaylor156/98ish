// The real surroundings of a venue for its spec (`surround`), from osm/<id>.surround.json
// (fetch-surround.mjs): only what is mapped, only outside the walkable crop, nothing invented.
//   buildings: [{ p, h, g? }]   h from height=, else building:levels x 3.2 m + 0.6; g: 1 marks a
//                               modest default height by building type (no height mapped)
//   areas:     [{ k, p }]      parks, golf (fairway, green, bunker, tee), woods, water, grass
//   roads:     [{ k, w, p }]   the bigger roads (motorway .. tertiary), flat
//   rails:     [{ p, bridge }] rail lines; bridges become a deck on columns (SMASH's Metro viaduct)
//   trees:     [[x, z, s, kind]] mapped single trees and tree rows (a tree every 8 m along a row)
// Data © OpenStreetMap contributors, ODbL 1.0.

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const r1 = (v) => Math.round(v * 10) / 10
const pr = (pts) => pts.map(([x, z]) => [r1(x), r1(z)])
// how far out (m from the courts' middle): the park's fog is solid past ~390 m
export const SURROUND_KEEP = 450
const DEFAULT_H = { house: 5, detached: 5, residential: 6, garage: 3, garages: 3, shed: 2.5, roof: 3.5, apartments: 10, school: 5, industrial: 7, warehouse: 8, commercial: 6.5, retail: 6, office: 9, hotel: 12, church: 8, yes: 5 }
const ROADS = { motorway: 22, trunk: 16, primary: 14, secondary: 11, tertiary: 8, motorway_link: 7, trunk_link: 7 }

const simplify = (pts, tol) => {
  if (pts.length < 4) return pts
  const keep = [pts[0]]
  for (let i = 1; i < pts.length - 1; i++) {
    const a = keep[keep.length - 1]
    const b = pts[i]
    const c = pts[i + 1]
    const L = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1
    if (Math.abs((c[0] - a[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (c[1] - a[1])) / L > tol) keep.push(b)
  }
  keep.push(pts[pts.length - 1])
  return keep.length >= 3 ? keep : pts
}
const dropClosing = (pts) => (pts.length > 2 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1] ? pts.slice(0, -1) : pts)
const heightOf = (t) => {
  const h = parseFloat(String(t.height || "").replace(",", "."))
  if (Number.isFinite(h) && h > 1 && h < 200) return { h }
  const lv = parseFloat(t["building:levels"])
  if (Number.isFinite(lv) && lv > 0 && lv < 60) return { h: lv * 3.2 + 0.6 }
  return { h: DEFAULT_H[t.building] ?? DEFAULT_H.yes, g: 1 }
}
const areaKind = (t) => {
  if (t.golf === "bunker") return "bunker"
  if (t.golf === "green" || t.golf === "tee") return "green"
  if (t.golf === "fairway") return "fairway"
  if (t.golf === "water_hazard" || t.golf === "lateral_water_hazard" || t.natural === "water" || t.natural === "wetland") return "water"
  if (t.golf === "rough" || t.leisure === "golf_course") return "golf"
  if (t.natural === "wood" || t.landuse === "forest" || t.landuse === "orchard") return "wood"
  if (t.natural === "scrub") return "scrub"
  if (t.natural === "beach" || t.natural === "sand") return "sand"
  if (t.leisure === "pitch") return "pitch"
  if (t.leisure || t.landuse || t.natural === "grassland") return "grass"
  return null
}
// paint order: big base areas first, details on top
const AREA_ORDER = ["grass", "golf", "scrub", "wood", "sand", "pitch", "fairway", "green", "bunker", "water"]

export const buildSurround = ({ id, proj, sh, box, cropIds, defaultTree = "broadleaf" }) => {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "osm", `${id}.surround.json`)
  if (!fs.existsSync(file)) return null
  const raw = JSON.parse(fs.readFileSync(file, "utf8"))
  const inBox = ([x, z]) => x >= box.x0 && x <= box.x1 && z >= box.z0 && z <= box.z1
  const near = (pts) => pts.some(([x, z]) => Math.hypot(x, z) < SURROUND_KEEP)
  const out = { buildings: [], areas: [], roads: [], rails: [], trees: [] }
  const rings = (e) => (e.g ? [dropClosing(e.g.map(proj.xz).map(sh))] : (e.m || []).filter((m) => m.role !== "inner").map((m) => dropClosing(m.g.map(proj.xz).map(sh))))
  for (const e of raw.elements) {
    const t = e.tags
    // (buildings and trees the crop already draws are skipped; areas run on under the crop's ground)
    if (cropIds.has(e.id) && (t.building || e.p || t.natural === "tree_row")) continue
    if (e.p) {
      if (t.natural !== "tree") continue
      const p = sh(proj.xz(e.p))
      if (inBox(p) || Math.hypot(p[0], p[1]) > SURROUND_KEEP) continue
      out.trees.push([r1(p[0]), r1(p[1]), 1, t.leaf_type === "needleleaved" ? "conifer" : defaultTree])
      continue
    }
    if (t.building) {
      for (const ring of rings(e)) {
        if (ring.length < 3 || ring.some(inBox) || !near(ring)) continue
        const { h, g } = heightOf(t)
        out.buildings.push({ p: pr(simplify(ring, 0.6)), h: r1(h), ...(g ? { g } : {}) })
      }
      continue
    }
    if (t.natural === "tree_row" && e.g) {
      const pts = e.g.map(proj.xz).map(sh)
      for (let i = 0; i + 1 < pts.length; i++) {
        const [a, b] = [pts[i], pts[i + 1]]
        const L = Math.hypot(b[0] - a[0], b[1] - a[1])
        for (let s = 0; s < L; s += 8) {
          const p = [a[0] + ((b[0] - a[0]) * s) / L, a[1] + ((b[1] - a[1]) * s) / L]
          if (!inBox(p) && Math.hypot(p[0], p[1]) < SURROUND_KEEP) out.trees.push([r1(p[0]), r1(p[1]), 1, defaultTree])
        }
      }
      continue
    }
    if (t.railway && e.g) {
      const pts = e.g.map(proj.xz).map(sh)
      if (near(pts)) out.rails.push({ p: pr(simplify(pts, 0.5)), ...(t.bridge && t.bridge !== "no" ? { bridge: 1 } : {}), ...(t.layer ? { layer: +t.layer || 1 } : {}) })
      continue
    }
    if (t.highway && e.g) {
      const pts = e.g.map(proj.xz).map(sh)
      if (near(pts)) out.roads.push({ k: t.highway, w: ROADS[t.highway] || 8, p: pr(simplify(pts, 0.8)) })
      continue
    }
    const k = areaKind(t)
    if (k)
      for (const ring of rings(e)) {
        if (ring.length < 3 || !near(ring)) continue
        out.areas.push({ k, p: pr(simplify(ring, 1)) })
      }
  }
  out.areas.sort((a, b) => AREA_ORDER.indexOf(a.k) - AREA_ORDER.indexOf(b.k))
  for (const k of Object.keys(out)) if (!out[k].length) delete out[k]
  out.src = `OpenStreetMap (ODbL), ${raw.osm_base || "?"}`
  return out
}
