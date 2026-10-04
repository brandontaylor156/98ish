// Echo Pads' rules (a Simon-style memory game): a plain ES module with no DOM, used by the game
// window and by the server (server/arcade/games/echo.js loads this file). Tested in
// echo.test.js.
//
// Four pads (green, red, yellow, blue), each with its own tone and a symbol for color-blind
// players. The pads play a sequence; you repeat it; every round adds one step.
//   classic  repeat it as played
//   reverse  repeat it backwards
//   rewind   repeat it forwards, then back again (a b c -> a b c b a)
//   speed    classic, starting fast
// Online "Pass the Pads": players take turns. On your turn, repeat the shared sequence, then
// add one step of your own. A mistake, or the turn clock running out, knocks you out; the
// last one left wins.

import { rng } from "../../../utils/gameKit.js"

export const PADS = [
  { id: "green", name: "Green", symbol: "triangle", freq: 392.0, key: "q" },
  { id: "red", name: "Red", symbol: "circle", freq: 329.63, key: "w" },
  { id: "yellow", name: "Yellow", symbol: "square", freq: 261.63, key: "a" },
  { id: "blue", name: "Blue", symbol: "star", freq: 196.0, key: "s" },
]
export const MODES = ["classic", "reverse", "rewind", "speed"]
export const MODE_NAMES = { classic: "Classic", reverse: "Reverse", rewind: "Rewind", speed: "Speed" }

// what the player has to press for a sequence
export const expectedFor = (seq, mode = "classic") => {
  if (mode === "reverse") return [...seq].reverse()
  if (mode === "rewind") return [...seq, ...[...seq].reverse().slice(1)]
  return [...seq]
}

// how long each step of the playback lights up (ms): faster at 5, 9 and 13 steps
export const stepMs = (len, mode = "classic") => {
  if (mode === "speed") return Math.max(200, 380 - len * 12)
  return len >= 13 ? 300 : len >= 9 ? 380 : len >= 5 ? 470 : 580
}
export const GAP_RATIO = 0.3 // dark time between steps, as a share of a step

// ---- solo ----
export const newSolo = ({ mode = "classic", seed = Date.now() } = {}) => {
  const random = rng(seed)
  return { mode, random, seq: [Math.floor(random() * 4)], pos: 0, phase: "show", round: 1, over: false, best: 0 }
}
// the playback finished: the player's turn
export const toInput = (s) => ({ ...s, phase: "input", pos: 0 })
// a pad press -> { state, ok, done (the round is complete) }
export const press = (s, pad) => {
  if (s.phase !== "input" || s.over) return { state: s, ok: false, done: false, ignored: true }
  const want = expectedFor(s.seq, s.mode)
  if (want[s.pos] !== pad) return { state: { ...s, over: true, phase: "over", best: s.seq.length - 1 }, ok: false, done: false, wanted: want[s.pos] }
  const pos = s.pos + 1
  if (pos < want.length) return { state: { ...s, pos }, ok: true, done: false }
  const seq = [...s.seq, Math.floor(s.random() * 4)]
  return { state: { ...s, seq, pos: 0, phase: "show", round: s.round + 1, best: s.seq.length }, ok: true, done: true }
}
// the score for a run: how many steps were repeated in full
export const scoreOf = (s) => (s.over ? s.best : s.seq.length - 1)

// ---- online: Pass the Pads ----
export const DEFAULTS = { mode: "classic", players: 4, replay: true }
export const FIRST_MS = 6000 // to make the first press of a turn
export const NEXT_MS = 3500 // between presses
export const SHOW_PAD = 300 // after a playback, before the turn clock starts

export const validateSettings = (raw = {}) => {
  const out = { ...DEFAULTS }
  if (raw.mode !== undefined) {
    if (!["classic", "reverse"].includes(raw.mode)) return { error: "Online is Classic or Reverse." }
    out.mode = raw.mode
  }
  if (raw.players !== undefined) {
    const p = Number(raw.players)
    if (!Number.isInteger(p) || p < 2 || p > 6) return { error: "2 to 6 players." }
    out.players = p
  }
  if (raw.replay !== undefined) out.replay = !!raw.replay
  return out
}
export const bucket = (s) => `${s.mode}:${s.replay ? "replay" : "memory"}`
export const seats = (s) => Math.max(2, Math.min(6, Number(s?.players) || 4))

const playbackMs = (len, mode) => len * stepMs(len, mode) * (1 + GAP_RATIO) + 400

const alive = (state) => state.alive.map((a, i) => (a ? i : -1)).filter((i) => i >= 0)
const nextAlive = (state, from) => {
  const n = state.alive.length
  for (let k = 1; k <= n; k++) {
    const i = (from + k) % n
    if (state.alive[i]) return i
  }
  return from
}

// start someone's turn: a playback first (when replay is on and there's something to play)
const beginTurn = (state, seat, ctx) => {
  const show = state.replay && state.seq.length > 0 ? playbackMs(state.seq.length, state.mode) : 0
  const now = ctx.now
  const next = { ...state, turn: seat, pos: 0, phase: show ? "showing" : "repeat", showFrom: now, showUntil: now + show, deadline: now + show + FIRST_MS + (show ? SHOW_PAD : 0) }
  if (state.seq.length === 0) next.phase = "add"
  if (show) ctx.after(show + SHOW_PAD, { type: "go", turn: seat, n: next.turns }, "show")
  ctx.after(next.deadline - now, { type: "timeout", turn: seat, n: next.turns }, "clock")
  return next
}

export const create = ({ players, settings, random = Math.random, now = Date.now(), after = () => {} }) => {
  const first = Math.floor(random() * players.length)
  const base = {
    mode: settings.mode,
    replay: settings.replay,
    seq: [],
    alive: players.map(() => true),
    names: players.map((p) => p.name),
    out: [],
    turns: 0,
    last: null, // { seat, pad, ok, n }
    presses: 0,
    winner: null,
    turn: first,
    pos: 0,
    phase: "add",
  }
  return beginTurn(base, first, { now, after })
}

const knockOut = (state, seat, why, ctx) => {
  const aliveNow = state.alive.map((a, i) => (i === seat ? false : a))
  let next = { ...state, alive: aliveNow, out: [...state.out, { seat, why, at: state.seq.length }] }
  const left = alive(next)
  if (left.length <= 1) {
    ctx.cancel?.("clock")
    ctx.cancel?.("show")
    return { ...next, phase: "over", winner: left[0] ?? null }
  }
  next = { ...next, turns: next.turns + 1 }
  return beginTurn(next, nextAlive(next, seat), ctx)
}

export const action = (state, seat, act, ctx) => {
  if (!act || typeof act !== "object") return { error: "That isn't a move." }
  if (state.phase === "over") return seat == null ? state : { error: "The game is over." }
  if (seat === null || seat === undefined) {
    if (act.type === "go" && act.turn === state.turn && act.n === state.turns && state.phase === "showing") return { ...state, phase: "repeat" }
    if (act.type === "timeout" && act.turn === state.turn && act.n === state.turns && ctx.now >= state.deadline - 5) return knockOut(state, state.turn, "time", ctx)
    return state
  }
  if (act.type !== "press") return { error: "That isn't a move." }
  if (seat !== state.turn) return { error: "It's not your turn." }
  if (state.phase === "showing") return { error: "Watch the pads first." }
  const pad = act.pad
  if (!Number.isInteger(pad) || pad < 0 || pad > 3) return { error: "Pick a pad." }
  const n = state.presses + 1
  if (state.phase === "add") {
    const seq = [...state.seq, pad]
    const next = { ...state, seq, presses: n, last: { seat, pad, ok: true, n, added: true }, turns: state.turns + 1 }
    return beginTurn(next, nextAlive(next, seat), ctx)
  }
  const want = expectedFor(state.seq, state.mode)
  if (want[state.pos] !== pad) return knockOut({ ...state, presses: n, last: { seat, pad, ok: false, n, wanted: want[state.pos] } }, seat, "wrong", ctx)
  const pos = state.pos + 1
  const done = pos >= want.length
  const deadline = ctx.now + NEXT_MS
  ctx.after(NEXT_MS, { type: "timeout", turn: seat, n: state.turns }, "clock")
  return { ...state, pos, phase: done ? "add" : "repeat", presses: n, last: { seat, pad, ok: true, n }, deadline }
}

export const view = (state) => ({
  mode: state.mode,
  replay: state.replay,
  seq: state.seq,
  turn: state.turn,
  pos: state.pos,
  phase: state.phase,
  alive: state.alive,
  out: state.out,
  last: state.last,
  showFrom: state.showFrom,
  showUntil: state.showUntil,
  deadline: state.deadline,
  winner: state.winner,
  turns: state.turns,
  stepMs: stepMs(state.seq.length, state.mode),
})

export const isOver = (state) => (state.phase === "over" ? { winners: state.winner == null ? [] : [state.winner], reason: `${state.seq.length} steps` } : null)

// computer players: right most of the time, slipping more as the sequence grows
export const bot = (state, seat, { random = Math.random } = {}) => {
  if (state.phase === "over" || state.turn !== seat || state.phase === "showing") return null
  if (state.phase === "add") return { type: "press", pad: Math.floor(random() * 4) }
  const want = expectedFor(state.seq, state.mode)
  const slip = random() < 0.012 + state.seq.length * 0.009
  const pad = slip ? (want[state.pos] + 1 + Math.floor(random() * 3)) % 4 : want[state.pos]
  return { type: "press", pad }
}

// someone left for good: they're out (and if it was their turn, the next one goes)
export const onLeave = (state, seat, ctx) => (state.phase === "over" || !state.alive[seat] ? state : knockOut(state, seat, "left", ctx))

export const rules = { defaultSettings: DEFAULTS, validateSettings, bucket, seats, create, action, view, isOver, bot, onLeave, botDelay: 520 }
export default rules
