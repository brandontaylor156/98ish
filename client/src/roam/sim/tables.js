// Roam: people sitting out at tables by the map's cafés and restaurants (the owner: "parked me
// at like, the mall or somewhere fun", so the shopping streets have some life). Pure;
// Node-tested (roam.test.js). The same in every browser (from the tile's key).
//
// Only at mapped places to eat or drink (amenity=restaurant|cafe|fast_food|ice_cream|food_court|
// bar|pub): a table or two on the open ground just outside, never in a building, on a road's
// lanes, in a parking lot or across a footway, each with two to four chairs and some of them
// taken. Like the people walking and the traffic, these are game items, not map features.

import { AREA, DRIVABLE, F, FOOT } from "../data/tile.js"
import { hashStr, rng } from "./parked.js"

export const EAT = /^(restaurant|cafe|fast_food|ice_cream|food_court|bar|pub|biergarten)$/
export const MAX_TABLES = 16 // a tile
const SHIRTS = [0xf4f1ea, 0x2f4b7c, 0xb23a3a, 0x3d6b4a, 0xe0b44c, 0x1d1f22, 0x7a5c8e, 0xd98a6a, 0x5aa0c8, 0xc8c4bc, 0xe7a3b6, 0x445566]
const PANTS = [0x2b3445, 0x1d1f22, 0x3a4a62, 0x8a7b62, 0x5b5e63, 0xc9bfa8, 0x24324f]
const SKIN = [0xf1c8a8, 0xe0ac86, 0xc68b62, 0x9c6a45, 0x6e4a32, 0xf6d4bc]
const HAIR = [0x1c1612, 0x3a2a1e, 0x5e4630, 0x8a6a44, 0xc9a66b, 0x9a9a98, 0x2a1d17]

const inRing = (ring, x, z) => {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) if (ring[i].z > z !== ring[j].z > z && x < ((ring[j].x - ring[i].x) * (z - ring[i].z)) / (ring[j].z - ring[i].z) + ring[i].x) inside = !inside
  return inside
}
const segDist = (pts, x, z) => {
  let best = Infinity
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    const dx = b.x - a.x
    const dz = b.z - a.z
    const L2 = dx * dx + dz * dz || 1e-9
    const k = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2))
    best = Math.min(best, Math.hypot(x - a.x - dx * k, z - a.z - dz * k))
  }
  return best
}
const ringDist = (ring, x, z) => segDist([...ring, ring[0]], x, z)

// is a spot clear for a table (2 m round it)?
export const tableClear = (tile, x, z) => {
  for (const b of tile.buildings) {
    const r = b.ring
    if (Math.abs(r[0].x - x) > 300 || Math.abs(r[0].z - z) > 300) continue
    if (inRing(r, x, z) || ringDist(r, x, z) < 1.8) return false
  }
  for (const r of tile.roads) {
    if (r.flags & (F.tunnel | F.bridge)) continue
    if (DRIVABLE.has(r.cls) && segDist(r.pts, x, z) < r.width / 2 + (r.flags & (F.walkL | F.walkR) ? 4.5 : 1.8)) return false
    if (FOOT.has(r.cls) && segDist(r.pts, x, z) < r.width / 2 + 1.4) return false
  }
  for (const a of tile.areas) if ((a.cls === AREA.parking || a.cls === AREA.water || a.cls === AREA.pool) && inRing(a.ring, x, z)) return false
  return true
}

// a tile's tables -> [{ x, z, yaw, chairs: [{ x, z, yaw, person: { shirt, pants, skin, hair } | null }] }]
export const tableSpots = (tile) => {
  const rand = rng(hashStr(`tables:${tile.key}`))
  const out = []
  for (const p of tile.pois) {
    if (out.length >= MAX_TABLES) break
    if (!EAT.test(p.kind)) continue
    // (not every place has tables out)
    if (rand() < 0.35) continue
    let spot = null
    for (let r = 3; r <= 15 && !spot; r += 1.5)
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2 + r
        const x = p.x + Math.cos(a) * r
        const z = p.z + Math.sin(a) * r
        if (tableClear(tile, x, z) && !out.some((t) => Math.hypot(t.x - x, t.z - z) < 3)) {
          spot = { x, z }
          break
        }
      }
    if (!spot) continue
    const n = rand() < 0.5 ? 1 : 2
    for (let i = 0; i < n; i++) {
      const x = spot.x + (i ? (rand() - 0.5) * 3.2 : 0)
      const z = spot.z + (i ? (rand() - 0.5) * 3.2 : 0)
      if (i && (!tableClear(tile, x, z) || out.some((t) => Math.hypot(t.x - x, t.z - z) < 2.6))) continue
      const yaw = rand() * Math.PI * 2
      const seats = rand() < 0.5 ? 2 : rand() < 0.6 ? 4 : 3
      const chairs = []
      for (let c = 0; c < seats; c++) {
        const a = yaw + (c / seats) * Math.PI * 2
        const cx = x + Math.sin(a) * 0.78
        const cz = z + Math.cos(a) * 0.78
        // (facing the table)
        const cy = Math.atan2(x - cx, z - cz)
        const taken = rand() < 0.62
        chairs.push({ x: cx, z: cz, yaw: cy, person: taken ? { shirt: SHIRTS[Math.floor(rand() * SHIRTS.length)], pants: PANTS[Math.floor(rand() * PANTS.length)], skin: SKIN[Math.floor(rand() * SKIN.length)], hair: HAIR[Math.floor(rand() * HAIR.length)] } : null })
      }
      out.push({ x, z, yaw, chairs, place: p.name })
    }
  }
  return out
}
