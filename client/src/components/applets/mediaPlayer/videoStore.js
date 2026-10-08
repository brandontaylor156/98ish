// Media Player's videos on this device.
// - The videos are drive files of type "movie" (the original MP4/MOV/WebM, never converted):
//   up to 8 MB a data URL, bigger a Blob kept on this device (utils/mediaFiles.js). Imports
//   go to C:\My Videos. The drive is the only copy.
// - What we know about each (title, length, size, poster) is kept in localStorage
//   "98ish.videos" (per user through the storage seam), keyed by the file's content hash, so
//   renaming or moving a video keeps it; posters are 320 px JPEGs in Music 98's art store
//   (IndexedDB "98ish-music", per user, deleted with the user).
// - Where you stopped each video ("resume"), for continue-where-you-left-off.

import { mediaBlob } from "../../../utils/fs"
import { keepMediaFile } from "../../../utils/mediaFiles"
import { titleFromName } from "../../../utils/mediaRules"
import { getArt, putArt, videoFiles } from "../music/musicStore"
import { posterSize, posterTime, withResume } from "./videoLib"

const KEY = "98ish.videos"

let data = null
const listeners = new Set()
let version = 0
const load = () => {
  if (data) return data
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "null")
    data = saved && typeof saved === "object" ? { videos: saved.videos || {}, resume: saved.resume || {} } : { videos: {}, resume: {} }
  } catch {
    data = { videos: {}, resume: {} }
  }
  return data
}
let saveTimer = null
const save = () => {
  version++
  listeners.forEach((fn) => fn())
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(data))
    } catch {
      // full: details are read again from the videos next time
    }
  }, 200)
}
export const subscribeVideos = (fn) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
export const videosVersion = () => version

// the library: [{ key, file, name, path, title, duration, w, h, poster, added, pending }]
export const listVideos = () => {
  const d = load()
  return videoFiles().map((file) => {
    const key = file.contentHash
    const meta = d.videos[key] || null
    return { key, file, name: file.name, path: file.path, title: meta?.title || titleFromName(file.name), ...(meta || {}), pending: !meta }
  })
}

// ---- reading a video: length, size and a poster frame ----

const grab = (url) =>
  new Promise((resolve) => {
    if (typeof document === "undefined") return resolve(null)
    const video = document.createElement("video")
    video.muted = true
    video.playsInline = true
    video.setAttribute("playsinline", "")
    video.preload = "auto"
    let done = false
    const finish = (value) => {
      if (done) return
      done = true
      clearTimeout(timer)
      video.removeAttribute("src")
      try {
        video.load()
      } catch {
        // fine
      }
      resolve(value)
    }
    const timer = setTimeout(() => finish(meta.d ? meta : null), 12_000)
    const meta = { d: 0, w: 0, h: 0, poster: null }
    // "length": some files (browser recordings) don't say how long they are until the end is
    // asked for; then "poster": the frame a second in
    let phase = "poster"
    const goTo = (t) => {
      try {
        video.currentTime = t
      } catch {
        finish(meta)
      }
    }
    video.onloadedmetadata = () => {
      meta.w = video.videoWidth
      meta.h = video.videoHeight
      if (Number.isFinite(video.duration)) {
        meta.d = video.duration
        goTo(posterTime(meta.d))
      } else {
        phase = "length"
        goTo(1e101)
      }
    }
    video.onseeked = () => {
      if (phase === "length") {
        meta.d = Number.isFinite(video.duration) ? video.duration : video.currentTime || 0
        phase = "poster"
        return goTo(posterTime(meta.d))
      }
      try {
        const size = posterSize(video.videoWidth, video.videoHeight)
        const canvas = document.createElement("canvas")
        canvas.width = size.w
        canvas.height = size.h
        canvas.getContext("2d").drawImage(video, 0, 0, size.w, size.h)
        meta.poster = canvas.toDataURL("image/jpeg", 0.8)
      } catch {
        meta.poster = null
      }
      finish(meta)
    }
    video.onerror = () => finish(meta.d ? meta : null)
    video.src = url
  })

const posterKey = (key) => `v${key}`
export const posterFor = (video) => (video?.poster ? getArt(video.poster) : Promise.resolve(null))

let queue = Promise.resolve()
// Read a video's details (in turn: one decoder at a time on a phone) -> the details or null
export const describeVideo = (file) => {
  const run = async () => {
    const key = file.contentHash
    if (load().videos[key]) return load().videos[key]
    const blob = await mediaBlob(file)
    if (!blob) return null
    const url = URL.createObjectURL(blob)
    let meta = null
    try {
      meta = await grab(url)
    } finally {
      URL.revokeObjectURL(url)
    }
    let poster = null
    if (meta?.poster) {
      await putArt(posterKey(key), meta.poster)
      poster = (await getArt(posterKey(key))) ? posterKey(key) : null
    }
    load().videos[key] = { title: titleFromName(file.name), duration: Math.round((meta?.d || 0) * 10) / 10, w: meta?.w || 0, h: meta?.h || 0, poster, bytes: blob.size, added: Date.now(), playable: !!meta }
    save()
    return load().videos[key]
  }
  const next = queue.then(run, run)
  queue = next.catch(() => null)
  return next
}

// details for videos that have none yet (synced, copied in, added before this): a few at a time
let reading = null
export const readPendingVideos = (list) => {
  if (reading) return reading
  const todo = list.filter((v) => v.pending).slice(0, 12)
  if (!todo.length) return Promise.resolve()
  reading = (async () => {
    for (const v of todo) await describeVideo(v.file).catch(() => null)
  })().finally(() => (reading = null))
  return reading
}

// Real video files -> C:\My Videos, as they are -> { added: [file], problems, notes }
export const importVideos = async (files, onProgress, into = null) => {
  const added = []
  const problems = []
  const notes = []
  const list = [...files]
  for (let i = 0; i < list.length; i++) {
    onProgress?.(i, list.length, list[i].name)
    const kept = await keepMediaFile(into, list[i], { kind: "movie" })
    if (!kept.ok) {
      problems.push(kept.error)
      continue
    }
    if (kept.note) notes.push(kept.note)
    added.push(kept.file)
    await describeVideo(kept.file).catch(() => null)
  }
  onProgress?.(list.length, list.length, "")
  return { added, problems, notes }
}

// ---- continue where you left off ----

export const getResume = (key) => load().resume[key] || null
export const saveResume = (key, t, d) => {
  const d0 = load()
  d0.resume = withResume(d0.resume, key, t, d)
  save()
}
export const clearResume = (key) => {
  const d0 = load()
  if (!d0.resume[key]) return
  delete d0.resume[key]
  save()
}

// forget videos no longer in the drive
export const tidyVideos = () => {
  const d = load()
  const keys = new Set(videoFiles().map((f) => f.contentHash))
  let changed = false
  for (const part of ["videos", "resume"])
    for (const k of Object.keys(d[part])) {
      if (!keys.has(k)) {
        delete d[part][k]
        changed = true
      }
    }
  if (changed) save()
}

export const _resetVideos = () => {
  data = null
}
