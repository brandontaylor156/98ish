// What Block Ten remembers in this browser: options, the top 10 scores for each mode,
// the best Daily Challenge score for each day, and the game in progress (so closing the
// window, or a phone reloading the page, doesn't lose it).

import { isValidState } from "./engine"

const KEY = "98ish.blockten"
const GAME_KEY = "98ish.blockten.game"
const TOP = 10

const read = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback
  } catch {
    return fallback
  }
}
const write = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // storage full or blocked: remembered for this visit only
  }
}

const DEFAULTS = { theme: "classic", sound: true, scores: { classic: [], daily: [], blast: [] }, daily: {} }

export const loadData = () => {
  const d = read(KEY, {})
  return { ...DEFAULTS, ...d, scores: { ...DEFAULTS.scores, ...(d.scores || {}) }, daily: { ...(d.daily || {}) } }
}
const saveData = (patch) => write(KEY, { ...loadData(), ...patch })

export const savePrefs = (prefs) => saveData(prefs)

export const bestFor = (data, mode, dayKey) =>
  mode === "daily" ? data.daily[dayKey] || 0 : data.scores[mode]?.[0]?.score || 0

// adds a finished game; returns { data, place (0-based, -1 if not in the top 10), best (was it a new best) }
export const recordScore = (mode, entry, dayKey) => {
  const data = loadData()
  const before = bestFor(data, mode, dayKey)
  const list = [...(data.scores[mode] || []), entry].sort((a, b) => b.score - a.score || a.date - b.date)
  const place = list.indexOf(entry)
  data.scores[mode] = list.slice(0, TOP)
  if (mode === "daily") {
    data.daily[dayKey] = Math.max(data.daily[dayKey] || 0, entry.score)
    // keep the last few weeks of days
    const days = Object.keys(data.daily).sort().slice(-30)
    data.daily = Object.fromEntries(days.map((k) => [k, data.daily[k]]))
  }
  write(KEY, data)
  return { data, place: place < TOP ? place : -1, best: entry.score > before && entry.score > 0 }
}

export const loadGame = () => {
  const saved = read(GAME_KEY, null)
  return saved && isValidState(saved.game) && !saved.game.over ? saved : null
}
export const saveGame = (game, dayKey) => write(GAME_KEY, { game, dayKey })
