import React, { useEffect, useRef, useState } from "react"
import { coupleApi, refreshCoupleThings, serverNow } from "../../../utils/couple"
import { progress } from "../../../utils/achievements"
import { Bouquet, WateringCan } from "./art"
import { dateLabel, playLoveChime, useNow } from "./shared"
import { markFlowersSeen } from "./TrayHeart"
import { waterDay, wiltOf } from "./wilt"
import "./FlowerWidget.css"

// The bouquet your partner sent, on your desktop: drag it anywhere (a little corner
// widget on phones). It wilts over a few days unless you water it, once a day.

const POS_KEY = "98ish.couple.flowerPos"

const loadPos = () => {
  try {
    const p = JSON.parse(localStorage.getItem(POS_KEY))
    return Number.isFinite(p?.x) && Number.isFinite(p?.y) ? p : null
  } catch {
    return null
  }
}

const FlowerWidget = ({ bouquet, mobile }) => {
  useNow(60_000)
  const now = serverNow()
  const wilt = wiltOf(bouquet, now)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(loadPos)
  const [watering, setWatering] = useState(false)
  const [message, setMessage] = useState(null)
  const drag = useRef(null)
  const ref = useRef(null)

  // keep it on screen if the window got smaller
  useEffect(() => {
    if (mobile || !pos || !ref.current) return
    const parent = ref.current.parentElement.getBoundingClientRect()
    const x = Math.min(Math.max(0, pos.x), parent.width - 120)
    const y = Math.min(Math.max(0, pos.y), parent.height - 120)
    if (x !== pos.x || y !== pos.y) setPos({ x, y })
  }, [])

  const water = async (e) => {
    e.stopPropagation()
    setWatering(true)
    setMessage(null)
    const r = await coupleApi("POST", `/flowers/${bouquet.id}/water`, { tz: new Date().getTimezoneOffset() })
    if (r.ok) {
      playLoveChime("arrive")
      progress("green-thumb", waterDay(r.now), 3)
      setTimeout(() => setWatering(false), 1600)
      refreshCoupleThings()
    } else {
      setWatering(false)
      setMessage(r.error)
    }
  }

  const goodbye = async (e) => {
    e.stopPropagation()
    await coupleApi("DELETE", `/flowers/${bouquet.id}`)
    refreshCoupleThings()
  }

  const toggle = () => {
    markFlowersSeen([bouquet.id])
    setOpen(!open)
  }

  // desktop: drag by the bouquet (a press that doesn't move is a click)
  const onPointerDown = (e) => {
    if (mobile || e.button !== 0 || e.target.closest("button")) return
    const box = ref.current.getBoundingClientRect()
    const parent = ref.current.parentElement.getBoundingClientRect()
    drag.current = { dx: e.clientX - box.left, dy: e.clientY - box.top, parent, moved: false, startX: e.clientX, startY: e.clientY }
    ref.current.setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e) => {
    const d = drag.current
    if (!d) return
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 4) return
    d.moved = true
    setPos({
      x: Math.min(Math.max(0, e.clientX - d.parent.left - d.dx), d.parent.width - 100),
      y: Math.min(Math.max(0, e.clientY - d.parent.top - d.dy), d.parent.height - 100),
    })
  }
  const onPointerUp = () => {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (d.moved) {
      try {
        localStorage.setItem(POS_KEY, JSON.stringify(pos))
      } catch {
        // fine
      }
    } else toggle()
  }

  const style = !mobile && pos ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto" } : undefined
  const canWater = !wilt.dead && !wilt.wateredToday

  const card = (
    <div className="fwCard" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <div className="fwFrom">From {bouquet.from} ♥</div>
      {bouquet.note && <div className="fwNote">{bouquet.note}</div>}
      <div className="fwMeta">
        {dateLabel(bouquet.sentAt, false)} · <span className={`fwState is-${wilt.dead ? "dead" : wilt.level > 0.4 ? "thirsty" : "ok"}`}>{wilt.label}</span>
      </div>
      {wilt.dead ? (
        <button type="button" onClick={goodbye}>
          Say goodbye
        </button>
      ) : (
        <button type="button" className="fwWater" disabled={!canWater || watering} onClick={water}>
          <WateringCan size={22} /> {wilt.wateredToday ? "Watered today ✓" : "Water"}
        </button>
      )}
      {message && <div className="fwMessage">{message}</div>}
    </div>
  )

  return (
    <div
      ref={ref}
      className={`fwWidget${mobile ? " is-mobile" : ""}${open ? " is-open" : ""}${wilt.dead ? " is-dead" : ""}`}
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onClick={mobile ? toggle : undefined}
      data-wilt={wilt.level.toFixed(2)}
      role="button"
      tabIndex={0}
      aria-label={`Flowers from ${bouquet.from}. ${wilt.label}`}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && toggle()}
    >
      <div className="fwArtWrap">
        <Bouquet stems={bouquet.stems} vase={bouquet.vase} ribbon={bouquet.ribbon} wilt={wilt.level} className="fwArt" idPrefix={`fw${bouquet.id}`} />
        {watering && (
          <div className="fwRain" aria-hidden="true">
            <span className="fwCan">
              <WateringCan size={40} />
            </span>
            {Array.from({ length: 8 }, (_, i) => (
              <i key={i} style={{ left: `${30 + i * 6}%`, animationDelay: `${0.2 + (i % 4) * 0.15}s` }} />
            ))}
          </div>
        )}
        {canWater && !open && wilt.level > 0.3 && <span className="fwThirsty" title="Thirsty!">💧</span>}
      </div>
      {open && card}
    </div>
  )
}

export default FlowerWidget
