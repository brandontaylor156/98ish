import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useMediaQuery } from "../../../hooks/useMediaQuery"
import { useSettings } from "../../../utils/settings"
import { allowsShortcuts, capsMode, enterLabel, isCredential, isMultiline, isPassword, layoutFor, readField, textFieldFor } from "./fields"
import { alternatesFor, rowUnits, rowsFor } from "./layouts"
import { wantsCapital, wantsPeriod } from "./editing"
import { focusNext, moveBy, pressKey, textBefore } from "./typing"
import { noteGesture, suppress, switchToPhoneKeyboard, wantsKeyboard } from "./native"
import { haptic, keyClick } from "./feedback"
import { BackIcon, EnterIcon, KeyboardIcon, PhoneIcon, ShiftIcon } from "./icons"
import "./Keyboard.css"

// The 98ish keyboard: a Windows 98 tool window docked above the taskbar that types into
// whichever text field has focus (see docs/keyboard.md). KeyboardHost mounts it on touch
// screens. It never takes focus: every key cancels its pointerdown, so the field keeps the
// caret and selection.

const LONG_PRESS = 420 // ms: accents, the space bar's caret mode
const DOUBLE_TAP = 350 // ms: Shift twice = Caps Lock
const STEP_X = 9 // px of space-bar drag per character
const STEP_Y = 22 // px per line
const WORD_AFTER = 12 // Backspace repeats before it starts deleting words

// windows and layers that fill the screen: never lifted over the keyboard
const NO_LIFT = ".mobileWindow, .mobileDesktop, .windowLayer, .os-root"

// a form field that isn't one the keyboard types into (a checkbox, a read-only or opted-out
// box, a list): moving there puts the keyboard away
const FORM_FIELD = "input, select, textarea, [contenteditable=true], [contenteditable='']"

// still in the page and drawn (not in a closed or minimized window)
const onScreen = (el) => el.isConnected && el.getClientRects().length > 0

// a key for the field: if a tap elsewhere took focus away (the keyboard stays up), focus
// goes back to the field first, so the key lands where the keyboard says it will
const press = (el, ...args) => {
  if (document.activeElement !== el && !el.contains(document.activeElement) && onScreen(el)) {
    suppress(el) // (still no phone keyboard when it takes focus back)
    el.focus({ preventScroll: true })
  }
  return pressKey(el, ...args)
}

const keyLabel = (key) => {
  if (key.kind === "page") return key.label
  if (key.kind === "key") return { ArrowLeft: "Left", ArrowRight: "Right", ArrowUp: "Up", ArrowDown: "Down" }[key.value] || key.label
  return key.label || key.value
}

const ARROW_GLYPH = { ArrowLeft: "◄︎", ArrowRight: "►︎", ArrowUp: "▲︎", ArrowDown: "▼︎" }

// where the taskbar starts (the keyboard sits on it); 0 without one (MS-DOS mode)
const taskbarOffset = () => {
  const bar = document.querySelector(".taskbar")
  if (!bar) return 0
  const r = bar.getBoundingClientRect()
  if (!r.height) return 0
  return Math.max(0, Math.round(window.innerHeight - r.top))
}

// the closest positioned box (a dialog, a floating window, the Start menu) that can move up
// to clear the keyboard
const liftTargetFor = (el) => {
  for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
    if (node.matches(NO_LIFT)) return null
    const pos = getComputedStyle(node).position
    if (pos !== "fixed" && pos !== "absolute") continue
    if (node.getBoundingClientRect().height >= window.innerHeight * 0.9) continue
    return node
  }
  return null
}

const Keyboard = () => {
  const settings = useSettings()
  const wide = useMediaQuery("(min-width: 600px) and (orientation: landscape), (min-width: 700px)")
  const short = useMediaQuery("(max-height: 500px)")

  const [field, setField] = useState(null)
  const [physical, setPhysical] = useState(false)
  const [dormant, setDormant] = useState(false) // focused by code, not by a touch: wait for a tap
  const [page, setPage] = useState("letters")
  const [shift, setShift] = useState("off") // off | once | lock
  const [autoUpper, setAutoUpper] = useState(false)
  const [ctrl, setCtrl] = useState(false)
  const [down, setDown] = useState({}) // key id -> true, while pressed
  const [preview, setPreview] = useState(null) // { id, text, x, y, w, h }
  const [alts, setAlts] = useState(null) // { id, items, index, x, y, cell }
  const [track, setTrack] = useState(false) // space bar caret mode
  const [bottom, setBottom] = useState(0)

  const rootRef = useRef(null)
  const pointers = useRef(new Map())
  const lastShiftTap = useRef(0)
  const lastSpace = useRef(0)
  const lifted = useRef(new Map())
  const liftFor = useRef({ field: null, box: null })

  const info = useMemo(() => (field ? readField(field) : null), [field])
  const home = info ? layoutFor(info) : { page: "letters", variant: "text" }
  const visible = !!field && !physical && !dormant
  const upper = shift !== "off" || autoUpper

  // what timers and listeners read (they outlive a render)
  const live = useRef({})
  live.current = { field, info, shift, autoUpper, ctrl, settings, page, home }
  // the last tap outside the keyboard: focus leaving the field right after one (onto the
  // desktop, the taskbar, a button) was a stray tap, and the keyboard stays up; focus leaving
  // any other way (Go, the app blurring it, another form field) puts it away as before
  const lastOutsideTap = useRef(null)
  const strayTap = () => {
    const tap = lastOutsideTap.current
    if (!tap || performance.now() - tap.t > 700) return false
    const now = document.activeElement
    return !(now && now !== document.body && now.matches?.(FORM_FIELD))
  }

  // ---- which field ----

  useEffect(() => {
    let outTimer
    const sync = () => {
      const el = textFieldFor(document.activeElement)
      // a tap on the taskbar, a toolbar or a plain spot doesn't put the keyboard away: it stays
      // on its field (still on screen) until its X is pressed or the field's window goes
      const cur = live.current.field
      if (!el && cur && onScreen(cur) && strayTap()) return
      if (el && el !== cur) setDormant(!wantsKeyboard(el))
      setField(el && !el.dataset.kbNative ? el : null)
    }
    const onIn = (e) => {
      const el = textFieldFor(e.target)
      if (!el || el.dataset.kbNative) return
      clearTimeout(outTimer)
      if (el !== live.current.field) setDormant(!wantsKeyboard(el))
      setField(el)
    }
    // after the focus settles (moving between fields keeps the keyboard up)
    const onOut = () => {
      clearTimeout(outTimer)
      outTimer = setTimeout(sync, 60)
    }
    // a tap on a field that already has focus but wasn't typable when it got it (read-only
    // until a race starts): no focusin comes, so the tap brings the keyboard
    const onTap = (e) => {
      // (a tap on the keyboard or on a form field isn't a stray tap)
      if (!rootRef.current?.contains(e.target) && !e.target.closest?.(FORM_FIELD)) lastOutsideTap.current = { t: performance.now(), target: e.target }
      else lastOutsideTap.current = null
      const el = textFieldFor(e.target)
      if (!el || el !== document.activeElement || el.dataset.kbNative || el === live.current.field) return
      clearTimeout(outTimer)
      setDormant(false)
      setField(el)
    }
    // a real key from an iPad or Bluetooth keyboard: get out of the way
    const onKey = (e) => {
      if (!e.isTrusted || e.isComposing || ["Unidentified", "Process", "Dead"].includes(e.key)) return
      if (live.current.field) setPhysical(true)
    }
    sync()
    document.addEventListener("pointerdown", onTap, true)
    document.addEventListener("focusin", onIn, true)
    document.addEventListener("focusout", onOut, true)
    document.addEventListener("keydown", onKey, true)
    return () => {
      clearTimeout(outTimer)
      document.removeEventListener("pointerdown", onTap, true)
      document.removeEventListener("focusin", onIn, true)
      document.removeEventListener("focusout", onOut, true)
      document.removeEventListener("keydown", onKey, true)
    }
  }, [])

  // a new field: its own layout, Shift off
  useEffect(() => {
    if (!info) return
    setPage(home.page)
    setShift("off")
    setCtrl(false)
    lastSpace.current = 0
    recomputeCaps()
  }, [field])

  // the field went away (window closed, minimized, switched) or lost focus without telling
  useEffect(() => {
    if (!field) return
    let frame = 0
    const check = () => {
      frame = 0
      const gone = !field.isConnected || !field.getClientRects().length
      if (gone && document.activeElement === field) field.blur()
      // (or stopped taking typing: read-only again when a race ends)
      const now = textFieldFor(document.activeElement)
      if (gone || field.readOnly || field.disabled) setField(now && !now.dataset.kbNative ? now : null)
      else if (now && now !== field && !now.dataset.kbNative) setField(now)
    }
    const observer = new MutationObserver(() => {
      if (!frame) frame = requestAnimationFrame(check)
    })
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden", "readonly", "disabled"] })
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [field])

  // capitals at the start of sentences, again when the caret moves
  const recomputeCaps = () => {
    const { field: el, info: f, settings: s, page: p } = live.current
    if (!el || !f || !s.autoCaps || p === "numpad") return setAutoUpper(false)
    setAutoUpper(wantsCapital(textBefore(el), capsMode(f)))
  }
  useEffect(() => {
    if (!field) return
    let frame = 0
    const onSel = () => {
      if (!frame) frame = requestAnimationFrame(() => ((frame = 0), recomputeCaps()))
    }
    document.addEventListener("selectionchange", onSel)
    return () => {
      document.removeEventListener("selectionchange", onSel)
      cancelAnimationFrame(frame)
    }
  }, [field])

  // a tap on the field itself brings the keyboard back up (after focus from code)
  useEffect(() => {
    if (!field) return
    const onDown = (e) => {
      if (textFieldFor(e.target) === live.current.field) setDormant(false)
    }
    document.addEventListener("pointerdown", onDown, true)
    return () => document.removeEventListener("pointerdown", onDown, true)
  }, [field])

  // (once a hardware keyboard has typed, it stays the way to type, field after field, until
  // the Keyboard button brings ours back)

  // ---- making room ----

  const unlift = () => {
    lifted.current.forEach((was, node) => (node.style.translate = was))
    lifted.current.clear()
  }

  const reveal = () => {
    const el = live.current.field
    const kb = rootRef.current
    if (!el || !kb || !el.isConnected) return
    const top = kb.getBoundingClientRect().top - 6
    const rectOf = () => {
      const r = el.getBoundingClientRect()
      // a big text box only needs its first lines in view
      return { top: r.top, bottom: isMultiline(readField(el)) ? Math.min(r.bottom, r.top + 64) : r.bottom }
    }
    let r = rectOf()
    if (r.bottom > top || r.top < 0) {
      el.scrollIntoView({ block: "nearest", inline: "nearest" })
      if (window.scrollX || window.scrollY) window.scrollTo(0, 0)
      r = rectOf()
    }
    // the dialog or floating box the field is in (looked up once per field)
    if (liftFor.current.field !== el) liftFor.current = { field: el, box: liftTargetFor(el) }
    const box = liftFor.current.box
    const over = r.bottom - top
    const b = box?.isConnected ? box.getBoundingClientRect() : null
    if (!b || (over <= 0 && b.bottom <= top)) return
    // the whole box (a dialog's OK and Cancel too) if it fits, else just the field; never
    // past the top of the screen
    const by = Math.min(Math.max(over, b.bottom - top), Math.max(0, b.top))
    if (by <= 0) return
    if (!lifted.current.has(box)) lifted.current.set(box, box.style.translate)
    const already = parseFloat((box.style.translate || "").split(" ")[1]) || 0
    box.style.translate = `0 ${already - by}px`
  }

  // tell the page how tall the keyboard is (phone windows end above it) while it shows
  useLayoutEffect(() => {
    const html = document.documentElement
    if (!visible) {
      html.classList.remove("kb-open")
      html.style.removeProperty("--kb-h")
      unlift()
      return
    }
    setBottom(taskbarOffset())
    const kb = rootRef.current
    const apply = () => {
      html.style.setProperty("--kb-h", `${kb.offsetHeight}px`)
      html.classList.add("kb-open")
      requestAnimationFrame(reveal)
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(kb)
    const onResize = () => {
      setBottom(taskbarOffset())
      requestAnimationFrame(reveal)
    }
    window.addEventListener("resize", onResize)
    return () => {
      ro.disconnect()
      window.removeEventListener("resize", onResize)
    }
  }, [visible, field])

  // field changed: drop the old lift before measuring for the new one
  useEffect(() => unlift, [field])
  useEffect(
    () => () => {
      document.documentElement.classList.remove("kb-open")
      document.documentElement.style.removeProperty("--kb-h")
      unlift()
    },
    []
  )

  // ---- typing ----

  const targetPage = (p) => {
    const h = live.current.home.page
    if (p === "letters" && h === "dos") return "dos"
    if (p === "numbers" && h === "numpad") return "numpad"
    return p
  }

  // after a key: Shift lets go, capitals and the view catch up
  const settle = () => {
    requestAnimationFrame(() => {
      recomputeCaps()
      reveal()
    })
  }

  const typeChar = (value) => {
    const { field: el, shift: sh, autoUpper: au, ctrl: c } = live.current
    if (!el) return
    const isLetter = value.length === 1 && value.toLowerCase() !== value.toUpperCase()
    const up = sh !== "off" || au
    if (c) {
      press(el, value.toLowerCase(), { ctrl: true })
      setCtrl(false)
    } else {
      press(el, isLetter && up && value === value.toLowerCase() ? value.toUpperCase() : value, { shift: isLetter && up })
    }
    lastSpace.current = 0
    if (sh === "once") setShift("off")
    settle()
  }

  const typeSpace = () => {
    const { field: el, info: f, settings: s } = live.current
    if (!el) return
    const now = performance.now()
    if (s.periodShortcut && allowsShortcuts(f) && now - lastSpace.current < 1500 && wantsPeriod(textBefore(el))) {
      press(el, "Backspace")
      press(el, ".")
      press(el, " ")
      lastSpace.current = 0
    } else {
      press(el, " ")
      lastSpace.current = now
    }
    if (live.current.shift === "once") setShift("off")
    settle()
  }

  const typeEnter = () => {
    const { field: el, shift: sh } = live.current
    if (!el) return
    const result = press(el, "Enter", { shift: sh !== "off" })
    lastSpace.current = 0
    if (sh === "once") setShift("off")
    if (result.then === "next") {
      if (!focusNext(el)) el.blur()
    } else if (result.then === "hide" && document.activeElement === el) el.blur()
    settle()
  }

  const typeBack = (repeat = false, word = false) => {
    const el = live.current.field
    if (!el) return
    press(el, "Backspace", { repeat, word })
    lastSpace.current = 0
    settle()
  }

  const typeNamed = (name, repeat = false) => {
    const el = live.current.field
    if (!el) return
    const c = live.current.ctrl
    const result = press(el, name, { repeat, ctrl: c })
    if (c) setCtrl(false)
    if (result.then === "next" && !focusNext(el)) el.blur()
    settle()
  }

  const typeUndo = () => {
    const el = live.current.field
    if (!el) return
    press(el, "z", { ctrl: true })
    settle()
  }

  const tapShift = () => {
    const now = performance.now()
    const { shift: sh, autoUpper: au } = live.current
    if (now - lastShiftTap.current < DOUBLE_TAP && sh !== "lock") {
      setShift("lock")
      lastShiftTap.current = 0
      return
    }
    lastShiftTap.current = now
    if (sh === "lock") setShift("off")
    else if (sh === "once" || au) setShift("off")
    else setShift("once")
    setAutoUpper(false)
  }

  // ---- pointers ----

  const keyAt = (id) => {
    const [r, c] = id.split("-").map(Number)
    return rows[r]?.[c]
  }

  const keyRect = (node) => {
    const root = rootRef.current.getBoundingClientRect()
    const r = node.getBoundingClientRect()
    return { x: r.left - root.left, y: r.top - root.top, w: r.width, h: r.height }
  }

  const charFor = (key) => {
    const { shift: sh, autoUpper: au } = live.current
    const up = sh !== "off" || au
    return up && key.value.length === 1 ? key.value.toUpperCase() : key.value
  }

  const showPreview = (id, node, key) => {
    const f = live.current.info
    if (!live.current.settings.keyPreviews || (f && isPassword(f)) || key.value.length > 1) return setPreview(null)
    setPreview({ id, text: charFor(key), ...keyRect(node) })
  }

  const stopTimers = (p) => {
    clearTimeout(p.timer)
    clearInterval(p.repeat)
  }

  const release = (p, commit) => {
    stopTimers(p)
    pointers.current.delete(p.pointerId)
    // with no finger left on the keyboard nothing can look pressed: this also clears a key
    // whose release went missing (the keys were redrawn mid-press: Shift, auto-capitals)
    setDown((d) => {
      if (!pointers.current.size) return {}
      const next = { ...d }
      delete next[p.id]
      return next
    })
    if (p.key.kind === "space" && p.mode === "track") setTrack(false)
    if (commit && !p.done) {
      p.done = true
      const k = p.key
      if (k.kind === "char") {
        if (p.mode === "alts") {
          const a = p.alts
          if (a && a.index >= 0) typeChar(a.items[a.index])
        } else typeChar(charFor(k))
      } else if (k.kind === "space" && p.mode !== "track") typeSpace()
      else if (k.kind === "enter") typeEnter()
      else if (k.kind === "undo") typeUndo()
    }
    setPreview((v) => (v?.id === p.id ? null : v))
    if (p.mode === "alts") setAlts(null)
  }

  const onPointerDown = (e) => {
    // keep focus (and the caret) in the field
    e.preventDefault()
    noteGesture()
    const node = e.target.closest?.("[data-k]")
    if (!node || !rootRef.current?.contains(node)) return
    const id = node.dataset.k
    const key = keyAt(id)
    if (!key) return
    try {
      rootRef.current.setPointerCapture(e.pointerId)
    } catch {
      // fine without
    }
    // fast thumbs: a second key down types the first one now
    for (const other of [...pointers.current.values()]) {
      if (other.key.kind === "char" && !other.mode) release(other, true)
    }
    const p = { pointerId: e.pointerId, id, key, node, x0: e.clientX, y0: e.clientY, lastX: e.clientX, lastY: e.clientY, accX: 0, accY: 0, mode: null, done: false }
    pointers.current.set(e.pointerId, p)
    setDown((d) => ({ ...d, [id]: true }))
    keyClick(key.kind === "space" || key.kind === "enter" ? "space" : key.kind === "back" ? "back" : "key")
    haptic()

    const s = live.current.settings
    switch (key.kind) {
      case "char": {
        showPreview(id, node, key)
        const items = alternatesFor(key.value, (live.current.shift !== "off" || live.current.autoUpper) && key.value.length === 1)
        if (items.length) {
          p.timer = setTimeout(() => {
            const rect = keyRect(node)
            const longest = Math.max(...items.map((item) => item.length))
            const cell = Math.max(rect.w, 34, longest > 1 ? longest * 8 + 14 : 0)
            const rootW = rootRef.current.offsetWidth
            const width = cell * items.length
            const x = Math.max(2, Math.min(rect.x + rect.w / 2 - cell / 2, rootW - width - 2))
            p.mode = "alts"
            p.alts = { id, items, index: 0, x, y: rect.y, cell, h: rect.h }
            setPreview(null)
            setAlts({ ...p.alts })
          }, LONG_PRESS)
        }
        break
      }
      case "back":
        typeBack()
        p.timer = setTimeout(() => {
          let count = 0
          p.repeat = setInterval(() => typeBack(true, ++count > WORD_AFTER), s.keyRepeatRate || 60)
        }, s.keyRepeatDelay || 500)
        break
      case "key":
        typeNamed(key.value)
        if (key.value.startsWith("Arrow"))
          p.timer = setTimeout(() => {
            p.repeat = setInterval(() => typeNamed(key.value, true), Math.max(s.keyRepeatRate || 60, 50))
          }, s.keyRepeatDelay || 500)
        break
      case "shift":
        tapShift()
        break
      case "page":
        setPage(targetPage(key.value))
        break
      case "ctrl":
        setCtrl((c) => !c)
        break
      case "space":
        p.timer = setTimeout(() => {
          p.mode = "track"
          setTrack(true)
          haptic()
        }, LONG_PRESS)
        break
      default:
    }
  }

  const onPointerMove = (e) => {
    const p = pointers.current.get(e.pointerId)
    if (!p) return
    if (p.mode === "alts") {
      const a = p.alts
      const rootLeft = rootRef.current.getBoundingClientRect().left
      const i = Math.floor((e.clientX - rootLeft - a.x) / a.cell)
      const index = i < 0 || i >= a.items.length ? (e.clientY - p.y0 > 40 ? -1 : Math.max(0, Math.min(a.items.length - 1, i))) : i
      if (index !== a.index) {
        a.index = index
        setAlts({ ...a })
      }
      return
    }
    if (p.key.kind === "space") {
      if (p.mode !== "track" && Math.abs(e.clientX - p.x0) > 12) {
        clearTimeout(p.timer)
        p.mode = "track"
        setTrack(true)
      }
      if (p.mode === "track") {
        const el = live.current.field
        p.accX += e.clientX - p.lastX
        p.accY += e.clientY - p.lastY
        const dx = Math.trunc(p.accX / STEP_X)
        const multi = live.current.info && isMultiline(live.current.info)
        const dy = multi ? Math.trunc(p.accY / STEP_Y) : 0
        if (dx) {
          p.accX -= dx * STEP_X
          p.column = moveBy(el, dx, 0)
        }
        if (dy) {
          p.accY -= dy * STEP_Y
          p.column = moveBy(el, 0, dy, p.column)
        }
        if (!multi) p.accY = 0
      }
      p.lastX = e.clientX
      p.lastY = e.clientY
      return
    }
    // sliding onto another letter types that one instead, as phones do
    if (p.key.kind === "char" && !p.mode) {
      const under = document.elementFromPoint(e.clientX, e.clientY)?.closest?.("[data-k]")
      if (under && under.dataset.k !== p.id && rootRef.current.contains(under)) {
        const key = keyAt(under.dataset.k)
        if (key?.kind === "char") {
          clearTimeout(p.timer)
          setDown((d) => {
            const next = { ...d, [under.dataset.k]: true }
            delete next[p.id]
            return next
          })
          p.id = under.dataset.k
          p.key = key
          p.node = under
          showPreview(p.id, under, key)
        }
      }
    }
  }

  const onPointerUp = (e) => {
    const p = pointers.current.get(e.pointerId)
    if (p) release(p, true)
  }

  const onPointerCancel = (e) => {
    const p = pointers.current.get(e.pointerId)
    if (p) release(p, false)
  }

  // the capture can be lost when keys are redrawn under a finger: that press is over (its
  // pointerup may never reach us), so don't leave the key looking held down
  const onLostCapture = (e) => {
    const p = pointers.current.get(e.pointerId)
    if (p) release(p, false)
  }

  // and a finger lifted anywhere on the page ends its press too
  useEffect(() => {
    const end = (e) => {
      const p = pointers.current.get(e.pointerId)
      if (p) release(p, e.type === "pointerup")
    }
    window.addEventListener("pointerup", end, true)
    window.addEventListener("pointercancel", end, true)
    return () => {
      window.removeEventListener("pointerup", end, true)
      window.removeEventListener("pointercancel", end, true)
    }
  })

  // a screen reader's activation (a click with no pointer before it)
  const onKeyClick = (e) => {
    if (e.detail !== 0) return
    const key = keyAt(e.currentTarget.dataset.k)
    if (!key) return
    if (key.kind === "char") typeChar(charFor(key))
    else if (key.kind === "space") typeSpace()
    else if (key.kind === "enter") typeEnter()
    else if (key.kind === "back") typeBack()
    else if (key.kind === "shift") tapShift()
    else if (key.kind === "page") setPage(targetPage(key.value))
    else if (key.kind === "ctrl") setCtrl((c) => !c)
    else if (key.kind === "undo") typeUndo()
    else if (key.kind === "key") typeNamed(key.value)
  }

  useEffect(
    () => () => {
      pointers.current.forEach(stopTimers)
      pointers.current.clear()
    },
    []
  )

  // the keyboard closing mid-press
  useEffect(() => {
    if (visible) return
    pointers.current.forEach(stopTimers)
    pointers.current.clear()
    setDown({})
    setPreview(null)
    setAlts(null)
    setTrack(false)
  }, [visible])

  // ---- the title bar's buttons ----

  const toPhoneKeyboard = () => {
    const el = live.current.field
    if (!el) return
    setField(null)
    switchToPhoneKeyboard(el)
  }

  const hide = () => {
    const el = live.current.field
    setField(null)
    el?.blur()
  }

  // ---- drawing ----

  const rows = rowsFor(page, home.variant, wide && page !== "dos")
  const units = rowUnits(rows)
  const label = info ? enterLabel(info) : "Enter"

  if (!field || (dormant && !physical)) return null

  if (physical)
    return (
      <button
        type="button"
        className="kb98Restore"
        tabIndex={-1}
        aria-label="Show the 98ish keyboard"
        title="Show the 98ish keyboard"
        style={{ bottom: taskbarOffset() + 4 }}
        onPointerDown={(e) => e.preventDefault()}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setPhysical(false)}
      >
        <KeyboardIcon />
      </button>
    )

  const keyContent = (key) => {
    switch (key.kind) {
      case "shift":
        return (
          <>
            <ShiftIcon filled={upper} />
            <span className={shift === "lock" ? "kb98Led is-on" : "kb98Led"} aria-hidden="true" />
          </>
        )
      case "back":
        return <BackIcon />
      case "enter":
        return (
          <span className="kb98EnterLabel">
            {label === "Return" || label === "Enter" ? <EnterIcon /> : null}
            {label}
          </span>
        )
      case "space":
        return <span className="kb98Small">space</span>
      case "key":
        return ARROW_GLYPH[key.value] ? <span className="kb98Arrow">{ARROW_GLYPH[key.value]}</span> : <span className="kb98Small">{key.label}</span>
      case "char": {
        const text = charFor(key)
        return <span className={text.length > 1 ? "kb98Small" : "kb98Glyph"}>{text}</span>
      }
      default:
        return <span className="kb98Small">{keyLabel(key)}</span>
    }
  }

  const ariaFor = (key) => {
    switch (key.kind) {
      case "shift":
        return shift === "lock" ? "Caps Lock (on)" : upper ? "Shift (on)" : "Shift"
      case "back":
        return "Backspace"
      case "enter":
        return label
      case "space":
        return "Space"
      case "page":
        return { letters: "Letters", numbers: "Numbers", symbols: "Symbols" }[key.value] || key.label
      case "ctrl":
        return ctrl ? "Ctrl (on)" : "Ctrl"
      case "key":
        return { Escape: "Escape", Tab: "Tab", ArrowLeft: "Left arrow", ArrowRight: "Right arrow", ArrowUp: "Up arrow", ArrowDown: "Down arrow" }[key.value] || key.label
      case "undo":
        return "Undo"
      default:
        return charFor(key)
    }
  }

  const className = ["kb98", "window", wide ? "is-wide" : "", short ? "is-short" : "", track ? "is-track" : "", bottom ? "" : "is-flush", page === "numpad" ? "is-numpad" : ""].filter(Boolean).join(" ")

  return (
    <div
      ref={rootRef}
      className={className}
      role="group"
      aria-label="98ish keyboard"
      style={{ bottom }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onLostCapture}
      onMouseDown={(e) => e.preventDefault()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="title-bar kb98Title">
        <div className="title-bar-text">
          <KeyboardIcon />
          Keyboard
        </div>
        <div className="title-bar-controls">
          {isCredential(info) && (
            <button type="button" className="kb98TitleText" tabIndex={-1} aria-label="Passwords: use the phone's keyboard for AutoFill" onClick={toPhoneKeyboard}>
              Passwords
            </button>
          )}
          <button type="button" className="kb98PhoneBtn" tabIndex={-1} aria-label="Use the phone's keyboard" title="Use the phone's keyboard" onClick={toPhoneKeyboard}>
            <PhoneIcon />
          </button>
          <button type="button" className="close" tabIndex={-1} aria-label="Hide keyboard" title="Hide keyboard" onClick={hide} />
        </div>
      </div>
      <div className="kb98Keys" style={{ "--kb-units": units }}>
        {rows.map((row, r) => {
          const used = row.reduce((sum, key) => sum + (key.w || 1), 0)
          const pad = (units - used) / 2
          return (
            <div className="kb98Row" key={`${page}-${r}`}>
              {pad > 0.01 && <span className="kb98Pad" style={{ flexGrow: pad }} />}
              {row.map((key, c) => {
                const id = `${r}-${c}`
                const latched = (key.kind === "shift" && upper) || (key.kind === "ctrl" && ctrl)
                const cls = ["kb98Key", `kb98Key--${key.kind}`, down[id] ? "is-down" : "", latched ? "is-latched" : ""].filter(Boolean).join(" ")
                return (
                  <button type="button" key={id} data-k={id} className={cls} style={{ flexGrow: key.w || 1 }} tabIndex={-1} aria-label={ariaFor(key)} onClick={onKeyClick}>
                    <span className="kb98Cap">{keyContent(key)}</span>
                  </button>
                )
              })}
              {pad > 0.01 && <span className="kb98Pad" style={{ flexGrow: pad }} />}
            </div>
          )
        })}
      </div>
      {preview && (
        <div className="kb98Preview" aria-hidden="true" style={{ left: preview.x - 8, top: preview.y - preview.h - 10, width: preview.w + 16, height: preview.h + 6 }}>
          {preview.text}
        </div>
      )}
      {alts && (
        <div className="kb98Alts" role="listbox" aria-label="Accents" style={{ left: alts.x, top: alts.y - alts.h - 10, height: alts.h + 4 }}>
          {alts.items.map((item, i) => (
            <span key={item} role="option" aria-selected={i === alts.index} className={["kb98Alt", item.length > 1 ? "kb98Alt--word" : "", i === alts.index ? "is-on" : ""].filter(Boolean).join(" ")} style={{ width: alts.cell }}>
              {item}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export default Keyboard
