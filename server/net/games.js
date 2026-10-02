// Head-to-head games between computers on the network: invitations, then matches of
// Checkers, Minesweeper Race, Hearts, Reversi, Chess and Battleship. The server keeps the real game state; each player
// gets their own view of it ("net:match"). Players are computer ids (pids); games.js never
// touches sockets, it talks through the `emit(pid, event, payload)` it's given.

const crypto = require("crypto")
const checkers = require("./checkers")
const hearts = require("./hearts")
const { rules } = require("./rules")

const INVITE_MS = 60_000
const GAMES = ["checkers", "race", "hearts", "reversi", "chess", "battleship"]
// two-player board games whose rules are shared with the browser (see rules.js)
const BOARD_GAMES = ["reversi", "chess", "battleship"]
const RACE_LEVELS = {
  beginner: { rows: 9, cols: 9, mines: 10 },
  intermediate: { rows: 16, cols: 16, mines: 40 },
  expert: { rows: 16, cols: 30, mines: 99 },
}
const BOT_NAMES = ["Ada", "Grace", "Alan", "Linus", "Hedy", "Dennis"]
const DELAYS = { botPass: 500, botPlay: 750, trick: 1400, nextHand: 7000 }

const newId = () => crypto.randomBytes(6).toString("hex")
const GAME_NAMES = { checkers: "Checkers", race: "Minesweeper Race", hearts: "Hearts", reversi: "Reversi", chess: "Chess", battleship: "Battleship" }

const createGames = ({ emit, delays = DELAYS, random = Math.random } = {}) => {
  const invites = new Map() // id -> { id, game, from, fromName, to, toName, options, matchId, timer }
  const matches = new Map() // id -> match

  const send = (pid, event, payload) => pid && emit(pid, event, payload)
  // game chat listens for results and rematches (server/gamechat)
  const listeners = new Set()
  const notify = (m, type) => listeners.forEach((fn) => fn(m, type))

  // ---------- views ----------

  const checkersView = (m, pid) => {
    const you = m.colors.b === pid ? "b" : "r"
    const them = checkers.other(you)
    const theirPid = m.colors[them]
    const yourTurn = !m.result && m.state.turn === you
    return {
      id: m.id,
      game: "checkers",
      round: m.round,
      you,
      names: { b: m.names[m.colors.b], r: m.names[m.colors.r] },
      board: m.state.board,
      turn: m.state.turn,
      moves: m.state.moves,
      last: m.state.last,
      legal: yourTurn ? checkers.legalMoves(m.state).map((mv) => mv.path) : [],
      counts: checkers.countPieces(m.state.board),
      drawOffer: m.drawOffer ? (m.drawOffer === pid ? "you" : "them") : null,
      result: m.result && { ...m.result, youWon: m.result.winner === pid, winnerName: m.names[m.result.winner] || null },
      rematch: { you: m.rematch.has(pid), them: m.rematch.has(theirPid) },
      away: !!m.away[theirPid],
      left: m.left.has(theirPid),
    }
  }

  const raceView = (m, pid) => {
    const them = m.players.find((p) => p !== pid)
    return {
      id: m.id,
      game: "race",
      round: m.round,
      level: m.level,
      field: RACE_LEVELS[m.level],
      seed: m.seed,
      startAt: m.startAt,
      you: { name: m.names[pid], ...m.progress[pid] },
      them: { name: m.names[them], ...m.progress[them], away: !!m.away[them], left: m.left.has(them) },
      result: m.result && { ...m.result, youWon: m.result.winner === pid, winnerName: m.names[m.result.winner] || null },
      rematch: { you: m.rematch.has(pid), them: m.rematch.has(them) },
    }
  }

  const heartsView = (m, pid) => {
    const seat = m.seats.findIndex((s) => s && s.pid === pid)
    const st = m.state
    const playing = st && st.hands
    const livePoints = playing ? st.taken.map((cards) => cards.reduce((sum, c) => sum + hearts.pointsOf(c), 0)) : [0, 0, 0, 0]
    return {
      id: m.id,
      game: "hearts",
      round: m.round,
      phase: m.phase === "lobby" ? "lobby" : st.phase,
      you: seat,
      host: m.host === pid,
      hostName: m.names[m.host],
      seats: m.seats.map((s, i) => ({
        name: s ? s.name : null,
        bot: !!s?.bot,
        away: !!(s && !s.bot && m.away[s.pid]),
        cards: playing ? st.hands[i].length : 0,
        score: st ? st.scores[i] : 0,
        points: livePoints[i],
        passed: !!(playing && st.phase === "passing" && st.passes[i]),
      })),
      pending: [...invites.values()].filter((inv) => inv.matchId === m.id).map((inv) => inv.toName),
      hand: playing && seat >= 0 ? st.hands[seat] : [],
      legal: playing && seat >= 0 && st.phase === "playing" ? hearts.legalPlays(st, seat) : [],
      direction: playing ? st.direction : null,
      passed: playing && seat >= 0 && st.phase === "passing" ? st.passes[seat] : null,
      received: playing && seat >= 0 && st.phase !== "passing" && st.tricks === 0 ? st.received[seat] : [],
      trick: playing ? st.trick : [],
      lastTrick: playing ? st.lastTrick : null,
      turn: playing ? st.turn : null,
      leader: playing ? st.leader : null,
      tricks: playing ? st.tricks : 0,
      heartsBroken: !!(playing && st.heartsBroken),
      handPoints: st?.handPoints || null,
      moon: st?.moon ?? null,
      history: st?.history || [],
      hand_no: st?.hand || 0,
      winners: st?.winners || null,
    }
  }

  const resultFor = (m, pid) => m.result && { ...m.result, youWon: m.result.winner === pid, winnerName: m.names[m.result.winner] || null }

  // Reversi and Chess: colors, the board, and the moves you may make when it's your turn
  const reversiView = (m, pid) => {
    const R = rules.reversi
    const you = m.colors.b === pid ? "b" : "w"
    const theirPid = m.colors[R.other(you)]
    const yourTurn = !m.result && m.state.turn === you
    return {
      id: m.id,
      game: "reversi",
      round: m.round,
      you,
      names: { b: m.names[m.colors.b], w: m.names[m.colors.w] },
      board: m.state.board,
      turn: m.state.turn,
      moves: m.state.moves,
      last: m.state.last,
      passed: m.state.passed,
      legal: yourTurn ? R.legalMoves(m.state.board, you) : [],
      counts: R.countDiscs(m.state.board),
      result: resultFor(m, pid),
      rematch: { you: m.rematch.has(pid), them: m.rematch.has(theirPid) },
      away: !!m.away[theirPid],
      left: m.left.has(theirPid),
    }
  }

  const chessView = (m, pid) => {
    const C = rules.chess
    const you = m.colors.w === pid ? "w" : "b"
    const theirPid = m.colors[C.other(you)]
    const yourTurn = !m.result && m.state.turn === you
    return {
      id: m.id,
      game: "chess",
      round: m.round,
      you,
      names: { w: m.names[m.colors.w], b: m.names[m.colors.b] },
      board: m.state.board,
      turn: m.state.turn,
      check: m.state.check,
      sans: m.state.sans,
      last: m.state.last,
      legal: yourTurn ? C.movesForView(m.state) : [],
      captured: C.captured(m.state.board),
      drawOffer: m.drawOffer ? (m.drawOffer === pid ? "you" : "them") : null,
      result: resultFor(m, pid),
      rematch: { you: m.rematch.has(pid), them: m.rematch.has(theirPid) },
      away: !!m.away[theirPid],
      left: m.left.has(theirPid),
    }
  }

  // Battleship: your own fleet and the shots at it, and only what you've learned about
  // theirs. Their fleet is sent once the game is over, never before.
  const battleshipView = (m, pid) => {
    const B = rules.battleship
    const side = m.players.indexOf(pid)
    const theirPid = m.players[1 - side]
    const st = m.state
    const view = {
      id: m.id,
      game: "battleship",
      round: m.round,
      names: { you: m.names[pid], them: m.names[theirPid] },
      phase: st.phase,
      placed: { you: !!st.sides[side].fleet, them: !!st.sides[1 - side].fleet },
      yourTurn: !m.result && st.phase === "playing" && st.turn === side,
      firstShot: m.first === side ? "you" : "them",
      own: B.ownView(st, side),
      enemy: B.enemyView(st, side),
      last: st.last && { ...st.last, by: st.last.by === side ? "you" : "them" },
      result: resultFor(m, pid),
      rematch: { you: m.rematch.has(pid), them: m.rematch.has(theirPid) },
      away: !!m.away[theirPid],
      left: m.left.has(theirPid),
    }
    if (m.result) view.enemyFleet = st.sides[1 - side].fleet
    return view
  }

  const VIEWS = { checkers: checkersView, race: raceView, hearts: heartsView, reversi: reversiView, chess: chessView, battleship: battleshipView }
  const viewFor = (m, pid) => VIEWS[m.game](m, pid)

  const humansOf = (m) => (m.game === "hearts" ? m.seats.filter((s) => s && !s.bot).map((s) => s.pid) : m.players.filter((p) => !m.left.has(p)))

  const publish = (m) => {
    for (const pid of humansOf(m)) send(pid, "net:match", viewFor(m, pid))
  }

  const matchesOf = (pid) => [...matches.values()].filter((m) => humansOf(m).includes(pid))

  // ---------- invitations ----------

  const invite = ({ from, fromName, to, toName, game, options = {}, matchId }) => {
    if (!GAMES.includes(game)) return { ok: false, error: "Unknown game." }
    if (from === to) return { ok: false, error: "You can't play against yourself." }
    if (BOARD_GAMES.includes(game) && !rules[game]) return { ok: false, error: "The game is still starting up. Try again in a moment." }
    if ([...invites.values()].filter((i) => i.from === from).length >= 6) return { ok: false, error: "You have too many invitations waiting. Wait for some answers first." }
    if ([...invites.values()].some((i) => i.from === from && i.to === to && i.game === game && (i.matchId || null) === (matchId || null))) {
      return { ok: false, error: `You already invited ${toName}.` }
    }
    const opts = {}
    if (game === "race") opts.level = RACE_LEVELS[options.level] ? options.level : "beginner"
    if (game === "hearts") {
      const table = matches.get(matchId)
      if (!table || table.game !== "hearts" || table.host !== from) return { ok: false, error: "Open a Hearts table first." }
      if (table.phase !== "lobby") return { ok: false, error: "This game has already started." }
      if (table.seats.some((s) => s && s.pid === to)) return { ok: false, error: `${toName} is already at the table.` }
      const pendingHere = [...invites.values()].filter((i) => i.matchId === matchId).length
      if (table.seats.filter((s) => !s).length - pendingHere <= 0) return { ok: false, error: "Every seat at the table is spoken for." }
    }
    const inv = { id: newId(), game, from, fromName, to, toName, options: opts, matchId: game === "hearts" ? matchId : null, expiresAt: Date.now() + INVITE_MS }
    inv.timer = setTimeout(() => endInvite(inv, "expired"), INVITE_MS)
    inv.timer.unref?.()
    invites.set(inv.id, inv)
    send(to, "net:invited", inviteView(inv))
    if (inv.matchId) publish(matches.get(inv.matchId))
    return { ok: true, inviteId: inv.id }
  }

  const inviteView = (inv) => ({ id: inv.id, game: inv.game, gameName: GAME_NAMES[inv.game], from: inv.fromName, fromId: inv.from, options: inv.options, expiresAt: inv.expiresAt })

  // status: accepted | declined | expired | canceled | gone (the other side left)
  const endInvite = (inv, status, error) => {
    if (!invites.has(inv.id)) return
    clearTimeout(inv.timer)
    invites.delete(inv.id)
    if (status !== "accepted") send(inv.to, "net:inviteGone", { id: inv.id })
    if (status !== "canceled") send(inv.from, "net:inviteResult", { id: inv.id, status, to: inv.toName, game: inv.game, gameName: GAME_NAMES[inv.game], error })
    const table = inv.matchId && matches.get(inv.matchId)
    if (table) publish(table)
  }

  const replyInvite = (pid, id, accept) => {
    const inv = invites.get(id)
    if (!inv || inv.to !== pid) return { ok: false, error: "That invitation has expired." }
    if (!accept) {
      endInvite(inv, "declined")
      return { ok: true }
    }
    if (inv.game === "hearts") {
      const table = matches.get(inv.matchId)
      const seat = table && table.phase === "lobby" ? table.seats.findIndex((s) => !s) : -1
      if (seat < 0) {
        endInvite(inv, "gone")
        return { ok: false, error: "Sorry, that Hearts game has already started or closed." }
      }
      table.seats[seat] = { pid, name: inv.toName }
      table.names[pid] = inv.toName
      endInvite(inv, "accepted")
      return { ok: true, matchId: table.id }
    }
    endInvite(inv, "accepted")
    const m =
      inv.game === "checkers"
        ? startCheckers(inv.from, inv.fromName, pid, inv.toName)
        : inv.game === "race"
          ? startRace(inv.from, inv.fromName, pid, inv.toName, inv.options.level)
          : startBoardGame(inv.game, inv.from, inv.fromName, pid, inv.toName)
    return { ok: true, matchId: m.id }
  }

  const cancelInvite = (pid, id) => {
    const inv = invites.get(id)
    if (inv && inv.from === pid) endInvite(inv, "canceled")
    return { ok: true }
  }

  // ---------- two-player matches ----------

  const base = (game, a, aName, b, bName) => ({
    id: newId(),
    game,
    round: 1,
    players: [a, b],
    names: { [a]: aName, [b]: bName },
    away: {},
    left: new Set(),
    rematch: new Set(),
    result: null,
  })

  const startCheckers = (a, aName, b, bName) => {
    const m = base("checkers", a, aName, b, bName)
    const aBlack = random() < 0.5
    m.colors = aBlack ? { b: a, r: b } : { b: b, r: a }
    m.state = checkers.newGame()
    m.drawOffer = null
    matches.set(m.id, m)
    publish(m)
    return m
  }

  // A fresh Reversi, Chess or Battleship game in a match (colors already chosen)
  const resetBoardGame = (m) => {
    m.drawOffer = null
    if (m.game === "battleship") m.state = { ...rules.battleship.newGame(), turn: m.first }
    else m.state = rules[m.game].newGame()
  }

  const startBoardGame = (game, a, aName, b, bName) => {
    const m = base(game, a, aName, b, bName)
    const aFirst = random() < 0.5
    // black moves first in Reversi, white in Chess; in Battleship someone shoots first
    if (game === "reversi") m.colors = aFirst ? { b: a, w: b } : { b: b, w: a }
    else if (game === "chess") m.colors = aFirst ? { w: a, b: b } : { w: b, b: a }
    else m.first = aFirst ? 0 : 1
    resetBoardGame(m)
    matches.set(m.id, m)
    publish(m)
    return m
  }

  const raceProgress = () => ({ revealed: 0, flags: 0, status: "playing", time: 0 })

  const startRace = (a, aName, b, bName, level = "beginner") => {
    const m = base("race", a, aName, b, bName)
    m.level = RACE_LEVELS[level] ? level : "beginner"
    m.seed = Math.floor(random() * 2 ** 31)
    m.startAt = Date.now() + 3000 // a 3 second countdown
    m.progress = { [a]: raceProgress(), [b]: raceProgress() }
    matches.set(m.id, m)
    publish(m)
    return m
  }

  const opponentOf = (m, pid) => m.players.find((p) => p !== pid)

  const finish = (m, winner, reason) => {
    if (m.result) return
    m.result = { winner, draw: winner === null, reason }
    m.drawOffer = null
    publish(m)
    notify(m, "finish")
  }

  const checkersMove = (pid, matchId, path) => {
    const m = matches.get(matchId)
    if (!m || m.game !== "checkers" || !m.players.includes(pid)) return { ok: false, error: "No such game." }
    if (m.result) return { ok: false, error: "The game is over." }
    if (m.colors[m.state.turn] !== pid) return { ok: false, error: "It isn't your turn." }
    const result = checkers.applyMove(m.state, path)
    if (!result.ok) return result
    m.state = result.state
    if (m.drawOffer && m.drawOffer !== pid) m.drawOffer = null // moving declines a draw offer
    if (m.state.winner === "draw") finish(m, null, "quiet")
    else if (m.state.winner) finish(m, m.colors[m.state.winner], m.state.reason)
    else publish(m)
    return { ok: true }
  }

  // A move in Reversi ({ square }), Chess ({ from, to, promotion }) or Battleship
  // ({ fleet } to place the ships, { cell } to fire)
  const gameMove = (pid, matchId, move) => {
    const m = matches.get(matchId)
    if (!m || !BOARD_GAMES.includes(m.game) || !m.players.includes(pid)) return { ok: false, error: "No such game." }
    if (m.result) return { ok: false, error: "The game is over." }
    if (!move || typeof move !== "object") return { ok: false, error: "That isn't a move." }
    if (m.game === "battleship") {
      const B = rules.battleship
      const side = m.players.indexOf(pid)
      const result = move.fleet !== undefined ? B.place(m.state, side, move.fleet) : B.fire(m.state, side, move.cell)
      if (!result.ok) return result
      m.state = result.state
      if (m.state.phase === "over") finish(m, pid, "sunk")
      else publish(m)
      return { ok: true }
    }
    if (m.colors[m.state.turn] !== pid) return { ok: false, error: "It isn't your turn." }
    const result =
      m.game === "reversi"
        ? rules.reversi.applyMove(m.state, move.square)
        : rules.chess.applyMove(m.state, { from: move.from, to: move.to, promotion: move.promotion ?? undefined })
    if (!result.ok) return result
    m.state = result.state
    if (m.drawOffer && m.drawOffer !== pid) m.drawOffer = null // moving declines a draw offer
    const over = m.state.result
    if (over) finish(m, over.winner ? m.colors[over.winner] : null, over.reason)
    else publish(m)
    return { ok: true }
  }

  const raceProgressUpdate = (pid, matchId, { revealed, flags, status, time }) => {
    const m = matches.get(matchId)
    if (!m || m.game !== "race" || !m.players.includes(pid)) return { ok: false, error: "No such game." }
    if (m.result) return { ok: true }
    if (Date.now() < m.startAt - 500) return { ok: false, error: "Wait for the countdown!" }
    const field = RACE_LEVELS[m.level]
    const safe = field.rows * field.cols - field.mines
    const p = m.progress[pid]
    if (p.status !== "playing") return { ok: true }
    const r = Number(revealed)
    const f = Number(flags)
    if (!Number.isInteger(r) || r < p.revealed || r > safe) return { ok: false, error: "Bad progress." }
    if (!Number.isInteger(f) || f < 0 || f > field.rows * field.cols) return { ok: false, error: "Bad progress." }
    if (!["playing", "won", "lost"].includes(status)) return { ok: false, error: "Bad progress." }
    if (status === "won" && r !== safe) return { ok: false, error: "Bad progress." }
    m.progress[pid] = { revealed: r, flags: f, status, time: Math.max(0, Math.min(999_999, Number(time) || 0)) }
    if (status === "won") finish(m, pid, "cleared")
    else if (status === "lost") finish(m, opponentOf(m, pid), "mine")
    else publish(m)
    return { ok: true }
  }

  const resign = (pid, matchId) => {
    const m = matches.get(matchId)
    if (!m || !m.players?.includes(pid)) return { ok: false, error: "No such game." }
    if (m.game === "race" && !m.result) m.progress[pid] = { ...m.progress[pid], status: "resigned" }
    finish(m, opponentOf(m, pid), "resigned")
    return { ok: true }
  }

  const draw = (pid, matchId, action) => {
    const m = matches.get(matchId)
    if (!m || (m.game !== "checkers" && m.game !== "chess") || !m.players.includes(pid) || m.result) return { ok: false, error: "No such game." }
    if (action === "offer") {
      if (m.drawOffer) return { ok: false, error: "A draw has already been offered." }
      m.drawOffer = pid
    } else if (action === "accept" && m.drawOffer && m.drawOffer !== pid) {
      return finish(m, null, "agreed"), { ok: true }
    } else if (action === "decline" && m.drawOffer && m.drawOffer !== pid) {
      m.drawOffer = null
    } else return { ok: false, error: "There's no draw offer." }
    publish(m)
    return { ok: true }
  }

  const rematch = (pid, matchId) => {
    const m = matches.get(matchId)
    if (!m || !m.players?.includes(pid) || !m.result) return { ok: false, error: "No such game." }
    const them = opponentOf(m, pid)
    if (m.left.has(them)) return { ok: false, error: `${m.names[them]} has left.` }
    m.rematch.add(pid)
    if (m.rematch.has(them)) {
      m.round++
      m.rematch = new Set()
      m.result = null
      if (m.game === "checkers") {
        m.colors = { b: m.colors.r, r: m.colors.b } // swap colors
        m.state = checkers.newGame()
        m.drawOffer = null
      } else if (BOARD_GAMES.includes(m.game)) {
        // swap colors (or who shoots first)
        if (m.game === "reversi") m.colors = { b: m.colors.w, w: m.colors.b }
        else if (m.game === "chess") m.colors = { w: m.colors.b, b: m.colors.w }
        else m.first = 1 - m.first
        resetBoardGame(m)
      } else {
        m.seed = Math.floor(random() * 2 ** 31)
        m.startAt = Date.now() + 3000
        m.progress = { [m.players[0]]: raceProgress(), [m.players[1]]: raceProgress() }
      }
      notify(m, "rematch")
    }
    publish(m)
    return { ok: true }
  }

  // ---------- Hearts tables ----------

  const createTable = (pid, name) => {
    const m = {
      id: newId(),
      game: "hearts",
      round: 1,
      host: pid,
      names: { [pid]: name },
      seats: [{ pid, name }, null, null, null],
      away: {},
      phase: "lobby",
      state: null,
      timer: null,
    }
    matches.set(m.id, m)
    publish(m)
    return { ok: true, matchId: m.id }
  }

  const botName = (m) => {
    const taken = new Set(m.seats.filter(Boolean).map((s) => s.name))
    return BOT_NAMES.find((n) => !taken.has(n)) || "Computer"
  }

  const startTable = (pid, matchId) => {
    const m = matches.get(matchId)
    if (!m || m.game !== "hearts" || m.host !== pid) return { ok: false, error: "Only the host can deal." }
    if (m.phase !== "lobby" && !(m.phase === "playing" && m.state.phase === "gameOver")) return { ok: false, error: "The game is already going." }
    for (const inv of [...invites.values()]) if (inv.matchId === m.id) endInvite(inv, "gone")
    for (let i = 0; i < 4; i++) if (!m.seats[i]) m.seats[i] = { bot: true, name: botName(m) }
    m.phase = "playing"
    if (m.state) m.round++
    m.state = hearts.deal(hearts.newGame(), random)
    advance(m)
    return { ok: true }
  }

  const schedule = (m, ms, fn) => {
    clearTimeout(m.timer)
    m.timer = setTimeout(() => {
      m.timer = null
      if (matches.get(m.id) === m) fn()
    }, ms)
  }

  // Let the computer players act, show finished tricks for a moment, deal the next hand
  const advance = (m) => {
    publish(m)
    const st = m.state
    if (!st) return
    if (st.phase === "gameOver" && m.notifiedRound !== m.round) {
      m.notifiedRound = m.round
      notify(m, "finish")
    }
    if (st.phase === "passing") {
      const waiting = m.seats.findIndex((s, i) => s.bot && !st.passes[i])
      if (waiting >= 0) {
        schedule(m, delays.botPass, () => {
          const result = hearts.setPass(m.state, waiting, hearts.botPass(m.state.hands[waiting]))
          if (result.ok) m.state = result.state
          advance(m)
        })
      }
    } else if (st.phase === "playing" && m.seats[st.turn].bot) {
      schedule(m, delays.botPlay, () => {
        const seat = m.state.turn
        if (m.state.phase !== "playing" || !m.seats[seat]?.bot) return advance(m)
        const result = hearts.play(m.state, seat, hearts.botPlay(m.state, seat))
        if (result.ok) m.state = result.state
        advance(m)
      })
    } else if (st.phase === "trickEnd") {
      schedule(m, delays.trick, () => {
        m.state = hearts.collectTrick(m.state)
        advance(m)
      })
    } else if (st.phase === "handOver") {
      schedule(m, delays.nextHand, () => {
        m.state = hearts.deal(m.state, random)
        advance(m)
      })
    }
  }

  const seatOf = (m, pid) => m.seats.findIndex((s) => s && !s.bot && s.pid === pid)

  const heartsPass = (pid, matchId, cards) => {
    const m = matches.get(matchId)
    if (!m || m.game !== "hearts" || m.phase !== "playing") return { ok: false, error: "No such game." }
    const seat = seatOf(m, pid)
    if (seat < 0) return { ok: false, error: "You aren't at this table." }
    const result = hearts.setPass(m.state, seat, cards)
    if (!result.ok) return result
    m.state = result.state
    advance(m)
    return { ok: true }
  }

  const heartsPlay = (pid, matchId, card) => {
    const m = matches.get(matchId)
    if (!m || m.game !== "hearts" || m.phase !== "playing") return { ok: false, error: "No such game." }
    const seat = seatOf(m, pid)
    if (seat < 0) return { ok: false, error: "You aren't at this table." }
    const result = hearts.play(m.state, seat, card)
    if (!result.ok) return result
    m.state = result.state
    advance(m)
    return { ok: true }
  }

  const closeMatch = (m) => {
    clearTimeout(m.timer)
    matches.delete(m.id)
    for (const inv of [...invites.values()]) if (inv.matchId === m.id) endInvite(inv, "gone")
  }

  // A human leaves a Hearts table: a computer player takes over their seat
  const leaveTable = (m, pid) => {
    const seat = seatOf(m, pid)
    if (seat < 0) return
    if (m.phase === "lobby") {
      if (m.host === pid) {
        for (const s of m.seats) if (s && s.pid !== pid) send(s.pid, "net:matchGone", { id: m.id, reason: `${m.names[pid]} closed the table.` })
        return closeMatch(m)
      }
      m.seats[seat] = null
      return publish(m)
    }
    m.seats[seat] = { bot: true, name: `${m.seats[seat].name} (computer)` }
    delete m.away[pid]
    if (!m.seats.some((s) => !s.bot)) return closeMatch(m)
    if (m.host === pid) m.host = m.seats.find((s) => !s.bot).pid
    advance(m)
  }

  // ---------- leaving, dropping, coming back ----------

  // The player closed the game window
  const leave = (pid, matchId) => {
    const m = matches.get(matchId)
    if (!m) return { ok: true }
    if (m.game === "hearts") return leaveTable(m, pid), { ok: true }
    if (!m.players.includes(pid)) return { ok: true }
    if (!m.result) resign(pid, matchId)
    m.left.add(pid)
    m.rematch.delete(pid)
    if (m.players.every((p) => m.left.has(p))) closeMatch(m)
    else publish(m)
    return { ok: true }
  }

  // Lost connection (maybe coming back): let the others know
  const setAway = (pid, away) => {
    for (const m of matchesOf(pid)) {
      if (away) m.away[pid] = true
      else delete m.away[pid]
      publish(m)
    }
  }

  // Gone for good: forfeit two-player games, computers take Hearts seats, drop invitations
  const drop = (pid) => {
    for (const inv of [...invites.values()]) {
      if (inv.to === pid) endInvite(inv, "gone")
      else if (inv.from === pid) endInvite(inv, "canceled")
    }
    for (const m of matchesOf(pid)) leave(pid, m.id)
  }

  // Reconnected: send everything again
  const resync = (pid) => {
    for (const m of matchesOf(pid)) send(pid, "net:match", viewFor(m, pid))
    for (const inv of invites.values()) if (inv.to === pid) send(pid, "net:invited", inviteView(inv))
  }

  const busy = (pid) => matchesOf(pid).some((m) => (m.game === "hearts" ? m.phase !== "lobby" && m.state?.phase !== "gameOver" : !m.result))

  return {
    invite,
    replyInvite,
    cancelInvite,
    checkersMove,
    gameMove,
    raceProgressUpdate,
    resign,
    draw,
    rematch,
    createTable,
    startTable,
    heartsPass,
    heartsPlay,
    leave,
    setAway,
    drop,
    resync,
    busy,
    // the people (not computer players) in a match, or null if there's no such match
    playersOf: (matchId) => {
      const m = matches.get(matchId)
      return m ? humansOf(m) : null
    },
    onEvent: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
    matches,
    invites,
    RACE_LEVELS,
  }
}

module.exports = { createGames, RACE_LEVELS, GAME_NAMES, BOARD_GAMES }
