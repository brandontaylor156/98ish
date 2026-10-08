// Pickleball 98 ball, paddle and net physics against published measurements, plus the rules
// that depend on them. Sources and numbers: docs/pickleball-physics.md.
// Run: node --test client/src/components/applets/pickleball/ballphysics.test.js
import test from "node:test"
import assert from "node:assert/strict"
import * as P from "./physics.js"
import * as R from "./rules.js"
import { SOFT_CLEAR, assessBall, planIntent, playShot } from "./shots.js"
import { createMatch, step } from "./match.js"

const IN = 0.0254
const MPH = 0.44704
const between = (v, lo, hi, msg) => assert.ok(v >= lo && v <= hi, `${msg}: ${v} not in [${lo}, ${hi}]`)

// drop a ball from `h` (bottom of the ball) and return its rebound (top of the ball)
const dropTest = (kind, h = 78 * IN) => {
  const ball = P.createBall(P.v3(0, h + P.BALL_R, 0), P.v3(), P.v3(), kind)
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
  return (apex + P.BALL_R) / IN
}

test("the rulebook bounce test: dropped 78 in, both balls rebound 30-34 in", () => {
  for (const kind of P.BALL_KINDS) between(dropTest(kind), 30, 34, `${kind} rebound (in)`)
  // and both balls are legal: 22.1-26.5 g
  for (const kind of P.BALL_KINDS) between(P.BALLS[kind].m * 1000, 22.1, 26.5, `${kind} mass (g)`)
})

test("drag and lift match the free-flight measurements (Cd 0.30-0.33 outdoor, ~0.45 indoor; Cl ~0.2 S)", () => {
  between(P.dragCd(10), 0.29, 0.36, "outdoor Cd at 10 m/s")
  between(P.dragCd(10, P.BALLS.indoor), 0.4, 0.5, "indoor Cd at 10 m/s")
  assert.ok(P.dragCd(25) >= P.dragCd(8), "level or rising a little with speed")
  // lift: a ball at 10 m/s with spin parameter S = 0.2 (topspin) is pushed down by
  // k Cl v^2 with Cl = 0.2 S (Steyn et al. 2025 fitted 0.195 S)
  const v = P.v3(0, 0, -10)
  const S = 0.2
  const w = P.scale(P.topspinAxis(v), (S * 10) / P.BALL_R)
  const lift = P.accel(v, w).y - P.accel(v, P.v3()).y
  const k = (0.5 * P.AIR_RHO * P.BALL_AREA) / P.BALL_M
  const cl = -lift / (k * 100)
  between(cl / S, 0.17, 0.23, "lift slope (topspin)")
  // backspin holds the ball up less than topspin pushes it down (a holed ball; Lindsey 2025)
  const back = P.accel(v, P.scale(w, -1)).y - P.accel(v, P.v3()).y
  assert.ok(back > 0 && back < -lift, `backspin lift ${back.toFixed(2)} vs topspin ${lift.toFixed(2)}`)
})

test("a 50 mph drive crosses the court in about 0.7 s and arrives at ~35 mph (heavy drag)", () => {
  const v0 = 50 * MPH
  const elev = (4 * Math.PI) / 180
  const b = P.createBall(P.v3(0, 0.8, P.HALF_L), P.v3(0, Math.sin(elev) * v0, -Math.cos(elev) * v0), P.v3(-120, 0, 0))
  // (the time to cover 12 m, baseline to just inside theirs, whatever the height)
  let t = 0
  while (b.p.z > P.HALF_L - 12) {
    P.flightStep(b)
    t += P.STEP
  }
  between(t, 0.6, 0.8, "time to cover 12 m (s)")
  between(P.len(b.v) / MPH, 30, 42, "arrival speed (mph)")
})

test("spin changes the bounce: topspin kicks on low, slice skids, sidespin jumps sideways", () => {
  const land = (w, v = P.v3(0, -4, -9)) => {
    const b = P.createBall(P.v3(0, P.BALL_R, 0), v, w)
    P.bounceOnCourt(b)
    return b
  }
  const axis = P.topspinAxis(P.v3(0, 0, -1))
  const top = land(P.scale(axis, 180))
  const flat = land(P.v3())
  const slice = land(P.scale(axis, -180))
  assert.ok(-top.v.z > -flat.v.z + 0.8, "topspin comes off faster")
  assert.ok(Math.atan2(top.v.y, -top.v.z) < Math.atan2(flat.v.y, -flat.v.z), "and lower")
  assert.ok(-slice.v.z >= -flat.v.z - 1e-9, "slice skids through (it doesn't sit up)")
  const side = land(P.v3(0, 0, 160))
  assert.ok(Math.abs(side.v.x) > 0.8, "a tilted spin axis kicks it sideways")
  // spin keeps most of itself through a one-second flight (the air slows it a little)
  const b = P.createBall(P.v3(0, 1, 6), P.v3(0, 3, -15), P.scale(axis, 150))
  for (let i = 0; i < 240; i++) P.flightStep(b)
  between(P.len(b.w) / 150, 0.6, 0.9, "spin left after 1 s")
})

test("the net: a ball square into the cord drops back, a clipped one trickles over, the mesh stops it", () => {
  const top = P.netHeightAt(0)
  const fly = (y, vz, vy = 0) => {
    const b = P.createBall(P.v3(0, y, 0.25), P.v3(0, vy, vz))
    let hit = null
    for (let i = 0; i < 240 && b.p.y > P.BALL_R; i++) hit = P.flyWithNet(b) || hit
    return { b, hit }
  }
  const square = fly(top - 0.005, -6)
  assert.equal(square.hit, "tape")
  assert.ok(square.b.p.z > 0, "struck square on the cord: back on the hitter's side")
  const clipped = fly(top + P.BALL_R + P.CORD_R - 0.012, -5)
  assert.equal(clipped.hit, "tape")
  assert.ok(clipped.b.p.z < 0, "clipped on top: it rolls over")
  const mesh = fly(top - 0.25, -12)
  assert.equal(mesh.hit, "net")
  assert.ok(mesh.b.p.z > 0, "into the mesh: it drops on the hitter's side")
  const clear = fly(top + 0.2, -8)
  assert.equal(clear.hit, null)
  // the net is 34 in at the center, 36 in at the sidelines
  assert.ok(Math.abs(P.netHeightAt(0) - 34 * IN) < 1e-9 && Math.abs(P.netHeightAt(P.HALF_W) - 36 * IN) < 1e-9)
})

test("the paddle: PBCoR 0.43 on a hand-held paddle is an apparent COR of ~0.24; a full swing tops out ~60 mph", () => {
  between(P.PADDLE_COR, 0.22, 0.27, "apparent COR at 60 mph")
  assert.ok(P.paddleCorAt(5) > P.paddleCorAt(27), "livelier on a slow (dink) contact")
  // a still paddle blocks a 45 mph speed-up back at about a quarter of its pace
  const n = P.v3(0, 0, -1)
  const ball = P.createBall(P.v3(0, 1, 2.5), P.v3(0, 0, 45 * MPH))
  const block = P.paddleHit(ball, n, P.v3())
  between(P.len(block.v) / MPH, 9, 15, "a dead block (mph)")
  // the fastest face (MAX_PADDLE_SPEED) on a 30 mph ball: ~55-65 mph out
  const fast = P.paddleHit(P.createBall(P.v3(0, 0.8, 6), P.v3(0, 0, 30 * MPH)), n, P.scale(n, P.MAX_PADDLE_SPEED))
  between(P.len(fast.v) / MPH, 52, 66, "a full drive (mph)")
  // brushing the face makes spin, but never more than a paddle can (2,100-2,300 rpm)
  const brushed = P.paddleHit(P.createBall(P.v3(0, 0.8, 6), P.v3(0, -2, 12)), P.norm(P.v3(0, 0.3, -1)), P.v3(0, 12, -14))
  assert.ok(P.rpm(brushed.w) <= 2300 + 1e-6, `${P.rpm(brushed.w).toFixed(0)} rpm`)
  assert.ok(P.rpm(brushed.w) > 800, "a hard brush makes real spin")
})

test("shots fly like the real ones: a dink 6-12 in over the tape, a third-shot drop launched at 11-16 m/s", () => {
  // a dink from the kitchen line
  const dinkFrom = P.v3(0.4, 0.45, 2.5)
  const dink = planIntent({ team: 0, from: dinkFrom, incoming: P.v3(0, -1, 4), target: { x: -0.6, z: -1.6 }, pace: 0.1 })
  assert.equal(dink.kind, "dink")
  const d = playShot({ p: dinkFrom, v: P.v3(0, -1, 4), w: P.v3() }, dink)
  const da = assessBall(d.ball, 0)
  between(da.clearance, 0.1, 0.35, "dink clearance (m)")
  assert.ok(da.kitchen, "lands in their kitchen")
  between(P.len(d.ball.v) / MPH, 6, 17, "dink speed (mph)")
  // a third-shot drop from the baseline (Steyn et al. 2025: 10.9-16 m/s at 12.5-22.5 deg)
  const dropFrom = P.v3(1, 0.6, P.HALF_L - 0.3)
  const drop = planIntent({ team: 0, from: dropFrom, incoming: P.v3(0, -2, 9), target: { x: -0.5, z: -1.8 }, pace: 0.1, shotNo: 3 })
  assert.equal(drop.kind, "drop")
  const r = playShot({ p: dropFrom, v: P.v3(0, -2, 9), w: P.v3() }, drop)
  const elev = (Math.atan2(r.ball.v.y, Math.hypot(r.ball.v.x, r.ball.v.z)) * 180) / Math.PI
  between(P.len(r.ball.v), 9, 16, "drop launch speed (m/s)")
  between(elev, 15, 32, "drop launch angle (deg)")
  const a = assessBall(r.ball, 0)
  between(a.clearance, SOFT_CLEAR.drop - 0.12, SOFT_CLEAR.drop + 0.25, "drop clearance (m)")
  assert.ok(a.kitchen && !a.attackable, "into the kitchen, unattackable")
  // a low ball can't be driven down: the same pace from below the net carries long
  const low = planIntent({ team: 0, from: P.v3(0, 0.3, 2.4), incoming: P.v3(0, -1, 5), target: { x: 0, z: -2.6 }, pace: 1, shotNo: 9 })
  const lr = playShot({ p: P.v3(0, 0.3, 2.4), v: P.v3(0, -1, 5), w: P.v3() }, low)
  assert.ok(lr.solved.long, "had to lift it over the tape")
  assert.ok(Math.abs(lr.solved.landing.z) > P.HALF_L - 1.5, `and it lands deep or long (${lr.solved.landing.z.toFixed(1)})`)
})

test("indoor vs outdoor: the same swing flies shorter and slower with the indoor ball", () => {
  const go = (kind) => P.flyToGround({ p: P.v3(0, 0.8, 6), v: P.v3(0, 3, -16), w: P.v3(), kind })
  const out = go("outdoor")
  const ind = go("indoor")
  assert.ok(Math.abs(ind.z - 6) < Math.abs(out.z - 6) - 0.4, `indoor ${ind.z.toFixed(2)} vs outdoor ${out.z.toFixed(2)}`)
  assert.ok(P.len(ind.v) < P.len(out.v))
})

test("determinism: the same seed plays the same match, step for step (online and replays rely on it)", () => {
  const run = () => {
    const m = createMatch({ doubles: true, level: "pro", seed: 77 })
    m.autoplay = true
    const trace = []
    for (let i = 0; i < 240 * 40; i++) {
      step(m)
      if (i % 120 === 0) trace.push(`${m.ball.p.x.toFixed(9)},${m.ball.p.y.toFixed(9)},${m.ball.p.z.toFixed(9)}`)
    }
    return trace.join("|") + m.game.score.join("-")
  }
  assert.equal(run(), run())
})

test("rules: a ball that hits a player is that team's fault; an Erne stance is outside the kitchen", () => {
  const g = R.createGame({ doubles: true })
  const r = R.createRally(g)
  R.refHit(r, { player: g.server, team: g.serving, x: 1.5, z: P.HALF_L + 0.2, serve: { contactY: 0.5, waistY: 1, paddleVy: 1 } })
  const res = R.refBody(r, 1 - g.serving, "B1")
  assert.equal(res.fault, 1 - g.serving)
  assert.equal(res.reason, "Hit by the ball")
  // the non-volley zone runs sideline to sideline: just outside the sideline, level with the
  // kitchen, is not in it (an Erne)
  assert.equal(R.inKitchen(P.HALF_W + R.FOOT_R + 0.05, 1.0), false)
  assert.equal(R.inKitchen(P.HALF_W - 0.2, 1.0), true)
  // around the post: a ball crossing outside the post at any height is good
  const atp = assessBall({ p: P.v3(P.NET_POST_X + 0.6, 0.3, 1.2), v: P.v3(-0.4, 1.5, -6), w: P.v3() }, 0)
  assert.ok(atp.atp, "crossed outside the post")
})

test("rules: a serve that clips the net and lands in the box plays on (no lets since 2021)", () => {
  const m = createMatch({ doubles: false, level: "pro", seed: 3 })
  m.phase = "rally"
  m.ball.held = null
  const r = m.rally
  R.refHit(r, { player: r.server, team: r.serving, x: 0, z: P.HALF_L + 0.2, serve: { contactY: 0.5, waistY: 1, paddleVy: 1 } })
  r.lastTeam = r.serving
  // a served ball arriving at the net just low enough to brush the cord on its way over
  const side = R.sideOf(r.serving)
  const want = (r.court === "right" ? 1 : -1) * R.rightSign(1 - r.serving)
  m.ball.p = P.v3(want * 0.4, P.netHeightAt(want * 0.4) + 0.03, side * 0.2)
  m.ball.v = P.v3(want * 1.6, 0.5, -side * 13)
  m.ball.w = P.scale(P.topspinAxis(P.v3(0, 0, -side)), 60)
  const seen = []
  let landed = null
  for (let i = 0; i < 240 * 2 && !landed; i++) {
    step(m)
    for (const e of m.events) {
      seen.push(e.type)
      if (e.type === "bounce") landed = e
    }
    m.events.length = 0
  }
  assert.ok(seen.includes("tape"), `it touched the cord: ${seen.join(" ")}`)
  assert.ok(landed && R.inServiceCourt(landed.x, landed.z, 1 - r.serving, r.court), `landed in the box (${landed?.x.toFixed(2)}, ${landed?.z.toFixed(2)})`)
  assert.ok(R.isLive(r), "play on")
})
