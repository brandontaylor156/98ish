// Pickleball 98: the MakeHuman body builder's pure math (tools/mh-core.mjs): files, macro
// targets, proxy fitting and weights, the rest-pose turns, bone frames. Also the clothes'
// clean edges (outfit.js clipBody).
import test from "node:test"
import assert from "node:assert/strict"
import { applyTarget, boneFrame, fitVerts, macroTargets, parseFitting, parseObj, parseTarget, qFromTo, qRotate, rotateAbout, transferWeights } from "./tools/mh-core.mjs"
import { clipBody, covers, landmarks, prepareBody } from "./outfit.js"

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps

test("MakeHuman files: OBJ groups and faces, targets, fittings (vertex lines after other keywords)", () => {
  const obj = parseObj("v 0 0 0\nv 1 0 0\nv 0 1 0\nv 1 1 0\nvt 0 0\nvt 1 0\ng body\nf 1/1 2/2 4/2 3/1\ng helper\nf 1 2 3\n")
  assert.equal(obj.v.length, 12)
  assert.equal(obj.faces.length, 2)
  assert.deepEqual(obj.faces[0], { group: "body", v: [0, 1, 3, 2], t: [0, 1, 1, 0] })
  assert.deepEqual(obj.faces[1].t, [-1, -1, -1])
  const t = parseTarget("# comment\n1 .5 -.25 0\n3 0 1 0\n")
  const pos = new Float64Array(12)
  applyTarget(pos, t, 2)
  assert.deepEqual(Array.from(pos.slice(3, 6)), [1, -0.5, 0])
  assert.deepEqual(Array.from(pos.slice(9, 12)), [0, 2, 0])
  // (long01.mhclo: "verts 0" then "material ...", then the vertex lines; delete_verts ends them)
  const fit = parseFitting("name x\nx_scale 0 1 2.0\nverts 0\nmaterial x.mhmat\n0 1 2 0.5 0.25 0.25 0.1 0 0\n3\ndelete_verts\n5 6 7\n")
  assert.equal(fit.refs.length, 2)
  assert.deepEqual(fit.refs[1].i, [3, 3, 3])
  assert.equal(fit.scale.x.d, 2)
})

test("macro targets: a young man mixes the races, his muscle and weight, proportions and height", () => {
  const ts = macroTargets({ gender: 1, muscle: 0.7, weight: 0.5, proportions: 0.8, height: 0.5 })
  const w = Object.fromEntries(ts.map((t) => [t.file, t.w]))
  assert.ok(near(w["caucasian-male-young"], 1 / 3) && near(w["african-male-young"], 1 / 3))
  assert.ok(near(w["universal-male-young-averagemuscle-averageweight"], 0.6, 1e-9))
  assert.ok(near(w["universal-male-young-maxmuscle-averageweight"], 0.4, 1e-9))
  assert.ok(near(w["proportions/male-young-maxmuscle-averageweight-idealproportions"], 0.4 * 0.6, 1e-9))
  assert.ok(!ts.some((t) => t.file.includes("female")))
  assert.ok(!ts.some((t) => t.file.startsWith("height/")))
  // a woman a little taller than average: the height targets in, with the same split
  const f = macroTargets({ gender: 0, muscle: 0.5, weight: 0.4, height: 0.6 })
  const h = f.filter((t) => t.file.startsWith("height/"))
  assert.ok(h.every((t) => t.file.endsWith("-maxheight")))
  assert.ok(near(h.reduce((s, t) => s + t.w, 0), 0.2, 1e-9))
})

test("fitting: barycentric references plus offsets scaled by the body's size; weights follow", () => {
  // base: a unit right triangle and a scale pair 2 apart on x
  const base = Float64Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 4, 0, 0])
  const fit = parseFitting("x_scale 0 3 2.0\ny_scale 0 2 1.0\nz_scale 0 1 1.0\nverts 0\n0 1 2 0.25 0.25 0.5 0.5 0 0\n")
  const p = fitVerts(fit, base)
  // 0.25*(1,0,0) + 0.5*(0,1,0) + offset 0.5 * (4/2)
  assert.deepEqual(Array.from(p), [0.25 + 1, 0.5, 0])
  const weights = new Map([
    [0, [["a", 1]]],
    [1, [["a", 0.5], ["b", 0.5]]],
    [2, [["c", 1]]],
  ])
  const [w] = transferWeights(fit, weights)
  const m = Object.fromEntries(w)
  assert.ok(near(m.a, 0.375) && near(m.b, 0.125) && near(m.c, 0.5))
  assert.ok(near(w.reduce((s, [, x]) => s + x, 0), 1))
})

test("rest pose turns and bone frames: an A-pose arm goes straight out, frames are right-handed", () => {
  const sh = [0.17, 1.4, 0]
  const el = [0.35, 1.2, 0.02]
  const q = qFromTo([el[0] - sh[0], el[1] - sh[1], el[2] - sh[2]], [1, 0, 0])
  const e2 = rotateAbout(q, sh, el)
  assert.ok(near(e2[1], sh[1], 1e-9) && near(e2[2], sh[2], 1e-9) && e2[0] > sh[0])
  assert.ok(near(Math.hypot(e2[0] - sh[0], e2[1] - sh[1], e2[2] - sh[2]), Math.hypot(el[0] - sh[0], el[1] - sh[1], el[2] - sh[2]), 1e-9))
  // (opposite directions: a half turn)
  const h = qRotate(qFromTo([0, 1, 0], [0, -1, 0]), [0, 1, 0])
  assert.ok(near(h[1], -1, 1e-9))
  const f = boneFrame([1, 0, 0], [0, -1, 0])
  assert.deepEqual(f.y, [1, 0, 0])
  assert.deepEqual(f.x.map((x) => Math.round(x)), [0, -1, 0])
  const z = [f.x[1] * f.y[2] - f.x[2] * f.y[1], f.x[2] * f.y[0] - f.x[0] * f.y[2], f.x[0] * f.y[1] - f.x[1] * f.y[0]]
  assert.deepEqual(z.map((x) => Math.round(x * 1e6) / 1e6), f.z.map((x) => Math.round(x * 1e6) / 1e6))
})

test("clothes: a garment's edge cuts the body's triangles, so a hem is straight on any mesh", () => {
  // a strip of skewed triangles (a coarse, irregular mesh) up a "thigh" at x = 0.12
  const pos = []
  const idx = []
  const rows = 12
  for (let r = 0; r <= rows; r++) {
    const y = 0.3 + r * 0.05
    for (let c = 0; c < 3; c++) pos.push(0.1 + c * 0.02 + (r % 2) * 0.01, y + (c === 1 ? 0.017 : 0), 0.02 * c)
  }
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < 2; c++) {
      const a = r * 3 + c
      idx.push(a, a + 1, a + 4, a, a + 4, a + 3)
    }
  const n = pos.length / 3
  const bones = ["pelvis", "thigh_l"]
  const body = prepareBody({ position: Float32Array.from(pos), skinIndex: new Uint16Array(n * 4).fill(1), skinWeight: Float32Array.from({ length: n * 4 }, (_, i) => (i % 4 === 0 ? 1 : 0)), index: Uint32Array.from(idx), bones })
  const joints = { thigh_l: { x: 0.1, y: 0.9, z: 0 }, thigh_r: { x: -0.1, y: 0.9, z: 0 }, calf_l: { x: 0.1, y: 0.5, z: 0 }, calf_r: { x: -0.1, y: 0.5, z: 0 }, foot_l: { x: 0.1, y: 0.08, z: 0 }, foot_r: { x: -0.1, y: 0.08, z: 0 }, upperarm_l: { x: 0.2, y: 1.4, z: 0 }, upperarm_r: { x: -0.2, y: 1.4, z: 0 }, neck_01: { x: 0, y: 1.5, z: 0 }, Head: { x: 0, y: 1.6, z: 0 }, pelvis: { x: 0, y: 0.95, z: 0 } }
  const m = landmarks(joints, 0)
  const low = m.kneeY + 0.14 // where shorts end
  const cut = clipBody("shorts", body, m)
  // every covered vertex is inside; the cut's new vertices lie on the hem, within a millimeter
  let onHem = 0
  for (let i = n; i < cut.position.length / 3; i++) {
    assert.ok(Math.abs(cut.position[i * 3 + 1] - low) < 0.001, `hem vertex at ${cut.position[i * 3 + 1]}`)
    onHem++
  }
  assert.ok(onHem >= 3)
  for (let t = 0; t < cut.index.length; t += 3)
    for (let k = 0; k < 3; k++) {
      const v = cut.index[t + k]
      assert.ok(cut.position[v * 3 + 1] >= low - 0.001)
      assert.ok(covers("shorts", { x: cut.position[v * 3], y: cut.position[v * 3 + 1] + 0.0011, z: cut.position[v * 3 + 2], bone: cut.dominant[v] }, m))
    }
  // weights stay normalized
  for (let i = 0; i < cut.skinWeight.length; i += 4) assert.ok(near(cut.skinWeight[i] + cut.skinWeight[i + 1] + cut.skinWeight[i + 2] + cut.skinWeight[i + 3], 1, 1e-6))
})
