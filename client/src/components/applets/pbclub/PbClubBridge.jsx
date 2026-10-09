import { useEffect } from "react"
import { notify } from "../../../utils/notifications"
import { refreshSoon } from "../../../utils/pbclub"

// Lives on the desktop (inside 98 Messenger's provider) whether or not Pickleball 98's Real Games is
// open: the server's "pb:changed" notices refresh utils/pbclub.js, and an invitation or a
// match waiting for you goes in the Notification Center. (Pushes cover being away.)

const PbClubBridge = ({ socket }) => {
  useEffect(() => {
    if (!socket) return
    const onChanged = (p) => {
      // tournaments (utils/tourney.js): a partner invitation, the draw, a result
      if (p?.kind === "tourney") {
        import("../../../utils/tourney").then((m) => (m.refreshSoon(), p.id && m.getTourneys().docs[p.id] && m.open(p.id))).catch(() => {})
        if (p.partner) notify({ app: "pbclub", key: `pb-t-${p.id}`, title: `${p.by} wants you as a tournament partner`, text: "Accept in Pickleball 98 > Real Games > Tournaments.", target: { kind: "program", name: "Pickleball 98", extra: { handoff: { id: Date.now(), tourney: p.id } } } })
        return
      }
      refreshSoon()
      if (p?.invited && p.kind === "session") {
        notify({ app: "pbclub", key: `pb-s-${p.id}`, title: `${p.by} invited you to play pickleball`, text: "In or out? Open Real Games in Pickleball 98.", target: { kind: "program", name: "Pickleball 98", extra: { handoff: { id: Date.now(), session: p.id } } } })
      }
      if (p?.confirm && p.kind === "match") {
        notify({ app: "pbclub", key: `pb-m-${p.id}`, title: `${p.by} logged a match with you`, text: "Confirm the score so it counts.", target: { kind: "program", name: "Pickleball 98", extra: { handoff: { id: Date.now(), match: p.id } } } })
      }
    }
    // Live Broadcast: a buddy went live (server/broadcast bc:live)
    const onLive = (b) => {
      if (!b?.id) return
      notify({ app: "pbclub", key: `bc-${b.id}`, title: `${b.host} is live${b.court ? ` on court ${b.court}` : ""}`, text: `${b.title}. Watch it live in 3D.`, target: { kind: "program", name: "Pickleball 98", extra: { handoff: { id: Date.now(), live: b.id } } } })
    }
    socket.on("pb:changed", onChanged)
    socket.on("bc:live", onLive)
    return () => {
      socket.off("pb:changed", onChanged)
      socket.off("bc:live", onLive)
    }
  }, [socket])
  return null
}

export default PbClubBridge
