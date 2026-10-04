// The "Blue Screen" table: where every wall, bumper, target, lane and ramp sits. Shapes are
// in table units (560 x 1000) and shared by the physics (buildTable) and the artwork
// (art.js / render.js). The playfield runs from x = 20 to 504 (mirror line x = 262); the
// shooter lane is 504..540 on the right. Layer 0 is the playfield, layer 1 the
// "My Computer" ramp.
//
//   dome + top lanes M-S-G                  (skill shot: the blinking lane)
//   3 Start-button pop bumpers
//   left orbit (Hourglass spinner)  /  right orbit         loops = "Surf the Web"
//   upper-left flipper (mini playfield)
//   Floppy drive saucer    9-8-I-S-H drop targets    Hard Drive captive ball
//                      Blue Screen lock behind them
//   My Computer ramp (up the right, round the U, down to the right inlane)
//   slingshots, inlanes, outlanes: Restore kickback (left), Recycle Bin (right)
//   flippers, the Recycle Bin drain

import { arc, circle, flipper, gate, segment, slope, spinner, transition } from "./physics.js"

export const WIDTH = 560
export const HEIGHT = 1000
export const MID = 262 // the playfield's mirror line
export const DRAIN_Y = 1040
export const LANE = { left: 504, right: 540, top: 330 } // the shooter lane
export const PLUNGER = { restY: 950, pull: 46 }
export const DOME = { cx: 280, cy: 280, r: 260 }
export const BALL_START = { x: (LANE.left + LANE.right) / 2, y: PLUNGER.restY - 12 }

const mirror = (x) => MID * 2 - x

// top rollover lanes
export const LANE_GUIDES = [196, 240, 284, 328]
export const LANE_TOP = 84
export const LANE_BOTTOM = 140
export const ROLLOVERS = [0, 1, 2].map((i) => ({ x: (LANE_GUIDES[i] + LANE_GUIDES[i + 1]) / 2, y: 112, letter: "MSG"[i] }))

export const BUMPERS = [
  { x: 208, y: 205, r: 28 },
  { x: 316, y: 205, r: 28 },
  { x: 262, y: 284, r: 28 },
]

// the orbit lanes' inner walls
export const ORBIT_L = { x: 64, y0: 300, y1: 540, flare: [96, 590] }
export const ORBIT_R = { x: 460, y0: 300, y1: 522 }
export const ORBIT_SENSORS = [
  { x: 42, y: 420 },
  { x: 482, y: 420 },
]
export const SPINNER = { ax: 20, ay: 486, bx: 64, by: 486 } // the Hourglass

// the Blue Screen: a monitor-shaped box with the lock hole inside, open at the bottom
export const MONITOR = { x0: 230, x1: 294, y0: 372, y1: 422 }
export const SCOOP = { x: 262, y: 398, r: 12 }

// 9-8-I-S-H drop targets, facing down the table. The bank leans (higher on the right) so
// a ball landing on top of it rolls off instead of resting there.
export const BANK = { x0: 186, y0: 492, x1: 338, y1: 456 }
export const TARGETS = Array.from({ length: 5 }, (_, i) => {
  const at = (t) => [BANK.x0 + (BANK.x1 - BANK.x0) * t, BANK.y0 + (BANK.y1 - BANK.y0) * t]
  const [x0, y0] = at((i + 0.06) / 5)
  const [x1, y1] = at((i + 0.94) / 5)
  return { x0, y0, x1, y1, x: (x0 + x1) / 2, y: (y0 + y1) / 2, letter: "98ISH"[i] }
})

export const FLOPPY = { x: 120, y: 470, r: 13 } // the Floppy drive saucer

// the Hard Drive: a captive ball in a channel between the targets and the ramp
export const CAPTIVE = { x0: 347, x1: 379, top: 390, mouth: 500 }
export const CAPTIVE_HOME = { x: (CAPTIVE.x0 + CAPTIVE.x1) / 2, y: CAPTIVE.mouth - 13 }
export const DRIVE_SENSOR = { x: CAPTIVE_HOME.x, y: CAPTIVE.top + 18, r: 10 }

// the upper-left flipper (the mini playfield)
export const UPPER_FLIPPER = { x: 74, y: 336, length: 56, r0: 9, r1: 5, rest: 0.95, up: -0.12 }

// the My Computer ramp's centerline (layer 1): up the right side, a U turn at the top,
// down over the right orbit, and off onto the right inlane
export const RAMP = {
  half: 21, // half the lane's width
  mouth: { x: 416, y: 560 },
  up: { x: 416, y: 330 },
  turn: { cx: 443, cy: 330, r: 27 },
  down: { x: 470, y: 330 },
  bend: { x: 470, y: 560 },
  exit: { x: 448, y: 648 },
}

export const SLING_L = [
  [98, 690],
  [98, 776],
  [150, 815],
]
export const SLINGS = [SLING_L, SLING_L.map(([x, y]) => [mirror(x), y])]

// the outlane/inlane separators and the inlane guides onto the flippers
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
// the orbit exits: one-way gates that send balls coming down the orbits into the inlanes
export const ORBIT_GATES = [
  [20, 600, 70, 648],
  [LANE.left, 572, 464, 612],
]
export const FLIPPER = { length: 78, r0: 11, r1: 6, rest: 0.52, up: -0.45, pivotY: 878, leftX: 174 }

// where the ball shows on the ramp (0 = playfield level .. 1 = top), for the artwork
export const rampHeight = (x, y) => {
  const { mouth, up, turn, bend, exit } = RAMP
  if (x < turn.cx) return y >= up.y ? Math.max(0, (mouth.y - y) / (mouth.y - up.y)) : 1
  if (y <= bend.y) return 1 - (0.4 * Math.max(0, y - up.y)) / (bend.y - up.y)
  return 0.6 - (0.3 * Math.min(1, (y - bend.y) / (exit.y - bend.y)))
}

export const buildTable = () => {
  const rubber = { e: 0.62, mu: 0.08 }
  const wall = { e: 0.42, mu: 0.05 }
  const metal = { e: 0.3, mu: 0.03 }
  const colliders = [
    // the dome over the top, the side walls, the shooter lane
    arc(DOME.cx, DOME.cy, DOME.r, Math.PI, Math.PI * 2, { ...wall, mu: 0.02 }),
    segment(20, DOME.cy, 20, 1060, wall),
    segment(LANE.right, DOME.cy, LANE.right, 1060, wall),
    segment(LANE.left, LANE.top, LANE.left, 1060, { ...wall, rad: 2 }),
    // the one-way gate over the top of the shooter lane: the ball leaves, but can't drop back in
    gate(LANE.right - 2, 296, LANE.left, LANE.top, LANE.left - 30, LANE.top - 40, { ...wall, tag: "gate" }),
  ]

  // top lane dividers
  for (const x of LANE_GUIDES) colliders.push(segment(x, LANE_TOP, x, LANE_BOTTOM, { ...rubber, rad: 4 }))

  // the orbits: inner walls, and the gates at their feet
  colliders.push(segment(ORBIT_L.x, ORBIT_L.y0, ORBIT_L.x, ORBIT_L.y1, { ...wall, rad: 3 }))
  colliders.push(segment(ORBIT_L.x, ORBIT_L.y1, ...ORBIT_L.flare, { ...wall, rad: 3 }))
  colliders.push(segment(ORBIT_R.x, ORBIT_R.y0, ORBIT_R.x, ORBIT_R.y1, { ...wall, rad: 3 }))
  colliders.push(gate(...ORBIT_GATES[0], 30, 580, { ...metal, rad: 2 }))
  colliders.push(gate(...ORBIT_GATES[1], 490, 560, { ...metal, rad: 2 }))

  // Start-button pop bumpers: always kick
  BUMPERS.forEach((b, i) => colliders.push(circle(b.x, b.y, b.r, { e: 0.5, mu: 0.02, kick: 760, tag: "bumper", id: i })))

  // the Blue Screen monitor
  const { x0, x1, y0, y1 } = MONITOR
  colliders.push(segment(x0, y1, x0, y0, { ...wall, rad: 3 }))
  colliders.push(segment(x0, y0, x1, y0, { ...wall, rad: 3 }))
  colliders.push(segment(x1, y0, x1, y1, { ...wall, rad: 3 }))

  // drop targets and the posts at the bank's ends
  TARGETS.forEach((t, i) => colliders.push(segment(t.x0, t.y0, t.x1, t.y1, { e: 0.35, mu: 0.05, rad: 3, tag: "target", id: i })))
  colliders.push(circle(BANK.x0 - 3, BANK.y0 + 1, 5, { ...rubber, tag: "post" }))
  colliders.push(circle(BANK.x1 + 3, BANK.y1 - 1, 5, { ...rubber, tag: "post", id: 1 }))

  // the Hard Drive channel; the bar across its mouth only stops the captive ball
  colliders.push(segment(CAPTIVE.x0, CAPTIVE.mouth, CAPTIVE.x0, CAPTIVE.top, { ...wall, rad: 3 }))
  colliders.push(segment(CAPTIVE.x0, CAPTIVE.top, CAPTIVE.x1, CAPTIVE.top, { ...wall, rad: 3 }))
  colliders.push(segment(CAPTIVE.x1, CAPTIVE.top, CAPTIVE.x1, CAPTIVE.mouth, { ...wall, rad: 3 }))
  colliders.push(segment(CAPTIVE.x0, CAPTIVE.mouth + 2, CAPTIVE.x1, CAPTIVE.mouth + 2, { e: 0.1, mu: 0.1, rad: 1, only: "captive" }))

  // slingshots: the face toward the middle kicks, the other two sides are plain rubber
  SLINGS.forEach((s, i) => {
    const [[ax, ay], [bx, by], [cx, cy]] = s
    colliders.push(segment(ax, ay, bx, by, { ...rubber, rad: 5 }))
    colliders.push(segment(bx, by, cx, cy, { ...rubber, rad: 5 }))
    colliders.push(segment(ax, ay, cx, cy, { e: 0.6, mu: 0.05, rad: 5, kick: 640, tag: "sling", id: i }))
  })

  SEPARATORS.forEach((s) => colliders.push(segment(s.x, s.y0, s.x, s.y1, { ...wall, rad: 3 })))
  GUIDES.forEach(([ax, ay, bx, by]) => colliders.push(segment(ax, ay, bx, by, { ...wall, rad: 3 })))

  // ---- the ramp (layer 1) ----
  const R = RAMP
  const ramp = { ...metal, layer: 1, rad: 2 }
  const hw = R.half
  // up: two rails
  colliders.push(segment(R.mouth.x - hw, R.mouth.y, R.up.x - hw, R.up.y, ramp))
  colliders.push(segment(R.mouth.x + hw, R.mouth.y, R.up.x + hw, R.up.y, ramp))
  // the U: an outer arc and a post in the middle
  colliders.push(arc(R.turn.cx, R.turn.cy, R.turn.r + hw, Math.PI, Math.PI * 2, ramp))
  colliders.push(circle(R.turn.cx, R.turn.cy, R.turn.r - hw, ramp))
  // down, then the bend toward the inlane
  colliders.push(segment(R.down.x - hw, R.down.y, R.bend.x - hw, R.bend.y, ramp))
  colliders.push(segment(R.down.x + hw, R.down.y, R.bend.x + hw, R.bend.y, ramp))
  colliders.push(segment(R.bend.x - hw, R.bend.y, R.exit.x - hw, R.exit.y, ramp))
  colliders.push(segment(R.bend.x + hw, R.bend.y, R.exit.x + hw, R.exit.y, ramp))
  // a flap at the far end of the mouth so a ball can't fly back out over the rails' ends
  // the ramp's entrance edges are solid on the playfield too
  colliders.push(circle(R.mouth.x - hw, R.mouth.y, 3, { ...metal }))
  colliders.push(circle(R.mouth.x + hw, R.mouth.y, 3, { ...metal }))
  const transitions = [
    transition(R.mouth.x - hw, R.mouth.y, R.mouth.x + hw, R.mouth.y, 0, 1, 0, -1, { tag: "rampEnter", margin: 6 }),
    transition(R.mouth.x - hw, R.mouth.y + 2, R.mouth.x + hw, R.mouth.y + 2, 1, 0, 0, 1, { tag: "rampFail" }),
    transition(R.exit.x - hw, R.exit.y, R.exit.x + hw, R.exit.y, 1, 0, 0, 1, { tag: "ramp" }),
  ]
  const slopes = [
    slope(R.mouth.x, R.mouth.y, R.up.x, R.up.y + 10, hw + 4, 0, 2100),
    slope(R.down.x, R.down.y + 10, R.bend.x, R.bend.y, hw + 4, 0, 250),
  ]

  // ---- flippers ----
  const flippers = [
    flipper({ x: FLIPPER.leftX, y: FLIPPER.pivotY, length: FLIPPER.length, r0: FLIPPER.r0, r1: FLIPPER.r1, rest: FLIPPER.rest, up: FLIPPER.up, side: "left" }),
    flipper({
      x: mirror(FLIPPER.leftX),
      y: FLIPPER.pivotY,
      length: FLIPPER.length,
      r0: FLIPPER.r0,
      r1: FLIPPER.r1,
      rest: Math.PI - FLIPPER.rest,
      up: Math.PI - FLIPPER.up,
      side: "right",
    }),
    flipper({ ...UPPER_FLIPPER, side: "left", id: 2 }),
  ]

  const plungerCollider = segment(LANE.left, PLUNGER.restY, LANE.right, PLUNGER.restY, { e: 0, mu: 0.02, tag: null, dynamic: true })
  colliders.push(plungerCollider)
  const plunger = { restY: PLUNGER.restY, y: PLUNGER.restY, vy: 0, collider: plungerCollider }

  const spinners = [spinner(SPINNER.ax, SPINNER.ay, SPINNER.bx, SPINNER.by, { tag: "spin", id: 0 })]

  const sensors = [
    ...ROLLOVERS.map((r, i) => ({ x: r.x, y: r.y, r: 12, tag: "rollover", id: i })),
    ...INLANES.map((p, i) => ({ x: p.x, y: p.y, r: 14, tag: "inlane", id: i })),
    ...OUTLANES.map((p, i) => ({ x: p.x, y: p.y, r: 16, tag: "outlane", id: i })),
    ...ORBIT_SENSORS.map((p, i) => ({ x: p.x, y: p.y, r: 14, tag: "orbit", id: i })),
    { x: SCOOP.x, y: SCOOP.y, r: SCOOP.r, tag: "scoop", id: 0 },
    { x: FLOPPY.x, y: FLOPPY.y, r: FLOPPY.r, tag: "floppy", id: 0 },
    { x: DRIVE_SENSOR.x, y: DRIVE_SENSOR.y, r: DRIVE_SENSOR.r, tag: "drive", id: 0, only: "captive" },
    // the top of the shooter lane: the ball has been launched into play
    { x: (LANE.left + LANE.right) / 2, y: LANE.top - 24, r: 16, tag: "laneExit", id: 0 },
  ]

  return { colliders, flippers, plunger, sensors, spinners, transitions, slopes, zones: { 1: onRamp } }
}

// is (x, y) over the ramp (within its lane, plus a little)?
const segDist = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax
  const dy = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)))
  return Math.hypot(px - ax - t * dx, py - ay - t * dy)
}
export const onRamp = (x, y) => {
  const R = RAMP
  const m = R.half + 6
  if (segDist(x, y, R.mouth.x, R.mouth.y + 4, R.up.x, R.up.y) < m) return true
  if (y <= R.turn.cy + 2 && Math.abs(Math.hypot(x - R.turn.cx, y - R.turn.cy) - R.turn.r) < m) return true
  if (segDist(x, y, R.down.x, R.down.y, R.bend.x, R.bend.y) < m) return true
  return segDist(x, y, R.bend.x, R.bend.y, R.exit.x, R.exit.y + 4) < m
}

export const inShooterLane = (b) => b.layer === 0 && b.x > LANE.left && b.y > LANE.top - 10
