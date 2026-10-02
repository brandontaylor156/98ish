// Content and rules tests for the Quiz Show. Run: node --test client/src/components/applets/quiz/shared/
import test from "node:test"
import assert from "node:assert/strict"
import { loadAllPacks } from "./packs.js"
import * as L from "./logic.js"

const content = await loadAllPacks()

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
const noDupes = (list, label) => {
  const seen = new Set()
  for (const x of list) {
    assert.ok(!seen.has(x), `${label}: "${x}" appears twice`)
    seen.add(x)
  }
}

test("packs meet the counts (over 300 original questions)", () => {
  assert.ok(content.aboutMe.length >= 70, `about me: ${content.aboutMe.length}`)
  assert.ok(content.pairs.filter((p) => p.kind === "tot").length >= 60)
  assert.ok(content.pairs.filter((p) => p.kind === "wyr").length >= 40)
  for (const level of [1, 2, 3]) assert.ok(content.deep.filter((c) => c.level === level).length >= 30, `deep level ${level}`)
  assert.equal(content.compat.length, 3)
  assert.ok(content.triviaPacks.length >= 6)
  for (const p of content.triviaPacks) assert.ok(p.questions.length >= 15, `${p.name} has ${p.questions.length}`)
  const compatQuestions = content.compat.reduce((s, q) => s + q.questions.length, 0)
  const total = content.aboutMe.length + content.pairs.length + content.deep.length + compatQuestions + content.trivia.length + content.likely.length
  assert.ok(total >= 300, `only ${total} questions`)
  console.log(`  ${total} questions in all`)
})

test("every id is unique and no question appears twice", () => {
  const all = [...content.aboutMe, ...content.pairs, ...content.deep, ...content.trivia, ...content.likely].map((q) => q.id)
  noDupes(all, "ids")
  noDupes(content.aboutMe.map((q) => norm(q.me)), "about me")
  noDupes(content.aboutMe.map((q) => norm(q.them)), "about me (guess)")
  noDupes(content.pairs.map((p) => norm(`${p.a} ${p.b}`)), "pairs")
  noDupes(content.deep.map((c) => norm(c.text)), "deep talk")
  noDupes(content.trivia.map((q) => norm(q.q)), "trivia")
  noDupes(content.likely.map((q) => norm(q.text)), "likely")
  for (const quiz of content.compat) noDupes(quiz.questions.map((q) => norm(q.q)), quiz.title)
})

test("about-me questions have sensible answers and a {name} to fill in", () => {
  for (const q of content.aboutMe) {
    assert.ok(q.options.length >= 3 && q.options.length <= 6, q.id)
    noDupes(q.options.map(norm), q.id)
    assert.ok(q.them.includes("{name}"), `${q.id} guess text has no {name}`)
    assert.ok(!q.me.includes("{name}"), q.id)
    for (const o of q.options) assert.ok(o.length <= L.LIMITS.option, `${q.id}: ${o}`)
  }
})

test("every trivia question has exactly one valid answer among four distinct options", () => {
  const spots = [0, 0, 0, 0]
  for (const q of content.trivia) {
    assert.equal(q.options.length, 4, q.id)
    noDupes(q.options.map(norm), q.id)
    assert.ok(Number.isInteger(q.answer) && q.answer >= 0 && q.answer < 4, q.id)
    spots[q.answer]++
  }
  // the right answer isn't always in the same place
  for (const n of spots) assert.ok(n >= content.trivia.length / 8, `answer spots ${spots}`)
  // a few spot checks of the facts
  const answerOf = (start) => {
    const q = content.trivia.find((t) => t.q.startsWith(start))
    return q.options[q.answer]
  }
  assert.equal(answerOf("What is the capital of Australia"), "Canberra")
  assert.equal(answerOf("How many hearts does an octopus"), "3")
  assert.equal(answerOf("What is the chemical symbol for gold"), "Au")
  assert.equal(answerOf("How many bits are in a byte"), "8")
  assert.equal(answerOf("Which of these storage formats came out first"), "The compact disc (CD)")
})

test("compatibility quizzes: every option maps to a category, and categories are balanced", () => {
  for (const quiz of content.compat) {
    const cats = Object.keys(quiz.categories)
    assert.equal(cats.length, 5)
    const counts = Object.fromEntries(cats.map((c) => [c, 0]))
    for (const q of quiz.questions) {
      noDupes(q.options.map((o) => norm(o.text)), `${quiz.id}: ${q.q}`)
      for (const o of q.options) {
        assert.ok(cats.includes(o.cat), `${quiz.id}: ${o.text}`)
        counts[o.cat]++
      }
    }
    const values = Object.values(counts)
    assert.equal(Math.min(...values), Math.max(...values), `${quiz.id} unbalanced: ${JSON.stringify(counts)}`)
  }
})

test("fuzzy free-text matching", () => {
  const yes = [
    ["Paris", "paris"],
    ["The Beatles", "beatles"],
    ["chocolate chip cookies", "Chocolate-chip cookie"],
    ["Spaghetti", "spagetti"],
    ["Golden Retriever", "golden retreiver"],
    ["Paris / France", "france"],
    ["two", "2"],
    ["New York City", "new york"],
    ["Café", "cafe"],
    ["blue", "Blue!"],
  ]
  const no = [
    ["cat", "car"],
    ["Paris", "London"],
    ["pepperoni pizza", "pizza"],
    ["blue", ""],
    ["red", "   "],
    ["Spaghetti", "lasagna"],
  ]
  for (const [a, b] of yes) assert.ok(L.fuzzyMatch(a, b), `${a} ~ ${b}`)
  for (const [a, b] of no) assert.ok(!L.fuzzyMatch(a, b), `${a} !~ ${b}`)
})

test("custom quiz validation and scoring", () => {
  const quiz = {
    title: "  All about   me ",
    questions: [
      { type: "choice", text: "Favorite color?", options: ["Red", "Blue", "Green"], answer: 1 },
      { type: "truefalse", text: "I can whistle.", answer: false },
      { type: "text", text: "My first pet's name?", answer: "Mr. Whiskers" },
      { type: "who", text: "Which of us is more likely to burn dinner?", answer: "author" },
    ],
  }
  const v = L.validateCustom(quiz)
  assert.ok(v.ok, v.error)
  assert.equal(v.title, "All about me")
  assert.deepEqual(v.key, [1, false, "Mr. Whiskers", "author"])
  assert.equal(v.questions[0].answer, undefined, "answers are kept apart from questions")
  const s = L.scoreAnswers(v.questions, v.key, [1, false, "mr whiskers", "taker"])
  assert.deepEqual(s.per, [true, true, true, false])
  assert.equal(s.percent, 75)

  const bad = (patch, re) => {
    const r = L.validateCustom({ ...quiz, ...patch })
    assert.equal(r.ok, false)
    if (re) assert.match(r.error, re)
  }
  bad({ title: "" }, /title/)
  bad({ title: "x".repeat(61) }, /at most 60/)
  bad({ questions: [] }, /at least one/)
  bad({ questions: Array(31).fill(quiz.questions[1]) }, /at most 30/)
  bad({ questions: [{ type: "essay", text: "?", answer: "x" }] }, /unknown type/)
  bad({ questions: [{ type: "choice", text: "Q", options: ["a"], answer: 0 }] }, /2 to 6/)
  bad({ questions: [{ type: "choice", text: "Q", options: ["a", "A"], answer: 0 }] }, /same answer twice/)
  bad({ questions: [{ type: "choice", text: "Q", options: ["a", "b"], answer: 2 }] }, /right answer/)
  bad({ questions: [{ type: "truefalse", text: "Q", answer: "yes" }] }, /true or false/)
  bad({ questions: [{ type: "text", text: "Q", answer: "x".repeat(81) }] }, /at most 80/)
  bad({ questions: [{ type: "who", text: "Q", answer: "nobody" }] }, /who/)
  bad({ questions: [{ type: "text", text: { html: "<b>" }, answer: "x" }] }, /must be text/)
  // HTML stays plain text
  assert.equal(L.validateCustom({ ...quiz, title: "<b>hi</b>" }).title, "<b>hi</b>")
})

test("challenges: validation, attempts and scoring for every kind", () => {
  const items = content.aboutMe.slice(0, 5).map((q) => q.id)
  const knowme = L.validateChallenge({ kind: "knowme", items, answers: [0, 1, 2, 0, 1] }, content)
  assert.ok(knowme.ok, knowme.error)
  const r = L.scoreChallenge("knowme", knowme.payload, knowme.key, [0, 1, 2, 0, 0], content)
  assert.equal(r.correct, 4)
  assert.equal(r.percent, 80)
  assert.equal(L.validateChallenge({ kind: "knowme", items: [...items.slice(0, 4), items[0]], answers: [0, 0, 0, 0, 0] }, content).ok, false)
  assert.equal(L.validateChallenge({ kind: "knowme", items: ["am-nope", ...items.slice(1)], answers: [0, 0, 0, 0, 0] }, content).ok, false)
  assert.equal(L.validateChallenge({ kind: "knowme", items, answers: [0, 0, 0, 0, 99] }, content).ok, false)
  assert.equal(L.validateChallenge({ kind: "knowme", items: items.slice(0, 2), answers: [0, 0] }, content).ok, false)
  assert.equal(L.validateChallenge({ kind: "hack" }, content).ok, false)

  const pairs = content.pairs.slice(0, 4).map((p) => p.id)
  const tot = L.validateChallenge({ kind: "tot", items: pairs, answers: [0, 1, 1, 0] }, content)
  assert.ok(tot.ok)
  assert.equal(L.scoreChallenge("tot", tot.payload, tot.key, [0, 1, 0, 0], content).correct, 3)
  assert.equal(L.validateAttempt("tot", tot.payload, [0, 1, 2, 0], content).ok, false)
  assert.equal(L.validateAttempt("tot", tot.payload, [0, 1], content).ok, false)

  const quiz = content.compat[0]
  const answers = quiz.questions.map(() => 0)
  const compat = L.validateChallenge({ kind: "compat", quizId: quiz.id, answers }, content)
  assert.ok(compat.ok)
  const same = L.scoreChallenge("compat", compat.payload, compat.key, answers, content)
  assert.equal(same.percent, 100)
  assert.ok(same.couple.same)
  const other = L.scoreChallenge("compat", compat.payload, compat.key, quiz.questions.map(() => 2), content)
  assert.ok(other.percent < 100)
  assert.ok(other.author.top && other.taker.top)

  const custom = L.validateChallenge({ kind: "custom", title: "Mine", questions: [{ type: "text", text: "Hometown?", answer: "Springfield" }] }, content)
  assert.ok(custom.ok)
  assert.deepEqual(L.validateAttempt("custom", custom.payload, ["  springfeld "], content).answers, ["springfeld"])
  assert.equal(L.scoreChallenge("custom", custom.payload, custom.key, ["springfeld"], content).percent, 100)
  assert.equal(L.validateAttempt("custom", custom.payload, [42], content).ok, false)
})

test("compatibility results and couple sync", () => {
  const quiz = content.compat.find((q) => q.id === "love-notes")
  const pickCat = (cat) => quiz.questions.map((q) => Math.max(0, q.options.findIndex((o) => o.cat === cat)))
  const words = L.compatResult(quiz, pickCat("words"))
  assert.equal(words.top, "words")
  assert.equal(words.counts.words, 9)
  const touch = L.compatResult(quiz, pickCat("touch"))
  assert.equal(touch.top, "touch")
  const c = L.coupleCompat(quiz, words, touch)
  assert.ok(c.sync < 60)
  assert.equal(c.same, false)
  assert.ok(c.text.length > 10)
})

test("trivia about us, points, streaks and badges", () => {
  const q = content.aboutMe[0]
  const facts = [
    { subject: "Sam", qid: q.id, answer: 1, at: 1 },
    { subject: "Sam", qid: q.id, answer: 2, at: 2 }, // newer answer wins
    { subject: "Alex", qid: q.id, answer: 0, at: 3 },
    { subject: "Alex", qid: "am-nope", answer: 0, at: 4 },
    { subject: "Alex", qid: q.id, answer: 99, at: 0 },
  ]
  const built = L.buildAboutUs(facts, content.aboutMe, { random: () => 0.5 })
  assert.equal(built.length, 2)
  const sam = built.find((b) => b.subject === "Sam")
  assert.equal(sam.answer, 2)
  assert.ok(sam.q.includes("Sam") && !sam.q.includes("{name}"))

  assert.equal(L.triviaPoints(false, 5000, 10000), 0)
  assert.equal(L.triviaPoints(true, 10000, 10000), 150)
  assert.equal(L.triviaPoints(true, 0, 10000), 100)
  assert.equal(L.triviaPoints(true), 100)

  const now = new Date(2026, 9, 2, 12).getTime()
  const day = 86_400_000
  assert.equal(L.streakFrom([L.dayKey(now), L.dayKey(now - day), L.dayKey(now - 2 * day)], now), 3)
  assert.equal(L.streakFrom([L.dayKey(now - day), L.dayKey(now - 2 * day)], now), 2)
  assert.equal(L.streakFrom([L.dayKey(now - 3 * day)], now), 0)

  const none = { games: 0, wins: 0, perfect: 0, deepCards: 0, customs: 0, sent: 0, triviaPerfect: 0, compat: 0, live: 0, streak: 0 }
  assert.deepEqual(L.badgesFor(none), [])
  const lots = L.badgesFor({ ...none, games: 30, wins: 10, perfect: 1, deepCards: 20 })
  for (const id of ["first", "mind", "deep", "master", "marathon"]) assert.ok(lots.includes(id), id)
  assert.match(L.soulmateLine(100), /Mind reader/)
  assert.match(L.soulmateLine(90), /Soulmates/)
})
