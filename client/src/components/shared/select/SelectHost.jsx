import React, { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { controlFor, isTextEntry, pickerKind } from "./fields"
import Popup from "./Popup"
import ListPicker from "./ListPicker"
import DatePicker from "./DatePicker"
import "./Select.css"

// Mounted once in App. Takes over every drop-down <select> and every date/time field in
// 98ish, so the phone's (or the browser's) own pickers never open and a Windows 98 list or
// calendar opens instead: under the field with a mouse, as a bottom sheet on a phone (lists
// drop down under the field on phones too).
//
// How the native picker is kept shut:
// - touch: the tap's touchend is cancelled (passive: false). A cancelled touchend gets no
//   mouse events, no click and no focus, which is what opens iOS's picker; scrolling that
//   starts on a field still scrolls (only a tap is cancelled).
// - mouse: the mousedown is cancelled (that's what opens a select's popup in every desktop
//   browser), and the field is focused by hand. Date fields keep their typing: only their
//   drawn button (the right-hand end) opens the calendar.
// - keys: Alt+Down/Up, F4 and Space (plus Enter and the arrows on a Mac) open ours.
// - focus that slips through on a touch screen (iOS's form arrows, a label tap) is undone.
// Opt out with data-native-select on the field or any parent. See docs in Select.css.
const touchPrimary = () => window.matchMedia?.("(hover: none) and (pointer: coarse)").matches
const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform || "")

// the drawn button at the right of a date field (as wide as main.css draws it, plus slack)
const buttonWidth = (el) => (parseFloat(getComputedStyle(el).getPropertyValue("--sel-btn")) || 16) + 4

const SelectHost = () => {
  const [open, setOpen] = useState(null) // { el, kind, via, sheet, rect, n }
  const live = useRef(null)
  live.current = open
  const popupRef = useRef(null)
  const keyRef = useRef(null) // the open picker's key handler: (event) => handled?
  const counter = useRef(0)

  const close = useCallback((refocus = true) => {
    const cur = live.current
    if (!cur) return
    live.current = null
    cur.el.removeAttribute("data-sel-open")
    cur.el.removeAttribute("aria-expanded")
    cur.el.removeAttribute("aria-controls")
    cur.el.removeAttribute("aria-activedescendant")
    setOpen(null)
    if (refocus && cur.via !== "touch" && cur.el.isConnected && !cur.el.disabled) cur.el.focus({ preventScroll: true })
  }, [])

  const openFor = useCallback((el, via) => {
    const kind = pickerKind(el)
    if (!kind) return
    // a text field's keyboard (the phone's or 98ish's) goes down, as for a native picker
    if (via === "touch" && isTextEntry(document.activeElement)) document.activeElement.blur()
    // lists drop down under the field everywhere (the owner wants a real drop-down); on a
    // phone only the date/time pickers, too wide for under a field, open as a bottom sheet
    const sheet = kind !== "list" && !!document.querySelector(".os-root")?.classList.contains("os-mobile")
    const n = ++counter.current
    el.setAttribute("data-sel-open", "")
    el.setAttribute("aria-expanded", "true")
    el.setAttribute("aria-controls", `sel-popup-${n}`)
    const next = { el, kind, via, sheet, rect: el.getBoundingClientRect(), n, size: { w: window.innerWidth, h: window.innerHeight } }
    live.current = next
    setOpen(next)
  }, [])

  useEffect(() => {
    let touch = null // the tap in progress on a field: { el, x, y }
    let lastTouch = null // { el, t }: the last touch on a field (to pair with a stray focus)
    let touchOpenedAt = 0
    const inPopup = (t) => !!popupRef.current?.contains(t)

    const onTouchStart = (e) => {
      touch = null
      if (inPopup(e.target) || e.touches.length !== 1) return
      const el = controlFor(e.target)
      if (!el) return
      const p = e.touches[0]
      touch = { el, x: p.clientX, y: p.clientY }
      lastTouch = { el, t: performance.now() }
    }
    const onTouchMove = (e) => {
      const p = e.touches[0]
      if (touch && p && Math.hypot(p.clientX - touch.x, p.clientY - touch.y) > 10) touch = null
    }
    const onTouchEnd = (e) => {
      const t = touch
      touch = null
      if (!t) return
      const p = e.changedTouches[0]
      if (p && Math.hypot(p.clientX - t.x, p.clientY - t.y) > 10) return
      // a scroll already took the touch: it isn't a tap
      if (!e.cancelable) return
      e.preventDefault()
      touchOpenedAt = performance.now()
      if (live.current?.el === t.el) return close(false)
      if (live.current) close(false)
      openFor(t.el, "touch")
    }
    const onTouchCancel = () => {
      touch = null
    }

    const onMouseDown = (e) => {
      if (e.button !== 0 || inPopup(e.target)) return
      const el = e.target.closest?.("select, input")
      const kind = el && pickerKind(el)
      if (!kind) return
      // the mouse events a touch screen makes up after a tap we already handled
      if (performance.now() - touchOpenedAt < 1000) return e.preventDefault()
      if (kind !== "list") {
        // date and time fields: typing in the field stays; the button opens the calendar
        const r = el.getBoundingClientRect()
        if (e.clientX < r.right - buttonWidth(el) && !touchPrimary()) return
      }
      e.preventDefault()
      if (document.activeElement !== el) el.focus({ preventScroll: true })
      if (live.current?.el === el) close()
      else {
        if (live.current) close(false)
        openFor(el, "mouse")
      }
    }

    // a press anywhere else closes the list (the field's own press toggles it, above)
    const onPointerDown = (e) => {
      const cur = live.current
      if (!cur || inPopup(e.target)) return
      if (cur.el === e.target || cur.el.contains(e.target)) return
      if (controlFor(e.target) === cur.el && e.pointerType === "touch") return
      close(false)
    }

    const onKeyDown = (e) => {
      if (live.current) {
        if (e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "Meta") return
        const handled = keyRef.current?.(e)
        if (handled) {
          if (handled !== "pass") e.preventDefault()
          e.stopPropagation()
          e.stopImmediatePropagation?.()
        }
        return
      }
      const el = e.target
      const kind = pickerKind(el)
      if (!kind || e.ctrlKey || e.metaKey) return
      const k = e.key
      const opens =
        (e.altKey && (k === "ArrowDown" || k === "ArrowUp")) ||
        k === "F4" ||
        (kind === "list" && !e.altKey && (k === " " || (isMac() && (k === "Enter" || k === "ArrowDown" || k === "ArrowUp"))))
      if (!opens) return
      e.preventDefault()
      e.stopPropagation()
      openFor(el, "key")
    }

    // focus that reached a field on a touch screen without our tap (iOS's form arrows, a
    // label, an app's focus()) would show the native picker: take it back
    const onFocusIn = (e) => {
      const el = e.target
      if (!touchPrimary() || !pickerKind(el) || live.current?.el === el) return
      el.blur()
      if (lastTouch && performance.now() - lastTouch.t < 1000 && lastTouch.el === el) {
        lastTouch = null
        openFor(el, "touch")
      }
    }

    // typing a new date into the field itself makes the open calendar stale
    const onInput = (e) => {
      const cur = live.current
      if (cur && e.target === cur.el && !cur.el.__selWriting) close(false)
    }

    // Only a scroll that moves the field closes the list, as natively: the page, or a box the
    // field is inside. (A game's own overlays and live panels scroll themselves all the time:
    // a list over a game could shut as it opened.)
    const onScroll = (e) => {
      const cur = live.current
      if (!cur || cur.sheet || inPopup(e.target)) return
      const t = e.target
      const moves = t === document || t === document.documentElement || t === document.body || (t?.nodeType === 1 && t.contains(cur.el))
      if (moves) close(false)
    }
    // A real change of the screen's size (turning the phone) closes it; iOS also sends
    // resize events for its toolbars and the home bar settling, which don't move the field
    const onResize = () => {
      const cur = live.current
      if (!cur || cur.sheet) return
      const w = window.innerWidth
      const h = window.innerHeight
      if (!cur.size) cur.size = { w, h }
      if (Math.abs(w - cur.size.w) > 40 || Math.abs(h - cur.size.h) > 120) close(false)
    }
    const onBlurWindow = () => {
      const cur = live.current
      if (cur && !cur.sheet) close(false)
    }

    document.addEventListener("touchstart", onTouchStart, { capture: true, passive: true })
    document.addEventListener("touchmove", onTouchMove, { capture: true, passive: true })
    document.addEventListener("touchend", onTouchEnd, { capture: true, passive: false })
    document.addEventListener("touchcancel", onTouchCancel, true)
    document.addEventListener("mousedown", onMouseDown, true)
    document.addEventListener("pointerdown", onPointerDown, true)
    window.addEventListener("keydown", onKeyDown, true)
    document.addEventListener("focusin", onFocusIn, true)
    document.addEventListener("input", onInput, true)
    document.addEventListener("scroll", onScroll, true)
    window.addEventListener("resize", onResize)
    window.addEventListener("blur", onBlurWindow)
    return () => {
      document.removeEventListener("touchstart", onTouchStart, { capture: true })
      document.removeEventListener("touchmove", onTouchMove, { capture: true })
      document.removeEventListener("touchend", onTouchEnd, { capture: true })
      document.removeEventListener("touchcancel", onTouchCancel, true)
      document.removeEventListener("mousedown", onMouseDown, true)
      document.removeEventListener("pointerdown", onPointerDown, true)
      window.removeEventListener("keydown", onKeyDown, true)
      document.removeEventListener("focusin", onFocusIn, true)
      document.removeEventListener("input", onInput, true)
      document.removeEventListener("scroll", onScroll, true)
      window.removeEventListener("resize", onResize)
      window.removeEventListener("blur", onBlurWindow)
    }
  }, [close, openFor])

  // the field went away (its window closed or minimized, it was disabled), or moved (a
  // window dragged): close, or follow it
  useEffect(() => {
    if (!open) return
    const id = setInterval(() => {
      const cur = live.current
      if (!cur) return
      const el = cur.el
      if (!el.isConnected || !el.getClientRects().length || !pickerKind(el)) return close(false)
      if (cur.sheet) return
      const r = el.getBoundingClientRect()
      if (Math.abs(r.left - cur.rect.left) > 0.5 || Math.abs(r.top - cur.rect.top) > 0.5 || Math.abs(r.width - cur.rect.width) > 0.5) {
        const next = { ...cur, rect: r }
        live.current = next
        setOpen(next)
      }
    }, 200)
    return () => clearInterval(id)
  }, [open?.n, close])

  if (!open) return null
  const { el, kind, sheet, rect, via, n } = open
  const id = `sel-popup-${n}`
  const done = () => close(true)
  const picker =
    kind === "list" ? (
      <ListPicker key={n} id={id} el={el} sheet={sheet} via={via} keyRef={keyRef} onDone={done} />
    ) : (
      <DatePicker key={n} id={id} el={el} kind={kind} sheet={sheet} keyRef={keyRef} onDone={done} />
    )
  return createPortal(
    <Popup popupRef={popupRef} el={el} kind={kind} sheet={sheet} rect={rect} onCancel={done}>
      {picker}
    </Popup>,
    document.querySelector(".os-root") || document.body
  )
}

export default SelectHost
