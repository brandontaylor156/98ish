// Speed Typist 98's race rules, written as a rules module for the online room system
// (server/arcade/rooms.js; the server loads this file through
// server/arcade/games/speedtype.js) and run in the browser by local.js for races against
// the computer, your ghost, the daily prompt and practice. Plain ES module, no I/O.
//
// The server is the referee: it picks the prompts, runs the countdown and the clock
// (everything is timed by its `now`), checks every progress report against the prompt
// and against human speed, works out each racer's WPM and the places, and types for the
// computer racers with a human-ish rhythm (quick bursts, slower capitals and symbols,
// pauses between words, the odd typo and fix).
//
// Modes: "race" (one prompt), "best3" (first to two race wins, up to three prompts) and
// "sudden" (one wrong key and you're out). Settings also pick the prompt length and
// category, strict typing (no backspace: enforced by each racer's typing field), the
// computer racers' speed, and custom text pasted by the host.

import { CATEGORIES, PROMPTS, lengthOf, pickPrompts, promptById } from "./prompts/index.js"
import { accuracy, checkProgress, normalizePrompt, round1, wpm } from "./typing.js"

export const TICK_MS = 200
export const COUNTDOWN_MS = 4000 // "Get ready", then 3, 2, 1
export const BETWEEN_MS = 7000 // between best-of-3 races
export const MAX_CUSTOM = 600
export const MIN_CUSTOM = 10
export const SAMPLE_MS = 1000

export const MODES = [
  { id: "race", label: "Standard Race", text: "Everyone types the same prompt. First to the finish wins." },
  { id: "best3", label: "Best of 3", text: "Three prompts. First to win two races takes the match." },
  { id: "sudden", label: "Sudden Death", text: "One wrong key and you're out. The fastest clean finish wins." },
]

export const DEFAULTS = { length: "any", category: "any", mode: "race", strict: false, players: 5, botWpm: 0, custom: "", promptId: null }

const LENGTH_IDS = ["any", "short", "medium", "long"]
const CATEGORY_IDS = ["any", ...CATEGORIES.map((c) => c.id)]

// -> the cleaned settings, or { error }. local: the browser's own races (they may bring a
// ghost to race and practice drills of any length)
export const validateSettings = (raw = {}, { local = false } = {}) => {
  const s = { ...DEFAULTS, ...(raw && typeof raw === "object" ? raw : {}) }
  if (!LENGTH_IDS.includes(s.length)) return { error: "Pick a prompt length." }
  if (!CATEGORY_IDS.includes(s.category)) return { error: "Pick a category." }
  if (!MODES.some((m) => m.id === s.mode)) return { error: "Pick a race mode." }
  const players = Math.round(Number(s.players))
  if (!(players >= 1 && players <= 5)) return { error: "Races have 1 to 5 racers." }
  const botWpm = Math.round(Number(s.botWpm) || 0)
  if (botWpm !== 0 && !(botWpm >= 10 && botWpm <= 200)) return { error: "Computer racers type between 10 and 200 WPM." }
  const custom = normalizePrompt(typeof s.custom === "string" ? s.custom.slice(0, 4000) : "")
  const max = local ? 2000 : MAX_CUSTOM
  if (custom && custom.length < MIN_CUSTOM) return { error: `Custom text needs at least ${MIN_CUSTOM} characters.` }
  if (custom.length > max) return { error: `Custom text can be up to ${max} characters.` }
  const promptId = s.promptId && promptById(String(s.promptId)) ? String(s.promptId) : null
  const out = { length: s.length, category: s.category, mode: s.mode, strict: !!s.strict, players, botWpm, custom, promptId }
  if (local && s.ghost && Array.isArray(s.ghost.timeline)) {
    out.ghost = { name: String(s.ghost.name || "Your Ghost").slice(0, 24), timeline: s.ghost.timeline.filter((p) => Array.isArray(p) && p.length === 2).slice(0, 2000) }
  }
  if (local && typeof s.label === "string") out.label = s.label.slice(0, 40)
  return out
}

// Quick Match pairs people who picked the same length, category, mode and strictness
export const bucket = (s) => [s.length, s.category, s.mode, s.strict ? "strict" : "free", s.custom ? `custom:${hash(s.custom)}` : ""].join("|")
export const seats = (s) => Math.max(1, Math.min(5, Number(s?.players) || 5))

const hash = (text) => {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0
  return h.toString(36)
}

// a race's time limit: enough for 20 WPM, plus a little
export const limitFor = (text) => 20_000 + text.length * 600

const promptsFor = (settings, random) => {
  const n = settings.mode === "best3" ? 3 : 1
  if (settings.custom) {
    const p = { id: "custom", category: settings.label ? "drill" : "custom", length: lengthOf(settings.custom), text: settings.custom }
    return Array(n).fill(p)
  }
  if (settings.promptId) {
    const first = promptById(settings.promptId)
    return [first, ...pickPrompts({ length: first.length, category: "any" }, n - 1, random).filter((p) => p.id !== first.id)].slice(0, n)
  }
  return pickPrompts(settings, n, random)
}

// ---------- computer racers ----------

// a computer racer's typing: speed, how often it slips, and when its next key lands
export const botProfile = (random, { wpm: target = 0, sudden = false } = {}) => {
  // a typical spread when no speed is set: mostly 40-80 WPM, the odd 90+
  const base = target > 0 ? target * (0.94 + random() * 0.12) : 38 + random() * 42 + (random() < 0.2 ? random() * 25 : 0)
  return {
    wpm: sudden ? base * 0.88 : base,
    typo: sudden ? 0.0015 + random() * 0.003 : 0.012 + random() * 0.03,
    next: null,
  }
}

// how long one key takes (ms): a jittery rhythm, slower for capitals, digits and symbols,
// a gap between words, now and then a longer think
const keyDelay = (prof, ch, prev, random) => {
  const base = (60000 / (prof.wpm * 5)) * 0.8
  let ms = base * (0.55 + random() * 0.9)
  if (/[A-Z0-9]/.test(ch) || /[^a-zA-Z ]/.test(ch)) ms *= 1.45
  if (prev === " ") ms += base * random() * 1.1
  if (prev === " " && random() < 0.03) ms += 250 + random() * 650
  return ms
}

// Type for a computer racer until it catches up with `now`. Returns a new racer (or the same one)
export const advanceBot = (r, text, goAt, now, random, { sudden = false } = {}) => {
  if (r.finishedAt != null || r.out) return r
  const prof = { ...r.prof }
  if (prof.next == null) prof.next = goAt + 250 + random() * 450 // reaction time
  if (prof.next > now) return r.prof.next === prof.next ? r : { ...r, prof }
  let { pos, keys, mistakes } = r
  let out = false
  let finishedAt = null
  while (prof.next <= now && pos < text.length) {
    keys++
    if (random() < prof.typo) {
      // a slip: notice it, back up, fix it
      mistakes++
      if (sudden) {
        out = true
        break
      }
      keys++
      prof.next += keyDelay(prof, text[pos], text[pos - 1], random) * 3.2
      continue
    }
    pos++
    if (pos === text.length) finishedAt = Math.round(prof.next)
    prof.next += keyDelay(prof, text[pos] || "", text[pos - 1], random)
  }
  return { ...r, prof, pos, keys, mistakes, at: now, out: out || r.out, outAt: out ? now : r.outAt, finishedAt: finishedAt ?? r.finishedAt }
}

// a recorded run ([[ms, characters], ...]) at time t
export const ghostPos = (timeline, t) => {
  if (!timeline.length || t <= 0) return 0
  for (let i = 0; i < timeline.length; i++) {
    if (timeline[i][0] >= t) {
      const [t0, p0] = i ? timeline[i - 1] : [0, 0]
      const [t1, p1] = timeline[i]
      return Math.floor(t1 === t0 ? p1 : p0 + ((p1 - p0) * (t - t0)) / (t1 - t0))
    }
  }
  return timeline[timeline.length - 1][1]
}

// ---------- the race ----------

const newRacer = (p) => ({ name: p.name, bot: !!p.bot, ghost: false, pos: 0, at: 0, keys: 0, mistakes: 0, finishedAt: null, out: false, outAt: null, left: false, samples: [], points: 0, prof: null })

const startRace = (state, now) => {
  const text = state.prompts[state.round].text
  const goAt = now + COUNTDOWN_MS
  return {
    ...state,
    phase: "countdown",
    goAt,
    limitAt: goAt + limitFor(text),
    nextAt: null,
    racers: state.racers.map((r) => ({ ...newRacer(r), bot: r.bot, ghost: r.ghost, left: r.left, out: r.left, points: r.points, prof: r.bot && !r.ghost ? { ...r.prof, next: null } : null, timeline: r.timeline })),
  }
}

export const create = ({ players, settings, random = Math.random, now = Date.now() }) => {
  const prompts = promptsFor(settings, random).map((p) => ({ ...p, text: normalizePrompt(p.text) }))
  const sudden = settings.mode === "sudden"
  let ghostUsed = false
  const racers = players.map((p) => {
    const r = newRacer(p)
    if (p.bot && settings.ghost && !ghostUsed) {
      ghostUsed = true
      return { ...r, name: settings.ghost.name, ghost: true, timeline: settings.ghost.timeline }
    }
    if (p.bot) r.prof = botProfile(random, { wpm: settings.botWpm, sudden })
    return r
  })
  return startRace({ v: 1, mode: settings.mode, strict: !!settings.strict, prompts, round: 0, toWin: settings.mode === "best3" ? 2 : 1, phase: "countdown", racers, results: [], winner: null }, now)
}

// one second of samples, one per racer that moved
const sample = (r, goAt, now) => {
  const t = now - goAt
  const last = r.samples[r.samples.length - 1]
  if (last && t - last[0] < SAMPLE_MS && r.finishedAt == null && !r.out) return r.samples
  return [...r.samples, [Math.max(0, Math.round(r.finishedAt != null ? r.finishedAt - goAt : t)), r.pos]]
}

// at most n samples (for the results)
const thin = (samples, n = 40) => {
  if (samples.length <= n) return samples
  const out = []
  for (let i = 0; i < n; i++) out.push(samples[Math.round((i * (samples.length - 1)) / (n - 1))])
  return out
}

const racerWpm = (r, state, now) => {
  const text = state.prompts[state.round].text
  if (r.finishedAt != null) return wpm(text.length, r.finishedAt - state.goAt)
  const until = r.out ? r.outAt ?? now : Math.min(now, state.limitAt)
  return wpm(r.pos, until - state.goAt)
}

// everyone's place: finishers by time, then the rest by how far they got (out last)
export const standings = (state, now) => {
  const order = state.racers
    .map((r, seat) => ({ r, seat }))
    .sort((a, b) => {
      const fa = a.r.finishedAt != null
      const fb = b.r.finishedAt != null
      if (fa !== fb) return fa ? -1 : 1
      if (fa) return a.r.finishedAt - b.r.finishedAt
      if (a.r.out !== b.r.out) return a.r.out ? 1 : -1
      return b.r.pos - a.r.pos
    })
  return order.map(({ r, seat }, i) => ({
    seat,
    name: r.name,
    bot: r.bot,
    ghost: r.ghost,
    place: i + 1,
    finished: r.finishedAt != null,
    out: r.out,
    left: r.left,
    time: r.finishedAt != null ? r.finishedAt - state.goAt : null,
    pos: r.pos,
    wpm: round1(racerWpm(r, state, now)),
    acc: round1(accuracy(r.keys, r.mistakes) * 100),
    mistakes: r.mistakes,
    samples: thin(r.samples),
  }))
}

const endRace = (state, now) => {
  const table = standings(state, now)
  const winner = table[0]
  const racers = state.racers.map((r, seat) => (seat === winner.seat && (winner.finished || winner.pos > 0) ? { ...r, points: r.points + 1 } : r))
  const results = [...state.results, { round: state.round, prompt: state.prompts[state.round], table }]
  const best = Math.max(...racers.map((r) => r.points))
  const over = state.round + 1 >= state.prompts.length || best >= state.toWin
  if (over) {
    const top = racers.map((r, seat) => ({ r, seat })).filter(({ r }) => r.points === best)
    // a tie on wins: the faster total typing (higher average WPM) takes it
    const avg = (seat) => results.reduce((sum, res) => sum + (res.table.find((x) => x.seat === seat)?.wpm || 0), 0)
    const champ = top.sort((a, b) => avg(b.seat) - avg(a.seat))[0]
    return { ...state, racers, results, phase: "done", winner: champ.seat, endedAt: now }
  }
  return { ...state, racers, results, phase: "between", nextAt: now + BETWEEN_MS, endedAt: now }
}

const humansDone = (state) => state.racers.every((r) => r.bot || r.left || r.out || r.finishedAt != null)
const allDone = (state) => state.racers.every((r) => r.left || r.out || r.finishedAt != null)

// Every human is done: the computer racers finish the race at their own pace, instantly
const fastForward = (state, now, random) => {
  const text = state.prompts[state.round].text
  return state.racers.map((r) => {
    if (r.finishedAt != null || r.out || r.left || !r.bot) return r
    if (r.ghost) {
      const end = r.timeline[r.timeline.length - 1]
      return end && end[1] >= text.length ? { ...r, pos: text.length, finishedAt: state.goAt + end[0] } : r
    }
    const per = 60000 / (r.prof.wpm * 5)
    const finishedAt = Math.round(Math.max(now, r.prof.next ?? now) + (text.length - r.pos) * per * (0.97 + random() * 0.06))
    if (finishedAt > state.limitAt) return { ...r, pos: Math.min(text.length - 1, r.pos + Math.floor((state.limitAt - now) / per)) }
    return { ...r, pos: text.length, finishedAt, keys: r.keys + (text.length - r.pos), samples: r.samples }
  })
}

const settle = (state, now, random) => {
  if (state.phase !== "racing") return state
  if (now >= state.limitAt) return endRace(state, now)
  if (allDone(state)) return endRace(state, now)
  if (humansDone(state)) {
    const racers = fastForward(state, now, random).map((r) => ({ ...r, samples: sample(r, state.goAt, now) }))
    return endRace({ ...state, racers }, now)
  }
  return state
}

const tick = (state, ctx) => {
  const { now, random } = ctx
  let next = state
  // a racer who left mid-race (the room put a computer player in the seat): out
  if (ctx.players && next.phase !== "done") {
    const gone = next.racers.map((r, i) => !r.bot && !r.left && ctx.players[i]?.bot)
    if (gone.some(Boolean)) next = { ...next, racers: next.racers.map((r, i) => (gone[i] ? { ...r, left: true, out: r.finishedAt == null, outAt: r.finishedAt == null ? now : r.outAt, bot: false } : r)) }
  }
  if (next.phase === "countdown" && now >= next.goAt) next = { ...next, phase: "racing" }
  if (next.phase === "between" && now >= next.nextAt) return startRace({ ...next, round: next.round + 1 }, now)
  if (next.phase !== "racing") return next
  const text = next.prompts[next.round].text
  const sudden = next.mode === "sudden"
  let moved = false
  const racers = next.racers.map((r) => {
    if (!r.bot || r.left || r.finishedAt != null || r.out) return r
    let n
    if (r.ghost) {
      const t = now - next.goAt
      const pos = Math.min(text.length, ghostPos(r.timeline, t))
      const end = r.timeline[r.timeline.length - 1]
      const finishedAt = pos >= text.length && end ? next.goAt + end[0] : null
      if (pos === r.pos && finishedAt == null) return r
      n = { ...r, pos, keys: Math.max(r.keys, pos), at: now, finishedAt }
    } else {
      n = advanceBot(r, text, next.goAt, now, random, { sudden })
      if (n === r) return r
    }
    moved = true
    return { ...n, samples: sample(n, next.goAt, now) }
  })
  if (moved) next = { ...next, racers }
  return settle(next, now, random)
}

const progress = (state, seat, action, ctx) => {
  const { now } = ctx
  const r = state.racers[seat]
  if (!r) return { error: "You aren't in this race." }
  if (state.phase === "countdown") return { error: "Wait for the green light!" }
  if (state.phase !== "racing") return { error: "This race is over." }
  if (r.finishedAt != null || r.out) return state
  const text = state.prompts[state.round].text
  const typed = typeof action.text === "string" ? action.text : null
  const problem = checkProgress({ prompt: text, text: typed, prev: { pos: r.pos, at: r.at }, goAt: state.goAt, now })
  if (problem) return { error: problem }
  const keys = Math.max(r.keys, typed.length, Math.min(1e6, Math.floor(Number(action.keys)) || 0))
  const mistakes = Math.min(keys, Math.max(r.mistakes, Math.min(1e6, Math.floor(Number(action.mistakes)) || 0)))
  const out = state.mode === "sudden" && mistakes > 0
  const finished = !out && typed.length === text.length
  if (typed.length === r.pos && keys === r.keys && mistakes === r.mistakes) return state
  let n = { ...r, pos: typed.length, at: now, keys, mistakes, out, outAt: out ? now : null, finishedAt: finished ? now : null }
  n = { ...n, samples: sample(n, state.goAt, now) }
  const next = { ...state, racers: state.racers.map((x, i) => (i === seat ? n : x)) }
  return settle(next, now, ctx.random || Math.random)
}

export const action = (state, seat, act, ctx) => {
  if (!act || typeof act !== "object") return { error: "That isn't a move." }
  if (seat === null || seat === undefined) return act.type === "tick" ? tick(state, ctx) : state
  if (act.type === "progress") return progress(state, seat, act, ctx)
  return { error: "That isn't a move." }
}

// What everyone sees: the prompts so far, the racers (no computer-racer internals) and results
export const view = (state, seat) => ({
  mode: state.mode,
  strict: state.strict,
  phase: state.phase,
  round: state.round,
  rounds: state.prompts.length,
  toWin: state.toWin,
  prompt: state.prompts[state.round],
  goAt: state.goAt,
  limitAt: state.limitAt,
  nextAt: state.nextAt,
  winner: state.winner,
  you: seat ?? null,
  racers: state.racers.map((r) => ({ name: r.name, bot: r.bot, ghost: r.ghost, pos: r.pos, finishedAt: r.finishedAt, out: r.out, left: r.left, points: r.points, mistakes: r.mistakes, keys: r.keys })),
  results: state.results,
})

export const isOver = (state) => {
  if (state.phase !== "done") return null
  const last = state.results[state.results.length - 1]
  return { winners: state.winner == null ? [] : [state.winner], reason: state.mode, table: last?.table?.map(({ seat, place, wpm: w, acc }) => ({ seat, place, wpm: w, acc })) }
}

export const rules = { defaultSettings: DEFAULTS, validateSettings, bucket, seats, create, action, view, isOver, tickMs: TICK_MS }
export default rules

// handy for tests and the library browser
export const LIBRARY_SIZE = PROMPTS.length
