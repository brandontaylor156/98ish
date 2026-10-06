import React, { useState } from "react"
import ContextMenu from "../../shared/ContextMenu"
import { openTarget } from "../../../utils/notifications"
import { useHangout, leave, follow, allowTouch, meKey } from "../../../utils/hangout"
import { DRAG_TYPE } from "../../../utils/fsActions"
import { initials } from "./hangoutCore"
import { handFile } from "./HangoutLayer"

// The taskbar's "who's here" strip while friends are over (Come Over): a colored dot for
// each person (drop a file from My Computer on one to hand it to them), and a red Stop
// that leaves at once (also on phones, where the dots are smaller). Click a dot for Follow,
// Visit and the rest.
const HangoutTray = ({ mobile }) => {
  const hg = useHangout()
  const [menu, setMenu] = useState(null)
  if (!hg.id) return null
  const me = meKey()
  const people = hg.state?.people || []
  const mine = people.find((p) => p.key === me)
  const followers = people.filter((p) => p.watching === me)

  const open = (e, p) => {
    e.preventDefault()
    e.stopPropagation()
    const box = e.currentTarget.getBoundingClientRect()
    setMenu({ x: box.left, y: box.top, p })
  }
  const items = (p) => [
    { label: p ? `${p.name}${p.key === me ? " (you)" : ""}` : "Come Over", bold: true, disabled: true, onClick: () => {} },
    "-",
    ...(p && p.key !== me
      ? [
          { label: mine?.watching === p.key ? `Stop Following ${p.name}` : `Follow ${p.name}`, onClick: () => follow(mine?.watching === p.key ? null : p.key) },
          { label: `Visit ${p.name}'s Desktop`, onClick: () => openTarget({ kind: "program", name: "Come Over", extra: { handoff: { id: Date.now(), tab: "visit" } } }) },
          "-",
        ]
      : []),
    { label: "Let Friends Touch My Desktop", checked: !!mine?.touch, onClick: () => allowTouch(!mine?.touch) },
    { label: "Open Come Over", onClick: () => openTarget({ kind: "program", name: "Come Over" }) },
    "-",
    { label: "Stop Sharing and Leave", onClick: () => leave() },
  ]

  return (
    <>
      <span className={`hgTray${mobile ? " is-mobile" : ""}`} data-hg-tray role="group" aria-label="Friends here">
        {people.map((p) => (
          <button
            key={p.key}
            type="button"
            className={`hgTrayDot${p.away ? " is-away" : ""}`}
            style={{ background: p.color }}
            title={`${p.name}${p.key === me ? " (you)" : ""}${p.away ? " (away)" : ""}. Drop a file here to hand it over.`}
            onClick={(e) => open(e, p)}
            onContextMenu={(e) => open(e, p)}
            onDragOver={(e) => p.key !== me && e.dataTransfer.types.includes(DRAG_TYPE) && e.preventDefault()}
            onDrop={(e) => {
              const path = e.dataTransfer.getData(DRAG_TYPE)
              if (!path || p.key === me) return
              e.preventDefault()
              handFile(p.key, path)
            }}
            data-tray-person={p.key}
          >
            {initials(p.name)}
          </button>
        ))}
        <button type="button" className="hgStop" onClick={() => leave()} title={followers.length ? "Someone is following your view. Stop sharing and leave." : "Stop sharing and leave"} data-hg-stop>
          {mobile ? "■" : "Stop"}
        </button>
      </span>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={items(menu.p)} onClose={() => setMenu(null)} />}
    </>
  )
}

export default HangoutTray
