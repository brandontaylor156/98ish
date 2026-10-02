// Pure Tetris engine following the Tetris Guideline: 7-bag randomizer, SRS rotation with
// wall kicks, hold, ghost piece, 0.5s move-reset lock delay, guideline gravity curve, and
// guideline scoring (T-spins, back-to-back, combos). Every function takes a state and
// returns a new one; useTetris drives it from a requestAnimationFrame loop.

import { SHAPES, TYPES, cellClass, kicksFor } from "./tetrominoes.js"

export const COLUMNS = 10
export const VISIBLE_ROWS = 20
export const HIDDEN_ROWS = 2 // spawn area above the visible field
const ROWS = VISIBLE_ROWS + HIDDEN_ROWS

export const NEXT_COUNT = 5
const LOCK_DELAY = 500
const MAX_LOCK_RESETS = 15
const SOFT_DROP_FACTOR = 20
const LINES_PER_LEVEL = 10

const LINE_NAMES = ["", "Single", "Double", "Triple", "Tetris"]

// Guideline gravity: seconds per row = (0.8 - (level - 1) * 0.007) ^ (level - 1)
export const gravityInterval = (level) =>
  Math.pow(0.8 - (level - 1) * 0.007, level - 1) * 1000

const emptyRow = () => Array(COLUMNS).fill(null)

const shuffledBag = () => {
  const bag = [...TYPES]
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[bag[i], bag[j]] = [bag[j], bag[i]]
  }
  return bag
}

const refillQueue = (queue) => {
  let next = queue
  while (next.length <= NEXT_COUNT) next = [...next, ...shuffledBag()]
  return next
}

const cellsOf = (piece) => {
  const cells = []
  SHAPES[piece.type][piece.rotation].forEach((row, y) =>
    row.forEach((filled, x) => {
      if (filled) cells.push([piece.x + x, piece.y + y])
    })
  )
  return cells
}

const fits = (board, piece) =>
  cellsOf(piece).every(
    ([x, y]) => x >= 0 && x < COLUMNS && y >= 0 && y < ROWS && !board[y][x]
  )

const isOnGround = (state) =>
  !fits(state.board, { ...state.active, y: state.active.y + 1 })

const spawn = (state, type) => {
  const piece = { type, rotation: 0, x: type === "O" ? 4 : 3, y: 0 }

  // Block out: the new piece overlaps the stack
  if (!fits(state.board, piece)) return { ...state, active: null, status: "over" }

  // Guideline: drop one row straight away if there's room
  const dropped = { ...piece, y: 1 }
  const active = fits(state.board, dropped) ? dropped : piece

  return {
    ...state,
    active,
    gravityTimer: 0,
    lockTimer: 0,
    lockResets: 0,
    lowestY: active.y,
    lastAction: null,
    lastKick: 0,
  }
}

const spawnNext = (state) => {
  const [type, ...rest] = state.queue
  return spawn({ ...state, queue: refillQueue(rest) }, type)
}

export const createGame = () => {
  const [first, ...rest] = refillQueue([])
  return spawn(
    {
      board: Array.from({ length: ROWS }, emptyRow),
      active: null,
      queue: refillQueue(rest),
      hold: null,
      holdUsed: false,
      score: 0,
      lines: 0,
      level: 1,
      combo: -1,
      backToBack: false,
      lastClear: null,
      status: "playing",
    },
    first
  )
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

export const move = (state, dx) =>
  state.status === "playing" ? shift(state, dx, 0) ?? state : state

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
  return lock({
    ...state,
    active: piece,
    score: state.score + rows * 2,
    lastAction: rows > 0 ? "drop" : state.lastAction,
  })
}

export const togglePause = (state) => {
  if (state.status === "playing") return { ...state, status: "paused" }
  if (state.status === "paused") return { ...state, status: "playing" }
  return state
}

// 3-corner rule; "mini" unless both corners on the pointed side are filled (or the last
// rotation needed the final SRS kick)
const detectTSpin = (state) => {
  const piece = state.active
  if (piece.type !== "T" || state.lastAction !== "rotate") return null

  const filled = (x, y) => x < 0 || x >= COLUMNS || y >= ROWS || Boolean(state.board[y][x])
  // Top-left, top-right, bottom-right, bottom-left of the 3x3 box
  const corners = [[0, 0], [2, 0], [2, 2], [0, 2]].map(([dx, dy]) =>
    filled(piece.x + dx, piece.y + dy)
  )
  if (corners.filter(Boolean).length < 3) return null

  const [frontA, frontB] = [[0, 1], [1, 2], [2, 3], [3, 0]][piece.rotation]
  return (corners[frontA] && corners[frontB]) || state.lastKick === 4 ? "full" : "mini"
}

const clearValue = (lines, tSpin) => {
  if (tSpin === "full")
    return { base: [400, 800, 1200, 1600][lines], name: `T-Spin ${LINE_NAMES[lines]}`.trim(), difficult: lines > 0 }
  if (tSpin === "mini")
    return { base: [100, 200, 400][lines], name: `T-Spin Mini ${LINE_NAMES[lines]}`.trim(), difficult: lines > 0 }
  return { base: [0, 100, 300, 500, 800][lines], name: LINE_NAMES[lines], difficult: lines === 4 }
}

const lock = (state) => {
  const cells = cellsOf(state.active)
  const tSpin = detectTSpin(state)

  const placed = state.board.map((row) => [...row])
  cells.forEach(([x, y]) => {
    placed[y][x] = state.active.type
  })

  const remaining = placed.filter((row) => row.some((cell) => !cell))
  const cleared = ROWS - remaining.length
  const board = [...Array.from({ length: cleared }, emptyRow), ...remaining]

  const { base, name, difficult } = clearValue(cleared, tSpin)
  let points = base * state.level
  let { combo, backToBack } = state
  const labels = []

  if (cleared > 0) {
    if (difficult && backToBack) {
      points = Math.floor(points * 1.5)
      labels.push("Back-to-Back")
    }
    backToBack = difficult
    combo += 1
    if (combo > 0) {
      points += 50 * combo * state.level
      labels.push(`${combo} Combo`)
    }
  } else {
    combo = -1
  }
  if (name) labels.unshift(name)

  const lines = state.lines + cleared
  const next = {
    ...state,
    board,
    active: null,
    score: state.score + points,
    lines,
    level: Math.floor(lines / LINES_PER_LEVEL) + 1,
    combo,
    backToBack,
    holdUsed: false,
    lastClear: labels.length
      ? { labels, points, id: (state.lastClear?.id ?? 0) + 1 }
      : state.lastClear,
  }

  // Lock out: the piece locked entirely above the visible field
  if (cells.every(([, y]) => y < HIDDEN_ROWS)) return { ...next, status: "over" }

  return spawnNext(next)
}

// Advance time: gravity (faster while soft dropping, 1 point per row) and lock delay
export const tick = (state, elapsed, softDropping) => {
  if (state.status !== "playing") return state

  let next = state
  const interval = gravityInterval(state.level) / (softDropping ? SOFT_DROP_FACTOR : 1)
  // Time saved up under normal gravity mustn't be spent all at once at the faster soft
  // drop rate (that dropped several rows in one frame the moment soft drop kicked in)
  let gravityTimer = (softDropping ? Math.min(state.gravityTimer, interval) : state.gravityTimer) + elapsed

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

// Visible 20x10 grid of cell class names, with the ghost and active piece drawn in
export const visibleCells = (state) => {
  const grid = state.board.map((row) => row.map((type) => (type ? cellClass(type) : "")))

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
