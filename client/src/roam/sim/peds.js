// Roam: a few people out walking near the shops. Pure; Node-tested (roam.test.js). Only on
// the map's own footways, pedestrian streets and mapped sidewalks within ~60 m of a shop (a
// mapped retail/commercial building or a shop/amenity place): 3 on a phone, 6 on a desktop,
// walking up and down at 1.1-1.5 m/s, a pause now and then, stepping round nobody: if you're in
// their way they stop and wait. They come and go out of sight (40-140 m away; gone past 180 m).

import { BUILDING_KINDS, DRIVABLE, F, ROAD } from "../data/tile.js"
import { along, roadLength } from "./traffic.js"
import { rng } from "./parked.js"

const SHOPS = new Set(["retail", "commercial", "supermarket"])
const SHOP_POI = /^(shop|supermarket|mall|cafe|restaurant|fast_food|bank|pharmacy|clothes|convenience|department_store|ice_cream|bakery|cinema|marketplace)$/

// a walkable line: a footway/pedestrian street, or the sidewalk side of a mapped road
// -> [{ road, off }] (off: metres right of the road's line)
export const walkLines = (roads) => {
  const out = []
  for (const r of roads) {
    if (r.flags & (F.tunnel | F.bridge) || r.pts.length < 2) continue
    if (r.cls === ROAD.footway || r.cls === ROAD.pedestrian) out.push({ road: r, off: 0 })
    else if (DRIVABLE.has(r.cls)) {
      if (r.flags & F.walkR) out.push({ road: r, off: r.width / 2 + 1.2 })
      if (r.flags & F.walkL) out.push({ road: r, off: -(r.width / 2 + 1.2) })
    }
  }
  return out
}
// the shops' spots in a decoded tile -> [{ x, z }]
export const shopSpots = (tile) => {
  const out = []
  for (const b of tile.buildings) {
    if (!SHOPS.has(BUILDING_KINDS[b.kind])) continue
    let x = 0
    let z = 0
    for (const p of b.ring) {
      x += p.x
      z += p.z
    }
    out.push({ x: x / b.ring.length, z: z / b.ring.length, r: Math.sqrt(b.area) / 2 })
  }
  for (const p of tile.pois) if (SHOP_POI.test(p.kind)) out.push({ x: p.x, z: p.z, r: 0 })
  return out
}
// a line's point s metres along, offset to its side -> { x, z, yaw }
export const pedPose = (p) => {
  const a = along(p.line.road, p.s)
  const hx = a.hx * p.dir
  const hz = a.hz * p.dir
  return { x: a.x - a.hz * p.line.off, z: a.z + a.hx * p.line.off, yaw: Math.atan2(hx, hz) }
}

// world: { lines (walkLines near you, each with near-a-shop marked), people: [{ x, z }] }
export const createPeds = ({ cap = 3, seed = 7 } = {}) => {
  const rand = rng(seed)
  const peds = []
  let nextId = 1
  return {
    peds,
    cap,
    step(world, center, dt) {
      for (let i = peds.length - 1; i >= 0; i--) {
        const p = peds[i]
        if (Math.hypot(p.x - center.x, p.z - center.z) > 180 || !world.lines.includes(p.line)) peds.splice(i, 1)
      }
      const shoppy = world.lines.filter((l) => l.shop)
      while (peds.length > this.cap) peds.pop()
      // (just arrived, world.view.fresh: people come into the view you see first, 12-70 m ahead,
      // so the street isn't empty; later they appear out of sight where they can)
      const v = world.view
      const fresh = !!v?.fresh
      if (peds.length < this.cap && shoppy.length && rand() < dt * (fresh ? 6 : 1.5)) {
        let pick = null
        for (let tries = 0; tries < 16; tries++) {
          const line = shoppy[Math.floor(rand() * shoppy.length)]
          const L = roadLength(line.road)
          if (L < 12) continue
          const p = { id: `p${nextId}`, line, s: 2 + rand() * (L - 4), dir: rand() < 0.5 ? 1 : -1, speed: 0, pace: 1.1 + rand() * 0.4, pause: 0 }
          Object.assign(p, pedPose(p))
          const d = Math.hypot(p.x - center.x, p.z - center.z)
          const seen = v ? ((p.x - v.x) * v.fx + (p.z - v.z) * v.fz) / Math.max(1, Math.hypot(p.x - v.x, p.z - v.z)) > 0.75 : false
          if (fresh) {
            if (d < 12 || d > 70) continue
            if (seen) {
              pick = p
              break
            }
          } else {
            if (d < 25 || d > 110) continue
            if (!seen || !v) {
              pick = p
              break
            }
          }
          pick ||= p
        }
        if (pick) {
          nextId++
          peds.push(pick)
        }
      }
      for (const p of peds) {
        const L = roadLength(p.line.road)
        // someone in the way (you, a friend, a car stopped on the walk): wait
        const fx = Math.sin(p.yaw)
        const fz = Math.cos(p.yaw)
        let blocked = false
        for (const o of world.people || []) {
          const dx = o.x - p.x
          const dz = o.z - p.z
          const ahead = dx * fx + dz * fz
          if (ahead > 0 && ahead < 1.8 && Math.abs(dx * fz - dz * fx) < 0.9) blocked = true
        }
        if (p.pause > 0) {
          p.pause -= dt
          p.speed = 0
        } else if (blocked) p.speed = Math.max(0, p.speed - dt * 4)
        else p.speed += Math.min(dt * 1.5, p.pace - p.speed)
        p.s += p.speed * dt * p.dir
        if (p.s > L - 1 || p.s < 1) {
          // (the end of the walk: turn round, a moment's pause)
          p.dir = -p.dir
          p.s = Math.max(1, Math.min(L - 1, p.s))
          p.pause = 1 + rand() * 3
        } else if (rand() < dt * 0.02) p.pause = 2 + rand() * 4 // (stopping to look at something)
        Object.assign(p, pedPose(p))
      }
      return peds
    },
  }
}
