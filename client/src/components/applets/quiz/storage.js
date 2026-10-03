import { useSyncExternalStore } from "react"
import { unlock } from "../../../utils/achievements"
import { badgesFor, dayKey, streakFrom } from "./shared/logic.js"
import { KNOWME_PACKS, TOT_PACKS } from "./shared/show.js"

// What the Quiz Show remembers in this browser: past games and scores, the days you
// played (streaks), answers from How Well Do You Know Me (for Trivia About Us), favorite
// Deep Talk cards, quizzes you've built while signed off, and your sound setting.

const KEY = "98ish.quiz"
const DEFAULTS = {
  history: [], // [{ mode, title, with, percent, score, total, won, live, at }]
  facts: [], // [{ subject, qid, answer, at }]
  favorites: [], // deep talk card ids
  deepSeen: [], // deep talk card ids you've talked through
  drafts: [], // custom quizzes saved here (signed off)
  days: [], // "2026-10-02" days with a game
  stats: { games: 0, wins: 0, perfect: 0, triviaPerfect: 0, compat: 0, live: 0, customs: 0, sent: 0 },
  sound: true,
  seenResults: [], // finished challenge ids already counted
  howto: {}, // { knowme: true }: "How to play" seen for a mode
  setup: {}, // { knowme: { how, pack, count, clock } }: last choices per mode
}

const read = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY))
    return saved && typeof saved === "object" ? { ...DEFAULTS, ...saved, stats: { ...DEFAULTS.stats, ...saved.stats } } : { ...DEFAULTS }
  } catch {
    return { ...DEFAULTS }
  }
}

let data = null
const listeners = new Set()
const current = () => (data ||= read())
const subscribe = (fn) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export const getQuizData = current
export const setQuizData = (patch) => {
  const prev = current()
  data = { ...prev, ...(typeof patch === "function" ? patch(prev) : patch) }
  try {
    localStorage.setItem(KEY, JSON.stringify(data))
  } catch {
    // remembered for this visit only
  }
  listeners.forEach((fn) => fn())
}
export const useQuizData = () => useSyncExternalStore(subscribe, current, current)

const checkAchievements = (d) => {
  if (d.stats.perfect >= 1) unlock("quiz-mind-reader")
  if (d.stats.wins >= 10) unlock("quiz-master")
  if (d.deepSeen.length >= 20) unlock("quiz-deep-diver")
}

// A finished game: { mode, title, with, percent, score, total, won, live, perfect, triviaPerfect }
export const recordGame = (game) => {
  setQuizData((d) => {
    const today = dayKey()
    const stats = { ...d.stats }
    stats.games++
    if (game.won) stats.wins++
    if (game.perfect) stats.perfect++
    if (game.triviaPerfect) stats.triviaPerfect++
    if (game.mode === "compat") stats.compat++
    if (game.live) stats.live++
    const entry = { mode: game.mode, title: game.title || null, with: game.with || null, percent: game.percent ?? null, score: game.score ?? null, total: game.total ?? null, won: !!game.won, live: !!game.live, at: Date.now() }
    // a show: how it was played ("live", "pass", "turns"), its verdict and summary line
    if (game.how) Object.assign(entry, { how: game.how, tier: game.tier || null, headline: game.headline || null, points: game.points ?? null })
    return { history: [entry, ...d.history].slice(0, 80), days: d.days.includes(today) ? d.days : [...d.days, today].slice(-120), stats }
  })
  checkAchievements(current())
}

export const bumpStat = (name, by = 1) => setQuizData((d) => ({ stats: { ...d.stats, [name]: (d.stats[name] || 0) + by } }))

// facts learned in How Well Do You Know Me: someone's own answers
export const addFacts = (facts) => {
  if (!facts.length) return
  setQuizData((d) => ({ facts: [...d.facts, ...facts.map((f) => ({ ...f, at: Date.now() }))].slice(-400) }))
}

export const seeDeepCard = (id) => {
  if (!id || current().deepSeen.includes(id)) return
  setQuizData((d) => ({ deepSeen: [...d.deepSeen, id].slice(-500) }))
  checkAchievements(current())
}

export const toggleFavorite = (id) => setQuizData((d) => ({ favorites: d.favorites.includes(id) ? d.favorites.filter((f) => f !== id) : [...d.favorites, id] }))

// Shows finished (How Well Do You Know Me, This or That, any way of playing): packs unlock by it
export const showsPlayed = (d) => d.history.filter((h) => h.mode === "knowme" || h.mode === "tot").length

// A finished show: into the history (and facts learned), -> the name of a pack it unlocked
// game: { mode, how, with, summary, points, won, perfect, facts }
export const recordShow = ({ mode, how, with: other, summary, points, won, perfect, facts = [] }) => {
  const before = showsPlayed(current())
  const tier = typeof summary.tier === "string" ? summary.tier : summary.tier?.name || null
  recordGame({ mode, how, with: other, title: tier, tier, headline: summary.headline, percent: summary.percent, points, won, perfect, live: how === "live" })
  addFacts(facts)
  const opened = [...KNOWME_PACKS.map((p) => ({ ...p, mode: "knowme" })), ...TOT_PACKS.map((p) => ({ ...p, mode: "tot" }))].filter((p) => p.unlock === before + 1)
  return opened.length ? opened.map((p) => `${p.name} (${p.mode === "tot" ? "This or That" : "Know Me"})`).join(" and ") : null
}

// stats plus the streak, for badges
export const statsOf = (d) => ({ ...d.stats, deepCards: d.deepSeen.length, streak: streakFrom(d.days) })
export const badgesOf = (d) => badgesFor(statsOf(d))
