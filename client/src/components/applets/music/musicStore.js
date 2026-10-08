// Music 98's library on this device.
// - The songs themselves are files in the drive (type "song": the original MP3/M4A/..., never
//   converted or cut), so My Computer, Recycle Bin, Backup and file sync treat them like any
//   file. Up to 8 MB a song is a data URL; bigger ones (up to 300 MB) are kept as a Blob on
//   this device (utils/mediaFiles.js; not synced). Imports go to C:\My Music.
// - What's in them (title, artist, album, length, art) is read once and kept in localStorage
//   "98ish.music" (per user through the storage seam), keyed by the file's content hash, so
//   renaming or moving a song keeps its details.
// - Cover art: small JPEGs in IndexedDB "98ish-music" (+ "-<user id>" for other users),
//   deleted with the user (onUserRemoved).
// - Playlists and player settings: localStorage "98ish.music" too.

import { DIRECTORY_TYPE, FILE_TYPE, fs, mediaBlob } from "../../../utils/fs"
import { keepMediaFile } from "../../../utils/mediaFiles"
import { MEDIA_CAPS } from "../../../utils/mediaRules"
import { currentUserId, DEFAULT_ID, onUserRemoved } from "../../../utils/users"
import { guessFromName, mimeFor, parseTags, tagBytes } from "./tags"

const KEY = "98ish.music"
const DB = "98ish-music"
export const MAX_SONG_BYTES = MEDIA_CAPS.song
export const SONG_ACCEPT = "audio/*,.mp3,.m4a,.aac,.wav,.ogg,.oga,.opus,.flac,.webm"
const ART_PX = 256

const blank = () => ({ tracks: {}, playlists: [], prefs: { shuffle: false, repeat: "off", eq: { on: false, low: 0, mid: 0, high: 0 }, viz: false, view: "songs" } })

let data = null
const listeners = new Set()
const load = () => {
  if (data) return data
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "null")
    data = saved && typeof saved === "object" ? { ...blank(), ...saved, prefs: { ...blank().prefs, ...(saved.prefs || {}) } } : blank()
  } catch {
    data = blank()
  }
  return data
}
let saveTimer = null
const save = () => {
  listeners.forEach((fn) => fn())
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(data))
    } catch {
      // full: details are re-read from the songs next time
    }
  }, 200)
}
export const subscribeMusic = (fn) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
let version = 0
listeners.add(() => version++)
export const musicVersion = () => version

export const getPrefs = () => load().prefs
export const setPrefs = (patch) => {
  const d = load()
  d.prefs = { ...d.prefs, ...patch, eq: { ...d.prefs.eq, ...(patch.eq || {}) } }
  save()
}

// ---- cover art (IndexedDB) ----

const dbName = (id = currentUserId()) => (!id || id === DEFAULT_ID ? DB : `${DB}-${id}`)
onUserRemoved((id) => {
  try {
    if (typeof indexedDB !== "undefined" && id && id !== DEFAULT_ID) indexedDB.deleteDatabase(dbName(id))
  } catch {
    // gone
  }
})
const memArt = new Map() // without IndexedDB, and as a cache
let opening = null
const openDb = () => {
  if (typeof indexedDB === "undefined") return Promise.resolve(null)
  opening ||= new Promise((resolve) => {
    try {
      const req = indexedDB.open(dbName(), 1)
      req.onupgradeneeded = () => req.result.createObjectStore("art")
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return opening
}
export const putArt = async (key, url) => {
  memArt.set(key, url)
  const db = await openDb()
  if (!db) return
  try {
    db.transaction("art", "readwrite").objectStore("art").put(url, key)
  } catch {
    // kept in memory for the visit
  }
}
export const getArt = async (key) => {
  if (!key) return null
  if (memArt.has(key)) return memArt.get(key)
  const db = await openDb()
  if (!db) return null
  return new Promise((resolve) => {
    try {
      const req = db.transaction("art").objectStore("art").get(key)
      req.onsuccess = () => {
        if (req.result) memArt.set(key, req.result)
        resolve(req.result || null)
      }
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}
export const peekArt = (key) => (key ? memArt.get(key) || null : null)

// the picture in a song -> a 256 px JPEG data URL (or null)
const shrinkArt = async (picture) => {
  if (!picture?.data?.length || typeof document === "undefined") return null
  const blob = new Blob([picture.data], { type: picture.mime || "image/jpeg" })
  let bitmap
  try {
    bitmap = await createImageBitmap(blob)
  } catch {
    return null
  }
  const scale = Math.min(1, ART_PX / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close?.()
  return canvas.toDataURL("image/jpeg", 0.82)
}

// a short, stable key for a picture's bytes (albums share one copy)
const artKeyOf = (bytes) => {
  let h = 2166136261
  const step = Math.max(1, Math.floor(bytes.length / 4096))
  for (let i = 0; i < bytes.length; i += step) h = Math.imul(h ^ bytes[i], 16777619)
  return `a${(h >>> 0).toString(36)}${bytes.length.toString(36)}`
}

// ---- reading a song ----

// how long a song is, from the browser itself
const measure = (url) =>
  new Promise((resolve) => {
    if (typeof Audio === "undefined") return resolve(0)
    const a = new Audio()
    a.preload = "metadata"
    const done = (v) => {
      a.removeAttribute("src")
      try {
        a.load()
      } catch {
        // fine
      }
      resolve(v)
    }
    a.onloadedmetadata = () => done(Number.isFinite(a.duration) ? a.duration : 0)
    a.onerror = () => done(0)
    setTimeout(() => done(0), 8000)
    a.src = url
  })

// details for a song file: its tag bytes (tags.js tagBytes) and the whole file as a Blob
const describe = async (file, bytes, blob) => {
  const tags = parseTags(bytes)
  const guess = guessFromName(file.name)
  let art = null
  if (tags.picture) {
    const key = artKeyOf(tags.picture.data)
    if (!(await getArt(key))) {
      const shrunk = await shrinkArt(tags.picture)
      if (shrunk) await putArt(key, shrunk)
    }
    if (await getArt(key)) art = key
  }
  let duration = 0
  if (blob) {
    const blobUrl = URL.createObjectURL(blob.type ? blob : blob.slice(0, blob.size, mimeFor(file.name)))
    duration = await measure(blobUrl)
    URL.revokeObjectURL(blobUrl)
  }
  return {
    title: tags.title || guess.title,
    artist: tags.artist || guess.artist,
    album: tags.album,
    albumArtist: tags.albumArtist,
    track: tags.track || guess.track,
    disc: tags.disc,
    year: tags.year,
    genre: tags.genre,
    duration: Math.round(duration * 10) / 10,
    art,
    format: tags.format,
    added: Date.now(),
  }
}

// ---- the library ----

// every song file in the drive (not the Recycle Bin)
export const songFiles = () => {
  const out = []
  const walk = (dir) => {
    for (const item of dir.content) {
      if (item.isDirectory) walk(item)
      else if (item.type === FILE_TYPE.song) out.push(item)
    }
  }
  walk(fs.root)
  return out
}

// the library as tracks (songs without details yet show their file name until read)
export const listTracks = () => {
  const d = load()
  return songFiles().map((file) => {
    const key = file.contentHash
    const meta = d.tracks[key] || null
    return { key, path: file.path, name: file.name, file, ...(meta || {}), pending: !meta }
  })
}

// read the details of songs that don't have any yet (synced from another device, copied in)
let reading = null
export const readPending = (tracks, onEach) => {
  if (reading) return reading
  const todo = tracks.filter((t) => t.pending).slice(0, 50)
  if (!todo.length) return Promise.resolve()
  reading = (async () => {
    for (const t of todo) {
      try {
        const blob = await mediaBlob(t.file)
        if (!blob) continue
        load().tracks[t.key] = await describe(t.file, await tagBytes(blob), blob)
        save()
        onEach?.()
      } catch {
        // skip it
      }
    }
  })().finally(() => (reading = null))
  return reading
}

const musicFolder = () => {
  const c = fs.resolve(["C:"]) || fs.root
  return fs.resolve(["C:", "My Music"]) || fs.createDirectoryIn(c, "My Music", DIRECTORY_TYPE.folder)
}

const AUDIO_NAME = /\.(mp3|m4a|mp4|aac|wav|ogg|oga|opus|flac|weba|webm)$/i
export const isSongFile = (f) => /^audio\//i.test(f?.type || "") || AUDIO_NAME.test(f?.name || "")

// Real files from the phone or computer -> songs in C:\My Music, kept as they are (full
// length, original format) -> { added: [track], problems: [text], notes: [text] }
// (notes: "kept on this device only" for songs over 8 MB)
export const importSongs = async (files, onProgress, into = null) => {
  const added = []
  const problems = []
  const notes = []
  const list = [...files]
  const dir = into || musicFolder()
  for (let i = 0; i < list.length; i++) {
    const f = list[i]
    onProgress?.(i, list.length, f.name)
    if (!isSongFile(f)) {
      problems.push(`${f.name} isn't a song file.`)
      continue
    }
    try {
      // the right type, so every browser knows what it is
      const kept = await keepMediaFile(dir, f, { kind: "song", mime: mimeFor(f.name, f.type) })
      if (!kept.ok) {
        problems.push(kept.error)
        continue
      }
      if (kept.note) notes.push(kept.note)
      const file = kept.file
      const meta = await describe(file, await tagBytes(f), f)
      load().tracks[file.contentHash] = meta
      save()
      added.push({ key: file.contentHash, path: file.path, name: file.name, file, ...meta })
    } catch (error) {
      problems.push(`${f.name} couldn't be added (${error.message || "error"}).`)
    }
  }
  onProgress?.(list.length, list.length, "")
  return { added, problems, notes }
}

// details you typed (Edit Info...)
export const editTrack = (key, patch) => {
  const d = load()
  if (!d.tracks[key]) return
  d.tracks[key] = { ...d.tracks[key], ...patch }
  save()
}

// every video file in the drive (Media Player's Videos; playlists can hold both)
export const videoFiles = () => {
  const out = []
  const walk = (dir) => {
    for (const item of dir.content) {
      if (item.isDirectory) walk(item)
      else if (item.type === FILE_TYPE.movie) out.push(item)
    }
  }
  walk(fs.root)
  return out
}

// forget details of songs no longer in the drive (keeps the saved list small); playlists keep
// songs and videos that are still there
export const tidy = () => {
  const d = load()
  const keys = new Set(songFiles().map((f) => f.contentHash))
  const inLists = new Set([...keys, ...videoFiles().map((f) => f.contentHash)])
  let changed = false
  for (const k of Object.keys(d.tracks)) {
    if (!keys.has(k)) {
      delete d.tracks[k]
      changed = true
    }
  }
  for (const p of d.playlists) {
    const before = p.keys.length
    p.keys = p.keys.filter((k) => inLists.has(k))
    if (p.keys.length !== before) changed = true
  }
  if (changed) save()
}

// ---- playlists ----

export const playlists = () => load().playlists
export const createPlaylist = (name, keys = []) => {
  const p = { id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: String(name || "").trim().slice(0, 60) || "New Playlist", keys: [...new Set(keys)] }
  load().playlists.push(p)
  save()
  return p
}
export const renamePlaylist = (id, name) => {
  const p = load().playlists.find((x) => x.id === id)
  if (p) p.name = String(name || "").trim().slice(0, 60) || p.name
  save()
}
export const deletePlaylist = (id) => {
  const d = load()
  d.playlists = d.playlists.filter((x) => x.id !== id)
  save()
}
export const addToPlaylist = (id, keys) => {
  const p = load().playlists.find((x) => x.id === id)
  if (!p) return
  p.keys = [...new Set([...p.keys, ...keys])]
  save()
}
export const removeFromPlaylist = (id, key) => {
  const p = load().playlists.find((x) => x.id === id)
  if (!p) return
  p.keys = p.keys.filter((k) => k !== key)
  save()
}
export const movePlaylistItem = (id, from, to) => {
  const p = load().playlists.find((x) => x.id === id)
  if (!p || from < 0 || from >= p.keys.length) return
  const [k] = p.keys.splice(from, 1)
  p.keys.splice(Math.max(0, Math.min(p.keys.length, to)), 0, k)
  save()
}

// the song's file by its key, for playing
export const fileFor = (key) => songFiles().find((f) => f.contentHash === key) || null
export const trackFor = (key) => {
  const file = fileFor(key)
  if (!file) return null
  const meta = load().tracks[key] || {}
  return { key, path: file.path, name: file.name, file, ...meta }
}

// tests
export const _reset = () => {
  data = null
  memArt.clear()
}
