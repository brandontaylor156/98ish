// Critter Catch Pinball's tables: where every wall, bumper, lane, hole and ramp sits, in
// the same 560 x 1000 table units as Blue Screen (and the same physics, ../pinball/
// physics.js). The skeleton (dome, shooter lane, slings, in/outlanes, flippers) and the
// tested ramp and orbit shapes come from Blue Screen; the Tide table mirrors the playfield
// (ramp on the left, spinner on the right orbit, Den and Grotto swapped) and moves the
// bumpers, so the two tables shoot differently. The shooter lane stays on the right.
//
//   top lanes (ball upgrade)      3 bumpers (reveal the critter in Catch mode)
//   orbits (CATCH letters, loops)   spinner (charges Sparkit, the outlane saver)
//   ramp (CATCH letters, map)       the screen in the middle: where critters appear
//   E-V-O drop targets (light Evolution)   Den hole (Catch / Evolve)   Cave hole (map, bonus)
//   slings, inlanes, outlanes (Sparkit saves one), flippers
//
// Bonus stages are smaller worlds of their own: no shooter lane, a boss in the middle.

import { arc, circle, flipper, gate, segment, slope, spinner, transition } from "../pinball/physics.js"

export const WIDTH = 560
export const HEIGHT = 1000
export const MID = 262
export const DRAIN_Y = 1040
export const LANE = { left: 504, right: 540, top: 330 }
export const PLUNGER = { restY: 950, pull: 46 }
export const DOME = { cx: 280, cy: 280, r: 260 }
export const BALL_START = { x: (LANE.left + LANE.right) / 2, y: PLUNGER.restY - 12 }
export const FLIPPER = { length: 78, r0: 11, r1: 6, rest: 0.52, up: -0.45, pivotY: 878, leftX: 174 }
export const LANE_GUIDES = [196, 240, 284, 328]
export const LANE_TOP = 84
export const LANE_BOTTOM = 140

const mirror = (x) => MID * 2 - x

// Ember's layout (Tide is this mirrored, with its own bumpers)
const EMBER = {
  bumpers: [
    { x: 208, y: 205, r: 28 },
    { x: 316, y: 205, r: 28 },
    { x: 262, y: 284, r: 28 },
  ],
  orbitL: { x: 64, y0: 300, y1: 540, flare: [96, 590] },
  orbitR: { x: 460, y0: 300, y1: 522 },
  orbitGates: [
    { a: [20, 600, 70, 648], side: [30, 580] },
    { a: [LANE.left, 572, 464, 612], side: [490, 560] },
  ],
  orbitSensors: [
    { x: 42, y: 420 },
    { x: 482, y: 420 },
  ],
  spinner: { ax: 20, ay: 486, bx: 64, by: 486 },
  ramp: {
    half: 21,
    mouth: { x: 416, y: 560 },
    up: { x: 416, y: 330 },
    turn: { cx: 443, cy: 330, r: 27 },
    down: { x: 470, y: 330 },
    bend: { x: 470, y: 560 },
    exit: { x: 448, y: 648 },
  },
  screen: { x0: 190, y0: 336, x1: 334, y1: 452 },
  critter: { x: 262, y: 394, r: 25 },
  bank: { x0: 100, y0: 446, x1: 178, y1: 420 },
  den: { x: 363, y: 448, r: 13 },
  cave: { x: 118, y: 494, r: 13 },
}

const TIDE_BUMPERS = [
  { x: 186, y: 252, r: 26 },
  { x: 338, y: 252, r: 26 },
  { x: 262, y: 196, r: 26 },
]

const mirrorLayout = (L) => {
  const pt = (p) => ({ ...p, x: mirror(p.x) })
  const R = L.ramp
  return {
    bumpers: TIDE_BUMPERS,
    // the orbits swap sides: Ember's right orbit (no flare) becomes Tide's left
    orbitL: { x: mirror(L.orbitR.x), y0: L.orbitR.y0, y1: L.orbitR.y1 },
    orbitR: { x: mirror(L.orbitL.x), y0: L.orbitL.y0, y1: L.orbitL.y1, flare: [mirror(L.orbitL.flare[0]), L.orbitL.flare[1]] },
    orbitGates: [
      { a: [mirror(L.orbitGates[1].a[0]), L.orbitGates[1].a[1], mirror(L.orbitGates[1].a[2]), L.orbitGates[1].a[3]], side: [mirror(L.orbitGates[1].side[0]), L.orbitGates[1].side[1]] },
      { a: [mirror(L.orbitGates[0].a[0]), L.orbitGates[0].a[1], mirror(L.orbitGates[0].a[2]), L.orbitGates[0].a[3]], side: [mirror(L.orbitGates[0].side[0]), L.orbitGates[0].side[1]] },
    ],
    orbitSensors: L.orbitSensors,
    spinner: { ax: mirror(L.spinner.bx), ay: L.spinner.ay, bx: mirror(L.spinner.ax), by: L.spinner.by },
    ramp: { half: R.half, mouth: pt(R.mouth), up: pt(R.up), turn: { cx: mirror(R.turn.cx), cy: R.turn.cy, r: R.turn.r }, down: pt(R.down), bend: pt(R.bend), exit: pt(R.exit) },
    screen: L.screen,
    critter: L.critter,
    bank: { x0: mirror(L.bank.x1), y0: L.bank.y1, x1: mirror(L.bank.x0), y1: L.bank.y0 },
    den: pt(L.den),
    cave: pt(L.cave),
  }
}

export const TABLES = {
  ember: { id: "ember", name: "Ember Table", mirrored: false, ...EMBER },
  tide: { id: "tide", name: "Tide Table", mirrored: true, ...mirrorLayout(EMBER) },
}

// the shared parts of every main table
export const ROLLOVERS = [0, 1, 2].map((i) => ({ x: (LANE_GUIDES[i] + LANE_GUIDES[i + 1]) / 2, y: 112 }))
export const SLING_L = [
  [98, 690],
  [98, 776],
  [150, 815],
]
export const SLINGS = [SLING_L, SLING_L.map(([x, y]) => [mirror(x), y])]
export const SEPARATORS = [
  { x: 58, y0: 690, y1: 790 },
  { x: mirror(58), y0: 690, y1: 790 },
]
export const GUIDES = [
  [58, 790, 176, 866],
  [mirror(58), 790, mirror(176), 866],
]
export const INLANES = [
  { x: 80, y: 735 },
  { x: mirror(80), y: 735 },
]
export const OUTLANES = [
  { x: 39, y: 830 },
  { x: 485, y: 830 },
]

// the E-V-O targets along a table's bank
export const bankTargets = (bank) =>
  Array.from({ length: 3 }, (_, i) => {
    const at = (t) => [bank.x0 + (bank.x1 - bank.x0) * t, bank.y0 + (bank.y1 - bank.y0) * t]
    const [x0, y0] = at((i + 0.08) / 3)
    const [x1, y1] = at((i + 0.92) / 3)
    // the face points down the table (toward the flippers)
    return { x0, y0, x1, y1, x: (x0 + x1) / 2, y: (y0 + y1) / 2, letter: "EVO"[i] }
  })

const segDist = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax
  const dy = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)))
  return Math.hypot(px - ax - t * dx, py - ay - t * dy)
}

// is (x, y) over the ramp?
export const onRampOf = (R) => (x, y) => {
  const m = R.half + 6
  if (segDist(x, y, R.mouth.x, R.mouth.y + 4, R.up.x, R.up.y) < m) return true
  if (y <= R.turn.cy + 2 && Math.abs(Math.hypot(x - R.turn.cx, y - R.turn.cy) - R.turn.r) < m) return true
  if (segDist(x, y, R.down.x, R.down.y, R.bend.x, R.bend.y) < m) return true
  return segDist(x, y, R.bend.x, R.bend.y, R.exit.x, R.exit.y + 4) < m
}

// how high a ball on the ramp looks (0 = playfield .. 1 = top), for the artwork
export const rampHeightOf = (T) => (x, y) => {
  const { mouth, up, turn, bend, exit } = T.ramp
  const upSide = T.mirrored ? x > turn.cx : x < turn.cx
  if (upSide) return y >= up.y ? Math.max(0, (mouth.y - y) / (mouth.y - up.y)) : 1
  if (y <= bend.y) return 1 - (0.4 * Math.max(0, y - up.y)) / (bend.y - up.y)
  return 0.6 - 0.3 * Math.min(1, (y - bend.y) / (exit.y - bend.y))
}

export const inShooterLane = (b) => b.layer === 0 && b.x > LANE.left && b.y > LANE.top - 10

const rubber = { e: 0.62, mu: 0.08 }
const wall = { e: 0.42, mu: 0.05 }
const metal = { e: 0.3, mu: 0.03 }

const lowerSkeleton = (colliders) => {
  SLINGS.forEach((s, i) => {
    const [[ax, ay], [bx, by], [cx, cy]] = s
    colliders.push(segment(ax, ay, bx, by, { ...rubber, rad: 5 }))
    colliders.push(segment(bx, by, cx, cy, { ...rubber, rad: 5 }))
    colliders.push(segment(ax, ay, cx, cy, { e: 0.6, mu: 0.05, rad: 5, kick: 640, tag: "sling", id: i }))
  })
  SEPARATORS.forEach((s) => colliders.push(segment(s.x, s.y0, s.x, s.y1, { ...wall, rad: 3 })))
  GUIDES.forEach(([ax, ay, bx, by]) => colliders.push(segment(ax, ay, bx, by, { ...wall, rad: 3 })))
}

const makeFlippers = () => [
  flipper({ x: FLIPPER.leftX, y: FLIPPER.pivotY, length: FLIPPER.length, r0: FLIPPER.r0, r1: FLIPPER.r1, rest: FLIPPER.rest, up: FLIPPER.up, side: "left" }),
  flipper({ x: mirror(FLIPPER.leftX), y: FLIPPER.pivotY, length: FLIPPER.length, r0: FLIPPER.r0, r1: FLIPPER.r1, rest: Math.PI - FLIPPER.rest, up: Math.PI - FLIPPER.up, side: "right" }),
]

const lowerSensors = () => [
  ...INLANES.map((p, i) => ({ x: p.x, y: p.y, r: 14, tag: "inlane", id: i })),
  ...OUTLANES.map((p, i) => ({ x: p.x, y: p.y, r: 16, tag: "outlane", id: i })),
]

// A main table's world parts (for physics.js createWorld)
export const buildTable = (T) => {
  const colliders = [
    arc(DOME.cx, DOME.cy, DOME.r, Math.PI, Math.PI * 2, { ...wall, mu: 0.02 }),
    segment(20, DOME.cy, 20, 1060, wall),
    segment(LANE.right, DOME.cy, LANE.right, 1060, wall),
    segment(LANE.left, LANE.top, LANE.left, 1060, { ...wall, rad: 2 }),
    gate(LANE.right - 2, 296, LANE.left, LANE.top, LANE.left - 30, LANE.top - 40, { ...wall, tag: "gate" }),
  ]
  for (const x of LANE_GUIDES) colliders.push(segment(x, LANE_TOP, x, LANE_BOTTOM, { ...rubber, rad: 4 }))

  // orbits
  const { orbitL: OL, orbitR: OR } = T
  colliders.push(segment(OL.x, OL.y0, OL.x, OL.y1, { ...wall, rad: 3 }))
  if (OL.flare) colliders.push(segment(OL.x, OL.y1, ...OL.flare, { ...wall, rad: 3 }))
  colliders.push(segment(OR.x, OR.y0, OR.x, OR.y1, { ...wall, rad: 3 }))
  if (OR.flare) colliders.push(segment(OR.x, OR.y1, ...OR.flare, { ...wall, rad: 3 }))
  for (const g of T.orbitGates) colliders.push(gate(...g.a, ...g.side, { ...metal, rad: 2 }))

  T.bumpers.forEach((b, i) => colliders.push(circle(b.x, b.y, b.r, { e: 0.5, mu: 0.02, kick: 760, tag: "bumper", id: i })))

  // E-V-O drop targets and the posts at the bank's ends
  const targets = bankTargets(T.bank)
  targets.forEach((t, i) => colliders.push(segment(t.x0, t.y0, t.x1, t.y1, { e: 0.35, mu: 0.05, rad: 3, tag: "target", id: i })))
  colliders.push(circle(T.bank.x0 - 3, T.bank.y0, 5, { ...rubber, tag: "post" }))
  colliders.push(circle(T.bank.x1 + 3, T.bank.y1, 5, { ...rubber, tag: "post", id: 1 }))

  // the critter in the middle: only solid while one is out to be caught
  colliders.push(circle(T.critter.x, T.critter.y, T.critter.r, { e: 0.55, mu: 0.04, kick: 420, tag: "critter", id: 0, active: false }))

  lowerSkeleton(colliders)

  // ---- the ramp (layer 1) ----
  const R = T.ramp
  const ramp = { ...metal, layer: 1, rad: 2 }
  const hw = R.half
  colliders.push(segment(R.mouth.x - hw, R.mouth.y, R.up.x - hw, R.up.y, ramp))
  colliders.push(segment(R.mouth.x + hw, R.mouth.y, R.up.x + hw, R.up.y, ramp))
  colliders.push(arc(R.turn.cx, R.turn.cy, R.turn.r + hw, Math.PI, Math.PI * 2, ramp))
  colliders.push(circle(R.turn.cx, R.turn.cy, R.turn.r - hw, ramp))
  colliders.push(segment(R.down.x - hw, R.down.y, R.bend.x - hw, R.bend.y, ramp))
  colliders.push(segment(R.down.x + hw, R.down.y, R.bend.x + hw, R.bend.y, ramp))
  colliders.push(segment(R.bend.x - hw, R.bend.y, R.exit.x - hw, R.exit.y, ramp))
  colliders.push(segment(R.bend.x + hw, R.bend.y, R.exit.x + hw, R.exit.y, ramp))
  colliders.push(circle(R.mouth.x - hw, R.mouth.y, 3, { ...metal }))
  colliders.push(circle(R.mouth.x + hw, R.mouth.y, 3, { ...metal }))
  const transitions = [
    transition(R.mouth.x - hw, R.mouth.y, R.mouth.x + hw, R.mouth.y, 0, 1, 0, -1, { tag: "rampEnter", margin: 6 }),
    transition(R.mouth.x - hw, R.mouth.y + 2, R.mouth.x + hw, R.mouth.y + 2, 1, 0, 0, 1, { tag: "rampFail" }),
    transition(R.exit.x - hw, R.exit.y, R.exit.x + hw, R.exit.y, 1, 0, 0, 1, { tag: "ramp" }),
  ]
  const slopes = [slope(R.mouth.x, R.mouth.y, R.up.x, R.up.y + 10, hw + 4, 0, 2100), slope(R.down.x, R.down.y + 10, R.bend.x, R.bend.y, hw + 4, 0, 250)]

  const plungerCollider = segment(LANE.left, PLUNGER.restY, LANE.right, PLUNGER.restY, { e: 0, mu: 0.02, tag: null, dynamic: true })
  colliders.push(plungerCollider)
  const plunger = { restY: PLUNGER.restY, y: PLUNGER.restY, vy: 0, collider: plungerCollider }

  const S = T.spinner
  const spinners = [spinner(S.ax, S.ay, S.bx, S.by, { tag: "spin", id: 0 })]

  const sensors = [
    ...ROLLOVERS.map((r, i) => ({ x: r.x, y: r.y, r: 12, tag: "rollover", id: i })),
    ...lowerSensors(),
    ...T.orbitSensors.map((p, i) => ({ x: p.x, y: p.y, r: 14, tag: "orbit", id: i })),
    { x: T.den.x, y: T.den.y, r: T.den.r, tag: "den", id: 0 },
    { x: T.cave.x, y: T.cave.y, r: T.cave.r, tag: "cave", id: 0 },
    { x: (LANE.left + LANE.right) / 2, y: LANE.top - 24, r: 16, tag: "laneExit", id: 0 },
  ]

  return { colliders, flippers: makeFlippers(), plunger, sensors, spinners, transitions, slopes, zones: { 1: onRampOf(R) } }
}

// ---- bonus stages: a closed table (no shooter lane), the ball dropped in from the top ----
export const BONUS_DOME = { cx: MID, cy: 280, r: MID - 20 }
export const BONUS_DROP = { x: MID, y: 120 }
export const MOLE_HOLES = [
  { x: 150, y: 330 },
  { x: 262, y: 290 },
  { x: 374, y: 330 },
  { x: 150, y: 480 },
  { x: 262, y: 450 },
  { x: 374, y: 480 },
]
export const MOLE_R = 18
// bosses are drawn twice as big as other critters, so they're big targets too
export const BOSS = {
  mole: { x: MID, y: 380, r: 40 },
  ghost: { x: MID, y: 330, r: 40, swing: 140 },
  crab: { x: MID, y: 330, r: 32, claw: 18, clawDx: 44, clawDy: -30, swing: 150 },
}
export const BONUS_BUMPERS = {
  mole: [],
  ghost: [
    { x: 160, y: 560, r: 22 },
    { x: 364, y: 560, r: 22 },
  ],
  crab: [
    { x: 120, y: 520, r: 20 },
    { x: 404, y: 520, r: 20 },
  ],
}

export const buildBonus = (kind) => {
  const colliders = [arc(BONUS_DOME.cx, BONUS_DOME.cy, BONUS_DOME.r, Math.PI, Math.PI * 2, { ...wall, mu: 0.02 }), segment(20, BONUS_DOME.cy, 20, 1060, wall), segment(LANE.left, BONUS_DOME.cy, LANE.left, 1060, wall)]
  lowerSkeleton(colliders)
  ;(BONUS_BUMPERS[kind] || []).forEach((b, i) => colliders.push(circle(b.x, b.y, b.r, { e: 0.5, mu: 0.02, kick: 700, tag: "bumper", id: i })))
  if (kind === "mole") {
    MOLE_HOLES.forEach((h, i) => colliders.push(circle(h.x, h.y, MOLE_R, { e: 0.5, mu: 0.04, kick: 380, tag: "mole", id: i, active: false })))
    const B = BOSS.mole
    colliders.push(circle(B.x, B.y, B.r, { e: 0.55, mu: 0.04, kick: 450, tag: "boss", id: 0, active: false }))
  } else if (kind === "ghost") {
    const B = BOSS.ghost
    colliders.push(circle(B.x, B.y, B.r, { e: 0.55, mu: 0.04, kick: 450, tag: "boss", id: 0, dynamic: true }))
  } else if (kind === "crab") {
    const B = BOSS.crab
    colliders.push(circle(B.x, B.y, B.r, { e: 0.55, mu: 0.04, kick: 450, tag: "boss", id: 0, dynamic: true }))
    colliders.push(circle(B.x - B.clawDx, B.y + B.clawDy, B.claw, { e: 0.6, mu: 0.04, kick: 520, tag: "claw", id: 0, dynamic: true }))
    colliders.push(circle(B.x + B.clawDx, B.y + B.clawDy, B.claw, { e: 0.6, mu: 0.04, kick: 520, tag: "claw", id: 1, dynamic: true }))
  }
  return { colliders, flippers: makeFlippers(), plunger: null, sensors: lowerSensors(), spinners: [], transitions: [], slopes: [], zones: {} }
}
