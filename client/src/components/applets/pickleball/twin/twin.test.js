// Twin Replay core: node --test client/src/components/applets/pickleball/twin/twin.test.js
import test from "node:test"
import assert from "node:assert/strict"
import { applyH, calibrate, solveHomography } from "./core/homography.js"
import { hungarian, oneEuro, createTracker } from "./core/tracker.js"
import { detectOnsets, addPop } from "./core/onsets.js"
import { classify } from "./core/hits.js"
import { rallyPath, ballAt, clearsNet } from "./core/ballpath.js"
import { createAnalyzer, withPaths } from "./core/analyze.js"
import { buildFrames } from "./core/replay.js"
import { toTwin, fromTwin } from "./core/twinfile.js"
import { makeCamera, scriptRally, filmRally, soundtrack, cornerTaps } from "./synthetic.js"
import { HALF_L, HALF_W } from "../physics.js"

test("homography: exact on 4 points, recovers a projection, rejects crossed corners", () => {
  const cam = makeCamera()
  const taps = cornerTaps(cam)
  const cal = calibrate(taps)
  assert.equal(cal.ok, true)
  assert.ok(cal.rms < 1e-6, `rms ${cal.rms}`)
  // any court point maps back within a centimeter
  for (const [x, z] of [[0, 0], [1.5, 3], [-2.8, -5.9], [2, 6.4]]) {
    const px = cam.project({ x, y: 0, z })
    const q = applyH(cal.H, px.x, px.y)
    assert.ok(Math.hypot(q[0] - x, q[1] - z) < 0.01, `${x},${z} -> ${q}`)
  }
  // least squares with extra points still fits
  const H = solveHomography([[0, 0], [10, 0], [10, 10], [0, 10], [5, 5]].map(([x, y]) => ({ src: [x, y], dst: [x * 2, y * 3] })))
  const q = applyH(H, 4, 7)
  assert.ok(Math.abs(q[0] - 8) < 1e-6 && Math.abs(q[1] - 21) < 1e-6)
  // corners in the wrong order (crossed) are refused
  const bad = [taps[0], taps[2], taps[1], taps[3]].map((t, i) => ({ ...t, id: taps[i].id }))
  assert.equal(calibrate(bad).ok, false)
  assert.equal(calibrate(taps.slice(0, 3)).ok, false)
})

test("tracking: Hungarian is optimal, one-euro smooths, identities survive shuffled detections", () => {
  assert.deepEqual(hungarian([[4, 1, 3], [2, 0, 5], [3, 2, 2]]), [1, 0, 2])
  assert.deepEqual(hungarian([[1, 9], [9, 1], [5, 5]]).slice(0, 2), [0, 1])
  const f = oneEuro()
  let y = 0
  for (let i = 0; i < 30; i++) y = f(i % 2 ? 1.05 : 0.95, i / 30)
  assert.ok(Math.abs(y - 1) < 0.06)
  const cam = makeCamera()
  const script = scriptRally()
  const frames = filmRally(script, cam)
  const cal = calibrate(cornerTaps(cam))
  const tr = createTracker({ players: 4, H: cal.H })
  for (const fr of frames) tr.step(fr.t, fr.people)
  const tracks = tr.finish()
  assert.equal(tracks.length, 4)
  // each track follows one true player the whole way (majority vote, then error check)
  for (const t of tracks) {
    const votes = [0, 0, 0, 0]
    t.samples.forEach((s, i) => {
      const fr = frames.find((f) => Math.abs(f.t - s.t) < 1e-6)
      const best = fr.people.reduce((a, p) => (Math.hypot(p.truth.x - s.rawX, p.truth.z - s.rawZ) < Math.hypot(a.truth.x - s.rawX, a.truth.z - s.rawZ) ? p : a))
      votes[best.truth.player]++
      void i
    })
    const who = votes.indexOf(Math.max(...votes))
    assert.ok(votes[who] / t.samples.length > 0.97, `track ${t.id} switched identity ${votes}`)
    let worst = 0
    for (const s of t.samples) {
      const p = script.posAt(who, s.t)
      worst = Math.max(worst, Math.hypot(p.x - s.x, p.z - s.z))
    }
    assert.ok(worst < 0.5, `track ${t.id} max error ${worst.toFixed(2)} m`)
  }
})

test("onsets: finds paddle pops, ignores footsteps and bounces", () => {
  const rate = 22050
  const x = new Float32Array(rate * 6)
  let s = 5
  for (let i = 0; i < x.length; i++) x[i] = ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 0.02
  // footsteps (low) every 0.3 s and a court bounce (dull) at 2.2 s
  for (let t = 0.1; t < 6; t += 0.3) for (let i = 0; i < 600; i++) x[Math.round(t * rate) + i] += 0.1 * Math.exp(-i / 170) * Math.sin((2 * Math.PI * 110 * i) / rate)
  for (let i = 0; i < 400; i++) x[Math.round(2.2 * rate) + i] += 0.1 * Math.exp(-i / 90) * Math.sin((2 * Math.PI * 600 * i) / rate)
  const pops = [0.8, 1.9, 3.05, 4.4, 5.2]
  pops.forEach((t, k) => addPop(x, rate, t, 0.5, k + 1))
  const found = detectOnsets(x, rate)
  assert.equal(found.length, pops.length, JSON.stringify(found.map((o) => o.t.toFixed(3))))
  found.forEach((o, i) => assert.ok(Math.abs(o.t - pops[i]) < 0.02, `${o.t} vs ${pops[i]}`))
})

test("shot kinds: serve, return, dink, volley, drop, lob, overhead", () => {
  const h = (z, height, bounced = true, t = 0) => ({ z, height, bounced, t, x: 0 })
  assert.equal(classify(h(7, 0.7), h(-7, 0.8, true, 1.3), 0), "serve")
  assert.equal(classify(h(-7, 0.8), h(6, 0.6, true, 2.6), 1), "return")
  assert.equal(classify(h(2.5, 0.3), h(-2.4, 0.3, true, 1.3), 4), "dink")
  assert.equal(classify(h(2.5, 1.0, false), h(-2.4, 1.0, false, 0.6), 5), "volley")
  assert.equal(classify(h(6.2, 0.6), h(-2.5, 0.35, true, 1.4), 2), "drop")
  assert.equal(classify(h(2.3, 0.8), h(-6.5, 1.8, true, 1.8), 6), "lob")
  assert.equal(classify(h(-5, 2.3, false), null, 7), "overhead")
})

test("ball path: clears the net, bounces on the receiver's side, meets each contact", () => {
  const hits = [
    { t: 0, player: 0, team: 0, x: 1.2, z: 6.9, height: 0.7, kind: "serve", side: "fh", bounced: true },
    { t: 1.35, player: 2, team: 1, x: -1.3, z: -6.3, height: 0.8, kind: "return", side: "fh", bounced: true },
    { t: 2.75, player: 1, team: 0, x: -1.2, z: 5.7, height: 0.6, kind: "drop", side: "bh", bounced: true },
    { t: 4.15, player: 3, team: 1, x: 1.3, z: -2.3, height: 0.35, kind: "dink", side: "fh", bounced: true },
    { t: 4.9, player: 0, team: 0, x: 1.0, z: 2.4, height: 1.0, kind: "volley", side: "fh", bounced: false },
  ]
  const { segments, bounces, contacts } = rallyPath(hits)
  assert.ok(clearsNet(segments))
  // serve bounce past the kitchen on the receiver's side; every bounce on the right side
  assert.ok(bounces[0].z < -2.13 - 0.1)
  assert.ok(bounces[1].z > 0 && bounces[2].z < 0)
  // the ball is at each contact at its hit time
  hits.forEach((h, i) => {
    if (i === 0) return
    const b = ballAt(segments, h.t)
    assert.ok(Math.hypot(b.x - contacts[i].x, b.y - contacts[i].y, b.z - contacts[i].z) < 0.02)
  })
  // a volley (no bounce) is one arc
  const last = segments.filter((s) => s.t0 >= 4.15 - 1e-9 && s.t1 <= 4.9 + 1e-9)
  assert.equal(last.length, 1)
})

test("end to end (synthetic fence-cam rally): positions within 0.5 m, hits within 0.15 s", () => {
  const cam = makeCamera()
  const script = scriptRally()
  const frames = filmRally(script, cam, { fps: 15 })
  const audio = soundtrack(script, { bounces: [2.3, 3.9, 6.6] })
  const an = createAnalyzer({ taps: cornerTaps(cam, 1.5), players: 4 })
  for (const f of frames) an.push(f.t, f.people)
  const result = an.finish({ audio })
  assert.equal(result.players.length, 4)
  // positions: every sample within 0.5 m of the truth (matched by majority player)
  for (const p of result.players) {
    const errs = p.samples.map((s) => Math.min(...[0, 1, 2, 3].map((k) => Math.hypot(script.posAt(k, s.t).x - s.x, script.posAt(k, s.t).z - s.z))))
    const worst = Math.max(...errs)
    assert.ok(worst < 0.5, `player ${p.id} worst ${worst.toFixed(2)} m`)
  }
  // hits: every scripted hit found within 0.15 s, none extra, right team
  const found = result.rallies.flatMap((r) => r.hits)
  assert.equal(found.length, script.hits.length, found.map((h) => h.t.toFixed(2)).join(" "))
  script.hits.forEach((h, i) => {
    assert.ok(Math.abs(found[i].t - h.t) < 0.15, `hit ${i} at ${found[i].t} vs ${h.t}`)
    assert.equal(found[i].team, h.team)
  })
  assert.equal(result.rallies.length, 1)
  assert.equal(found[0].kind, "serve")
  assert.equal(found[1].kind, "return")
  assert.ok(["dink"].includes(found[4].kind), found[4].kind)
  assert.ok(["volley"].includes(found[7].kind), found[7].kind)
  // stats exist and make sense
  assert.ok(result.stats.players.every((s) => s.distance > 1 && s.kitchenPct >= 0 && s.kitchenPct <= 1))
  assert.equal(result.stats.longest, script.hits.length)
  // sound 0.4 s late (a recorder's start-up): the offset is found and the hits still line up
  const late = soundtrack(script, { bounces: [2.3, 3.9, 6.6] })
  const shifted = new Float32Array(late.samples.length)
  const k = Math.round(0.4 * late.rate)
  shifted.set(late.samples.subarray(0, late.samples.length - k), k)
  const an3 = createAnalyzer({ taps: cornerTaps(cam), players: 4 })
  for (const f of frames) an3.push(f.t, f.people)
  const r3 = an3.finish({ audio: { samples: shifted, rate: late.rate } })
  assert.ok(Math.abs(r3.soundOffset + 0.4) < 0.05, `offset ${r3.soundOffset}`)
  const f3 = r3.rallies.flatMap((r) => r.hits)
  assert.equal(f3.length, script.hits.length)
  script.hits.forEach((h, i) => assert.ok(Math.abs(f3[i].t - h.t) < 0.15, `late sound: hit ${i} ${f3[i].t} vs ${h.t}`))
  // without sound: swing peaks alone still find most hits
  const an2 = createAnalyzer({ taps: cornerTaps(cam), players: 4 })
  for (const f of frames) an2.push(f.t, f.people)
  const silent = an2.finish({ audio: null })
  const n2 = silent.rallies.flatMap((r) => r.hits)
  const matched = script.hits.filter((h) => n2.some((q) => Math.abs(q.t - h.t) < 0.2 && q.team === h.team)).length
  assert.ok(matched >= script.hits.length - 1, `silent: ${matched}/${script.hits.length}`)
})

test("far region: the far half enlarged, mapped back, duplicates merged", async () => {
  const { courtRegion, farRegion, fromCrop, mergePeople } = await import("./core/regions.js")
  const cam = makeCamera({ width: 640, height: 360 })
  const cal = calibrate(cornerTaps(cam))
  // the court crop holds every corner and a far player's head, and less than the whole frame
  const c = courtRegion(cal.Hinv, 640, 360)
  for (const t of cornerTaps(cam)) {
    const inside = t.x >= c.x - 1 && t.x <= c.x + c.w + 1 && t.y >= c.y - 1 && t.y <= c.y + c.h + 1
    const offFrame = t.x < 0 || t.x > 640 || t.y < 0 || t.y > 360
    assert.ok(inside || offFrame, `corner ${t.id} in the court crop`)
  }
  const head = cam.project({ x: 0, y: 1.9, z: -HALF_L - 1 })
  assert.ok(head.y >= c.y, "a far player's head is in the crop")
  assert.ok(c.w * c.h < 640 * 360, "the crop leaves out the stands")
  const r = farRegion(cal.Hinv, 640, 360)
  assert.ok(r, "a fence camera's far players are small: a far region is used")
  // the far baseline's corners are inside it, and it reaches up a player's height above them
  const fl = cam.project({ x: -HALF_W, y: 0, z: -HALF_L })
  const fh = cam.project({ x: 0, y: 2.0, z: -HALF_L })
  assert.ok(fl.x >= r.x && fl.x <= r.x + r.w && fl.y >= r.y && fl.y <= r.y + r.h)
  assert.ok(fh.y >= r.y, "head room above the far baseline")
  // a camera close above the far court needs no extra region
  const close = makeCamera({ pos: { x: 0, y: 14, z: 0.5 }, look: { x: 0, y: 0, z: -0.5 }, width: 640, height: 360, fov: 70 })
  assert.equal(farRegion(calibrate(cornerTaps(close)).Hinv, 640, 360, { minPxPerM: 15 }), null)
  // crop coordinates -> frame coordinates
  const back = fromCrop([{ lm: [{ x: 256, y: 50, v: 1 }] }], { x: 100, y: 20, w: 200, h: 80 }, 512, 205)
  assert.ok(Math.abs(back[0].lm[0].x - 200) < 1e-9 && Math.abs(back[0].lm[0].y - (20 + (50 / 205) * 80)) < 1e-9)
  // the same person in both lists: one kept (the more visible)
  const mk = (x, v) => ({ x, lm: [{ x: 0, y: 0, v }] })
  const merged = mergePeople([mk(1, 0.5), mk(5, 0.9)], [mk(1.2, 0.9), mk(-3, 0.9)], (p) => [p.x, 0])
  assert.equal(merged.length, 3)
  assert.equal(merged.find((p) => Math.abs(p.x - 1.2) < 1e-9 || Math.abs(p.x - 1) < 1e-9).lm[0].v, 0.9)
})

test("replay frames and the share file round-trip", () => {
  const cam = makeCamera()
  const script = scriptRally()
  const an = createAnalyzer({ taps: cornerTaps(cam), players: 4 })
  for (const f of filmRally(script, cam)) an.push(f.t, f.people)
  const result = an.finish({ audio: soundtrack(script), names: { 0: "Brandon", 1: "Kim" } })
  const full = withPaths(result)
  const { frames } = buildFrames(full)
  assert.ok(frames.length > 200)
  // every situation is well formed: numbers, a ball, swings right after hits
  for (const f of frames) for (const s of f.players) {
    assert.ok(Number.isFinite(s.x) && Number.isFinite(s.z) && s.ball && Number.isFinite(s.ball.y))
    assert.ok(Math.abs(s.x) < HALF_W + 4 && Math.abs(s.z) < HALF_L + 4)
  }
  const swings = frames.filter((f) => f.players.some((s) => s.swing && s.swing.t < 0.04)).length
  assert.ok(swings >= script.hits.length - 1)
  // the file: small, and it comes back the same
  const twin = toTwin(result, { venue: "loscab", court: 3, title: "Sunday doubles" })
  const text = JSON.stringify(twin)
  assert.ok(text.length < 20000, `${text.length} bytes`)
  const back = fromTwin(JSON.parse(text))
  assert.equal(back.meta.venue, "loscab")
  assert.equal(back.analysis.players.length, 4)
  assert.equal(back.analysis.players[0].name, result.players[0].name)
  const a = result.rallies[0].hits
  const b = back.analysis.rallies[0].hits
  assert.equal(b.length, a.length)
  a.forEach((h, i) => {
    assert.ok(Math.abs(b[i].t - h.t) < 0.002)
    assert.equal(b[i].kind, h.kind)
  })
  // positions on the 10 Hz grid within 3 cm of the original
  const p = result.players[0]
  const q = back.analysis.players.find((x) => x.id === p.id)
  for (const s of q.samples.slice(5, 50)) {
    const o = p.samples.reduce((m, x) => (Math.abs(x.t - s.t) < Math.abs(m.t - s.t) ? x : m))
    if (Math.abs(o.t - s.t) < 0.01) assert.ok(Math.hypot(o.x - s.x, o.z - s.z) < 0.03)
  }
  assert.throws(() => fromTwin({ format: "nope" }))
  assert.throws(() => fromTwin({ format: "98ish-twin", v: 99 }))
})
