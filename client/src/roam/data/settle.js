// Roam: where an aerial crown stands, given the map (docs/open-world.md "Vegetation"). Pure;
// Node-tested (veg.test.js). The NAIP aerial and OpenStreetMap disagree by a few metres (the
// imagery's registration, a crown leaning over a curb or a roof's edge, the map's road widths
// taken from defaults), so a street tree's crown often lands just inside a road's lanes or a
// building's outline. A crown that is only a little in (SETTLE m) is stood at the curb or just
// outside the wall it overlaps; one deep in a road or a building isn't a tree we can draw.

import { DRIVABLE, F } from "./tile.js"
import { onLanes } from "./veg.js"

export const SETTLE = 3 // metres a crown may be moved to the curb or out of a wall's line

const inRing = (r, x, z) => {
  let ins = false
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) if (r[i].z > z !== r[j].z > z && x < ((r[j].x - r[i].x) * (z - r[i].z)) / (r[j].z - r[i].z) + r[i].x) ins = !ins
  return ins
}
// the nearest point on a polyline -> { d, px, pz }
const nearestOn = (pts, x, z, closed = false) => {
  let best = { d: Infinity, px: x, pz: z }
  const n = closed ? pts.length : pts.length - 1
  for (let i = 0; i < n; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    const dx = b.x - a.x
    const dz = b.z - a.z
    const L2 = dx * dx + dz * dz || 1e-9
    const k = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2))
    const px = a.x + dx * k
    const pz = a.z + dz * k
    const d = Math.hypot(x - px, z - pz)
    if (d < best.d) best = { d, px, pz }
  }
  return best
}

// -> what's in the way at (x, z): { kind: "building", ring } | { kind: "road", road, d, px, pz } | null
const blocker = (x, z, buildings, roads) => {
  for (const b of buildings) if (b.ring.length >= 3 && inRing(b.ring, x, z)) return { kind: "building", ring: b.ring }
  for (const r of roads) {
    if (!DRIVABLE.has(r.cls) || r.flags & (F.tunnel | F.bridge) || r.pts.length < 2) continue
    const n = nearestOn(r.pts, x, z)
    if (onLanes(r, n.d, !!(r.flags & F.oneway), -0.5)) return { kind: "road", road: r, ...n }
  }
  return null
}

// a crown at (x, z) -> { x, z } where it's drawn (moved at most SETTLE m), or null (deep in a
// road or a building)
export const settleCrown = (x, z, buildings, roads) => {
  let px = x
  let pz = z
  for (let step = 0; step < 3; step++) {
    const b = blocker(px, pz, buildings, roads)
    if (!b) return Math.hypot(px - x, pz - z) <= SETTLE + 0.01 ? { x: px, z: pz } : null
    if (b.kind === "building") {
      // (out past the nearest wall)
      const e = nearestOn(b.ring, px, pz, true)
      if (e.d > SETTLE - 0.8) return null
      const ux = (e.px - px) / (e.d || 1e-6)
      const uz = (e.pz - pz) / (e.d || 1e-6)
      px = e.px + ux * 0.8
      pz = e.pz + uz * 0.8
    } else {
      // (to the curb on its own side, just past the lanes' edge)
      const edge = b.road.width / 2 - 0.5
      if (edge - b.d > SETTLE || b.d < 0.05) return null
      const ux = (px - b.px) / b.d
      const uz = (pz - b.pz) / b.d
      px = b.px + ux * (b.road.width / 2 + 0.6)
      pz = b.pz + uz * (b.road.width / 2 + 0.6)
    }
  }
  return null
}
