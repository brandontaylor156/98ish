// A computer player: tries every rotation and column for the falling piece (and the held
// one), scores the resulting stack, and drops the best. The server runs these at a capped
// speed to fill online matches.

import { COLUMNS, ROWS, cellsOf, fits, hardDrop, hold } from "./engine.js"

export const BOT_LEVELS = {
  easy: { interval: 1300, noise: 6 },
  medium: { interval: 800, noise: 2 },
  hard: { interval: 420, noise: 0 },
}

// Pierre Dellacherie-style weights, simplified
const WEIGHTS = { height: -0.51, lines: 0.76, holes: -0.36, bump: -0.18, well: 0.05 }

const evaluate = (board, lines) => {
  const heights = []
  let holes = 0
  for (let x = 0; x < COLUMNS; x++) {
    let top = ROWS
    for (let y = 0; y < ROWS; y++) {
      if (board[y][x]) {
        top = y
        break
      }
    }
    heights.push(ROWS - top)
    for (let y = top + 1; y < ROWS; y++) if (!board[y][x]) holes++
  }
  let bump = 0
  for (let x = 0; x < COLUMNS - 1; x++) bump += Math.abs(heights[x] - heights[x + 1])
  const aggregate = heights.reduce((a, b) => a + b, 0)
  const max = Math.max(...heights)
  // keep the stack low when it gets tall
  const danger = max > 12 ? (max - 12) * -2 : 0
  return WEIGHTS.height * aggregate + WEIGHTS.lines * lines * 4 + WEIGHTS.holes * holes * 3 + WEIGHTS.bump * bump + danger
}

const landing = (board, piece) => {
  let p = piece
  while (fits(board, { ...p, y: p.y + 1 })) p = { ...p, y: p.y + 1 }
  return p
}

// Every place the piece can drop straight down into, with its score
export const placements = (board, type, startY = 0) => {
  const results = []
  const rotations = type === "O" ? [0] : [0, 1, 2, 3]
  for (const rotation of rotations) {
    for (let x = -2; x < COLUMNS; x++) {
      const start = { type, rotation, x, y: startY }
      if (!fits(board, start)) continue
      const piece = landing(board, start)
      const placed = board.map((row) => [...row])
      for (const [cx, cy] of cellsOf(piece)) placed[cy][cx] = type
      const kept = placed.filter((row) => row.some((c) => !c) || row.every((c) => c === "#"))
      const lines = ROWS - kept.length
      const after = [...Array.from({ length: lines }, () => Array(COLUMNS).fill(null)), ...kept]
      results.push({ rotation, x, score: evaluate(after, lines), lines })
    }
  }
  return results
}

const best = (list, noise, random) => {
  let top = null
  for (const p of list) {
    const score = p.score + (noise ? (random() - 0.5) * noise : 0)
    if (!top || score > top.score) top = { ...p, score }
  }
  return top
}

// Place one piece (maybe holding first). Returns the new state.
export const botMove = (state, level = "medium", random = Math.random) => {
  if (state.status !== "playing" || !state.active) return state
  const { noise } = BOT_LEVELS[level] || BOT_LEVELS.medium
  const startY = Math.max(0, state.active.y - 1)
  const here = best(placements(state.board, state.active.type, startY), noise, random)
  let next = state
  let pick = here
  const other = state.hold || state.queue[0]
  if (!state.holdUsed && other && other !== state.active.type) {
    const there = best(placements(state.board, other, startY), noise, random)
    if (there && (!here || there.score > here.score + 0.5)) {
      next = hold(state)
      if (next.status !== "playing") return next
      pick = best(placements(next.board, next.active.type, Math.max(0, next.active.y - 1)), noise, random)
    }
  }
  if (!pick) return hardDrop(next) // nowhere sensible: just drop it
  const piece = { ...next.active, rotation: pick.rotation, x: pick.x, y: Math.max(0, next.active.y - 1) }
  if (!fits(next.board, piece)) return hardDrop(next)
  return hardDrop({ ...next, active: piece, lastAction: "move" })
}
