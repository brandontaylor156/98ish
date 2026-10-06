// Coach: node --test client/src/components/applets/pickleball/twin/coach/coach.test.js
import test from "node:test"
import assert from "node:assert/strict"
import { handHeight, readySeries, PADDLE_UP } from "./pose.js"
import { diagnose, levelPos, metricById, estimateLevel, speedAt } from "./metrics.js"
import { weaknesses, weekPlan } from "./plan.js"
import { recordGame, seriesOf, streakOf, trendOf } from "./progress.js"
import { ghostSituations } from "./ghost.js"
import { simulateCoach } from "./coachSim.js"
import { buildFrames } from "../core/replay.js"
import { withPaths } from "../core/analyze.js"
import { DRILLS } from "../../practice/drillbook.js"

const GOOD = { legs: 1, split: -0.05, readyUp: 0.9, thirdGood: 0.85, recoveryErr: 0.2, stacked: 0, serveDepth: 6.5, returnDepth: 6.5, dinkErr: 0.03 }
const WEAK = { legs: 4, split: 0.35, readyUp: 0.2, thirdGood: 0.2, recoveryErr: 1.3, stacked: 0.7, serveDepth: 5.0, returnDepth: 5.0, dinkErr: 0.3, highSpeedups: 0.1 }
const run = (habits, seed = 7, target = "pro") => {
  const { analysis, truth } = simulateCoach(habits, { seed })
  const d = diagnose([{ key: "g", analysis }], { g: 0 }, { target })
  const by = Object.fromEntries(d.metrics.map((m) => [m.id, m]))
  return { analysis, truth, d, by }
}

test("pose: paddle-hand height between hips and shoulders, and the series at their hits", () => {
  const body = (wristY) => {
    const lm = []
    lm[11] = { x: 0, y: 100, v: 1 }
    lm[12] = { x: 20, y: 100, v: 1 }
    lm[23] = { x: 2, y: 200, v: 1 }
    lm[24] = { x: 18, y: 200, v: 1 }
    lm[15] = { x: 0, y: 210, v: 1 }
    lm[16] = { x: 20, y: wristY, v: 1 }
    return { lm }
  }
  assert.equal(handHeight(body(100), 1), 1) // at the shoulder
  assert.equal(handHeight(body(200), 1), 0) // at the hip
  assert.equal(handHeight(body(150), 1), 0.5)
  assert.equal(handHeight(body(150), -1), -0.1) // the other hand hangs below the hip
  assert.equal(handHeight(body(150), 0), 0.5) // the higher hand
  assert.equal(handHeight({ lm: [] }), null)
  const track = { team: 0, samples: [{ t: 1.0, ...body(120) }, { t: 2.02, ...body(195) }, { t: 3, x: 0, z: 0 }] }
  const rallies = [{ hits: [{ t: 1.0, team: 1 }, { t: 1.5, team: 0 }, { t: 2.0, team: 1 }, { t: 3.0, team: 1 }] }]
  const s = readySeries(track, rallies, 1)
  assert.deepEqual(s.map((x) => x.t), [1, 2]) // (3.0 has no landmarks)
  assert.ok(s[0].h >= PADDLE_UP && s[1].h < PADDLE_UP)
})

test("metrics match the script's true values (good player)", () => {
  const { truth, by } = run(GOOD)
  assert.ok(Math.abs(by.kitchen.value - truth.kitchen) < 0.15, `kitchen ${by.kitchen.value} vs ${truth.kitchen}`)
  assert.ok(Math.abs(by.recovery.value - truth.recovery) < 0.08, `recovery ${by.recovery.value} vs ${truth.recovery}`)
  assert.ok(Math.abs(by.ready.value - truth.ready) < 0.02)
  assert.ok(Math.abs(by.third.value - truth.third) < 0.02)
  assert.equal(by.serve.value, truth.serve)
  assert.equal(by.return.value, truth.return)
  assert.ok(by.split.value > 0.85, `split ${by.split.value}`)
  assert.ok(by.spacing.value > 0.85, `spacing ${by.spacing.value}`)
  for (const id of ["kitchen", "split", "ready", "recovery", "third", "spacing"]) assert.equal(by[id].verdict, "good", id)
})

test("metrics match the script's true values (weak player), and say why", () => {
  const { truth, by } = run(WEAK)
  assert.ok(Math.abs(by.kitchen.value - truth.kitchen) < 0.2, `kitchen ${by.kitchen.value} vs ${truth.kitchen}`)
  assert.ok(Math.abs(by.recovery.value - truth.recovery) < 0.1, `recovery ${by.recovery.value} vs ${truth.recovery}`)
  assert.ok(Math.abs(by.ready.value - truth.ready) < 0.02)
  assert.ok(Math.abs(by.third.value - truth.third) < 0.02)
  assert.ok(by.split.value < 0.15, `split ${by.split.value}`)
  assert.match(by.split.detail, /late/)
  assert.ok(by.spacing.value < 0.5)
  for (const id of ["kitchen", "split", "ready", "recovery", "third", "serve"]) assert.equal(by[id].verdict, "work", id)
  // a moment to watch, with the ghost for movement habits
  assert.ok(by.kitchen.moments.length && by.kitchen.moments[0].ghost === "kitchen" && by.kitchen.moments[0].game === "g")
  assert.equal(by.split.moments[0].ghost, "split")
})

test("split step: early, on time and late are told apart by when they stop", () => {
  for (const [split, ok] of [[-0.05, true], [0.05, true], [0.3, false], [0.45, false]]) {
    const { by } = run({ ...GOOD, split }, 11)
    assert.equal(by.split.value > 0.8, ok, `split ${split}: ${by.split.value}`)
  }
})

test("bands: the level scale, verdicts against the target and the level estimate", () => {
  const k = metricById("kitchen") // lower is better: 4.5 / 3.3 / 2.5 / 2.0
  assert.equal(levelPos(k, 2.0), 3)
  assert.equal(levelPos(k, 2.5), 2)
  assert.ok(Math.abs(levelPos(k, 2.9) - 1.5) < 1e-9)
  assert.equal(levelPos(k, 9), -1)
  const s = metricById("split") // higher is better
  assert.ok(Math.abs(levelPos(s, 0.59) - 1.5) < 1e-9)
  assert.equal(levelPos(s, 0.9), 3)
  // the same habits read against a lower target are closer to "good"
  const pro = run(WEAK, 7, "pro").by.kitchen
  const club = run(WEAK, 7, "intermediate").by.kitchen
  assert.ok(club.gap < pro.gap)
  // estimates: the good player is rated higher, with a range
  const g = run(GOOD).d.level
  const w = run(WEAK).d.level
  assert.ok(g.pos > w.pos + 1.5, `${g.pos} vs ${w.pos}`)
  assert.ok(g.low <= g.pos && g.pos <= g.high)
  assert.equal(estimateLevel([]).pos, null)
  // too little film: unknown, not a verdict
  const few = simulateCoach(GOOD, { rallies: 2, seed: 1 })
  const fd = diagnose([{ key: "f", analysis: few.analysis }], { f: 0 })
  assert.equal(fd.metrics.find((m) => m.id === "third").verdict, "unknown")
})

test("plan: the biggest fixable weaknesses get the drills that train them", () => {
  const { d } = run(WEAK)
  const ws = weaknesses(d)
  assert.equal(ws.length, 3)
  assert.deepEqual(ws.map((w) => w.id).sort(), ["kitchen", "split", "third"].sort())
  const plan = weekPlan(d, { now: 5 })
  const drills = new Set(plan.items.filter((i) => i.kind === "drill").map((i) => i.drill))
  for (const want of ["kitchen", "split", "drop"]) assert.ok(drills.has(want), `plan has ${want}`)
  // every drill in a plan exists, sized by the gap, three sessions, three cues
  for (const it of plan.items) if (it.kind === "drill") assert.ok(DRILLS.some((x) => x.id === it.drill), it.drill)
  assert.ok(plan.items.some((i) => i.balls === 20))
  assert.deepEqual([...new Set(plan.items.map((i) => i.day))], [1, 2, 3])
  assert.equal(plan.cues.length, 3)
  // a good player has little to fix at Pro
  assert.ok(weaknesses(run(GOOD).d).every((w) => w.id !== "kitchen" && w.id !== "split"))
})

test("progress: one entry per game, series, trend and weekly streak", () => {
  let s = { target: "pro", me: {}, history: [], plan: null, done: {} }
  const week = 7 * 864e5
  const now = Date.UTC(2026, 9, 7, 12)
  const kitchen = [3.6, 3.2, 2.7, 2.4]
  kitchen.forEach((v, i) => (s = recordGame(s, { game: `g${i}`, at: now - (3 - i) * week, metrics: [{ id: "kitchen", value: v, n: 4 }], level: { pos: 1 + i * 0.3 } })))
  s = recordGame(s, { game: "g3", at: now, metrics: [{ id: "kitchen", value: 2.3, n: 5 }], level: { pos: 2 } }) // (read again: replaced)
  const ser = seriesOf(s.history, "kitchen")
  assert.deepEqual(ser.map((x) => x.v), [3.6, 3.2, 2.7, 2.3])
  assert.equal(trendOf(ser, "low"), 1) // fewer seconds = better
  assert.equal(trendOf(ser, "high"), -1)
  assert.equal(trendOf([{ v: 1 }, { v: 1.01 }], "high"), 0)
  assert.equal(streakOf(s, now), 4)
  assert.equal(streakOf({ ...s, history: s.history.slice(0, 2) }, now), 0) // two quiet weeks broke it
})

test("ghost: runs to the line sooner than a slow player, and splits right at their contact", () => {
  const { analysis, by } = run(WEAK)
  const an = withPaths(analysis)
  const m = by.kitchen.moments[0]
  const rally = an.rallies.find((r) => m.t >= r.start - 0.5 && m.t <= r.end + 0.5)
  const { frames } = buildFrames(an, { from: rally.start - 1.5, to: rally.end + 2 })
  const g = ghostSituations(frames, 0, an, { t: m.t, ghost: "kitchen" })
  assert.equal(g.length, frames.length)
  const reach = (list) => list.findIndex((s, i) => s && frames[i].t > m.t && Math.abs(s.z) <= 2.8)
  const gi = reach(g)
  const pi = reach(frames.map((f) => f.players[0]))
  assert.ok(gi > 0 && (pi < 0 || gi < pi), `ghost at the line at frame ${gi}, player ${pi}`)
  // before the moment it is the player
  const before = frames.findIndex((f) => f.t > m.t - 0.4)
  assert.ok(Math.abs(g[before - 5].z - frames[before - 5].players[0].z) < 1e-9)
  // split: still at their contact
  const ms = by.split.moments[0]
  const r2 = an.rallies.find((r) => ms.t >= r.start - 0.5 && ms.t <= r.end + 0.5)
  const f2 = buildFrames(an, { from: r2.start - 1.5, to: r2.end + 2 }).frames
  const g2 = ghostSituations(f2, 0, an, { t: ms.t, ghost: "split" })
  const at = f2.findIndex((f) => f.t >= ms.t)
  assert.ok(Math.hypot(g2[at].vx, g2[at].vz) < 0.3, `ghost speed ${Math.hypot(g2[at].vx, g2[at].vz)}`)
  assert.ok(speedAt(analysis.players[0].samples, ms.t) > 0.9) // (while the player was still moving)
})
