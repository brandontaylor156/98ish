// Color Match's rules: a plain ES module with no DOM, used by the game window (solo and
// online) and by the server (server/arcade/games/colormatch.js loads this very file), so
// both agree on every question and every score. Tested in colormatch.test.js.
//
// Classic: two cards. The left card's word has a MEANING; the right card's word is printed in
// an INK. Does the left word's meaning match the right word's ink? Yes or No.
// Swatch: a color name in a misleading ink, and swatches: tap the one the word SAYS.
// Each right answer scores 50 x the multiplier; the multiplier goes up by one every 4 right in
// a row (up to x5) and back to x1 on a mistake. The questions come from a seed, one per index,
// so everyone in an online room gets the same ones and the server can check any answer.

import { rng } from "../../../utils/gameKit.js"

export const COLORS = [
  { id: "red", name: "RED", hex: "#e01818" },
  { id: "blue", name: "BLUE", hex: "#1c4fe0" },
  { id: "green", name: "GREEN", hex: "#109030" },
  { id: "yellow", name: "YELLOW", hex: "#e8c000" },
  { id: "black", name: "BLACK", hex: "#101010" },
  { id: "purple", name: "PURPLE", hex: "#8a2be2" },
  { id: "orange", name: "ORANGE", hex: "#f07800" },
  { id: "pink", name: "PINK", hex: "#ff5fb0" },
  { id: "brown", name: "BROWN", hex: "#7a4a1c" },
]
export const CLASSIC_COLORS = 6
export const MODES = ["classic", "swatch"]
export const SECONDS = [30, 60, 90]
export const COUNTDOWN_MS = 3500
export const TICK_MS = 250
export const MIN_GAP_MS = 120 // faster than this is a machine
export const BASE_POINTS = 50
export const MAX_MULT = 5
export const DEFAULTS = { mode: "classic", seconds: 60, players: 4 }

export const multFor = (streak) => Math.min(MAX_MULT, 1 + Math.floor(streak / 4))

// question i of a seed. Classic: { left: { word, ink }, right: { word, ink }, answer: bool }
// Swatch: { word, ink, tiles: [colorId...], answer: tileIndex }
export const tilesFor = (i) => (i < 8 ? 4 : i < 20 ? 6 : 9)
export const questionAt = (seed, i, mode = "classic") => {
  const r = rng(((seed >>> 0) ^ Math.imul(i + 1, 2654435761)) >>> 0)
  const n = mode === "classic" ? CLASSIC_COLORS : COLORS.length
  const any = () => COLORS[Math.floor(r() * n)].id
  const other = (not) => {
    let c = any()
    while (c === not) c = any()
    return c
  }
  if (mode === "swatch") {
    const word = any()
    const ink = other(word)
    const count = tilesFor(i)
    const pool = COLORS.map((c) => c.id).filter((c) => c !== word && c !== ink)
    for (let k = pool.length - 1; k > 0; k--) {
      const j = Math.floor(r() * (k + 1))
      ;[pool[k], pool[j]] = [pool[j], pool[k]]
    }
    // the ink color is always among the tiles: that's the trap
    const tiles = [word, ink, ...pool.slice(0, count - 2)]
    for (let k = tiles.length - 1; k > 0; k--) {
      const j = Math.floor(r() * (k + 1))
      ;[tiles[k], tiles[j]] = [tiles[j], tiles[k]]
    }
    return { word, ink, tiles, answer: tiles.indexOf(word) }
  }
  const yes = r() < 0.5
  const meaning = any()
  const rightInk = yes ? meaning : other(meaning)
  // the right card's WORD is often the left card's meaning (or its ink), to tempt a quick Yes
  const roll = r()
  const rightWord = roll < 0.4 ? meaning : roll < 0.6 ? other(rightInk) : any()
  const leftInk = r() < 0.5 ? other(meaning) : "black"
  return { left: { word: meaning, ink: leftInk }, right: { word: rightWord, ink: rightInk }, answer: yes }
}

export const isRight = (q, choice) => (typeof q.answer === "boolean" ? choice === q.answer : choice === q.answer)

// ---- one player's run (solo games use this directly; online it's inside the room state) ----
export const newRun = () => ({ i: 0, score: 0, streak: 0, best: 0, right: 0, wrong: 0, lastAt: -Infinity })

// apply an answer to question run.i -> { run, right, points }
export const answer = (run, seed, mode, choice, at = 0) => {
  const q = questionAt(seed, run.i, mode)
  const ok = isRight(q, choice)
  const mult = multFor(run.streak)
  const points = ok ? BASE_POINTS * mult : 0
  const next = {
    ...run,
    i: run.i + 1,
    score: run.score + points,
    streak: ok ? run.streak + 1 : 0,
    best: ok ? Math.max(run.best, run.streak + 1) : run.best,
    right: run.right + (ok ? 1 : 0),
    wrong: run.wrong + (ok ? 0 : 1),
    lastAt: at,
  }
  return { run: next, right: ok, points, mult }
}

export const accuracy = (run) => (run.right + run.wrong ? Math.round((run.right / (run.right + run.wrong)) * 100) : 0)

// ---- online (server/arcade/rooms.js rules) ----

export const validateSettings = (raw = {}) => {
  const out = { ...DEFAULTS }
  if (raw.mode !== undefined) {
    if (!MODES.includes(raw.mode)) return { error: "Pick Classic or Swatch." }
    out.mode = raw.mode
  }
  if (raw.seconds !== undefined) {
    const s = Number(raw.seconds)
    if (!SECONDS.includes(s)) return { error: "Games last 30, 60 or 90 seconds." }
    out.seconds = s
  }
  if (raw.players !== undefined) {
    const p = Number(raw.players)
    if (!Number.isInteger(p) || p < 2 || p > 6) return { error: "2 to 6 players." }
    out.players = p
  }
  return out
}
export const bucket = (s) => `${s.mode}:${s.seconds}`
export const seats = (s) => Math.max(2, Math.min(6, Number(s?.players) || 4))

// computer players: how long they take and how often they're right
const BOT = { gap: 1150, spread: 700, accuracy: 0.86 }

export const create = ({ players, settings, random = Math.random, now = Date.now() }) => {
  const goAt = now + COUNTDOWN_MS
  return {
    seed: Math.floor(random() * 2 ** 31),
    mode: settings.mode,
    seconds: settings.seconds,
    goAt,
    endsAt: goAt + settings.seconds * 1000,
    phase: "countdown",
    players: players.map((p) => ({ name: p.name, bot: !!p.bot, run: newRun(), nextAt: p.bot ? goAt + BOT.gap + random() * BOT.spread : null, left: false })),
  }
}

const finishIfDone = (state, now) => (now >= state.endsAt ? { ...state, phase: "over" } : state)

const tick = (state, { now, random }) => {
  if (state.phase === "over") return state
  let next = state
  if (state.phase === "countdown" && now >= state.goAt) next = { ...next, phase: "playing" }
  if (next.phase === "playing") {
    let changed = false
    const players = next.players.map((p) => {
      if (!p.bot || p.left) return p
      let run = p.run
      let at = p.nextAt
      if (at > now || at >= next.endsAt) return p
      while (at <= now && at < next.endsAt) {
        const q = questionAt(next.seed, run.i, next.mode)
        const right = random() < BOT.accuracy
        let choice
        if (typeof q.answer === "boolean") choice = right ? q.answer : !q.answer
        else choice = right ? q.answer : (q.answer + 1) % q.tiles.length
        run = answer(run, next.seed, next.mode, choice, at).run
        at += BOT.gap + random() * BOT.spread
        changed = true
      }
      return { ...p, run, nextAt: at }
    })
    if (changed) next = { ...next, players }
  }
  next = finishIfDone(next, now)
  return next === state ? state : next
}

export const action = (state, seat, act, ctx) => {
  if (!act || typeof act !== "object") return { error: "That isn't a move." }
  if (seat === null || seat === undefined) return act.type === "tick" ? tick(state, ctx) : state
  const now = ctx.now
  if (act.type !== "answer") return { error: "That isn't a move." }
  if (state.phase === "over" || now >= state.endsAt) return { error: "Time's up!" }
  if (now < state.goAt) return { error: "Wait for GO!" }
  const p = state.players[seat]
  if (!p || p.left) return { error: "You're not in this game." }
  if (act.i !== p.run.i) return { error: "That question has gone by." }
  if (now - p.run.lastAt < MIN_GAP_MS) return { error: "Too fast!" }
  const choice = typeof act.choice === "boolean" ? act.choice : Number.isInteger(act.choice) ? act.choice : null
  if (choice === null) return { error: "That isn't an answer." }
  const { run } = answer(p.run, state.seed, state.mode, choice, now)
  const players = state.players.map((x, k) => (k === seat ? { ...x, run } : x))
  return { ...state, phase: "playing", players }
}

export const view = (state) => ({
  seed: state.seed,
  mode: state.mode,
  seconds: state.seconds,
  goAt: state.goAt,
  endsAt: state.endsAt,
  phase: state.phase,
  players: state.players.map((p) => ({ name: p.name, bot: p.bot, left: p.left, i: p.run.i, score: p.run.score, streak: p.run.streak, best: p.run.best, right: p.run.right, wrong: p.run.wrong })),
})

export const standings = (players) =>
  players
    .map((p, seat) => ({ seat, score: p.run ? p.run.score : p.score }))
    .sort((a, b) => b.score - a.score || a.seat - b.seat)

export const isOver = (state) => {
  if (state.phase !== "over") return null
  const top = Math.max(...state.players.map((p) => p.run.score))
  const winners = state.players.map((p, seat) => (p.run.score === top ? seat : -1)).filter((s) => s >= 0)
  return { winners, draw: winners.length > 1, reason: `${top.toLocaleString("en-US")} points` }
}

// a player who left for good: their score stands, they stop answering
export const onLeave = (state, seat) => ({ ...state, players: state.players.map((p, k) => (k === seat ? { ...p, left: true } : p)) })

export const rules = { defaultSettings: DEFAULTS, validateSettings, bucket, seats, create, action, view, isOver, onLeave, tickMs: TICK_MS }
export default rules
