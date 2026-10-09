// Roam: parked cars, the same in every browser (a tile's cars come from its key, not from
// chance), so friends see one car where the other does. Pure; Node-tested (roam.test.js).
//
// Where: in the mapped parking lots (rows of stalls along the lot's longest side, about a
// third of them taken) and at the curb of residential streets (now and then). A modest count:
// at most 24 in a lot, 50 a tile. Never in a building, never on top of another car.

import { AREA, DRIVABLE, ROAD } from "../data/tile.js"
import { MODEL_IDS } from "./car.js"

export const MAX_PER_TILE = 50
export const MAX_PER_LOT = 24
// original paint colors (white, silver, black, grey, the odd red/blue/pearl/green)
export const PAINTS = [0xf2f2ef, 0xf2f2ef, 0xc9ccd0, 0xc9ccd0, 0x1d1f22, 0x1d1f22, 0x6b6f75, 0x8c1c1c, 0x1f3f7a, 0xe8e2d0, 0x3b5d47, 0x9aa7b4]

// a small seeded generator (mulberry32) and a string hash
export const hashStr = (s) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
export const rng = (seed) => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const inRing = (ring, x, z) => {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) if (ring[i].z > z !== ring[j].z > z && x < ((ring[j].x - ring[i].x) * (z - ring[i].z)) / (ring[j].z - ring[i].z) + ring[i].x) inside = !inside
  return inside
}
const edgeDist = (ring, x, z) => {
  let best = Infinity
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    const dx = b.x - a.x
    const dz = b.z - a.z
    const L2 = dx * dx + dz * dz || 1e-9
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2))
    best = Math.min(best, Math.hypot(x - a.x - dx * t, z - a.z - dz * t))
  }
  return best
}

// a lot's own axes: u along its longest side, v across -> { ox, oz, ux, uz, vx, vz, u0, u1, v0, v1 }
export const lotFrame = (r) => {
  let best = 0
  let ux = 1
  let uz = 0
  for (let i = 0; i < r.length; i++) {
    const p = r[i]
    const q = r[(i + 1) % r.length]
    const L = Math.hypot(q.x - p.x, q.z - p.z)
    if (L > best) {
      best = L
      ux = (q.x - p.x) / L
      uz = (q.z - p.z) / L
    }
  }
  const vx = -uz
  const vz = ux
  let u0 = Infinity
  let u1 = -Infinity
  let v0 = Infinity
  let v1 = -Infinity
  const ox = r[0].x
  const oz = r[0].z
  for (const p of r) {
    const u = (p.x - ox) * ux + (p.z - oz) * uz
    const v = (p.x - ox) * vx + (p.z - oz) * vz
    u0 = Math.min(u0, u)
    u1 = Math.max(u1, u)
    v0 = Math.min(v0, v)
    v1 = Math.max(v1, v)
  }
  return { ox, oz, ux, uz, vx, vz, u0, u1, v0, v1 }
}
// the stalls of a lot (rows of 2.75 m stalls, a row every 9 m across the lot, facing alternate
// ways), the same grid the parked cars use -> [{ x, z, yaw, u, v }]
export const STALL_W = 2.75
export const lotStalls = (r) => {
  const f = lotFrame(r)
  const out = []
  for (let v = f.v0 + 3.2; v < f.v1 - 2.5; v += 9) {
    const facing = Math.round((v - f.v0) / 9) % 2 === 0 ? 1 : -1
    for (let u = f.u0 + 2; u < f.u1 - 1.5; u += STALL_W) {
      const x = f.ox + f.ux * u + f.vx * v
      const z = f.oz + f.uz * u + f.vz * v
      if (!inRing(r, x, z) || edgeDist(r, x, z) < 1.6) continue
      out.push({ x, z, yaw: Math.atan2(f.vx * facing, f.vz * facing), u, v, f })
    }
  }
  return out
}
export { inRing, edgeDist }

// decoded tile (data/tile.js decodeTile) -> [{ id, x, z, yaw, model, color }]
export const parkedCars = (tile) => {
  const rand = rng(hashStr(`cars:${tile.key}`))
  const out = []
  const blds = tile.buildings.filter((b) => b.ring.length >= 3)
  const drive = tile.roads.filter((r) => DRIVABLE.has(r.cls))
  // (off every other road's lanes: not across a side street or a lot's aisle)
  const offRoads = (x, z, own) => {
    for (const r of drive) {
      if (r === own) continue
      for (let i = 0; i + 1 < r.pts.length; i++) {
        const a = r.pts[i]
        const b = r.pts[i + 1]
        const dx = b.x - a.x
        const dz = b.z - a.z
        const L2 = dx * dx + dz * dz || 1e-9
        const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2))
        if (Math.hypot(x - a.x - dx * t, z - a.z - dz * t) < r.width / 2 + 1.4) return false
      }
    }
    return true
  }
  const clearOf = (x, z, own = null) => {
    for (const b of blds) if (inRing(b.ring, x, z) || edgeDist(b.ring, x, z) < 2.6) return false
    for (const c of out) if (Math.hypot(c.x - x, c.z - z) < 4.6) return false
    return offRoads(x, z, own)
  }
  const add = (x, z, yaw, src) => {
    out.push({ id: `${tile.key}:${out.length}`, x, z, yaw, model: MODEL_IDS[Math.floor(rand() * MODEL_IDS.length) % MODEL_IDS.length], color: PAINTS[Math.floor(rand() * PAINTS.length) % PAINTS.length], src })
  }
  // the lots
  for (const a of tile.areas) {
    if (a.cls !== AREA.parking || out.length >= MAX_PER_TILE) continue
    const r = a.ring
    if (r.length < 3) continue
    // (double rows of 5.5 m stalls along the lot's longest side: lotStalls; about a third taken)
    let n = 0
    for (const st of lotStalls(r)) {
      if (n >= MAX_PER_LOT || out.length >= MAX_PER_TILE) break
      if (rand() > 0.34) continue
      if (!clearOf(st.x, st.z)) continue
      add(st.x, st.z, st.yaw, "lot")
      n++
    }
  }
  // the curbs of residential streets
  for (const road of tile.roads) {
    if (out.length >= MAX_PER_TILE) break
    if (road.cls !== ROAD.residential && road.cls !== ROAD.living_street) continue
    for (let i = 0; i + 1 < road.pts.length; i++) {
      const a = road.pts[i]
      const b = road.pts[i + 1]
      const L = Math.hypot(b.x - a.x, b.z - a.z)
      if (L < 1) continue
      const fx = (b.x - a.x) / L
      const fz = (b.z - a.z) / L
      for (let s = 12; s < L - 12; s += 18) {
        if (rand() > 0.22 || out.length >= MAX_PER_TILE) continue
        const side = rand() < 0.5 ? 1 : -1
        const off = road.width / 2 - 1.15
        // (x east / z south: the right of a heading (fx, fz) is (-fz, fx))
        const x = a.x + fx * s + -fz * off * side
        const z = a.z + fz * s + fx * off * side
        if (!clearOf(x, z, road)) continue
        // (parked with the traffic on its side of the street)
        const yaw = Math.atan2(fx, fz) + (side > 0 ? 0 : Math.PI)
        add(x, z, Math.atan2(Math.sin(yaw), Math.cos(yaw)), "curb")
      }
    }
  }
  return out
}
