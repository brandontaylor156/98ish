// Roam: what's drawn along the roads as geometry (plain arrays; Node-tested): the lane
// markings (US style: double yellow down two-way arterials, white lane dashes, white edge
// lines on freeways) and the bridges' decks with their parapets. The road surfaces themselves
// are painted into the ground's texture (ground.js).

import { DRIVABLE, F, ROAD } from "../data/tile.js"

const YELLOW = 0xe0b43a
const WHITE = 0xe9e9e4

// a road's height at a point along it: its deck on a bridge, else the ground
export const roadHeight = (road, i, k, groundAt, x, z) => (road.deck ? road.deck[i] + (road.deck[i + 1] - road.deck[i]) * k : groundAt(x, z))

const createArrays = () => {
  const P = []
  const N = []
  const C = []
  const quad = (a, b, c, d, col, ny = 1, nx = 0, nz = 0) => {
    const r = ((col >> 16) & 255) / 255
    const g = ((col >> 8) & 255) / 255
    const bl = (col & 255) / 255
    // (wound so the face looks the way of its normal)
    const gx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1])
    const gy = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2])
    const gz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    const order = gx * nx + gy * ny + gz * nz < 0 ? [a, c, b, a, d, c] : [a, b, c, a, c, d]
    for (const v of order) {
      P.push(v[0], v[1], v[2])
      N.push(nx, ny, nz)
      C.push(r, g, bl)
    }
  }
  const done = () => ({ position: new Float32Array(P), normal: new Float32Array(N), color: new Float32Array(C) })
  return { quad, done, get size() {
    return P.length / 3
  } }
}

// a line offset sideways from a road's centre, as a flat strip (dash: [on, off] metres or null)
const strip = (out, road, groundAt, offset, width, col, dash = null, lift = 0.05) => {
  const pts = road.pts
  let phase = 0
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    const L = Math.hypot(b.x - a.x, b.z - a.z)
    if (L < 0.2) continue
    const fx = (b.x - a.x) / L
    const fz = (b.z - a.z) / L
    // (right of the heading: (-fz, fx))
    const rx = -fz
    const rz = fx
    const n = Math.max(1, Math.ceil(L / 4))
    for (let s = 0; s < n; s++) {
      let t0 = (s / n) * L
      let t1 = ((s + 1) / n) * L
      if (dash) {
        // (keep only the "on" part of the pattern inside this piece)
        const period = dash[0] + dash[1]
        const p0 = (phase + t0) % period
        if (p0 >= dash[0]) continue
        t1 = Math.min(t1, t0 + (dash[0] - p0))
      }
      const at = (t, side) => {
        const x = a.x + fx * t + rx * (offset + side * width * 0.5)
        const z = a.z + fz * t + rz * (offset + side * width * 0.5)
        return [x, roadHeight(road, i, t / L, groundAt, x, z) + lift, z]
      }
      out.quad(at(t0, -1), at(t1, -1), at(t1, 1), at(t0, 1), col)
      void t0
      t0 = t1
    }
    phase += L
  }
}

// the markings of a tile's roads -> arrays
export const markingArrays = (roads, groundAt) => {
  const out = createArrays()
  for (const r of roads) {
    if (!DRIVABLE.has(r.cls) || r.flags & F.tunnel) continue
    const big = r.cls === ROAD.primary || r.cls === ROAD.secondary || r.cls === ROAD.tertiary || r.cls === ROAD.trunk
    const free = r.cls === ROAD.motorway || r.cls === ROAD.trunk || r.cls === ROAD.link
    const oneway = !!(r.flags & F.oneway)
    const w = r.width
    if (big && !oneway) {
      // double yellow down the middle
      strip(out, r, groundAt, -0.17, 0.11, YELLOW)
      strip(out, r, groundAt, 0.17, 0.11, YELLOW)
      // lanes each way
      const per = Math.max(1, Math.round((w / 2 - 0.6) / 3.6))
      for (let k = 1; k < per; k++) {
        const off = (w / 2 / per) * k
        strip(out, r, groundAt, off, 0.11, WHITE, [3, 9])
        strip(out, r, groundAt, -off, 0.11, WHITE, [3, 9])
      }
    } else if (oneway && (big || free) && w >= 6) {
      const lanes = Math.max(1, Math.round((w - 1) / 3.6))
      for (let k = 1; k < lanes; k++) strip(out, r, groundAt, -w / 2 + (w / lanes) * k, 0.11, WHITE, [3, 9])
    }
    if (free || ((big || oneway) && w >= 9)) {
      strip(out, r, groundAt, w / 2 - 0.35, 0.12, WHITE)
      strip(out, r, groundAt, -(w / 2 - 0.35), 0.12, oneway ? YELLOW : WHITE)
    }
  }
  return out.done()
}

// bridges: the deck (a slab under the road's width, its sides) and low parapets -> arrays
export const deckArrays = (roads) => {
  const out = createArrays()
  for (const r of roads) {
    if (!r.deck) continue
    const drive = DRIVABLE.has(r.cls)
    const top = drive ? 0x4a4c4f : 0xc6c0b2
    const side = 0xa9a59c
    const hw = r.width / 2 + (drive ? 0.6 : 0.4)
    const pts = r.pts
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i]
      const b = pts[i + 1]
      const L = Math.hypot(b.x - a.x, b.z - a.z)
      if (L < 0.2) continue
      const fx = (b.x - a.x) / L
      const fz = (b.z - a.z) / L
      const rx = -fz
      const rz = fx
      const ya = r.deck[i]
      const yb = r.deck[i + 1]
      const P = (p, s, y) => [p.x + rx * hw * s, y, p.z + rz * hw * s]
      // the deck's surface (its top just under the road's own height: the road is the top)
      out.quad(P(a, -1, ya), P(b, -1, yb), P(b, 1, yb), P(a, 1, ya), top)
      // the slab's sides and underside (0.9 m deep)
      out.quad(P(a, 1, ya), P(b, 1, yb), P(b, 1, yb - 0.9), P(a, 1, ya - 0.9), side, 0, rx, rz)
      out.quad(P(b, -1, yb), P(a, -1, ya), P(a, -1, ya - 0.9), P(b, -1, yb - 0.9), side, 0, -rx, -rz)
      out.quad(P(a, 1, ya - 0.9), P(b, 1, yb - 0.9), P(b, -1, yb - 0.9), P(a, -1, ya - 0.9), side, -1)
      // parapets (0.9 m, both edges; outer faces and tops)
      for (const s of [-1, 1]) {
        const e = hw - 0.12
        const Q = (p, y, k = 0) => [p.x + rx * (e + k) * s, y, p.z + rz * (e + k) * s]
        out.quad(Q(a, ya, 0.12), Q(b, yb, 0.12), Q(b, yb + 0.9, 0.12), Q(a, ya + 0.9, 0.12), side, 0, rx * s, rz * s)
        out.quad(Q(b, yb, -0.12), Q(a, ya, -0.12), Q(a, ya + 0.9, -0.12), Q(b, yb + 0.9, -0.12), side, 0, -rx * s, -rz * s)
        out.quad(Q(a, ya + 0.9, -0.12), Q(b, yb + 0.9, -0.12), Q(b, yb + 0.9, 0.12), Q(a, ya + 0.9, 0.12), side)
      }
    }
  }
  return out.done()
}

// the decks as surfaces to stand or drive on -> [{ ax, az, bx, bz, ha, hb, hw, drive }]
export const deckSurfaces = (roads) => {
  const list = []
  for (const r of roads) {
    if (!r.deck) continue
    for (let i = 0; i + 1 < r.pts.length; i++) list.push({ ax: r.pts[i].x, az: r.pts[i].z, bx: r.pts[i + 1].x, bz: r.pts[i + 1].z, ha: r.deck[i], hb: r.deck[i + 1], hw: r.width / 2 + 0.5, drive: DRIVABLE.has(r.cls) })
  }
  return list
}
// the deck under a point near height y (within a step up or a drop) -> height | null
export const deckAt = (decks, x, z, y, drive = false) => {
  let best = null
  for (const d of decks) {
    if (drive && !d.drive) continue
    const dx = d.bx - d.ax
    const dz = d.bz - d.az
    const L2 = dx * dx + dz * dz || 1e-9
    const t = ((x - d.ax) * dx + (z - d.az) * dz) / L2
    if (t < -0.02 || t > 1.02) continue
    const k = Math.max(0, Math.min(1, t))
    if (Math.hypot(x - d.ax - dx * k, z - d.az - dz * k) > d.hw) continue
    const h = d.ha + (d.hb - d.ha) * k
    if (h > y + 1.3 || h < y - 2.5) continue
    if (best === null || h > best) best = h
  }
  return best
}
