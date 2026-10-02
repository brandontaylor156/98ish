// Chess rules: legal moves (castling, en passant, promotion), check, checkmate, stalemate,
// threefold repetition, the 50-move rule, dead positions, and algebraic notation. Pure
// functions on plain objects, shared by the game server (network games) and the browser
// (games against the computer).
//
// Squares are 0..63 (row * 8 + col), row 0 is rank 8 (a8 = 0, h1 = 63). Pieces are letters,
// white uppercase: P N B R Q K, black lowercase. Empty squares are null.

export const FILES = "abcdefgh"
export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"

const rowOf = (i) => i >> 3
const colOf = (i) => i & 7
const at = (r, c) => (r >= 0 && r < 8 && c >= 0 && c < 8 ? r * 8 + c : -1)

export const squareName = (i) => FILES[colOf(i)] + (8 - rowOf(i))
export const squareIndex = (name) => {
  const m = /^([a-h])([1-8])$/.exec(String(name))
  return m ? (8 - Number(m[2])) * 8 + FILES.indexOf(m[1]) : -1
}

export const colorOf = (piece) => (!piece ? null : piece === piece.toUpperCase() ? "w" : "b")
export const other = (color) => (color === "w" ? "b" : "w")
const typeOf = (piece) => piece.toLowerCase()

const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]
const KING = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]
const ROOK = [[-1, 0], [1, 0], [0, -1], [0, 1]]
const BISHOP = [[-1, -1], [-1, 1], [1, -1], [1, 1]]

// Is square `sq` attacked by any piece of `by`?
export const attacked = (board, sq, by) => {
  const r = rowOf(sq)
  const c = colOf(sq)
  const own = (p, t) => p && colorOf(p) === by && typeOf(p) === t
  // pawns attack diagonally forward: white ones from the row below
  const pr = by === "w" ? r + 1 : r - 1
  for (const dc of [-1, 1]) {
    const s = at(pr, c + dc)
    if (s >= 0 && own(board[s], "p")) return true
  }
  for (const [dr, dc] of KNIGHT) {
    const s = at(r + dr, c + dc)
    if (s >= 0 && own(board[s], "n")) return true
  }
  for (const [dr, dc] of KING) {
    const s = at(r + dr, c + dc)
    if (s >= 0 && own(board[s], "k")) return true
  }
  const slide = (dirs, types) => {
    for (const [dr, dc] of dirs) {
      for (let k = 1; ; k++) {
        const s = at(r + dr * k, c + dc * k)
        if (s < 0) break
        const p = board[s]
        if (!p) continue
        if (colorOf(p) === by && types.includes(typeOf(p))) return true
        break
      }
    }
    return false
  }
  return slide(ROOK, "rq") || slide(BISHOP, "bq")
}

export const kingSquare = (board, color) => board.indexOf(color === "w" ? "K" : "k")

export const inCheck = (pos, color = pos.turn) => {
  const k = kingSquare(pos.board, color)
  return k >= 0 && attacked(pos.board, k, other(color))
}

// ---------- FEN ----------

// A position from Forsyth-Edwards Notation
export const parseFEN = (fen = START_FEN) => {
  const [placement, turn = "w", rights = "-", ep = "-", half = "0", full = "1"] = String(fen).trim().split(/\s+/)
  const board = []
  for (const ch of placement.replace(/\//g, "")) {
    if (/\d/.test(ch)) for (let i = 0; i < Number(ch); i++) board.push(null)
    else if (/^[pnbrqkPNBRQK]$/.test(ch)) board.push(ch)
    else throw new Error("Bad FEN")
  }
  if (board.length !== 64) throw new Error("Bad FEN")
  return {
    board,
    turn: turn === "b" ? "b" : "w",
    castling: { K: rights.includes("K"), Q: rights.includes("Q"), k: rights.includes("k"), q: rights.includes("q") },
    ep: ep === "-" ? null : squareIndex(ep),
    half: Number(half) || 0,
    full: Number(full) || 1,
  }
}

// A game starting from a FEN position
export const fromFEN = (fen) => newGame(parseFEN(fen))

export const toFEN = (pos) => {
  let out = ""
  for (let r = 0; r < 8; r++) {
    let empty = 0
    for (let c = 0; c < 8; c++) {
      const p = pos.board[r * 8 + c]
      if (!p) empty++
      else {
        if (empty) out += empty
        empty = 0
        out += p
      }
    }
    if (empty) out += empty
    if (r < 7) out += "/"
  }
  const rights = ["K", "Q", "k", "q"].filter((k) => pos.castling[k]).join("") || "-"
  return `${out} ${pos.turn} ${rights} ${pos.ep === null ? "-" : squareName(pos.ep)} ${pos.half} ${pos.full}`
}

// ---------- moves ----------

// Moves that follow the pieces' rules, ignoring whether they leave the king in check.
// A move: { from, to, piece, captured, promotion, flag } with flag one of
// "n" (normal), "b" (pawn double step), "e" (en passant), "k" / "q" (castling)
export const pseudoMoves = (pos, color = pos.turn) => {
  const { board } = pos
  const moves = []
  const add = (from, to, flag = "n", promotion = null, captured = board[to]) => moves.push({ from, to, piece: board[from], captured: captured || null, promotion, flag })
  for (let from = 0; from < 64; from++) {
    const piece = board[from]
    if (!piece || colorOf(piece) !== color) continue
    const r = rowOf(from)
    const c = colOf(from)
    const t = typeOf(piece)
    if (t === "p") {
      const dir = color === "w" ? -1 : 1
      const startRow = color === "w" ? 6 : 1
      const lastRow = color === "w" ? 0 : 7
      const pawnTo = (to, flag, captured) => {
        if (rowOf(to) === lastRow) for (const p of "qrbn") add(from, to, flag, color === "w" ? p.toUpperCase() : p, captured)
        else add(from, to, flag, null, captured)
      }
      const one = at(r + dir, c)
      if (one >= 0 && !board[one]) {
        pawnTo(one, "n")
        const two = at(r + 2 * dir, c)
        if (r === startRow && !board[two]) add(from, two, "b")
      }
      for (const dc of [-1, 1]) {
        const to = at(r + dir, c + dc)
        if (to < 0) continue
        if (board[to] && colorOf(board[to]) !== color) pawnTo(to, "n")
        else if (to === pos.ep && !board[to]) add(from, to, "e", null, color === "w" ? "p" : "P")
      }
    } else if (t === "n" || t === "k") {
      for (const [dr, dc] of t === "n" ? KNIGHT : KING) {
        const to = at(r + dr, c + dc)
        if (to >= 0 && colorOf(board[to]) !== color) add(from, to)
      }
      if (t === "k") {
        const home = color === "w" ? 60 : 4
        const enemy = other(color)
        const [K, Q] = color === "w" ? ["K", "Q"] : ["k", "q"]
        const rook = color === "w" ? "R" : "r"
        if (from === home && !attacked(board, home, enemy)) {
          if (pos.castling[K] && board[home + 3] === rook && !board[home + 1] && !board[home + 2] && !attacked(board, home + 1, enemy) && !attacked(board, home + 2, enemy)) add(from, home + 2, "k")
          if (pos.castling[Q] && board[home - 4] === rook && !board[home - 1] && !board[home - 2] && !board[home - 3] && !attacked(board, home - 1, enemy) && !attacked(board, home - 2, enemy)) add(from, home - 2, "q")
        }
      }
    } else {
      const dirs = t === "r" ? ROOK : t === "b" ? BISHOP : [...ROOK, ...BISHOP]
      for (const [dr, dc] of dirs) {
        for (let k = 1; ; k++) {
          const to = at(r + dr * k, c + dc * k)
          if (to < 0) break
          if (!board[to]) add(from, to)
          else {
            if (colorOf(board[to]) !== color) add(from, to)
            break
          }
        }
      }
    }
  }
  return moves
}

// The position after a move (no checking: the move should come from pseudoMoves)
export const make = (pos, move) => {
  const board = pos.board.slice()
  const color = colorOf(move.piece)
  board[move.from] = null
  board[move.to] = move.promotion || move.piece
  if (move.flag === "e") board[move.to + (color === "w" ? 8 : -8)] = null
  if (move.flag === "k") {
    board[move.to - 1] = board[move.to + 1]
    board[move.to + 1] = null
  } else if (move.flag === "q") {
    board[move.to + 1] = board[move.to - 2]
    board[move.to - 2] = null
  }
  const castling = { ...pos.castling }
  const touch = (sq) => {
    if (sq === 60) castling.K = castling.Q = false
    if (sq === 4) castling.k = castling.q = false
    if (sq === 63) castling.K = false
    if (sq === 56) castling.Q = false
    if (sq === 7) castling.k = false
    if (sq === 0) castling.q = false
  }
  touch(move.from)
  touch(move.to)
  const pawn = typeOf(move.piece) === "p"
  return {
    board,
    turn: other(color),
    castling,
    ep: move.flag === "b" ? (move.from + move.to) / 2 : null,
    half: pawn || move.captured ? 0 : pos.half + 1,
    full: color === "b" ? pos.full + 1 : pos.full,
  }
}

export const legalMoves = (pos) => pseudoMoves(pos).filter((m) => !inCheck(make(pos, m), pos.turn))

// Count leaf positions (for testing the move generator against known numbers)
export const perft = (pos, depth) => {
  if (depth === 0) return 1
  const moves = legalMoves(pos)
  if (depth === 1) return moves.length
  let n = 0
  for (const m of moves) n += perft(make(pos, m), depth - 1)
  return n
}

// ---------- the game ----------

// Positions are the same for repetition if the pieces, the side to move, castling rights
// and an en passant capture that's actually possible all match
export const positionKey = (pos) => {
  const rights = ["K", "Q", "k", "q"].filter((k) => pos.castling[k]).join("")
  const ep = pos.ep !== null && legalMoves(pos).some((m) => m.flag === "e") ? pos.ep : "-"
  return `${pos.board.map((p) => p || ".").join("")}${pos.turn}${rights}${ep}`
}

// Neither side can ever mate: kings alone, or a king and one bishop or knight
export const deadPosition = (board) => {
  const pieces = board.filter((p) => p && typeOf(p) !== "k")
  if (pieces.length === 0) return true
  if (pieces.length === 1) return "nb".includes(typeOf(pieces[0]))
  // bishops only, all on the same color of square
  if (pieces.every((p) => typeOf(p) === "b")) {
    const shades = new Set(board.map((p, i) => (p && typeOf(p) === "b" ? (rowOf(i) + colOf(i)) % 2 : -1)).filter((s) => s >= 0))
    return shades.size === 1
  }
  return false
}

export const newGame = (pos = null) => {
  const base = pos || parseFEN(START_FEN)
  const game = { ...base, keys: [], sans: [], last: null, check: false, result: null }
  game.keys = [positionKey(game)]
  game.check = inCheck(game)
  return game
}

// Standard algebraic notation for a legal move in a position ("Nbd7", "exd5", "O-O", "e8=Q+")
export const toSAN = (pos, move, legal = legalMoves(pos)) => {
  let san
  if (move.flag === "k") san = "O-O"
  else if (move.flag === "q") san = "O-O-O"
  else {
    const t = typeOf(move.piece)
    const capture = !!move.captured
    if (t === "p") {
      san = (capture ? `${FILES[colOf(move.from)]}x` : "") + squareName(move.to)
      if (move.promotion) san += `=${move.promotion.toUpperCase()}`
    } else {
      const rivals = legal.filter((m) => m.to === move.to && m.from !== move.from && m.piece === move.piece)
      let which = ""
      if (rivals.length) {
        if (!rivals.some((m) => colOf(m.from) === colOf(move.from))) which = FILES[colOf(move.from)]
        else if (!rivals.some((m) => rowOf(m.from) === rowOf(move.from))) which = String(8 - rowOf(move.from))
        else which = squareName(move.from)
      }
      san = t.toUpperCase() + which + (capture ? "x" : "") + squareName(move.to)
    }
  }
  const next = make(pos, move)
  if (inCheck(next)) san += legalMoves(next).length ? "+" : "#"
  return san
}

const sameMove = (m, { from, to, promotion }) =>
  m.from === from && m.to === to && (!m.promotion || m.promotion.toLowerCase() === String(promotion || "q").toLowerCase())

// Play a move { from, to, promotion? } (promotion "q" "r" "b" "n", queen if left out).
// Returns { ok, state, san } or { ok: false, error }.
export const applyMove = (game, move) => {
  if (game.result) return { ok: false, error: "The game is over." }
  if (!move || !Number.isInteger(move.from) || !Number.isInteger(move.to) || move.from < 0 || move.from > 63 || move.to < 0 || move.to > 63) {
    return { ok: false, error: "That isn't a move." }
  }
  if (move.promotion != null && !/^[qrbnQRBN]$/.test(String(move.promotion))) return { ok: false, error: "Pick a piece to promote to." }
  const legal = legalMoves(game)
  const found = legal.find((m) => sameMove(m, move))
  if (!found) {
    const piece = game.board[move.from]
    if (!piece || colorOf(piece) !== game.turn) return { ok: false, error: "That isn't your piece." }
    const wouldBe = pseudoMoves(game).some((m) => sameMove(m, move))
    return { ok: false, error: wouldBe ? (game.check ? "You have to get out of check." : "That would leave your king in check.") : "That piece can't move there." }
  }
  const san = toSAN(game, found, legal)
  const pos = make(game, found)
  const next = {
    ...pos,
    keys: [...game.keys, ""],
    sans: [...game.sans, san],
    last: { from: found.from, to: found.to, san, captured: found.captured, flag: found.flag },
    check: inCheck(pos),
    result: null,
  }
  next.keys[next.keys.length - 1] = positionKey(next)
  const replies = legalMoves(next)
  const key = next.keys.at(-1)
  if (!replies.length) next.result = next.check ? { winner: game.turn, reason: "checkmate" } : { winner: null, reason: "stalemate" }
  else if (next.keys.filter((k) => k === key).length >= 3) next.result = { winner: null, reason: "repetition" }
  else if (next.half >= 100) next.result = { winner: null, reason: "fifty" }
  else if (deadPosition(next.board)) next.result = { winner: null, reason: "material" }
  return { ok: true, state: next, san, move: found }
}

// Legal moves as plain { from, to, promotion } for a client to show
export const movesForView = (game) => (game.result ? [] : legalMoves(game).map((m) => (m.promotion ? { from: m.from, to: m.to, promotion: true } : { from: m.from, to: m.to })))
  .filter((m, i, all) => !m.promotion || all.findIndex((x) => x.from === m.from && x.to === m.to) === i)

// Material each side has captured, for the panels beside the board
export const captured = (board) => {
  const full = { p: 8, n: 2, b: 2, r: 2, q: 1 }
  const out = { w: [], b: [] } // pieces each side has taken
  for (const t of "qrbnp") {
    const white = board.filter((p) => p === t.toUpperCase()).length
    const black = board.filter((p) => p === t).length
    for (let i = 0; i < Math.max(0, full[t] - black); i++) out.w.push(t)
    for (let i = 0; i < Math.max(0, full[t] - white); i++) out.b.push(t.toUpperCase())
  }
  return out
}
