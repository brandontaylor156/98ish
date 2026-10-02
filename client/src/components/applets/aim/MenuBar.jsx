import React, { useEffect, useRef, useState } from "react"

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
    document.addEventListener("pointerdown", close)
    return () => document.removeEventListener("pointerdown", close)
  }, [open])

  return (
    <ul className="aimMenuBar" ref={ref}>
      {menus.map((menu, i) => (
        <li key={menu.label} className={open === i ? "aimMenuTitle is-open" : "aimMenuTitle"}>
          <button type="button" onClick={() => setOpen(open === i ? null : i)} onMouseEnter={() => open !== null && setOpen(i)}>
            {menu.label}
          </button>
          {open === i && (
            <ul className="aimMenu window">
              {menu.items.map((item, j) =>
                item === "-" ? (
                  <li key={j} className="aimMenuSep" role="separator" />
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
                      <span className="aimMenuCheck">{item.checked ? "✓" : ""}</span>
                      {item.label}
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
