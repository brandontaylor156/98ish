// Speed Typist 98's local data (this browser only): options, every race you've run (WPM,
// accuracy, mistakes), your best per prompt length, ghosts (your best run of each prompt,
// to race again) and the daily prompt's leaderboard on this computer.

const KEY = "98ish.speedtype"
const MAX_HISTORY = 300
const MAX_GHOSTS = 60
const MAX_DAILY_DAYS = 14

const DEFAULT = {
  prefs: { sound: true, strict: false, length: "any", category: "any", bots: 3, botWpm: 0, mode: "race", name: "" },
  history: [], // { at, wpm, acc, mistakes, length, category, kind, place, racers, promptId }
  best: {}, // length -> { wpm, acc, at, promptId }
  ghosts: {}, // promptId -> { wpm, at, timeline: [[ms, chars]...] }
  daily: {}, // dayKey -> [{ name, wpm, acc, at }]
}

export const load = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY)) || {}
    return {
      prefs: { ...DEFAULT.prefs, ...raw.prefs },
      history: Array.isArray(raw.history) ? raw.history : [],
      best: { ...raw.best },
      ghosts: { ...raw.ghosts },
      daily: { ...raw.daily },
    }
  } catch {
    return { ...DEFAULT, prefs: { ...DEFAULT.prefs }, history: [], best: {}, ghosts: {}, daily: {} }
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

export const resetStats = () => save({ ...load(), history: [], best: {}, ghosts: {}, daily: {} })

// at most n points of a timeline, always keeping the last one
export const thinTimeline = (timeline, n = 150) => {
  if (timeline.length <= n) return timeline
  const out = []
  for (let i = 0; i < n; i++) out.push(timeline[Math.round((i * (timeline.length - 1)) / (n - 1))])
  return out
}

// A finished race of yours. race: { wpm, acc, mistakes, length, category, kind ("race" |
// "online" | "ghost" | "daily" | "drill" | "practice"), place, racers, promptId, finished,
// timeline, dayKey, name }. -> { data, newBest (beat your best for this length), oldBest }
export const recordRace = (race) => {
  const data = load()
  const at = Date.now()
  const entry = { at, wpm: race.wpm, acc: race.acc, mistakes: race.mistakes, length: race.length, category: race.category, kind: race.kind, place: race.place ?? null, racers: race.racers ?? 1, promptId: race.promptId ?? null, finished: !!race.finished }
  const history = [...data.history, entry].slice(-MAX_HISTORY)
  const best = { ...data.best }
  const ghosts = { ...data.ghosts }
  const daily = { ...data.daily }
  let newBest = false
  const oldBest = best[race.length]?.wpm ?? null
  // bests and ghosts count only finished library prompts (not drills or your own text)
  const counts = race.finished && race.kind !== "drill" && race.promptId && race.promptId !== "custom"
  if (counts && (oldBest == null || race.wpm > oldBest)) {
    best[race.length] = { wpm: race.wpm, acc: race.acc, at, promptId: race.promptId }
    newBest = oldBest != null
  }
  if (counts && Array.isArray(race.timeline) && race.timeline.length > 1) {
    const old = ghosts[race.promptId]
    if (!old || race.wpm > old.wpm) {
      ghosts[race.promptId] = { wpm: race.wpm, at, timeline: thinTimeline(race.timeline) }
      const ids = Object.keys(ghosts)
      if (ids.length > MAX_GHOSTS) {
        ids.sort((a, b) => ghosts[a].at - ghosts[b].at)
        for (const id of ids.slice(0, ids.length - MAX_GHOSTS)) delete ghosts[id]
      }
    }
  }
  if (race.kind === "daily" && race.finished && race.dayKey) {
    const list = [...(daily[race.dayKey] || []), { name: race.name || "You", wpm: race.wpm, acc: race.acc, at }]
    daily[race.dayKey] = list.sort((a, b) => b.wpm - a.wpm).slice(0, 10)
    const days = Object.keys(daily).sort()
    for (const d of days.slice(0, Math.max(0, days.length - MAX_DAILY_DAYS))) delete daily[d]
  }
  return { data: save({ ...data, history, best, ghosts, daily }), newBest, oldBest }
}

// Your fastest ghost (or the ghost for one prompt): -> { promptId, wpm, timeline } | null
export const bestGhost = (data, promptId = null) => {
  if (promptId) return data.ghosts[promptId] ? { promptId, ...data.ghosts[promptId] } : null
  let top = null
  for (const [id, g] of Object.entries(data.ghosts)) if (!top || g.wpm > top.wpm) top = { promptId: id, ...g }
  return top
}

// Summary numbers for the Statistics window
export const summary = (data) => {
  const races = data.history.filter((h) => h.kind !== "drill")
  const done = races.filter((h) => h.finished)
  const avg = (list, key) => (list.length ? list.reduce((s, h) => s + h[key], 0) / list.length : 0)
  const recent = done.slice(-10)
  const wins = data.history.filter((h) => h.place === 1 && h.racers > 1).length
  return {
    races: races.length,
    finished: done.length,
    wins,
    avgWpm: avg(done, "wpm"),
    avgAcc: avg(done, "acc"),
    recentWpm: avg(recent, "wpm"),
    topWpm: done.reduce((m, h) => Math.max(m, h.wpm), 0),
    wpmTrend: done.slice(-30).map((h) => h.wpm),
    accTrend: done.slice(-30).map((h) => h.acc),
  }
}
