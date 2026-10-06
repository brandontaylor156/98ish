// My Park: the prop kit and the room kit's furniture (pure: Node-tested; props.js draws them).
//
// A prop is { t: type, x, z, a (yaw, radians: its front faces +z turned by a), ...params }:
// the types are in PROPS (size, whether you bump into it, its parts are props.js's). Real
// venues list props in their spec (overrides "props"), and every room of the room kit gets
// furniture from a preset for its type (furnishRoom) unless it lists its own.
//
// A room is { id, type, name, p (polygon, x east / z south, metres), h (ceiling), floor, wall,
// ceiling, wainscot (lower-wall color), doors: [{ x, z, w, kind }], furnish (false: none),
// props: [] (extra props in venue coordinates), gender ("m" | "f": locker rooms, restrooms) }.
// Door kinds: "glass" (entry, sliding glass), "double" (glass doubles), "open" (an archway),
// "wood", "restroom", "sauna" (glass), "rollup", "closed" (a door drawn shut: no way through).

// type -> { w, d, h (metres, unrotated: w across x, d along z), solid (bumped into), r (solid as
// a circle of radius r instead of a box), wall (stands against a wall: its back at -d/2) }
export const PROPS = {
  bench: { w: 1.8, d: 0.55, h: 0.85, solid: true },
  picnic: { w: 1.8, d: 1.6, h: 0.8, solid: true },
  chair: { w: 0.5, d: 0.5, h: 0.9 },
  stool: { w: 0.42, d: 0.42, h: 0.78 },
  table: { w: 0.9, d: 0.9, h: 0.76, r: 0.45, solid: true },
  tablesq: { w: 1.0, d: 1.0, h: 0.76, solid: true },
  lounger: { w: 0.7, d: 1.9, h: 0.5, solid: true },
  umbrella: { w: 2.6, d: 2.6, h: 2.5, r: 0.1, solid: true },
  tent: { w: 3, d: 3, h: 2.9, r: 0.08, solid: false },
  cabana: { w: 3, d: 3, h: 2.8, r: 0.1, solid: true },
  fountain: { w: 0.5, d: 0.45, h: 1.0, solid: true, wall: true },
  filler: { w: 0.6, d: 0.35, h: 1.6, solid: true, wall: true },
  vending: { w: 1.0, d: 0.85, h: 1.85, solid: true, wall: true },
  bin: { w: 0.55, d: 0.55, h: 0.95, r: 0.28, solid: true },
  recycle: { w: 0.55, d: 0.55, h: 0.95, r: 0.28, solid: true },
  waitboard: { w: 2.2, d: 0.35, h: 1.9, solid: true },
  paddlerack: { w: 1.2, d: 0.3, h: 1.1, solid: true },
  courtsign: { w: 0.5, d: 0.1, h: 2.2, r: 0.06, solid: true },
  scoreboard: { w: 0.9, d: 0.2, h: 1.5, r: 0.08, solid: true },
  machine: { w: 0.6, d: 0.6, h: 0.9, solid: true },
  bleacher: { w: 4.5, d: 1.8, h: 1.3, solid: true },
  spa: { w: 3.2, d: 3.2, h: 0.55, r: 1.6, solid: true },
  treadmill: { w: 0.85, d: 2.0, h: 1.45, solid: true },
  bike: { w: 0.6, d: 1.3, h: 1.3, solid: true },
  elliptical: { w: 0.7, d: 1.9, h: 1.7, solid: true },
  powerrack: { w: 1.4, d: 1.5, h: 2.3, solid: true },
  weightbench: { w: 0.6, d: 1.4, h: 0.55, solid: true },
  dumbbells: { w: 2.4, d: 0.7, h: 0.9, solid: true, wall: true },
  mirror: { w: 3, d: 0.05, h: 2.1, wall: true },
  mat: { w: 2, d: 1.2, h: 0.03 },
  lockers: { w: 2.4, d: 0.5, h: 1.95, solid: true, wall: true },
  sink: { w: 2.4, d: 0.6, h: 2.1, solid: true, wall: true },
  stall: { w: 1.0, d: 1.6, h: 2.0, solid: true, wall: true },
  shower: { w: 1.1, d: 1.1, h: 2.2, solid: true, wall: true },
  saunabench: { w: 2.4, d: 1.3, h: 0.95, solid: true, wall: true },
  heater: { w: 0.6, d: 0.5, h: 0.8, solid: true, wall: true },
  tilebench: { w: 2.4, d: 0.5, h: 0.45, solid: true, wall: true },
  desk: { w: 3.2, d: 0.9, h: 1.1, solid: true },
  officedesk: { w: 1.6, d: 0.8, h: 0.76, solid: true },
  shelf: { w: 1.8, d: 0.5, h: 2.0, solid: true, wall: true },
  paddlewall: { w: 3.0, d: 0.15, h: 2.2, solid: true, wall: true },
  sofa: { w: 2.1, d: 0.9, h: 0.85, solid: true },
  armchair: { w: 0.9, d: 0.85, h: 0.85, solid: true },
  coffeetable: { w: 1.2, d: 0.6, h: 0.42, solid: true },
  tv: { w: 1.5, d: 0.08, h: 0.88, wall: true },
  rug: { w: 3, d: 2, h: 0.01 },
  plant: { w: 0.6, d: 0.6, h: 1.4, r: 0.3, solid: true },
  planter: { w: 2.0, d: 0.8, h: 0.9, solid: true },
  counter: { w: 3.0, d: 0.75, h: 1.08, solid: true },
  backbar: { w: 3.0, d: 0.45, h: 2.3, solid: true, wall: true },
  stairs: { w: 1.6, d: 4.0, h: 2.8 },
  partition: { w: 2.0, d: 0.06, h: 1.1, solid: true },
  glasswall: { w: 2.0, d: 0.06, h: 2.4, solid: true },
  kidsmat: { w: 2, d: 2, h: 0.04 },
  toybox: { w: 0.9, d: 0.5, h: 0.5, solid: true, wall: true },
  smalltable: { w: 0.8, d: 0.6, h: 0.5, solid: true },
  door: { w: 1.0, d: 0.1, h: 2.2, wall: true },
  lobbyfountain: { w: 2.4, d: 2.4, h: 1.9, r: 1.25, solid: true },
  pooltable: { w: 1.4, d: 2.6, h: 0.85, solid: true },
  flagpole: { w: 0.3, d: 0.3, h: 9, r: 0.12, solid: true },
  hoop: { w: 1.9, d: 1.4, h: 3.9, solid: true, wall: true },
  massagebed: { w: 0.8, d: 2.0, h: 0.75, solid: true },
  startblock: { w: 0.5, d: 0.6, h: 0.75, solid: true },
  pingpong: { w: 1.53, d: 2.74, h: 0.92, solid: true },
}

// a prop's solid footprint -> a layout box { cx, cz, hx, hz, ux, uz, h } or a circle { x, z, r }, or null
export const propSolid = (pr) => {
  const T = PROPS[pr.t]
  // (up on a mezzanine or a roof: nothing to bump into on the floor)
  if (!T || pr.solid === false || (!T.solid && !pr.solid) || (pr.y || 0) > 2.2) return null
  if (T.r) return { x: pr.x, z: pr.z, r: T.r * (pr.s || 1) }
  const w = (pr.w ?? T.w) * (pr.s || 1)
  const d = (pr.d ?? T.d) * (pr.s || 1)
  const a = pr.a || 0
  // (the prop's x axis in the world: (cos a, -sin a); a box's u axis is its long side)
  return { cx: pr.x, cz: pr.z, hx: w / 2 + 0.05, hz: d / 2 + 0.05, ux: Math.cos(a), uz: -Math.sin(a), h: (pr.h ?? T.h) * (pr.s || 1), kind: "prop" }
}

// ---------- rooms ----------
// a room's colors and height by type (anything can be overridden in the spec)
export const ROOM_LOOK = {
  lobby: { h: 3.6, floor: "#cdbfa8", wall: "#efe9de", ceiling: "#f4f2ec", wainscot: null },
  proshop: { h: 3.4, floor: "#bfae94", wall: "#f1ede4", ceiling: "#f4f2ec" },
  cafe: { h: 3.4, floor: "#9b7a58", wall: "#efe6d6", ceiling: "#f2efe8", wainscot: "#5a3a26" },
  bar: { h: 3.4, floor: "#6e5440", wall: "#e9dfcd", ceiling: "#2e2a28", wainscot: "#3e2a1e" },
  lounge: { h: 3.4, floor: "#a9927a", wall: "#efe9de", ceiling: "#f4f2ec" },
  gym: { h: 4.2, floor: "#2d3033", wall: "#e9e9e6", ceiling: "#f1f1ef" },
  locker: { h: 3.0, floor: "#c9c6bd", wall: "#e6e2d8", ceiling: "#f1f0ec", wainscot: "#b7c7cf" },
  restroom: { h: 3.0, floor: "#cfccc4", wall: "#ece9e2", ceiling: "#f2f1ee", wainscot: "#9fb6c2" },
  sauna: { h: 2.4, floor: "#a07a4e", wall: "#c99a62", ceiling: "#c39460" },
  steam: { h: 2.5, floor: "#d7dde0", wall: "#cfd8dc", ceiling: "#e2e7e9" },
  kids: { h: 3.0, floor: "#8fc3e0", wall: "#fbf4e2", ceiling: "#f6f4ee", wainscot: "#f4b942" },
  office: { h: 3.0, floor: "#9c9890", wall: "#ebe8e1", ceiling: "#f2f1ee" },
  studio: { h: 4.0, floor: "#c9a77a", wall: "#efeee9", ceiling: "#f2f1ee" },
  racquet: { h: 6.0, floor: "#d6b27c", wall: "#efe6b8", ceiling: "#f4f3ee" },
  basketball: { h: 9.0, floor: "#d2a868", wall: "#e7e3d8", ceiling: "#f0efea" },
  spa: { h: 3.2, floor: "#d9cbb6", wall: "#efe3d2", ceiling: "#f4efe6" },
  hall: { h: 3.2, floor: "#c9bda8", wall: "#ece6da", ceiling: "#f2f0ea" },
  corridor: { h: 3.0, floor: "#c9bda8", wall: "#ece6da", ceiling: "#f2f0ea" },
}

const rnd = (seed) => {
  let s = seed >>> 0 || 1
  return () => ((s = (s * 16807) % 2147483647) / 2147483647)
}
const hashStr = (str) => String(str).split("").reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)

// a polygon's smallest rectangle: axes u (long side), w, and extents
export const roomRect = (p) => {
  let best = null
  for (let i = 0; i < p.length; i++) {
    const a = p[i]
    const b = p[(i + 1) % p.length]
    const L = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (L < 0.3) continue
    const ux = (b[0] - a[0]) / L
    const uz = (b[1] - a[1]) / L
    let u0 = Infinity
    let u1 = -Infinity
    let w0 = Infinity
    let w1 = -Infinity
    for (const [x, z] of p) {
      const u = x * ux + z * uz
      const w = -x * uz + z * ux
      u0 = Math.min(u0, u)
      u1 = Math.max(u1, u)
      w0 = Math.min(w0, w)
      w1 = Math.max(w1, w)
    }
    const area = (u1 - u0) * (w1 - w0)
    if (!best || area < best.area) best = { area, ux, uz, u0, u1, w0, w1 }
  }
  if (!best) return null
  let { ux, uz, u0, u1, w0, w1 } = best
  if (w1 - w0 > u1 - u0) {
    ;[ux, uz] = [-uz, ux]
    ;[u0, u1, w0, w1] = [w0, w1, -u1, -u0]
  }
  return { ux, uz, u0, u1, w0, w1, L: u1 - u0, W: w1 - w0 }
}

// Furniture for a room from its type's preset: props in venue coordinates, kept clear of the
// doors (1.6 m round each) and of each other. Deterministic (seeded by the room's id).
export const furnishRoom = (room) => {
  if (!room.p || room.p.length < 3) return []
  if (room.furnish === false) return [...(room.props || [])]
  const R = roomRect(room.p)
  if (!R) return []
  const rand = rnd(hashStr(room.id || room.type))
  const { ux, uz, u0, u1, w0, w1 } = R
  // local (u, w) -> world; a yaw facing local direction (du, dw)
  const W = (u, w) => ({ x: u * ux - w * uz, z: u * uz + w * ux })
  const yawOf = (du, dw) => {
    const d = W(du, dw)
    return Math.atan2(d.x, d.z)
  }
  const doors = (room.doors || []).map((d) => ({ u: d.x * ux + d.z * uz, w: -d.x * uz + d.z * ux }))
  const out = []
  const boxes = []
  // (an aisle from every door to the middle of the room stays clear: 0.9 m each side, less
  // in a small room)
  const mid = { u: (u0 + u1) / 2, w: (w0 + w1) / 2 }
  const aisle = Math.min(0.9, Math.min(R.L, R.W) * 0.12)
  const doorClear = Math.min(1.0, Math.min(R.L, R.W) * 0.2)
  const offAisle = (u, w, hu, hw) =>
    doors.every((d) => {
      const du = mid.u - d.u
      const dw = mid.w - d.w
      const L2 = du * du + dw * dw || 1
      const t = Math.max(0, Math.min(1, ((u - d.u) * du + (w - d.w) * dw) / L2))
      const pu = d.u + du * t - u
      const pw = d.w + dw * t - w
      return Math.abs(pu) > hu + aisle || Math.abs(pw) > hw + aisle
    })
  const clearOf = (u, w, hu, hw) => offAisle(u, w, hu, hw) && doors.every((d) => Math.abs(d.u - u) > hu + doorClear || Math.abs(d.w - w) > hw + doorClear) && boxes.every((b) => Math.abs(b.u - u) > b.hu + hu || Math.abs(b.w - w) > b.hw + hw)
  // put a prop at local (u, w) facing (du, dw) if it fits; its size along u/w for the overlap test
  const put = (t, u, w, du, dw, extra = {}) => {
    const T = PROPS[t]
    const along = Math.abs(du) > Math.abs(dw) // facing along u: its width runs along w
    const hu = ((along ? T.d : T.w) * (extra.s || 1)) / 2
    const hw = ((along ? T.w : T.d) * (extra.s || 1)) / 2
    if (u - hu < u0 + 0.02 || u + hu > u1 - 0.02 || w - hw < w0 + 0.02 || w + hw > w1 - 0.02) return false
    if (!clearOf(u, w, hu, hw)) return false
    boxes.push({ u, w, hu: hu + 0.25, hw: hw + 0.25 })
    out.push({ t, ...W(u, w), a: yawOf(du, dw), ...extra })
    return true
  }
  // a row of props against a wall: side "u0" | "u1" | "w0" | "w1", facing into the room
  const row = (t, side, { gap = 0.1, from = 0, to = 1, extra = {}, every = null } = {}) => {
    const T = PROPS[t]
    const alongU = side === "w0" || side === "w1"
    const a0 = alongU ? u0 : w0
    const a1 = alongU ? u1 : w1
    const span = a1 - a0
    const step = every || T.w + gap
    const inset = T.d / 2 + 0.06
    let n = 0
    for (let s = a0 + span * from + T.w / 2 + 0.3; s <= a0 + span * to - T.w / 2 - 0.3; s += step) {
      const ok = alongU ? put(t, s, side === "w0" ? w0 + inset : w1 - inset, 0, side === "w0" ? 1 : -1, extra) : put(t, side === "u0" ? u0 + inset : u1 - inset, s, side === "u0" ? 1 : -1, 0, extra)
      if (ok) n++
    }
    return n
  }
  // a grid of props in the middle (facing +u or as given)
  const grid = (t, { du = 1, dw = 0, su = 2.4, sw = 2.4, m = 1.2, from = 0, to = 1, extra = {} } = {}) => {
    for (let u = u0 + (u1 - u0) * from + m + su / 2; u < u0 + (u1 - u0) * to - m; u += su) for (let w = w0 + m + sw / 2; w < w1 - m; w += sw) put(t, u, w, du, dw, extra)
  }
  const cu = (u0 + u1) / 2
  const cw = (w0 + w1) / 2
  // the wall the first door is on (the entrance): its side, and the side across from it
  const d0 = doors[0]
  const sideOf = (d) => {
    if (!d) return "w0"
    const e = [
      ["u0", Math.abs(d.u - u0)],
      ["u1", Math.abs(d.u - u1)],
      ["w0", Math.abs(d.w - w0)],
      ["w1", Math.abs(d.w - w1)],
    ].sort((a, b) => a[1] - b[1])
    return e[0][0]
  }
  const across = { u0: "u1", u1: "u0", w0: "w1", w1: "w0" }
  const entry = sideOf(d0)
  const back = across[entry]
  const sides = ["w0", "w1", "u0", "u1"]
  const other = sides.filter((s) => s !== entry && s !== back)
  const type = room.type || "hall"

  if (type === "lobby") {
    // the front desk facing the entrance, across the room; a waiting area; plants; a TV
    const deskU = back === "u1" ? u1 - 1.6 : back === "u0" ? u0 + 1.6 : cu
    const deskW = back === "w1" ? w1 - 1.6 : back === "w0" ? w0 + 1.6 : cw
    const facing = { u0: [1, 0], u1: [-1, 0], w0: [0, 1], w1: [0, -1] }[back]
    put("desk", deskU, deskW, facing[0], facing[1], { c: room.accent })
    row("tv", back, { from: 0.15, to: 0.35 })
    const s = other[0]
    const sU = s === "u0" ? u0 + 2.2 : s === "u1" ? u1 - 2.2 : cu - (u1 - u0) * 0.2
    const sW = s === "w0" ? w0 + 2.2 : s === "w1" ? w1 - 2.2 : cw
    if (put("rug", sU, sW, 1, 0)) boxes.pop()
    put("sofa", sU, sW - 1.25, 0, 1, { c: room.sofa })
    put("coffeetable", sU, sW, 0, 1)
    put("armchair", sU + 1.5, sW, -1, 0, { c: room.sofa })
    put("armchair", sU - 1.5, sW, 1, 0, { c: room.sofa })
    for (const [u, w] of [[u0 + 0.6, w0 + 0.6], [u1 - 0.6, w0 + 0.6], [u0 + 0.6, w1 - 0.6], [u1 - 0.6, w1 - 0.6]]) put("plant", u, w, 1, 0)
    if (room.proshop) row("shelf", other[1], { from: 0.1, to: 0.9 })
    row("paddlewall", other[1], { from: 0.3, to: 0.7 })
  } else if (type === "proshop") {
    row("paddlewall", back, { from: 0.05, to: 0.95 })
    row("shelf", other[0], { from: 0.05, to: 0.95 })
    row("shelf", other[1], { from: 0.3, to: 0.95 })
    put("counter", d0 ? (entry === "u0" ? u0 + 2 : entry === "u1" ? u1 - 2 : cu + 2) : cu, d0 ? (entry === "w0" ? w0 + 2 : entry === "w1" ? w1 - 2 : cw) : cw, 1, 0)
    grid("tablesq", { su: 2.6, sw: 2.6, m: 2.0 })
  } else if (type === "cafe" || type === "bar") {
    // the counter parallel to the back wall, the backbar against it, stools in front; tables
    const c = back
    const alongU = c === "w0" || c === "w1"
    const span = alongU ? u1 - u0 : w1 - w0
    const n = Math.max(1, Math.min(4, Math.floor((span * 0.6) / 3)))
    for (let k = 0; k < n; k++) {
      const s = (alongU ? u0 : w0) + span * 0.2 + k * 3 + 1.5
      if (alongU) {
        const wb = c === "w0" ? w0 + 0.3 : w1 - 0.3
        const wc = c === "w0" ? w0 + 1.9 : w1 - 1.9
        const f = c === "w0" ? 1 : -1
        put("backbar", s, wb, 0, f)
        put("counter", s, wc, 0, f)
        for (const o of [-1, 0, 1]) put("stool", s + o, wc + f * 0.75, 0, -f, { c: room.accent })
      } else {
        const ub = c === "u0" ? u0 + 0.3 : u1 - 0.3
        const uc = c === "u0" ? u0 + 1.9 : u1 - 1.9
        const f = c === "u0" ? 1 : -1
        put("backbar", ub, s, f, 0)
        put("counter", uc, s, f, 0)
        for (const o of [-1, 0, 1]) put("stool", uc + f * 0.75, s + o, -f, 0, { c: room.accent })
      }
    }
    row("tv", other[0], { from: 0.2, to: 0.8, every: 4 })
    for (let u = u0 + 2.2; u < u1 - 1.6; u += 2.6)
      for (let w = w0 + 2.2; w < w1 - 1.6; w += 2.6) {
        if (put("table", u, w, 1, 0)) {
          put("chair", u + 0.75, w, -1, 0, { c: room.chairs })
          put("chair", u - 0.75, w, 1, 0, { c: room.chairs })
        }
      }
  } else if (type === "lounge") {
    for (let u = u0 + 2.5; u < u1 - 2; u += 5)
      for (let w = w0 + 2.2; w < w1 - 1.8; w += 4.4) {
        if (put("coffeetable", u, w, 0, 1)) {
          put("sofa", u, w - 1.25, 0, 1, { c: room.sofa })
          put("armchair", u + 1.6, w, -1, 0, { c: room.sofa })
        }
      }
    row("tv", other[0], { from: 0.3, to: 0.7 })
    for (const [u, w] of [[u0 + 0.6, w0 + 0.6], [u1 - 0.6, w1 - 0.6]]) put("plant", u, w, 1, 0)
  } else if (type === "gym") {
    // cardio along one long wall, a mirror and dumbbells on the other, racks and benches
    // between, mats in a corner, water by the door
    const L1 = other[0] || "w0"
    const L2 = other[1] || "w1"
    const cardio = ["treadmill", "treadmill", "bike", "elliptical"]
    let k = 0
    const alongU1 = L1 === "w0" || L1 === "w1"
    for (let s = (alongU1 ? u0 : w0) + 1.0; s < (alongU1 ? u1 : w1) - 1.0; s += 1.25) {
      const t = cardio[k++ % cardio.length]
      const inset = PROPS[t].d / 2 + 0.6
      if (alongU1) put(t, s, L1 === "w0" ? w0 + inset : w1 - inset, 0, L1 === "w0" ? -1 : 1)
      else put(t, L1 === "u0" ? u0 + inset : u1 - inset, s, L1 === "u0" ? -1 : 1, 0)
    }
    // (a mirror is flat: the dumbbell racks stand in front of it)
    const nb = boxes.length
    row("mirror", L2, { gap: 0.05, from: 0.05, to: 0.95 })
    boxes.length = nb
    row("dumbbells", L2, { gap: 0.8, from: 0.15, to: 0.85 })
    for (let u = u0 + 3.5; u < u1 - 3; u += 3.4) {
      put("powerrack", u, cw, 1, 0)
      put("weightbench", u, cw + (rand() < 0.5 ? 2 : -2), 1, 0)
    }
    put("mat", u0 + 1.6, w0 + 1.2, 1, 0)
    put("mat", u0 + 1.6, w0 + 2.6, 1, 0)
    if (d0) {
      put("fountain", d0.u + (d0.u < cu ? 1.4 : -1.4), d0.w + (d0.w < cw ? 0.5 : -0.5), 0, d0.w < cw ? 1 : -1)
      put("filler", d0.u + (d0.u < cu ? 2.3 : -2.3), d0.w + (d0.w < cw ? 0.4 : -0.4), 0, d0.w < cw ? 1 : -1)
    }
  } else if (type === "locker") {
    row("lockers", other[0], { gap: 0.02, from: 0.05, to: 0.95, extra: { c: room.accent } })
    row("lockers", other[1], { gap: 0.02, from: 0.05, to: 0.7, extra: { c: room.accent } })
    const alongU = other[0] === "w0" || other[0] === "w1"
    for (let s = (alongU ? u0 : w0) + 2; s < (alongU ? u1 : w1) - 2; s += 2.6) (alongU ? put("bench", s, cw, 0, 1) : put("bench", cu, s, 1, 0))
    row("sink", back, { from: 0.1, to: 0.6 })
    row("shower", back, { gap: 0.05, from: 0.62, to: 0.98 })
  } else if (type === "restroom") {
    row("stall", other[0], { gap: 0.02, from: 0.05, to: 0.95 })
    row("sink", other[1], { from: 0.1, to: 0.9 })
  } else if (type === "sauna") {
    row("saunabench", other[0], { gap: 0, from: 0, to: 1 })
    row("saunabench", back, { gap: 0, from: 0, to: 0.75 })
    put("heater", back === "u1" || back === "u0" ? (back === "u1" ? u1 - 0.4 : u0 + 0.4) : u1 - 0.5, back === "w1" ? w1 - 0.4 : back === "w0" ? w0 + 0.4 : w1 - 0.5, -1, 0)
  } else if (type === "steam") {
    for (const s of other) row("tilebench", s, { gap: 0, from: 0, to: 1 })
  } else if (type === "kids") {
    grid("kidsmat", { su: 2.2, sw: 2.2, m: 1.0 })
    boxes.length = 0
    row("toybox", back, { gap: 0.4, from: 0.1, to: 0.9 })
    for (let u = u0 + 2; u < u1 - 1.5; u += 3) put("smalltable", u, cw, 1, 0)
  } else if (type === "office") {
    put("officedesk", cu, cw, back.startsWith("w") ? 0 : back === "u1" ? -1 : 1, back === "w1" ? -1 : back === "w0" ? 1 : 0)
    put("chair", cu + 0.7 * (back === "u1" ? 1 : back === "u0" ? -1 : 0), cw + 0.7 * (back === "w1" ? 1 : back === "w0" ? -1 : 0), 1, 0, { c: "#2b2f36" })
    row("shelf", back, { from: 0.1, to: 0.9 })
  } else if (type === "studio") {
    // spin bikes in rows facing the mirror wall, mats at the back
    const nb = boxes.length
    row("mirror", back, { gap: 0.05, from: 0.03, to: 0.97 })
    boxes.length = nb
    const f = { u0: [-1, 0], u1: [1, 0], w0: [0, -1], w1: [0, 1] }[back]
    for (let u = u0 + 1.6; u < u1 - 1.2; u += 1.5) for (let w = w0 + 2.0; w < w1 - 3.2; w += 1.9) put("bike", u, w, f[0], f[1])
    grid("mat", { su: 2.4, sw: 1.6, m: 0.6, from: 0.82, to: 1 })
  } else if (type === "racquet") {
    // the courts' glass back walls in a row across the room
    const alongU = back === "w0" || back === "w1"
    for (let s = (alongU ? u0 : w0) + 1.2; s < (alongU ? u1 : w1) - 1; s += 2.05) (alongU ? put("glasswall", s, cw + (w1 - w0) * 0.18, 0, 1) : put("glasswall", cu + (u1 - u0) * 0.18, s, 1, 0))
    row("bench", entry, { from: 0.2, to: 0.8, every: 4 })
  } else if (type === "basketball") {
    const alongU = R.L >= R.W
    if (alongU) {
      put("hoop", u0 + 0.8, cw, 1, 0)
      put("hoop", u1 - 0.8, cw, -1, 0)
    } else {
      put("hoop", cu, w0 + 0.8, 0, 1)
      put("hoop", cu, w1 - 0.8, 0, -1)
    }
    row("bleacher", other[0] || "w0", { from: 0.25, to: 0.75, gap: 0.5 })
  } else if (type === "spa") {
    for (let u = u0 + 2; u < u1 - 1.5; u += 3.2) put("massagebed", u, cw, 0, 1)
    for (const [u, w] of [[u0 + 0.6, w0 + 0.6], [u1 - 0.6, w1 - 0.6]]) put("plant", u, w, 1, 0)
    row("shelf", back, { from: 0.3, to: 0.7, extra: { c: "#f4efe6" } })
  } else if (type === "hall" || type === "corridor") {
    if (room.benches !== false) row("bench", other[0], { from: 0.2, to: 0.8, every: 5 })
    if (d0) put("fountain", cu, w0 + 0.3, 0, 1)
  }
  for (const pr of room.props || []) out.push(pr)
  return out
}
