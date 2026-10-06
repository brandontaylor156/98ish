// Twin Clones: profiles found again from scripted styles, smoothing with little evidence,
// merging games, the share file's checks, and clones that really play differently.
import test from "node:test"
import assert from "node:assert/strict"
import { simulateAnalysis } from "./styleSim.js"
import { cloneLevel, describe, fitProfile, fromCloneFile, knowOf, toCloneFile, traitsOf } from "./profile.js"
import { createMatch, step } from "../../match.js"
import { KITCHEN } from "../core/homography.js"

const RUSHER = { netRush: 0.9, stanceNet: 2.3, thirdDrop: 0.85, hardShare: 0.4, crossDink: 0.85, speed: 4.4, reaction: 0.14, deepZ: 6.0 }
const BASELINER = { netRush: 0.1, backDepth: 7.0, thirdDrop: 0.15, hardShare: 0.05, crossDink: 0.4, speed: 3.0, reaction: 0.32, reset: 0.2, lob: 0.25, deepZ: 4.6 }
const fit = (style, rallies = 40, seed = 3, name = "X") => fitProfile([{ analysis: simulateAnalysis(style, { rallies, seed }), playerId: 0, gameId: `g${seed}` }], { name })

test("a profile finds a scripted player's habits again", () => {
  for (const [name, style] of [["rusher", RUSHER], ["baseliner", BASELINER]]) {
    const t = traitsOf(fit(style))
    const near = (got, want, tol, what) => assert.ok(Math.abs(got - want) <= tol, `${name} ${what}: ${got.toFixed(2)} vs ${want} (±${tol})`)
    near(t.netRate, style.netRush, 0.12, "time at the line")
    near(t.drop, style.thirdDrop, 0.12, "third-shot drop")
    near(t.speed, style.speed, 0.4, "speed")
    near(t.reaction, style.reaction, 0.06, "reaction")
    near(t.deepZ, style.deepZ, 0.25, "drive depth")
    if (name === "rusher") {
      near(t.stanceNet, style.stanceNet, 0.15, "net depth")
      near(t.hardShare, style.hardShare, 0.1, "speed-ups at the line")
      near(t.crossDink, style.crossDink, 0.12, "cross-court dinks")
    } else {
      near(t.stanceBack, style.backDepth, 0.25, "back depth")
      near(t.lob, style.lob, 0.1, "lobs vs net players")
      near(t.reset, style.reset, 0.12, "resets vs net players")
    }
  }
  // and the words say so
  assert.ok(describe(fit(RUSHER)).includes("rushes the net"))
  assert.ok(describe(fit(BASELINER)).includes("stays back"))
  assert.ok(describe(fit(BASELINER)).includes("drives the third"))
})

test("little film: traits stay near the level; more film moves them; games add up once", () => {
  const short = fit(RUSHER, 2)
  const long = fit(RUSHER, 60)
  assert.ok(knowOf(short) < 0.3 && knowOf(long) > 0.9, `meter ${knowOf(short).toFixed(2)} -> ${knowOf(long).toFixed(2)}`)
  // a 2-rally film says less about their speed-ups than a long one (pulled toward the level)
  assert.ok(Math.abs(traitsOf(short).hardShare - 0.4) > Math.abs(traitsOf(long).hardShare - 0.4))
  // merging: two games = the counts of both; the same game twice counts once
  const a = simulateAnalysis(RUSHER, { rallies: 10, seed: 5 })
  const b = simulateAnalysis(RUSHER, { rallies: 10, seed: 6 })
  const one = fitProfile([{ analysis: a, playerId: 0, gameId: "A" }])
  const two = fitProfile([{ analysis: b, playerId: 0, gameId: "B" }], { prev: one })
  const again = fitProfile([{ analysis: b, playerId: 0, gameId: "B" }], { prev: two })
  assert.equal(two.counts.third.n, one.counts.third.n * 2)
  assert.equal(again.counts.third.n, two.counts.third.n)
  assert.equal(two.id, one.id)
})

test("the share file: only your own clone travels, and what arrives is checked", () => {
  const mine = { ...fit(RUSHER), origin: "self", name: "Brandon" }
  const back = fromCloneFile(JSON.parse(JSON.stringify(toCloneFile(mine))), { from: "Brandon" })
  assert.equal(back.origin, "shared")
  assert.equal(back.from, "Brandon")
  assert.deepEqual(back.counts.third, mine.counts.third)
  assert.ok(Math.abs(traitsOf(back).drop - traitsOf(mine).drop) < 1e-9)
  // a clone built from your video of someone else isn't theirs to pass on
  assert.throws(() => fromCloneFile({ ...toCloneFile(mine), origin: "video" }), /own clone/)
  assert.throws(() => fromCloneFile({ format: "nope" }), /isn't a Pickleball 98 clone/)
  // nonsense counts are clamped (k never above n, no negatives)
  const bad = fromCloneFile({ ...toCloneFile(mine), counts: { third: { k: 999, n: 3 }, speed: { sum: -5, n: 2 } } })
  assert.deepEqual(bad.counts.third, { k: 3, n: 3 })
  assert.equal(bad.counts.speed.sum, 0)
  assert.ok(JSON.stringify(toCloneFile(mine)).length < 4096, "a clone is a few KB")
})

// play a doubles match between a team of one clone and a fixed computer side; measure the
// clone side's time at the kitchen line, third-shot drops and speed-ups at the line
const playStyle = (profile, seconds = 220, seed = 21) => {
  const lv = cloneLevel(profile)
  const m = createMatch({ doubles: true, level: "pro", seed, target: 99, roster: [
    { id: "c1", team: 0, ctrl: "cpu", level: lv },
    { id: "c2", team: 0, ctrl: "cpu", level: lv },
    { id: "o1", team: 1, ctrl: "cpu", level: "intermediate" },
    { id: "o2", team: 1, ctrl: "cpu", level: "intermediate" },
  ] })
  m.autoplay = true
  const STEP = 1 / 120
  let netT = 0
  let rallyT = 0
  let thirds = 0
  let drops = 0
  let lineShots = 0
  let fast = 0
  let shotNo = 0
  for (let i = 0; i < seconds / STEP; i++) {
    step(m, STEP)
    if (m.rally?.hits >= 4) {
      for (const p of m.players.filter((q) => q.team === 0)) {
        rallyT += STEP
        if (Math.abs(p.z) < KITCHEN + 1.0) netT += STEP
      }
    }
    for (const e of m.events) {
      if (e.type === "point") shotNo = 0
      if (e.type !== "hit") continue
      shotNo++
      if (e.team !== 0) continue
      if (shotNo === 3) {
        thirds++
        if (e.kind === "drop" || e.kind === "dink") drops++
      }
      if (shotNo >= 4 && Math.abs(e.z) < 3.8) {
        lineShots++
        if (e.fast || e.kind === "drive" || e.kind === "smash") fast++
      }
    }
    m.events.length = 0
  }
  return { net: netT / Math.max(1e-6, rallyT), drop: drops / Math.max(1, thirds), fast: fast / Math.max(1, lineShots), thirds, lineShots }
}

test("clones play like their people: the rusher lives at the line and drops; the baseliner stays back and drives", () => {
  const rusher = playStyle(fit(RUSHER, 60))
  const baseliner = playStyle(fit(BASELINER, 60))
  console.log("rusher", rusher, "baseliner", baseliner)
  assert.ok(rusher.net > baseliner.net + 0.2, `time at the line: rusher ${rusher.net.toFixed(2)} vs baseliner ${baseliner.net.toFixed(2)}`)
  assert.ok(rusher.thirds >= 5 && baseliner.thirds >= 5, "enough third shots seen")
  assert.ok(rusher.drop > baseliner.drop + 0.25, `third-shot drops: ${rusher.drop.toFixed(2)} vs ${baseliner.drop.toFixed(2)}`)
})

test("plain levels play as before (the clone fields are optional)", () => {
  const m = createMatch({ doubles: false, level: "pro", seed: 4 })
  assert.equal(m.players[1].level.stanceNet, undefined)
  assert.equal(typeof m.players[1].level.speed, "number")
  const lv = cloneLevel(fit(RUSHER))
  assert.equal(lv.style, "clone")
  for (const k of ["speed", "reaction", "advance", "drop", "impatience", "reset", "lob", "sigma", "softTouch"]) assert.ok(Number.isFinite(lv[k]), k)
})
