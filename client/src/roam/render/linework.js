// Roam: what's drawn along the roads as geometry (plain arrays; Node-tested): the lane
// markings (US style: double yellow down two-way arterials, white lane dashes, white edge
// lines on freeways) and the bridges' decks with their parapets. The road surfaces themselves
// are painted into the ground's texture (ground.js).

import * as THREE from "three"
import { AREA, DRIVABLE, F, ROAD } from "../data/tile.js"
import { STALL_W, edgeDist, inRing, lotStalls } from "../sim/parked.js"
import { ROAD_ORDER, ROAD_PAINT, SIDEWALK } from "./paint.js"

const YELLOW = 0xe0b43a
const WHITE = 0xf1f1ec
const BLUE = 0x2f62b8
const CURB = 0xcfcbc1
const GUTTER = 0x6b6a66

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
const strip = (out, road, groundAt, offset, width, col, dash = null, lift = 0.1) => {
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
    const n = Math.max(1, Math.ceil(L / 6))
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

// a straight painted line from (ax, az) to (bx, bz), w wide, on the ground
const line = (out, groundAt, ax, az, bx, bz, w, col, lift = 0.07) => {
  const L = Math.hypot(bx - ax, bz - az)
  if (L < 0.05) return
  const rx = (-(bz - az) / L) * w * 0.5
  const rz = ((bx - ax) / L) * w * 0.5
  const P = (x, z) => [x, groundAt(x, z) + lift, z]
  out.quad(P(ax - rx, az - rz), P(bx - rx, bz - rz), P(bx + rx, bz + rz), P(ax + rx, az + rz), col)
}

// the accessible stalls of a lot: the two (three in a big lot) nearest a building's wall within
// 45 m, the way lots by offices and shops are striped -> Set of stall indexes
export const accessibleStalls = (stalls, buildings) => {
  const out = new Set()
  if (!stalls.length || !buildings.length) return out
  const scored = []
  stalls.forEach((st, i) => {
    const f = st.f
    const x = f.ox + f.ux * st.u + f.vx * st.v
    const z = f.oz + f.uz * st.u + f.vz * st.v
    let best = 45
    for (const b of buildings) {
      if (b.area < 200 || Math.abs(b.ring[0].x - x) > 200 || Math.abs(b.ring[0].z - z) > 200) continue
      best = Math.min(best, edgeDist(b.ring, x, z))
    }
    if (best < 45) scored.push([best, i])
  })
  scored.sort((p, q) => p[0] - q[0])
  for (const [, i] of scored.slice(0, stalls.length > 60 ? 3 : 2)) out.add(i)
  return out
}

// a lot's stall lines (the grid the parked cars use, sim/parked.js lotStalls): a line between
// neighbouring stalls and across each stall's head, kept inside the lot and off buildings
export const stallLines = (out, areas, groundAt, buildings = []) => {
  let n = 0
  for (const a of areas) {
    if (a.cls !== AREA.parking || a.ring.length < 3) continue
    const stalls = lotStalls(a.ring)
    const blue = accessibleStalls(stalls, buildings)
    stalls.forEach((st, si) => {
      const f = st.f
      const at = (u, v) => [f.ox + f.ux * u + f.vx * v, f.oz + f.uz * u + f.vz * v]
      const ok = (x, z) => inRing(a.ring, x, z) && edgeDist(a.ring, x, z) > 0.4 && !buildings.some((b) => inRing(b.ring, x, z))
      const col = blue.has(si) ? BLUE : WHITE
      for (const side of [-0.5, 0.5]) {
        const [x0, z0] = at(st.u + side * STALL_W, st.v - 2.6)
        const [x1, z1] = at(st.u + side * STALL_W, st.v + 2.6)
        if (ok(x0, z0) && ok(x1, z1)) {
          line(out, groundAt, x0, z0, x1, z1, 0.12, col)
          n++
        }
      }
      // (the head of the stall: the side the car's nose points to)
      const head = Math.sin(st.yaw) * f.vx + Math.cos(st.yaw) * f.vz > 0 ? 2.6 : -2.6
      const [x0, z0] = at(st.u - 0.5 * STALL_W, st.v + head)
      const [x1, z1] = at(st.u + 0.5 * STALL_W, st.v + head)
      if (ok(x0, z0) && ok(x1, z1)) line(out, groundAt, x0, z0, x1, z1, 0.12, col)
      if (blue.has(si)) {
        // (an accessible stall: a blue square painted in it, a white mark in the middle)
        const [cx, cz] = at(st.u, st.v - head * 0.35)
        const [sx0, sz0] = at(st.u - 0.6, st.v - head * 0.35)
        const [sx1, sz1] = at(st.u + 0.6, st.v - head * 0.35)
        if (ok(cx, cz)) {
          line(out, groundAt, sx0, sz0, sx1, sz1, 1.3, BLUE, 0.075)
          line(out, groundAt, (sx0 + cx) / 2, (sz0 + cz) / 2, (sx1 + cx) / 2, (sz1 + cz) / 2, 0.45, WHITE, 0.08)
        }
      }
    })
  }
  return n
}

// the markings of a tile's roads (and its lots' stalls) -> arrays
export const markingArrays = (roads, groundAt, areas = [], buildings = []) => {
  const out = createArrays()
  stallLines(out, areas, groundAt, buildings)
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

// piers mapped as areas (data/tile.js `q`): a level deck of weathered boards on pilings, a
// railing along the sides over the water (wet(x, z): is a point the sea?) -> arrays
export const platformArrays = (platforms, seaY = 0, wet = () => true) => {
  const out = createArrays()
  const BOARD = 0x9b8b73
  const FASCIA = 0x75685a
  const RAIL = 0xd9d6cf
  const PILE = 0x5f5548
  for (const p of platforms || []) {
    if (!p.own || p.ring.length < 3) continue
    const h = p.h
    let tris = []
    try {
      tris = THREE.ShapeUtils.triangulateShape(p.ring.map((q) => new THREE.Vector2(q.x, q.z)), [])
    } catch {
      tris = []
    }
    for (const [i, j, k] of tris) out.quad([p.ring[i].x, h, p.ring[i].z], [p.ring[j].x, h, p.ring[j].z], [p.ring[k].x, h, p.ring[k].z], [p.ring[k].x, h, p.ring[k].z], BOARD)
    // (which way is out: the ring's winding in the x/z plane)
    let area2 = 0
    for (let i = 0; i < p.ring.length; i++) {
      const a = p.ring[i]
      const b = p.ring[(i + 1) % p.ring.length]
      area2 += a.x * b.z - b.x * a.z
    }
    const out1 = area2 > 0 ? 1 : -1
    for (let i = 0; i < p.ring.length; i++) {
      const a = p.ring[i]
      const b = p.ring[(i + 1) % p.ring.length]
      const L = Math.hypot(b.x - a.x, b.z - a.z)
      if (L < 0.3) continue
      const fx = (b.x - a.x) / L
      const fz = (b.z - a.z) / L
      const nx = fz * out1
      const nz = -fx * out1
      const V = (q, y, o = 0) => [q.x + nx * o, y, q.z + nz * o]
      out.quad(V(a, h), V(b, h), V(b, h - 0.6), V(a, h - 0.6), FASCIA, 0, nx, nz)
      out.quad(V(b, h), V(a, h), V(a, h - 0.6), V(b, h - 0.6), FASCIA, 0, -nx, -nz)
      // pilings down into the water every ~9 m
      const n = Math.max(1, Math.round(L / 9))
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n
        const q = { x: a.x + (b.x - a.x) * t - nx * 0.3, z: a.z + (b.z - a.z) * t - nz * 0.3 }
        if (!wet(q.x, q.z)) continue
        for (const [ux, uz] of [[fx, fz], [nx, nz]]) {
          const P = (s, y) => [q.x + ux * 0.18 * s, y, q.z + uz * 0.18 * s]
          out.quad(P(-1, h - 0.6), P(1, h - 0.6), P(1, seaY - 3), P(-1, seaY - 3), PILE, 0, -uz, ux)
          out.quad(P(1, h - 0.6), P(-1, h - 0.6), P(-1, seaY - 3), P(1, seaY - 3), PILE, 0, uz, -ux)
        }
      }
      // the railing (where the side is over the water, not across the way on from the shore)
      if (!wet((a.x + b.x) / 2 + nx * 1.5, (a.z + b.z) / 2 + nz * 1.5)) continue
      for (const [y0, y1] of [[h + 0.95, h + 1.07], [h + 0.47, h + 0.55]]) {
        out.quad(V(a, y0, -0.05), V(b, y0, -0.05), V(b, y1, -0.05), V(a, y1, -0.05), RAIL, 0, nx, nz)
        out.quad(V(b, y0, -0.05), V(a, y0, -0.05), V(a, y1, -0.05), V(b, y1, -0.05), RAIL, 0, -nx, -nz)
      }
      const posts = Math.max(1, Math.round(L / 2.5))
      for (let k = 0; k <= posts; k++) {
        const t = k / posts
        const q = { x: a.x + (b.x - a.x) * t - nx * 0.05, z: a.z + (b.z - a.z) * t - nz * 0.05 }
        const P = (s, y) => [q.x + fx * 0.05 * s, y, q.z + fz * 0.05 * s]
        out.quad(P(-1, h), P(1, h), P(1, h + 1.07), P(-1, h + 1.07), RAIL, 0, nx, nz)
        out.quad(P(1, h), P(-1, h), P(-1, h + 1.07), P(1, h + 1.07), RAIL, 0, -nx, -nz)
      }
    }
  }
  return out.done()
}

// the decks as surfaces to stand or drive on -> [{ ax, az, bx, bz, ha, hb, hw, drive }], and
// the piers' level decks [{ ring, h, x0, z0, x1, z1 }]
export const deckSurfaces = (roads, platforms = []) => {
  const list = []
  for (const r of roads) {
    if (!r.deck) continue
    for (let i = 0; i + 1 < r.pts.length; i++) list.push({ ax: r.pts[i].x, az: r.pts[i].z, bx: r.pts[i + 1].x, bz: r.pts[i + 1].z, ha: r.deck[i], hb: r.deck[i + 1], hw: r.width / 2 + 0.5, drive: DRIVABLE.has(r.cls) })
  }
  for (const p of platforms || []) {
    if (p.ring.length < 3) continue
    let x0 = Infinity
    let z0 = Infinity
    let x1 = -Infinity
    let z1 = -Infinity
    for (const q of p.ring) {
      x0 = Math.min(x0, q.x)
      x1 = Math.max(x1, q.x)
      z0 = Math.min(z0, q.z)
      z1 = Math.max(z1, q.z)
    }
    list.push({ ring: p.ring, h: p.h, x0, z0, x1, z1, drive: false })
  }
  return list
}
// the deck under a point near height y (within a step up or a drop) -> height | null
export const deckAt = (decks, x, z, y, drive = false) => {
  let best = null
  for (const d of decks) {
    if (drive && !d.drive) continue
    if (d.ring) {
      if (x < d.x0 || x > d.x1 || z < d.z0 || z > d.z1 || d.h > y + 1.3 || d.h < y - 2.5) continue
      let inside = false
      const r = d.ring
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) if (r[i].z > z !== r[j].z > z && x < ((r[j].x - r[i].x) * (z - r[i].z)) / (r[j].z - r[i].z) + r[i].x) inside = !inside
      if (inside && (best === null || d.h > best)) best = d.h
      continue
    }
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

// the road surfaces as geometry on near tiles (crisp edges; the ground texture keeps them
// from afar): carriageways, sidewalks where mapped, footpaths; round joins at bends
const hex = (h) => parseInt(h.slice(1), 16)
const SKIP = new Set([ROAD.driveway, ROAD.rail, ROAD.river, ROAD.stream, ROAD.track])
export const roadArrays = (roads, groundAt) => {
  const out = createArrays()
  const rank = new Map(ROAD_ORDER.map((c, i) => [c, i]))
  const ribbon = (r, half, col, lift) => {
    const pts = r.pts
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i]
      const b = pts[i + 1]
      const L = Math.hypot(b.x - a.x, b.z - a.z)
      if (L < 0.1) continue
      const fx = (b.x - a.x) / L
      const fz = (b.z - a.z) / L
      const rx = -fz
      const rz = fx
      const n = Math.max(1, Math.ceil(L / 8))
      for (let s = 0; s < n; s++) {
        const t0 = (s / n) * L
        const t1 = ((s + 1) / n) * L
        const at = (t, side) => {
          const x = a.x + fx * t + rx * half * side
          const z = a.z + fz * t + rz * half * side
          return [x, groundAt(x, z) + lift, z]
        }
        out.quad(at(t0, -1), at(t1, -1), at(t1, 1), at(t0, 1), col)
      }
      // a round join at the far end of the segment where the road bends
      if (i + 2 < pts.length && half > 1.2) {
        const c = pts[i + 2]
        const L2 = Math.hypot(c.x - b.x, c.z - b.z) || 1
        const turn = Math.abs(Math.atan2(fx * (c.z - b.z) / L2 - fz * (c.x - b.x) / L2, fx * (c.x - b.x) / L2 + fz * (c.z - b.z) / L2))
        if (turn > 0.2) {
          const y = groundAt(b.x, b.z) + lift
          const K = 6
          for (let k = 0; k < K; k++) {
            const a0 = (k / K) * Math.PI * 2
            const a1 = ((k + 1) / K) * Math.PI * 2
            const p0 = [b.x + Math.cos(a0) * half, y, b.z + Math.sin(a0) * half]
            const p1 = [b.x + Math.cos(a1) * half, y, b.z + Math.sin(a1) * half]
            out.quad([b.x, y, b.z], p0, p1, [b.x, y, b.z], col)
          }
        }
      }
    }
  }
  const list = roads.filter((r) => !SKIP.has(r.cls) && !(r.flags & (F.tunnel | F.bridge)) && ROAD_PAINT[r.cls]).sort((p, q) => (rank.get(p.cls) ?? 0) - (rank.get(q.cls) ?? 0))
  for (const r of list) if (DRIVABLE.has(r.cls) && r.flags & (F.walkL | F.walkR)) ribbon(r, r.width / 2 + 2, hex(SIDEWALK), 0.03)
  for (const r of list) ribbon(r, r.width / 2, hex(ROAD_PAINT[r.cls][0]), 0.04 + (rank.get(r.cls) ?? 0) * 0.0025)
  // curbs and gutters where the map has sidewalks: a pale curb top and a darker gutter line
  for (const r of list) {
    if (!DRIVABLE.has(r.cls)) continue
    if (r.flags & F.walkL) {
      strip(out, r, groundAt, -(r.width / 2 + 0.12), 0.24, CURB, null, 0.13)
      strip(out, r, groundAt, -(r.width / 2 - 0.25), 0.45, GUTTER, null, 0.085)
    }
    if (r.flags & F.walkR) {
      strip(out, r, groundAt, r.width / 2 + 0.12, 0.24, CURB, null, 0.13)
      strip(out, r, groundAt, r.width / 2 - 0.25, 0.45, GUTTER, null, 0.085)
    }
  }
  return out.done()
}
