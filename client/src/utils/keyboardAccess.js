// Keyboard access for the whole desktop (installed once by OS-specific/A11yHost.jsx):
//   Shift+F10 or the Menu key  opens the right-click menu of the focused item, as in Windows
//   keyboardUser()             true when the last thing used was the keyboard (menus then
//                              highlight their first item for you)
// The other shortcuts live where their state is: Ctrl+Esc, Alt+Q and Alt+F4 in TaskBar.jsx,
// arrow keys in StartMenu.jsx and ContextMenu.jsx.

let lastSynthetic = 0
let keyboardLast = false

export const keyboardUser = () => keyboardLast

// where a menu for this element should appear: near its top left, inside it
const menuPoint = (el) => {
  const r = el.getBoundingClientRect()
  return { x: Math.round(r.left + Math.min(r.width / 2, 24)), y: Math.round(r.top + Math.min(r.height / 2, 18)) }
}

export const openMenuFor = (el) => {
  if (!el) return false
  const { x, y } = menuPoint(el)
  lastSynthetic = performance.now()
  return !el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 2, buttons: 0, view: window }))
}

export const installKeyboardAccess = () => {
  const onKey = (e) => {
    keyboardLast = true
    const menuKey = e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey)
    if (!menuKey) return
    const active = document.activeElement
    const el = active && active !== document.body && active !== document.documentElement ? active : document.querySelector(".desktopIconInner.is-selected")
    if (!el) return
    e.preventDefault()
    e.stopPropagation()
    openMenuFor(el)
  }
  // the browser's own contextmenu for the Menu key (it comes on key up) would open a
  // second menu: drop it
  const onNative = (e) => {
    if (e.isTrusted && e.button !== 2 && performance.now() - lastSynthetic < 800) {
      e.preventDefault()
      e.stopImmediatePropagation()
    }
  }
  const onPointer = () => {
    keyboardLast = false
  }
  window.addEventListener("keydown", onKey, true)
  window.addEventListener("contextmenu", onNative, true)
  window.addEventListener("pointerdown", onPointer, true)
  return () => {
    window.removeEventListener("keydown", onKey, true)
    window.removeEventListener("contextmenu", onNative, true)
    window.removeEventListener("pointerdown", onPointer, true)
  }
}
