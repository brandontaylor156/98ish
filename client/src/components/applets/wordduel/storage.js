// Word Duel's local data (this browser only): options, today's daily word in progress,
// and statistics per mode (games, wins, streaks, how many guesses the wins took).

const KEY = "98ish.wordduel"

const EMPTY_STATS = () => ({ played: 0, won: 0, streak: 0, best: 0, dist: Array(11).fill(0), last: null })

const DEFAULT = {
  prefs: { length: 5, contrast: false, sound: true, settings: null },
  daily: null, // { key, words: [guesses], done, solved }
  stats: {}, // mode -> EMPTY_STATS()
}

export const load = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY))
    return { ...DEFAULT, ...raw, prefs: { ...DEFAULT.prefs, ...raw?.prefs }, stats: { ...raw?.stats } }
  } catch {
    return { ...DEFAULT, prefs: { ...DEFAULT.prefs }, stats: {} }
  }
}

const save = (data) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(data))
  } catch {
    // storage full or blocked: remembered for this visit only
  }
  return data
}

export const savePrefs = (patch) => {
  const data = load()
  return save({ ...data, prefs: { ...data.prefs, ...patch } })
}

export const saveDaily = (daily) => save({ ...load(), daily })

export const statsFor = (data, mode) => ({ ...EMPTY_STATS(), ...data.stats[mode] })

// A finished game: mode "daily" | "practice" | ...; guesses: how many the win took.
// Daily streaks need consecutive days (dayNumber); other modes count wins in a row.
export const recordGame = (mode, { won, guesses, day = null }) => {
  const data = load()
  const s = statsFor(data, mode)
  s.played++
  if (won) {
    s.won++
    const continues = day === null || s.last === null || day === s.last + 1 || day === s.last
    s.streak = continues ? s.streak + 1 : 1
    s.best = Math.max(s.best, s.streak)
    s.dist[Math.min(10, Math.max(1, guesses))] = (s.dist[Math.min(10, Math.max(1, guesses))] || 0) + 1
  } else {
    s.streak = 0
    s.dist[0] = (s.dist[0] || 0) + 1
  }
  if (day !== null) s.last = day
  return save({ ...data, stats: { ...data.stats, [mode]: s } })
}

export const resetStats = () => save({ ...load(), stats: {} })
