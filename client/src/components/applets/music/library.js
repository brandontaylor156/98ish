// Music 98's library and queue logic: pure (no drive, no audio), tested in music.test.js.
//
// A track: { key (the song file's content hash), path, name, title, artist, album,
//   albumArtist, track, disc, year, genre, duration, art (art key) | null, added }

import { guessFromName } from "./tags.js"

export const UNKNOWN_ARTIST = "Unknown Artist"
export const UNKNOWN_ALBUM = "Unknown Album"

export const titleOf = (t) => t?.title || guessFromName(t?.name).title || t?.name || "Untitled"
export const artistOf = (t) => t?.artist || t?.albumArtist || UNKNOWN_ARTIST
export const albumOf = (t) => t?.album || UNKNOWN_ALBUM
const albumArtistOf = (t) => t?.albumArtist || t?.artist || UNKNOWN_ARTIST
export const albumKeyOf = (t) => `${albumArtistOf(t).toLowerCase()}|${albumOf(t).toLowerCase()}`

const byText = (a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true })
// "The Beatles" sorts under B
const sortName = (s) => String(s || "").replace(/^the\s+/i, "")

export const albumOrder = (a, b) => (a.disc || 1) - (b.disc || 1) || (a.track || 999) - (b.track || 999) || byText(titleOf(a), titleOf(b))

export const groupAlbums = (tracks) => {
  const map = new Map()
  for (const t of tracks) {
    const key = albumKeyOf(t)
    let a = map.get(key)
    if (!a) {
      a = { key, album: albumOf(t), artist: albumArtistOf(t), year: "", art: null, tracks: [] }
      map.set(key, a)
    }
    a.tracks.push(t)
    a.year ||= t.year || ""
    a.art ||= t.art || null
  }
  const list = [...map.values()]
  for (const a of list) a.tracks.sort(albumOrder)
  return list.sort((x, y) => byText(sortName(x.artist), sortName(y.artist)) || byText(x.album, y.album))
}

export const groupArtists = (tracks) => {
  const map = new Map()
  for (const t of tracks) {
    const name = artistOf(t)
    const key = name.toLowerCase()
    if (!map.has(key)) map.set(key, { key, name, tracks: [] })
    map.get(key).tracks.push(t)
  }
  const list = [...map.values()]
  for (const a of list) {
    a.tracks.sort((x, y) => byText(albumOf(x), albumOf(y)) || albumOrder(x, y))
    a.albums = new Set(a.tracks.map(albumKeyOf)).size
  }
  return list.sort((x, y) => byText(sortName(x.name), sortName(y.name)))
}

export const sortSongs = (tracks) => [...tracks].sort((a, b) => byText(titleOf(a), titleOf(b)) || byText(artistOf(a), artistOf(b)))

export const filterTracks = (tracks, query) => {
  const words = String(query || "").toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return tracks
  return tracks.filter((t) => {
    const hay = `${titleOf(t)} ${artistOf(t)} ${albumOf(t)} ${t.genre || ""} ${t.name || ""}`.toLowerCase()
    return words.every((w) => hay.includes(w))
  })
}

export const totalTime = (tracks) => tracks.reduce((s, t) => s + (t.duration || 0), 0)

export const clock = (seconds) => {
  const s = Math.max(0, Math.floor(Number(seconds) || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const pad = (n) => String(n).padStart(2, "0")
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`
}

export const longTime = (seconds) => {
  const m = Math.round((seconds || 0) / 60)
  return m >= 60 ? `${Math.floor(m / 60)} hr ${m % 60} min` : `${m} min`
}

// ---- the queue ----
// { keys: [...] (the list as picked), order: [...] (play order: the same, or shuffled),
//   pos: index into order }

// a shuffled copy with `first` kept in front (the song you tapped plays first)
export const shuffled = (keys, first = null, random = Math.random) => {
  const rest = keys.filter((k) => k !== first)
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[rest[i], rest[j]] = [rest[j], rest[i]]
  }
  return first !== null && keys.includes(first) ? [first, ...rest] : rest
}

export const makeQueue = (keys, startKey = null, shuffle = false, random = Math.random) => {
  const list = [...new Set(keys)]
  const first = startKey !== null && list.includes(startKey) ? startKey : (list[0] ?? null)
  if (shuffle) return { keys: list, order: shuffled(list, first, random), pos: 0 }
  return { keys: list, order: list, pos: Math.max(0, list.indexOf(first)) }
}

// turning shuffle on/off keeps the song that's playing
export const reshuffle = (queue, shuffle, random = Math.random) => {
  const now = queue.order[queue.pos] ?? null
  if (shuffle) {
    const order = shuffled(queue.keys, now, random)
    return { ...queue, order, pos: 0 }
  }
  return { ...queue, order: queue.keys, pos: Math.max(0, queue.keys.indexOf(now)) }
}

// repeat: "off" | "all" | "one". `auto` = the song ended by itself (repeat one replays it;
// pressing Next skips anyway). -> the next pos, or null (stop)
export const nextPos = (queue, repeat = "off", auto = false) => {
  if (!queue.order.length) return null
  if (auto && repeat === "one") return queue.pos
  if (queue.pos + 1 < queue.order.length) return queue.pos + 1
  return repeat === "off" ? null : 0
}

// Previous: back to the start if you're 3 s in, else the song before
export const prevPos = (queue, time = 0, repeat = "off") => {
  if (!queue.order.length) return null
  if (time > 3) return queue.pos
  if (queue.pos > 0) return queue.pos - 1
  return repeat === "all" ? queue.order.length - 1 : 0
}

// "Play Next" / "Add to Queue"
export const insertNext = (queue, key) => {
  const order = queue.order.filter((k, i) => k !== key || i === queue.pos)
  const pos = order.indexOf(queue.order[queue.pos])
  order.splice(pos + 1, 0, key)
  return { ...queue, keys: queue.keys.includes(key) ? queue.keys : [...queue.keys, key], order, pos }
}
export const append = (queue, key) => (queue.order.includes(key) ? queue : { ...queue, keys: [...queue.keys, key], order: [...queue.order, key] })

// the queue after a song left the library
export const dropKey = (queue, key) => {
  const at = queue.order.indexOf(key)
  if (at < 0) return queue
  const order = queue.order.filter((k) => k !== key)
  const pos = at < queue.pos ? queue.pos - 1 : Math.min(queue.pos, Math.max(0, order.length - 1))
  return { keys: queue.keys.filter((k) => k !== key), order, pos }
}
