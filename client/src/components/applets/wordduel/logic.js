// Word Duel's pure helpers (no React, no I/O): judging a guess, hard mode, the evil
// "absurd" host, the daily word, seeded randomness, share text and the solver the computer
// players use. The rules (rules.js) and the window (WordDuel.jsx) both build on these, and
// the server loads this very file (server/arcade/games/wordduel.js).
//
// A guess's colors are a string with one letter per tile:
//   g = green (right letter, right spot), y = yellow (in the word, another spot), b = gray

// ---------- judging ----------

// Colors for `guess` against `answer`, repeated letters done right: greens first, then
// yellows left to right only while the answer has that letter to spare
export const score = (guess, answer) => {
  const n = answer.length
  const out = Array(n).fill("b")
  const spare = {}
  for (let i = 0; i < n; i++) {
    if (guess[i] === answer[i]) out[i] = "g"
    else spare[answer[i]] = (spare[answer[i]] || 0) + 1
  }
  for (let i = 0; i < n; i++) {
    if (out[i] === "g") continue
    const c = guess[i]
    if (spare[c] > 0) {
      out[i] = "y"
      spare[c]--
    }
  }
  return out.join("")
}

export const solvedColors = (colors) => !!colors && /^g+$/.test(colors)

// Could `answer` still be the word, given what one row showed?
export const fits = (answer, row) => score(row.word, answer) === row.colors

const ORDINAL = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th"]

// Hard mode: every green must stay put and every revealed letter must be used (as many
// times as one row showed it). rows: [{ word, colors }]. -> a sentence, or null when fine
export const hardModeError = (guess, rows) => {
  for (const row of rows) {
    if (!row.word || !row.colors) continue
    for (let i = 0; i < row.colors.length; i++) {
      if (row.colors[i] === "g" && guess[i] !== row.word[i]) return `${ORDINAL[i] || `#${i + 1}`} letter must be ${row.word[i].toUpperCase()}`
    }
  }
  for (const row of rows) {
    if (!row.word || !row.colors) continue
    const need = {}
    for (let i = 0; i < row.colors.length; i++) if (row.colors[i] !== "b") need[row.word[i]] = (need[row.word[i]] || 0) + 1
    for (const [c, count] of Object.entries(need)) {
      const have = [...guess].filter((x) => x === c).length
      if (have < count) return count > 1 ? `Guess must contain ${count} ${c.toUpperCase()}s` : `Guess must contain ${c.toUpperCase()}`
    }
  }
  return null
}

// The keyboard's colors: the best each letter has shown (green beats yellow beats gray)
const RANK = { g: 3, y: 2, b: 1 }
export const keyStates = (rows) => {
  const keys = {}
  for (const row of rows) {
    if (!row.word || !row.colors) continue
    for (let i = 0; i < row.colors.length; i++) {
      const c = row.word[i]
      const s = row.colors[i]
      if (!keys[c] || RANK[s] > RANK[keys[c]]) keys[c] = s
    }
  }
  return keys
}

// Points per tile: each green spot found for the first time is worth 2, each letter first
// found to be in the word (yellow or green) 1. rows before this guess, then the new row
export const tilePoints = (before, row) => {
  if (!row.word || !row.colors) return 0
  const greens = new Set()
  const found = new Set()
  for (const r of before) {
    if (!r.word || !r.colors) continue
    for (let i = 0; i < r.colors.length; i++) {
      if (r.colors[i] === "g") greens.add(i)
      if (r.colors[i] !== "b") found.add(r.word[i])
    }
  }
  let points = 0
  for (let i = 0; i < row.colors.length; i++) {
    if (row.colors[i] === "g" && !greens.has(i)) points += 2
    if (row.colors[i] !== "b" && !found.has(row.word[i])) {
      points += 1
      found.add(row.word[i])
    }
  }
  return points
}

// ---------- absurd mode: the word keeps changing to dodge you ----------

const patternValue = (p) => [...p].reduce((sum, c) => sum + (c === "g" ? 3 : c === "y" ? 1 : 0), 0)

// Split the words that could still be the answer by the colors `guess` would get, and keep
// the biggest group (ties: the one that tells you least). -> { colors, candidates }
export const absurdStep = (candidates, guess) => {
  const groups = new Map()
  for (const word of candidates) {
    const p = score(guess, word)
    if (!groups.has(p)) groups.set(p, [])
    groups.get(p).push(word)
  }
  let best = null
  for (const [colors, words] of groups) {
    if (!best || words.length > best.candidates.length || (words.length === best.candidates.length && patternValue(colors) < patternValue(best.colors))) best = { colors, candidates: words }
  }
  // with nothing left to dodge to, the guess is right
  return best || { colors: "g".repeat(guess.length), candidates: [guess] }
}

// ---------- randomness and the daily word ----------

// A string -> a 32-bit number (FNV-1a)
export const hash = (text) => {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

// A seeded random number generator (mulberry32): -> () => [0, 1)
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

const pad = (n) => String(n).padStart(2, "0")
// "2026-10-03" for a date, in local time (solo) or UTC (the server)
export const dayKey = (date = new Date(), utc = false) =>
  utc ? `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}` : `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

// The puzzle number: days since Word Duel's first daily word (1 = 2026-10-01)
export const dayNumber = (key) => {
  const [y, m, d] = key.split("-").map(Number)
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(2026, 9, 1)) / 86_400_000) + 1
}

// The daily word: the same for everyone on the same day. Days walk a shuffled order of the
// answers (no repeats for years); `extra` picks more words (later rounds, more boards)
export const dailyWord = (answers, key, extra = 0) => {
  const n = answers.length
  const day = dayNumber(key) + extra * 7919
  // a full-cycle step through the list: odd step and length coprime
  let step = (hash(`step:${n}`) % n) | 1
  const gcd = (a, b) => (b ? gcd(b, a % b) : a)
  while (gcd(step, n) !== 1) step += 2
  const start = hash(`start:${n}`) % n
  return answers[(((start + day * step) % n) + n) % n]
}

export const pickRandom = (list, random) => list[Math.floor(random() * list.length) % list.length]

// ---------- sharing ----------

const EMOJI = { g: "🟩", y: "🟨", b: "⬛" }
const EMOJI_CONTRAST = { g: "🟧", y: "🟦", b: "⬛" }

// "Word Duel #3 4/6" and the rows as colored squares (no letters)
export const shareText = ({ title, rows, solved, max, contrast = false, hard = false }) => {
  const set = contrast ? EMOJI_CONTRAST : EMOJI
  const grid = rows
    .filter((r) => r.colors)
    .map((r) => [...r.colors].map((c) => set[c]).join(""))
    .join("\n")
  return `${title} ${solved ? rows.length : "X"}/${max || "∞"}${hard ? "*" : ""}\n\n${grid}`
}

// ---------- the computer player ----------

// Letter frequencies by position, for picking likely words (cached per list)
const freqCache = new WeakMap()
const freqOf = (answers) => {
  if (freqCache.has(answers)) return freqCache.get(answers)
  const any = {}
  const at = []
  for (const w of answers) {
    const seen = new Set()
    for (let i = 0; i < w.length; i++) {
      at[i] ||= {}
      at[i][w[i]] = (at[i][w[i]] || 0) + 1
      if (!seen.has(w[i])) any[w[i]] = (any[w[i]] || 0) + 1
      seen.add(w[i])
    }
  }
  const f = { any, at }
  freqCache.set(answers, f)
  return f
}
// how much a word would probably tell you: common letters, no repeats
const wordValue = (word, f) => {
  const seen = new Set()
  let v = 0
  for (let i = 0; i < word.length; i++) {
    if (!seen.has(word[i])) v += f.any[word[i]] || 0
    v += (f.at[i]?.[word[i]] || 0) * 0.5
    seen.add(word[i])
  }
  return v
}

const openerCache = new WeakMap()
// good first guesses for this list: the 40 best-valued answers
export const openers = (answers) => {
  if (openerCache.has(answers)) return openerCache.get(answers)
  const f = freqOf(answers)
  const best = [...answers].sort((a, b) => wordValue(b, f) - wordValue(a, f)).slice(0, 40)
  openerCache.set(answers, best)
  return best
}

// The words the computer can still think of. Easy players know only part of the list and
// sometimes forget where yellows can't go; others use everything they've seen.
export const candidatesFor = (answers, rows, { level = "normal", seed = 0, random = Math.random } = {}) => {
  let pool = answers
  if (level === "easy") pool = answers.filter((w) => hash(`${seed}:${w}`) % 100 < 55)
  const used = rows.filter((r) => r.word && r.colors)
  const loose = level === "easy" && random() < 0.35
  const ok = (w) =>
    used.every((r) => {
      if (!loose) return fits(w, r)
      // only greens and letters known to be missing
      for (let i = 0; i < w.length; i++) if (r.colors[i] === "g" && w[i] !== r.word[i]) return false
      const has = new Set([...r.word].filter((_, i) => r.colors[i] !== "b"))
      for (let i = 0; i < w.length; i++) if (r.colors[i] === "b" && !has.has(r.word[i]) && w.includes(r.word[i])) return false
      return w !== r.word
    })
  let list = pool.filter(ok)
  if (!list.length && pool !== answers) list = answers.filter((w) => used.every((r) => fits(w, r)))
  return list
}

// A plausible guess, not a perfect one. rows: what this computer player has seen;
// answers: the words it knows; extra: candidates that must be considered (absurd mode,
// a custom list). -> a word
export const botGuess = ({ answers, rows, level = "normal", random = Math.random, seed = 0 }) => {
  const used = rows.filter((r) => r.word && r.colors)
  if (!used.length) {
    const first = openers(answers)
    // easy players open with whatever comes to mind
    if (level === "easy") return pickRandom(answers, random)
    return pickRandom(level === "hard" ? first.slice(0, 12) : first, random)
  }
  const list = candidatesFor(answers, rows, { level, seed, random })
  if (!list.length) return pickRandom(answers, random)
  if (list.length <= 2 || level === "easy") return pickRandom(list, random)
  const f = freqOf(list)
  if (level === "normal") {
    // likely-looking words, with some luck
    const ranked = [...list].sort((a, b) => wordValue(b, f) - wordValue(a, f))
    return pickRandom(ranked.slice(0, Math.max(1, Math.ceil(ranked.length / 3))), random)
  }
  // hard: the candidate that splits the rest into the most groups (sampled for speed)
  const sample = list.length > 60 ? Array.from({ length: 60 }, () => pickRandom(list, random)) : list
  const against = list.length > 300 ? Array.from({ length: 300 }, () => pickRandom(list, random)) : list
  let best = null
  for (const g of sample) {
    const groups = new Set(against.map((w) => score(g, w)))
    const v = groups.size + random() * 0.5
    if (!best || v > best.v) best = { g, v }
  }
  return best.g
}

// ---------- words typed by people ----------

export const cleanWord = (text) => String(text ?? "").toLowerCase().replace(/[^a-z]/g, "")

// A pasted list: words of `length` letters, no repeats, at most `max`
export const parseList = (text, length, max = 300) => {
  const words = String(text ?? "")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length === length)
  return [...new Set(words)].slice(0, max)
}
