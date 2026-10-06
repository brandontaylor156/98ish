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
      refreshSoon()
      if (p?.invited && p.kind === "session") {
        notify({ app: "pbclub", key: `pb-s-${p.id}`, title: `${p.by} invited you to play pickleball`, text: "In or out? Open Real Games in Pickleball 98.", target: { kind: "program", name: "Pickleball 98", extra: { handoff: { id: Date.now(), session: p.id } } } })
      }
      if (p?.confirm && p.kind === "match") {
        notify({ app: "pbclub", key: `pb-m-${p.id}`, title: `${p.by} logged a match with you`, text: "Confirm the score so it counts.", target: { kind: "program", name: "Pickleball 98", extra: { handoff: { id: Date.now(), match: p.id } } } })
      }
    }
    socket.on("pb:changed", onChanged)
    return () => socket.off("pb:changed", onChanged)
  }, [socket])
  return null
}

export default PbClubBridge
