// Your career: best results per song and difficulty, a top-5 table for each, the stars
// that unlock new venues, and preferences. Kept in localStorage; the functions here are
// pure (they take and return plain objects) so they can be tested.

export const KEYS = { progress: "98ish.shred.progress", prefs: "98ish.shred.prefs", calibration: "98ish.shred.calibration" }
export const TABLE_SIZE = 5

export const DEFAULT_PREFS = {
  difficulty: "easy",
  easyStrum: true,
  noFail: false,
  speed: 3, // note speed 1-5
  lefty: false,
  music: 0.9,
  sfx: true,
  shake: true,
  keys: {
    frets: [["KeyA", "Digit1", "F1"], ["KeyS", "Digit2", "F2"], ["KeyD", "Digit3", "F3"], ["KeyF", "Digit4", "F4"], ["KeyG", "Digit5", "F5"]],
    strum: ["Enter", "Space", "ArrowUp", "ArrowDown", "NumpadEnter"],
    star: ["ShiftLeft", "ShiftRight", "Backspace"],
    whammy: ["KeyW", "ArrowRight"],
    pause: ["Escape", "KeyP"],
  },
}

export const emptyProgress = () => ({ songs: {}, plays: 0, unlockAll: false })

// { songs: { [id]: { [difficulty]: { best: {score, stars, accuracy, longest, fullCombo, date}, table: [...] } } } }
export const record = (progress, songId, difficulty, result, date = Date.now()) => {
  const songs = { ...progress.songs }
  const song = { ...(songs[songId] || {}) }
  const slot = song[difficulty] || { best: null, table: [] }
  const entry = { score: result.score, stars: result.stars, accuracy: result.accuracy, longest: result.longest, fullCombo: !!result.fullCombo, date }
  const newBest = !result.failed && (!slot.best || entry.score > slot.best.score)
  const best = newBest ? entry : slot.best
  const table = result.failed ? slot.table : [...slot.table, entry].sort((a, b) => b.score - a.score || a.date - b.date).slice(0, TABLE_SIZE)
  const rank = result.failed ? -1 : table.indexOf(entry)
  // a better star count on an older, higher score still counts for the career
  const bestStars = Math.max(slot.bestStars || 0, result.failed ? 0 : result.stars)
  song[difficulty] = { best, table, bestStars }
  songs[songId] = song
  return { progress: { ...progress, songs, plays: (progress.plays || 0) + 1 }, newBest, rank, entry }
}

export const bestOf = (progress, songId, difficulty) => progress.songs?.[songId]?.[difficulty]?.best || null
export const tableOf = (progress, songId, difficulty) => progress.songs?.[songId]?.[difficulty]?.table || []

// Stars for a song: your best on any difficulty
export const songStars = (progress, songId) => Math.max(0, ...Object.values(progress.songs?.[songId] || {}).map((s) => s.bestStars || 0))

export const totalStars = (progress, songs) => songs.reduce((sum, s) => sum + songStars(progress, s.id), 0)

export const tierUnlocked = (progress, tier, songs) => !!progress.unlockAll || totalStars(progress, songs) >= tier.stars

export const starsToUnlock = (progress, tier, songs) => Math.max(0, tier.stars - totalStars(progress, songs))

// Reading and writing (storage is injected for tests; defaults to localStorage)
const store = () => (typeof localStorage === "undefined" ? null : localStorage)

export const load = (key, fallback, storage = store()) => {
  try {
    const raw = storage?.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

export const save = (key, value, storage = store()) => {
  try {
    storage?.setItem(key, JSON.stringify(value))
  } catch {
    // storage full or blocked: kept for this visit
  }
}

export const loadPrefs = (storage) => {
  const saved = load(KEYS.prefs, {}, storage)
  return { ...DEFAULT_PREFS, ...saved, keys: { ...DEFAULT_PREFS.keys, ...(saved.keys || {}) } }
}

export const loadProgress = (storage) => ({ ...emptyProgress(), ...load(KEYS.progress, {}, storage) })
