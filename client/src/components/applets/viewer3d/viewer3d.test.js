import { test } from "node:test"
import assert from "node:assert/strict"
import { MAX_BYTES, MAX_MODELS, PET, fitScale, keepRatio, modelName, nextModels, petTarget, quotaWait, sniff, spaceError, stepPet, textureFor, validateModel } from "./core.js"

// a minimal valid GLB header (+ a JSON chunk) of a given total length
const glb = (length = 64, version = 2) => {
  const b = new Uint8Array(length)
  const dv = new DataView(b.buffer)
  dv.setUint32(0, 0x46546c67, true)
  dv.setUint32(4, version, true)
  dv.setUint32(8, length, true)
  return b
}
const text = (s) => new TextEncoder().encode(s)

test("sniffing and validating model files", () => {
  assert.equal(sniff(glb()), "glb")
  assert.equal(sniff(text('  {"asset":{"version":"2.0"}}')), "gltf")
  assert.equal(sniff(text("not a model")), null)
  assert.equal(sniff(new Uint8Array(4)), null)
  assert.deepEqual(validateModel(glb()), { ok: true, format: "glb" })
  assert.match(validateModel(new Uint8Array(0)).error, /empty/)
  assert.match(validateModel(glb(64, 1)).error, /old glTF version/)
  const short = glb(64)
  new DataView(short.buffer).setUint32(8, 999, true)
  assert.match(validateModel(short).error, /cut short/)
  assert.match(validateModel(text("hello world, not 3d")).error, /\.glb or \.gltf/)
  // .gltf: buffers must be inside
  assert.equal(validateModel(text('{"asset":{"version":"2.0"},"buffers":[{"uri":"data:application/octet-stream;base64,AAAA"}]}')).ok, true)
  assert.match(validateModel(text('{"asset":{"version":"2.0"},"buffers":[{"uri":"model.bin"}]}')).error, /single \.glb/)
  assert.match(validateModel(text('{"asset": oops')).error, /valid JSON/)
})

test("size caps: drive vs Messenger", () => {
  const big = glb(64)
  assert.equal(validateModel(big, { maxBytes: 32 }).ok, false)
  assert.match(validateModel(big, { maxBytes: 32 }).error, /limit is 0 MB|limit/)
  assert.equal(MAX_BYTES, 8 * 1024 * 1024)
})

test("simplify and texture budgets", () => {
  assert.equal(keepRatio(10_000, 30_000), 1)
  assert.equal(keepRatio(60_000, 30_000), 0.5)
  assert.equal(keepRatio(10_000_000, 30_000), 0.02, "never below 2%")
  assert.equal(textureFor(8 * 1024 * 1024, 2048), 2048)
  assert.ok(textureFor(2 * 1024 * 1024, 2048) <= 2048)
  assert.equal(textureFor(100_000, 2048), 512)
  assert.equal(textureFor(10_000, 2048), 256, "floor 256")
})

test("the model list keeps the newest MAX_MODELS", () => {
  const list = Array.from({ length: MAX_MODELS }, (_, i) => ({ name: `m${i}.glb`, at: i }))
  const { keep, drop } = nextModels(list, { name: "new.glb", at: 999 })
  assert.equal(keep.length, MAX_MODELS)
  assert.equal(keep[0].name, "new.glb")
  assert.deepEqual(drop.map((m) => m.name), ["m0.glb"], "the oldest goes")
  assert.equal(nextModels([{ name: "a.glb", at: 1 }], { name: "b.glb", at: 2 }).drop.length, 0)
})

test("names and scale", () => {
  assert.equal(modelName("Red Mug"), "Red Mug.glb")
  assert.equal(modelName('a/b:c*?"<>|d', "gltf"), "a b c d.gltf")
  assert.equal(modelName(""), "Model.glb")
  assert.equal(modelName("x".repeat(80)).length, 44)
  assert.equal(fitScale({ x: 2, y: 1, z: 0.5 }, 0.6), 0.3)
  assert.equal(fitScale({ x: 0, y: 0, z: 0 }), 1)
})

test("the pet trots after you and never needs you to move", () => {
  const you = { x: 0, z: 0, yaw: 0 }
  const t = petTarget(you)
  assert.ok(t.z < 0, "behind you (yaw 0 faces +z)")
  // far away: hurries toward the spot
  let pet = { x: 0, z: -10, yaw: 0, speed: 0 }
  for (let i = 0; i < 60; i++) pet = stepPet(pet, you, 1 / 30)
  assert.ok(pet.speed > PET.walk, "runs when off the leash distance")
  for (let i = 0; i < 400; i++) pet = stepPet(pet, you, 1 / 30)
  assert.ok(Math.hypot(pet.x - t.x, pet.z - t.z) <= PET.rest + 0.05, "arrives beside you")
  assert.equal(pet.moving, false)
  // you teleport (a door, the stairs): it pops next to you
  const far = stepPet(pet, { x: 50, z: 50, yaw: 1 }, 1 / 30)
  assert.ok(Math.hypot(far.x - 50, far.z - 50) < 2)
  // resting: turns to face your way, doesn't wander
  let still = { x: t.x, z: t.z, yaw: 2, speed: 0 }
  for (let i = 0; i < 120; i++) still = stepPet(still, you, 1 / 30)
  assert.ok(Math.abs(still.yaw) < 0.1)
  assert.equal(still.x, t.x)
})

test("Hugging Face errors become honest words", () => {
  const q = spaceError({ message: "You have exceeded your ZeroGPU quota (120s requested vs. 149s left). Try again in 22:25:24. Authenticate with a Hugging Face token for more quota" })
  assert.equal(q.quota, true)
  assert.match(q.text, /used up \(2 min 29 s left, and this needs 2 min\); it comes back in about 22 hours/)
  assert.match(q.text, /token/)
  assert.equal(quotaWait("Try again in 0:05:10."), "in about 5 minutes")
  assert.match(spaceError(new Error("Space is sleeping")).text, /asleep/)
  assert.match(spaceError(new Error("too many requests in queue")).text, /busy/)
  assert.match(spaceError(new Error("boom")).text, /import a \.glb/)
})

import * as C from "./core.js"

test("free-time numbers from Hugging Face's refusal, and the order to try Spaces in", () => {
  const msg = "You have exceeded your ZeroGPU quota (120s requested vs. 49s left). Try again in 23:59:48."
  assert.deepEqual(C.quotaNumbers(msg), { requested: 120, left: 49 })
  assert.deepEqual(C.quotaNumbers("boom"), { requested: null, left: null })
  const e = C.spaceError({ message: msg })
  assert.equal(e.quota, true)
  assert.equal(e.left, 49)
  assert.match(e.text, /49 s left, and this needs 2 min/)
  assert.equal(C.minutesText(171), "2 min 51 s")
  assert.equal(C.minutesText(45), "45 s")
  assert.match(C.spaceError({ message: "RuntimeError", title: "ZeroGPU worker error" }).text, /hiccup/)
  // unknown allowance: best first; 49 s left: only the cheap ones that fit come first
  assert.equal(C.planSpaces(C.PHOTO_SPACES)[0].id, "trellis2")
  const plan = C.planSpaces(C.PHOTO_SPACES, { left: 49 })
  assert.ok(plan.slice(0, 2).every((s) => s.gpu <= 49))
  assert.equal(plan.length, C.PHOTO_SPACES.length)
  assert.ok(!C.planSpaces(C.PHOTO_SPACES, { skip: ["trellis2"] }).some((s) => s.id === "trellis2"))
  assert.ok(C.PHOTO_SPACES.some((s) => !s.textured), "a shape-only fallback exists")
})

test("coloring a shape from the photo: the subject's box and the pixel over a point", () => {
  const w = 20
  const h = 10
  const rgba = new Uint8ClampedArray(w * h * 4).fill(255)
  // a red block from (5,2) to (14,7) on white
  for (let y = 2; y <= 7; y++)
    for (let x = 5; x <= 14; x++) {
      const i = (y * w + x) * 4
      rgba[i] = 200
      rgba[i + 1] = 20
      rgba[i + 2] = 20
    }
  assert.deepEqual(C.subjectBox(rgba, w, h), { x0: 5, y0: 2, x1: 14, y1: 7 })
  const box3 = { minX: -1, maxX: 1, minY: 0, maxY: 2 }
  const box2 = { x0: 5, y0: 2, x1: 14, y1: 7 }
  assert.deepEqual(C.photoPixel(-1, 2, box3, box2), [5, 2]) // top left of the model -> top left of the subject
  assert.deepEqual(C.photoPixel(1, 0, box3, box2), [14, 7])
  // a plain photo: the whole picture
  assert.deepEqual(C.subjectBox(new Uint8ClampedArray(w * h * 4).fill(255), w, h), { x0: 0, y0: 0, x1: w - 1, y1: h - 1 })
})
