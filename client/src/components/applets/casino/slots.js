// Slots: three reels, three rows showing, up to five paylines (the three rows and the two
// diagonals). Original symbols. Each reel is a strip of 32 stops; a spin stops each reel at a
// random stop and shows the stop above and below it too. The "98" badge is wild: it stands in
// for any symbol, and three of them hit the jackpot. Cherries pay from the left even alone.
// The paytable pays `pay` times the coin on each winning line; the return over every possible
// spin is computed exactly (rtp(), and a test keeps it between 92% and 97%).

export const SYMBOLS = {
  wild: { name: "98 Wild", short: "98" },
  seven: { name: "Lucky 7", short: "7" },
  floppy: { name: "Floppy", short: "FD" },
  bell: { name: "Bell", short: "BL" },
  star: { name: "Star", short: "ST" },
  coffee: { name: "Coffee", short: "CF" },
  cherry: { name: "Cherry", short: "CH" },
  blank: { name: "Blank", short: "--" },
}

// three of a kind (wilds stand in), per coin
export const PAYS = { wild: 1000, seven: 170, floppy: 70, bell: 36, star: 23, coffee: 15, cherry: 11 }
export const CHERRY_TWO = 4 // cherries (or wilds) on the first two reels
export const CHERRY_ONE = 1 // a cherry on the first reel

const strip = (counts) => {
  // spread each symbol round the strip instead of in clumps
  const out = []
  const left = { ...counts }
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  const order = Object.keys(counts)
  for (let i = 0; i < total; i++) {
    let best = null
    for (const s of order) {
      if (!left[s]) continue
      const want = counts[s] * ((i + 1) / total) - (counts[s] - left[s])
      if (!best || want > best.want) best = { s, want }
    }
    out.push(best.s)
    left[best.s]--
  }
  return out
}

export const REELS = [
  strip({ wild: 1, seven: 2, floppy: 3, bell: 4, star: 4, coffee: 5, cherry: 6, blank: 7 }),
  strip({ wild: 1, seven: 2, floppy: 3, bell: 3, star: 4, coffee: 5, cherry: 5, blank: 9 }),
  strip({ wild: 1, seven: 1, floppy: 3, bell: 4, star: 5, coffee: 6, cherry: 5, blank: 7 }),
]

// rows shown: 0 top, 1 middle, 2 bottom; each payline picks a row on each reel
export const LINES = [
  { name: "Middle", rows: [1, 1, 1] },
  { name: "Top", rows: [0, 0, 0] },
  { name: "Bottom", rows: [2, 2, 2] },
  { name: "Diagonal down", rows: [0, 1, 2] },
  { name: "Diagonal up", rows: [2, 1, 0] },
]
export const COINS = [1, 2, 5, 10, 25]

// the three symbols a reel shows when it stops at `stop` (the stop is the middle row)
export const window = (reel, stop) => {
  const r = REELS[reel]
  const n = r.length
  return [r[(stop - 1 + n) % n], r[stop], r[(stop + 1) % n]]
}

// what one line pays (per coin) for its three symbols
export const linePay = ([a, b, c]) => {
  const syms = [a, b, c]
  if (syms.every((s) => s === "wild")) return PAYS.wild
  const real = syms.filter((s) => s !== "wild")
  if (!real.includes("blank") && real.every((s) => s === real[0])) return PAYS[real[0]]
  const isCherry = (s) => s === "cherry" || s === "wild"
  if (a === "cherry" && isCherry(b)) return CHERRY_TWO
  if (a === "wild" && b === "cherry") return CHERRY_TWO
  if (a === "cherry") return CHERRY_ONE
  return 0
}

export const spin = (random = Math.random) => REELS.map((r) => Math.floor(random() * r.length))

// stops + lines played + coin -> { wins: [{ line, symbols, pay }], total }
export const evaluateSpin = (stops, lines, coin) => {
  const shown = stops.map((stop, reel) => window(reel, stop))
  const wins = []
  for (let i = 0; i < lines; i++) {
    const symbols = LINES[i].rows.map((row, reel) => shown[reel][row])
    const pay = linePay(symbols)
    if (pay) wins.push({ line: i, symbols, pay: pay * coin })
  }
  return { shown, wins, total: wins.reduce((s, w) => s + w.pay, 0), cost: lines * coin }
}

// the exact return to player, per coin per line (every line is alike: each reel's stops are
// equally likely)
export const rtp = () => {
  let sum = 0
  let hits = 0
  for (const a of REELS[0]) for (const b of REELS[1]) for (const c of REELS[2]) {
    const p = linePay([a, b, c])
    sum += p
    if (p) hits++
  }
  const n = REELS[0].length * REELS[1].length * REELS[2].length
  return { rtp: sum / n, hitRate: hits / n }
}
