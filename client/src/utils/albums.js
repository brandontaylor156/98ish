import { useSyncExternalStore } from "react"
import { currentUserId, DEFAULT_ID, onUserRemoved } from "./users"
import { mediaBlob as driveMediaBlob, readContent } from "./fs"
import { dateFromName, exifDate, photoTime } from "../components/applets/photos/memoriesCore.js"
import {
  PHOTO_MAX_BYTES,
  PHOTO_QUALITY,
  PHOTO_SIDE,
  THUMB_MAX_CHARS,
  THUMB_SIDE,
  VIDEO_MAX_BYTES,
  VIDEO_MAX_SECONDS,
  VIDEO_MIME,
  fitWithin,
  isHardError,
  retryDelay,
  unseenCount,
} from "../components/applets/photos/albumsCore.js"

// Shared Albums on this device (server/albums is the server, Photos' Albums.jsx the screens):
//   - the albums I'm in (refreshed on sign on, when Photos opens one, and on "albums:changed"
//     from the 98 Messenger socket: AlbumsBridge), and which ones I've seen since they changed
//     (localStorage "98ish.albums", per 98ish user through the storage seam)
//   - IndexedDB "98ish-albums" (+ "-<user id>" for other 98ish users; deleted with the user):
//       thumbs  { pk: "<acct>|<item>", acct, data, at }   previews, fetched once
//       media   { pk: "<acct>|<item>", acct, blob, at }   full photos and videos (newest 150)
//       queue   { id, acct, albumId, albumName, blob, kind, mime, w, h, d, thumb, caption,
//                 taken, name, tries, nextAt, error }    uploads waiting (offline, resting)
//     without IndexedDB (some private windows) it's all in memory for the visit
// Uploads: photos are made 2048 px JPEG (quality 0.82, smaller if needed to fit 1.5 MB) with a
// 256 px preview; videos (MP4/MOV/WebM, 12 MB, a minute) go as they are with a frame for a
// preview. Each goes up as: ask the server -> PUT to the signed URL -> commit. A failure that
// may pass (offline, resting, the server asleep) waits 30 s, 1 min, 2 min ... (at most 30 min);
// one that won't (too big, album full, not a member) waits for the person (Retry / Remove).

export const SERVER_URL = import.meta.env?.VITE_SOCKET_URL || "http://localhost:8000"
const SEEN_KEY = "98ish.albums"
const DB = "98ish-albums"
const MAX_MEDIA = 150
const dbName = (id = currentUserId()) => (!id || id === DEFAULT_ID ? DB : `${DB}-${id}`)

onUserRemoved((id) => {
  try {
    if (typeof indexedDB !== "undefined" && id && id !== DEFAULT_ID) indexedDB.deleteDatabase(dbName(id))
  } catch {
    // gone already
  }
})

// ---------- IndexedDB ----------

const reqP = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
const mem = { thumbs: new Map(), media: new Map(), queue: new Map() }
let opening = null
let openedFor = null
const openDb = () => {
  const name = dbName()
  if (opening && openedFor === name) return opening
  openedFor = name
  opening = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null)
      const req = indexedDB.open(name, 1)
      req.onupgradeneeded = () => {
        const db = req.result
        db.createObjectStore("thumbs", { keyPath: "pk" }).createIndex("acct", "acct")
        const media = db.createObjectStore("media", { keyPath: "pk" })
        media.createIndex("acct", "acct")
        media.createIndex("at", "at")
        db.createObjectStore("queue", { keyPath: "id" }).createIndex("acct", "acct")
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return opening
}
const idbGet = async (store, key) => {
  const db = await openDb()
  if (!db) return mem[store].get(key) || null
  try {
    return (await reqP(db.transaction(store).objectStore(store).get(key))) || null
  } catch {
    return null
  }
}
const idbPut = async (store, value) => {
  const db = await openDb()
  if (!db) return void mem[store].set(value.pk || value.id, value)
  try {
    await reqP(db.transaction(store, "readwrite").objectStore(store).put(value))
  } catch {
    mem[store].set(value.pk || value.id, value)
  }
}
const idbDelete = async (store, key) => {
  mem[store].delete(key)
  const db = await openDb()
  if (!db) return
  try {
    await reqP(db.transaction(store, "readwrite").objectStore(store).delete(key))
  } catch {
    // ignore
  }
}
const idbAllFor = async (store, acct) => {
  const db = await openDb()
  const fromMem = [...mem[store].values()].filter((v) => v.acct === acct)
  if (!db) return fromMem
  try {
    return [...(await reqP(db.transaction(store).objectStore(store).index("acct").getAll(acct))), ...fromMem]
  } catch {
    return fromMem
  }
}
// keep the newest MAX_MEDIA full photos/videos
const trimMedia = async () => {
  const db = await openDb()
  if (!db) {
    const all = [...mem.media.values()].sort((a, b) => a.at - b.at)
    for (const v of all.slice(0, Math.max(0, all.length - MAX_MEDIA))) mem.media.delete(v.pk)
    return
  }
  try {
    const store = db.transaction("media", "readwrite").objectStore("media")
    const count = await reqP(store.count())
    if (count <= MAX_MEDIA) return
    let extra = count - MAX_MEDIA
    const cursorReq = store.index("at").openCursor()
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result
      if (!cursor || extra <= 0) return
      cursor.delete()
      extra--
      cursor.continue()
    }
  } catch {
    // ignore
  }
}

// ---------- state ----------

const readSeen = () => {
  try {
    const v = JSON.parse(localStorage.getItem(SEEN_KEY))
    return v && typeof v === "object" ? { seen: v.seen || {}, prefs: v.prefs || {} } : { seen: {}, prefs: {} }
  } catch {
    return { seen: {}, prefs: {} }
  }
}
let saved = readSeen()
let session = null // { token, key, name }
let state = { status: "off", albums: [], error: null, queue: [], details: {}, seen: saved.seen, me: null }
const listeners = new Set()
const emit = () => listeners.forEach((fn) => fn())
const set = (patch) => {
  state = { ...state, ...patch }
  emit()
}
const subscribe = (fn) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
export const getAlbumsState = () => state
export const useAlbums = () => useSyncExternalStore(subscribe, getAlbumsState)
export const albumsBadge = (s = state) => unseenCount(s.albums, s.seen, s.me)
export const albumsSignedOn = () => !!session

const saveSeen = () => {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify({ seen: state.seen, prefs: saved.prefs }))
  } catch {
    // this visit only
  }
}
export const markSeen = (id) => {
  const album = state.albums.find((a) => a.id === id) || state.details[id]?.album
  if (!album) return
  set({ seen: { ...state.seen, [id]: Math.max(album.changedAt || 0, Date.now()) } })
  saveSeen()
}
// Memories' settings ride along in the same key: { memoriesNotify, music, motion }
export const albumPrefs = () => saved.prefs
export const setAlbumPrefs = (patch) => {
  saved = { ...saved, prefs: { ...saved.prefs, ...patch } }
  saveSeen()
  emit()
}

// ---------- the server ----------

const api = async (method, path, body) => {
  if (!session) return { ok: false, signedOff: true, error: "Sign on to 98 Messenger to use shared albums." }
  try {
    const response = await fetch(`${SERVER_URL}/api/albums${path}`, {
      method,
      headers: { Authorization: `Bearer ${session.token}`, ...(method === "GET" ? {} : { "Content-Type": "application/json" }) },
      ...(method === "GET" ? {} : { body: JSON.stringify(body || {}) }),
    })
    const data = await response.json().catch(() => ({ ok: false, error: `The server had a problem (${response.status}).` }))
    return { ...data, status: response.status }
  } catch {
    return { ok: false, offline: true, error: "Couldn't reach the 98ish server. Try again in a minute." }
  }
}

export const refreshAlbums = async () => {
  if (!session) return { ok: false }
  if (!state.albums.length) set({ status: "loading" })
  const r = await api("GET", "/")
  if (r.ok) set({ status: "ready", albums: r.albums, error: null })
  else set({ status: state.albums.length ? "ready" : "error", error: r.error })
  return r
}

export const openAlbum = async (id) => {
  const r = await api("GET", `/${id}`)
  if (r.ok) {
    set({ details: { ...state.details, [id]: { album: r.album, items: r.items, at: Date.now() } }, albums: state.albums.some((a) => a.id === id) ? state.albums.map((a) => (a.id === id ? r.album : a)) : [r.album, ...state.albums] })
  } else if (r.status === 404) {
    const { [id]: drop, ...details } = state.details
    set({ details, albums: state.albums.filter((a) => a.id !== id) })
  }
  return r
}

const replaceAlbum = (album) => {
  if (!album) return
  set({ albums: state.albums.some((a) => a.id === album.id) ? state.albums.map((a) => (a.id === album.id ? album : a)) : [album, ...state.albums], details: state.details[album.id] ? { ...state.details, [album.id]: { ...state.details[album.id], album } } : state.details })
}
const dropAlbum = (id) => {
  const { [id]: drop, ...details } = state.details
  set({ albums: state.albums.filter((a) => a.id !== id), details })
}

export const createAlbum = async (name) => {
  const r = await api("POST", "/", { name })
  if (r.ok) {
    replaceAlbum(r.album)
    markSeen(r.album.id)
  }
  return r
}
export const renameAlbum = async (id, name) => {
  const r = await api("POST", `/${id}/rename`, { name })
  if (r.ok) replaceAlbum(r.album)
  return r
}
export const inviteToAlbum = async (id, to) => {
  const r = await api("POST", `/${id}/invite`, { to })
  if (r.ok) replaceAlbum(r.album)
  return r
}
export const removeFromAlbum = async (id, key) => {
  const r = await api("POST", `/${id}/remove`, { key })
  if (r.ok) replaceAlbum(r.album)
  return r
}
export const leaveAlbum = async (id) => {
  const r = await api("POST", `/${id}/leave`, {})
  if (r.ok) dropAlbum(id)
  return r
}
export const deleteAlbum = async (id) => {
  const r = await api("POST", `/${id}/delete`, {})
  if (r.ok) dropAlbum(id)
  return r
}

const patchItem = (albumId, itemId, fn) => {
  const d = state.details[albumId]
  if (!d) return
  set({ details: { ...state.details, [albumId]: { ...d, items: d.items.map((i) => (i.id === itemId ? fn(i) : i)) } } })
}
export const likeItem = async (albumId, itemId, on) => {
  const me = session?.key
  patchItem(albumId, itemId, (i) => ({ ...i, likes: on ? [...new Set([...i.likes, me])] : i.likes.filter((k) => k !== me) }))
  const r = await api("POST", `/${albumId}/items/${itemId}/like`, { on })
  if (r.ok) patchItem(albumId, itemId, (i) => ({ ...i, likes: r.likes }))
  else openAlbum(albumId)
  return r
}
export const commentOn = async (albumId, itemId, text) => {
  const r = await api("POST", `/${albumId}/items/${itemId}/comment`, { text })
  if (r.ok) patchItem(albumId, itemId, (i) => ({ ...i, comments: [...i.comments, r.comment] }))
  return r
}
export const deleteComment = async (albumId, itemId, cid) => {
  const r = await api("POST", `/${albumId}/items/${itemId}/uncomment`, { id: cid })
  if (r.ok) patchItem(albumId, itemId, (i) => ({ ...i, comments: i.comments.filter((c) => c.id !== cid) }))
  return r
}
export const removeItem = async (albumId, itemId) => {
  const r = await api("POST", `/${albumId}/items/${itemId}/remove`, {})
  if (r.ok) {
    const d = state.details[albumId]
    if (d) set({ details: { ...state.details, [albumId]: { ...d, items: d.items.filter((i) => i.id !== itemId) } } })
    idbDelete("media", `${session.key}|${itemId}`)
    openAlbum(albumId)
  }
  return r
}

// previews: device first, then the server 60 at a time -> { id: data URL }
const thumbMem = new Map()
export const thumbFor = (itemId) => thumbMem.get(itemId) || null
export const loadThumbs = async (albumId, ids) => {
  if (!session) return {}
  const acct = session.key
  const out = {}
  const missing = []
  for (const id of ids) {
    if (thumbMem.has(id)) {
      out[id] = thumbMem.get(id)
      continue
    }
    const hit = await idbGet("thumbs", `${acct}|${id}`)
    if (hit?.data) {
      thumbMem.set(id, hit.data)
      out[id] = hit.data
    } else missing.push(id)
  }
  for (let i = 0; i < missing.length; i += 60) {
    const r = await api("POST", `/${albumId}/thumbs`, { ids: missing.slice(i, i + 60) })
    if (!r.ok) break
    for (const [id, data] of Object.entries(r.thumbs || {})) {
      if (!data) continue
      thumbMem.set(id, data)
      out[id] = data
      idbPut("thumbs", { pk: `${acct}|${id}`, acct, data, at: Date.now() })
    }
  }
  if (missing.length) emit()
  return out
}

// the full photo or video as an object URL (fetched once per device)
const urlMem = new Map()
const loading = new Map()
export const mediaUrlFor = (itemId) => urlMem.get(itemId) || null
export const loadMedia = (albumId, item) => {
  if (!session) return Promise.resolve({ ok: false })
  if (urlMem.has(item.id)) return Promise.resolve({ ok: true, url: urlMem.get(item.id) })
  if (loading.has(item.id)) return loading.get(item.id)
  const acct = session.key
  const job = (async () => {
    const hit = await idbGet("media", `${acct}|${item.id}`)
    let blob = hit?.blob || null
    if (!blob) {
      const r = await api("POST", `/${albumId}/items/${item.id}/url`, {})
      if (!r.ok) return r
      try {
        const response = await fetch(r.url)
        if (!response.ok) return { ok: false, error: "That one couldn't be downloaded." }
        blob = new Blob([await response.arrayBuffer()], { type: r.mime || item.mime })
      } catch {
        return { ok: false, offline: true, error: "Couldn't download it. Check the connection." }
      }
      await idbPut("media", { pk: `${acct}|${item.id}`, acct, blob, at: Date.now() })
      trimMedia()
    } else idbPut("media", { ...hit, at: Date.now() })
    const url = URL.createObjectURL(blob)
    urlMem.set(item.id, url)
    emit()
    return { ok: true, url, blob }
  })().finally(() => loading.delete(item.id))
  loading.set(item.id, job)
  return job
}
export const mediaBlob = async (albumId, item) => {
  const r = await loadMedia(albumId, item)
  if (!r.ok) return null
  if (r.blob) return r.blob
  const hit = await idbGet("media", `${session.key}|${item.id}`)
  return hit?.blob || (await (await fetch(r.url)).blob())
}

// ---------- preparing photos and videos ----------

const loadImg = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image()
    img.decoding = "async"
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error("That picture couldn't be opened."))
    img.src = src
  })
const toBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality))
const draw = (source, w, h) => {
  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  const g = canvas.getContext("2d")
  g.fillStyle = "#fff"
  g.fillRect(0, 0, w, h)
  g.drawImage(source, 0, 0, w, h)
  return canvas
}
// a 256 px JPEG data URL under the server's limit
export const makeThumb = (source, sw, sh) => {
  for (const side of [THUMB_SIDE, 200, 160, 120]) {
    const { w, h } = fitWithin(sw, sh, side)
    const canvas = draw(source, w, h)
    for (const q of [0.72, 0.6, 0.45]) {
      const data = canvas.toDataURL("image/jpeg", q)
      if (data.length <= THUMB_MAX_CHARS) return data
    }
  }
  return null
}
const videoPlaceholder = () => {
  const canvas = document.createElement("canvas")
  canvas.width = 160
  canvas.height = 120
  const g = canvas.getContext("2d")
  g.fillStyle = "#000080"
  g.fillRect(0, 0, 160, 120)
  g.fillStyle = "#fff"
  g.beginPath()
  g.moveTo(66, 40)
  g.lineTo(100, 60)
  g.lineTo(66, 80)
  g.fill()
  return canvas.toDataURL("image/jpeg", 0.7)
}

const photoFromImage = async (img, taken, name) => {
  const sw = img.naturalWidth || img.width
  const sh = img.naturalHeight || img.height
  const { w, h } = fitWithin(sw, sh, PHOTO_SIDE)
  let canvas = draw(img, w, h)
  let blob = null
  for (const q of [PHOTO_QUALITY, 0.72, 0.6, 0.5]) {
    blob = await toBlob(canvas, "image/jpeg", q)
    if (blob && blob.size <= PHOTO_MAX_BYTES) break
  }
  if (!blob || blob.size > PHOTO_MAX_BYTES) {
    const smaller = fitWithin(sw, sh, 1400)
    canvas = draw(img, smaller.w, smaller.h)
    blob = await toBlob(canvas, "image/jpeg", 0.7)
  }
  if (!blob) throw new Error(`${name} couldn't be prepared.`)
  return { kind: "image", mime: "image/jpeg", blob, w: canvas.width, h: canvas.height, d: 0, thumb: makeThumb(canvas, canvas.width, canvas.height), taken, name }
}

const prepareVideo = (blob, name) =>
  new Promise((resolve, reject) => {
    const mime = String(blob.type || "").split(";")[0].toLowerCase() || (/\.mov$/i.test(name) ? "video/quicktime" : /\.webm$/i.test(name) ? "video/webm" : "video/mp4")
    if (!VIDEO_MIME.test(mime)) return reject(new Error(`${name}: albums take MP4, MOV and WebM videos.`))
    if (blob.size > VIDEO_MAX_BYTES) return reject(new Error(`${name} is too big for an album (12 MB at most). Try a shorter clip.`))
    const url = URL.createObjectURL(blob)
    const video = document.createElement("video")
    video.muted = true
    video.playsInline = true
    video.preload = "auto"
    let settled = false
    const finish = (meta) => {
      if (settled) return
      settled = true
      URL.revokeObjectURL(url)
      if (meta.d > VIDEO_MAX_SECONDS + 1) return reject(new Error(`${name} is longer than a minute. Albums take short videos.`))
      resolve({ kind: "video", mime, blob, w: meta.w, h: meta.h, d: meta.d, thumb: meta.thumb || videoPlaceholder(), taken: blob.lastModified || Date.now(), name })
    }
    const timer = setTimeout(() => finish({ w: 0, h: 0, d: 0 }), 6000) // can't decode it here: a plain preview
    video.onloadedmetadata = () => {
      video.currentTime = Math.min(0.5, (video.duration || 1) / 2)
    }
    video.onseeked = () => {
      clearTimeout(timer)
      const w = video.videoWidth
      const h = video.videoHeight
      let thumb = null
      try {
        thumb = w && h ? makeThumb(video, w, h) : null
      } catch {
        thumb = null
      }
      finish({ w, h, d: Math.round(video.duration || 0), thumb })
    }
    video.onerror = () => {
      clearTimeout(timer)
      finish({ w: 0, h: 0, d: 0 })
    }
    video.src = url
  })

// a picture on drive C: (an fs File), or a Blob/File from the device or the camera -> prepared
export const prepareUpload = async (source) => {
  if (source?.blob instanceof Blob || source instanceof Blob) {
    const blob = source.blob || source
    const name = source.name || blob.name || "Photo"
    if (String(blob.type).startsWith("video/") || /\.(mp4|mov|webm)$/i.test(name)) return prepareVideo(blob, name)
    let taken = null
    try {
      taken = exifDate(await blob.slice(0, 128 * 1024).arrayBuffer())
    } catch {
      taken = null
    }
    const url = URL.createObjectURL(blob)
    try {
      return await photoFromImage(await loadImg(url), taken || dateFromName(name) || blob.lastModified || Date.now(), name)
    } finally {
      URL.revokeObjectURL(url)
    }
  }
  const file = source?.file || source
  // a video on drive C: (Media Player's Videos): its original file, as it is
  if (file?.type === "movie") {
    const blob = await driveMediaBlob(file)
    if (!blob) throw new Error(`${file.name} isn't on this device any more.`)
    return prepareVideo(blob, file.name)
  }
  const data = await readContent(file)
  if (!data || !/^data:image\//.test(data)) throw new Error(`${file?.name || "That file"} isn't a picture.`)
  return photoFromImage(await loadImg(data), photoTime(file), file.name)
}

// ---------- the upload queue ----------

let pumping = false
let pumpTimer = null
const refreshQueue = async () => {
  if (!session) return set({ queue: [] })
  const entries = (await idbAllFor("queue", session.key)).sort((a, b) => a.added - b.added)
  set({ queue: entries.map(({ blob, thumb, ...rest }) => ({ ...rest, size: blob?.size || 0, thumb })) })
}

// put prepared photos/videos in the queue for an album and start sending
export const addToAlbum = async (albumId, sources, { caption = "" } = {}) => {
  if (!session) return { ok: false, error: "Sign on to 98 Messenger to use shared albums." }
  const albumName = state.albums.find((a) => a.id === albumId)?.name || "an album"
  const problems = []
  let added = 0
  for (const source of sources) {
    try {
      const p = source.prepared || (await prepareUpload(source))
      if (!p.thumb) throw new Error(`${p.name} couldn't get a preview.`)
      const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
      await idbPut("queue", { id, acct: session.key, albumId, albumName, blob: p.blob, kind: p.kind, mime: p.mime, w: p.w, h: p.h, d: p.d, thumb: p.thumb, caption, taken: p.taken, name: p.name, tries: 0, nextAt: 0, error: null, added: Date.now() })
      added++
    } catch (error) {
      problems.push(error.message || "That one couldn't be added.")
    }
  }
  await refreshQueue()
  pump()
  return { ok: added > 0, added, problems }
}

const sendOne = async (entry) => {
  const ticket = await api("POST", `/${entry.albumId}/upload`, { kind: entry.kind, mime: entry.mime, size: entry.blob.size, w: entry.w, h: entry.h, d: entry.d, thumb: entry.thumb, caption: entry.caption, taken: entry.taken })
  if (!ticket.ok) return ticket
  try {
    const put = await fetch(ticket.url, { method: ticket.method, headers: ticket.headers, body: entry.blob })
    if (!put.ok) return { ok: false, status: 503, error: "The upload didn't go through. It will try again." }
  } catch {
    return { ok: false, offline: true, error: "Couldn't upload. It will try again." }
  }
  const commit = await api("POST", `/${entry.albumId}/items/${ticket.item}/commit`, {})
  if (commit.ok) {
    // the photo is ours already: keep it so it never downloads again
    idbPut("media", { pk: `${session.key}|${ticket.item}`, acct: session.key, blob: entry.blob, at: Date.now() })
    thumbMem.set(ticket.item, entry.thumb)
    idbPut("thumbs", { pk: `${session.key}|${ticket.item}`, acct: session.key, data: entry.thumb, at: Date.now() })
  }
  return commit.ok ? commit : commit.status === 409 ? { ...commit, status: 503 } : commit
}

export const pump = async () => {
  if (pumping || !session) return
  pumping = true
  clearTimeout(pumpTimer)
  try {
    const acct = session.key
    const changed = new Set()
    for (;;) {
      if (!session || session.key !== acct) break
      const entries = (await idbAllFor("queue", acct)).filter((e) => !e.error).sort((a, b) => a.added - b.added)
      const now = Date.now()
      const next = entries.find((e) => (e.nextAt || 0) <= now)
      if (!next) {
        const soonest = Math.min(...entries.map((e) => e.nextAt || 0))
        if (Number.isFinite(soonest)) pumpTimer = setTimeout(pump, Math.max(1000, soonest - now))
        break
      }
      const r = await sendOne(next)
      if (r.ok) {
        await idbDelete("queue", next.id)
        changed.add(next.albumId)
      } else if (isHardError(r)) {
        await idbPut("queue", { ...next, error: r.error || "That one couldn't be added." })
      } else {
        const tries = (next.tries || 0) + 1
        await idbPut("queue", { ...next, tries, nextAt: Date.now() + retryDelay(tries), lastError: r.error || "" })
        if (r.offline || r.resting) {
          // everything else would fail the same way: wait
          const later = (await idbAllFor("queue", acct)).filter((e) => !e.error)
          for (const e of later) if (e.id !== next.id && (e.nextAt || 0) < Date.now() + retryDelay(tries)) await idbPut("queue", { ...e, nextAt: Date.now() + retryDelay(tries) })
        }
      }
      await refreshQueue()
    }
    for (const id of changed) if (state.details[id]) openAlbum(id)
    if (changed.size) refreshAlbums()
  } finally {
    pumping = false
  }
}
export const retryQueued = async (id) => {
  const e = await idbGet("queue", id)
  if (e) await idbPut("queue", { ...e, error: null, tries: 0, nextAt: 0 })
  await refreshQueue()
  pump()
}
export const retryAllNow = async () => {
  if (!session) return
  for (const e of await idbAllFor("queue", session.key)) if (!e.error) await idbPut("queue", { ...e, nextAt: 0 })
  pump()
}
export const discardQueued = async (id) => {
  await idbDelete("queue", id)
  await refreshQueue()
}

// ---------- signing on and off ----------

const keyOf = (name) => String(name || "").replace(/\s+/g, "").toLowerCase()
const onOnline = () => retryAllNow()
const onVisible = () => {
  if (document.visibilityState === "visible") {
    refreshAlbums()
    pump()
  }
}

// 98 Messenger signed on ({ token, screenName }) or off (null)
export const setAlbumsSession = (next) => {
  const key = next?.token ? keyOf(next.screenName) : null
  if (!key) {
    session = null
    clearTimeout(pumpTimer)
    if (typeof window !== "undefined") {
      window.removeEventListener("online", onOnline)
      document.removeEventListener("visibilitychange", onVisible)
    }
    for (const url of urlMem.values()) URL.revokeObjectURL(url)
    urlMem.clear()
    thumbMem.clear()
    set({ status: "off", albums: [], details: {}, queue: [], error: null, me: null })
    return
  }
  if (session?.token === next.token) return
  session = { token: next.token, key, name: next.screenName }
  if (typeof window !== "undefined") {
    window.addEventListener("online", onOnline)
    document.addEventListener("visibilitychange", onVisible)
  }
  set({ me: key, seen: readSeen().seen })
  refreshAlbums()
  refreshQueue().then(pump)
}

// Delete My Account: what this device kept for the account (previews, photos, queued uploads)
export const forgetAlbumsAccount = async (key) => {
  for (const store of ["thumbs", "media", "queue"]) {
    for (const v of await idbAllFor(store, key)) await idbDelete(store, v.pk || v.id)
  }
  try {
    localStorage.removeItem(SEEN_KEY)
  } catch {
    // ignore
  }
}

if (typeof window !== "undefined" && (import.meta.env?.DEV || import.meta.env?.VITE_TEST_HOOKS === "1")) {
  window.__albums = { state: () => state, refreshAlbums, openAlbum, addToAlbum, pump, createAlbum, inviteToAlbum, albumsBadge }
}
