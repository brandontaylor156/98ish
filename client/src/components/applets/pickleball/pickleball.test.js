// Physics and rules tests for Pickleball 98, checked against the real numbers.
// Run: node --test client/src/components/applets/pickleball/
//
// Sources for the numbers: USA Pickleball Official Rulebook (court: section 2; equipment
// standards: ball and paddle; serve: 4.A; two-bounce rule: 7; non-volley zone: 9; faults:
// 7-10; scoring and score calling: 4.B, 4.C, 4.M, and the rally-scoring provisional rule).
import test from "node:test"
import assert from "node:assert/strict"
import * as P from "./physics.js"
import * as R from "./rules.js"
import { planShot, playShot } from "./shots.js"
import { createMatch, step, scenario, swing, playerById } from "./match.js"

const near = (actual, expected, tol, msg) => assert.ok(Math.abs(actual - expected) <= tol, `${msg}: ${actual} not within ${tol} of ${expected}`)
const between = (v, lo, hi, msg) => assert.ok(v >= lo && v <= hi, `${msg}: ${v} not in [${lo}, ${hi}]`)

// fly a ball (with bounces) until `until` says stop
const fly = (ball, until, maxT = 8) => {
  let t = 0
  while (t < maxT) {
    P.flightStep(ball)
    t += P.STEP
    if (ball.p.y <= P.BALL_R && ball.v.y < 0) {
      const at = { x: ball.p.x, z: ball.p.z, t }
      P.bounceOnCourt(ball)
      if (until({ bounce: at, ball, t })) return at
    } else if (until({ ball, t })) return null
  }
  return null
}

// ---------- the court and net ----------

test("court dimensions are regulation (20 x 44 ft, 7 ft kitchen, 2 in lines)", () => {
  near(P.COURT_W, 6.096, 1e-9, "width")
  near(P.COURT_L, 13.4112, 1e-9, "length")
  near(P.KITCHEN, 2.1336, 1e-9, "non-volley zone depth")
  near(P.LINE_W, 0.0508, 1e-9, "line width")
  near(P.NET_SPAN, 6.7056, 1e-9, "22 ft between posts")
})

test("the net is 34 in at the center and 36 in at the sidelines (it sags)", () => {
  near(P.netHeightAt(0), 34 * 0.0254, 1e-9, "center")
  near(P.netHeightAt(P.HALF_W), 36 * 0.0254, 1e-9, "sideline")
  near(P.netHeightAt(-P.HALF_W), 36 * 0.0254, 1e-9, "other sideline")
  assert.ok(P.netHeightAt(1.5) > P.netHeightAt(0) && P.netHeightAt(1.5) < P.netHeightAt(P.HALF_W), "sags smoothly")
  near(P.netHeightAt(P.NET_POST_X), 36 * 0.0254, 1e-9, "no higher out to the posts")
})

// ---------- the ball ----------

test("ball spec: 74 mm, 26 g (outdoor ball limits 2.87-2.97 in, 22.1-26.5 g)", () => {
  between(P.BALL_D / 0.0254, 2.87, 2.97, "diameter in inches")
  between(P.BALL_M, 0.0221, 0.0265, "mass in kg")
})

test("bounce test: dropped from 78 in, it rebounds 30-34 in (bottom to top, granite)", () => {
  // the rulebook measures the drop from the bottom of the ball and the bounce to its top
  const ball = P.createBall(P.v3(0, 78 * 0.0254 + P.BALL_R, 0))
  let bounced = false
  let apex = 0
  for (let i = 0; i < 4000; i++) {
    P.flightStep(ball)
    if (!bounced && ball.p.y <= P.BALL_R && ball.v.y < 0) {
      P.bounceOnCourt(ball)
      bounced = true
    }
    if (bounced) {
      apex = Math.max(apex, ball.p.y)
      if (ball.v.y < 0) break
    }
  }
  const inches = (apex + P.BALL_R) / 0.0254
  between(inches, 30, 34, "rebound height (in)")
})

test("terminal velocity is sane for a holed plastic ball (heavy drag)", () => {
  const vt = P.terminalVelocity()
  between(vt, 12, 17, "terminal velocity m/s")
  // a ball dropped from very high approaches it and never exceeds it
  const ball = P.createBall(P.v3(0, 500, 0))
  for (let i = 0; i < 240 * 12; i++) P.flightStep(ball)
  near(-ball.v.y, vt, 0.05, "falling speed after 12 s")
  // drag is strong: a 20 m/s drive loses a big share of its speed over the court
  const drive = P.createBall(P.v3(0, 1, 6.5), P.v3(0, 1, -20))
  while (drive.p.z > -6.5) P.flightStep(drive)
  between(P.len(drive.v), 9, 15, "speed after 13 m")
})

test("spin: topspin dips, backspin floats (modest Magnus lift)", () => {
  const go = (spin) => {
    const v = P.v3(0, 3, -15)
    const w = P.scale(P.topspinAxis(v), spin)
    return P.flyToGround({ p: P.v3(0, 1, 6), v, w })
  }
  const flat = go(0)
  const top = go(150)
  const back = go(-150)
  assert.ok(top.z > flat.z && flat.z > back.z, `topspin lands shorter, backspin longer: ${top.z} ${flat.z} ${back.z}`)
  // modest: under ~2.5 m difference over a full-court flight for ~1400 rpm
  assert.ok(Math.abs(top.z - flat.z) < 2.5, "lift is modest")
})

test("bounce friction: topspin skids through low and fast, backspin checks up", () => {
  const land = (spin) => {
    const v = P.v3(0, -5, -10)
    const ball = P.createBall(P.v3(0, P.BALL_R, 0), v, P.scale(P.topspinAxis(v), spin))
    P.bounceOnCourt(ball)
    return { vz: -ball.v.z, angle: Math.atan2(ball.v.y, -ball.v.z) }
  }
  const top = land(200)
  const flat = land(0)
  const back = land(-200)
  assert.ok(top.vz > flat.vz && flat.vz > back.vz, `forward speed after the bounce: ${top.vz} ${flat.vz} ${back.vz}`)
  assert.ok(top.angle < flat.angle && flat.angle < back.angle, "topspin stays lower, backspin kicks up steeper")
  // and the bounce keeps the ball's vertical speed by the coefficient of restitution
  near(P.COURT_COR, 0.65, 0.05, "COR")
})

test("the net stops a low ball and lets a high one pass", () => {
  const low = P.createBall(P.v3(0, 0.5, 0.2), P.v3(0, 0, -10))
  let hit = null
  for (let i = 0; i < 40 && !hit; i++) {
    const z = low.p.z
    P.flightStep(low)
    hit = P.netContact(z, low)
  }
  assert.equal(hit, "net")
  assert.ok(low.p.z > 0, "falls back on the hitter's side")
  const high = P.createBall(P.v3(0, 1.2, 0.2), P.v3(0, 0, -10))
  for (let i = 0; i < 40; i++) {
    const z = high.p.z
    P.flightStep(high)
    assert.equal(P.netContact(z, high), null)
  }
})

// ---------- shots ----------

const incoming = (p, v) => ({ p, v, w: P.v3() })

test("a dink from the kitchen line clears the net and lands in the other kitchen at 3-6 m/s", () => {
  for (const [x, y] of [[0.4, 0.35], [-1, 0.45], [1.5, 0.3]]) {
    const ball = incoming(P.v3(x, y, 2.4), P.v3(0, -1.5, 3.5))
    const plan = planShot("dink", { team: 0, from: ball.p, aim: 0 })
    const { ball: out } = playShot(ball, plan)
    between(P.len(out.v), 3, 6.5, "dink speed m/s")
    const res = P.flyToGround(out)
    assert.ok(res.clearance > 0, `clears the net (${res.clearance})`)
    assert.ok(Math.abs(res.z) < P.KITCHEN && res.z < 0, `lands in their kitchen at z=${res.z}`)
  }
})

test("a drive from the baseline is 15-25 m/s, flies 12 m in under a second and lands in", () => {
  const ball = incoming(P.v3(1, 0.8, 6.6), P.v3(0, -2, 9))
  const plan = planShot("drive", { team: 0, from: ball.p, aim: 0, power: 0.7 })
  const { ball: out, u } = playShot(ball, plan)
  between(P.len(out.v), 15, 25, "drive speed")
  assert.ok(P.len(u) <= P.MAX_PADDLE_SPEED + 1e-9, "paddle face speed within human limits")
  const res = P.flyToGround(out)
  between(Math.abs(res.z - ball.p.z), 10, 13.4, "carry (m)")
  between(res.t, 0.55, 1.1, "flight time (s)")
  assert.ok(R.inCourt(res.x, res.z) && res.z < 0, "in")
  assert.ok(res.clearance > 0.05, "over the net")
})

test("a serve is underhand-legal, 12-20 m/s, and lands diagonally in the right box", () => {
  for (const court of ["right", "left"]) {
    const x = court === "right" ? 1.5 : -1.5 // team 0's right is +x
    const ball = incoming(P.v3(x, 0.52, P.HALF_L + 0.2), P.v3(0, -2.5, 0))
    const plan = planShot("serve", { team: 0, from: ball.p, aim: 0, power: 0.5, court })
    const { ball: out, u } = playShot(ball, plan)
    between(P.len(out.v), 12, 20, "serve speed")
    assert.ok(u.y > 0, "the paddle swings upward")
    assert.equal(R.serveFaults({ contactY: 0.52, waistY: 1.0, paddleVy: u.y, x, z: P.HALF_L + 0.3, team: 0, court }).length, 0)
    const res = P.flyToGround(out)
    assert.ok(R.inServiceCourt(res.x, res.z, 1, court), `${court}: lands at ${res.x.toFixed(2)}, ${res.z.toFixed(2)}`)
    assert.ok(Math.sign(res.x) === -Math.sign(x), "diagonal")
  }
})

test("the paddle: a closed face hits lower, an open face higher; a faster face hits harder", () => {
  const ball = incoming(P.v3(0, 0.8, 5), P.v3(0, 0, 8))
  const hit = (pitch, speed) => {
    const n = P.norm(P.v3(0, Math.sin(pitch), -Math.cos(pitch)))
    return P.paddleHit(ball, n, P.scale(n, speed)).v
  }
  const closed = hit(-0.1, 8)
  const open = hit(0.3, 8)
  assert.ok(open.y > closed.y, "open face lifts")
  assert.ok(P.len(hit(0.1, 12)) > P.len(hit(0.1, 6)), "faster swing, faster ball")
  // off the sweet spot it comes off slower
  const n = P.v3(0, 0, -1)
  assert.ok(P.len(P.paddleHit(ball, n, P.scale(n, 8), { offset: 0.08 }).v) < P.len(P.paddleHit(ball, n, P.scale(n, 8)).v))
})

// ---------- line calls ----------

test("line calls: on the line is in; the kitchen line is short on a serve", () => {
  const edge = P.HALF_W
  assert.ok(R.inCourt(edge - 0.01, -3), "on the sideline: in")
  assert.ok(R.inCourt(edge, -3), "outer edge of the sideline: in")
  assert.ok(!R.inCourt(edge + 0.01, -3), "just past it: out")
  assert.ok(R.inCourt(0, -P.HALF_L), "on the baseline: in")
  assert.ok(!R.inCourt(0, -P.HALF_L - 0.01), "past the baseline: out")
  // serves into team 1's right court (x < 0 for team 1)
  assert.ok(R.inServiceCourt(-1, -4, 1, "right"), "in the box")
  assert.ok(!R.inServiceCourt(-1, -P.KITCHEN, 1, "right"), "on the kitchen line: short")
  assert.ok(!R.inServiceCourt(-1, -P.KITCHEN + 0.3, 1, "right"), "in the kitchen: short")
  assert.ok(R.inServiceCourt(-1, -P.KITCHEN - 0.01, 1, "right"), "just past the kitchen line: in")
  assert.ok(R.inServiceCourt(0, -4, 1, "right") && R.inServiceCourt(0.02, -4, 1, "right"), "on the centerline: in")
  assert.ok(!R.inServiceCourt(1, -4, 1, "right"), "wrong box")
  assert.ok(R.inServiceCourt(-1, -P.HALF_L, 1, "right"), "on the baseline: in")
})

// ---------- the referee ----------

const freshRally = (opts) => {
  const g = R.createGame({ doubles: true, ...opts })
  return { g, r: R.createRally(g) }
}

test("two-bounce rule: volleying the serve or the return is a fault; the 4th shot may be volleyed", () => {
  // receiver volleys the serve
  let { g, r } = freshRally()
  const recv = R.receiver(g)
  assert.equal(R.refHit(r, { player: g.server, team: 0, x: 1.5, z: 7, serve: { contactY: 0.5, waistY: 1, paddleVy: 2 } }), null)
  let f = R.refHit(r, { player: recv, team: 1, x: -1.5, z: -6, volley: true })
  assert.equal(f.reason, "Two-bounce rule")
  assert.equal(f.fault, 1)
  // server's team volleys the return
  ;({ g, r } = freshRally())
  R.refHit(r, { player: g.server, team: 0, x: 1.5, z: 7, serve: { contactY: 0.5, waistY: 1, paddleVy: 2 } })
  assert.equal(R.refBounce(r, -1.5, -5), null)
  assert.equal(R.refHit(r, { player: R.receiver(g), team: 1, x: -1.5, z: -6 }), null)
  f = R.refHit(r, { player: "A2", team: 0, x: -1, z: 3 })
  assert.equal(f?.reason, "Two-bounce rule", "third shot out of the air")
  // let it bounce, then volleys are fine
  ;({ g, r } = freshRally())
  R.refHit(r, { player: g.server, team: 0, x: 1.5, z: 7, serve: { contactY: 0.5, waistY: 1, paddleVy: 2 } })
  R.refBounce(r, -1.5, -5)
  R.refHit(r, { player: R.receiver(g), team: 1, x: -1.5, z: -6 })
  R.refBounce(r, 1, 5)
  assert.equal(R.refHit(r, { player: "A1", team: 0, x: 1, z: 6 }), null, "third shot after the bounce")
  assert.equal(R.refHit(r, { player: "B2", team: 1, x: 1, z: -3 }), null, "4th shot volleyed (bounces = 0)")
  assert.ok(R.isLive(r))
})

test("kitchen: volleying with a foot in it (or on the line) is a fault; momentum counts too", () => {
  const setup = () => {
    const { g, r } = freshRally()
    r.hits = 4
    r.lastTeam = 1
    r.lastPlayer = "B1"
    return { g, r }
  }
  let { r } = setup()
  assert.equal(R.refHit(r, { player: "A1", team: 0, x: 0.5, z: 1.5, volley: true }).reason, "Volley in the kitchen")
  ;({ r } = setup())
  // toes on the line: the line is part of the kitchen
  assert.equal(R.refHit(r, { player: "A1", team: 0, x: 0.5, z: P.KITCHEN + R.FOOT_R - 0.01, volley: true })?.reason, "Volley in the kitchen")
  ;({ r } = setup())
  assert.equal(R.refHit(r, { player: "A1", team: 0, x: 0.5, z: P.KITCHEN + 0.3, volley: true }), null, "behind the line: fine")
  // ... but then stumbling forward into the kitchen is a fault, even after the ball is dead
  R.refBounce(r, 0.3, -2) // their side
  R.refBounce(r, 0.3, -3) // second bounce: team 1 failed to get it (pending, team 0 wins)
  assert.equal(R.settle(r), null, "held while the volleyer is still moving")
  const f = R.refFeet(r, "A1", 0, 0.5, 2.0, 2.5, P.STEP)
  assert.equal(f.reason, "Momentum into the kitchen")
  assert.equal(R.settle(r).winner, 1)
  // a ball that bounced can be played from inside the kitchen
  ;({ r } = setup())
  r.bounces = 1
  assert.equal(R.refHit(r, { player: "A1", team: 0, x: 0.5, z: 1.2, volley: false }), null)
})

test("faults: out, net, short serve, double bounce, wrong server, serve technique", () => {
  let { g, r } = freshRally()
  const serve = { contactY: 0.5, waistY: 1, paddleVy: 2 }
  R.refHit(r, { player: g.server, team: 0, x: 1.5, z: 7, serve })
  assert.equal(R.refBounce(r, 1.5, -4).reason, "Serve out", "wrong box")
  ;({ g, r } = freshRally())
  R.refHit(r, { player: g.server, team: 0, x: 1.5, z: 7, serve })
  assert.equal(R.refBounce(r, -1.5, -1).call, "Short!")
  ;({ g, r } = freshRally())
  R.refHit(r, { player: g.server, team: 0, x: 1.5, z: 7, serve })
  assert.equal(R.refBounce(r, 1, 0.5).reason, "Didn't clear the net")
  ;({ g, r } = freshRally())
  R.refHit(r, { player: g.server, team: 0, x: 1.5, z: 7, serve })
  R.refBounce(r, -1.5, -5)
  const dbl = R.refBounce(r, -1.6, -6)
  assert.equal(dbl.reason, "Double bounce")
  assert.equal(dbl.winner, 0)
  ;({ g, r } = freshRally())
  assert.equal(R.refHit(r, { player: "A2", team: 0, x: -1.5, z: 7, serve }).reason, "Wrong server")
  ;({ g, r } = freshRally())
  assert.equal(R.refHit(r, { player: g.server, team: 0, x: 1.5, z: 7, serve: { ...serve, contactY: 1.2 } }).reason, "Serve contact above the waist")
  ;({ g, r } = freshRally())
  assert.equal(R.refHit(r, { player: g.server, team: 0, x: 1.5, z: 7, serve: { ...serve, paddleVy: -1 } }).reason, "Serve must swing upward")
  ;({ g, r } = freshRally())
  assert.equal(R.refHit(r, { player: g.server, team: 0, x: 1.5, z: P.HALF_L, serve }).reason, "Foot fault")
  ;({ g, r } = freshRally())
  assert.equal(R.refHit(r, { player: g.server, team: 0, x: -1.5, z: 7, serve }).reason, "Served from the wrong court")
  // the ball goes out after a rally shot
  ;({ g, r } = freshRally())
  r.hits = 3
  r.lastTeam = 0
  assert.equal(R.refBounce(r, 0, -P.HALF_L - 0.2).call, "Out!")
  // the wrong player returns the serve
  ;({ g, r } = freshRally())
  R.refHit(r, { player: g.server, team: 0, x: 1.5, z: 7, serve })
  R.refBounce(r, -1.5, -5)
  assert.equal(R.refHit(r, { player: "B2", team: 1, x: 1.5, z: -5 }).reason, "Wrong receiver")
})

// ---------- scoring ----------

test("side-out doubles: 0-0-2 start, server switches courts on a point, second server, side out", () => {
  const g = R.createGame({ doubles: true, players: [["A1", "A2"], ["B1", "B2"]] })
  const calls = [R.scoreCall(g)]
  assert.equal(g.server, "A1")
  assert.equal(R.serverCourt(g), "right")
  assert.equal(R.receiver(g), "B1")
  R.rallyWon(g, 0) // A scores, A1 and A2 switch courts, A1 serves again from the left
  calls.push(R.scoreCall(g))
  assert.equal(g.server, "A1")
  assert.equal(R.serverCourt(g), "left")
  assert.equal(R.receiver(g), "B2", "diagonal receiver")
  assert.equal(R.rallyWon(g, 1), "side-out", "start of game: only one server")
  calls.push(R.scoreCall(g))
  assert.equal(g.server, "B1", "the player in the right court serves first")
  R.rallyWon(g, 1)
  calls.push(R.scoreCall(g))
  assert.equal(R.rallyWon(g, 0), "second-server")
  calls.push(R.scoreCall(g))
  assert.equal(g.server, "B2")
  R.rallyWon(g, 1)
  calls.push(R.scoreCall(g))
  assert.equal(R.rallyWon(g, 0), "side-out")
  calls.push(R.scoreCall(g))
  assert.deepEqual(calls, ["0-0-2", "1-0-2", "0-1-1", "1-1-1", "1-1-2", "2-1-2", "1-2-1"])
})

test("side-out: first to 11, win by 2; only the serving team scores", () => {
  const g = R.createGame({ doubles: true })
  R.rallyWon(g, 1) // side out from 0-0-2
  for (let i = 0; i < 10; i++) R.rallyWon(g, 1)
  assert.deepEqual(g.score, [0, 10])
  R.rallyWon(g, 0)
  R.rallyWon(g, 0) // side out to team 0
  assert.deepEqual(g.score, [0, 10], "the receiving team never scores")
  for (let i = 0; i < 10; i++) R.rallyWon(g, 0)
  assert.deepEqual(g.score, [10, 10])
  R.rallyWon(g, 0)
  assert.equal(g.winner, null, "11-10 isn't a win")
  R.rallyWon(g, 0)
  assert.equal(g.winner, 0)
  assert.equal(R.scoreCall(g), "Game: 12-10")
  assert.equal(R.rallyWon(g, 1), null, "nothing after the game")
})

test("singles: two-number calls, serve from the right on an even score", () => {
  const g = R.createGame({ doubles: false, players: [["A1"], ["B1"]] })
  assert.equal(R.scoreCall(g), "0-0")
  assert.equal(R.serverCourt(g), "right")
  R.rallyWon(g, 0)
  assert.equal(R.scoreCall(g), "1-0")
  assert.equal(R.serverCourt(g), "left")
  assert.equal(R.rallyWon(g, 1), "side-out")
  assert.equal(R.scoreCall(g), "0-1")
  assert.equal(R.serverCourt(g), "right")
  R.rallyWon(g, 1)
  R.rallyWon(g, 1)
  assert.equal(R.scoreCall(g), "2-1")
})

test("rally scoring: every rally scores, to the target, win by 2", () => {
  const g = R.createGame({ doubles: true, scoring: "rally", target: 11 })
  assert.equal(R.scoreCall(g), "0-0")
  R.rallyWon(g, 1)
  assert.deepEqual(g.score, [0, 1], "the receiving team scores too")
  assert.equal(g.serving, 1)
  assert.equal(R.scoreCall(g), "1-0")
  assert.equal(R.serverCourt(g), "left", "odd score: from the left")
  R.rallyWon(g, 1)
  assert.equal(R.serverCourt(g), "right", "even score: from the right")
  for (let i = 0; i < 9; i++) R.rallyWon(g, 1)
  assert.equal(g.winner, 1)
  assert.deepEqual(g.score, [0, 11])
})

// ---------- whole matches ----------

test("the match: a kitchen volley is called against you", () => {
  const m = createMatch({ doubles: true, level: "pro", seed: 3 })
  scenario(m, "kitchen")
  for (let i = 0; i < 72; i++) step(m) // swing as the ball arrives
  swing(m, { kind: "auto", power: 0.5 })
  let fault = null
  for (let i = 0; i < 240 * 2 && !fault; i++) {
    step(m)
    fault = m.events.find((e) => e.type === "fault")
  }
  assert.equal(fault?.reason, "Volley in the kitchen")
  assert.equal(fault.winner, 1)
})

test("the match: volleying the return breaks the two-bounce rule", () => {
  const m = createMatch({ doubles: true, level: "pro", seed: 4 })
  scenario(m, "two-bounce")
  for (let i = 0; i < 72; i++) step(m)
  swing(m, { kind: "auto", power: 0.5 })
  let fault = null
  for (let i = 0; i < 240 * 2 && !fault; i++) {
    step(m)
    fault = m.events.find((e) => e.type === "fault")
  }
  assert.equal(fault?.reason, "Two-bounce rule")
})

test("computer matches finish with a legal score and realistic shot speeds", () => {
  for (const [level, doubles, scoring] of [["beginner", true, "sideout"], ["intermediate", false, "sideout"], ["pro", true, "rally"]]) {
    const m = createMatch({ doubles, level, scoring, seed: 11 })
    m.autoplay = true
    const speeds = {}
    let steps = 0
    while (m.phase !== "over" && steps < 240 * 60 * 40) {
      step(m)
      steps++
      for (const e of m.events) {
        if (e.type === "hit") (speeds[e.kind] ||= []).push(e.speed)
        assert.ok(Number.isFinite(m.ball.p.x + m.ball.p.y + m.ball.p.z), "the ball stays finite")
      }
      m.events.length = 0
    }
    assert.equal(m.phase, "over", `${level} match finished`)
    const [a, b] = m.game.score
    assert.ok(Math.max(a, b) >= m.game.target && Math.abs(a - b) >= 2, `final ${a}-${b}`)
    const avg = (k) => speeds[k].reduce((s, v) => s + v, 0) / speeds[k].length
    between(avg("serve"), 12, 20, `${level} serve speed`)
    between(avg("dink"), 3, 7.5, `${level} dink speed`) // (8-17 mph; a floated one runs faster)
    if (speeds.drive) between(avg("drive"), 15, 25, `${level} drive speed`)
    assert.ok(m.stats.shots > m.stats.rallies * 2, "real rallies happen")
  }
})

test("the AI never breaks the two-bounce or kitchen rules on its own", () => {
  const m = createMatch({ doubles: true, level: "pro", seed: 21 })
  m.autoplay = true
  let steps = 0
  while (m.phase !== "over" && steps < 240 * 60 * 40) {
    step(m)
    steps++
  }
  for (const reason of ["Two-bounce rule", "Volley in the kitchen", "Wrong server", "Wrong receiver", "Double hit", "Both partners hit it"]) {
    assert.ok(!m.stats.faults[reason], `${reason}: ${m.stats.faults[reason]}`)
  }
  assert.equal(playerById(m, "you").human, true)
})
