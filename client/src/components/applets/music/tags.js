// Song tags from the file's own bytes: ID3v2 (2.2, 2.3, 2.4) and ID3v1 (MP3), MP4/M4A
// atoms (iTunes "ilst"), FLAC and Ogg Vorbis/Opus comments. Pure: give it a Uint8Array (the
// whole file, or at least the start; ID3v1 needs the end), get back
//   { format, title, artist, album, albumArtist, track, trackTotal, disc, year, genre,
//     picture: { mime, data: Uint8Array } | null }
// Missing fields are "" / 0. Never throws on a broken file: it returns what it found.

const EMPTY = () => ({ format: "", title: "", artist: "", album: "", albumArtist: "", track: 0, trackTotal: 0, disc: 0, year: "", genre: "", picture: null })

const latin1 = (b, start = 0, end = b.length) => {
  let s = ""
  for (let i = start; i < end; i++) s += String.fromCharCode(b[i])
  return s
}
const decoderFor = (label) => {
  try {
    return new TextDecoder(label)
  } catch {
    return null
  }
}
const UTF8 = decoderFor("utf-8")
const UTF16LE = decoderFor("utf-16le")
const UTF16BE = decoderFor("utf-16be")
const utf8 = (b, start = 0, end = b.length) => (UTF8 ? UTF8.decode(b.subarray(start, end)) : latin1(b, start, end))
const clean = (s) =>
  String(s || "")
    .replace(/\u0000+$/g, "")
    .replace(/\u0000/g, " / ")
    .replace(/^﻿/, "")
    .trim()

const u32 = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0
const u24 = (b, i) => (b[i] << 16) | (b[i + 1] << 8) | b[i + 2]
const u32le = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0
const syncsafe = (b, i) => ((b[i] & 0x7f) << 21) | ((b[i + 1] & 0x7f) << 14) | ((b[i + 2] & 0x7f) << 7) | (b[i + 3] & 0x7f)

// "3/12" -> [3, 12]
const numPair = (s) => {
  const m = String(s || "").match(/^\s*(\d+)(?:\s*\/\s*(\d+))?/)
  return m ? [Number(m[1]) || 0, Number(m[2]) || 0] : [0, 0]
}

// ID3v1 genre numbers ("(17)" in old tags)
const GENRES = ["Blues", "Classic Rock", "Country", "Dance", "Disco", "Funk", "Grunge", "Hip-Hop", "Jazz", "Metal", "New Age", "Oldies", "Other", "Pop", "R&B", "Rap", "Reggae", "Rock", "Techno", "Industrial", "Alternative", "Ska", "Death Metal", "Pranks", "Soundtrack", "Euro-Techno", "Ambient", "Trip-Hop", "Vocal", "Jazz+Funk", "Fusion", "Trance", "Classical", "Instrumental", "Acid", "House", "Game", "Sound Clip", "Gospel", "Noise", "AlternRock", "Bass", "Soul", "Punk", "Space", "Meditative", "Instrumental Pop", "Instrumental Rock", "Ethnic", "Gothic", "Darkwave", "Techno-Industrial", "Electronic", "Pop-Folk", "Eurodance", "Dream", "Southern Rock", "Comedy", "Cult", "Gangsta", "Top 40", "Christian Rap", "Pop/Funk", "Jungle", "Native American", "Cabaret", "New Wave", "Psychedelic", "Rave", "Showtunes", "Trailer", "Lo-Fi", "Tribal", "Acid Punk", "Acid Jazz", "Polka", "Retro", "Musical", "Rock & Roll", "Hard Rock"]
const genreName = (g) => {
  const s = clean(g)
  const m = s.match(/^\((\d+)\)(.*)$/) || s.match(/^(\d+)$/)
  if (m) return clean(m[2]) || GENRES[Number(m[1])] || ""
  return s
}

// ---- ID3v2 ----

// text in one of ID3's four encodings
const id3Text = (b, start, end) => {
  if (end <= start) return ""
  const enc = b[start]
  const body = b.subarray(start + 1, end)
  if (enc === 0) return clean(latin1(body))
  if (enc === 3) return clean(utf8(body))
  if (enc === 1) {
    // UTF-16 with a byte order mark
    if (body[0] === 0xfe && body[1] === 0xff) return clean(UTF16BE ? UTF16BE.decode(body.subarray(2)) : "")
    if (body[0] === 0xff && body[1] === 0xfe) return clean(UTF16LE ? UTF16LE.decode(body.subarray(2)) : "")
    return clean(UTF16LE ? UTF16LE.decode(body) : "")
  }
  if (enc === 2) return clean(UTF16BE ? UTF16BE.decode(body) : "")
  return clean(latin1(b, start, end))
}

// where a terminated string in `enc` ends (and the next field starts)
const skipString = (b, i, end, enc) => {
  if (enc === 1 || enc === 2) {
    while (i + 1 < end && !(b[i] === 0 && b[i + 1] === 0)) i += 2
    return Math.min(end, i + 2)
  }
  while (i < end && b[i] !== 0) i++
  return Math.min(end, i + 1)
}

const unsync = (b) => {
  const out = new Uint8Array(b.length)
  let n = 0
  for (let i = 0; i < b.length; i++) {
    out[n++] = b[i]
    if (b[i] === 0xff && b[i + 1] === 0x00) i++
  }
  return out.subarray(0, n)
}

const parseId3v2 = (bytes, tags) => {
  if (bytes.length < 10 || latin1(bytes, 0, 3) !== "ID3") return 0
  const major = bytes[3]
  const flags = bytes[5]
  const size = syncsafe(bytes, 6)
  const total = 10 + size + (flags & 0x10 ? 10 : 0)
  if (major < 2 || major > 4) return total
  let b = bytes.subarray(10, Math.min(bytes.length, 10 + size))
  // whole-tag unsynchronisation (2.2/2.3; 2.4 does it per frame)
  if (flags & 0x80 && major < 4) b = unsync(b)
  let i = 0
  if (flags & 0x40 && major >= 3) i += major === 4 ? syncsafe(b, 0) : u32(b, 0) + 4 // extended header
  const idLen = major === 2 ? 3 : 4
  const headLen = major === 2 ? 6 : 10
  const text = {}
  while (i + headLen <= b.length) {
    const id = latin1(b, i, i + idLen)
    if (!/^[A-Z0-9]{3,4}$/.test(id)) break
    const fsize = major === 2 ? u24(b, i + 3) : major === 4 ? syncsafe(b, i + 4) : u32(b, i + 4)
    const fflags = major === 2 ? 0 : b[i + 9]
    const start = i + headLen
    const end = Math.min(b.length, start + fsize)
    if (fsize <= 0 || start >= b.length) break
    let frame = b.subarray(start, end)
    if (major === 4 && fflags & 0x02) frame = unsync(frame)
    // 2.4 "data length indicator" adds 4 bytes in front
    if (major === 4 && fflags & 0x01) frame = frame.subarray(4)
    const compressedOrEncrypted = major === 3 ? fflags & 0xc0 : major === 4 ? fflags & 0x0c : 0
    if (!compressedOrEncrypted) {
      if (id[0] === "T" && id !== "TXXX" && id !== "TXX") text[id] = id3Text(frame, 0, frame.length)
      else if ((id === "APIC" || id === "PIC") && !tags.picture) {
        const enc = frame[0]
        let p = 1
        let mime
        if (id === "PIC") {
          const fmt = latin1(frame, 1, 4).toUpperCase()
          mime = fmt === "PNG" ? "image/png" : "image/jpeg"
          p = 4
        } else {
          const mEnd = skipString(frame, 1, frame.length, 0)
          mime = latin1(frame, 1, mEnd - 1).toLowerCase() || "image/jpeg"
          if (!mime.includes("/")) mime = `image/${mime === "jpg" ? "jpeg" : mime}`
          p = mEnd
        }
        const picType = frame[p]
        p = skipString(frame, p + 1, frame.length, enc) // description
        const data = frame.slice(p)
        // the front cover (3) wins; otherwise the first picture
        if (data.length > 16 && (picType === 3 || !tags.picture)) tags.picture = { mime, data }
      }
    }
    i = end
  }
  const pick = (...ids) => ids.map((k) => text[k]).find(Boolean) || ""
  tags.title = pick("TIT2", "TT2")
  tags.artist = pick("TPE1", "TP1")
  tags.album = pick("TALB", "TAL")
  tags.albumArtist = pick("TPE2", "TP2")
  ;[tags.track, tags.trackTotal] = numPair(pick("TRCK", "TRK"))
  tags.disc = numPair(pick("TPOS", "TPA"))[0]
  tags.year = (pick("TDRC", "TYER", "TYE", "TDOR").match(/\d{4}/) || [""])[0]
  tags.genre = genreName(pick("TCON", "TCO"))
  return total
}

const parseId3v1 = (b, tags) => {
  if (b.length < 128) return
  const t = b.length - 128
  if (latin1(b, t, t + 3) !== "TAG") return
  const field = (s, n) => clean(latin1(b, t + s, t + s + n))
  tags.title ||= field(3, 30)
  tags.artist ||= field(33, 30)
  tags.album ||= field(63, 30)
  tags.year ||= field(93, 4)
  if (!tags.track && b[t + 125] === 0 && b[t + 126]) tags.track = b[t + 126]
  if (!tags.genre && b[t + 127] < GENRES.length) tags.genre = GENRES[b[t + 127]]
}

// ---- MP4 / M4A ----

const CONTAINERS = new Set(["moov", "udta", "ilst", "trak", "mdia", "minf", "stbl"])
const parseMp4 = (b, tags) => {
  if (b.length < 12 || latin1(b, 4, 8) !== "ftyp") return false
  tags.format = "mp4"
  const walk = (start, end, path) => {
    let i = start
    while (i + 8 <= end) {
      let size = u32(b, i)
      const type = latin1(b, i + 4, i + 8)
      let head = 8
      if (size === 1) {
        size = u32(b, i + 8) * 2 ** 32 + u32(b, i + 12)
        head = 16
      } else if (size === 0) size = end - i
      if (size < head || i + size > end + 1e9) break
      const stop = Math.min(end, i + size)
      if (type === "meta") walk(i + head + 4, stop, [...path, type]) // a full box: 4 bytes of version/flags
      else if (CONTAINERS.has(type)) walk(i + head, stop, [...path, type])
      else if (path.at(-1) === "ilst") item(type, i + head, stop)
      i += size
      if (size <= 0) break
    }
  }
  // an ilst item holds a "data" box: type(4) locale(4) value
  const item = (type, start, end) => {
    let i = start
    while (i + 16 <= end) {
      const size = u32(b, i)
      if (latin1(b, i + 4, i + 8) === "data" && size >= 16) {
        const kind = u32(b, i + 8) & 0xffffff
        const v = b.subarray(i + 16, Math.min(end, i + size))
        const s = () => clean(utf8(v))
        switch (type) {
          case "©nam":
            tags.title = s()
            break
          case "©ART":
            tags.artist = s()
            break
          case "©alb":
            tags.album = s()
            break
          case "aART":
            tags.albumArtist = s()
            break
          case "©day":
            tags.year = (s().match(/\d{4}/) || [""])[0]
            break
          case "©gen":
            tags.genre = s()
            break
          case "gnre":
            if (v.length >= 2) tags.genre ||= GENRES[((v[0] << 8) | v[1]) - 1] || ""
            break
          case "trkn":
            if (v.length >= 6) {
              tags.track = (v[2] << 8) | v[3]
              tags.trackTotal = (v[4] << 8) | v[5]
            }
            break
          case "disk":
            if (v.length >= 4) tags.disc = (v[2] << 8) | v[3]
            break
          case "covr":
            if (!tags.picture && v.length > 16) tags.picture = { mime: kind === 14 ? "image/png" : "image/jpeg", data: v.slice() }
            break
          default:
        }
        return
      }
      if (size < 8) return
      i += size
    }
  }
  walk(0, b.length, [])
  return true
}

// ---- Vorbis comments (FLAC, Ogg) ----

const vorbisComments = (b, start, end, tags) => {
  let i = start
  const vlen = u32le(b, i)
  i += 4 + vlen
  const count = u32le(b, i)
  i += 4
  const fields = {}
  for (let n = 0; n < count && i + 4 <= end; n++) {
    const len = u32le(b, i)
    i += 4
    const entry = utf8(b, i, Math.min(end, i + len))
    i += len
    const eq = entry.indexOf("=")
    if (eq > 0) {
      const key = entry.slice(0, eq).toUpperCase()
      if (!fields[key]) fields[key] = clean(entry.slice(eq + 1))
      if (key === "METADATA_BLOCK_PICTURE" && !tags.picture) {
        try {
          const raw = Uint8Array.from(atob(entry.slice(eq + 1)), (c) => c.charCodeAt(0))
          flacPicture(raw, 0, raw.length, tags)
        } catch {
          // not base64
        }
      }
    }
  }
  tags.title ||= fields.TITLE || ""
  tags.artist ||= fields.ARTIST || ""
  tags.album ||= fields.ALBUM || ""
  tags.albumArtist ||= fields.ALBUMARTIST || fields["ALBUM ARTIST"] || ""
  if (!tags.track) [tags.track, tags.trackTotal] = numPair(fields.TRACKNUMBER)
  tags.trackTotal ||= Number(fields.TRACKTOTAL || fields.TOTALTRACKS) || 0
  tags.disc ||= numPair(fields.DISCNUMBER)[0]
  tags.year ||= (String(fields.DATE || fields.YEAR || "").match(/\d{4}/) || [""])[0]
  tags.genre ||= fields.GENRE || ""
}

const flacPicture = (b, start, end, tags) => {
  let i = start
  const type = u32(b, i)
  const mlen = u32(b, i + 4)
  const mime = latin1(b, i + 8, i + 8 + mlen) || "image/jpeg"
  i += 8 + mlen
  const dlen = u32(b, i)
  i += 4 + dlen + 16
  const len = u32(b, i)
  i += 4
  if (i + len <= end && len > 16 && (type === 3 || !tags.picture)) tags.picture = { mime, data: b.slice(i, i + len) }
}

const parseFlac = (b, tags, offset = 0) => {
  if (latin1(b, offset, offset + 4) !== "fLaC") return false
  tags.format = "flac"
  let i = offset + 4
  while (i + 4 <= b.length) {
    const last = b[i] & 0x80
    const type = b[i] & 0x7f
    const len = u24(b, i + 1)
    const start = i + 4
    const end = Math.min(b.length, start + len)
    if (type === 4) vorbisComments(b, start, end, tags)
    else if (type === 6) flacPicture(b, start, end, tags)
    i = end
    if (last) break
  }
  return true
}

// the comment packet near the start of an Ogg stream (good enough for tags: it's packet 2,
// usually inside the first few pages; a picture spanning pages is skipped)
const parseOgg = (b, tags) => {
  if (latin1(b, 0, 4) !== "OggS") return false
  tags.format = "ogg"
  const limit = Math.min(b.length, 512 * 1024)
  for (let i = 0; i < limit - 8; i++) {
    if (b[i] === 0x03 && latin1(b, i + 1, i + 7) === "vorbis") {
      vorbisComments(b, i + 7, limit, tags)
      return true
    }
    if (b[i] === 0x4f && latin1(b, i, i + 8) === "OpusTags") {
      vorbisComments(b, i + 8, limit, tags)
      return true
    }
  }
  return true
}

export const parseTags = (input) => {
  const tags = EMPTY()
  const b = input instanceof Uint8Array ? input : new Uint8Array(input || [])
  try {
    if (parseMp4(b, tags)) return tags
    if (parseOgg(b, tags)) return tags
    const after = parseId3v2(b, tags)
    if (parseFlac(b, tags, after)) return tags
    tags.format = after || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) ? "mp3" : latin1(b, 0, 4) === "RIFF" ? "wav" : ""
    parseId3v1(b, tags)
  } catch {
    // a broken file: what we have so far
  }
  return tags
}

// "02 - Some Song.mp3" -> { track: 2, title: "Some Song" }; "Artist - Title.mp3" -> both
export const guessFromName = (name) => {
  let base = String(name || "").replace(/\.[a-z0-9]{2,5}$/i, "").replace(/_/g, " ").trim()
  let track = 0
  const t = base.match(/^(\d{1,3})[\s.\-_)]+(.+)$/)
  if (t) {
    track = Number(t[1])
    base = t[2].trim()
  }
  const parts = base.split(/\s+-\s+/)
  if (parts.length >= 2) return { track, artist: parts[0].trim(), title: parts.slice(1).join(" - ").trim() }
  return { track, artist: "", title: base }
}

export const mimeFor = (name, type = "") => {
  if (type && /^audio\//.test(type)) return type === "audio/x-m4a" ? "audio/mp4" : type
  const ext = String(name || "").toLowerCase().split(".").pop()
  return { mp3: "audio/mpeg", m4a: "audio/mp4", mp4: "audio/mp4", aac: "audio/aac", wav: "audio/wav", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg", flac: "audio/flac", weba: "audio/webm", webm: "audio/webm" }[ext] || "audio/mpeg"
}
