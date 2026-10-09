// Sheets 98's formula engine: pure (no DOM), tested with
//   node --test client/src/components/applets/sheets/engine.test.js
//
// A sheet is { cells: { "A1": "raw text the person typed" }, formats: { "A1": "currency" } }.
// Raw text starting with "=" is a formula; anything else is a number ("12", "1,234.5",
// "$4.50", "15%"), TRUE/FALSE, or text ("'12" keeps 12 as text).
//
// Formulas: numbers, "text", TRUE/FALSE, cell refs (B2, $B$2, B$2, $B2), ranges (A1:B10),
// + - * / ^ (power) & (join text) = <> < > <= >= , unary minus, % after a number, parentheses,
// and functions: SUM AVERAGE MIN MAX COUNT COUNTA IF ROUND ROUNDUP ROUNDDOWN ABS INT MOD
// POWER SQRT AND OR NOT CONCATENATE LEN UPPER LOWER TRIM.
// Errors show in the cell: #DIV/0! #VALUE! #REF! #NAME? #N/A #NUM! #ERROR! (can't read the
// formula) #CYCLE! (the cell depends on itself, directly or through others).
//
// recalc(cells) -> Map(address -> value), every formula worked out once per change, each
// cell after the cells it needs (depth-first with memo); a cell met again while it's still
// being worked out closes a cycle, and every cell in it (and anything using one) is #CYCLE!.
// shiftFormula(raw, dRow, dCol) moves relative refs when a formula is copied (absolute $ parts
// stay put; a ref moved off the sheet becomes #REF!).

export const MAX_COLS = 52 // A..AZ
export const MAX_ROWS = 999

// ---- addresses ----

export const colName = (c) => {
  let s = ""
  c += 1
  while (c > 0) {
    const m = (c - 1) % 26
    s = String.fromCharCode(65 + m) + s
    c = Math.floor((c - 1) / 26)
  }
  return s
}
export const colIndex = (name) => {
  let n = 0
  for (const ch of name.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}
export const addr = (row, col) => `${colName(col)}${row + 1}`
// "B12" -> { row: 11, col: 1 } | null
export const parseAddr = (a) => {
  const m = /^\$?([A-Za-z]{1,2})\$?(\d{1,4})$/.exec(String(a || "").trim())
  if (!m) return null
  const row = Number(m[2]) - 1
  const col = colIndex(m[1])
  if (row < 0 || row >= MAX_ROWS || col < 0 || col >= MAX_COLS) return null
  return { row, col }
}

// ---- errors ----

export class SheetError {
  constructor(code) {
    this.code = code
  }
  toString() {
    return this.code
  }
}
const E = {
  div0: new SheetError("#DIV/0!"),
  value: new SheetError("#VALUE!"),
  ref: new SheetError("#REF!"),
  name: new SheetError("#NAME?"),
  na: new SheetError("#N/A"),
  num: new SheetError("#NUM!"),
  parse: new SheetError("#ERROR!"),
  cycle: new SheetError("#CYCLE!"),
}
export const ERRORS = E
export const isError = (v) => v instanceof SheetError

// ---- literals ----

// typed text that isn't a formula -> number | boolean | string | null (empty)
export const parseLiteral = (raw) => {
  const s = String(raw ?? "")
  if (s === "") return null
  if (s[0] === "'") return s.slice(1)
  const t = s.trim()
  if (/^(true|false)$/i.test(t)) return t.toUpperCase() === "TRUE"
  const m = /^([-+])?\$?\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d*)?|\.\d+)(?:[eE]([-+]?\d+))?\s*(%)?$/.exec(t)
  if (m) {
    let n = Number(m[2].replace(/,/g, "") + (m[3] ? `e${m[3]}` : ""))
    if (m[1] === "-") n = -n
    if (m[4]) n /= 100
    return n
  }
  return s
}

// the format a typed literal suggests ("$4.50" -> currency, "15%" -> percent), or null
export const suggestedFormat = (raw) => {
  const t = String(raw ?? "").trim()
  if (/^[-+]?\$/.test(t) && typeof parseLiteral(t) === "number") return "currency"
  if (/%$/.test(t) && typeof parseLiteral(t) === "number") return "percent"
  return null
}

// ---- tokens ----

const TOKEN = /\s+|(\$?[A-Za-z]{1,2}\$?\d{1,4}(?![A-Za-z0-9_(]))|((?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)|("(?:[^"]|"")*")|([A-Za-z_][A-Za-z0-9_.]*)|(<=|>=|<>|[-+*/^&=<>(),:%])/y

// -> [{ type: "ref" | "num" | "str" | "name" | "op", text, at }]
export const tokenize = (src) => {
  const out = []
  TOKEN.lastIndex = 0
  let at = 0
  while (at < src.length) {
    TOKEN.lastIndex = at
    const m = TOKEN.exec(src)
    if (!m) throw E.parse
    if (m[1]) out.push({ type: "ref", text: m[1], at })
    else if (m[2]) out.push({ type: "num", text: m[2], at })
    else if (m[3]) out.push({ type: "str", text: m[3], at })
    else if (m[4]) out.push({ type: "name", text: m[4], at })
    else if (m[5]) out.push({ type: "op", text: m[5], at })
    at = TOKEN.lastIndex
  }
  return out
}

const refNode = (text) => {
  const m = /^(\$?)([A-Za-z]{1,2})(\$?)(\d{1,4})$/.exec(text)
  const col = colIndex(m[2])
  const row = Number(m[4]) - 1
  return { t: "ref", col, row, colAbs: !!m[1], rowAbs: !!m[3], bad: row < 0 || row >= MAX_ROWS || col >= MAX_COLS }
}

// ---- parser (precedence: comparison < & < + - < * / < ^ < unary - < %) ----

export const parse = (formula) => {
  const tokens = tokenize(formula)
  let i = 0
  const peek = () => tokens[i]
  const isOp = (text) => tokens[i]?.type === "op" && tokens[i].text === text
  const take = (text) => {
    if (!isOp(text)) throw E.parse
    i++
  }

  const primary = () => {
    const tok = tokens[i++]
    if (!tok) throw E.parse
    if (tok.type === "num") return { t: "num", v: Number(tok.text) }
    if (tok.type === "str") return { t: "str", v: tok.text.slice(1, -1).replace(/""/g, '"') }
    if (tok.type === "ref") {
      const a = refNode(tok.text)
      if (isOp(":")) {
        i++
        const next = tokens[i++]
        if (!next || next.type !== "ref") throw E.parse
        return { t: "range", a, b: refNode(next.text) }
      }
      return a
    }
    if (tok.type === "name") {
      const name = tok.text.toUpperCase()
      if (isOp("(")) {
        i++
        const args = []
        if (!isOp(")")) {
          for (;;) {
            args.push(compare())
            if (isOp(",")) {
              i++
              continue
            }
            break
          }
        }
        take(")")
        return { t: "fn", name, args }
      }
      if (name === "TRUE" || name === "FALSE") return { t: "bool", v: name === "TRUE" }
      return { t: "name", name }
    }
    if (tok.text === "(") {
      const e = compare()
      take(")")
      return e
    }
    if (tok.text === "-" || tok.text === "+") {
      const e = unary()
      return tok.text === "-" ? { t: "neg", e } : e
    }
    throw E.parse
  }
  const postfix = () => {
    let e = primary()
    while (isOp("%")) {
      i++
      e = { t: "pct", e }
    }
    return e
  }
  const unary = () => {
    if (isOp("-")) {
      i++
      return { t: "neg", e: unary() }
    }
    if (isOp("+")) {
      i++
      return unary()
    }
    return postfix()
  }
  const power = () => {
    let l = unary()
    while (isOp("^")) {
      i++
      l = { t: "bin", op: "^", l, r: unary() }
    }
    return l
  }
  const level = (next, ops) => () => {
    let l = next()
    while (peek()?.type === "op" && ops.includes(peek().text)) {
      const op = tokens[i++].text
      l = { t: "bin", op, l, r: next() }
    }
    return l
  }
  const product = level(power, ["*", "/"])
  const sum = level(product, ["+", "-"])
  const join = level(sum, ["&"])
  const compare = level(join, ["=", "<>", "<", ">", "<=", ">="])

  const ast = compare()
  if (i !== tokens.length) throw E.parse
  return ast
}

// ---- copying formulas ----

// the raw text of a cell copied dRow rows down and dCol columns right
export const shiftFormula = (raw, dRow, dCol) => {
  const s = String(raw ?? "")
  if (s[0] !== "=") return s
  let tokens
  try {
    tokens = tokenize(s.slice(1))
  } catch {
    return s
  }
  let out = ""
  let at = 0
  const body = s.slice(1)
  for (const tok of tokens) {
    if (tok.type !== "ref") continue
    const r = refNode(tok.text)
    const row = r.rowAbs ? r.row : r.row + dRow
    const col = r.colAbs ? r.col : r.col + dCol
    const text = row < 0 || col < 0 || row >= MAX_ROWS || col >= MAX_COLS ? "#REF!" : `${r.colAbs ? "$" : ""}${colName(col)}${r.rowAbs ? "$" : ""}${row + 1}`
    out += body.slice(at, tok.at) + text
    at = tok.at + tok.text.length
  }
  return `=${out}${body.slice(at)}`
}

// ---- values ----

const toNumber = (v) => {
  if (isError(v)) throw v
  if (v === null || v === undefined || v === "") return 0
  if (typeof v === "number") return v
  if (typeof v === "boolean") return v ? 1 : 0
  const n = parseLiteral(v)
  if (typeof n === "number") return n
  throw E.value
}
const toText = (v) => {
  if (isError(v)) throw v
  if (v === null || v === undefined) return ""
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE"
  if (typeof v === "number") return formatGeneral(v)
  return String(v)
}
const toBool = (v) => {
  if (isError(v)) throw v
  if (typeof v === "boolean") return v
  if (v === null || v === undefined || v === "") return false
  if (typeof v === "number") return v !== 0
  if (/^true$/i.test(v)) return true
  if (/^false$/i.test(v)) return false
  throw E.value
}
const check = (n) => {
  if (!Number.isFinite(n)) throw E.num
  return n
}

const compareValues = (a, b) => {
  if (isError(a)) throw a
  if (isError(b)) throw b
  const kind = (v) => (v === null || v === undefined ? "empty" : typeof v)
  let x = a
  let y = b
  if (kind(x) === "empty") x = kind(y) === "string" ? "" : kind(y) === "boolean" ? false : 0
  if (kind(y) === "empty") y = kind(x) === "string" ? "" : kind(x) === "boolean" ? false : 0
  if (typeof x === "string" && typeof y === "string") {
    x = x.toLowerCase()
    y = y.toLowerCase()
  } else if (typeof x !== typeof y) {
    // numbers < text < booleans, as in spreadsheets
    const rank = { number: 0, string: 1, boolean: 2 }
    return rank[typeof x] - rank[typeof y]
  }
  return x < y ? -1 : x > y ? 1 : 0
}

// numbers among the values (text and booleans inside ranges are skipped, as in Excel; typed
// straight into the function they count)
const numbersOf = (args) => {
  const out = []
  for (const a of args) {
    if (a && a.range) {
      for (const v of a.values) {
        if (isError(v)) throw v
        if (typeof v === "number") out.push(v)
      }
    } else out.push(toNumber(a))
  }
  return out
}
const flat = (args) => args.flatMap((a) => (a && a.range ? a.values : [a]))
const roundTo = (n, digits, mode) => {
  const d = Math.trunc(digits)
  const f = 10 ** d
  const x = n * f
  const r = mode === "up" ? Math.sign(x) * Math.ceil(Math.abs(x) - 1e-9) : mode === "down" ? Math.trunc(x) : Math.sign(x) * Math.round(Math.abs(x) + 1e-9)
  return check(r / f)
}

const FUNCTIONS = {
  SUM: (a) => numbersOf(a).reduce((s, n) => s + n, 0),
  AVERAGE: (a) => {
    const n = numbersOf(a)
    if (!n.length) throw E.div0
    return n.reduce((s, x) => s + x, 0) / n.length
  },
  MIN: (a) => {
    const n = numbersOf(a)
    return n.length ? Math.min(...n) : 0
  },
  MAX: (a) => {
    const n = numbersOf(a)
    return n.length ? Math.max(...n) : 0
  },
  COUNT: (a) => flat(a).filter((v) => typeof v === "number").length,
  COUNTA: (a) => flat(a).filter((v) => v !== null && v !== undefined && v !== "").length,
  ROUND: (a) => roundTo(toNumber(one(a, 0)), a.length > 1 ? toNumber(one(a, 1)) : 0),
  ROUNDUP: (a) => roundTo(toNumber(one(a, 0)), a.length > 1 ? toNumber(one(a, 1)) : 0, "up"),
  ROUNDDOWN: (a) => roundTo(toNumber(one(a, 0)), a.length > 1 ? toNumber(one(a, 1)) : 0, "down"),
  ABS: (a) => Math.abs(toNumber(one(a, 0))),
  INT: (a) => Math.floor(toNumber(one(a, 0))),
  MOD: (a) => {
    const d = toNumber(one(a, 1))
    if (d === 0) throw E.div0
    const n = toNumber(one(a, 0))
    return n - d * Math.floor(n / d)
  },
  POWER: (a) => check(toNumber(one(a, 0)) ** toNumber(one(a, 1))),
  SQRT: (a) => {
    const n = toNumber(one(a, 0))
    if (n < 0) throw E.num
    return Math.sqrt(n)
  },
  AND: (a) => flat(a).filter((v) => v !== null && v !== "").every(toBool),
  OR: (a) => flat(a).filter((v) => v !== null && v !== "").some(toBool),
  NOT: (a) => !toBool(one(a, 0)),
  CONCATENATE: (a) => flat(a).map(toText).join(""),
  CONCAT: (a) => flat(a).map(toText).join(""),
  LEN: (a) => toText(one(a, 0)).length,
  UPPER: (a) => toText(one(a, 0)).toUpperCase(),
  LOWER: (a) => toText(one(a, 0)).toLowerCase(),
  TRIM: (a) => toText(one(a, 0)).trim().replace(/\s+/g, " "),
}
const ARITY = { ROUND: [1, 2], ROUNDUP: [1, 2], ROUNDDOWN: [1, 2], ABS: [1, 1], INT: [1, 1], MOD: [2, 2], POWER: [2, 2], SQRT: [1, 1], NOT: [1, 1], LEN: [1, 1], UPPER: [1, 1], LOWER: [1, 1], TRIM: [1, 1], IF: [2, 3] }
export const FUNCTION_NAMES = [...Object.keys(FUNCTIONS), "IF"].sort()

// a single value argument (a one-cell range counts as that cell)
const one = (args, i) => {
  const a = args[i]
  if (a && a.range) {
    if (a.values.length === 1) return a.values[0]
    throw E.value
  }
  return a
}

// ---- evaluation ----

class Cycle extends Error {}

export const createCalc = (cells) => {
  const values = new Map()
  const state = new Map() // address -> "busy" | "done"
  const asts = new Map()

  const astOf = (a, raw) => {
    if (!asts.has(a)) {
      try {
        asts.set(a, parse(raw.slice(1)))
      } catch {
        asts.set(a, null)
      }
    }
    return asts.get(a)
  }

  const valueOf = (a) => {
    if (state.get(a) === "done") return values.get(a)
    if (state.get(a) === "busy") throw new Cycle()
    const raw = cells[a]
    if (raw === undefined || raw === null || raw === "") return null
    if (raw[0] !== "=" || raw.length < 2) {
      const v = raw === "=" ? raw : parseLiteral(raw)
      values.set(a, v)
      state.set(a, "done")
      return v
    }
    state.set(a, "busy")
    let v
    try {
      const ast = astOf(a, raw)
      v = ast ? evaluate(ast) : E.parse
      if (v && v.range) v = v.values.length === 1 ? v.values[0] : E.value
      if (v === null || v === undefined) v = 0
      if (typeof v === "number" && !Number.isFinite(v)) v = E.num
    } catch (error) {
      if (error instanceof Cycle) {
        v = E.cycle
        values.set(a, v)
        state.set(a, "done")
        throw error // everyone further up the chain is in (or depends on) the cycle
      }
      v = isError(error) ? error : E.value
    }
    values.set(a, v)
    state.set(a, "done")
    return v
  }

  // (a Cycle thrown from here unwinds every formula on the way, marking each #CYCLE!)
  const at = (row, col) => valueOf(addr(row, col))

  const evaluate = (n) => {
    switch (n.t) {
      case "num":
      case "str":
      case "bool":
        return n.v
      case "name":
        throw E.name
      case "ref": {
        if (n.bad) throw E.ref
        const v = at(n.row, n.col)
        if (isError(v)) throw v
        return v
      }
      case "range": {
        if (n.a.bad || n.b.bad) throw E.ref
        const r0 = Math.min(n.a.row, n.b.row)
        const r1 = Math.max(n.a.row, n.b.row)
        const c0 = Math.min(n.a.col, n.b.col)
        const c1 = Math.max(n.a.col, n.b.col)
        const out = []
        for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push(at(r, c))
        return { range: true, values: out }
      }
      case "neg":
        return -toNumber(single(evaluate(n.e)))
      case "pct":
        return toNumber(single(evaluate(n.e))) / 100
      case "bin": {
        const l = single(evaluate(n.l))
        const r = single(evaluate(n.r))
        switch (n.op) {
          case "+":
            return toNumber(l) + toNumber(r)
          case "-":
            return toNumber(l) - toNumber(r)
          case "*":
            return toNumber(l) * toNumber(r)
          case "/": {
            const d = toNumber(r)
            const x = toNumber(l)
            if (d === 0) throw E.div0
            return x / d
          }
          case "^":
            return check(toNumber(l) ** toNumber(r))
          case "&":
            return toText(l) + toText(r)
          case "=":
            return compareValues(l, r) === 0
          case "<>":
            return compareValues(l, r) !== 0
          case "<":
            return compareValues(l, r) < 0
          case ">":
            return compareValues(l, r) > 0
          case "<=":
            return compareValues(l, r) <= 0
          case ">=":
            return compareValues(l, r) >= 0
        }
        throw E.parse
      }
      case "fn": {
        const [lo, hi] = ARITY[n.name] || [1, 255]
        if (!FUNCTIONS[n.name] && n.name !== "IF") throw E.name
        if (n.args.length < lo || n.args.length > hi) throw E.value
        if (n.name === "IF") {
          // only the branch taken is worked out
          const test = toBool(single(evaluate(n.args[0])))
          if (test) return single(evaluate(n.args[1]))
          return n.args.length > 2 ? single(evaluate(n.args[2])) : false
        }
        return FUNCTIONS[n.name](n.args.map(evaluate))
      }
    }
    throw E.parse
  }
  const single = (v) => {
    if (v && v.range) {
      if (v.values.length === 1) return v.values[0]
      throw E.value
    }
    return v
  }

  // the value of one cell ("B3"); a cycle has already been marked on the way back
  const get = (a) => {
    try {
      return valueOf(a)
    } catch (error) {
      if (error instanceof Cycle) return values.get(a) ?? E.cycle
      throw error
    }
  }
  return { get, values }
}

// every non-empty cell's value: Map(address -> number | string | boolean | SheetError)
export const recalc = (cells) => {
  const calc = createCalc(cells)
  for (const a of Object.keys(cells)) calc.get(a)
  // a cycle found from one cell leaves the rest of the loop marked "done" with #CYCLE!, but a
  // cell whose work was cut short by the throw is still unset: work those out now
  const out = new Map()
  for (const a of Object.keys(cells)) {
    const v = calc.values.has(a) ? calc.values.get(a) : calc.get(a)
    if (v !== null && v !== undefined) out.set(a, v)
  }
  return out
}

// ---- formats ----

export const FORMATS = [
  { id: "general", label: "General" },
  { id: "number", label: "Number (1,234.50)" },
  { id: "currency", label: "Currency ($1,234.50)" },
  { id: "percent", label: "Percent (12.5%)" },
  { id: "integer", label: "Whole number (1,235)" },
  { id: "text", label: "Text" },
]

export const formatGeneral = (n) => {
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n)
  if (Math.abs(n) >= 1e11 || (Math.abs(n) < 1e-9 && n !== 0)) return n.toExponential(5).replace(/\.?0+e/, "e")
  return String(Number(n.toPrecision(10)))
}

const nf = new Map()
const numberFormat = (key, options) => {
  if (!nf.has(key)) nf.set(key, new Intl.NumberFormat("en-US", options))
  return nf.get(key)
}

// what a cell shows
export const display = (value, format = "general") => {
  if (value === null || value === undefined) return ""
  if (isError(value)) return value.code
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE"
  if (typeof value !== "number") return String(value)
  switch (format) {
    case "number":
      return numberFormat("n", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
    case "currency":
      return numberFormat("c", { style: "currency", currency: "USD" }).format(value)
    case "percent":
      return numberFormat("p", { style: "percent", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value)
    case "integer":
      return numberFormat("i", { maximumFractionDigits: 0 }).format(value)
    default:
      return formatGeneral(value)
  }
}

// ---- CSV (RFC 4180) ----

// text -> rows of strings (quotes, "" inside quotes, commas and line breaks inside quotes)
export const parseCsv = (text) => {
  const rows = []
  let row = []
  let field = ""
  let quoted = false
  const s = String(text ?? "").replace(/^﻿/, "")
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += ch
    } else if (ch === '"' && field === "") quoted = true
    else if (ch === ",") {
      row.push(field)
      field = ""
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++
      row.push(field)
      rows.push(row)
      row = []
      field = ""
    } else field += ch
  }
  if (field !== "" || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

const csvField = (v) => (/[",\r\n]/.test(v) || /^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
export const toCsv = (rows) => rows.map((r) => r.map((v) => csvField(String(v ?? ""))).join(",")).join("\r\n") + "\r\n"

// the used area: { rows, cols } (1 past the last non-empty cell)
export const usedSize = (cells) => {
  let rows = 0
  let cols = 0
  for (const [a, raw] of Object.entries(cells)) {
    if (raw === "" || raw == null) continue
    const p = parseAddr(a)
    if (!p) continue
    rows = Math.max(rows, p.row + 1)
    cols = Math.max(cols, p.col + 1)
  }
  return { rows, cols }
}

// a sheet -> CSV of what the cells show (formulas saved as their results, like any spreadsheet)
export const sheetToCsv = ({ cells, formats = {} }) => {
  const values = recalc(cells)
  const { rows, cols } = usedSize(cells)
  const out = []
  for (let r = 0; r < rows; r++) {
    const line = []
    for (let c = 0; c < cols; c++) {
      const a = addr(r, c)
      const v = values.get(a)
      // numbers keep full precision unless a format says otherwise (no thousands commas)
      line.push(v === undefined ? "" : typeof v === "number" && (!formats[a] || formats[a] === "general") ? String(v) : display(v, formats[a]).replace(/,(?=\d{3})/g, ""))
    }
    out.push(line)
  }
  return toCsv(out)
}

// CSV text -> a sheet (each field as typed; a field that looks like a formula stays text so a
// downloaded file can't run anything)
export const csvToSheet = (text) => {
  const cells = {}
  parseCsv(text).forEach((row, r) => {
    if (r >= MAX_ROWS) return
    row.forEach((v, c) => {
      if (c >= MAX_COLS || v === "") return
      cells[addr(r, c)] = /^[=]/.test(v) ? `'${v}` : v
    })
  })
  return { cells, formats: {} }
}

// ---- the .sheet file (Sheets 98's own format: JSON) ----

export const SHEET_VERSION = 1
export const serialize = (sheet) =>
  JSON.stringify({ app: "Sheets 98", version: SHEET_VERSION, cells: sheet.cells || {}, formats: sheet.formats || {}, widths: sheet.widths || {}, chart: sheet.chart || null })

export const deserialize = (text) => {
  const data = JSON.parse(text)
  if (!data || data.app !== "Sheets 98" || typeof data.cells !== "object") throw new Error("This isn't a Sheets 98 file.")
  const cells = {}
  for (const [a, raw] of Object.entries(data.cells)) if (parseAddr(a) && typeof raw === "string" && raw !== "") cells[addr(parseAddr(a).row, parseAddr(a).col)] = raw.slice(0, 5000)
  const formats = {}
  const known = new Set(FORMATS.map((f) => f.id))
  for (const [a, f] of Object.entries(data.formats || {})) if (parseAddr(a) && known.has(f)) formats[a] = f
  const widths = {}
  for (const [c, w] of Object.entries(data.widths || {})) if (/^\d+$/.test(c) && Number.isFinite(w)) widths[c] = Math.max(30, Math.min(400, w))
  return { cells, formats, widths, chart: data.chart && typeof data.chart === "object" ? data.chart : null }
}

// ---- ranges for the UI ----

// { r0, c0, r1, c1 } from two corners
export const rangeOf = (a, b) => ({ r0: Math.min(a.row, b.row), c0: Math.min(a.col, b.col), r1: Math.max(a.row, b.row), c1: Math.max(a.col, b.col) })
export const rangeText = (r) => (r.r0 === r.r1 && r.c0 === r.c1 ? addr(r.r0, r.c0) : `${addr(r.r0, r.c0)}:${addr(r.r1, r.c1)}`)

// copy a block of raw cells to a new top-left, shifting formulas -> { address: raw }
export const pasteBlock = (block, toRow, toCol) => {
  // block: { r0, c0, cells: [[raw]] } (from copyBlock)
  const out = {}
  block.cells.forEach((line, i) =>
    line.forEach((raw, j) => {
      const row = toRow + i
      const col = toCol + j
      if (row >= MAX_ROWS || col >= MAX_COLS) return
      out[addr(row, col)] = shiftFormula(raw, row - (block.r0 + i), col - (block.c0 + j))
    })
  )
  return out
}
export const copyBlock = (cells, r) => {
  const out = []
  for (let row = r.r0; row <= r.r1; row++) {
    const line = []
    for (let col = r.c0; col <= r.c1; col++) line.push(cells[addr(row, col)] ?? "")
    out.push(line)
  }
  return { r0: r.r0, c0: r.c0, cells: out }
}
