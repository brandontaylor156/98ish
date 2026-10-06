// Roulette's rules: the wheel, the bets and what they pay. European wheels have one zero
// (37 pockets), American wheels a zero and a double zero (38; 00 is pocket 37 here).
// A bet is { kind, numbers, amount }: it wins when the ball lands on one of its numbers and
// pays PAYOUT[kind] to 1 (the stake comes back too).

export const DOUBLE_ZERO = 37
export const RED = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]
export const isRed = (n) => RED.includes(n)
export const colorOf = (n) => (n === 0 || n === DOUBLE_ZERO ? "green" : isRed(n) ? "red" : "black")
export const label = (n) => (n === DOUBLE_ZERO ? "00" : String(n))

// the order of the pockets round each wheel
export const WHEELS = {
  european: [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26],
  american: [0, 28, 9, 26, 30, 11, 7, 20, 32, 17, 5, 22, 34, 15, 3, 24, 36, 13, 1, DOUBLE_ZERO, 27, 10, 25, 29, 12, 8, 19, 31, 18, 6, 21, 33, 16, 4, 23, 35, 14, 2],
}

export const PAYOUT = { straight: 35, split: 17, street: 11, corner: 8, line: 5, basket: 6, first4: 8, dozen: 2, column: 2, red: 1, black: 1, odd: 1, even: 1, low: 1, high: 1 }

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i)

// outside bets
export const OUTSIDE = {
  red: { label: "Red", numbers: RED },
  black: { label: "Black", numbers: range(1, 36).filter((n) => !isRed(n)) },
  odd: { label: "Odd", numbers: range(1, 36).filter((n) => n % 2) },
  even: { label: "Even", numbers: range(1, 36).filter((n) => n % 2 === 0) },
  low: { label: "1 to 18", numbers: range(1, 18) },
  high: { label: "19 to 36", numbers: range(19, 36) },
}
export const dozen = (k) => range(k * 12 + 1, k * 12 + 12) // k 0..2
export const column = (k) => range(1, 36).filter((n) => n % 3 === (k + 1) % 3) // k 0 = 1,4,7..

// the layout: three rows (top row 3, 6, ... 36), twelve columns
export const rowOf = (n) => 2 - ((n - 1) % 3) // 3,6,9 -> row 0 (top)
export const colOf = (n) => Math.floor((n - 1) / 3)

// inside bets anchored on number `n` (the window builds them from taps); null if not allowed
export const insideBet = (kind, n, other = null, wheel = "european") => {
  if (kind === "straight") return n === 0 || n === DOUBLE_ZERO || (n >= 1 && n <= 36) ? [n] : null
  if (n < 1 || n > 36) {
    if (kind === "split" && other != null) return splitOf(n, other, wheel)
    return null
  }
  if (kind === "split") return other == null ? null : splitOf(n, other, wheel)
  if (kind === "street") {
    const base = colOf(n) * 3 + 1
    return [base, base + 1, base + 2]
  }
  if (kind === "corner") {
    // n, the number below it (above, on the bottom row) and the two to their right (left,
    // in the last column)
    const c = Math.min(colOf(n), 10)
    const r = Math.min(rowOf(n), 1)
    const at = (col, row) => col * 3 + (3 - row)
    return [at(c, r), at(c, r + 1), at(c + 1, r), at(c + 1, r + 1)].sort((a, b) => a - b)
  }
  if (kind === "line") {
    const c = Math.min(colOf(n), 10)
    const base = c * 3 + 1
    return range(base, base + 5)
  }
  return null
}

// two numbers side by side on the layout (or 0 / 00 next to the first column)
export const splitOf = (a, b, wheel = "european") => {
  const [x, y] = [a, b].sort((p, q) => p - q)
  if (x === y) return null
  const zeroes = wheel === "american" ? [0, DOUBLE_ZERO] : [0]
  if (zeroes.includes(x) || zeroes.includes(y)) {
    const z = zeroes.includes(x) ? x : y
    const other = z === x ? y : x
    if (zeroes.includes(other)) return wheel === "american" ? [0, DOUBLE_ZERO] : null
    const ok = wheel === "american" ? (z === 0 ? [1, 2] : [2, 3]) : [1, 2, 3]
    return ok.includes(other) ? [Math.min(z, other), Math.max(z, other)] : null
  }
  if (x < 1 || y > 36) return null
  const sameCol = colOf(x) === colOf(y) && Math.abs(rowOf(x) - rowOf(y)) === 1
  const sameRow = rowOf(x) === rowOf(y) && y - x === 3
  return sameCol || sameRow ? [x, y] : null
}

// the bets the table takes: kind + numbers -> a bet (validated), or { error }
export const makeBet = (kind, numbers, amount, wheel = "european") => {
  if (!(amount > 0) || !Number.isInteger(amount)) return { error: "Pick a chip first." }
  if (!PAYOUT[kind]) return { error: "That isn't a bet." }
  const n = numbers.length
  const sizes = { straight: 1, split: 2, street: 3, corner: 4, line: 6, basket: 5, first4: 4, dozen: 12, column: 12, red: 18, black: 18, odd: 18, even: 18, low: 18, high: 18 }
  if (n !== sizes[kind]) return { error: "That isn't a bet." }
  if (kind === "basket" && wheel !== "american") return { error: "The top line is on American wheels." }
  if (kind === "first4" && wheel !== "european") return { error: "The first four is on European wheels." }
  return { kind, numbers: [...numbers].sort((a, b) => a - b), amount }
}

export const BASKET = [0, 1, 2, 3, DOUBLE_ZERO]
export const FIRST4 = [0, 1, 2, 3]

export const pocketCount = (wheel) => WHEELS[wheel].length
export const spin = (wheel = "european", random = Math.random) => WHEELS[wheel][Math.floor(random() * WHEELS[wheel].length)]

// chips back for one bet (stake included)
export const payout = (bet, result) => (bet.numbers.includes(result) ? bet.amount * (PAYOUT[bet.kind] + 1) : 0)
export const settleAll = (bets, result) => {
  const lines = bets.map((b) => ({ ...b, returned: payout(b, result) }))
  const staked = bets.reduce((s, b) => s + b.amount, 0)
  const returned = lines.reduce((s, b) => s + b.returned, 0)
  return { lines, staked, returned, net: returned - staked }
}

export const describeBet = (b) => {
  const nums = b.numbers.map(label)
  switch (b.kind) {
    case "straight":
      return `Straight up ${nums[0]}`
    case "split":
      return `Split ${nums.join("/")}`
    case "street":
      return `Street ${nums.join("-")}`
    case "corner":
      return `Corner ${nums.join("-")}`
    case "line":
      return `Six line ${nums[0]}-${nums[5]}`
    case "basket":
      return "Top line 0-00-1-2-3"
    case "first4":
      return "First four 0-1-2-3"
    case "dozen":
      return `${["1st", "2nd", "3rd"][Math.floor((b.numbers[0] - 1) / 12)]} 12`
    case "column":
      return `Column ${b.numbers[0]}`
    default:
      return OUTSIDE[b.kind]?.label || b.kind
  }
}
