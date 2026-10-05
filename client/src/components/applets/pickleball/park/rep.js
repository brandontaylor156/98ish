// My Park: your park rep (pure; Node-tested). Wins, losses, the current streak and a level
// shown on your nameplate. Every game counts a little (showing up is half of open play); a
// win counts more, a streak more again, and harder courts more still.

export const REP_LEVELS = [
  { min: 0, name: "Newcomer" },
  { min: 30, name: "Regular" },
  { min: 90, name: "Local" },
  { min: 200, name: "Court Boss" },
  { min: 400, name: "Park Legend" },
]
const COURT_BONUS = { beginner: 0, intermediate: 2, pro: 5, legend: 8 }

export const freshRep = () => ({ wins: 0, losses: 0, streak: 0, best: 0, points: 0, games: 0 })

export const validRep = (raw) => {
  const r = freshRep()
  if (!raw || typeof raw !== "object") return r
  for (const k of Object.keys(r)) {
    const v = Number(raw[k])
    r[k] = Number.isFinite(v) && v >= 0 ? Math.floor(Math.min(v, 1e7)) : 0
  }
  return r
}

// points a game is worth: -> number
export const gamePoints = (won, { streak = 0, level = "intermediate" } = {}) => (won ? 10 + Math.min(10, streak * 2) + (COURT_BONUS[level] || 0) : 3)

// after a game: -> the new rep (and what was earned)
export const recordGame = (rep, won, { level = "intermediate" } = {}) => {
  const r = validRep(rep)
  const earned = gamePoints(won, { streak: won ? r.streak : 0, level })
  const streak = won ? r.streak + 1 : 0
  return { ...r, wins: r.wins + (won ? 1 : 0), losses: r.losses + (won ? 0 : 1), streak, best: Math.max(r.best, streak), points: r.points + earned, games: r.games + 1, earned }
}

export const repLevel = (points = 0) => {
  let i = 0
  for (let k = 0; k < REP_LEVELS.length; k++) if (points >= REP_LEVELS[k].min) i = k
  const next = REP_LEVELS[i + 1] || null
  return { index: i, name: REP_LEVELS[i].name, next: next ? next.name : null, toNext: next ? next.min - points : 0, progress: next ? (points - REP_LEVELS[i].min) / (next.min - REP_LEVELS[i].min) : 1 }
}

// the nameplate's short line: "Regular · 5-2" (and the streak when there is one)
export const repLine = (rep) => {
  const r = validRep(rep)
  const lv = repLevel(r.points)
  return `${lv.name} · ${r.wins}-${r.losses}${r.streak >= 2 ? ` · ${r.streak} in a row` : ""}`
}
