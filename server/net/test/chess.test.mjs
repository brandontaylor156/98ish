// Chess rules (shared with the browser): move generation against known perft counts,
// special moves, notation, and how games end
import test from "node:test"
import assert from "node:assert/strict"
import * as chess from "../../../client/src/components/applets/network/rules/chess.js"
import { bestMove } from "../../../client/src/components/applets/network/rules/chessAI.js"

const sq = chess.squareIndex
const play = (game, ...moves) => {
  for (const san of moves) {
    const move = chess.legalMoves(game).find((m) => chess.toSAN(game, m).replace(/[+#]$/, "") === san.replace(/[+#]$/, ""))
    assert.ok(move, `${san} should be legal in ${chess.toFEN(game)}`)
    const r = chess.applyMove(game, { from: move.from, to: move.to, promotion: move.promotion?.toLowerCase() })
    assert.ok(r.ok, r.error)
    game = r.state
  }
  return game
}

test("perft from the start position", () => {
  const g = chess.newGame()
  assert.equal(chess.perft(g, 1), 20)
  assert.equal(chess.perft(g, 2), 400)
  assert.equal(chess.perft(g, 3), 8902)
})

test("perft on well-known tricky positions", () => {
  // "Kiwipete": castling both ways, en passant, promotions, pins
  const kiwipete = chess.fromFEN("r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1")
  assert.equal(chess.perft(kiwipete, 1), 48)
  assert.equal(chess.perft(kiwipete, 2), 2039)
  // en passant that would expose the king along a rank, and rook endings
  const p3 = chess.fromFEN("8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1")
  assert.equal(chess.perft(p3, 3), 2812)
  // promotions with capture, castling rights lost to captures
  const p4 = chess.fromFEN("r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1")
  assert.equal(chess.perft(p4, 2), 264)
  assert.equal(chess.perft(p4, 3), 9467)
  const p5 = chess.fromFEN("rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8")
  assert.equal(chess.perft(p5, 2), 1486)
})

test("FEN round trip", () => {
  for (const fen of [chess.START_FEN, "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1", "8/8/8/8/8/8/8/K6k b - - 12 40"]) {
    assert.equal(chess.toFEN(chess.fromFEN(fen)), fen)
  }
})

test("castling: both sides, and not through check or after the king moved", () => {
  let g = play(chess.newGame(), "e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5")
  g = play(g, "O-O")
  assert.equal(g.board[sq("g1")], "K")
  assert.equal(g.board[sq("f1")], "R")
  assert.equal(g.sans.at(-1), "O-O")
  assert.equal(g.castling.K || g.castling.Q, false)

  // queenside for black
  let q = chess.fromFEN("r3k3/8/8/8/8/8/8/4K3 b q - 0 1")
  q = play(q, "O-O-O")
  assert.equal(q.board[sq("c8")], "k")
  assert.equal(q.board[sq("d8")], "r")

  // through an attacked square: a rook on f-file stops kingside castling
  const through = chess.fromFEN("4k3/8/8/8/8/8/8/4K2R w K - 0 1")
  assert.ok(chess.legalMoves(through).some((m) => m.flag === "k"))
  const blocked = chess.fromFEN("4kr2/8/8/8/8/8/8/4K2R w K - 0 1")
  assert.ok(!chess.legalMoves(blocked).some((m) => m.flag === "k"))
  // out of check is not allowed
  const checked = chess.fromFEN("4k3/8/8/8/8/8/4r3/R3K2R w KQ - 0 1")
  assert.ok(!chess.legalMoves(checked).some((m) => m.flag === "k" || m.flag === "q"))
  // a rook that moved loses its side's right
  let moved = chess.fromFEN("4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1")
  moved = play(moved, "Rb1", "Kd8", "Ra1", "Ke8")
  assert.ok(!chess.legalMoves(moved).some((m) => m.flag === "q"))
  assert.ok(chess.legalMoves(moved).some((m) => m.flag === "k"))
})

test("en passant: only right after the double step, and it removes the pawn", () => {
  let g = play(chess.newGame(), "e4", "a6", "e5", "d5")
  assert.equal(g.ep, sq("d6"))
  const ep = chess.legalMoves(g).find((m) => m.flag === "e")
  assert.ok(ep)
  assert.equal(chess.toSAN(g, ep), "exd6")
  const after = chess.applyMove(g, { from: ep.from, to: ep.to }).state
  assert.equal(after.board[sq("d5")], null)
  assert.equal(after.board[sq("d6")], "P")
  // wait one move and the chance is gone
  let late = play(chess.newGame(), "e4", "a6", "e5", "d5", "h3", "h6")
  assert.ok(!chess.legalMoves(late).some((m) => m.flag === "e"))
})

test("promotion: choose the piece, queen by default, notation shows it", () => {
  const g = chess.fromFEN("8/P6k/8/8/8/8/8/K7 w - - 0 1")
  const choices = chess.legalMoves(g).filter((m) => m.from === sq("a7"))
  assert.deepEqual(choices.map((m) => m.promotion).sort(), ["B", "N", "Q", "R"])
  const knight = chess.applyMove(g, { from: sq("a7"), to: sq("a8"), promotion: "n" })
  assert.equal(knight.state.board[sq("a8")], "N")
  assert.equal(knight.san, "a8=N")
  const queen = chess.applyMove(g, { from: sq("a7"), to: sq("a8") })
  assert.equal(queen.state.board[sq("a8")], "Q")
  assert.equal(queen.san, "a8=Q")
  assert.equal(chess.applyMove(g, { from: sq("a7"), to: sq("a8"), promotion: "k" }).ok, false)
  // the view lists a promoting move once, flagged
  const view = chess.movesForView(g).filter((m) => m.from === sq("a7"))
  assert.deepEqual(view, [{ from: sq("a7"), to: sq("a8"), promotion: true }])
})

test("Scholar's mate is checkmate, written with #", () => {
  const g = play(chess.newGame(), "e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6", "Qxf7")
  assert.deepEqual(g.result, { winner: "w", reason: "checkmate" })
  assert.equal(g.sans.at(-1), "Qxf7#")
  assert.equal(chess.applyMove(g, { from: sq("e8"), to: sq("f7") }).ok, false)
})

test("stalemate, threefold repetition, the 50-move rule and dead positions are draws", () => {
  const stale = play(chess.fromFEN("7k/8/6Q1/8/8/8/8/K7 w - - 0 1"), "Qf7")
  assert.deepEqual(stale.result, { winner: null, reason: "stalemate" })

  let rep = chess.newGame()
  rep = play(rep, "Nf3", "Nf6", "Ng1", "Ng8", "Nf3", "Nf6", "Ng1")
  assert.equal(rep.result, null)
  rep = play(rep, "Ng8")
  assert.deepEqual(rep.result, { winner: null, reason: "repetition" })

  const fifty = play(chess.fromFEN("4k3/8/8/8/8/8/8/R3K3 w - - 99 80"), "Rb1")
  assert.deepEqual(fifty.result, { winner: null, reason: "fifty" })

  const bare = play(chess.fromFEN("4k3/8/8/8/8/8/3q4/4K3 w - - 0 1"), "Kxd2")
  assert.deepEqual(bare.result, { winner: null, reason: "material" })
})

test("disambiguation in notation", () => {
  const g = chess.fromFEN("4k3/8/8/8/8/8/8/R4RK1 w - - 0 1")
  const rd1 = chess.legalMoves(g).find((m) => m.from === sq("a1") && m.to === sq("d1"))
  assert.equal(chess.toSAN(g, rd1), "Rad1")
  const n = chess.fromFEN("4k3/8/8/N7/8/8/8/N3K3 w - - 0 1")
  const nb3 = chess.legalMoves(n).find((m) => m.from === sq("a1") && m.to === sq("b3"))
  assert.equal(chess.toSAN(n, nb3), "N1b3")
})

test("illegal moves are refused with a reason", () => {
  const g = chess.newGame()
  assert.equal(chess.applyMove(g, { from: sq("e7"), to: sq("e5") }).ok, false) // not your piece
  assert.equal(chess.applyMove(g, { from: sq("e2"), to: sq("e5") }).ok, false)
  assert.equal(chess.applyMove(g, { from: 99, to: 1 }).ok, false)
  const pinned = chess.fromFEN("4k3/4r3/8/8/8/8/4B3/4K3 w - - 0 1")
  assert.match(chess.applyMove(pinned, { from: sq("e2"), to: sq("d3") }).error, /check/)
})

test("the computer finds mate in one and takes a free queen", () => {
  const mate = chess.fromFEN("r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4")
  const m = bestMove(mate, { depth: 2 })
  assert.equal(chess.squareName(m.from) + chess.squareName(m.to), "h5f7")
  const free = chess.fromFEN("4k3/8/8/3q4/8/8/3R4/4K3 w - - 0 1")
  const t = bestMove(free, { depth: 2 })
  assert.equal(chess.squareName(t.to), "d5")
})
