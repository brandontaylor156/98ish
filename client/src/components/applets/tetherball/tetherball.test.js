// Tetherball's physics and match. Run: node --test client/src/components/applets/tetherball/tetherball.test.js
import test from "node:test"
import assert from "node:assert/strict"
import * as P from "./physics.js"
import * as M from "./match.js"

const run = (b, seconds) => {
  for (let t = 0; t < seconds; t += P.STEP) P.stepBall(b, P.STEP)
  return b
}

test("a hanging ball stays put under the tie point, the rope taut", () => {
  const b = P.newBall()
  run(b, 2)
  assert.ok(P.speed(b) < 0.05)
  assert.ok(Math.abs(P.wraps(b)) < 0.01)
  const d = Math.hypot(b.x, b.y - P.POLE_H, b.z)
  assert.ok(Math.abs(d - P.ROPE_L) < 0.06, `rope ${d}`)
})

test("the rope never stretches; it can go slack", () => {
  const b = P.newBall()
  P.hitBall(b, 1, 1, 0.4)
  for (let i = 0; i < 240 * 4; i++) {
    P.stepBall(b, P.STEP)
    const r = P.horizontal(b) || 1
    const d = Math.hypot(b.x - (b.x / r) * P.POLE_R, b.y - P.tieHeight(b), b.z - (b.z / r) * P.POLE_R)
    assert.ok(d <= P.freeLength(b) + 1e-6, "never longer than the free rope")
    assert.ok(P.horizontal(b) >= P.POLE_R + P.BALL_R - 1e-9, "never inside the pole")
    assert.ok(b.y >= P.BALL_R - 1e-9, "never under the ground")
  }
  // thrown straight at the pole from out wide, the rope goes slack for a moment
  const c = P.newBall(0, { out: 1.6 })
  c.vx = -6
  P.stepBall(c, P.STEP)
  assert.equal(c.taut, false)
})

test("going round counts wraps (signed); coming back unwinds them", () => {
  const b = P.newBall(0, { out: 1.4 })
  P.hitBall(b, 1, 0.9, 0.35)
  let max = 0
  for (let i = 0; i < 240 * 3; i++) {
    P.stepBall(b, P.STEP)
    max = Math.max(max, P.wraps(b))
  }
  assert.ok(max > 1.2, `wound ${max} turns`)
  const wound = P.wraps(b)
  // hit back the other way: it unwinds
  P.hitBall(b, -1, 1, 0.2)
  run(b, 1.5)
  assert.ok(P.wraps(b) < wound - 0.3, `${P.wraps(b)} < ${wound}`)
  // unwrapped azimuth: a full circle by hand is one wrap either way
  const c = P.newBall(0)
  for (let k = 1; k <= 64; k++) {
    const a = (k / 64) * 2 * Math.PI
    c.x = Math.cos(a) * 0.5
    c.z = Math.sin(a) * 0.5
    c.vx = c.vy = c.vz = 0
    P.stepBall(c, 1e-6)
  }
  assert.ok(Math.abs(P.wraps(c) - 1) < 0.02, `${P.wraps(c)}`)
})

test("winding shortens the free rope, lowers the tie point and speeds the ball up", () => {
  const b = P.newBall()
  assert.ok(Math.abs(P.freeLength(b) - P.ROPE_L) < 1e-9)
  b.theta = 2 * Math.PI * 3
  assert.ok(P.freeLength(b) < P.ROPE_L - 0.8)
  assert.ok(P.tieHeight(b) < P.POLE_H - 0.2)
  b.theta = -2 * Math.PI * 3
  assert.equal(P.freeLength(b), P.ROPE_L - 3 * (P.ROPE_L - P.MIN_FREE) / P.MAX_WRAPS)
  // the same hit on a wound rope goes round faster (a shorter rope: a tighter, quicker circle)
  const turnRate = (turns) => {
    const c = P.newBall(0, { out: 0.2 })
    c.theta = turns * 2 * Math.PI
    const L = P.freeLength(c)
    c.x = L * 0.7
    c.y = P.tieHeight(c) - L * 0.7
    c.z = 0
    c.lastAz = 0
    P.hitBall(c, 1, 0.5, 0)
    const start = c.theta
    run(c, 1)
    return c.theta - start
  }
  const loose = turnRate(0)
  const wound = turnRate(4)
  assert.ok(wound > loose * 1.3, `${wound} rad vs ${loose} rad in a second`)
})

test("fully wound: the winner by direction", () => {
  const b = P.newBall()
  b.theta = 2 * Math.PI * (P.MAX_WRAPS + 0.01)
  assert.equal(P.woundBy(b), 1)
  b.theta = -b.theta
  assert.equal(P.woundBy(b), -1)
  b.theta = 0
  assert.equal(P.woundBy(b), 0)
  assert.ok(P.MAX_WRAPS > 5 && P.MAX_WRAPS < 8)
})

test("each player hits only their own way, only on their own half", () => {
  const m = M.createMatch({ players: ["human", "human"], seed: 3 })
  assert.equal(m.phase, "serve")
  assert.equal(M.swing(m, 1, 0.8, 0.3), false, "only the server serves")
  assert.equal(M.swing(m, 0, 0.8, 0.3), true)
  assert.equal(m.phase, "play")
  assert.ok(P.angularSpeed(m.ball) > 0, "player 1 winds counter-clockwise")
  // the ball on player 2's half: player 1 can't reach it
  const p0 = m.players[0]
  const far = { ...m.ball, x: 0, z: -0.8, y: 1.4 }
  assert.equal(M.inReach(m, p0, far), false)
  const near = { ...m.ball, x: p0.x, z: p0.z, y: 1.4 }
  assert.equal(M.inReach(m, p0, near), true)
  // player 2's hit sends it clockwise
  m.ball = P.newBall(-Math.PI / 2, { out: 0.9 })
  m.ball.y = 1.4
  const p1 = m.players[1]
  p1.x = m.ball.x
  p1.z = m.ball.z - 0.3
  p1.az = Math.atan2(p1.z, p1.x)
  p1.r = Math.hypot(p1.x, p1.z)
  M.swing(m, 1, 0.8, 0.3)
  M.step(m, 1 / 60)
  assert.ok(m.events.some((e) => e.type === "hit" && e.seat === 1))
  assert.ok(P.angularSpeed(m.ball) < 0)
})

test("computer against computer: someone winds it all the way, games are counted, the match ends", () => {
  for (const level of ["easy", "hard"]) {
    const m = M.createMatch({ players: ["cpu", "cpu"], level, target: 2, seed: level === "easy" ? 11 : 12 })
    let games = 0
    for (let t = 0; t < 600 && m.phase !== "over"; t += 1 / 30) {
      M.step(m, 1 / 30)
      games += M.takeEvents(m).filter((e) => e.type === "game").length
    }
    assert.equal(m.phase, "over", `${level} match finished`)
    assert.ok(games >= 2 && games <= 3)
    assert.equal(Math.max(...m.games), 2)
    assert.equal(m.games[m.winner], 2)
    assert.ok(m.players[0].hits + m.players[1].hits > 4)
  }
})

test("online mirror: snapshots land where the host has the ball and fly on; a guest's hit shows at once", async () => {
  const N = await import("./netplay.js")
  const host = M.createMatch({ players: ["human", "remote"], seed: 9, rewind: true })
  M.swing(host, 0, 0.8, 0.2)
  for (let i = 0; i < 60; i++) M.step(host, P.STEP)
  const snap = N.pack(host, [{ id: 1, type: "hit", seat: 0 }])
  const mirror = N.createMirror({ seat: 1 })
  mirror.snap(snap, 1000)
  assert.equal(mirror.view.phase, "play")
  assert.ok(Math.abs(mirror.view.ball.x - host.ball.x) < 1e-3, "lands where the host had it")
  assert.deepEqual(mirror.takeEvents().map((e) => e.type), ["hit"])
  assert.ok(Math.abs(mirror.hostNow(1100) - snap.t - 0.1) < 1e-9, "the host's clock runs on between snapshots")
  // between snapshots the mirror flies the ball with the same physics as the host
  for (let i = 0; i < 24; i++) M.step(host, P.STEP)
  mirror.step(24 * P.STEP)
  assert.ok(Math.hypot(mirror.view.ball.x - host.ball.x, mirror.view.ball.z - host.ball.z) < 0.02)
  // an older snapshot arriving late is ignored
  mirror.snap({ ...snap, t: snap.t - 0.5 }, 1200)
  assert.equal(mirror.view.t > snap.t - 0.1, true)
  // the guest's swing with the ball in reach: clockwise on the guest's screen right away
  const g = N.createMirror({ seat: 1 })
  g.snap(snap, 0)
  g.view.ball = { ...host.ball, x: 0, z: -0.9, y: 1.4, vx: 2, vy: 0, vz: 0 }
  g.view.players[1] = { ...g.view.players[1], x: 0, z: -1.2, lastHit: -9 }
  const msg = g.swing(0.8, 0.2, 50)
  assert.equal(msg.type, "swing")
  assert.ok(Math.abs(msg.at - (snap.t + 0.05)) < 1e-9, "stamped with the host's time")
  assert.ok(P.angularSpeed(g.view.ball) < 0)
  // a snapshot from before the host saw that hit doesn't undo it
  g.snap({ ...snap, t: snap.t + 0.05 }, 80)
  assert.ok(P.angularSpeed(g.view.ball) < 0)
})

test("online: a guest's swing from a moment ago is checked against the history and hits", () => {
  const m = M.createMatch({ players: ["human", "remote"], seed: 5, rewind: true })
  M.swing(m, 0, 0.9, 0.3)
  // fly until the ball is in player 2's reach, then a bit more
  let inAt = null
  for (let i = 0; i < 240 * 4 && inAt === null; i++) {
    M.step(m, P.STEP)
    if (M.inReach(m, m.players[1])) inAt = m.t
  }
  assert.ok(inAt !== null, "the ball came round to player 2")
  for (let i = 0; i < 12; i++) M.step(m, P.STEP) // 50 ms of lag
  const hit = M.remoteSwing(m, 1, inAt - 0.02, 0.8, 0.3)
  assert.equal(hit, true)
  assert.ok(P.angularSpeed(m.ball) < 0, "sent back clockwise")
  // a swing far too old is refused (out of the history)
  const n = M.createMatch({ players: ["human", "remote"], seed: 6, rewind: true })
  M.swing(n, 0, 0.9, 0.3)
  for (let i = 0; i < 240; i++) M.step(n, P.STEP)
  assert.equal(M.remoteSwing(n, 1, n.t - 5, 0.8, 0.3), false)
})
