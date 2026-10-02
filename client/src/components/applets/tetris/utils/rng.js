// Seeded randomness for the piece sequence, so every player in a race (and a test) can get
// the very same pieces. The generator's whole state is one 32-bit number kept in the game
// state, which keeps the engine pure.

// mulberry32: returns [a float in 0..1, the next state]
export const nextRandom = (state) => {
  const s = (state + 0x6d2b79f5) | 0
  let t = s
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, s]
}

export const randomSeed = () => Math.floor(Math.random() * 2 ** 31)

// 7-bag: each run of seven pieces holds every tetromino once, shuffled (Fisher-Yates).
// Returns [bag, next rng state].
export const shuffleBag = (types, rng) => {
  const bag = [...types]
  let state = rng
  for (let i = bag.length - 1; i > 0; i--) {
    const [r, next] = nextRandom(state)
    state = next
    const j = Math.floor(r * (i + 1))
    ;[bag[i], bag[j]] = [bag[j], bag[i]]
  }
  return [bag, state]
}
