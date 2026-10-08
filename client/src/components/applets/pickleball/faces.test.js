// Pickleball 98, players v3 (docs/players-v3.md): the photo faces. The builder's math
// (tools/players/faces.mjs: closest points, the similarity and thin-plate fits, the non-rigid
// fit, landmarks, island growing), the shape files' format (faceshape.js), the face list the
// Locker Room offers and the server accepts, and the shipped assets (faces.json and its files,
// within their budgets).
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { closestOnTriangle, faceLandmarks, faceWeight, fitSurface, grow, photoWeight, similarity, thinPlate, triangleGrid, weld, weldedMesh, classifyTargets } from "./tools/players/faces.mjs"
import { parseFaceShape } from "./faceshape.js"
import { FACE_LIST } from "./faceList.js"
import { FACES, LOOK_IDS, characterLook, validateLook } from "./locker.js"
import { CHARACTERS } from "./looks.js"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ASSETS = path.join(HERE, "../../../../public/assets/pickleball")
const near = (a, b, eps = 1e-6) => a.every((x, i) => Math.abs(x - b[i]) < eps)

// a unit-ish UV sphere (radius r, center c) as a triangle mesh
const sphere = (r = 1, c = [0, 0, 0], nu = 24, nv = 16) => {
  const pos = []
  const index = []
  for (let j = 0; j <= nv; j++)
    for (let i = 0; i <= nu; i++) {
      const th = (j / nv) * Math.PI
      const ph = (i / nu) * Math.PI * 2
      pos.push(c[0] + r * Math.sin(th) * Math.cos(ph), c[1] + r * Math.cos(th), c[2] + r * Math.sin(th) * Math.sin(ph))
    }
  for (let j = 0; j < nv; j++)
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i
      const b = a + nu + 1
      index.push(a, b, a + 1, a + 1, b, b + 1)
    }
  return { pos: Float64Array.from(pos), index: Uint32Array.from(index) }
}

test("faces math: closest point on a triangle (inside, on an edge, at a corner)", () => {
  const A = [0, 0, 0]
  const B = [1, 0, 0]
  const C = [0, 1, 0]
  const at = (w) => [0, 1, 2].map((k) => A[k] * w[0] + B[k] * w[1] + C[k] * w[2])
  assert.ok(near(at(closestOnTriangle([0.2, 0.2, 5], A, B, C)), [0.2, 0.2, 0]))
  assert.ok(near(at(closestOnTriangle([0.5, -3, 0], A, B, C)), [0.5, 0, 0]))
  assert.ok(near(at(closestOnTriangle([-1, -1, 1], A, B, C)), [0, 0, 0]))
  assert.ok(near(at(closestOnTriangle([2, 2, 0], A, B, C)), [0.5, 0.5, 0]))
})

test("faces math: a grid finds the same closest point as brute force", () => {
  const s = sphere(0.1, [0, 1.6, 0])
  const g = triangleGrid(s.pos, s.index, null, 0.01)
  let worst = 0
  for (let k = 0; k < 40; k++) {
    const p = [Math.sin(k) * 0.13, 1.6 + Math.cos(k * 1.3) * 0.13, Math.sin(k * 0.7) * 0.12]
    const h = g.query(p, 0.2)
    // brute force
    let best = Infinity
    for (let t = 0; t < s.index.length; t += 3) {
      const P = (i) => [s.pos[i * 3], s.pos[i * 3 + 1], s.pos[i * 3 + 2]]
      const [a, b, c] = [P(s.index[t]), P(s.index[t + 1]), P(s.index[t + 2])]
      const w = closestOnTriangle(p, a, b, c)
      const q = [0, 1, 2].map((i) => a[i] * w[0] + b[i] * w[1] + c[i] * w[2])
      best = Math.min(best, Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]))
    }
    worst = Math.max(worst, Math.abs(Math.sqrt(h.d2) - best))
  }
  assert.ok(worst < 1e-9, `grid vs brute force ${worst}`)
})

test("faces math: the similarity fit recovers a scale, turn and shift; the thin-plate spline meets its landmarks", () => {
  const src = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0.5]]
  const c = Math.cos(0.4)
  const s = Math.sin(0.4)
  const dst = src.map(([x, y, z]) => [1.3 * (c * x + s * z) + 0.2, 1.3 * y - 0.5, 1.3 * (-s * x + c * z) + 2])
  const T = similarity(src, dst)
  assert.ok(Math.abs(T.s - 1.3) < 1e-6)
  for (let i = 0; i < src.length; i++) assert.ok(near(T.apply(src[i]), dst[i], 1e-6))
  const moved = src.map((p, i) => [p[0] + 0.01 * i, p[1] - 0.02 * (i % 2), p[2] + 0.005])
  const tps = thinPlate(src, moved)
  for (let i = 0; i < src.length; i++) assert.ok(near(tps(src[i]), moved[i], 1e-6))
})

test("faces math: welding joins seam duplicates; the non-rigid fit pulls a sphere onto a bigger one, never past maxShift", () => {
  const w = weld(Float64Array.from([0, 0, 0, 1, 0, 0, 0, 0, 0]))
  assert.equal(w.count, 2)
  assert.equal(w.canon[0], w.canon[2])
  const small = sphere(0.1, [0, 0, 0])
  const big = sphere(0.104, [0, 0, 0], 40, 30)
  const W = weldedMesh(small.pos, small.index)
  const move = new Float64Array(W.count).fill(1)
  const out = fitSurface({ pos: W.pos, index: W.index, count: W.count }, move, triangleGrid(big.pos, big.index), { rounds: 10, maxR: 0.02, maxShift: 0.01 })
  let err = 0
  for (let i = 0; i < W.count; i++) err = Math.max(err, Math.abs(Math.hypot(out[i * 3], out[i * 3 + 1], out[i * 3 + 2]) - 0.104))
  assert.ok(err < 0.0015, `fit error ${err}`)
  const capped = fitSurface({ pos: W.pos, index: W.index, count: W.count }, move, triangleGrid(big.pos, big.index), { rounds: 10, maxR: 0.02, maxShift: 0.002 })
  for (let i = 0; i < W.count; i++) assert.ok(Math.hypot(capped[i * 3], capped[i * 3 + 1], capped[i * 3 + 2]) < 0.1 + 0.0021)
})

test("faces math: the face moves only in front (the cranium, ears and neck keep their shape); the photo reaches to the neck's base", () => {
  const mid = [0, 1.69, 0.13]
  assert.equal(faceWeight([0, 1.66, 0.2], mid), 1) // the nose
  assert.equal(faceWeight([0, 1.8, 0.05], mid), 0) // the crown
  assert.equal(faceWeight([0.08, 1.67, 0.03], mid), 0) // an ear
  assert.equal(faceWeight([0, 1.47, 0.1], mid), 0) // the neck
  assert.equal(photoWeight([0, 1.8, 0], mid), 1)
  assert.equal(photoWeight([0, 1.38, 0], mid), 0)
})

test("faces math: growing an image's islands fills the background next to them only", () => {
  const size = 8
  const img = new Uint8Array(size * size * 3)
  const mask = new Uint8Array(size * size)
  for (let y = 2; y < 4; y++) for (let x = 2; x < 4; x++) (mask[y * size + x] = 1), img.set([200, 100, 50], (y * size + x) * 3)
  grow(img, mask, size, 3, 1)
  assert.deepEqual([...img.slice((2 * size + 1) * 3, (2 * size + 1) * 3 + 3)], [200, 100, 50])
  assert.equal(img[(0 * size + 0) * 3], 0) // (two texels away: not yet)
})

test("faces: shape files parse; every face is on its own body with sane offsets", () => {
  const mf = JSON.parse(fs.readFileSync(path.join(ASSETS, "faces.json"), "utf8"))
  const ids = Object.keys(mf.faces)
  assert.ok(ids.length >= 4, "some faces")
  for (const id of ids) {
    const f = mf.faces[id]
    const buf = fs.readFileSync(path.join(ASSETS, f.shape))
    const s = parseFaceShape(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
    for (const lod of ["hi", "med"]) {
      const L = s.lods[lod]
      assert.ok(L.count > 500, `${id} ${lod} moves vertices`)
      let max = 0
      for (let i = 0; i < L.pos.length; i++) max = Math.max(max, Math.abs(L.pos[i] * s.unit))
      assert.ok(max < 0.035, `${id} ${lod}: a face moves under 3.5 cm (${max})`)
      assert.ok(L.lash.length === L.brows * 3)
    }
    for (const e of [s.eyes.l, s.eyes.r]) assert.ok(Math.hypot(...e) < 0.015, `${id} eyes move under 1.5 cm`)
    for (const k of ["med", "detail", "eye", "shape", "hair"]) assert.ok(fs.existsSync(path.join(ASSETS, f[k])), `${id} ${k}`)
    if (f.cards) {
      // the hair cards: a header, then positions, UVs and triangles that fit the file; on the head
      const b = fs.readFileSync(path.join(ASSETS, f.cards))
      const hl = b.readUInt32LE(0)
      const h = JSON.parse(b.subarray(4, 4 + hl).toString())
      assert.ok(h.verts > 50 && h.tris > 50, `${id} cards`)
      assert.ok(b.length >= 4 + hl + h.verts * 20 + h.tris * 6, `${id} cards size`)
      const pos = new Float32Array(b.buffer.slice(b.byteOffset + 4 + hl, b.byteOffset + 4 + hl + h.verts * 12))
      let minY = Infinity
      for (let i = 1; i < pos.length; i += 3) minY = Math.min(minY, pos[i])
      assert.ok(minY > 1.2, `${id} cards sit on the head (lowest ${minY})`)
      assert.ok(fs.existsSync(path.join(ASSETS, f.cardsTex)))
    }
    // download budgets: what Medium fetches for a face (KTX2 or the JPEG, eye, hair mask, shape),
    // and High's extra (the 2048 KTX2 and the detail map)
    const size = (k) => (f[k] ? fs.statSync(path.join(ASSETS, f[k])).size : 0)
    const med = (f.medKtx ? size("medKtx") : size("med")) + size("eye") + size("hair") + size("shape")
    assert.ok(med < 420e3, `${id}: Medium downloads ${med} bytes`)
    assert.ok(size("hi") + size("detail") < 750e3, `${id}: High's extra ${size("hi") + size("detail")} bytes`)
  }
})

test("faces: the Locker Room's list matches faces.json; the server takes the same ids; roster looks keep their faces", () => {
  const mf = JSON.parse(fs.readFileSync(path.join(ASSETS, "faces.json"), "utf8"))
  assert.deepEqual(FACE_LIST.map((f) => f.id).sort(), Object.keys(mf.faces).sort())
  for (const f of FACE_LIST) assert.equal(f.body, mf.faces[f.id].body)
  assert.deepEqual(LOOK_IDS.face, FACES.map((f) => f.id))
  const require = createRequire(import.meta.url)
  const server = require("../../../../../server/arcade/games/pickleballLooks.js")
  assert.deepEqual(server.LOOK_IDS.face, LOOK_IDS.face)
  for (const c of CHARACTERS) {
    const look = characterLook(c.id)
    const f = FACES.find((x) => x.id === look.face)
    assert.ok(f, `${c.id} has a face`)
    assert.ok(!f.body || f.body === look.body, `${c.id}'s face is for its body`)
  }
  // a face from the other body is replaced by one of this body's
  const moved = validateLook({ ...characterLook(CHARACTERS[0].id), body: CHARACTERS[0].look.body === "m" ? "f" : "m" })
  assert.ok(FACES.find((x) => x.id === moved.face && (!x.body || x.body === moved.body)))
})
