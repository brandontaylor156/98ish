import React, { useEffect, useLayoutEffect, useRef, useState } from "react"
import "./shared.css"

// A Windows 98 right-click menu at (x, y) in viewport coordinates. items:
// [{ label, onClick, disabled, bold, checked, items: [...submenu] } | "-"]
// Closes on Escape, on a press outside it, or after choosing something. Stays on screen.
const Menu = ({ items, x, y, onClose, depth = 0 }) => {
  const ref = useRef(null)
  const [pos, setPos] = useState({ x, y })
  const [open, setOpen] = useState(null) // index of the open submenu

  useLayoutEffect(() => {
    const el = ref.current
    const w = el.offsetWidth
    const h = el.offsetHeight
    const vw = document.documentElement.clientWidth
    const vh = window.innerHeight
    setPos({ x: Math.max(2, Math.min(x, vw - w - 2)), y: Math.max(2, Math.min(y, vh - h - 2)) })
  }, [x, y])

  return (
    <ul className="window menu contextMenu" ref={ref} style={{ left: pos.x, top: pos.y, zIndex: 100000000 + depth }} role="menu">
      {items.map((item, i) =>
        item === "-" ? (
          <li key={i} className="menuSep" role="separator" />
        ) : (
          <li key={item.label} onMouseEnter={() => setOpen(item.items ? i : null)} style={{ position: "relative" }}>
            <button
              type="button"
              role="menuitem"
              disabled={item.disabled}
              className={item.bold ? "is-default" : undefined}
              onClick={(e) => {
                if (item.items) {
                  setOpen(open === i ? null : i)
                  return
                }
                onClose()
                item.onClick?.(e)
              }}
            >
              <span className="menuCheck">{item.checked ? "✓" : ""}</span>
              <span className="menuLabel">{item.label}</span>
              {item.items && <span className="menuArrow">&#9654;</span>}
            </button>
            {open === i && item.items && (
              <SubMenu parentRef={ref} index={i} items={item.items} onClose={onClose} depth={depth + 1} />
            )}
          </li>
        )
      )}
    </ul>
  )
}

const SubMenu = ({ parentRef, index, items, onClose, depth }) => {
  const parent = parentRef.current
  const row = parent?.children[index]?.getBoundingClientRect()
  const box = parent?.getBoundingClientRect()
  if (!row || !box) return null
  const roomRight = document.documentElement.clientWidth - box.right
  return <Menu items={items} x={roomRight > 160 ? box.right - 3 : Math.max(2, box.left - 180)} y={row.top - 3} onClose={onClose} depth={depth} />
}

const ContextMenu = ({ items, x, y, onClose }) => {
  const ref = useRef(null)

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

  return (
    <div ref={ref} className="contextMenuLayer" onContextMenu={(e) => e.preventDefault()}>
      <Menu items={items} x={x} y={y} onClose={onClose} />
    </div>
  )
}

export default ContextMenu
