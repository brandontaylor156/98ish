// Runs Monster Duel's match rules (engine/rules.js) right here in the browser, the way the
// online room system runs them on the server (server/arcade/rooms.js): timers by key,
// computer players taking their turns after a short pause, and the end of the match.
// Games against the computer and the tutorial use this; nothing goes over the network.

import * as rules from "./engine/rules"

const clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h),
}

// how long the computer thinks before each kind of move (ms)
const PACE = { slow: 1.6, normal: 1, fast: 0.45 }
const delayFor = (state, seat, move, pace) => {
  const d = state.duel
  let ms = 750
  if (!d) ms = 300
  else if (move.type === "pass") ms = 380
  else if (move.type === "choose") ms = 600
  else if (move.type === "phase") ms = 520
  else if (move.type === "attack") ms = 820
  return ms * (PACE[pace] || 1)
}

// players: [{ name, bot }]; ai: [null, { level, style, deck }]; humans: the seats people
// play (default [0]); onChange(match) after every change
// -> { state, result, view(seat), act(action, seat = 0), stop() }
export const createLocalMatch = ({ players, settings, ai, onChange = () => {}, random = Math.random, time = clock, pace = "normal", botFor = null }) => {
  const timers = new Map()
  let state = null
  let result = null
  let botTimer = null
  let stopped = false
  const bots = players.map((p) => !!p.bot)

  const contextFor = (pending) => ({
    now: time.now(),
    random,
    players: players.map((p, i) => ({ id: i, name: p.name, bot: !!p.bot })),
    after: (ms, action, key = "timer") => pending.set(String(key), { ms: Math.max(0, Number(ms) || 0), action }),
    cancel: (key = "timer") => pending.set(String(key), null),
  })

  const commit = (pending) => {
    for (const [key, timer] of pending) {
      if (timers.has(key)) time.clearTimeout(timers.get(key))
      timers.delete(key)
      if (!timer) continue
      timers.set(
        key,
        time.setTimeout(() => {
          timers.delete(key)
          if (!stopped && !result) apply(null, timer.action)
        }, timer.ms)
      )
    }
  }

  const stopTimers = () => {
    for (const h of timers.values()) time.clearTimeout(h)
    timers.clear()
    time.clearTimeout(botTimer)
    botTimer = null
  }

  const apply = (seat, action) => {
    if (stopped || result) return { ok: false, error: "The duel is over." }
    const pending = new Map()
    let next
    try {
      next = rules.action(state, seat, action, contextFor(pending))
    } catch (error) {
      console.error("[monsterduel] that move failed", error)
      return { ok: false, error: "That didn't work. Please try again." }
    }
    if (!next) return { ok: false, error: "That isn't allowed." }
    if (typeof next.error === "string" && Object.keys(next).length === 1) return { ok: false, error: next.error }
    const changed = next !== state
    state = next
    commit(pending)
    if (changed) {
      const over = rules.isOver(state)
      if (over) {
        result = over
        stopTimers()
      }
      onChange(match)
    }
    scheduleBots()
    return { ok: true }
  }

  const botMove = (seat) => {
    try {
      return botFor ? botFor(state, seat, { random }) : rules.bot(state, seat, { random })
    } catch (error) {
      console.error("[monsterduel] the computer player failed", error)
      return null
    }
  }

  // the first computer player with something to do does it, after a pause
  const scheduleBots = () => {
    time.clearTimeout(botTimer)
    botTimer = null
    if (stopped || result) return
    for (const seat of [0, 1]) {
      if (!bots[seat]) continue
      const move = botMove(seat)
      if (!move) continue
      botTimer = time.setTimeout(() => {
        botTimer = null
        if (stopped || result) return
        const again = botMove(seat)
        if (!again) return scheduleBots()
        const r = apply(seat, again)
        if (!r.ok) {
          console.warn("[monsterduel] the computer's move was refused:", r.error, again)
          // don't get stuck: pass or end the turn
          const d = state.duel
          if (d?.wait?.seat === seat) apply(seat, d.wait.kind === "respond" ? { type: "pass" } : { type: "choose", picks: d.wait.options.slice(0, d.wait.min || 1) })
          else if (d?.active === seat) apply(seat, { type: "phase", to: "end" })
        }
      }, delayFor(state, seat, move, match.pace))
      return
    }
  }

  const start = () => {
    stopTimers()
    result = null
    const pending = new Map()
    const ctx = contextFor(pending)
    state = rules.create({ players: ctx.players, settings: { ...settings, ai }, random, now: ctx.now, after: ctx.after })
    commit(pending)
    onChange(match)
    scheduleBots()
  }

  const match = {
    pace,
    get state() {
      return state
    },
    get result() {
      return result
    },
    view: (seat = 0) => (state ? rules.view(state, seat) : null),
    act: (action, seat = 0) => apply(seat, action),
    setPace: (p) => (match.pace = p),
    // let the computer play for a seat too (tests), or hand it back
    autoplay: (seat, on) => {
      bots[seat] = on
      scheduleBots()
    },
    stop: () => {
      stopped = true
      stopTimers()
    },
  }
  start()
  return match
}
