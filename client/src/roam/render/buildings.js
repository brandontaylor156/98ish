// Roam: the mapped buildings as geometry (plain arrays; three.js only for its triangulator).
// Node-tested (roam.test.js: heights, walls facing out, roofs facing up).
//
// Each footprint is pushed up to its real height (the map's height or levels; otherwise a
// default by kind, data/tile.js buildingHeight), standing on the lowest ground under it with
// its walls sunk a little into the slope. Roof hints: a near-rectangular house gets a hipped
// roof (gabled when the map says so) over its outline's rectangle; everything else is flat.
// Far away (far: true) every building is a plain block and small sheds are skipped.

import { ShapeUtils, Vector2 } from "three"
import { BUILDING_KINDS, ROOF_SHAPES, isHouse } from "../data/tile.js"
import { ROOFS, WALLS } from "./paint.js"
import { hashStr } from "../sim/parked.js"

const SINK = 0.8
const pick = (list, h) => list[h % list.length]

// the smallest rectangle round a ring -> { cx, cz, ux, uz, hl, hw, area } (u: the long axis)
export const orientedBox = (ring) => {
  let best = null
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    const L = Math.hypot(b.x - a.x, b.z - a.z)
    if (L < 0.5) continue
    const ux = (b.x - a.x) / L
    const uz = (b.z - a.z) / L
    let u0 = Infinity
    let u1 = -Infinity
    let v0 = Infinity
    let v1 = -Infinity
    for (const p of ring) {
      const u = p.x * ux + p.z * uz
      const v = -p.x * uz + p.z * ux
      if (u < u0) u0 = u
      if (u > u1) u1 = u
      if (v < v0) v0 = v
      if (v > v1) v1 = v
    }
    const area = (u1 - u0) * (v1 - v0)
    if (!best || area < best.area) best = { ux, uz, u0, u1, v0, v1, area }
  }
  if (!best) return null
  let { ux, uz, u0, u1, v0, v1 } = best
  // (u along the longer side)
  if (v1 - v0 > u1 - u0) {
    ;[ux, uz] = [-uz, ux]
    ;[u0, u1, v0, v1] = [v0, v1, -u1, -u0]
  }
  const cu = (u0 + u1) / 2
  const cv = (v0 + v1) / 2
  return { cx: cu * ux - cv * uz, cz: cu * uz + cv * ux, ux, uz, hl: (u1 - u0) / 2, hw: (v1 - v0) / 2, area: best.area }
}

const signedArea = (ring) => {
  let a = 0
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]
    const q = ring[(i + 1) % ring.length]
    a += p.x * q.z - q.x * p.z
  }
  return a / 2
}

const colorOf = (b, key) => {
  const name = BUILDING_KINDS[b.kind]
  const h = hashStr(key)
  const house = isHouse(b.kind)
  const works = ["industrial", "warehouse", "service", "garages"].includes(name)
  const civic = ["school", "church", "civic", "public", "library", "university", "college", "hospital", "fire_station"].includes(name)
  const wall = pick(house ? WALLS.house : works ? WALLS.works : civic ? WALLS.civic : WALLS.shop, h)
  const roof = house ? pick((h >> 4) % 4 === 0 ? ROOFS.shingle : ROOFS.tile, h >> 6) : pick(ROOFS.flat, h >> 6)
  return { wall, roof }
}

// buildings: decoded (data/tile.js); groundAt(x, z) -> m. -> { position, normal, color, count }
export const buildingArrays = (buildings, groundAt, { far = false, key = "" } = {}) => {
  const P = []
  const N = []
  const C = []
  const push = (x, y, z, nx, ny, nz, col, k = 1) => {
    P.push(x, y, z)
    N.push(nx, ny, nz)
    C.push((((col >> 16) & 255) / 255) * k, (((col >> 8) & 255) / 255) * k, ((col & 255) / 255) * k)
  }
  const tri = (a, b, c, n, col, k = [1, 1, 1]) => {
    push(a[0], a[1], a[2], n[0], n[1], n[2], col, k[0])
    push(b[0], b[1], b[2], n[0], n[1], n[2], col, k[1])
    push(c[0], c[1], c[2], n[0], n[1], n[2], col, k[2])
  }
  const faceN = (a, b, c) => {
    const ux = b[0] - a[0]
    const uy = b[1] - a[1]
    const uz = b[2] - a[2]
    const vx = c[0] - a[0]
    const vy = c[1] - a[1]
    const vz = c[2] - a[2]
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    const l = Math.hypot(nx, ny, nz) || 1
    return [nx / l, ny / l, nz / l]
  }
  let n = 0
  for (let bi = 0; bi < buildings.length; bi++) {
    const b = buildings[bi]
    if (far && b.area < 50) continue
    let ring = b.ring
    if (ring.length < 3) continue
    // (one winding: clockwise seen from above, so each wall's outside is on its left... see below)
    if (signedArea(ring) > 0) ring = ring.slice().reverse()
    let ground = Infinity
    for (const p of ring) ground = Math.min(ground, groundAt(p.x, p.z))
    if (!Number.isFinite(ground)) ground = 0
    const { wall, roof } = colorOf(b, `${key}:${bi}`)
    const name = BUILDING_KINDS[b.kind]
    const roofOnly = name === "roof" || name === "carport" || b.min > 0
    const top = ground + Math.max(2.4, b.height)
    const bottom = roofOnly ? top - 0.5 : ground - SINK
    // a hipped (or gabled) roof on a near-rectangular house
    let pitched = null
    if (!far && !roofOnly && isHouse(b.kind) && b.area < 700 && b.area > 25) {
      const shape = ROOF_SHAPES[b.roof]
      if (shape === "" || shape === "hipped" || shape === "gabled" || shape === "half-hipped") {
        const box = orientedBox(ring)
        if (box && b.area / box.area > 0.8) pitched = { box, gabled: shape === "gabled", rise: Math.min(2.4, Math.max(1.1, box.hw * 0.55)) }
      }
    }
    const eave = pitched ? top - pitched.rise : top
    // walls (each edge a quad; ring clockwise from above -> (a, b, a_top) faces out)
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i]
      const q = ring[(i + 1) % ring.length]
      const a0 = [p.x, bottom, p.z]
      const b0 = [q.x, bottom, q.z]
      const a1 = [p.x, eave, p.z]
      const b1 = [q.x, eave, q.z]
      const nrm = faceN(a0, b0, b1)
      // (a little darker at the foot: contact shade)
      const lowK = roofOnly ? 1 : 0.8
      tri(a0, b0, b1, nrm, wall, [lowK, lowK, 1])
      tri(a0, b1, a1, nrm, wall, [lowK, 1, 1])
    }
    // the roof
    if (pitched) {
      const { box, gabled, rise } = pitched
      const o = 0.35 // overhang
      const L = box.hl + o
      const W = box.hw + o
      const at = (u, v, y) => [box.cx + box.ux * u - box.uz * v, y, box.cz + box.uz * u + box.ux * v]
      const r = gabled ? L : Math.max(0, L - W)
      const c1 = at(-L, -W, eave)
      const c2 = at(L, -W, eave)
      const c3 = at(L, W, eave)
      const c4 = at(-L, W, eave)
      const r1 = at(-r, 0, top)
      const r2 = at(r, 0, top)
      const up = (a, bb, c) => {
        const f = faceN(a, bb, c)
        if (f[1] < 0) tri(a, c, bb, [-f[0], -f[1], -f[2]], roof)
        else tri(a, bb, c, f, roof)
      }
      // the two long slopes
      up(c1, c2, r2)
      up(c1, r2, r1)
      up(c3, c4, r1)
      up(c3, r1, r2)
      if (gabled) {
        // (gable ends: wall-coloured triangles facing out along the ridge)
        const out = (a, bb, c, dx, dz) => {
          const f = faceN(a, bb, c)
          if (f[0] * dx + f[2] * dz < 0) tri(a, c, bb, [-f[0], -f[1], -f[2]], wall)
          else tri(a, bb, c, f, wall)
        }
        out(c4, c1, r1, -box.ux, -box.uz)
        out(c2, c3, r2, box.ux, box.uz)
      } else {
        up(c4, c1, r1)
        up(c2, c3, r2)
      }
      // (the soffit isn't drawn: seen from the street the eaves read from the slopes alone)
    } else {
      const contour = ring.map((p) => new Vector2(p.x, p.z))
      let faces
      try {
        faces = ShapeUtils.triangulateShape(contour, [])
      } catch {
        faces = []
      }
      for (const [i, j, k] of faces) {
        const a = [ring[i].x, top, ring[i].z]
        const bb = [ring[j].x, top, ring[j].z]
        const c = [ring[k].x, top, ring[k].z]
        const f = faceN(a, bb, c)
        if (f[1] < 0) tri(a, c, bb, [0, 1, 0], roof)
        else tri(a, bb, c, [0, 1, 0], roof)
      }
      if (roofOnly) {
        // (an underside, seen from below)
        for (const [i, j, k] of faces) {
          const a = [ring[i].x, bottom, ring[i].z]
          const bb = [ring[j].x, bottom, ring[j].z]
          const c = [ring[k].x, bottom, ring[k].z]
          const f = faceN(a, bb, c)
          if (f[1] > 0) tri(a, c, bb, [0, -1, 0], wall, [0.7, 0.7, 0.7])
          else tri(a, bb, c, [0, -1, 0], wall, [0.7, 0.7, 0.7])
        }
      }
    }
    n++
  }
  return { position: new Float32Array(P), normal: new Float32Array(N), color: new Float32Array(C), count: n }
}

// the outlines that are walls (for collisions): -> [{ ring, top, solid }]
export const wallRings = (buildings, groundAt) =>
  buildings.map((b) => {
    const name = BUILDING_KINDS[b.kind]
    let ground = Infinity
    for (const p of b.ring) ground = Math.min(ground, groundAt(p.x, p.z))
    return { ring: b.ring, top: (Number.isFinite(ground) ? ground : 0) + Math.max(2.4, b.height), solid: !(name === "roof" || name === "carport" || b.min > 0) }
  })
