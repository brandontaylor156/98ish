// Roam: a little traffic on the mapped streets. Pure; Node-tested (roam.test.js). A few cars
// (8 on a phone, 16 on a desktop) drive the real roads near you in their lane (US: on the
// right), at about each road's speed, follow on to a connecting road at a way's end, stop at
// the map's stop signs and red lights (the map's traffic_signals nodes, on a shared cycle),
// keep their distance from each other, and NEVER hit you: anyone (you walking, your car, a
// friend) in their lane ahead and they brake to a stop and wait. They come and go out of
// sight (spawned 70-260 m away, dropped past 330 m).

import { DRIVABLE, F, ROAD, STREET } from "../data/tile.js"
import { MODEL_IDS } from "./car.js"
import { PAINTS, rng } from "./parked.js"

// the roads cars use, and how fast they go there (m/s)
const SPEED = {
  [ROAD.motorway]: 29,
  [ROAD.trunk]: 24,
  [ROAD.primary]: 19,
  [ROAD.secondary]: 17,
  [ROAD.tertiary]: 14.5,
  [ROAD.residential]: 11,
  [ROAD.unclassified]: 11,
  [ROAD.living_street]: 7,
  [ROAD.link]: 15,
}
export const trafficRoad = (r) => DRIVABLE.has(r.cls) && SPEED[r.cls] !== undefined && !(r.flags & F.tunnel) && r.pts.length >= 2
export const roadSpeed = (r) => SPEED[r.cls] ?? 10
// a signal's cycle: 22 s green, 4 s amber, 26 s red for one way; the cross street the other
// half (by the road's heading: roughly north-south vs east-west)
export const CYCLE = 52
export const signalGreen = (t, heading, seed = 0) => {
  const ns = Math.abs(Math.cos(heading)) > Math.abs(Math.sin(heading))
  const p = (((t + seed) % CYCLE) + CYCLE) % CYCLE
  return ns ? p < 24 : p >= 26 && p < 50
}

// a road's cumulative lengths (cached on the road)
const lengthsOf = (r) => {
  if (r._cum) return r._cum
  const cum = [0]
  for (let i = 1; i < r.pts.length; i++) cum.push(cum[i - 1] + Math.hypot(r.pts[i].x - r.pts[i - 1].x, r.pts[i].z - r.pts[i - 1].z))
  r._cum = cum
  return cum
}
// a point s metres along a road -> { x, z, hx, hz } (heading along the road's own direction)
export const along = (r, s) => {
  const cum = lengthsOf(r)
  const L = cum[cum.length - 1]
  const t = Math.max(0, Math.min(L, s))
  let i = 0
  while (i < cum.length - 2 && cum[i + 1] < t) i++
  const a = r.pts[i]
  const b = r.pts[i + 1]
  const seg = cum[i + 1] - cum[i] || 1e-6
  const k = (t - cum[i]) / seg
  return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, hx: (b.x - a.x) / seg, hz: (b.z - a.z) / seg }
}
export const roadLength = (r) => {
  const c = lengthsOf(r)
  return c[c.length - 1]
}
// the lane's offset from the road's middle (right of travel)
// (two-way: the right lane, clear of cars parked at the curb, sim/parked.js)
export const laneOffset = (r) => {
  if (r.flags & F.oneway) return r.width >= 7 ? r.width / 4 : 0
  return Math.max(1.6, Math.min(r.width / 2 - 2.9, 3.6))
}

// a car's place and heading -> { x, z, yaw }
export const carPose = (c) => {
  const p = along(c.road, c.s)
  const hx = p.hx * c.dir
  const hz = p.hz * c.dir
  // (x east / z south: the right of a heading (hx, hz) is (-hz, hx))
  const off = laneOffset(c.road)
  return { x: p.x - hz * off, z: p.z + hx * off, yaw: Math.atan2(hx, hz) }
}

// the next road at an end of a road: one that meets it there (a point within 4 m) and leads
// on, preferring going straight -> { road, s, dir } | null
export const nextRoad = (roads, r, dir, rand = Math.random) => {
  const L = roadLength(r)
  const end = along(r, dir > 0 ? L : 0)
  const hx = end.hx * dir
  const hz = end.hz * dir
  const options = []
  for (const q of roads) {
    if (q === r || !trafficRoad(q)) continue
    const n = q.pts.length
    const ends = [
      [0, q.pts[0], 1],
      [n - 1, q.pts[n - 1], -1],
    ]
    for (const [, p, d] of ends) {
      if (Math.hypot(p.x - end.x, p.z - end.z) > 4) continue
      // (one-way: only in its own direction)
      if (q.flags & F.oneway && d < 0) continue
      const s = d > 0 ? 0 : roadLength(q)
      const a = along(q, d > 0 ? Math.min(6, roadLength(q)) : roadLength(q) - Math.min(6, roadLength(q)))
      const dx = (a.x - p.x) * 1
      const dz = (a.z - p.z) * 1
      const l = Math.hypot(dx, dz) || 1
      const turn = (dx / l) * hx + (dz / l) * hz // 1 straight on, -1 straight back
      if (turn < -0.3) continue
      options.push({ road: q, s, dir: d, w: 0.25 + Math.max(0, turn) * 2 + (q.cls === r.cls ? 0.5 : 0) })
    }
    // (a road passing through the end point: join it there, either way it allows)
    if (options.length < 1) {
      const cum = lengthsOf(q)
      for (let i = 1; i + 1 < n; i++) {
        const p = q.pts[i]
        if (Math.hypot(p.x - end.x, p.z - end.z) > 4) continue
        for (const d of q.flags & F.oneway ? [1] : [1, -1]) {
          const a = along(q, cum[i] + d * 6)
          const dx = a.x - p.x
          const dz = a.z - p.z
          const l = Math.hypot(dx, dz) || 1
          const turn = (dx / l) * hx + (dz / l) * hz
          if (turn < -0.3) continue
          options.push({ road: q, s: cum[i], dir: d, w: 0.25 + Math.max(0, turn) * 2 })
        }
      }
    }
  }
  if (!options.length) return null
  let sum = 0
  for (const o of options) sum += o.w
  let x = rand() * sum
  for (const o of options) if ((x -= o.w) <= 0) return o
  return options[options.length - 1]
}

// the stop points ahead of a car on its road: [{ s (metres along the road), kind }]
// (the map's stop signs and signals within 7 m of the road's middle)
export const stopsOn = (road, street) => {
  if (road._stops) return road._stops
  const out = []
  const cum = lengthsOf(road)
  for (const n of street) {
    if (n.kind === STREET.lamp) continue
    let best = Infinity
    let at = 0
    for (let i = 0; i + 1 < road.pts.length; i++) {
      const a = road.pts[i]
      const b = road.pts[i + 1]
      const dx = b.x - a.x
      const dz = b.z - a.z
      const L2 = dx * dx + dz * dz || 1e-9
      const k = Math.max(0, Math.min(1, ((n.x - a.x) * dx + (n.z - a.z) * dz) / L2))
      const d = Math.hypot(n.x - a.x - dx * k, n.z - a.z - dz * k)
      if (d < best) {
        best = d
        at = cum[i] + Math.sqrt(L2) * k
      }
    }
    if (best < 7) out.push({ s: at, kind: n.kind, x: n.x, z: n.z })
  }
  road._stops = out
  return out
}

// world: { roads (the drivable roads near you), street (the stop/signal nodes), people: [{ x, z }]
// (you and friends, on foot or in cars), time (s) }
export const createTraffic = ({ cap = 8, seed = 1 } = {}) => {
  const rand = rng(seed)
  const cars = []
  let nextId = 1
  const spawn = (world, center) => {
    const roads = world.roads.filter(trafficRoad)
    if (!roads.length) return null
    for (let tries = 0; tries < 12; tries++) {
      // (busier roads more often)
      const r = roads[Math.floor(rand() * roads.length)]
      if (rand() > Math.min(1, roadSpeed(r) / 18)) continue
      const L = roadLength(r)
      if (L < 20) continue
      const s = 5 + rand() * (L - 10)
      const dir = r.flags & F.oneway ? 1 : rand() < 0.5 ? 1 : -1
      const c = { id: `t${nextId++}`, road: r, s, dir, speed: 0, model: MODEL_IDS[Math.floor(rand() * MODEL_IDS.length)], color: PAINTS[Math.floor(rand() * PAINTS.length)], wait: 0, stopped: null }
      const p = carPose(c)
      const d = Math.hypot(p.x - center.x, p.z - center.z)
      if (d < 70 || d > 260) continue
      if (cars.some((o) => o.road === r && Math.abs(o.s - s) < 20)) continue
      c.speed = roadSpeed(r) * 0.8
      Object.assign(c, p)
      cars.push(c)
      return c
    }
    return null
  }
  // is anyone (a person or another car) in this car's lane ahead? -> distance | Infinity
  const blockedAhead = (c, world, look) => {
    const fx = Math.sin(c.yaw)
    const fz = Math.cos(c.yaw)
    let best = Infinity
    const check = (x, z, half) => {
      const dx = x - c.x
      const dz = z - c.z
      const ahead = dx * fx + dz * fz
      const side = Math.abs(dx * fz - dz * fx)
      if (ahead > 0 && ahead < look && side < half) best = Math.min(best, ahead)
    }
    for (const p of world.people || []) check(p.x, p.z, p.car ? 2.4 : 1.9)
    for (const o of cars) if (o !== c) check(o.x, o.z, 1.6)
    return best
  }
  return {
    cars,
    cap,
    // one step: dt seconds; center: where you are (spawning and dropping round it)
    step(world, center, dt) {
      // come and go
      for (let i = cars.length - 1; i >= 0; i--) {
        const c = cars[i]
        if (Math.hypot(c.x - center.x, c.z - center.z) > 330 || !world.roads.includes(c.road)) cars.splice(i, 1)
      }
      while (cars.length > this.cap) cars.pop()
      if (cars.length < this.cap && rand() < dt * 2) spawn(world, center)
      for (const c of cars) {
        const top = roadSpeed(c.road)
        let want = top
        // a bend ahead: slower
        const L = roadLength(c.road)
        const a = along(c.road, c.s)
        const b = along(c.road, c.s + c.dir * 18)
        const bend = Math.abs(Math.atan2(a.hx * b.hz - a.hz * b.hx, a.hx * b.hx + a.hz * b.hz))
        want = Math.min(want, top * (1 - Math.min(0.6, bend * 0.9)))
        // stop signs and red lights ahead (and a pause at a stop sign)
        const stops = stopsOn(c.road, c.road._street || world.street || [])
        let gap = Infinity
        for (const st of stops) {
          const d = (st.s - c.s) * c.dir
          if (d < -1 || d > 40) continue
          if (c.stopped === st) continue
          const green = st.kind === STREET.signals && signalGreen(world.time || 0, c.yaw, Math.round(st.x * 0.01 + st.z * 0.013) * 7)
          if (st.kind === STREET.signals && green) continue
          gap = Math.min(gap, d - 4)
          if (d < 6 && c.speed < 0.3) {
            // (at the line: a stop sign is a pause; a red light waits for green)
            if (st.kind === STREET.stop) {
              c.wait += dt
              if (c.wait > 1.6) {
                c.stopped = st
                c.wait = 0
              }
            }
          }
        }
        // anyone in the lane ahead (people first: the car stops well short of you)
        const ahead = blockedAhead(c, world, 28)
        gap = Math.min(gap, ahead - 6.5)
        // the speed for that gap (stopping at 4.5 m/s² comfortably)
        if (gap < Infinity) want = Math.min(want, Math.sqrt(Math.max(0, 2 * 4.5 * Math.max(0, gap))))
        c.speed += Math.max(-7.5 * dt, Math.min(2.2 * dt, want - c.speed))
        if (gap < 0.5) c.speed = 0
        c.speed = Math.max(0, c.speed)
        c.s += c.speed * dt * c.dir
        // the road's end: on to the next one (or turn back if it's a dead end)
        if (c.s > L || c.s < 0) {
          const nx = nextRoad(world.roads, c.road, c.dir, rand)
          if (nx) {
            c.road = nx.road
            c.s = nx.s
            c.dir = nx.dir
            c.stopped = null
          } else if (!(c.road.flags & F.oneway)) {
            c.dir = -c.dir
            c.s = Math.max(0, Math.min(L, c.s))
            c.speed = 0
          } else c.s = Math.max(0, Math.min(L, c.s))
        }
        Object.assign(c, carPose(c))
      }
      return cars
    },
    // circles a car takes up (for your car and you to bump into): [{ x, z, r }]
    solids() {
      const out = []
      for (const c of cars) {
        const fx = Math.sin(c.yaw)
        const fz = Math.cos(c.yaw)
        for (const k of [-1.4, 0, 1.4]) out.push({ x: c.x + fx * k, z: c.z + fz * k, r: 0.95 })
      }
      return out
    },
  }
}
