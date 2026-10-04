import { getSettings } from "./settings"

// Control Panel > Mouse, for the whole desktop:
//   openOnDoubleClick(open)  props that open something on a double-click at the chosen
//                            Double-click speed (hooks/useMediaQuery.js useOpenGesture)
//   installMouseOptions()    Swap buttons (left-handed): the right button clicks and the
//                            left one opens menus. Installed once by A11yHost.jsx.

const lastClick = new WeakMap()
const opened = new WeakMap()

// Two clicks on the same thing within doubleClickMs (and nearly the same spot) open it.
// A double-click sent by a script (a test, a screen reader) still opens it directly.
export const openOnDoubleClick = (open) => ({
  onClickCapture: (e) => {
    if (e.button !== 0) return
    const el = e.currentTarget
    const ms = getSettings().doubleClickMs || 500
    const prev = lastClick.get(el)
    const now = e.timeStamp || performance.now()
    if (prev && now - prev.t <= ms && Math.abs(e.clientX - prev.x) < 6 && Math.abs(e.clientY - prev.y) < 6) {
      lastClick.delete(el)
      opened.set(el, performance.now())
      open(e)
    } else lastClick.set(el, { t: now, x: e.clientX, y: e.clientY })
  },
  onDoubleClick: (e) => {
    if (e.nativeEvent?.isTrusted) return
    const el = e.currentTarget
    if (performance.now() - (opened.get(el) || 0) < 1000) return
    open(e)
  },
})

const fire = (target, type, x, y, extra = {}) => {
  const init = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, view: window, button: 0, ...extra }
  const event = type.startsWith("pointer") ? new PointerEvent(type, { pointerId: 1, pointerType: "mouse", isPrimary: true, ...init }) : new MouseEvent(type, init)
  return target.dispatchEvent(event)
}

export const installMouseOptions = () => {
  const swapped = () => getSettings().swapButtons && !window.matchMedia?.("(pointer: coarse)").matches
  let lastRight = { t: 0, x: 0, y: 0 }

  // the right button: a left click (and a double-click when twice in time)
  const onContextMenu = (e) => {
    if (!swapped() || !e.isTrusted || e.button !== 2) return
    e.preventDefault()
    e.stopImmediatePropagation()
    const { clientX: x, clientY: y } = e
    const target = document.elementFromPoint(x, y) || e.target
    fire(target, "pointerdown", x, y, { buttons: 1 })
    fire(target, "mousedown", x, y, { buttons: 1, detail: 1 })
    if (target.focus && target.tabIndex >= 0) target.focus({ preventScroll: true })
    fire(target, "pointerup", x, y)
    fire(target, "mouseup", x, y, { detail: 1 })
    const now = performance.now()
    const double = now - lastRight.t <= (getSettings().doubleClickMs || 500) && Math.abs(x - lastRight.x) < 6 && Math.abs(y - lastRight.y) < 6
    fire(target, "click", x, y, { detail: double ? 2 : 1 })
    if (double) fire(target, "dblclick", x, y, { detail: 2 })
    lastRight = double ? { t: 0, x: 0, y: 0 } : { t: now, x, y }
  }
  // the left button: the right-click menu
  const onClick = (e) => {
    if (!swapped() || !e.isTrusted || e.button !== 0 || e.pointerType === "touch" || e.detail === 0) return
    e.preventDefault()
    e.stopImmediatePropagation()
    fire(e.target, "contextmenu", e.clientX, e.clientY, { button: 2 })
  }
  const onDouble = (e) => {
    if (swapped() && e.isTrusted && e.button === 0) {
      e.preventDefault()
      e.stopImmediatePropagation()
    }
  }
  window.addEventListener("contextmenu", onContextMenu, true)
  window.addEventListener("click", onClick, true)
  window.addEventListener("dblclick", onDouble, true)
  return () => {
    window.removeEventListener("contextmenu", onContextMenu, true)
    window.removeEventListener("click", onClick, true)
    window.removeEventListener("dblclick", onDouble, true)
  }
}
