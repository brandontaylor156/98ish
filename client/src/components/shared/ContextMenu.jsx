import React, { useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { keyboardUser } from "../../utils/keyboardAccess"
import "./shared.css"

// A Windows 98 right-click menu at (x, y) in viewport coordinates. items:
// [{ label, onClick, disabled, bold, checked, items: [...submenu] } | "-"]
// Closes on Escape, on a press outside it, or after choosing something. Stays on screen.
// Keys: Up/Down move, Right opens a submenu, Left closes it, Enter chooses; opened from the
// keyboard (Shift+F10, the Menu key) the first item is highlighted.
const buttonsOf = (ul) => [...(ul?.children || [])].map((li) => li.querySelector(":scope > button")).filter((b) => b && !b.disabled)

const Menu = ({ items, x, y, flipX = null, onClose, onBack, focusFirst = false, depth = 0 }) => {
  const ref = useRef(null)
  const [pos, setPos] = useState({ x, y })
  const [focusSub, setFocusSub] = useState(false)
  useEffect(() => {
    if (focusFirst) buttonsOf(ref.current)[0]?.focus({ preventScroll: true })
  }, [])

  const onKeyDown = (e) => {
    const all = buttonsOf(ref.current)
    const at = all.indexOf(document.activeElement)
    const move = { ArrowDown: 1, ArrowUp: -1 }[e.key]
    if (move) {
      e.preventDefault()
      e.stopPropagation()
      all[(at + move + all.length) % all.length]?.focus({ preventScroll: true })
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault()
      e.stopPropagation()
      ;(e.key === "Home" ? all[0] : all.at(-1))?.focus({ preventScroll: true })
    } else if (e.key === "ArrowRight" && at >= 0) {
      const i = [...ref.current.children].indexOf(all[at].parentElement)
      if (!items[i]?.items) return
      e.preventDefault()
      e.stopPropagation()
      setFocusSub(true)
      setOpen(i)
    } else if (e.key === "ArrowLeft" && onBack) {
      e.preventDefault()
      e.stopPropagation()
      onBack()
    }
  }
  const [open, setOpen] = useState(null) // index of the open submenu
  // passing over other items on the way to a submenu shouldn't close it: wait a moment
  const closing = useRef(null)
  useEffect(() => () => clearTimeout(closing.current), [])
  const hover = (item, i) => {
    clearTimeout(closing.current)
    if (item.items) setFocusSub(false), setOpen(i)
    else if (open !== null) closing.current = setTimeout(() => setOpen(null), 350)
  }

  useLayoutEffect(() => {
    const el = ref.current
    const w = el.offsetWidth
    const h = el.offsetHeight
    const vw = document.documentElement.clientWidth
    const vh = window.innerHeight
    // a submenu that doesn't fit on the right opens flush against the left of its parent
    // (by its own width, so there's never a gap between them)
    const left = flipX != null && x + w > vw - 2 ? flipX - w : x
    setPos({ x: Math.max(2, Math.min(left, vw - w - 2)), y: Math.max(2, Math.min(y, vh - h - 2)) })
  }, [x, y, flipX])

  return (
    <ul className="window menu contextMenu" ref={ref} style={{ left: pos.x, top: pos.y, zIndex: 100000000 + depth }} role="menu" onKeyDown={onKeyDown}>
      {items.map((item, i) =>
        item === "-" ? (
          <li key={i} className="menuSep" role="separator" />
        ) : (
          <li key={item.label} onMouseEnter={() => hover(item, i)} style={{ position: "relative" }}>
            <button
              type="button"
              role="menuitem"
              disabled={item.disabled}
              className={item.bold ? "is-default" : undefined}
              onClick={(e) => {
                if (item.items) {
                  clearTimeout(closing.current)
                  setOpen(i)
                  return
                }
                onClose()
                item.onClick?.(e)
              }}
            >
              <span className="menuCheck">{item.checked ? "✓" : ""}</span>
              <span className="menuLabel">{item.label}</span>
              {item.items && <span className="menuArrow">&#9654;&#xFE0E;</span>}
            </button>
            {open === i && item.items && (
              <SubMenu parentRef={ref} index={i} items={item.items} onClose={onClose} depth={depth + 1} focusFirst={focusSub} onBack={() => (setOpen(null), setFocusSub(false), buttonsOf(ref.current).find((b) => b.parentElement === ref.current.children[i])?.focus({ preventScroll: true }))} />
            )}
          </li>
        )
      )}
    </ul>
  )
}

const SubMenu = ({ parentRef, index, items, onClose, depth, focusFirst, onBack }) => {
  const parent = parentRef.current
  const row = parent?.children[index]?.getBoundingClientRect()
  const box = parent?.getBoundingClientRect()
  if (!row || !box) return null
  return <Menu items={items} x={box.right - 3} flipX={box.left + 3} y={row.top - 3} onClose={onClose} depth={depth} focusFirst={focusFirst} onBack={onBack} />
}

const ContextMenu = ({ items, x, y, onClose }) => {
  const ref = useRef(null)
  // opened from the keyboard: highlight the first item, and give the focus back after
  const [fromKeys] = useState(keyboardUser)
  const opener = useRef(typeof document === "undefined" ? null : document.activeElement)
  useEffect(
    () => () => {
      const now = document.activeElement
      if (fromKeys && (!now || now === document.body || !now.isConnected) && opener.current?.isConnected) opener.current.focus({ preventScroll: true })
    },
    []
  )

  useEffect(() => {
    const onDown = (e) => {
      if (!ref.current?.contains(e.target)) onClose()
    }
    const onKey = (e) => e.key === "Escape" && onClose()
    // after the press that opened it
    const id = setTimeout(() => {
      document.addEventListener("pointerdown", onDown, true)
      document.addEventListener("keydown", onKey, true)
    }, 0)
    return () => {
      clearTimeout(id)
      document.removeEventListener("pointerdown", onDown, true)
      document.removeEventListener("keydown", onKey, true)
    }
  }, [onClose])

  // drawn at the desktop level: inside a window (which is moved with a transform) fixed
  // positions would be measured from the window instead of the screen
  const layer = (
    <div ref={ref} className="contextMenuLayer" onContextMenu={(e) => e.preventDefault()}>
      <Menu items={items} x={x} y={y} onClose={onClose} focusFirst={fromKeys} />
    </div>
  )
  return createPortal(layer, document.querySelector(".os-root") || document.body)
}

export default ContextMenu
