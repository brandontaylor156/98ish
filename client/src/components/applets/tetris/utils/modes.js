// The ways to play: engine options, what the side panel shows, and how a result is judged.
// Solo modes keep a local best; versus modes are played online (see ../online).

export const SOLO_MODES = ["marathon", "sprint", "ultra", "survival"]
export const ONLINE_MODES = ["battle", "arena", "race"]

export const MODES = {
  marathon: {
    name: "Marathon",
    blurb: "15 levels. Each level needs more line points than the last.",
    options: { levelMode: "variable", variableLevels: 15 },
    best: "score",
  },
  sprint: {
    name: "Sprint 40L",
    blurb: "Clear 40 lines as fast as you can.",
    options: { levelMode: "fixed", goalLines: 40 },
    best: "time",
  },
  ultra: {
    name: "Ultra 2:00",
    blurb: "Two minutes. Score as much as you can.",
    options: { levelMode: "fixed", timeLimit: 120_000 },
    best: "score",
  },
  survival: {
    name: "Survival",
    blurb: "200 lines at rising speed, then a finale in the dark.",
    options: { levelMode: "lines10", maxLevel: 20, finaleAt: 200, finaleLines: 20 },
    best: "lines",
  },
  battle: {
    name: "Battle 2P",
    blurb: "Two minutes, one on one. Top out your opponent 3 times.",
    options: { levelMode: "time", maxLevel: 8, solidGarbage: true, noPause: true },
    players: [2, 2],
  },
  arena: {
    name: "Arena",
    blurb: "2 to 6 players. Garbage, items, last one standing wins.",
    options: { levelMode: "time", maxLevel: 10, noPause: true },
    players: [2, 6],
  },
  race: {
    name: "Sprint Race",
    blurb: "Up to 5 players race to 40 lines on the same pieces.",
    options: { levelMode: "fixed", goalLines: 40, noPause: true },
    players: [2, 5],
  },
}

export const formatTime = (ms, tenths = true) => {
  const total = Math.max(0, ms)
  const minutes = Math.floor(total / 60_000)
  const seconds = Math.floor((total % 60_000) / 1000)
  const t = Math.floor((total % 1000) / 100)
  const base = `${minutes}:${String(seconds).padStart(2, "0")}`
  return tenths ? `${base}.${t}` : base
}

// The number a mode's best is kept by, and whether a result beats it
export const resultValue = (mode, game) => {
  const kind = MODES[mode].best
  if (kind === "time") return game.endReason === "goal" ? game.time : null // only finished sprints count
  if (kind === "lines") return game.lines
  return game.score
}
export const beats = (mode, value, best) => {
  if (value === null || value === undefined) return false
  if (best === null || best === undefined) return true
  return MODES[mode].best === "time" ? value < best : value > best
}
export const formatBest = (mode, value) => {
  if (value === null || value === undefined) return "-"
  const kind = MODES[mode].best
  if (kind === "time") return formatTime(value)
  if (kind === "lines") return `${value} lines`
  return value.toLocaleString()
}
