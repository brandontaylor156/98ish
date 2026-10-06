import React, { useState } from "react"
import ContextMenu from "../../shared/ContextMenu"
import { openTarget } from "../../../utils/notifications"
import { activeShares, setPaused, startWatching, stopAll, useLocate } from "../../../utils/locate"

// The taskbar tray's location arrow: there whenever you share your location with anyone
// (also on phones: you should always be able to see that you're sharing). Blue while
// sending, grey while paused, flashing when updates need a tap to resume. Click or tap for
// who sees you, Pause/Resume, Stop Sharing Everywhere, and Buddy Locator.

export const ArrowIcon = ({ size = 16, color = "#0050d0" }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" className="locArrow" shapeRendering="crispEdges">
    <path d="M14 2 L2 7 L7 9 L9 14 Z" fill={color} stroke="#000" strokeWidth="1" strokeLinejoin="miter" />
    <path d="M12 4 L7 9" stroke="#fff" strokeWidth="1" opacity="0.6" />
  </svg>
)

const LocatorTray = () => {
  const loc = useLocate()
  const [menu, setMenu] = useState(null)
  const shares = activeShares(loc.me)
  if (!shares.length) return null
  const paused = !!loc.me?.paused
  const needsTap = !paused && (loc.geo.state === "needs-tap" || loc.geo.state === "denied")
  const names = shares.map((s) => s.name || s.to)
  const who = names.length <= 3 ? names.join(", ") : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`
  const label = paused ? `Location sharing paused (${who})` : needsTap ? "Location sharing: tap to resume updates" : `Sharing your location with ${who}`

  const open = (e) => {
    e.preventDefault()
    e.stopPropagation()
    const box = e.currentTarget.getBoundingClientRect()
    setMenu({ x: box.left, y: box.top })
  }
  const items = [
    { label: paused ? "Location sharing is paused" : `Sharing with ${who}`, bold: true, disabled: true, onClick: () => {} },
    "-",
    ...(needsTap ? [{ label: "Resume location updates", onClick: () => startWatching() }] : []),
    { label: paused ? "Resume Sharing" : "Pause Sharing", onClick: () => setPaused(!paused) },
    { label: "Stop Sharing Everywhere", onClick: () => stopAll() },
    "-",
    { label: "Open Buddy Locator", onClick: () => openTarget({ kind: "program", name: "Buddy Locator" }) },
  ]
  return (
    <>
      <button
        type="button"
        className={`trayIcon locTray${paused ? " is-paused" : ""}${needsTap ? " is-attention" : ""}`}
        title={label}
        aria-label={label}
        data-loc-tray={paused ? "paused" : needsTap ? "needs-tap" : "on"}
        onClick={open}
        onContextMenu={open}
      >
        <ArrowIcon color={paused ? "#808080" : "#0050d0"} />
      </button>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />}
    </>
  )
}

export default LocatorTray
