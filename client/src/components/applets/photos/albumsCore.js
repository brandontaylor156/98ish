// Shared Albums, the pure parts (client/src/utils/albums.js is the store, Albums.jsx the
// screens, server/albums the server): the "new" badge, what an album's last change says,
// sizes for photos and previews, the upload queue's retry timing, who may do what.

export const PHOTO_SIDE = 2048 // long edge of a photo sent to an album
export const PHOTO_QUALITY = 0.82
export const PHOTO_MAX_BYTES = 1.5 * 1024 * 1024
export const THUMB_SIDE = 256
export const THUMB_MAX_CHARS = 24_000
export const VIDEO_MAX_BYTES = 12 * 1024 * 1024
export const VIDEO_MAX_SECONDS = 60
export const VIDEO_MIME = /^video\/(mp4|quicktime|webm)$/

// width/height fitted inside `side` (never enlarged)
export const fitWithin = (w, h, side) => {
  if (!w || !h) return { w: 0, h: 0 }
  const s = Math.min(1, side / Math.max(w, h))
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) }
}

// albums with something new from somebody else since I last opened them
export const isUnseen = (album, seen = {}, me = null) => !!album && !!album.lastBy && album.lastBy !== me && album.changedAt > (seen[album.id] || 0)
export const unseenCount = (albums = [], seen = {}, me = null) => albums.filter((a) => isUnseen(a, seen, me)).length

// "Tina added 3 photos" / "You commented: so cute" / "A member deleted their account"
export const activityText = (album, me = null) => {
  if (!album?.lastWhat) return ""
  if (!album.lastBy) return album.lastWhat
  return `${album.lastBy === me ? "You" : album.lastByName || album.lastBy} ${album.lastWhat}`
}

export const countText = (album) => {
  const n = album?.count || 0
  return n === 1 ? "1 item" : `${n} items`
}

export const membersText = (album, me = null) => {
  const others = (album?.members || []).filter((m) => m.key !== me).map((m) => m.name)
  if (!others.length) return "Only you so far"
  if (others.length <= 3) return `With ${others.join(", ")}`
  return `With ${others.slice(0, 2).join(", ")} and ${others.length - 2} others`
}

export const canRemoveItem = (album, item, me) => !!me && (item?.by === me || album?.owner === me)
export const canRemoveComment = (album, comment, me) => !!me && (comment?.by === me || album?.owner === me)

// the upload queue: wait longer after each failure (30 s, 1 min, 2 min ... at most 30 min);
// a hard error (too big, full, not a member) stops it until the person decides
export const retryDelay = (tries) => Math.min(30 * 60_000, 30_000 * 2 ** Math.max(0, tries - 1))
export const isHardError = (result) => !!result && !result.ok && !result.resting && !result.offline && [400, 403, 404, 413].includes(result.status)

export const queueText = (entries = []) => {
  const waiting = entries.filter((e) => !e.error)
  const failed = entries.length - waiting.length
  const parts = []
  if (waiting.length) parts.push(`${waiting.length} waiting to upload`)
  if (failed) parts.push(`${failed} couldn't be added`)
  return parts.join(", ")
}

export const likeText = (item, me, names = {}) => {
  const likes = item?.likes || []
  if (!likes.length) return ""
  const who = likes.map((k) => (k === me ? "You" : names[k] || k))
  return who.length <= 2 ? `${who.join(" and ")} liked this` : `${who[0]}, ${who[1]} and ${who.length - 2} more liked this`
}

export const ALBUM_NAME_MAX = 60
export const COMMENT_MAX = 300
