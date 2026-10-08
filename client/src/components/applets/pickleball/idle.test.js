// Pickleball 98: standing like an athlete (idle.js) and the athletic bodies' pure helpers:
// the weight shifts, the ready bounce and the breathing; the builder's normal-map and
// expression math (tools/mh-core.mjs); the clothes' drape and creases (outfit.js); the motion
// matching's standing idles (they play, they don't freeze).
import test from "node:test"
import assert from "node:assert/strict"
import { IDLE, createIdle, stepIdle } from "./idle.js"
import { dilate, encodeTangentNormal, expressionDelta, highpass, neighbors, rasterUV, triTangents, vertexNormals } from "./tools/mh-core.mjs"
import { buildSkirt, creases, drape } from "./outfit.js"
import fs from "node:fs"
import zlib from "node:zlib"
import { fileURLToPath } from "node:url"
import { buildLibrary } from "./mm/library.js"
import { setMotionLibrary } from "./mm/runtime.js"
import { createAnim, updateAnim } from "./anim.js"
import { poseMetrics } from "./studio.js"

const lib = (() => {
  const dir = fileURLToPath(new URL("../../../../public/assets/pickleball/", import.meta.url))
  if (!fs.existsSync(dir + "motion.bin")) return null
  return buildLibrary(JSON.parse(fs.readFileSync(dir + "motion.json", "utf8")), new Uint8Array(zlib.gunzipSync(fs.readFileSync(dir + "motion.bin"))))
})()

test("motion matching: standing between points, the captured idle plays (never frozen), knees soft not bent", { skip: !lib }, () => {
  setMotionLibrary(lib)
  for (const between of [true, false]) {
    const a = createAnim(0, -2.2, 0)
    a.useMM = true
    const head = []
    const knees = []
    let jumps = 0
    let lastV = null
    for (let i = 0; i < 480; i++) {
      const pose = updateAnim(a, { x: 0, z: -2.2, vx: 0, vz: 0, facing: 0, ball: { x: 0.4, y: 0.9, z: 2.3 }, holding: false, swing: null, prep: null, charging: false, between, atNet: !between, hand: 1, twoHand: false }, 1 / 60)
      if (i > 60) {
        head.push(pose.head)
        const m = poseMetrics(pose)
        knees.push((m.kneeL + m.kneeR) / 2)
        if (lastV !== null && a.mm.v !== lastV + 1 && a.mm.v !== lastV) jumps++
      }
      lastV = a.mm.v
    }
    const span = (k) => Math.max(...head.map((h) => h[k])) - Math.min(...head.map((h) => h[k]))
    // the head moves a few centimeters over 7 s (sway, weight shifts, breathing), no more
    assert.ok(span("x") > 0.02 && span("x") < 0.15, `head sways (${span("x").toFixed(3)} m)`)
    // the capture plays on: few jumps back to "the best standing frame"
    assert.ok(jumps <= 4, `idle plays on (${jumps} jumps in 7 s)`)
    const knee = knees.reduce((s, k) => s + k, 0) / knees.length
    if (between) assert.ok(knee < 30, `relaxed knees between points (${knee.toFixed(0)} deg)`)
    // (PPA footage: pros wait at the kitchen line with the knees softly bent, ~24 deg, on a wide base)
    else assert.ok(knee > 15 && knee < 45, `athletic knees in the ready position (${knee.toFixed(0)} deg)`)
  }
})

const run = (st, opts, secs, dt = 1 / 60) => {
  const out = []
  for (let t = 0; t < secs; t += dt) out.push(stepIdle(st, opts, dt))
  return out
}
const range = (a) => Math.max(...a) - Math.min(...a)

test("idle: between points the weight goes from leg to leg every few seconds, never frozen", () => {
  const st = createIdle(3.7)
  const f = run(st, { between: true, still: 1 }, 30)
  const shifts = f.map((x) => x.shift)
  // over to each side, about as far as the spec says, and back
  assert.ok(Math.max(...shifts) > IDLE.between.shift * 0.7, "goes over to one side")
  assert.ok(Math.min(...shifts) < -IDLE.between.shift * 0.7, "and the other")
  assert.ok(Math.max(...shifts.map(Math.abs)) <= IDLE.between.shift * 1.05, "never further")
  // a few changes in 30 s, not a constant wobble
  let flips = 0
  for (let i = 1; i < shifts.length; i++) if (Math.sign(shifts[i]) !== Math.sign(shifts[i - 1])) flips++
  assert.ok(flips >= 3 && flips <= 14, `weight changes sides now and then (${flips})`)
  // the hips tilt with it (the unloaded side drops)
  const k = shifts.findIndex((s) => Math.abs(s) > IDLE.between.shift * 0.8)
  assert.ok(Math.sign(f[k].roll) === Math.sign(f[k].shift))
  // smooth: no jumps between frames
  for (let i = 1; i < shifts.length; i++) assert.ok(Math.abs(shifts[i] - shifts[i - 1]) < 0.003)
  // no bounce between points, only the breath's few millimeters
  assert.ok(range(f.map((x) => x.bob)) < 0.006)
})

test("idle: ready in a rally, a light uneven bounce; nothing at all while moving", () => {
  const st = createIdle(1.3)
  const f = run(st, { between: false, still: 1 }, 6)
  const bob = f.map((x) => x.bob)
  assert.ok(range(bob) > IDLE.ready.bob * 0.8 && Math.max(...bob) <= IDLE.ready.bob + 1e-9, "bounces about a centimeter")
  // about 1.7 bounces a second
  let peaks = 0
  for (let i = 1; i < bob.length - 1; i++) if (bob[i] > bob[i - 1] && bob[i] >= bob[i + 1] && bob[i] > IDLE.ready.bob * 0.5) peaks++
  assert.ok(peaks >= 7 && peaks <= 14, `bounces ${peaks} times in 6 s`)
  const moving = run(createIdle(1.3), { between: false, still: 0 }, 6)
  assert.ok(Math.max(...moving.map((x) => Math.abs(x.bob) + Math.abs(x.shift))) < 1e-6)
})

test("idle: breathing gets faster and deeper after running, then settles", () => {
  const st = createIdle(2)
  run(st, { between: true, still: 1, run: 0 }, 5)
  const restDepth = stepIdle(st, { between: true, still: 1 }, 1 / 60).depth
  run(st, { between: false, still: 0, run: 1 }, 6)
  const hard = stepIdle(st, { between: true, still: 1, run: 0 }, 1 / 60)
  assert.ok(hard.depth > restDepth + 0.3, "deeper after a run")
  const ph0 = st.breathPh
  stepIdle(st, { between: true, still: 1 }, 1)
  const fast = st.breathPh - ph0
  run(st, { between: true, still: 1, run: 0 }, 40)
  const ph1 = st.breathPh
  stepIdle(st, { between: true, still: 1 }, 1)
  assert.ok(fast > (st.breathPh - ph1) * 1.4, "faster after a run than once settled")
  // the same seed, the same idle (replays, tests)
  const a = run(createIdle(9), { between: true, still: 1 }, 3).map((x) => x.shift)
  const b = run(createIdle(9), { between: true, still: 1 }, 3).map((x) => x.shift)
  assert.deepEqual(a, b)
})

test("builder: normal map math (tangents, encoding, raster, dilate, sharpening)", () => {
  // a flat square in the xz plane facing +y, u along +x, v along +z
  const t = triTangents([0, 0, 0], [1, 0, 0], [0, 0, 1], [0, 0], [1, 0], [0, 1])
  assert.deepEqual(t.T, [1, 0, 0])
  assert.deepEqual(t.B, [0, 0, 1])
  const n = [0, 1, 0]
  // the same normal: flat (128, 128, 255)
  assert.deepEqual(encodeTangentNormal(n, n, t.T, t.B), [128, 128, 255])
  // tipped toward +u: red up; toward +v (down the image): green down
  const du = encodeTangentNormal([Math.sin(0.3), Math.cos(0.3), 0], n, t.T, t.B)
  assert.ok(du[0] > 160 && Math.abs(du[1] - 128) <= 1)
  const dv = encodeTangentNormal([0, Math.cos(0.3), Math.sin(0.3)], n, t.T, t.B)
  assert.ok(dv[1] < 100 && Math.abs(dv[0] - 128) <= 1)
  // rasterizing two triangles covers the square
  const size = 16
  const seen = new Uint8Array(size * size)
  rasterUV(size, [[0, 1, 2], [1, 3, 2]], [0, 0, 1, 0, 0, 1, 1, 1], (ti, b0, b1, b2, x, y) => {
    assert.ok(Math.abs(b0 + b1 + b2 - 1) < 1e-9)
    seen[y * size + x]++
  })
  // (every texel; those on the shared edge may be written by both, harmless)
  assert.ok(seen.every((c) => c >= 1) && seen.reduce((a, c) => a + c, 0) <= size * size + size)
  // dilation fills the gutter from written texels
  const img = new Uint8Array(4 * 4 * 3)
  const mask = new Uint8Array(16)
  img.set([200, 100, 50], 5 * 3)
  mask[5] = 1
  dilate(img, mask, 4, 3, 2)
  assert.deepEqual(Array.from(img.slice(6 * 3, 7 * 3)), [200, 100, 50])
  assert.ok(mask.filter(Boolean).length > 5)
  // sharpening pushes a bump further out, leaves a plane alone
  const grid = []
  for (let z = 0; z < 5; z++) for (let x = 0; x < 5; x++) grid.push(x, x === 2 && z === 2 ? 0.2 : 0, z)
  const faces = []
  for (let z = 0; z < 4; z++) for (let x = 0; x < 4; x++) faces.push({ v: [z * 5 + x, z * 5 + x + 1, (z + 1) * 5 + x + 1, (z + 1) * 5 + x] })
  const P = Float64Array.from(grid)
  const nb = neighbors(25, faces)
  const h = highpass(P, nb, { k: 1, iterations: 3 })
  assert.ok(h[12 * 3 + 1] > 0.2, "the bump stands out more")
  assert.ok(Math.abs(h[0 * 3 + 1]) < 0.05, "a corner far from it barely moves")
  const vn = vertexNormals(P, faces)
  assert.ok(Math.abs(Math.hypot(vn[0], vn[1], vn[2]) - 1) < 1e-9)
})

test("builder: an expression moves the fitted vertices by the targets' offsets (meters)", () => {
  // a fitting with one vertex on base vertex 1, one halfway between 0 and 2
  const fit = { scale: {}, refs: [{ i: [1, 1, 1], w: [1, 0, 0], o: [0, 0, 0] }, { i: [0, 2, 2], w: [0.5, 0.5, 0], o: [0, 0, 0] }] }
  const base = Float64Array.from([0, 0, 0, 1, 0, 0, 2, 0, 0])
  const target = { idx: Int32Array.from([1, 2]), d: Float64Array.from([0, 1, 0, 0, 0, 2]) }
  const d = expressionDelta(fit, base, [[target, 0.5]], 0.1)
  assert.deepEqual(Array.from(d).map((x) => Math.round(x * 1e6) / 1e6), [0, 0.05, 0, 0, 0, 0.05])
})

test("clothes: a top drapes over the hollows and never goes inside the body", () => {
  // a corrugated patch (ridges and grooves 2 cm deep) facing +y
  const N = 13
  const P = []
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) P.push(x * 0.02, 0.02 * Math.max(0, Math.sin(x * 1.3)), z * 0.02)
  const faces = []
  const tri = []
  for (let z = 0; z < N - 1; z++)
    for (let x = 0; x < N - 1; x++) {
      const a = z * N + x
      faces.push({ v: [a, a + N, a + N + 1, a + 1] })
      tri.push(a, a + N, a + N + 1, a, a + N + 1, a + 1)
    }
  const orig = Float64Array.from(P)
  const nb = neighbors(N * N, faces)
  const bnd = Array.from({ length: N * N }, (_, i) => (i % N === 0 || i % N === N - 1 || i < N || i >= N * (N - 1) ? [] : null))
  const bn = new Float64Array(N * N * 3)
  for (let i = 0; i < N * N; i++) bn[i * 3 + 1] = 1
  const gap = 0.01
  const cloth = drape(orig, nb, bnd, bn, () => gap, 30)
  let minGap = Infinity
  let groove = 0
  for (let i = 0; i < N * N; i++) {
    const d = cloth[i * 3 + 1] - orig[i * 3 + 1]
    minGap = Math.min(minGap, d)
    if (orig[i * 3 + 1] === 0 && i % N > 1 && i % N < N - 2 && Math.floor(i / N) > 1 && Math.floor(i / N) < N - 2) groove = Math.max(groove, d)
  }
  assert.ok(minGap >= gap - 1e-9, "the cloth stays at least the gap off the body")
  assert.ok(groove > gap + 0.004, "over a groove it bridges instead of dipping in")
  // creases: a dip is darker than a flat or a ridge
  const flat = new Float32Array(N * N * 3)
  for (let i = 0; i < N * N; i++) flat[i * 3 + 1] = 1
  const sh = creases(Float32Array.from(P), flat, tri)
  const valley = 4 * N + 5 // x = 5: sin(6.5) > 0 ... find a real valley: lowest point between ridges
  void valley
  const ys = Array.from({ length: N }, (_, x) => P[(4 * N + x) * 3 + 1])
  const vx = ys.findIndex((y, x) => x > 0 && x < N - 1 && y === 0 && (ys[x - 1] > 0 || ys[x + 1] > 0))
  const rx = ys.findIndex((y, x) => x > 0 && x < N - 1 && y > ys[x - 1] && y > ys[x + 1])
  assert.ok(sh[4 * N + vx] < sh[4 * N + rx], "a crease is darker than a ridge")
  assert.ok(Math.min(...sh) >= 0.6 && Math.max(...sh) <= 1)
})

test("clothes: a pleated skirt sways at the hem only, its pleats in the folds", () => {
  const m = { hipY: 0.95, cx: 0, cz: 0 }
  const g = buildSkirt(m, () => 0.16, { pelvis: 0, thigh_l: 1, thigh_r: 2 })
  const n = g.position.length / 3
  const rings = 8
  const per = n / rings
  // the waistband doesn't move; the hem fully
  for (let s = 0; s < per; s++) {
    assert.equal(g.sway[s], 0)
    assert.ok(Math.abs(g.sway[(rings - 1) * per + s] - 1) < 1e-9)
  }
  // the hem's radius goes in and out round the skirt (the pleats), the waist's doesn't
  const r = (i) => Math.hypot(g.position[i * 3], g.position[i * 3 + 2])
  const hem = Array.from({ length: per }, (_, s) => r((rings - 1) * per + s))
  const top = Array.from({ length: per }, (_, s) => r(s))
  assert.ok(range(hem) > 0.008 && range(top) < 1e-6)
  assert.ok(Math.min(...g.shade) < 0.85 && Math.max(...g.shade) === 1)
})
