import React, { useEffect, useRef, useState } from "react"
import { PICKLEBALL_ORIGIN, embedUrl, meetFromHandoff, pickleballSearch } from "../../../utils/pickleballSite"
import { currentUser } from "../../../utils/users"
import "./PickleballLauncher.css"

// Pickleball 98 in its 98ish window, as before the split: the game is its own site now
// (utils/pickleballSite.js), shown here in a frame. 98ish draws the window; the site draws the
// game (its menus, screens and dialogs). The site talks back with postMessage
// (pickleball-98 client/src/utils/embed.js):
//   from the game: { type: "pk98:exit" }     Game > Exit: this window closes
//   to the game:   { type: "pk98:open", search } a new start (Messenger's "Play here", Floppy)
//                                               while it's open: no reload, the game goes there

// what the game may use, as it could inside 98ish: Twin Replay's camera, voice, Venue Finder's
// "near me", full screen, controllers, the clipboard
const ALLOW = "camera; microphone; geolocation; fullscreen; gamepad; autoplay; clipboard-read; clipboard-write; screen-wake-lock; accelerometer; gyroscope; xr-spatial-tracking"

const PickleballLauncher = ({ handoff = null, active = true, onClose }) => {
  const frame = useRef(null)
  // the first start goes in the address; later ones as messages (the game keeps its place)
  const [src] = useState(() => {
    const user = currentUser()
    const name = user?.screenName || (user?.name && !/^(Guest|User)$/.test(user.name) ? user.name : "")
    return embedUrl(meetFromHandoff(handoff), name)
  })
  const firstId = useRef(handoff?.id ?? null)

  useEffect(() => {
    if (!handoff || handoff.id === firstId.current) return
    firstId.current = handoff.id
    frame.current?.contentWindow?.postMessage({ type: "pk98:open", search: pickleballSearch(meetFromHandoff(handoff)) }, PICKLEBALL_ORIGIN)
  }, [handoff])

  useEffect(() => {
    const listen = (event) => {
      if (event.origin !== PICKLEBALL_ORIGIN || event.source !== frame.current?.contentWindow) return
      if (event.data?.type === "pk98:exit") onClose?.()
    }
    window.addEventListener("message", listen)
    return () => window.removeEventListener("message", listen)
  }, [onClose])

  // the game's keys work as soon as its window is the active one
  useEffect(() => {
    if (active) frame.current?.focus({ preventScroll: true })
  }, [active])

  return (
    <div className="pklRoot">
      <iframe
        ref={frame}
        className="pklFrame"
        src={src}
        title="Pickleball 98"
        allow={ALLOW}
        allowFullScreen
        onLoad={() => active && frame.current?.focus({ preventScroll: true })}
      />
    </div>
  )
}

export default PickleballLauncher
