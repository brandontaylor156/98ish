// American checkers (English draughts) on an 8x8 board. Pure functions on a plain state
// object; the server is the only one that applies moves.
//
// Squares are 0..63 (row * 8 + col), row 0 at the top. Pieces stand on dark squares
// ((row + col) odd). Black starts on rows 0-2 and moves down; red starts on rows 5-7 and
// moves up. Black moves first. Pieces: "b" "r" men, "B" "R" kings, null empty.
//
// Rules: captures are compulsory (any capture, not necessarily the longest), a capturing
// piece must keep jumping while it can, men move and capture forward only, a man reaching
// the far row is crowned and his move ends there. You lose with no pieces or no moves.
// 40 moves each without a capture or a man moving is a draw.

const SIZE = 8
const QUIET_LIMIT = 80 // plies

const rowOf = (i) => Math.floor(i / SIZE)
const colOf = (i) => i % SIZE
const at = (r, c) => (r >= 0 && r < SIZE && c >= 0 && c < SIZE ? r * SIZE + c : -1)
const isDark = (i) => (rowOf(i) + colOf(i)) % 2 === 1

const colorOf = (piece) => (piece ? piece.toLowerCase() : null)
const isKing = (piece) => piece === "B" || piece === "R"
const other = (color) => (color === "b" ? "r" : "b")

// Directions a piece may move or capture in
const dirsFor = (piece) => {
  if (isKing(piece)) return [[-1, -1], [-1, 1], [1, -1], [1, 1]]
  return colorOf(piece) === "b" ? [[1, -1], [1, 1]] : [[-1, -1], [-1, 1]]
}

const crownRow = (color) => (color === "b" ? SIZE - 1 : 0)

const initialBoard = () => {
  const board = Array(SIZE * SIZE).fill(null)
  for (let i = 0; i < board.length; i++) {
    if (!isDark(i)) continue
    if (rowOf(i) < 3) board[i] = "b"
    else if (rowOf(i) > 4) board[i] = "r"
  }
  return board
}

const newGame = (board = initialBoard(), turn = "b") => ({
  board,
  turn,
  quiet: 0, // plies since the last capture or man move
  moves: 0,
  last: null, // the last move made: { path, captures }
  winner: null, // "b" | "r" | "draw"
  reason: null,
})

// Every capture sequence starting at `from` (complete: they stop only when no further
// jump is possible or the man was crowned). A captured piece stays on the board until
// the move ends, but can't be jumped twice.
const jumpsFrom = (board, from) => {
  const piece = board[from]
  const color = colorOf(piece)
  const results = []
  const walk = (square, path, captured) => {
    let extended = false
    // A man crowned mid-sequence stops there (his move ends on the king row)
    const crowned = !isKing(piece) && rowOf(square) === crownRow(color) && path.length > 1
    if (!crowned) {
      for (const [dr, dc] of dirsFor(piece)) {
        const over = at(rowOf(square) + dr, colOf(square) + dc)
        const land = at(rowOf(square) + 2 * dr, colOf(square) + 2 * dc)
        if (over < 0 || land < 0) continue
        if (colorOf(board[over]) !== other(color) || captured.includes(over)) continue
        if (board[land] && land !== from) continue
        extended = true
        walk(land, [...path, land], [...captured, over])
      }
    }
    if (!extended && captured.length) results.push({ path, captures: captured })
  }
  walk(from, [from], [])
  return results
}

const stepsFrom = (board, from) => {
  const out = []
  for (const [dr, dc] of dirsFor(board[from])) {
    const to = at(rowOf(from) + dr, colOf(from) + dc)
    if (to >= 0 && !board[to]) out.push({ path: [from, to], captures: [] })
  }
  return out
}

// All legal moves for the side to move (captures only, if any capture exists)
const legalMoves = (state, color = state.turn) => {
  if (state.winner) return []
  const own = []
  for (let i = 0; i < state.board.length; i++) if (colorOf(state.board[i]) === color) own.push(i)
  const jumps = own.flatMap((i) => jumpsFrom(state.board, i))
  if (jumps.length) return jumps
  return own.flatMap((i) => stepsFrom(state.board, i))
}

const samePath = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])

// Apply a move given as a path of squares. Returns { ok, state, error }.
const applyMove = (state, path) => {
  if (state.winner) return { ok: false, error: "The game is over." }
  if (!Array.isArray(path) || path.length < 2 || path.length > 13 || !path.every((n) => Number.isInteger(n) && n >= 0 && n < 64)) {
    return { ok: false, error: "That isn't a move." }
  }
  const moves = legalMoves(state)
  const move = moves.find((m) => samePath(m.path, path))
  if (!move) {
    const mustJump = moves.length && moves[0].captures.length
    return { ok: false, error: mustJump ? "You must take a jump." : "That move isn't allowed." }
  }

  const board = state.board.slice()
  const from = path[0]
  const to = path.at(-1)
  let piece = board[from]
  const wasMan = !isKing(piece)
  board[from] = null
  for (const c of move.captures) board[c] = null
  if (wasMan && rowOf(to) === crownRow(colorOf(piece))) piece = piece.toUpperCase()
  board[to] = piece

  const quiet = move.captures.length || wasMan ? 0 : state.quiet + 1
  const next = {
    ...state,
    board,
    turn: other(state.turn),
    quiet,
    moves: state.moves + 1,
    last: { path: move.path, captures: move.captures, crowned: wasMan && isKing(piece) },
  }
  if (legalMoves(next).length === 0) {
    const anyLeft = board.some((p) => colorOf(p) === next.turn)
    next.winner = state.turn
    next.reason = anyLeft ? "blocked" : "captured"
  } else if (quiet >= QUIET_LIMIT) {
    next.winner = "draw"
    next.reason = "quiet"
  }
  return { ok: true, state: next }
}

const countPieces = (board) => ({
  b: board.filter((p) => colorOf(p) === "b").length,
  r: board.filter((p) => colorOf(p) === "r").length,
})

module.exports = { SIZE, initialBoard, newGame, legalMoves, applyMove, countPieces, isDark, colorOf, isKing, other, QUIET_LIMIT }
