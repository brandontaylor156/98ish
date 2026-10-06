// Runs INSIDE a Visual Basic 98 program's sandbox (an iframe with sandbox="allow-scripts",
// no same-origin, a CSP with no network). It's included as text after vbruntime.js's text
// (srcdoc.js), so makeRuntime is in scope; it imports nothing and can't reach 98ish.
//
// parent -> sandbox: { t: "init", project, js, me, friends, shared, scale }
//                    { t: "shared", k, v }   { t: "ping", n }   { t: "stop" }
// sandbox -> parent: { t: "ready" }  { t: "set", k, v }  { t: "sound", name }
//                    { t: "error", message, line, fatal }  { t: "end" }  { t: "pong", n }
// The parent checks every message (bridge.js) and ignores anything else.

/* global makeRuntime */
;(() => {
  const post = (msg) => window.parent.postMessage(msg, "*")
  const $ = (tag, cls) => {
    const el = document.createElement(tag)
    if (cls) el.className = cls
    return el
  }
  const PROP = {
    caption: "caption",
    text: "text",
    left: "left",
    top: "top",
    x: "left",
    y: "top",
    width: "width",
    height: "height",
    visible: "visible",
    enabled: "enabled",
    backcolor: "backColor",
    forecolor: "foreColor",
    fontsize: "fontSize",
    fontbold: "fontBold",
    value: "value",
    listindex: "listIndex",
    interval: "interval",
    fillcolor: "fillColor",
    bordercolor: "borderColor",
    picture: "picture",
    costume: "costume",
    shape: "shape",
    alignment: "alignment",
    multiline: "multiLine",
    group: "group",
    sound: "sound",
    name: "name",
  }
  const DEFAULT_PROP = { Label: "caption", TextBox: "text", CommandButton: "caption", CheckBox: "value", OptionButton: "value", ListBox: "text", ComboBox: "text", PictureBox: "picture", Shape: "fillColor", Sprite: "name", Timer: "enabled", Sound: "sound" }
  const NUMERIC = new Set(["left", "top", "width", "height", "fontSize", "listIndex", "interval"])
  const BOOL = new Set(["visible", "enabled", "fontBold", "value", "multiLine"])
  const COLOR = /^(#[0-9a-f]{3,8}|transparent|[a-z]{3,20})$/i

  let R = null
  let procs = {}
  let project = null
  let me = { name: "", host: false }
  let friends = []
  const shared = new Map()
  const controls = new Map() // lowercase name -> control
  const timers = new Map()
  const busy = new Set() // timers whose handler is still running
  let formEl = null
  let modal = null
  let ended = false

  const fire = (object, event, args = []) => {
    if (ended || !R) return
    const proc = procs[`${String(object).toLowerCase()}_${event}`]
    if (proc) return R.run(proc, args)
  }

  // ---- drawing ----
  const isPicture = (v) => /^data:image\//.test(String(v || ""))
  const paint = (c) => {
    const p = c.props
    const el = c.el
    if (!el) return
    const s = el.style
    s.left = `${p.left}px`
    s.top = `${p.top}px`
    s.width = `${Math.max(1, p.width)}px`
    s.height = `${Math.max(1, p.height)}px`
    s.display = p.visible === false ? "none" : ""
    if (p.foreColor) s.color = p.foreColor
    if (p.fontSize) s.fontSize = `${Math.max(6, Math.min(96, p.fontSize))}px`
    s.fontWeight = p.fontBold ? "bold" : ""
    el.classList.toggle("off", p.enabled === false)
    switch (c.type) {
      case "Label":
        el.textContent = String(p.caption ?? "")
        s.textAlign = p.alignment || "left"
        s.background = p.backColor || "transparent"
        break
      case "CommandButton":
        el.textContent = String(p.caption ?? "")
        s.backgroundColor = p.backColor || "#c0c0c0"
        el.disabled = p.enabled === false
        break
      case "TextBox": {
        const want = p.multiLine ? "TEXTAREA" : "INPUT"
        if (c.input.tagName !== want) {
          const fresh = $(want.toLowerCase())
          c.input.replaceWith(fresh)
          c.input = fresh
          wireText(c)
        }
        if (c.input.value !== String(p.text ?? "")) c.input.value = String(p.text ?? "")
        c.input.disabled = p.enabled === false
        c.input.style.background = p.backColor || "#fff"
        c.input.style.color = p.foreColor || "#000"
        break
      }
      case "CheckBox":
      case "OptionButton":
        c.box.classList.toggle("on", !!p.value)
        c.label.textContent = String(p.caption ?? "")
        break
      case "ListBox":
      case "ComboBox": {
        const items = (p.list || []).slice(0, 2000)
        if (c.type === "ComboBox") c.label.textContent = String(p.text ?? "")
        const list = c.type === "ListBox" ? el : c.drop
        list.replaceChildren(
          ...items.map((item, i) => {
            const row = $("div", `row${i === p.listIndex ? " sel" : ""}`)
            row.textContent = String(item)
            row.addEventListener("click", (e) => {
              e.stopPropagation()
              if (p.enabled === false) return
              p.listIndex = i
              if (c.type === "ComboBox") {
                p.text = String(item)
                c.drop.hidden = true
              }
              paint(c)
              fire(c.name, "click")
            })
            return row
          })
        )
        break
      }
      case "PictureBox":
      case "Sprite": {
        const v = c.type === "Sprite" ? p.costume : p.picture
        el.replaceChildren()
        if (isPicture(v)) {
          const img = $("img")
          img.src = v
          img.alt = ""
          el.append(img)
        } else {
          const span = $("span", "emoji")
          span.textContent = String(v ?? "")
          span.style.fontSize = `${Math.max(8, Math.min(p.width, p.height) * 0.8)}px`
          el.append(span)
        }
        s.background = c.type === "PictureBox" ? p.backColor || "transparent" : "transparent"
        break
      }
      case "Shape":
        s.background = p.fillColor || "transparent"
        s.border = `1px solid ${p.borderColor || "#000"}`
        s.borderRadius = p.shape === "oval" ? "50%" : p.shape === "rounded" ? "12px" : "0"
        break
    }
  }

  const wireText = (c) => {
    c.input.addEventListener("input", () => {
      c.props.text = c.input.value
      fire(c.name, "change")
    })
    c.el.replaceChildren(c.input)
  }

  const build = (spec) => {
    const c = { __control: true, type: spec.type, name: spec.name, props: { ...spec }, el: null }
    let el = null
    switch (spec.type) {
      case "Label":
        el = $("div", "ctl label")
        break
      case "CommandButton":
        el = $("button", "ctl button")
        el.type = "button"
        break
      case "TextBox":
        el = $("div", "ctl textbox")
        c.input = $(spec.multiLine ? "textarea" : "input")
        c.el = el
        wireText(c)
        break
      case "CheckBox":
      case "OptionButton":
        el = $("div", `ctl check${spec.type === "OptionButton" ? " radio" : ""}`)
        c.box = $("span", "box")
        c.label = $("span", "cap")
        el.append(c.box, c.label)
        break
      case "ListBox":
        el = $("div", "ctl list")
        break
      case "ComboBox": {
        el = $("div", "ctl combo")
        c.label = $("span", "cap")
        const btn = $("span", "arrow")
        c.drop = $("div", "drop")
        c.drop.hidden = true
        el.append(c.label, btn, c.drop)
        break
      }
      case "PictureBox":
        el = $("div", "ctl picture")
        break
      case "Sprite":
        el = $("div", "ctl sprite")
        break
      case "Shape":
        el = $("div", "ctl shape")
        break
      default:
        el = null // Timer and Sound draw nothing
    }
    c.el = el
    if (el) {
      el.addEventListener("click", (e) => {
        if (c.props.enabled === false || modal) return
        e.stopPropagation()
        if (c.type === "CheckBox") c.props.value = !c.props.value
        if (c.type === "OptionButton") {
          for (const o of controls.values()) if (o.type === "OptionButton" && o !== c && String(o.props.group) === String(c.props.group)) (o.props.value = false), paint(o)
          c.props.value = true
        }
        if (c.type === "ComboBox") {
          c.drop.hidden = !c.drop.hidden
          return
        }
        if (c.type === "ListBox" || c.type === "TextBox") return
        paint(c)
        fire(c.name, "click")
      })
      formEl.append(el)
    }
    controls.set(spec.name.toLowerCase(), c)
    paint(c)
    if (c.type === "Timer") retime(c)
    return c
  }

  const retime = (c) => {
    clearInterval(timers.get(c))
    timers.delete(c)
    if (ended || !c.props.enabled) return
    const ms = Math.max(16, Math.min(3600000, Number(c.props.interval) || 1000))
    timers.set(
      c,
      setInterval(async () => {
        if (busy.has(c) || modal) return
        busy.add(c)
        try {
          await fire(c.name, "timer")
        } finally {
          busy.delete(c)
        }
      }, ms)
    )
  }

  // ---- what the runtime asks of the form ----
  const coerce = (prop, v) => {
    if (NUMERIC.has(prop)) return R.num(v)
    if (BOOL.has(prop)) return R.truthy(v)
    if (/color$/i.test(prop)) {
      const s = String(v)
      if (!COLOR.test(s)) throw new Error(`"${s}" isn't a color (use vbRed, RGB(255, 0, 0) or "#ff0000")`)
      return s
    }
    if (prop === "list") return Array.isArray(v) ? v.map(String) : String(v).split("\n")
    return String(v ?? "")
  }
  const rect = (c) => ({ x: c.props.left, y: c.props.top, w: c.props.width, h: c.props.height })
  const host = {
    control: (name) => controls.get(String(name).toLowerCase()) || null,
    get: (c, prop) => {
      if (prop === null) prop = DEFAULT_PROP[c.type] || "caption"
      const p = c.props
      if (prop === "listcount") return (p.list || []).length
      if (prop === "text" && c.type === "ListBox") return p.listIndex >= 0 ? String((p.list || [])[p.listIndex] ?? "") : ""
      if (prop === "name") return c.name
      const key = PROP[prop] || prop
      if (!(key in p)) throw new Error(`${c.name} (a ${c.type}) has no property "${prop}"`)
      return p[key]
    },
    set: (c, prop, v) => {
      if (prop === null) prop = DEFAULT_PROP[c.type] || "caption"
      const key = PROP[prop] || prop
      if (key === "name") throw new Error("A control's Name can't change while the program runs")
      if (!(key in c.props) && !(key === "text" && c.type === "ListBox")) throw new Error(`${c.name} (a ${c.type}) has no property "${prop}"`)
      if (key === "text" && c.type === "ListBox") {
        const i = (c.props.list || []).indexOf(String(v))
        c.props.listIndex = i
      } else c.props[key] = coerce(key, v)
      if (key === "value" && c.type === "OptionButton" && c.props.value) for (const o of controls.values()) if (o.type === "OptionButton" && o !== c && String(o.props.group) === String(c.props.group)) (o.props.value = false), paint(o)
      paint(c)
      if (c.type === "Timer" && (key === "enabled" || key === "interval")) retime(c)
    },
    setAt: (c, prop, args, v) => {
      if (prop !== "list") throw new Error(`${c.name}.${prop}(...) can't be changed`)
      const i = Math.round(R.num(args[0]))
      const list = c.props.list || []
      if (i < 0 || i >= list.length) throw new Error(`${c.name} has no item ${i}`)
      list[i] = String(v)
      paint(c)
    },
    call: (c, method, args) => {
      const p = c.props
      switch (method) {
        case "additem":
          if ((p.list || []).length >= 2000) throw new Error(`${c.name} is full (2000 items)`)
          p.list = [...(p.list || []), R.str(args[0])]
          paint(c)
          return ""
        case "removeitem": {
          const i = Math.round(R.num(args[0]))
          p.list = (p.list || []).filter((_, k) => k !== i)
          if (p.listIndex >= p.list.length) p.listIndex = p.list.length - 1
          paint(c)
          return ""
        }
        case "clear":
          if ("list" in p) {
            p.list = []
            p.listIndex = -1
          }
          if (c.type === "TextBox") p.text = ""
          paint(c)
          return ""
        case "list":
          return String((p.list || [])[Math.round(R.num(args[0]))] ?? "")
        case "move":
          p.left += R.num(args[0] ?? 0)
          p.top += R.num(args[1] ?? 0)
          paint(c)
          return ""
        case "moveto":
          p.left = R.num(args[0] ?? p.left)
          p.top = R.num(args[1] ?? p.top)
          paint(c)
          return ""
        case "touching": {
          const o = args[0] && args[0].__control ? args[0] : host.control(args[0])
          if (!o) throw new Error("Touching needs another control, like Sprite1.Touching(Sprite2)")
          if (p.visible === false || o.props.visible === false) return false
          const a = rect(c)
          const b = rect(o)
          return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
        }
        case "play":
          post({ t: "sound", name: String(args[0] ?? p.sound ?? "ding") })
          return ""
        case "setfocus":
          c.input?.focus()
          return ""
        case "refresh":
          return ""
      }
      throw new Error(`${c.name} (a ${c.type}) can't "${method}"`)
    },
    msgbox: (text, buttons, title) => dialog({ text, buttons, title }),
    inputbox: (prompt, title, def) => dialog({ text: prompt, title, input: def }),
    sound: (name) => post({ t: "sound", name: String(name) }),
    shared: {
      get: (k) => (shared.has(k) ? shared.get(k) : ""),
      set: (k, v) => {
        const key = String(k).slice(0, 64)
        const value = typeof v === "number" || typeof v === "boolean" ? v : Array.isArray(v) ? v.map(String).join(",") : String(v ?? "")
        if (typeof value === "string" && value.length > 8000) throw new Error("A Shared value can hold up to 8,000 letters")
        shared.set(key, value)
        post({ t: "set", k: key, v: value })
        queueMicrotask(() => fire("shared", "changed", [key]))
      },
      keys: () => [...shared.keys()].filter((k) => shared.get(k) !== ""),
    },
    get me() {
      return me
    },
    get friends() {
      return friends
    },
    form: {
      get: (prop) => {
        if (prop === "caption") return project.form.caption
        if (prop === "width") return project.form.width
        if (prop === "height") return project.form.height
        if (prop === "backcolor") return project.form.backColor
        throw new Error(`Form has no property "${prop}"`)
      },
      set: (prop, v) => {
        if (prop === "caption") project.form.caption = String(v)
        else if (prop === "backcolor") {
          project.form.backColor = coerce("backColor", v)
          formEl.style.background = project.form.backColor
        } else throw new Error(`Form.${prop} can't be changed while the program runs`)
      },
    },
    end: () => stop(true),
    error: (message, line, fatal) => {
      post({ t: "error", message: String(message).slice(0, 300), line, fatal: !!fatal })
      dialog({ text: `Run-time error${line ? ` (line ${line})` : ""}:\n\n${message}`, title: "Visual Basic 98", icon: "x" })
      if (fatal) stop(false)
    },
  }

  // a 98-style message box (or input box) over the form
  const dialog = ({ text, buttons = 0, title = "", input, icon }) =>
    new Promise((resolve) => {
      const veil = $("div", "veil")
      const box = $("div", "dlg")
      const bar = $("div", "dlgbar")
      bar.textContent = title || project?.form?.caption || "Visual Basic 98"
      const body = $("div", "dlgbody")
      const msg = $("div", "dlgtext")
      msg.textContent = text
      body.append(msg)
      let field = null
      if (input !== undefined) {
        field = $("input")
        field.value = input
        body.append(field)
      }
      const row = $("div", "dlgbtns")
      const add = (label, value) => {
        const b = $("button", "button")
        b.type = "button"
        b.textContent = label
        b.addEventListener("click", () => {
          veil.remove()
          modal = document.querySelector(".veil")
          resolve(field ? (value === 1 ? field.value : "") : value)
        })
        row.append(b)
        return b
      }
      const kind = Math.round(Number(buttons) || 0) % 16
      let first
      if (field) {
        first = add("OK", 1)
        add("Cancel", 2)
      } else if (kind === 4) {
        first = add("Yes", 6)
        add("No", 7)
      } else if (kind === 1) {
        first = add("OK", 1)
        add("Cancel", 2)
      } else first = add("OK", 1)
      if (icon === "x") msg.classList.add("err")
      box.append(bar, body, row)
      veil.append(box)
      document.body.append(veil)
      modal = veil
      ;(field || first).focus()
    })

  const stop = (byProgram) => {
    if (ended) return
    ended = true
    R?.stop()
    for (const id of timers.values()) clearInterval(id)
    timers.clear()
    if (byProgram) post({ t: "end" })
  }

  const start = async (msg) => {
    project = msg.project
    me = msg.me || me
    friends = msg.friends || []
    for (const [k, v] of Object.entries(msg.shared || {})) shared.set(k, v)
    formEl = document.getElementById("form")
    formEl.style.width = `${project.form.width}px`
    formEl.style.height = `${project.form.height}px`
    formEl.style.background = project.form.backColor
    document.documentElement.style.setProperty("--scale", String(msg.scale || 1))
    formEl.addEventListener("click", () => {
      for (const c of controls.values()) if (c.drop) c.drop.hidden = true
      if (!modal) fire("form", "click")
    })
    R = makeRuntime(host)
    try {
      procs = new Function("R", msg.js)(R)
    } catch (error) {
      post({ t: "error", message: `The program couldn't start: ${error.message}`, line: 0, fatal: true })
      return
    }
    for (const spec of project.controls) build(spec)
    post({ t: "ready" })
    await fire("form", "load")
  }

  document.addEventListener("keydown", (e) => {
    if (modal || ended) return
    const t = e.target
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return
    if (procs.form_keydown) {
      if (e.key.startsWith("Arrow") || e.key === " ") e.preventDefault()
      fire("form", "keydown", [e.key])
    }
  })

  window.addEventListener("message", (e) => {
    if (e.source !== window.parent) return
    const msg = e.data
    if (!msg || typeof msg !== "object") return
    if (msg.t === "init" && !R) start(msg)
    else if (msg.t === "shared" && typeof msg.k === "string") {
      const v = msg.v
      if (v === "" || v === null || v === undefined) shared.delete(msg.k)
      else shared.set(msg.k, v)
      fire("shared", "changed", [msg.k])
    } else if (msg.t === "scale" && Number.isFinite(msg.s)) document.documentElement.style.setProperty("--scale", String(Math.max(0.2, Math.min(4, msg.s))))
    else if (msg.t === "ping") post({ t: "pong", n: msg.n })
    else if (msg.t === "stop") stop(false)
    else if (msg.t === "people" && Array.isArray(msg.friends)) friends = msg.friends.map(String).slice(0, 50)
  })
  post({ t: "boot" })
})()
