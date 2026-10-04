// Tests for the skinned athletes' pure parts: the retargeting math (retarget.js), the
// motion-capture clips (moves.json) and the clothes grown from the body (outfit.js).
// Run: node --test client/src/components/applets/pickleball/
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { additiveMove, aimDelta, bendAxis, clipTime, decodeMoves, FADE, frameOf, gripSide, LAYERS, layerTargets, Q, qangle, qaxis, qinv, qmul, qrot, qslerp, sampleClip, solveLimb, stepLayers, swingTwist, twistAngle } from "./retarget.js"
import { BUILD_SCALE, buildGarment, buildSkirt, covers, landmarks, prepareBody, reshapeBody, skirtWeights, visibleIndex } from "./outfit.js"

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} not within ${tol} of ${b}`)
const nearV = (a, b, tol, msg) => near(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z), 0, tol, msg)
const len = (v) => Math.hypot(v.x, v.y, v.z)
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z
const unit = (v) => {
  const l = len(v)
  return { x: v.x / l, y: v.y / l, z: v.z / l }
}

test("quaternions: rotate, compose, invert, slerp", () => {
  const q = qaxis({ x: 0, y: 1, z: 0 }, Math.PI / 2)
  nearV(qrot(q, { x: 1, y: 0, z: 0 }), { x: 0, y: 0, z: -1 }, 1e-9, "90 degrees about y takes x to -z")
  const r = qaxis({ x: 1, y: 2, z: 3 }, 1.1)
  const v = { x: 0.3, y: -0.7, z: 0.2 }
  nearV(qrot(qmul(q, r), v), qrot(q, qrot(r, v)), 1e-9, "compose")
  nearV(qrot(qinv(r), qrot(r, v)), v, 1e-9, "invert")
  near(qangle(qslerp(Q(), q, 0.5), qaxis({ x: 0, y: 1, z: 0 }, Math.PI / 4)), 0, 1e-6, "slerp halfway")
})

test("frames and aiming: a bone's rest directions land exactly on the pose's", () => {
  for (let i = 0; i < 50; i++) {
    const rnd = () => ({ x: Math.sin(i * 1.7 + 0.3), y: Math.cos(i * 2.3), z: Math.sin(i * 0.9 + 1) })
    const p0 = unit(rnd())
    const s0 = unit({ x: p0.y, y: -p0.x + 0.3, z: 0.5 })
    const p = unit({ x: Math.cos(i), y: 0.4, z: Math.sin(i * 1.3) })
    const s = unit({ x: 0.2, y: 1, z: -0.1 * i })
    const d = aimDelta(p0, s0, p, s)
    nearV(qrot(d, p0), p, 1e-6, "primary axis")
    // the roll: the hint's part perpendicular to the axis goes to the target's
    const perp = (a, ax) => unit({ x: a.x - ax.x * dot(a, ax), y: a.y - ax.y * dot(a, ax), z: a.z - ax.z * dot(a, ax) })
    nearV(qrot(d, perp(s0, p0)), perp(s, p), 1e-6, "roll")
    const f = frameOf(p, s)
    nearV(qrot(f, { x: 0, y: 1, z: 0 }), p, 1e-6, "frame y is the primary")
  }
})

test("swing-twist: the parts recompose, and the twist angle is right", () => {
  const axis = unit({ x: 0.2, y: 1, z: 0.1 })
  const twist = qaxis(axis, 0.9)
  const swing = qaxis({ x: axis.z, y: 0, z: -axis.x }, 0.5) // (about an axis across it)
  const q = qmul(swing, twist)
  const parts = swingTwist(q, axis)
  near(qangle(qmul(parts.swing, parts.twist), q), 0, 1e-6, "recomposes")
  near(twistAngle(parts.twist, axis), 0.9, 0.06, "twist angle")
})

test("limbs: two-bone IK reaches with the model's lengths, stretching no more than allowed", () => {
  const root = { x: 0, y: 1.4, z: 0 }
  const pole = { x: 0, y: -1, z: -1 }
  const inReach = solveLimb(root, { x: 0.3, y: 1.1, z: 0.3 }, 0.28, 0.26, pole, 1.18)
  near(inReach.stretch, 1, 1e-9, "no stretch in reach")
  nearV(inReach.end, { x: 0.3, y: 1.1, z: 0.3 }, 1e-3, "reaches")
  near(len({ x: inReach.mid.x - root.x, y: inReach.mid.y - root.y, z: inReach.mid.z - root.z }), 0.28, 1e-6, "upper length")
  const far = solveLimb(root, { x: 0.62, y: 1.4, z: 0 }, 0.28, 0.26, pole, 1.18)
  assert.ok(far.stretch > 1 && far.stretch <= 1.18, `stretches a little (${far.stretch})`)
  nearV(far.end, { x: 0.62, y: 1.4, z: 0 }, 2e-3, "reaches by stretching")
  const tooFar = solveLimb(root, { x: 2, y: 1.4, z: 0 }, 0.28, 0.26, pole, 1.18)
  near(tooFar.stretch, 1.18, 1e-9, "stretch capped")
  const n = bendAxis({ x: 0, y: -1, z: 0 }, { x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: 1 })
  near(len(n), 1, 1e-9, "a straight limb still has a bend axis")
})

test("grip: the palm's side of the paddle only flips when the other side is clearly better", () => {
  assert.equal(gripSide(0, 0.2), 1)
  assert.equal(gripSide(0, -0.2), -1)
  let side = 1
  for (const d of [0.5, 0.1, -0.2, -0.3, 0.2]) side = gripSide(side, d)
  assert.equal(side, 1, "small wobbles don't flip it")
  side = gripSide(side, -0.6)
  assert.equal(side, -1, "a clear change does")
})

test("clip layers: crossfade in FADE seconds, run clips follow the gait, swings mute the run", () => {
  const w = {}
  const run = layerTargets({ speed: 3 })
  assert.ok(run.jog > 0.5 && run.breathe < 0.5, "jogging")
  let t = 0
  while (Math.abs((w.jog ?? 0) - run.jog) > 1e-9) {
    stepLayers(w, run, 1 / 60)
    t += 1 / 60
  }
  assert.ok(t <= FADE + 1 / 30, `faded in within ${FADE}s (${t.toFixed(2)})`)
  const swinging = layerTargets({ speed: 3, swinging: true })
  assert.equal(swinging.jog, 0)
  assert.equal(swinging.sprint, 0)
  assert.equal(layerTargets({ speed: 0, mood: { kind: "cheer", variant: 2 }, between: true }).dance, 1)
  const clip = { duration: 0.8 }
  near(clipTime(clip, { phase: Math.PI, locked: true }), 0.4, 1e-9, "half a gait cycle is half the clip")
  near(clipTime(clip, { phase: Math.PI * 5, locked: true }), 0.4, 1e-9, "loops")
  near(clipTime(clip, { time: 1.0 }), 0.2, 1e-9, "real time loops")
})

test("moves.json: every layer's clip is there, unit quaternions, additive moves start at rest", () => {
  const file = fileURLToPath(new URL("../../../../public/assets/pickleball/moves.json", import.meta.url))
  const moves = decodeMoves(JSON.parse(readFileSync(file, "utf8")))
  for (const L of Object.values(LAYERS)) {
    const clip = moves.clips[L.clip]
    assert.ok(clip, `clip ${L.clip}`)
    assert.ok(clip.frames > 5 && clip.duration > 0.2, `${L.clip} has frames`)
    for (const bone of Object.keys(L.bones)) {
      assert.ok(bone in moves.index, `${L.clip} moves ${bone}`)
      for (const t of [0, clip.duration * 0.37, clip.duration * 0.9]) {
        const q = sampleClip(moves, clip, bone, t)
        near(Math.hypot(q.x, q.y, q.z, q.w), 1, 1e-6, "unit")
        const d = additiveMove(moves, clip, bone, t, 1)
        assert.ok(qangle(d, Q()) < 1.6, `${L.clip} ${bone}: a modest move (${qangle(d, Q()).toFixed(2)} rad)`)
      }
      near(qangle(additiveMove(moves, clip, bone, 0, 1), Q()), 0, 1e-4, "no move at the clip's start")
      near(qangle(additiveMove(moves, clip, bone, 0.3, 0), Q()), 0, 1e-9, "weight 0 is no move")
    }
  }
})

// a stand-in body: a capsule-ish trunk and two legs, made of rings
const fakeBody = () => {
  const position = []
  const skinIndex = []
  const skinWeight = []
  const index = []
  const bones = ["pelvis", "spine_01", "thigh_l", "thigh_r", "foot_l", "neck_01"]
  const N = 16
  const tube = (cx, y0, y1, r, rings, bone) => {
    const start = position.length / 3
    for (let j = 0; j <= rings; j++)
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2
        position.push(cx + Math.cos(a) * r, y0 + ((y1 - y0) * j) / rings, Math.sin(a) * r)
        skinIndex.push(bones.indexOf(bone), 0, 0, 0)
        skinWeight.push(1, 0, 0, 0)
      }
    for (let j = 0; j < rings; j++)
      for (let i = 0; i < N; i++) {
        const a = start + j * N + i
        const b = start + j * N + ((i + 1) % N)
        index.push(a, b, a + N, b, b + N, a + N)
      }
  }
  tube(0, 0.9, 1.2, 0.16, 6, "pelvis")
  tube(0.09, 0.45, 0.9, 0.07, 9, "thigh_l")
  tube(-0.09, 0.45, 0.9, 0.07, 9, "thigh_r")
  return { position: Float32Array.from(position), skinIndex: Uint16Array.from(skinIndex), skinWeight: Float32Array.from(skinWeight), index: Uint32Array.from(index), bones }
}
const joints = {
  thigh_l: { x: 0.09, y: 0.92, z: 0 },
  thigh_r: { x: -0.09, y: 0.92, z: 0 },
  calf_l: { x: 0.09, y: 0.5, z: 0 },
  calf_r: { x: -0.09, y: 0.5, z: 0 },
  foot_l: { x: 0.09, y: 0.09, z: 0 },
  foot_r: { x: -0.09, y: 0.09, z: 0 },
  upperarm_l: { x: 0.18, y: 1.42, z: 0 },
  upperarm_r: { x: -0.18, y: 1.42, z: 0 },
  neck_01: { x: 0, y: 1.5, z: 0 },
  Head: { x: 0, y: 1.6, z: 0 },
  pelvis: { x: 0, y: 0.95, z: 0 },
}

test("clothes: shorts grow out of the body, bend with its bones and never sink into it", () => {
  const body = prepareBody(fakeBody())
  const m = landmarks(joints, 0)
  assert.ok(covers("shorts", { x: 0.09, y: 0.8, z: 0.07, bone: "thigh_l" }, m), "shorts cover the thigh")
  assert.ok(!covers("shorts", { x: 0.09, y: 0.5, z: 0.07, bone: "thigh_l" }, m), "not the knee")
  assert.ok(!covers("tee", { x: 0, y: 1.0, z: 0.1, bone: "foot_l" }, m), "a tee isn't on the feet")
  const g = buildGarment("shorts", body, m)
  const n = g.position.length / 3
  assert.ok(n > 50 && g.index.length > 100, `a real patch (${n} vertices)`)
  for (let i = 0; i < g.index.length; i++) assert.ok(g.index[i] < n, "indices in range")
  let thinnest = Infinity
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < body.position.length; j += 3) thinnest = Math.min(thinnest, Math.hypot(g.position[i * 3] - body.position[j], g.position[i * 3 + 1] - body.position[j + 1], g.position[i * 3 + 2] - body.position[j + 2]))
    let w = 0
    for (let k = 0; k < 4; k++) w += g.skinWeight[i * 4 + k]
    near(w, 1, 1e-5, "skin weights sum to 1")
    assert.ok(Number.isFinite(g.normal[i * 3]) && Number.isFinite(g.trim[i]), "finite")
  }
  assert.ok(thinnest > 0.002, `stands off the skin everywhere (closest ${thinnest.toFixed(4)} m)`)
  assert.ok([...g.trim].some((t) => t > 0.9), "has a hem in the trim color")
})

test("clothes: a skirt flares from the waist and follows hips and thighs", () => {
  for (const a of [0, 1, 2, 3, 4, 5, 6]) {
    const w = skirtWeights(a, a / 6)
    near(w.pelvis + w.thigh_l + w.thigh_r, 1, 1e-9, "weights sum to 1")
  }
  assert.ok(skirtWeights(0, 1).thigh_l > skirtWeights(0, 1).thigh_r, "the left side follows the left thigh")
  assert.equal(skirtWeights(1, 0).pelvis, 1, "the waistband is on the pelvis")
  const m = landmarks(joints, 0)
  const s = buildSkirt(m, () => 0.17, { pelvis: 0, thigh_l: 2, thigh_r: 3 })
  const ring = (r) => Math.hypot(s.position[r * 28 * 3] - m.cx, s.position[r * 28 * 3 + 2] - m.cz)
  assert.ok(ring(6) > ring(0) + 0.05, "flares toward the hem")
  assert.ok(s.position[6 * 28 * 3 + 1] < s.position[1], "hangs down")
})

test("Locker Room clothes: each garment covers its part of the body", () => {
  const m = landmarks({ ...joints, hand_l: { x: 0.7, y: 1.42, z: 0 } }, 0)
  const v = (x, y, z, bone) => ({ x, y, z, bone })
  const thighMid = v(0.09, 0.71, 0.07, "thigh_l")
  const aboveKnee = v(0.09, 0.53, 0.07, "thigh_l")
  const shin = v(0.09, 0.3, 0.05, "calf_l")
  assert.ok(covers("shorts", thighMid, m) && !covers("shorts", aboveKnee, m), "shorts: mid-thigh")
  assert.ok(covers("board", aboveKnee, m) && !covers("board", shin, m), "board shorts: to the knee")
  assert.ok(covers("pants", shin, m), "track pants: down the shin")
  assert.ok(!covers("short", thighMid, m) && !covers("swim", thighMid, m), "short shorts and swim shorts stay high")
  const chest = v(0.05, 1.3, 0.12, "spine_03")
  const belly = v(0.05, 1.05, 0.12, "spine_01")
  assert.ok(covers("onepiece", chest, m) && covers("onepiece", v(0.05, 0.9, 0.1, "pelvis"), m) && !covers("onepiece", thighMid, m), "one-piece: torso and hips")
  assert.ok(covers("crop", chest, m) && !covers("crop", belly, m), "sports top: the chest, not the midriff")
  const forearm = v(0.55, 1.42, 0.03, "lowerarm_l")
  assert.ok(covers("rash", forearm, m) && covers("jacket", forearm, m) && !covers("tee", forearm, m), "long sleeves to the wrist")
  assert.ok(!covers("rash", v(0.75, 1.42, 0, "hand_l"), m), "...not the hand")
  assert.ok(covers("gloves", v(0.75, 1.42, 0, "index_01_l"), m), "gloves: the hand")
  assert.ok(covers("wristbands", v(0.66, 1.42, 0.03, "lowerarm_l"), m) && !covers("wristbands", forearm, m), "wristbands: at the wrist")
  assert.ok(covers("kneesocks", shin, m) && !covers("socks", shin, m), "knee socks go higher than crew socks")
  const body = prepareBody(fakeBody())
  for (const kind of ["board", "short", "swim", "pants", "onepiece"]) {
    const g = buildGarment(kind, body, m)
    assert.ok(g.position.length > 0 && g.index.length > 0, `${kind} builds`)
  }
  assert.ok(visibleIndex(["pants"], body, m).length < body.index.length, "skin under track pants isn't drawn")
})

test("builds: slim and strong reshape torso and limbs; seams never open", () => {
  const body = prepareBody(fakeBody())
  const m = landmarks(joints, 0)
  assert.deepEqual(Array.from(reshapeBody(body, joints, m, 1)), Array.from(body.position), "regular is the body as it is")
  const meanR = (P, bone, cx) => {
    let s = 0
    let n = 0
    for (let i = 0; i < P.length / 3; i++)
      if (body.dominant[i] === bone) {
        s += Math.hypot(P[i * 3] - cx, P[i * 3 + 2])
        n++
      }
    return s / n
  }
  const slim = reshapeBody(body, joints, m, BUILD_SCALE.slim)
  const strong = reshapeBody(body, joints, m, BUILD_SCALE.strong)
  assert.ok(meanR(strong, "thigh_l", 0.09) > meanR(body.position, "thigh_l", 0.09) * 1.04, "strong: thicker legs")
  assert.ok(meanR(slim, "thigh_l", 0.09) < meanR(body.position, "thigh_l", 0.09) * 0.97, "slim: thinner legs")
  assert.ok(meanR(strong, "pelvis", 0) > meanR(body.position, "pelvis", 0) && meanR(slim, "pelvis", 0) < meanR(body.position, "pelvis", 0), "torso wider / narrower")
  // vertices that share a spot (UV seams) still share it
  const first = new Map()
  body.welded.ids.forEach((w, i) => {
    const j = first.get(w)
    if (j === undefined) first.set(w, i)
    else for (let k = 0; k < 3; k++) assert.equal(strong[i * 3 + k], strong[j * 3 + k])
  })
  for (const x of strong) assert.ok(Number.isFinite(x))
})
