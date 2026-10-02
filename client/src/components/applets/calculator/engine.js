// The Calculator's math, kept free of React so it can be tested with plain Node.
// State is immutable: press(state, key) returns the next state.
//
// Standard view works left to right (2 + 3 * 4 = 20); Scientific respects operator
// precedence and parentheses (2 + 3 * 4 = 14), as in Windows 98. Hex, Oct and Bin work on
// whole numbers of the chosen word size (Dword, Word or Byte), shown unsigned.

export const DIV_ZERO = "Cannot divide by zero."
export const INVALID = "Invalid input for function."

const WORD_BITS = { dword: 32, word: 16, byte: 8 }

// higher binds tighter; Standard view gives every operator the same rank
const PRECEDENCE = { or: 1, xor: 2, and: 3, lsh: 4, rsh: 4, add: 5, sub: 5, mul: 6, div: 6, mod: 6, pow: 7, root: 7 }
export const BINARY = Object.keys(PRECEDENCE)

class CalcError extends Error {}
const fail = (message) => {
  throw new CalcError(message)
}

const freshFrames = () => [{ values: [], ops: [] }]

export const initialState = (overrides = {}) => ({
  mode: "standard", // or "scientific"
  base: 10, // 16, 10, 8 or 2
  angle: "deg", // "rad", "grad"
  word: "dword", // "word", "byte" (Hex, Oct and Bin only)
  inv: false,
  hyp: false,
  fe: false, // scientific notation for results
  grouping: false, // digit grouping (1,234,567)
  value: 0, // the number on display
  entry: null, // the text being typed, or null
  frames: freshFrames(), // pending operations; one frame per open parenthesis
  last: "start", // the kind of the last key: digit, op, eq, func, paren, ce, start
  repeat: null, // { op, operand }: what = repeats
  memory: 0,
  stats: [], // the Statistics Box
  error: null,
  ...overrides,
})

// ---- numbers ----

const bitsOf = (state) => WORD_BITS[state.word] || 32

// whole number, wrapped to the word size (signed)
const wrap = (state, x) => {
  if (!Number.isFinite(x)) fail(INVALID)
  return Number(BigInt.asIntN(bitsOf(state), BigInt(Math.trunc(x))))
}

// computed results: catch overflow, keep Hex/Oct/Bin whole. Values keep full precision
// (so 1 / 3 * 3 = 1); the display rounds to 15 digits, hiding binary noise like 0.1 + 0.2.
const normalize = (state, x) => {
  if (Number.isNaN(x) || !Number.isFinite(x)) fail(INVALID)
  if (state.base !== 10) return wrap(state, x)
  return Object.is(x, -0) ? 0 : x
}

// the value as displayed, for functions that care about whole numbers (Int, n!, And...)
const snap = (x) => Number(x.toPrecision(15))

// sums that should cancel out exactly (0.1 + 0.2 - 0.3) come out as 0
const cancel = (r, a, b) => (Math.abs(r) < Math.max(Math.abs(a), Math.abs(b)) * 1e-14 ? 0 : r)

const big = (x) => BigInt(Math.trunc(snap(x)))
const bitwise = (state, fn) => (a, b) => {
  const r = BigInt.asIntN(state.base === 10 ? 64 : bitsOf(state), fn(big(a), big(b)))
  return Number(r)
}

const maxDigits = (state) => {
  if (state.base === 10) return 16
  const bits = bitsOf(state)
  return state.base === 16 ? bits / 4 : state.base === 8 ? Math.ceil(bits / 3) : bits
}

const parseEntry = (state, entry) => {
  if (state.base === 10) {
    const n = Number(entry === "-" ? 0 : entry)
    return Number.isFinite(n) ? n : 0
  }
  const unsigned = BigInt.asUintN(bitsOf(state), BigInt(parseInt(entry, state.base) || 0))
  return Number(BigInt.asIntN(bitsOf(state), unsigned))
}

// ---- display ----

const groupDigits = (digits, size, sep) => {
  let out = ""
  for (let i = 0; i < digits.length; i++) {
    if (i && (digits.length - i) % size === 0) out += sep
    out += digits[i]
  }
  return out
}

const groupNumber = (text, state) => {
  if (!state.grouping) return text
  if (state.base !== 10) return groupDigits(text, 4, " ")
  const m = /^(-?)(\d+)(.*)$/.exec(text)
  return m ? m[1] + groupDigits(m[2], 3, ",") + m[3] : text
}

const exponential = (x) => {
  let [mantissa, exp] = x.toExponential(14).split("e")
  mantissa = mantissa.replace(/0+$/, "")
  if (!mantissa.includes(".")) mantissa += "."
  return `${mantissa}e${exp}`
}

// a value as Windows shows it: "0." "3.14" "1.5e+20", or FF in Hex
export const formatValue = (state, x) => {
  if (state.base !== 10) {
    const text = BigInt.asUintN(bitsOf(state), big(x)).toString(state.base).toUpperCase()
    return groupNumber(text, state)
  }
  if (Object.is(x, -0)) x = 0
  const abs = Math.abs(x)
  if (state.fe || (x !== 0 && (abs >= 1e16 || abs < 1e-15))) return exponential(x)
  let text = snap(x).toString()
  if (text.includes("e")) return exponential(x)
  if (!text.includes(".")) text += "."
  return groupNumber(text, state)
}

const formatEntry = (state, entry) => {
  if (state.base !== 10) return groupNumber(entry.toUpperCase(), state)
  if (entry.includes("e")) return entry
  return groupNumber(entry.includes(".") ? entry : `${entry}.`, state)
}

export const displayText = (state) => {
  if (state.error) return state.error
  if (state.entry !== null) return formatEntry(state, state.entry)
  return formatValue(state, state.value)
}

// what Edit > Copy puts on the clipboard: no grouping, no trailing point
export const copyText = (state) => {
  if (state.error) return ""
  let text = displayText(state).replace(/[, ]/g, "")
  if (text.endsWith(".")) text = text.slice(0, -1)
  return text
}

export const parenDepth = (state) => state.frames.length - 1

// ---- operations ----

const toRadians = (state, x) => (state.angle === "deg" ? (x * Math.PI) / 180 : state.angle === "grad" ? (x * Math.PI) / 200 : x)
const fromRadians = (state, x) => (state.angle === "deg" ? (x * 180) / Math.PI : state.angle === "grad" ? (x * 200) / Math.PI : x)

// sin, cos and tan of whole quarter turns come out exact (sin 180 = 0, tan 90 is an error)
const trig = (state, name, x) => {
  if (state.angle !== "rad") {
    const full = state.angle === "deg" ? 360 : 400
    const r = ((x % full) + full) % full
    if (r % (full / 4) === 0) {
      const k = r / (full / 4)
      if (name === "sin") return [0, 1, 0, -1][k]
      if (name === "cos") return [1, 0, -1, 0][k]
      if (k % 2) fail(INVALID)
      return 0
    }
  }
  const result = Math[name](toRadians(state, x))
  return Math.abs(result) < 1e-15 ? 0 : result
}

// Lanczos approximation, for n! of fractions
const gamma = (z) => {
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z))
  const g = 7
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7]
  z -= 1
  let x = c[0]
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i)
  const t = z + g + 0.5
  return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x
}

const factorial = (x) => {
  if (Number.isInteger(x)) {
    if (x < 0) fail(INVALID)
    if (x > 170) fail(INVALID)
    let r = 1
    for (let i = 2; i <= x; i++) r *= i
    return r
  }
  if (x > 170) fail(INVALID)
  return gamma(x + 1)
}

const toDms = (x) => {
  const sign = Math.sign(x)
  x = Math.abs(x)
  const d = Math.trunc(x)
  const minutes = (x - d) * 60
  const m = Math.trunc(Number(minutes.toPrecision(12)))
  const s = (minutes - m) * 60
  return sign * (d + m / 100 + s / 10000)
}

const fromDms = (x) => {
  const sign = Math.sign(x)
  x = Math.abs(x)
  const d = Math.trunc(x)
  const rest = Number(((x - d) * 100).toPrecision(12))
  const m = Math.trunc(rest)
  const s = (rest - m) * 100
  return sign * (d + m / 60 + s / 3600)
}

const applyBinary = (state, op, a, b) => {
  const intMode = state.base !== 10
  switch (op) {
    case "add":
      return cancel(a + b, a, b)
    case "sub":
      return cancel(a - b, a, b)
    case "mul":
      return a * b
    case "div":
      if (b === 0) fail(DIV_ZERO)
      return intMode ? Math.trunc(a / b) : a / b
    case "mod":
      if (Math.trunc(b) === 0 && intMode) fail(DIV_ZERO)
      if (b === 0) fail(DIV_ZERO)
      return a % b
    case "pow": {
      const r = Math.pow(a, b)
      if (Number.isNaN(r)) fail(INVALID)
      return r
    }
    case "root": {
      if (b === 0) fail(INVALID)
      if (a < 0 && Number.isInteger(b) && Math.abs(b) % 2 === 1) return -Math.pow(-a, 1 / b)
      const r = Math.pow(a, 1 / b)
      if (Number.isNaN(r)) fail(INVALID)
      return r
    }
    case "and":
      return bitwise(state, (x, y) => x & y)(a, b)
    case "or":
      return bitwise(state, (x, y) => x | y)(a, b)
    case "xor":
      return bitwise(state, (x, y) => x ^ y)(a, b)
    case "lsh":
      return bitwise(state, (x, y) => (y < 0n ? x >> -y : y > 128n ? 0n : x << y))(a, b)
    case "rsh":
      return bitwise(state, (x, y) => (y < 0n ? x << -y : x >> (y > 128n ? 128n : y)))(a, b)
    default:
      throw new Error(`unknown operator ${op}`)
  }
}

const precedence = (state, op) => (state.mode === "standard" ? 1 : PRECEDENCE[op])

// collapse the pending operations in a frame while they bind at least as tight as minRank
const reduce = (state, frame, minRank, record) => {
  while (frame.ops.length && precedence(state, frame.ops[frame.ops.length - 1]) >= minRank) {
    const op = frame.ops.pop()
    const b = frame.values.pop()
    const a = frame.values.pop()
    frame.values.push(normalize(state, applyBinary(state, op, a, b)))
    if (record) record.last = { op, operand: b }
  }
}

const cloneFrames = (frames) => frames.map((f) => ({ values: [...f.values], ops: [...f.ops] }))

const unary = (state, name, x) => {
  const { inv, hyp } = state
  switch (name) {
    case "sqrt":
      if (x < 0) fail(INVALID)
      return Math.sqrt(x)
    case "recip":
      if (x === 0) fail(DIV_ZERO)
      return 1 / x
    case "sqr":
      if (inv) {
        if (x < 0) fail(INVALID)
        return Math.sqrt(x)
      }
      return x * x
    case "cube":
      return inv ? Math.cbrt(x) : x * x * x
    case "fact":
      return factorial(state.base === 10 ? snap(x) : Math.trunc(x))
    case "ln":
      if (inv) return Math.exp(x)
      if (x <= 0) fail(INVALID)
      return Math.log(x)
    case "log":
      if (inv) return Math.pow(10, x)
      if (x <= 0) fail(INVALID)
      return Math.log10(x)
    case "sin":
    case "cos":
    case "tan": {
      if (hyp && inv) {
        if (name === "sin") return Math.asinh(x)
        if (name === "cos") {
          if (x < 1) fail(INVALID)
          return Math.acosh(x)
        }
        if (Math.abs(x) >= 1) fail(INVALID)
        return Math.atanh(x)
      }
      if (hyp) return Math[`${name}h`](x)
      if (inv) {
        if (name !== "tan" && Math.abs(x) > 1) fail(INVALID)
        return fromRadians(state, Math[`a${name}`](x))
      }
      return trig(state, name, x)
    }
    case "int":
      x = snap(x)
      return inv ? snap(x - Math.trunc(x)) : Math.trunc(x)
    case "not":
      return Number(BigInt.asIntN(state.base === 10 ? 64 : bitsOf(state), ~big(x)))
    case "dms":
      return inv ? fromDms(x) : toDms(x)
    case "pi":
      return inv ? 2 * Math.PI : Math.PI
    default:
      throw new Error(`unknown function ${name}`)
  }
}

const UNARY = ["sqrt", "recip", "sqr", "cube", "fact", "ln", "log", "sin", "cos", "tan", "int", "not", "dms", "pi"]
const USES_INV = ["sqr", "cube", "ln", "log", "sin", "cos", "tan", "int", "dms", "pi", "pow", "lsh", "ave", "sum", "s"]

// keys that make no sense in the current view or number base (the UI greys them out)
export const isEnabled = (state, key) => {
  const decimalOnly = [".", "exp", "fe", "dms", "sin", "cos", "tan", "pi"]
  if (state.base !== 10 && decimalOnly.includes(key)) return false
  if (/^[0-9A-F]$/.test(key)) return parseInt(key, 16) < state.base
  if (key === "rparen") return state.frames.length > 1
  return true
}

const currentValue = (state) => (state.entry !== null ? parseEntry(state, state.entry) : state.value)

const withError = (state, message) => ({
  ...state,
  error: message,
  value: 0,
  entry: null,
  frames: freshFrames(),
  repeat: null,
  last: "start",
  inv: false,
  hyp: false,
})

const clearAll = (state) => ({ ...state, value: 0, entry: null, frames: freshFrames(), last: "start", repeat: null, error: null })

// a whole number in the new base: Dec keeps fractions, the others drop them
const convertBase = (state, base) => {
  const value = currentValue(state)
  const next = { ...state, base, entry: null, last: "func", error: null }
  if (base === 10) return { ...next, value: state.error ? 0 : value }
  return { ...next, value: wrap(next, value) }
}

// ---- keys ----

const typeDigit = (state, d) => {
  if (state.error) state = clearAll(state)
  if (d !== "." && parseInt(d, 16) >= state.base) return state
  if (d === "." && state.base !== 10) return state
  const fresh = state.entry === null || state.last !== "digit"
  let entry = fresh ? (d === "." ? "0." : d) : state.entry
  if (!fresh) {
    if (entry.includes("e")) {
      if (d === ".") return state
      const [mantissa, exp] = entry.split("e")
      const digits = exp.slice(1) === "0" ? d : exp.slice(1) + d
      if (digits.length > 3) return state
      entry = `${mantissa}e${exp[0]}${digits}`
    } else if (d === ".") {
      if (entry.includes(".")) return state
      entry += "."
    } else {
      const count = entry.replace(/[^0-9A-F]/gi, "").replace(/^0+(?=.)/, "").length
      if (count >= maxDigits(state) && !/^-?0$/.test(entry)) return state
      entry = entry === "0" ? d : entry === "-0" ? `-${d}` : entry + d
    }
  }
  return { ...state, entry, value: parseEntry(state, entry), last: "digit" }
}

const backspace = (state) => {
  if (state.error || state.entry === null || state.last !== "digit") return state
  let entry = state.entry
  if (/e[+-]0$/.test(entry)) entry = entry.replace(/e[+-]0$/, "")
  else {
    entry = entry.slice(0, -1)
    if (/e[+-]$/.test(entry)) entry += "0"
  }
  if (entry === "" || entry === "-" || entry === "-0") entry = "0"
  return { ...state, entry, value: parseEntry(state, entry) }
}

const negate = (state) => {
  if (state.error) return state
  if (state.entry !== null && state.last === "digit" && state.base === 10) {
    let entry = state.entry
    if (entry.includes("e")) entry = entry.replace(/e([+-])/, (_, s) => `e${s === "+" ? "-" : "+"}`)
    else entry = entry.startsWith("-") ? entry.slice(1) : `-${entry}`
    return { ...state, entry, value: parseEntry(state, entry) }
  }
  return { ...state, value: normalize(state, -currentValue(state)), entry: null, last: "func" }
}

const binaryOp = (state, op) => {
  if (op === "pow" && state.inv) op = "root"
  if (op === "lsh" && state.inv) op = "rsh"
  const frames = cloneFrames(state.frames)
  const frame = frames[frames.length - 1]
  if (state.last === "op" && frame.ops.length) frame.ops.pop()
  else frame.values.push(currentValue(state))
  reduce(state, frame, precedence(state, op))
  frame.ops.push(op)
  return {
    ...state,
    frames,
    value: frame.values[frame.values.length - 1],
    entry: null,
    last: "op",
    inv: USES_INV.includes(op === "root" ? "pow" : op === "rsh" ? "lsh" : op) ? false : state.inv,
    hyp: false,
  }
}

const equals = (state) => {
  if (state.error) return state
  const pending = state.frames.some((f) => f.ops.length)
  if (!pending || state.last === "eq") {
    if (!state.repeat) return { ...state, value: currentValue(state), entry: null, last: "eq", frames: freshFrames() }
    const value = normalize(state, applyBinary(state, state.repeat.op, currentValue(state), state.repeat.operand))
    return { ...state, value, entry: null, last: "eq", frames: freshFrames() }
  }
  const frames = cloneFrames(state.frames)
  const record = { last: state.repeat }
  let value = currentValue(state)
  while (frames.length) {
    const frame = frames.pop()
    frame.values.push(value)
    reduce(state, frame, 0, record)
    value = frame.values[0]
  }
  return { ...state, value, entry: null, last: "eq", frames: freshFrames(), repeat: record.last }
}

const percent = (state) => {
  if (state.error) return state
  const frame = state.frames[state.frames.length - 1]
  if (!frame.ops.length) return { ...state, value: 0, entry: null, last: "func" }
  const base = frame.values[frame.values.length - 1]
  return { ...state, value: normalize(state, (base * currentValue(state)) / 100), entry: null, last: "func" }
}

const stat = (state, key) => {
  const data = state.stats
  const n = data.length
  const sum = (f) => data.reduce((t, x) => t + f(x), 0)
  if (key === "dat") return { ...state, stats: [...data, currentValue(state)], entry: null, last: "func" }
  let value = 0
  if (key === "ave") value = n ? (state.inv ? sum((x) => x * x) : sum((x) => x)) / n : 0
  if (key === "sum") value = state.inv ? sum((x) => x * x) : sum((x) => x)
  if (key === "s") {
    const divisor = state.inv ? n : n - 1
    if (divisor > 0) {
      const mean = sum((x) => x) / n
      value = Math.sqrt(sum((x) => (x - mean) ** 2) / divisor)
    }
  }
  return { ...state, value: normalize(state, value), entry: null, last: "func", inv: false }
}

const startExponent = (state) => {
  if (state.error || state.base !== 10) return state
  if (state.entry !== null && state.last === "digit") {
    if (state.entry.includes("e")) return state
    return { ...state, entry: `${state.entry.replace(/\.$/, "")}e+0` }
  }
  const text = String(currentValue(state))
  if (text.includes("e")) return state
  const entry = `${text}e+0`
  return { ...state, entry, value: parseEntry(state, entry), last: "digit" }
}

// press(state, key, arg): one key (or menu choice), returns the next state
export const press = (state, key, arg) => {
  try {
    return pressUnsafe(state, key, arg)
  } catch (error) {
    if (error instanceof CalcError) return withError(state, error.message)
    throw error
  }
}

const pressUnsafe = (state, key, arg) => {
  if (/^[0-9A-F.]$/.test(key)) return typeDigit(state, key)
  if (BINARY.includes(key)) return state.error ? state : binaryOp(state, key)

  if (UNARY.includes(key)) {
    if (state.error) return state
    const result = normalize(state, unary(state, key, currentValue(state)))
    return { ...state, value: result, entry: null, last: "func", inv: USES_INV.includes(key) ? false : state.inv, hyp: false }
  }

  switch (key) {
    case "eq":
      return equals(state)
    case "neg":
      return negate(state)
    case "back":
      return backspace(state)
    case "ce":
      return { ...state, entry: null, value: 0, error: null, last: state.error ? "start" : "ce", frames: state.error ? freshFrames() : state.frames }
    case "c":
      return clearAll(state)
    case "pct":
      return percent(state)
    case "exp":
      return startExponent(state)
    case "fe":
      return { ...state, fe: !state.fe }
    case "inv":
      return { ...state, inv: !state.inv }
    case "hyp":
      return { ...state, hyp: !state.hyp }
    case "lparen":
      if (state.error || state.frames.length > 25) return state
      return { ...state, frames: [...cloneFrames(state.frames), { values: [], ops: [] }], entry: null, last: "paren" }
    case "rparen": {
      if (state.error || state.frames.length < 2) return state
      const frames = cloneFrames(state.frames)
      const frame = frames.pop()
      frame.values.push(currentValue(state))
      reduce(state, frame, 0)
      return { ...state, frames, value: frame.values[0], entry: null, last: "func" }
    }
    case "mc":
      return { ...state, memory: 0 }
    case "mr":
      if (state.error) return state
      return { ...state, value: state.memory, entry: null, last: "func" }
    case "ms":
      if (state.error) return state
      return { ...state, memory: currentValue(state), entry: null, last: state.last === "digit" ? "func" : state.last }
    case "mplus":
      if (state.error) return state
      return { ...state, memory: normalize(state, state.memory + currentValue(state)), entry: null, last: state.last === "digit" ? "func" : state.last }
    case "dat":
    case "ave":
    case "sum":
    case "s":
      return state.error ? state : stat(state, key)
    case "statClear":
      return { ...state, stats: [] }
    case "statRemove":
      return { ...state, stats: state.stats.filter((_, i) => i !== arg) }
    case "statLoad":
      return arg in state.stats ? { ...state, value: state.stats[arg], entry: null, last: "func", error: null } : state
    case "base":
      return state.base === arg ? state : convertBase(state, arg)
    case "angle":
      return { ...state, angle: arg }
    case "word": {
      const next = { ...state, word: arg }
      return state.base === 10 ? next : { ...next, value: wrap(next, currentValue(state)), entry: null, last: "func" }
    }
    case "mode": {
      if (arg === state.mode) return state
      const value = state.error ? 0 : currentValue(state)
      const next = { ...state, mode: arg, frames: freshFrames(), entry: null, last: "func", inv: false, hyp: false, error: null }
      return arg === "standard" ? { ...convertBase(next, 10), value } : { ...next, value }
    }
    case "grouping":
      return { ...state, grouping: !state.grouping }
    default:
      return state
  }
}

// ---- keyboard and paste ----

// A key press (KeyboardEvent-like) -> [key, arg] for press(), or null. Mostly the Windows
// 98 shortcuts: @ = square root (x^2 in Scientific), r = 1/x, F9 = +/-, Esc = C, Del = CE,
// Ctrl+M/R/L/P = MS/MR/MC/M+, F5-F8 = Hex/Dec/Oct/Bin...
export const keyFor = (state, e) => {
  const sci = state.mode === "scientific"
  const k = e.key
  if (e.ctrlKey || e.metaKey) {
    const ctrl = { m: "ms", r: "mr", l: "mc", p: "mplus", a: "ave", t: "sum", d: "s" }[k.toLowerCase()]
    if (!ctrl || (["ave", "sum", "s"].includes(ctrl) && !sci)) return null
    return [ctrl]
  }
  if (/^[0-9]$/.test(k) || k === "." || k === ",") return [k === "," ? "." : k]
  if (state.base === 16 && /^[a-fA-F]$/.test(k)) return [k.toUpperCase()]
  const plain = {
    "+": "add",
    "-": "sub",
    "*": "mul",
    "/": "div",
    "=": "eq",
    Enter: "eq",
    Escape: "c",
    Delete: "ce",
    Backspace: "back",
    F9: "neg",
    r: "recip",
    R: "recip",
  }
  if (plain[k]) return [plain[k]]
  if (!sci) {
    if (k === "@") return ["sqrt"]
    if (k === "%") return ["pct"]
    return null
  }
  const scientific = {
    "@": "sqr",
    "#": "cube",
    "%": "mod",
    "^": "xor",
    "&": "and",
    "|": "or",
    "~": "not",
    "<": "lsh",
    ";": "int",
    "!": "fact",
    "(": "lparen",
    ")": "rparen",
    s: "sin",
    o: "cos",
    t: "tan",
    y: "pow",
    n: "ln",
    l: "log",
    p: "pi",
    i: "inv",
    h: "hyp",
    x: "exp",
    m: "dms",
    v: "fe",
    Insert: "dat",
  }
  if (scientific[k]) return [scientific[k]]
  const bases = { F5: 16, F6: 10, F7: 8, F8: 2 }
  if (bases[k]) return ["base", bases[k]]
  if (state.base === 10) {
    const angles = { F2: "deg", F3: "rad", F4: "grad" }
    if (angles[k]) return ["angle", angles[k]]
  } else {
    const words = { F2: "dword", F3: "word", F4: "byte" }
    if (words[k]) return ["word", words[k]]
  }
  return null
}

// Paste: a plain number becomes the entry; anything else is typed in key by key, so
// pasting "12*3=" calculates 36, as in Windows
export const pasteText = (state, text) => {
  const trimmed = String(text).trim().replace(/,/g, "")
  if (state.base === 10 && /^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(trimmed)) {
    const n = Number(trimmed)
    if (Number.isFinite(n)) return { ...state, error: null, entry: null, value: n, last: "func" }
  }
  if (state.base !== 10 && /^[0-9a-f]+$/i.test(trimmed)) {
    let s = { ...state, last: "start" }
    for (const ch of trimmed.toUpperCase()) s = press(s, ch)
    return s
  }
  // the pasted keys start a new number, keeping any operation already pending
  let s = { ...state, last: state.last === "digit" ? "func" : state.last }
  for (const ch of trimmed) {
    if (/\s/.test(ch)) continue
    const mapped = keyFor(s, { key: ch === "\n" ? "Enter" : ch })
    if (!mapped || ["c", "ce", "back"].includes(mapped[0])) continue
    s = press(s, ...mapped)
  }
  return s
}
