import { useEffect } from "react"
import { notify } from "../../../utils/notifications"
import { albumPrefs, getAlbumsState, openAlbum, refreshAlbums, setAlbumPrefs } from "../../../utils/albums"
import { activityText } from "./albumsCore"

// Lives on the desktop (inside 98 Messenger's provider), whether or not Photos is open:
//   - a buddy changed a shared album ("albums:changed" { id, by, what } on the 98 Messenger
//     socket): refresh the list (Photos' badge), and put news in the Notification Center
//     ("Tina added 3 photos", merged per album); push covers the times 98ish is closed
//   - once a day (after 9 in the morning), if turned on in Memories: "On this day" pictures
// (Signing on and off reaches utils/albums.js from AimContext, like Notes.)

const NEWS = new Set(["added", "commented", "invited", "removed", "deleted"])

const dayKey = () => new Date().toDateString()

const checkMemories = async () => {
  const prefs = albumPrefs()
  if (!prefs.memoriesNotify || prefs.memoriesDay === dayKey() || new Date().getHours() < 9) return
  const [{ drivePhotos }, { dailyNotice }] = await Promise.all([import("./library"), import("./memoriesCore")])
  setAlbumPrefs({ memoriesDay: dayKey() })
  const notice = dailyNotice(drivePhotos())
  if (!notice) return
  notify({ app: "photos", key: `memories-${dayKey()}`, title: notice.title, text: notice.text, target: { kind: "program", name: "Photos", extra: { handoff: { id: Date.now(), memories: true } } } })
}

const PhotosBridge = ({ socket }) => {
  useEffect(() => {
    if (!socket) return
    const onChanged = async (payload) => {
      const id = payload?.id
      if (!id) return
      const before = getAlbumsState().albums.find((a) => a.id === id)
      await refreshAlbums()
      if (getAlbumsState().details[id]) openAlbum(id)
      if (!NEWS.has(payload.what)) return
      const album = getAlbumsState().albums.find((a) => a.id === id)
      const me = getAlbumsState().me
      const target = { kind: "program", name: "Photos", extra: { handoff: { id: Date.now(), album: id } } }
      if (!album) {
        if (before) notify({ app: "photos", key: `album-${id}`, title: payload.what === "deleted" ? `${payload.by} deleted "${before.name}"` : `You're no longer in "${before.name}"`, text: "Shared album" })
        return
      }
      notify({ app: "photos", key: `album-${id}`, title: album.name, text: activityText(album, me) || `${payload.by} changed the album`, target })
    }
    socket.on("albums:changed", onChanged)
    return () => socket.off("albums:changed", onChanged)
  }, [socket])

  useEffect(() => {
    checkMemories().catch(() => {})
    const timer = setInterval(() => checkMemories().catch(() => {}), 30 * 60_000)
    return () => clearInterval(timer)
  }, [])
  return null
}

export default PhotosBridge
