// Visual Basic 98's runtime: what compiled programs (vblang.js) call as `R`. It has no
// imports and touches no DOM itself, so the sandbox (sandbox.js) can include this file's
// text as-is, and the unit tests can run programs in Node with a pretend form.
//
//   const R = makeRuntime(host)
//   const procs = new Function("R", compiled.js)(R)      // { command1_click: async fn, ... }
//   await R.run(procs.command1_click, [])                // runs one event with the watchdog
//
// host: {
//   control(name) -> a control object or null, get(ctl, prop), set(ctl, prop, value),
//   call(ctl, method, args), setAt(ctl, prop, args, value),
//   msgbox(text, buttons, title) -> Promise<number>, inputbox(prompt, title, def) -> Promise<string>,
//   sound(name), shared: { get(k), set(k, v), keys() }, me: { name, host }, friends: [names],
//   form: { get(prop), set(prop, v) }, end(), error(message, line), now() -> ms (optional)
// }

export class RunawayError extends Error {}
export class EndProgram extends Error {}
export class VbRuntimeError extends Error {}

export const SLICE_MS = 2000 // one event may run this long without waiting before it's stopped
export const MAX_DEPTH = 200 // procedure calls inside each other
export const MAX_ARRAY = 100000

export const makeRuntime = (host) => {
  const clock = host.now || (() => Date.now())
  let sliceStart = clock()
  let ticks = 0
  let depth = 0
  let line = 0
  let stopped = false
  const stack = []

  const fail = (message) => {
    throw new VbRuntimeError(message)
  }
  const isNumLike = (v) => typeof v === "number" || typeof v === "boolean" || (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v)))
  const num = (v) => {
    if (typeof v === "number") return v
    if (typeof v === "boolean") return v ? -1 : 0 // VB's True is -1
    if (v === "" || v == null) return 0
    const n = Number(String(v).trim())
    if (isNaN(n)) fail(`Type mismatch: "${String(v).slice(0, 30)}" isn't a number`)
    return n
  }
  const str = (v) => {
    if (v === true) return "True"
    if (v === false) return "False"
    if (v == null) return ""
    if (Array.isArray(v)) return v.join(", ")
    if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e10) / 1e10)
    return String(v)
  }
  const truthy = (v) => {
    if (typeof v === "boolean") return v
    if (typeof v === "number") return v !== 0
    if (typeof v === "string") {
      const t = v.trim().toLowerCase()
      if (t === "true") return true
      if (t === "false" || t === "") return false
      if (!isNaN(Number(t))) return Number(t) !== 0
      fail(`Type mismatch: "${v.slice(0, 30)}" isn't True or False`)
    }
    return !!v
  }
  const pad2 = (n) => String(n).padStart(2, "0")

  const builtins = {
    len: (s) => str(s).length,
    left: (s, n) => str(s).slice(0, Math.max(0, num(n))),
    right: (s, n) => {
      const t = str(s)
      const k = Math.max(0, num(n))
      return k ? t.slice(-k) : ""
    },
    mid: (s, start, n) => {
      const t = str(s)
      const a = Math.max(1, num(start)) - 1
      return n === undefined ? t.slice(a) : t.slice(a, a + Math.max(0, num(n)))
    },
    ucase: (s) => str(s).toUpperCase(),
    lcase: (s) => str(s).toLowerCase(),
    trim: (s) => str(s).trim(),
    ltrim: (s) => str(s).replace(/^\s+/, ""),
    rtrim: (s) => str(s).replace(/\s+$/, ""),
    instr: (a, b, c) => {
      // InStr(haystack, needle) or InStr(start, haystack, needle)
      if (c === undefined) return str(a).indexOf(str(b)) + 1
      return str(b).indexOf(str(c), Math.max(0, num(a) - 1)) + 1
    },
    replace: (s, a, b) => (str(a) === "" ? str(s) : str(s).split(str(a)).join(str(b))),
    str: (v) => (typeof v === "number" && v >= 0 ? " " : "") + str(v),
    cstr: (v) => str(v),
    val: (v) => {
      const m = /^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(str(v))
      return m ? Number(m[0]) : 0
    },
    cint: (v) => Math.round(num(v)),
    clng: (v) => Math.round(num(v)),
    cdbl: (v) => num(v),
    cbool: (v) => truthy(v),
    int: (v) => Math.floor(num(v)),
    fix: (v) => Math.trunc(num(v)),
    abs: (v) => Math.abs(num(v)),
    sqr: (v) => Math.sqrt(num(v)),
    sin: (v) => Math.sin(num(v)),
    cos: (v) => Math.cos(num(v)),
    round: (v, d) => {
      const f = Math.pow(10, d === undefined ? 0 : num(d))
      return Math.round(num(v) * f) / f
    },
    rnd: () => Math.random(),
    random: (a, b) => {
      const lo = Math.ceil(Math.min(num(a), num(b)))
      const hi = Math.floor(Math.max(num(a), num(b)))
      return lo + Math.floor(Math.random() * (hi - lo + 1))
    },
    now: () => {
      const d = new Date(clock())
      return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()} ${builtins.time()}`
    },
    time: () => {
      const d = new Date(clock())
      const h = d.getHours()
      return `${h % 12 || 12}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())} ${h < 12 ? "AM" : "PM"}`
    },
    date: () => {
      const d = new Date(clock())
      return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`
    },
    timer: () => {
      const d = new Date(clock())
      return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + d.getMilliseconds() / 1000
    },
    hour: () => new Date(clock()).getHours(),
    chr: (n) => String.fromCharCode(num(n)),
    asc: (s) => (str(s).length ? str(s).charCodeAt(0) : fail("Asc needs some text")),
    split: (s, sep) => str(s).split(sep === undefined ? " " : str(sep)),
    join: (a, sep) => (Array.isArray(a) ? a.map(str).join(sep === undefined ? " " : str(sep)) : fail("Join needs an array")),
    ubound: (a) => (Array.isArray(a) ? a.length - 1 : fail("UBound needs an array")),
    lbound: (a) => (Array.isArray(a) ? 0 : fail("LBound needs an array")),
    isnumeric: (v) => isNumLike(v),
    isempty: (v) => v === "" || v == null,
    rgb: (r, g, b) => `#${[r, g, b].map((x) => Math.max(0, Math.min(255, Math.round(num(x)))).toString(16).padStart(2, "0")).join("")}`,
    format: (v, f) => {
      if (f === undefined) return str(v)
      const fmt = str(f).toLowerCase()
      const n = num(v)
      if (fmt === "currency") return `$${n.toFixed(2)}`
      if (fmt === "percent") return `${(n * 100).toFixed(0)}%`
      const m = /^0*(?:\.(0+))?$/.exec(fmt)
      if (m) return n.toFixed(m[1] ? m[1].length : 0).padStart(fmt.split(".")[0].length, "0")
      return str(v)
    },
    string: (n, ch) => str(ch).charAt(0).repeat(Math.max(0, Math.min(10000, num(n)))),
    space: (n) => " ".repeat(Math.max(0, Math.min(10000, num(n)))),
    // days from today until a date like "12/25/2026" (negative once it's past)
    daysuntil: (d) => {
      const t = new Date(str(d))
      if (isNaN(t)) fail(`"${str(d)}" isn't a date`)
      const today = new Date(clock())
      today.setHours(0, 0, 0, 0)
      t.setHours(0, 0, 0, 0)
      return Math.round((t - today) / 86400000)
    },
    beep: () => host.sound?.("ding"),
  }

  // the async ones: they wait, so the watchdog's clock starts again afterwards
  const resumeAfter = async (promise) => {
    try {
      return await promise
    } finally {
      sliceStart = clock()
      if (stopped) throw new EndProgram()
    }
  }
  const asyncs = {
    msgbox: (text, buttons, title) => resumeAfter(host.msgbox(str(text), buttons === undefined ? 0 : num(buttons), title === undefined ? "" : str(title))),
    inputbox: (prompt, title, def) => resumeAfter(host.inputbox(str(prompt), title === undefined ? "" : str(title), def === undefined ? "" : str(def))),
    wait: (ms) => resumeAfter(new Promise((r) => setTimeout(r, Math.max(0, Math.min(60000, num(ms)))))),
  }

  const special = {
    shared: { kind: "shared" },
    me: { kind: "me" },
    friends: { kind: "friends" },
    form: { kind: "form" },
    sound: { kind: "sound" },
    app: { kind: "app" },
    screen: { kind: "screen" },
  }
  const isSpecial = (o) => o && typeof o === "object" && Object.values(special).includes(o)

  const R = {
    num,
    str,
    truthy,
    fn: builtins,
    async: asyncs,
    get currentLine() {
      return line
    },
    line: (n) => {
      line = n
    },
    // the watchdog: every loop turn and procedure call
    tick: () => {
      if (stopped) throw new EndProgram()
      if (++ticks % 256 === 0 && clock() - sliceStart > SLICE_MS) throw new RunawayError("This program stopped responding (an endless loop?), so it was ended.")
    },
    enter: (name) => {
      if (++depth > MAX_DEPTH) {
        depth = 0
        throw new RunawayError(`Out of stack space: ${name} kept calling itself.`)
      }
      stack.push(name)
    },
    leave: () => {
      depth = Math.max(0, depth - 1)
      stack.pop()
    },
    end: () => {
      stopped = true
      host.end?.()
    },
    get stopped() {
      return stopped
    },
    stop: () => {
      stopped = true
    },
    add: (a, b) => {
      if (typeof a === "string" && typeof b === "string") return a + b
      if (isNumLike(a) && isNumLike(b)) return num(a) + num(b)
      return str(a) + str(b)
    },
    cat: (a, b) => str(a) + str(b),
    div: (a, b) => {
      const d = num(b)
      if (d === 0) fail("Division by zero")
      return num(a) / d
    },
    idiv: (a, b) => {
      const d = Math.round(num(b))
      if (d === 0) fail("Division by zero")
      return Math.trunc(Math.round(num(a)) / d)
    },
    mod: (a, b) => {
      const d = Math.round(num(b))
      if (d === 0) fail("Division by zero")
      return Math.round(num(a)) % d
    },
    pow: (a, b) => Math.pow(num(a), num(b)),
    not: (v) => !truthy(v),
    eq: (a, b) => {
      if (typeof a === "boolean" || typeof b === "boolean") return truthy(a) === truthy(b)
      if (typeof a === "number" || typeof b === "number") return isNumLike(a) && isNumLike(b) ? num(a) === num(b) : str(a) === str(b)
      return str(a) === str(b)
    },
    cmp: (a, b) => {
      if ((typeof a === "number" || typeof b === "number") && isNumLike(a) && isNumLike(b)) return num(a) - num(b)
      const x = str(a)
      const y = str(b)
      return x < y ? -1 : x > y ? 1 : 0
    },
    arr: (n) => {
      const size = Math.round(num(n)) + 1
      if (size < 0 || size > MAX_ARRAY) fail(`An array can hold up to ${MAX_ARRAY} items`)
      return Array.from({ length: Math.max(0, size) }, () => "")
    },
    idx: (a, i) => {
      if (!Array.isArray(a)) fail("This isn't an array")
      const k = Math.round(num(i))
      if (k < 0 || k >= a.length) fail(`Subscript out of range: ${k} (the array goes from 0 to ${a.length - 1})`)
      return k
    },
    iter: (v) => {
      if (Array.isArray(v)) return [...v]
      if (typeof v === "string") return [...v]
      if (v && v.kind === "friends") return [...(host.friends || [])]
      fail("For Each needs an array or text")
    },
    // controls and objects
    c: (name) => host.control(name) || fail(`Object not found: ${name}`),
    obj: (name) => special[name] || fail(`Object not found: ${name}`),
    dflt: (o) => {
      if (isSpecial(o)) {
        if (o.kind === "me") return host.me?.name || ""
        if (o.kind === "friends") return [...(host.friends || [])]
        return ""
      }
      return host.get(o, null)
    },
    get: (o, prop) => {
      if (isSpecial(o)) {
        switch (o.kind) {
          case "me":
            if (prop === "name") return host.me?.name || ""
            if (prop === "ishost") return !!host.me?.host
            break
          case "friends":
            if (prop === "count") return (host.friends || []).length
            break
          case "shared":
            if (prop === "keys") return host.shared.keys()
            break
          case "form":
            return host.form.get(prop)
          case "app":
            if (prop === "title") return host.form.get("caption")
            break
          case "screen":
            if (prop === "width") return host.form.get("width")
            if (prop === "height") return host.form.get("height")
            break
        }
        return fail(`${o.kind[0].toUpperCase()}${o.kind.slice(1)} has no property "${prop}"`)
      }
      if (o && typeof o === "object" && o.__control) return host.get(o, prop)
      if (typeof o === "string" && prop === "length") return o.length
      return fail(`"${prop}" needs a control or object before the dot`)
    },
    set: (o, prop, v) => {
      if (isSpecial(o)) {
        if (o.kind === "form") return host.form.set(prop, v)
        return fail(`You can't change ${o.kind}.${prop}`)
      }
      if (o && typeof o === "object" && o.__control) return host.set(o, prop, v)
      return fail(`"${prop}" needs a control before the dot`)
    },
    setAt: (o, prop, args, v) => {
      if (o && o.__control) return host.setAt(o, prop, args, v)
      return fail(`You can't change ${prop}(...) here`)
    },
    call: (o, method, args) => {
      if (isSpecial(o)) {
        if (o.kind === "sound" && method === "play") return host.sound?.(str(args[0] ?? "ding")), ""
        if (o.kind === "shared" && method === "get") return host.shared.get(str(args[0]))
        if (o.kind === "shared" && (method === "set" || method === "let")) return host.shared.set(str(args[0]), args[1]), ""
        if (o.kind === "shared" && method === "clear") {
          for (const k of host.shared.keys()) host.shared.set(k, "")
          return ""
        }
        if (o.kind === "friends" && method === "item") return (host.friends || [])[Math.round(num(args[0]))] ?? ""
        if (o.kind === "form" && method === "cls") return host.form.call?.("cls", args), ""
        return fail(`${o.kind}.${method} isn't something it can do`)
      }
      if (o && typeof o === "object" && o.__control) return host.call(o, method, args)
      if (Array.isArray(o) && method === "count") return o.length
      return fail(`"${method}" needs a control before the dot`)
    },
    shared: {
      get: (k) => host.shared.get(str(k)),
      set: (k, v) => {
        host.shared.set(str(k), v)
      },
    },
    // run one event procedure with the watchdog; errors are reported, not thrown
    run: async (proc, args = []) => {
      if (!proc || stopped) return
      sliceStart = clock()
      ticks = 0
      try {
        await proc(...args)
      } catch (error) {
        if (error instanceof EndProgram) return
        if (error instanceof RunawayError) {
          stopped = true
          host.error?.(error.message, line, true)
          return
        }
        const message = error instanceof VbRuntimeError ? error.message : error?.message || String(error)
        host.error?.(message, line, false)
      } finally {
        depth = 0
        stack.length = 0
      }
    },
  }
  return R
}

// the sounds Sound.Play knows (played by 98ish itself, on its volume)
export const SOUNDS = ["ding", "chord", "tada", "click", "pop", "boing", "win", "lose", "chimes", "notify"]
