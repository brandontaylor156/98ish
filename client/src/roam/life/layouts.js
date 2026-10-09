// Roam life: the interiors (pure data; Node-tested in life.test.js; drawn by interior.js).
//
// There's no source for any real interior, so these are ORIGINAL GAME SPACES (docs/open-world.md
// says so): a modern office ("like the office", the owner), a cozy apartment, the warehouse club
// "Big Crate 98" and the mall's concourse. The owner can send photos later to match a real place.
//
// Units are metres; the room's middle is (0, 0) on the floor; the way in is in the south wall
// (z = -D/2), and you come in facing north (+z, yaw 0). A layout:
//   { kind, name, W, D, H, floor, wall, ceiling, walls: [{ a, b, h, color, glass?, windows? }],
//     boxes: [{ x, z, w, d, h, y?, color, glow?, solid? }], seats: [{ id, x, z, yaw, h, label }],
//     spots: [{ id, kind, x, z, r, label, ... }], npcs: [{ id, name, x, z, yaw, seat?, lines }],
//     signs: [{ text, x, y, z, yaw, w, h, bg, fg }], lights: [{ x, z, w, d }], spawn, exit }
// solid boxes are walls you bump into; seats are where you sit (h: the seat's height).

const hash = (s) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}
const rng = (seed) => {
  let a = seed >>> 0 || 1
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const pick = (r, list) => list[Math.floor(r() * list.length)]

// the four outer walls with the way in (a 2.4 m gap) in the middle of the south wall; windows on
// the walls that have them
const shell = (W, D, H, color, { windows = ["n", "e", "w"], door = 2.4 } = {}) => {
  const x0 = -W / 2
  const x1 = W / 2
  const z0 = -D / 2
  const z1 = D / 2
  return [
    { a: { x: x0, z: z0 }, b: { x: -door / 2, z: z0 }, h: H, color, windows: windows.includes("s") },
    { a: { x: door / 2, z: z0 }, b: { x: x1, z: z0 }, h: H, color, windows: windows.includes("s") },
    { a: { x: x1, z: z0 }, b: { x: x1, z: z1 }, h: H, color, windows: windows.includes("e") },
    { a: { x: x1, z: z1 }, b: { x: x0, z: z1 }, h: H, color, windows: windows.includes("n") },
    { a: { x: x0, z: z1 }, b: { x: x0, z: z0 }, h: H, color, windows: windows.includes("w") },
  ]
}
// an inside wall from a to b with a door gap (from..to metres along it)
const partition = (a, b, h, color, gaps = [], extra = {}) => {
  const L = Math.hypot(b.x - a.x, b.z - a.z)
  const ux = (b.x - a.x) / L
  const uz = (b.z - a.z) / L
  const cuts = [0, ...gaps.flat(), L]
  const out = []
  for (let i = 0; i + 1 < cuts.length; i += 2) if (cuts[i + 1] - cuts[i] > 0.05) out.push({ a: { x: a.x + ux * cuts[i], z: a.z + uz * cuts[i] }, b: { x: a.x + ux * cuts[i + 1], z: a.z + uz * cuts[i + 1] }, h, color, ...extra })
  return out
}
const plant = (x, z, s = 1) => [
  { x, z, w: 0.5 * s, d: 0.5 * s, h: 0.45 * s, color: "#8a5a3c", solid: true },
  { x, z, w: 0.75 * s, d: 0.75 * s, h: 0.8 * s, y: 0.45 * s, color: "#3f8a45", round: true },
]
// a desk with a monitor (glowing), a keyboard and a chair; the chair's seat looks at the screen
const desk = (x, z, yaw, id, { name = "", mine = false } = {}) => {
  const f = { x: Math.sin(yaw), z: Math.cos(yaw) }
  const boxes = [
    { x, z, w: Math.abs(f.z) > 0.5 ? 1.6 : 0.8, d: Math.abs(f.z) > 0.5 ? 0.8 : 1.6, h: 0.74, color: mine ? "#c9a46a" : "#d8d2c6", solid: true },
    { x: x + f.x * 0.22, z: z + f.z * 0.22, w: Math.abs(f.z) > 0.5 ? 0.62 : 0.06, d: Math.abs(f.z) > 0.5 ? 0.06 : 0.62, h: 0.4, y: 0.84, color: "#1d2a3a", glow: mine ? "#7fd0ff" : "#4f88c9" },
    { x: x + f.x * 0.22, z: z + f.z * 0.22, w: 0.12, d: 0.12, h: 0.1, y: 0.74, color: "#2b2b2b" },
    { x: x - f.x * 0.12, z: z - f.z * 0.12, w: Math.abs(f.z) > 0.5 ? 0.45 : 0.15, d: Math.abs(f.z) > 0.5 ? 0.15 : 0.45, h: 0.02, y: 0.74, color: "#3a3a3a" },
    // the chair
    { x: x - f.x * 0.75, z: z - f.z * 0.75, w: 0.5, d: 0.5, h: 0.08, y: 0.42, color: "#2e3440" },
    { x: x - f.x * 1.0, z: z - f.z * 1.0, w: Math.abs(f.z) > 0.5 ? 0.5 : 0.08, d: Math.abs(f.z) > 0.5 ? 0.08 : 0.5, h: 0.55, y: 0.5, color: "#2e3440" },
  ]
  if (name) boxes.push({ x: x + f.x * 0.3, z: z + f.z * 0.3, w: 0.3, d: 0.3, h: 0.08, y: 0.74, color: mine ? "#ffd166" : "#9aa0a6" })
  return { boxes, seat: { id, x: x - f.x * 0.75, z: z - f.z * 0.75, yaw, h: 0.45, label: mine ? "Sit at your desk" : "Sit down" } }
}

// coworkers (original names; the lines are generic office chatter, nobody real)
const COWORKERS = [
  { name: "Priya", lines: ["Morning! The coffee machine's finally fixed.", "Did you see the new ticket queue? Wild.", "Lunch at noon? I'm thinking tacos."] },
  { name: "Marcus", lines: ["Big demo Friday. No pressure!", "My build's green, for once.", "Ping me if the printer jams again."] },
  { name: "Dana", lines: ["Stand-up's in five.", "I color-coded the whole backlog. You're welcome.", "Have you tried turning it off and on again?"] },
  { name: "Theo", lines: ["The conference room TV needs a new remote.", "I'm on my fourth coffee. Send help.", "Nice shoes today!"] },
  { name: "June", lines: ["Plant duty this week is you, right?", "Inbox zero by lunch. Let's go.", "The fridge has free sparkling water."] },
]

export const officeLayout = (seed = 1) => {
  const r = rng(seed)
  const W = 32
  const D = 24
  const H = 3.2
  const wall = "#e9e6df"
  const walls = [...shell(W, D, H, wall)]
  const boxes = []
  const seats = []
  const spots = []
  const npcs = []
  const signs = []
  // reception: a curved-front desk facing the door, the company sign behind it
  boxes.push({ x: 0, z: -7.4, w: 3.6, d: 0.9, h: 1.05, color: "#f4f1ea", solid: true }, { x: 0, z: -7.4, w: 3.7, d: 0.95, h: 0.05, y: 1.05, color: "#7a5a3a" })
  npcs.push({ id: "reception", name: "Marisol", x: 0, z: -6.6, yaw: Math.PI, seat: { h: 0.45 }, lines: ["Welcome in! Have a great day.", "Your badge works on every floor now.", "There's cake in the break room. Shh."] })
  signs.push({ text: "Welcome", x: 0, y: 2.3, z: -5.3, yaw: Math.PI, w: 3.2, h: 0.55, bg: "#23395d", fg: "#ffffff" })
  // the time clock by the way in
  boxes.push({ x: -2.6, z: -11.6, w: 0.5, d: 0.2, h: 0.7, y: 1.0, color: "#3a3f47", glow: "#9fe870" })
  spots.push({ id: "clock", kind: "clock", x: -2.6, z: -10.9, r: 1.6, label: "Clock in" })
  // the open plan: three rows of desks (four each), one is yours
  const mineAt = Math.floor(r() * 12)
  let k = 0
  for (let row = 0; row < 3; row++)
    for (let c = 0; c < 4; c++) {
      const x = -11 + c * 4
      const z = -3 + row * 3.6
      const mine = k === mineAt
      const d = desk(x, z, 0, `desk${k}`, { name: "x", mine })
      boxes.push(...d.boxes)
      seats.push(d.seat)
      if (mine) spots.push({ id: "mydesk", kind: "desk", x: d.seat.x, z: d.seat.z, r: 1.4, label: "Sit at your desk", seat: d.seat.id })
      k++
    }
  // coworkers at some of the other desks, and one by the water cooler
  const free = seats.filter((s) => s.id !== `desk${mineAt}`)
  COWORKERS.forEach((cw, i) => {
    if (i < 4) {
      const s = free[(i * 3 + Math.floor(r() * 2)) % free.length]
      npcs.push({ id: `cw${i}`, name: cw.name, x: s.x, z: s.z, yaw: s.yaw, seat: { h: s.h }, takes: s.id, lines: cw.lines })
    } else npcs.push({ id: `cw${i}`, name: cw.name, x: 9.4, z: 3.5, yaw: -Math.PI / 2, lines: cw.lines })
  })
  // three private offices on the east side behind glass
  for (let i = 0; i < 3; i++) {
    const z0 = -10 + i * 5
    walls.push(...partition({ x: 10.5, z: z0 }, { x: 10.5, z: z0 + 5 }, 2.7, "#bfe0f0", [[1.6, 2.6]], { glass: true }))
    if (i < 2) walls.push(...partition({ x: 10.5, z: z0 + 5 }, { x: 16, z: z0 + 5 }, 2.7, wall))
    const d = desk(13.6, z0 + 2.5, -Math.PI / 2, `office${i}`)
    boxes.push(...d.boxes)
    seats.push(d.seat)
    boxes.push(...plant(15.4, z0 + 0.6, 0.8))
    signs.push({ text: ["Studio A", "Studio B", "Focus room"][i], x: 10.45, y: 2.25, z: z0 + 2.1, yaw: -Math.PI / 2, w: 1.5, h: 0.3, bg: "#ffffff", fg: "#23395d" })
  }
  walls.push(...partition({ x: 10.5, z: 5 }, { x: 16, z: 5 }, 2.7, wall))
  // the conference room (north-west) with a long table and a TV
  walls.push(...partition({ x: -16, z: 5.5 }, { x: -5, z: 5.5 }, 2.7, "#bfe0f0", [[8.4, 9.6]], { glass: true }))
  walls.push(...partition({ x: -5, z: 5.5 }, { x: -5, z: 12 }, 2.7, wall))
  boxes.push({ x: -10.5, z: 9, w: 5, d: 1.5, h: 0.75, color: "#6b4f36", solid: true })
  for (let i = 0; i < 4; i++)
    for (const side of [-1, 1]) {
      const x = -12.4 + i * 1.3
      const z = 9 + side * 1.15
      boxes.push({ x, z, w: 0.48, d: 0.48, h: 0.08, y: 0.42, color: "#3a3f47" }, { x, z: z + side * 0.24, w: 0.48, d: 0.07, h: 0.5, y: 0.5, color: "#3a3f47" })
      seats.push({ id: `conf${i}${side}`, x, z, yaw: side > 0 ? Math.PI : 0, h: 0.45, label: "Sit down" })
    }
  boxes.push({ x: -15.85, z: 9, w: 0.08, d: 2.4, h: 1.35, y: 0.9, color: "#111111", glow: "#2a4f7a" })
  spots.push({ id: "tv", kind: "tv", x: -13.6, z: 9, r: 2.6, label: "Turn on the TV" })
  signs.push({ text: "Conference", x: -10.5, y: 2.25, z: 5.45, yaw: Math.PI, w: 2, h: 0.32, bg: "#ffffff", fg: "#23395d" })
  // the break room (north-east): counter, coffee machine, fridge, a table, a kitchen counter
  walls.push(...partition({ x: 3, z: 5.5 }, { x: 10.5, z: 5.5 }, 2.7, wall, [[1, 2.4]]))
  boxes.push({ x: 13.2, z: 11.4, w: 5.4, d: 0.7, h: 0.92, color: "#f2efe9", solid: true }, { x: 13.2, z: 11.4, w: 5.5, d: 0.75, h: 0.04, y: 0.92, color: "#4a4a4a" })
  boxes.push({ x: 11.2, z: 11.4, w: 0.45, d: 0.4, h: 0.5, y: 0.96, color: "#2b2b2b", glow: "#ff8a3d" }) // the coffee machine
  spots.push({ id: "coffee", kind: "coffee", x: 11.2, z: 10.2, r: 1.5, label: "Grab a coffee" })
  boxes.push({ x: 15.5, z: 11.3, w: 0.85, d: 0.75, h: 1.9, color: "#d9dde2", solid: true })
  spots.push({ id: "fridge", kind: "fridge", x: 15.4, z: 10.2, r: 1.5, label: "Grab a drink from the fridge" })
  boxes.push({ x: 13.5, z: 8.4, w: 1.6, d: 1.0, h: 0.74, color: "#d8d2c6", solid: true })
  for (const [dx, yaw] of [[-1.15, Math.PI / 2], [1.15, -Math.PI / 2]]) {
    boxes.push({ x: 13.5 + dx, z: 8.4, w: 0.45, d: 0.45, h: 0.08, y: 0.42, color: "#e0a458" })
    seats.push({ id: `break${dx > 0 ? 1 : 0}`, x: 13.5 + dx, z: 8.4, yaw, h: 0.45, label: "Sit down" })
  }
  boxes.push({ x: 5, z: 11.4, w: 3.2, d: 0.7, h: 0.92, color: "#f2efe9", solid: true }, { x: 4.4, z: 11.4, w: 0.6, d: 0.45, h: 0.04, y: 0.92, color: "#9aa0a6" })
  signs.push({ text: "Break room", x: 6.7, y: 2.25, z: 5.45, yaw: Math.PI, w: 1.8, h: 0.32, bg: "#ffffff", fg: "#23395d" })
  // a water cooler and plants
  boxes.push({ x: 9.6, z: 2.6, w: 0.35, d: 0.35, h: 1.25, color: "#dfe7ee", solid: true }, { x: 9.6, z: 2.6, w: 0.3, d: 0.3, h: 0.35, y: 1.25, color: "#8cc8f0", glow: "#8cc8f0" })
  for (const [x, z] of [[-15, -11], [15, -11], [-4, -11], [4.5, -11], [-4.4, 4.6], [8.8, 4.6], [-15.3, 1]]) boxes.push(...plant(x, z, pick(r, [0.9, 1.1, 1.3])))
  // ceiling light panels
  const lights = []
  for (let x = -12; x <= 12; x += 6) for (let z = -8; z <= 8; z += 5) lights.push({ x, z, w: 1.2, d: 0.6 })
  return { kind: "office", name: "The office", W, D, H, floor: "#5d6670", floorAlt: "#56606a", wall, ceiling: "#f4f4f2", walls, boxes, seats, spots, npcs, signs, lights, spawn: { x: 0, z: -10.6, yaw: 0 }, exit: { x: 0, z: -11.6, r: 1.6 } }
}

export const homeLayout = (seed = 1) => {
  const r = rng(seed)
  const W = 14
  const D = 12
  const H = 2.8
  const wall = pick(r, ["#f1e6d6", "#e9efe6", "#f4ece4"])
  const walls = [...shell(W, D, H, wall, { windows: ["n", "e", "w", "s"], door: 1.2 })]
  const boxes = []
  const seats = []
  const spots = []
  const signs = []
  // the bedroom (north-east) behind a wall with a doorway
  walls.push(...partition({ x: 1.5, z: 1 }, { x: 7, z: 1 }, H, wall, [[0.5, 1.5]]))
  walls.push(...partition({ x: 1.5, z: 1 }, { x: 1.5, z: 6 }, H, wall))
  const sheets = pick(r, ["#9ec5e8", "#e8a0b4", "#b8d8a8", "#f3d27a"])
  boxes.push({ x: 4.6, z: 4.6, w: 2.0, d: 2.2, h: 0.5, color: "#7a5a3c", solid: true }, { x: 4.6, z: 4.4, w: 1.95, d: 1.9, h: 0.14, y: 0.5, color: sheets }, { x: 4.6, z: 5.55, w: 1.6, d: 0.35, h: 0.14, y: 0.6, color: "#ffffff" }, { x: 4.6, z: 5.9, w: 2.0, d: 0.12, h: 1.0, color: "#5a3e28" })
  boxes.push({ x: 3.2, z: 5.6, w: 0.5, d: 0.45, h: 0.55, color: "#8a6a4c", solid: true }, { x: 3.2, z: 5.6, w: 0.22, d: 0.22, h: 0.3, y: 0.55, color: "#ffe9b0", glow: "#ffe9b0" })
  seats.push({ id: "bed0", x: 4.1, z: 4.0, yaw: Math.PI, h: 0.6, label: "Sit on the bed" }, { id: "bed1", x: 5.1, z: 4.0, yaw: Math.PI, h: 0.6, label: "Sit on the bed" })
  signs.push({ text: "♥", x: 4.6, y: 1.9, z: 5.95, yaw: Math.PI, w: 0.5, h: 0.5, bg: "#fff6e8", fg: "#e0566e" })
  // the kitchen (north-west): an L counter, the fridge, the stove, a little table
  boxes.push({ x: -4.4, z: 5.6, w: 5, d: 0.65, h: 0.92, color: "#f7f5f0", solid: true }, { x: -4.4, z: 5.6, w: 5.05, d: 0.7, h: 0.04, y: 0.92, color: "#3e4a52" })
  boxes.push({ x: -6.6, z: 3.8, w: 0.65, d: 2.6, h: 0.92, color: "#f7f5f0", solid: true }, { x: -6.6, z: 3.8, w: 0.7, d: 2.65, h: 0.04, y: 0.92, color: "#3e4a52" })
  boxes.push({ x: -1.6, z: 5.55, w: 0.85, d: 0.75, h: 1.85, color: "#dfe3e8", solid: true })
  spots.push({ id: "fridge", kind: "fridge", x: -1.6, z: 4.5, r: 1.3, label: "Grab a drink from the fridge" })
  boxes.push({ x: -4.2, z: 5.6, w: 0.75, d: 0.6, h: 0.02, y: 0.96, color: "#222222", glow: "#552211" })
  spots.push({ id: "coffee", kind: "coffee", x: -5.5, z: 4.7, r: 1.2, label: "Make a coffee" })
  boxes.push({ x: -5.5, z: 5.6, w: 0.35, d: 0.35, h: 0.4, y: 0.96, color: "#2b2b2b" })
  boxes.push({ x: -3.6, z: 2.2, w: 1.2, d: 0.9, h: 0.74, color: "#a07a52", solid: true })
  for (const dx of [-0.8, 0.8]) {
    boxes.push({ x: -3.6 + dx, z: 2.2, w: 0.42, d: 0.42, h: 0.06, y: 0.44, color: "#7a5a3c" })
    seats.push({ id: `kt${dx > 0 ? 1 : 0}`, x: -3.6 + dx, z: 2.2, yaw: dx > 0 ? -Math.PI / 2 : Math.PI / 2, h: 0.46, label: "Sit at the table" })
  }
  // the living room (south): a couch facing the TV, a rug, a coffee table, a lamp, plants
  const couch = pick(r, ["#4f6d7a", "#8a5a6a", "#6a7a4f", "#9a7a5a"])
  boxes.push({ x: -1.5, z: -1.2, w: 3.0, d: 0.95, h: 0.45, color: couch, solid: true }, { x: -1.5, z: -0.8, w: 3.0, d: 0.25, h: 0.5, y: 0.45, color: couch }, { x: -3.05, z: -1.2, w: 0.2, d: 0.95, h: 0.3, y: 0.45, color: couch }, { x: 0.05, z: -1.2, w: 0.2, d: 0.95, h: 0.3, y: 0.45, color: couch })
  for (let i = 0; i < 3; i++) seats.push({ id: `couch${i}`, x: -2.45 + i * 0.95, z: -1.35, yaw: Math.PI, h: 0.46, label: "Sit on the couch" })
  boxes.push({ x: -1.5, z: -3.6, w: 3.2, d: 2.2, h: 0.01, color: pick(r, ["#c9b48a", "#b8c4cc", "#d8b8a8"]) }) // the rug
  boxes.push({ x: -1.5, z: -3.0, w: 1.2, d: 0.6, h: 0.4, color: "#7a5a3c", solid: true })
  boxes.push({ x: -1.5, z: -5.75, w: 2.6, d: 0.4, h: 0.5, color: "#3a3a3a", solid: true }, { x: -1.5, z: -5.85, w: 2.0, d: 0.06, h: 1.1, y: 0.65, color: "#0d0d10", glow: "#1d2f4a" })
  spots.push({ id: "tv", kind: "tv", x: -1.5, z: -2.4, r: 2.2, label: "Watch TV together" })
  boxes.push({ x: 1.0, z: -0.6, w: 0.35, d: 0.35, h: 1.5, color: "#3a3a3a" }, { x: 1.0, z: -0.6, w: 0.45, d: 0.45, h: 0.35, y: 1.5, color: "#fff2cc", glow: "#fff2cc" })
  for (const [x, z] of [[-6.4, -5.4], [6.3, -5.3], [1.0, 0.4]]) boxes.push(...plant(x, z, 0.9))
  // a shelf of keepsakes (what you were given shows here in a later round)
  boxes.push({ x: 6.6, z: -2.4, w: 0.4, d: 1.8, h: 1.6, color: "#8a6a4c", solid: true })
  const lights = [{ x: -1.5, z: -2.5, w: 0.7, d: 0.7 }, { x: -4, z: 3.5, w: 0.7, d: 0.7 }, { x: 4.5, z: 3.5, w: 0.7, d: 0.7 }]
  return { kind: "home", name: "Home", W, D, H, floor: "#b48a5e", floorAlt: "#a87e54", wall, ceiling: "#fbfaf7", walls, boxes, seats, spots, npcs: [], signs, lights, spawn: { x: 0, z: -4.9, yaw: 0 }, exit: { x: 0, z: -5.6, r: 1.1 } }
}

// the warehouse club: pallet racks in rows, wide aisles, sample stands, the food court and the
// registers by the way in
export const clubLayout = (seed = 1, aisles = []) => {
  const r = rng(seed)
  const W = 64
  const D = 48
  const H = 9
  const wall = "#d9d7d0"
  const walls = [...shell(W, D, H, wall, { windows: [], door: 6 })]
  const boxes = []
  const seats = []
  const spots = []
  const npcs = []
  const signs = []
  signs.push({ text: "BIG CRATE 98", x: 0, y: 6.4, z: -23.9, yaw: 0, w: 12, h: 1.6, bg: "#c8102e", fg: "#ffffff" })
  // racks: five rows running north-south, two faces each, an aisle (sign over it) between
  const ROW_X = [-24, -12, 0, 12, 24]
  const colors = ["#2f6fd6", "#f07d1a"]
  ROW_X.forEach((x, i) => {
    boxes.push({ x, z: 8, w: 2.4, d: 26, h: 0.12, color: "#555555", solid: true })
    for (let level = 0; level < 4; level++) {
      const y = 0.15 + level * 1.7
      boxes.push({ x, z: 8, w: 2.6, d: 26, h: 0.12, y: y + 1.45, color: colors[level % 2] })
      // the pallets of boxes on each level (cardboard and shrink-wrap colours)
      for (let p = 0; p < 9; p++) {
        const c = pick(r, ["#c49a6c", "#b48a5c", "#d4b48c", "#e8e2d4", "#c8d4dc", "#9a7a54"])
        boxes.push({ x, z: -3.5 + p * 2.9, w: 2.2, d: 2.4, h: 0.9 + r() * 0.45, y, color: c })
      }
    }
    for (const dz of [-5, 21]) boxes.push({ x, z: dz, w: 2.8, d: 0.2, h: 7, color: "#f07d1a" })
    const a = aisles[i]
    if (a) {
      const ax = x + 6
      signs.push({ text: a.name, x: ax, y: 7.2, z: -4.6, yaw: 0, w: 5.4, h: 0.9, bg: "#23395d", fg: "#ffffff" })
      spots.push({ id: `aisle-${a.id}`, kind: "aisle", aisle: a.id, x: ax, z: 0, r: 3.2, label: `Browse ${a.name}` })
    }
  })
  // sample stands in the aisles, each with a person handing out bites
  const SAMPLERS = ["Lou", "Bea", "Ramon"]
  ;[[-18, 14, "tacos"], [6, 10, "lemonade"], [18, 16, "burger"]].forEach(([x, z, item], i) => {
    boxes.push({ x, z, w: 1.2, d: 0.6, h: 0.9, color: "#ffffff", solid: true }, { x, z: z + 0.05, w: 1.25, d: 0.65, h: 0.04, y: 0.9, color: "#c8102e" })
    npcs.push({ id: `sampler${i}`, name: SAMPLERS[i], x, z: z + 0.8, yaw: Math.PI, lines: ["Free sample? Fresh out of the oven!", "Try one, they're really good today.", "One per customer... okay, two."] })
    spots.push({ id: `sample${i}`, kind: "sample", item, x, z: z - 0.9, r: 1.6, label: "Try a free sample" })
  })
  // the carts by the way in
  for (let i = 0; i < 4; i++) boxes.push({ x: 8.6 + i * 0.35, z: -21.4, w: 0.6, d: 0.95, h: 0.95, color: "#b8bcc2" })
  spots.push({ id: "cart", kind: "cart", x: 9.2, z: -20.2, r: 1.8, label: "Grab a cart" })
  // the registers (four lanes) between the door and the racks
  for (let i = 0; i < 4; i++) {
    const x = -20 + i * 5
    boxes.push({ x, z: -14, w: 0.9, d: 3.4, h: 0.9, color: "#3a3f47", solid: true }, { x, z: -15, w: 0.4, d: 0.4, h: 0.35, y: 0.9, color: "#222222", glow: "#7dff9a" })
    signs.push({ text: String(i + 1), x, y: 2.4, z: -14, yaw: 0, w: 0.6, h: 0.6, bg: "#ffd166", fg: "#222222" })
    spots.push({ id: `register${i}`, kind: "checkout", x: x + 1.4, z: -14, r: 1.9, label: "Check out" })
    npcs.push({ id: `cashier${i}`, name: ["Ana", "Ken", "Rosa", "Jay"][i], x: x - 1.0, z: -14, yaw: Math.PI / 2, lines: ["Find everything okay?", "Membership card? Just kidding. Play chips are fine.", "Have a good one!"] })
  }
  // the food court counter (west of the way in) and its tables
  boxes.push({ x: -26, z: -20.5, w: 8, d: 1.0, h: 1.05, color: "#ffffff", solid: true }, { x: -26, z: -20.5, w: 8.1, d: 1.05, h: 0.05, y: 1.05, color: "#c8102e" })
  signs.push({ text: "FOOD COURT · Hot dog + soda 2", x: -26, y: 3.2, z: -21.3, yaw: 0, w: 7.6, h: 0.9, bg: "#ffd166", fg: "#c8102e" })
  npcs.push({ id: "cook", name: "Gus", x: -26, z: -21.4, yaw: 0, lines: ["Hot dog combo? Same price since forever.", "Extra mustard's free.", "Next!"] })
  spots.push({ id: "foodcourt", kind: "foodcourt", x: -26, z: -19.2, r: 2.2, label: "Order at the food court" })
  for (let i = 0; i < 3; i++) {
    const x = -29 + i * 3.4
    boxes.push({ x, z: -16.4, w: 1.4, d: 0.9, h: 0.74, color: "#c8102e", solid: true })
    for (const dz of [-0.75, 0.75]) {
      boxes.push({ x, z: -16.4 + dz, w: 1.3, d: 0.3, h: 0.06, y: 0.44, color: "#9aa0a6" })
      seats.push({ id: `fc${i}${dz > 0 ? 1 : 0}`, x, z: -16.4 + dz, yaw: dz > 0 ? Math.PI : 0, h: 0.46, label: "Sit and eat" })
    }
  }
  const lights = []
  for (let x = -24; x <= 24; x += 12) for (let z = -16; z <= 18; z += 8.5) lights.push({ x: x + 6, z, w: 0.5, d: 6 })
  return { kind: "club", name: "Big Crate 98", W, D, H, floor: "#a8a7a2", floorAlt: "#a19f99", wall, ceiling: "#c4c6c8", walls, boxes, seats, spots, npcs, signs, lights, spawn: { x: 0, z: -21.5, yaw: 0 }, exit: { x: 0, z: -23.3, r: 2.6 }, bright: true }
}

// the mall: one concourse, shops on both sides behind open storefronts, the food court at the end
export const mallLayout = (seed = 1, shops = []) => {
  const r = rng(seed)
  const W = 20
  const D = 84
  const H = 6
  const wall = "#efe9df"
  const walls = [...shell(W, D, H, wall, { windows: [], door: 4 })]
  const boxes = []
  const seats = []
  const spots = []
  const npcs = []
  const signs = []
  // shop fronts: on the west and east sides, 11 m each, with a counter and a clerk inside
  const fronts = [-34, -22, -10, 2, 14]
  const CLERKS = ["Nia", "Omar", "Skye", "Ivan", "Lena", "Rae", "Cole"]
  shops.forEach((s, i) => {
    const side = i % 2 ? 1 : -1
    const z = fronts[Math.floor(i / 2)]
    if (z === undefined) return
    const wx = side * 4
    // the side walls between shops and the storefront (open in the middle)
    walls.push(...partition({ x: wx, z: z - 5.5 }, { x: side * 10, z: z - 5.5 }, H, wall))
    walls.push(...partition({ x: wx, z: z - 5.5 }, { x: wx, z: z + 5.5 }, H, "#c8d8e0", [[2.5, 8.5]], { glass: true }))
    const cx = side * 8.6
    boxes.push({ x: cx, z, w: 0.8, d: 3.2, h: 1.0, color: s.color || "#ffffff", solid: true })
    // display shelves along the back
    for (const dz of [-3.6, 3.6]) boxes.push({ x: side * 9.6, z: z + dz, w: 0.7, d: 2.6, h: 1.9, color: "#d8cfc2", solid: true }, { x: side * 9.55, z: z + dz, w: 0.6, d: 2.4, h: 0.3, y: 1.0, color: pick(r, ["#ef476f", "#2f6fd6", "#ffd166", "#7fe0bf", "#9d4edd"]) })
    npcs.push({ id: `clerk${i}`, name: CLERKS[i % CLERKS.length], x: side * 9.3, z, yaw: side > 0 ? -Math.PI / 2 : Math.PI / 2, lines: ["Hi! Let me know if you need anything.", "Everything here's brand new this week.", "Great choice!"] })
    spots.push({ id: `shop-${s.id}`, kind: "shop", shop: s.id, x: side * 7.3, z, r: 2.2, label: `Shop at ${s.name}` })
    signs.push({ text: s.name, x: wx + side * -0.05, y: 4.4, z, yaw: side > 0 ? -Math.PI / 2 : Math.PI / 2, w: 6, h: 0.9, bg: s.bg || "#23395d", fg: "#ffffff" })
  })
  // the food court at the north end: a counter and tables
  boxes.push({ x: 0, z: 39.6, w: 10, d: 1.0, h: 1.05, color: "#ffffff", solid: true })
  spots.push({ id: "shop-food", kind: "shop", shop: "food", x: 0, z: 37.8, r: 2.6, label: "Order at the Food Court" })
  npcs.push({ id: "fcook", name: "Pat", x: 0, z: 40.4, yaw: Math.PI, lines: ["What can I get you?", "Smoothies are two for one today.", "Enjoy!"] })
  signs.push({ text: "FOOD COURT", x: 0, y: 3.4, z: 41.9, yaw: Math.PI, w: 6, h: 0.9, bg: "#ffd166", fg: "#23395d" })
  for (let i = 0; i < 4; i++) {
    const x = -5.4 + i * 3.6
    boxes.push({ x, z: 33, w: 1.2, d: 1.2, h: 0.74, color: "#ffffff", solid: true })
    for (const dz of [-0.85, 0.85]) seats.push({ id: `mfc${i}${dz > 0 ? 1 : 0}`, x, z: 33 + dz, yaw: dz > 0 ? Math.PI : 0, h: 0.46, label: "Sit and eat" })
  }
  // the arcade's claw machine and a fountain in the middle of the concourse with benches
  boxes.push({ x: 7.6, z: 26, w: 1.2, d: 1.2, h: 1.9, color: "#ff6fb0", solid: true }, { x: 7.6, z: 26, w: 1.0, d: 1.0, h: 0.8, y: 1.0, color: "#cfefff", glow: "#cfefff" })
  spots.push({ id: "claw", kind: "claw", x: 7.6, z: 24.4, r: 1.6, label: "Try the claw (5 chips)" })
  signs.push({ text: "PIXEL ARCADE 98", x: 7.6, y: 3.2, z: 24.8, yaw: 0, w: 4.2, h: 0.7, bg: "#9d4edd", fg: "#ffffff" })
  boxes.push({ x: 0, z: -18, w: 3.2, d: 3.2, h: 0.55, color: "#b8c4cc", solid: true }, { x: 0, z: -18, w: 2.8, d: 2.8, h: 0.04, y: 0.55, color: "#5fb3e8", glow: "#5fb3e8" })
  for (const dz of [-3.2, 3.2]) {
    boxes.push({ x: 0, z: -18 + dz, w: 2.2, d: 0.5, h: 0.45, color: "#8a6a4c", solid: true })
    for (const dx of [-0.6, 0.6]) seats.push({ id: `bench${dz > 0 ? 1 : 0}${dx > 0 ? 1 : 0}`, x: dx, z: -18 + dz, yaw: dz > 0 ? 0 : Math.PI, h: 0.45, label: "Sit on the bench" })
  }
  for (const z of [-30, -6, 8, 20]) boxes.push(...plant(-2.6, z, 1.2), ...plant(2.6, z, 1.2))
  signs.push({ text: "CENTER COURT MALL 98", x: 0, y: 4.6, z: -41.9, yaw: 0, w: 10, h: 1.0, bg: "#23395d", fg: "#ffffff" })
  const lights = []
  for (let z = -36; z <= 36; z += 6) lights.push({ x: 0, z, w: 2.4, d: 1.2 })
  return { kind: "mall", name: "The mall", W, D, H, floor: "#e4ddd2", floorAlt: "#d9d1c4", wall, ceiling: "#ffffff", walls, boxes, seats, spots, npcs, signs, lights, spawn: { x: 0, z: -39.5, yaw: 0 }, exit: { x: 0, z: -41.4, r: 2.2 }, bright: true }
}

export const layoutFor = (kind, seed = 1, extra = {}) => (kind === "office" ? officeLayout(seed) : kind === "home" ? homeLayout(seed) : kind === "club" ? clubLayout(seed, extra.aisles || []) : kind === "mall" ? mallLayout(seed, extra.shops || []) : null)
export const seedOf = (s) => hash(String(s))

// ---- checks (tests; and the interior's walking grid) ----
// the floor as a grid of 0.25 m cells: free unless inside a solid box or across a wall
export const walkGrid = (L, cell = 0.25, radius = 0.3) => {
  const nx = Math.ceil(L.W / cell)
  const nz = Math.ceil(L.D / cell)
  const free = new Uint8Array(nx * nz)
  const segDist = (px, pz, a, b) => {
    const dx = b.x - a.x
    const dz = b.z - a.z
    const L2 = dx * dx + dz * dz || 1e-9
    const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / L2))
    return Math.hypot(px - a.x - dx * t, pz - a.z - dz * t)
  }
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < nz; j++) {
      const x = -L.W / 2 + (i + 0.5) * cell
      const z = -L.D / 2 + (j + 0.5) * cell
      let ok = true
      for (const w of L.walls) if (segDist(x, z, w.a, w.b) < radius) ok = false
      if (ok) for (const b of L.boxes) if (b.solid && Math.abs(x - b.x) < b.w / 2 + radius && Math.abs(z - b.z) < b.d / 2 + radius) ok = false
      free[j * nx + i] = ok ? 1 : 0
    }
  return { nx, nz, cell, free, at: (x, z) => {
    const i = Math.floor((x + L.W / 2) / cell)
    const j = Math.floor((z + L.D / 2) / cell)
    return i >= 0 && j >= 0 && i < nx && j < nz ? free[j * nx + i] === 1 : false
  } }
}
// every cell reachable from the spawn -> a test: can you walk from the way in to (x, z) (within r)?
export const reachable = (L, cell = 0.25, radius = 0.3) => {
  const g = walkGrid(L, cell, radius)
  const seen = new Uint8Array(g.nx * g.nz)
  const si = Math.floor((L.spawn.x + L.W / 2) / cell)
  const sj = Math.floor((L.spawn.z + L.D / 2) / cell)
  const q = [[si, sj]]
  seen[sj * g.nx + si] = 1
  while (q.length) {
    const [i, j] = q.pop()
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di
      const b = j + dj
      if (a < 0 || b < 0 || a >= g.nx || b >= g.nz || seen[b * g.nx + a] || !g.free[b * g.nx + a]) continue
      seen[b * g.nx + a] = 1
      q.push([a, b])
    }
  }
  return (x, z, r = 1) => {
    for (let i = Math.floor((x - r + L.W / 2) / cell); i <= Math.floor((x + r + L.W / 2) / cell); i++)
      for (let j = Math.floor((z - r + L.D / 2) / cell); j <= Math.floor((z + r + L.D / 2) / cell); j++) if (i >= 0 && j >= 0 && i < g.nx && j < g.nz && seen[j * g.nx + i]) return true
    return false
  }
}
