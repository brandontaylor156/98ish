// The computer's chess thinking, off the main thread: { id, game, depth } in, { id, move } out
import { bestMove } from "./chessAI.js"

self.onmessage = ({ data }) => {
  const { id, game, depth } = data
  let move = null
  try {
    move = bestMove(game, { depth })
  } catch {
    move = null
  }
  self.postMessage({ id, move: move && { from: move.from, to: move.to, promotion: move.promotion } })
}
