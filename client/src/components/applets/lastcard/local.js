// Runs Last Card's rules (rules.js) right here in the browser, the way the online room
// system runs them on the server (server/arcade/rooms.js): timers by key, computer players
// moving after their thinking time (the quickest one first), and the end of the game.
// Games against the computer use this; nothing goes over the network.

import * as rules from "./rules.js"

const realTime = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h),
}

// players: [{ id, name, bot }] (seat 0 is you); onChange(game) after every change
// -> { state, result, view(seat), act(action, seat = 0), restart(), stop() }
export const createLocalGame = ({ settings, players, onChange = () => {}, random = Math.random, time = realTime }) => {
  const timers = new Map()
  let state = null
  let result = null
  let stopped = false
  let botTimer = null

  const stopTimers = () => {
    for (const h of timers.values()) time.clearTimeout(h)
    timers.clear()
    time.clearTimeout(botTimer)
    botTimer = null
  }

  const contextFor = (pending) => ({
    now: time.now(),
    random,
    players,
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

  const checkOver = () => {
    const over = rules.isOver(state)
    if (over) {
      result = over
      stopTimers()
    }
  }

  // the computer player with the quickest move makes it
  const scheduleBots = () => {
    time.clearTimeout(botTimer)
    botTimer = null
    if (stopped || result || !state) return
    let best = null
    players.forEach((p, seat) => {
      if (!p.bot) return
      const action = rules.bot(state, seat, { random, now: time.now() })
      if (!action) return
      const ms = rules.botDelay(state, seat, action, { now: time.now() })
      if (!best || ms < best.ms) best = { seat, ms }
    })
    if (!best) return
    botTimer = time.setTimeout(() => {
      botTimer = null
      if (stopped || result) return
      const action = rules.bot(state, best.seat, { random, now: time.now() })
      if (!action) return scheduleBots()
      const out = apply(best.seat, action)
      if (!out.ok) {
        console.warn("[lastcard] the computer player's move was refused:", out.error)
        scheduleBots()
      }
    }, best.ms)
  }

  const apply = (seat, action) => {
    if (stopped || result) return { ok: false, error: "The game is over." }
    const pending = new Map()
    let next
    try {
      next = rules.action(state, seat, action, contextFor(pending))
    } catch (error) {
      console.error("[lastcard] that move failed", error)
      return { ok: false, error: "That didn't work. Please try again." }
    }
    if (!next) return { ok: false, error: "That isn't allowed." }
    if (typeof next.error === "string" && Object.keys(next).length === 1) return { ok: false, error: next.error }
    const changed = next !== state
    state = next
    commit(pending)
    if (changed) {
      checkOver()
      onChange(game)
    }
    scheduleBots()
    return { ok: true }
  }

  const start = () => {
    stopTimers()
    result = null
    const pending = new Map()
    const ctx = contextFor(pending)
    state = rules.create({ players, settings, random, now: ctx.now, after: ctx.after })
    commit(pending)
    checkOver()
    onChange(game)
    scheduleBots()
  }

  const game = {
    get state() {
      return state
    },
    get result() {
      return result
    },
    view: (seat = 0) => (state ? rules.view(state, seat) : null),
    act: (action, seat = 0) => apply(seat, action),
    restart: start,
    stop: () => {
      stopped = true
      stopTimers()
    },
  }
  start()
  return game
}
