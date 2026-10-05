// Pickleball 98's one banner slot (pure, tested in pb7.test.js). Everything the broadcast
// overlay says during a match goes through here: your shot's label ("Unattackable dink ·
// 22 mph"), line calls, faults, the point's outcome and the umpire's score call. Only ONE
// banner is on screen at a time, so they can never overlap, and each has a lifetime kept by
// the game's own timer (not a CSS animation: with Reduce Motion on, the old labels never
// faded and stayed up across points).
//
// Rules:
// - every item has a priority: shot 0 < line 1 < play 2 (faults, aces, winners, "Side out")
//   < call 3 (the score call before a serve);
// - a new item replaces the one on screen if it is at least as important (the newest shot
//   label replaces the last one at once);
// - a less important one waits in the queue, but only while it is still news (`wait`):
//   shot labels never wait (a label for a shot two shots ago is noise), the rest briefly;
// - the queue keeps the most important first, oldest first among equals.

export const PRIORITY = { shot: 0, line: 1, play: 2, call: 3 }
// how long each kind stays up (ms) and how long it may wait for the slot
export const LIFE = { shot: 1100, line: 900, play: 1300, call: 1900 }
export const WAIT = { shot: 0, line: 400, play: 1200, call: 2500 }

export const emptyBanners = () => ({ current: null, queue: [], seq: 0 })

const prio = (b) => PRIORITY[b.kind] ?? 0

// item: { kind: "shot" | "line" | "play" | "call", text, sub?, tone?, ms? } (ms: its own life)
export const pushBanner = (state, item, now) => {
  const id = state.seq + 1
  const b = { ...item, id, at: now, until: now + (item.ms ?? LIFE[item.kind] ?? 1200), stale: now + (WAIT[item.kind] ?? 0) }
  const cur = state.current && state.current.until > now ? state.current : null
  if (!cur || prio(b) >= prio(cur)) return tickBanners({ current: b, queue: state.queue, seq: id }, now)
  if (!(WAIT[item.kind] > 0)) return { ...state, current: cur, seq: id }
  const queue = [...state.queue, b].sort((a, c) => prio(c) - prio(a) || a.at - c.at)
  return { current: cur, queue, seq: id }
}

// the slot's state at time `now`: the current banner expires, the next fresh one shows (with
// its full lifetime from when it shows)
export const tickBanners = (state, now) => {
  let { current, queue } = state
  if (current && current.until <= now) current = null
  queue = queue.filter((b) => b.stale > now)
  if (!current && queue.length) {
    const [next, ...rest] = queue
    const life = next.until - next.at
    current = { ...next, at: now, until: now + life }
    queue = rest
  }
  if (current === state.current && queue.length === state.queue.length) return state
  return { ...state, current, queue }
}

// when the slot next changes (for a timer), or null
export const nextBannerAt = (state) => {
  const times = []
  if (state.current) times.push(state.current.until)
  for (const b of state.queue) times.push(b.stale)
  return times.length ? Math.min(...times) : null
}

// drop everything (a new match, a replay starting)
export const clearBanners = (state) => ({ current: null, queue: [], seq: state.seq })
