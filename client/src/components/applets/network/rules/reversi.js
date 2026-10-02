// Reversi on an 8x8 board. Pure functions on plain objects, shared by the game server
// (network games) and the browser (games against the computer).
//
// Squares are 0..63 (row * 8 + col). "b" black, "w" white, null empty. Black moves first.
// A move must flip at least one disc. A side with no move passes; when neither side can
// move the game is over and the most discs wins.

export const SIZE = 8
export const other = (color) => (color === "b" ? "w" : "b")

const DIRS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]
const at = (r, c) => (r >= 0 && r < SIZE && c >= 0 && c < SIZE ? r * SIZE + c : -1)

export const initialBoard = () => {
  const board = Array(64).fill(null)
  board[27] = board[36] = "w"
  board[28] = board[35] = "b"
  return board
}

export const newGame = (board = initialBoard(), turn = "b") => {
  const game = { board, turn, moves: 0, last: null, passed: null, result: null }
  // a position where the side to move is already stuck
  return settle(game)
}

// The discs a move at `square` would flip (empty if it isn't a legal move)
export const flipsFor = (board, square, color) => {
  if (board[square]) return []
  const out = []
  const r0 = Math.floor(square / SIZE)
  const c0 = square % SIZE
  for (const [dr, dc] of DIRS) {
    const line = []
    let r = r0 + dr
    let c = c0 + dc
    let s = at(r, c)
    while (s >= 0 && board[s] === other(color)) {
      line.push(s)
      r += dr
      c += dc
      s = at(r, c)
    }
    if (line.length && s >= 0 && board[s] === color) out.push(...line)
  }
  return out
}

export const legalMoves = (board, color) => {
  const out = []
  for (let i = 0; i < 64; i++) if (!board[i] && flipsFor(board, i, color).length) out.push(i)
  return out
}

export const countDiscs = (board) => ({ b: board.filter((x) => x === "b").length, w: board.filter((x) => x === "w").length })

// After a move (or at the start): pass for a side that can't move, end the game when
// neither can
const settle = (game) => {
  if (legalMoves(game.board, game.turn).length) return game
  const them = other(game.turn)
  if (legalMoves(game.board, them).length) return { ...game, passed: game.turn, turn: them }
  const counts = countDiscs(game.board)
  const winner = counts.b === counts.w ? null : counts.b > counts.w ? "b" : "w"
  return { ...game, result: { winner, reason: game.board.every(Boolean) ? "full" : "stuck", counts } }
}

// Play a disc at `square` for the side to move. Returns { ok, state } or { ok: false, error }.
export const applyMove = (game, square) => {
  if (game.result) return { ok: false, error: "The game is over." }
  if (!Number.isInteger(square) || square < 0 || square > 63) return { ok: false, error: "That isn't a square." }
  if (game.board[square]) return { ok: false, error: "That square is taken." }
  const flips = flipsFor(game.board, square, game.turn)
  if (!flips.length) return { ok: false, error: "A move has to flip at least one disc." }
  const board = game.board.slice()
  board[square] = game.turn
  for (const s of flips) board[s] = game.turn
  const next = settle({ ...game, board, turn: other(game.turn), moves: game.moves + 1, last: { square, flips, by: game.turn }, passed: null })
  return { ok: true, state: next }
}

// ---------- the computer ----------

// Corners are gold, the squares next to them are poison (until the corner is taken)
const WEIGHTS = [
  100, -20, 10, 5, 5, 10, -20, 100,
  -20, -50, -2, -2, -2, -2, -50, -20,
  10, -2, 1, 1, 1, 1, -2, 10,
  5, -2, 1, 0, 0, 1, -2, 5,
  5, -2, 1, 0, 0, 1, -2, 5,
  10, -2, 1, 1, 1, 1, -2, 10,
  -20, -50, -2, -2, -2, -2, -50, -20,
  100, -20, 10, 5, 5, 10, -20, 100,
]
const CORNER_OF = { 1: 0, 8: 0, 9: 0, 6: 7, 15: 7, 14: 7, 48: 56, 57: 56, 49: 56, 55: 63, 62: 63, 54: 63 }

const weightOf = (board, square) => (CORNER_OF[square] !== undefined && board[CORNER_OF[square]] ? 5 : WEIGHTS[square])

const positional = (board, color) => {
  let score = 0
  for (let i = 0; i < 64; i++) if (board[i]) score += (board[i] === color ? 1 : -1) * weightOf(board, i)
  return score
}

// Greedy with positional weights: the move that leaves the best board, counting discs
// more as the board fills, and giving the opponent few replies
export const bestMove = (game, { random = Math.random } = {}) => {
  const color = game.turn
  const moves = legalMoves(game.board, color)
  if (!moves.length) return null
  const filled = game.board.filter(Boolean).length
  let best = []
  let bestScore = -Infinity
  for (const square of moves) {
    const { state } = applyMove(game, square)
    const counts = countDiscs(state.board)
    let score = positional(state.board, color) + (filled > 48 ? 3 : 0.5) * (counts[color] - counts[other(color)])
    if (state.result) score = state.result.winner === color ? 10000 : state.result.winner ? -10000 : 0
    else if (state.turn === color) score += 30 // they had to pass
    else score -= 3 * legalMoves(state.board, state.turn).length
    if (score > bestScore + 0.001) {
      bestScore = score
      best = [square]
    } else if (Math.abs(score - bestScore) <= 0.001) best.push(square)
  }
  return best[Math.floor(random() * best.length)]
}
