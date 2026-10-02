// The Quiz Show's rules, shared by the browser and the server (server/quiz): fuzzy
// free-text answers, scoring, what a quiz or challenge may contain, compatibility results,
// "Trivia about us" questions, streaks and badges. Pure functions; packs come in as
// arguments (see packs.js).

export const LIMITS = { title: 60, text: 200, option: 80, answer: 80, minQ: 1, maxQ: 30, minOptions: 2, maxOptions: 6, minItems: 3, maxItems: 20 }
export const TYPES = ["choice", "truefalse", "text", "who"]
export const WHO = ["author", "taker", "both"]
export const KINDS = ["knowme", "tot", "custom", "compat"]
export const KIND_NAMES = { knowme: "How Well Do You Know Me?", tot: "This or That", custom: "Custom Quiz", compat: "Compatibility Quiz" }

// ---------- random helpers ----------

export const shuffle = (list, random = Math.random) => {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}
export const pickSome = (list, n, random = Math.random) => shuffle(list, random).slice(0, n)

// A small seeded random (mulberry32), so a shuffle can be the same on both screens
export const seeded = (seed) => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------- fuzzy free text ----------

const STOP = new Set(["a", "an", "the", "my", "our", "your", "his", "her", "their", "its"])
const NUMBERS = { zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10", eleven: "11", twelve: "12", thirteen: "13", fourteen: "14", fifteen: "15", sixteen: "16", seventeen: "17", eighteen: "18", nineteen: "19", twenty: "20" }
const singular = (w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w)

// "The Beatles!" -> "beatle"; "Twenty-one" -> "20 1" (close enough to match itself)
export const normalizeText = (text) => {
  const words = String(text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean)
  const kept = words.filter((w) => !STOP.has(w))
  return (kept.length ? kept : words).map((w) => singular(NUMBERS[w] ?? w)).join(" ")
}

export const editDistance = (a, b) => {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = row
  }
  return prev[b.length]
}

// Close enough for one word or phrase: exact for short ones, a typo allowed in medium
// ones, 80% alike for long ones
const closeEnough = (a, b) => {
  if (a === b) return true
  const n = Math.max(a.length, b.length)
  if (n <= 4) return false
  const d = editDistance(a, b)
  return n <= 7 ? d <= 1 : 1 - d / n >= 0.8
}

// Every word of the shorter phrase is in the longer one, and it's at least half as long
const coversWords = (a, b) => {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  if (short.length < 4 || short.length < long.length * 0.5) return false
  const longWords = long.split(" ")
  return short.split(" ").every((w) => longWords.some((x) => closeEnough(w, x)))
}

// Does `given` match the expected answer? Alternatives can be separated with "/" or "|"
// ("Paris / France").
export const fuzzyMatch = (expected, given) => {
  const g = normalizeText(given)
  if (!g) return false
  const alternatives = String(expected ?? "")
    .split(/[/|]/)
    .map(normalizeText)
    .filter(Boolean)
  return alternatives.some((a) => closeEnough(a, g) || coversWords(a, g))
}

// ---------- custom quizzes ----------

class Invalid extends Error {}
const fail = (message) => {
  throw new Invalid(message)
}
const guard = (fn) => {
  try {
    return fn()
  } catch (error) {
    if (error instanceof Invalid) return { ok: false, error: error.message }
    throw error
  }
}

// plain text on one line, no control characters
export const cleanLine = (text) =>
  String(text ?? "")
    .replace(/[\u0000-\u001F\u007F​-‏‪-‮⁦-⁩]/g, " ")
    .replace(/\s+/g, " ")
    .trim()

const line = (value, max, what) => {
  if (typeof value !== "string" && typeof value !== "number") fail(`${what} must be text.`)
  const text = cleanLine(value)
  if (!text) fail(`${what} can't be empty.`)
  if (text.length > max) fail(`${what} can be at most ${max} characters.`)
  return text
}

// One question of a custom quiz, as the author wrote it (with its answer).
// -> { question: { type, text, options? }, answer }
const cleanQuestion = (q, i) => {
  if (!q || typeof q !== "object") fail(`Question ${i + 1} is missing.`)
  const type = TYPES.includes(q.type) ? q.type : fail(`Question ${i + 1} has an unknown type.`)
  const text = line(q.text, LIMITS.text, `Question ${i + 1}`)
  if (type === "choice") {
    if (!Array.isArray(q.options)) fail(`Question ${i + 1} needs answers to choose from.`)
    const options = q.options.map((o, j) => line(o, LIMITS.option, `Answer ${j + 1} of question ${i + 1}`))
    if (options.length < LIMITS.minOptions || options.length > LIMITS.maxOptions) fail(`Question ${i + 1} needs ${LIMITS.minOptions} to ${LIMITS.maxOptions} answers.`)
    if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) fail(`Question ${i + 1} has the same answer twice.`)
    const answer = Number(q.answer)
    if (!Number.isInteger(answer) || answer < 0 || answer >= options.length) fail(`Pick the right answer for question ${i + 1}.`)
    return { question: { type, text, options }, answer }
  }
  if (type === "truefalse") {
    if (typeof q.answer !== "boolean") fail(`Pick true or false for question ${i + 1}.`)
    return { question: { type, text }, answer: q.answer }
  }
  if (type === "text") return { question: { type, text }, answer: line(q.answer, LIMITS.answer, `The answer to question ${i + 1}`) }
  if (!WHO.includes(q.answer)) fail(`Pick who it is for question ${i + 1}.`)
  return { question: { type, text }, answer: q.answer }
}

// A whole custom quiz -> { ok, title, questions, key } | { ok: false, error }
export const validateCustom = (input = {}) =>
  guard(() => {
    const title = line(input.title ?? "", LIMITS.title, "The title")
    if (!Array.isArray(input.questions) || input.questions.length < LIMITS.minQ) fail("Add at least one question.")
    if (input.questions.length > LIMITS.maxQ) fail(`A quiz can have at most ${LIMITS.maxQ} questions.`)
    const cleaned = input.questions.map(cleanQuestion)
    return { ok: true, title, questions: cleaned.map((c) => c.question), key: cleaned.map((c) => c.answer) }
  })

// Is one given answer right?
export const checkAnswer = (question, key, given) => {
  if (given === null || given === undefined) return false
  switch (question.type) {
    case "choice":
      return Number(given) === key
    case "truefalse":
      return given === key
    case "text":
      return fuzzyMatch(key, given)
    case "who":
      return given === key
    default:
      return false
  }
}

// A taker's answers are well formed for these questions?
const cleanGiven = (question, value) => {
  if (value === null || value === undefined) return null
  switch (question.type) {
    case "choice": {
      const n = Number(value)
      return Number.isInteger(n) && n >= 0 && n < question.options.length ? n : fail("One of the answers isn't one of the choices.")
    }
    case "truefalse":
      return typeof value === "boolean" ? value : fail("True or false answers must be true or false.")
    case "text":
      return typeof value === "string" ? cleanLine(value).slice(0, LIMITS.answer) : fail("Typed answers must be text.")
    case "who":
      return WHO.includes(value) ? value : fail("Pick one of the three people.")
    default:
      return fail("Unknown question.")
  }
}

// -> { per: [true|false], correct, total, percent }
export const scoreAnswers = (questions, key, given) => {
  const per = questions.map((q, i) => checkAnswer(q, key[i], given[i]))
  const correct = per.filter(Boolean).length
  return { per, correct, total: questions.length, percent: questions.length ? Math.round((correct / questions.length) * 100) : 0 }
}

// ---------- compatibility ----------

// -> { counts: { cat: n }, percents: { cat: % }, top, order: [cats by score] }
export const compatResult = (quiz, answers) => {
  const cats = Object.keys(quiz.categories)
  const counts = Object.fromEntries(cats.map((c) => [c, 0]))
  quiz.questions.forEach((q, i) => {
    const option = q.options[answers[i]]
    if (option) counts[option.cat]++
  })
  const total = Object.values(counts).reduce((s, n) => s + n, 0) || 1
  const percents = Object.fromEntries(cats.map((c) => [c, Math.round((counts[c] / total) * 100)]))
  const order = [...cats].sort((a, b) => counts[b] - counts[a] || cats.indexOf(a) - cats.indexOf(b))
  return { counts, percents, top: order[0], order }
}

// Two people's results side by side: how in sync (100 = identical leanings) and a line
export const coupleCompat = (quiz, a, b) => {
  const cats = Object.keys(quiz.categories)
  const totalA = Object.values(a.counts).reduce((s, n) => s + n, 0) || 1
  const totalB = Object.values(b.counts).reduce((s, n) => s + n, 0) || 1
  const distance = cats.reduce((s, c) => s + Math.abs(a.counts[c] / totalA - b.counts[c] / totalB), 0) / 2
  const sync = Math.round((1 - distance) * 100)
  const same = a.top === b.top
  const shared = cats.filter((c) => a.order.slice(0, 2).includes(c) && b.order.slice(0, 2).includes(c))
  const name = (c) => quiz.categories[c].short
  const text = same
    ? `You both lead with ${name(a.top)}. Two peas in a pod!`
    : shared.length
      ? `Different favorites, but you share a soft spot for ${shared.map(name).join(" and ")}.`
      : `Opposites attract! ${name(a.top)} meets ${name(b.top)}: you'll always have something new to show each other.`
  return { sync, same, shared, text }
}

// ---------- challenges (sent to someone to take later) ----------

const ids = (value, valid, min, max, what) => {
  if (!Array.isArray(value)) fail(`Pick some ${what}.`)
  if (value.length < min || value.length > max) fail(`Pick ${min} to ${max} ${what}.`)
  const list = value.map(String)
  if (new Set(list).size !== list.length) fail(`The same ${what.replace(/s$/, "")} is in there twice.`)
  for (const id of list) if (!valid(id)) fail(`Unknown ${what.replace(/s$/, "")}.`)
  return list
}

const choiceAnswers = (value, counts, what = "your answers") => {
  if (!Array.isArray(value) || value.length !== counts.length) fail(`Answer every question first.`)
  return value.map((v, i) => {
    const n = Number(v)
    if (!Number.isInteger(n) || n < 0 || n >= counts[i]) fail(`One of ${what} isn't one of the choices.`)
    return n
  })
}

const index = (list) => new Map(list.map((x) => [x.id, x]))

// What the author sends -> { ok, kind, payload, key } | { ok: false, error }. The key (the
// author's own answers) is never shown to the taker before they answer.
// content: { aboutMe, pairs, compat }
export const validateChallenge = (input = {}, content) =>
  guard(() => {
    const kind = KINDS.includes(input.kind) ? input.kind : fail("Unknown kind of quiz.")
    if (kind === "knowme" || kind === "tot") {
      const pool = index(kind === "knowme" ? content.aboutMe : content.pairs)
      const items = ids(input.items, (id) => pool.has(id), LIMITS.minItems, LIMITS.maxItems, "questions")
      const key = choiceAnswers(input.answers, items.map((id) => (kind === "knowme" ? pool.get(id).options.length : 2)))
      return { ok: true, kind, payload: { items }, key }
    }
    if (kind === "compat") {
      const quiz = content.compat.find((q) => q.id === input.quizId) || fail("Unknown quiz.")
      const key = choiceAnswers(input.answers, quiz.questions.map((q) => q.options.length))
      return { ok: true, kind, payload: { quizId: quiz.id }, key }
    }
    const custom = validateCustom(input)
    if (!custom.ok) return custom
    return { ok: true, kind, payload: { title: custom.title, questions: custom.questions }, key: custom.key }
  })

// The questions of a challenge in the custom-quiz shape ({ type, text, options })
export const challengeQuestions = (kind, payload, content, names = {}) => {
  if (kind === "custom") return payload.questions
  if (kind === "knowme") {
    const pool = index(content.aboutMe)
    return payload.items.map((id) => ({ type: "choice", id, text: pool.get(id).them.replace(/\{name\}/g, names.author || "they"), options: pool.get(id).options }))
  }
  if (kind === "tot") {
    const pool = index(content.pairs)
    return payload.items.map((id) => ({ type: "choice", id, text: pool.get(id).prompt, options: [pool.get(id).a, pool.get(id).b] }))
  }
  const quiz = content.compat.find((q) => q.id === payload.quizId)
  return quiz.questions.map((q) => ({ type: "choice", text: q.q, options: q.options.map((o) => o.text) }))
}

// The taker's answers, checked -> { ok, answers } | { ok: false, error }
export const validateAttempt = (kind, payload, answers, content) =>
  guard(() => {
    const questions = challengeQuestions(kind, payload, content)
    if (!Array.isArray(answers) || answers.length !== questions.length) fail("Answer every question first.")
    const cleaned = questions.map((q, i) => cleanGiven(q, answers[i]))
    if (kind !== "custom" && cleaned.some((a) => a === null)) fail("Answer every question first.")
    return { ok: true, answers: cleaned }
  })

// The result of a finished challenge: { per, correct, total, percent, ... }
export const scoreChallenge = (kind, payload, key, answers, content) => {
  if (kind === "compat") {
    const quiz = content.compat.find((q) => q.id === payload.quizId)
    const author = compatResult(quiz, key)
    const taker = compatResult(quiz, answers)
    const couple = coupleCompat(quiz, author, taker)
    const per = key.map((k, i) => quiz.questions[i].options[k].cat === quiz.questions[i].options[answers[i]]?.cat)
    return { per, correct: per.filter(Boolean).length, total: per.length, percent: couple.sync, author, taker, couple }
  }
  return scoreAnswers(challengeQuestions(kind, payload, content), key, answers)
}

// ---------- reactions ----------

export const soulmateLine = (percent) =>
  percent >= 100
    ? "Mind reader! You know each other by heart."
    : percent >= 90
      ? "Soulmates! Practically telepathic."
      : percent >= 75
        ? "Two peas in a pod!"
        : percent >= 50
          ? "Pretty in tune, with a few sweet surprises."
          : percent >= 25
            ? "Still some mysteries to unwrap. Fun!"
            : "Strangers on a train? Time for a long talk over dessert."

export const MATCH_REACTIONS = ["Nailed it!", "Mind meld!", "You know them so well!", "Bullseye!", "Same brain!", "Aww, perfect match!", "Telepathy confirmed!", "Spot on!"]
export const MISS_REACTIONS = ["So close!", "Plot twist!", "Ooh, now you know!", "Surprise!", "Next time!", "Noted for later!", "Not quite!", "A new fact unlocked!"]
export const reaction = (match, n) => (match ? MATCH_REACTIONS : MISS_REACTIONS)[Math.abs(n) % 8]

// Points for a trivia answer: 100 for right, up to 50 more for speed
export const triviaPoints = (correct, msLeft = 0, msTotal = 0) => (correct ? 100 + (msTotal > 0 ? Math.round((50 * Math.max(0, Math.min(msLeft, msTotal))) / msTotal) : 0) : 0)

// ---------- Trivia about us ----------

// facts: [{ subject, qid, answer, at }] from finished "How well do you know me" games.
// -> questions { id, q, options, answer, subject } (newest fact per person and question)
export const buildAboutUs = (facts, aboutMe, { count = 10, random = Math.random } = {}) => {
  const pool = index(aboutMe)
  const latest = new Map()
  for (const f of [...(facts || [])].sort((a, b) => (a.at || 0) - (b.at || 0))) {
    const q = pool.get(f.qid)
    if (!q || !f.subject || !Number.isInteger(f.answer) || f.answer < 0 || f.answer >= q.options.length) continue
    latest.set(`${f.subject.toLowerCase()}|${f.qid}`, f)
  }
  return pickSome([...latest.values()], count, random).map((f) => {
    const q = pool.get(f.qid)
    return { id: `us-${f.qid}-${f.subject}`, q: `${q.them.replace(/\{name\}/g, f.subject)}`, options: q.options, answer: f.answer, subject: f.subject }
  })
}

// ---------- streaks and badges ----------

export const dayKey = (time = Date.now()) => {
  const d = new Date(time)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

// Days in a row with a game, counting back from today (or yesterday, if not yet today)
export const streakFrom = (days, now = Date.now()) => {
  const set = new Set(days)
  const day = 86_400_000
  let t = now
  if (!set.has(dayKey(t))) t -= day
  let n = 0
  while (set.has(dayKey(t))) {
    n++
    t -= day
  }
  return n
}

// stats: { games, wins, perfect, deepCards, customs, sent, triviaPerfect, compat, live, streak, partyGames }
export const BADGES = [
  { id: "first", name: "First Date", text: "Played your first game.", test: (s) => s.games >= 1 },
  { id: "mind", name: "Mind Reader", text: "Scored 100% on How Well Do You Know Me.", test: (s) => s.perfect >= 1 },
  { id: "deep", name: "Deep Diver", text: "Talked through 20 Deep Talk cards.", test: (s) => s.deepCards >= 20 },
  { id: "master", name: "Quiz Master", text: "Won 10 quizzes.", test: (s) => s.wins >= 10 },
  { id: "builder", name: "Quiz Builder", text: "Made your own quiz.", test: (s) => s.customs >= 1 },
  { id: "postman", name: "Love Letters", text: "Sent 5 quizzes to someone.", test: (s) => s.sent >= 5 },
  { id: "brainy", name: "Big Brain", text: "Got every question right in a trivia round.", test: (s) => s.triviaPerfect >= 1 },
  { id: "matchmaker", name: "Matchmaker", text: "Finished a compatibility quiz.", test: (s) => s.compat >= 1 },
  { id: "party", name: "Life of the Party", text: "Played 3 live games.", test: (s) => s.live >= 3 },
  { id: "streak3", name: "On a Roll", text: "Played 3 days in a row.", test: (s) => s.streak >= 3 },
  { id: "streak7", name: "Sweet Habit", text: "Played 7 days in a row.", test: (s) => s.streak >= 7 },
  { id: "marathon", name: "Marathon", text: "Played 25 games.", test: (s) => s.games >= 25 },
]
export const badgesFor = (stats) => BADGES.filter((b) => b.test(stats)).map((b) => b.id)
