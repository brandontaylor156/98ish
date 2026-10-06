// Twin Replay's saved games, on this device only: IndexedDB "98ish-twin" (+ "-<user id>" for
// other profiles; deleted with the profile through the storage seam). Two stores:
// - games: { id, title, created, duration, venue, court, taps, players (names/hands), analysis, thumb (small JPEG data URL), shared (from a friend: no video) }
// - videos: the recording itself (a Blob), never uploaded anywhere
// Limits: MAX_GAMES games; the oldest videos go first when the device says it's full.

import { currentUserId, DEFAULT_ID, onUserRemoved } from "../../../../utils/users"

const DB = "98ish-twin"
export const MAX_GAMES = 40
const dbName = (id = currentUserId()) => (!id || id === DEFAULT_ID ? DB : `${DB}-${id}`)

onUserRemoved((id) => {
  try {
    if (typeof indexedDB !== "undefined" && id && id !== DEFAULT_ID) indexedDB.deleteDatabase(dbName(id))
  } catch {
    // gone
  }
})

let opening = null
const openDb = () => {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("This browser can't keep games."))
  opening ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName(), 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore("games", { keyPath: "id" })
      req.result.createObjectStore("videos")
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => {
      opening = null
      reject(req.error)
    }
  })
  return opening
}
const tx = async (store, mode, fn) => {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode)
    const s = t.objectStore(store)
    let out
    Promise.resolve(fn(s)).then((v) => (out = v))
    t.oncomplete = () => resolve(out)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error || new Error("aborted"))
  })
}
const req = (r) => new Promise((resolve, reject) => ((r.onsuccess = () => resolve(r.result)), (r.onerror = () => reject(r.error))))

export const listGames = async () => {
  const all = await tx("games", "readonly", (s) => req(s.getAll()))
  // (the list doesn't need every track)
  return (all || []).map(({ analysis, ...g }) => ({ ...g, rallies: analysis?.rallies?.length || 0, shots: analysis?.stats?.shots || 0 })).sort((a, b) => b.created - a.created)
}
export const getGame = (id) => tx("games", "readonly", (s) => req(s.get(id)))
export const putGame = async (game) => {
  const count = (await tx("games", "readonly", (s) => req(s.count()))) || 0
  const exists = await getGame(game.id)
  if (!exists && count >= MAX_GAMES) throw new Error(`You can keep ${MAX_GAMES} games. Delete one first.`)
  await tx("games", "readwrite", (s) => req(s.put(game)))
  return game
}
export const deleteGame = async (id) => {
  await tx("games", "readwrite", (s) => req(s.delete(id)))
  await tx("videos", "readwrite", (s) => req(s.delete(id)))
}
export const putVideo = (id, blob) => tx("videos", "readwrite", (s) => req(s.put(blob, id)))
export const getVideo = (id) => tx("videos", "readonly", (s) => req(s.get(id)))
export const newId = () => `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
