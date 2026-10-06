// Real Games' courtside scorekeeper (Pickleball 98): the scoring rules for real games, pure (no
// React), so the tests can play whole games. Used by Scorekeeper.jsx.
//
//   newGame(cfg) -> state          cfg: { format: "doubles" | "singles", scoring: "sideout" |
//                                  "rally", to: 11 | 15 | 21, winBy: 1 | 2, freeze, first: 0 | 1 }
//   rally(state, team) -> { state, events }   `team` (0 or 1) won the rally
//   call(state) -> "4-2-1"         the score call (serving team first; the server number in
//                                  side-out doubles)
//   sayCall(state, events) -> text for speechSynthesis ("Side out. 4, 2, 1. Game point.")
//   serverSpot(state) -> { team, player, side }, receiverSpot(state) -> { team, player, side }
//   gamePoint(state, team), isOver(state)
//   matchState(games, bestOf) -> { won: [a, b], over, winner }
//
// Side-out scoring (the usual game): only the serving team scores. In doubles both partners
// serve before a side out, except at the start of the game (the first serving team gets one
// server, so the call starts "0-0-2"). The first server after a side out is the player in
// the right-hand court; each point the server switches courts with their partner; the
// second server serves from wherever they're standing.
// Rally scoring: every rally scores; the team that wins the rally serves next (one server
// per turn in doubles: the player whose court matches the team's score, right when even).
// `freeze`: a team can only win the game on its own serve (the receiving team winning a
// rally at game point just gets the serve).
// Ends: switch when the first team reaches half the target (6 in a game to 11, 8 to 15, 11
// to 21), as in tournament play.

export const TARGETS = [11, 15, 21]

export const switchAt = (to) => Math.ceil(to / 2) // 6, 8, 11

const other = (t) => 1 - t

export const newGame = (cfg = {}) => {
  const format = cfg.format === "singles" ? "singles" : "doubles"
  const scoring = cfg.scoring === "rally" ? "rally" : "sideout"
  const to = TARGETS.includes(Number(cfg.to)) ? Number(cfg.to) : 11
  const winBy = Number(cfg.winBy) === 1 ? 1 : 2
  const first = cfg.first === 1 ? 1 : 0
  // pos[t] = [player in the right-hand court, player in the left] (indexes into the team)
  const pos = format === "doubles" ? [[0, 1], [0, 1]] : [[0], [0]]
  return {
    cfg: { format, scoring, to, winBy, freeze: !!cfg.freeze && scoring === "rally", first },
    score: [0, 0],
    serving: first,
    // side-out doubles starts with the second server ("0-0-2")
    server: format === "doubles" && scoring === "sideout" ? 2 : 1,
    serverPlayer: 0, // index into the serving team's players
    pos,
    switched: false,
    rallies: 0,
    over: false,
    winner: null,
  }
}

const clone = (s) => ({ ...s, score: [...s.score], pos: s.pos.map((p) => [...p]) })

const wins = (s, t, score = s.score) => score[t] >= s.cfg.to && score[t] - score[other(t)] >= s.cfg.winBy

// could `team` win the game with the next rally?
export const gamePoint = (s, team) => {
  if (s.over) return false
  if (s.cfg.scoring === "sideout" && team !== s.serving) return false
  if (s.cfg.freeze && team !== s.serving) return false
  const next = [...s.score]
  next[team]++
  return wins(s, team, next)
}

export const isOver = (s) => s.over

// in rally doubles the server is whoever stands in the court matching the team's score
const parityServer = (s, t) => (s.score[t] % 2 === 0 ? s.pos[t][0] : s.pos[t][1])

export const rally = (state, team) => {
  if (state.over || (team !== 0 && team !== 1)) return { state, events: [] }
  const s = clone(state)
  const events = []
  const doubles = s.cfg.format === "doubles"
  s.rallies++
  if (s.cfg.scoring === "sideout") {
    if (team === s.serving) {
      s.score[team]++
      events.push("point")
      if (doubles) s.pos[team].reverse() // the server and partner switch courts
    } else if (doubles && s.server === 1) {
      s.server = 2
      s.serverPlayer = 1 - s.serverPlayer // the partner serves from where they stand
      events.push("second")
    } else {
      s.serving = other(s.serving)
      s.server = 1
      s.serverPlayer = doubles ? s.pos[s.serving][0] : 0 // the right-hand court serves first
      events.push("sideout")
    }
  } else {
    const frozen = s.cfg.freeze && team !== s.serving && wins(s, team, s.score.map((v, i) => (i === team ? v + 1 : v)))
    if (!frozen) {
      s.score[team]++
      events.push("point")
    }
    if (team === s.serving) {
      if (doubles) s.pos[team].reverse()
    } else {
      s.serving = team
      events.push("sideout")
      if (frozen) events.push("frozen")
    }
    s.server = 1
    s.serverPlayer = doubles ? parityServer(s, s.serving) : 0
  }
  if (wins(s, 0) || wins(s, 1)) {
    s.over = true
    s.winner = wins(s, 0) ? 0 : 1
    events.push("game")
  } else {
    if (!s.switched && Math.max(...s.score) >= switchAt(s.cfg.to)) {
      s.switched = true
      events.push("switch")
    }
    if (gamePoint(s, s.serving) || (s.cfg.scoring === "rally" && gamePoint(s, other(s.serving)))) events.push("gamepoint")
  }
  return { state: s, events }
}

export const call = (s) => {
  const a = s.score[s.serving]
  const b = s.score[other(s.serving)]
  return s.cfg.format === "doubles" && s.cfg.scoring === "sideout" ? `${a}-${b}-${s.server}` : `${a}-${b}`
}

// for speechSynthesis: "Side out. 4, 2, 1. Game point."
export const sayCall = (s, events = [], names = null) => {
  if (s.over) {
    const who = names?.[s.winner] || (s.winner === 0 ? "Team A" : "Team B")
    return `Game. ${who} wins, ${Math.max(...s.score)} to ${Math.min(...s.score)}.`
  }
  const parts = []
  if (events.includes("sideout")) parts.push("Side out.")
  else if (events.includes("second")) parts.push("Second server.")
  parts.push(call(s).split("-").join(", ") + ".")
  if (events.includes("gamepoint")) parts.push("Game point.")
  if (events.includes("switch")) parts.push("Switch ends.")
  return parts.join(" ")
}

// which court the server stands in: "right" | "left"
export const serverSpot = (s) => {
  const t = s.serving
  if (s.cfg.format === "singles") return { team: t, player: 0, side: s.score[t] % 2 === 0 ? "right" : "left" }
  const i = s.pos[t].indexOf(s.serverPlayer)
  return { team: t, player: s.serverPlayer, side: i === 0 ? "right" : "left" }
}

// the receiver is diagonal from the server: the same side (each from their own end)
export const receiverSpot = (s) => {
  const srv = serverSpot(s)
  const t = other(s.serving)
  if (s.cfg.format === "singles") return { team: t, player: 0, side: srv.side }
  return { team: t, player: s.pos[t][srv.side === "right" ? 0 : 1], side: srv.side }
}

// games: [[a, b], ...] finished games; bestOf: 1 | 3 | 5
export const matchState = (games, bestOf = 1) => {
  const need = Math.floor((bestOf === 3 || bestOf === 5 ? bestOf : 1) / 2) + 1
  const won = [0, 0]
  for (const g of games || []) if (g[0] !== g[1]) won[g[0] > g[1] ? 0 : 1]++
  const winner = won[0] >= need ? 0 : won[1] >= need ? 1 : null
  return { won, need, over: winner !== null, winner }
}
