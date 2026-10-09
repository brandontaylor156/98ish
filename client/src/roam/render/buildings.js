// Roam: the mapped buildings as geometry (plain arrays; three.js only for its triangulator).
// Node-tested (roam.test.js: heights, walls facing out, roofs facing up).
//
// Each footprint is pushed up to its real height (the map's height or levels; otherwise a
// default by kind, data/tile.js buildingHeight), standing on the lowest ground under it with
// its walls sunk a little into the slope. Roof hints: a near-rectangular house gets a hipped
// roof (gabled when the map says so) over its outline's rectangle; everything else is flat.
// Far away (far: true) every building is a plain block and small sheds are skipped.
//
// Materials (docs/open-world.md "Buildings"): each vertex carries `win` = (u, v, style, surface):
// on walls u = metres along the wall, v = metres up from the ground; on pitched roofs u = metres
// along the ridge, v = metres up the slope (so the tile rows run along the eaves). style: 0 no
// windows, 1 a house's, 2 a shop's storefront, 3 rows of them on tall buildings, plus a
// per-building fraction (0..0.9) the shader uses to vary them. surface: SURF below.

import { ShapeUtils, Vector2 } from "three"
import { BUILDING_KINDS, ROOF_SHAPES, isHouse } from "../data/tile.js"
import { AWNINGS, ROOFS, WALLS } from "./paint.js"
import { hashStr } from "../sim/parked.js"

const SINK = 0.8
// what a surface is made of (the shader's textures: tilemesh.js)
export const SURF = { stucco: 0, panel: 1, tile: 2, shingle: 3, flat: 4 }
// a building's walls and roof by its kind and a hash (SoCal: stucco houses with clay tile or
// composition shingle roofs; shops and offices stucco; works, warehouses and big boxes
// concrete tilt-up panels; flat roofs gravel/membrane)
export const materialOf = (b, h = 0) => {
  const name = BUILDING_KINDS[b.kind]
  const house = isHouse(b.kind)
  const works = ["industrial", "warehouse", "service", "garages", "parking", "supermarket"].includes(name) || (!house && b.area > 2500 && !isOffice(b))
  const wall = works ? SURF.panel : SURF.stucco
  const roof = house ? ((h >>> 4) % 4 === 0 ? SURF.shingle : SURF.tile) : SURF.flat
  return { wall, roof }
}
const pick = (list, h) => list[(((h | 0) % list.length) + list.length) % list.length] // (h may be negative after a shift)

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

// an office (mapped as one, or a commercial block of two storeys or more): ribbon windows of dark
// glass on white walls, like the owner's photo of a Valencia business park
export const isOffice = (b) => {
  const name = BUILDING_KINDS[b.kind]
  return name === "office" || (name === "commercial" && b.height >= 6.5) || (name === "yes" && b.height >= 7 && b.area > 600 && b.area < 6000)
}

const colorOf = (b, key, h = hashStr(key)) => {
  const name = BUILDING_KINDS[b.kind]
  const house = isHouse(b.kind)
  const works = ["industrial", "warehouse", "service", "garages"].includes(name)
  const civic = ["school", "church", "civic", "public", "library", "university", "college", "hospital", "fire_station"].includes(name)
  const office = isOffice(b)
  const wall = pick(house ? WALLS.house : works ? WALLS.works : civic ? WALLS.civic : office ? WALLS.office : WALLS.shop, h)
  const roof = house ? pick((h >>> 4) % 4 === 0 ? ROOFS.shingle : ROOFS.tile, h >>> 6) : pick(ROOFS.flat, h >>> 6)
  return { wall, roof }
}

// buildings: decoded (data/tile.js); groundAt(x, z) -> m. -> { position, normal, color, count }
export const buildingArrays = (buildings, groundAt, { far = false, key = "" } = {}) => {
  const P = []
  const N = []
  const C = []
  const Wn = [] // (u, v, style, surface): see the top
  const Wt = [] // the wall's height above its ground (m): the shader's base trim and parapet
  let wallTop = 0
  let win = null // (set per wall quad)
  let roofUV = null // (set per pitched roof: its box and eave height)
  let surf = 0
  const push = (x, y, z, nx, ny, nz, col, k = 1) => {
    if (win) {
      const u = win.u0 + (win.u1 - win.u0) * (Math.abs(x - win.ax) + Math.abs(z - win.az) > 1e-6 ? 1 : 0)
      Wn.push(u, y - win.g, win.style, surf)
    } else if (roofUV) {
      const { box, eave, slope } = roofUV
      const u = (x - box.cx) * box.ux + (z - box.cz) * box.uz
      Wn.push(u, (y - eave) * slope, 0, surf)
    } else Wn.push(x, z, 0, surf)
    P.push(x, y, z)
    Wt.push(wallTop)
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
    const hb = hashStr(`${key}:${bi}`)
    const { wall, roof } = colorOf(b, "", hb)
    const mat = materialOf(b, hb)
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
    // (windows: houses a few, shops storefronts, tall ones rows; sheds, works and roofs none)
    const tall = b.height >= 10 || ["apartments", "office", "hotel", "hospital", "university", "college"].includes(name)
    const office = isOffice(b)
    const style0 = name === "parking" && !roofOnly && b.height >= 5 ? 4 : roofOnly || b.height < 2.8 || ["garage", "garages", "shed", "carport", "industrial", "warehouse", "service", "roof", "parking"].includes(name) ? 0 : tall || office ? 3 : isHouse(b.kind) ? 1 : 2
    // (an office: ribbon windows (0.45-0.75) or now and then a curtain wall, never punched)
    const frac = office && style0 === 3 ? 0.46 + ((hb >>> 9) % 28) / 100 + ((hb >>> 13) % 6 === 0 ? 0.3 : 0) : ((hb >>> 9) % 90) / 100
    const style = style0 ? style0 + Math.min(0.9, frac) : 0
    wallTop = roofOnly ? 0 : (pitched ? top - pitched.rise : top) - ground
    let perim = 0
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
      const len = Math.hypot(q.x - p.x, q.z - p.z)
      win = { ax: p.x, az: p.z, u0: perim, u1: perim + len, g: ground, style }
      perim += len
      surf = mat.wall
      if (pitched && eave - bottom > 1.6) {
        // (the eaves' shade: the top 0.6 m of the wall under the overhang darker)
        const m0 = [p.x, eave - 0.6, p.z]
        const m1 = [q.x, eave - 0.6, q.z]
        tri(a0, b0, m1, nrm, wall, [lowK, lowK, 1])
        tri(a0, m1, m0, nrm, wall, [lowK, 1, 1])
        tri(m0, m1, b1, nrm, wall, [1, 1, 0.7])
        tri(m0, b1, a1, nrm, wall, [1, 0.7, 0.7])
      } else {
        tri(a0, b0, b1, nrm, wall, [lowK, lowK, 1])
        tri(a0, b1, a1, nrm, wall, [lowK, 1, 1])
      }
      win = null
    }
    // (only walls carry their height: roofs, eaves and awnings get no trim)
    wallTop = 0
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
      // (roof coordinates: along the ridge, and up the slope from the eave)
      roofUV = { box, eave, slope: Math.hypot(W, rise) / rise }
      surf = mat.roof
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
        roofUV = null
        surf = mat.wall
        out(c4, c1, r1, -box.ux, -box.uz)
        out(c2, c3, r2, box.ux, box.uz)
      } else {
        up(c4, c1, r1)
        up(c2, c3, r2)
      }
      roofUV = null
      // the eaves: a white fascia board round the overhang's edge and the soffit under it, so
      // the roof has thickness instead of reading as a sheet
      surf = mat.wall
      const FASCIA = 0xf1ede4
      const fd = 0.2
      const corners = [c1, c2, c3, c4]
      const inner = [at(-box.hl, -box.hw, eave - fd), at(box.hl, -box.hw, eave - fd), at(box.hl, box.hw, eave - fd), at(-box.hl, box.hw, eave - fd)]
      for (let k = 0; k < 4; k++) {
        const a = corners[k]
        const bq = corners[(k + 1) % 4]
        const a0 = [a[0], eave - fd, a[2]]
        const b0 = [bq[0], eave - fd, bq[2]]
        // (out from the house's middle)
        const mx = (a[0] + bq[0]) / 2 - box.cx
        const mz = (a[2] + bq[2]) / 2 - box.cz
        const f = faceN(a0, b0, bq)
        if (f[0] * mx + f[2] * mz < 0) {
          tri(a0, bq, b0, [-f[0], -f[1], -f[2]], FASCIA)
          tri(a0, a, bq, [-f[0], -f[1], -f[2]], FASCIA)
        } else {
          tri(a0, b0, bq, f, FASCIA)
          tri(a0, bq, a, f, FASCIA)
        }
        // the soffit: from the fascia's foot in to the wall line, facing down (in shade)
        const i0 = inner[k]
        const i1 = inner[(k + 1) % 4]
        const g = faceN(a0, b0, i1)
        if (g[1] > 0) {
          tri(a0, i1, b0, [0, -1, 0], wall, [0.72, 0.72, 0.72])
          tri(a0, i0, i1, [0, -1, 0], wall, [0.72, 0.72, 0.72])
        } else {
          tri(a0, b0, i1, [0, -1, 0], wall, [0.72, 0.72, 0.72])
          tri(a0, i1, i0, [0, -1, 0], wall, [0.72, 0.72, 0.72])
        }
      }
    } else {
      surf = mat.roof
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
        surf = mat.wall
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
    // shop awnings: over the storefronts of a shop's longer walls, every other bay (about half
    // the shops have them; a material, like the windows: canvas over the glass)
    if (!far && style0 === 2 && !mat.wall && (hb >>> 17) % 2 === 0 && eave - ground >= 4) {
      const col = AWNINGS[(hb >>> 19) % AWNINGS.length]
      surf = SURF.stucco
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i]
        const q = ring[(i + 1) % ring.length]
        const len = Math.hypot(q.x - p.x, q.z - p.z)
        if (len < 7) continue
        const fx = (q.x - p.x) / len
        const fz = (q.z - p.z) / len
        // (out of the building: the wall's normal; the ring is wound so that is (-fz, fx))
        const ox = -fz
        const oz = fx
        const bays = Math.floor(len / 6)
        for (let k = 0; k < bays; k++) {
          if ((k + (hb >>> 3)) % 2) continue
          const s0 = (len - bays * 6) / 2 + k * 6 + 0.7
          const s1 = s0 + 4.6
          const hi = ground + 3.15
          const lo = ground + 2.7
          const out = 1.15
          const A = [p.x + fx * s0, hi, p.z + fz * s0]
          const B = [p.x + fx * s1, hi, p.z + fz * s1]
          const C2 = [B[0] + ox * out, lo, B[2] + oz * out]
          const D = [A[0] + ox * out, lo, A[2] + oz * out]
          const up = faceN(A, B, C2)
          if (up[1] < 0) tri(A, C2, B, [-up[0], -up[1], -up[2]], col)
          else tri(A, B, C2, up, col)
          if (up[1] < 0) tri(A, D, C2, [-up[0], -up[1], -up[2]], col)
          else tri(A, C2, D, up, col)
          // (the valance: a short drop at the front, a little darker)
          const D2 = [D[0], lo - 0.28, D[2]]
          const C3 = [C2[0], lo - 0.28, C2[2]]
          const fn = [ox, 0, oz]
          tri(D, C2, C3, fn, col, [0.8, 0.8, 0.8])
          tri(D, C3, D2, fn, col, [0.8, 0.8, 0.8])
        }
      }
    }
    n++
  }
  return { position: new Float32Array(P), normal: new Float32Array(N), color: new Float32Array(C), win: new Float32Array(Wn), wtop: new Float32Array(Wt), count: n }
}

// the outlines that are walls (for collisions): -> [{ ring, top, solid }]
export const wallRings = (buildings, groundAt) =>
  buildings.map((b) => {
    const name = BUILDING_KINDS[b.kind]
    let ground = Infinity
    for (const p of b.ring) ground = Math.min(ground, groundAt(p.x, p.z))
    return { ring: b.ring, top: (Number.isFinite(ground) ? ground : 0) + Math.max(2.4, b.height), solid: !(name === "roof" || name === "carport" || b.min > 0) }
  })
