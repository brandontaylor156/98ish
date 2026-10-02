// The computer's chess player: a small alpha-beta search (2-3 moves deep, plus captures
// until things are quiet) with an evaluation of material, piece placement and mobility.
// Runs in a Web Worker in the browser (chessWorker.js) so the board stays responsive.

import { colorOf, inCheck, legalMoves, make, pseudoMoves } from "./chess.js"

const VALUE = { p: 100, n: 310, b: 330, r: 500, q: 900, k: 0 }
const MATE = 100000

// Bonuses by square for white (row 0 = rank 8); black reads them mirrored
const PST = {
  p: [
    0, 0, 0, 0, 0, 0, 0, 0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
    5, 5, 10, 25, 25, 10, 5, 5,
    0, 0, 0, 20, 20, 0, 0, 0,
    5, -5, -10, 0, 0, -10, -5, 5,
    5, 10, 10, -20, -20, 10, 10, 5,
    0, 0, 0, 0, 0, 0, 0, 0,
  ],
  n: [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20, 0, 0, 0, 0, -20, -40,
    -30, 0, 10, 15, 15, 10, 0, -30,
    -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30,
    -30, 5, 10, 15, 15, 10, 5, -30,
    -40, -20, 0, 5, 5, 0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50,
  ],
  b: [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 10, 10, 5, 0, -10,
    -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 10, 10, 10, 10, 0, -10,
    -10, 10, 10, 10, 10, 10, 10, -10,
    -10, 5, 0, 0, 0, 0, 5, -10,
    -20, -10, -10, -10, -10, -10, -10, -20,
  ],
  r: [
    0, 0, 0, 0, 0, 0, 0, 0,
    5, 10, 10, 10, 10, 10, 10, 5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    0, 0, 0, 5, 5, 0, 0, 0,
  ],
  q: [
    -20, -10, -10, -5, -5, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 5, 5, 5, 0, -10,
    -5, 0, 5, 5, 5, 5, 0, -5,
    0, 0, 5, 5, 5, 5, 0, -5,
    -10, 5, 5, 5, 5, 5, 0, -10,
    -10, 0, 5, 0, 0, 0, 0, -10,
    -20, -10, -10, -5, -5, -10, -10, -20,
  ],
  k: [
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -10, -20, -20, -20, -20, -20, -20, -10,
    20, 20, 0, 0, 0, 0, 20, 20,
    20, 30, 10, 0, 0, 10, 30, 20,
  ],
}

// Score from white's point of view
export const evaluate = (pos) => {
  let score = 0
  for (let i = 0; i < 64; i++) {
    const p = pos.board[i]
    if (!p) continue
    const t = p.toLowerCase()
    const white = p !== t
    const value = VALUE[t] + PST[t][white ? i : (7 - (i >> 3)) * 8 + (i & 7)]
    score += white ? value : -value
  }
  // mobility: a few points per available move
  const mobility = pseudoMoves(pos, "w").length - pseudoMoves(pos, "b").length
  return score + 4 * mobility
}

const sideScore = (pos) => (pos.turn === "w" ? evaluate(pos) : -evaluate(pos))

// Captures first, the biggest victims with the smallest attackers first
const order = (moves) =>
  moves
    .map((m) => ({ m, k: (m.captured ? 10 * VALUE[m.captured.toLowerCase()] - VALUE[m.piece.toLowerCase()] + 1000 : 0) + (m.promotion ? 800 : 0) }))
    .sort((a, b) => b.k - a.k)
    .map((x) => x.m)

const quiesce = (pos, alpha, beta, depth, stats) => {
  stats.nodes++
  const stand = sideScore(pos)
  if (stand >= beta) return beta
  if (stand > alpha) alpha = stand
  if (depth <= 0) return alpha
  const captures = order(pseudoMoves(pos).filter((m) => m.captured || m.promotion))
  for (const m of captures) {
    const next = make(pos, m)
    if (inCheck(next, pos.turn)) continue
    const score = -quiesce(next, -beta, -alpha, depth - 1, stats)
    if (score >= beta) return beta
    if (score > alpha) alpha = score
  }
  return alpha
}

const search = (pos, depth, alpha, beta, ply, stats) => {
  stats.nodes++
  if (depth === 0) return quiesce(pos, alpha, beta, 4, stats)
  const moves = legalMoves(pos)
  if (!moves.length) return inCheck(pos) ? -MATE + ply : 0
  if (pos.half >= 100) return 0
  for (const m of order(moves)) {
    const score = -search(make(pos, m), depth - 1, -beta, -alpha, ply + 1, stats)
    if (score >= beta) return beta
    if (score > alpha) alpha = score
  }
  return alpha
}

// The computer's move: { from, to, promotion } (null if it has none). `random` breaks ties
// between equally good moves so games differ.
export const bestMove = (game, { depth = 3, random = Math.random } = {}) => {
  const moves = order(legalMoves(game))
  if (!moves.length) return null
  const stats = { nodes: 0 }
  // avoid walking into a draw by repetition when ahead
  const repeats = (next) => game.keys && game.keys.filter((k) => k.startsWith(next.board.map((p) => p || ".").join("") + next.turn)).length >= 2
  let best = []
  let bestScore = -Infinity
  for (const m of moves) {
    const next = make(game, m)
    let score = -search(next, depth - 1, -MATE - 1, -bestScore + 1, 1, stats)
    if (repeats(next)) score = Math.min(score, 0)
    if (m.promotion && m.promotion.toLowerCase() === "q") score += 1 // a queen, when any piece would do
    if (score > bestScore) {
      bestScore = score
      best = [m]
    } else if (score === bestScore) best.push(m)
  }
  const pick = best[Math.floor(random() * best.length)]
  return { from: pick.from, to: pick.to, promotion: pick.promotion ? pick.promotion.toLowerCase() : undefined, score: bestScore, nodes: stats.nodes, color: colorOf(pick.piece) }
}
