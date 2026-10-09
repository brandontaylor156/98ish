// My Park: the courts are kept clean (pure; Node-tested in venues.test.js).
//
// The owner (2026-10-09): "Too much shrub and bushes ON the court ... Make sure the courts are
// CLEAN." Nothing green may stand inside or overlap a court, a pen, a court's surround, a
// walkway, a deck, a shade roof or a building, nor within 2 m of a court's outer lines; the
// generated scatter (weed tufts, the hillside's scrub and bushes, leaf litter) never lands on a
// hard surface. Real trees (OSM, the aerial's tree finder) are only dropped when their trunk
// stands in that zone or their crown would hang over a court's playing area.
//
// cleanZone(scene) -> { dirty(x, z, r), overCourt(x, z, r) }: is a thing of radius r at (x, z)
// in the zone that must stay clean (or over a court's lines)?
// vegetationOf(scene, opts) -> the scatter lists the scenery draws (scenery.js uses these),
// already filtered, so the test sees exactly what's drawn.

import { coverGrid } from "./surround.js"

export const COURT_PAD = 2 // m kept clear beyond a court's outer lines
export const FENCE_PAD = 1 // m kept clear either side of a pen's fence
const HARD = new Set(["paved", "concrete", "asphalt", "parking", "deck", "channel", "pool", "planter"])

const inPoly = (x, z, p) => {
  let inside = false
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, zi] = p[i]
    const [xj, zj] = p[j]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}
const segDist = (x, z, ax, az, bx, bz) => {
  const dx = bx - ax
  const dz = bz - az
  const L2 = dx * dx + dz * dz || 1e-9
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2))
  return Math.hypot(ax + dx * t - x, az + dz * t - z)
}
const polyDist = (x, z, p) => {
  let d = Infinity
  for (let i = 0; i < p.length; i++) {
    const a = p[i]
    const b = p[(i + 1) % p.length]
    d = Math.min(d, segDist(x, z, a[0], a[1], b[0], b[1]))
  }
  return d
}
// an oriented rectangle: centre, unit axis u, half sizes along u (hu) and across (hw)
const rect = (cx, cz, ux, uz, hu, hw) => ({ cx, cz, ux, uz, hu, hw, R: Math.hypot(hu, hw) })
const inRect = (q, x, z, r) => {
  const dx = x - q.cx
  const dz = z - q.cz
  if (Math.abs(dx) > q.R + r || Math.abs(dz) > q.R + r) return false
  return Math.abs(dx * q.ux + dz * q.uz) <= q.hu + r && Math.abs(-dx * q.uz + dz * q.ux) <= q.hw + r
}
const bboxOf = (p, pad) => {
  let x0 = Infinity
  let x1 = -Infinity
  let z0 = Infinity
  let z1 = -Infinity
  for (const [x, z] of p) {
    x0 = Math.min(x0, x)
    x1 = Math.max(x1, x)
    z0 = Math.min(z0, z)
    z1 = Math.max(z1, z)
  }
  return { x0: x0 - pad, x1: x1 + pad, z0: z0 - pad, z1: z1 + pad }
}

// a court's rectangle (scenery: PlaneGeometry(W, L) turned by rot about y: L runs along
// (sin rot, cos rot))
const courtRect = (c, pad) => rect(c.x, c.z, Math.sin(c.rot || 0), Math.cos(c.rot || 0), c.L / 2 + pad, c.W / 2 + pad)

// the footprint of an extra that stands over or on the ground (shade roofs, tents, decks ...)
export const extraFootprint = (x) => {
  if (x.poly?.length >= 3) return x.poly
  const w = x.w || (x.type === "canopy" ? 3 : x.type === "gazebo" ? 5 : x.type === "cabana" ? 4 : x.type === "sail" ? 10 : x.type === "solar" ? 30 : x.type === "spine" ? 20 : 0)
  const d = x.d || (x.type === "sail" ? 8 : x.type === "solar" ? 20 : x.type === "spine" ? 5 : x.type === "stands" ? 3.5 : w)
  if (!w) return null
  const a = ((x.deg || 0) * Math.PI) / 180
  const c = Math.cos(-a)
  const s = Math.sin(-a)
  // (scenery: rotation.y = -deg; local (u, v) -> world (u c + v s, -u s + v c))
  return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([u, v]) => [x.x + u * c + v * s, x.z - u * s + v * c])
}
const GROUND_EXTRAS = new Set(["cabana", "gazebo", "canopy", "sail", "solar", "pergola", "shade", "spine", "stands", "umbrellas"])

export const cleanZone = (S, { courtPad = COURT_PAD, fencePad = FENCE_PAD } = {}) => {
  const rects = []
  const lines = (S.courts || []).map((c) => courtRect(c, 0))
  for (const c of S.courts || []) rects.push(courtRect(c, courtPad))
  for (const b of S.banks || []) rects.push(rect(b.cx, b.cz, b.ux, b.uz, b.hx, b.hz))
  const polys = []
  // (hard: a lot, a plaza, a road: no scatter there, but real trees in a lot's islands or a
  // street's tree wells stay)
  const addPoly = (p, pad = 0, hard = false) => p?.length >= 3 && polys.push({ p, pad, hard, bb: bboxOf(p, pad + 6) })
  for (const b of S.buildings || []) addPoly(b.p)
  for (const h of S.halls || []) addPoly(h.p)
  for (const r of S.rooms || []) addPoly(r.p)
  for (const d of S.decks || []) addPoly(d.p, 0.3)
  for (const a of S.areas || []) if (HARD.has(a.k)) addPoly(a.p, 0, true)
  for (const x of S.extras || []) if (GROUND_EXTRAS.has(x.type)) addPoly(extraFootprint(x), 0.3)
  const segs = []
  for (const f of S.fences || []) if (f.k === "chain" || f.part) segs.push({ a: f.a, b: f.b, pad: fencePad })
  for (const r of S.roads || []) {
    const p = r.p || []
    for (let i = 0; i + 1 < p.length; i++) segs.push({ a: p[i], b: p[i + 1], pad: (r.w || 3) / 2, hard: true })
  }
  for (const s of S.stairs || []) segs.push({ a: [s.a.x, s.a.z], b: [s.b.x, s.b.z], pad: (s.w || 1.5) / 2 + 0.3 })
  for (const s of segs) s.bb = bboxOf([s.a, s.b], s.pad + 6)
  const inBB = (bb, x, z, r) => x >= bb.x0 - r && x <= bb.x1 + r && z >= bb.z0 - r && z <= bb.z1 + r
  const dirty = (x, z, r = 0, { trees = false } = {}) => {
    for (const q of rects) if (inRect(q, x, z, r)) return true
    for (const s of segs) if (!trees && inBB(s.bb, x, z, r) && segDist(x, z, s.a[0], s.a[1], s.b[0], s.b[1]) < s.pad + r) return true
    for (const q of polys) {
      if (trees && q.hard) continue
      if (!inBB(q.bb, x, z, r)) continue
      if (inPoly(x, z, q.p)) return true
      if (q.pad + r > 0 && polyDist(x, z, q.p) < q.pad + r) return true
    }
    return false
  }
  // (a tree's crown over a court's lines, or a pen: real trees there would have been cut back)
  const overCourt = (x, z, r = 0) => lines.some((q) => inRect(q, x, z, r + 1))
  return { dirty, overCourt }
}

// how wide a tree's crown is (detail.js models, scaled by s)
export const crownOf = (t) => (t.kind === "palm" || t.kind === "fanpalm" ? 2.2 : t.kind === "pine" || t.kind === "conifer" ? 2.0 : 2.6) * (t.s || 1)

// real trees kept: trunk out of the clean zone, crown not over a court
export const keepTree = (zone, t) => !zone.dirty(t.x, t.z, 0.35, { trees: true }) && !zone.overCourt(t.x, t.z, crownOf(t))

const lcg = (seed) => {
  let sd = seed
  return () => ((sd = (sd * 16807) % 2147483647) / 2147483647)
}

// the hillside's scrub clumps and bushes (terrain-cover.py): only outside the venue's own
// grounds (its bounds and a margin: inside them the park is what OSM and the photos show,
// mown and kept), never on anything in the clean zone. -> { shrubs: [[x, z, s]], bushes: [{ x, z, s, k }] }
export const hillScatter = (S, { bounds = null, detail = true, zone = cleanZone(S) } = {}) => {
  const shrubs = []
  const bushes = []
  const T = S.terrain
  if (!T?.cover) return { shrubs, bushes }
  const B = bounds || S.bounds || null
  const M = 12
  const inGrounds = (x, z) => !!B && x > B.x0 - M && x < B.x1 + M && z > B.z0 - M && z < B.z1 + M
  const { r: r0, cell } = T.cover
  const { rows, dots } = coverGrid(T)
  const rnd = lcg(3)
  for (let j = 0; j < rows.length && shrubs.length < 3000; j++)
    for (let i = 0; i < rows[j].length; i++)
      if (rows[j][i] === "s")
        for (let k = 0; k < 2 + (rnd() < 0.5 ? 1 : 0); k++) {
          const x = -r0 + (i + rnd() - 0.5) * cell
          const z = -r0 + (j + rnd() - 0.5) * cell
          const s = 2 + rnd() * 2.6
          if (!inGrounds(x, z) && !zone.dirty(x, z, s * 0.6)) shrubs.push([x, z, s])
        }
  if (detail && dots) {
    const rb = lcg(17)
    for (let j = 0; j < dots.length && bushes.length < 4500; j++)
      for (let i = 0; i < dots[j].length; i++) {
        const d = dots[j][i]
        for (let k = 0; k < Math.floor(d / 2); k++) {
          const x = -r0 + (i + rb() - 0.5) * cell
          const z = -r0 + (j + rb() - 0.5) * cell
          const s = 0.7 + rb() * 1.1
          const tone = rb()
          if (!inGrounds(x, z) && !zone.dirty(x, z, s)) bushes.push({ x, z, s, k: tone })
        }
      }
  }
  return { shrubs, bushes }
}

// weeds where a parking lot's curb meets the ground, outside the lot only (none along the
// pens' fences: the owner wants the courts clean). edges: [[a, b]] lot outlines.
export const curbTufts = (S, edges, { zone = cleanZone(S), seed = 29 } = {}) => {
  const out = []
  if (S.indoor) return out
  const rand = lcg(seed)
  for (const [[x0, z0], [x1, z1]] of edges) {
    const len = Math.hypot(x1 - x0, z1 - z0)
    if (len < 0.5) continue
    const nx = -(z1 - z0) / len
    const nz = (x1 - x0) / len
    for (let d = rand() * 1.3; d < len && out.length < 4000; d += 1.3 * (0.6 + rand() * 0.8)) {
      const side = rand() < 0.5 ? -1 : 1
      const o = 0.25 * (0.4 + rand() * 0.8) * side
      const t = { x: x0 + ((x1 - x0) * d) / len + nx * o, z: z0 + ((z1 - z0) * d) / len + nz * o, s: 0.6 + rand() * 0.8, r: rand() * Math.PI }
      if (!zone.dirty(t.x, t.z, t.s * 0.35)) out.push(t)
    }
  }
  return out
}

// every green thing a venue draws, for the test: trees (kept), hill scatter, tufts
export const vegetationOf = (S, { bounds = null, detail = true } = {}) => {
  const zone = cleanZone(S)
  const trees = [...(S.trees || []), ...(S.surround?.trees || []).map((t) => ({ x: t[0], z: t[1], s: t[2], kind: t[3] }))].filter((t) => keepTree(zone, t))
  const { shrubs, bushes } = hillScatter(S, { bounds, detail, zone })
  const lots = (S.areas || []).filter((a) => a.k === "parking").map((a) => a.p)
  const edges = lots.flatMap((p) => p.map((a, i) => [a, p[(i + 1) % p.length]]))
  const tufts = curbTufts(S, edges, { zone })
  return { zone, trees, shrubs, bushes, tufts }
}
