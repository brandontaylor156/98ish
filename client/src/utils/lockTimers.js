// The lock screen's timing rules, kept pure for the tests (utils/lock.js runs them).

const MINUTE = 60_000

// Should 98ish open locked? Yes if it was locked when the page went away, or if it has
// been left longer than the idle wait (iPhone Safari reloads pages it put to sleep).
export const shouldLockOnLoad = ({ hasSecret, locked, lastActive, now, lockAfter }) => {
  if (!hasSecret) return false
  if (locked) return true
  if (!(lockAfter > 0) || !(lastActive > 0)) return false
  return now - lastActive >= lockAfter * MINUTE
}

// Has the idle wait passed since the last input?
export const idleDue = ({ last, now, minutes }) => minutes > 0 && now - last >= minutes * MINUTE

// Counts idle time. poke() on input; tick() (once a second) calls onIdle once per idle
// spell. now() is injectable for fake clocks.
export const createIdleLock = ({ minutes, onIdle, now = () => Date.now() }) => {
  let last = now()
  let fired = false
  return {
    poke() {
      last = now()
      fired = false
    },
    tick() {
      if (fired || !idleDue({ last, now: now(), minutes })) return false
      fired = true
      onIdle()
      return true
    },
    // coming back to the page: how long was it away?
    awayFor: () => now() - last,
  }
}

// Wrong tries: the record after one more wrong try, and how long until the next may go in
export const afterWrongTry = (fails, now, delayAfter) => {
  const count = (fails?.count || 0) + 1
  const wait = delayAfter(count)
  return { count, until: wait ? now + wait * 1000 : 0 }
}
export const waitLeft = (fails, now) => Math.max(0, Math.ceil(((fails?.until || 0) - now) / 1000))
