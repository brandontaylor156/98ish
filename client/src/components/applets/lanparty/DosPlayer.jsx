import React, { useEffect, useRef, useState } from "react"
import TouchControls, { useTouchControlsVisible } from "../../shared/controls"
import { CDN, KEY, PEER_SERVER, dosboxConf } from "./catalog"
import { loadJsDos } from "./engines"
import { driveSaves } from "./saves"

// One DOS game in js-dos 8. mode: "play" | "host" (starts the IPX server; tells onNet its
// peer id) | "join" (connects to the host's peer id). Saves go to drive C: (saves.js).
// On touch screens our own movable controls send keys (catalog.js controls).
const DosPlayer = ({ game, mode = "play", opts = {}, peer = null, onNet, onError, onReady }) => {
  const box = useRef(null)
  const ci = useRef(null)
  const player = useRef(null)
  const [status, setStatus] = useState("Loading the DOS player...")
  const [editing, setEditing] = useState(false)
  const showControls = useTouchControlsVisible()
  const cycle = useRef(0)

  useEffect(() => {
    let dead = false
    let poll = null
    const el = document.createElement("div")
    el.className = "lpDosHost"
    box.current.appendChild(el)
    loadJsDos()
      .then((Dos) => {
        if (dead) return
        setStatus(mode === "play" ? "Starting..." : "Connecting to the LAN...")
        player.current = Dos(el, {
          url: game.url,
          pathPrefix: `${CDN.jsdos}emulators/`,
          dosboxConf: dosboxConf(game, { mode, ...opts }),
          autoStart: true,
          countDownStart: 0,
          thinSidebar: true,
          theme: "dark",
          mouseCapture: false,
          fsChanges: driveSaves({ onError: (m) => onError?.(m) }),
          startIpxServer: mode === "host",
          connectIpxAddress: mode === "join" && peer ? String(peer) : undefined,
          net: { peerServer: PEER_SERVER, token: "98ish-lanparty" },
          onEvent: (event, c) => {
            if (event !== "ci-ready" || dead) return
            ci.current = c
            setStatus("")
            onReady?.()
            if (mode === "host") {
              // the IPX server's address: our peer id on the WebRTC network
              poll = setInterval(() => {
                const id = c?.net?.()?.peerId || window.net?.peerId
                if (id) {
                  clearInterval(poll)
                  onNet?.(id)
                }
              }, 250)
            }
          },
        })
        try {
          player.current?.setNoCloud?.(true)
        } catch {}
      })
      .catch((e) => !dead && (setStatus(""), onError?.(e.message)))
    return () => {
      dead = true
      clearInterval(poll)
      const p = player.current
      player.current = null
      ci.current = null
      Promise.resolve(p?.stop?.()).catch(() => {})
      setTimeout(() => el.remove(), 0)
    }
  }, [game.id, mode, peer])

  const send = (key, down) => {
    const code = KEY[key]
    if (code && ci.current?.sendKeyEvent) ci.current.sendKeyEvent(code, down)
  }
  const controlFor = (id) => game.controls.find((c) => c.id === id)

  return (
    <div className="lpDos" data-mode={mode}>
      <div className="lpDosScreen" ref={box} data-touch-surface />
      {status && <div className="lpStatus">{status}</div>}
      {showControls && game.controls && (
        <TouchControls
          game={`lanparty-${game.id}`}
          controls={game.controls.map((c) => ({ ...c, icon: <span className="lpKeyGlyph">{c.icon}</span> }))}
          onPress={(action) => {
            const c = controlFor(action)
            if (!c) return
            if (c.cycle) {
              cycle.current = (cycle.current + 1) % c.cycle.length
              send(c.cycle[cycle.current], true)
              setTimeout(() => send(c.cycle[cycle.current], false), 60)
            } else send(c.key, true)
          }}
          onRelease={(action) => {
            const c = controlFor(action)
            if (c && !c.cycle) send(c.key, false)
          }}
          editing={editing}
          onEditingChange={setEditing}
          gear
        />
      )}
    </div>
  )
}

export default DosPlayer
