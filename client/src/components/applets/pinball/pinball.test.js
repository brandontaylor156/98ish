// Physics and rules tests for Pinball. Run: node --test client/src/components/applets/pinball/
import test from "node:test"
import assert from "node:assert/strict"
import { BALL_R, MAX_SPEED, STEP, contact, createBall, createWorld, energy, segment, stepWorld } from "./physics.js"
import { BUMPERS, DOME, LANE, buildTable } from "./table.js"
import * as G from "./game.js"

// A seeded random so failures repeat
const seeded = (seed) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646

const run = (w, seconds, each) => {
  const steps = Math.round(seconds / STEP)
  for (let i = 0; i < steps; i++) {
    stepWorld(w, STEP)
    if (each && each(i) === false) return
  }
}

test("a ball at top speed never passes through a thin wall", () => {
  const rand = seeded(7)
  for (let shot = 0; shot < 600; shot++) {
    const w = createWorld({ colliders: [segment(-1e6, 500, 1e6, 500)] })
    w.gravity = 0
    const angle = 0.1 + rand() * (Math.PI - 0.2) // somewhere downward, onto the wall
    const b = createBall(200 + rand() * 600, 380 + rand() * 100, Math.cos(angle) * MAX_SPEED, Math.sin(angle) * MAX_SPEED)
    w.balls.push(b)
    run(w, 0.3, () => assert.ok(b.y < 500, `shot ${shot} crossed the wall at ${b.x},${b.y}`))
  }
})

// Somewhere open on the playfield (inside the dome, touching nothing)
const openSpot = (w, rand) => {
  for (;;) {
    const b = createBall(40 + rand() * 450, 60 + rand() * 760)
    const inDome = b.y > DOME.cy || Math.hypot(b.x - DOME.cx, b.y - DOME.cy) < DOME.r - BALL_R - 1
    if (inDome && b.x < LANE.left - BALL_R - 1 && !w.colliders.some((c) => c.active && contact(b, c)) && !w.flippers.some((f) => contact(b, f))) return b
  }
}

test("fast random shots stay on the table, out of bumpers, flippers and the shooter lane", () => {
  const rand = seeded(42)
  for (let shot = 0; shot < 250; shot++) {
    const w = createWorld(buildTable())
    const b = openSpot(w, rand)
    const angle = rand() * Math.PI * 2
    const speed = MAX_SPEED * (0.5 + rand() * 0.5)
    b.vx = Math.cos(angle) * speed
    b.vy = Math.sin(angle) * speed
    w.balls.push(b)
    let flipClock = 0
    run(w, 2.5, (i) => {
      // flap the flippers at random
      if (++flipClock > 20 + rand() * 40) {
        flipClock = 0
        for (const f of w.flippers) f.pressed = rand() < 0.5
      }
      if (b.y > 1040) return false // drained: fine
      const where = `shot ${shot} step ${i} at ${b.x.toFixed(1)},${b.y.toFixed(1)}`
      assert.ok(b.x > 20 && b.x < LANE.right, `left the table sideways: ${where}`)
      if (b.y < DOME.cy) assert.ok(Math.hypot(b.x - DOME.cx, b.y - DOME.cy) < DOME.r, `went through the dome: ${where}`)
      if (b.y > LANE.top + 15) assert.ok(b.x < LANE.left, `got into the shooter lane through its wall: ${where}`)
      for (const p of BUMPERS) assert.ok(Math.hypot(b.x - p.x, b.y - p.y) > p.r + BALL_R * 0.5, `inside a bumper: ${where}`)
      for (const f of w.flippers) {
        const hit = contact(b, f)
        assert.ok(!hit || hit.pen < BALL_R * 0.6, `through a flipper (${hit?.pen}): ${where}`)
      }
    })
  }
})

// Roll a ball down an inlane onto the flipper and flip when it gets near the tip
const flipShot = (side, flipAt) => {
  const w = createWorld(buildTable())
  const f = w.flippers[side === "left" ? 0 : 1]
  const b = createBall(side === "left" ? 80 : 524 - 80, 740)
  w.balls.push(b)
  let best = Infinity
  let flipped = false
  run(w, 3, () => {
    const along = Math.abs(b.x - f.x)
    if (!flipped && along > flipAt && b.y > 840) {
      f.pressed = true
      flipped = true
    }
    if (flipped) best = Math.min(best, b.y)
  })
  return { flipped, best }
}

test("flipping sends the ball up the table from either flipper", () => {
  for (const side of ["left", "right"]) {
    for (const at of [25, 40, 55]) {
      const { flipped, best } = flipShot(side, at)
      assert.ok(flipped, `${side} ball never reached the flipper`)
      assert.ok(best < 500, `${side} flip at ${at}: the ball only got to y=${best.toFixed(0)}`)
    }
  }
})

test("a ball hit by a swinging flipper leaves faster than the flipper tip moves", () => {
  const w = createWorld(buildTable())
  const f = w.flippers[0]
  // resting just above the flipper, two thirds of the way out
  const t = 0.66
  const b = createBall(f.x + Math.cos(f.rest) * f.length * t, f.y + Math.sin(f.rest) * f.length * t - 16)
  w.gravity = 0
  w.balls.push(b)
  f.pressed = true
  run(w, 0.1)
  assert.ok(b.vy < -1200, `ball only moving ${b.vy.toFixed(0)}`)
})

test("without kicks, energy never grows over a long simulation", () => {
  const rand = seeded(9)
  for (let shot = 0; shot < 30; shot++) {
    const table = buildTable()
    // close the drain and the outlanes so the ball stays on the table
    table.colliders.push(segment(0, 990, 600, 990))
    const w = createWorld(table)
    w.kickers = false
    const b = openSpot(w, rand)
    const angle = rand() * Math.PI * 2
    b.vx = Math.cos(angle) * 2500
    b.vy = Math.sin(angle) * 2500
    w.balls.push(b)
    const start = energy(b)
    let peak = start
    run(w, 20, () => {
      peak = Math.max(peak, energy(b))
    })
    // allow a whisker (a unit of height) for pushing the ball out of walls
    assert.ok(peak <= start + G_TOL, `shot ${shot}: energy grew from ${start.toFixed(0)} to ${peak.toFixed(0)}`)
    assert.ok(energy(b) < start, `shot ${shot}: no energy lost in 20 s`)
  }
})
const G_TOL = 1900 * 1.5

// ---- rules ----

const newGame = () => {
  const g = G.createGame()
  G.startGame(g)
  return g
}
const ev = (g, type, id = 0, extra = {}) => G.handleEvent(g, { type, id, ball: g.world.balls[0], speed: 300, ...extra })
const settle = (g, seconds) => {
  for (let t = 0; t < seconds; t += 1 / 60) G.update(g, 1 / 60)
}

test("pulling and releasing the plunger launches the ball and starts the ball save", () => {
  const g = newGame()
  for (let t = 0; t < 1; t += 1 / 60) G.update(g, 1 / 60, { plunger: true })
  assert.equal(g.pull, 1)
  G.update(g, 1 / 60, {})
  settle(g, 1.5)
  const b = g.world.balls[0]
  assert.ok(b.x < LANE.left, "the ball should be out on the playfield")
  assert.ok(g.ballSaveUntil > g.time, "the ball save is running")
})

test("a drained ball is detected and the next ball is served", () => {
  const g = newGame()
  const b = g.world.balls[0]
  Object.assign(b, { x: 262, y: 930, vx: 0, vy: 0 }) // between the flippers
  g.ballSavePending = false
  settle(g, 0.5)
  assert.equal(g.world.balls.length, 0)
  assert.equal(g.stats.drains, 1)
  settle(g, 2)
  assert.equal(g.ballNumber, 2)
  assert.equal(g.world.balls.length, 1)
})

test("an outlane drains the ball after its consolation points", () => {
  const g = newGame()
  const b = g.world.balls[0]
  Object.assign(b, { x: 41, y: 720, vx: 0, vy: 100 })
  settle(g, 1)
  assert.equal(g.stats.drains, 1)
  assert.equal(g.score, G.SCORES.outlane)
})

test("ball save returns a ball lost early", () => {
  const g = newGame()
  g.ballSaveUntil = g.time + 5
  const b = g.world.balls[0]
  Object.assign(b, { x: 262, y: 930, vx: 0, vy: 0 })
  settle(g, 2)
  assert.equal(g.ballNumber, 1)
  assert.equal(g.world.balls.length, 1)
  assert.equal(g.message?.text, "BALL SAVED")
})

test("scoring: bumpers, the multiplier and D-I-V-E", () => {
  const g = newGame()
  ev(g, "bumper")
  assert.equal(g.score, 500)
  for (let i = 0; i < 4; i++) ev(g, "rollover", i)
  assert.equal(g.multiplier, 2)
  assert.deepEqual(g.dive, [false, false, false, false])
  const before = g.score
  ev(g, "bumper")
  assert.equal(g.score - before, 1000)
})

test("lane change: flippers move the lit lanes", () => {
  const g = newGame()
  ev(g, "rollover", 0)
  G.update(g, 1 / 60, { right: true })
  assert.deepEqual(g.dive, [false, true, false, false])
  G.update(g, 1 / 60, {})
  G.update(g, 1 / 60, { left: true })
  assert.deepEqual(g.dive, [true, false, false, false])
})

test("missions rank you up, and rank 2 gives an extra ball", () => {
  const g = newGame()
  assert.equal(G.currentMission(g).id, "jelly")
  for (let i = 0; i < 10; i++) ev(g, "bumper")
  assert.equal(g.rank, 1)
  assert.equal(G.currentMission(g).id, "clams")
  for (let i = 0; i < 3; i++) ev(g, "target", i)
  assert.equal(g.rank, 2)
  assert.equal(g.extraBalls, 1)
  // the second lap asks for more
  g.missionsDone = G.MISSIONS.length
  assert.equal(G.missionGoal(g), G.MISSIONS[0].goal * 2)
})

test("drop targets drop, score a bank bonus and come back", () => {
  const g = newGame()
  for (let i = 0; i < 3; i++) ev(g, "target", i)
  ev(g, "target", 1) // already down: nothing
  assert.equal(g.score, 3 * G.SCORES.target + G.SCORES.bank)
  assert.ok(g.world.colliders.filter((c) => c.tag === "target").every((c) => !c.active))
  settle(g, 2)
  assert.deepEqual(g.targets, [false, false, false])
  assert.ok(g.world.colliders.filter((c) => c.tag === "target").every((c) => c.active))
})

test("three treasure chests start multiball, which ends when one ball is left", () => {
  const g = newGame()
  for (let i = 0; i < 2; i++) {
    ev(g, "chest", 0, { speed: 200 })
    assert.ok(!g.multiball)
    settle(g, 1.5) // the chest kicks the ball back out
  }
  ev(g, "chest", 0, { speed: 200 })
  assert.ok(g.multiball)
  assert.equal(g.launchQueue, 2)
  g.world.gravity = 0 // keep every ball up while they launch
  settle(g, 3)
  assert.equal(g.world.balls.length, 3)
  g.ballSaveUntil = 0
  // drain two
  for (const b of g.world.balls.slice(0, 2)) Object.assign(b, { y: 2000 })
  settle(g, 0.1)
  assert.equal(g.world.balls.length, 1)
  assert.equal(g.multiball, false)
  assert.equal(g.ballNumber, 1)
})

test("too much nudging tilts: flippers die and nothing scores", () => {
  const g = newGame()
  for (let i = 0; i < 5; i++) G.nudge(g, "up")
  assert.ok(g.tilted)
  const score = g.score
  ev(g, "bumper")
  G.update(g, 1 / 60, { left: true })
  assert.equal(g.score, score)
  assert.equal(g.world.flippers[0].pressed, false)
  // a few gentle nudges are fine
  const h = newGame()
  for (let i = 0; i < 2; i++) G.nudge(h, "left")
  assert.ok(!h.tilted)
})

test("three lost balls end the game", () => {
  const g = newGame()
  for (let n = 1; n <= 3; n++) {
    assert.equal(g.ballNumber, n)
    g.ballSaveUntil = 0
    Object.assign(g.world.balls[0], { x: 262, y: 1100 })
    settle(g, 2)
  }
  assert.equal(g.mode, "over")
  assert.equal(g.message.text, "GAME OVER")
})

test("high score table keeps the top five", () => {
  let scores = []
  for (const s of [500, 9000, 100, 7000, 3000, 8000]) scores = G.insertScore(scores, { name: "AAA", score: s })
  assert.deepEqual(scores.map((s) => s.score), [9000, 8000, 7000, 3000, 500])
  assert.ok(G.qualifies(scores, 600))
  assert.ok(!G.qualifies(scores, 400))
  assert.ok(G.qualifies([], 1))
  assert.ok(!G.qualifies([], 0))
  assert.equal(G.cleanInitials("b.t-x9"), "BTX")
  assert.equal(G.cleanInitials(""), "???")
})
