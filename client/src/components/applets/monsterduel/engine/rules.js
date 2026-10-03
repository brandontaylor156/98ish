// Monster Duel as a match: deck choice, one or three duels, clocks and computer players,
// in the shape the online room system wants (server/arcade/rooms.js: create / action /
// view / isOver / bot). The game server and the browser (games against the computer, the
// tutorial: local.js) run this same file. The duel itself is engine.js.
//
// Stages: "decks" (both players pick a deck; decks are checked against the card pool),
// "duel", "between" (best of three: the loser of the last duel goes first next), "over".

import { STARTERS, starterById, validateDeck } from "./decks.js"
import { act as duelAct, autoAnswer, legal, newDuel, setPref, setRandom, view as duelView } from "./engine.js"
import { chooseMove } from "./ai.js"

export const DEFAULT_SETTINGS = { bestOf: 1, turnTime: 180, lp: 8000 }
export const TURN_TIMES = [0, 60, 120, 180, 300]
export const LIFE_POINTS = [4000, 8000, 16000]
export const BEST_OF = [1, 3]

const TIMES = { decks: 120_000, respond: 25_000, choose: 40_000, between: 20_000 }
const MAX_GAMES = 5

export const validateSettings = (raw = {}) => {
  const s = { ...DEFAULT_SETTINGS, ...raw }
  const bestOf = Number(s.bestOf)
  const turnTime = Number(s.turnTime)
  const lp = Number(s.lp)
  if (!BEST_OF.includes(bestOf)) return { error: "Play one duel or best of three." }
  if (!TURN_TIMES.includes(turnTime)) return { error: "Pick a turn time from the list." }
  if (!LIFE_POINTS.includes(lp)) return { error: "Pick 4000, 8000 or 16000 Life Points." }
  return { bestOf, turnTime, lp }
}

const clone = (x) => (typeof structuredClone === "function" ? structuredClone(x) : JSON.parse(JSON.stringify(x)))
const other = (s) => 1 - s

// players: [{ id, name, bot }]; settings (checked); extra for games in the browser:
// ai: [{ level, style, deck } | null per seat], tutorial (decks in order, you go first)
export const create = ({ players, settings, random = Math.random, now = Date.now(), after = () => {} }) => {
  const s = { ...DEFAULT_SETTINGS, ...settings }
  const state = {
    stage: "decks",
    settings: { bestOf: s.bestOf, turnTime: s.turnTime, lp: s.lp },
    names: players.map((p) => p.name || "Duelist"),
    bots: players.map((p) => !!p.bot),
    ai: Array.isArray(s.ai) ? s.ai : [null, null],
    tutorial: !!s.tutorial,
    decks: [null, null],
    deckNames: [null, null],
    prefs: ["auto", "auto"],
    wins: [0, 0],
    game: 0,
    results: [],
    duel: null,
    ready: [false, false],
    winner: null,
    reason: null,
    stageEnds: now + TIMES.decks,
    turnEnds: null,
    waitEnds: null,
  }
  if (!state.tutorial && s.turnTime) after(TIMES.decks, { type: "timeout", kind: "decks" }, "stage")
  return state
}

const randomStarter = (random) => STARTERS[Math.floor(random() * STARTERS.length)]

const startDuel = (st, ctx) => {
  st.game++
  const first = st.tutorial ? 0 : st.game === 1 ? (ctx.random() < 0.5 ? 0 : 1) : st.firstNext ?? 0
  st.duel = newDuel({ decks: st.decks, names: st.names, first, lp: st.settings.lp, noShuffle: st.tutorial, prefs: st.prefs })
  st.stage = "duel"
  st.stageEnds = null
  st.ready = [false, false]
  st.turnEnds = null
  st.waitEnds = null
  clocks(st, ctx, null)
  if (st.duel.over) endDuel(st, ctx)
}

// the turn clock and the answer clock (a response window, a choice)
const clocks = (st, ctx, before) => {
  const d = st.duel
  const t = st.settings.turnTime
  if (!t || st.stage !== "duel") return
  if (!before || before.turn !== d.turn) {
    ctx.after(t * 1000, { type: "timeout", kind: "turn", turn: d.turn }, "turn")
    st.turnEnds = ctx.now + t * 1000
  }
  if (d.wait && (!before || before.stamp !== d.wait.stamp)) {
    const ms = d.wait.kind === "respond" ? TIMES.respond : TIMES.choose
    ctx.after(ms, { type: "timeout", kind: "wait", stamp: d.wait.stamp }, "wait")
    st.waitEnds = ctx.now + ms
  } else if (!d.wait && before?.stamp != null) {
    ctx.cancel?.("wait")
    st.waitEnds = null
  }
}

const endDuel = (st, ctx) => {
  const d = st.duel
  const w = d.over.winner
  st.results.push({ winner: w, reason: d.over.reason, lp: d.p.map((p) => p.lp), turns: d.turn })
  if (w != null) st.wins[w]++
  ctx.cancel?.("turn")
  ctx.cancel?.("wait")
  st.turnEnds = null
  st.waitEnds = null
  const need = Math.ceil(st.settings.bestOf / 2)
  const decided = w != null && st.wins[w] >= need
  if (decided || st.settings.bestOf === 1 || st.game >= MAX_GAMES) {
    st.stage = "over"
    st.winner = decided || st.wins[0] !== st.wins[1] ? (st.wins[0] > st.wins[1] ? 0 : 1) : null
    st.reason = d.over.reason
    return
  }
  st.stage = "between"
  st.firstNext = w == null ? other(d.first) : other(w)
  st.ready = [...st.bots]
  st.stageEnds = ctx.now + TIMES.between
  ctx.after(TIMES.between, { type: "timeout", kind: "between", game: st.game }, "stage")
}

const timeUp = (d, turn) => {
  for (let i = 0; i < 80 && !d.over && d.turn === turn; i++) {
    if (d.wait) {
      const a = autoAnswer(d, d.wait.seat)
      if (!a || duelAct(d, d.wait.seat, a).error) break
    } else if (duelAct(d, d.active, { type: "phase", to: "end" }).error) break
  }
}

// a move. seat null: the server (clocks)
export const action = (state, seat, a, ctx = {}) => {
  if (!a || typeof a !== "object") return { error: "That isn't a move." }
  setRandom(ctx.random || Math.random)
  const c = { now: Date.now(), random: Math.random, after: () => {}, cancel: () => {}, ...ctx }
  if (state.stage === "over") return { error: "The match is over." }
  const st = clone(state)

  if (a.type === "prefs") {
    if (seat == null || !["always", "auto", "never"].includes(a.respond)) return { error: "Pick when to be asked." }
    st.prefs[seat] = a.respond
    if (st.duel) setPref(st.duel, seat, a.respond)
    return st
  }

  if (st.stage === "decks") {
    if (a.type === "timeout" && seat == null) {
      for (const s of [0, 1])
        if (!st.decks[s]) {
          const pick = randomStarter(c.random)
          st.decks[s] = { main: pick.main, extra: pick.extra }
          st.deckNames[s] = pick.name
        }
      startDuel(st, c)
      return st
    }
    if (a.type !== "deck" || seat == null) return { error: "Pick a deck first." }
    if (st.decks[seat]) return { error: "You already picked a deck." }
    const starter = typeof a.starter === "string" ? starterById(a.starter) : null
    const checked = validateDeck(starter ? { main: starter.main, extra: starter.extra } : a)
    if (checked.error) return { error: checked.error }
    st.decks[seat] = checked
    st.deckNames[seat] = String((starter ? starter.name : a.name) || "Custom Deck").slice(0, 40)
    if (st.decks[0] && st.decks[1]) startDuel(st, c)
    return st
  }

  if (st.stage === "between") {
    if (a.type === "timeout" && seat == null) {
      if (a.game !== st.game) return state
      startDuel(st, c)
      return st
    }
    if (a.type !== "next" || seat == null) return { error: "Get ready for the next duel." }
    if (st.ready[seat]) return state
    st.ready[seat] = true
    if (st.ready[0] && st.ready[1]) startDuel(st, c)
    return st
  }

  // a duel
  const d = st.duel
  const before = { turn: d.turn, stamp: d.wait?.stamp ?? null }
  if (a.type === "timeout") {
    if (seat != null) return { error: "That isn't a move." }
    if (a.kind === "wait") {
      if (!d.wait || d.wait.stamp !== a.stamp) return state
      const auto = autoAnswer(d, d.wait.seat)
      if (auto) duelAct(d, d.wait.seat, auto)
    } else if (a.kind === "turn") {
      if (d.turn !== a.turn || d.over) return state
      timeUp(d, a.turn)
    } else return state
  } else {
    if (seat == null) return { error: "That isn't a move." }
    const r = duelAct(d, seat, a)
    if (r.error) return { error: r.error }
  }
  if (d.over) endDuel(st, c)
  else clocks(st, c, before)
  return st
}

// what `seat` may see (null: a spectator)
export const view = (state, seat) => {
  const you = seat == null ? null : seat
  return {
    stage: state.stage,
    settings: state.settings,
    names: state.names,
    bots: state.bots,
    wins: state.wins,
    game: state.game,
    results: state.results,
    tutorial: state.tutorial,
    picked: state.decks.map(Boolean),
    deckNames: state.stage === "decks" ? state.deckNames.map((n, i) => (i === you ? n : null)) : state.deckNames,
    ready: state.ready,
    winner: state.winner,
    reason: state.reason,
    prefs: you == null ? null : state.prefs[you],
    stageEnds: state.stageEnds,
    turnEnds: state.turnEnds,
    waitEnds: state.waitEnds,
    duel: state.duel ? duelView(state.duel, you) : null,
    legal: state.stage === "duel" && state.duel && you != null ? legal(state.duel, you) : [],
  }
}

export const isOver = (state) => (state.stage === "over" ? { winners: state.winner == null ? [] : [state.winner], draw: state.winner == null, reason: state.reason } : null)

// a computer player's next move, or null
export const bot = (state, seat, { random = Math.random } = {}) => {
  const ai = state.ai?.[seat] || {}
  if (state.stage === "decks") {
    if (state.decks[seat]) return null
    const pick = starterById(ai.deck) || STARTERS[Math.floor(random() * STARTERS.length)]
    return { type: "deck", starter: pick.id }
  }
  if (state.stage === "between") return state.ready[seat] ? null : { type: "next" }
  if (state.stage !== "duel" || !state.duel || state.duel.over) return null
  setRandom(random)
  return chooseMove(state.duel, seat, { level: ai.level || "normal", style: ai.style || "balanced", random })
}

export const rules = { defaultSettings: DEFAULT_SETTINGS, validateSettings, create, action, view, isOver, bot }
export default rules
