// What Photo Puzzle remembers on this device: puzzles in progress (to pick up later), best
// times, and options. Kept in localStorage "98ish.puzzle".

const KEY = "98ish.puzzle"
const MAX_SAVED = 8

const read = () => {
  try {
    const data = JSON.parse(localStorage.getItem(KEY))
    return { progress: {}, best: {}, prefs: {}, ...data }
  } catch {
    return { progress: {}, best: {}, prefs: {} }
  }
}
const write = (data) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(data))
    return true
  } catch {
    return false
  }
}

// A puzzle's identity: where its picture came from plus how it's cut
export const puzzleKey = (source, setup) =>
  `${source.kind}:${source.id}|${setup.mode === "slide" ? `s${setup.size}` : `j${setup.pieces}${setup.rotate ? "r" : ""}`}`

export const loadPrefs = () => ({ preview: false, edges: false, rotate: false, numbers: false, sound: true, ...read().prefs })
export const savePrefs = (prefs) => {
  const data = read()
  data.prefs = { ...data.prefs, ...prefs }
  write(data)
}

// { key, source, setup, title, state, elapsed, seed, savedAt }
export const loadProgress = (key) => read().progress[key] || null
export const listProgress = () =>
  Object.entries(read().progress)
    .map(([key, p]) => ({ key, ...p }))
    .sort((a, b) => b.savedAt - a.savedAt)

export const saveProgress = (key, entry) => {
  const data = read()
  data.progress[key] = { ...entry, savedAt: Date.now() }
  // keep the most recent few
  const keys = Object.keys(data.progress).sort((a, b) => data.progress[b].savedAt - data.progress[a].savedAt)
  for (const old of keys.slice(MAX_SAVED)) delete data.progress[old]
  return write(data)
}
export const clearProgress = (key) => {
  const data = read()
  delete data.progress[key]
  write(data)
}

// -> { ms, moves } or null
export const bestFor = (key) => read().best[key] || null
// Record a finished time; true if it's a new best
export const recordBest = (key, ms, moves = 0) => {
  const data = read()
  const old = data.best[key]
  if (old && old.ms <= ms) return false
  data.best[key] = { ms, moves, at: Date.now() }
  write(data)
  return true
}
