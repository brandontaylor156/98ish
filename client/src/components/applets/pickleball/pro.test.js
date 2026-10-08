// Pickleball 98: pro movement and handedness (pro.js, anim.js, strokes.js, locomotion.js,
// locker.js, match.js, ai.js). node --test client/src/components/applets/pickleball/pro.test.js
import test from "node:test"
import assert from "node:assert/strict"
import { CROSS, LUNGE, READY, SPLIT, footworkFor, lungePlan, quickSteps, readyFor, shouldSplit, splitHeight, stepIn, weightFor } from "./pro.js"
import { createAnim, situation, splitStep, updateAnim } from "./anim.js"
import { blendSpace } from "./locomotion.js"
import { DEFAULT_LOOK, LOOK_IDS, PLAYS, PRO_STYLES, characterLook, lookForPlayer, randomLook, validateLook } from "./locker.js"
import { CHARACTERS } from "./looks.js"
import { createMatch, handPos, seeded, step } from "./match.js"
import { middleForehand } from "./ai.js"
import { STEP } from "./physics.js"
import { rightSign } from "./rules.js"

const V = (x = 0, y = 0, z = 0) => ({ x, y, z })
const sub = (a, b) => V(a.x - b.x, a.y - b.y, a.z - b.z)
const len = (a) => Math.hypot(a.x, a.y, a.z)
const angle3 = (a, b, c) => {
  const u = sub(a, b)
  const v = sub(c, b)
  return (Math.acos(Math.max(-1, Math.min(1, (u.x * v.x + u.y * v.y + u.z * v.z) / (len(u) * len(v))))) * 180) / Math.PI
}
const knee = (p, s) => 180 - angle3(p["hip" + s], p["knee" + s], p["ankle" + s])
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]

// a player at (0, 0) facing +z (the body's right is -x)
const base = (extra = {}) => ({ x: 0, z: 0, vx: 0, vz: 0, facing: 0, ball: V(0.4, 0.9, 4.5), holding: false, swing: null, prep: null, charging: false, between: false, atNet: true, hand: 1, ...extra })
// a stroke at contact time T0 for a ball at c (prep, then the swing)
const stroke = (a, { kind, c, T0 = 0.7, after = 0.4, extra = {} }, each) => {
  let pose
  for (let i = 0; i <= Math.round((T0 + after) * 60); i++) {
    const t = i / 60
    const s = t < T0 ? base({ ...extra, prep: { ttc: T0 - t, x: c.x, y: c.y, z: c.z, kind, forward: true }, ball: { ...c } }) : base({ ...extra, swing: { t: t - T0, kind, x: c.x, y: c.y, z: c.z }, ball: { ...c } })
    pose = updateAnim(a, s, 1 / 60)
    each?.(pose, t, s)
  }
  return pose
}

test("the ready position at the kitchen: wide (PPA footage ~0.65 m), tall knees, hips back, chest over the knees, paddle out front", () => {
  for (const twoHand of [false, true]) {
    const a = createAnim(0, 0, 0)
    let p
    for (let i = 0; i < 120; i++) p = updateAnim(a, base({ twoHand }), 1 / 60)
    const stance = Math.hypot(p.ankleL.x - p.ankleR.x, p.ankleL.z - p.ankleR.z)
    const k = (knee(p, "L") + knee(p, "R")) / 2
    const trunk = (Math.acos(p.spine.y) * 180) / Math.PI
    const shoulderY = (p.shoulderL.y + p.shoulderR.y) / 2
    const ahead = p.paddle.face.z - p.neck.z
    assert.ok(stance >= 0.54 && stance <= 0.7, `feet wider than the shoulders (${stance.toFixed(2)} m)`)
    // (the tour stands taller than the old coaching numbers: knees ~24 deg of bend while the
    // other side hits, from a wide base; docs/ppa-reference.md)
    assert.ok(k >= 15 && k <= 45, `knees softly bent (${k.toFixed(0)} deg)`)
    assert.ok(trunk >= 18 && trunk <= 32, `chest over the knees (${trunk.toFixed(0)} deg)`)
    assert.ok(p.pelvis.z < -0.03, `hips back (${p.pelvis.z.toFixed(2)})`)
    assert.ok(p.paddle.face.y < shoulderY && p.paddle.face.y > p.pelvis.y + 0.15, `paddle between the waist and the chest (${p.paddle.face.y.toFixed(2)})`)
    assert.ok(ahead > 0.2, `paddle out in front (${ahead.toFixed(2)} m)`)
    // the tip toward the backhand side (a right-hander's left, +x here)
    assert.ok(p.paddle.axis.x > 0.1, `tip toward the backhand side (${p.paddle.axis.x.toFixed(2)})`)
    // two-handers: the other hand on the handle
    const hands = len(sub(p.wristO, p.wristP))
    if (twoHand) assert.ok(hands < 0.11, `two hands on the handle (${hands.toFixed(2)} m)`)
    else assert.ok(hands > 0.1, `one hand on the handle (${hands.toFixed(2)})`)
  }
  assert.ok(readyFor("twohand", true).hand.y > readyFor("allcourt", true).hand.y, "a two-hander holds it higher")
  // (PPA footage: lower at the baseline (hips ~85% of upright) than at the kitchen (~90%), on a
  // narrower base; the kitchen line is the widest)
  assert.ok(READY.base.allcourt.crouch > READY.mid.allcourt.crouch && READY.mid.allcourt.crouch > READY.net.allcourt.crouch, "lower at the baseline than at the kitchen")
  assert.ok(READY.net.allcourt.stance > READY.base.allcourt.stance, "wider at the kitchen")
})

test("left-handed: the whole body is the mirror image of a right-hander's", () => {
  const run = (hand) => {
    const a = createAnim(0, 0, 0)
    const out = []
    // the ready position, then a forehand drive on the paddle side
    for (let i = 0; i < 60; i++) updateAnim(a, base({ hand, atNet: false }), 1 / 60)
    stroke(a, { kind: "drive", c: V(-0.62 * hand, 0.85, 0.45), extra: { hand, atNet: false } }, (p, t) => {
      if (Math.abs(t - 0.5) < 1e-6 || Math.abs(t - 0.7) < 1e-6 || Math.abs(t - 0.9) < 1e-6) out.push({ wrist: { ...p.wristP }, face: { ...p.paddle.face }, side: p.info.side, shoulder: { ...p.paddleShoulder } })
    })
    return out
  }
  const R = run(1)
  const L = run(-1)
  for (let i = 0; i < R.length; i++) {
    assert.equal(R[i].side, 1, "the right-hander hits a forehand")
    assert.equal(L[i].side, 1, "so does the left-hander (on their left)")
    assert.ok(Math.abs(R[i].wrist.x + L[i].wrist.x) < 0.04, `paddle hands mirrored (${R[i].wrist.x.toFixed(3)} vs ${L[i].wrist.x.toFixed(3)})`)
    assert.ok(Math.abs(R[i].wrist.y - L[i].wrist.y) < 0.03 && Math.abs(R[i].wrist.z - L[i].wrist.z) < 0.04, "same height and depth")
    assert.ok(Math.sign(L[i].shoulder.x) === 1 && Math.sign(R[i].shoulder.x) === -1, "the paddle in the left hand (left is +x facing +z)")
  }
  // at contact both faces are on the ball
  assert.ok(len(sub(R[1].face, V(-0.62, 0.85, 0.45))) < 0.03 && len(sub(L[1].face, V(0.62, 0.85, 0.45))) < 0.03, "paddle on the ball for both")
})

test("left-handed: forehand and backhand sides follow the hand (strokes, match labels, the server's ball hand)", () => {
  // a ball on the player's left: a backhand for a right-hander, a forehand for a left-hander
  for (const [hand, want] of [[1, -1], [-1, 1]]) {
    const a = createAnim(0, 0, 0)
    const p = stroke(a, { kind: "drive", c: V(0.6, 0.85, 0.45), extra: { hand, atNet: false } })
    assert.equal(p.info.side, want, `hand ${hand}: side ${p.info.side}`)
  }
  // in a match: every hit's fh/bh label agrees with the player's hand
  const m = createMatch({ doubles: true, level: "pro", seed: 11, roster: [
    { id: "L1", team: 0, ctrl: "cpu", level: "pro", look: { plays: "left" } },
    { id: "R1", team: 0, ctrl: "cpu", level: "pro" },
    { id: "L2", team: 1, ctrl: "cpu", level: "pro", look: { plays: "left", backhand: "two" } },
    { id: "R2", team: 1, ctrl: "cpu", level: "pro" },
  ] })
  m.autoplay = true
  assert.equal(m.players[0].hand, -1)
  assert.equal(m.players[1].hand, 1)
  assert.equal(m.players[2].twoHand, true)
  let checked = 0
  for (let i = 0; i < 60 * 240 * 4 && checked < 60; i++) {
    const at = m.players.map((q) => ({ x: q.x }))
    step(m, STEP)
    for (const e of m.events) {
      if (e.type !== "hit" || e.kind === "serve") continue
      const idx = m.players.findIndex((q) => q.id === e.player)
      const q = m.players[idx]
      const local = (e.x - at[idx].x) * rightSign(q.team) * q.hand
      if (Math.abs(local) < 0.15) continue
      assert.equal(e.hand, local > 0 ? "fh" : "bh", `${q.id}: ${e.hand} for a ball ${local.toFixed(2)} m to the paddle side`)
      checked++
    }
    m.events.length = 0
  }
  assert.ok(checked > 20, `plenty of hits checked (${checked})`)
  // the server holds the ball in front of their paddle side
  const s = m.players[0]
  assert.ok((handPos(m, s).x - s.x) * rightSign(s.team) < 0, "a left-hander's ball hand is on their left")
  // doubles: the forehand takes the middle
  assert.equal(middleForehand({ hand: 1, lane: "left" }, 0.2), true)
  assert.equal(middleForehand({ hand: 1, lane: "right" }, 0.2), false)
  assert.equal(middleForehand({ hand: -1, lane: "right" }, 0.2), true)
  assert.equal(middleForehand({ hand: 1, lane: "left" }, 1.2), false, "only down the middle")
})

test("the split step: lands as the other side hits, a small hop and a sink", () => {
  assert.equal(shouldSplit(null, 9), false)
  assert.equal(shouldSplit(0.5, 9), false, "not yet")
  assert.equal(shouldSplit(SPLIT.lead, 9), true, "off the court one hop's time before")
  assert.equal(shouldSplit(0.05, 0.2), false, "not twice in a row")
  assert.equal(splitHeight(-0.1), 0)
  assert.ok(splitHeight(SPLIT.lead / 2) > 0.02, "up on the toes")
  assert.ok(splitHeight(SPLIT.lead + (SPLIT.dur - SPLIT.lead) / 2) < -0.02, "sinks on the landing (a little: hips ~90% of upright at the far contact)")
  assert.equal(splitHeight(SPLIT.dur + 0.01), 0)
  // the anim starts it itself from oppHit; the engine's late fallback does nothing then
  const a = createAnim(0, 0, 0)
  for (let i = 0; i < 30; i++) updateAnim(a, base(), 1 / 60)
  updateAnim(a, base({ oppHit: 0.1 }), 1 / 60)
  assert.ok(a.hop > 0, "split started")
  assert.equal(splitStep(a, { fallback: true }), false, "the fallback skips a fresh split")
  // in a pro match the landings fall on the other side's hits
  const m = createMatch({ doubles: true, level: "pro", seed: 3 })
  m.autoplay = true
  const anims = m.players.map((q) => createAnim(q.x, q.z, q.team === 0 ? Math.PI : 0))
  const land = m.players.map(() => null)
  const errs = []
  for (let f = 0; f < 60 * 60; f++) {
    const hits = []
    for (let k = 0; k < 4; k++) {
      step(m, STEP)
      for (const e of m.events) if (e.type === "hit") hits.push({ team: e.team, t: m.t })
      m.events.length = 0
    }
    m.players.forEach((q, i) => {
      const before = anims[i].hop
      updateAnim(anims[i], situation(m, q), 1 / 60)
      if (anims[i].hop > before + 1e-6) land[i] = m.t + SPLIT.lead - (1 / 60)
      for (const h of hits) if (h.team !== q.team && land[i] !== null) {
        if (Math.abs(land[i] - h.t) < 0.4) errs.push(land[i] - h.t)
        land[i] = null
      }
    })
  }
  assert.ok(errs.length > 40, `splits measured (${errs.length})`)
  assert.ok(Math.abs(median(errs)) < 0.04, `landing on the other side's contact (median ${(median(errs) * 1000).toFixed(0)} ms)`)
})

test("footwork: shuffles for small moves, a crossover for fast wide ones; quick small steps at the kitchen", () => {
  assert.equal(footworkFor({ lat: 1.2, fwd: 0, dist: 1.5 }), "shuffle")
  assert.equal(footworkFor({ lat: 2.6, fwd: 0, dist: 1.6 }), "cross")
  assert.equal(footworkFor({ lat: -2.6, fwd: 0.2, dist: 1.6 }), "cross", "either way")
  assert.equal(footworkFor({ lat: 2.6, fwd: 0, dist: 0.5 }), "shuffle", "nearly there: shuffle")
  assert.equal(footworkFor({ lat: 2.6, fwd: 3, dist: 2 }), "shuffle", "not sideways")
  assert.equal(footworkFor({ lat: 1.6, prev: "cross", dist: 1 }), "cross", "keeps crossing while still quick")
  assert.equal(footworkFor({ lat: CROSS.off - 0.1, prev: "cross" }), "shuffle")
  assert.equal(footworkFor({ lat: 3, between: true }), "shuffle")
  // at the kitchen the same speed is more, shorter steps
  assert.ok(quickSteps(0.8, true) > 1.3 && quickSteps(0.8, false) === 1 && quickSteps(3, true) < 1.05)
  const slow = blendSpace({ vx: -0.9, vz: 0, yaw: 0 })
  const quick = blendSpace({ vx: -0.9, vz: 0, yaw: 0, quick: quickSteps(0.9, true) })
  assert.ok(quick.sps > slow.sps * 1.3 && quick.stride < slow.stride * 0.8, `quick ${quick.sps.toFixed(2)} steps/s, ${quick.stride.toFixed(2)} m`)
  assert.ok(quick.clear < slow.clear, "and lower")
})

test("the lunge: a low wide ball steps out long, front knee bent, back leg long", () => {
  assert.equal(lungePlan(V(0.35, 0, 0.5), 0.3), null, "within reach: no lunge")
  assert.equal(lungePlan(V(0.5, 0, 0.6), 1.0), null)
  const low = lungePlan(V(1.1, 0, 0.5), 0.25)
  assert.ok(low && low.foot === 1 && low.spot.x > 0.6 && low.crouch > 0.1, "a long step out with the right foot")
  const high = lungePlan(V(1.1, 0, 0.5), 1.1)
  assert.ok(high && high.spot.x <= 0.55 && high.crouch < low.crouch, "a ball at the chest: a shorter step out")
  assert.equal(lungePlan(V(-1.0, 0, 0.4), 0.3).foot, 0, "the left foot to the left")
  assert.ok(lungePlan(V(0.1, 0, LUNGE.front + 0.3), 0.3), "a low ball far in front: lunge forward")
  // in the body, at contact: the front knee bent, the back leg long, the paddle on the ball
  // (the player's right is -x: a ball 1.1 m out to the right, 25 cm up)
  const a = createAnim(0, 0, 0)
  const c = V(-1.1, 0.25, 0.55)
  const p = stroke(a, { kind: "dink", c, after: 0 })
  assert.ok(p.footR.planted && p.footL.planted, "both feet down")
  assert.ok(knee(p, "R") > 75, `front knee bent (${knee(p, "R").toFixed(0)} deg)`)
  assert.ok(knee(p, "L") < 45, `back leg long (${knee(p, "L").toFixed(0)} deg)`)
  assert.ok(Math.hypot(p.footL.x - p.footR.x, p.footL.z - p.footR.z) > 0.8, "a long lunge")
  assert.ok(len(sub(p.paddle.face, c)) < 0.06, `paddle at the ball (${len(sub(p.paddle.face, c)).toFixed(3)} m)`)
})

test("strokes: compact take-backs, weight forward through drives, stepping in, two hands on a two-handed backhand", () => {
  // the drive's take-back stays about the ball's height, not up by the head
  const a = createAnim(0, 0, 0)
  let topBack = 0
  stroke(a, { kind: "drive", c: V(-0.6, 0.85, 0.45), extra: { atNet: false } }, (p, t) => {
    if (t > 0.3 && t < 0.55) topBack = Math.max(topBack, p.wristP.y)
  })
  assert.ok(topBack < 1.2, `compact take-back (hand up to ${topBack.toFixed(2)} m)`)
  assert.ok(weightFor("drive", "wind", 1) < 0 && weightFor("drive", "after", 1) > 0.05, "back, then onto the front foot")
  assert.equal(weightFor("serve", "none", 1), 0)
  assert.equal(stepIn("drive", 1, V(0.6, 0, 0.4), 0).foot, 0, "a right-hander's forehand steps in with the left foot")
  assert.equal(stepIn("drive", -1, V(-0.6, 0, 0.4), 0).foot, 1, "the backhand with the right")
  assert.equal(stepIn("dink", 1, V(0.6, 0, 0.4), 0), null, "a dink doesn't step in")
  assert.equal(stepIn("drive", 1, V(0.6, 0, 0.4), 2), null, "nor a drive on the run")
  // two-handed backhand: the other hand stays on the handle from the take-back to the finish
  for (const twoHand of [true, false]) {
    const b = createAnim(0, 0, 0)
    let maxGap = 0
    let minGap = 9
    stroke(b, { kind: "drive", c: V(0.6, 0.85, 0.45), extra: { atNet: false, twoHand } }, (p, t) => {
      if (t > 0.35 && t < 0.95) {
        const g = len(sub(p.wristO, p.wristP))
        maxGap = Math.max(maxGap, g)
        minGap = Math.min(minGap, g)
      }
    })
    if (twoHand) assert.ok(maxGap < 0.12, `both hands on the paddle (gap up to ${maxGap.toFixed(3)} m)`)
    else assert.ok(maxGap > 0.3, `one-handed: the other arm goes out for balance (${maxGap.toFixed(2)} m)`)
  }
})

test("looks: which hand and the pro style are saved, checked, and old saves play right-handed", () => {
  assert.deepEqual(LOOK_IDS.plays, PLAYS.map((p) => p.id))
  assert.deepEqual(LOOK_IDS.backhand, PRO_STYLES.map((p) => p.id))
  assert.equal(DEFAULT_LOOK.plays, "right")
  assert.equal(validateLook({ plays: "left", backhand: "two" }).plays, "left")
  assert.equal(validateLook({ plays: "left", backhand: "two" }).backhand, "two")
  assert.equal(validateLook({ plays: "both", backhand: 2 }).plays, "right", "junk: right-handed")
  assert.equal(validateLook({ plays: "both", backhand: 2 }).backhand, "one")
  // about one computer player in ten is left-handed (Kenji); an older save of him plays right
  const lefties = CHARACTERS.filter((c) => characterLook(c.id).plays === "left")
  assert.equal(lefties.length, 1)
  assert.ok(Math.abs(lefties.length / CHARACTERS.length - 0.1) < 0.01)
  assert.equal(validateLook({ v: 2, shirt: "#ffffff" }, characterLook("kenji")).plays, "right", "an old save plays right-handed")
  assert.equal(validateLook({ v: 3, shirt: "#ffffff" }, characterLook("kenji")).plays, "left")
  assert.equal(lookForPlayer({}, { character: "kenji", ai: true }).plays, "left")
  // a random kit keeps the hand
  const rand = seeded(5)
  for (let i = 0; i < 20; i++) assert.equal(randomLook(rand, characterLook("kenji")).plays, "left")
  // and the match reads it
  const m = createMatch({ doubles: false, seed: 1, roster: [
    { id: "you", team: 0, ctrl: "human", look: validateLook({ plays: "left" }) },
    { id: "cpu", team: 1, ctrl: "cpu", look: characterLook("rosa") },
  ] })
  assert.equal(m.players[0].hand, -1)
  assert.equal(m.players[1].twoHand, true)
  assert.equal(situation(m, m.players[0]).hand, -1)
  assert.equal(situation(m, m.players[1]).twoHand, true)
})
