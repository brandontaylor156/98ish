// Visual Basic 98's language: a small, friendly slice of Visual Basic 6, compiled to
// JavaScript that runs inside the program's sandbox (sandbox.js). Pure: no DOM, so the unit
// tests run it in Node.
//
//   compile(source, { controls: ["Label1", "Command1", ...] })
//     -> { ok: true, js, subs: ["command1_click", ...] }
//     |  { ok: false, error: { line, message } }
//
// What it understands (case doesn't matter, as in VB):
//   ' comments and Rem          Dim x [As T] [= value]  Dim a(10)  ReDim a(n)  Const N = 5
//   x = expr   Label1.Caption = expr   a(i) = expr   Shared("key") = expr
//   If c Then ... ElseIf c Then ... Else ... End If      If c Then stmt [Else stmt]
//   For i = a To b [Step s] ... Next [i]   For Each x In list ... Next   Exit For / Exit Do
//   Do [While|Until c] ... Loop [While|Until c]   While c ... Wend
//   Select Case x / Case 1, 2 / Case 3 To 5 / Case Is > 9 / Case Else / End Select
//   Sub Name(a, b) ... End Sub   Function Name(a) ... Name = value ... End Function   Exit Sub
//   Call Name(a)   Name a, b   List1.AddItem "x"   MsgBox "Hi"   x = InputBox("Name?")
//   operators: + - * / \ Mod ^ & = <> < > <= >= And Or Not Xor
//
// The compiled code calls a runtime object R (sandbox.js):
//   R.c(name) a control; R.get(obj, prop); R.set(obj, prop, v); R.call(obj, method, args)
//   R.fn.<builtin>(...) sync built-ins; await R.async.<builtin>(...) MsgBox/InputBox/Wait
//   R.tick() every loop turn and procedure entry: stops an endless loop
//   R.add, R.cat, R.eq, R.cmp, R.idiv, R.mod, R.pow, R.not, R.truthy, R.arr, R.idx, R.iter
//   R.shared.get(k) / R.shared.set(k, v), R.me, R.friends, R.form
// Every user Sub/Function is async (so MsgBox and InputBox can wait for an answer).

export const KEYWORDS = new Set(
  "and as byref byval call case const dim do each else elseif end exit false for function if in is loop mod new next not nothing optional or preserve redim rem select step sub then to true until wend while xor".split(" ")
)

// built-ins: name -> { async?: true, min, max }
export const BUILTINS = {
  len: { min: 1, max: 1 },
  left: { min: 2, max: 2 },
  right: { min: 2, max: 2 },
  mid: { min: 2, max: 3 },
  ucase: { min: 1, max: 1 },
  lcase: { min: 1, max: 1 },
  trim: { min: 1, max: 1 },
  ltrim: { min: 1, max: 1 },
  rtrim: { min: 1, max: 1 },
  instr: { min: 2, max: 3 },
  replace: { min: 3, max: 3 },
  str: { min: 1, max: 1 },
  cstr: { min: 1, max: 1 },
  val: { min: 1, max: 1 },
  cint: { min: 1, max: 1 },
  clng: { min: 1, max: 1 },
  cdbl: { min: 1, max: 1 },
  cbool: { min: 1, max: 1 },
  int: { min: 1, max: 1 },
  fix: { min: 1, max: 1 },
  abs: { min: 1, max: 1 },
  sqr: { min: 1, max: 1 },
  sin: { min: 1, max: 1 },
  cos: { min: 1, max: 1 },
  round: { min: 1, max: 2 },
  rnd: { min: 0, max: 1 },
  random: { min: 2, max: 2 },
  now: { min: 0, max: 0 },
  time: { min: 0, max: 0 },
  date: { min: 0, max: 0 },
  timer: { min: 0, max: 0 },
  hour: { min: 0, max: 1 },
  chr: { min: 1, max: 1 },
  asc: { min: 1, max: 1 },
  split: { min: 1, max: 2 },
  join: { min: 1, max: 2 },
  ubound: { min: 1, max: 1 },
  lbound: { min: 1, max: 1 },
  isnumeric: { min: 1, max: 1 },
  isempty: { min: 1, max: 1 },
  rgb: { min: 3, max: 3 },
  format: { min: 1, max: 2 },
  string: { min: 2, max: 2 },
  space: { min: 1, max: 1 },
  daysuntil: { min: 1, max: 1 },
  msgbox: { async: true, min: 1, max: 3 },
  inputbox: { async: true, min: 1, max: 3 },
  wait: { async: true, min: 1, max: 1 },
  beep: { min: 0, max: 0 },
}

// constants anyone can use
export const CONSTANTS = {
  vbred: '"#ff0000"',
  vbgreen: '"#008000"',
  vbblue: '"#0000ff"',
  vbyellow: '"#ffff00"',
  vbblack: '"#000000"',
  vbwhite: '"#ffffff"',
  vbmagenta: '"#ff00ff"',
  vbcyan: '"#00ffff"',
  vbgray: '"#c0c0c0"',
  vbgrey: '"#c0c0c0"',
  vbnavy: '"#000080"',
  vborange: '"#ff8000"',
  vbpink: '"#ff80c0"',
  vbteal: '"#008080"',
  vbcrlf: '"\\n"',
  vbnewline: '"\\n"',
  vbtab: '"\\t"',
  vbyes: "6",
  vbno: "7",
  vbok: "1",
  vbyesno: "4",
  vbokonly: "0",
  pi: String(Math.PI),
}

// the built-in objects: their names can't be used for variables
const SPECIAL = new Set(["shared", "me", "friends", "form", "sound", "app", "screen"])

export class VbError extends Error {
  constructor(message, line) {
    super(message)
    this.line = line
  }
}

// ---- tokens ----
// { t: "id" | "num" | "str" | "op" | "nl", v, line }
export const tokenize = (src) => {
  const out = []
  const s = String(src ?? "").replace(/\r\n?/g, "\n")
  let i = 0
  let line = 1
  const push = (t, v) => out.push({ t, v, line })
  while (i < s.length) {
    const c = s[i]
    if (c === "\n") {
      push("nl", "\n")
      line++
      i++
      continue
    }
    if (c === " " || c === "\t") {
      i++
      continue
    }
    // a line ending in " _" goes on
    if (c === "_" && /[ \t]/.test(s[i - 1] || " ") && /^[ \t]*(\n|$)/.test(s.slice(i + 1))) {
      const nl = s.indexOf("\n", i)
      i = nl < 0 ? s.length : nl + 1
      line++
      continue
    }
    if (c === "'") {
      while (i < s.length && s[i] !== "\n") i++
      continue
    }
    if (c === ":") {
      push("nl", ":")
      i++
      continue
    }
    if (c === '"') {
      let j = i + 1
      let text = ""
      for (;;) {
        if (j >= s.length || s[j] === "\n") throw new VbError("A string is missing its closing quote (\")", line)
        if (s[j] === '"') {
          if (s[j + 1] === '"') {
            text += '"'
            j += 2
            continue
          }
          break
        }
        text += s[j++]
      }
      push("str", text)
      i = j + 1
      continue
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(s[i + 1] || ""))) {
      const m = /^[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?/.exec(s.slice(i)) || /^[0-9]+/.exec(s.slice(i))
      push("num", Number(m[0]))
      i += m[0].length
      continue
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*[$%&!#]?/.exec(s.slice(i))
      const word = m[0].replace(/[$%&!#]$/, "")
      // Rem starts a comment
      if (word.toLowerCase() === "rem") {
        while (i < s.length && s[i] !== "\n") i++
        continue
      }
      push("id", word)
      i += m[0].length
      continue
    }
    const two = s.slice(i, i + 2)
    if (two === "<>" || two === "<=" || two === ">=") {
      push("op", two)
      i += 2
      continue
    }
    if ("+-*/\\^&=<>(),.".includes(c)) {
      push("op", c)
      i++
      continue
    }
    throw new VbError(`I don't understand the character "${c}"`, line)
  }
  push("nl", "\n")
  return out
}

// ---- parser ----
const lc = (tok) => (tok && tok.t === "id" ? tok.v.toLowerCase() : null)

export const parse = (src) => {
  const toks = tokenize(src)
  let p = 0
  const peek = (k = 0) => toks[p + k]
  const next = () => toks[p++]
  const atEnd = () => p >= toks.length
  const isKw = (word, k = 0) => lc(peek(k)) === word
  const isOp = (op, k = 0) => peek(k)?.t === "op" && peek(k).v === op
  const isNl = (k = 0) => !peek(k) || peek(k).t === "nl"
  const fail = (message, tok = peek()) => {
    throw new VbError(message, tok?.line ?? toks[toks.length - 1]?.line ?? 1)
  }
  const expectKw = (word, what = word) => {
    if (!isKw(word)) fail(`Expected "${what}"`)
    return next()
  }
  const expectOp = (op) => {
    if (!isOp(op)) fail(`Expected "${op}"`)
    return next()
  }
  const skipNl = () => {
    while (!atEnd() && peek().t === "nl") p++
  }
  const endLine = () => {
    if (!isNl()) fail(`Unexpected "${peek().v}"`)
    while (!atEnd() && peek().t === "nl") p++
  }
  const ident = (what = "a name") => {
    const tok = peek()
    if (tok?.t !== "id") fail(`Expected ${what}`)
    if (KEYWORDS.has(tok.v.toLowerCase())) fail(`"${tok.v}" is a reserved word and can't be used as ${what}`)
    p++
    return tok
  }

  // ---- expressions (precedence: Or/Xor < And < Not < compare < & < + - < Mod < \ < * / < unary - < ^) ----
  const expr = () => orExpr()
  const bin = (sub, ops) => () => {
    let left = sub()
    for (;;) {
      const tok = peek()
      const op = tok?.t === "op" ? tok.v : lc(tok)
      if (!op || !ops.includes(op)) return left
      p++
      left = { k: "bin", op, left, right: sub(), line: tok.line }
    }
  }
  const primary = () => {
    const tok = peek()
    if (!tok || tok.t === "nl") fail("An expression is missing here")
    if (tok.t === "num") return next(), { k: "num", v: tok.v }
    if (tok.t === "str") return next(), { k: "str", v: tok.v }
    if (isOp("(")) {
      next()
      const e = expr()
      expectOp(")")
      return postfix({ k: "paren", e })
    }
    if (tok.t === "id") {
      const word = tok.v.toLowerCase()
      if (word === "true" || word === "false") return next(), { k: "bool", v: word === "true" }
      if (word === "nothing") return next(), { k: "str", v: "" }
      if (KEYWORDS.has(word)) fail(`Unexpected "${tok.v}"`)
      next()
      return postfix({ k: "name", name: word, raw: tok.v, line: tok.line })
    }
    fail(`Unexpected "${tok.v}"`)
  }
  const args = () => {
    const list = []
    if (isOp(")")) return next(), list
    for (;;) {
      list.push(expr())
      if (isOp(",")) {
        next()
        continue
      }
      expectOp(")")
      return list
    }
  }
  const postfix = (node) => {
    for (;;) {
      if (isOp(".")) {
        next()
        const tok = peek()
        if (tok?.t !== "id") fail("Expected a property or method name after the dot")
        next()
        node = { k: "member", obj: node, name: tok.v.toLowerCase(), raw: tok.v, line: tok.line }
        continue
      }
      if (isOp("(")) {
        const line = peek().line
        next()
        node = { k: "apply", target: node, args: args(), line }
        continue
      }
      return node
    }
  }
  const pow = () => {
    let left = primary()
    while (isOp("^")) {
      next()
      left = { k: "bin", op: "^", left, right: unary() }
    }
    return left
  }
  const unary = () => {
    if (isOp("-")) return next(), { k: "neg", e: unary() }
    if (isOp("+")) return next(), unary()
    return pow()
  }
  const mul = bin(unary, ["*", "/"])
  const idiv = bin(mul, ["\\"])
  const mod = bin(idiv, ["mod"])
  const add = bin(mod, ["+", "-"])
  const cat = bin(add, ["&"])
  const cmp = bin(cat, ["=", "<>", "<", ">", "<=", ">="])
  const notExpr = () => {
    if (isKw("not")) return next(), { k: "not", e: notExpr() }
    return cmp()
  }
  const andExpr = bin(notExpr, ["and"])
  const orExpr = bin(andExpr, ["or", "xor"])

  // a statement's argument list without parentheses: `MsgBox "hi", 1`
  const bareArgs = () => {
    const list = []
    if (isNl() || isKw("else")) return list
    for (;;) {
      list.push(expr())
      if (isOp(",")) {
        next()
        continue
      }
      return list
    }
  }

  // ---- statements ----
  const block = (enders) => {
    const body = []
    for (;;) {
      skipNl()
      if (atEnd()) return body
      if (enders(peek(), peek(1))) return body
      // an "End Sub" (or End If...) that isn't ours: the block above is missing its end
      if (lc(peek()) === "end" && ["sub", "function", "if", "select"].includes(lc(peek(1)))) return body
      if (["next", "loop", "wend"].includes(lc(peek())) || (lc(peek()) === "else" && isNl(1)) || lc(peek()) === "elseif" || lc(peek()) === "case") return body
      body.push(statement())
    }
  }
  const isEnd = (word) => (a, b) => lc(a) === "end" && lc(b) === word

  const dimItem = (line) => {
    const name = ident("a variable name")
    let size = null
    if (isOp("(")) {
      next()
      size = isOp(")") ? { k: "num", v: -1 } : expr()
      expectOp(")")
    }
    if (isKw("as")) {
      next()
      if (isKw("new")) next()
      ident("a type")
    }
    let init = null
    if (isOp("=")) {
      next()
      init = expr()
    }
    return { name: name.v.toLowerCase(), raw: name.v, size, init, line }
  }

  const statement = () => {
    const tok = peek()
    const line = tok.line
    const word = lc(tok)
    if (word === "dim" || word === "private" || word === "public" || word === "static" || word === "global") {
      next()
      const items = [dimItem(line)]
      while (isOp(",")) next(), items.push(dimItem(line))
      endLine()
      return { k: "dim", items, line }
    }
    if (word === "const") {
      next()
      const items = []
      do {
        if (items.length) next()
        const name = ident("a constant name")
        if (isKw("as")) next(), ident("a type")
        expectOp("=")
        items.push({ name: name.v.toLowerCase(), raw: name.v, init: expr(), line })
      } while (isOp(","))
      endLine()
      return { k: "dim", items, line, constant: true }
    }
    if (word === "redim") {
      next()
      if (isKw("preserve")) next()
      const name = ident("an array name")
      expectOp("(")
      const size = expr()
      expectOp(")")
      endLine()
      return { k: "redim", name: name.v.toLowerCase(), size, line }
    }
    if (word === "if") {
      next()
      const cond = expr()
      expectKw("then")
      if (!isNl()) {
        // one-line If
        const then = [simple()]
        let other = []
        if (isKw("else")) {
          next()
          other = [simple()]
        }
        endLine()
        return { k: "if", arms: [{ cond, body: then }], other, line }
      }
      endLine()
      const arms = [{ cond, body: block((a, b) => lc(a) === "elseif" || lc(a) === "else" || (lc(a) === "end" && lc(b) === "if")) }]
      let other = []
      for (;;) {
        if (isKw("elseif")) {
          next()
          const c = expr()
          expectKw("then")
          endLine()
          arms.push({ cond: c, body: block((a, b) => lc(a) === "elseif" || lc(a) === "else" || (lc(a) === "end" && lc(b) === "if")) })
          continue
        }
        if (isKw("else")) {
          next()
          endLine()
          other = block(isEnd("if"))
        }
        break
      }
      if (!(isKw("end") && isKw("if", 1))) fail('This "If" is missing its "End If"', tok)
      next(), next()
      endLine()
      return { k: "if", arms, other, line }
    }
    if (word === "for") {
      next()
      if (isKw("each")) {
        next()
        const v = ident("a loop variable")
        expectKw("in")
        const list = expr()
        endLine()
        const body = block((a) => lc(a) === "next")
        if (!isKw("next")) fail('This "For Each" is missing its "Next"', tok)
        next()
        if (!isNl()) ident()
        endLine()
        return { k: "foreach", name: v.v.toLowerCase(), list, body, line }
      }
      const v = ident("a loop variable")
      expectOp("=")
      const from = expr()
      expectKw("to")
      const to = expr()
      let step = null
      if (isKw("step")) next(), (step = expr())
      endLine()
      const body = block((a) => lc(a) === "next")
      if (!isKw("next")) fail('This "For" is missing its "Next"', tok)
      next()
      if (!isNl()) ident()
      endLine()
      return { k: "for", name: v.v.toLowerCase(), from, to, step, body, line }
    }
    if (word === "do") {
      next()
      let pre = null
      if (isKw("while") || isKw("until")) {
        const kind = lc(next())
        pre = { kind, cond: expr() }
      }
      endLine()
      const body = block((a) => lc(a) === "loop")
      if (!isKw("loop")) fail('This "Do" is missing its "Loop"', tok)
      next()
      let post = null
      if (isKw("while") || isKw("until")) {
        const kind = lc(next())
        post = { kind, cond: expr() }
      }
      endLine()
      return { k: "do", pre, post, body, line }
    }
    if (word === "while") {
      next()
      const cond = expr()
      endLine()
      const body = block((a) => lc(a) === "wend")
      if (!isKw("wend")) fail('This "While" is missing its "Wend"', tok)
      next()
      endLine()
      return { k: "do", pre: { kind: "while", cond }, post: null, body, line }
    }
    if (word === "select") {
      next()
      expectKw("case")
      const subject = expr()
      endLine()
      const cases = []
      let other = null
      skipNl()
      while (isKw("case")) {
        next()
        if (isKw("else")) {
          next()
          endLine()
          other = block((a, b) => lc(a) === "case" || (lc(a) === "end" && lc(b) === "select"))
          continue
        }
        const tests = []
        for (;;) {
          if (isKw("is")) {
            next()
            const op = peek()
            if (op?.t !== "op" || !["=", "<>", "<", ">", "<=", ">="].includes(op.v)) fail('Expected a comparison after "Is"')
            next()
            tests.push({ kind: "is", op: op.v, e: expr() })
          } else {
            const a = expr()
            if (isKw("to")) {
              next()
              tests.push({ kind: "range", a, b: expr() })
            } else tests.push({ kind: "eq", e: a })
          }
          if (isOp(",")) {
            next()
            continue
          }
          break
        }
        endLine()
        cases.push({ tests, body: block((a, b) => lc(a) === "case" || (lc(a) === "end" && lc(b) === "select")) })
      }
      if (!(isKw("end") && isKw("select", 1))) fail('This "Select Case" is missing its "End Select"', tok)
      next(), next()
      endLine()
      return { k: "select", subject, cases, other, line }
    }
    if (word === "sub" || word === "function" || ((word === "private" || word === "public") && (isKw("sub", 1) || isKw("function", 1)))) {
      fail(`A ${word === "function" ? "Function" : "Sub"} can't go inside another one`)
    }
    const s = simple()
    endLine()
    return s
  }

  // statements that fit on one line (also the parts of a one-line If)
  const simple = () => {
    const tok = peek()
    const line = tok.line
    const word = lc(tok)
    if (word === "exit") {
      next()
      const what = lc(next())
      if (!["sub", "function", "for", "do"].includes(what)) fail('Expected "Exit Sub", "Exit Function", "Exit For" or "Exit Do"', tok)
      return { k: "exit", what, line }
    }
    if (word === "call") {
      next()
      const target = postfix({ k: "name", ...nameTok(ident("a procedure name")) })
      return { k: "call", e: target, bare: [], line }
    }
    if (word === "end" && isNl(1)) {
      next()
      return { k: "endprog", line }
    }
    if (tok.t !== "id" || KEYWORDS.has(word)) fail(`Unexpected "${tok.v}"`)
    // assignment, or a call
    next()
    const target = postfix({ k: "name", name: word, raw: tok.v, line })
    if (isOp("=")) {
      next()
      return { k: "assign", target, e: expr(), line }
    }
    return { k: "call", e: target, bare: bareArgs(), line }
  }
  const nameTok = (tok) => ({ name: tok.v.toLowerCase(), raw: tok.v, line: tok.line })

  // ---- the program: Subs, Functions and module-level Dims/Consts ----
  const program = { procs: [], module: [] }
  skipNl()
  while (!atEnd()) {
    if (isKw("private") || isKw("public")) {
      if (isKw("sub", 1) || isKw("function", 1)) next()
    }
    if (isKw("sub") || isKw("function")) {
      const head = next()
      const kind = lc(head)
      const name = ident(kind === "sub" ? "a Sub name" : "a Function name")
      const params = []
      if (isOp("(")) {
        next()
        if (!isOp(")"))
          for (;;) {
            if (isKw("byval") || isKw("byref") || isKw("optional")) next()
            const pn = ident("a parameter name")
            if (isKw("as")) next(), ident("a type")
            params.push(pn.v.toLowerCase())
            if (isOp(",")) {
              next()
              continue
            }
            break
          }
        expectOp(")")
      }
      if (isKw("as")) next(), ident("a type")
      endLine()
      const body = block(isEnd(kind))
      const stray = { next: '"Next" without a "For"', loop: '"Loop" without a "Do"', wend: '"Wend" without a "While"', else: '"Else" without an "If"', elseif: '"ElseIf" without an "If"', case: '"Case" without a "Select Case"' }[lc(peek())]
      if (stray) fail(stray)
      if (isKw("end") && (isKw("if", 1) || isKw("select", 1))) fail(`"End ${peek(1).v}" without a matching start`)
      if (!(isKw("end") && isKw(kind, 1))) fail(`This ${kind === "sub" ? "Sub" : "Function"} is missing its "End ${kind === "sub" ? "Sub" : "Function"}"`, head)
      next(), next()
      endLine()
      const lname = name.v.toLowerCase()
      if (program.procs.some((pr) => pr.name === lname)) throw new VbError(`"${name.v}" is defined twice`, head.line)
      program.procs.push({ kind, name: lname, raw: name.v, params, body, line: head.line })
      skipNl()
      continue
    }
    const st = statement()
    if (st.k !== "dim") fail("Outside a Sub only Dim and Const can go here; put this inside a Sub (like Form_Load)", { line: st.line })
    program.module.push(st)
    skipNl()
  }
  return program
}

// ---- compiler ----
const js = (v) => JSON.stringify(v)

export const compile = (source, { controls = [] } = {}) => {
  try {
    return { ok: true, ...compileProgram(parse(source), controls) }
  } catch (error) {
    if (error instanceof VbError) return { ok: false, error: { line: error.line, message: error.message } }
    throw error
  }
}

const compileProgram = (program, controls) => {
  const ctl = new Set(controls.map((c) => String(c).toLowerCase()))
  const procs = new Map(program.procs.map((pr) => [pr.name, pr]))
  const moduleVars = new Map() // name -> { array, constant }
  const err = (message, line) => {
    throw new VbError(message, line)
  }
  const reserved = (name, line) => {
    if (ctl.has(name)) err(`"${name}" is already the name of a control on the form`, line)
    if (SPECIAL.has(name)) err(`"${name}" is a built-in object`, line)
    if (BUILTINS[name]) err(`"${name}" is a built-in function`, line)
  }
  for (const st of program.module) for (const it of st.items) {
    reserved(it.name, it.line)
    moduleVars.set(it.name, { array: !!it.size, constant: !!st.constant })
  }
  // variables used without Dim: assigned somewhere -> module variables (VB without Option
  // Explicit); only read -> a typo, reported
  const assigned = new Set()
  const walkAssign = (body) => {
    for (const st of body) {
      if (st.k === "assign" && st.target.k === "name") assigned.add(st.target.name)
      if (st.k === "assign" && st.target.k === "apply" && st.target.target.k === "name") assigned.add(`${st.target.target.name}()`)
      if (st.k === "for" || st.k === "foreach") assigned.add(st.name)
      for (const key of ["body", "other"]) if (Array.isArray(st[key])) walkAssign(st[key])
      if (st.arms) for (const a of st.arms) walkAssign(a.body)
      if (st.cases) for (const c of st.cases) walkAssign(c.body)
      if (st.k === "select" && st.other) walkAssign(st.other)
    }
  }
  for (const pr of program.procs) walkAssign(pr.body)

  let labelSeq = 0
  const out = []
  out.push('"use strict";')
  for (const st of program.module) for (const it of st.items) out.push(`let v_${it.name} = ${it.size ? `R.arr(${expr(it.size, null)})` : it.init ? expr(it.init, null) : '""'};`)

  // scope: { proc, locals: Map(name -> { array }), loops: [{ kind, label }] }
  function lookupVar(name, scope) {
    if (scope?.locals.has(name)) return { where: "local", ...scope.locals.get(name) }
    if (moduleVars.has(name)) return { where: "module", ...moduleVars.get(name) }
    return null
  }

  function expr(e, scope) {
    switch (e.k) {
      case "num":
        return String(e.v)
      case "str":
        return js(e.v)
      case "bool":
        return e.v ? "true" : "false"
      case "paren":
        return `(${expr(e.e, scope)})`
      case "neg":
        return `(-R.num(${expr(e.e, scope)}))`
      case "not":
        return `R.not(${expr(e.e, scope)})`
      case "bin": {
        const a = expr(e.left, scope)
        const b = expr(e.right, scope)
        switch (e.op) {
          case "+":
            return `R.add(${a}, ${b})`
          case "-":
            return `(R.num(${a}) - R.num(${b}))`
          case "*":
            return `(R.num(${a}) * R.num(${b}))`
          case "/":
            return `R.div(${a}, ${b})`
          case "\\":
            return `R.idiv(${a}, ${b})`
          case "mod":
            return `R.mod(${a}, ${b})`
          case "^":
            return `R.pow(${a}, ${b})`
          case "&":
            return `R.cat(${a}, ${b})`
          case "=":
            return `R.eq(${a}, ${b})`
          case "<>":
            return `!R.eq(${a}, ${b})`
          case "<":
          case ">":
          case "<=":
          case ">=":
            return `(R.cmp(${a}, ${b}) ${e.op} 0)`
          case "and":
            return `(R.truthy(${a}) && R.truthy(${b}))`
          case "or":
            return `(R.truthy(${a}) || R.truthy(${b}))`
          case "xor":
            return `(R.truthy(${a}) !== R.truthy(${b}))`
        }
        return err(`Unknown operator ${e.op}`, e.line)
      }
      case "name":
        return nameRef(e, scope)
      case "member": {
        // Obj.Prop: a control, the form, Me, App
        return `R.get(${objRef(e.obj, scope)}, ${js(e.name)})`
      }
      case "apply":
        return applyRef(e, scope, false)
    }
    return err("I can't work out this expression", e.line)
  }

  function objRef(o, scope) {
    if (o.k === "name") {
      if (ctl.has(o.name)) return `R.c(${js(o.name)})`
      if (o.name === "form" || o.name === "me" || o.name === "app" || o.name === "screen" || o.name === "sound" || o.name === "shared" || o.name === "friends") return `R.obj(${js(o.name)})`
      const v = lookupVar(o.name, scope)
      if (v) return `v_${o.name}`
      err(`There's no control or object called "${o.raw}"`, o.line)
    }
    if (o.k === "apply" && o.target.k === "member") return applyRef(o, scope, false)
    if (o.k === "apply" && o.target.k === "name") {
      // a control array-ish lookup isn't supported; an array element holding a control name is
      return expr(o, scope)
    }
    return expr(o, scope)
  }

  function nameRef(e, scope) {
    const name = e.name
    if (scope?.proc?.kind === "function" && name === scope.proc.name) return `v_${name}`
    const v = lookupVar(name, scope)
    if (v) return `v_${name}`
    if (CONSTANTS[name]) return CONSTANTS[name]
    if (ctl.has(name)) return `R.dflt(R.c(${js(name)}))` // Label1 alone = its default property
    if (name === "me" || name === "form" || name === "friends" || name === "screen") return `R.dflt(R.obj(${js(name)}))`
    const b = BUILTINS[name]
    if (b) {
      if (b.min > 0) err(`${e.raw} needs ${b.min === 1 ? "a value" : `${b.min} values`} in parentheses`, e.line)
      return b.async ? `(await R.async.${name}())` : `R.fn.${name}()`
    }
    if (procs.has(name)) {
      const pr = procs.get(name)
      if (pr.params.length) err(`${pr.raw} needs ${pr.params.length} value${pr.params.length > 1 ? "s" : ""}`, e.line)
      return `(await p_${name}())`
    }
    if (assigned.has(name)) {
      moduleVars.set(name, { array: false })
      return `v_${name}`
    }
    return err(`Variable not defined: "${e.raw}" (Dim it first, or check the spelling)`, e.line)
  }

  // a method's argument: a control's bare name passes the control itself
  // (Sprite1.Touching(Sprite2)); anything else is a value
  function methodArg(a, scope) {
    if (a.k === "name" && ctl.has(a.name) && !lookupVar(a.name, scope)) return `R.c(${js(a.name)})`
    return expr(a, scope)
  }

  // f(args): a built-in, a procedure, an array element, Shared("k"), or obj.method(args)
  function applyRef(e, scope, asStatement) {
    const t = e.target
    const argJs = e.args.map((a) => expr(a, scope))
    if (t.k === "member") {
      // Shared.Get("k") style isn't needed; obj.method(args) or a property with an index (List1.List(i))
      return `R.call(${objRef(t.obj, scope)}, ${js(t.name)}, [${e.args.map((a) => methodArg(a, scope)).join(", ")}])`
    }
    if (t.k === "name") {
      const name = t.name
      if (name === "shared") {
        if (argJs.length !== 1) err('Shared needs one key: Shared("score")', e.line)
        return `R.shared.get(${argJs[0]})`
      }
      const v = lookupVar(name, scope)
      if (v || assigned.has(`${name}()`)) {
        if (!v) moduleVars.set(name, { array: true })
        if (argJs.length !== 1) err(`"${t.raw}" is an array: use one index, like ${t.raw}(0)`, e.line)
        return `v_${name}[R.idx(v_${name}, ${argJs[0]})]`
      }
      if (procs.has(name)) {
        const pr = procs.get(name)
        if (argJs.length !== pr.params.length) err(`${pr.raw} needs ${pr.params.length} value${pr.params.length === 1 ? "" : "s"}, not ${argJs.length}`, e.line)
        if (!asStatement && pr.kind === "sub") err(`${pr.raw} is a Sub: it doesn't give back a value (make it a Function)`, e.line)
        return `(await p_${name}(${argJs.join(", ")}))`
      }
      const b = BUILTINS[name]
      if (b) {
        if (argJs.length < b.min || argJs.length > b.max) err(`${t.raw} needs ${b.min === b.max ? b.min : `${b.min} to ${b.max}`} value${b.max === 1 ? "" : "s"}`, e.line)
        return b.async ? `(await R.async.${name}(${argJs.join(", ")}))` : `R.fn.${name}(${argJs.join(", ")})`
      }
      if (ctl.has(name)) err(`"${t.raw}" is a control: use a property, like ${t.raw}.Caption`, e.line)
      return err(`Sub or Function not defined: "${t.raw}"`, e.line)
    }
    return err("I can't work out this call", e.line)
  }

  function assignTo(target, valueJs, scope, line) {
    if (target.k === "name") {
      const name = target.name
      if (scope?.proc?.kind === "function" && name === scope.proc.name) return `v_${name} = ${valueJs};`
      if (ctl.has(name)) return `R.set(R.c(${js(name)}), null, ${valueJs});`
      const v = lookupVar(name, scope)
      if (v?.constant) err(`"${target.raw}" is a constant: it can't be changed`, line)
      if (!v) {
        if (CONSTANTS[name] || BUILTINS[name] || SPECIAL.has(name) || procs.has(name)) err(`"${target.raw}" can't be assigned to`, line)
        moduleVars.set(name, { array: false })
      }
      return `v_${name} = ${valueJs};`
    }
    if (target.k === "member") return `R.set(${objRef(target.obj, scope)}, ${js(target.name)}, ${valueJs});`
    if (target.k === "apply") {
      const t = target.target
      if (t.k === "name" && t.name === "shared") {
        if (target.args.length !== 1) err('Shared needs one key: Shared("score") = 3', line)
        return `R.shared.set(${expr(target.args[0], scope)}, ${valueJs});`
      }
      if (t.k === "name") {
        const v = lookupVar(t.name, scope)
        if (!v && !assigned.has(`${t.name}()`)) err(`"${t.raw}" isn't an array (Dim ${t.raw}(10) first)`, line)
        if (!v) moduleVars.set(t.name, { array: true })
        return `v_${t.name}[R.idx(v_${t.name}, ${expr(target.args[0], scope)})] = ${valueJs};`
      }
      if (t.k === "member") return `R.setAt(${objRef(t.obj, scope)}, ${js(t.name)}, [${target.args.map((a) => expr(a, scope)).join(", ")}], ${valueJs});`
    }
    return err("You can't assign to this", line)
  }

  function stmts(body, scope, indent) {
    const lines = []
    for (const st of body) lines.push(...stmt(st, scope, indent))
    return lines
  }

  function stmt(st, scope, ind) {
    const pad = "  ".repeat(ind)
    const L = (s) => `${pad}${s}`
    switch (st.k) {
      case "dim":
        return st.items.map((it) => {
          if (scope.locals.has(it.name)) err(`"${it.raw}" is already declared`, it.line)
          reserved(it.name, it.line)
          scope.locals.set(it.name, { array: !!it.size, constant: !!st.constant })
          scope.hoist.push(it.name)
          return L(`v_${it.name} = ${it.size ? `R.arr(${expr(it.size, scope)})` : it.init ? expr(it.init, scope) : '""'};`)
        })
      case "redim": {
        const v = lookupVar(st.name, scope)
        if (!v) moduleVars.set(st.name, { array: true })
        return [L(`v_${st.name} = R.arr(${expr(st.size, scope)});`)]
      }
      case "assign":
        return [L(`R.line(${st.line}); ${assignTo(st.target, expr(st.e, scope), scope, st.line)}`)]
      case "call": {
        const e = st.e
        if (e.k === "apply") return [L(`R.line(${st.line}); ${callStatement(e, st.bare, scope)};`)]
        return [L(`R.line(${st.line}); ${callStatement({ k: "apply", target: e, args: [], line: st.line }, st.bare, scope)};`)]
      }
      case "if": {
        const lines = []
        st.arms.forEach((arm, i) => {
          lines.push(L(`${i ? "} else if" : "if"} (R.truthy(${expr(arm.cond, scope)})) {`))
          lines.push(...stmts(arm.body, scope, ind + 1))
        })
        if (st.other.length) {
          lines.push(L("} else {"))
          lines.push(...stmts(st.other, scope, ind + 1))
        }
        lines.push(L("}"))
        return lines
      }
      case "for": {
        const label = `L${++labelSeq}`
        const v = lookupVar(st.name, scope)
        if (!v) moduleVars.set(st.name, { array: false })
        const step = st.step ? expr(st.step, scope) : "1"
        const tmp = `t${labelSeq}`
        const lines = [
          L(`{ const ${tmp}e = R.num(${expr(st.to, scope)}), ${tmp}s = R.num(${step});`),
          L(`${label}: for (v_${st.name} = R.num(${expr(st.from, scope)}); ${tmp}s >= 0 ? v_${st.name} <= ${tmp}e : v_${st.name} >= ${tmp}e; v_${st.name} += ${tmp}s) {`),
          L("  R.tick();"),
        ]
        scope.loops.push({ kind: "for", label })
        lines.push(...stmts(st.body, scope, ind + 1))
        scope.loops.pop()
        lines.push(L("} }"))
        return lines
      }
      case "foreach": {
        const label = `L${++labelSeq}`
        if (!lookupVar(st.name, scope)) moduleVars.set(st.name, { array: false })
        const lines = [L(`${label}: for (const e${labelSeq} of R.iter(${expr(st.list, scope)})) {`), L(`  v_${st.name} = e${labelSeq}; R.tick();`)]
        scope.loops.push({ kind: "for", label })
        lines.push(...stmts(st.body, scope, ind + 1))
        scope.loops.pop()
        lines.push(L("}"))
        return lines
      }
      case "do": {
        const label = `L${++labelSeq}`
        const cond = (c) => (c.kind === "while" ? `R.truthy(${expr(c.cond, scope)})` : `!R.truthy(${expr(c.cond, scope)})`)
        const lines = [L(`${label}: while (${st.pre ? cond(st.pre) : "true"}) {`), L("  R.tick();")]
        scope.loops.push({ kind: "do", label })
        lines.push(...stmts(st.body, scope, ind + 1))
        scope.loops.pop()
        if (st.post) lines.push(L(`  if (!(${cond(st.post)})) break;`))
        lines.push(L("}"))
        return lines
      }
      case "select": {
        const tmp = `sel${++labelSeq}`
        const lines = [L(`{ const ${tmp} = ${expr(st.subject, scope)};`)]
        const test = (t) => {
          if (t.kind === "eq") return `R.eq(${tmp}, ${expr(t.e, scope)})`
          if (t.kind === "range") return `(R.cmp(${tmp}, ${expr(t.a, scope)}) >= 0 && R.cmp(${tmp}, ${expr(t.b, scope)}) <= 0)`
          return t.op === "=" ? `R.eq(${tmp}, ${expr(t.e, scope)})` : t.op === "<>" ? `!R.eq(${tmp}, ${expr(t.e, scope)})` : `(R.cmp(${tmp}, ${expr(t.e, scope)}) ${t.op} 0)`
        }
        st.cases.forEach((c, i) => {
          lines.push(L(`  ${i ? "} else if" : "if"} (${c.tests.map(test).join(" || ")}) {`))
          lines.push(...stmts(c.body, scope, ind + 2))
        })
        if (st.other) {
          lines.push(L(st.cases.length ? "  } else {" : "  {"))
          lines.push(...stmts(st.other, scope, ind + 2))
        }
        if (st.cases.length || st.other) lines.push(L("  }"))
        lines.push(L("}"))
        return lines
      }
      case "exit": {
        if (st.what === "sub" || st.what === "function") {
          if (st.what !== scope.proc.kind) err(`"Exit ${st.what === "sub" ? "Sub" : "Function"}" inside a ${scope.proc.kind === "sub" ? "Sub" : "Function"}`, st.line)
          return [L(scope.proc.kind === "function" ? `return v_${scope.proc.name};` : "return;")]
        }
        const loop = [...scope.loops].reverse().find((l) => l.kind === st.what)
        if (!loop) err(`"Exit ${st.what === "for" ? "For" : "Do"}" isn't inside a ${st.what === "for" ? "For" : "Do"} loop`, st.line)
        return [L(`break ${loop.label};`)]
      }
      case "endprog":
        return [L("R.end(); return;")]
    }
    return err("I can't work out this statement", st.line)
  }

  // a statement call: `Name a, b`, `Name(a)`, `obj.Method a`, `MsgBox "x"`
  function callStatement(e, bare, scope) {
    const t = e.target
    const allArgs = [...e.args, ...bare]
    if (t.k === "member") return `R.call(${objRef(t.obj, scope)}, ${js(t.name)}, [${allArgs.map((a) => methodArg(a, scope)).join(", ")}])`
    if (t.k === "name") {
      const name = t.name
      if (procs.has(name)) return applyRef({ ...e, args: allArgs }, scope, true)
      if (BUILTINS[name]) return applyRef({ ...e, args: allArgs }, scope, true)
      if (ctl.has(name)) err(`"${t.raw}" is a control: give it a property or method, like ${t.raw}.Caption = "Hi"`, e.line)
      return err(`Sub not defined: "${t.raw}"`, e.line)
    }
    if (t.k === "apply") return expr(t, scope)
    return err("This line doesn't do anything", e.line)
  }

  const subs = []
  for (const pr of program.procs) {
    const scope = { proc: pr, locals: new Map(pr.params.map((n) => [n, { array: false }])), loops: [], hoist: [] }
    if (pr.kind === "function") scope.locals.set(pr.name, { array: false })
    const body = stmts(pr.body, scope, 1)
    out.push(`async function p_${pr.name}(${pr.params.map((n) => `v_${n} = ""`).join(", ")}) {`)
    out.push(`  R.tick(); R.enter(${js(pr.raw)});`)
    if (pr.kind === "function") out.push(`  let v_${pr.name} = "";`)
    if (scope.hoist.length) out.push(`  let ${scope.hoist.map((n) => `v_${n} = ""`).join(", ")};`)
    out.push("  try {")
    out.push(...body.map((l) => `  ${l}`))
    if (pr.kind === "function") out.push(`    return v_${pr.name};`)
    out.push(`  } finally { R.leave(); }`)
    out.push("}")
    subs.push(pr.name)
  }
  // module variables first used inside procedures (implicit) get declared up top
  const declared = new Set(program.module.flatMap((st) => st.items.map((it) => it.name)))
  const implicit = [...moduleVars.entries()].filter(([n]) => !declared.has(n))
  out.splice(1, 0, ...implicit.map(([n, v]) => `let v_${n} = ${v.array ? "R.arr(-1)" : '""'};`))
  out.push(`return { ${subs.map((n) => `${js(n)}: p_${n}`).join(", ")} };`)
  return { js: out.join("\n"), subs }
}

// event procedures a control type can have (the Code tab's Procedure list)
export const eventName = (control, event) => `${control}_${event}`
