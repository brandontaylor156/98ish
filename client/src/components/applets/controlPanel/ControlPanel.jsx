import React, { useEffect, useRef, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import Dialog from "../../shared/Dialog"
import ContextMenu from "../../shared/ContextMenu"
import { useOpenGesture } from "../../../hooks/useMediaQuery"
import { useLongPress } from "../../../hooks/useLongPress"
import { CPL_ITEMS, openCplItem } from "./items"
import "./ControlPanel.css"
import { helpItem } from "../../../utils/help"

const VIEW_KEY = "98ish.cpl.view"
const readView = () => {
  try {
    return JSON.parse(localStorage.getItem(VIEW_KEY)) || {}
  } catch {
    return {}
  }
}

// The Control Panel: a folder of settings, as in Windows 98, with the "web view" pane on
// the left describing the selected item. Large Icons, List or Details; double-click (or
// tap, or Enter) opens an item; arrow keys move around.
const ControlPanel = ({ dispatch, mobile }) => {
  const [view, setViewState] = useState(() => ({ mode: "icons", web: true, ...readView() }))
  const [selected, setSelected] = useState(null) // an item id
  const [menu, setMenu] = useState(null)
  const [about, setAbout] = useState(false)
  const openGesture = useOpenGesture()
  const listRef = useRef(null)
  const setView = (patch) =>
    setViewState((v) => {
      const next = { ...v, ...patch }
      try {
        localStorage.setItem(VIEW_KEY, JSON.stringify(next))
      } catch {
        // fine: for this visit
      }
      return next
    })

  const item = CPL_ITEMS.find((i) => i.id === selected) || null
  const open = (it) => it && openCplItem(it, dispatch)
  const showWeb = view.web && !mobile

  const viewItems = [
    { label: "Large Icons", checked: view.mode === "icons", onClick: () => setView({ mode: "icons" }) },
    { label: "List", checked: view.mode === "list", onClick: () => setView({ mode: "list" }) },
    { label: "Details", checked: view.mode === "details", onClick: () => setView({ mode: "details" }) },
    ...(mobile ? [] : ["-", { label: "as Web Page", checked: view.web, onClick: () => setView({ web: !view.web }) }]),
  ]
  const menus = [
    { label: "File", items: [{ label: "Open", disabled: !item, onClick: () => open(item) }] },
    { label: "View", items: viewItems },
    { label: "Help", items: [helpItem({ program: "Control Panel" }), "-", { label: "About Control Panel", onClick: () => setAbout(true) }] },
  ]

  // arrow keys: left/right through the items, up/down by rows (by one in List and Details)
  const onKeyDown = (e) => {
    if (e.target.closest("input, textarea, .menuBar")) return
    const at = CPL_ITEMS.findIndex((i) => i.id === selected)
    const els = [...(listRef.current?.querySelectorAll("[data-cpl]") || [])]
    const perRow = view.mode === "icons" && els.length ? els.filter((el) => el.offsetTop === els[0].offsetTop).length || 1 : 1
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: perRow, ArrowUp: -perRow, Home: -999, End: 999 }[e.key]
    if (step !== undefined) {
      e.preventDefault()
      const next = at < 0 ? 0 : Math.max(0, Math.min(CPL_ITEMS.length - 1, at + step))
      setSelected(CPL_ITEMS[next].id)
      els[next]?.focus({ preventScroll: false })
    } else if (e.key === "Enter" && item) {
      e.preventDefault()
      open(item)
    }
  }

  const longPress = useLongPress((x, y, { target }) => {
    const el = target.closest?.("[data-cpl]")
    if (el) setSelected(el.dataset.cpl)
    setMenu({ x, y, id: el?.dataset.cpl })
  })

  useEffect(() => {
    if (selected && !CPL_ITEMS.some((i) => i.id === selected)) setSelected(null)
  }, [selected])

  return (
    <div className="cplRoot" onKeyDown={onKeyDown}>
      <MenuBar menus={menus} />
      <div className="cplAddress">
        <span>Address</span>
        <div className="cplAddressBox">
          <img src="/assets/program_icons/cpl/control.svg" alt="" width="16" height="16" />
          Control Panel
        </div>
      </div>
      <div className="cplMain">
        {showWeb && (
          <aside className="cplPane" aria-live="polite">
            <div className="cplPaneHead">
              <img src="/assets/program_icons/cpl/control.svg" alt="" width="32" height="32" />
              <h2>Control Panel</h2>
            </div>
            <div className="cplPaneRule" />
            {item ? (
              <>
                <h3>{item.name}</h3>
                <p>{item.text}</p>
              </>
            ) : (
              <p>Use the settings in Control Panel to personalize your computer.</p>
            )}
            <p className="cplPaneHint">{item ? "Double-click it, or press Enter, to open it." : "Select an item to view its description."}</p>
          </aside>
        )}
        <div
          ref={listRef}
          className={`cplView cplView--${view.mode}`}
          role="listbox"
          aria-label="Control Panel"
          aria-orientation={view.mode === "icons" ? "horizontal" : "vertical"}
          onClick={(e) => !e.target.closest("[data-cpl]") && setSelected(null)}
          onContextMenu={(e) => {
            e.preventDefault()
            const el = e.target.closest("[data-cpl]")
            if (el) setSelected(el.dataset.cpl)
            setMenu({ x: e.clientX, y: e.clientY, id: el?.dataset.cpl })
          }}
          {...longPress}
        >
          {view.mode === "details" && (
            <div className="cplDetailsHead" aria-hidden="true">
              <span>Name</span>
              <span>Description</span>
            </div>
          )}
          {CPL_ITEMS.map((it) => (
            <div
              key={it.id}
              data-cpl={it.id}
              className={selected === it.id ? "cplItem is-selected" : "cplItem"}
              role="option"
              aria-selected={selected === it.id}
              aria-label={it.name}
              tabIndex={selected === it.id || (!selected && it === CPL_ITEMS[0]) ? 0 : -1}
              title={view.mode === "details" ? undefined : it.text}
              onClick={() => setSelected(it.id)}
              onFocus={() => setSelected(it.id)}
              {...openGesture(() => open(it))}
            >
              <img src={it.icon} alt="" draggable="false" />
              <span className="cplName">{it.name}</span>
              {view.mode === "details" && <span className="cplDesc">{it.text}</span>}
            </div>
          ))}
        </div>
      </div>
      <div className="status-bar cplStatus">
        <p className="status-bar-field">{item ? item.text : `${CPL_ITEMS.length} object(s)`}</p>
        <p className="status-bar-field cplStatusRight">
          <img src="/assets/program_icons/computer_explorer.png" alt="" width="14" height="14" /> My Computer
        </p>
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={
            menu.id
              ? [{ label: "Open", bold: true, onClick: () => open(CPL_ITEMS.find((i) => i.id === menu.id)) }]
              : [{ label: "View", items: viewItems }]
          }
        />
      )}
      {about && (
        <Dialog title="About Control Panel" onOk={() => setAbout(false)}>
          <div className="cplAbout">
            <img src="/assets/program_icons/cpl/control.svg" alt="" width="32" height="32" />
            <p className="dialogText">
              98ish Control Panel
              <br />
              Every setting in 98ish, in one folder.
            </p>
          </div>
        </Dialog>
      )}
    </div>
  )
}

export default ControlPanel
