import { useCallback, useRef } from "react"
import { playSystemSound } from "../utils/systemSounds"
import { INPUT_RESET } from "../utils/inputGuard"

// Lets a popup inside a window (a dialog, Find, a property sheet) float free like a
// Windows 98 child dialog: it opens where its CSS lays it out (dialogs: centered over
// their window), then turns position: fixed and drags by its own title bar anywhere on
// the screen, even outside its window.
//
// It stays in its window's DOM, so it stacks, hides and closes with the window, the
// right-click menu still finds its window, and app CSS (".pRoot .dialog...") still
// applies. A fixed box inside a desktop window is placed against the window's Rnd box
// (its transform makes it the containing block), which also lets it escape every
// overflow clip in the window; we measure that origin rather than assume it.
//
// Dragging (mouse, finger or pen): the popup follows the pointer through left/top, written
// once per animation frame from an origin measured when the press starts (a move reads no
// layout; browsers lay out a positioned box's move by itself). The box is always where
// left/top put it, so letting go changes nothing: no translate to commit and nothing to
// measure again (the old translate-then-commit release left the box somewhere other than
// where it was drawn on iPhones).
// The drag ends when the press ends, is cancelled (iOS taking the gesture over) or loses
// its capture, so it can never be left hanging. The grab point stays under the finger.
// On touch screens the title bar takes the whole gesture (no scrolling, zooming, text
// callout or long-press menu), a second finger can't take the drag over, and a press on
// the title bar doesn't put focus in a text field (that would raise the keyboard).
// Popups keep clear of the taskbar, the phone's safe areas and the 98ish keyboard.

// how much of the title bar stays on screen when dragged off an edge
const KEEP = 60

// the phone's safe areas (notch, rounded corners), read from CSS (again after turning)
let insets = null
const safeInsets = () => {
  if (insets) return insets
  const probe = document.createElement("div")
  probe.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) 0 env(safe-area-inset-left)"
  document.body.appendChild(probe)
  const s = getComputedStyle(probe)
  insets = { top: parseFloat(s.paddingTop) || 0, right: parseFloat(s.paddingRight) || 0, left: parseFloat(s.paddingLeft) || 0 }
  probe.remove()
  return insets
}
if (typeof window !== "undefined") window.addEventListener("orientationchange", () => (insets = null))

// the top of the 98ish phone keyboard while it is up (shared/keyboard), else null
const keyboardTop = () => {
  if (!document.documentElement.classList.contains("kb-open")) return null
  const r = document.querySelector(".kb98")?.getBoundingClientRect()
  return r?.height ? r.top : null
}

// The part of the page that's on screen, in the layout coordinates fixed boxes are placed
// in. The phone's own keyboard (Keyboard Properties > the phone's keyboard) and Safari's bars
// shrink only the visual viewport, so a box placed by innerHeight alone sat partly under
// them. (A pinch-zoomed page keeps the whole layout viewport: popups don't chase the zoom.)
export const visibleViewport = () => {
  const width = document.documentElement.clientWidth || window.innerWidth
  const height = window.innerHeight
  const vv = window.visualViewport
  if (vv && Math.abs(vv.scale - 1) < 0.02 && vv.height > 100) {
    const top = Math.max(0, vv.offsetTop)
    return { top, bottom: Math.min(height, top + vv.height), width }
  }
  return { top: 0, bottom: height, width }
}

// the screen above (or below) the taskbar, clear of the safe areas and the 98ish keyboard
const screenArea = () => {
  const view = visibleViewport()
  const width = view.width
  const height = view.bottom
  const safe = safeInsets()
  let top = Math.max(view.top, safe.top)
  let bottom = height
  const bar = document.querySelector(".taskbar")?.getBoundingClientRect()
  if (bar?.height && bar.width) {
    if (bar.top > height / 2) bottom = Math.min(bottom, Math.max(bar.top, height / 2))
    else top = Math.max(top, bar.bottom)
  }
  const kb = keyboardTop()
  if (kb != null) bottom = Math.min(bottom, Math.max(kb, top + 60))
  return { left: safe.left, right: width - safe.right, top, bottom, keyboard: kb != null }
}

const between = (value, low, high) => Math.max(low, Math.min(value, high))

// For checking drags on a real phone: open 98ish with ?dragdebug=1 (remembered on that
// browser; ?dragdebug=0 turns it off) and a few lines at the top of the screen tell where
// each popup was drawn just before the finger lifted, right after, and 300 ms later, and
// anything else that moved it
const DEBUG_KEY = "98ish.dragDebug"
let debugLines = null
try {
  const q = new URLSearchParams(location.search).get("dragdebug")
  if (q === "0") localStorage.removeItem(DEBUG_KEY)
  else if (q !== null) localStorage.setItem(DEBUG_KEY, "1")
  if (localStorage.getItem(DEBUG_KEY)) debugLines = []
} catch {
  // no window (unit tests) or no storage
}
const corner = (el) => {
  const r = el.getBoundingClientRect()
  return `${r.left.toFixed(1)},${r.top.toFixed(1)}`
}
const debugLog = (line) => {
  debugLines.push(line)
  if (debugLines.length > 12) debugLines.shift()
  let pre = document.getElementById("dragDebug")
  if (!pre) {
    pre = document.createElement("pre")
    pre.id = "dragDebug"
    pre.style.cssText = "position:fixed;left:0;right:0;top:env(safe-area-inset-top);z-index:2147483647;margin:0;padding:2px 4px;font:10px/1.3 monospace;background:#ffffe1e8;color:#000;pointer-events:none;white-space:pre-wrap"
    document.body.appendChild(pre)
  }
  pre.textContent = debugLines.join("\n")
}
// a drag that just ended: drawn before the release, right after, then 300 ms later
const debugEnd = (el, before, how) => {
  const vv = window.visualViewport
  const now = corner(el)
  setTimeout(() => debugLog(`${how}: ${before} -> ${now} -> ${corner(el)} (vv ${vv ? `${vv.offsetLeft.toFixed(0)},${vv.offsetTop.toFixed(0)} x${vv.scale.toFixed(2)} h${vv.height.toFixed(0)}` : "-"} ih${innerHeight})`), 300)
}

// Title bar flash (and the default beep) when the window a modal dialog blocks is clicked.
// focus: put the keyboard back in the popup (not after a finger's tap: on a phone that
// would raise the on-screen keyboard)
export const flashFloating = (el, { focus = true } = {}) => {
  if (!el) return
  playSystemSound("ding")
  if (focus) setTimeout(() => el._floating?.activate()) // after the press has moved focus
  el.removeAttribute("data-flashing")
  void el.offsetWidth // restart the animation
  el.setAttribute("data-flashing", "")
  clearTimeout(el._flashTimer)
  el._flashTimer = setTimeout(() => el.removeAttribute("data-flashing"), 700)
}

// onPointerDown for a modal popup's backdrop: a press on the backdrop itself (the blocked
// window) flashes the popup inside it, and leaves the keyboard in the popup
export const flashOnBackdrop = (e) => {
  if (e.target !== e.currentTarget) return
  e.preventDefault()
  flashFloating(e.currentTarget.querySelector("[data-floating]"), { focus: e.pointerType !== "touch" })
}

// Something inside the window between the popup and its window that would become the
// fixed box's containing block (a transform, a filter...) and could clip it: then the
// popup stays where its app put it, as before.
const trapped = (el) => {
  const stop = el.closest(".desktopWindow, .mobileWindow, .os-root")
  for (let node = el.parentElement; node && node !== stop; node = node.parentElement) {
    const s = getComputedStyle(node)
    if (s.transform !== "none" || s.filter !== "none" || s.perspective !== "none" || (s.backdropFilter && s.backdropFilter !== "none")) return true
    if (/paint|layout|strict|content/.test(s.contain) || /transform|filter|perspective/.test(s.willChange)) return true
    if (/size/.test(s.containerType)) return true // container queries contain layout too
  }
  return false
}

const FOCUSABLE = "input:not(:disabled):not([type=hidden]), select:not(:disabled), textarea:not(:disabled), button:not(:disabled), a[href], [tabindex]:not([tabindex='-1'])"

// Sets up `el`; returns the cleanup. center: keep the laid-out box's center rather than
// its top-left corner when the floating box comes out a different size. takeFocus: a
// press on its title bar (or a flash) puts the keyboard back in it, where it last was,
// as activating a dialog does in Windows (off for toolbars such as Paint's Fonts).
export const attachFloating = (el, { center = false, takeFocus = true } = {}) => {
  let pos = null // the box's top-left corner on screen
  let drag = null // { id, dx, dy, bar, touch, fit: the screen and box sizes for clamp }
  let frame = 0
  let lastFocus = null
  const mobile = () => !!el.closest(".os-mobile")
  el.setAttribute("data-floating", "")
  if (trapped(el)) return () => {}

  const activate = () => {
    if (!takeFocus || el.contains(document.activeElement)) return
    const target =
      lastFocus?.isConnected && el.contains(lastFocus)
        ? lastFocus
        : [...el.querySelectorAll(FOCUSABLE)].find((f) => !f.closest(".title-bar") && (f.offsetWidth || f.offsetHeight))
    target?.focus({ preventScroll: true })
  }
  // the focused field stays in view in a dialog that scrolls (a short screen, the keyboard
  // up), clear of the buttons kept at its bottom (shared.css)
  const revealFocus = () => {
    const f = document.activeElement
    if (!f || f === el || !el.contains(f)) return
    const body = f.closest(".dialogBody")
    if (!body || !el.contains(body) || body.scrollHeight <= body.clientHeight + 1) return
    const b = body.getBoundingClientRect()
    const r = f.getBoundingClientRect()
    const sticky = body.querySelector(":scope > .dialogButtons")
    const bottom = b.bottom - (sticky && !sticky.contains(f) ? sticky.offsetHeight : 0) - 4
    if (r.bottom > bottom) body.scrollTop += r.bottom - bottom
    else if (r.top < b.top + 4) body.scrollTop -= b.top + 4 - r.top
  }
  const onFocus = (e) => {
    lastFocus = e.target
    requestAnimationFrame(revealFocus)
  }
  el._floating = { activate }

  // where left/top 0 put the box's corner on screen (its containing block's corner),
  // measured from the box as it is drawn now; returns that box (null while it's hidden)
  let origin = { x: 0, y: 0 }
  const measure = () => {
    const r = el.getBoundingClientRect()
    if (!r.width && !r.height) return null // hidden with its (minimized) window
    origin = { x: r.left - (parseFloat(el.style.left) || 0), y: r.top - (parseFloat(el.style.top) || 0) }
    return r
  }
  // left/top for pos from the last measured origin, on whole device pixels (crisp edges)
  const write = () => {
    const dpr = window.devicePixelRatio || 1
    el.style.left = `${Math.round((pos.x - origin.x) * dpr) / dpr}px`
    el.style.top = `${Math.round((pos.y - origin.y) * dpr) / dpr}px`
  }

  // put the box at pos, whatever its containing block is (measured again: the window may
  // have moved). A translate left by older code or a keyboard lift is dropped first.
  const place = () => {
    cancelAnimationFrame(frame)
    frame = 0
    if (el.style.translate) el.style.translate = ""
    if (measure()) write()
  }

  // during a drag: move the box to pos, once per frame. Only left/top change (the origin
  // was measured when the drag started), which browsers lay out as a move of this one box.
  const show = (last = false) => {
    cancelAnimationFrame(frame)
    frame = 0
    if (drag || last) write()
  }

  // what clamp needs to know about the screen and the box (fixed for the whole of a drag,
  // so a move reads no layout)
  const fit = () => ({ area: screenArea(), w: el.offsetWidth, h: el.offsetHeight, bar: el.querySelector(":scope > .title-bar")?.offsetHeight || 20 })

  // whole: keep the whole box on screen (on opening, always on phones, and above the
  // 98ish keyboard); otherwise just enough of the title bar to grab it again, never under
  // the taskbar
  const clamp = (p, whole, { area, w, h, bar } = fit()) => {
    const { left, right, top, bottom, keyboard } = area
    if (whole || keyboard || mobile()) {
      return {
        x: between(p.x, left, Math.max(left, right - w)),
        y: between(p.y, top, Math.max(top, bottom - h)),
      }
    }
    return {
      x: between(p.x, Math.min(left, left + KEEP - w), Math.max(left, right - KEEP)),
      y: between(p.y, top, Math.max(top, bottom - bar)),
    }
  }

  // Never taller or wider than the free screen (above the taskbar and any keyboard): a tall
  // dialog scrolls inside instead of running under the keyboard with its buttons out of
  // reach (WordPad's Save As in landscape). Dialogs everywhere; every popup on a phone.
  const sizeTo = (area) => {
    if (!mobile() && !el.classList.contains("dialog")) return
    const h = `${Math.max(80, Math.floor(area.bottom - area.top))}px`
    const w = `${Math.max(120, Math.floor(area.right - area.left))}px`
    if (el.style.maxHeight !== h) el.style.maxHeight = h
    if (el.style.maxWidth !== w) el.style.maxWidth = w
  }

  // Centered popups (dialogs) open in the middle of what you can see of their window: the
  // part of it on screen, above the taskbar and the keyboard (on a phone, the free screen).
  // They stay centered as they grow, shrink, the keyboard comes and goes or the phone turns,
  // until you drag one: then it stays where you put it. (A dialog used to keep its top-left
  // corner when its content arrived after it opened, so it grew toward the bottom right.)
  let moved = false
  const centered = (area, w, h) => {
    let { left, right, top, bottom } = area
    const r = !mobile() && el.parentElement?.getBoundingClientRect()
    if (r && r.width && r.height) {
      const l2 = Math.max(left, r.left)
      const r2 = Math.min(right, r.right)
      const t2 = Math.max(top, r.top)
      const b2 = Math.min(bottom, r.bottom)
      if (r2 - l2 > 40 && b2 - t2 > 40) [left, right, top, bottom] = [l2, r2, t2, b2]
    }
    return { x: (left + right - w) / 2, y: (top + bottom - h) / 2 }
  }

  const init = () => {
    const laid = el.getBoundingClientRect()
    if (!laid.width && !laid.height) return false
    el.setAttribute("data-floating", "on")
    el.style.left = "0px"
    el.style.top = "0px"
    const area = screenArea()
    sizeTo(area)
    const w = el.offsetWidth
    const h = el.offsetHeight
    const start = center ? centered(area, w, h) : { x: laid.left, y: laid.top }
    pos = clamp(start, true, { area, w, h, bar: 20 })
    place()
    return true
  }
  init()

  const ownBar = (target) => {
    const bar = target.closest?.(".title-bar")
    return bar && bar.parentElement === el && !target.closest(".title-bar-controls, button, input, select, textarea, a") ? bar : null
  }

  // the drag ends where it is: the box already sits there by left/top, so nothing is
  // measured or moved again (only a move that came after the last frame is drawn now)
  const end = (how) => {
    if (!drag) return
    const before = debugLines && corner(el)
    drag = null
    if (frame) show(true)
    if (debugLines) debugEnd(el, before, how)
  }

  const onDown = (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return
    const bar = ownBar(e.target)
    if (!bar) return
    if (drag) {
      // a second finger on the title bar doesn't take the drag over (or make it jump)
      if (drag.touch && drag.bar.isConnected && drag.bar.hasPointerCapture?.(drag.id)) return void e.preventDefault()
      end("new press")
    }
    if (!pos && !init()) return
    e.preventDefault() // no text selection (and no mousedown for the window to drag on)
    try {
      bar.setPointerCapture(e.pointerId)
    } catch {
      return // the pointer is already gone
    }
    // a finger's press doesn't focus a text field: on a phone that raises the keyboard
    if (e.pointerType === "mouse") setTimeout(activate) // after the press has moved focus
    // start from the box as it is drawn now (and where its containing block is), not from
    // where it was last put, so nothing that moved it since can make it jump
    cancelAnimationFrame(frame)
    frame = 0
    const r = measure()
    if (r) pos = { x: r.left, y: r.top }
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: e.clientX - pos.x, dy: e.clientY - pos.y, bar, touch: e.pointerType !== "mouse", fit: fit() }
  }
  const onMove = (e) => {
    if (!drag || e.pointerId !== drag.id) return
    // (a press that hardly moves doesn't count as placing it)
    if (!moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 4) moved = true
    pos = clamp({ x: e.clientX - drag.dx, y: e.clientY - drag.dy }, false, drag.fit)
    if (!frame) frame = requestAnimationFrame(() => show())
  }
  // up, cancel (iOS deciding the gesture is its own), or the capture lost: end in place
  const onUp = (e) => {
    if (drag && e.pointerId === drag.id) end(e.type)
  }
  // the window's own Rnd drags by any .title-bar inside it: keep it off this one
  const shield = (e) => {
    if (e.target.closest?.(".title-bar")?.parentElement === el) e.stopPropagation()
  }
  // touch: the title bar takes the gesture: no page scroll or rubber-band, no double-tap
  // zoom, no text callout (iOS can turn a gesture into a scroll despite touch-action)
  const onTouchStart = (e) => {
    shield(e)
    if (e.cancelable && ownBar(e.target)) e.preventDefault()
  }
  const onTouchMove = (e) => {
    if (drag && e.cancelable) e.preventDefault()
  }
  // a long press on the title bar is the start of a drag, not a right-click
  const onMenu = (e) => {
    if (drag?.touch && ownBar(e.target)) {
      e.preventDefault()
      e.stopPropagation()
    }
  }

  el.addEventListener("focusin", onFocus)
  el.addEventListener("pointerdown", onDown)
  el.addEventListener("pointermove", onMove)
  el.addEventListener("pointerup", onUp)
  el.addEventListener("pointercancel", onUp)
  el.addEventListener("lostpointercapture", onUp)
  el.addEventListener("mousedown", shield)
  el.addEventListener("touchstart", onTouchStart, { passive: false })
  el.addEventListener("touchmove", onTouchMove, { passive: false })
  el.addEventListener("contextmenu", onMenu)

  // opened while its window was minimized, grew, the screen changed size, or the 98ish
  // keyboard came up (html.kb-open, --kb-h)
  const refit = (why) => {
    if (debugLines && pos) debugLog(`refit (${why?.type || (Array.isArray(why) ? "observer" : "?")}${drag ? ", dragging" : ""}) at ${corner(el)}`)
    if (!pos) return void init()
    const area = screenArea()
    sizeTo(area)
    if (drag) drag.fit = fit()
    if (center && !moved && !drag) {
      // still where it opened: keep it in the middle
      const w = el.offsetWidth
      const h = el.offsetHeight
      if (!w && !h) return // hidden with its window
      pos = clamp(centered(area, w, h), true, { area, w, h, bar: 20 })
    } else pos = clamp(pos, false, drag?.fit)
    place()
    if (!drag) requestAnimationFrame(revealFocus)
  }
  const resized = new ResizeObserver(refit)
  resized.observe(el)
  window.addEventListener("resize", refit)
  const keyboard = new MutationObserver(refit)
  keyboard.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] })
  // the phone's keyboard or Safari's bars (the visual viewport), turning the phone (iOS
  // reports the new size a moment late), coming back from the background, or the shell's
  // input reset (utils/inputGuard.js): a drag left hanging ends, and the box is put back on
  // screen
  const vv = window.visualViewport
  vv?.addEventListener("resize", refit)
  vv?.addEventListener("scroll", refit)
  let later = 0
  const settle = (e) => {
    if (e?.type === "visibilitychange" && document.visibilityState !== "visible") return void end("hidden")
    end(e?.type || "reset")
    refit(e)
    clearTimeout(later)
    later = setTimeout(() => refit(e), 350)
  }
  window.addEventListener("orientationchange", settle)
  document.addEventListener("visibilitychange", settle)
  window.addEventListener(INPUT_RESET, settle)

  // the window moved, maximized or came back: the dialog stays where it is on screen,
  // as an owned window does in Windows
  const box = el.closest(".desktopWindow")?.parentElement
  const windowMoved = box && new MutationObserver(() => pos && place())
  windowMoved?.observe(box, { attributes: true, attributeFilter: ["style", "class"] })
  el._floating.refit = refit

  return () => {
    el.removeEventListener("focusin", onFocus)
    el.removeEventListener("pointerdown", onDown)
    el.removeEventListener("pointermove", onMove)
    el.removeEventListener("pointerup", onUp)
    el.removeEventListener("pointercancel", onUp)
    el.removeEventListener("lostpointercapture", onUp)
    el.removeEventListener("mousedown", shield)
    el.removeEventListener("touchstart", onTouchStart)
    el.removeEventListener("touchmove", onTouchMove)
    el.removeEventListener("contextmenu", onMenu)
    resized.disconnect()
    keyboard.disconnect()
    windowMoved?.disconnect()
    window.removeEventListener("resize", refit)
    vv?.removeEventListener("resize", refit)
    vv?.removeEventListener("scroll", refit)
    window.removeEventListener("orientationchange", settle)
    document.removeEventListener("visibilitychange", settle)
    window.removeEventListener(INPUT_RESET, settle)
    clearTimeout(later)
    cancelAnimationFrame(frame)
    drag = null
    clearTimeout(el._flashTimer)
    delete el._floating
  }
}

// A stable callback ref that makes its element float (see attachFloating). Pass `also`
// to keep a ref object of your own pointed at the element.
export const useFloating = ({ center = false, takeFocus = true, also } = {}) => {
  const options = useRef(null)
  options.current = { center, takeFocus, also }
  return useCallback((el) => {
    const { also: mine, ...rest } = options.current
    if (mine) mine.current = el
    if (!el) return
    const cleanup = attachFloating(el, rest)
    return () => {
      cleanup()
      if (mine) mine.current = null
    }
  }, [])
}
