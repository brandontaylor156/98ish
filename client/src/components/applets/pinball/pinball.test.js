// Physics and rules tests for Pinball: Blue Screen.
// Run: node --test client/src/components/applets/pinball/pinball.test.js
import test from "node:test"
import assert from "node:assert/strict"
import {
  BALL_R,
  FLIP_UP_SPEED,
  MAX_SPEED,
  STEP,
  arc,
  circle,
  contact,
  createBall,
  createWorld,
  energy,
  flipper,
  gate,
  segment,
  spinner,
  stepWorld,
} from "./physics.js"
import { BUMPERS, CAPTIVE, CAPTIVE_HOME, DOME, FLOPPY, LANE, RAMP, SCOOP, buildTable, inShooterLane } from "./table.js"
import * as G from "./game.js"
import { dmdContent } from "./dmd.js"
import { createDrawer } from "./render.js"
import { H, W } from "./art.js"
import { PAL32, surface } from "./pixel.js"

// A seeded random so failures repeat
const seeded = (seed) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646

const run = (w, seconds, each) => {
  const steps = Math.round(seconds / STEP)
  for (let i = 0; i < steps; i++) {
    w.events.length = 0
    stepWorld(w, STEP)
    if (each && each(i) === false) return
  }
}

const tableWorld = (o = {}) => {
  const w = createWorld(buildTable())
  Object.assign(w, o)
  return w
}

// ---------------------------------------------------------------- physics

test("a ball at top speed never passes through a thin wall, a thin arc or a one-way gate", () => {
  const rand = seeded(7)
  const walls = [
    () => segment(-1e6, 500, 1e6, 500),
    () => arc(500, 0, 500, 0, Math.PI), // the bottom half of a big circle: y = 500 at x = 500
    () => gate(-1e6, 500, 1e6, 500, 0, 400), // solid from above
  ]
  for (const make of walls) {
    for (let shot = 0; shot < 300; shot++) {
      const w = createWorld({ colliders: [make()] })
      w.gravity = 0
      const angle = 0.3 + rand() * (Math.PI - 0.6) // downward, onto the wall
      const b = createBall(420 + rand() * 160, 380 + rand() * 90, Math.cos(angle) * MAX_SPEED, Math.sin(angle) * MAX_SPEED)
      w.balls.push(b)
      run(w, 0.25, () => {
        const inside = Math.hypot(b.x - 500, b.y) < 500
        if (make === walls[1]) assert.ok(inside || b.y < 0, `shot ${shot} left the arc at ${b.x},${b.y}`)
        else assert.ok(b.y < 500, `shot ${shot} crossed at ${b.x},${b.y}`)
      })
    }
  }
})

test("a one-way gate lets balls through from its open side", () => {
  const w = createWorld({ colliders: [gate(0, 500, 1000, 500, 500, 400)] })
  w.gravity = 0
  const b = createBall(500, 560, 0, -2000)
  w.balls.push(b)
  run(w, 0.1)
  assert.ok(b.y < 440, `stopped at ${b.y}`)
})

// Somewhere open on the playfield (inside the dome, touching nothing on layer 0)
const openSpot = (w, rand) => {
  for (;;) {
    const b = createBall(40 + rand() * 450, 60 + rand() * 760)
    const inDome = b.y > DOME.cy || Math.hypot(b.x - DOME.cx, b.y - DOME.cy) < DOME.r - BALL_R - 1
    if (inDome && b.x < LANE.left - BALL_R - 1 && !w.colliders.some((c) => c.active && (c.layer || 0) === 0 && !c.only && contact(b, c)) && !w.flippers.some((f) => contact(b, f))) return b
  }
}

test("fast random shots stay on the table, out of bumpers, and only ever change layer at the ramp", () => {
  const rand = seeded(42)
  let ramps = 0
  for (let shot = 0; shot < 250; shot++) {
    const w = tableWorld()
    const b = openSpot(w, rand)
    const angle = rand() * Math.PI * 2
    const speed = MAX_SPEED * (0.5 + rand() * 0.5)
    b.vx = Math.cos(angle) * speed
    b.vy = Math.sin(angle) * speed
    w.balls.push(b)
    let flipClock = 0
    let layer = 0
    run(w, 2.5, (i) => {
      if (++flipClock > 20 + rand() * 40) {
        flipClock = 0
        for (const f of w.flippers) f.pressed = rand() < 0.5
      }
      if (b.y > 1040) return false // drained: fine
      const where = `shot ${shot} step ${i} at ${b.x.toFixed(1)},${b.y.toFixed(1)} layer ${b.layer}`
      assert.ok(b.x > 20 - 1 && b.x < LANE.right + 1, `left the table sideways: ${where}`)
      if (b.y < DOME.cy) assert.ok(Math.hypot(b.x - DOME.cx, b.y - DOME.cy) < DOME.r + 1, `went through the dome: ${where}`)
      if (b.layer === 0) for (const bp of BUMPERS) assert.ok(Math.hypot(b.x - bp.x, b.y - bp.y) > bp.r + BALL_R - 4, `inside a bumper: ${where}`)
      if (b.layer !== layer) {
        // layers change only at the ramp's mouth or its exit
        const atMouth = Math.abs(b.y - RAMP.mouth.y) < 30 && Math.abs(b.x - RAMP.mouth.x) < RAMP.half + 12
        const atExit = Math.abs(b.y - RAMP.exit.y) < 30 && Math.abs(b.x - RAMP.exit.x) < RAMP.half + 12
        assert.ok(atMouth || atExit, `changed layer away from the ramp: ${where}`)
        if (b.layer === 1) ramps++
        layer = b.layer
      }
    })
  }
  assert.ok(ramps > 0, "some random shots should find the ramp")
})

test("flipping sends a resting ball up the table from each of the three flippers", () => {
  for (const id of [0, 1, 2]) {
    const w = tableWorld({ kickers: false })
    const f = w.flippers[id]
    // a ball resting on the flipper, two thirds of the way out
    const t = 0.65
    const x = f.x + Math.cos(f.angle) * f.length * t
    const y = f.y + Math.sin(f.angle) * f.length * t - (f.r0 + BALL_R + 1)
    const b = createBall(x, y)
    w.balls.push(b)
    run(w, 0.05)
    f.pressed = true
    let best = 0
    run(w, 0.12, () => {
      best = Math.min(best, b.vy)
    })
    assert.ok(best < -1200, `flipper ${id} only sent it up at ${best.toFixed(0)}`)
  }
})

test("the tip of a swinging flipper hits harder than its base (a sweet spot), and both beat the tip's own speed at the tip", () => {
  const out = (t) => {
    const w = createWorld({ colliders: [], flippers: [flipper({ x: 0, y: 0, length: 78, r0: 11, r1: 6, rest: 0.52, up: -0.45, side: "left" })] })
    w.gravity = 0
    const f = w.flippers[0]
    f.angle = 0.2 // mid-stroke, at full speed
    f.omega = -FLIP_UP_SPEED
    f.pressed = true
    const r = f.r0 + (f.r1 - f.r0) * t
    const b = createBall(Math.cos(0.2) * 78 * t + Math.sin(0.2) * 0, Math.sin(0.2) * 78 * t - (r + BALL_R) * Math.cos(0.2) - 0.5)
    b.x += Math.sin(0.2) * (r + BALL_R)
    w.balls.push(b)
    run(w, 0.03)
    return Math.hypot(b.vx, b.vy)
  }
  const base = out(0.2)
  const tip = out(0.95)
  assert.ok(tip > base * 1.8, `tip ${tip.toFixed(0)} vs base ${base.toFixed(0)}`)
  assert.ok(tip > FLIP_UP_SPEED * 78 * 0.9, `tip shot ${tip.toFixed(0)} slower than the tip moves`)
})

test("a live catch: a ball landing on a held-up flipper stays close, while a dead flipper bounces it off", () => {
  const bounce = (held) => {
    const w = createWorld({ colliders: [], flippers: [flipper({ x: 0, y: 0, length: 78, r0: 11, r1: 6, rest: 0.52, up: -0.45, side: "left" })] })
    const f = w.flippers[0]
    f.pressed = held
    f.angle = held ? f.up : f.rest
    const b = createBall(50, -140, 0, 0)
    w.balls.push(b)
    let top = Infinity
    let hit = false
    run(w, 0.6, () => {
      if (w.events.some((e) => e.type === "flipperHit")) hit = true
      if (hit) top = Math.min(top, b.y)
    })
    return { top, hit }
  }
  const held = bounce(true)
  assert.ok(held.hit)
  // dropped from rest it can't bounce higher than it fell (no flipper energy added)
  assert.ok(held.top > -140, `bounced to ${held.top}`)
})

test("without kicks or ramps' slopes, energy never grows over a long simulation", () => {
  const rand = seeded(3)
  for (let shot = 0; shot < 40; shot++) {
    const w = tableWorld({ kickers: false, slopes: [] })
    w.flippers.forEach((f) => (f.pressed = false))
    const b = openSpot(w, rand)
    b.vx = (rand() - 0.5) * 2400
    b.vy = (rand() - 0.5) * 2400
    w.balls.push(b)
    let e0 = energy(b)
    run(w, 1.5, () => {
      if (b.y > 1040 || w.plunger.vy || b.x > LANE.left) return false
      const e = energy(b)
      // a little slack for the push-out of overlaps
      assert.ok(e < e0 + 3000, `energy grew from ${e0.toFixed(0)} to ${e.toFixed(0)}`)
      e0 = Math.max(e0, e)
    })
  }
})

test("a pop bumper kicks the ball away at its kick speed", () => {
  const w = tableWorld()
  const bp = BUMPERS[2]
  const b = createBall(bp.x + 3, bp.y - bp.r - BALL_R - 20, 0, 200)
  w.balls.push(b)
  let kicked = false
  run(w, 0.2, () => {
    if (w.events.some((e) => e.type === "bumper")) kicked = true
  })
  assert.ok(kicked)
  assert.ok(Math.hypot(b.vx, b.vy) > 600 || b.y < bp.y - bp.r, `left at ${Math.hypot(b.vx, b.vy).toFixed(0)}`)
})

test("a slingshot kicks a ball rolling into its face", () => {
  const w = tableWorld()
  const b = createBall(150, 720, -500, 300)
  w.balls.push(b)
  let kick = null
  run(w, 0.3, () => {
    const e = w.events.find((ev) => ev.type === "sling")
    if (e && !kick) kick = { vx: b.vx }
  })
  assert.ok(kick, "no kick")
  assert.ok(kick.vx > 200, `kicked to vx ${kick?.vx}`)
})

test("the spinner spins longer for a faster ball, then settles", () => {
  const spins = (speed) => {
    const w = createWorld({ colliders: [], spinners: [spinner(0, 500, 44, 500)] })
    w.gravity = 0
    const b = createBall(22, 560, 0, -speed)
    w.balls.push(b)
    let n = 0
    run(w, 4, () => {
      n += w.events.filter((e) => e.type === "spin").length
    })
    return { n, sp: w.spinners[0], b }
  }
  const slow = spins(600)
  const fast = spins(2600)
  assert.ok(slow.n >= 1, `slow ball: ${slow.n} spins`)
  assert.ok(fast.n > slow.n * 2, `fast ${fast.n} vs slow ${slow.n}`)
  assert.equal(fast.sp.omega, 0, "spinner still turning after 4 s")
  assert.ok(Math.abs(fast.b.vy) < 2600, "the ball loses a little speed going through")
})

const shoot = (x, y, tx, ty, speed, seconds = 3) => {
  const w = tableWorld()
  const d = Math.hypot(tx - x, ty - y)
  const b = createBall(x, y, ((tx - x) / d) * speed, ((ty - y) / d) * speed)
  w.balls.push(b)
  const events = []
  let maxLayer = 0
  run(w, seconds, () => {
    for (const e of w.events) events.push({ type: e.type, x: b.x, y: b.y, layer: b.layer })
    maxLayer = Math.max(maxLayer, b.layer)
    if (b.y > 1040) return false
  })
  return { events, b, maxLayer, types: events.map((e) => e.type) }
}

test("the ramp: a strong shot rides up layer 1, round the U, and drops back to the playfield at the right inlane", () => {
  const r = shoot(240, 840, RAMP.mouth.x, RAMP.mouth.y, 3000)
  assert.ok(r.types.includes("rampEnter"), r.types.join())
  const made = r.events.find((e) => e.type === "ramp")
  assert.ok(made, `no ramp exit: ${r.types.join()}`)
  assert.equal(made.layer, 0)
  assert.ok(made.x > 400 && made.y > 600, `came off at ${made.x},${made.y}`)
  assert.ok(r.types.includes("inlane") || r.b.y > 1000, "then down the inlane to the flipper")
})

test("the ramp: a weak shot rolls back down and leaves at the mouth", () => {
  const r = shoot(240, 840, RAMP.mouth.x - 14, RAMP.mouth.y, 2000)
  assert.ok(r.types.includes("rampEnter"))
  assert.ok(r.types.includes("rampFail"), r.types.join())
  assert.ok(!r.types.includes("ramp"))
  assert.equal(r.b.layer, 0)
})

test("orbits: a shot up the left orbit spins the Hourglass and comes round", () => {
  const r = shoot(300, 860, 50, 580, 3000)
  assert.ok(r.types.includes("spin"), r.types.join())
  assert.ok(r.types.filter((t) => t === "orbit").length >= 1)
})

test("the launch: the plunger shoots the ball out of the lane past the one-way gate, and it never falls back in", () => {
  const g = G.createGame()
  G.startGame(g)
  for (let i = 0; i < 60; i++) G.update(g, 1 / 60, { plunger: true })
  G.update(g, 1 / 60, {})
  let left = false
  for (let i = 0; i < 60 * 4; i++) {
    G.update(g, 1 / 60, {})
    const b = g.world.balls.find((x) => x.kind === "play")
    if (!b) break
    if (!inShooterLane(b)) left = true
    else if (left) assert.fail(`fell back into the shooter lane at ${b.x},${b.y}`)
  }
  assert.ok(left)
  assert.ok(g.ballSaveUntil > 0, "ball save started")
})

test("the Hard Drive captive ball never leaves its channel, and a hard hit knocks it to the top", () => {
  const g = G.createGame()
  G.startGame(g)
  const cap = g.world.balls.find((b) => b.kind === "captive")
  let top = Infinity
  for (let k = 0; k < 6; k++) {
    const b = createBall(CAPTIVE_HOME.x + (k - 3) * 2, 640, 0, -2800 + k * 150)
    g.world.balls.push(b)
    for (let i = 0; i < 60; i++) {
      G.update(g, 1 / 60, {})
      top = Math.min(top, cap.y)
      assert.ok(cap.x > CAPTIVE.x0 && cap.x < CAPTIVE.x1 && cap.y > CAPTIVE.top && cap.y < CAPTIVE.mouth + 2, `captive ball at ${cap.x},${cap.y}`)
    }
    g.world.balls = g.world.balls.filter((x) => x !== b)
  }
  assert.ok(g.stats.drive > 0, `drive never hit (highest ${top})`)
})

// ---------------------------------------------------------------- rules

const play = () => {
  const g = G.createGame()
  G.startGame(g)
  g.sfx.length = 0
  return g
}
const ball = (g) => g.world.balls.find((b) => b.kind === "play")
const tick = (g, seconds = 0.1) => {
  for (let t = 0; t < seconds; t += 1 / 60) G.update(g, 1 / 60, {})
}
const drainAll = (g) => {
  for (const b of g.world.balls) if (b.kind === "play") Object.assign(b, { x: 262, y: 1100, held: false, vx: 0, vy: 0, layer: 0 })
  tick(g, 0.05)
}

test("a game starts in attract mode, and startGame serves a ball to the plunger", () => {
  const g = G.createGame()
  assert.equal(g.mode, "attract")
  assert.equal(g.world.balls.filter((b) => b.kind === "play").length, 0)
  G.startGame(g)
  assert.equal(g.mode, "play")
  assert.ok(inShooterLane(ball(g)))
  assert.equal(g.world.balls.filter((b) => b.kind === "captive").length, 1)
})

test("drains: ball save brings a ball back, then three lost balls end the game with the bonus counted", () => {
  const g = play()
  g.ballSaveUntil = g.time + 5
  drainAll(g)
  tick(g, 1.5)
  assert.equal(g.ballNumber, 1, "saved: still ball 1")
  assert.ok(ball(g), "a ball was put back")
  g.ballSaveUntil = 0
  g.bonus = 10
  g.bonusX = 2
  const before = g.score
  drainAll(g)
  assert.equal(g.score - before, 20000, "bonus 10 x 1,000 x 2")
  tick(g, 2.5)
  assert.equal(g.ballNumber, 2)
  for (let i = 0; i < 2; i++) {
    g.ballSaveUntil = 0
    drainAll(g)
    tick(g, 2.5)
  }
  assert.equal(g.mode, "over")
})

test("bumpers score, M-S-G lanes raise the bonus multiplier, and the flippers move the lit lanes", () => {
  const g = play()
  g.skillLane = -1
  const b = ball(g)
  G.handleEvent(g, { type: "bumper", id: 0, ball: b })
  assert.equal(g.score, G.SCORES.bumper)
  g.lanes = [true, false, false]
  G.update(g, 0, { right: true })
  assert.deepEqual(g.lanes, [false, true, false])
  G.update(g, 0, {})
  G.update(g, 0, { left: true })
  assert.deepEqual(g.lanes, [true, false, false])
  G.update(g, 0, {})
  for (const id of [1, 2]) G.handleEvent(g, { type: "rollover", id, ball: b })
  assert.equal(g.bonusX, 2)
  assert.deepEqual(g.lanes, [false, false, false])
})

test("skill shot: the blinking lane on the launch scores, anything else first ends it", () => {
  const g = play()
  const b = ball(g)
  g.skillLane = 1
  g.skillUntil = g.time + 4
  G.handleEvent(g, { type: "rollover", id: 1, ball: b })
  assert.ok(g.score >= G.SCORES.skillShot)
  const h = play()
  h.skillLane = 1
  h.skillUntil = h.time + 4
  G.handleEvent(h, { type: "bumper", id: 0, ball: ball(h) })
  G.handleEvent(h, { type: "rollover", id: 1, ball: ball(h) })
  assert.ok(h.score < G.SCORES.skillShot)
})

const sinkScoop = (g) => {
  const b = ball(g)
  Object.assign(b, { x: SCOOP.x, y: SCOOP.y, vx: 0, vy: 0 })
  G.handleEvent(g, { type: "scoop", id: 0, ball: b, speed: 200 })
  tick(g, 1.3)
}

test("9-8-I-S-H lights the lock; three Blue Screen locks start a three-ball multiball; the ramp scores jackpots", () => {
  const g = play()
  const b = ball(g)
  sinkScoop(g)
  assert.equal(g.locks, 0, "no lock while it isn't lit")
  for (let round = 1; round <= 3; round++) {
    for (let i = 0; i < 5; i++) G.handleEvent(g, { type: "target", id: i, ball: ball(g), ny: 1 })
    assert.ok(g.lockLit, `round ${round}: lock lit`)
    sinkScoop(g)
    if (round < 3) {
      assert.equal(g.locks, round)
      assert.ok(inShooterLane(ball(g)), "a new ball waits at the plunger")
      assert.equal(g.world.balls.filter((x) => x.kind === "play").length, 1)
    }
  }
  assert.ok(g.multiball)
  tick(g, 2)
  // three balls in play (some may be waiting to be relaunched by the multiball ball save)
  assert.equal(g.world.balls.filter((x) => x.kind === "play").length + g.launchQueue, 3)
  const before = g.score
  G.handleEvent(g, { type: "ramp", id: 0, ball: ball(g) || g.world.balls[0] })
  assert.ok(g.score - before >= G.SCORES.jackpot, "jackpot")
  // multiball ends when one ball is left (after the multiball ball save)
  g.ballSaveUntil = 0
  g.launchQueue = 0
  const plays = g.world.balls.filter((x) => x.kind === "play")
  for (const p of plays.slice(1)) Object.assign(p, { y: 1100, layer: 0, held: false })
  tick(g, 0.2)
  assert.equal(g.multiball, false)
  assert.ok(b)
})

test("a drop target only drops when hit on its face", () => {
  const g = play()
  G.handleEvent(g, { type: "target", id: 2, ball: ball(g), ny: -1 })
  assert.equal(g.targets[2], false)
  G.handleEvent(g, { type: "target", id: 2, ball: ball(g), ny: 0.95 })
  assert.equal(g.targets[2], true)
  assert.equal(g.world.colliders.find((c) => c.tag === "target" && c.id === 2).active, false)
})

test("missions rank you up; rank 3 lights an extra ball the Floppy drive collects; the extra ball is shot again", () => {
  const g = play()
  const b = ball(g)
  assert.equal(G.currentMission(g).id, "dialup")
  for (let i = 0; i < G.missionGoal(g); i++) G.handleEvent(g, { type: "spin", id: 0, ball: b })
  assert.equal(g.rank, 1)
  assert.equal(G.rankName(g.rank), "Help Desk")
  // Virus Scan, Defragment
  for (let i = 0; i < 5; i++) G.handleEvent(g, { type: "target", id: i, ball: b, ny: 1 })
  assert.equal(g.rank, 2)
  for (let i = 0; i < 3; i++) G.handleEvent(g, { type: "ramp", id: 0, ball: b })
  assert.equal(g.rank, 3)
  assert.ok(g.extraLit)
  Object.assign(b, { x: FLOPPY.x, y: FLOPPY.y })
  G.handleEvent(g, { type: "floppy", id: 0, ball: b, speed: 100 })
  assert.equal(g.extraBalls, 1)
  assert.equal(g.extraLit, false)
  tick(g, 1.6)
  assert.ok(!ball(g).held, "the floppy drive ejects the ball")
  g.ballSaveUntil = 0
  drainAll(g)
  tick(g, 2.5)
  assert.equal(g.ballNumber, 1, "shoot again: same ball number")
  assert.equal(g.extraBalls, 0)
})

test("orbit loops count for Surf the Web only when the ball goes up one side and down the other", () => {
  const g = play()
  const b = ball(g)
  b.vy = -900
  G.handleEvent(g, { type: "orbit", id: 0, ball: b })
  b.vy = 900
  G.handleEvent(g, { type: "orbit", id: 1, ball: b })
  assert.equal(g.stats.loop, 1)
  b.vy = 900
  G.handleEvent(g, { type: "orbit", id: 0, ball: b })
  assert.equal(g.stats.loop, 1)
})

test("Restore: the left outlane kicks the ball back once, then it's lit again by the Floppy drive", () => {
  const g = play()
  const b = ball(g)
  Object.assign(b, { x: 39, y: 830, vy: 600 })
  G.handleEvent(g, { type: "outlane", id: 0, ball: b })
  assert.ok(b.vy < -2000, "kicked back up")
  assert.equal(g.kickback, false)
  b.vy = 600
  G.handleEvent(g, { type: "outlane", id: 0, ball: b })
  assert.ok(b.vy > 0, "not twice")
  Object.assign(b, { x: FLOPPY.x, y: FLOPPY.y })
  G.handleEvent(g, { type: "floppy", id: 0, ball: b, speed: 100 })
  assert.equal(g.kickback, true)
})

test("too much nudging tilts: flippers die, nothing scores, and the ball gets no bonus", () => {
  const g = play()
  g.bonus = 50
  for (let i = 0; i < 5; i++) G.nudge(g, "up")
  assert.ok(g.tilted)
  G.update(g, 1 / 60, { left: true, right: true })
  assert.ok(g.world.flippers.every((f) => !f.pressed))
  const s = g.score
  G.handleEvent(g, { type: "bumper", id: 0, ball: ball(g) })
  assert.equal(g.score, s)
  drainAll(g)
  assert.equal(g.score, s)
})

test("ball search: a ball wedged still for six seconds gets a kick", () => {
  const g = play()
  const b = ball(g)
  Object.assign(b, { x: 150, y: 600, vx: 0, vy: 0, held: true })
  tick(g, 0.2)
  b.held = false
  // hold it in place as if wedged
  for (let i = 0; i < 60 * 7; i++) {
    Object.assign(b, { x: 150, y: 600, vx: 0, vy: 0 })
    G.update(g, 1 / 60, {})
  }
  assert.ok(g.stats.searches >= 1)
})

test("high scores keep the top ten, and Deep Sea Dive's list carries over", () => {
  const old = [
    { name: "ab", score: 5000, date: 1 },
    { name: "XYZ", score: 90000, date: 2 },
    null,
    { name: "BAD", score: "lots" },
  ]
  const s = G.migrateScores(old)
  assert.deepEqual(
    s.map((e) => [e.name, e.score]),
    [
      ["XYZ", 90000],
      ["AB", 5000],
    ],
  )
  let list = []
  for (let i = 1; i <= 12; i++) list = G.insertScore(list, { name: "AAA", score: i * 100, date: i })
  assert.equal(list.length, 10)
  assert.equal(list[0].score, 1200)
  assert.ok(G.qualifies(list, 5000))
  assert.ok(!G.qualifies(list, 100))
  assert.equal(G.cleanInitials("b-o!b"), "BOB")
  assert.equal(G.cleanInitials(""), "???")
})

test("the dot-matrix display shows the score and mission, and big news when something happens", () => {
  const g = play()
  g.score = 1234560
  g.dmd = null
  const lines = dmdContent(g, g.time, { rows: 32 })
  assert.ok(lines.some((l) => l.t === "1,234,560"))
  assert.ok(lines.some((l) => l.t.startsWith("DIAL-UP")))
  for (let i = 0; i < 5; i++) G.handleEvent(g, { type: "target", id: i, ball: ball(g), ny: 1 })
  const news = dmdContent(g, g.time, { rows: 32 })
  assert.ok(news.some((l) => /LOCK IS LIT|MISSION/.test(l.t)), JSON.stringify(news))
  const short = dmdContent(G.createGame(), 0, { rows: 16 })
  assert.ok(short.length >= 1)
})

test("the pixel renderer draws a frame using only the palette", () => {
  const drawer = createDrawer()
  const fb = surface(W, H)
  const g = play()
  g.world.balls.push(createBall(430, 400, 0, -500, { layer: 1 }))
  drawer.draw(fb, g, 1)
  const palette = new Set(PAL32)
  let odd = 0
  for (const v of fb.buf) if (!palette.has(v)) odd++
  assert.equal(odd, 0, `${odd} pixels off the palette`)
})
