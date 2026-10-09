// The paddle never passes through the body (2026-10-08, after "the pickleball paddle still
// pierces through the players bodies"): paddlebody.js measures the paddle's real shape (its
// face, edge guard and handle) against capsules fitted to the skinned athletes, and resolves it;
// anim.js keeps every pose clear (the skinned athletes check their drawn paddle again,
// athlete.js). Before this round, on these same poses: 16-23% of studio frames and 10-17% of
// match frames had the paddle more than 1 cm into the body, up to 13 cm.
// Run: node --test client/src/components/applets/pickleball/paddlebody.test.js
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import zlib from "node:zlib"
import { fileURLToPath } from "node:url"
import { PADDLE_SHAPE, bodyCapsules, paddleDepth, poseJoints, resolvePaddle, rollPaddle, skipFor } from "./paddlebody.js"
import { createAnim, updateAnim, situation, splitStep } from "./anim.js"
import { STATES, studioScript } from "./studio.js"
import { createMatch, step, handPos } from "./match.js"
import { STEP } from "./physics.js"
import { buildLibrary } from "./mm/library.js"
import { setMotionLibrary, setEnabled } from "./mm/runtime.js"
import { armRig, gripFrame, guardPaddleArm, paddleOfArm, armFK, solvePaddleArm } from "./arms.js"

const V = (x, y, z) => ({ x, y, z })
const lib = (() => {
  const dir = fileURLToPath(new URL("../../../../public/assets/pickleball/", import.meta.url))
  if (!fs.existsSync(dir + "motion.bin")) return null
  return buildLibrary(JSON.parse(fs.readFileSync(dir + "motion.json", "utf8")), new Uint8Array(zlib.gunzipSync(fs.readFileSync(dir + "motion.bin"))))
})()

// a man standing at the origin facing +z (his right at -x)
const STAND = { pelvis: V(0, 1, 0), neck: V(0, 1.5, 0), pelvisRight: V(-1, 0, 0), chestRight: V(-1, 0, 0), head: V(0, 1.63, 0), headUp: V(0, 1, 0), headFwd: V(0, 0, 1), shoulderP: V(-0.2, 1.42, 0), elbowP: V(-0.25, 1.15, 0.05), wristP: V(-0.25, 0.92, 0.15), hipL: V(0.1, 0.95, 0), kneeL: V(0.1, 0.52, 0.02), ankleL: V(0.1, 0.08, 0), hipR: V(-0.1, 0.95, 0), kneeR: V(-0.1, 0.52, 0.02), ankleR: V(-0.1, 0.08, 0) }

test("paddleDepth: the whole shape, exactly: through the belly, an edge into a thigh, the handle, clear", () => {
  const caps = bodyCapsules(STAND, { kind: "m" })
  // the face edge-on through the belly
  const belly = paddleDepth({ face: V(0, 1.1, 0.05), axis: V(1, 0, 0), normal: V(0, 0, 1) }, caps)
  assert.ok(belly.depth > 0.08 && (belly.part === "hips" || belly.part === "torso"), `${belly.depth} ${belly.part}`)
  // flat in front of the belly, 3 cm off its skin (the belly's front is ~13 cm in front of the spine)
  // (margin: report anything within 5 cm, not only what's in)
  const front = paddleDepth({ face: V(0, 1.1, 0.13 + 0.0085 + 0.03), axis: V(1, 0, 0), normal: V(0, 0, 1) }, caps, { margin: 0.05 })
  assert.ok(front.depth < -0.02 && front.depth > -0.04, `${front.depth}`)
  // only the face's corner (not its center) reaches the right thigh
  const corner = paddleDepth({ face: V(-0.26, 0.62, 0.0), axis: V(0, -1, 0), normal: V(0, 0, 1) }, caps)
  assert.ok(corner.depth > 0 && corner.part === "thighR" && corner.what === "face", JSON.stringify(corner))
  // the handle's butt in the hip, the face well out
  const butt = paddleDepth({ face: V(-0.15, 1.0 + PADDLE_SHAPE.faceFromGrip + 0.08, 0.2), axis: V(0, 1, 0), normal: V(0, 0, 1) }, caps)
  assert.ok(butt.what === "handle" || butt.depth < 0, JSON.stringify(butt))
  // far away
  assert.equal(paddleDepth({ face: V(0, 1.1, 0.7), axis: V(0, 1, 0), normal: V(0, 0, 1) }, caps).depth, -1)
  // the hand that holds the handle: never "in" its own forearm
  const skip = skipFor({})
  assert.equal(skip("forearmP", "handle"), true)
  assert.equal(skip("forearmP", "face"), false)
})

test("resolvePaddle: turns (and only if it must, moves) the paddle clear; rollPaddle keeps the face where the ball is", () => {
  const caps = bodyCapsules(STAND, { kind: "m" })
  for (const p of [
    { face: V(-0.16, 0.65, 0.05), axis: V(0, -1, 0), normal: V(1, 0, 0) }, // hanging into the thigh
    { face: V(-0.05, 1.3, 0.12), axis: V(0.7, 0.7, 0), normal: V(0, 0, 1) }, // an edge in the chest
  ]) {
    const r = resolvePaddle(p, caps, { pivot: STAND.wristP, margin: 0.015 })
    assert.ok(r.before > 0.01 && r.depth < 0, `${r.before} -> ${r.depth}`)
    assert.ok(r.turned < 1.01 && Math.hypot(r.shift.x, r.shift.y, r.shift.z) < 0.101)
  }
  // a punch at the chest with the handle pointing back into it: rolled about the face's normal
  const p = { face: V(0, 1.25, 0.32), axis: V(0, 0, 1), normal: V(0, 1, 0) }
  const r = rollPaddle(p, caps, { margin: 0.015 })
  assert.ok(r.before > 0.05 && r.depth <= -0.015, `${r.before} -> ${r.depth}`)
  assert.deepEqual(r.paddle.face, p.face)
  assert.ok(Math.abs(r.paddle.axis.y) < 1e-9, "the roll is about the normal only")
})

// a T-pose arm like the MakeHuman athletes' (arms.test.js), for the drawn arm's guard
const LEFT = { clavicle: V(0.023, 1.483, 0.024), upperarm: V(0.24, 1.454, 0.019), lowerarm: V(0.505, 1.454, 0.019), hand: V(0.783, 1.454, 0.019), middle_01: V(0.899, 1.447, 0.027), thumb_01: V(0.823, 1.448, 0.05) }
const I = { x: 0, y: 0, z: 0, w: 1 }
const REST = { spine_03: { wp: V(0, 1.2, -0.03), wq: I }, pelvis: { wp: V(0, 1.0, 0), wq: I }, neck_01: { wp: V(0, 1.5, 0), wq: I } }
for (const [k, p] of Object.entries(LEFT)) {
  REST[k + "_l"] = { wp: p, wq: I }
  REST[k + "_r"] = { wp: V(-p.x, p.y, p.z), wq: I }
}
test("guardPaddleArm: the drawn arm's hand turned at the wrist until the paddle clears the thigh; nothing at contact", () => {
  const rig = armRig(REST, "r", 1, gripFrame(REST, "r"))
  const S = REST.upperarm_r.wp
  const chest = { right: V(-1, 0, 0), up: V(0, 1, 0), fwd: V(0, 0, 1) }
  // the paddle hanging from a hand at the hip, its face into the thigh
  const res = solvePaddleArm(rig, S, { face: V(-0.17, 0.62, 0.06), axis: V(0.05, -1, 0.1), normal: V(1, 0, 0) }, chest, { faceFromGrip: 0.2158, exact: 1 })
  const { E, W } = armFK(rig, S, res)
  const caps = bodyCapsules({ ...STAND, shoulderP: S, elbowP: E, wristP: W, handTipO: null }, { kind: "m" })
  const before = paddleDepth(paddleOfArm(rig, res, 0.2158, W), caps, { skip: skipFor({}) }).depth
  assert.ok(before > 0.01, `the set-up pierces the thigh (${before})`)
  const g = guardPaddleArm(rig, S, res, caps, { faceFromGrip: 0.2158, skip: skipFor({}) })
  const after = paddleDepth(paddleOfArm(rig, g.res, 0.2158, W), caps, { skip: skipFor({}) }).depth
  assert.ok(after < before - 0.01 && (after < 0.005 || g.shift), `${before} -> ${after}`)
  // at contact (keep 0) the face is the ball's: untouched
  assert.equal(guardPaddleArm(rig, S, res, caps, { faceFromGrip: 0.2158, keep: 0 }).res, res)
})

// every frame of a pose sequence: how far the paddle is into the body, and where
const measure = (pose, out) => {
  const caps = bodyCapsules(poseJoints(pose), { kind: "any" })
  const info = pose.info || {}
  const near = Math.hypot(pose.wristO.x - pose.wristP.x, pose.wristO.y - pose.wristP.y, pose.wristO.z - pose.wristP.z) < 0.2
  const r = paddleDepth(pose.paddle, caps, { skip: skipFor({ two: !!info.two, cup: !!info.offGrip && near }) })
  const contact = info.tRel !== null && info.tRel !== undefined && Math.abs(info.tRel) < 0.17 && info.stroke > 0.3
  out.n++
  if (r.depth > 0.01) out.over1++
  if (r.depth > 0.05) out.over5++
  // the trunk, head and legs (the other arm moves; at contact the face is where the ball is)
  if (!contact && r.depth > 0.01 && !/O$|P$/.test(r.part)) out.body++
  // (round 2: contact frames by stroke, |tRel| < 0.17 s)
  if (contact && out.styles) {
    const S = (out.styles[info.style || "?"] ||= { n: 0, over1: 0 })
    S.n++
    if (r.depth > 0.01) S.over1++
  }
  return r
}
const pct = (S) => `${((100 * S.over1) / Math.max(1, S.n)).toFixed(1)}% of ${S.n}`

test("studio states (ready, every stroke, Ernes and lunges, the between-points routine, celebrations, sulks, taps): the paddle stays out of the body", { skip: !lib }, () => {
  setMotionLibrary(lib)
  const tot = { n: 0, over1: 0, over5: 0, body: 0 }
  const worst = []
  for (const mm of [true, false]) {
    setEnabled(mm)
    for (const state of STATES) {
      const S = { n: 0, over1: 0, over5: 0, body: 0 }
      for (const hand of [1, -1]) {
        const sc = studioScript(state, 0, -4.6, { hand, twoHand: hand < 0 && /bh|backhand/.test(state) })
        const s0 = sc.at(0)
        const a = createAnim(s0.x, s0.z, 0)
        a.useMM = mm
        const events = [...(sc.events || [])]
        for (let t = 0; t <= sc.T; t += 1 / 60) {
          while (events.length && events[0][0] <= t) events.shift()[1](a)
          const pose = updateAnim(a, sc.at(t), 1 / 60)
          if (t > 0.1) measure(pose, S)
        }
      }
      for (const k of Object.keys(tot)) tot[k] += S[k]
      worst.push([`${mm ? "mm" : "pr"}:${state}`, S.over1 / S.n])
    }
  }
  setEnabled(false)
  worst.sort((a, b) => b[1] - a[1])
  // (main: 16% of these frames more than 1 cm in, motion matching, 23% procedural; >5 cm 2.4%)
  assert.ok(tot.over1 / tot.n < 0.04, `${((100 * tot.over1) / tot.n).toFixed(1)}% of frames > 1 cm; worst ${worst.slice(0, 4).map(([k, v]) => `${k} ${(100 * v).toFixed(0)}%`).join(", ")}`)
  assert.ok(tot.over5 / tot.n < 0.003, `${tot.over5} frames > 5 cm`)
  assert.ok(tot.body / tot.n < 0.008, `${tot.body} frames into the trunk, head or legs`)
})

test("simulated matches (motion matching and procedural): the paddle out of the body, between points and in rallies", { skip: !lib }, () => {
  setMotionLibrary(lib)
  for (const mm of [true, false]) {
    setEnabled(mm)
    const tot = { n: 0, over1: 0, over5: 0, body: 0, styles: {} }
    const between = { n: 0, over1: 0, over5: 0, body: 0 }
    const m = createMatch({ doubles: true, level: "pro", seed: 3, scoring: "rally" })
    m.autoplay = true
    const anims = m.players.map((p) => {
      const a = createAnim(p.x, p.z, p.team === 0 ? Math.PI : 0)
      a.useMM = mm
      a.mmEvery = 0.1
      return a
    })
    for (let f = 0; f < 60 * 50 && m.phase !== "over"; f++) {
      const hits = []
      for (let k = 0; k < 4; k++) {
        step(m, STEP)
        for (const e of m.events) if (e.type === "hit") hits.push(e)
        m.events.length = 0
      }
      m.players.forEach((p, i) => {
        for (const e of hits) if (e.team !== p.team) splitStep(anims[i], { fallback: true })
        const pose = updateAnim(anims[i], situation(m, p), 1 / 60)
        measure(pose, tot)
        if (pose.info?.between) measure(pose, between)
      })
    }
    // (main, this match's first 50 s: motion matching 9.6% > 1 cm, procedural 17%; walking
    // between points 43% in the browser)
    const tag = mm ? "motion matching" : "procedural"
    assert.ok(tot.n > 10000)
    assert.ok(tot.over1 / tot.n < 0.02, `${tag}: ${((100 * tot.over1) / tot.n).toFixed(1)}% > 1 cm`)
    assert.ok(tot.over5 / tot.n < 0.005, `${tag}: ${tot.over5} frames > 5 cm`)
    assert.ok(between.over1 / Math.max(1, between.n) < 0.02, `${tag}: between points ${between.over1}/${between.n}`)
    // at contact, by stroke (2026-10-08 round 2: the serve's ball beside the front foot and the
    // swing outside the back knee, the drive's finish out in front, low balls met out in front,
    // the hand kept out of the trunk and the body making room for a ball at it). Main, this
    // match, motion matching: 8.8% of contact frames > 1 cm in (serve 23%, drive 11%, dink 9%,
    // punch 5%). What's left is mostly your own player with a low ball at their knee (nothing
    // moves your player: it only leans) and balls taken behind the body.
    const all = Object.values(tot.styles).reduce((a, S) => ({ n: a.n + S.n, over1: a.over1 + S.over1 }), { n: 0, over1: 0 })
    assert.ok(all.over1 / all.n < 0.06, `${tag}: contact frames ${pct(all)}`)
    for (const [style, S] of Object.entries(tot.styles)) if (S.n > 150) assert.ok(S.over1 / S.n < 0.14, `${tag}: ${style} at contact ${pct(S)}`)
  }
  setEnabled(false)
})

// Balls at the body (2026-10-08 round 2): a punch volley at the chest, a chest-high ball on the
// backhand, a forehand jammed at the hip, the serve. The paddle face stays on the ball and the
// paddle out of the body (main: 28%, 33% and 22% of these frames > 1 cm in, motion matching);
// a computer player's hips make room, a person's player only leans (nothing moves their feet or
// where they stand: the hips stay put).
test("balls at the body and the serve: the face on the ball, the paddle out of the body; a person's player only leans", { skip: !lib }, () => {
  setMotionLibrary(lib)
  const caps = []
  for (const mm of [true, false]) {
    setEnabled(mm)
    for (const state of ["volley-body", "body-bh", "jam-fh", "serve"]) {
      for (const person of [false, true]) {
        let n = 0
        let over = 0
        let maxHip = 0
        for (const hand of [1, -1]) {
          const sc = studioScript(state, 0, -4.6, { hand })
          const a = createAnim(sc.at(0).x, sc.at(0).z, 0)
          a.useMM = mm
          for (let t = 0; t <= sc.T; t += 1 / 60) {
            const pose = updateAnim(a, { ...sc.at(t), person }, 1 / 60)
            if (a.roomPelvis) maxHip = Math.max(maxHip, Math.hypot(a.roomPelvis.x, a.roomPelvis.z))
            if (t < 0.1) continue
            bodyCapsules(poseJoints(pose), { kind: "any", out: caps })
            const info = pose.info
            const near = Math.hypot(pose.wristO.x - pose.wristP.x, pose.wristO.y - pose.wristP.y, pose.wristO.z - pose.wristP.z) < 0.2
            const r = paddleDepth(pose.paddle, caps, { skip: skipFor({ two: !!info.two, cup: !!info.offGrip && near }) })
            n++
            if (r.depth > 0.01) over++
            // the face meets the ball
            if (Math.abs(t - 0.7) < 1 / 120) {
              const c = sc.contact
              const d = Math.hypot(pose.paddle.face.x - c.x, pose.paddle.face.y - c.y, pose.paddle.face.z - c.z)
              assert.ok(d < 0.07, `${state} ${mm ? "mm" : "pr"} hand ${hand}: face ${(d * 100).toFixed(1)} cm off the ball`)
            }
          }
        }
        // (a person's player only leans: the hips stay, so a ball at the belly can still touch them)
        assert.ok(over / n < (person ? 0.15 : 0.1), `${state} ${mm ? "mm" : "pr"}${person ? " person" : ""}: ${over}/${n} frames > 1 cm in`)
        if (person) assert.equal(maxHip, 0, `${state}: a person's hips never move to make room`)
      }
    }
  }
  setEnabled(false)
  // the serve's ball drops out beside the front foot: on the paddle side, in front
  const m = createMatch({ doubles: true, level: "pro", seed: 3, scoring: "rally" })
  for (const p of m.players) {
    const b = handPos(m, p)
    const side = (b.x - p.x) * (p.team === 0 ? 1 : -1) * (p.hand || 1)
    assert.ok(side > 0.24, `ball beside the server (${side.toFixed(2)} m to the paddle side)`)
  }
})
