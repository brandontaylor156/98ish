const test = require("node:test")
const assert = require("node:assert/strict")
const ck = require("../checkers")

const sq = (row, col) => row * 8 + col
const empty = () => Array(64).fill(null)
const paths = (state) => ck.legalMoves(state).map((m) => m.path.join("-")).sort()

test("starting position: 12 pieces each, black moves first with 7 moves", () => {
  const g = ck.newGame()
  assert.deepEqual(ck.countPieces(g.board), { b: 12, r: 12 })
  assert.equal(g.turn, "b")
  assert.equal(ck.legalMoves(g).length, 7)
  assert.ok(g.board.every((p, i) => !p || ck.isDark(i)))
})

test("men move diagonally forward only", () => {
  const board = empty()
  board[sq(3, 2)] = "b"
  board[sq(6, 1)] = "r"
  const g = ck.newGame(board, "b")
  assert.deepEqual(paths(g), [`${sq(3, 2)}-${sq(4, 1)}`, `${sq(3, 2)}-${sq(4, 3)}`].sort())
  const bad = ck.applyMove(g, [sq(3, 2), sq(2, 1)])
  assert.equal(bad.ok, false)
})

test("captures are forced", () => {
  const board = empty()
  board[sq(2, 1)] = "b"
  board[sq(2, 5)] = "b"
  board[sq(3, 2)] = "r"
  board[sq(7, 0)] = "r"
  const g = ck.newGame(board, "b")
  assert.deepEqual(paths(g), [`${sq(2, 1)}-${sq(4, 3)}`])
  const plain = ck.applyMove(g, [sq(2, 5), sq(3, 6)])
  assert.equal(plain.ok, false)
  assert.match(plain.error, /must take a jump/)
  const jump = ck.applyMove(g, [sq(2, 1), sq(4, 3)])
  assert.ok(jump.ok)
  assert.equal(jump.state.board[sq(3, 2)], null)
  assert.equal(jump.state.turn, "r")
})

test("multi-jumps must be completed and can branch", () => {
  const board = empty()
  board[sq(0, 1)] = "b"
  board[sq(1, 2)] = "r"
  board[sq(3, 4)] = "r"
  board[sq(3, 2)] = "r"
  board[sq(7, 6)] = "r"
  const g = ck.newGame(board, "b")
  // 0,1 x 1,2 -> 2,3 then either x 3,4 -> 4,5 or x 3,2 -> 4,1
  assert.deepEqual(paths(g), [`${sq(0, 1)}-${sq(2, 3)}-${sq(4, 5)}`, `${sq(0, 1)}-${sq(2, 3)}-${sq(4, 1)}`].sort())
  assert.equal(ck.applyMove(g, [sq(0, 1), sq(2, 3)]).ok, false) // stopping halfway
  const done = ck.applyMove(g, [sq(0, 1), sq(2, 3), sq(4, 5)])
  assert.ok(done.ok)
  assert.deepEqual(ck.countPieces(done.state.board), { b: 1, r: 2 })
  assert.deepEqual(done.state.last.captures, [sq(1, 2), sq(3, 4)])
})

test("a man reaching the far row is crowned and his move ends", () => {
  const board = empty()
  board[sq(5, 0)] = "b"
  board[sq(6, 1)] = "r"
  // after landing on 7,2 a king could jump 6,3 back, but a newly crowned man stops
  board[sq(6, 3)] = "r"
  board[sq(0, 7)] = "r"
  const g = ck.newGame(board, "b")
  assert.deepEqual(paths(g), [`${sq(5, 0)}-${sq(7, 2)}`])
  const r = ck.applyMove(g, [sq(5, 0), sq(7, 2)])
  assert.ok(r.ok)
  assert.equal(r.state.board[sq(7, 2)], "B")
  assert.ok(r.state.last.crowned)
  assert.equal(r.state.turn, "r")
})

test("kings move and capture backwards", () => {
  const board = empty()
  board[sq(4, 3)] = "R"
  board[sq(5, 4)] = "b"
  board[sq(0, 1)] = "b"
  const g = ck.newGame(board, "r")
  assert.deepEqual(paths(g), [`${sq(4, 3)}-${sq(6, 5)}`])
  const r = ck.applyMove(g, [sq(4, 3), sq(6, 5)])
  assert.ok(r.ok)
})

test("a piece can't be jumped twice in one move", () => {
  const board = empty()
  // A king circling around a single red piece
  board[sq(2, 1)] = "B"
  board[sq(3, 2)] = "r"
  board[sq(7, 6)] = "r"
  const g = ck.newGame(board, "b")
  const moves = ck.legalMoves(g)
  assert.equal(moves.length, 1)
  assert.equal(moves[0].captures.length, 1)
})

test("taking the last piece wins; being blocked loses", () => {
  const board = empty()
  board[sq(2, 1)] = "b"
  board[sq(3, 2)] = "r"
  const won = ck.applyMove(ck.newGame(board, "b"), [sq(2, 1), sq(4, 3)])
  assert.equal(won.state.winner, "b")
  assert.equal(won.state.reason, "captured")

  const blocked = empty()
  blocked[sq(7, 0)] = "r" // red man in the corner, blocked by two black pieces
  blocked[sq(6, 1)] = "b"
  blocked[sq(5, 2)] = "b"
  blocked[sq(0, 7)] = "b"
  const g = ck.newGame(blocked, "b")
  const r = ck.applyMove(g, [sq(0, 7), sq(1, 6)])
  assert.ok(r.ok)
  assert.equal(r.state.winner, "b")
  assert.equal(r.state.reason, "blocked")
})

test("40 moves each without captures or man moves is a draw", () => {
  const board = empty()
  board[sq(0, 1)] = "B"
  board[sq(7, 6)] = "R"
  let g = ck.newGame(board, "b")
  let ply = 0
  const shuttle = { b: [sq(0, 1), sq(1, 0)], r: [sq(7, 6), sq(6, 7)] }
  while (!g.winner && ply < 200) {
    const [a, b] = shuttle[g.turn]
    const from = g.board[a] ? a : b
    const r = ck.applyMove(g, [from, from === a ? b : a])
    assert.ok(r.ok)
    g = r.state
    ply++
  }
  assert.equal(g.winner, "draw")
  assert.equal(ply, ck.QUIET_LIMIT)
})

test("rejects junk input", () => {
  const g = ck.newGame()
  for (const junk of [null, "12-16", [1], [1.5, 2], [-1, 3], Array(20).fill(1)]) assert.equal(ck.applyMove(g, junk).ok, false)
})
