// The show format's tests (packs, rounds, scoring, results, host lines).
// Run: node --test client/src/components/applets/quiz/shared/
import test from "node:test"
import assert from "node:assert/strict"
import { loadAllPacks } from "./packs.js"
import { seeded } from "./logic.js"
import * as S from "./show.js"

const content = await loadAllPacks()

test("every question is in a pack, and packs are big enough for a show", () => {
  const cats = new Set(content.aboutMe.map((q) => q.cat))
  const packed = new Set(S.KNOWME_PACKS.flatMap((p) => p.cats || []))
  for (const c of cats) assert.ok(packed.has(c), `category ${c} isn't in a pack`)
  const kinds = new Set(content.pairs.map((p) => p.kind))
  const packedKinds = new Set(S.TOT_PACKS.flatMap((p) => p.kinds || []))
  for (const k of kinds) assert.ok(packedKinds.has(k), `pair kind ${k} isn't in a pack`)
  for (const p of S.KNOWME_PACKS) assert.ok(S.packPool(content, "knowme", p.id).length >= 18, `${p.name}: ${S.packPool(content, "knowme", p.id).length}`)
  for (const p of S.TOT_PACKS) assert.ok(S.packPool(content, "tot", p.id).length >= 18, p.name)
  assert.ok(S.packPool(content, "knowme", "mix").every((q) => q.cat !== "flirty"), "the grab bag keeps it clean")
  // unknown packs: everything (but flirty)
  assert.equal(S.packPool(content, "knowme", "nope").length, S.packPool(content, "knowme", "mix").length)
  assert.ok(content.aboutMe.filter((q) => q.cat === "flirty").length >= 15)
  assert.ok(content.pairs.filter((p) => p.kind === "date").length >= 20)
})

test("packs unlock as you play", () => {
  const open = (shows) => S.KNOWME_PACKS.filter((p) => S.isUnlocked(p, shows)).map((p) => p.id)
  assert.deepEqual(open(0), ["firstdate", "quirks", "mix"])
  assert.deepEqual(open(1), ["firstdate", "quirks", "wayback", "mix"])
  assert.equal(open(3).length, S.KNOWME_PACKS.length)
  assert.equal(S.isUnlocked(S.packById("tot", "datenight"), 0), false)
  assert.equal(S.defaultPack("knowme"), "firstdate")
})

test("a How Well Do You Know Me show: two rounds, a lightning round, the big bet", () => {
  const steps = S.buildShow("knowme", { pool: S.packPool(content, "knowme", "firstdate"), count: 5, random: seeded(4) })
  assert.equal(steps.length, 16)
  assert.equal(new Set(steps.map((s) => s.id)).size, 16, "no question twice")
  assert.deepEqual(steps.map((s) => s.round), [...Array(5).fill("one"), ...Array(5).fill("two"), ...Array(4).fill("lightning"), "final", "final"])
  assert.deepEqual(steps.map((s) => s.subject), [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 1, 0, 1, 0, 1])
  assert.deepEqual(steps.map((s) => s.mult), [1, 1, 1, 1, 2, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1], "each round ends on double points")
  assert.ok(steps.slice(10, 14).every((s) => s.timer === S.TIMES.lightning && s.base === 50))
  assert.ok(steps.slice(14).every((s) => s.bet))
  assert.ok(steps.slice(0, 10).every((s) => s.timer === S.TIMES.normal))
  // no clock: only the lightning round is timed
  const relaxed = S.buildShow("knowme", { pool: content.aboutMe, count: 3, timer: false })
  assert.deepEqual(relaxed.map((s) => s.timer), [0, 0, 0, 0, 0, 0, 8, 8, 8, 8, 0, 0])
  // a pack smaller than a marathon gets topped up from the rest
  const flirty = S.packPool(content, "knowme", "flirty")
  const big = S.buildShow("knowme", { pool: flirty, fallback: content.aboutMe, count: 7 })
  assert.equal(big.length, 20)
  assert.equal(new Set(big.map((s) => s.id)).size, 20)
  assert.deepEqual([S.startsRound(steps, 0), S.startsRound(steps, 1), S.startsRound(steps, 5), S.startsRound(steps, 14)], [true, false, true, true])
  assert.match(S.roundInfo("knowme", "one", ["Ana", "Ben"]).title, /Ana/)
  assert.match(S.roundInfo("knowme", "two", ["Ana", "Ben"]).text, /Ben answers, Ana guesses/)
})

test("a This or That show: warm-up, double trouble, lightning", () => {
  const steps = S.buildShow("tot", { pool: S.packPool(content, "tot", "quick"), count: 10 })
  assert.deepEqual(steps.map((s) => s.round), [...Array(5).fill("warmup"), ...Array(5).fill("double"), ...Array(4).fill("lightning")])
  assert.ok(steps.every((s) => s.subject === null))
  assert.ok(steps.slice(5, 10).every((s) => s.mult === 2))
})

test("scoring: the guesser scores, streaks earn a bonus, doubles count twice, bets win or lose", () => {
  const step = { subject: 0, base: 100, mult: 1, bet: false }
  let score = S.newScore()
  let r = S.scoreStep("knowme", score, step, [2, 2])
  assert.deepEqual(r.outcome.gained, [0, 100])
  assert.equal(r.outcome.guesser, 1)
  assert.equal(r.outcome.truth, 2)
  r = S.scoreStep("knowme", r.score, step, [1, 1])
  r = S.scoreStep("knowme", r.score, { ...step, mult: 2 }, [0, 0])
  assert.deepEqual(r.outcome.gained, [0, 250], "double points plus the streak bonus")
  assert.ok(r.outcome.onFire)
  assert.equal(r.score.points[1], 450)
  r = S.scoreStep("knowme", r.score, step, [0, 3])
  assert.equal(r.outcome.match, false)
  assert.equal(r.score.streak[1], 0)
  assert.equal(r.score.best[1], 3)
  // no answer from the subject: nobody can match it
  assert.equal(S.scoreStep("knowme", r.score, step, [null, null]).outcome.match, false)
  // the big bet: right wins the bet, wrong loses it (never below zero)
  const final = { subject: 1, base: 100, mult: 1, bet: true }
  score = { ...S.newScore(), points: [120, 450] }
  assert.deepEqual(S.scoreStep("knowme", score, final, [3, 3], ["allin", "safe"]).outcome.gained, [300, 0])
  assert.deepEqual(S.scoreStep("knowme", score, final, [3, 1], ["bold", "safe"]).outcome.gained, [-120, 0])
  assert.equal(S.betAmount("allin", 900), 900)
  assert.equal(S.betAmount("allin", 10), 300)
  // This or That: a match scores for everyone
  r = S.scoreStep("tot", S.newScore(3), { base: 100, mult: 2 }, [1, 1, 1])
  assert.deepEqual(r.outcome.gained, [200, 200, 200])
  assert.equal(S.scoreStep("tot", S.newScore(3), { base: 100, mult: 1 }, [1, 1, 0]).outcome.match, false)
  assert.equal(S.scoreStep("tot", S.newScore(), { base: 100, mult: 1 }, [null, null]).outcome.match, false)
})

test("results: the summary line, tiers and winner", () => {
  const steps = S.buildShow("knowme", { pool: content.aboutMe, count: 3, random: seeded(1) })
  const answers = steps.map((s, i) => (i < 9 ? [1, 1] : [1, 0]))
  const { score } = S.replayShow("knowme", steps, answers)
  const sum = S.summarize("knowme", score, ["Ana", "Ben"])
  assert.equal(sum.matches, 9)
  assert.equal(sum.total, 12)
  assert.equal(sum.percent, 75)
  assert.equal(sum.tier.name, "Lovebirds")
  assert.equal(sum.headline, "You two matched on 9/12: Lovebirds!")
  assert.ok(sum.winnerName)
  assert.equal(S.tierFor(100).name, "Soulmates")
  assert.equal(S.tierFor(0).name, "Beautiful Mysteries")
  assert.equal(S.summarize("tot", score).winner, null)
})

test("Lulu's lines: the same moment gets the same line on both screens", () => {
  assert.equal(S.hostLine("match", 3), S.hostLine("match", 3))
  assert.notEqual(S.hostLine("match", 3), S.hostLine("match", 4))
  assert.equal(S.hostLine("fire", 0, { name: "Ana", n: 3 }), "Ana is on fire! 3 in a row!")
  assert.ok(S.hostLine("results:Soulmates").length > 5)
  assert.ok(S.hostLine("results:Unknown").length > 5)
})
