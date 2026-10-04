import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useSettings } from "../../../utils/settings"
import { allowsShortcuts, capsMode, enterLabel, isCredential, isMultiline, isPassword, layoutFor, readField, textFieldFor } from "./fields"
import { PAD_LETTERS, alternatesFor, isPad, rowsFor } from "./layouts"
import { balloonFor, deleteRepeat, hitTest, layoutKeys, metricsFor, stripFor, stripIndex } from "./geometry"
import { wantsCapital, wantsPeriod } from "./editing"
import { focusNext, moveBy, pressKey, textBefore } from "./typing"
import { noteGesture, suppress, switchToPhoneKeyboard, wantsKeyboard } from "./native"
import { haptic, keyClick } from "./feedback"
import { BackIcon, EnterIcon, KeyboardIcon, PhoneIcon, ShiftIcon } from "./icons"
import "./Keyboard.css"

// The 98ish keyboard: a Windows 98 tool window docked above the taskbar that types into
// whichever text field has focus (see docs/keyboard.md). KeyboardHost mounts it on touch
// screens. It never takes focus: every key cancels its pointerdown, so the field keeps the
// caret and selection. Keys sit where the iPhone's do and behave like them (geometry.js):
// a letter pops up in a balloon on touch down, follows the finger and types on touch up.

const LONG_PRESS = 500 // ms: accents
const TRACK_HOLD = 500 // ms on the space bar: the keyboard turns into a trackpad
const DOUBLE_TAP = 350 // ms: Shift twice = Caps Lock
const STEP_X = 9 // px of trackpad drag per character
const STEP_Y = 22 // px per line
const OFF_KEYS = 44 // px a sliding finger may stray above / below the keys and still be on one

// return keys iOS draws blue (the 98 highlight here); return, Enter and Next stay gray
const ACTION_LABELS = new Set(["Go", "Search", "Send", "Done", "Join"])

const readView = () => ({ w: window.innerWidth, h: window.innerHeight })

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
  // phones get the iPhone's keyboard (portrait or landscape); tablets a roomier one
  const [view, setView] = useState(readView)
  const tablet = Math.min(view.w, view.h) >= 500
  const landscape = view.w > view.h && !tablet

  const [field, setField] = useState(null)
  const [physical, setPhysical] = useState(false)
  const [dormant, setDormant] = useState(false) // focused by code, not by a touch: wait for a tap
  const [page, setPage] = useState("letters")
  const [shift, setShift] = useState("off") // off | once | lock
  const [autoUpper, setAutoUpper] = useState(false)
  const [ctrl, setCtrl] = useState(false)
  const [down, setDown] = useState({}) // key id -> true, while pressed
  const [preview, setPreview] = useState(null) // { id, text, cap }: the balloon
  const [alts, setAlts] = useState(null) // { id, cap, strip, index }: the accents strip
  const [track, setTrack] = useState(false) // the space bar's trackpad
  const [bottom, setBottom] = useState(0)
  const [kw, setKw] = useState(() => Math.max(0, window.innerWidth - 4)) // the keys' width

  const rootRef = useRef(null)
  const keysRef = useRef(null)
  const pointers = useRef(new Map())
  const lastShiftTap = useRef(0)
  const lastSpace = useRef(0)
  const lifted = useRef(new Map())
  const liftFor = useRef({ field: null, box: null })

  const info = useMemo(() => (field ? readField(field) : null), [field])
  const home = info ? layoutFor(info) : { page: "letters", variant: "text" }
  const visible = !!field && !physical && !dormant
  const upper = shift !== "off" || autoUpper

  // the page's keys, placed as on an iPhone this wide
  const m = metricsFor({ width: kw, landscape, numpad: isPad(page) })
  const keys = useMemo(() => layoutKeys(rowsFor(page, home.variant, tablet && page !== "dos"), metricsFor({ width: kw, landscape, numpad: isPad(page) })), [page, home.variant, tablet, kw, landscape])

  // what timers and listeners read (they outlive a render)
  const live = useRef({})
  live.current = { field, info, shift, autoUpper, ctrl, settings, page, home, keys, m, landscape, kw }
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
    if (!el || !f || !s.autoCaps || isPad(p)) return setAutoUpper(false)
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

  // the screen turning (portrait / landscape keys)
  useEffect(() => {
    const onResize = () => setView(readView())
    window.addEventListener("resize", onResize)
    window.addEventListener("orientationchange", onResize)
    return () => {
      window.removeEventListener("resize", onResize)
      window.removeEventListener("orientationchange", onResize)
    }
  }, [])

  // the keys' width (the screen less the frame and the safe areas): where every key goes
  useLayoutEffect(() => {
    const el = keysRef.current
    if (!el) return
    const measure = () => {
      if (el.clientWidth) setKw(el.clientWidth)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [visible, physical])

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

  // like iOS, the 123 and #+= pages go back to the letters after a space or an apostrophe
  // (or a character slid to from the 123 key)
  const backToLetters = () => {
    const { page: p, home: h } = live.current
    if ((p === "numbers" || p === "symbols") && (h.page === "letters" || h.page === "dos")) setPage(h.page)
  }

  const typeChar = (value, slid = false) => {
    if (slid || value === "'") backToLetters()
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
    backToLetters()
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
  // Like iOS: a touch belongs to the nearest key (geometry.js hitTest), letters pop up in a
  // balloon on touch down and type on touch up, the finger can slide to another letter
  // (the balloon follows; the key under the finger at the end is the one typed), Shift and
  // the page keys act on touch down (and a slide from them to a character types it), Delete
  // deletes on touch down and repeats, the space bar types on touch up or turns into a
  // trackpad when held or dragged.

  // a pointer's place in the keys area, and whether it's near enough the keys to be on one
  const localPoint = (e) => {
    const r = keysRef.current?.getBoundingClientRect()
    if (!r) return null
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    return { x, y, near: y >= -OFF_KEYS && y <= r.height + OFF_KEYS && x >= -OFF_KEYS && x <= r.width + OFF_KEYS }
  }

  const keyAt = (id) => live.current.keys.find((k) => k.id === id)?.key

  const charFor = (key) => {
    const { shift: sh, autoUpper: au } = live.current
    const up = sh !== "off" || au
    return up && key.value.length === 1 ? key.value.toUpperCase() : key.value
  }

  // the balloon over a character key (not on password fields, as on iOS, or with the
  // setting off; words like ".com" don't pop up)
  const showPreview = (placed) => {
    const f = live.current.info
    if (!live.current.settings.keyPreviews || (f && isPassword(f)) || placed.key.value.length > 1) return setPreview(null)
    setPreview({ id: placed.id, text: charFor(placed.key), cap: placed.cap })
  }

  const pressDown = (id, on = true) =>
    setDown((d) => {
      const next = { ...d }
      if (on) next[id] = true
      else delete next[id]
      return next
    })

  const stopTimers = (p) => {
    clearTimeout(p.timer)
    clearInterval(p.repeat)
  }

  // the long press on a character with alternates: the strip opens over it
  const altsItems = (key) => {
    const { page: pg, home: h, shift: sh, autoUpper: au } = live.current
    if (isPad(pg)) return h.variant === "tel" && key.value === "0" ? ["+"] : []
    return alternatesFor(key.value, (sh !== "off" || au) && key.value.length === 1)
  }

  const armLongPress = (p) => {
    clearTimeout(p.timer)
    const items = altsItems(p.k.key)
    if (!items.length) return
    p.timer = setTimeout(() => {
      const { kw: width, landscape: land } = live.current
      const strip = stripFor(p.k.cap, items, width, land)
      // the key's own character (or the only choice) starts chosen, as on iOS
      const index = strip.shown.indexOf(items[0])
      p.mode = "alts"
      p.alts = { id: p.k.id, cap: p.k.cap, strip, index: Math.max(0, index) }
      setPreview(null)
      setAlts({ ...p.alts })
      haptic()
    }, LONG_PRESS)
  }

  // a character press moving onto another key
  const follow = (p, placed) => {
    const isChar = placed?.key.kind === "char"
    if (!isChar) {
      // off the letters (onto Shift, space, off the keyboard): nothing is typed unless the
      // finger comes back
      if (!p.off) {
        p.off = true
        clearTimeout(p.timer)
        pressDown(p.k.id, false)
        setPreview((v) => (v?.id === p.k.id ? null : v))
      }
      return
    }
    if (!p.off && placed.id === p.k.id) return
    if (!p.off) pressDown(p.k.id, false)
    p.off = false
    p.k = placed
    p.id = placed.id
    pressDown(placed.id)
    showPreview(placed)
    armLongPress(p)
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
    if (p.k.key.kind === "space" && p.mode === "track") setTrack(false)
    if (commit && !p.done) {
      p.done = true
      const k = p.k.key
      if (k.kind === "char" && !p.off) {
        if (p.mode === "alts") {
          const a = p.alts
          if (a && a.index >= 0) typeChar(a.strip.shown[a.index], p.slid)
        } else typeChar(charFor(k), p.slid)
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
    if (!rootRef.current || e.target.closest?.(".kb98Title")) return
    const pt = localPoint(e)
    const { keys: placedKeys, m: metrics } = live.current
    const placed = pt && hitTest(placedKeys, pt.x, pt.y, metrics)
    if (!placed) return
    const { key, id } = placed
    // fast thumbs: a second key down types the first one now (rollover, as on iOS)
    for (const other of [...pointers.current.values()]) {
      if (other.k.key.kind === "char" && !other.mode) release(other, true)
    }
    const p = { pointerId: e.pointerId, id, k: placed, x0: e.clientX, y0: e.clientY, lastX: e.clientX, lastY: e.clientY, accX: 0, accY: 0, mode: null, done: false, off: false, slid: false }
    pointers.current.set(e.pointerId, p)
    pressDown(id)
    keyClick(key.kind === "space" || key.kind === "enter" ? "space" : key.kind === "back" ? "back" : "key")
    haptic()
    // the phone slot works by its click (the phone's keyboard needs focus inside the tap)
    if (key.kind === "phone") return
    try {
      rootRef.current.setPointerCapture(e.pointerId)
    } catch {
      // fine without
    }

    const s = live.current.settings
    switch (key.kind) {
      case "char":
        showPreview(placed)
        armLongPress(p)
        break
      case "back": {
        typeBack()
        let n = 1
        const next = () => {
          const step = deleteRepeat(n, { delay: s.keyRepeatDelay || 500, rate: s.keyRepeatRate || 60 })
          p.timer = setTimeout(() => {
            typeBack(true, step.word)
            n++
            next()
          }, step.wait)
        }
        next()
        break
      }
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
        }, TRACK_HOLD)
        break
      default:
    }
  }

  const onPointerMove = (e) => {
    const p = pointers.current.get(e.pointerId)
    if (!p) return
    const kind = p.k.key.kind
    if (p.mode === "alts") {
      const pt = localPoint(e)
      const a = p.alts
      // well below the strip lets go of it: nothing is typed
      const index = pt && pt.y - (a.cap.y + a.cap.h) > OFF_KEYS ? -1 : pt ? stripIndex(a.strip, pt.x) : a.index
      if (index !== a.index) {
        a.index = index
        setAlts({ ...a })
      }
      return
    }
    if (kind === "space") {
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
    const pt = localPoint(e)
    const { keys: placedKeys, m: metrics } = live.current
    const under = pt && pt.near ? hitTest(placedKeys, pt.x, pt.y, metrics) : null
    if (kind === "char" && !p.mode) return follow(p, under)
    // from Shift or 123 / #+= / ABC onto a character: that character, on letting go (and
    // from a page key, back to the letters after it)
    if ((kind === "shift" || kind === "page") && under && under.id !== p.k.id && under.key.kind === "char") {
      p.slid = kind === "page"
      pressDown(p.k.id, false)
      p.off = true
      p.k = { ...p.k, key: { kind: "char", value: "" } }
      follow(p, under)
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

  // a screen reader's activation (a click with no pointer before it), and the phone slot
  const onKeyClick = (e) => {
    const key = keyAt(e.currentTarget.dataset.k)
    if (!key) return
    if (key.kind === "phone") return toPhoneKeyboard()
    if (e.detail !== 0) return
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

  const label = info ? enterLabel(info) : "Enter"
  const pad = isPad(page)

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
            <ShiftIcon filled={upper} lock={shift === "lock"} />
            <span className={shift === "lock" ? "kb98Led is-on" : "kb98Led"} aria-hidden="true" />
          </>
        )
      case "back":
        return <BackIcon />
      case "phone":
        return <PhoneIcon />
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
        if (pad) {
          const sub = page === "numpad" ? (home.variant === "tel" && text === "0" ? "+" : PAD_LETTERS[text]) : null
          return (
            <span className="kb98PadDigit">
              <span className="kb98Glyph">{text}</span>
              {sub && <span className="kb98PadSub">{sub}</span>}
            </span>
          )
        }
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
      case "phone":
        return "Use the phone's keyboard"
      case "page":
        return { letters: "Letters", numbers: "Numbers", symbols: "Symbols", numpad: "Numbers", telsym: "Phone symbols" }[key.value] || key.label
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

  // the balloon: the key's face grown up out of it, white, with the letter big
  const balloon = (cap, head, body, id) => {
    const b = balloonFor(cap, kw, landscape)
    const h = head || b.head
    return (
      <div className={`kb98Balloon${head ? " kb98Balloon--alts" : ""}`} aria-hidden={head ? undefined : "true"} data-for={id}>
        <div className="kb98BalloonStem" style={{ left: b.stem.x, top: h.y + h.h - 3, width: b.stem.w, height: b.stem.y + b.stem.h - (h.y + h.h - 3) }} />
        <div className="kb98BalloonHead" style={{ left: h.x, top: h.y, width: h.w, height: h.h }}>
          {body}
        </div>
      </div>
    )
  }

  const className = ["kb98", "window", tablet ? "is-wide" : "", landscape ? "is-short" : "", track ? "is-track" : "", bottom ? "" : "is-flush", pad ? "is-numpad" : ""].filter(Boolean).join(" ")
  const action = ACTION_LABELS.has(label)

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
          {pad && (
            <>
              {/* the number pad has no return key (as on iOS): Safari's bar above it has Done */}
              <button type="button" className="kb98TitleText kb98TitleEnter" tabIndex={-1} aria-label={label} onClick={typeEnter}>
                {label}
              </button>
              <button type="button" className="kb98PhoneBtn" tabIndex={-1} aria-label="Use the phone's keyboard" title="Use the phone's keyboard" onClick={toPhoneKeyboard}>
                <PhoneIcon />
              </button>
            </>
          )}
          <button type="button" className="close" tabIndex={-1} aria-label="Hide keyboard" title="Hide keyboard" onClick={hide} />
        </div>
      </div>
      <div className="kb98Keys" ref={keysRef} style={{ height: rowsCount(keys) * m.pitch }}>
        {keys.map((placed) => {
          const { key, id, touch, cap } = placed
          if (key.kind === "blank") return null
          const latched = (key.kind === "shift" && upper) || (key.kind === "ctrl" && ctrl)
          const cls = ["kb98Key", `kb98Key--${key.kind}`, down[id] ? "is-down" : "", latched ? "is-latched" : "", key.kind === "enter" && action ? "is-action" : ""].filter(Boolean).join(" ")
          return (
            <button
              type="button"
              key={`${page}-${id}`}
              data-k={id}
              className={cls}
              style={{ left: touch.x, top: touch.y, width: touch.w, height: touch.h }}
              tabIndex={-1}
              aria-label={ariaFor(key)}
              onClick={onKeyClick}
            >
              <span className="kb98Cap" style={{ left: Math.round(cap.x - touch.x), top: Math.round(cap.y - touch.y), width: Math.round(cap.w), height: cap.h }}>
                {keyContent(key)}
              </span>
            </button>
          )
        })}
        {preview && !alts && balloon(preview.cap, null, <span className="kb98BalloonText">{preview.text}</span>, preview.id)}
        {alts &&
          balloon(
            alts.cap,
            alts.strip,
            <div className="kb98Alts" role="listbox" aria-label="Accents" style={{ padding: alts.strip.pad }}>
              {alts.strip.shown.map((item, i) => (
                <span key={item} role="option" aria-selected={i === alts.index} className={["kb98Alt", item.length > 1 ? "kb98Alt--word" : "", i === alts.index ? "is-on" : ""].filter(Boolean).join(" ")} style={{ width: alts.strip.cell }}>
                  {item}
                </span>
              ))}
            </div>,
            alts.id
          )}
      </div>
    </div>
  )
}

// how many rows a page's placed keys make
const rowsCount = (keys) => (keys.length ? keys[keys.length - 1].row + 1 : 0)

export default Keyboard
