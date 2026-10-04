// Small shared pieces for the quick games (Boom Frenzy, Color Match, Echo Pads, Zap It!,
// Tetherball). Pure: no DOM, so Node's tests can load it (gameKit.test.js).
//   rng(seed)                 a seeded random number generator (mulberry32), returns 0..1
//   pick(random, list)        one item
//   weighted(random, entries) [[value, weight]...] -> a value
//   createScores(key, opts)   top-N score lists per mode, kept in localStorage (per user
//                             through the storage seam in utils/userStorage.js)

export const rng = (seed = Date.now()) => {
  let a = seed >>> 0 || 1
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const pick = (random, list) => list[Math.floor(random() * list.length) % list.length]

export const weighted = (random, entries) => {
  const total = entries.reduce((s, [, w]) => s + w, 0)
  let r = random() * total
  for (const [value, w] of entries) {
    r -= w
    if (r < 0) return value
  }
  return entries[entries.length - 1][0]
}

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

const memoryStore = () => {
  const m = new Map()
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }
}
const defaultStore = () => (typeof localStorage !== "undefined" ? localStorage : memoryStore())

// Scores and prefs for one game: { prefs, scores: { [mode]: [{ score, date, ...extra }] }, extra }
// lower: true for modes where a lower number is better (times)
export const createScores = (key, { top = 10, defaults = {}, lower = [], store = defaultStore() } = {}) => {
  const read = () => {
    try {
      const d = JSON.parse(store.getItem(key)) || {}
      return { prefs: { ...defaults, ...(d.prefs || {}) }, scores: { ...(d.scores || {}) }, extra: { ...(d.extra || {}) } }
    } catch {
      return { prefs: { ...defaults }, scores: {}, extra: {} }
    }
  }
  const write = (data) => {
    try {
      store.setItem(key, JSON.stringify(data))
    } catch {
      // storage full or blocked: remembered for this visit only
    }
    return data
  }
  const better = (mode) => (lower.includes(mode) ? (a, b) => a.score - b.score || a.date - b.date : (a, b) => b.score - a.score || a.date - b.date)
  return {
    load: read,
    best: (data, mode) => data.scores[mode]?.[0]?.score ?? 0,
    setPrefs: (patch) => {
      const d = read()
      d.prefs = { ...d.prefs, ...patch }
      return write(d)
    },
    setExtra: (patch) => {
      const d = read()
      d.extra = { ...d.extra, ...patch }
      return write(d)
    },
    // adds a finished game -> { data, place (0-based, -1 when not in the list), best }
    record: (mode, entry) => {
      const d = read()
      const e = { date: Date.now(), ...entry }
      const before = d.scores[mode]?.[0]
      const list = [...(d.scores[mode] || []), e].sort(better(mode))
      const place = list.indexOf(e)
      d.scores[mode] = list.slice(0, top)
      write(d)
      const isBest = !before ? e.score > 0 || lower.includes(mode) : lower.includes(mode) ? e.score < before.score : e.score > before.score
      return { data: d, place: place < top ? place : -1, best: isBest }
    },
  }
}

// mm:ss
export const fmtTime = (s) => {
  const t = Math.max(0, Math.ceil(s))
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`
}
export const fmtNum = (n) => Math.round(n).toLocaleString("en-US")
