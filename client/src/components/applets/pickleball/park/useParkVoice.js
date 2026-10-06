import { useEffect, useRef, useState } from "react"
import { useNet } from "../../network/NetContext"
import { createVoiceSession, voiceSupported } from "../../../../utils/voice/session.js"

// My Park's spatial voice (utils/voice): hear the people in your park where they stand. Off
// until you turn it on (park menu > Voice); while it's on, a mic chip shows on screen. The
// session follows the park you're in: leaving the park (or another park) turns it off.
//   -> { supported, state, toggle(), session }
export const useParkVoice = ({ world, joined, park }) => {
  const net = useNet()
  const socket = net?.socket
  const [state, setState] = useState({ status: "off", peers: {}, on: [] })
  const sessionRef = useRef(null)

  useEffect(() => {
    if (!world || !joined || !socket) return
    const space = {
      get me() {
        return world.voicePlace().me
      },
      mode: "world",
      join: (on) => net.request("park:vc", { on }),
      send: (to, kind, data) => net.request("park:sig", { to, kind, data }),
      listen: (onList, onSignal) => {
        const list = (d) => onList(d?.on || [])
        const sig = (d) => d && onSignal(d.from, d.kind, d.data)
        socket.on("park:vc", list)
        socket.on("park:sig", sig)
        return () => {
          socket.off("park:vc", list)
          socket.off("park:sig", sig)
        }
      },
      place: () => world.voicePlace(),
    }
    const session = createVoiceSession({ space })
    sessionRef.current = session
    if (import.meta.env?.DEV) window.__parkVoice = session
    const off = session.subscribe((s) => {
      setState(s)
      world.setVoiceTalk(Object.entries(s.peers).filter(([, p]) => p.talking).map(([id]) => Number(id)))
    })
    return () => {
      off()
      session.stop()
      world.setVoiceTalk([])
      sessionRef.current = null
      setState({ status: "off", peers: {}, on: [] })
    }
  }, [world, joined, park, socket])

  const toggle = () => {
    const s = sessionRef.current
    if (!s) return
    if (s.state.status === "on" || s.state.status === "starting" || s.state.status === "paused") s.stop()
    else s.start()
  }
  return { supported: voiceSupported() && !!joined, state, toggle, session: sessionRef.current }
}
