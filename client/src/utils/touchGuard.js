// No phone "hold" menus where they don't belong.
//
// On an iPhone, holding a finger on the page brings up the phone's own things: the text
// loupe and selection handles with Copy / Look Up / Share, and for pictures and links a
// preview with Save / Share. In 98ish they are off by default (CSS in main.css: every
// element is `user-select: none` + `-webkit-touch-callout: none`) and on only where people
// read or type:
//   - text boxes: input, textarea, contenteditable (automatic)
//   - areas marked `data-selectable` (or class `selectable`): Mail and Help text, contact
//     details, event notes...; a dialog's paragraphs (`.dialogBody p`: error and notice
//     words) are allowed too. `data-selectable="mouse"` selects with a
//     mouse only (Messenger's transcript: holding a message on a phone opens reactions,
//     whose box has Copy); `data-selectable="false"` turns it off again inside one.
//
// CSS alone isn't enough everywhere, so this adds (installTouchGuard, once, from main.jsx):
//   - touch surfaces (game canvases, touch controls, Tetris while swiping... anything with
//     `data-touch-surface`): their touchstart is cancelled. Since iOS 18 a tap followed by a
//     hold shows the loupe even over `user-select: none` (WebKit bug 296492), and only a
//     cancelled touchstart stops it. Pointer events still arrive, so games that read
//     pointerdown/up keep working; `click` does NOT, so mark only elements driven by pointer
//     events, and never on something that scrolls by dragging (a cancelled touchstart
//     can't scroll: Minesweeper's big boards scroll, so they rely on the CSS alone).
//     Buttons, links and fields inside a surface are left alone.
//   - contextmenu from a finger (Android fires it on a long press): 98ish's own menus
//     (GlobalMenu and the apps' onContextMenu) still run and cancel it as before. If a
//     handler stops the event without cancelling it, the phone's menu is cancelled anyway.
//   - selectstart: cancelled where the CSS says no selection (some WebViews ignore it).
//   - dragstart on pictures: a picture never drags out as a file (unless draggable="true").
// Opting an area in or out never needs this file: use the attributes above.

// (Pickleball's court and locker-room turntable are listed here rather than marked in its
// files, which are being reworked)
export const SURFACE_SELECTOR = "[data-touch-surface], .tcZone, .tcButton, .pkCanvas, .pkLockerTurn"
// reading areas main.css allows besides [data-selectable] (keep the two in step)
export const READING_SELECTOR = ".selectable, .dialogBody p"

const TEXT_INPUT = /^(text|search|email|url|tel|password|number|date|time|datetime-local|month|week|)$/i
const INTERACTIVE = new Set(["BUTTON", "A", "INPUT", "SELECT", "TEXTAREA", "LABEL", "SUMMARY", "OPTION", "VIDEO", "AUDIO"])

const elementOf = (node) => (node && node.nodeType === 3 ? node.parentElement : node) || null

// a field you type in (where the phone's own copy/paste menu belongs)
export const isEditable = (el) => {
  el = elementOf(el)
  if (!el || !el.tagName) return false
  if (el.tagName === "TEXTAREA") return true
  if (el.tagName === "INPUT") return TEXT_INPUT.test(el.getAttribute?.("type") || "")
  return !!el.isContentEditable
}

// What the page allows at `el` for a finger (touch) or a mouse: "edit" (a field),
// "select" (an opted-in reading area) or "none".
export const nativeAt = (el, { touch = true } = {}) => {
  for (let n = elementOf(el); n && n.tagName; n = n.parentElement) {
    if (isEditable(n)) return "edit"
    const sel = n.getAttribute?.("data-selectable")
    if (sel === "false") return "none"
    if (sel === "mouse") return touch ? "none" : "select"
    if (sel !== null && sel !== undefined) return "select"
    if (n.matches?.(READING_SELECTOR)) return "select"
  }
  return "none"
}

// Is `el` on a touch surface (and not on a button/link/field inside it)?
export const onTouchSurface = (el) => {
  for (let n = elementOf(el); n && n.tagName; n = n.parentElement) {
    if (n.matches?.(SURFACE_SELECTOR)) return true
    if (INTERACTIVE.has(n.tagName) || n.isContentEditable) return false
  }
  return false
}

let installed = false

export const installTouchGuard = (doc = globalThis.document, win = globalThis.window) => {
  if (installed || !doc || !win) return
  installed = true
  let lastPointer = { type: "mouse", at: 0 }
  const fromFinger = (e) => {
    const type = e.pointerType || (performance.now() - lastPointer.at < 1500 ? lastPointer.type : "mouse")
    return type === "touch" || type === "pen"
  }

  win.addEventListener("pointerdown", (e) => (lastPointer = { type: e.pointerType, at: performance.now() }), { capture: true, passive: true })

  doc.addEventListener(
    "touchstart",
    (e) => {
      if (e.cancelable && onTouchSurface(e.target)) e.preventDefault()
    },
    { capture: true, passive: false }
  )

  win.addEventListener(
    "contextmenu",
    (e) => {
      if (!fromFinger(e) || nativeAt(e.target) !== "none") return
      // 98ish's handlers decide (and cancel it); one that only stops the event cancels it too
      for (const name of ["stopPropagation", "stopImmediatePropagation"]) {
        const stop = e[name].bind(e)
        e[name] = () => {
          e.preventDefault()
          stop()
        }
      }
    },
    true
  )

  doc.addEventListener(
    "selectstart",
    (e) => {
      const el = elementOf(e.target)
      if (!el || isEditable(el)) return
      const style = win.getComputedStyle?.(el)
      if (style && (style.webkitUserSelect || style.userSelect) === "none") e.preventDefault()
    },
    true
  )

  doc.addEventListener(
    "dragstart",
    (e) => {
      const el = elementOf(e.target)
      if (el?.tagName === "IMG" && el.getAttribute("draggable") !== "true") e.preventDefault()
    },
    true
  )
}
