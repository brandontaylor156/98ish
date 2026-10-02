// Reversi rules (shared with the browser): flips, legal moves, passing, the end
import test from "node:test"
import assert from "node:assert/strict"
import * as reversi from "../../../client/src/components/applets/network/rules/reversi.js"

// Build a board from 8 strings of "." "b" "w"
const board = (rows) => rows.join("").split("").map((ch) => (ch === "." ? null : ch))

test("the opening: four legal moves for black, and a move flips", () => {
  const g = reversi.newGame()
  assert.equal(g.turn, "b")
  assert.deepEqual(reversi.legalMoves(g.board, "b").sort((a, b) => a - b), [19, 26, 37, 44])
  const r = reversi.applyMove(g, 19)
  assert.ok(r.ok)
  assert.deepEqual(r.state.last.flips, [27])
  assert.deepEqual(reversi.countDiscs(r.state.board), { b: 4, w: 1 })
  assert.equal(r.state.turn, "w")
  assert.equal(reversi.applyMove(r.state, 0).ok, false) // flips nothing
  assert.equal(reversi.applyMove(r.state, 19).ok, false) // taken
})

test("flips in several directions at once", () => {
  const g = reversi.newGame(
    board([
      "........",
      ".b.b.b..",
      "..www...",
      ".bw.wb..",
      "..www...",
      ".b.b.b..",
      "........",
      "........",
    ]),
    "b"
  )
  const r = reversi.applyMove(g, 3 * 8 + 3)
  assert.equal(r.state.last.flips.length, 8)
  assert.equal(reversi.countDiscs(r.state.board).w, 0)
})

test("a side with no moves passes, and the move comes back", () => {
  // white's discs sit against the edge behind black ones: white can't flank anything
  const rows = ["......wb", "........", "........", "........", "........", "........", "........", "......wb"]
  const g = reversi.newGame(board(rows), "w")
  assert.equal(g.passed, "w")
  assert.equal(g.turn, "b")
  assert.equal(g.result, null)
  assert.deepEqual(reversi.legalMoves(g.board, "b"), [5, 61])
  // black plays, white still can't move: black goes again
  const r = reversi.applyMove(g, 5)
  assert.equal(r.state.passed, "w")
  assert.equal(r.state.turn, "b")
  // black's last move takes white's last disc: nobody can move, black wins
  const end = reversi.applyMove(r.state, 61).state
  assert.deepEqual(end.result, { winner: "b", reason: "stuck", counts: { b: 6, w: 0 } })
  assert.equal(reversi.applyMove(end, 0).ok, false)
})

test("the game ends when neither side can move, most discs wins", () => {
  const full = reversi.newGame(
    board([
      "bbbbbbbb",
      "bbbbbbbb",
      "bbbbbbbb",
      "bbbbbbbb",
      "wwwwwwww",
      "wwwwwwww",
      "wwwwwwww",
      "wwwwwww.",
    ]),
    "b"
  )
  // black plays the last square
  const r = reversi.applyMove(full, 63)
  assert.ok(r.state.result)
  assert.equal(r.state.result.reason, "full")
  assert.equal(r.state.result.winner, "b")
  // stuck before the board is full: no one can move
  const stuck = reversi.newGame(board(["b.......", "........", "........", "........", "........", "........", "........", ".......w"]), "b")
  assert.deepEqual(stuck.result, { winner: null, reason: "stuck", counts: { b: 1, w: 1 } })
  const wipe = reversi.newGame(board(["bbb.....", "........", "........", "........", "........", "........", "........", "........"]), "w")
  assert.equal(wipe.result.winner, "b")
})

test("the computer prefers corners and finishes whole games", () => {
  const g = reversi.newGame(
    board([
      "........",
      ".w......",
      "..b.....",
      "........",
      "........",
      "........",
      "........",
      "........",
    ]),
    "b"
  )
  // a1 would flip b2: a corner is the clear best
  assert.equal(reversi.bestMove(g), 0)
  for (let n = 0; n < 20; n++) {
    let game = reversi.newGame()
    let guard = 0
    while (!game.result && guard++ < 100) {
      const move = game.turn === "b" ? reversi.bestMove(game) : reversi.legalMoves(game.board, "w")[0]
      game = reversi.applyMove(game, move).state
    }
    assert.ok(game.result, "every game ends")
    const c = reversi.countDiscs(game.board)
    assert.equal(game.result.winner, c.b === c.w ? null : c.b > c.w ? "b" : "w")
  }
})
