import React, { useEffect, useRef, useState } from "react"
import { loadRuffle } from "./engines"

// A Flash movie in Ruffle. src: a URL (the bundled demo) or a data URL (a .swf on drive C:).
// Ruffle destroys its player when the element leaves the page, so it lives in its own host
// element that React never renders into (the status line is a sibling overlay).
const FlashPlayer = ({ src, onError }) => {
  const host = useRef(null)
  const [status, setStatus] = useState("Loading the Flash player...")

  useEffect(() => {
    let dead = false
    let player = null
    let blobUrl = null
    setStatus("Loading the Flash player...")
    loadRuffle()
      .then(async (ruffle) => {
        if (dead) return
        let url = src
        if (/^data:/.test(src)) {
          blobUrl = URL.createObjectURL(await (await fetch(src)).blob())
          url = blobUrl
        }
        if (dead) return
        player = ruffle.createPlayer()
        player.className = "lpRuffle"
        player.style.width = "100%"
        player.style.height = "100%"
        host.current.appendChild(player)
        setStatus("")
        await player.ruffle().load({ url, allowScriptAccess: false, allowNetworking: "none" })
      })
      .catch((e) => !dead && (setStatus(""), onError?.(e?.message || "This Flash movie couldn't be played.")))
    return () => {
      dead = true
      try {
        player?.remove()
      } catch {}
      if (blobUrl) URL.revokeObjectURL(blobUrl)
    }
  }, [src])

  return (
    <div className="lpFlash">
      <div className="lpFlashHost" ref={host} data-touch-surface />
      {status && <div className="lpStatus">{status}</div>}
    </div>
  )
}

export default FlashPlayer
