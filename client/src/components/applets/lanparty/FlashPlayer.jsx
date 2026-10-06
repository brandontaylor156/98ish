import React, { useEffect, useRef, useState } from "react"
import { loadRuffle } from "./engines"

// A Flash movie in Ruffle. src: a URL (the bundled demo) or a data URL (a .swf on drive C:).
const FlashPlayer = ({ src, onError }) => {
  const box = useRef(null)
  const [status, setStatus] = useState("Loading the Flash player...")

  useEffect(() => {
    let dead = false
    let player = null
    let blobUrl = null
    loadRuffle()
      .then(async (ruffle) => {
        if (dead) return
        let url = src
        if (/^data:/.test(src)) {
          const bytes = await (await fetch(src)).blob()
          blobUrl = URL.createObjectURL(bytes)
          url = blobUrl
        }
        player = ruffle.createPlayer()
        player.className = "lpRuffle"
        player.style.width = "100%"
        player.style.height = "100%"
        box.current.appendChild(player)
        await player.ruffle().load({ url, allowScriptAccess: false, allowNetworking: "none" })
        if (!dead) setStatus("")
      })
      .catch((e) => !dead && (setStatus(""), onError?.(e.message || "This Flash movie couldn't be played.")))
    return () => {
      dead = true
      try {
        player?.remove()
      } catch {}
      if (blobUrl) URL.revokeObjectURL(blobUrl)
    }
  }, [src])

  return (
    <div className="lpFlash" ref={box} data-touch-surface>
      {status && <div className="lpStatus">{status}</div>}
    </div>
  )
}

export default FlashPlayer
