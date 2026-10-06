// Chess Puzzles: loading the bundled Lichess puzzles, playing one through, picking the next,
// and the puzzle rating. Plain functions (no React, no storage) so they can be unit-tested.
//
// Puzzle data (puzzles/band0..4.js): a CC0 sample of the Lichess puzzle database
// (database.lichess.org), one puzzle per line: id,FEN,moves,rating,themes. Moves are UCI
// ("e2e4", "e7e8q"); like on Lichess the first move is the opponent's, played for you, and
// then you find the rest. Any move that checkmates counts, as Lichess allows.

import * as chess from "../network/rules/chess.js"

// rating bands, one file each (loaded on demand, so the puzzles stay out of the main bundle)
export const BANDS = [
  [0, 1000],
  [1000, 1400],
  [1400, 1800],
  [1800, 2200],
  [2200, 9999],
]
export const bandFor = (rating) => Math.max(0, BANDS.findIndex(([lo, hi]) => rating >= lo && rating < hi))

export const parseShard = (text) =>
  String(text)
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [id, fen, moves, rating, themes = ""] = line.split(",")
      return { id, fen, moves: moves.split(" "), rating: Number(rating), themes: themes ? themes.split(" ") : [] }
    })

// ---------- themes ----------

export const THEMES = [
  ["mateIn1", "Mate in 1"],
  ["mateIn2", "Mate in 2"],
  ["mateIn3", "Mate in 3"],
  ["mate", "Any checkmate"],
  ["fork", "Fork"],
  ["pin", "Pin"],
  ["skewer", "Skewer"],
  ["discoveredAttack", "Discovered attack"],
  ["doubleCheck", "Double check"],
  ["hangingPiece", "Hanging piece"],
  ["trappedPiece", "Trapped piece"],
  ["sacrifice", "Sacrifice"],
  ["deflection", "Deflection"],
  ["attraction", "Attraction"],
  ["clearance", "Clearance"],
  ["intermezzo", "In-between move"],
  ["backRankMate", "Back-rank mate"],
  ["smotheredMate", "Smothered mate"],
  ["kingsideAttack", "Kingside attack"],
  ["exposedKing", "Exposed king"],
  ["defensiveMove", "Defensive move"],
  ["quietMove", "Quiet move"],
  ["zugzwang", "Zugzwang"],
  ["advancedPawn", "Advanced pawn"],
  ["promotion", "Promotion"],
  ["opening", "Opening"],
  ["middlegame", "Middlegame"],
  ["endgame", "Endgame"],
  ["rookEndgame", "Rook endgame"],
  ["pawnEndgame", "Pawn endgame"],
  ["bishopEndgame", "Bishop endgame"],
  ["knightEndgame", "Knight endgame"],
  ["queenEndgame", "Queen endgame"],
]
const THEME_LABEL = Object.fromEntries(THEMES)
export const themeLabel = (t) => THEME_LABEL[t] || t.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())

export const hasTheme = (p, theme) => {
  if (!theme) return true
  if (theme === "mate") return p.themes.some((t) => /^mateIn\d$/.test(t) || /Mate$/.test(t))
  return p.themes.includes(theme)
}

// ---------- playing a puzzle ----------

export const uciToMove = (uci) => ({ from: chess.squareIndex(uci.slice(0, 2)), to: chess.squareIndex(uci.slice(2, 4)), ...(uci[4] ? { promotion: uci[4] } : {}) })
export const moveToUci = (m) => chess.squareName(m.from) + chess.squareName(m.to) + (m.promotion ? String(m.promotion).toLowerCase() : "")

// A puzzle ready to play: the opponent's first move is waiting in `setup` (the screen
// animates it, then calls playSetup)
export const startPuzzle = (p) => {
  const start = chess.fromFEN(p.fen)
  return { puzzle: p, game: start, you: chess.other(start.turn), ply: 0, status: "setup", failed: false, hinted: false, line: [] }
}

const play = (st, uci) => {
  const r = chess.applyMove(st.game, uciToMove(uci))
  if (!r.ok) throw new Error(`Puzzle ${st.puzzle.id}: bad move ${uci}`)
  return { ...st, game: r.state, ply: st.ply + 1, line: [...st.line, uci] }
}

export const playSetup = (st) => (st.status === "setup" ? { ...play(st, st.puzzle.moves[0]), status: "play" } : st)

// Your move -> { ok, correct, state } (state: after it, with the reply waiting in "reply"
// status), or { ok: false, error } for an illegal move. A wrong move isn't kept: the
// screen shows it for a moment and goes back (state stays where it was, marked failed).
export const tryMove = (st, move) => {
  if (st.status !== "play") return { ok: false, error: "Not your move." }
  const r = chess.applyMove(st.game, move)
  if (!r.ok) return r
  const expected = uciToMove(st.puzzle.moves[st.ply])
  const promo = (m) => (m.promotion ? String(m.promotion).toLowerCase() : "")
  const exact = r.move.from === expected.from && r.move.to === expected.to && promo(r.move) === promo(expected)
  const mate = r.state.result?.reason === "checkmate"
  if (!exact && !mate) return { ok: true, correct: false, state: { ...st, failed: true }, wrong: r.state }
  const next = { ...st, game: r.state, ply: st.ply + 1, line: [...st.line, moveToUci(r.move)] }
  const done = mate || next.ply >= st.puzzle.moves.length
  return { ok: true, correct: true, state: { ...next, status: done ? "solved" : "reply" } }
}

// The opponent's answer after a right move
export const playReply = (st) => (st.status === "reply" ? { ...play(st, st.puzzle.moves[st.ply]), status: "play" } : st)

// Show the answer: plays the rest of the line, one ply at a time (call until status "shown")
export const stepSolution = (st) => {
  if (st.ply >= st.puzzle.moves.length) return { ...st, status: "shown" }
  const next = play(st, st.puzzle.moves[st.ply])
  return { ...next, failed: true, status: next.ply >= st.puzzle.moves.length ? "shown" : "showing" }
}
// Back to the position before your first move, to try again (still counts as failed)
export const retry = (st) => {
  let s = startPuzzle(st.puzzle)
  s = playSetup(s)
  return { ...s, failed: true, hinted: st.hinted }
}

// Hint: the piece to move (level 1), then where it goes (level 2)
export const hint = (st, level = 1) => {
  if (st.status !== "play") return null
  const m = uciToMove(st.puzzle.moves[st.ply])
  return level >= 2 ? { from: m.from, to: m.to } : { from: m.from }
}

// ---------- choosing puzzles ----------

// A puzzle near `target`, with the theme, not in `exclude` (ids); widening the window
// until something fits
export const choosePuzzle = (all, { target = 1500, theme = null, exclude = new Set(), random = Math.random, above = false } = {}) => {
  let pool = all.filter((p) => hasTheme(p, theme))
  const unseen = pool.filter((p) => !exclude.has(p.id))
  if (unseen.length) pool = unseen
  if (!pool.length) return null
  for (const w of [75, 150, 250, 400, 700, 5000]) {
    const near = pool.filter((p) => (above ? p.rating >= target - w / 3 && p.rating <= target + w : Math.abs(p.rating - target) <= w))
    if (near.length) return near[Math.floor(random() * near.length)]
  }
  return pool[Math.floor(random() * pool.length)]
}

// The day's puzzle: the same for everyone on a date, from the middle bands
export const dailyPuzzle = (all, date = new Date()) => {
  const key = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
  let h = 2166136261
  for (const ch of key) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0
  const pool = all.filter((p) => p.rating >= 1300 && p.rating < 2100).sort((a, b) => (a.id < b.id ? -1 : 1))
  return pool.length ? pool[h % pool.length] : null
}

// Streak and Rush get harder as you go
export const streakTarget = (n) => 900 + n * 60
export const rushTarget = (n) => 700 + n * 75

// ---------- rating (Glicko-1, like Lichess's puzzle rating in spirit) ----------

export const START_RATING = { rating: 1500, rd: 350 }
const Q = Math.log(10) / 400
const g = (rd) => 1 / Math.sqrt(1 + (3 * Q * Q * rd * rd) / (Math.PI * Math.PI))
const MIN_RD = 60
const PUZZLE_RD = 80

// win: true/false -> the new { rating, rd } and the change
export const rate = ({ rating, rd }, puzzleRating, win) => {
  const gj = g(PUZZLE_RD)
  const e = 1 / (1 + Math.pow(10, (-gj * (rating - puzzleRating)) / 400))
  const d2 = 1 / (Q * Q * gj * gj * e * (1 - e))
  const denom = 1 / (rd * rd) + 1 / d2
  const next = rating + (Q / denom) * gj * ((win ? 1 : 0) - e)
  const nextRd = Math.max(MIN_RD, Math.sqrt(1 / denom))
  const r = Math.round(Math.min(3200, Math.max(400, next)))
  return { rating: r, rd: Math.round(nextRd * 10) / 10, delta: r - Math.round(rating) }
}
