// The Deep Sea Dive table: where every wall, bumper, target and lane sits. The playfield
// runs from x = 20 to 504 (mirror line x = 262); the shooter lane is 504..540 on the right.
// Shapes are in table units (560 x 1000) and shared by the physics and the artwork.

import { arc, circle, flipper, segment } from "./physics.js"

export const WIDTH = 560
export const HEIGHT = 1000
export const MID = 262 // the playfield's mirror line
export const DRAIN_Y = 1040
export const LANE = { left: 504, right: 540, top: 340 } // the shooter lane
export const PLUNGER = { restY: 950, pull: 46 }
export const DOME = { cx: 280, cy: 290, r: 260 }
export const BALL_START = { x: (LANE.left + LANE.right) / 2, y: PLUNGER.restY - 12 }

export const BUMPERS = [
  { x: 212, y: 250, r: 24 },
  { x: 312, y: 250, r: 24 },
  { x: 262, y: 330, r: 24 },
]
export const LANE_GUIDES = [150, 205, 260, 315, 370] // the top rollover lanes' dividers
export const LANE_TOP = 112
export const LANE_BOTTOM = 160
export const ROLLOVERS = LANE_GUIDES.slice(0, 4).map((x, i) => ({ x: (x + LANE_GUIDES[i + 1]) / 2, y: 138, letter: "DIVE"[i] }))
export const TARGETS = [380, 421, 462].map((y) => ({ x: 33, y0: y, y1: y + 35 })) // the clam drop targets
export const CHEST = { x: 438, y: 470, r: 16 } // the treasure chest saucer
export const POSTS = [
  { x: 112, y: 566, r: 8 },
  { x: 412, y: 566, r: 8 },
  { x: 29, y: 371, r: 6 }, // caps the clam bank so balls rolling down the wall glance off
]
export const FLIPPER = { length: 78, r0: 11, r1: 6, rest: 0.52, up: -0.45, pivotY: 878, leftX: 174 }

const mirror = (x) => MID * 2 - x

// The slingshot triangles above the flippers: top, bottom-left, bottom-right (left side)
const SLING_L = [
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
  { x: 80, y: 762 },
  { x: mirror(80), y: 762 },
]
export const OUTLANES = [
  { x: 39, y: 830 },
  { x: mirror(39), y: 830 },
]

export const buildTable = () => {
  const rubber = { e: 0.62, mu: 0.08 }
  const wall = { e: 0.42, mu: 0.05 }
  const colliders = [
    // the dome over the top, the side walls, the shooter lane
    arc(DOME.cx, DOME.cy, DOME.r, Math.PI, Math.PI * 2, { ...wall, mu: 0.02 }),
    segment(20, DOME.cy, 20, 1060, wall),
    segment(LANE.right, DOME.cy, LANE.right, 1060, wall),
    segment(LANE.left, LANE.top, LANE.left, 1060, { ...wall, rad: 2 }),
    // the one-way gate over the top of the shooter lane: the ball leaves, but can't drop back in
    segment(LANE.right - 2, 306, LANE.left, LANE.top, { ...wall, oneSided: true, tag: "gate" }),
  ]

  // top lane dividers
  for (const x of LANE_GUIDES) colliders.push(segment(x, LANE_TOP, x, LANE_BOTTOM, { ...rubber, rad: 4 }))

  // pop bumpers: always kick
  BUMPERS.forEach((b, i) => colliders.push(circle(b.x, b.y, b.r, { e: 0.5, mu: 0.02, kick: 780, tag: "bumper", id: i })))

  // drop targets (facing into the table) along the left wall
  TARGETS.forEach((t, i) => colliders.push(segment(t.x, t.y0, t.x, t.y1, { e: 0.35, mu: 0.05, rad: 3, tag: "target", id: i })))

  POSTS.forEach((p, i) => colliders.push(circle(p.x, p.y, p.r, { ...rubber, e: 0.7, tag: "post", id: i })))

  // slingshots: the face toward the middle kicks, the other two sides are plain rubber
  SLINGS.forEach((s, i) => {
    const [[ax, ay], [bx, by], [cx, cy]] = s
    colliders.push(segment(ax, ay, bx, by, { ...rubber, rad: 5 }))
    colliders.push(segment(bx, by, cx, cy, { ...rubber, rad: 5 }))
    colliders.push(segment(ax, ay, cx, cy, { e: 0.6, mu: 0.05, rad: 5, kick: 640, tag: "sling", id: i }))
  })

  SEPARATORS.forEach((s) => {
    colliders.push(circle(s.x, s.y0, 5, rubber))
    colliders.push(segment(s.x, s.y0, s.x, s.y1, { ...wall, rad: 3 }))
  })
  GUIDES.forEach(([ax, ay, bx, by]) => colliders.push(segment(ax, ay, bx, by, { ...wall, rad: 3 })))

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
  ]

  const plungerCollider = segment(LANE.left, PLUNGER.restY, LANE.right, PLUNGER.restY, { e: 0, mu: 0.02, tag: null })
  colliders.push(plungerCollider)
  const plunger = { restY: PLUNGER.restY, y: PLUNGER.restY, vy: 0, collider: plungerCollider }

  const sensors = [
    ...ROLLOVERS.map((r, i) => ({ x: r.x, y: r.y, r: 13, tag: "rollover", id: i })),
    ...INLANES.map((p, i) => ({ x: p.x, y: p.y, r: 14, tag: "inlane", id: i })),
    ...OUTLANES.map((p, i) => ({ x: p.x, y: p.y, r: 16, tag: "outlane", id: i })),
    { x: CHEST.x, y: CHEST.y, r: CHEST.r, tag: "chest", id: 0 },
    // the top of the shooter lane: the ball has been launched into play
    { x: (LANE.left + LANE.right) / 2, y: LANE.top - 20, r: 16, tag: "laneExit", id: 0 },
  ]

  return { colliders, flippers, plunger, sensors }
}

export const inShooterLane = (b) => b.x > LANE.left && b.y > LANE.top - 10
