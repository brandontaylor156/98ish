// Roam: dockless bikes and e-scooters near the shops and parks (the owner: "give me easy access
// to faster transportation. Option to bike, scooter..."). Pure; Node-tested (transport.test.js).
// The same in every browser (from the tile's key). Game items like the traffic: "Pedal 98" bikes
// and "Zoom 98" scooters (original names), standing on open ground at the edge of a mapped walk
// near a mapped shop, place to eat or park; never in a building, on a road's lanes or in water.

import { AREA, DRIVABLE, F, FOOT } from "../data/tile.js"
import { hashStr, rng } from "./parked.js"

export const FLEET = {
  bike: { name: "Pedal 98 bike", color: 0x16a596 },
  scooter: { name: "Zoom 98 scooter", color: 0xf09a2a },
}
export const MAX_FLEET = 8 // a tile
const ANCHOR = /^(mall|supermarket|department_store|cafe|restaurant|fast_food|ice_cream|cinema|library|marketplace|university|college|clothes|food_court|bicycle|park|playground|sports_centre|stadium|ferry_terminal|pier)$/

const inRing = (ring, x, z) => {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) if (ring[i].z > z !== ring[j].z > z && x < ((ring[j].x - ring[i].x) * (z - ring[i].z)) / (ring[j].z - ring[i].z) + ring[i].x) inside = !inside
  return inside
}
// the closest point of a line -> { d, px, pz, hx, hz }
const closest = (pts, x, z) => {
  const out = { d: Infinity, px: x, pz: z, hx: 1, hz: 0 }
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    const dx = b.x - a.x
    const dz = b.z - a.z
    const L2 = dx * dx + dz * dz || 1e-9
    const k = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2))
    const px = a.x + dx * k
    const pz = a.z + dz * k
    const d = Math.hypot(x - px, z - pz)
    if (d < out.d) {
      const L = Math.sqrt(L2)
      Object.assign(out, { d, px, pz, hx: dx / L, hz: dz / L })
    }
  }
  return out
}
// a spot clear for a bike: off every lane and building, out of the water
export const fleetClear = (tile, x, z) => {
  for (const b of tile.buildings) {
    if (Math.abs(b.ring[0].x - x) > 300 || Math.abs(b.ring[0].z - z) > 300) continue
    if (inRing(b.ring, x, z)) return false
    if (closest([...b.ring, b.ring[0]], x, z).d < 1.2) return false
  }
  for (const r of tile.roads) if (DRIVABLE.has(r.cls) && !(r.flags & (F.tunnel | F.bridge)) && closest(r.pts, x, z).d < r.width / 2 + 0.8) return false
  for (const a of tile.areas) if ((a.cls === AREA.water || a.cls === AREA.pool) && inRing(a.ring, x, z)) return false
  for (const g of tile.sea || []) if (g.reduce((ins, r) => (inRing(r, x, z) ? !ins : ins), false)) return false
  return true
}

// a tile's bikes and scooters -> [{ id, kind, x, z, yaw }]
export const fleetSpots = (tile) => {
  const rand = rng(hashStr(`fleet:${tile.key}`))
  const anchors = tile.pois.filter((p) => ANCHOR.test(p.kind))
  const walks = tile.roads.filter((r) => (FOOT.has(r.cls) || (DRIVABLE.has(r.cls) && r.flags & (F.walkL | F.walkR))) && !(r.flags & (F.tunnel | F.bridge)) && r.pts.length > 1)
  const out = []
  for (const p of anchors) {
    if (out.length >= MAX_FLEET) break
    if (rand() < 0.45) continue
    // (the walk nearest the place)
    let best = null
    for (const r of walks) {
      const c = closest(r.pts, p.x, p.z)
      if (c.d < 60 && (!best || c.d < best.c.d)) best = { r, c }
    }
    if (!best) continue
    const { r, c } = best
    // (a footway's edge, or a road's sidewalk: beyond the lanes)
    const edge = FOOT.has(r.cls) ? r.width / 2 + 0.9 : r.width / 2 + 2.2
    const n = 1 + Math.floor(rand() * 2)
    for (let i = 0; i < n && out.length < MAX_FLEET; i++)
      for (let tries = 0; tries < 10; tries++) {
        const t = (rand() - 0.5) * 14
        // (the side of the walk the place is on; the other side now and then)
        let side = (p.x - c.px) * -c.hz + (p.z - c.pz) * c.hx >= 0 ? 1 : -1
        if (rand() < 0.25) side = -side
        const x = c.px + c.hx * t + -c.hz * side * (edge + rand() * 0.8)
        const z = c.pz + c.hz * t + c.hx * side * (edge + rand() * 0.8)
        if (!fleetClear(tile, x, z)) continue
        if (out.some((o) => Math.hypot(o.x - x, o.z - z) < 1.6)) continue
        const kind = rand() < 0.5 ? "bike" : "scooter"
        // (parked along the walk, either way, a little askew)
        const yaw = Math.atan2(c.hx, c.hz) + (rand() < 0.5 ? 0 : Math.PI) + (rand() - 0.5) * 0.5
        out.push({ id: `fl:${tile.key}:${out.length}`, kind, x, z, yaw })
        break
      }
  }
  return out
}
