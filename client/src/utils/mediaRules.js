// What happens to a song, video or PDF that comes in (Upload from Phone, dropped files, the
// share target, Music 98's Add Songs, Media Player's Add Videos). Pure: no fs, no React, so
// Node tests can check every rule (mediaRules.test.js).
//
// The rule (wave 2, 2026-10-08, "keep uploads as they are"): the file is kept exactly as it
// came: an MP3 stays an MP3 at full length (no 30-second WAV), videos and PDFs come in.
//  - Up to INLINE_MEDIA_BYTES (8 MB) it is a data URL in the drive like a photo, so file sync
//    can carry it when its folder syncs (sync's per-file limit is 12 MB of text = 9 MB of
//    bytes; Vercel Blob's free budget is the cap behind that, docs/storage-sync.md).
//  - Bigger files are kept as a Blob in the drive's IndexedDB ("device only"): never turned
//    into text, never uploaded. They'd blow the free online budget (1 GB for everyone), so
//    sync and Backup skip them and say so.
//  - Caps per kind (MEDIA_CAPS) are about the phone, not the server: a song up to 300 MB
//    (long mixes, audiobooks), a video up to 2 GB, a PDF up to 200 MB, and never more than
//    the storage this browser says is free (navigator.storage.estimate) minus some room.

export const MB = 1024 * 1024
export const INLINE_MEDIA_BYTES = 8 * MB
export const MEDIA_CAPS = { song: 300 * MB, movie: 2048 * MB, pdf: 200 * MB }
export const FREE_ROOM = 20 * MB // left free on the device after a file comes in

const SONG_NAME = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|weba)$/i
const MOVIE_NAME = /\.(mp4|m4v|mov|webm|ogv|3gp)$/i
const PDF_NAME = /\.pdf$/i

// A real file -> "song" | "movie" | "pdf" | null. A .webm/.mp4 says "video/..." when it's a
// video; an .m4a or an audio-only .webm says "audio/...".
export const mediaKindOf = ({ name = "", type = "" } = {}) => {
  const t = String(type).toLowerCase()
  if (t === "application/pdf" || PDF_NAME.test(name)) return "pdf"
  if (t.startsWith("video/")) return "movie"
  if (t.startsWith("audio/")) return "song"
  if (SONG_NAME.test(name)) return "song"
  if (MOVIE_NAME.test(name)) return "movie"
  return null
}

const MIME_BY_EXT = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  ogv: "video/ogg",
  "3gp": "video/3gpp",
  pdf: "application/pdf",
}
// the type to keep with a video or PDF (iPhone sometimes hands over "" or octet-stream)
export const mediaMime = ({ name = "", type = "" } = {}, kind = mediaKindOf({ name, type })) => {
  const t = String(type).toLowerCase().split(";")[0]
  if (t && t !== "application/octet-stream" && (kind !== "pdf" || t === "application/pdf")) return t
  const ext = (String(name).match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase()
  return MIME_BY_EXT[ext] || (kind === "pdf" ? "application/pdf" : kind === "movie" ? "video/mp4" : "audio/mpeg")
}

export const sizeText = (bytes) => (bytes >= 1024 * MB ? `${(bytes / 1024 / MB).toFixed(1).replace(/\.0$/, "")} GB` : bytes >= MB ? `${Math.round(bytes / MB)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)

const KIND_WORD = { song: "Songs", movie: "Videos", pdf: "PDFs" }

// How to keep one file -> { ok: true, store: "inline" | "device", deviceOnly, note }
//                       | { ok: false, error }
// free: bytes this browser says are left (null when it won't say); canDevice: false when
// there's no IndexedDB (then only small files fit).
export const planMediaStore = ({ kind, size, name = "That file", free = null, canDevice = true }) => {
  if (!MEDIA_CAPS[kind]) return { ok: false, error: `${name} isn't a song, video or PDF.` }
  if (!(size > 0)) return { ok: false, error: `${name} is empty.` }
  if (size > MEDIA_CAPS[kind]) return { ok: false, error: `${name} is ${sizeText(size)}. ${KIND_WORD[kind]} can be up to ${sizeText(MEDIA_CAPS[kind])}.` }
  if (free !== null && Number.isFinite(free) && size + FREE_ROOM > free) {
    return { ok: false, error: `${name} is ${sizeText(size)}, and this device only has room for ${sizeText(Math.max(0, free - FREE_ROOM))} more. Delete some files (and empty the Recycle Bin), then try again.` }
  }
  if (size <= INLINE_MEDIA_BYTES) return { ok: true, store: "inline", deviceOnly: false, note: null }
  if (!canDevice) return { ok: false, error: `${name} is ${sizeText(size)}. This browser isn't letting 98ish use its larger storage (a private window does this), so files over ${sizeText(INLINE_MEDIA_BYTES)} can't be kept.` }
  return { ok: true, store: "device", deviceOnly: true, note: deviceOnlyNote(name, size) }
}

export const deviceOnlyNote = (name, size) =>
  `${name} (${sizeText(size)}) is kept on this device only: files over ${sizeText(INLINE_MEDIA_BYTES)} aren't synced or included in backups.`

// The short line shown in Properties, Media Player and PDF Viewer for such a file
export const DEVICE_ONLY_LINE = `On this device only (over ${sizeText(INLINE_MEDIA_BYTES)}: not synced or backed up)`

// "Movie Night.MOV" -> "Movie Night"
export const titleFromName = (name) =>
  String(name || "")
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/[_]+/g, " ")
    .trim() || "Untitled"
