// Word Duel's rules, in the shape of an online room system rules module (see the guide at
// the top of server/arcade/rooms.js): create / action / view / isOver. The server runs them
// for online rooms (server/arcade/games/wordduel.js) and the window runs the very same rules
// for solo games and games against the computer (local.js), so every format works both ways.
//
// The secret words live only in the state. view() never shows a word before its round is
// over (except to the player who chose it), so the server never sends an answer early.
//
// Shape of the state:
//   teams: who scores together ([{ seats }]); sets: this round's boards, one per team, or
//   one shared by everyone (Duel Turns, Co-op). A set has its guesses (words) and boards;
//   each board has its answer and the colors each guess got (null once it was solved).
//
// Actions: { type: "guess", word } (in Co-op voting it's a suggestion), { type: "pick", word }
// (Sabotage and custom words), and from the server (seat null): tick (computer players),
// timeout (a guess clock ran out), vote (a vote's time is up), roundEnd, next.

import { absurdStep, botGuess, cleanWord, dailyWord, dayKey, hardModeError, hash, parseList, pickRandom, score, seeded, solvedColors, tilePoints } from "./logic.js"
import { DEFAULTS, MAX_PLAYERS, validateSettings } from "./settings.js"

export const TIMES = {
  roundPause: 6000, // the answer is shown between rounds
  pick: 90_000, // to pick a word for someone (then one is picked for you)
  vote: 20_000, // Co-op: after the first suggestion, the rest have this long
}
const MAX_TIMEOUTS = 3 // in a row: you're out of the round
const MAX_ROYALE_ROUNDS = 20

// how long a computer player thinks, in ms
const THINK = { easy: [6500, 12000], normal: [4500, 9000], hard: [3000, 6500] }

const clone = (v) => (typeof structuredClone === "function" ? structuredClone(v) : JSON.parse(JSON.stringify(v)))

// dict: { answers(length) -> [words], isWord(word) -> bool } (words/index.js makeDict)
// options.utc: the daily word follows UTC days (the server) instead of local ones
export const makeRules = (dict, { utc = false } = {}) => {
  // ---------- setting up ----------

  const sharedBoard = (s) => s.format === "turns" || s.format === "coop"
  const turnBased = (s) => s.format === "turns" || (s.format === "coop" && s.coopMode === "alternate")

  const teamsFor = (s, n, setter) => {
    const seats = Array.from({ length: n }, (_, i) => i).filter((i) => i !== setter)
    if (s.format === "coop") return [{ seats }]
    if (s.teams && seats.length >= 2) {
      const a = seats.filter((_, i) => i % 2 === 0)
      const b = seats.filter((_, i) => i % 2 === 1)
      return [{ seats: a }, { seats: b }]
    }
    return seats.map((seat) => ({ seats: [seat] }))
  }

  const answersFor = (st) => {
    const s = st.s
    if (s.source === "list") return parseList(s.list, s.length)
    return dict.answers(s.length)
  }

  // the next secret word (not one this game has used yet, while there are others)
  const freshWord = (st, random) => {
    const list = answersFor(st)
    const unused = list.filter((w) => !st.used.includes(w))
    const word = pickRandom(unused.length ? unused : list, random)
    st.used.push(word)
    if (st.used.length > 400) st.used.shift()
    return word
  }

  const dailyFor = (st, k) => {
    const list = dict.answers(st.s.length)
    const word = dailyWord(list, st.day, (st.round - 1) * st.s.boards + k)
    st.used.push(word)
    return word
  }

  const maxFor = (st, team) => {
    const s = st.s
    if (!s.guesses) return 0
    const seats = st.teams[team]?.seats || []
    // handicaps count when one person has the board to themselves
    const extra = seats.length === 1 ? s.handicap[seats[0]] || 0 : 0
    return Math.max(1, s.guesses + extra)
  }

  const newBoard = (st, answer) => {
    const board = { answer, colors: [], solvedAt: null }
    if (st.s.format === "absurd") {
      board.answer = null
      board.cand = answersFor(st)
    }
    return board
  }

  // a fresh set of boards for a team (or for everyone: team null)
  const newSet = (st, team, seats, answers) => ({
    team,
    seats,
    boards: answers.map((a) => newBoard(st, a)),
    words: [], // the guesses, in order (null: the clock ran out)
    by: [], // who made each guess
    max: team === null ? (st.s.guesses || 0) : maxFor(st, team),
    done: false,
    solved: false,
    timeMs: null,
    tiles: 0,
    timeouts: 0,
    turn: 0,
    votes: {},
    voteOrder: [],
    rush: st.s.format === "rush" ? { solved: 0, failed: 0, guesses: 0, last: null } : null,
    deadline: null, // this set's guess clock
  })

  const aliveTeams = (st) => st.teams.map((_, i) => i).filter((i) => st.alive[i])

  // ---------- rounds ----------

  const startRound = (st, ctx) => {
    st.round++
    st.sets = []
    st.picks = {}
    st.pickFor = {}
    st.deadline = null
    st.nextAt = null
    st.roundStart = null
    st.pickDeadline = null
    st.botAt = {}
    const s = st.s
    const alive = aliveTeams(st)
    // custom words and Sabotage: somebody picks first
    if (s.source === "custom" && st.setter !== null) {
      st.phase = "pick"
      st.pickFor = { [st.setter]: null } // null: for everyone
    } else if (s.format === "sabotage" && alive.length >= 2) {
      st.phase = "pick"
      alive.forEach((t, i) => {
        st.pickFor[st.teams[t].seats[0]] = alive[(i + 1) % alive.length]
      })
    }
    if (st.phase === "pick") {
      st.pickDeadline = ctx.now + TIMES.pick
      ctx.after(TIMES.pick, { type: "pickTimeout", round: st.round }, "pick")
      return st
    }
    return beginPlay(st, ctx)
  }

  const beginPlay = (st, ctx) => {
    const s = st.s
    const random = ctx.random
    st.phase = "play"
    st.roundStart = ctx.now
    st.pickDeadline = null
    ctx.cancel("pick")
    const alive = aliveTeams(st)
    const roundWords = () =>
      Array.from({ length: s.boards }, (_, k) => {
        if (s.source === "custom" && st.setter !== null) return st.picks[st.setter]
        if (s.source === "daily") return dailyFor(st, k)
        return freshWord(st, random)
      })
    if (sharedBoard(s)) {
      const set = newSet(st, null, alive.flatMap((t) => st.teams[t].seats), roundWords())
      set.turn = (st.round - 1) % Math.max(1, set.seats.length)
      st.sets = [set]
    } else if (s.format === "sabotage" && alive.length >= 2) {
      // each team guesses the word picked for it
      st.sets = alive.map((t) => {
        const picker = Object.keys(st.pickFor).find((seat) => st.pickFor[seat] === t)
        return newSet(st, t, st.teams[t].seats, [st.picks[picker] || freshWord(st, random)])
      })
    } else if (s.format === "rush") {
      // everyone gets their own words (the same list would let people pass answers on)
      st.sets = alive.map((t) => newSet(st, t, st.teams[t].seats, [freshWord(st, random)]))
    } else {
      const words = roundWords()
      st.sets = alive.map((t) => newSet(st, t, st.teams[t].seats, words))
    }
    const roundSecs = s.format === "rush" ? s.rushSecs : s.timer === "round" ? s.timerSecs : 0
    if (roundSecs) {
      st.deadline = ctx.now + roundSecs * 1000
      ctx.after(roundSecs * 1000, { type: "roundEnd", round: st.round }, "round")
    }
    st.sets.forEach((set, i) => armGuessClock(st, i, ctx))
    return st
  }

  const armGuessClock = (st, i, ctx) => {
    const set = st.sets[i]
    if (st.s.timer !== "guess" || st.s.format === "rush" || set.done || st.phase !== "play") {
      set.deadline = null
      ctx.cancel(`g${i}`)
      return
    }
    const ms = st.s.timerSecs * 1000
    set.deadline = ctx.now + ms
    ctx.after(ms, { type: "timeout", set: i, row: set.words.length, round: st.round }, `g${i}`)
  }

  // ---------- guesses ----------

  const setOfSeat = (st, seat) => st.sets.findIndex((set) => set.seats.includes(seat))

  const accepted = (st, set, word) => {
    if (!st.s.strict) return true
    if (dict.isWord(word)) return true
    if (st.s.source === "list" && parseList(st.s.list, st.s.length).includes(word)) return true
    // the answer itself is always a word (a custom one, or one picked in Sabotage)
    return set.boards.some((b) => b.answer === word)
  }

  const rowsOf = (set, board) => set.words.map((word, i) => ({ word, colors: board.colors[i] ?? null })).filter((r) => r.word && r.colors)

  // Is this word allowed from this set right now? -> a sentence or null
  const guessProblem = (st, set, word) => {
    const s = st.s
    if (word.length < s.length) return "Not enough letters"
    if (word.length > s.length) return "Too many letters"
    if (!accepted(st, set, word)) return "Not in word list"
    if (s.hard) {
      for (const board of set.boards) {
        if (board.solvedAt !== null) continue
        const problem = hardModeError(word, rowsOf(set, board))
        if (problem) return problem
      }
    }
    return null
  }

  // Play a word on a set's boards (null: the clock ran out on this guess)
  const playWord = (st, i, word, seat, ctx) => {
    const set = st.sets[i]
    const row = set.words.length
    set.words.push(word)
    set.by.push(seat)
    set.votes = {}
    set.voteOrder = []
    ctx.cancel(`v${i}`)
    if (word) set.timeouts = 0
    for (const board of set.boards) {
      if (board.solvedAt !== null) {
        board.colors.push(null)
        continue
      }
      if (!word) {
        board.colors.push(null)
        continue
      }
      let colors
      if (board.cand) {
        const step = absurdStep(board.cand, word)
        colors = step.colors
        board.cand = step.candidates
        if (solvedColors(colors)) board.answer = word
      } else colors = score(word, board.answer)
      set.tiles += tilePoints(rowsOf(set, board), { word, colors })
      board.colors.push(colors)
      if (solvedColors(colors)) board.solvedAt = row
    }
    const allSolved = set.boards.every((b) => b.solvedAt !== null)
    const outOfGuesses = set.max && set.words.length >= set.max
    if (st.s.format === "rush") {
      if (allSolved || outOfGuesses) {
        const board = set.boards[0]
        const answer = board.answer || board.cand?.[0]
        set.rush.guesses += set.words.length
        if (allSolved) set.rush.solved++
        else set.rush.failed++
        set.rush.last = { answer, solved: allSolved, words: set.words.length }
        set.words = []
        set.by = []
        set.boards = [newBoard(st, freshWord(st, ctx.random))]
      }
    } else if (allSolved) {
      set.done = true
      set.solved = true
      set.timeMs = ctx.now - st.roundStart
    } else if (outOfGuesses) {
      set.done = true
      set.timeMs = ctx.now - st.roundStart
    }
    if (turnBased(st.s) && !set.done) set.turn = (set.turn + 1) % set.seats.length
    if (set.done) {
      set.deadline = null
      ctx.cancel(`g${i}`)
    } else armGuessClock(st, i, ctx)
    // computer players think again from now
    for (const s of set.seats) delete st.botAt[s]
    return maybeEndRound(st, ctx)
  }

  const maybeEndRound = (st, ctx) => {
    if (st.phase !== "play") return st
    const s = st.s
    if (s.format === "rush") return st // only the clock ends a rush
    if (st.sets.every((set) => set.done)) return endRound(st, ctx, "done")
    // a race for time: the first to solve takes the round
    if (s.format === "race" && s.scoring === "time" && st.sets.length > 1 && st.sets.some((set) => set.solved)) return endRound(st, ctx, "solved")
    return st
  }

  // Co-op voting: play the favorite (most votes; ties: the earliest suggested)
  const playVotes = (st, i, ctx) => {
    const set = st.sets[i]
    const counts = {}
    for (const w of Object.values(set.votes)) counts[w] = (counts[w] || 0) + 1
    const best = set.voteOrder.reduce((top, w) => (top === null || counts[w] > counts[top] ? w : top), null)
    if (!best) return st
    const by = Number(Object.keys(set.votes).find((seat) => set.votes[seat] === best))
    return playWord(st, i, best, by, ctx)
  }

  const suggest = (st, i, seat, word, ctx) => {
    const set = st.sets[i]
    const first = !Object.keys(set.votes).length
    set.votes[seat] = word
    if (!set.voteOrder.includes(word)) set.voteOrder.push(word)
    const members = set.seats.length
    const forIt = Object.values(set.votes).filter((w) => w === word).length
    if (forIt * 2 > members || Object.keys(set.votes).length >= members) return playVotes(st, i, ctx)
    if (first) ctx.after(TIMES.vote, { type: "vote", set: i, row: set.words.length, round: st.round }, `v${i}`)
    return st
  }

  // ---------- the end of a round ----------

  // a set's round, as numbers
  const resultOf = (st, set) => ({
    solved: set.solved,
    guesses: set.words.filter(Boolean).length,
    used: set.words.length,
    timeMs: set.timeMs,
    tiles: set.tiles,
  })

  const roundPoints = (st, set) => {
    const s = st.s
    if (s.format === "rush") return set.rush.solved
    if (s.format === "coop") return set.solved ? 1 : 0
    if (s.scoring === "tiles") return set.tiles + (set.solved ? 10 : 0)
    if (!set.solved) return 0
    if (s.scoring === "time") return 1
    const cap = s.guesses || 12
    return Math.max(1, cap + 1 - set.words.length)
  }

  const endRound = (st, ctx, why) => {
    const s = st.s
    st.phase = "roundOver"
    st.deadline = null
    ctx.cancel("round")
    st.sets.forEach((set, i) => {
      ctx.cancel(`g${i}`)
      ctx.cancel(`v${i}`)
      set.deadline = null
      if (!set.done) {
        set.done = true
        if (set.timeMs === null) set.timeMs = ctx.now - st.roundStart
      }
    })
    const points = st.teams.map(() => 0)
    const results = {}
    let winners = [] // teams that won the round
    if (s.format === "turns") {
      const set = st.sets[0]
      const solvedRow = set.boards.every((b) => b.solvedAt !== null) ? Math.max(...set.boards.map((b) => b.solvedAt)) : -1
      if (solvedRow >= 0) {
        const solver = set.by[solvedRow]
        const team = st.teams.findIndex((t) => t.seats.includes(solver))
        if (team >= 0) {
          points[team] = s.scoring === "tiles" ? set.tiles + 10 : roundPoints(st, set)
          winners = [team]
        }
      }
      results.shared = resultOf(st, set)
    } else {
      for (const set of st.sets) {
        const t = set.team === null ? 0 : set.team
        points[t] = roundPoints(st, set)
        results[t] = { ...resultOf(st, set), rush: set.rush }
      }
      if (s.format === "race" && s.scoring === "time") {
        // the fastest solve
        const solved = st.sets.filter((set) => set.solved)
        const best = Math.min(...solved.map((set) => set.timeMs))
        winners = solved.filter((set) => set.timeMs === best).map((set) => set.team)
        st.teams.forEach((_, t) => (points[t] = winners.includes(t) ? 1 : 0))
      } else {
        const top = Math.max(0, ...points)
        winners = top > 0 ? points.map((p, t) => (p === top ? t : -1)).filter((t) => t >= 0) : []
      }
    }
    // Battle Royale: who's out
    let out = []
    if (s.format === "royale") {
      const alive = aliveTeams(st)
      const ranked = st.sets
        .map((set) => ({ team: set.team, ...resultOf(st, set) }))
        .sort((a, b) => (a.solved !== b.solved ? (a.solved ? -1 : 1) : a.solved ? a.used - b.used || a.timeMs - b.timeMs : b.tiles - a.tiles))
      const unsolved = ranked.filter((r) => !r.solved).map((r) => r.team)
      if (alive.length === 1) out = unsolved
      else if (unsolved.length && unsolved.length < alive.length) out = unsolved
      else {
        // everyone solved (or nobody did): the last one out, unless it's a dead heat
        const last = ranked[ranked.length - 1]
        const prev = ranked[ranked.length - 2]
        const same = prev && prev.solved === last.solved && prev.used === last.used && (last.solved ? prev.timeMs === last.timeMs : prev.tiles === last.tiles)
        if (!same) out = [last.team]
      }
      for (const t of out) st.alive[t] = false
      winners = aliveTeams(st)
      for (const t of winners) points[t] = 1
    }
    points.forEach((p, t) => (st.points[t] += p))
    if (s.format !== "royale") for (const t of winners) st.wins[t]++
    const answers = st.sets.map((set) => set.boards.map((b) => b.answer || b.cand?.[0] || null))
    st.history.push({ round: st.round, answers, points, winners, out, results, why })
    if (st.history.length > 30) st.history.shift()
    if (gameDecided(st)) return finishGame(st)
    st.nextAt = ctx.now + TIMES.roundPause
    ctx.after(TIMES.roundPause, { type: "next", round: st.round }, "next")
    return st
  }

  const gameDecided = (st) => {
    const s = st.s
    if (s.format === "royale") return aliveTeams(st).length <= (st.teams.length === 1 ? 0 : 1) || st.round >= MAX_ROYALE_ROUNDS
    if (s.series === "wins" && st.teams.length > 1) {
      const need = Math.floor(s.rounds / 2) + 1
      if (st.wins.some((w) => w >= need)) return true
    }
    return st.round >= s.rounds
  }

  const finishGame = (st) => {
    const s = st.s
    st.phase = "over"
    const seatsOf = (teams) => teams.flatMap((t) => st.teams[t].seats)
    let teams = []
    let reason = "points"
    if (s.format === "royale") {
      teams = aliveTeams(st)
      reason = st.teams.length === 1 ? (teams.length ? "survived" : "eliminated") : "last standing"
    } else if (st.teams.length === 1) {
      // alone (or Co-op): solving most of the rounds is a win
      const solvedRounds = st.history.filter((h) => (s.format === "rush" ? h.points[0] > 0 : (h.results.shared || h.results[0])?.solved)).length
      teams = solvedRounds * 2 >= st.round && solvedRounds > 0 ? [0] : []
      reason = teams.length ? "solved" : "stumped"
    } else {
      const key = s.series === "wins" ? st.wins : st.points
      const top = Math.max(...key)
      teams = key.map((v, t) => (v === top ? t : -1)).filter((t) => t >= 0)
      // a tie in round wins goes to the points
      if (teams.length > 1 && s.series === "wins") {
        const best = Math.max(...teams.map((t) => st.points[t]))
        teams = teams.filter((t) => st.points[t] === best)
      }
      reason = s.series === "wins" ? "series" : s.format === "rush" ? "rush" : "points"
      if (top === 0) teams = []
      if (teams.length === st.teams.length && teams.length > 1) teams = [] // everyone tied
    }
    const scores = Array(st.n).fill(0)
    st.teams.forEach((t, i) => t.seats.forEach((seat) => (scores[seat] = st.points[i])))
    st.final = { winners: seatsOf(teams), draw: !teams.length && st.teams.length > 1, reason, scores }
    // nobody got the custom word: the one who picked it wins
    if (st.setter !== null && !teams.length) st.final = { winners: [st.setter], draw: false, reason: "stumped", scores }
    return st
  }

  // ---------- computer players ----------

  const levelOf = (st) => st.s.bots || "normal"

  const thinkMs = (st, seat, random, fast = false) => {
    const [lo, hi] = THINK[levelOf(st)]
    let ms = lo + random() * (hi - lo)
    if (st.s.format === "rush") ms *= 0.6
    if (fast) ms *= 0.7
    if (st.s.timer === "guess") ms = Math.min(ms, st.s.timerSecs * 1000 * 0.7)
    if (st.phase === "pick") ms = 1200 + random() * 2500
    return Math.round(ms)
  }

  // What a computer player in `seat` wants to do now, or null
  const botWants = (st, seat) => {
    if (st.phase === "pick") return seat in st.pickFor && !st.picks[seat] ? "pick" : null
    if (st.phase !== "play") return null
    const i = setOfSeat(st, seat)
    if (i < 0) return null
    const set = st.sets[i]
    if (set.done) return null
    if (turnBased(st.s)) return set.seats[set.turn] === seat ? "guess" : null
    if (st.s.format === "coop" && st.s.coopMode === "vote") return set.votes[seat] ? null : "guess"
    // a team shares a board: only its first computer player types
    const firstBot = set.seats.find((s) => st.bots[s])
    if (set.seats.length > 1 && firstBot !== seat) return null
    return "guess"
  }

  const botWord = (st, seat, random) => {
    const i = setOfSeat(st, seat)
    const set = st.sets[i]
    const level = levelOf(st)
    const known = answersFor(st)
    // the unsolved board with the fewest possibilities
    let best = null
    for (const board of set.boards) {
      if (board.solvedAt !== null) continue
      const rows = rowsOf(set, board)
      const n = known.filter((w) => rows.every((r) => score(r.word, w) === r.colors)).length
      if (!best || n < best.n) best = { rows, n }
    }
    const rows = best?.rows || []
    for (let tries = 0; tries < 3; tries++) {
      const word = botGuess({ answers: known, rows, level: tries ? "normal" : level, random, seed: hash(`${st.seed}:${seat}`) })
      if (word && !guessProblem(st, set, word)) return word
    }
    // something that fits everything seen
    const fitting = known.filter((w) => rows.every((r) => score(r.word, w) === r.colors) && !guessProblem(st, set, w))
    return fitting.length ? pickRandom(fitting, random) : null
  }

  const tick = (state, ctx) => {
    const due = []
    let schedule = false
    for (let seat = 0; seat < state.n; seat++) {
      if (!ctx.players[seat]?.bot || !botWants(state, seat)) continue
      const at = state.botAt?.[seat]
      if (at === undefined) schedule = true
      else if (ctx.now >= at) due.push(seat)
    }
    if (!due.length && !schedule) return state
    let st = clone(state)
    st.bots = ctx.players.map((p) => !!p?.bot)
    for (let seat = 0; seat < st.n; seat++) {
      if (st.bots[seat] && botWants(st, seat) && st.botAt[seat] === undefined) st.botAt[seat] = ctx.now + thinkMs(st, seat, ctx.random, !st.sets[setOfSeat(st, seat)]?.words.length)
    }
    for (const seat of due) {
      const want = botWants(st, seat)
      if (!want) continue
      delete st.botAt[seat]
      if (want === "pick") {
        const list = dict.answers(st.s.length)
        st = applyPick(st, seat, pickRandom(list, ctx.random), ctx)
        continue
      }
      const i = setOfSeat(st, seat)
      let word = null
      if (st.s.format === "coop" && st.s.coopMode === "vote") {
        // a good teammate backs a suggestion that fits everything seen so far
        const set = st.sets[i]
        const fitsAll = (w) => set.boards.every((b) => b.solvedAt !== null || rowsOf(set, b).every((r) => score(r.word, w) === r.colors))
        const good = [...new Set(Object.values(set.votes))].filter((w) => fitsAll(w) && !guessProblem(st, set, w))
        if (good.length && ctx.random() < 0.75) word = pickRandom(good, ctx.random)
      }
      word ||= botWord(st, seat, ctx.random)
      if (!word) continue
      if (st.s.format === "coop" && st.s.coopMode === "vote") st = suggest(st, i, seat, word, ctx)
      else st = playWord(st, i, word, seat, ctx)
      if (st.phase !== "play") break
    }
    return st
  }

  // ---------- picking words ----------

  const applyPick = (st, seat, word, ctx) => {
    st.picks[seat] = word
    st.used.push(word)
    const waiting = Object.keys(st.pickFor).filter((s) => !st.picks[s])
    return waiting.length ? st : beginPlay(st, ctx)
  }

  // ---------- the module ----------

  return {
    id: "wordduel",
    name: "Word Duel",
    minPlayers: 1,
    maxPlayers: MAX_PLAYERS,
    seats: (settings) => settings.players,
    spectate: (settings) => settings.spectators !== false,
    defaultSettings: DEFAULTS,
    validateSettings,
    tickMs: 500,
    // the computer players act on the server's ticks (they need time to "think")
    bot: () => null,

    create: ({ players, settings, random, now, after }) => {
      const s = validateSettings(settings)
      if (s.error) throw new Error(s.error)
      const n = players.length
      const setter = s.source === "custom" && n >= 2 ? 0 : null
      const teams = teamsFor(s, n, setter)
      const st = {
        s,
        n,
        names: players.map((p) => p.name),
        bots: players.map((p) => !!p.bot),
        seed: Math.floor(random() * 2 ** 31),
        day: dayKey(new Date(now), utc),
        round: 0,
        phase: "play",
        setter,
        teams,
        alive: teams.map(() => true),
        points: teams.map(() => 0),
        wins: teams.map(() => 0),
        history: [],
        used: [],
        sets: [],
        picks: {},
        pickFor: {},
        botAt: {},
        final: null,
      }
      // a custom word with nobody to guess it: a random word instead
      if (s.source === "custom" && setter === null) st.s = { ...s, source: "random" }
      const ctx = { now, random, after, cancel: () => {}, players }
      return startRound(st, ctx)
    },

    action: (state, seat, action, ctx) => {
      const type = action?.type
      if (seat === null) {
        if (type === "tick") return tick(state, ctx)
        if (action.round !== undefined && action.round !== state.round) return state
        if (type === "next") {
          if (state.phase !== "roundOver") return state
          return startRound(clone(state), ctx)
        }
        if (type === "roundEnd") return state.phase === "play" ? endRound(clone(state), ctx, "time") : state
        if (type === "pickTimeout") {
          if (state.phase !== "pick") return state
          const st = clone(state)
          for (const s of Object.keys(st.pickFor)) if (!st.picks[s]) st.picks[s] = pickRandom(dict.answers(st.s.length), ctx.random)
          return beginPlay(st, ctx)
        }
        if (type === "timeout") {
          const set = state.sets[action.set]
          if (state.phase !== "play" || !set || set.done || set.words.length !== action.row) return state
          const st = clone(state)
          const s2 = st.sets[action.set]
          if (st.s.format === "coop" && st.s.coopMode === "vote" && Object.keys(s2.votes).length) return playVotes(st, action.set, ctx)
          s2.timeouts++
          if (turnBased(st.s)) {
            // the turn passes; nobody loses a guess
            s2.turn = (s2.turn + 1) % s2.seats.length
            for (const x of s2.seats) delete st.botAt[x]
            if (s2.timeouts >= MAX_TIMEOUTS * s2.seats.length) {
              s2.done = true
              return maybeEndRound(st, ctx)
            }
            armGuessClock(st, action.set, ctx)
            return st
          }
          if (s2.timeouts >= MAX_TIMEOUTS && !s2.max) {
            s2.done = true
            s2.timeMs = ctx.now - st.roundStart
            ctx.cancel(`g${action.set}`)
            return maybeEndRound(st, ctx)
          }
          return playWord(st, action.set, null, null, ctx)
        }
        if (type === "vote") {
          const set = state.sets[action.set]
          if (state.phase !== "play" || !set || set.done || set.words.length !== action.row) return state
          return playVotes(clone(state), action.set, ctx)
        }
        return { error: "Nothing to do." }
      }

      if (type === "pick") {
        if (state.phase !== "pick") return { error: "It isn't time to pick a word." }
        if (!(seat in state.pickFor)) return { error: "Someone else is picking the word." }
        if (state.picks[seat]) return { error: "You already picked." }
        const word = cleanWord(action.word)
        const n = state.s.length
        if (word.length !== n) return { error: `Pick a ${n}-letter word.` }
        if (state.s.format === "sabotage") {
          if (!dict.answers(n).includes(word)) return { error: "Pick a common word (one from the answer list)." }
        } else if (state.s.strict && !dict.isWord(word)) return { error: "That isn't in the word list." }
        return applyPick(clone(state), seat, word, ctx)
      }

      if (type === "guess") {
        if (state.phase !== "play") return { error: state.phase === "pick" ? "Waiting for the word to be picked." : "The round is over." }
        const i = setOfSeat(state, seat)
        if (i < 0) return { error: state.setter === seat ? "You picked the word. Watch them squirm!" : "You're out of this round." }
        const set = state.sets[i]
        if (set.done) return { error: set.solved ? "You already solved it!" : "No guesses left this round." }
        if (turnBased(state.s) && set.seats[set.turn] !== seat) return { error: `It's ${state.names[set.seats[set.turn]] || "someone else"}'s turn.` }
        const word = cleanWord(action.word)
        const problem = guessProblem(state, set, word)
        if (problem) return { error: problem }
        const st = clone(state)
        if (st.s.format === "coop" && st.s.coopMode === "vote") {
          if (set.votes[seat] === word) return { error: "You already suggested that." }
          return suggest(st, i, seat, word, ctx)
        }
        return playWord(st, i, word, seat, ctx)
      }
      return { error: "That isn't a move." }
    },

    view: (st, seat) => {
      const s = st.s
      const me = seat ?? null
      const mine = me === null ? -1 : setOfSeat(st, me)
      const watching = me === null || me === st.setter
      const roundDone = st.phase === "roundOver" || st.phase === "over"
      const sets = st.sets.map((set, i) => {
        const own = i === mine
        const level = own || watching || roundDone ? "full" : s.show
        const v = {
          team: set.team,
          seats: set.seats,
          words: set.words.length,
          max: set.max,
          done: set.done,
          solved: set.solved,
          timeMs: set.timeMs,
          tiles: set.tiles,
          deadline: set.deadline,
          turnSeat: turnBased(s) ? set.seats[set.turn] : null,
          rush: set.rush && { solved: set.rush.solved, failed: set.rush.failed, last: own || roundDone ? set.rush.last : set.rush.last && { solved: set.rush.last.solved } },
          boards: set.boards.map((b) => ({
            solvedAt: b.solvedAt,
            left: own && b.cand ? b.cand.length : undefined,
            rows: level === "none" ? [] : set.words.map((w, k) => (level === "full" ? { word: w, colors: b.colors[k] } : { colors: b.colors[k] })),
          })),
        }
        if (own && s.format === "coop" && s.coopMode === "vote") v.votes = Object.entries(set.votes).map(([by, word]) => ({ seat: Number(by), word }))
        return v
      })
      const picking = st.phase === "pick"
      return {
        phase: st.phase,
        round: st.round,
        rounds: s.format === "royale" ? null : s.rounds,
        settings: s,
        names: st.names,
        you: me,
        setter: st.setter,
        mine,
        teams: st.teams.map((t, i) => ({ seats: t.seats, points: st.points[i], wins: st.wins[i], alive: st.alive[i] })),
        sets,
        roundStart: st.roundStart,
        deadline: st.deadline,
        nextAt: st.nextAt,
        pick: picking
          ? {
              deadline: st.pickDeadline,
              you: me !== null && me in st.pickFor,
              done: Object.keys(st.picks).map(Number),
              waiting: Object.keys(st.pickFor).filter((x) => !st.picks[x]).map(Number),
              target: me !== null && me in st.pickFor ? st.pickFor[me] : null,
              yours: me !== null ? st.picks[me] || null : null,
            }
          : null,
        // the word you chose for someone (custom words, Sabotage)
        secret: me !== null && st.picks[me] ? st.picks[me] : null,
        history: st.history,
        final: st.final,
      }
    },

    isOver: (st) => (st.phase === "over" ? st.final : null),
  }
}
