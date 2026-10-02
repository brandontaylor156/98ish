// Block Ten's rules, with no DOM: a 10x10 board, three pieces at a time, full rows and
// columns clear. Every function returns a new state (nothing is changed in place), so the
// UI can keep the previous one around for Undo, and tests can build any board they like.

export const SIZE = 10
export const MODES = ["classic", "daily", "blast"]
export const BLAST_SECONDS = 180

// ---- the pieces (never rotated: each rotation is its own piece) ----

// cells as [row, col] from the top-left of the piece's bounding box
const line = (n, vertical) => Array.from({ length: n }, (_, i) => (vertical ? [i, 0] : [0, i]))
const square = (n) => Array.from({ length: n * n }, (_, i) => [Math.floor(i / n), i % n])

// color is an index into the theme's colors (1-9); weight is how often it's dealt
const DEFS = [
  ["dot", [[0, 0]], 1, 2],
  ["h2", line(2), 2, 3],
  ["v2", line(2, true), 2, 3],
  ["h3", line(3), 3, 3],
  ["v3", line(3, true), 3, 3],
  ["h4", line(4), 4, 2],
  ["v4", line(4, true), 4, 2],
  ["h5", line(5), 5, 2],
  ["v5", line(5, true), 5, 2],
  ["sq2", square(2), 6, 4],
  ["sq3", square(3), 7, 2],
  // small corners (three cells in a 2x2)
  ["l2a", [[0, 0], [1, 0], [1, 1]], 8, 2],
  ["l2b", [[0, 0], [0, 1], [1, 0]], 8, 2],
  ["l2c", [[0, 0], [0, 1], [1, 1]], 8, 2],
  ["l2d", [[0, 1], [1, 0], [1, 1]], 8, 2],
  // big corners (five cells in a 3x3)
  ["l3a", [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]], 9, 1],
  ["l3b", [[0, 0], [0, 1], [0, 2], [1, 0], [2, 0]], 9, 1],
  ["l3c", [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]], 9, 1],
  ["l3d", [[0, 2], [1, 2], [2, 0], [2, 1], [2, 2]], 9, 1],
]

export const PIECES = Object.fromEntries(
  DEFS.map(([id, cells, color, weight]) => [
    id,
    { id, cells, color, weight, w: Math.max(...cells.map((c) => c[1])) + 1, h: Math.max(...cells.map((c) => c[0])) + 1 },
  ])
)
export const PIECE_IDS = DEFS.map((d) => d[0])
const TOTAL_WEIGHT = DEFS.reduce((sum, d) => sum + d[3], 0)

// ---- a small seeded random (mulberry32), its state kept as a number in the game ----

export const seedFrom = (text) => {
  let h = 2166136261
  for (const ch of String(text)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return h >>> 0
}

// one random number in [0, 1) and the next seed
export const nextRandom = (seed) => {
  const s = (seed + 0x6d2b79f5) >>> 0
  let t = s
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, s]
}

const randomPiece = (seed) => {
  const [r, next] = nextRandom(seed)
  let pick = r * TOTAL_WEIGHT
  for (const [id, , , weight] of DEFS) {
    pick -= weight
    if (pick < 0) return [id, next]
  }
  return [DEFS.at(-1)[0], next]
}

// ---- the board: 100 numbers, 0 empty or a color ----

export const emptyBoard = () => new Array(SIZE * SIZE).fill(0)
export const at = (r, c) => r * SIZE + c

// can this piece go with its top-left at (r, c)?
export const canPlace = (board, id, r, c) => {
  const p = PIECES[id]
  if (!p || r < 0 || c < 0 || r + p.h > SIZE || c + p.w > SIZE) return false
  return p.cells.every(([dr, dc]) => !board[at(r + dr, c + dc)])
}

// every spot this piece fits
export const spotsFor = (board, id) => {
  const spots = []
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (canPlace(board, id, r, c)) spots.push([r, c])
  return spots
}

export const fitsAnywhere = (board, id) => {
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (canPlace(board, id, r, c)) return true
  return false
}

// the rows and columns that are full
export const fullLines = (board) => {
  const rows = []
  const cols = []
  for (let i = 0; i < SIZE; i++) {
    let row = true
    let col = true
    for (let j = 0; j < SIZE; j++) {
      if (!board[at(i, j)]) row = false
      if (!board[at(j, i)]) col = false
    }
    if (row) rows.push(i)
    if (col) cols.push(i)
  }
  return { rows, cols }
}

// what placing would clear, without placing (for the preview)
export const wouldClear = (board, id, r, c) => {
  if (!canPlace(board, id, r, c)) return { rows: [], cols: [] }
  const next = board.slice()
  for (const [dr, dc] of PIECES[id].cells) next[at(r + dr, c + dc)] = PIECES[id].color
  return fullLines(next)
}

// ---- scoring ----

// lines cleared at once (the combo): 10, 30, 60, 100, 150... and each move in a row that
// clears something (the streak) adds half again
export const linePoints = (lines, streak = 1) => {
  if (lines <= 0) return 0
  const base = (10 * lines * (lines + 1)) / 2
  return Math.round(base * (1 + 0.5 * Math.max(0, streak - 1)))
}
export const CLEAR_BOARD_BONUS = 300

// ---- the game ----

// three new pieces; when none of them fits, reroll a few times so a fresh tray is rarely
// dead on arrival (still deterministic: the rerolls come from the same seed)
export const dealTray = (board, seed, tries = 4) => {
  let tray
  for (let attempt = 0; attempt <= tries; attempt++) {
    tray = []
    for (let i = 0; i < 3; i++) {
      const [id, next] = randomPiece(seed)
      tray.push(id)
      seed = next
    }
    if (tray.some((id) => fitsAnywhere(board, id))) break
  }
  return { tray, seed }
}

export const newGame = ({ mode = "classic", seed = (Math.random() * 4294967296) >>> 0 } = {}) => {
  const board = emptyBoard()
  const dealt = dealTray(board, seed >>> 0)
  return {
    mode,
    board,
    tray: dealt.tray,
    seed: dealt.seed,
    score: 0,
    streak: 0, // moves in a row that cleared a line
    lines: 0, // lines cleared this game
    moves: 0,
    bestCombo: 0,
    timeLeft: mode === "blast" ? BLAST_SECONDS : null,
    over: null, // null, "stuck" or "time"
    undos: 1, // one Undo per game
    prev: null, // the state before the last move, while Undo is possible
  }
}

// can any piece left in the tray go anywhere?
export const anyMove = (state) => state.tray.some((id) => id && fitsAnywhere(state.board, id))

// places the piece in tray slot `slot` at (r, c). Returns { state, result } or null if it
// doesn't fit. result says what happened: cells, rows, cols, points, combo, streak...
export const place = (state, slot, r, c) => {
  if (state.over) return null
  const id = state.tray[slot]
  if (!id || !canPlace(state.board, id, r, c)) return null
  const piece = PIECES[id]
  let board = state.board.slice()
  const placed = piece.cells.map(([dr, dc]) => at(r + dr, c + dc))
  for (const i of placed) board[i] = piece.color

  const { rows, cols } = fullLines(board)
  const combo = rows.length + cols.length
  const cleared = [] // { i, color } of every cell that goes
  if (combo) {
    const gone = new Set()
    for (const row of rows) for (let j = 0; j < SIZE; j++) gone.add(at(row, j))
    for (const col of cols) for (let j = 0; j < SIZE; j++) gone.add(at(j, col))
    for (const i of gone) cleared.push({ i, color: board[i] })
    board = board.map((v, i) => (gone.has(i) ? 0 : v))
  }
  const streak = combo ? state.streak + 1 : 0
  const cellPoints = piece.cells.length
  const clearPoints = linePoints(combo, streak)
  const boardBonus = combo && board.every((v) => !v) ? CLEAR_BOARD_BONUS : 0
  const points = cellPoints + clearPoints + boardBonus

  let tray = state.tray.slice()
  tray[slot] = null
  let seed = state.seed
  let dealt = false
  if (tray.every((t) => !t)) {
    const d = dealTray(board, seed)
    tray = d.tray
    seed = d.seed
    dealt = true
  }

  const { prev, ...before } = state // only one level of undo is kept
  const next = {
    ...state,
    board,
    tray,
    seed,
    score: state.score + points,
    streak,
    lines: state.lines + combo,
    moves: state.moves + 1,
    bestCombo: Math.max(state.bestCombo, combo),
    prev: state.undos > 0 ? before : null,
  }
  next.over = anyMove(next) ? null : "stuck"
  return {
    state: next,
    result: { id, r, c, placed, rows, cols, combo, streak, cleared, cellPoints, clearPoints, boardBonus, points, dealt, over: next.over },
  }
}

// (not once the game is over: its score is already in the high scores)
export const canUndo = (state) => !!state.prev && state.undos > 0 && !state.over

// back to before the last move (the same pieces come back: the seed is restored too)
export const undo = (state) => {
  if (!canUndo(state)) return state
  return { ...state.prev, undos: state.undos - 1, prev: null, timeLeft: state.timeLeft }
}

// Blast mode's clock
export const tick = (state, seconds) => {
  if (state.mode !== "blast" || state.over) return state
  const timeLeft = Math.max(0, state.timeLeft - seconds)
  return { ...state, timeLeft, over: timeLeft <= 0 ? "time" : null }
}

// today's Daily Challenge seed: everyone gets the same pieces on the same day
export const dailyKey = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
export const dailySeed = (key = dailyKey()) => seedFrom(`block-ten-${key}`)

// a quick sanity check for a saved game read back from storage
export const isValidState = (s) =>
  !!s &&
  MODES.includes(s.mode) &&
  Array.isArray(s.board) &&
  s.board.length === SIZE * SIZE &&
  Array.isArray(s.tray) &&
  s.tray.length === 3 &&
  s.tray.every((t) => t === null || PIECES[t]) &&
  Number.isFinite(s.score)
