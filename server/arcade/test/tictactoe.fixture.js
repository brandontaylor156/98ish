// A tiny game used ONLY by the room system's tests: tic-tac-toe where each player also
// holds a secret number (hidden information: only its owner may see it), with an optional
// turn clock (a server timer) and a computer player that takes the first free square.

const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]]

const winnerOf = (board) => {
  for (const [a, b, c] of LINES) if (board[a] !== null && board[a] === board[b] && board[a] === board[c]) return board[a]
  return null
}

const startClock = (state, ctx) => {
  if (state.turnMs > 0) ctx.after(state.turnMs, { type: "timeout", turn: state.moves }, "turn")
  return state
}

module.exports = {
  id: "tictactoe",
  name: "Tic-Tac-Toe",
  minPlayers: 2,
  maxPlayers: 2,
  defaultSettings: { turnMs: 0, style: "classic" },
  validateSettings: (s) => {
    const turnMs = Number(s.turnMs)
    if (!Number.isInteger(turnMs) || turnMs < 0 || turnMs > 60_000) return { error: "The turn clock must be 0 to 60 seconds." }
    if (!["classic", "fancy"].includes(s.style)) return { error: "Unknown style." }
    return { turnMs, style: s.style }
  },
  create: ({ players, settings, random, after }) => {
    const state = {
      board: Array(9).fill(null),
      turn: 0,
      moves: 0,
      secrets: players.map(() => Math.floor(random() * 1e9)),
      turnMs: settings.turnMs,
      timedOut: null,
    }
    return startClock(state, { after })
  },
  action: (state, seat, action, ctx) => {
    if (seat === null) {
      // the turn clock ran out on whoever's turn it still is
      if (action.type === "timeout" && action.turn === state.moves) return { ...state, timedOut: state.turn }
      return { error: "stale timer" }
    }
    if (action.type !== "mark") return { error: "That isn't a move." }
    if (state.turn !== seat) return { error: "It isn't your turn." }
    const cell = action.cell
    if (!Number.isInteger(cell) || cell < 0 || cell > 8 || state.board[cell] !== null) return { error: "That square is taken." }
    const board = state.board.slice()
    board[cell] = seat
    return startClock({ ...state, board, turn: 1 - seat, moves: state.moves + 1 }, ctx)
  },
  view: (state, seat) => ({
    board: state.board,
    turn: state.turn,
    yourTurn: state.turn === seat,
    secret: seat === null ? null : state.secrets[seat],
  }),
  isOver: (state) => {
    if (state.timedOut !== null) return { winners: [1 - state.timedOut], reason: "timeout" }
    const w = winnerOf(state.board)
    if (w !== null) return { winners: [w], reason: "three" }
    if (state.moves === 9) return { winners: [], draw: true, reason: "full" }
    return null
  },
  bot: (state, seat) => (state.turn === seat ? { type: "mark", cell: state.board.indexOf(null) } : null),
}
