// Pickleball 98: the computer players play like PPA pros (docs/pickleball-physics.md, "How the
// computer plays"): situational third shots, the fifth shot after a drive, attacking by height
// in the dink battle, dodging balls going out, stacking, poaching, levels by consistency.
// Run: node --test client/src/components/applets/pickleball/proplay.test.js
import test from "node:test"
import assert from "node:assert/strict"
import { HALF_L, v3 } from "./physics.js"
import { LEVELS, aiShot, homeFor, levelFor } from "./ai.js"
import { createMatch, playerById, scenario, seeded, step } from "./match.js"
import { simulate } from "./tools/rallysim.mjs"

const intents = (m, p, lv, ball, n = 80, setup = () => {}) => {
  const out = {}
  for (let i = 0; i < n; i++) {
    m.rand = seeded(500 + i)
    setup(m)
    const s = aiShot(m, p, lv, ball)
    out[s.intent] = (out[s.intent] || 0) + 1
  }
  return out
}

// the third shot: "you" served (team 0), the return is coming back to the baseline
const third = (returnersIn) => {
  const m = createMatch({ doubles: true, level: "pro", seed: 9 })
  scenario(m, "kitchen")
  m.rally.hits = 2
  for (const p of m.players) {
    if (p.team === 0) p.z = HALF_L + 0.2
    else p.z = -(returnersIn ? 2.6 : 5.2)
  }
  return m
}

test("third shot: a pro drops a deep, low return and drives a short or sitting one", () => {
  const lv = levelFor("pro")
  const m = third(true)
  const p = playerById(m, "you")
  const deep = intents(m, p, lv, { p: v3(0.4, 0.4, HALF_L - 0.4), v: v3(0, -1, 8) })
  const sitting = intents(m, p, lv, { p: v3(0.4, 0.95, HALF_L - 2.6), v: v3(0, -1, 8) })
  assert.ok((deep.drop || 0) > (deep.drive || 0), `deep, low return: ${JSON.stringify(deep)}`)
  assert.ok((sitting.drive || 0) > (sitting.drop || 0), `short, high return: ${JSON.stringify(sitting)}`)
  // returners still back (they didn't follow their return in): drive it at them more often
  const mOut = third(false)
  const notIn = intents(mOut, playerById(mOut, "you"), lv, { p: v3(0.4, 0.6, HALF_L - 0.6), v: v3(0, -1, 8) })
  const inn = intents(m, p, lv, { p: v3(0.4, 0.6, HALF_L - 0.6), v: v3(0, -1, 8) })
  assert.ok((notIn.drive || 0) > (inn.drive || 0), `returners back ${JSON.stringify(notIn)} vs in ${JSON.stringify(inn)}`)
})

test("fifth shot after a third-shot drive: mostly a drop from the transition zone", () => {
  const m = third(true)
  m.rally.hits = 4
  m.rally.third = "drive"
  const p = playerById(m, "you")
  p.z = 4.6
  const r = intents(m, p, levelFor("pro"), { p: v3(0.4, 0.5, 4.5), v: v3(0, -1, 7) })
  assert.ok((r.drop || 0) >= 45, `fifth shot: ${JSON.stringify(r)}`)
})

test("the dink battle: a pro dinks one at the ankles and attacks one met at the hip", () => {
  const m = createMatch({ doubles: true, level: "pro", seed: 1 })
  scenario(m, "kitchen")
  for (const p of m.players) p.z = Math.sign(p.z) * 2.55
  m.rally.hits = 8
  const p = playerById(m, "you")
  const lv = levelFor("pro")
  const ankles = intents(m, p, lv, { p: v3(0.5, 0.3, 2.4), v: v3(0, -1, 4) })
  assert.ok((ankles.dink || 0) >= 70, `at the ankles: ${JSON.stringify(ankles)}`)
  const hip = intents(m, p, lv, { p: v3(0.5, 0.78, 2.4), v: v3(0, -1, 4) }, 80, (mm) => (mm.rally.dinks = 3))
  const att = (hip.roll || 0) + (hip.speedup || 0)
  assert.ok(att >= 40, `at the hip, after a few dinks: ${JSON.stringify(hip)}`)
})

test("against a ball machine it's a drill: the stand-in keeps dinking", () => {
  const m = createMatch({ doubles: false, level: "pro", seed: 1, roster: [{ id: "you", team: 0, ctrl: "human", slot: 0 }, { id: "machine", team: 1, ctrl: "feeder", level: "pro" }] })
  scenario(m, "kitchen")
  const p = playerById(m, "you")
  m.players.find((q) => q.id === "machine").z = -2.6
  const r = intents(m, p, levelFor("pro"), { p: v3(0.5, 0.75, 2.4), v: v3(0, -1, 4) }, 40, (mm) => (mm.rally.dinks = 5))
  assert.equal(r.dink || 0, 40, JSON.stringify(r))
})

test("partners hold their serve and return positions until their side has hit (nobody walks across the serve)", () => {
  const m = createMatch({ doubles: true, level: "pro", seed: 4 })
  const r = m.rally
  const recvPartner = m.players.find((p) => p.team !== r.serving && p.id !== r.receiver)
  const spot = { ...recvPartner.spot }
  m.ball.p = v3(2.5, 1, 0)
  const h = homeFor(m, recvPartner)
  assert.deepEqual({ x: h.x, z: h.z }, { x: spot.x, z: spot.z })
})

test("stacking: a stacked team ends up on its chosen sides after its first shot, whatever the score", () => {
  let checked = 0
  for (const seed of [3, 4, 5, 6, 7, 8]) {
    const roster = [0, 1].flatMap((team) => [1, 2].map((k) => ({ id: `t${team}p${k}`, team, ctrl: "cpu", level: "legend" })))
    const m = createMatch({ doubles: true, level: "legend", scoring: "rally", seed, roster })
    const team = m.stack.findIndex(Boolean)
    if (team < 0) continue
    const pref = m.stack[team].pref
    for (let i = 0; i < 240 * 60 && m.phase !== "over"; i++) {
      step(m)
      const r = m.rally
      // after the team's first shot of a rally, its lanes are its preferred ones
      const theirFirst = r.serving === team ? 1 : 2
      if (m.phase === "rally" && r.hits > theirFirst && r.hits < 5) {
        for (const p of m.players.filter((q) => q.team === team)) {
          if (r.poached) continue // (a poach switches them for the rest of the point)
          assert.equal(p.lane, pref[p.id], `seed ${seed} ${p.id}`)
          checked++
        }
      }
    }
  }
  assert.ok(checked > 100, `checked ${checked} frames`)
})

test("levels differ in consistency, decisions and shot quality, not superhuman speed", () => {
  const order = ["beginner", "intermediate", "pro", "legend"]
  for (let i = 1; i < order.length; i++) {
    const a = LEVELS[order[i - 1]]
    const b = LEVELS[order[i]]
    assert.ok(b.face < a.face && b.softTouch < a.softTouch && b.sigma < a.sigma, `${order[i]} steadier than ${order[i - 1]}`)
    assert.ok((b.power ?? 1) >= (a.power ?? 1), `${order[i]} hits at least as hard`)
  }
  // court speed: no more than a real step up (pros ~4-4.3 m/s on short bursts); reactions human
  assert.ok(LEVELS.legend.speed - LEVELS.intermediate.speed <= 0.6)
  for (const k of order) assert.ok(LEVELS[k].reaction >= 0.14, `${k} reaction ${LEVELS[k].reaction} s`)
})

test("whole points look like PPA pro doubles: rally length, third shots, serve and return depth, speeds", () => {
  // PPA championship finals (Ramsey, PPA stats wraps 2022-2024): 8.9-14.8 shots a rally, 57% of
  // rallies 9 shots or fewer in 2022 (42% in 2019), third shots 42-80% drops by match, pro
  // serves ~35-50 mph, drives 40-60 mph, dinks ~5-15 mph
  const s = simulate({ level: "pro", games: 4, seed0: 11 })
  assert.ok(s.rally.mean >= 8 && s.rally.mean <= 15, `mean ${s.rally.mean}`)
  assert.ok(s.rally.upTo9 >= 40 && s.rally.upTo9 <= 72, `9 or fewer: ${s.rally.upTo9}%`)
  const drops = s.third.drop || 0
  const drives = s.third.drive || 0
  const dropShare = drops / (drops + drives)
  assert.ok(dropShare > 0.3 && dropShare < 0.8, `third-shot drops ${(dropShare * 100).toFixed(0)}%`)
  assert.ok(s.serve.mph >= 35 && s.serve.mph <= 50, `serve ${s.serve.mph} mph`)
  assert.ok(s.serve.faultPct > 0 && s.serve.faultPct < 10, `serve faults ${s.serve.faultPct}%`)
  assert.ok(s.serve.depthFromBaseline.median < 2, "deep serves")
  assert.ok(s.returnDepthFromBaseline.median < 2.2, "deep returns")
  assert.ok(s.mph.drive.median >= 38 && s.mph.drive.median <= 55, `drives ${s.mph.drive.median} mph`)
  assert.ok(s.mph.dink.median >= 8 && s.mph.dink.median <= 16, `dinks ${s.mph.dink.median} mph`)
  // dinks met at the top of their bounce (not scooped off the court)
  assert.ok(s.contactHeightAfter.dink.p10 > 0.3, `dink contact p10 ${s.contactHeightAfter.dink.p10} m`)
  // rallies end the ways pro rallies do: errors at the net and long, winners, a few dinks in
  const ends = s.ends
  const sum = (re) => Object.entries(ends).filter(([k]) => re.test(k)).reduce((t, [, v]) => t + v, 0)
  const winners = sum(/^winner|^ace|Hit by the ball/)
  assert.ok(winners > 10 && winners < 45, `winners ${winners.toFixed(0)}%`)
  assert.ok(sum(/^net: dink/) < 15, `dinks into the net ${sum(/^net: dink/)}%`)
})
