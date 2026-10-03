import React, { useEffect, useRef, useState } from "react"
import { NEXT_PHOTO_EVENT, coupleApi, on, openCouples, serverNow, useCouple } from "../../../utils/couple"
import { setOurPhoto, useSettings } from "../../../utils/settings"
import { unlock } from "../../../utils/achievements"
import { TwoHearts } from "./art"
import { dateLabel, loadPhoto, playLoveChime } from "./shared"
import "./CoupleOverlays.css"

// What couples see on top of the desktop: a pair request to answer, little toasts when a
// letter or flowers arrive (or a moment's anniversary comes around), and Our Story photos
// taking turns as the wallpaper when you've picked "Our photos" in Display Properties.

const PHOTO_EVERY_MS = 5 * 60_000
const ON_THIS_DAY_KEY = "98ish.couple.onThisDay"

const read = (key) => {
  try {
    return JSON.parse(localStorage.getItem(key))
  } catch {
    return null
  }
}
const write = (key, value) => {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // storage blocked: this visit only
  }
}

const PairRequest = ({ from, onLater }) => {
  const couple = useCouple()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const answer = async (yes) => {
    setBusy(true)
    const result = yes ? await couple.acceptPair(from) : await couple.declinePair(from)
    setBusy(false)
    if (!result.ok) return setError(result.error)
    if (yes) {
      unlock("two-hearts")
      playLoveChime("open")
    }
  }
  return (
    <div className="coDim">
      <div className="window coRequest" role="dialog" aria-label="Pair request">
        <div className="title-bar">
          <div className="title-bar-text">Pair Request ♥</div>
          <div className="title-bar-controls">
            <button type="button" aria-label="Close" onClick={onLater} />
          </div>
        </div>
        <div className="window-body coRequestBody">
          <div className="coRequestArt">
            <TwoHearts size={86} />
          </div>
          <p className="coRequestTitle">
            <b>{from}</b> wants to pair with you!
          </p>
          <p>Pairing makes a private little space for the two of you on 98ish: love letters, your story in photos and flowers. Only you two can see it.</p>
          {error && <p className="usError">{error}</p>}
          <div className="coRequestButtons">
            <button type="button" className="coYes" disabled={busy} onClick={() => answer(true)}>
              Accept ♥
            </button>
            <button type="button" disabled={busy} onClick={() => answer(false)}>
              Decline
            </button>
            <button type="button" disabled={busy} onClick={onLater}>
              Later
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

const Toast = ({ toast, onClose }) => {
  useEffect(() => {
    const t = setTimeout(onClose, 10000)
    return () => clearTimeout(t)
  }, [])
  return (
    <div className="window coToast" role="status">
      <div className="title-bar">
        <div className="title-bar-text">{toast.title}</div>
        <div className="title-bar-controls">
          <button type="button" aria-label="Close" onClick={onClose} />
        </div>
      </div>
      <div className="window-body coToastBody">
        <span className="coToastIcon" aria-hidden="true">
          {toast.icon}
        </span>
        <div className="coToastText">{toast.text}</div>
        {toast.action && (
          <button
            type="button"
            onClick={() => {
              onClose()
              toast.action.run()
            }}
          >
            {toast.action.label}
          </button>
        )}
      </div>
    </div>
  )
}

const CoupleOverlays = () => {
  const couple = useCouple()
  const settings = useSettings()
  const [later, setLater] = useState(() => new Set())
  const [toasts, setToasts] = useState([])
  const idRef = useRef(0)

  const toast = (t) => setToasts((list) => [...list.slice(-2), { ...t, id: ++idRef.current }])
  const close = (id) => setToasts((list) => list.filter((t) => t.id !== id))

  // live notices -> toasts
  useEffect(() => {
    const offs = [
      on("couple:letter", (l) => {
        if (l.removed) return
        playLoveChime("arrive")
        toast({
          title: "Love Letters",
          icon: "💌",
          text: l.locked ? `${l.from} sealed a letter for you: "${l.title}". It opens ${dateLabel(l.unlockAt)}.` : l.delivery === "openwhen" ? `${l.from} left you a letter to open when ${l.label}.` : `A new love letter from ${l.from}: "${l.title}"`,
          action: { label: l.locked ? "See it" : "Read", run: () => openCouples("Love Letters") },
        })
      }),
      on("couple:letter-opened", (p) => toast({ title: "Love Letters", icon: "💞", text: `${p.by} just opened your letter "${p.title}".` })),
      on("couple:flowers", (b) => {
        playLoveChime("arrive")
        toast({ title: "Flowers!", icon: "💐", text: `${b.from} sent you flowers! They're on your desktop. Remember to water them.` })
      }),
      on("couple:watered", (p) => toast({ title: "Flowers", icon: "💧", text: `${p.by} watered the flowers you sent.` })),
      // a toast from another couple feature on this desktop (Our Pet's reminders)
      on("couple:local-toast", (t) => toast(t)),
      on("couple:update", (p) => {
        if (p.paired) {
          playLoveChime("open")
          unlock("two-hearts")
          toast({ title: "Us", icon: "💕", text: `${p.paired} said yes! You're paired now.`, action: { label: "Open Us", run: () => openCouples("Us") } })
        }
        if (p.unpaired) toast({ title: "Us", icon: "💔", text: `${p.unpaired} unpaired. What you shared is kept for 30 days in case you pair up again.` })
        if (p.declined) toast({ title: "Us", icon: "💌", text: `${p.declined} said no to pairing, for now.` })
      }),
    ]
    return () => offs.forEach((off) => off())
  }, [])

  // the "Our photos" wallpaper: Our Story photos taking turns
  useEffect(() => {
    if (settings.wallpaper !== "ourphotos" || couple.status !== "paired") {
      setOurPhoto(null)
      return
    }
    let live = true
    let photos = []
    let index = -1
    let last = serverNow()
    const show = async () => {
      if (!photos.length) return setOurPhoto(null)
      index = (index + 1) % photos.length
      last = serverNow()
      const data = await loadPhoto(photos[index].id)
      if (live && data) setOurPhoto(data)
    }
    const fetchList = async () => {
      const r = await coupleApi("GET", "/photos")
      if (!live || !r.ok) return
      photos = r.photos
      if (index < 0) index = Math.floor(Math.random() * Math.max(1, photos.length)) - 1
      if (index >= photos.length - 1) index = -1
      show()
    }
    fetchList()
    const timer = setInterval(() => serverNow() - last >= PHOTO_EVERY_MS && show(), 5000)
    window.addEventListener(NEXT_PHOTO_EVENT, show)
    const off = on("couple:story", fetchList)
    return () => {
      live = false
      clearInterval(timer)
      window.removeEventListener(NEXT_PHOTO_EVENT, show)
      off()
    }
  }, [settings.wallpaper, couple.status, couple.coupleId])

  // "On this day": a moment from a year (or more) ago today
  useEffect(() => {
    if (couple.status !== "paired") return
    const now = new Date(serverNow())
    const pad = (n) => String(n).padStart(2, "0")
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
    const key = `${couple.coupleId}:${today}`
    if (read(ON_THIS_DAY_KEY) === key) return
    let live = true
    coupleApi("GET", "/story").then((r) => {
      if (!live || !r.ok) return
      const found = r.moments.filter((m) => m.date.slice(5) === today.slice(5) && m.date < today)
      if (!found.length) return
      write(ON_THIS_DAY_KEY, key)
      const m = found[found.length - 1]
      const years = now.getFullYear() - Number(m.date.slice(0, 4))
      toast({
        title: "On this day ♥",
        icon: "📷",
        text: `${years === 1 ? "One year" : `${years} years`} ago today: "${m.title}"${found.length > 1 ? ` (and ${found.length - 1} more)` : ""}`,
        action: { label: "Look back", run: () => openCouples("Our Story", { focus: m.id }) },
      })
    })
    return () => {
      live = false
    }
  }, [couple.status, couple.coupleId])

  const request = couple.status === "pending-in" ? couple.incoming.find((n) => !later.has(n)) : null

  return (
    <>
      {request && <PairRequest from={request} onLater={() => setLater(new Set([...later, request]))} />}
      {toasts.length > 0 && (
        <div className="coToasts">
          {toasts.map((t) => (
            <Toast key={t.id} toast={t} onClose={() => close(t.id)} />
          ))}
        </div>
      )}
    </>
  )
}

export default CoupleOverlays
