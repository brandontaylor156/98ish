// My Park as a place to hang out (pure; Node-tested in hangout.test.js): two regulars
// sitting on a bench together chatting, a seat next to a friend who's sitting ("Sit with
// Ali"), which seat a person online is sitting on, and the regulars who wave hello by name.
// Nothing here adds anything to a venue: only the benches, bleachers and seats it already has.

export const HANG_LINES = [
  "Perfect evening for it.",
  "This is my happy place.",
  "No work talk out here.",
  "I needed this today.",
  "Look at that sky.",
  "Same time tomorrow?",
  "Best part of my week.",
  "Just here for the vibes.",
  "Phone's on silent.",
  "Remember that rally last week?",
  "Snacks after?",
  "Can't beat this weather.",
]
export const HELLO = (name) => [`Hey ${name}!`, `${name}! Good to see you.`, `Hi ${name}!`, `Look who's here: ${name}!`]

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z)

// the seat someone online is on, from where they are (within 0.3 m) -> seat | null
export const seatAt = (seats, x, z, within = 0.3) => {
  let best = null
  let bestD = within
  for (const s of seats) {
    const d = Math.hypot(s.x - x, s.z - z)
    if (d <= bestD) {
      best = s
      bestD = d
    }
  }
  return best
}

// a free seat next to a friend's (same bench first, then the nearest within `max`) -> seat | null
export const seatNextTo = (seats, isFree, friendSeat, max = 2.5) => {
  if (!friendSeat) return null
  const free = seats.filter((s) => s.id !== friendSeat.id && isFree(s) && dist(s, friendSeat) <= max)
  if (!free.length) return null
  const same = friendSeat.bench ? free.filter((s) => s.bench === friendSeat.bench) : []
  const pool = same.length ? same : free
  return pool.sort((a, b) => dist(a, friendSeat) - dist(b, friendSeat))[0]
}

// two free seats side by side (a bench's pair, or neighbors on a bleacher) nearest to `from`
// -> [seat, seat] | null
export const benchPair = (seats, isFree, from, maxSpan = 1) => {
  let best = null
  let bestD = Infinity
  const free = seats.filter(isFree)
  for (let i = 0; i < free.length; i++) {
    for (let j = i + 1; j < free.length; j++) {
      const a = free[i]
      const b = free[j]
      if ((a.bench || a.court) !== (b.bench || b.court)) continue
      if (dist(a, b) > maxSpan || Math.abs((a.y || 0) - (b.y || 0)) > 0.1) continue
      const d = dist(a, from)
      if (d < bestD) {
        best = [a, b]
        bestD = d
      }
    }
  }
  return best
}

// should a regular passing by wave and say hi to you? once per visit each, close by, some
// of them (the ones you've met always): -> a line | null
export const helloFor = (meName, met, rand) => {
  if (!meName) return null
  if (!met && rand() > 0.35) return null
  const lines = HELLO(meName)
  return lines[Math.floor(rand() * lines.length) % lines.length]
}
