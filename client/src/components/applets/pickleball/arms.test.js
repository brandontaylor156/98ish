// Tests for the athletes' arms (arms.js): the arm solver's joint limits (no locked or stretched
// elbows, the humerus, the forearm's twist and the wrist inside their ranges), the elbow's
// direction, the paddle kept exactly where the shot needs it, swing-twist, the shoulder
// girdle, finger poses and the twist bones' skin weights.
// Run: node --test client/src/components/applets/pickleball/arms.test.js
import test from "node:test"
import assert from "node:assert/strict"
import { JOINTS, armAngles, armMetrics, armReference, armRig, chooseBend, clavicleFor, fingerPose, FINGERS, gripFrame, handOn, humeralOf, limitHand, naturalBend, softReach, solveArm, solvePaddleArm, splitTwistWeights, stepFingers, twistOf, wristSplit, armRotations } from "./arms.js"
import { qaxis, qmul, qrot, qangle, qinv } from "./mm/quat.js"
import { createAnim, updateAnim } from "./anim.js"

const V = (x, y, z) => ({ x, y, z })
const sub = (a, b) => V(a.x - b.x, a.y - b.y, a.z - b.z)
const add = (a, b) => V(a.x + b.x, a.y + b.y, a.z + b.z)
const mul = (a, s) => V(a.x * s, a.y * s, a.z * s)
const len = (a) => Math.hypot(a.x, a.y, a.z)
const dist = (a, b) => len(sub(a, b))
const I = { x: 0, y: 0, z: 0, w: 1 }

// a T-pose arm like the MakeHuman athletes' (meters; facing +z, the left side at +x, palms
// down), every rest rotation the identity
const LEFT = { clavicle: V(0.023, 1.483, 0.024), upperarm: V(0.24, 1.454, 0.019), lowerarm: V(0.505, 1.454, 0.019), hand: V(0.783, 1.454, 0.019), middle_01: V(0.899, 1.447, 0.027), thumb_01: V(0.823, 1.448, 0.05) }
const REST = { spine_03: { wp: V(0, 1.2, -0.03), wq: I }, pelvis: { wp: V(0, 1.0, 0), wq: I }, neck_01: { wp: V(0, 1.5, 0), wq: I } }
for (const [k, p] of Object.entries(LEFT)) {
  REST[k + "_l"] = { wp: p, wq: I }
  REST[k + "_r"] = { wp: V(-p.x, p.y, p.z), wq: I }
}
const CHEST = { right: V(-1, 0, 0), up: V(0, 1, 0), fwd: V(0, 0, 1) }
const S = { l: REST.upperarm_l.wp, r: REST.upperarm_r.wp }
const rig = (side) => armRig(REST, side, 1, gripFrame(REST, side))
const TORSO = { a: V(0, 1.0, 0), b: V(0, 1.5, 0), r: 0.115 }
// the solved arm, measured the way the filmstrips measure the drawn one
const measure = (side, res) => {
  const bones = { spine_03: { p: REST.spine_03.wp, q: I }, pelvis: { p: TORSO.a, q: I }, neck_01: { p: TORSO.b, q: I } }
  const o = side === "l" ? "r" : "l"
  bones["clavicle_" + side] = { p: REST["clavicle_" + side].wp, q: I }
  bones["upperarm_" + side] = { p: S[side], q: res.upper }
  bones["lowerarm_" + side] = { p: res.E, q: res.lower }
  bones["hand_" + side] = { p: res.W, q: res.hand }
  // (the other arm hanging: unmeasured here)
  bones["clavicle_" + o] = { p: REST["clavicle_" + o].wp, q: I }
  bones["upperarm_" + o] = { p: S[o], q: I }
  bones["lowerarm_" + o] = { p: add(S[o], V(0, -0.27, 0)), q: I }
  bones["hand_" + o] = { p: add(S[o], V(0, -0.54, 0)), q: I }
  return armMetrics(bones, armReference(REST))[side]
}
// (the model's resting hand reads a few degrees off neutral: its palm isn't quite square)
const NEUTRAL = {}
const neutralOf = (side) => {
  if (NEUTRAL[side] === undefined) {
    const r = rig(side)
    const res = solveArm(r, S[side], V(side === "l" ? 0.25 : -0.25, 1.1, 0.3), CHEST, {})
    NEUTRAL[side] = measure(side, { ...res, hand: armRotations(r, res.a).neutral }).pronation
  }
  return NEUTRAL[side]
}
const inRange = (m, label, side = "l") => {
  const J = JOINTS
  const pron = m.pronation - neutralOf(side)
  assert.ok(m.elbow >= J.elbow.min - 0.5 && m.elbow <= J.elbow.max + 0.5, `${label}: elbow ${m.elbow}`)
  assert.ok(pron >= J.pron.min - 5 && pron <= J.pron.max + 5, `${label}: pronation ${pron}`)
  assert.ok(m.flexion >= J.flex.min - 2 && m.flexion <= J.flex.max + 2, `${label}: wrist flexion ${m.flexion}`)
  assert.ok(m.deviation >= J.dev.min - 2 && m.deviation <= J.dev.max + 2, `${label}: wrist deviation ${m.deviation}`)
  assert.ok(m.humeral >= J.hum.min - 3 && m.humeral <= J.hum.max + 3, `${label}: humerus ${m.humeral}`)
}

test("soft reach: never past the elbow's limits, never a jump", () => {
  const r = rig("l")
  let prev = softReach(0, r.l1, r.l2)
  assert.ok(prev > 0.1, "the elbow's fold keeps the wrist off the shoulder")
  for (let d = 0; d < 0.8; d += 0.005) {
    const s = softReach(d, r.l1, r.l2)
    assert.ok(s >= prev - 1e-9, "never shorter for a further target")
    assert.ok(s - prev < 0.0051, "no jump")
    prev = s
  }
  // (the arm never straighter than the elbow's minimum)
  const max = Math.sqrt(r.l1 ** 2 + r.l2 ** 2 + 2 * r.l1 * r.l2 * Math.cos((JOINTS.elbow.min * Math.PI) / 180))
  assert.ok(prev <= max + 1e-9)
  assert.ok(prev > max - 0.01, "but it gets close")
})

test("swing-twist: the twist about an axis, and a hand turned by a pronation reads back", () => {
  const a = V(0, 0, 1)
  const q = qmul(qaxis(V(1, 0, 0), 0.4), qaxis(a, 0.7))
  assert.ok(Math.abs(twistOf(q, a) - 0.7) < 0.05)
  const r = rig("l")
  const res = solveArm(r, S.l, V(0.3, 1.1, 0.35), CHEST, { torso: TORSO })
  const rot = armRotations(r, res.a)
  const m0 = measure("l", { ...res, hand: rot.neutral })
  for (const pron of [-60, -20, 0, 30, 60]) {
    const H = handOn(r, res.a, rot.neutral, { pron })
    const { twist } = wristSplit(H, rot.neutral, res.a.fa)
    assert.ok(Math.abs(r.sg * twist * (180 / Math.PI) - pron) < 0.5, `pron ${pron}`)
    const m = measure("l", { ...res, hand: H })
    assert.ok(Math.abs(m.pronation - m0.pronation - pron) < 1, `measured ${m.pronation} for ${pron}`)
  }
  // (the model's resting hand reads close to neutral: its palm is a few degrees off square)
  assert.ok(Math.abs(m0.pronation - 90) < 10)
})

test("free arm: bones keep their lengths, the elbow is natural, everything in range", () => {
  for (const side of ["l", "r"]) {
    const r = rig(side)
    const sg = side === "l" ? 1 : -1
    // hanging, in front at the waist, at the chest across the body, overhead, out to the side,
    // too far (a reach), behind
    const targets = [V(sg * 0.25, 0.9, 0.05), V(sg * 0.1, 1.05, 0.35), V(-sg * 0.05, 1.25, 0.32), V(sg * 0.25, 1.95, 0.15), V(sg * 0.75, 1.4, 0.1), V(sg * 0.3, 1.3, 0.9), V(sg * 0.3, 1.0, -0.25)]
    for (const t of targets) {
      const res = solveArm(r, S[side], t, CHEST, { torso: TORSO, relax: { pron: 15, flex: 10, dev: -6 } })
      assert.ok(Math.abs(dist(res.E, S[side]) - r.l1) < 1e-6, "upper arm length")
      assert.ok(Math.abs(dist(res.W, res.E) - r.l2) < 1e-6, "forearm length")
      const m = measure(side, res)
      inRange(m, `${side} ${JSON.stringify(t)}`, side)
      assert.ok(m.stretch === 1)
    }
  }
})

test("free arm: a relaxed hanging arm's elbow points back and out; a hand in front keeps the elbow down", () => {
  const r = rig("l")
  const hang = solveArm(r, S.l, V(0.27, 0.95, 0.06), CHEST, { torso: TORSO })
  const out = sub(hang.E, mul(add(S.l, hang.W), 0.5))
  assert.ok(out.z < 0, "elbow behind the shoulder-wrist line")
  const front = solveArm(r, S.l, V(0.12, 1.05, 0.35), CHEST, { torso: TORSO })
  assert.ok(front.E.y < S.l.y - 0.12, "elbow down, below the shoulder")
  assert.ok(dot3(sub(front.E, mul(add(S.l, front.W), 0.5)), V(0, -1, 0)) > 0.02, "pointing down")
  // (a pole asked for is followed when it's anatomical)
  const wide = solveArm(r, S.l, V(0.12, 1.05, 0.35), CHEST, { torso: TORSO, pole: V(1, -0.3, 0), poleW: 1 })
  assert.ok(wide.E.x > front.E.x, "the elbow out to the side when asked")
})
const dot3 = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z

test("free arm: the elbow turns smoothly from frame to frame (no flips) as the hand moves", () => {
  const r = rig("l")
  let st = null
  let worst = 0
  for (let k = 0; k <= 120; k++) {
    const u = k / 120
    // a hand sweeping from hanging, up in front, across, overhead and back down
    const t = V(0.25 - 0.4 * Math.sin(u * Math.PI), 0.95 + 0.9 * Math.sin(u * Math.PI), 0.05 + 0.3 * Math.sin(u * 2 * Math.PI))
    const res = solveArm(r, S.l, t, CHEST, { torso: TORSO, prev: st, maxTurn: 0.25 })
    if (st) worst = Math.max(worst, Math.acos(Math.max(-1, Math.min(1, dot3(res.bend, st) / len(res.bend) / len(st)))))
    st = res.bend
  }
  assert.ok(worst < 0.3, `worst elbow turn ${worst}`)
})

test("paddle arm: the face's center and normal exact; the wrist and forearm inside their ranges", () => {
  for (const side of ["l", "r"]) {
    const r = rig(side)
    const g = gripFrame(REST, side)
    const sg = side === "l" ? 1 : -1
    const FFG = 0.216
    // (paddle poses from a game: the ready position, a forehand contact, a backhand, a dink, a
    // high volley, the follow-through over the other shoulder; the face normal toward the net)
    const poses = [
      { face: V(sg * 0.05, 1.28, 0.5), axis: V(-sg * 0.32, 0.62, 0.72), normal: V(0, 0, 1) },
      { face: V(sg * 0.6, 1.0, 0.45), axis: V(sg * 0.9, 0.3, 0.3), normal: V(0, 0, 1) },
      { face: V(-sg * 0.2, 1.05, 0.45), axis: V(-sg * 0.9, 0.2, 0.3), normal: V(0, 0, 1) },
      { face: V(sg * 0.3, 0.85, 0.45), axis: V(sg * 0.2, -0.9, 0.4), normal: V(0, 0.4, 1) },
      { face: V(sg * 0.35, 1.6, 0.5), axis: V(0.1, 0.9, 0.4), normal: V(0, 0, 1) },
      { face: V(-sg * 0.2, 1.75, 0.15), axis: V(-sg * 0.5, 0.8, -0.2), normal: V(sg, 0, 0.3) },
    ]
    for (const [i, p] of poses.entries()) {
      const res = solvePaddleArm(r, S[side], p, CHEST, { faceFromGrip: FFG, torso: TORSO })
      // the face's center from the hand and the grip
      const gripW = add(res.W, qrot(res.hand, g.p))
      const face = add(gripW, mul(res.axis, FFG))
      const reach = res.short
      if (reach < 0.005) assert.ok(dist(face, p.face) < 0.002 + reach, `${side} pose ${i}: face ${dist(face, p.face)}`)
      // (the face's normal is the asked one made square to the handle, either face)
      const a0 = mul(p.axis, 1 / len(p.axis))
      const n0 = sub(p.normal, mul(a0, dot3(p.normal, a0)))
      const along = Math.abs(dot3(res.normal, mul(n0, 1 / len(n0))))
      const ax = res.axis
      assert.ok(along > 0.9999, `${side} pose ${i}: normal ${along}`)
      assert.ok(Math.abs(dot3(ax, res.normal)) < 1e-6)
      const m = measure(side, res)
      inRange(m, `${side} paddle pose ${i}`, side)
    }
  }
})

test("paddle arm: through real strokes (anim.js) the grip and roll stay steady, the arm in range", () => {
  for (const [kind, dx, y, hand] of [["drive", 0.62, 0.85, "fh"], ["drive", -0.62, 0.85, "bh"], ["dink", 0.42, 0.3, "fh"], ["punch", 0.45, 1.12, "fh"], ["block", -0.4, 1.05, "bh"], ["smash", 0.25, 2.0, "fh"], ["serve", 0.3, 0.52, "fh"]]) {
    const r = rig("r")
    const a = createAnim(0, 0, 0)
    const c = { x: -dx, y, z: 0.45 }
    const base = { x: 0, z: 0, vx: 0, vz: 0, facing: 0, holding: false, charging: false, between: false, atNet: kind === "dink" || kind === "punch" || kind === "block", hand: 1, twoHand: false }
    let prev = null
    let flips = 0
    let worstPsi = 0
    let worstBone = 0
    let lastWrist = null
    let bad = 0
    let n = 0
    const dt = 1 / 60
    for (let t = 0; t < 1.4; t += dt) {
      const s = t < 0.7 ? { ...base, ball: { ...c }, prep: { ttc: 0.7 - t, ...c, kind, hand, forward: true } } : { ...base, ball: { ...c }, swing: { t: t - 0.7, kind, hand, ...c } }
      const pose = updateAnim(a, s, dt)
      const chest = { right: pose.chestRight, fwd: pose.chestForward, up: norm3(cross3(pose.chestRight, pose.chestForward)) }
      const tRel = pose.info.tRel
      const exact = tRel === null || pose.info.stroke < 0.3 ? 0 : Math.max(0, Math.min(1, 1 - (Math.abs(tRel) - 0.05) / 0.12))
      const res = solvePaddleArm(r, pose.shoulderR, pose.paddle, chest, { faceFromGrip: 0.216, torso: { a: pose.pelvis, b: pose.neck, r: 0.115 }, prev, pole: pose.bendP, poleW: 0.35, maxTurn: 0.4, handRate: 14 / 60, handTurn: 11 / 60, exact, sideWant: pose.info.stroke > 0.05 ? pose.info.side : 0, wrist: pose.wristP, stroke: pose.info.stroke, dt })
      if (prev) {
        if (res.side !== prev.side) flips++
        // (away from contact: how far the wrist (the hand against its forearm), the upper arm and
        // the forearm turned in a frame)
        if (exact < 0.5 && prev.exact < 0.5) worstPsi = Math.max(worstPsi, qangle(qmul(qinv(prev.neutral), prev.hand), qmul(qinv(res.neutral), res.hand)))
        // (unless the pose's own hand moved fast that frame: a swing)
        const moved = dist(pose.wristP, lastWrist)
        if (exact < 0.5 && prev.exact < 0.5 && moved < 0.05) worstBone = Math.max(worstBone, qangle(prev.upper, res.upper), qangle(prev.lower, res.lower))
      }
      prev = res
      lastWrist = pose.wristP
      const A = armAngles(r, res, chest)
      n++
      if (A.pron < JOINTS.pron.min - 10 || A.pron > JOINTS.pron.max + 10 || A.flex < JOINTS.flex.min - 10 || A.flex > JOINTS.flex.max + 10 || A.dev < JOINTS.dev.min - 10 || A.dev > JOINTS.dev.max + 10) bad++
    }
    // (into the stroke's face and back to the ready one at most; the hand turning gradually)
    assert.ok(flips <= 2, `${kind} ${hand}: grip flips ${flips}`)
    assert.ok(worstPsi <= 0.4, `${kind} ${hand}: the wrist turned ${worstPsi} in a frame away from contact`)
    assert.ok(worstBone <= 0.6, `${kind} ${hand}: an arm bone turned ${worstBone} in a frame away from contact`)
    assert.ok(bad / n < 0.1, `${kind} ${hand}: ${bad}/${n} frames with the wrist or forearm well out of range`)
  }
})
const cross3 = (a, b) => V(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x)
const norm3 = (a) => mul(a, 1 / len(a))

test("hands: limited back into range; natural bend; humerus reference", () => {
  const r = rig("l")
  const res = solveArm(r, S.l, V(0.2, 1.1, 0.3), CHEST, { torso: TORSO })
  const rot = armRotations(r, res.a)
  // a hand bent far back and wrung
  const bad = qmul(qaxis(res.a.fa, 2.6), qmul(qaxis(V(0, 1, 0), 1.4), rot.neutral))
  const lim = limitHand(r, res.a, rot.neutral, bad)
  const m = measure("l", { ...res, hand: lim })
  inRange(m, "limited hand", "l")
  // the natural elbow for a hanging arm points down (along the arm, mostly) and back
  const nb = naturalBend(V(0, -1, 0), CHEST, 1)
  assert.ok(nb.z < 0 && nb.x > 0)
  // a hanging arm with the crease forward is the humerus' zero
  assert.ok(Math.abs(humeralOf(V(0, -1, 0), V(0, 0, 1), CHEST, 1)) < 1e-6)
  assert.ok(humeralOf(V(0, -1, 0), V(1, 0, 0), CHEST, 1) > 1.5, "crease out to the left side: external rotation")
  void qangle
  void chooseBend
})

test("shoulder girdle: rises with the arm past 40 degrees, forward on a reach in front, back behind", () => {
  const low = clavicleFor(V(0, -1, 0), 0.8, 1)
  const level = clavicleFor(V(-1, 0, 0), 0.8, 1)
  const high = clavicleFor(V(0, 1, 0), 0.8, 1)
  assert.ok(low.elev < level.elev && level.elev < high.elev)
  assert.ok(high.elev * (180 / Math.PI) > 20 && high.elev * (180 / Math.PI) <= 33)
  const front = clavicleFor(V(0, 0, 1), 0.8, 1)
  const across = clavicleFor(V(0.7, 0, 0.7), 0.8, 1) // (the left arm across to the right)
  const back = clavicleFor(V(0, -0.3, -0.95), 0.8, 1)
  assert.ok(front.prot > 0 && across.prot > front.prot && back.prot < 0)
  const reach = clavicleFor(V(0, 0, 1), 1.05, 1)
  assert.ok(reach.prot > front.prot, "a long reach brings the shoulder forward")
})

test("fingers: a relaxed hand is a cascade; shapes blend; moves are gradual", () => {
  const r = fingerPose("relaxed")
  const sum = (f) => f.reduce((a, b) => a + b, 0)
  assert.ok(sum(r.index) < sum(r.middle) && sum(r.middle) < sum(r.ring) && sum(r.ring) < sum(r.pinky))
  // (no claw: the end joints curl less than the middle ones; nothing bent backward)
  for (const shape of Object.keys(FINGERS))
    for (const f of ["index", "middle", "ring", "pinky"]) {
      const c = FINGERS[shape][f]
      assert.ok(c.every((v) => v >= 0), `${shape} ${f} never hyperextended`)
      assert.ok(c[2] <= c[1] + 1e-9, `${shape} ${f}: the tip curls no more than the middle joint`)
    }
  assert.ok(sum(fingerPose("grip").middle) > 3, "a grip wraps round the handle")
  const half = fingerPose("relaxed", "fist", 0.5)
  assert.ok(Math.abs(half.middle[0] - (FINGERS.relaxed.middle[0] + FINGERS.fist.middle[0]) / 2) < 1e-9)
  const step = stepFingers(fingerPose("relaxed"), fingerPose("fist"), 1 / 60, 9)
  assert.ok(step.middle[0] - FINGERS.relaxed.middle[0] <= 9 / 60 + 1e-9, "a fist closes over a few frames")
})

test("twist weights: shared along the forearm, at most 4 influences, summing to 1", () => {
  // a forearm of vertices along x from the elbow (0.5) to the wrist (0.78), weighted to bone 2
  // (and near the elbow partly bone 1, near the wrist partly bone 3)
  const n = 30
  const position = new Float32Array(n * 3)
  const skinIndex = new Uint16Array(n * 4)
  const skinWeight = new Float32Array(n * 4)
  for (let i = 0; i < n; i++) {
    const x = 0.48 + (i / (n - 1)) * 0.32
    position.set([x, 1.45, 0.03], i * 3)
    const e = Math.max(0, Math.min(1, (0.55 - x) / 0.07))
    const w = Math.max(0, Math.min(1, (x - 0.74) / 0.06))
    skinIndex.set([2, 1, 3, 5], i * 4)
    skinWeight.set([1 - e - w, e, w, 0], i * 4)
  }
  const changed = splitTwistWeights(position, skinIndex, skinWeight, 2, V(0.505, 1.454, 0.019), V(0.783, 1.454, 0.019), [[0, 2], [0.5, 10], [1, 11]])
  assert.ok(changed > 20)
  let last = -1
  for (let i = 0; i < n; i++) {
    let sum = 0
    let tw = 0
    for (let k = 0; k < 4; k++) {
      sum += skinWeight[i * 4 + k]
      if (skinIndex[i * 4 + k] === 10) tw += skinWeight[i * 4 + k] * 0.5
      if (skinIndex[i * 4 + k] === 11) tw += skinWeight[i * 4 + k]
      if (skinIndex[i * 4 + k] === 3) tw += skinWeight[i * 4 + k]
    }
    assert.ok(Math.abs(sum - 1) < 1e-5, "weights sum to 1")
    // (how much of the hand's twist this vertex follows: never less further down the forearm)
    assert.ok(tw >= last - 0.03, `twist share grows toward the wrist at ${i}: ${tw} < ${last}`)
    last = tw
  }
  assert.ok(last > 0.95, "the wrist follows the hand's twist")
})
