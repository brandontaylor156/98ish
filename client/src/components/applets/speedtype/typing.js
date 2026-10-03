// Speed Typist 98's typing math, shared by the browser and the server (plain ES module):
// text normalization (curly quotes, dashes, odd spaces), words-per-minute and accuracy,
// and the typing field's state machine (what's correct, what's red, when a word is done).

// ---------- normalizing ----------

// Phones and word processors "smarten" what you type: curly quotes, long dashes, one-
// character ellipses, no-break spaces. They all count as the plain ASCII character.
export const normalizeChars = (s) =>
  String(s ?? "")
    .replace(/[\u2018\u2019\u201a\u201b\u2032\u02bc]/g, "'")
    .replace(/[\u201c\u201d\u201e\u201f\u2033\u00ab\u00bb]/g, '"')
    .replace(/[\u2010-\u2015\u2212\ufe58\ufe63\uff0d]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000\t\r\n]/g, " ")
    .replace(/[\u200b-\u200d\u2060\ufeff]/g, "")

// A prompt (from the library or pasted by a host): normalized, printable, single spaces
export const normalizePrompt = (s) =>
  normalizeChars(s)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
    .replace(/ {2,}/g, " ")
    .trim()

// What's in the typing field (spaces kept as typed)
export const normalizeInput = (s) => normalizeChars(s)

// ---------- speed ----------

// a "word" is five characters, spaces and punctuation included
export const wpm = (chars, ms) => (ms > 0 && chars > 0 ? chars / 5 / (ms / 60000) : 0)
export const accuracy = (keys, mistakes) => (keys > 0 ? Math.max(0, Math.min(1, (keys - mistakes) / keys)) : 1)
export const round1 = (n) => Math.round(n * 10) / 10

// how many characters at the start of a and b are the same
export const commonPrefix = (a, b) => {
  const n = Math.min(a.length, b.length)
  let i = 0
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++
  return i
}

// The words of a prompt as [start, end) ranges; each word owns the space after it
export const wordRanges = (prompt) => {
  const out = []
  let start = 0
  for (let i = 0; i < prompt.length; i++) {
    if (prompt[i] === " ") {
      out.push([start, i + 1])
      start = i + 1
    }
  }
  if (start < prompt.length) out.push([start, prompt.length])
  return out
}
export const wordIndexAt = (ranges, pos) => {
  const i = ranges.findIndex(([, end]) => pos < end)
  return i < 0 ? ranges.length - 1 : i
}

// WPM over time from samples [[ms since the start, characters], ...]: one point per
// stretch of at least `step` ms (a moving window, so a pause shows up as a dip)
export const speedCurve = (samples, { step = 1000, window = 3000 } = {}) => {
  if (!Array.isArray(samples) || samples.length < 2) return []
  const pts = [[0, 0], ...samples.filter((s) => s[0] > 0)]
  const out = []
  let next = step
  const end = pts[pts.length - 1][0]
  const posAt = (t) => {
    if (t <= 0) return 0
    for (let i = 1; i < pts.length; i++) {
      if (pts[i][0] >= t) {
        const [t0, p0] = pts[i - 1]
        const [t1, p1] = pts[i]
        return t1 === t0 ? p1 : p0 + ((p1 - p0) * (t - t0)) / (t1 - t0)
      }
    }
    return pts[pts.length - 1][1]
  }
  for (; next <= end + step / 2; next += step) {
    const t = Math.min(next, end)
    const from = Math.max(0, t - window)
    out.push([t, Math.round(wpm(posAt(t) - posAt(from), t - from))])
    if (t === end) break
  }
  return out
}

// ---------- the typing field ----------
//
// The field holds what you've typed of the current word (and anything wrong after it).
// Each change goes through step(): it counts keystrokes and mistakes, refuses what isn't
// allowed (strict mode: a wrong key, or backspace; normal mode: piling up more than
// MAX_WRONG wrong characters), and moves the finished words out of the field.

export const MAX_WRONG = 12

export const startTyping = () => ({ committed: 0, value: "", keys: 0, mistakes: 0, done: false, lastError: false })

// -> { correct: characters right from the start, wrong: characters typed after the first slip }
export const judge = (prompt, t) => {
  const typed = prompt.slice(0, t.committed) + t.value
  const correct = commonPrefix(typed, prompt)
  return { typed, correct, wrong: typed.length - correct }
}

// state + the field's new value -> the next state (rejected: true when the field should
// snap back to the old value). Pure.
export const step = (prompt, t, rawValue, { strict = false } = {}) => {
  if (t.done) return t
  const value = normalizeInput(rawValue)
  const before = prompt.slice(0, t.committed) + t.value
  const typed = prompt.slice(0, t.committed) + value
  // the keys pressed: the new characters past where the old and new text agree
  const same = commonPrefix(before, typed)
  const added = typed.length - same
  // a wrong character still in the field makes everything typed after it wrong too
  let behind = commonPrefix(before.slice(0, same), prompt) < same
  let keys = t.keys
  let mistakes = t.mistakes
  let slipped = false
  for (let i = same; i < typed.length; i++) {
    keys++
    if (behind || typed[i] !== prompt[i]) {
      mistakes++
      slipped = true
      behind = true
    }
  }
  const correct = commonPrefix(typed, prompt)
  const wrong = typed.length - correct
  // strict: a wrong key doesn't go in (but counts), and there's no going back
  if (strict && (wrong > 0 || typed.length < before.length)) {
    return { ...t, keys, mistakes, lastError: slipped, rejected: true }
  }
  if (wrong > MAX_WRONG && added > 0) return { ...t, keys, mistakes, lastError: true, rejected: true }
  // finished words leave the field: everything up to the last correct space
  let committed = t.committed
  if (wrong === 0) {
    const space = typed.lastIndexOf(" ", correct - 1)
    if (space + 1 > committed) committed = space + 1
  }
  const done = correct === prompt.length && wrong === 0
  return { committed: done ? prompt.length : committed, value: done ? "" : typed.slice(committed), keys, mistakes, done, lastError: slipped && added > 0, rejected: false }
}

// ---------- the server's checks ----------

export const MAX_CPS = 25 // characters a second: 300 WPM, far past any human sprint
export const BURST = 12 // characters that may arrive together (network bunching)

// A racer's progress report against the prompt: -> null (fine) or a sentence why not.
// prev: { pos, at } the last accepted progress (at: server ms); goAt: the green light
export const checkProgress = ({ prompt, text, prev = { pos: 0, at: 0 }, goAt, now }) => {
  if (typeof text !== "string" || text.length > prompt.length) return "That isn't part of the prompt."
  if (!prompt.startsWith(text)) return "That doesn't match the prompt."
  if (now < goAt) return "Wait for the green light!"
  const gained = text.length - prev.pos
  if (gained > 0) {
    const since = Math.max(0, now - Math.max(prev.at || 0, goAt))
    if (gained > (MAX_CPS * since) / 1000 + BURST) return "Whoa, that's faster than anyone can type."
    if (text.length > BURST && text.length > (MAX_CPS * (now - goAt)) / 1000 + BURST) return "Whoa, that's faster than anyone can type."
  }
  return null
}
