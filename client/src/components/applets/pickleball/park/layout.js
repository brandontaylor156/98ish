// My Park: where everything is (pure data and geometry, no three.js; Node-tested).
//
// World frame: meters, y up. The courts run east-west (their length along world x), four
// of them in two rows either side of the main path (z = 0), each in its own fenced pen with
// a gate onto the path, a paddle rack beside the gate and bleachers between the pen and
// the path (a sideline view). The pro shop (Locker Room) is on the west plaza, where you
// arrive; the ball-machine court closes the path's east end; benches under the trees along
// the north and south edges; a fountain in the middle.
//
// A court's match runs in the court's own frame (match.js: the net along local x, the
// length along local z). The court's group is turned a quarter turn: local (x, z) is world
// (cx + z, cz - x), and a local yaw is world yaw + pi/2.

import { HALF_L, HALF_W } from "../physics.js"

export const PEN = { hx: HALF_L + 3.2, hz: HALF_W + 2.0, h: 3 } // a pen's half sizes (world x, z) and fence height
export const PATH_W = 3.2 // the main path's width
export const BOUNDS = { x0: -30.5, x1: 47.5, z0: -15.5, z1: 15.5 }
export const LEVEL_NAMES = { beginner: "Rookie", intermediate: "Club", pro: "Pro", legend: "Legend" }

// the four courts with live games (the ball machine's is separate)
export const COURTS = [
  { id: 0, name: "Court 1", level: "beginner", x: -12, z: -8.2 },
  { id: 1, name: "Court 2", level: "intermediate", x: 12, z: -8.2 },
  { id: 2, name: "Court 3", level: "intermediate", x: -12, z: 8.2 },
  { id: 3, name: "Court 4", level: "pro", x: 12, z: 8.2 },
].map((c) => {
  const s = Math.sign(c.z) // -1: north row (its fence on the path side faces south)
  const fenceZ = c.z - s * PEN.hz // the pen's fence along the path
  const toward = -Math.sign(c.x) // toward the middle of the park
  const gate = { x: c.x + toward * (PEN.hx - 2.4), z: fenceZ }
  return {
    ...c,
    side: s,
    fenceZ,
    gate,
    // just inside the gate (where players come on and go off)
    inside: { x: gate.x, z: fenceZ + s * 0.9 },
    // just outside it, on the path side
    outside: { x: gate.x, z: fenceZ - s * 1.0 },
    rack: { x: gate.x + toward * 1.5, z: fenceZ - s * 0.55 },
    // the bleachers: two rows between the pen and the path, facing the court
    bleacher: { x: c.x, z: fenceZ - s * 0.95, len: 7, yaw: s > 0 ? 0 : Math.PI },
  }
})
export const MACHINE_COURT = { id: "machine", name: "Ball Machine", x: 36, z: 0, gate: { x: 36 - PEN.hx, z: 0 } }
export const BOOTH = { x: -27, z: 0, hx: 2, hz: 1.6, h: 3.2 }
export const SPAWN = { x: -18.6, z: 0.6, yaw: Math.PI / 2 }
export const FOUNTAIN = { x: 0, z: 0, r: 0.95 }
export const BOARD = { x: -25.6, z: -5.6, yaw: Math.PI / 2, w: 3.2, h: 2 }

// a court's frame <-> the world
export const toWorld = (c, x, z) => ({ x: c.x + z, z: c.z - x })
export const toLocal = (c, x, z) => ({ x: -(z - c.z), z: x - c.x })
export const yawToWorld = (yaw) => yaw + Math.PI / 2
export const courtById = (id) => COURTS.find((c) => c.id === id) || null

// seats on a court's bleachers (two rows of 8; the front row is nearer the court and lower)
export const SEAT_ROWS = [
  { off: 0.3, y: 0.45 },
  { off: -0.32, y: 0.85 },
]
export const bleacherSeats = (c) => {
  const b = c.bleacher
  const out = []
  SEAT_ROWS.forEach((row, r) => {
    for (let i = 0; i < 8; i++) {
      const along = -b.len / 2 + 0.45 + (i * (b.len - 0.9)) / 7
      out.push({ id: `c${c.id}r${r}s${i}`, court: c.id, x: b.x + along, y: row.y, z: b.z + c.side * row.off, yaw: b.yaw, row: r })
    }
  })
  return out
}

// plain benches (two seats each): on the west plaza, in the gap between the pens, and round
// the ball-machine court
export const BENCHES = [
  { id: "bw0", x: -29.6, z: 6.5, yaw: Math.PI / 2 },
  { id: "bw1", x: -29.6, z: -9.5, yaw: Math.PI / 2 },
  { id: "bc0", x: -1.3, z: -9.5, yaw: Math.PI / 2 },
  { id: "bc1", x: 1.3, z: 9.5, yaw: -Math.PI / 2 },
  { id: "be0", x: 31, z: -9.8, yaw: 0 },
  { id: "be1", x: 41, z: -9.8, yaw: 0 },
  { id: "be2", x: 31, z: 9.8, yaw: Math.PI },
  { id: "be3", x: 41, z: 9.8, yaw: Math.PI },
]
export const benchSeats = (b) => [-0.45, 0.45].map((d, i) => ({ id: `${b.id}s${i}`, bench: b.id, x: b.x + d * Math.cos(b.yaw), y: 0.45, z: b.z - d * Math.sin(b.yaw), yaw: b.yaw }))
export const ALL_SEATS = [...COURTS.flatMap(bleacherSeats), ...BENCHES.flatMap(benchSeats)]
// where someone stands to take a seat: a bench from the front; a bleacher from behind (the
// path side), stepping up onto it
export const seatApproach = (seat) => {
  if (seat.court !== undefined && seat.court !== null) {
    const c = COURTS.find((k) => k.id === seat.court)
    return { x: seat.x, z: c.bleacher.z - c.side * 0.85 }
  }
  return { x: seat.x + Math.sin(seat.yaw) * 0.62, z: seat.z + Math.cos(seat.yaw) * 0.62 }
}

// trees round the edges (deterministic)
export const TREES = (() => {
  const out = []
  let s = 7
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647)
  for (let x = -29; x <= 47; x += 4.2) {
    out.push({ x: x + (rnd() - 0.5) * 1.5, z: -16.6 - rnd() * 2.5, s: 0.8 + rnd() * 0.5 })
    out.push({ x: x + (rnd() - 0.5) * 1.5, z: 16.6 + rnd() * 2.5, s: 0.8 + rnd() * 0.5 })
  }
  for (let z = -13; z <= 13; z += 4.4) {
    out.push({ x: -32.5 - rnd() * 2, z: z + (rnd() - 0.5), s: 0.8 + rnd() * 0.5 })
    out.push({ x: 49.5 + rnd() * 2, z: z + (rnd() - 0.5), s: 0.8 + rnd() * 0.5 })
  }
  // a few inside the park, by the benches
  for (const b of BENCHES) out.push({ x: b.x - Math.sin(b.yaw) * 0.9 + Math.cos(b.yaw) * 1.5, z: b.z - Math.cos(b.yaw) * 0.9 - Math.sin(b.yaw) * 1.5, s: 0.9 + rnd() * 0.3 })
  return out
})()

// light poles at each pen's corners
export const LIGHTS = [...COURTS, MACHINE_COURT].flatMap((c) => [-1, 1].flatMap((sx) => [-1, 1].map((sz) => ({ x: c.x + sx * (PEN.hx + 0.3), z: c.z + sz * (PEN.hz + 0.3) }))))

// ---------- collisions ----------
// boxes (the pens, the booth, bleachers, the board) and circles (the fountain, trunks, poles)
export const BOXES = [
  ...COURTS.map((c) => ({ x0: c.x - PEN.hx, x1: c.x + PEN.hx, z0: c.z - PEN.hz, z1: c.z + PEN.hz, h: PEN.h, kind: "pen", court: c.id })),
  { x0: MACHINE_COURT.x - PEN.hx, x1: MACHINE_COURT.x + PEN.hx, z0: -PEN.hz, z1: PEN.hz, h: PEN.h, kind: "pen", court: "machine" },
  { x0: BOOTH.x - BOOTH.hx, x1: BOOTH.x + BOOTH.hx, z0: BOOTH.z - BOOTH.hz, z1: BOOTH.z + BOOTH.hz, h: BOOTH.h, kind: "booth" },
  ...COURTS.map((c) => {
    const b = c.bleacher
    return { x0: b.x - b.len / 2, x1: b.x + b.len / 2, z0: b.z - 0.55, z1: b.z + 0.55, h: 1.1, kind: "bleacher", court: c.id }
  }),
  { x0: BOARD.x - 0.2, x1: BOARD.x + 0.2, z0: BOARD.z - BOARD.w / 2, z1: BOARD.z + BOARD.w / 2, h: 3, kind: "board" },
  ...BENCHES.map((b) => {
    const across = Math.abs(Math.cos(b.yaw)) > 0.5 // (a bench facing north or south runs along x)
    return { x0: b.x - (across ? 0.75 : 0.25), x1: b.x + (across ? 0.75 : 0.25), z0: b.z - (across ? 0.25 : 0.75), z1: b.z + (across ? 0.25 : 0.75), h: 0.5, kind: "bench" }
  }),
]
export const CIRCLES = [{ x: FOUNTAIN.x, z: FOUNTAIN.z, r: FOUNTAIN.r }, ...TREES.map((t) => ({ x: t.x, z: t.z, r: 0.3 })), ...LIGHTS.map((l) => ({ x: l.x, z: l.z, r: 0.15 }))]

// pushes a circle (x, z, radius r) out of everything solid and inside the park
export const resolve = (x, z, r = 0.35) => {
  for (let pass = 0; pass < 2; pass++) {
    for (const b of BOXES) {
      const cx = Math.max(b.x0, Math.min(b.x1, x))
      const cz = Math.max(b.z0, Math.min(b.z1, z))
      const dx = x - cx
      const dz = z - cz
      const d = Math.hypot(dx, dz)
      if (d >= r) continue
      if (d > 1e-6) {
        x = cx + (dx / d) * r
        z = cz + (dz / d) * r
      } else {
        // inside the box: out the nearest side that isn't into something else
        const outs = [
          [b.x0 - r - x, 0],
          [b.x1 + r - x, 0],
          [0, b.z0 - r - z],
          [0, b.z1 + r - z],
        ].sort((a, c) => Math.abs(a[0]) + Math.abs(a[1]) - Math.abs(c[0]) - Math.abs(c[1]))
        const free = (px, pz) => !BOXES.some((o) => o !== b && px > o.x0 - r && px < o.x1 + r && pz > o.z0 - r && pz < o.z1 + r)
        const out = outs.find(([dx, dz]) => free(x + dx, z + dz)) || outs[0]
        x += out[0]
        z += out[1]
      }
    }
    for (const c of CIRCLES) {
      const dx = x - c.x
      const dz = z - c.z
      const d = Math.hypot(dx, dz)
      const min = c.r + r
      if (d >= min) continue
      if (d < 1e-6) x += min
      else {
        x = c.x + (dx / d) * min
        z = c.z + (dz / d) * min
      }
    }
    x = Math.max(BOUNDS.x0, Math.min(BOUNDS.x1, x))
    z = Math.max(BOUNDS.z0, Math.min(BOUNDS.z1, z))
  }
  return { x, z }
}
export const blocked = (x, z, r = 0.3) => {
  const p = resolve(x, z, r)
  return Math.hypot(p.x - x, p.z - z) > 1e-3
}

// The first solid thing a segment from a to b (on the ground plane) runs into below height
// h: the fraction along it (0..1), or null. (The follow camera stays on this side of fences.)
export const segmentHit = (a, b, h = 0, pad = 0) => {
  let best = null
  const dx = b.x - a.x
  const dz = b.z - a.z
  for (const box of BOXES) {
    if (box.h <= h) continue
    // (starting inside the padding, beside a fence: only the box itself counts)
    if (pad > 0 && a.x > box.x0 - pad && a.x < box.x1 + pad && a.z > box.z0 - pad && a.z < box.z1 + pad) {
      const t = segmentHit(a, b, h, 0)
      if (t !== null && (best === null || t < best)) best = t
      continue
    }
    // slab test
    let t0 = 0
    let t1 = 1
    let ok = true
    for (const [p, d, lo, hi] of [
      [a.x, dx, box.x0 - pad, box.x1 + pad],
      [a.z, dz, box.z0 - pad, box.z1 + pad],
    ]) {
      if (Math.abs(d) < 1e-9) {
        if (p < lo || p > hi) ok = false
        continue
      }
      let u0 = (lo - p) / d
      let u1 = (hi - p) / d
      if (u0 > u1) [u0, u1] = [u1, u0]
      t0 = Math.max(t0, u0)
      t1 = Math.min(t1, u1)
      if (t0 > t1) ok = false
    }
    if (ok && (best === null || t0 < best)) best = t0
  }
  return best
}

// ---------- things you can do ----------
// Each has a spot and a reach; the nearest one in reach is the context button.
export const INTERACTABLES = [
  ...COURTS.map((c) => ({ id: `watch${c.id}`, kind: "watch", court: c.id, x: c.bleacher.x, z: c.bleacher.z - c.side * 1.0, r: 4.2, label: "Watch" })),
  ...COURTS.map((c) => ({ id: `rack${c.id}`, kind: "rack", court: c.id, x: c.rack.x, z: c.rack.z - c.side * 0.6, r: 1.9, label: "Call next" })),
  { id: "locker", kind: "locker", x: BOOTH.x + BOOTH.hx + 0.9, z: BOOTH.z, r: 2.2, label: "Locker Room" },
  { id: "machine", kind: "machine", x: MACHINE_COURT.gate.x - 1.0, z: 0, r: 2.4, label: "Ball Machine" },
  ...BENCHES.map((b) => ({ id: `sit-${b.id}`, kind: "sit", bench: b.id, x: b.x + Math.sin(b.yaw) * 0.9, z: b.z + Math.cos(b.yaw) * 0.9, r: 1.6, label: "Sit" })),
]

// the thing to offer at (x, z): the nearest in reach (by how far into its reach you are), or null
export const nearestAction = (x, z, list = INTERACTABLES) => {
  let best = null
  let bestK = Infinity
  for (const it of list) {
    const d = Math.hypot(x - it.x, z - it.z)
    if (d > it.r) continue
    const k = d / it.r
    if (k < bestK) {
      bestK = k
      best = it
    }
  }
  return best
}

// places people walk between (the path, the plazas, by the bleachers and benches)
export const WAYPOINTS = [
  { x: -22, z: 0 },
  { x: -14, z: 0.4 },
  { x: -6, z: -0.5 },
  { x: 3.5, z: 0.6 },
  { x: 10, z: -0.4 },
  { x: 18, z: 0.5 },
  { x: 23, z: 0 },
  { x: -24, z: 8 },
  { x: -24, z: -9 },
  { x: -10, z: -14.5 },
  { x: 2, z: -14.6 },
  { x: 14, z: 14.6 },
  { x: -2, z: 14.4 },
  { x: 25, z: -11 },
  { x: 25, z: 11 },
  { x: 40, z: -9 },
  { x: 40, z: 9 },
]

// a spot facing someone to chat with: a little apart, both turned in
export const chatSpots = (a, b) => {
  const mx = (a.x + b.x) / 2
  const mz = (a.z + b.z) / 2
  let dx = b.x - a.x
  let dz = b.z - a.z
  const d = Math.hypot(dx, dz) || 1
  dx /= d
  dz /= d
  return [resolve(mx - dx * 0.6, mz - dz * 0.6), resolve(mx + dx * 0.6, mz + dz * 0.6)]
}

// ---------- getting round the pens ----------
// A small graph of open spots (the path, the gaps between pens, the corridors along the
// edges); a walk from a to b goes straight when nothing's in the way, otherwise from node to
// node (shortest by distance) with the first and last legs straight.
export const NAV = [
  ...[-24, -12, 12, 24].map((x) => ({ x, z: 0 })),
  { x: 0, z: -1.8 },
  { x: 0, z: 1.8 },
  { x: 0, z: -8 },
  { x: 0, z: 8 },
  { x: 0, z: -14.6 },
  { x: 0, z: 14.6 },
  ...[-24, 24].flatMap((x) => [-8, 8, -14.6, 14.6].map((z) => ({ x, z }))),
  ...[-12, 12].flatMap((x) => [-14.6, 14.6].map((z) => ({ x, z }))),
  ...[36, 46].flatMap((x) => [-8, 8].map((z) => ({ x, z }))),
  { x: 36, z: -14.6 },
  { x: 36, z: 14.6 },
]
const open = (a, b) => segmentHit(a, b, 0) === null
const NAV_EDGES = NAV.map((a, i) => NAV.map((b, j) => (i !== j && Math.hypot(a.x - b.x, a.z - b.z) < 16 && open(a, b) ? j : -1)).filter((j) => j >= 0))
export const route = (from, to) => {
  if (open(from, to)) return [{ x: to.x, z: to.z }]
  const n = NAV.length
  const starts = NAV.map((p, i) => (open(from, p) ? i : -1)).filter((i) => i >= 0)
  const ends = new Set(NAV.map((p, i) => (open(p, to) ? i : -1)).filter((i) => i >= 0))
  if (!starts.length || !ends.size) return [{ x: to.x, z: to.z }]
  const dist = Array(n).fill(Infinity)
  const prev = Array(n).fill(-1)
  const done = Array(n).fill(false)
  for (const s of starts) dist[s] = Math.hypot(NAV[s].x - from.x, NAV[s].z - from.z)
  for (;;) {
    let u = -1
    for (let i = 0; i < n; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i
    if (u < 0) break
    done[u] = true
    for (const v of NAV_EDGES[u]) {
      const d = dist[u] + Math.hypot(NAV[u].x - NAV[v].x, NAV[u].z - NAV[v].z)
      if (d < dist[v]) {
        dist[v] = d
        prev[v] = u
      }
    }
  }
  let best = -1
  let bestD = Infinity
  for (const e of ends) {
    const d = dist[e] + Math.hypot(NAV[e].x - to.x, NAV[e].z - to.z)
    if (d < bestD) {
      bestD = d
      best = e
    }
  }
  if (best < 0) return [{ x: to.x, z: to.z }]
  const path = []
  for (let v = best; v >= 0; v = prev[v]) path.unshift({ x: NAV[v].x, z: NAV[v].z })
  // (skip the nodes a straight line can cut past)
  const out = []
  let at = from
  for (let i = 0; i < path.length; i++) {
    const next = path[i + 1] || to
    if (!open(at, next)) {
      out.push(path[i])
      at = path[i]
    }
  }
  out.push({ x: to.x, z: to.z })
  return out
}

// A pose worked out in a court's frame (anim.js on a match player), in the world's: points
// moved and turned, directions turned, yaws a quarter turn on (layout.js toWorld)
const DIRS = new Set(["pelvisRight", "spine", "chestRight", "chestForward", "look", "bendP", "bendO"])
const xfPoint = (v, c) => {
  const o = { ...v, x: c.x + v.z, z: c.z - v.x }
  if (v.yaw !== undefined) o.yaw = v.yaw + Math.PI / 2
  // (a planted foot's pin, the ball of the foot: a point too)
  if (v.pin && v.pin.x !== undefined) o.pin = xfPoint(v.pin, c)
  return o
}
const xfDir = (v) => ({ ...v, x: v.z, z: -v.x })
export const poseToWorld = (pose, c) => {
  const out = {}
  for (const k in pose) {
    const v = pose[k]
    if (k === "yaw") out.yaw = v + Math.PI / 2
    else if (k === "paddle" && v) out.paddle = { ...v, grip: xfPoint(v.grip, c), face: xfPoint(v.face, c), axis: xfDir(v.axis), normal: xfDir(v.normal) }
    else if (k === "info" || !v || typeof v !== "object" || v.x === undefined || v.z === undefined) out[k] = v
    else out[k] = DIRS.has(k) ? xfDir(v) : xfPoint(v, c)
  }
  return out
}
