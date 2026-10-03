// Checkers on the online room system (server/arcade/rooms.js): Quick Match, private rooms,
// computer players. The rules are the same ones network matches use (server/net/checkers.js).
// A worked example of a turn-based rules module: seats 0 and 1, a random color each game,
// draw offers and resigning as actions, and a computer player that looks one move ahead.

const checkers = require("../../net/checkers")

const colorOfSeat = (state, seat) => (seat === null || seat === undefined ? null : state.colors[seat])
const seatOfColor = (state, color) => state.colors.indexOf(color)

module.exports = {
  id: "checkers",
  name: "Checkers",
  minPlayers: 2,
  maxPlayers: 2,
  defaultSettings: {},
  validateSettings: () => ({}),

  create: ({ random }) => ({
    colors: random() < 0.5 ? ["b", "r"] : ["r", "b"], // seat -> color; black moves first
    game: checkers.newGame(),
    drawOffer: null, // the seat offering a draw
    resigned: null, // the seat that resigned
    agreed: false, // a draw by agreement
  }),

  // { type: "move", path } | { type: "resign" } | { type: "draw", answer: "offer" | "accept" | "decline" }
  action: (state, seat, action) => {
    if (seat === null) return { error: "Nothing to do." }
    const color = colorOfSeat(state, seat)
    if (action.type === "move") {
      if (state.game.turn !== color) return { error: "It isn't your turn." }
      const result = checkers.applyMove(state.game, action.path)
      if (!result.ok) return { error: result.error }
      // moving declines a draw offer
      return { ...state, game: result.state, drawOffer: state.drawOffer === seat ? seat : null }
    }
    if (action.type === "resign") return { ...state, resigned: seat }
    if (action.type === "draw") {
      if (action.answer === "offer") {
        if (state.drawOffer !== null) return { error: "A draw has already been offered." }
        return { ...state, drawOffer: seat }
      }
      if (state.drawOffer === null || state.drawOffer === seat) return { error: "There's no draw offer." }
      return action.answer === "accept" ? { ...state, agreed: true, drawOffer: null } : { ...state, drawOffer: null }
    }
    return { error: "That isn't a move." }
  },

  // Nothing is hidden in checkers: everyone sees the board; the legal moves are only sent
  // to the player whose turn it is
  view: (state, seat) => {
    const you = colorOfSeat(state, seat)
    const yourTurn = !!you && !state.game.winner && state.resigned === null && !state.agreed && state.game.turn === you
    return {
      you,
      colors: state.colors,
      board: state.game.board,
      turn: state.game.turn,
      moves: state.game.moves,
      last: state.game.last,
      legal: yourTurn ? checkers.legalMoves(state.game).map((m) => m.path) : [],
      counts: checkers.countPieces(state.game.board),
      drawOffer: state.drawOffer === null ? null : seat === null ? "someone" : state.drawOffer === seat ? "you" : "them",
    }
  },

  isOver: (state) => {
    if (state.resigned !== null) return { winners: [1 - state.resigned], reason: "resigned" }
    if (state.agreed) return { winners: [], draw: true, reason: "agreed" }
    const winner = state.game.winner
    if (!winner) return null
    if (winner === "draw") return { winners: [], draw: true, reason: state.game.reason }
    return { winners: [seatOfColor(state, winner)], reason: state.game.reason }
  },

  // Take the most pieces, crown when it can, and avoid moves that hand over a jump
  bot: (state, seat, { random }) => {
    const color = colorOfSeat(state, seat)
    if (state.drawOffer !== null && state.drawOffer !== seat) return { type: "draw", answer: "decline" }
    if (state.game.turn !== color || state.game.winner) return null
    const moves = checkers.legalMoves(state.game)
    if (!moves.length) return null
    let best = null
    for (const m of moves) {
      const after = checkers.applyMove(state.game, m.path).state
      const replies = after.winner ? [] : checkers.legalMoves(after)
      const danger = replies.reduce((most, r) => Math.max(most, r.captures.length), 0)
      const score = (after.winner === color ? 100 : 0) + m.captures.length * 10 + (after.last.crowned ? 4 : 0) - danger * 9 + random()
      if (!best || score > best.score) best = { score, path: m.path }
    }
    return { type: "move", path: best.path }
  },
  botDelay: 900,
}
