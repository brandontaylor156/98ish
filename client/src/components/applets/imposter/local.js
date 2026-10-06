// Runs Imposter's rules (rules.js) right here in the browser for pass-and-play, the way the
// online room system runs them on the server: timers by key, and the end of the game.

import * as rules from "./rules.js"

// players: [{ id, name }]; onChange(game) after every change
// -> { state, result, view(seat), act(action, seat), stop() }
export const createLocalGame = ({ settings, players, onChange = () => {}, random = Math.random }) => {
  const timers = new Map()
  let state = null
  let stopped = false

  const ctxFor = (pending) => ({
    now: Date.now(),
    random,
    players,
    after: (ms, action, key = "timer") => pending.set(String(key), { ms, action }),
    cancel: (key = "timer") => pending.set(String(key), null),
  })
  const commit = (pending) => {
    for (const [key, timer] of pending) {
      clearTimeout(timers.get(key))
      timers.delete(key)
      if (timer) timers.set(key, setTimeout(() => (timers.delete(key), apply(null, timer.action)), timer.ms))
    }
  }
  const apply = (seat, action) => {
    if (stopped || !state || state.over) return { ok: false, error: "The game is over." }
    const pending = new Map()
    const next = rules.action(state, seat, action, ctxFor(pending))
    if (next?.error) return { ok: false, error: next.error }
    if (next !== state) {
      state = next
      commit(pending)
      if (state.over) for (const h of timers.values()) clearTimeout(h)
      onChange(game)
    }
    return { ok: true }
  }

  const pending = new Map()
  state = rules.create({ players, settings, random, now: Date.now(), after: ctxFor(pending).after })
  commit(pending)

  const game = {
    get state() {
      return state
    },
    get result() {
      return state.over
    },
    view: (seat) => rules.view(state, seat),
    act: (action, seat) => apply(seat, action),
    stop: () => {
      stopped = true
      for (const h of timers.values()) clearTimeout(h)
      timers.clear()
    },
  }
  return game
}
