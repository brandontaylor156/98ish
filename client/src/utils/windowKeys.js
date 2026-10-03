// Games that listen for keys on the whole page (so a shortcut works wherever the focus is
// inside them) must ignore keys meant for other windows: typing "d" in Notepad drew a card
// in Last Card, even with Last Card minimized.
//
// isKeyForWindow(el, e): true when the key event belongs to the window that holds `el`:
// the focus is inside that window, or nothing has the focus and that window is the active
// one. Never while the window is minimized (display: none).
export const isKeyForWindow = (el, e) => {
  const win = el?.closest?.(".window")
  if (!win) return true // not in a desktop window (a test page): nothing to guard
  if (!el.offsetParent && getComputedStyle(el).position !== "fixed") return false // minimized
  // (an event sent to window or document itself has no element target)
  const target = e.target instanceof Element ? e.target : null
  if (target && win.contains(target)) return true
  if (!target || target === document.body || target === document.documentElement) {
    const bar = win.querySelector(":scope > .title-bar")
    return !bar || !bar.classList.contains("inactive")
  }
  return false
}
