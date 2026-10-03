// Speed Typist 98's typing math, prompts, drills and race rules.
// Run: node --test client/src/components/applets/speedtype/speedtype.test.js
import test from "node:test"
import assert from "node:assert/strict"
import * as T from "./typing.js"
import { CATEGORIES, PROMPTS, dailyPrompt, pickPrompts, poolFor, promptById } from "./prompts/index.js"
import { DRILLS, makeDrill, vocabulary } from "./drills.js"
import rules, { advanceBot, botProfile, ghostPos, standings, validateSettings } from "./rules.js"

const seeded = (seed) => () => (seed = (seed * 16807) % 2147483647) / 2147483647

// ---------- typing math ----------

test("WPM counts five characters as a word; accuracy is right keys over all keys", () => {
  assert.equal(T.wpm(250, 60000), 50)
  assert.equal(T.wpm(100, 30000), 40)
  assert.equal(T.wpm(0, 1000), 0)
  assert.equal(T.wpm(10, 0), 0)
  assert.equal(T.accuracy(100, 5), 0.95)
  assert.equal(T.accuracy(0, 0), 1)
  assert.equal(T.accuracy(3, 9), 0)
})

test("smart quotes, dashes, ellipses and odd spaces count as the plain characters", () => {
  assert.equal(T.normalizeChars("it’s “fine”"), "it's \"fine\"")
  assert.equal(T.normalizeChars("a—b–c"), "a-b-c")
  assert.equal(T.normalizeChars("wait…"), "wait...")
  assert.equal(T.normalizeChars("a b​c"), "a bc")
  assert.equal(T.normalizePrompt("  two   spaces\n\nand\ttabs  "), "two spaces and tabs")
  assert.equal(T.normalizePrompt("bell\u0007 gone"), "bell gone")
})

test("word ranges own their trailing space", () => {
  const r = T.wordRanges("The cat sat")
  assert.deepEqual(r, [
    [0, 4],
    [4, 8],
    [8, 11],
  ])
  assert.equal(T.wordIndexAt(r, 0), 0)
  assert.equal(T.wordIndexAt(r, 4), 1)
  assert.equal(T.wordIndexAt(r, 11), 2)
})

// type a string one key at a time (a backspace is "\b")
const typeOut = (prompt, keys, opts) => {
  let t = T.startTyping()
  let field = ""
  for (const k of keys) {
    const next = k === "\b" ? field.slice(0, -1) : field + k
    t = T.step(prompt, t, next, opts)
    field = t.value
  }
  return t
}

test("the field: right words leave it, wrong letters must be fixed first", () => {
  const p = "Hi there you"
  let t = typeOut(p, "Hi ")
  assert.equal(t.committed, 3)
  assert.equal(t.value, "")
  t = typeOut(p, "Hi tg")
  assert.deepEqual(T.judge(p, t), { typed: "Hi tg", correct: 4, wrong: 1 })
  assert.equal(t.mistakes, 1)
  // more keys after a slip are all wrong, and the space doesn't move on
  t = typeOut(p, "Hi tgere ")
  assert.equal(t.committed, 3)
  assert.equal(T.judge(p, t).wrong, 5)
  // fix it
  t = typeOut(p, "Hi tg\bhere you")
  assert.equal(t.done, true)
  assert.equal(t.mistakes, 1)
  assert.equal(t.keys, 13)
  assert.equal(Math.round(T.accuracy(t.keys, t.mistakes) * 100), 92)
})

test("phone keyboards' curly apostrophes match a straight one in the prompt", () => {
  const t = typeOut("don't stop", "don’t stop")
  assert.equal(t.done, true)
  assert.equal(t.mistakes, 0)
})

test("strict mode: a wrong key doesn't go in (but counts) and there's no backspace", () => {
  const p = "abc def"
  let t = typeOut(p, "abx", { strict: true })
  assert.equal(t.value, "ab")
  assert.equal(t.mistakes, 1)
  t = T.step(p, t, "a", { strict: true })
  assert.equal(t.rejected, true)
  assert.equal(t.value, "ab")
  t = typeOut(p, "abc def", { strict: true })
  assert.equal(t.done, true)
})

test("piling up wrong characters stops at a limit", () => {
  const p = "short words here"
  const t = typeOut(p, "x".repeat(T.MAX_WRONG + 5))
  assert.equal(t.value.length, T.MAX_WRONG)
})

test("speed curve: WPM over a moving window", () => {
  const samples = Array.from({ length: 10 }, (_, i) => [(i + 1) * 1000, (i + 1) * 5])
  const curve = T.speedCurve(samples)
  assert.ok(curve.length >= 9)
  for (const [, w] of curve) assert.equal(w, 60)
  assert.deepEqual(T.speedCurve([]), [])
})

// ---------- the server's checks ----------

test("progress must be a prefix of the prompt, after the green light, at a human speed", () => {
  const prompt = "The quick test prompt goes here and keeps going for a while."
  const goAt = 10_000
  const ok = (text, now, prev) => T.checkProgress({ prompt, text, prev, goAt, now })
  assert.equal(ok("The qu", 13_000), null)
  assert.match(ok("The qx", 13_000), /match/)
  assert.match(ok("The", 9_000), /green light/)
  assert.match(ok(prompt + "!", 30_000), /isn't part/)
  assert.match(ok(null, 13_000), /isn't part/)
  // the whole prompt half a second after the start: nobody types that fast
  assert.match(ok(prompt, 10_500), /faster/)
  // 40 characters in one second, after a fair start: too fast
  assert.match(ok(prompt.slice(0, 50), 14_000, { pos: 10, at: 13_000 }), /faster/)
  // a normal pace is fine
  assert.equal(ok(prompt.slice(0, 20), 14_000, { pos: 10, at: 13_000 }), null)
})

// ---------- prompts and drills ----------

test("the prompt library: ids are unique, text is printable ASCII, every category has prompts", () => {
  assert.ok(PROMPTS.length >= 100)
  assert.equal(new Set(PROMPTS.map((p) => p.id)).size, PROMPTS.length)
  for (const p of PROMPTS) {
    assert.match(p.text, /^[\x20-\x7e]+$/, p.id)
    assert.equal(T.normalizePrompt(p.text), p.text, `${p.id} is already normalized`)
  }
  for (const c of CATEGORIES) assert.ok(c.list.length > 0, c.id)
  for (const len of ["short", "medium", "long"]) assert.ok(PROMPTS.some((p) => p.length === len), len)
  assert.equal(promptById("facts-1").category, "facts")
})

test("every pangram uses all 26 letters", () => {
  for (const p of PROMPTS.filter((x) => x.category === "pangrams")) {
    const letters = new Set(p.text.toLowerCase().replace(/[^a-z]/g, ""))
    assert.equal(letters.size, 26, p.text)
  }
})

test("prompt pools never come back empty, and picks are distinct", () => {
  assert.ok(poolFor({ length: "long", category: "numbers" }).length > 0)
  const three = pickPrompts({ length: "short" }, 3, seeded(5))
  assert.equal(new Set(three.map((p) => p.id)).size, 3)
  assert.equal(dailyPrompt("2026-10-03").id, dailyPrompt("2026-10-03").id)
  assert.equal(dailyPrompt("2026-10-03").length, "medium")
})

test("drills: each one makes typeable text of about the right size from the right keys", () => {
  assert.ok(vocabulary().length > 200)
  for (const d of DRILLS) {
    const text = makeDrill(d.id, seeded(3))
    assert.ok(text.length >= 150 && text.length < 260, `${d.id}: ${text.length}`)
    assert.equal(T.normalizePrompt(text), text)
    if (d.keys) assert.match(text, new RegExp(`^[${d.keys} ]+$`), d.id)
  }
  assert.match(makeDrill("numbers", seeded(9)), /\d/)
})

// ---------- the race rules ----------

const players = (n, humans = 1) => Array.from({ length: n }, (_, i) => ({ id: i, name: `P${i}`, bot: i >= humans }))

test("settings: cleaned, with sensible errors", () => {
  assert.equal(validateSettings({ length: "huge" }).error, "Pick a prompt length.")
  assert.equal(validateSettings({ mode: "relay" }).error, "Pick a race mode.")
  assert.match(validateSettings({ custom: "short" }).error, /at least/)
  assert.match(validateSettings({ custom: "x".repeat(700) }).error, /up to 600/)
  assert.equal(validateSettings({ custom: "x".repeat(700) }, { local: true }).custom.length, 700)
  assert.equal(validateSettings({ botWpm: 5 }).error, "Computer racers type between 10 and 200 WPM.")
  const s = validateSettings({ mode: "best3", strict: 1, players: 3, ghost: { timeline: [] } })
  assert.equal(s.mode, "best3")
  assert.equal(s.strict, true)
  assert.equal(s.ghost, undefined, "online rooms never get a ghost")
})

test("a race: countdown, progress checks, finish order and WPM by the server's clock", () => {
  const settings = validateSettings({ players: 2, promptId: "twisters-1" })
  let now = 0
  let s = rules.create({ players: players(2, 2), settings, random: seeded(1), now })
  const text = s.prompts[0].text
  assert.equal(s.phase, "countdown")
  assert.match(rules.action(s, 0, { type: "progress", text: text.slice(0, 1) }, { now: 100 }).error, /green light/)
  now = s.goAt
  s = rules.action(s, null, { type: "tick" }, { now, random: seeded(2), players: players(2, 2) })
  assert.equal(s.phase, "racing")
  // seat 1 types at about 60 WPM (5 characters a second)
  const typeTo = (seat, pos, at) => {
    const r = rules.action(s, seat, { type: "progress", text: text.slice(0, pos), keys: pos, mistakes: 0 }, { now: at, random: seeded(3) })
    assert.ok(!r.error, r.error)
    s = r
  }
  let t = s.goAt
  for (let pos = 5; pos < text.length; pos += 5) typeTo(1, pos, (t += 1000))
  typeTo(1, text.length, (t += 1000))
  assert.equal(s.racers[1].finishedAt, t)
  // a cheater pastes the whole prompt a moment after the start
  assert.match(rules.action(s, 0, { type: "progress", text, keys: 1, mistakes: 0 }, { now: s.goAt + 300 }).error, /faster/)
  // and a wrong text
  assert.match(rules.action(s, 0, { type: "progress", text: "nope", keys: 4, mistakes: 0 }, { now: t + 10 }).error, /match/)
  const table = standings(s, t)
  assert.equal(table[0].seat, 1)
  assert.equal(table[0].place, 1)
  assert.ok(Math.abs(table[0].wpm - T.wpm(text.length, t - s.goAt)) < 0.1)
  assert.equal(rules.isOver(s), null)
  // seat 0 gives up: the time limit ends it
  s = rules.action(s, null, { type: "tick" }, { now: s.limitAt + 1, random: seeded(4), players: players(2, 2) })
  assert.equal(s.phase, "done")
  assert.deepEqual(rules.isOver(s).winners, [1])
  const v = rules.view(s, 0)
  assert.equal(v.you, 0)
  assert.equal(v.results.length, 1)
  assert.equal(v.racers[0].prof, undefined, "no computer internals in the view")
})

test("computer racers type near their set speed, with slips", () => {
  const text = PROMPTS.find((p) => p.length === "medium").text
  for (const target of [30, 60, 100]) {
    const random = seeded(target)
    let r = { pos: 0, keys: 0, mistakes: 0, finishedAt: null, out: false, prof: botProfile(random, { wpm: target }) }
    let now = 0
    while (r.finishedAt == null && now < 600_000) r = advanceBot(r, text, 0, (now += 200), random)
    const got = T.wpm(text.length, r.finishedAt)
    assert.ok(got > target * 0.75 && got < target * 1.3, `${target} -> ${got}`)
  }
})

test("ghosts replay a recorded run", () => {
  const tl = [
    [1000, 5],
    [2000, 12],
  ]
  assert.equal(ghostPos(tl, 0), 0)
  assert.equal(ghostPos(tl, 500), 2)
  assert.equal(ghostPos(tl, 1500), 8)
  assert.equal(ghostPos(tl, 5000), 12)
})

test("against the computer: when you finish, the computer racers finish too", () => {
  const settings = validateSettings({ players: 3, length: "short", botWpm: 40 })
  const random = seeded(8)
  let s = rules.create({ players: players(3), settings, random, now: 0 })
  const text = s.prompts[0].text
  let now = s.goAt
  const ctx = () => ({ now, random, players: players(3) })
  s = rules.action(s, null, { type: "tick" }, ctx())
  // you type fast (100 WPM)
  for (let pos = 0; pos < text.length; ) {
    pos = Math.min(text.length, pos + 3)
    now += 360
    s = rules.action(s, null, { type: "tick" }, ctx())
    const r = rules.action(s, 0, { type: "progress", text: text.slice(0, pos), keys: pos, mistakes: 0 }, ctx())
    assert.ok(!r.error, r.error)
    s = r
  }
  assert.equal(s.phase, "done")
  const over = rules.isOver(s)
  assert.deepEqual(over.winners, [0])
  assert.equal(over.table.length, 3)
  assert.ok(s.results[0].table.every((row) => row.finished), "everyone crossed the line")
})

test("sudden death: one mistake and you're out", () => {
  const settings = validateSettings({ players: 2, mode: "sudden", promptId: "facts-2" })
  let s = rules.create({ players: players(2, 2), settings, random: seeded(1), now: 0 })
  const text = s.prompts[0].text
  s = rules.action(s, null, { type: "tick" }, { now: s.goAt, random: seeded(1), players: players(2, 2) })
  s = rules.action(s, 0, { type: "progress", text: text.slice(0, 3), keys: 4, mistakes: 1 }, { now: s.goAt + 2000 })
  assert.equal(s.racers[0].out, true)
  assert.equal(s.phase, "racing")
})

test("best of 3: race wins add up, the match ends at two", () => {
  const settings = validateSettings({ players: 2, mode: "best3", length: "short" })
  const random = seeded(4)
  let s = rules.create({ players: players(2, 2), settings, random, now: 0 })
  assert.equal(s.prompts.length, 3)
  for (let round = 0; round < 2; round++) {
    const text = s.prompts[s.round].text
    let now = s.goAt
    s = rules.action(s, null, { type: "tick" }, { now, random, players: players(2, 2) })
    for (let pos = 4; pos <= text.length + 3; pos += 4) {
      now += 1000
      s = rules.action(s, 0, { type: "progress", text: text.slice(0, Math.min(pos, text.length)), keys: pos, mistakes: 0 }, { now, random })
      assert.ok(!s.error, s.error)
    }
    s = rules.action(s, null, { type: "tick" }, { now: s.limitAt, random, players: players(2, 2) })
    if (round === 0) {
      assert.equal(s.phase, "between")
      s = rules.action(s, null, { type: "tick" }, { now: s.nextAt, random, players: players(2, 2) })
      assert.equal(s.round, 1)
      assert.equal(s.phase, "countdown")
    }
  }
  assert.equal(s.phase, "done")
  assert.equal(s.racers[0].points, 2)
  assert.deepEqual(rules.isOver(s).winners, [0])
})
