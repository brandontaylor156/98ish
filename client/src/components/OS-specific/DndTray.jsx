import React, { Suspense, useEffect, useState } from "react"
import ContextMenu from "../shared/ContextMenu"
import PixelArt from "../shared/PixelArt"
import { moonArt } from "../../utils/moonArt"
import { SHELL_EVENT } from "../../utils/shell"
import { turnOffDnd, turnOnDnd, useDnd } from "../../utils/dnd"
import { formatTime } from "../../utils/region"

// Do Not Disturb in the taskbar tray: a moon. Click (or tap) for the choices: For 1 hour,
// Until tomorrow morning, Until I turn it off (or Turn Off), and Settings... Phones keep the
// taskbar tidy: no moon there; the bell wears a little moon while it's on, and the bell's
// panel has the switch.
// The settings (schedule, who can call, reminders, Away) load the first time they're opened.

const DndSettings = React.lazy(() => import("./DndSettings"))

// a pixel-art crescent (utils/moonArt.js): yellow with a twinkle when on, grey when off
export const MoonIcon = ({ on = true, size = 16 }) => <PixelArt art={moonArt(on)} size={size} className="moonIcon" />

// "until 7:00 AM", "until Mon 7:00 AM", "until you turn it off"
export const dndUntilText = (dnd, now = Date.now()) => {
  if (!dnd.active) return "Off"
  if (!dnd.endsAt) return dnd.reason === "schedule" ? "On (schedule)" : "On until you turn it off"
  const d = new Date(dnd.endsAt)
  const sameDay = new Date(now).toDateString() === d.toDateString()
  const day = sameDay ? "" : `${d.toLocaleDateString([], { weekday: "short" })} `
  return `On until ${day}${formatTime(d.getHours(), d.getMinutes())}`
}

export const dndMenu = (dnd, openSettings) => [
  { label: dnd.active ? `Do Not Disturb: ${dndUntilText(dnd)}` : "Do Not Disturb", bold: true, disabled: true, onClick: () => {} },
  "-",
  { label: "For 1 hour", onClick: () => turnOnDnd("hour") },
  { label: "Until tomorrow morning", onClick: () => turnOnDnd("morning") },
  { label: "Until I turn it off", checked: dnd.active && dnd.reason === "manual" && !dnd.state.until, onClick: () => turnOnDnd("off") },
  ...(dnd.active ? ["-", { label: "Turn Off", onClick: turnOffDnd }] : []),
  "-",
  { label: "Settings...", onClick: openSettings },
]

const DndTray = ({ mobile }) => {
  const dnd = useDnd()
  const [menu, setMenu] = useState(null)
  const [settings, setSettings] = useState(false)

  // Control Panel > Do Not Disturb, search results and the Notification Center ask for these
  useEffect(() => {
    const onShell = (e) => {
      if (e.detail?.action === "dnd-settings") setSettings(true)
    }
    window.addEventListener(SHELL_EVENT, onShell)
    return () => window.removeEventListener(SHELL_EVENT, onShell)
  }, [])

  const open = (e) => {
    e.preventDefault()
    e.stopPropagation()
    const box = e.currentTarget.getBoundingClientRect()
    setMenu({ x: box.left, y: box.top })
  }

  const label = dnd.active ? `Do Not Disturb: ${dndUntilText(dnd)}` : "Do Not Disturb: Off"
  return (
    <>
      {!mobile && (
        <button type="button" className={`trayIcon dndTray${dnd.active ? " is-on" : ""}`} title={label} aria-label={label} aria-pressed={dnd.active} data-dnd={dnd.active ? "on" : "off"} onClick={open} onContextMenu={open}>
          <MoonIcon on={dnd.active} />
        </button>
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={dndMenu(dnd, () => setSettings(true))} onClose={() => setMenu(null)} />}
      {settings && (
        <div className="shellLayer">
          <Suspense fallback={null}>
            <DndSettings onClose={() => setSettings(false)} />
          </Suspense>
        </div>
      )}
    </>
  )
}

export default DndTray
