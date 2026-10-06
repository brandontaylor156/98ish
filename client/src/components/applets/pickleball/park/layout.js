// My Park: where everything is (pure data and geometry, no three.js; Node-tested).
//
// makeLayout(spec) turns a layout spec (Riverside Park below, or a real venue from venuegen.js)
// into everything the park needs: the courts with their gates, racks and bleachers, the solid
// things (oriented boxes and circles), seats, the things you can do, a walking graph, and the
// functions that use them (resolve, segmentHit, route, nearestAction ...). One layout is
// "active" (setLayout); the module's named exports (COURTS, BOXES, resolve ...) are live
// bindings to it, so the rest of the park reads whichever venue you're at.
//
// World frame: meters, y up (a real venue: x east, z south). A court's match runs in the
// court's own frame (match.js: the net along local x, the length along local z); the court's
// group is turned by `rot` about y: local (x, z) is world (cx + x cos rot + z sin rot,
// cz - x sin rot + z cos rot), and a local yaw is world yaw + rot. Riverside's courts are a
// quarter turn (rot = pi/2): local (x, z) is world (cx + z, cz - x).

import { HALF_L, HALF_W } from "../physics.js"

export const PEN = { hx: HALF_L + 3.2, hz: HALF_W + 2.0, h: 3 } // Riverside's pens: half sizes (along the court, across it) and fence height
export const PATH_W = 3.2 // Riverside's main path
export const LEVEL_NAMES = { beginner: "Rookie", intermediate: "Club", pro: "Pro", legend: "Legend" }
const LEVELS = ["beginner", "intermediate", "intermediate", "pro"]

// seats on a court's bleachers (two rows of 8; the front row is nearer the court and lower)
export const SEAT_ROWS = [
  { off: 0.3, y: 0.45 },
  { off: -0.32, y: 0.85 },
]

const snap = (v) => (Math.abs(v) < 1e-12 ? 0 : Math.abs(v - 1) < 1e-12 ? 1 : Math.abs(v + 1) < 1e-12 ? -1 : v)
const unit = (x, z) => {
  const d = Math.hypot(x, z) || 1
  return { x: snap(x / d), z: snap(z / d) }
}
// a yaw (0: facing +z) that looks along (x, z)
const yawAlong = (x, z) => Math.atan2(x || 0, z)

// an oriented box: center, half sizes along its own x (ux, uz) and z (-uz, ux), height
export const obb = ({ cx, cz, hx, hz, ux = 1, uz = 0, h = 3, ...rest }) => {
  ux = snap(ux)
  uz = snap(uz)
  // (the axis-aligned bounds, for quick tests)
  const ex = Math.abs(ux) * hx + Math.abs(uz) * hz
  const ez = Math.abs(uz) * hx + Math.abs(ux) * hz
  return { ...rest, cx, cz, hx, hz, ux, uz, h, x0: cx - ex, x1: cx + ex, z0: cz - ez, z1: cz + ez }
}
const boxFromAabb = (x0, x1, z0, z1, h, rest = {}) => ({ ...obb({ cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, hx: (x1 - x0) / 2, hz: (z1 - z0) / 2, h, ...rest }), x0, x1, z0, z1 })

// ---------- a court's frame ----------
const frameOf = (rot) => {
  const s = snap(Math.sin(rot))
  const c = snap(Math.cos(rot))
  return { s, c }
}
export const toWorld = (court, x, z) => {
  const { s, c } = court.f || frameOf(court.rot ?? Math.PI / 2)
  return { x: court.x + x * c + z * s, z: court.z - x * s + z * c }
}
export const toLocal = (court, x, z) => {
  const { s, c } = court.f || frameOf(court.rot ?? Math.PI / 2)
  const dx = x - court.x
  const dz = z - court.z
  return { x: dx * c - dz * s, z: dx * s + dz * c }
}
// a direction (no translation) from a court's frame into the world's
export const dirToWorld = (court, x, z) => {
  const { s, c } = court.f || frameOf(court.rot ?? Math.PI / 2)
  return { x: x * c + z * s, z: -x * s + z * c }
}
export const yawToWorld = (yaw, court = null) => yaw + (court ? court.rot ?? Math.PI / 2 : Math.PI / 2)

// A pose worked out in a court's frame (anim.js on a match player), in the world's: points
// moved and turned, directions turned, yaws turned (by the court's rot)
const DIRS = new Set(["pelvisRight", "spine", "chestRight", "chestForward", "look", "bendP", "bendO"])
const xfPoint = (v, court) => {
  const w = toWorld(court, v.x, v.z)
  const o = { ...v, x: w.x, z: w.z }
  if (v.yaw !== undefined) o.yaw = v.yaw + (court.rot ?? Math.PI / 2)
  // (a planted foot's pin, the ball of the foot: a point too)
  if (v.pin && v.pin.x !== undefined) o.pin = xfPoint(v.pin, court)
  return o
}
const xfDir = (v, court) => {
  const w = dirToWorld(court, v.x, v.z)
  return { ...v, x: w.x, z: w.z }
}
export const poseToWorld = (pose, court) => {
  const out = {}
  for (const k in pose) {
    const v = pose[k]
    if (k === "yaw") out.yaw = v + (court.rot ?? Math.PI / 2)
    else if (k === "paddle" && v) out.paddle = { ...v, grip: xfPoint(v.grip, court), face: xfPoint(v.face, court), axis: xfDir(v.axis, court), normal: xfDir(v.normal, court) }
    else if (k === "info" || !v || typeof v !== "object" || v.x === undefined || v.z === undefined) out[k] = v
    else out[k] = DIRS.has(k) ? xfDir(v, court) : xfPoint(v, court)
  }
  return out
}

// ---------- Riverside Park (the original, hand-made park) ----------
// The courts run east-west, four of them in two rows either side of the main path (z = 0),
// each in its own fenced pen with a gate onto the path, a paddle rack beside the gate and
// bleachers between the pen and the path (a sideline view). The pro shop (Locker Room) is on
// the west plaza, where you arrive; the ball-machine court closes the path's east end;
// benches under the trees along the north and south edges; a fountain in the middle.
const RIVERSIDE_COURTS = [
  { id: 0, name: "Court 1", level: "beginner", x: -12, z: -8.2 },
  { id: 1, name: "Court 2", level: "intermediate", x: 12, z: -8.2 },
  { id: 2, name: "Court 3", level: "intermediate", x: -12, z: 8.2 },
  { id: 3, name: "Court 4", level: "pro", x: 12, z: 8.2 },
]
const RIVERSIDE_BENCHES = [
  { id: "bw0", x: -29.6, z: 6.5, yaw: Math.PI / 2 },
  { id: "bw1", x: -29.6, z: -9.5, yaw: Math.PI / 2 },
  { id: "bc0", x: -1.3, z: -9.5, yaw: Math.PI / 2 },
  { id: "bc1", x: 1.3, z: 9.5, yaw: -Math.PI / 2 },
  { id: "be0", x: 31, z: -9.8, yaw: 0 },
  { id: "be1", x: 41, z: -9.8, yaw: 0 },
  { id: "be2", x: 31, z: 9.8, yaw: Math.PI },
  { id: "be3", x: 41, z: 9.8, yaw: Math.PI },
]
const riversideTrees = () => {
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
  for (const b of RIVERSIDE_BENCHES) out.push({ x: b.x - Math.sin(b.yaw) * 0.9 + Math.cos(b.yaw) * 1.5, z: b.z - Math.cos(b.yaw) * 0.9 - Math.sin(b.yaw) * 1.5, s: 0.9 + rnd() * 0.3 })
  return out
}
export const RIVERSIDE = {
  id: "riverside",
  name: "Riverside Park",
  kind: "riverside", // (build.js draws Riverside's own plazas, fountain and paths)
  bounds: { x0: -30.5, x1: 47.5, z0: -15.5, z1: 15.5 },
  courts: RIVERSIDE_COURTS.map((c) => {
    const s = Math.sign(c.z) // -1: north row (its fence on the path side faces south)
    const toward = -Math.sign(c.x) // toward the middle of the park
    // out: from the court to its gate side (the path); the gate along the fence, toward the middle
    const out = { x: 0, z: -s }
    const tangent = { x: out.z, z: -out.x }
    return { ...c, rot: Math.PI / 2, hx: PEN.hx, hz: PEN.hz, out, gate: (toward * (PEN.hx - 2.4)) * (tangent.x || tangent.z), bleacher: 7, view: out, baseE: c.x >= 0 ? 1 : -1 }
  }),
  machine: { x: 36, z: 0, rot: Math.PI / 2, hx: PEN.hx, hz: PEN.hz, out: { x: -1, z: 0 }, gate: 0 },
  booth: { x: -27, z: 0, hx: 2, hz: 1.6, h: 3.2, face: { x: 1, z: 0 } },
  spawn: { x: -18.6, z: 0.6, yaw: Math.PI / 2 },
  fountain: { x: 0, z: 0, r: 0.95 },
  board: { x: -25.6, z: -5.6, yaw: Math.PI / 2, w: 3.2, h: 2 },
  benches: RIVERSIDE_BENCHES,
  trees: riversideTrees(),
  // light poles at each pen's corners
  lights: "pens",
  waypoints: [
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
  ],
  // A small graph of open spots (the path, the gaps between pens, the corridors along the edges)
  nav: [
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
  ],
  navLink: 16,
}

// ---------- makeLayout ----------
// spec: { id, name, kind?, bounds, courts: [court], machine?, booth, spawn, fountain?, board?,
//   benches, trees, lights ("pens" | [{ x, z }]), boxes? (more solid things: { cx, cz, hx,
//   hz, ux, uz, h, kind }), circles?, waypoints, nav, navLink?, scene? (what only build.js
//   reads) }
// court: { id, name, level, x, z, rot, hx, hz (pen half sizes along / across the court), out
//   (unit: from the court toward its gate side), gate (offset along the fence, along the
//   tangent (out.z, -out.x)), bleacher (length, 0: none), view (unit: the side the sideline
//   camera watches from), baseE (+1 / -1: which baseline the baseline camera is behind) }
export const makeLayout = (spec) => {
  const bounds = spec.bounds
  // a court's derived spots: the fence on its gate side, the gate, just inside and outside
  // it, the rack beside it, the bleachers beyond it
  const derive = (c, i) => {
    const f = frameOf(c.rot)
    const u = { x: f.s, z: f.c } // along the court (its local +z)
    const w = { x: f.c, z: -f.s } // across it (its local +x)
    const out = unit(c.out.x, c.out.z)
    // how far the fence is from the middle along `out`, and the pen's half length along the fence
    const alongOut = Math.abs(out.x * u.x + out.z * u.z) > 0.7
    const dOut = alongOut ? c.hx : c.hz
    const tangent = { x: out.z, z: -out.x }
    const fence = { x: c.x + out.x * dOut, z: c.z + out.z * dOut }
    const g = c.gate ?? 0
    const gate = { x: fence.x + tangent.x * g, z: fence.z + tangent.z * g }
    const tg = Math.sign(g) || 1
    const ba = tangent.x > 1e-9 || (Math.abs(tangent.x) <= 1e-9 && tangent.z > 0) ? tangent : { x: -tangent.x, z: -tangent.z } // (the bleachers' seats run along +x or +z)
    const bleacherLen = c.bleacher ?? 7
    const shift = c.bleacherShift || 0
    const bleacher = bleacherLen > 0 ? { x: fence.x + out.x * 0.95 + tangent.x * shift, z: fence.z + out.z * 0.95 + tangent.z * shift, len: bleacherLen, yaw: yawAlong(-out.x, -out.z), ax: ba.x, az: ba.z } : null
    return {
      id: c.id ?? i,
      name: c.name || `Court ${i + 1}`,
      level: c.level || LEVELS[i % LEVELS.length],
      x: c.x,
      z: c.z,
      rot: c.rot,
      f,
      u,
      w,
      hx: c.hx,
      hz: c.hz,
      out,
      // (Riverside's: -1 north row, +1 south row; the side of the path the court is on)
      side: -Math.sign(out.z) || -Math.sign(out.x) || 1,
      outYaw: yawAlong(out.x, out.z),
      fence,
      fenceZ: fence.z,
      gate,
      inside: { x: gate.x - out.x * 0.9, z: gate.z - out.z * 0.9 },
      outside: { x: gate.x + out.x * 1.0, z: gate.z + out.z * 1.0 },
      rack: { x: gate.x + tangent.x * tg * 1.5 + out.x * 0.55, z: gate.z + tangent.z * tg * 1.5 + out.z * 0.55 },
      rackAlong: { x: ba.x, z: ba.z },
      bleacher,
      view: unit((c.view || out).x, (c.view || out).z),
      baseE: c.baseE ?? 1,
      decor: c.decor || null,
    }
  }
  const COURTS = spec.courts.map(derive)
  const MACHINE_COURT = spec.machine ? { ...derive({ ...spec.machine, bleacher: 0, name: "Ball Machine" }, -1), id: "machine" } : null
  const BOOTH = spec.booth ? { face: { x: 1, z: 0 }, ...spec.booth } : null
  const SPAWN = spec.spawn
  const FOUNTAIN = spec.fountain || null
  const BOARD = spec.board || null
  const BENCHES = spec.benches || []
  const TREES = spec.trees || []

  const bleacherSeats = (c) => {
    const b = c.bleacher
    if (!b) return []
    const out = []
    // (seats: across the stand along its length; the rows toward / away from the court)
    const nIn = { x: -c.out.x, z: -c.out.z }
    const per = Math.max(2, Math.min(8, Math.round((b.len - 0.9) / 0.85) + 1))
    SEAT_ROWS.forEach((row, r) => {
      for (let i = 0; i < per; i++) {
        const along = -b.len / 2 + 0.45 + (i * (b.len - 0.9)) / (per - 1)
        out.push({ id: `c${c.id}r${r}s${i}`, court: c.id, x: b.x + b.ax * along + nIn.x * row.off, y: row.y, z: b.z + b.az * along + nIn.z * row.off, yaw: b.yaw, row: r, along })
      }
    })
    return out
  }
  const benchSeats = (b) => [-0.45, 0.45].map((d, i) => ({ id: `${b.id}s${i}`, bench: b.id, x: b.x + d * Math.cos(b.yaw), y: 0.45, z: b.z - d * Math.sin(b.yaw), yaw: b.yaw }))
  const ALL_SEATS = [...COURTS.flatMap(bleacherSeats), ...BENCHES.flatMap(benchSeats), ...(spec.seats || [])]
  const courtOf = (id) => COURTS.find((k) => k.id === id) || null
  // where someone stands to take a seat: a bench from the front; a bleacher from behind (the
  // path side), stepping up onto it
  const seatApproach = (seat) => {
    // (a seat that says where you step up to it: bar stools, chairs at a table)
    if (seat.approach) return seat.approach
    if (seat.court !== undefined && seat.court !== null) {
      const c = courtOf(seat.court)
      const b = c.bleacher
      return { x: b.x + b.ax * seat.along + c.out.x * 0.85, z: b.z + b.az * seat.along + c.out.z * 0.85 }
    }
    return { x: seat.x + Math.sin(seat.yaw) * 0.62, z: seat.z + Math.cos(seat.yaw) * 0.62 }
  }

  const LIGHTS =
    spec.lights === "pens"
      ? [...COURTS, ...(MACHINE_COURT ? [MACHINE_COURT] : [])].flatMap((c) => [-1, 1].flatMap((sx) => [-1, 1].map((sz) => ({ x: c.x + sx * (c.hx + 0.3), z: c.z + sz * (c.hz + 0.3) }))))
      : spec.lights || []

  // ---------- collisions ----------
  // oriented boxes (the pens, the booth, bleachers, the board, benches, buildings) and circles
  // (the fountain, trunks, poles)
  const penBox = (c, court) => obb({ cx: c.x, cz: c.z, hx: c.hx, hz: c.hz, ux: c.u.x, uz: c.u.z, h: c.penH ?? PEN.h, kind: "pen", court })
  const BOXES = [
    ...(spec.penBoxes === false ? [] : COURTS.map((c) => penBox(c, c.id))),
    ...(MACHINE_COURT && spec.penBoxes !== false ? [penBox(MACHINE_COURT, "machine")] : []),
    ...(BOOTH ? [obb({ cx: BOOTH.x, cz: BOOTH.z, hx: BOOTH.hx, hz: BOOTH.hz, ux: BOOTH.face.x, uz: BOOTH.face.z, h: BOOTH.h, kind: "booth" })] : []),
    ...COURTS.filter((c) => c.bleacher).map((c) => {
      const b = c.bleacher
      return obb({ cx: b.x, cz: b.z, hx: b.len / 2, hz: 0.55, ux: b.ax, uz: b.az, h: 1.1, kind: "bleacher", court: c.id })
    }),
    ...(BOARD ? [obb({ cx: BOARD.x, cz: BOARD.z, hx: 0.2, hz: BOARD.w / 2, ux: Math.sin(BOARD.yaw), uz: Math.cos(BOARD.yaw), h: 3, kind: "board" })] : []),
    ...BENCHES.map((b) => obb({ cx: b.x, cz: b.z, hx: 0.75, hz: 0.25, ux: Math.cos(b.yaw), uz: -Math.sin(b.yaw), h: 0.5, kind: "bench" })),
    ...(spec.boxes || []).map((b) => obb(b)),
  ]
  const CIRCLES = [...(FOUNTAIN ? [{ x: FOUNTAIN.x, z: FOUNTAIN.z, r: FOUNTAIN.r }] : []), ...TREES.map((t) => ({ x: t.x, z: t.z, r: t.r ?? 0.3 })), ...LIGHTS.map((l) => ({ x: l.x, z: l.z, r: 0.15 })), ...(spec.circles || [])]

  // (a quick grid of which boxes are near: venues have lots of them)
  const CELL = 8
  const grid = new Map()
  const cellKey = (i, j) => i * 100003 + j
  BOXES.forEach((b, k) => {
    for (let i = Math.floor(b.x0 / CELL) - 1; i <= Math.floor(b.x1 / CELL) + 1; i++)
      for (let j = Math.floor(b.z0 / CELL) - 1; j <= Math.floor(b.z1 / CELL) + 1; j++) {
        const key = cellKey(i, j)
        if (!grid.has(key)) grid.set(key, [])
        grid.get(key).push(k)
      }
  })
  const circleGrid = new Map()
  CIRCLES.forEach((c, k) => {
    const key = cellKey(Math.floor(c.x / CELL), Math.floor(c.z / CELL))
    if (!circleGrid.has(key)) circleGrid.set(key, [])
    circleGrid.get(key).push(k)
  })
  const many = BOXES.length + CIRCLES.length > 120
  const boxesNear = (x, z) => {
    if (!many) return BOXES
    const list = grid.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)))
    return list ? list.map((k) => BOXES[k]) : []
  }
  const circlesNear = (x, z) => {
    if (!many) return CIRCLES
    const out = []
    const i0 = Math.floor(x / CELL)
    const j0 = Math.floor(z / CELL)
    for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) for (const k of circleGrid.get(cellKey(i, j)) || []) out.push(CIRCLES[k])
    return out
  }
  const inBoxPadded = (o, px, pz, r) => {
    const dx = px - o.cx
    const dz = pz - o.cz
    const lx = dx * o.ux + dz * o.uz
    const lz = -dx * o.uz + dz * o.ux
    return lx > -o.hx - r && lx < o.hx + r && lz > -o.hz - r && lz < o.hz + r
  }

  // pushes a circle (x, z, radius r) out of everything solid and inside the park
  const resolve = (x, z, r = 0.35) => {
    for (let pass = 0; pass < 2; pass++) {
      for (const b of boxesNear(x, z)) {
        const dx = x - b.cx
        const dz = z - b.cz
        const lx = dx * b.ux + dz * b.uz
        const lz = -dx * b.uz + dz * b.ux
        const clx = Math.max(-b.hx, Math.min(b.hx, lx))
        const clz = Math.max(-b.hz, Math.min(b.hz, lz))
        const ex = lx - clx
        const ez = lz - clz
        const d = Math.hypot(ex, ez)
        if (d >= r) continue
        let nx
        let nz
        if (d > 1e-6) {
          nx = clx + (ex / d) * r
          nz = clz + (ez / d) * r
        } else {
          // inside the box: out the nearest side that isn't into something else
          const outs = [
            [-b.hx - r - lx, 0],
            [b.hx + r - lx, 0],
            [0, -b.hz - r - lz],
            [0, b.hz + r - lz],
          ].sort((a, c) => Math.abs(a[0]) + Math.abs(a[1]) - Math.abs(c[0]) - Math.abs(c[1]))
          const toW = (ax, az) => ({ x: b.cx + ax * b.ux - az * b.uz, z: b.cz + ax * b.uz + az * b.ux })
          const free = (ax, az) => {
            const p = toW(ax, az)
            return !boxesNear(p.x, p.z).some((o) => o !== b && inBoxPadded(o, p.x, p.z, r))
          }
          const out = outs.find(([ox, oz]) => free(lx + ox, lz + oz)) || outs[0]
          nx = lx + out[0]
          nz = lz + out[1]
        }
        x = b.cx + nx * b.ux - nz * b.uz
        z = b.cz + nx * b.uz + nz * b.ux
      }
      for (const c of circlesNear(x, z)) {
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
      x = Math.max(bounds.x0, Math.min(bounds.x1, x))
      z = Math.max(bounds.z0, Math.min(bounds.z1, z))
    }
    return { x, z }
  }
  const blocked = (x, z, r = 0.3) => {
    const p = resolve(x, z, r)
    return Math.hypot(p.x - x, p.z - z) > 1e-3
  }

  // The first solid thing a segment from a to b (on the ground plane) runs into below height
  // h: the fraction along it (0..1), or null. (The follow camera stays on this side of fences.)
  const segBoxes = (a, b) => {
    if (!many) return BOXES
    const seen = new Set()
    const out = []
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / (CELL / 2)))
    for (let k = 0; k <= n; k++) {
      const x = a.x + ((b.x - a.x) * k) / n
      const z = a.z + ((b.z - a.z) * k) / n
      for (const o of boxesNear(x, z))
        if (!seen.has(o)) {
          seen.add(o)
          out.push(o)
        }
    }
    return out
  }
  const segmentHit = (a, b, h = 0, pad = 0) => {
    let best = null
    for (const box of segBoxes(a, b)) {
      if (box.h <= h) continue
      const ax = a.x - box.cx
      const az = a.z - box.cz
      const bx = b.x - box.cx
      const bz = b.z - box.cz
      const la = { x: ax * box.ux + az * box.uz, z: -ax * box.uz + az * box.ux }
      const lb = { x: bx * box.ux + bz * box.uz, z: -bx * box.uz + bz * box.ux }
      // (starting inside the padding, beside a fence: only the box itself counts)
      if (pad > 0 && la.x > -box.hx - pad && la.x < box.hx + pad && la.z > -box.hz - pad && la.z < box.hz + pad) {
        const t = slab(la, lb, box, 0)
        if (t !== null && (best === null || t < best)) best = t
        continue
      }
      const t = slab(la, lb, box, pad)
      if (t !== null && (best === null || t < best)) best = t
    }
    return best
  }
  const slab = (la, lb, box, pad) => {
    const dx = lb.x - la.x
    const dz = lb.z - la.z
    let t0 = 0
    let t1 = 1
    for (const [p, d, lo, hi] of [
      [la.x, dx, -box.hx - pad, box.hx + pad],
      [la.z, dz, -box.hz - pad, box.hz + pad],
    ]) {
      if (Math.abs(d) < 1e-9) {
        if (p < lo || p > hi) return null
        continue
      }
      let u0 = (lo - p) / d
      let u1 = (hi - p) / d
      if (u0 > u1) [u0, u1] = [u1, u0]
      t0 = Math.max(t0, u0)
      t1 = Math.min(t1, u1)
      if (t0 > t1) return null
    }
    return t0
  }

  // ---------- things you can do ----------
  // Each has a spot and a reach; the nearest one in reach is the context button.
  const INTERACTABLES = [
    ...COURTS.map((c) => {
      // (no bleachers: watch from just outside the gate)
      const at = c.bleacher ? { x: c.bleacher.x + c.out.x * 1.0, z: c.bleacher.z + c.out.z * 1.0 } : { x: c.outside.x - c.rackAlong.x * 1.6 + c.out.x * 0.6, z: c.outside.z - c.rackAlong.z * 1.6 + c.out.z * 0.6 }
      return { id: `watch${c.id}`, kind: "watch", court: c.id, x: at.x, z: at.z, r: c.bleacher ? 4.2 : 2.6, label: "Watch" }
    }),
    ...COURTS.map((c) => ({ id: `rack${c.id}`, kind: "rack", court: c.id, x: c.rack.x + c.out.x * 0.6, z: c.rack.z + c.out.z * 0.6, r: 1.9, label: "Call next" })),
    ...(BOOTH ? [{ id: "locker", kind: "locker", x: BOOTH.x + BOOTH.face.x * (BOOTH.hx + 0.9), z: BOOTH.z + BOOTH.face.z * (BOOTH.hx + 0.9), r: 2.2, label: "Locker Room" }] : []),
    ...(MACHINE_COURT ? [{ id: "machine", kind: "machine", x: MACHINE_COURT.gate.x + MACHINE_COURT.out.x * 1.0, z: MACHINE_COURT.gate.z + MACHINE_COURT.out.z * 1.0, r: 2.4, label: "Ball Machine" }] : []),
    ...BENCHES.map((b) => ({ id: `sit-${b.id}`, kind: "sit", bench: b.id, x: b.x + Math.sin(b.yaw) * 0.9, z: b.z + Math.cos(b.yaw) * 0.9, r: 1.6, label: "Sit" })),
  ]
  // the thing to offer at (x, z): the nearest in reach (by how far into its reach you are), or null
  const nearestAction = (x, z, list = INTERACTABLES) => {
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

  const WAYPOINTS = spec.waypoints || []
  // a spot facing someone to chat with: a little apart, both turned in
  const chatSpots = (a, b) => {
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
  // A graph of open spots; a walk from a to b goes straight when nothing's in the way,
  // otherwise from node to node (shortest by distance) with the first and last legs straight.
  const NAV = spec.nav || []
  const open = (a, b) => segmentHit(a, b, 0) === null
  const link = spec.navLink || 16
  const NAV_EDGES =
    NAV.length <= 60
      ? NAV.map((a, i) => NAV.map((b, j) => (i !== j && Math.hypot(a.x - b.x, a.z - b.z) < link && open(a, b) ? j : -1)).filter((j) => j >= 0))
      : (() => {
          const cells = new Map()
          const key = (x, z) => Math.floor(x / link) * 100003 + Math.floor(z / link)
          NAV.forEach((p, i) => {
            const k = key(p.x, p.z)
            if (!cells.has(k)) cells.set(k, [])
            cells.get(k).push(i)
          })
          return NAV.map((a, i) => {
            const out = []
            const ci = Math.floor(a.x / link)
            const cj = Math.floor(a.z / link)
            for (let di = -1; di <= 1; di++)
              for (let dj = -1; dj <= 1; dj++)
                for (const j of cells.get((ci + di) * 100003 + (cj + dj)) || []) if (j !== i && Math.hypot(a.x - NAV[j].x, a.z - NAV[j].z) < link && open(a, NAV[j])) out.push(j)
            return out
          })
        })()
  // (nodes a spot can see: the nearest few that are in the clear)
  const visible = (p) => {
    if (NAV.length <= 60) return NAV.map((q, i) => (open(p, q) ? i : -1)).filter((i) => i >= 0)
    const near = NAV.map((q, i) => [i, Math.hypot(q.x - p.x, q.z - p.z)]).sort((a, b) => a[1] - b[1]).slice(0, 14)
    return near.filter(([i]) => open(p, NAV[i])).map(([i]) => i)
  }
  // (a big graph, a real venue's: a binary heap; Riverside's small one: a plain scan)
  const heapPush = (h, d, i) => {
    h.push([d, i])
    let k = h.length - 1
    while (k > 0) {
      const p = (k - 1) >> 1
      if (h[p][0] <= h[k][0]) break
      ;[h[p], h[k]] = [h[k], h[p]]
      k = p
    }
  }
  const heapPop = (h) => {
    const top = h[0]
    const last = h.pop()
    if (h.length) {
      h[0] = last
      let k = 0
      for (;;) {
        const l = 2 * k + 1
        const r = l + 1
        let m = k
        if (l < h.length && h[l][0] < h[m][0]) m = l
        if (r < h.length && h[r][0] < h[m][0]) m = r
        if (m === k) break
        ;[h[m], h[k]] = [h[k], h[m]]
        k = m
      }
    }
    return top
  }
  const route = (from, to) => {
    if (open(from, to)) return [{ x: to.x, z: to.z }]
    const n = NAV.length
    const starts = visible(from)
    const ends = new Set(visible(to))
    if (!starts.length || !ends.size) return [{ x: to.x, z: to.z }]
    const dist = Array(n).fill(Infinity)
    const prev = Array(n).fill(-1)
    const done = Array(n).fill(false)
    for (const s of starts) dist[s] = Math.hypot(NAV[s].x - from.x, NAV[s].z - from.z)
    if (n > 60) {
      const h = []
      for (const s of starts) heapPush(h, dist[s], s)
      while (h.length) {
        const [du, u] = heapPop(h)
        if (done[u] || du > dist[u]) continue
        done[u] = true
        for (const v of NAV_EDGES[u]) {
          const d = du + Math.hypot(NAV[u].x - NAV[v].x, NAV[u].z - NAV[v].z)
          if (d < dist[v]) {
            dist[v] = d
            prev[v] = u
            heapPush(h, d, v)
          }
        }
      }
    } else
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

  return {
    id: spec.id,
    name: spec.name,
    kind: spec.kind || "venue",
    spec,
    BOUNDS: bounds,
    COURTS,
    MACHINE_COURT,
    BOOTH,
    SPAWN,
    FOUNTAIN,
    BOARD,
    BENCHES,
    TREES,
    LIGHTS,
    ALL_SEATS,
    BOXES,
    CIRCLES,
    INTERACTABLES,
    WAYPOINTS,
    NAV,
    NAV_EDGES,
    bleacherSeats,
    benchSeats,
    seatApproach,
    courtById: courtOf,
    resolve,
    blocked,
    segmentHit,
    nearestAction,
    chatSpots,
    route,
  }
}

// ---------- the active layout (live bindings) ----------
export let ACTIVE = null
export let BOUNDS
export let COURTS
export let MACHINE_COURT
export let BOOTH
export let SPAWN
export let FOUNTAIN
export let BOARD
export let BENCHES
export let TREES
export let LIGHTS
export let ALL_SEATS
export let BOXES
export let CIRCLES
export let INTERACTABLES
export let WAYPOINTS
export let NAV
export const setLayout = (L) => {
  ACTIVE = L
  ;({ BOUNDS, COURTS, MACHINE_COURT, BOOTH, SPAWN, FOUNTAIN, BOARD, BENCHES, TREES, LIGHTS, ALL_SEATS, BOXES, CIRCLES, INTERACTABLES, WAYPOINTS, NAV } = L)
  return L
}
export const RIVERSIDE_LAYOUT = makeLayout(RIVERSIDE)
setLayout(RIVERSIDE_LAYOUT)

export const bleacherSeats = (c) => ACTIVE.bleacherSeats(c)
export const benchSeats = (b) => ACTIVE.benchSeats(b)
export const seatApproach = (seat) => ACTIVE.seatApproach(seat)
export const courtById = (id) => ACTIVE.courtById(id)
export const resolve = (x, z, r) => ACTIVE.resolve(x, z, r)
export const blocked = (x, z, r) => ACTIVE.blocked(x, z, r)
export const segmentHit = (a, b, h, pad) => ACTIVE.segmentHit(a, b, h, pad)
export const nearestAction = (x, z, list) => ACTIVE.nearestAction(x, z, list)
export const chatSpots = (a, b) => ACTIVE.chatSpots(a, b)
export const route = (from, to) => ACTIVE.route(from, to)
