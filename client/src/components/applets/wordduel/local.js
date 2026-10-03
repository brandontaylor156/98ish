// Runs Word Duel's rules (rules.js) right here in the browser, the way the online room
// system runs them on the server (server/arcade/rooms.js): timers by key, a tick every half
// second for the computer players, and the end of the game. Solo games and offline games
// against the computer use this; nothing goes over the network.

const clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h),
}

// rules: makeRules(dict); players: [{ id, name, bot }] (seat 0 is you);
// onChange(game) after every change. -> { state, result, view(seat), act(action), restart(), stop() }
export const createLocalGame = ({ rules, settings, players, onChange = () => {}, random = Math.random, time = clock }) => {
  const timers = new Map()
  let state = null
  let result = null
  let ticker = null
  let stopped = false

  const stopTimers = () => {
    for (const h of timers.values()) time.clearTimeout(h)
    timers.clear()
    if (ticker) time.clearInterval(ticker)
    ticker = null
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

  const apply = (seat, action) => {
    if (stopped || result) return { ok: false, error: "The game is over." }
    const pending = new Map()
    let next
    try {
      next = rules.action(state, seat, action, contextFor(pending))
    } catch (error) {
      console.error("[wordduel] that move failed", error)
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
    if (!result) ticker = time.setInterval(() => !stopped && !result && apply(null, { type: "tick" }), rules.tickMs || 500)
    onChange(game)
  }

  const game = {
    get state() {
      return state
    },
    get result() {
      return result
    },
    view: (seat = 0) => (state ? rules.view(state, seat) : null),
    act: (action) => apply(0, action),
    restart: start,
    stop: () => {
      stopped = true
      stopTimers()
    },
  }
  start()
  return game
}
