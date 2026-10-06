// Pickleball 98 gameplay feel (2026-10-06 round): realistic rally lengths at the top levels,
// overheads that reach high balls (a jump), and a camera that never eases through a player.
// node --test client/src/components/applets/pickleball/feel.test.js
import test from "node:test"
import assert from "node:assert/strict"
import { createMatch, step } from "./match.js"
import { LEVELS, senseOf } from "./ai.js"
import { OVERHEAD, overheadLift } from "./pro.js"
import { blocker, easeClear } from "./camera.js"
import { createAnim, updateAnim } from "./anim.js"

// all-computer doubles at one level; shots per point
const rallies = (level, seeds) => {
  const shots = []
  for (const seed of seeds) {
    const roster = [0, 1].flatMap((team) => [1, 2].map((k) => ({ id: `t${team}p${k}`, team, ctrl: "cpu", level, name: `P${team}${k}` })))
    const m = createMatch({ doubles: true, level, scoring: "rally", seed, roster })
    let hits = 0
    let steps = 0
    while (m.phase !== "over" && steps < 240 * 60 * 30) {
      step(m)
      steps++
      for (const e of m.events) {
        if (e.type === "hit") hits++
        if (e.type === "point") {
          shots.push(hits)
          hits = 0
        }
      }
      m.events.length = 0
    }
  }
  shots.sort((a, b) => a - b)
  return { mean: shots.reduce((s, v) => s + v, 0) / shots.length, p90: shots[Math.floor(shots.length * 0.9)], max: shots.at(-1), n: shots.length }
}

test("rally length: Pro and Legend points last like real pro doubles (not 14-19 shots on average)", () => {
  // before this round: Pro mean 13.9 (p90 27, max 50), Legend 18.7 (p90 37, max 64); real pro
  // doubles average roughly 8-11 shots. Club stays shorter, Rookie shortest.
  const club = rallies("intermediate", [1, 2])
  const pro = rallies("pro", [1, 2, 3])
  const legend = rallies("legend", [1, 2, 3])
  for (const [name, r] of [["pro", pro], ["legend", legend]]) {
    assert.ok(r.mean >= 6.5 && r.mean <= 13, `${name} mean ${r.mean.toFixed(1)} shots`)
    assert.ok(r.p90 <= 26, `${name} p90 ${r.p90}`)
  }
  assert.ok(club.mean < pro.mean, `club ${club.mean.toFixed(1)} shorter than pro ${pro.mean.toFixed(1)}`)
})

test("shot sense is its own setting: top levels attack lower balls without losing their judgment", () => {
  assert.equal(senseOf(LEVELS.pro), 1)
  assert.equal(senseOf(LEVELS.legend), 1)
  assert.equal(senseOf(LEVELS.intermediate), 0.5) // (read off the attack threshold, as before)
  assert.equal(senseOf(LEVELS.beginner), 0)
  assert.ok(LEVELS.legend.attack < LEVELS.intermediate.attack + 0.05)
})

test("overheads: no jump below standing reach; a jump that peaks at the contact and lands after", () => {
  assert.equal(overheadLift(1.9, 0), 0)
  assert.equal(overheadLift(OVERHEAD.reach, 0), 0)
  const need = 2.35 - OVERHEAD.reach
  assert.ok(Math.abs(overheadLift(2.35, 0) - need) < 1e-9, "the peak is exactly what's needed")
  assert.ok(overheadLift(2.35, -0.15) > 0 && overheadLift(2.35, -0.15) < need, "rising before the contact")
  assert.ok(overheadLift(2.35, 0.15) > 0 && overheadLift(2.35, 0.15) < need, "falling after")
  assert.equal(overheadLift(2.35, -OVERHEAD.up - 0.01), 0)
  assert.equal(overheadLift(2.35, OVERHEAD.down + 0.01), 0)
  assert.ok(overheadLift(3.5, 0) <= OVERHEAD.max + 1e-9, "never more than a real jump")
})

test("overheads: the paddle face meets balls up to 2.45 m (was 6.5 cm short at 2.15, 35 cm at 2.45)", () => {
  const x = 0
  const z = -4.6
  const base = (t, extra = {}) => ({ x, z, vx: 0, vz: 0, facing: 0, ball: { x, y: 1, z: z + 6 }, holding: false, swing: null, prep: null, charging: false, between: false, atNet: false, hand: 1, twoHand: false, ...extra })
  for (const y of [2.15, 2.3, 2.45]) {
    const c = { x: x - 0.25, y, z: z + 0.3 }
    const T0 = 0.7
    const at = (t) => (t < T0 ? base(t, { prep: { ttc: T0 - t, x: c.x, y: c.y, z: c.z, kind: "smash", hand: "fh", forward: true }, ball: { ...c } }) : base(t, { swing: { t: t - T0, kind: "smash", hand: "fh", x: c.x, y: c.y, z: c.z }, ball: { ...c } }))
    const a = createAnim(x, z, 0)
    let best = 9
    for (let t = 0; t <= T0 + 1e-4; t += 1 / 60) {
      const pose = updateAnim(a, at(t), 1 / 60)
      if (t > T0 - 0.05) best = Math.min(best, Math.hypot(pose.paddle.face.x - c.x, pose.paddle.face.y - c.y, pose.paddle.face.z - c.z))
    }
    assert.ok(best < 0.02, `face ${(best * 100).toFixed(1)} cm from a ${y} m ball`)
  }
})

test("camera: the eased position is cleared too, so it never passes through a player on its way", () => {
  // a camera easing from one end to the other, straight through a player standing in its path
  const bodies = [{ x: 0, z: 0 }]
  const look = { x: 0, y: 0.5, z: -8 }
  const target = { x: 0, y: 1.6, z: -3 }
  let naive = { x: 0, y: 1.6, z: 6 }
  let cleared = { ...naive }
  let naiveBlocked = 0
  let clearedBlocked = 0
  for (let f = 0; f < 90; f++) {
    const k = 1 - Math.exp(-(1 / 60) * 4)
    naive = { x: naive.x + (target.x - naive.x) * k, y: naive.y + (target.y - naive.y) * k, z: naive.z + (target.z - naive.z) * k }
    if (blocker(naive, look, bodies)) naiveBlocked++
    const c = easeClear(cleared, target, k, look, bodies)
    cleared = { x: c.x, y: c.y, z: c.z }
    if (blocker(cleared, look, bodies)) clearedBlocked++
  }
  assert.ok(naiveBlocked > 5, `the plain ease does pass through (${naiveBlocked} frames)`)
  assert.equal(clearedBlocked, 0)
})
