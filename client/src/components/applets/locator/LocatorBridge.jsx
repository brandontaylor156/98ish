import React, { useEffect, useState } from "react"
import { interrupts, notify, openTarget } from "../../../utils/notifications"
import { notifyLocked } from "../../../utils/lock"
import { onChanged, onGone, onPos, onShared, refresh } from "../../../utils/locate"
import { untilText } from "./locateCore"
import "./Locator.css"

// Lives on the desktop (inside 98 Messenger's provider), whether or not Buddy Locator is
// open: passes the server's live location events to utils/locate.js, and tells you (the
// Notification Center, plus a small pop-up unless Do Not Disturb) when a buddy starts sharing
// with you, asks to see your location, or arrives at / leaves one of your places.
// (Signing on and off reaches utils/locate.js from AimContext, like Notes.)

const OPEN = { kind: "program", name: "Buddy Locator" }

const LocatorBridge = ({ socket }) => {
  const [toast, setToast] = useState(null) // { title, text }

  useEffect(() => {
    if (!socket) return
    const tell = ({ key, title, text, from }) => {
      notify({ app: "locator", key, title, text, target: OPEN })
      notifyLocked()
      if (interrupts("locator", from)) setToast({ title, text })
    }
    const handlers = {
      "loc:pos": onPos,
      "loc:gone": onGone,
      "loc:changed": onChanged,
      "loc:shared": (p) => {
        onShared(p)
        tell({ key: `loc-share-${p.key}`, title: `${p.name} is sharing their location with you`, text: untilText(p.until, Date.now()), from: p.name })
      },
      "loc:ask": (p) => {
        refresh()
        tell({ key: `loc-ask-${p.from}`, title: `${p.name} would like to see your location`, text: "Open Buddy Locator to share or say no.", from: p.name })
      },
      "loc:alert": (p) => tell({ key: `loc-alert-${p.key}-${p.place}`, title: `${p.name} ${p.event === "arrive" ? "arrived at" : "left"} ${p.place}`, text: "Buddy Locator", from: p.name }),
    }
    for (const [event, fn] of Object.entries(handlers)) socket.on(event, fn)
    return () => {
      for (const [event, fn] of Object.entries(handlers)) socket.off(event, fn)
    }
  }, [socket])

  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 9000)
    return () => clearTimeout(id)
  }, [toast])

  if (!toast) return null
  return (
    <div className="window locToast" role="status" data-loc-toast>
      <div className="title-bar">
        <div className="title-bar-text">Buddy Locator</div>
        <div className="title-bar-controls">
          <button type="button" aria-label="Close" onClick={() => setToast(null)} />
        </div>
      </div>
      <div className="window-body locToastBody">
        <img src="/assets/program_icons/locator.svg" alt="" width="32" height="32" />
        <div className="locToastText">
          <b>{toast.title}</b>
          <div>{toast.text}</div>
        </div>
        <button
          type="button"
          onClick={() => {
            setToast(null)
            openTarget(OPEN)
          }}
        >
          Show
        </button>
      </div>
    </div>
  )
}

export default LocatorBridge
