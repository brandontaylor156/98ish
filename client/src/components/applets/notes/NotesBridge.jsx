import { useEffect } from "react"
import { notify } from "../../../utils/notifications"
import { notifyLocked } from "../../../utils/lock"
import { onRemoteChange, purgeExpired, syncNow } from "../../../utils/notes"
import { noteTitle } from "./notesCore"

// Lives on the desktop (inside 98 Messenger's provider), whether or not Notes is open:
//   - a buddy changed or shared a note ("notes:changed" { ids, by } on the 98 Messenger
//     socket): sync now, and put it in the Notification Center ("Tina changed Groceries")
//   - the Recycle Bin's 30 days run out while 98ish stays open
// (Signing on and off reaches utils/notes.js from AimContext, like the Address Book.)

const NotesBridge = ({ socket }) => {
  useEffect(() => {
    if (!socket) return
    const by = new Map() // note id -> who changed it (from the socket notice)
    const onChanged = (payload) => {
      for (const id of payload?.ids || []) by.set(id, payload.by)
      syncNow()
    }
    const off = onRemoteChange(({ id, note, share, isNew, wasShared }) => {
      if (!share && !wasShared) return // my own note from my other device: nothing to tell
      const who = by.get(id) || "Someone"
      by.delete(id)
      const title = noteTitle(note)
      notifyLocked()
      if (!share && wasShared) return
      notify({
        app: "notes",
        key: `note-${id}`,
        title: isNew ? `${who} shared a note with you` : `${who} changed "${title}"`,
        text: isNew ? title : "Shared note",
        target: { kind: "program", name: "Notes", extra: { handoff: { id: Date.now(), note: id } } },
      })
    })
    socket.on("notes:changed", onChanged)
    const timer = setInterval(() => purgeExpired(), 60 * 60_000)
    return () => {
      socket.off("notes:changed", onChanged)
      off()
      clearInterval(timer)
    }
  }, [socket])
  return null
}

export default NotesBridge
