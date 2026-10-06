// Real Ball: node --test client/src/components/applets/pickleball/twin/ball/ball.test.js
import test from "node:test"
import assert from "node:assert/strict"
import { BALL_R, HALF_L, HALF_W, KITCHEN } from "../../physics.js"
import { bounceSigma, callBounce, callText, cameraFromHomography, fitFlight, flightAt, simulate } from "./flight.js"
import { detectBall, createBallFinder, searchRegion, ballColor } from "./detect.js"
import { analyzeBall, annotateHits, measuredPath, rallyVerdict, TRUST } from "./realball.js"
import { makeCamera, observe } from "./testcam.js"
import { withPaths } from "../core/analyze.js"
import { ballAt, rallyPath } from "../core/ballpath.js"

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`)

test("the camera comes back from the four corner taps (focal length, position)", () => {
  for (const setup of [{}, { pos: { x: -1.2, y: 2.4, z: HALF_L + 3 }, f: 760, W: 960, H: 540 }, { pos: { x: 0.8, y: 4.5, z: HALF_L + 6 }, f: 1400, W: 1920, H: 1080 }]) {
    const truth = makeCamera(setup)
    const cam = cameraFromHomography(truth.H, truth.W, truth.H_px)
    near(cam.f, truth.f, truth.f * 0.01, "focal")
    near(cam.center.x, truth.pos.x, 0.05, "camera x")
    near(cam.center.y, truth.pos.y, 0.05, "camera height")
    near(cam.center.z, truth.pos.z, 0.05, "camera z")
    // a point in the air projects where the true camera puts it
    const P = { x: 1.1, y: 2.2, z: -3.4 }
    const a = truth.project(P)
    const b = cam.project(P)
    near(Math.hypot(a[0] - b[0], a[1] - b[1]), 0, 0.5, "air point reprojection px")
  }
})

test("the flight model: drag slows it, the court bounces it", () => {
  const vac = { x: 0, y: 1, z: 6 }
  const sim = simulate({ x: 0, y: 1, z: -6 }, { x: 0, y: 3, z: 15 }, 1.5)
  assert.equal(sim.bounces.length >= 1, true, "bounces")
  const b = sim.bounces[0]
  assert.ok(b.vout.y > 0 && Math.abs(b.vout.y) < Math.abs(b.vin.y), "loses height speed at the bounce")
  // a holed ball's drag: well short of where a vacuum arc would land
  const tVac = (3 + Math.sqrt(9 + 2 * 9.81 * (1 - BALL_R))) / 9.81
  assert.ok(b.z < -6 + 15 * tVac - 0.5, `drag shortens the flight (${b.z.toFixed(2)})`)
  void vac
  for (const p of sim.pts) assert.ok(p.y >= BALL_R - 1e-9, "never under the court")
})

test("the fit recovers a flight from a noisy track with misses and false spots", () => {
  const truth = makeCamera()
  const cam = cameraFromHomography(truth.H, truth.W, truth.H_px)
  const cases = [
    { P: { x: 1.2, y: 0.9, z: -5.8 }, V: { x: -1.5, y: 3.2, z: 14 }, T: 1.1 }, // a drive from the far side
    { P: { x: -0.6, y: 0.5, z: -2.2 }, V: { x: 0.6, y: 3.0, z: 5.0 }, T: 1.1 }, // a dink over the net
    { P: { x: 0.9, y: 0.7, z: 6.4 }, V: { x: -1.6, y: 4.4, z: -10.5 }, T: 1.4 }, // a drive away from the camera
  ]
  for (const [k, c] of cases.entries()) {
    const sim = simulate(c.P, c.V, c.T)
    const obs = observe(sim, truth, { T: c.T, falsePerFrame: 2, seed: 11 + k })
    const prior = { P0: { x: c.P.x - 0.3, y: c.P.y + 0.2, z: c.P.z + 0.4 }, V0: { x: c.V.x * 0.8, y: c.V.y * 0.8, z: c.V.z * 0.85 }, P1: (() => { const e = sim.at(c.T); return { x: e.x + 0.3, y: e.y - 0.15, z: e.z - 0.3 } })() }
    const fit = fitFlight(obs, { t0: 0, t1: c.T, cam, prior })
    assert.ok(fit, `case ${k}: a fit`)
    assert.ok(fit.conf >= TRUST, `case ${k}: confident (${fit.conf})`)
    // the path matches the truth closely (camera-depth errors stay small with both ends known)
    let worst = 0
    for (let t = 0.1; t < c.T - 0.05; t += 0.05) {
      const a = fit.at(t)
      const b = sim.at(t)
      worst = Math.max(worst, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z))
    }
    // (the far end of a drive is ~17 m from a fence camera: depth along the view is the
    // loosest direction; the bounce and the speed are what the calls and stats use)
    assert.ok(worst < 0.45, `case ${k}: path within 45 cm (${worst.toFixed(3)})`)
    if (sim.bounces[0]) {
      const fb = fit.bounces[0]
      assert.ok(fb, `case ${k}: bounce found`)
      const e = Math.hypot(fb.x - sim.bounces[0].x, fb.z - sim.bounces[0].z)
      assert.ok(e < 0.1, `case ${k}: bounce within 10 cm (${(e * 100).toFixed(1)} cm)`)
      assert.ok(bounceSigma(fit, cam) < 0.15, "a sensible uncertainty")
    }
    near(fit.speed, Math.hypot(c.V.x, c.V.y, c.V.z), 1.5, `case ${k}: speed m/s`)
  }
})

test("line calls: lines are in, the kitchen line is a fault on a serve, too close stands", () => {
  // rally ball into team 0's half (+z)
  assert.equal(callBounce({ x: 0.5, z: HALF_L - 0.02, sigma: 0.01 }, { toTeam: 0 }).verdict, "in")
  assert.equal(callBounce({ x: 0.5, z: HALF_L + 0.05, sigma: 0.01 }, { toTeam: 0 }).verdict, "out")
  // touching the sideline (center 5 mm outside its outer edge, footprint on the line): in
  assert.equal(callBounce({ x: HALF_W + 0.005, z: 3, sigma: 0.01 }, { toTeam: 0 }).verdict, "in")
  assert.equal(callBounce({ x: -(HALF_W + 0.05), z: 3, sigma: 0.01 }, { toTeam: 0 }).line, "sideline")
  // team 1's half (-z)
  assert.equal(callBounce({ x: 0, z: -(HALF_L + 0.04), sigma: 0.01 }, { toTeam: 1 }).verdict, "out")
  // a serve: past the kitchen line, in the diagonal court (centerline counts)
  const serve = (x, z) => callBounce({ x, z, sigma: 0.01 }, { kind: "serve", toTeam: 1, serverX: 1.5 })
  assert.equal(serve(-1.2, -4.5).verdict, "in", "deep in the diagonal court")
  assert.equal(serve(-1.2, -(KITCHEN + 0.005)).verdict, "out", "on the kitchen line: a fault")
  assert.equal(serve(-1.2, -(KITCHEN + 0.005)).line, "kitchen")
  assert.equal(serve(0.005, -4).verdict, "in", "on the centerline")
  assert.equal(serve(0.6, -4).verdict, "out", "the wrong service court")
  // too close to call: within 2 sigma
  const close = callBounce({ x: 0, z: HALF_L + 0.015, sigma: 0.03 }, { toTeam: 0 })
  assert.equal(close.close, true)
  assert.equal(callText(close), "Too close: call stands")
  assert.equal(callText(callBounce({ x: 0, z: HALF_L + 0.05, sigma: 0.005 }, { toTeam: 0 })), "OUT by 4 cm")
})

test("the detector finds a small moving ball and ignores a moving player and still courts", () => {
  const W = 320
  const H = 200
  const frame = (bx, by, px) => {
    const a = new Uint8ClampedArray(W * H * 4)
    for (let i = 0; i < W * H; i++) {
      // a blue court with a little noise and a white line
      const y = Math.floor(i / W)
      const n = ((i * 2654435761) >>> 0) % 7
      a[i * 4] = 40 + n
      a[i * 4 + 1] = 90 + n
      a[i * 4 + 2] = 170 + n
      if (y === 120) (a[i * 4] = 240), (a[i * 4 + 1] = 240), (a[i * 4 + 2] = 240)
      a[i * 4 + 3] = 255
    }
    const dot = (cx, cy, r, rgb) => {
      for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        if (x < 0 || y < 0 || x >= W || y >= H || (x - cx) ** 2 + (y - cy) ** 2 > r * r) continue
        const k = (y * W + x) * 4
        a[k] = rgb[0]
        a[k + 1] = rgb[1]
        a[k + 2] = rgb[2]
      }
    }
    dot(px, 100, 22, [200, 40, 60]) // a player in a red shirt
    dot(bx, by, 2, [215, 235, 60]) // the ball
    return a
  }
  const region = { x0: 0, y0: 0, x1: W, y1: H }
  const c = detectBall(frame(100, 60, 200), frame(112, 58, 206), frame(124, 57, 212), W, H, region)
  assert.ok(c.length >= 1, "candidates")
  near(c[0].u, 112, 2, "ball u")
  near(c[0].v, 58, 2, "ball v")
  assert.ok(!c.some((x) => x.area > 260), "no player-sized blob")
  assert.ok(ballColor(215, 235, 60) > 0.8 && ballColor(40, 90, 170) < 0.1, "ball color vs court")
  // the rolling finder skips a repeated frame
  const f = createBallFinder({ W, H, region })
  assert.equal(f.push(0, frame(100, 60, 200)), null)
  assert.equal(f.push(0.033, frame(100, 60, 200)), null, "duplicate skipped")
  assert.equal(f.push(0.066, frame(112, 58, 206)), null)
  const out = f.push(0.1, frame(124, 57, 212))
  assert.equal(out.t, 0.066)
  near(out.cands[0].u, 112, 2, "finder ball u")
})

test("analyzeBall: rallies + spots -> measured flights, calls, the rally's winner; the replay uses them", () => {
  const truthCam = makeCamera()
  const taps = truthCam.taps
  // a two-shot rally: a serve from the near right (team 0) landing deep, returned by team 1
  const P0 = { x: 1.6, y: 0.62, z: 6.9 }
  const V0 = { x: -2.6, y: 4.6, z: -15 }
  const T = 1.25
  const sim = simulate(P0, V0, T)
  const end = sim.at(T)
  const rally = {
    id: 0,
    start: 1,
    end: 1 + T,
    hits: [
      { t: 1, player: 0, team: 0, kind: "serve", side: "fh", x: P0.x, z: P0.z + 0.45, height: 0.6, bounced: true },
      { t: 1 + T, player: 2, team: 1, kind: "return", side: "fh", x: end.x + 0.38, z: end.z - 0.45, height: end.y - 0.08, bounced: true },
    ],
  }
  const analysis = { players: [0, 2].map((id) => ({ id, team: id < 2 ? 0 : 1, hand: 1, name: `P${id}`, samples: [] })), rallies: [rally], calibration: { taps } }
  // spots: what the reader would have collected at 15 fps (shifted to the rally's time)
  const obs = observe(sim, truthCam, { t0: 1, T, falsePerFrame: 1, seed: 5 })
  const byT = new Map()
  for (const o of obs) {
    if (!byT.has(o.t)) byT.set(o.t, [])
    byT.get(o.t).push({ u: o.u, v: o.v, score: o.score })
  }
  const spots = [...byT.entries()].map(([t, cands]) => ({ t, cands }))
  const ball = analyzeBall(spots, analysis, { W: truthCam.W, H: truthCam.H_px })
  assert.ok(ball && ball.flights[0][0], "a flight for the serve")
  const f = ball.flights[0][0]
  assert.ok(f.conf >= TRUST, `confident (${f.conf})`)
  const tb = sim.bounces[0]
  assert.ok(Math.hypot(f.bounce.x - tb.x, f.bounce.z - tb.z) < 0.15, "the serve's bounce")
  assert.equal(f.call.verdict, "in", "a deep serve in the diagonal court")
  // annotated hits + replay segments + fallback
  const withBall = { ...analysis, ball }
  const a = annotateHits(withBall)
  assert.ok(a.rallies[0].hits[0].ball?.call, "the serve carries its call")
  const full = withPaths(withBall)
  const seg = full.paths[0].segments.find((s) => s.measured)
  assert.ok(seg, "the replay uses the measured flight")
  const q = ballAt(full.paths[0].segments, 1.5)
  const tq = sim.at(0.5)
  assert.ok(Math.hypot(q.x - tq.x, q.y - tq.y, q.z - tq.z) < 0.3, "the replayed ball follows the real one")
  // a weak flight falls back to the rebuilt arc
  const weak = { ...ball, flights: [[{ ...f, conf: 0.1 }, ball.flights[0][1]]] }
  const rebuilt = rallyPath(rally.hits)
  const mp = measuredPath(rally, weak.flights[0], rebuilt)
  assert.ok(!mp.segments.some((s) => s.measured && s.t0 === 1), "low confidence: rebuilt")
  // ballOff turns it all off
  assert.ok(!withPaths({ ...withBall, ballOff: true }).paths[0].segments.some((s) => s.flight))
  // flightAt is the same physics as simulate
  const fs = { t0: 1, t1: 1 + T, flight: { P0, V0 } }
  near(flightAt(fs, 1.4).z, sim.at(0.4).z, 1e-9, "flightAt")
  // the rally's winner by the last shot
  const v = rallyVerdict({ hits: [{ team: 0 }] }, [{ conf: 0.9, bounce: { x: 0, z: -HALF_L - 0.1 }, call: { verdict: "out", close: false, margin: -0.1, line: "baseline" } }])
  assert.deepEqual([v.winner, v.why], [1, "out"])
  assert.deepEqual(rallyVerdict({ hits: [{ team: 1 }] }, [{ conf: 0.9, bounce: { x: 0, z: -2 }, call: null }]).why, "net")
})

test("the search region covers the court and the air above it", () => {
  const truth = makeCamera()
  const cam = cameraFromHomography(truth.H, truth.W, truth.H_px)
  const r = searchRegion(cam, truth.W, truth.H_px)
  for (const t of truth.taps.filter((t) => t.x >= 0 && t.y >= 0 && t.x <= truth.W && t.y <= truth.H_px)) assert.ok(t.x >= r.x0 && t.x <= r.x1 && t.y >= r.y0 && t.y <= r.y1, "corner inside")
  const lob = cam.project({ x: 0, y: 4, z: -5 })
  assert.ok(lob[1] >= r.y0, "a high lob is inside")
})
