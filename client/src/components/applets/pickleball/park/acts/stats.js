// My Park activities' stats (pure): what each one adds to your record (kept in Pickleball 98's
// prefs, so per user on this device: utils/userStorage.js), your fitness from the workouts,
// and how it shows on your player (the owner: "it makes your player look/feel stronger").
//
//   addStats(stats, result) -> stats
//   fitnessOf(stats) -> { level 0..5, name, next, workouts, reps, streakDays, pumped }
//   gainsLook(look, stats, now) -> the look your player wears in My Park (one build up while
//     pumped after a workout; for good from level 3 while "Show my gains" is on)

export const DAY_MS = 86_400_000
export const localDay = (t = Date.now()) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}
export const FIT_LEVELS = [
  { at: 0, name: "Getting started" },
  { at: 2, name: "Warming up" },
  { at: 5, name: "Regular" },
  { at: 10, name: "Fit" },
  { at: 20, name: "Strong" },
  { at: 40, name: "Beast mode" },
]
export const PUMP_MS = 30 * 60_000 // how long the pump lasts after a workout

const num = (v) => (Number.isFinite(v) && v > 0 ? v : 0)

export const addStats = (stats = {}, res = {}, now = Date.now()) => {
  const out = { ...stats }
  if (res.kind === "tennis") {
    const t = { ...(out.tennis || {}) }
    if (res.mode === "rally") t.best = Math.max(num(t.best), num(res.best))
    else if (res.won === true) t.wins = num(t.wins) + 1
    else if (res.won === false) t.losses = num(t.losses) + 1
    out.tennis = t
  } else if (res.kind === "hoops") {
    const h = { ...(out.hoops || {}) }
    h.made = num(h.made) + num(res.made)
    h.shots = num(h.shots) + num(res.shots)
    h.swishes = num(h.swishes) + num(res.swishes)
    h.streak = Math.max(num(h.streak), num(res.streak))
    if (res.world) h.world = h.world ? Math.min(h.world, res.world) : res.world
    if (res.won === true) h.horseWins = num(h.horseWins) + 1
    if (res.won === false) h.horseLosses = num(h.horseLosses) + 1
    out.hoops = h
  } else if (res.kind === "workout" && num(res.reps) >= 8) {
    // (a workout counts once it has eight reps in it: a peek and leave isn't one)
    const w = { ...(out.workout || {}) }
    w.sessions = num(w.sessions) + 1
    w.reps = num(w.reps) + num(res.reps)
    w.perfect = num(w.perfect) + num(res.perfect)
    w.bestStreak = Math.max(num(w.bestStreak), num(res.streak))
    w.best = Math.max(num(w.best), num(res.score))
    w.real = num(w.real) + num(res.real)
    const day = localDay(now)
    const days = Array.isArray(w.days) ? w.days.filter((d) => typeof d === "string") : []
    if (!days.includes(day)) days.push(day)
    w.days = days.slice(-60)
    if (res.daily && (!w.daily || day > w.daily)) w.daily = day
    w.lastAt = Math.max(num(w.lastAt), now)
    out.workout = w
  }
  return out
}

// days in a row with a workout, ending today or yesterday
export const dayStreak = (days = [], now = Date.now()) => {
  const set = new Set(days)
  let d = now
  if (!set.has(localDay(d))) d -= DAY_MS
  let n = 0
  while (set.has(localDay(d))) {
    n++
    d -= DAY_MS
  }
  return n
}

export const fitnessOf = (stats = {}, now = Date.now()) => {
  const w = stats.workout || {}
  const sessions = num(w.sessions)
  let level = 0
  for (let i = 0; i < FIT_LEVELS.length; i++) if (sessions >= FIT_LEVELS[i].at) level = i
  const next = FIT_LEVELS[level + 1] || null
  return {
    level,
    name: FIT_LEVELS[level].name,
    next: next ? { name: next.name, left: next.at - sessions } : null,
    workouts: sessions,
    reps: num(w.reps),
    perfect: num(w.perfect),
    best: num(w.best),
    streakDays: dayStreak(w.days || [], now),
    today: w.daily === localDay(now),
    pumped: !!w.lastAt && now - w.lastAt < PUMP_MS,
  }
}

const BUILD_UP = { slim: "regular", regular: "strong", strong: "strong" }
// your look in My Park: one build up while pumped, and for good from "Fit" (level 3) unless
// you turned "Show my gains" off (prefs.actGains === false)
export const gainsLook = (look, stats = {}, { gains = true, now = Date.now() } = {}) => {
  if (!look || gains === false) return look
  const f = fitnessOf(stats, now)
  if (!f.pumped && f.level < 3) return look
  const b = look.build && typeof look.build === "string" ? look.build : "regular"
  const up = BUILD_UP[b] || b
  return up === b ? look : { ...look, build: up }
}
