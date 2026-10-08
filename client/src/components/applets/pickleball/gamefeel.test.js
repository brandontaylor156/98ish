// Pickleball 98 game feel (the "gameplay like fire" round, 2026-10-06): no "Swing and a miss!"
// after the point is over, a miss called as the ball goes by, a stretch for a ball passing
// just out of reach, timing windows that reward timing, shots that feel different, quicker
// point flow, the rally camera's framing, and the buzz/streak extras.
// node --test client/src/components/applets/pickleball/gamefeel.test.js
import test from "node:test"
import assert from "node:assert/strict"
import { autopilot, canHit, createMatch, dropSwing, goneBy, seeded, step } from "./match.js"
import { gradeOf, shotQuality } from "./shots.js"
import { isLive } from "./rules.js"
import { KITCHEN_FAR, KITCHEN_NEAR, rallyFrame } from "./camera.js"
import { createStreaks, hapticFor, pulseFor, streakHit, streakRally, streakScore } from "./juice.js"

// a person (the autopilot with timing scatter `jitter`, seconds) against the computer
const play = (level, seeds, jitter, onEvent) => {
  for (const seed of seeds) {
    const m = createMatch({ doubles: false, level, scoring: "rally", target: 11, seed, assist: "reflex" })
    const rand = seeded(seed * 7 + 1)
    let n = 0
    while (m.phase !== "over" && n < 240 * 60 * 20) {
      autopilot(m, 0, { jitter, rand })
      // (whether the point was still on as this step began: a miss called in the very step the
      // ball bounces a second time is a miss during the point)
      const was = isLive(m.rally) && m.phase === "rally"
      step(m)
      n++
      for (const e of m.events) onEvent(e, m, was)
      m.events.length = 0
    }
  }
}

test("no 'Swing and a miss!' after the point is over (it used to come a second after the swing)", () => {
  let whiffs = 0
  let afterPoint = 0
  play("intermediate", [1, 2], 0.06, (e, m, was) => {
    if (e.type !== "whiff" || e.player !== "you") return
    whiffs++
    if (!was) afterPoint++
  })
  assert.equal(afterPoint, 0, `${afterPoint} of ${whiffs} misses were called after the point`)
})

test("a swing still waiting when the point ends goes quietly; a held swing is let go", () => {
  const m = createMatch({ doubles: false, level: "intermediate", scoring: "rally", target: 11, seed: 3, assist: "reflex" })
  const you = m.players.find((p) => p.id === "you")
  m.phase = "dead"
  you.armed = { kind: "hit", pace: 0.3, release: m.t - 0.8, until: m.t + 0.2 }
  assert.equal(dropSwing(m, you), null)
  assert.equal(you.armed, null)
  you.charge = { kind: "hit", start: m.t }
  dropSwing(m, you)
  assert.equal(you.charge, null)
  // (a serve being held is never touched)
  m.phase = "serve"
  you.charge = { kind: "serve", start: m.t }
  dropSwing(m, you)
  assert.ok(you.charge)
})

test("a ball that's gone past you low is a miss right away, not a second later", () => {
  const m = createMatch({ doubles: false, level: "intermediate", scoring: "rally", target: 11, seed: 4, assist: "reflex" })
  const you = m.players.find((p) => p.id === "you")
  const side = you.team === 0 ? Math.sign(you.z || 1) : Math.sign(you.z || -1)
  m.phase = "rally"
  m.ball.held = null
  m.rally.hits = 3
  m.rally.lastTeam = 1 - you.team
  you.x = 0
  you.z = side * 5
  // 2 m behind them, knee high, still going back
  m.ball.p = { x: 0.3, y: 0.3, z: side * 7 }
  m.ball.v = { x: 0, y: -1, z: side * 8 }
  you.armed = { kind: "hit", pace: 0.3, release: m.t - 0.2, until: m.t + 0.8 }
  assert.ok(goneBy(m, you))
  assert.equal(dropSwing(m, you), "miss")
  // the same ball still in front of them, coming: no
  m.ball.p = { x: 0.3, y: 0.6, z: side * 3 }
  assert.ok(!goneBy(m, you))
  assert.equal(dropSwing(m, you), null)
})

test("a person's swing stretches for a ball passing just beyond arm's length, not further", () => {
  const m = createMatch({ doubles: false, level: "intermediate", scoring: "rally", target: 11, seed: 5, assist: "reflex" })
  const you = m.players.find((p) => p.id === "you")
  const side = Math.sign(you.z)
  m.phase = "rally"
  m.ball.held = null
  m.rally.hits = 4
  m.rally.bounces = 1
  m.rally.lastTeam = 1 - you.team
  you.x = 0
  you.z = side * 4
  you.vx = 0
  you.vz = 0
  const req = { kind: "hit", pace: 0.3, release: m.t, until: m.t + 1 }
  // passing beside them (moving straight back, level with them): 1.12 m away is in reach
  m.ball.v = { x: 0, y: 0, z: side * 6 }
  m.ball.p = { x: 1.12, y: 0.7, z: side * 4 }
  assert.ok(canHit(m, you, req), "a stretch at 1.12 m")
  m.ball.p = { x: 1.3, y: 0.7, z: side * 4 }
  assert.ok(!canHit(m, you, req), "1.3 m is too far")
  // the computer gets no stretch (its plans already put it in reach)
  you.ctrl = "cpu"
  m.ball.p = { x: 1.12, y: 0.7, z: side * 4 }
  assert.ok(!canHit(m, you, req))
})

test("timing windows: perfect is tight, good is forgiving, and better timing earns more perfects", () => {
  const w = 0.06
  assert.equal(gradeOf(0, w), "perfect")
  assert.equal(gradeOf(w, w), "perfect")
  assert.equal(gradeOf(w * 2, w), "good")
  assert.equal(gradeOf(-w * 3, w), "early")
  assert.equal(gradeOf(w * 3, w), "late")
  // a perfect contact is cleaner and a little quicker; an off one wanders
  const p = shotQuality(0, { window: w })
  const g = shotQuality(w * 1.8, { window: w })
  const l = shotQuality(w * 3.5, { window: w })
  assert.ok(p.sigma < g.sigma && g.sigma < l.sigma)
  assert.ok(p.speedMul > 1 && l.speedMul < 1)
  const share = (jitter) => {
    const c = {}
    play("intermediate", [1], jitter, (e) => {
      if (e.type === "hit" && e.player === "you" && e.kind !== "serve") c[e.grade] = (c[e.grade] || 0) + 1
    })
    const tot = Object.values(c).reduce((a, b) => a + b, 0)
    return (c.perfect || 0) / tot
  }
  const steady = share(0.04)
  const shaky = share(0.15)
  assert.ok(steady > shaky + 0.15, `steady ${steady.toFixed(2)} vs shaky ${shaky.toFixed(2)}`)
})

test("shots feel different: a dink is slow, a drive is fast, a smash is fastest", () => {
  const by = {}
  play("intermediate", [1, 2], 0.06, (e) => {
    if (e.type === "hit") (by[e.kind] ||= []).push(e.speed)
  })
  const med = (k) => {
    const a = [...(by[k] || [])].sort((x, y) => x - y)
    return a[Math.floor(a.length / 2)]
  }
  assert.ok(med("dink") < 9, `dink ${med("dink")}`)
  assert.ok(med("drop") > med("dink") && med("drop") < med("drive"), `drop ${med("drop")}`)
  assert.ok(med("drive") > med("dink") * 2, `drive ${med("drive")} vs dink ${med("dink")}`)
})

test("quicker point flow: from one point to the next serve takes under 3.6 s on average", () => {
  // (before this round: 3.9 s at Club; the walk back, the score call and the computer's wait
  // to serve were all trimmed. Tapping still hurries it along.)
  const gaps = []
  let at = null
  let first = false
  play("intermediate", [1], 0.06, (e, m) => {
    if (e.type === "point") {
      at = m.t
      first = true
    }
    if (e.type === "hit" && first && at !== null) {
      gaps.push(m.t - at)
      first = false
    }
  })
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length
  assert.ok(gaps.length > 10)
  assert.ok(mean < 3.6, `mean ${mean.toFixed(2)} s`)
})

test("the rally camera closes in on a kitchen battle and leads the ball", () => {
  const ball = { p: { x: 0, y: 1, z: 0 }, v: { x: 0, y: 0, z: 5 } }
  const at = (zs) => zs.map((z) => ({ x: 0, z }))
  assert.equal(rallyFrame({ players: at([2.5, -2.4]), ball, live: true }).tight, 1)
  assert.equal(rallyFrame({ players: at([2.5, -6.5]), ball, live: true }).tight, 0)
  const half = rallyFrame({ players: at([(KITCHEN_NEAR + KITCHEN_FAR) / 2, -2.5]), ball, live: true }).tight
  assert.ok(half > 0.4 && half < 0.6)
  // dead ball: back to the normal shot
  assert.equal(rallyFrame({ players: at([2.5, -2.4]), ball, live: false }).tight, 0)
  // the look leads where the ball is going, a little, and never far
  const right = rallyFrame({ players: at([3, -3]), ball: { p: { x: 0, y: 1, z: 0 }, v: { x: 6, y: 0, z: 5 } }, live: true })
  const left = rallyFrame({ players: at([3, -3]), ball: { p: { x: 0, y: 1, z: 0 }, v: { x: -6, y: 0, z: 5 } }, live: true })
  assert.ok(right.leadX > 0.2 && left.leadX < -0.2)
  const wild = rallyFrame({ players: at([3, -3]), ball: { p: { x: 3, y: 1, z: 0 }, v: { x: 40, y: 0, z: 5 } }, live: true })
  assert.ok(wild.leadX <= 0.6)
})

test("the buzz: only your own moments, stronger for perfect and smashes; the glow follows it", () => {
  assert.equal(hapticFor({ type: "hit", mine: false, grade: "perfect" }), null)
  const plain = hapticFor({ type: "hit", mine: true, grade: "good", kind: "drive" })
  const perfect = hapticFor({ type: "hit", mine: true, grade: "perfect", kind: "drive" })
  const smash = hapticFor({ type: "hit", mine: true, grade: "good", kind: "smash" })
  assert.ok(plain < perfect && perfect < smash)
  assert.ok(Array.isArray(hapticFor({ type: "rally", yours: true })))
  assert.equal(hapticFor({ type: "rally", yours: false }), null)
  assert.equal(hapticFor({ type: "bounce" }), null)
  assert.equal(pulseFor({ type: "hit", mine: true, kind: "smash" }), 1)
  assert.ok(pulseFor({ type: "hit", mine: true, grade: "good" }) < pulseFor({ type: "hit", mine: true, grade: "perfect" }))
})

test("streaks: perfect runs, rally runs both ways, and one comeback a game", () => {
  const s = createStreaks(0)
  const hits = ["perfect", "perfect", "perfect"].map((grade) => streakHit(s, { mine: true, grade }))
  assert.deepEqual(hits.slice(0, 2), [null, null])
  assert.match(hits[2].text, /3 perfect/)
  assert.equal(streakHit(s, { mine: true, grade: "good" }), null)
  assert.equal(s.perfect, 0)
  // they win 4 in a row: "Stop the run!"
  const theirs = [1, 1, 1, 1].map((winner) => streakRally(s, { winner }))
  assert.equal(theirs[3].text, "Stop the run!")
  const mine = [0, 0, 0].map((winner) => streakRally(s, { winner }))
  assert.equal(mine[2].text, "3 in a row!")
  // down 2-6, back to 6-6: a comeback, once
  assert.equal(streakScore(s, [2, 6]), null)
  assert.match(streakScore(s, [6, 6]).text, /Comeback/i)
  assert.equal(streakScore(s, [7, 6]), null)
})
