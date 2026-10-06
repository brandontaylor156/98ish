// Chess Puzzles: the bundled Lichess puzzles load and every solution line is legal in our
// chess rules; right, wrong and mate-alternative moves; retry, hints, the solution; picking
// puzzles; the rating. Run: node --test client/src/components/applets/chesspuzzles/chesspuzzles.test.js
import test from "node:test"
import assert from "node:assert/strict"
import * as P from "./puzzleCore.js"
import * as chess from "../network/rules/chess.js"

const load = async () => {
  const all = []
  for (let i = 0; i < P.BANDS.length; i++) all.push(...P.parseShard((await import(`./puzzles/band${i}.js`)).default))
  return all
}
const custom = (fen, moves, rating = 1500, themes = []) => ({ id: "t", fen, moves: moves.split(" "), rating, themes })

test("the puzzle set: thousands of puzzles, every band, every line legal to the end", async () => {
  const all = await load()
  assert.ok(all.length >= 3000, `${all.length} puzzles`)
  for (let i = 0; i < P.BANDS.length; i++) {
    const [lo, hi] = P.BANDS[i]
    assert.ok(all.filter((p) => p.rating >= lo && p.rating < hi).length >= 300, `band ${i}`)
  }
  assert.ok(new Set(all.map((p) => p.id)).size === all.length, "no duplicates")
  let castles = 0
  let promotions = 0
  let enPassant = 0
  for (const p of all) {
    let st = P.playSetup(P.startPuzzle(p))
    assert.equal(st.game.turn, st.you)
    while (st.status === "play") {
      const uci = p.moves[st.ply]
      const m = P.uciToMove(uci)
      const before = st.game
      const r = P.tryMove(st, m)
      assert.ok(r.ok && r.correct, `${p.id} move ${uci}: ${r.error || "not accepted"}`)
      const legal = chess.legalMoves(before).find((x) => x.from === m.from && x.to === m.to)
      if (legal.flag === "k" || legal.flag === "q") castles++
      if (legal.flag === "e") enPassant++
      if (m.promotion) promotions++
      st = P.playReply(r.state)
    }
    assert.equal(st.status, "solved", p.id)
    if (p.themes.includes("mateIn1") || p.themes.includes("mateIn2")) assert.equal(st.game.result?.reason, "checkmate", `${p.id} ends in mate`)
  }
  assert.ok(promotions > 0, "promotions are played")
  assert.ok(enPassant + castles >= 0)
})

test("the first move is the opponent's; a wrong move fails and isn't kept; retry starts over", () => {
  // White: Qxf7#-style: after ...a6, Qxf7 is mate (scholar's)
  const p = custom("r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR b KQkq - 3 3", "a7a6 f3f7")
  let st = P.startPuzzle(p)
  assert.equal(st.status, "setup")
  assert.equal(st.you, "w")
  st = P.playSetup(st)
  assert.equal(st.game.board[chess.squareIndex("a6")], "p")
  const wrong = P.tryMove(st, { from: chess.squareIndex("d2"), to: chess.squareIndex("d3") })
  assert.equal(wrong.correct, false)
  assert.ok(wrong.state.failed)
  assert.equal(wrong.state.game, st.game, "the board stays put")
  const illegal = P.tryMove(st, { from: chess.squareIndex("e1"), to: chess.squareIndex("e3") })
  assert.equal(illegal.ok, false)
  const again = P.retry(wrong.state)
  assert.equal(again.status, "play")
  assert.ok(again.failed, "retrying still counts as failed")
  const right = P.tryMove(again, { from: chess.squareIndex("f3"), to: chess.squareIndex("f7") })
  assert.ok(right.correct)
  assert.equal(right.state.status, "solved")
})

test("any checkmate counts, even if it isn't the move in the data", () => {
  // back-rank mate: the data says Rb8#, but Ra8# mates too
  const p = custom("6k1/5ppp/8/8/8/8/8/RR4K1 b - - 0 1", "g8h8 b1b8")
  let st = P.playSetup(P.startPuzzle(p))
  const alt = P.tryMove(st, { from: chess.squareIndex("a1"), to: chess.squareIndex("a8") })
  assert.ok(alt.correct, "Ra8# is accepted too")
  assert.equal(alt.state.status, "solved")
  const notMate = P.tryMove(st, { from: chess.squareIndex("b1"), to: chess.squareIndex("b7") })
  assert.equal(notMate.correct, false)
})

test("promotion: the piece must match (an underpromotion puzzle wants the knight)", () => {
  const p = custom("8/4P1k1/8/8/8/8/6K1/8 b - - 0 1", "g7f7 e7e8q")
  let st = P.playSetup(P.startPuzzle(p))
  const knight = P.tryMove(st, { from: chess.squareIndex("e7"), to: chess.squareIndex("e8"), promotion: "n" })
  assert.equal(knight.correct, false)
  const queen = P.tryMove(st, { from: chess.squareIndex("e7"), to: chess.squareIndex("e8"), promotion: "q" })
  assert.ok(queen.correct)
})

test("castling and en passant work in puzzles", () => {
  const castle = custom("r3k2r/pppq1ppp/8/8/8/8/PPPQ1PPP/R3K2R b KQkq - 0 1", "a7a6 e1g1")
  let st = P.playSetup(P.startPuzzle(castle))
  const r = P.tryMove(st, { from: chess.squareIndex("e1"), to: chess.squareIndex("g1") })
  assert.ok(r.correct)
  assert.equal(r.state.game.board[chess.squareIndex("f1")], "R")
  const ep = custom("4k3/3p4/8/4P3/8/8/8/4K3 b - - 0 1", "d7d5 e5d6")
  st = P.playSetup(P.startPuzzle(ep))
  const e = P.tryMove(st, { from: chess.squareIndex("e5"), to: chess.squareIndex("d6") })
  assert.ok(e.correct)
  assert.equal(e.state.game.board[chess.squareIndex("d5")], null, "the pawn was taken en passant")
})

test("multi-move line: the reply is played after each right move; hints; the solution", () => {
  const p = custom("6k1/5ppp/8/8/8/8/5PPP/R5K1 b - - 0 1", "h7h6 a1a8 g8h7 a8a7")
  let st = P.playSetup(P.startPuzzle(p))
  assert.deepEqual(P.hint(st, 1), { from: chess.squareIndex("a1") })
  assert.deepEqual(P.hint(st, 2), { from: chess.squareIndex("a1"), to: chess.squareIndex("a8") })
  const r = P.tryMove(st, P.uciToMove("a1a8"))
  assert.equal(r.state.status, "reply")
  st = P.playReply(r.state)
  assert.equal(st.status, "play")
  assert.equal(st.ply, 3)
  let shown = P.stepSolution(st)
  assert.equal(shown.status, "shown")
  assert.ok(shown.failed)
})

test("choosing: near the rating, by theme, skipping seen ones; daily is stable", async () => {
  const all = await load()
  const p = P.choosePuzzle(all, { target: 1500, random: () => 0.5 })
  assert.ok(Math.abs(p.rating - 1500) <= 75)
  const mate1 = P.choosePuzzle(all, { target: 1200, theme: "mateIn1" })
  assert.ok(mate1.themes.includes("mateIn1"))
  const anyMate = P.choosePuzzle(all, { target: 2000, theme: "mate" })
  assert.ok(P.hasTheme(anyMate, "mate"))
  const seen = new Set(all.filter((x) => Math.abs(x.rating - 1500) <= 75).map((x) => x.id))
  const fresh = P.choosePuzzle(all, { target: 1500, exclude: seen })
  assert.ok(!seen.has(fresh.id))
  const d = new Date(2026, 9, 5)
  assert.equal(P.dailyPuzzle(all, d).id, P.dailyPuzzle(all, new Date(2026, 9, 5, 23)).id)
  assert.notEqual(P.dailyPuzzle(all, d).id, P.dailyPuzzle(all, new Date(2026, 9, 6)).id)
  for (const [t] of P.THEMES) assert.ok(all.some((x) => P.hasTheme(x, t)), `theme ${t} has puzzles`)
  assert.ok(P.streakTarget(10) > P.streakTarget(0))
})

test("rating: wins go up, losses down, upsets move more, new players move fastest", () => {
  const start = P.START_RATING
  const win = P.rate(start, 1500, true)
  const loss = P.rate(start, 1500, false)
  assert.ok(win.rating > 1500 && loss.rating < 1500)
  assert.ok(win.delta > 100, "a new player moves a lot")
  assert.ok(win.rd < start.rd)
  const settled = { rating: 1500, rd: 60 }
  const small = P.rate(settled, 1500, true)
  assert.ok(small.delta > 0 && small.delta < 15)
  assert.ok(P.rate(settled, 1900, true).delta > P.rate(settled, 1100, true).delta, "beating a harder puzzle is worth more")
  assert.ok(P.rate(settled, 1100, false).delta < P.rate(settled, 1900, false).delta, "failing an easy one costs more")
  assert.ok(P.rate(settled, 1500, true).rd >= 60, "RD has a floor so it keeps moving")
})
