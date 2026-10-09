import React, { useState } from "react"
import ContextMenu from "../../shared/ContextMenu"
import { openTarget } from "../../../utils/notifications"
import { useHangout, leave, follow, allowTouch, meKey, useHangoutVoice, toggleVoice, voiceSession, setSpatialVoice } from "../../../utils/hangout"
import { DRAG_TYPE } from "../../../utils/fsActions"
import { initials } from "./hangoutCore"
import { handFile } from "./HangoutLayer"
import { voiceStatus } from "../../../utils/voice/status.js"

// The taskbar's "who's here" strip while friends are over (Come Over): a colored dot for
// each person (drop a file from My Computer on one to hand it to them), and a red Stop
// that leaves at once (also on phones, where the dots are smaller). Click a dot for Follow,
// Visit and the rest.
const HangoutTray = ({ mobile }) => {
  const hg = useHangout()
  const vc = useHangoutVoice()
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
    { label: "Voice Chat", checked: vc.status !== "off" && vc.status !== "error", onClick: () => toggleVoice() },
    ...(vc.status === "on" ? [{ label: "Mute Me", checked: !!vc.muted, onClick: () => voiceSession()?.setMuted(!vc.muted) }] : []),
    { label: "Spatial Sound (voices from their pointers)", checked: vc.spatial !== false, onClick: () => setSpatialVoice(vc.spatial === false) },
    "-",
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
            data-talking={vc.peers?.[p.key]?.talking || (p.key === me && vc.talking) ? "1" : undefined}
          >
            {initials(p.name)}
          </button>
        ))}
        <button
          type="button"
          className={`hgMic${vc.status === "on" || vc.status === "paused" ? " is-on" : ""}${vc.muted ? " is-muted" : ""}`}
          onClick={() => (vc.status === "on" ? voiceSession()?.setMuted(!vc.muted) : toggleVoice())}
          onContextMenu={(e) => (e.preventDefault(), toggleVoice())}
          title={vc.error || (voiceStatus(vc).problem ? voiceStatus(vc).line : null) || (vc.status === "on" ? (vc.muted ? "Voice on, you're muted. Click to unmute (right-click: voice off)." : "Voice on. Click to mute yourself (right-click: voice off).") : "Talk with your friends here")}
          aria-pressed={vc.status === "on"}
          data-hg-mic
        >
          {vc.status === "starting" ? "…" : vc.muted ? "🔇" : "🎙"}
          {voiceStatus(vc).problem && <span className="hgMicWarn" aria-label="Voice problem"> ⚠</span>}
        </button>
        <button type="button" className="hgStop" onClick={() => leave()} title={followers.length ? "Someone is following your view. Stop sharing and leave." : "Stop sharing and leave"} data-hg-stop>
          {mobile ? "■" : "Stop"}
        </button>
      </span>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={items(menu.p)} onClose={() => setMenu(null)} />}
    </>
  )
}

export default HangoutTray
