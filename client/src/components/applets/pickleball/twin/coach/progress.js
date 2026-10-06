// Coach on this device: who you are in each filmed game, your target level, a history of your
// numbers (one entry per game), and the current week's plan. localStorage
// "98ish.pickleball.coach", kept separately for each user by the storage seam
// (utils/userStorage.js). Never uploaded. Small: numbers only (no tracks).

export const KEY = "98ish.pickleball.coach"
const MAX_HISTORY = 120

const blank = () => ({ target: null, me: {}, history: [], plan: null, done: {} })

export const loadCoach = () => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "null")
    if (!v || typeof v !== "object") return blank()
    return { ...blank(), ...v, me: v.me || {}, history: Array.isArray(v.history) ? v.history : [], done: v.done || {} }
  } catch {
    return blank()
  }
}
const listeners = new Set()
export const subscribeCoach = (fn) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
export const saveCoach = (state) => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...state, history: state.history.slice(-MAX_HISTORY) }))
  } catch {
    // storage full or blocked: keep it for this visit
  }
  listeners.forEach((fn) => fn())
  return state
}
export const updateCoach = (fn) => saveCoach(fn(loadCoach()))

// one history entry per game: the metric values seen in that game alone (for the progress
// charts), replaced if the game is read again
export const recordGame = (state, { game, at, metrics, level }) => {
  const values = {}
  for (const m of metrics) if (m.value !== null && m.n >= 1) values[m.id] = { v: m.value, n: m.n }
  const history = state.history.filter((h) => h.game !== game)
  history.push({ game, at, values, level: level?.pos ?? null })
  history.sort((a, b) => a.at - b.at)
  return { ...state, history }
}

// a metric over time: [{ at, v, n }] (oldest first)
export const seriesOf = (history, id) => history.filter((h) => h.values?.[id]).map((h) => ({ at: h.at, v: h.values[id].v, n: h.values[id].n }))

// better or worse than the first half of the history? (+1 better, -1 worse, 0 about the same)
export const trendOf = (series, better = "high") => {
  if (series.length < 2) return 0
  const half = Math.max(1, Math.floor(series.length / 2))
  const avg = (a) => a.reduce((x, s) => x + s.v, 0) / a.length
  const d = avg(series.slice(-half)) - avg(series.slice(0, half))
  const rel = Math.abs(d) / Math.max(1e-6, Math.abs(avg(series.slice(0, half))))
  if (rel < 0.05) return 0
  return (d > 0) === (better === "high") ? 1 : -1
}

// weeks in a row (counting back from this week) with a filmed game or a practice drill done
const weekOf = (ms) => {
  const d = new Date(ms)
  const day = (d.getDay() + 6) % 7 // Monday = 0
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - day)
  return d.getTime()
}
export const streakOf = (state, now = Date.now()) => {
  const weeks = new Set([...state.history.map((h) => weekOf(h.at)), ...Object.values(state.done || {}).map((t) => weekOf(t))])
  let w = weekOf(now)
  // (this week not done yet doesn't break it)
  if (!weeks.has(w)) w -= 7 * 864e5
  let n = 0
  while (weeks.has(w)) {
    n++
    w = weekOf(w - 3 * 864e5)
  }
  return n
}

// the top cues for a session at the courts (Real Games), or [] before any plan
export const currentCues = (state = loadCoach()) => (state.plan?.cues || []).slice(0, 3)
