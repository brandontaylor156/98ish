import React, { useEffect, useRef, useState } from "react"
import { NEXT_PHOTO_EVENT, openCouples, unreadLetters, useCouple } from "../../../utils/couple"
import { useSettings } from "../../../utils/settings"
import "./CoupleTray.css"

// The tray heart itself (see CoupleTray.jsx): a badge for new letters, flowers and pair
// requests, and a balloon with what's new.

const SEEN_FLOWERS_KEY = "98ish.couple.seenFlowers"

export const seenFlowers = () => {
  try {
    return JSON.parse(localStorage.getItem(SEEN_FLOWERS_KEY)) || []
  } catch {
    return []
  }
}
export const markFlowersSeen = (ids) => {
  try {
    localStorage.setItem(SEEN_FLOWERS_KEY, JSON.stringify([...new Set([...seenFlowers(), ...ids])].slice(-40)))
  } catch {
    // fine
  }
}

const HeartIcon = () => (
  <svg viewBox="-10 -10 20 20" width="16" height="16" aria-hidden="true">
    <path d="M0,-3 C0,-9 -9,-10 -9,-3 C-9,2 -3,6 0,9 C3,6 9,2 9,-3 C9,-10 0,-9 0,-3 Z" fill="#e8405f" stroke="#7a1430" strokeWidth="1.2" />
    <path d="M-5,-5 Q-6,-2 -4,0" stroke="#fff" strokeWidth="1.6" fill="none" strokeLinecap="round" opacity="0.7" />
  </svg>
)

const TrayHeart = () => {
  const couple = useCouple()
  const settings = useSettings()
  const [open, setOpen] = useState(false)
  const [, tick] = useState(0)
  const ref = useRef(null)
  const visible = couple.status === "paired" || couple.status === "pending-in"

  // sealed letters open on their own: look again every half minute
  useEffect(() => {
    if (couple.status !== "paired") return
    const id = setInterval(() => tick((n) => n + 1), 30_000)
    return () => clearInterval(id)
  }, [couple.status])

  useEffect(() => {
    if (!open) return
    const away = (e) => !ref.current?.contains(e.target) && !e.target.closest?.(".coupleTray") && setOpen(false)
    document.addEventListener("pointerdown", away, true)
    const t = setTimeout(() => setOpen(false), 15000)
    return () => {
      document.removeEventListener("pointerdown", away, true)
      clearTimeout(t)
    }
  }, [open])

  if (!visible) return null
  const letters = unreadLetters(couple)
  const seen = seenFlowers()
  const flowers = (couple.bouquets || []).filter((b) => !b.dismissed && !seen.includes(b.id)).length
  const requests = couple.status === "pending-in" ? couple.incoming.length : 0
  const count = letters + flowers + requests
  const go = (program) => {
    setOpen(false)
    openCouples(program)
  }

  return (
    <>
      <button
        type="button"
        className="trayIcon coupleTray"
        title={couple.status === "paired" ? `Us: you and ${couple.partner}` : "Someone wants to pair with you"}
        aria-label={count ? `Us, ${count} new` : "Us"}
        onClick={() => setOpen(!open)}
      >
        <HeartIcon />
        {count > 0 && <span className="coupleTrayCount">{count > 9 ? "9+" : count}</span>}
      </button>
      {open && (
        <div className="trayPopup coupleBalloon" ref={ref} role="status">
          <div className="coupleBalloonTitle">
            <HeartIcon /> {couple.status === "paired" ? <>You &amp; {couple.partner}</> : "Pair request"}
            {couple.status === "paired" && (
              <span className={couple.partnerOnline ? (couple.partnerAway ? "coupleDot is-away" : "coupleDot is-on") : "coupleDot"} title={couple.partnerOnline ? (couple.partnerAway ? "Away" : "Online") : "Offline"} />
            )}
          </div>
          {requests > 0 && <button type="button" className="coupleBalloonLink" onClick={() => go("Us")}>{couple.incoming[0]} wants to pair with you ♥</button>}
          {letters > 0 && <button type="button" className="coupleBalloonLink" onClick={() => go("Love Letters")}>{letters === 1 ? "1 new love letter" : `${letters} new love letters`} ✉</button>}
          {flowers > 0 && <button type="button" className="coupleBalloonLink" onClick={() => (markFlowersSeen((couple.bouquets || []).map((b) => b.id)), setOpen(false))}>{couple.partner} sent you flowers! 🌷</button>}
          {couple.status === "paired" && !count && <div className="coupleBalloonQuiet">All caught up. Maybe write {couple.partner} a letter?</div>}
          {couple.status === "paired" && settings.wallpaper === "ourphotos" && (
            <button type="button" className="coupleBalloonLink" onClick={() => window.dispatchEvent(new CustomEvent(NEXT_PHOTO_EVENT))}>
              Next wallpaper photo ›
            </button>
          )}
          {couple.status === "paired" && (
            <button type="button" className="coupleBalloonLink" onClick={() => go("Us")}>
              Open Us
            </button>
          )}
        </div>
      )}
    </>
  )
}

export default TrayHeart
