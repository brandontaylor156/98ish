import test from "node:test"
import assert from "node:assert/strict"
import { DEFAULT_PHRASES, LIMITS, PHRASE_KINDS, addToLog, awaySummary, cleanMemory, cleanPhrases, meetRegular, memoryKey, pickLine, rememberResult, resultText, scheduleFor } from "./living.js"

const seq = (...v) => {
  let i = 0
  return () => v[i++ % v.length]
}

test("the phrasebook: known kinds, trimmed, capped, defaults for an empty kind", () => {
  const p = cleanPhrases({ greet: ["  Hello\nthere  ", "Hello there", "x".repeat(99)], win: [], bogus: ["nope"], trash: Array.from({ length: 12 }, (_, i) => `t${i}`) })
  assert.deepEqual(Object.keys(p), PHRASE_KINDS)
  assert.equal(p.greet[0], "Hello there")
  assert.equal(p.greet.length, 2, "duplicates dropped")
  assert.equal(p.greet[1].length, LIMITS.chars)
  assert.equal(p.trash.length, LIMITS.perKind)
  assert.deepEqual(p.win, DEFAULT_PHRASES.win.slice(0, 2), "an empty kind falls back to polite defaults")
  assert.ok(!("bogus" in p))
  const big = cleanPhrases(Object.fromEntries(PHRASE_KINDS.map((k) => [k, Array.from({ length: 6 }, (_, i) => `${k}${i}`)])))
  const total = PHRASE_KINDS.reduce((n, k) => n + big[k].length, 0)
  assert.ok(total <= LIMITS.total + PHRASE_KINDS.length * 2, "the overall cap (empty kinds only get two defaults)")
  assert.ok(big.greet.length + big.win.length + big.loss.length <= LIMITS.total)
})

test("a clone only says approved lines, never the same one twice in a row", () => {
  const p = cleanPhrases({ win: ["A", "B"], greet: ["Hi"] })
  for (let i = 0; i < 20; i++) assert.ok(p.win.includes(pickLine(p, "win", Math.random)))
  assert.equal(pickLine(p, "win", seq(0), "A"), "B")
  assert.equal(pickLine(p, "greet", seq(0), "Hi"), "Hi", "with one line it may repeat")
  assert.equal(pickLine({}, "cheer", seq(0)), DEFAULT_PHRASES.cheer[0])
})

test("the memory log and the away card", () => {
  let log = []
  for (let i = 0; i < 60; i++) log = addToLog(log, { id: String(i), cloneWon: i % 3 === 0, score: [11, 5], by: "Bob" })
  assert.equal(log.length, LIMITS.log)
  assert.equal(log[0].id, "59", "newest first")
  const a = awaySummary(log, 3)
  assert.equal(a.games, 3)
  assert.equal(a.won, [59, 58, 57].filter((i) => i % 3 === 0).length)
  assert.match(a.headline, /3 games while you were away/)
  assert.equal(awaySummary(log, 0).headline, "")
  assert.equal(resultText({ by: "Sam", cloneWon: false, score: [7, 11], venueName: "Los Cab" }), "Your clone lost to Sam 7-11 at Los Cab")
  assert.equal(resultText({ by: "Sam", cloneWon: true, score: [11, 9] }), "Your clone beat Sam 11-9")
})

test("the regulars' day follows the hour", () => {
  assert.equal(scheduleFor(8).phase, "morning")
  assert.equal(scheduleFor(13).phase, "midday")
  assert.equal(scheduleFor(18.5).phase, "evening")
  assert.equal(scheduleFor(23).phase, "night")
  assert.equal(scheduleFor(-1).phase, "night")
  assert.ok(scheduleFor(18).keen > scheduleFor(8).keen, "evening open play is busiest")
})

test("the regulars remember you: first meeting, a recent result, a long absence", () => {
  const now = Date.UTC(2026, 9, 6, 17)
  let r = meetRegular(null, "Marge", "Brandon", now)
  assert.match(r.line, /I'm Marge. First time here\?/)
  r = meetRegular(r.mem, "Marge", "Brandon", now + 60_000)
  assert.match(r.line, /Brandon/)
  const mem = rememberResult(r.mem, { won: true, score: [11, 7], vs: "Alice's clone" }, now + 120_000)
  r = meetRegular(mem, "Marge", "Brandon", now + 180_000)
  assert.match(r.line, /Saw you win 11-7 against Alice's clone/)
  r = meetRegular(cleanMemory({ met: { Dale: { times: 2, last: now - 30 * 86_400_000 } } }), "Dale", "Brandon", now)
  assert.match(r.line, /in a while/)
  // the memory stays small and clean
  let m = null
  for (let i = 0; i < 9; i++) m = rememberResult(m, { won: i % 2 === 0, score: [11, i], vs: "x" }, now + i)
  assert.equal(m.results.length, 5)
  assert.equal(memoryKey("loscab"), "98ish.pickleball.parkMemory.loscab")
  assert.equal(memoryKey("../evil"), "98ish.pickleball.parkMemory.evil")
})
