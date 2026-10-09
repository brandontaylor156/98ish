import { useEffect, useRef, useState } from "react"
import { useNet } from "../../network/NetContext"
import { repLevel } from "./rep.js"

// My Park online: joins a park on the server (server/park) over the shared network
// connection while you're in My Park, and passes everything to the world (world.setNet /
// netJoined / netEvent). Without a connection the park is just yours and the regulars'.
// -> { joined, park, people, error }
// (park:ask ... park:tgend: My Park > Together, server/park/together.js)
const EVENTS = ["park:m", "park:person", "park:gone", "park:fx", "park:courts", "park:go", "park:rate", "park:ask", "park:answer", "park:link", "park:tg", "park:tgend"]

export const usePark = ({ world, active, me }) => {
  const net = useNet()
  const socket = net?.socket
  const online = net?.status === "online"
  const meRef = useRef(me)
  meRef.current = me
  const [state, setState] = useState({ joined: false, park: null, people: 0, error: null })
  useEffect(() => {
    if (!active || !world || !socket || !online) return
    let live = true
    const handlers = Object.fromEntries(
      EVENTS.map((ev) => [
        ev,
        (d) => {
          world.netEvent(ev, d)
          if (ev === "park:person" || ev === "park:gone") setState((s) => ({ ...s, people: Math.max(1, s.people + (ev === "park:gone" ? -1 : 0)) }))
        },
      ])
    )
    for (const [ev, fn] of Object.entries(handlers)) socket.on(ev, fn)
    world.setNet({
      emit: (event, payload) => net.request(event, payload),
      volatile: (event, payload) => socket.connected && socket.volatile.emit(event, payload),
    })
    const m = meRef.current || {}
    const rep = m.rep ? { level: repLevel(m.rep.points).index, wins: m.rep.wins, losses: m.rep.losses, streak: m.rep.streak } : null
    net.request("park:join", { look: m.look, rep, venue: world.venue || "riverside" }).then((r) => {
      if (!live) return
      if (r?.ok) {
        world.netJoined(r)
        setState({ joined: true, park: r.park, people: (r.people?.length || 0) + 1, error: null })
      } else {
        world.setNet(null)
        setState({ joined: false, park: null, people: 0, error: r?.error || null })
      }
    })
    return () => {
      live = false
      for (const [ev, fn] of Object.entries(handlers)) socket.off(ev, fn)
      if (socket.connected) socket.emit("park:leave", {}, () => {})
      world.setNet(null)
      setState({ joined: false, park: null, people: 0, error: null })
    }
  }, [active, world, socket, online])
  return { ...state, request: net?.request || null }
}
