import { useCallback, useRef } from "react"
import { playSystemSound } from "../utils/systemSounds"

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

// how much of the title bar stays on screen when dragged off an edge
const KEEP = 60

// the screen above (or below) the taskbar
const screenArea = () => {
  const width = document.documentElement.clientWidth
  const height = window.innerHeight
  let top = 0
  let bottom = height
  const bar = document.querySelector(".taskbar")?.getBoundingClientRect()
  if (bar?.height && bar.width) {
    if (bar.top > height / 2) bottom = Math.min(bottom, Math.max(bar.top, height / 2))
    else top = Math.max(top, bar.bottom)
  }
  return { width, top, bottom }
}

const between = (value, low, high) => Math.max(low, Math.min(value, high))

// Title bar flash (and the default beep) when the window a modal dialog blocks is clicked
export const flashFloating = (el) => {
  if (!el) return
  playSystemSound("ding")
  setTimeout(() => el._floating?.activate()) // after the press has moved focus
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
  flashFloating(e.currentTarget.querySelector("[data-floating]"))
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
  let drag = null
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
  const onFocus = (e) => (lastFocus = e.target)
  el._floating = { activate }

  // write left/top so the box lands at pos, whatever its containing block is
  const place = () => {
    const r = el.getBoundingClientRect()
    if (!r.width && !r.height) return // hidden with its (minimized) window
    const ox = r.left - (parseFloat(el.style.left) || 0)
    const oy = r.top - (parseFloat(el.style.top) || 0)
    el.style.left = `${Math.round(pos.x - ox)}px`
    el.style.top = `${Math.round(pos.y - oy)}px`
  }

  // whole: keep the whole box on screen (on opening, and always on phones); otherwise
  // just enough of the title bar to grab it again, never under the taskbar
  const clamp = (p, whole) => {
    const { width, top, bottom } = screenArea()
    const w = el.offsetWidth
    const h = el.offsetHeight
    if (whole || mobile()) {
      return {
        x: between(p.x, 0, Math.max(0, width - w)),
        y: between(p.y, top, Math.max(top, bottom - h)),
      }
    }
    const bar = el.querySelector(":scope > .title-bar")?.offsetHeight || 20
    return {
      x: between(p.x, Math.min(0, KEEP - w), Math.max(0, width - KEEP)),
      y: between(p.y, top, Math.max(top, bottom - bar)),
    }
  }

  const init = () => {
    const laid = el.getBoundingClientRect()
    if (!laid.width && !laid.height) return false
    el.setAttribute("data-floating", "on")
    el.style.left = "0px"
    el.style.top = "0px"
    const w = el.offsetWidth
    const h = el.offsetHeight
    const start = center
      ? { x: laid.left + (laid.width - w) / 2, y: laid.top + (laid.height - h) / 2 }
      : { x: laid.left, y: laid.top }
    pos = clamp(start, true)
    place()
    return true
  }
  init()

  const ownBar = (target) => {
    const bar = target.closest?.(".title-bar")
    return bar && bar.parentElement === el && !target.closest(".title-bar-controls, button, input, select, textarea, a") ? bar : null
  }

  const onDown = (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return
    const bar = ownBar(e.target)
    if (!bar || (!pos && !init())) return
    e.preventDefault() // no text selection (and no mousedown for the window to drag on)
    setTimeout(activate) // after the press has moved focus
    drag = { id: e.pointerId, dx: e.clientX - pos.x, dy: e.clientY - pos.y, bar }
    try {
      bar.setPointerCapture(e.pointerId)
    } catch {
      // the pointer is already gone
    }
  }
  const onMove = (e) => {
    if (!drag || e.pointerId !== drag.id) return
    pos = clamp({ x: e.clientX - drag.dx, y: e.clientY - drag.dy }, false)
    place()
  }
  const onUp = (e) => {
    if (drag && e.pointerId === drag.id) drag = null
  }
  // the window's own Rnd drags by any .title-bar inside it: keep it off this one
  const shield = (e) => {
    if (e.target.closest?.(".title-bar")?.parentElement === el) e.stopPropagation()
  }

  el.addEventListener("focusin", onFocus)
  el.addEventListener("pointerdown", onDown)
  el.addEventListener("pointermove", onMove)
  el.addEventListener("pointerup", onUp)
  el.addEventListener("pointercancel", onUp)
  el.addEventListener("mousedown", shield)
  el.addEventListener("touchstart", shield, { passive: true })

  // opened while its window was minimized, grew, or the screen changed size
  const refit = () => {
    if (!pos) return void init()
    pos = clamp(pos, false)
    place()
  }
  const resized = new ResizeObserver(refit)
  resized.observe(el)
  window.addEventListener("resize", refit)

  // the window moved, maximized or came back: the dialog stays where it is on screen,
  // as an owned window does in Windows
  const box = el.closest(".desktopWindow")?.parentElement
  const moved = box && new MutationObserver(() => pos && place())
  moved?.observe(box, { attributes: true, attributeFilter: ["style", "class"] })

  return () => {
    el.removeEventListener("focusin", onFocus)
    el.removeEventListener("pointerdown", onDown)
    el.removeEventListener("pointermove", onMove)
    el.removeEventListener("pointerup", onUp)
    el.removeEventListener("pointercancel", onUp)
    el.removeEventListener("mousedown", shield)
    el.removeEventListener("touchstart", shield)
    resized.disconnect()
    moved?.disconnect()
    window.removeEventListener("resize", refit)
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
