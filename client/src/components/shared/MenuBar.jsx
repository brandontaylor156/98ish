import React, { useEffect, useRef, useState } from "react"
import "./shared.css"

// "Undo Ctrl+Z": the shortcut goes in its own column on the right, as in Windows
const SHORTCUT = /^(.*\S)\s+((?:Ctrl|Alt|Shift|Shft)\+\S+|Del|Delete|F\d{1,2})$/
const ItemLabel = ({ label }) => {
  const m = typeof label === "string" && label.match(SHORTCUT)
  if (!m) return <span className="menuLabel">{label}</span>
  return (
    <>
      <span className="menuLabel">{m[1]}</span>
      <span className="menuShortcut"> {m[2]}</span>
    </>
  )
}

// Classic menu bar: click a title to open its menu, click an item (or away) to close.
// menus: [{ label, items: [{ label, onClick, checked, disabled } | "-"] }]
const MenuBar = ({ menus }) => {
  const [open, setOpen] = useState(null)
  const ref = useRef(null)

  useEffect(() => {
    if (open === null) return
    const close = (e) => {
      if (!ref.current?.contains(e.target)) setOpen(null)
    }
    // Escape closes it too, as in Windows (and doesn't reach the app underneath)
    const onKey = (e) => {
      if (e.key !== "Escape") return
      e.stopPropagation()
      setOpen(null)
    }
    document.addEventListener("pointerdown", close)
    document.addEventListener("keydown", onKey, true)
    return () => {
      document.removeEventListener("pointerdown", close)
      document.removeEventListener("keydown", onKey, true)
    }
  }, [open])

  return (
    <ul className="menuBar" ref={ref}>
      {menus.map((menu, i) => (
        <li key={menu.label} className={open === i ? "menuTitle is-open" : "menuTitle"}>
          <button type="button" onClick={() => setOpen(open === i ? null : i)} onMouseEnter={() => open !== null && setOpen(i)}>
            {menu.label}
          </button>
          {open === i && (
            <ul className="menu window">
              {menu.items.map((item, j) =>
                item === "-" ? (
                  <li key={j} className="menuSep" role="separator" />
                ) : (
                  <li key={item.label}>
                    <button
                      type="button"
                      disabled={item.disabled}
                      onClick={() => {
                        setOpen(null)
                        item.onClick()
                      }}
                    >
                      <span className="menuCheck">{item.checked ? "✓" : ""}</span>
                      <ItemLabel label={item.label} />
                    </button>
                  </li>
                )
              )}
            </ul>
          )}
        </li>
      ))}
    </ul>
  )
}

export default MenuBar
