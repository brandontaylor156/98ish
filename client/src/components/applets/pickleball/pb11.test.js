// pb11: the swipe trail (swipetrail.js) and the researched ball sounds (pbsound.js)
import { test } from "node:test"
import assert from "node:assert/strict"
import { TRAIL, SHOT_COLORS, addPoint, bandOf, colorForKind, createRipple, createTrail, outline, release, ribbon, rippleAt, smoothPath, swipeLook, trailAlpha } from "./swipetrail.js"
import { CAL, PADDLE_CORES, bounceVoice, contactOf, distanceMix, fenceVoice, hitVoice, keyStrength, netVoice, renderVoice, rng, roomFor, shotFamily, strengthOf, tapVoice, voiceFor, voiceKey } from "./pbsound.js"
import { readSwipe } from "./touchplay.js"

// ---------- the swipe trail ----------
const swipe = (n = 12, { x0 = 200, y0 = 700, dx = 6, dy = -30, dt = 12 } = {}) => {
  const pts = []
  for (let i = 0; i < n; i++) pts.push({ x: x0 + dx * i + Math.sin(i) * 3, y: y0 + dy * i, t: 1000 + dt * i })
  return pts
}

test("trail: points follow the finger; a still finger adds nothing; long swipes stay bounded", () => {
  const t = createTrail({ x: 10, y: 10, t: 0 })
  addPoint(t, { x: 11, y: 10, t: 8 })
  assert.equal(t.pts.length, 1, "a 1 px move is the same point")
  assert.equal(t.pts[0].t, 8, "...with the tip's time moved on")
  addPoint(t, { x: 30, y: 10, t: 16 })
  assert.equal(t.pts.length, 2)
  for (let i = 0; i < 400; i++) addPoint(t, { x: 30 + i * 4, y: 10, t: 16 + i })
  assert.ok(t.pts.length <= TRAIL.maxPts, `kept ${t.pts.length}`)
  assert.deepEqual([t.pts[0].x, t.pts[0].y], [10, 10], "the start stays (thinned, not cut)")
  assert.equal(t.pts[t.pts.length - 1].x, 30 + 399 * 4, "the tip is the finger")
})

test("trail: smoothing passes through every finger point and fills the gaps", () => {
  const pts = swipe(6, { dy: -60 })
  const path = smoothPath(pts, 5)
  // through the points (Catmull-Rom interpolates them)
  for (const p of pts) assert.ok(path.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 0.01), `misses ${p.x},${p.y}`)
  // no gap bigger than about a step
  for (let i = 1; i < path.length; i++) assert.ok(Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y) < 7, "a gap in the curve")
  // it stays near the polyline (no wild overshoot)
  const minY = Math.min(...pts.map((p) => p.y)) - 6
  const maxY = Math.max(...pts.map((p) => p.y)) + 6
  assert.ok(path.every((q) => q.y >= minY && q.y <= maxY))
  assert.equal(smoothPath([{ x: 1, y: 2 }]).length, 1)
})

test("trail: thin at the start, full at the fingertip; fades out over 0.4 s after the lift", () => {
  const t = createTrail(swipe(1)[0])
  for (const p of swipe(10).slice(1)) addPoint(t, p)
  const down = ribbon(t, 5)
  assert.ok(down.length > 10)
  assert.ok(down[0].w < down[down.length - 1].w * 0.3, "tapered")
  assert.ok(down[0].a < down[down.length - 1].a, "the start is fainter")
  assert.equal(trailAlpha(t, 99), 1, "full while the finger is down")
  release(t, 10, SHOT_COLORS.hard)
  assert.equal(t.color, SHOT_COLORS.hard)
  const a1 = trailAlpha(t, 10.1)
  const a2 = trailAlpha(t, 10.3)
  assert.ok(a1 > a2 && a2 > 0, `fading: ${a1} then ${a2}`)
  assert.equal(trailAlpha(t, 10 + TRAIL.life), 0, "gone at 0.4 s")
  assert.equal(ribbon(t, 10.5).length, 0)
  assert.ok(ribbon(t, 10.2)[ribbon(t, 10.2).length - 1].w < down[down.length - 1].w, "shrinks as it fades")
})

test("trail: drawn as one closed shape around the path (no overlapping segments)", () => {
  const t = createTrail({ x: 100, y: 500, t: 0 })
  for (let i = 1; i < 8; i++) addPoint(t, { x: 100, y: 500 - i * 20, t: i * 10 })
  const pts = ribbon(t, 1)
  const shape = outline(pts)
  assert.equal(shape.length, pts.length * 2 + 7, "left edge, a 7-point cap, right edge")
  // a straight swipe up: the edges sit half a width either side
  const tip = pts[pts.length - 1]
  const xs = shape.map((q) => q.x)
  assert.ok(Math.abs(Math.max(...xs) - 100 - tip.w / 2) < 0.01 && Math.abs(100 - Math.min(...xs) - tip.w / 2) < 0.01)
  assert.ok(Math.min(...shape.map((q) => q.y)) < tip.y - tip.w / 2 + 0.5, "the cap is ahead of the finger")
})

test("trail colors: the swipe's shot, then the hit's real kind", () => {
  const H = 844
  const tap = readSwipe([{ x: 100, y: 600, t: 0 }, { x: 102, y: 598, t: 80 }], { width: 390, height: H })
  assert.equal(swipeLook(tap).color, SHOT_COLORS.soft, "a tap is a soft touch")
  const flick = readSwipe([{ x: 100, y: 700, t: 0 }, { x: 110, y: 640, t: 10 }, { x: 120, y: 420, t: 70 }], { width: 390, height: H })
  assert.equal(swipeLook(flick).band, "hard", `a quick flick is hard (pace ${flick.pace})`)
  const slowLong = readSwipe([{ x: 100, y: 760, t: 0 }, { x: 100, y: 740, t: 50 }, { x: 100, y: 450, t: 900 }], { width: 390, height: H })
  assert.equal(swipeLook(slowLong).kind, "lob", "slow and long up: a lob")
  assert.equal(bandOf(0.1), "soft")
  assert.equal(bandOf(0.5), "firm")
  assert.equal(bandOf(0.9), "hard")
  assert.equal(colorForKind("dink"), SHOT_COLORS.soft)
  assert.equal(colorForKind("drive"), SHOT_COLORS.hard)
  assert.equal(colorForKind("lob"), SHOT_COLORS.lob)
  assert.equal(colorForKind("roll"), SHOT_COLORS.firm)
})

test("ripples: grow and fade over 0.45 s; the release one is bigger", () => {
  const r = createRipple(50, 60, 1)
  const a = rippleAt(r, 1.05)
  const b = rippleAt(r, 1.3)
  assert.ok(b.radius > a.radius && b.alpha < a.alpha)
  assert.equal(rippleAt(r, 1 + TRAIL.rippleLife + 1e-6), null)
  const big = createRipple(0, 0, 1, SHOT_COLORS.hard, true)
  assert.ok(rippleAt(big, 1.3).radius > b.radius)
})

// ---------- the sounds ----------
const SR = 48000
// the spectrum's peak (Hz) between lo and hi, by a plain DFT on a 2.5 Hz grid
const peakHz = (x, lo = 300, hi = 6000, len = Math.round(SR * 0.04)) => {
  let best = 0
  let bestF = 0
  const n = Math.min(len, x.length)
  for (let f = lo; f <= hi; f += 10) {
    let re = 0
    let im = 0
    const w = (2 * Math.PI * f) / SR
    for (let i = 0; i < n; i++) {
      const h = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n)
      re += x[i] * h * Math.cos(w * i)
      im -= x[i] * h * Math.sin(w * i)
    }
    const p = re * re + im * im
    if (p > best) {
      best = p
      bestF = f
    }
  }
  return bestF
}
const peakAbs = (x) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
// ms from the peak until the envelope stays under -20 dB
const decay20 = (x) => {
  const pk = peakAbs(x)
  let i0 = x.findIndex((v) => Math.abs(v) === pk)
  let last = i0
  for (let i = i0; i < x.length; i++) if (Math.abs(x[i]) > pk * 0.1) last = i
  return ((last - i0) / SR) * 1000
}
const render = (v, seed = 3) => renderVoice(v, SR, rng(seed))

test("sound: a paddle hit rings at the paddle's membrane mode (980-1477 Hz) and dies in tens of ms", () => {
  for (const [design, core] of Object.entries(PADDLE_CORES)) {
    const x = render(hitVoice({ s: 0.6, design }, rng(9)))
    const f = peakHz(x, 600, 3000)
    assert.ok(Math.abs(f - core.f) < core.f * 0.05, `${design}: peak ${f} vs ${core.f}`)
    assert.ok(f >= 980 * 0.97 && f <= 1477 * 1.03, `${design}: ${f} outside the measured range`)
  }
  const x = render(hitVoice({ s: 0.6 }, rng(2)))
  const d = decay20(x)
  assert.ok(d < 25 && d > 1, `-20 dB after ${d.toFixed(1)} ms (research: 1-2 ms onset, 10-20 ms tail)`)
  assert.ok(x.length / SR <= 0.08, "short")
})

test("sound: shots differ like the real thing (dink soft, drive louder, smash loudest; off-center lower and duller)", () => {
  const level = (o) => peakAbs(render(hitVoice(o, rng(4)), 4))
  const dink = level({ s: keyStrength("hit", strengthOf({ paddle: 2.5, speed: 5 })), family: shotFamily("dink") })
  const drive = level({ s: keyStrength("hit", strengthOf({ paddle: 10, speed: 14 })), family: shotFamily("drive") })
  const smash = level({ s: keyStrength("hit", strengthOf({ paddle: 15, speed: 22 })), family: shotFamily("smash") })
  assert.ok(drive > dink * 1.8, `drive ${drive} vs dink ${dink}`)
  assert.ok(smash > drive * 1.3, `smash ${smash} vs drive ${drive}`)
  assert.ok(smash <= 1, "never clips")
  assert.equal(shotFamily("dink"), "soft")
  assert.equal(shotFamily("dink", true), "block")
  assert.equal(shotFamily("drive", true), "volley")
  assert.equal(shotFamily("punch"), "volley")
  assert.equal(contactOf("perfect"), "sweet")
  assert.equal(contactOf("late"), "off")
  assert.equal(contactOf("very early"), "edge")
  assert.equal(contactOf("good"), "normal")
  const fSweet = peakHz(render(hitVoice({ s: 0.6, contact: "sweet" }, rng(5))), 600, 3000)
  const fEdge = peakHz(render(hitVoice({ s: 0.6, contact: "edge" }, rng(5))), 600, 3000)
  assert.ok(fEdge < fSweet, `edge ${fEdge} < sweet ${fSweet}`)
})

test("sound: the bounce is a duller, lower tock (~730 Hz) and quieter than a hit", () => {
  const b = render(bounceVoice({ s: 0.5 }, rng(6)))
  const f = peakHz(b, 300, 3000)
  assert.ok(f > 600 && f < 900, `bounce peak ${f}`)
  const h = render(hitVoice({ s: 0.5 }, rng(6)))
  assert.ok(peakHz(h, 300, 3000) > f + 300, "the hit is higher")
  assert.ok(peakAbs(b) < peakAbs(h), "the bounce is quieter")
})

test("sound: net, tape, fence and paddle taps", () => {
  const net = render(netVoice({ s: 0.5 }, rng(7)))
  const tape = render(netVoice({ s: 0.5, tape: true }, rng(7)))
  assert.ok(net.length / SR > 0.15, "the net's rattle lasts")
  assert.ok(peakHz(net, 100, 4000) < 900, `the net is a low thud (${peakHz(net, 100, 4000)})`)
  assert.ok(peakAbs(tape) > peakAbs(net), "the tape is a sharper tick")
  const fence = render(fenceVoice({ s: 0.6 }, rng(8)))
  assert.ok(fence.length / SR >= 0.35 && decay20(fence) > 30, "the fence rings")
  const tap = render(tapVoice({}, rng(8)))
  assert.ok(peakAbs(tap) < peakAbs(render(hitVoice({ s: 0.1, family: "soft" }, rng(8)))), "a tap is softer than a dink")
})

test("sound: cached by what the ear hears; same key + seed = same samples", () => {
  const a = voiceFor("hit", { s: 0.61, family: "drive", design: "solid" })
  const b = voiceFor("hit", { s: 0.64, family: "drive", design: "solid" })
  assert.equal(a.key, b.key, "close strengths share renders")
  assert.notEqual(a.key, voiceFor("hit", { s: 0.9, family: "drive", design: "solid" }).key)
  assert.notEqual(a.key, voiceFor("hit", { s: 0.61, family: "drive", design: "flame" }).key)
  assert.deepEqual(render(a.make(rng(1)), 1), render(b.make(rng(1)), 1))
  assert.equal(voiceKey("net", { tape: true }), "net|1|2")
  // fast enough to render on demand (a variation per first use)
  const t0 = performance.now()
  for (let i = 0; i < 50; i++) render(hitVoice({ s: i / 50 }, rng(i)), i)
  assert.ok((performance.now() - t0) / 50 < 4, "under 4 ms a render")
})

test("sound: distance and room", () => {
  const near = distanceMix({ dist: 1 })
  const far = distanceMix({ dist: 14, side: 1 })
  assert.equal(near.gain, 1)
  assert.ok(far.gain < 0.6 && far.gain > 0.35, `far ${far.gain}`)
  assert.ok(far.cutoff < near.cutoff, "farther: a little duller")
  assert.ok(far.pan > 0 && Math.abs(near.pan) < 1e-9)
  assert.ok(roomFor("stadium").wet > roomFor("park").wet && roomFor("stadium").len > roomFor("park").len)
  assert.equal(roomFor("nowhere"), roomFor("park"))
  assert.ok(CAL.hitGain > 0 && CAL.bounceGain > 0)
})
