// Imposter's rules: everyone gets the secret word except the imposter(s); players take turns
// giving a clue, talk it over, then vote someone out. Plain ES module with no I/O: the room
// system runs it on the server for online games (server/arcade/games/imposter.js, which
// decides the roles so nobody can peek) and local.js runs it in the browser for pass-and-play.
//
// Phases of a round: reveal (everyone looks at their card) -> clues (turns, N rounds) ->
// discuss (optional) -> vote (maybe a revote) -> guess (a caught imposter names the word)
// -> result. In "elimination" a wrong vote sends the survivors back to clues.

import { CATEGORIES, CATEGORY_IDS, DEFAULT_CATEGORIES, parseCustom } from "./words.js"

export const MIN_PLAYERS = 3
export const MAX_PLAYERS = 20
const CLUE_MAX = 40

export const DEFAULTS = {
  players: 8, // seats in an online room (pass-and-play counts the names)
  imposters: 1,
  randomImposters: false, // 1..imposters, picked each round
  zeroChance: 0, // % chance of a round with no imposter at all
  impostersKnow: false, // imposters see each other
  categories: DEFAULT_CATEGORIES,
  custom: "", // custom words, one per line ("word" or "word:close word")
  customOnly: false,
  imposterInfo: "category", // none | category | hint | decoy | undercover
  crewSeeCategory: true,
  clueMode: "spoken", // spoken (say it, tap Done) | typed
  clueRounds: 2,
  clueTime: 0, // seconds per clue, 0 = no clock
  discussTime: 60, // seconds, 0 = until everyone's ready, -1 = no discussion
  voteStyle: "secret", // secret | open (votes show as they come) | group (one shared pick)
  voteTime: 0,
  allowSkip: true, // "No one / skip" is a choice
  tieRule: "revote", // revote | noone | random | all
  voteMode: "once", // once | elimination (keep going until the imposters are out)
  guessWhen: "caught", // off | caught | anytime
  guessStyle: "choice", // choice (pick from 8) | type
  starter: "random", // random | rotate
  imposterNotFirst: true,
  scoring: true,
  length: "rounds", // rounds | score | endless
  lengthN: 5,
  revealRoles: true,
}

export const PRESETS = {
  classic: { label: "Classic", settings: {} },
  quick: { label: "Quick", settings: { clueRounds: 1, clueTime: 20, discussTime: -1, voteTime: 30, length: "rounds", lengthN: 3 } },
  undercover: { label: "Undercover", settings: { imposterInfo: "undercover", clueRounds: 2, guessWhen: "off", crewSeeCategory: false } },
  chaos: { label: "Chaos", settings: { imposters: 3, randomImposters: true, zeroChance: 20, imposterInfo: "none", guessWhen: "anytime", tieRule: "random", imposterNotFirst: false, voteStyle: "open" } },
}
export const presetSettings = (id, base = DEFAULTS) => validateSettings({ ...base, ...DEFAULTS, players: base.players, categories: base.categories, custom: base.custom, ...(PRESETS[id]?.settings || {}) })

const pick = (v, list, fallback) => (list.includes(v) ? v : fallback)
const int = (v, lo, hi, fallback) => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback
}
const bool = (v, fallback) => (typeof v === "boolean" ? v : fallback)

export const validateSettings = (s = {}) => {
  if (!s || typeof s !== "object") return { ...DEFAULTS }
  const categories = Array.isArray(s.categories) ? [...new Set(s.categories.filter((c) => CATEGORY_IDS.includes(c)))] : DEFAULTS.categories
  const custom = parseCustom(s.custom).slice(0, 60).map(([w, c]) => (c ? `${w}:${c}` : w)).join("\n")
  const customOnly = bool(s.customOnly, false) && !!custom
  const out = {
    players: int(s.players, MIN_PLAYERS, MAX_PLAYERS, DEFAULTS.players),
    imposters: int(s.imposters, 1, 9, 1),
    randomImposters: bool(s.randomImposters, false),
    zeroChance: int(s.zeroChance, 0, 50, 0),
    impostersKnow: bool(s.impostersKnow, false),
    categories: categories.length || custom ? categories : DEFAULTS.categories,
    custom,
    customOnly,
    imposterInfo: pick(s.imposterInfo, ["none", "category", "hint", "decoy", "undercover"], DEFAULTS.imposterInfo),
    crewSeeCategory: bool(s.crewSeeCategory, true),
    clueMode: pick(s.clueMode, ["spoken", "typed"], "spoken"),
    clueRounds: int(s.clueRounds, 1, 5, 2),
    clueTime: int(s.clueTime, 0, 180, 0),
    discussTime: int(s.discussTime, -1, 600, 60),
    voteStyle: pick(s.voteStyle, ["secret", "open", "group"], "secret"),
    voteTime: int(s.voteTime, 0, 300, 0),
    allowSkip: bool(s.allowSkip, true),
    tieRule: pick(s.tieRule, ["revote", "noone", "random", "all"], "revote"),
    voteMode: pick(s.voteMode, ["once", "elimination"], "once"),
    guessWhen: pick(s.guessWhen, ["off", "caught", "anytime"], "caught"),
    guessStyle: pick(s.guessStyle, ["choice", "type"], "choice"),
    starter: pick(s.starter, ["random", "rotate"], "random"),
    imposterNotFirst: bool(s.imposterNotFirst, true),
    scoring: bool(s.scoring, true),
    length: pick(s.length, ["rounds", "score", "endless"], "rounds"),
    lengthN: int(s.lengthN, 1, 50, 5),
    revealRoles: bool(s.revealRoles, true),
  }
  if (!out.scoring && out.length === "score") out.length = "rounds"
  // "no imposter" rounds need a way to say so
  if (out.zeroChance > 0) out.allowSkip = true
  return out
}

// A one-line summary for the setup screen
export const describe = (s) => {
  const imp = s.randomImposters ? `1-${s.imposters} imposters` : `${s.imposters} imposter${s.imposters === 1 ? "" : "s"}`
  const len = s.length === "endless" ? "no end" : s.length === "score" ? `first to ${s.lengthN}` : `${s.lengthN} round${s.lengthN === 1 ? "" : "s"}`
  return `${imp} · ${s.clueRounds} clue round${s.clueRounds === 1 ? "" : "s"} · ${len}`
}

// the most imposters a table of n may have (always fewer than the crew)
export const maxImposters = (n) => Math.max(1, Math.floor((n - 1) / 2))

const shuffle = (list, random) => {
  const a = [...list]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// every word this game may use: [{ key, word, close, category }]
export const wordPool = (s) => {
  const pool = []
  if (!s.customOnly) {
    for (const id of s.categories) for (const [word, close] of CATEGORIES[id].words) pool.push({ key: `${id}:${word}`, word, close, category: CATEGORIES[id].name, cat: id })
  }
  for (const [word, close] of parseCustom(s.custom)) pool.push({ key: `custom:${word}`, word, close, category: "Custom words", cat: "custom" })
  return pool
}

// Words match loosely: case, spaces, punctuation and a trailing "s" don't matter
export const normalize = (w) =>
  String(w || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "")
// "bus" / "buses", "pizza" / "pizzas"
const forms = (n) => [n, n.replace(/s$/, ""), n.replace(/es$/, "")].filter((f) => f.length > 1)
export const sameWord = (a, b) => {
  const fa = forms(normalize(a))
  const fb = forms(normalize(b))
  return fa.some((f) => fb.includes(f))
}
// does a clue give the word away? ("Hot dogs", "a pizza" yes; "catch" for "cat" no)
export const saysWord = (text, word) => {
  const w = normalize(word)
  if (!w) return false
  if (String(text).split(/\s+/).some((part) => sameWord(part, word))) return true
  return /\s/.test(word.trim()) && normalize(text).includes(w)
}

// ---------- a game ----------

export const create = ({ players, settings, random = Math.random, now = Date.now(), after }) => {
  const s = validateSettings(settings)
  const state = {
    settings: s,
    names: players.map((p) => p.name || `Player ${p.id + 1}`),
    left: players.map(() => false),
    scores: players.map(() => 0),
    roundNo: 0,
    used: [],
    stamp: 0,
    starter: Math.floor(random() * players.length),
    over: null,
    history: [],
  }
  return startRound(state, { random, now, after })
}

const activeSeats = (state) => state.names.map((_, i) => i).filter((i) => !state.left[i])
const inRound = (state) => activeSeats(state).filter((i) => !state.round.out.includes(i))
const isImposter = (state, seat) => state.round.imposters.includes(seat)

// set the phase's clock (or none) and invalidate older timers
const enter = (state, phase, ctx, seconds = 0, extra = {}) => {
  const stamp = state.stamp + 1
  const next = { ...state, stamp, phase, round: { ...state.round, deadline: seconds > 0 ? ctx.now + seconds * 1000 : null, ...extra } }
  if (seconds > 0) ctx.after?.(seconds * 1000, { type: "timeout", stamp }, "phase")
  else ctx.cancel?.("phase")
  return next
}

export const startRound = (state, ctx) => {
  const s = state.settings
  const random = ctx.random || Math.random
  const seats = activeSeats(state)
  const n = seats.length
  // the word: one not used lately
  let pool = wordPool(s)
  if (!pool.length) pool = wordPool(DEFAULTS)
  const fresh = pool.filter((w) => !state.used.includes(w.key))
  const choice = (fresh.length ? fresh : pool)[Math.floor(random() * (fresh.length ? fresh : pool).length)]
  const used = [...(fresh.length ? state.used : []), choice.key].slice(-200)
  // a close word for decoys: the pair's own, else another word from the same category
  let close = choice.close
  if (!close) {
    const others = pool.filter((w) => w.cat === choice.cat && w.word !== choice.word)
    close = others.length ? others[Math.floor(random() * others.length)].word : ""
  }
  // the imposters
  let count = Math.min(s.imposters, maxImposters(n))
  if (s.randomImposters) count = 1 + Math.floor(random() * count)
  if (s.zeroChance > 0 && random() * 100 < s.zeroChance) count = 0
  const imposters = shuffle(seats, random).slice(0, count).sort((a, b) => a - b)
  // speaking order, starting from the starter (the next active seat), imposters not first
  let first = s.starter === "rotate" ? state.starter : seats[Math.floor(random() * n)]
  if (!seats.includes(first)) first = seats.find((i) => i > first) ?? seats[0]
  let order = [...seats.filter((i) => i >= first), ...seats.filter((i) => i < first)]
  if (s.imposterNotFirst && imposters.includes(order[0]) && imposters.length < n) {
    const k = order.findIndex((i) => !imposters.includes(i))
    order = [...order.slice(k), ...order.slice(0, k)]
  }
  const round = {
    word: choice.word,
    close,
    category: choice.category,
    cat: choice.cat,
    imposters,
    out: [],
    acks: [],
    order,
    turn: 0,
    clueRound: 1,
    clues: [],
    ready: [],
    votes: {},
    voteRound: 1,
    candidates: null,
    tally: null,
    ejected: [],
    guessers: [],
    guesses: {},
    choices: null,
    outcome: null,
    points: null,
    deadline: null,
    cycle: 1,
  }
  const next = { ...state, roundNo: state.roundNo + 1, used, starter: (order[0] + 1) % state.names.length, round }
  return enter(next, "reveal", ctx)
}

// What each player's card says
const cardFor = (state, seat) => {
  const s = state.settings
  const r = state.round
  if (seat == null || state.left[seat]) return null
  const imp = isImposter(state, seat)
  const crewCategory = s.crewSeeCategory ? r.category : null
  if (!imp) return { role: "crew", word: r.word, category: crewCategory }
  const info = s.imposterInfo
  if (info === "undercover") return { role: "crew", word: r.close || r.word, category: crewCategory, undercover: true }
  const card = { role: "imposter", word: null, category: null, hint: null }
  if (info === "category" || info === "hint" || info === "decoy") card.category = r.category
  if (info === "hint") card.hint = r.close || null
  if (info === "decoy") card.word = r.close || null
  if (s.impostersKnow) card.partners = r.imposters.filter((i) => i !== seat)
  return card
}

const clueSpeaker = (state) => {
  const order = state.round.order.filter((i) => inRound(state).includes(i))
  return order[state.round.turn] ?? null
}

const startClues = (state, ctx) => enter(state, "clues", ctx, state.settings.clueTime, { turn: 0, clueRound: 1 })

const advanceClue = (state, ctx, text) => {
  const r = state.round
  const speaker = clueSpeaker(state)
  const clues = [...r.clues, { seat: speaker, text, round: r.clueRound, cycle: r.cycle }]
  const order = r.order.filter((i) => inRound(state).includes(i))
  let turn = r.turn + 1
  let clueRound = r.clueRound
  if (turn >= order.length) {
    turn = 0
    clueRound++
  }
  const next = { ...state, round: { ...r, clues, turn, clueRound } }
  if (clueRound > state.settings.clueRounds) return startDiscuss(next, ctx)
  return enter(next, "clues", ctx, state.settings.clueTime)
}

const startDiscuss = (state, ctx) => {
  const t = state.settings.discussTime
  if (t < 0) return startVote(state, ctx)
  return enter(state, "discuss", ctx, t, { ready: [] })
}

const startVote = (state, ctx, candidates = null) =>
  enter(state, "vote", ctx, state.settings.voteTime, { votes: {}, candidates, voteRound: candidates ? 2 : 1 })

const voters = (state) => inRound(state)

// Count the votes -> who's out (maybe a revote first)
const tallyVotes = (state, ctx) => {
  const r = state.round
  const s = state.settings
  const tally = {}
  for (const seat of voters(state)) {
    const v = r.votes[seat]
    if (v === undefined) continue // no vote in time: abstains
    tally[v] = (tally[v] || 0) + 1
  }
  const top = Math.max(0, ...Object.values(tally))
  const leaders = Object.keys(tally).filter((k) => tally[k] === top).map(Number)
  let ejected = []
  if (top === 0) ejected = []
  else if (leaders.length === 1) ejected = leaders[0] === -1 ? [] : leaders
  else {
    const people = leaders.filter((k) => k !== -1)
    if (s.tieRule === "revote" && r.voteRound === 1 && people.length >= 2) {
      return startVote({ ...state, round: { ...r, tally } }, ctx, people)
    }
    if (s.tieRule === "random" && people.length) ejected = [people[Math.floor((ctx.random || Math.random)() * people.length)]]
    else if (s.tieRule === "all" && !leaders.includes(-1)) ejected = people
    else ejected = []
  }
  return afterVote({ ...state, round: { ...r, tally, ejected } }, ctx)
}

const afterVote = (state, ctx) => {
  const r = state.round
  const s = state.settings
  const out = [...r.out, ...r.ejected]
  const caught = r.ejected.filter((i) => r.imposters.includes(i))
  const next = { ...state, round: { ...r, out } }
  if (!r.imposters.length) return finishRound(next, ctx, r.ejected.length ? "none-lose" : "none-win")
  const remainingImp = r.imposters.filter((i) => !out.includes(i))
  const remainingCrew = inRound(next).filter((i) => !r.imposters.includes(i))
  const crewWins = s.voteMode === "once" ? caught.length > 0 : remainingImp.length === 0
  if (crewWins) {
    if (s.guessWhen !== "off" && caught.length) return startGuess(next, ctx, caught)
    return finishRound(next, ctx, "crew")
  }
  if (s.voteMode === "elimination" && remainingImp.length < remainingCrew.length && remainingCrew.length > 1) {
    // a wrong guess (or nobody): the survivors go round again
    return enter({ ...next, round: { ...next.round, cycle: r.cycle + 1, votes: {}, candidates: null, voteRound: 1 } }, "clues", ctx, s.clueTime, { turn: 0, clueRound: 1 })
  }
  return finishRound(next, ctx, "imposters")
}

const startGuess = (state, ctx, guessers) => {
  const r = state.round
  let choices = null
  if (state.settings.guessStyle === "choice") {
    const pool = wordPool(state.settings).filter((w) => w.cat === r.cat && !sameWord(w.word, r.word))
    const decoys = shuffle(pool, ctx.random || Math.random).slice(0, 7).map((w) => w.word)
    if (r.close && !decoys.some((d) => sameWord(d, r.close)) && !sameWord(r.close, r.word)) decoys[0] = r.close
    choices = shuffle([r.word, ...decoys.filter(Boolean)], ctx.random || Math.random)
  }
  return enter(state, "guess", ctx, 0, { guessers, guesses: {}, choices, guessFrom: state.phase })
}

// Points: crew +1 each when they win, +1 more for voting an imposter; imposters +2 for
// staying hidden, +3 for naming the word; a no-imposter round: +1 for each "no one" vote
const pointsFor = (state, outcome) => {
  const r = state.round
  const pts = {}
  const add = (seat, n) => (pts[seat] = (pts[seat] || 0) + n)
  const crew = activeSeats(state).filter((i) => !r.imposters.includes(i))
  if (outcome === "crew") {
    crew.forEach((i) => add(i, 1))
    crew.forEach((i) => r.imposters.includes(r.votes[i]) && add(i, 1))
  } else if (outcome === "imposters") r.imposters.forEach((i) => add(i, 2))
  else if (outcome === "stolen") r.imposters.forEach((i) => add(i, r.guessedBy === i ? 3 : 2))
  else if (outcome === "none-win") crew.forEach((i) => (r.votes[i] == null || r.votes[i] === -1) && add(i, 1))
  return pts
}

const finishRound = (state, ctx, outcome, extra = {}) => {
  const s = state.settings
  const round = { ...state.round, ...extra, outcome }
  let next = { ...state, round }
  const points = s.scoring ? pointsFor(next, outcome) : {}
  const scores = next.scores.map((v, i) => v + (points[i] || 0))
  const history = [...state.history, { word: round.word, outcome, imposters: round.imposters }].slice(-50)
  next = enter({ ...next, scores, history, round: { ...round, points } }, "result", ctx)
  const done = s.length === "rounds" ? next.roundNo >= s.lengthN : s.length === "score" ? Math.max(...scores) >= s.lengthN : false
  return { ...next, gameDone: done }
}

const endGame = (state, reason = "done") => {
  const active = activeSeats(state)
  const best = Math.max(...active.map((i) => state.scores[i]))
  const winners = state.settings.scoring ? active.filter((i) => state.scores[i] === best) : []
  return { ...state, over: { winners, draw: !winners.length || winners.length === active.length, reason } }
}

// ---------- moves ----------

export const action = (state, seat, a, ctx = {}) => {
  if (!a || typeof a !== "object") return { error: "That isn't a move." }
  if (state.over) return { error: "The game is over." }
  const r = state.round
  const s = state.settings
  const playing = seat != null && inRound(state).includes(seat)

  if (seat == null) {
    if (a.type !== "timeout" || a.stamp !== state.stamp) return state
    if (state.phase === "clues") return advanceClue(state, ctx, "")
    if (state.phase === "discuss") return startVote(state, ctx)
    if (state.phase === "vote") return tallyVotes(state, ctx)
    return state
  }
  if (state.left[seat]) return { error: "You left this game." }

  switch (a.type) {
    case "ack": {
      if (state.phase !== "reveal") return state
      if (r.acks.includes(seat)) return state
      const acks = [...r.acks, seat]
      const next = { ...state, round: { ...r, acks } }
      return activeSeats(state).every((i) => acks.includes(i)) ? startClues(next, ctx) : next
    }
    case "clue": {
      if (state.phase !== "clues") return { error: "It isn't time for clues." }
      if (clueSpeaker(state) !== seat) return { error: "It isn't your turn." }
      const text = String(a.text || "").replace(/\s+/g, " ").trim().slice(0, CLUE_MAX)
      if (s.clueMode === "typed" && !text) return { error: "Type a clue first." }
      // only the crew is stopped (stopping an imposter would tell them the word)
      if (text && !isImposter(state, seat) && saysWord(text, r.word)) return { error: "You can't say the word itself!" }
      return advanceClue(state, ctx, text)
    }
    case "ready": {
      if (state.phase !== "discuss" || !playing) return state
      const ready = r.ready.includes(seat) ? r.ready.filter((i) => i !== seat) : [...r.ready, seat]
      const next = { ...state, round: { ...r, ready } }
      return voters(state).every((i) => ready.includes(i)) ? startVote(next, ctx) : next
    }
    case "vote": {
      if (state.phase !== "vote") return { error: "It isn't time to vote." }
      if (!playing && s.voteStyle !== "group") return { error: "You're out of this round." }
      const target = Number(a.target)
      const allowed = r.candidates || inRound(state)
      if (target === -1 ? !s.allowSkip || r.candidates : !allowed.includes(target)) return { error: "You can't vote for that." }
      if (s.voteStyle === "group") {
        // one shared pick for the whole table (everyone talks it over out loud)
        const votes = Object.fromEntries(voters(state).map((i) => [i, target]))
        return tallyVotes({ ...state, round: { ...r, votes, group: true } }, ctx)
      }
      if (target === seat) return { error: "You can't vote for yourself." }
      const votes = { ...r.votes, [seat]: target }
      const next = { ...state, round: { ...r, votes } }
      return voters(state).every((i) => votes[i] !== undefined) ? tallyVotes(next, ctx) : next
    }
    case "unvote": {
      if (state.phase !== "vote" || r.votes[seat] === undefined) return state
      const votes = { ...r.votes }
      delete votes[seat]
      return { ...state, round: { ...r, votes } }
    }
    case "guess": {
      const word = String(a.word || "").slice(0, 40)
      if (!word.trim()) return { error: "Pick a word." }
      if (state.phase === "guess") {
        if (!r.guessers.includes(seat) || r.guesses[seat] !== undefined) return { error: "It isn't your guess." }
        const right = sameWord(word, r.word)
        if (right) return finishRound(state, ctx, "stolen", { guessedBy: seat, guessWord: word, guessRight: true })
        const guesses = { ...r.guesses, [seat]: word }
        if (r.guessers.every((i) => guesses[i] !== undefined)) return finishRound({ ...state, round: { ...r, guesses } }, ctx, "crew", { guessWord: word, guessRight: false })
        return { ...state, round: { ...r, guesses } }
      }
      // a guess any time (Chaos): right steals the round, wrong hands it to the crew
      if (s.guessWhen !== "anytime" || !["clues", "discuss", "vote"].includes(state.phase)) return { error: "You can't guess now." }
      if (!isImposter(state, seat) || s.imposterInfo === "undercover" || r.out.includes(seat)) return { error: "Only an imposter can guess the word." }
      const right = sameWord(word, r.word)
      return finishRound(state, ctx, right ? "stolen" : "crew", { guessedBy: seat, guessWord: word, guessRight: right, early: true })
    }
    case "next": {
      if (state.phase !== "result") return state
      if (state.gameDone) return endGame(state)
      if (activeSeats(state).length < MIN_PLAYERS) return endGame(state, "players")
      return startRound({ ...state, gameDone: false }, ctx)
    }
    case "end": {
      if (state.phase !== "result") return { error: "Finish the round first." }
      return endGame(state)
    }
    default:
      return { error: "That isn't a move." }
  }
}

// A player left for good: the game carries on without them when it can
export const onLeave = (state, seat, ctx = {}) => {
  if (state.over) return state
  const left = state.left.map((v, i) => v || i === seat)
  let next = { ...state, left }
  if (activeSeats(next).length < MIN_PLAYERS) return endGame(next, "players")
  const r = next.round
  if (state.phase === "reveal") {
    if (activeSeats(next).every((i) => r.acks.includes(i))) return startClues(next, ctx)
    return next
  }
  if (r.imposters.includes(seat) && r.imposters.every((i) => left[i] || r.out.includes(i)) && state.phase !== "result") {
    return finishRound({ ...next, round: { ...r, out: [...r.out, seat] } }, ctx, "crew", { imposterLeft: true })
  }
  if (state.phase === "clues") {
    // their turn: the next speaker goes
    const order = r.order.filter((i) => inRound(state).includes(i))
    const k = order.indexOf(seat)
    const turn = k >= 0 && k < r.turn ? r.turn - 1 : r.turn
    const remaining = r.order.filter((i) => inRound(next).includes(i))
    if (turn >= remaining.length) return advanceClue({ ...next, round: { ...r, turn: remaining.length - 1 } }, ctx, "")
    return { ...next, round: { ...r, turn } }
  }
  if (state.phase === "discuss" && voters(next).every((i) => r.ready.includes(i))) return startVote(next, ctx)
  if (state.phase === "vote" && voters(next).every((i) => r.votes[i] !== undefined)) return tallyVotes(next, ctx)
  if (state.phase === "guess" && r.guessers.every((i) => left[i] || r.guesses[i] !== undefined)) return finishRound(next, ctx, "crew")
  return next
}

export const isOver = (state) => state.over

// ---------- what one player sees ----------

export const view = (state, seat) => {
  const r = state.round
  const s = state.settings
  const showAll = state.phase === "result" || !!state.over
  const secret = s.voteStyle === "secret" && state.phase === "vote"
  const me = seat == null ? null : seat
  const card = cardFor(state, me)
  const players = state.names.map((name, i) => ({
    seat: i,
    name,
    left: state.left[i],
    out: r.out.includes(i),
    score: state.scores[i],
    acked: r.acks.includes(i),
    ready: r.ready.includes(i),
    voted: r.votes[i] !== undefined,
  }))
  const v = {
    phase: state.over ? "over" : state.phase,
    roundNo: state.roundNo,
    gameDone: !!state.gameDone,
    you: me,
    players,
    card,
    order: r.order.filter((i) => !state.left[i] && !r.out.includes(i)),
    speaker: state.phase === "clues" ? clueSpeaker(state) : null,
    clueRound: r.clueRound,
    cycle: r.cycle,
    clues: r.clues,
    candidates: r.candidates,
    votes: secret ? (me != null && r.votes[me] !== undefined ? { [me]: r.votes[me] } : {}) : r.votes,
    tally: state.phase === "vote" && !r.candidates ? null : r.tally,
    deadline: r.deadline,
    out: r.out,
    ejected: state.phase === "vote" ? [] : r.ejected,
    imposterCount: s.randomImposters || s.zeroChance ? null : r.imposters.length,
    settings: s,
    scores: state.scores,
    over: state.over,
  }
  if (state.phase === "guess") {
    v.guessers = r.guessers
    v.guesses = Object.keys(r.guesses).map(Number)
    if (me != null && r.guessers.includes(me)) v.choices = r.choices
  }
  if (me != null && card?.partners) v.partners = card.partners
  if (showAll) {
    v.result = {
      word: r.word,
      close: r.close,
      category: r.category,
      outcome: r.outcome,
      imposters: s.revealRoles || r.outcome !== "imposters" ? r.imposters : r.imposters.filter((i) => i === me),
      rolesHidden: !s.revealRoles && r.outcome === "imposters",
      ejected: r.ejected,
      guessedBy: r.guessedBy ?? null,
      guessWord: r.guessWord ?? null,
      guessRight: !!r.guessRight,
      early: !!r.early,
      points: r.points || {},
      imposterLeft: !!r.imposterLeft,
    }
    v.votes = r.votes
  }
  return v
}
