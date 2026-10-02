// Pure Tetris engine following the Tetris Guideline: seeded 7-bag randomizer, SRS rotation
// with wall kicks, hold, ghost piece, 0.5s move-reset lock delay (15 resets), guideline
// gravity curve and scoring (T-spins, back-to-back, combos, perfect clears), plus what the
// game modes need: level rules, goals and time limits, and versus garbage (an attack table,
// incoming garbage that your own attacks cancel, garbage rows with a hole or solid ones).
// Every function takes a state and returns a new one; useTetris drives it from a
// requestAnimationFrame loop, and the server's computer players use it too.

import { SHAPES, TYPES, cellClass, kicksFor } from "./tetrominoes.js"
import { randomSeed, shuffleBag } from "./rng.js"

export const COLUMNS = 10
export const VISIBLE_ROWS = 20
export const HIDDEN_ROWS = 2 // spawn area above the visible field
export const ROWS = VISIBLE_ROWS + HIDDEN_ROWS

export const NEXT_COUNT = 5
export const LOCK_DELAY = 500
export const MAX_LOCK_RESETS = 15
const SOFT_DROP_FACTOR = 20

const LINE_NAMES = ["", "Single", "Double", "Triple", "Tetris"]
const PERFECT_CLEAR_POINTS = [0, 800, 1200, 1800, 2000]

// How a game levels up and ends. Modes (modes.js) pick from these.
// levelMode: "lines10" (a level every 10 lines), "variable" (Marathon: level N needs 5N
// goal points, see awardedLines), "fixed", "time" (a level every 30 seconds, for versus)
export const DEFAULT_OPTIONS = {
  levelMode: "lines10",
  startLevel: 1,
  maxLevel: 20, // gravity stops getting faster here
  variableLevels: 15, // "variable": finishing this level ends the game
  goalLines: 0, // end after this many lines (Sprint)
  timeLimit: 0, // ms (Ultra, versus)
  finaleAt: 0, // Survival: after this many lines, the stack turns semi-invisible...
  finaleLines: 0, // ...for this many more lines
  solidGarbage: false, // Battle: garbage rows without holes, removed only by attacking
  garbageCap: 8, // garbage rows that can rise under one piece
  noPause: false,
}

// Lines of garbage sent per clear (versus). T-spins and Tetrises are worth the most.
export const ATTACK = {
  lines: [0, 0, 1, 2, 4],
  tSpin: [0, 2, 4, 6],
  mini: [0, 0, 1],
  backToBack: 1,
  perfectClear: 10,
  combo: [0, 0, 1, 1, 1, 2, 2, 3, 3, 4, 4, 4, 5], // by combo count (0 = the first clear)
}

export const attackFor = ({ lines, tSpin = null, backToBack = false, combo = 0, perfectClear = false }) => {
  if (!lines) return 0
  let n = tSpin === "full" ? ATTACK.tSpin[lines] : tSpin === "mini" ? ATTACK.mini[lines] ?? 0 : ATTACK.lines[lines]
  if (backToBack) n += ATTACK.backToBack
  n += ATTACK.combo[Math.min(Math.max(combo, 0), ATTACK.combo.length - 1)]
  if (perfectClear) n += ATTACK.perfectClear
  return n
}

// Marathon's variable goal: what a clear counts toward the level's goal of 5 x level
export const awardedLines = (lines, tSpin = null, backToBack = false) => {
  const n = tSpin === "full" ? [4, 8, 12, 16][lines] : tSpin === "mini" ? [1, 2, 4][lines] ?? 0 : [0, 1, 3, 5, 8][lines]
  return backToBack && lines ? Math.floor(n * 1.5) : n
}
export const levelGoal = (level) => 5 * level

// Guideline gravity: seconds per row = (0.8 - (level - 1) * 0.007) ^ (level - 1)
export const gravityInterval = (level) => Math.pow(0.8 - (level - 1) * 0.007, level - 1) * 1000

const emptyRow = () => Array(COLUMNS).fill(null)
const emptyBoard = () => Array.from({ length: ROWS }, emptyRow)

// Keep at least NEXT_COUNT + 1 pieces queued, a whole bag at a time
const fillQueue = (state) => {
  let { queue, rng } = state
  while (queue.length <= NEXT_COUNT) {
    const [bag, next] = shuffleBag(TYPES, rng)
    queue = [...queue, ...bag]
    rng = next
  }
  return queue === state.queue ? state : { ...state, queue, rng }
}

export const cellsOf = (piece) => {
  const cells = []
  SHAPES[piece.type][piece.rotation].forEach((row, y) =>
    row.forEach((filled, x) => {
      if (filled) cells.push([piece.x + x, piece.y + y])
    })
  )
  return cells
}

export const fits = (board, piece) => cellsOf(piece).every(([x, y]) => x >= 0 && x < COLUMNS && y >= 0 && y < ROWS && !board[y][x])

const isOnGround = (state) => !fits(state.board, { ...state.active, y: state.active.y + 1 })

const over = (state, endReason) => ({ ...state, status: "over", endReason })

export const spawnPiece = (type) => ({ type, rotation: 0, x: type === "O" ? 4 : 3, y: 0 })

const spawn = (state, type) => {
  const piece = spawnPiece(type)

  // Block out: the new piece overlaps the stack
  if (!fits(state.board, piece)) return over({ ...state, active: null }, "topout")

  // Guideline: drop one row straight away if there's room
  const dropped = { ...piece, y: 1 }
  const active = fits(state.board, dropped) ? dropped : piece

  return { ...state, active, gravityTimer: 0, lockTimer: 0, lockResets: 0, lowestY: active.y, lastAction: null, lastKick: 0 }
}

const spawnNext = (state) => {
  const [type, ...rest] = state.queue
  return spawn(fillQueue({ ...state, queue: rest }), type)
}

const emptyStats = () => ({
  singles: 0,
  doubles: 0,
  triples: 0,
  tetrises: 0,
  tSpins: { zero: 0, mini: 0, single: 0, double: 0, triple: 0 },
  maxCombo: 0,
  backToBacks: 0,
  perfectClears: 0,
  sent: 0,
  received: 0,
})

// options: DEFAULT_OPTIONS plus `seed` (the same seed gives the same pieces)
export const createGame = (options = {}) => {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  const seed = Number.isInteger(options.seed) ? options.seed >>> 0 : randomSeed()
  const state = fillQueue({
    board: emptyBoard(),
    active: null,
    queue: [],
    rng: seed,
    seed,
    hold: null,
    holdUsed: false,
    score: 0,
    lines: 0,
    level: opts.startLevel,
    goal: 0, // "variable" levels: goal points earned in this level
    combo: -1,
    backToBack: false,
    lastClear: null,
    attack: null, // the last attack: { id, lines, sent, cancelled }
    pending: [], // incoming garbage: [{ lines, hole, solid }]
    shield: false,
    status: "playing",
    endReason: null,
    time: 0, // ms played
    pieces: 0,
    splits: [], // time at every 10 lines (Sprint)
    finale: false,
    kos: 0, // times this board was knocked out and refilled (Battle)
    stats: emptyStats(),
    opts,
  })
  return spawnNext(state)
}

// The piece sequence a seed gives (what a race's players all get)
export const sequenceFor = (seed, count) => {
  let state = { queue: [], rng: seed >>> 0 }
  while (state.queue.length < count) {
    const [bag, rng] = shuffleBag(TYPES, state.rng)
    state = { queue: [...state.queue, ...bag], rng }
  }
  return state.queue.slice(0, count)
}

// Apply a successful move/rotation, handling move-reset lock delay: while the lock timer
// is running, each move restarts it, up to MAX_LOCK_RESETS times. Reaching a new lowest
// row restores the resets.
const placeActive = (state, piece, action, kick = 0) => {
  const next = { ...state, active: piece, lastAction: action, lastKick: kick }
  if (piece.y > state.lowestY) {
    next.lowestY = piece.y
    next.lockResets = 0
    next.lockTimer = 0
  } else if (state.lockTimer > 0 && state.lockResets < MAX_LOCK_RESETS) {
    next.lockTimer = 0
    next.lockResets = state.lockResets + 1
  }
  return next
}

const shift = (state, dx, dy) => {
  const piece = { ...state.active, x: state.active.x + dx, y: state.active.y + dy }
  return fits(state.board, piece) ? placeActive(state, piece, "move") : null
}

export const move = (state, dx) => (state.status === "playing" ? shift(state, dx, 0) ?? state : state)

export const rotate = (state, direction) => {
  if (state.status !== "playing" || state.active.type === "O") return state

  const { active } = state
  const to = (active.rotation + direction + 4) % 4
  const tests = kicksFor(active.type, active.rotation, to)

  for (let i = 0; i < tests.length; i++) {
    const [kickX, kickY] = tests[i]
    const piece = { ...active, rotation: to, x: active.x + kickX, y: active.y - kickY }
    if (fits(state.board, piece)) return placeActive(state, piece, "rotate", i)
  }
  return state
}

export const hold = (state) => {
  if (state.status !== "playing" || state.holdUsed) return state
  const next = { ...state, hold: state.active.type, holdUsed: true }
  return state.hold ? spawn(next, state.hold) : spawnNext(next)
}

// One row down now (1 point), as when soft drop is first pressed; holding it then
// speeds up gravity in tick(). Resets the gravity timer so it doesn't fall twice at once.
export const softDropStep = (state) => {
  if (state.status !== "playing") return state
  const fallen = shift(state, 0, 1)
  return fallen ? { ...fallen, score: fallen.score + 1, gravityTimer: 0 } : state
}

export const ghostOf = (state) => {
  let piece = state.active
  while (fits(state.board, { ...piece, y: piece.y + 1 })) piece = { ...piece, y: piece.y + 1 }
  return piece
}

export const hardDrop = (state) => {
  if (state.status !== "playing") return state
  const piece = ghostOf(state)
  const rows = piece.y - state.active.y
  return lock({ ...state, active: piece, score: state.score + rows * 2, lastAction: rows > 0 ? "drop" : state.lastAction })
}

export const togglePause = (state) => {
  if (state.opts.noPause) return state
  if (state.status === "playing") return { ...state, status: "paused" }
  if (state.status === "paused") return { ...state, status: "playing" }
  return state
}

// 3-corner rule; "mini" unless both corners on the pointed side are filled (or the last
// rotation needed the final SRS kick)
export const detectTSpin = (state) => {
  const piece = state.active
  if (piece.type !== "T" || state.lastAction !== "rotate") return null

  const filled = (x, y) => x < 0 || x >= COLUMNS || y >= ROWS || Boolean(state.board[y][x])
  // Top-left, top-right, bottom-right, bottom-left of the 3x3 box
  const corners = [[0, 0], [2, 0], [2, 2], [0, 2]].map(([dx, dy]) => filled(piece.x + dx, piece.y + dy))
  if (corners.filter(Boolean).length < 3) return null

  const [frontA, frontB] = [[0, 1], [1, 2], [2, 3], [3, 0]][piece.rotation]
  return (corners[frontA] && corners[frontB]) || state.lastKick === 4 ? "full" : "mini"
}

const clearValue = (lines, tSpin) => {
  if (tSpin === "full") return { base: [400, 800, 1200, 1600][lines], name: `T-Spin ${LINE_NAMES[lines]}`.trim(), difficult: lines > 0 }
  if (tSpin === "mini") return { base: [100, 200, 400][lines], name: `T-Spin Mini ${LINE_NAMES[lines]}`.trim(), difficult: lines > 0 }
  return { base: [0, 100, 300, 500, 800][lines], name: LINE_NAMES[lines], difficult: lines === 4 }
}

// ---------- garbage ----------

const isSolidRow = (row) => row.every((cell) => cell === "#")

// Push `lines` garbage rows up from the bottom. overflow: blocks were pushed off the top.
export const insertGarbage = (board, lines, hole = 0, solid = false) => {
  const rows = Array.from({ length: lines }, () =>
    solid ? Array(COLUMNS).fill("#") : Array.from({ length: COLUMNS }, (_, x) => (x === hole ? null : "g"))
  )
  const overflow = board.slice(0, lines).some((row) => row.some(Boolean))
  return { board: [...board.slice(lines), ...rows], overflow }
}

// Garbage on its way to this board ({ lines, hole, solid }). A shield (an Arena item)
// stops the next batch.
export const receiveGarbage = (state, garbage) => {
  const lines = Math.max(0, Math.min(20, Math.floor(garbage.lines) || 0))
  if (!lines) return state
  if (state.shield) return { ...state, shield: false, blocked: (state.blocked || 0) + lines }
  const hole = Number.isInteger(garbage.hole) && garbage.hole >= 0 && garbage.hole < COLUMNS ? garbage.hole : 0
  return { ...state, pending: [...state.pending, { lines, hole, solid: !!garbage.solid }] }
}

export const pendingLines = (state) => state.pending.reduce((sum, g) => sum + g.lines, 0)

// Spend `amount` attack lines cancelling incoming garbage, oldest first
export const cancelPending = (pending, amount) => {
  let left = amount
  const rest = []
  for (const g of pending) {
    if (left >= g.lines) left -= g.lines
    else {
      rest.push({ ...g, lines: g.lines - left })
      left = 0
    }
  }
  return { pending: rest, cancelled: amount - left }
}

// Raise up to `cap` rows of the waiting garbage into the board
const riseGarbage = (state) => {
  let { board } = state
  let room = state.opts.garbageCap
  let overflow = false
  let risen = 0
  const pending = []
  for (const g of state.pending) {
    const n = Math.min(g.lines, room)
    if (n > 0) {
      const result = insertGarbage(board, n, g.hole, g.solid)
      board = result.board
      overflow ||= result.overflow
      room -= n
      risen += n
    }
    if (g.lines > n) pending.push({ ...g, lines: g.lines - n })
  }
  return { ...state, board, pending, stats: { ...state.stats, received: state.stats.received + risen }, overflow }
}

// Remove the bottom `count` solid garbage rows (Battle: attacking digs out your own garbage)
const removeSolidRows = (board, count) => {
  let removed = 0
  const rows = [...board]
  while (removed < count && rows.length && isSolidRow(rows[rows.length - 1])) {
    rows.pop()
    removed++
  }
  return { board: [...Array.from({ length: removed }, emptyRow), ...rows], removed }
}

// Arena item: clear the bottom rows, whatever is in them
export const sweepRows = (state, count = 3) => {
  const board = [...Array.from({ length: count }, emptyRow), ...state.board.slice(0, ROWS - count)]
  let next = { ...state, board }
  if (next.active && !fits(board, next.active)) {
    for (let up = 1; up <= count; up++) {
      const piece = { ...next.active, y: next.active.y - up }
      if (fits(board, piece)) return { ...next, active: piece }
    }
  }
  return next
}

// Battle: knocked out, the board is cleared and play goes on
export const respawn = (state) =>
  spawnNext({
    ...state,
    board: emptyBoard(),
    pending: [],
    combo: -1,
    backToBack: false,
    holdUsed: false,
    status: "playing",
    endReason: null,
    kos: state.kos + 1,
  })

// ---------- locking ----------

const levelAfter = (state, lines, awarded) => {
  const { opts } = state
  if (opts.levelMode === "lines10") return { level: Math.min(Math.floor(lines / 10) + opts.startLevel, 99), goal: 0 }
  if (opts.levelMode === "variable") {
    let { level, goal } = state
    goal += awarded
    while (goal >= levelGoal(level) && level <= opts.variableLevels) {
      goal -= levelGoal(level)
      level++
    }
    return { level, goal }
  }
  return { level: state.level, goal: state.goal }
}

// End conditions shared by lock and tick
const checkGoals = (state) => {
  if (state.status !== "playing") return state
  const { opts } = state
  if (opts.goalLines && state.lines >= opts.goalLines) return over(state, "goal")
  if (opts.levelMode === "variable" && state.level > opts.variableLevels) return over({ ...state, level: opts.variableLevels, goal: levelGoal(opts.variableLevels) }, "goal")
  if (opts.finaleAt) {
    if (state.lines >= opts.finaleAt + opts.finaleLines) return over(state, "goal")
    if (!state.finale && state.lines >= opts.finaleAt) return { ...state, finale: true }
  }
  if (opts.timeLimit && state.time >= opts.timeLimit) return over({ ...state, time: opts.timeLimit }, "time")
  return state
}

const TSPIN_KEYS = ["zero", "single", "double", "triple"]
const LINE_KEYS = ["", "singles", "doubles", "triples", "tetrises"]

const lock = (state) => {
  const cells = cellsOf(state.active)
  const tSpin = detectTSpin(state)

  const placed = state.board.map((row) => [...row])
  cells.forEach(([x, y]) => {
    placed[y][x] = state.active.type
  })

  const remaining = placed.filter((row) => row.some((cell) => !cell) || isSolidRow(row))
  const cleared = ROWS - remaining.length
  let board = [...Array.from({ length: cleared }, emptyRow), ...remaining]
  const perfectClear = cleared > 0 && board.every((row) => row.every((cell) => !cell))

  const { base, name, difficult } = clearValue(cleared, tSpin)
  let points = base * state.level
  let { combo, backToBack } = state
  const labels = []
  const b2b = cleared > 0 && difficult && backToBack
  const stats = { ...state.stats, tSpins: { ...state.stats.tSpins } }

  if (cleared > 0) {
    if (b2b) {
      points = Math.floor(points * 1.5)
      labels.push("Back-to-Back")
      stats.backToBacks++
    }
    backToBack = difficult
    combo += 1
    if (combo > 0) {
      points += 50 * combo * state.level
      labels.push(`${combo} Combo`)
    }
    stats.maxCombo = Math.max(stats.maxCombo, combo)
    if (!tSpin) stats[LINE_KEYS[cleared]]++
  } else {
    combo = -1
  }
  if (tSpin === "full") stats.tSpins[TSPIN_KEYS[cleared]]++
  if (tSpin === "mini") stats.tSpins.mini++
  if (perfectClear) {
    points += PERFECT_CLEAR_POINTS[cleared] * state.level
    labels.push("Perfect Clear")
    stats.perfectClears++
  }
  if (name) labels.unshift(name)

  // Versus: the attack first cancels garbage on its way here, then (Battle) digs out
  // solid garbage, and whatever is left goes to the opponent
  const attackLines = attackFor({ lines: cleared, tSpin, backToBack: b2b, combo, perfectClear })
  let { pending, attack } = state
  if (attackLines > 0) {
    const result = cancelPending(pending, attackLines)
    pending = result.pending
    let left = attackLines - result.cancelled
    let dug = 0
    if (state.opts.solidGarbage && left > 0) {
      const dig = removeSolidRows(board, left)
      board = dig.board
      dug = dig.removed
      left -= dug
    }
    stats.sent += left
    attack = { id: (attack?.id ?? 0) + 1, lines: attackLines, sent: left, cancelled: result.cancelled, dug }
  }

  const lines = state.lines + cleared
  const { level, goal } = levelAfter(state, lines, awardedLines(cleared, tSpin, b2b))
  const splits = [...state.splits]
  for (let mark = (Math.floor(state.lines / 10) + 1) * 10; mark <= lines; mark += 10) splits.push({ lines: mark, time: state.time })

  let next = {
    ...state,
    board,
    active: null,
    score: state.score + points,
    lines,
    level,
    goal,
    combo,
    backToBack,
    pending,
    attack,
    splits,
    stats,
    pieces: state.pieces + 1,
    holdUsed: false,
    lastClear: labels.length ? { labels, points, attack: attackLines, id: (state.lastClear?.id ?? 0) + 1, tSpin: tSpin && cleared ? `${tSpin}${cleared}` : null } : state.lastClear,
  }

  // Lock out: the piece locked entirely above the visible field
  if (cells.every(([, y]) => y < HIDDEN_ROWS)) return over(next, "topout")

  // No lines cleared: the waiting garbage rises
  if (cleared === 0 && pending.length) {
    next = riseGarbage(next)
    const overflow = next.overflow
    delete next.overflow
    if (overflow) return over(next, "topout")
  }

  next = checkGoals(next)
  if (next.status !== "playing") return next
  return spawnNext(next)
}

// Advance time: gravity (faster while soft dropping, 1 point per row) and lock delay
export const tick = (state, elapsed, softDropping) => {
  if (state.status !== "playing") return state

  let next = { ...state, time: state.time + elapsed }
  if (state.opts.levelMode === "time") next.level = Math.min(state.opts.maxLevel, state.opts.startLevel + Math.floor(next.time / 30_000))
  next = checkGoals(next)
  if (next.status !== "playing") return next

  const interval = gravityInterval(Math.min(next.level, next.opts.maxLevel)) / (softDropping ? SOFT_DROP_FACTOR : 1)
  // Time saved up under normal gravity mustn't be spent all at once at the faster soft
  // drop rate (that dropped several rows in one frame the moment soft drop kicked in)
  let gravityTimer = (softDropping ? Math.min(next.gravityTimer, interval) : next.gravityTimer) + elapsed

  while (gravityTimer >= interval) {
    const fallen = shift(next, 0, 1)
    if (!fallen) {
      gravityTimer = 0
      break
    }
    gravityTimer -= interval
    next = softDropping ? { ...fallen, score: fallen.score + 1 } : fallen
  }
  next = { ...next, gravityTimer }

  if (!isOnGround(next)) return { ...next, lockTimer: 0 }

  const lockTimer = next.lockTimer + elapsed
  return lockTimer >= LOCK_DELAY ? lock(next) : { ...next, lockTimer }
}

// Visible 20x10 grid of cell class names, with the ghost and active piece drawn in.
// Survival's finale leaves the stack faint.
export const visibleCells = (state) => {
  const faint = state.finale ? " tetromino_faint" : ""
  const grid = state.board.map((row) => row.map((type) => (type ? cellClass(type) + faint : "")))

  if (state.active) {
    const ghost = ghostOf(state)
    cellsOf(ghost).forEach(([x, y]) => {
      if (!grid[y][x]) grid[y][x] = `${cellClass(ghost.type)} tetromino_ghost`
    })
    cellsOf(state.active).forEach(([x, y]) => {
      grid[y][x] = cellClass(state.active.type)
    })
  }

  return grid.slice(HIDDEN_ROWS)
}

// ---------- compact boards for opponents' views ----------

// Rows from the top of the stack to the floor (0 = empty board)
export const stackHeight = (board) => {
  const top = board.findIndex((row) => row.some(Boolean))
  return top < 0 ? 0 : ROWS - top
}

// The visible field (with the falling piece) as 200 characters: "." empty, a piece letter
// in lower case, "g" garbage, "#" solid garbage
export const toSnapshot = (state) => {
  const grid = state.board.map((row) => row.map((type) => (type ? type.toLowerCase() : ".")))
  if (state.active && state.status === "playing") cellsOf(state.active).forEach(([x, y]) => (grid[y][x] = state.active.type.toLowerCase()))
  return grid.slice(HIDDEN_ROWS).map((row) => row.join("")).join("")
}

export const SNAPSHOT = /^[.ijlostzg#]{200}$/

// Back to rows of cell class names (for the mini boards)
export const fromSnapshot = (snap) => {
  const rows = []
  for (let y = 0; y < VISIBLE_ROWS; y++) {
    const row = []
    for (let x = 0; x < COLUMNS; x++) {
      const c = snap?.[y * COLUMNS + x] || "."
      row.push(c === "." ? "" : cellClass(c === "#" ? "#" : c.toUpperCase()))
    }
    rows.push(row)
  }
  return rows
}
