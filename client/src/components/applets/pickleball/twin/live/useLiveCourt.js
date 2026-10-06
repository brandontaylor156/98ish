import { useEffect, useState } from "react"
import { useNet } from "../../../network/NetContext"
import { sampleAt } from "../core/tracker.js"
import { splitTicks } from "./packet.js"
import { createStream, DELAY } from "./stream.js"

// Live Broadcast in My Park: when a buddy is live on a court at the venue you're walking, the
// real players are there on that court (world.setLive), moving as they move, ~1 s behind.
// One live game at a time (the server lets a person watch one); none while you're elsewhere.
// -> the live game shown ({ id, host, courtName, title }) or null
export const useLiveCourt = ({ world, venue }) => {
  const net = useNet()
  const socket = net?.socket
  const online = net?.status === "online"
  const [shown, setShown] = useState(null)
  useEffect(() => {
    if (!world?.setLive || !venue || !socket || !online) return
    let alive = true
    let current = null // { id, stream, info }
    let feed = null
    const onTick = (b) => current?.stream.addTick(b)
    const onEv = (e) => current?.stream.addEvent(e)
    const onEnd = (d) => {
      if (current && d?.id === current.id) stop()
    }
    const stop = () => {
      clearInterval(feed)
      feed = null
      if (current && socket.connected) socket.emit("bc:unwatch", {}, () => {})
      current = null
      world.setLive(null, [])
      if (alive) setShown(null)
    }
    const look = async () => {
      if (current) return
      const r = await net.request("bc:list", {})
      const here = alive && r?.ok ? (r.live || []).find((b) => b.venue === venue) : null
      if (!here || current) return
      const w = await net.request("bc:watch", { id: here.id })
      if (!alive || !w?.ok) return
      const stream = createStream({ players: w.info.players })
      for (const e of w.events || []) stream.addEvent(e)
      for (const b of w.ring ? splitTicks(w.ring) : []) stream.addTick(b)
      current = { id: here.id, stream, info: w.info }
      setShown({ id: here.id, host: w.info.host, courtName: w.info.courtName, title: w.info.title })
      // ~20 times a second: everyone where they were DELAY seconds ago (smooth between ticks)
      feed = setInterval(() => {
        const s = current?.stream
        const t = s?.edge(DELAY)
        if (t === null || t === undefined) return
        const players = s.players.map((p, slot) => {
          const at = p.samples.length ? sampleAt(p.samples, t) : null
          return at ? { slot, name: p.name, x: at.x, z: at.z, vx: at.vx, vz: at.vz } : null
        })
        world.setLive(current.info.court, players.filter(Boolean), { title: `${current.info.host}'s game` })
      }, 50)
    }
    socket.on("bc:t", onTick)
    socket.on("bc:ev", onEv)
    socket.on("bc:end", onEnd)
    socket.on("bc:live", look)
    look()
    const poll = setInterval(look, 20000)
    return () => {
      alive = false
      clearInterval(poll)
      socket.off("bc:t", onTick)
      socket.off("bc:ev", onEv)
      socket.off("bc:end", onEnd)
      socket.off("bc:live", look)
      stop()
    }
  }, [world, venue, socket, online])
  return shown
}
