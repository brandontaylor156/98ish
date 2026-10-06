import test from "node:test"
import assert from "node:assert/strict"
import { similarity, apply, rotate, courtCorners, upAxis, COURT_W, COURT_L } from "./align.js"
import { detectFormat, checkSize, centersFromSplat, parsePlyHeader, centersFromPly, pointsToSplat, MAX_BYTES, MAX_SYNCED_BYTES } from "./files.js"
import { synthBackdrop } from "./synth.js"
import { nextBackdrops } from "./store.js"

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`)

test("similarity recovers a known scale, rotation and translation from 4 corners", () => {
  // a splat captured upside down (y down), 0.37x scale, turned 1.1 rad, offset
  const half = Math.sin(0.55)
  const yaw = [0, half, 0, Math.cos(0.55)]
  const flip = [1, 0, 0, 0] // 180 deg about x
  const mul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]]
  const truth = { s: 0.37, q: mul(yaw, flip), t: [12, 0.4, -7] }
  const dst = courtCorners({ x: 3, z: -4, rot: 0.3 })
  // src = inverse(truth) applied to dst
  const inv = (p) => {
    const d = [(p[0] - truth.t[0]) / truth.s, (p[1] - truth.t[1]) / truth.s, (p[2] - truth.t[2]) / truth.s]
    return rotate([-truth.q[0], -truth.q[1], -truth.q[2], truth.q[3]], d)
  }
  const src = dst.map(inv)
  const T = similarity(src, dst)
  near(T.s, 0.37, 1e-6)
  assert.ok(T.rms < 1e-6)
  for (let i = 0; i < 4; i++) {
    const p = apply(T, src[i])
    for (let k = 0; k < 3; k++) near(p[k], dst[i][k], 1e-5)
  }
})

test("similarity tolerates tap noise (a few cm) with a sensible residual", () => {
  const dst = courtCorners({ x: 0, z: 0, rot: 0 })
  const src = dst.map(([x, y, z], i) => [x * 2 + (i % 2 ? 0.03 : -0.02), y + 0.01 * i, z * 2])
  const T = similarity(src, dst)
  near(T.s, 0.5, 0.01)
  assert.ok(T.rms < 0.05)
})

test("court corners are the regulation size", () => {
  const c = courtCorners({ x: 0, z: 0, rot: 0 })
  near(Math.hypot(c[1][0] - c[0][0], c[1][2] - c[0][2]), COURT_W)
  near(Math.hypot(c[2][0] - c[1][0], c[2][2] - c[1][2]), COURT_L)
})

test("formats, caps and centers", () => {
  const splat = synthBackdrop({ count: 2000 })
  assert.equal(splat.length, 2000 * 32)
  assert.equal(detectFormat(splat, "x.splat"), "splat")
  assert.equal(detectFormat(new Uint8Array([0x1f, 0x8b, 8, 0]), "a.spz"), "spz")
  assert.equal(detectFormat(new Uint8Array([0x50, 0x4b, 3, 4]), "a.sog"), "sog")
  assert.equal(detectFormat(new TextEncoder().encode("ply\nformat binary_little_endian 1.0\n"), "a.ply"), "ply")
  assert.equal(checkSize({ byteLength: MAX_SYNCED_BYTES }).synced, true)
  assert.equal(checkSize({ byteLength: MAX_SYNCED_BYTES + 1 }).synced, false)
  assert.equal(checkSize({ byteLength: MAX_BYTES + 1 }).ok, false)
  const c = centersFromSplat(splat)
  assert.equal(c.length, 2000 * 3)
  assert.ok(c.every(Number.isFinite))
  // the backdrop is a flat-ish ring: "up" comes out as y
  const { up } = upAxis(c)
  assert.ok(Math.abs(up[1]) > 0.9, `up ${up}`)
})

test("a binary .ply point cloud reads back its centers", () => {
  const n = 3
  const header = `ply\nformat binary_little_endian 1.0\nelement vertex ${n}\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n`
  const hb = new TextEncoder().encode(header)
  const stride = 15
  const out = new Uint8Array(hb.length + n * stride)
  out.set(hb)
  const dv = new DataView(out.buffer)
  for (let i = 0; i < n; i++) {
    dv.setFloat32(hb.length + i * stride, i, true)
    dv.setFloat32(hb.length + i * stride + 4, i * 2, true)
    dv.setFloat32(hb.length + i * stride + 8, i * 3, true)
  }
  const h = parsePlyHeader(out)
  assert.equal(h.count, 3)
  assert.equal(h.stride, 15)
  const c = centersFromPly(out)
  assert.deepEqual([...c], [0, 0, 0, 1, 2, 3, 2, 4, 6])
})

test("points become splats; the per-person cap keeps the newest backdrops", () => {
  const s = pointsToSplat(new Float32Array([0, 0, 0, 1, 1, 1]), new Uint8Array([255, 0, 0, 0, 255, 0]))
  assert.equal(s.length, 64)
  assert.equal(s[24], 255)
  const list = [
    { venue: "a", at: 1 },
    { venue: "b", at: 2 },
    { venue: "c", at: 3 },
  ]
  const { keep, drop } = nextBackdrops(list, { venue: "d", at: 4 })
  assert.deepEqual(keep.map((b) => b.venue), ["d", "c", "b"])
  assert.deepEqual(drop.map((b) => b.venue), ["a"])
  // replacing the same venue doesn't drop another
  const again = nextBackdrops(list, { venue: "b", at: 5 })
  assert.deepEqual(again.keep.map((b) => b.venue).sort(), ["a", "b", "c"])
  assert.deepEqual(again.drop.map((b) => b.venue), ["b"])
})
