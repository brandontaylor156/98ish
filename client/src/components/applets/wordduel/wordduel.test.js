// Word Duel's rules. Run: node --test client/src/components/applets/wordduel/
import test from "node:test"
import assert from "node:assert/strict"
import * as L from "./logic.js"
import { makeRules } from "./rules.js"
import { DEFAULTS, PRESETS, presetSettings, validateSettings } from "./settings.js"
import { LENGTHS, loadWords, makeDict } from "./words/index.js"
import { createLocalGame } from "./local.js"

const lists = await Promise.all(LENGTHS.map(loadWords))
const dict = makeDict(lists)
const rules = makeRules(dict)

// ---------- judging ----------

test("colors: greens first, then yellows only while the answer has letters to spare", () => {
  assert.equal(L.score("crane", "crane"), "ggggg")
  assert.equal(L.score("trace", "crane"), "bggyg")
  // two E's guessed, one in the answer (in the right spot): the other is gray
  assert.equal(L.score("geese", "those"), "bbbgg")
  assert.equal(L.score("eerie", "those"), "bbbbg")
  // two E's guessed, three in the answer, none in place: both yellow
  assert.equal(L.score("sleep", "eerie"), "bbyyb")
  // three E's guessed, one in the answer: one yellow, the rest gray
  assert.equal(L.score("eerie", "ahead"), "ybbbb")
  // a repeated letter that's yellow once and gray once
  assert.equal(L.score("allee", "eagle"), "yybyg")
  assert.equal(L.score("speed", "abide"), "bbyby")
  assert.equal(L.score("lolly", "hello"), "byggb")
  assert.equal(L.score("mamma", "maxim"), "ggybb")
  assert.ok(L.solvedColors("ggggg"))
  assert.ok(!L.solvedColors("ggggy"))
})

test("hard mode: greens stay put, revealed letters must be used (as many as shown)", () => {
  const rows = [{ word: "trace", colors: L.score("trace", "crane") }]
  assert.equal(L.hardModeError("plumb", rows), "2nd letter must be R")
  assert.equal(L.hardModeError("graze", rows), "Guess must contain C")
  assert.equal(L.hardModeError("brace", rows), null)
  // two E's shown: both must come back
  const two = [{ word: "eerie", colors: "yybbb" }]
  assert.equal(L.hardModeError("elbow", two), "Guess must contain 2 Es")
  assert.equal(L.hardModeError("eaves", two), null)
  // a row from a clock running out has nothing to say
  assert.equal(L.hardModeError("crane", [{ word: null, colors: null }]), null)
})

test("the keyboard keeps each letter's best color", () => {
  const keys = L.keyStates([
    { word: "trace", colors: "bggyg" },
    { word: "crane", colors: "ggggg" },
  ])
  assert.equal(keys.t, "b")
  assert.equal(keys.c, "g")
  assert.equal(keys.r, "g")
})

test("points per tile: 2 per green spot found, 1 per letter found, each only once", () => {
  assert.equal(L.tilePoints([], { word: "trace", colors: "bggyg" }), 2 * 3 + 4)
  assert.equal(L.tilePoints([{ word: "trace", colors: "bggyg" }], { word: "crane", colors: "ggggg" }), 2 * 2 + 1)
})

test("absurd mode keeps the biggest group of words and only gives in when cornered", () => {
  const words = ["crane", "crate", "grate", "plumb", "fjord"]
  const step = L.absurdStep(words, "crane")
  assert.ok(step.candidates.length >= 1)
  assert.ok(!step.candidates.includes("crane"), "it dodged")
  assert.ok(!L.solvedColors(step.colors))
  for (const w of step.candidates) assert.equal(L.score("crane", w), step.colors)
  // one word left: guessing it wins
  const end = L.absurdStep(["fjord"], "fjord")
  assert.equal(end.colors, "ggggg")
  // a full game against the real list ends, eventually
  let cand = dict.answers(5)
  let guesses = 0
  let colors = ""
  while (!L.solvedColors(colors) && guesses < 30) {
    const word = L.botGuess({ answers: cand, rows: [], level: "hard", random: L.seeded(guesses) })
    const r = L.absurdStep(cand, cand.length <= 2 ? cand[0] : word)
    cand = r.candidates
    colors = r.colors
    guesses++
  }
  assert.ok(L.solvedColors(colors), "the absurd word was cornered")
})

test("the daily word is the same all day, different the next, and walks the whole list", () => {
  const answers = dict.answers(5)
  assert.equal(L.dailyWord(answers, "2026-10-03"), L.dailyWord(answers, "2026-10-03"))
  assert.notEqual(L.dailyWord(answers, "2026-10-03"), L.dailyWord(answers, "2026-10-04"))
  assert.equal(L.dayNumber("2026-10-01"), 1)
  assert.equal(L.dayNumber("2027-10-01"), 366)
  const year = new Set()
  for (let d = 0; d < 365; d++) year.add(L.dailyWord(answers, L.dayKey(new Date(Date.UTC(2026, 9, 1 + d)), true)))
  assert.equal(year.size, 365, "no repeats within a year")
})

test("share text: colored squares, no letters", () => {
  const text = L.shareText({ title: "Word Duel #3", rows: [{ word: "trace", colors: "bggyg" }, { word: "crane", colors: "ggggg" }], solved: true, max: 6 })
  assert.equal(text, "Word Duel #3 2/6\n\n⬛🟩🟩🟨🟩\n🟩🟩🟩🟩🟩")
  assert.ok(!/[a-z]{5}/.test(text.split("\n").slice(1).join("")))
  assert.match(L.shareText({ title: "x", rows: [], solved: false, max: 6, contrast: true, hard: true }), /^x X\/6\*/)
})

test("word lists: answers are real, unique, the right length, and not offensive", () => {
  for (const l of lists) {
    assert.ok(l.answers.length > 1000, `${l.length}: ${l.answers.length} answers`)
    assert.equal(new Set(l.answers).size, l.answers.length)
    for (const w of l.answers) {
      assert.equal(w.length, l.length)
      assert.ok(l.valid.has(w))
    }
    for (const bad of ["shit", "fuck", "bitch", "whore", "nigger", "rapist"]) assert.ok(!l.answers.includes(bad), bad)
  }
  assert.ok(dict.isWord("crane"))
  assert.ok(dict.isWord("aahed"), "obscure words are fine as guesses")
  assert.ok(!dict.answers(5).includes("aahed"))
  assert.ok(!dict.isWord("zzzzz"))
})

test("the computer player guesses plausibly: only words that fit what it has seen", () => {
  const answers = dict.answers(5)
  const rows = [{ word: "trace", colors: L.score("trace", "crane") }]
  for (let i = 0; i < 20; i++) {
    const w = L.botGuess({ answers, rows, level: "normal", random: L.seeded(i) })
    assert.ok(L.fits(w, rows[0]), `${w} fits`)
  }
  // a hard computer player solves real words in a sensible number of guesses
  let total = 0
  for (let g = 0; g < 30; g++) {
    const answer = answers[(g * 97) % answers.length]
    const seen = []
    let n = 0
    for (; n < 12; n++) {
      const w = L.botGuess({ answers, rows: seen, level: "hard", random: L.seeded(g * 31 + n) })
      seen.push({ word: w, colors: L.score(w, answer) })
      if (w === answer) break
    }
    total += n + 1
  }
  assert.ok(total / 30 < 5.5, `average ${total / 30}`)
})

// ---------- settings ----------

test("settings: anything goes in, clean settings come out", () => {
  assert.deepEqual(validateSettings({}), { ...DEFAULTS, preset: "race" })
  const s = validateSettings({ format: "rush", boards: 4, rounds: 5, guesses: 0, timer: "guess" })
  assert.equal(s.boards, 1)
  assert.equal(s.rounds, 1)
  assert.equal(s.timer, "none")
  assert.equal(s.guesses, 6)
  assert.equal(validateSettings({ format: "absurd", source: "daily" }).source, "random")
  assert.equal(validateSettings({ teams: true, players: 4, format: "turns" }).teams, false)
  assert.match(validateSettings({ source: "list", list: "cat dog", length: 5 }).error, /5-letter/)
  assert.equal(validateSettings({ handicap: [9, -9, "x"] }).handicap.slice(0, 3).join(), "5,-3,0")
  for (const name of Object.keys(PRESETS)) assert.ok(!validateSettings(presetSettings(name)).error, name)
})

// ---------- the rules ----------

const clockedGame = (settings, players) => {
  let now = 1_000_000
  const timers = []
  const time = {
    now: () => now,
    setTimeout: (fn, ms) => (timers.push({ at: now + ms, fn }), timers.length),
    clearTimeout: (h) => timers[h - 1] && (timers[h - 1].fn = null),
    setInterval: (fn, ms) => {
      const h = { fn, ms, next: now + ms }
      timers.push(h)
      return timers.length
    },
    clearInterval: (h) => timers[h - 1] && (timers[h - 1].fn = null),
  }
  const game = createLocalGame({ rules, settings: validateSettings(settings), players, random: L.seeded(5), time })
  const advance = (ms) => {
    const end = now + ms
    while (now < end) {
      now += 100
      for (const t of timers) {
        if (!t.fn) continue
        if (t.ms && now >= t.next) {
          t.next += t.ms
          t.fn()
        } else if (!t.ms && now >= t.at) {
          const fn = t.fn
          t.fn = null
          fn()
        }
      }
    }
  }
  return { game, advance }
}
const you = (n = 0) => [{ id: 0, name: "You", bot: false }, ...Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `Bot ${i + 1}`, bot: true }))]
const answerOf = (game, set = 0, board = 0) => game.state.sets[set].boards[board].answer

test("classic solo: solve it, win; the view hides the word until then", () => {
  const { game } = clockedGame({ format: "race", players: 1 }, you())
  const answer = answerOf(game)
  assert.ok(!JSON.stringify(game.view(0)).includes(`"${answer}"`))
  assert.equal(game.act({ type: "guess", word: "qqqqq" }).error, "Not in word list")
  const wrong = answer === "crane" ? "slate" : "crane"
  assert.ok(game.act({ type: "guess", word: wrong }).ok)
  assert.ok(game.act({ type: "guess", word: answer }).ok)
  assert.deepEqual(game.result.winners, [0])
  assert.equal(game.view(0).sets[0].words, 2)
  assert.deepEqual(game.view(0).history[0].answers, [[answer]])
})

test("out of guesses: a loss, and the word is shown", () => {
  const { game } = clockedGame({ format: "race", players: 1, guesses: 4 }, you())
  const answer = answerOf(game)
  for (const w of ["fjord", "nymph", "waltz", "gucks"].filter((w) => w !== answer).slice(0, 4)) game.act({ type: "guess", word: w })
  if (!game.result) game.act({ type: "guess", word: "vibex" })
  assert.ok(game.result)
  assert.deepEqual(game.result.winners, [])
})

test("allow any letters: nonsense guesses are fine", () => {
  const { game } = clockedGame({ format: "race", players: 1, strict: false }, you())
  assert.ok(game.act({ type: "guess", word: "qqqqq" }).ok)
})

test("multi-board: every guess goes on every board until each is solved", () => {
  const { game } = clockedGame({ format: "race", players: 1, boards: 4, guesses: 9 }, you())
  const answers = game.state.sets[0].boards.map((b) => b.answer)
  assert.equal(new Set(answers).size, 4, "four different words")
  for (const w of answers) game.act({ type: "guess", word: w })
  const v = game.view(0)
  assert.deepEqual(v.sets[0].boards.map((b) => b.solvedAt), [0, 1, 2, 3])
  // a solved board takes no more rows
  assert.equal(v.sets[0].boards[0].rows[1].colors, null)
  assert.deepEqual(game.result.winners, [0])
})

test("race against the computer: same word, scored by guesses; the computer plays on its own clock", () => {
  const { game, advance } = clockedGame({ format: "race", players: 2, scoring: "guesses", bots: "hard" }, you(1))
  assert.equal(answerOf(game, 0), answerOf(game, 1))
  advance(120_000)
  const bot = game.view(0).sets[1]
  assert.ok(bot.done, "the computer finished")
  assert.ok(bot.words >= 1 && bot.words <= 6)
  // the computer's letters are hidden from you (colors only by default)
  assert.equal(game.view(0).sets[1].boards[0].rows[0].word, undefined)
  game.act({ type: "guess", word: answerOf(game, 0) })
  assert.ok(game.result)
  assert.deepEqual(game.result.winners, bot.solved && bot.words === 1 ? [0, 1].slice(0, 0) : [0], "one guess beats the computer")
})

test("speed rush: a new word after each solve, until the clock runs out", () => {
  const { game, advance } = clockedGame({ format: "rush", players: 1, rushSecs: 60 }, you())
  for (let i = 0; i < 3; i++) game.act({ type: "guess", word: answerOf(game) })
  const v = game.view(0)
  assert.equal(v.sets[0].rush.solved, 3)
  assert.equal(v.sets[0].words, 0)
  assert.ok(v.sets[0].rush.last.solved)
  assert.ok(!game.result)
  advance(61_000)
  assert.deepEqual(game.result.winners, [0])
  assert.deepEqual(game.result.scores, [3])
})

test("best of 3: the series ends as soon as someone has two round wins", () => {
  const { game, advance } = clockedGame({ format: "race", players: 2, rounds: 3, series: "wins", scoring: "guesses" }, you(1))
  for (let round = 1; round <= 2; round++) {
    assert.equal(game.view(0).round, round)
    game.act({ type: "guess", word: answerOf(game) })
    advance(60_000) // the computer finishes, the round ends, the next starts
  }
  assert.ok(game.result, "over after two wins")
  assert.deepEqual(game.result.winners, [0])
  assert.equal(game.view(0).history.length, 2)
})

test("co-op voting: a majority plays the word", () => {
  const { game, advance } = clockedGame({ format: "coop", players: 3, coopMode: "vote" }, you(2))
  const answer = answerOf(game)
  assert.ok(game.act({ type: "guess", word: "slate" === answer ? "crane" : "slate" }).ok)
  assert.equal(game.view(0).sets[0].words, 0, "a suggestion, not a guess yet")
  assert.equal(game.view(0).sets[0].votes.length, 1)
  advance(25_000) // the computers suggest too, or the vote runs out
  assert.ok(game.view(0).sets[0].words >= 1)
})

test("absurd solo: the word dodges until it's cornered", () => {
  const { game } = clockedGame({ format: "absurd", players: 1 }, you())
  const v0 = game.view(0)
  assert.equal(v0.sets[0].boards[0].left, dict.answers(5).length)
  game.act({ type: "guess", word: "crane" })
  const v1 = game.view(0)
  assert.ok(v1.sets[0].boards[0].left < v0.sets[0].boards[0].left)
  assert.ok(!L.solvedColors(v1.sets[0].boards[0].rows[0].colors))
  // keep guessing what's left until it gives in
  for (let i = 0; i < 40 && !game.result; i++) game.act({ type: "guess", word: game.state.sets[0].boards[0].cand[0] })
  assert.deepEqual(game.result.winners, [0])
})

test("handicaps: extra guesses for one seat", () => {
  const handicap = [2, -1, 0, 0, 0, 0, 0, 0]
  const { game } = clockedGame({ format: "race", players: 2, handicap }, you(1))
  assert.equal(game.view(0).sets[0].max, 8)
  assert.equal(game.view(0).sets[1].max, 5)
})

test("teams: odd seats against even seats, one board per team", () => {
  const { game } = clockedGame({ format: "race", players: 4, teams: true }, you(3))
  const v = game.view(0)
  assert.deepEqual(v.teams.map((t) => t.seats), [[0, 2], [1, 3]])
  assert.equal(v.sets.length, 2)
})

test("a custom word list: the words come from the list", () => {
  const { game } = clockedGame({ format: "race", players: 1, source: "list", list: "Mango, pixel; zebra crane cat elephant" }, you())
  assert.ok(["mango", "pixel", "zebra", "crane"].includes(answerOf(game)))
})
