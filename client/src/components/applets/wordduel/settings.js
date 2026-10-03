// Word Duel's game settings: every knob, the presets (a preset is just a set of knobs),
// and the check the server runs on a room's settings (validateSettings). Pure, shared by
// the window and the server.

export const FORMATS = {
  race: { label: "Race", text: "Everyone gets the same word on their own board." },
  turns: { label: "Duel Turns", text: "Take turns guessing on one shared board. Solve it to score." },
  coop: { label: "Co-op", text: "One team, one board. Suggest guesses and vote, or take turns." },
  royale: { label: "Battle Royale", text: "Survive each round. The slowest, or anyone who runs out of guesses, is out." },
  rush: { label: "Speed Rush", text: "Solve as many words as you can before the clock runs out." },
  sabotage: { label: "Sabotage", text: "Pick the word your opponent has to guess. Fewest guesses wins." },
  absurd: { label: "Absurd", text: "The word changes to dodge your guesses. Corner it!" },
}

export const MAX_PLAYERS = 8
export const BOARD_COUNTS = [1, 2, 4, 8]
export const BOT_LEVELS = ["easy", "normal", "hard"]

export const DEFAULTS = {
  preset: "race",
  format: "race", // race | turns | coop | royale | rush | sabotage | absurd
  players: 2, // seats in the room, 1-8
  length: 5, // letters, 4-7
  guesses: 6, // 4-10, or 0 for unlimited
  boards: 1, // 1, 2, 4 or 8 words at once
  rounds: 1, // 1-9
  series: "points", // points (add up every round) | wins (best of: first to a majority of rounds)
  timer: "none", // none | guess (seconds per guess) | round (seconds per round)
  timerSecs: 60,
  rushSecs: 180, // Speed Rush's clock
  scoring: "guesses", // guesses (fewest) | time (first to solve) | tiles (points per tile)
  hard: false, // revealed hints must be used
  show: "colors", // what you see of other boards: none | colors | full (letters too)
  source: "random", // random | daily | custom (player 1 types it) | list (pasted below)
  list: "", // the custom word list
  strict: true, // guesses must be real words
  handicap: [0, 0, 0, 0, 0, 0, 0, 0], // extra (or fewer) guesses, per seat
  teams: false, // Race and Absurd: odd seats against even seats, one board per team
  coopMode: "vote", // vote | alternate | free (anyone, any time)
  spectators: true,
  bots: "normal", // computer players: easy | normal | hard
}

// name -> { label, text, solo (shown in the solo menu), settings }
export const PRESETS = {
  classic: { label: "Classic", text: "One word, six guesses. The way it's always been.", solo: true, settings: { format: "race", players: 1, scoring: "guesses" } },
  race: { label: "Head to Head Race", text: "Same word, two boards. First to solve wins. You see their colors, not their letters.", settings: { format: "race", players: 2, scoring: "time", show: "colors" } },
  turns: { label: "Duel Turns", text: "One board, two players, alternating guesses. Whoever solves it scores.", settings: { format: "turns", players: 2, rounds: 3, series: "points", show: "full" } },
  best3: { label: "Best of 3", text: "A three-round series. Win two rounds to take it.", settings: { format: "race", players: 2, rounds: 3, series: "wins", scoring: "guesses" } },
  best5: { label: "Best of 5", text: "Five rounds, first to three.", settings: { format: "race", players: 2, rounds: 5, series: "wins", scoring: "guesses" } },
  royale: { label: "Battle Royale", text: "Up to 8 players. Each round the slowest is knocked out. Last one standing wins.", settings: { format: "royale", players: 8, timer: "round", timerSecs: 150, show: "colors" } },
  coop: { label: "Co-op", text: "Everyone on one board. Suggest a guess, the most votes gets played.", settings: { format: "coop", players: 4, coopMode: "vote", rounds: 3, show: "full" } },
  rush: { label: "Speed Rush", text: "Three minutes. Solve as many words as you can.", solo: true, settings: { format: "rush", rushSecs: 180, guesses: 6 } },
  quad: { label: "Multi-board", text: "Four words at once, nine guesses. Every guess goes on every board.", solo: true, settings: { format: "race", boards: 4, guesses: 9, scoring: "guesses" } },
  sabotage: { label: "Sabotage", text: "You pick the word your opponent has to guess. Pick a mean one.", settings: { format: "sabotage", players: 2, scoring: "guesses", show: "colors" } },
  hard: { label: "Hard Mode", text: "Any revealed hint must be used in later guesses.", solo: true, settings: { format: "race", hard: true, scoring: "guesses" } },
  absurd: { label: "Absurd", text: "There is no word yet. Every guess, the game picks whatever dodges you best.", solo: true, settings: { format: "absurd", players: 1, guesses: 0 } },
}

// A preset's settings (on top of the defaults)
export const presetSettings = (name, base = DEFAULTS) => {
  const p = PRESETS[name]
  if (!p) return { ...base }
  const s = { ...DEFAULTS, ...p.settings, preset: name }
  // keep things that aren't part of the preset (length, bots, spectators)
  return { ...s, length: base.length ?? DEFAULTS.length, bots: base.bots ?? DEFAULTS.bots, spectators: base.spectators ?? true }
}

// How many guesses a game of `boards` boards usually gets
export const guessesForBoards = (boards) => ({ 1: 6, 2: 7, 4: 9, 8: 13 })[boards] || 6

const int = (v, lo, hi, fallback) => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback
}
const oneOf = (v, list, fallback) => (list.includes(v) ? v : fallback)

// Any settings -> clean settings, or { error }. Used by the server for every room and by
// the window for solo games.
export const validateSettings = (raw = {}) => {
  const s = { ...DEFAULTS, ...(raw && typeof raw === "object" ? raw : {}) }
  const out = {
    preset: typeof s.preset === "string" && (PRESETS[s.preset] || s.preset === "custom") ? s.preset : "custom",
    format: oneOf(s.format, Object.keys(FORMATS), "race"),
    players: int(s.players, 1, MAX_PLAYERS, 2),
    length: int(s.length, 4, 7, 5),
    guesses: s.guesses === 0 || s.guesses === "0" ? 0 : int(s.guesses, 4, 15, 6),
    boards: oneOf(Number(s.boards), BOARD_COUNTS, 1),
    rounds: int(s.rounds, 1, 9, 1),
    series: oneOf(s.series, ["points", "wins"], "points"),
    timer: oneOf(s.timer, ["none", "guess", "round"], "none"),
    timerSecs: int(s.timerSecs, 10, 900, 60),
    rushSecs: int(s.rushSecs, 30, 900, 180),
    scoring: oneOf(s.scoring, ["guesses", "time", "tiles"], "guesses"),
    hard: !!s.hard,
    show: oneOf(s.show, ["none", "colors", "full"], "colors"),
    source: oneOf(s.source, ["random", "daily", "custom", "list"], "random"),
    list: typeof s.list === "string" ? s.list.slice(0, 1500) : "",
    strict: s.strict !== false,
    handicap: Array.from({ length: MAX_PLAYERS }, (_, i) => int(Array.isArray(s.handicap) ? s.handicap[i] : 0, -3, 5, 0)),
    teams: !!s.teams,
    coopMode: oneOf(s.coopMode, ["vote", "alternate", "free"], "vote"),
    spectators: s.spectators !== false,
    bots: oneOf(s.bots, BOT_LEVELS, "normal"),
  }
  // what each format can't do
  if (out.format === "absurd") {
    out.boards = 1
    if (out.source !== "list") out.source = "random"
  }
  if (out.format === "rush") {
    out.boards = 1
    out.rounds = 1
    out.timer = "none"
    if (out.source === "custom") out.source = "random"
    if (out.guesses === 0) out.guesses = 6
  }
  if (out.format === "sabotage") {
    out.boards = 1
    out.source = "random"
  }
  if (out.format === "royale") out.series = "points"
  if (!["race", "absurd"].includes(out.format) || out.players < 2) out.teams = false
  if (out.source !== "list") out.list = ""
  if (out.source === "list") {
    const words = out.list.toLowerCase().split(/[^a-z]+/).filter((w) => w.length === out.length)
    if (!words.length) return { error: `Paste at least one ${out.length}-letter word into the word list.` }
  }
  if (out.source === "custom" && out.boards > 1) out.boards = 1
  return out
}

// What a game is, in a few words: "Race · 5 letters · 6 guesses · best of 3"
export const describe = (s) => {
  const parts = [PRESETS[s.preset]?.label || FORMATS[s.format]?.label || "Custom"]
  if (s.players > 1) parts.push(`${s.players} players`)
  parts.push(`${s.length} letters`)
  if (s.boards > 1) parts.push(`${s.boards} boards`)
  parts.push(s.guesses ? `${s.guesses} guesses` : "unlimited guesses")
  if (s.format === "rush") parts.push(`${Math.round(s.rushSecs / 60 * 10) / 10} min`)
  else if (s.rounds > 1 && !/^Best of/.test(parts[0])) parts.push(s.series === "wins" ? `best of ${s.rounds}` : `${s.rounds} rounds`)
  if (s.timer !== "none" && s.format !== "rush") parts.push(`${s.timerSecs}s per ${s.timer}`)
  if (s.hard) parts.push("hard mode")
  if (s.source === "daily") parts.push("daily word")
  if (s.source === "custom") parts.push("player 1 picks the word")
  if (s.source === "list") parts.push("custom list")
  if (s.teams) parts.push("teams")
  return parts.join(" · ")
}
