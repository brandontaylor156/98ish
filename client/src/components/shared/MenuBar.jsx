import React, { useEffect, useLayoutEffect, useRef, useState } from "react"
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

// A menu's rows. An item with `items` is a submenu ("Send To" ▸): it opens on hover or a
// tap, to the right (or the left, if there's no room).
const MenuItems = ({ items, close }) => {
  const [sub, setSub] = useState(null)
  return items.map((item, j) =>
    item === "-" ? (
      <li key={j} className="menuSep" role="separator" />
    ) : (
      <li key={item.label} className={item.items ? "menuHasSub" : undefined} onMouseEnter={() => setSub(item.items ? j : null)}>
        <button
          type="button"
          disabled={item.disabled}
          aria-haspopup={item.items ? "menu" : undefined}
          aria-expanded={item.items ? sub === j : undefined}
          onClick={() => {
            // (the pointer already opened it on the way in: a click keeps it open)
            if (item.items) return setSub(j)
            close()
            item.onClick()
          }}
        >
          <span className="menuCheck">{item.checked ? "✓" : ""}</span>
          <ItemLabel label={item.label} />
          {item.items && <span className="menuArrow">&#9654;&#xFE0E;</span>}
        </button>
        {sub === j && item.items && <SubMenu items={item.items} close={close} />}
      </li>
    )
  )
}

const SubMenu = ({ items, close }) => {
  const ref = useRef(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    // the window clips what's outside it, so its edge counts (else the screen's)
    const frame = el.closest(".desktopWindow, [data-window-index]")?.getBoundingClientRect()
    const vw = Math.min(document.documentElement.clientWidth, frame ? frame.right : Infinity)
    if (el.getBoundingClientRect().right <= vw - 2) return
    el.classList.add("is-flipped")
    // a narrow phone: no room on either side, so it drops down over its menu instead
    const left = Math.max(0, frame ? frame.left : 0)
    if (el.getBoundingClientRect().left < left + 2) {
      const row = el.parentElement.getBoundingClientRect()
      el.classList.remove("is-flipped")
      el.style.left = `${Math.max(left + 2, Math.min(row.left + 12, vw - el.offsetWidth - 2)) - row.left}px`
      el.style.top = `${row.height - 2}px`
    }
  }, [])
  return (
    <ul className="menu window menuSub" ref={ref} role="menu">
      <MenuItems items={items} close={close} />
    </ul>
  )
}

// Classic menu bar: click a title to open its menu, click an item (or away) to close.
// menus: [{ label, items: [{ label, onClick, checked, disabled, items } | "-"] }]
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
              <MenuItems items={menu.items} close={() => setOpen(null)} />
            </ul>
          )}
        </li>
      ))}
    </ul>
  )
}

export default MenuBar
