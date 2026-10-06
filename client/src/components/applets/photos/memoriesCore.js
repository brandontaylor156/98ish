// Memories in Photos: when each picture was taken, "On this day" (pictures from today's date
// in earlier years), and trips and days out (pictures close together in time). Pure: no DOM,
// no drive, so the unit tests and the daily notice can use it.
//
//   exifDate(arrayBuffer)       -> ms | null   DateTimeOriginal from a JPEG's EXIF (the start
//                                              of the file is enough: 128 KB)
//   dateFromName(name)          -> ms | null   IMG_20240305_123456.jpg, PXL_20240305..., 2024-03-05...
//   photoTime(file)             -> ms          meta.taken (saved at upload) > the name > mtime
//   onThisDay(photos, now)      -> [{ yearsAgo, year, items }]
//   clusters(photos, options)   -> [{ id, kind: "trip" | "day", start, end, days, items, title }]
//   memoriesOf(photos, now)     -> { onThisDay, trips } (what the Memories view shows)
// `photos` are [{ file, time }] (or anything with a time).

const DAY = 86_400_000
const ascii = (v, off, n) => {
  let s = ""
  for (let i = 0; i < n && off + i < v.byteLength; i++) {
    const c = v.getUint8(off + i)
    if (!c) break
    s += String.fromCharCode(c)
  }
  return s
}

// "2024:03:05 14:22:10" (+ an optional offset "+02:00") -> ms
export const parseExifTime = (text, offset = "") => {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(text || "").trim())
  if (!m) return null
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number)
  if (y < 1990 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 60) return null
  const o = /^([+-])(\d{2}):(\d{2})$/.exec(String(offset || "").trim())
  if (o) return Date.UTC(y, mo - 1, d, h, mi, s) - (o[1] === "-" ? -1 : 1) * (Number(o[2]) * 60 + Number(o[3])) * 60_000
  return new Date(y, mo - 1, d, h, mi, s).getTime()
}

const readIfd = (v, tiff, at, little, end) => {
  const out = new Map()
  if (at + 2 > end) return out
  const count = v.getUint16(at, little)
  for (let i = 0; i < count && at + 2 + i * 12 + 12 <= end; i++) {
    const e = at + 2 + i * 12
    const tag = v.getUint16(e, little)
    const type = v.getUint16(e + 2, little)
    const n = v.getUint32(e + 4, little)
    if (type === 2) out.set(tag, ascii(v, n <= 4 ? e + 8 : tiff + v.getUint32(e + 8, little), Math.min(n, 64)))
    else if (type === 4 || type === 13) out.set(tag, v.getUint32(e + 8, little))
  }
  return out
}

export const exifDate = (buffer) => {
  try {
    const v = new DataView(buffer instanceof ArrayBuffer ? buffer : buffer.buffer)
    if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null
    let off = 2
    while (off + 4 <= v.byteLength) {
      if (v.getUint8(off) !== 0xff) return null
      const marker = v.getUint8(off + 1)
      if (marker === 0xda || marker === 0xd9) return null
      const len = v.getUint16(off + 2)
      if (marker === 0xe1 && ascii(v, off + 4, 4) === "Exif") {
        const tiff = off + 10
        const end = Math.min(v.byteLength, off + 2 + len)
        const order = v.getUint16(tiff)
        const little = order === 0x4949
        if (!little && order !== 0x4d4d) return null
        const ifd0 = readIfd(v, tiff, tiff + v.getUint32(tiff + 4, little), little, end)
        const exifAt = ifd0.get(0x8769)
        const exif = typeof exifAt === "number" ? readIfd(v, tiff, tiff + exifAt, little, end) : new Map()
        return parseExifTime(exif.get(0x9003), exif.get(0x9011)) ?? parseExifTime(exif.get(0x9004), exif.get(0x9012)) ?? parseExifTime(ifd0.get(0x0132), exif.get(0x9010))
      }
      off += 2 + len
    }
    return null
  } catch {
    return null
  }
}

// the date (and time, if there) in a camera-style file name
export const dateFromName = (name) => {
  const s = String(name || "")
  const m = /(?:^|[^0-9])((?:19|20)\d{2})[-_.]?(0[1-9]|1[0-2])[-_.]?(0[1-9]|[12]\d|3[01])(?:(?: at |[-_ T.])?([01]\d|2[0-3])[-_.:]?([0-5]\d)[-_.:]?([0-5]\d))?/.exec(s)
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const t = new Date(y, mo - 1, d, Number(m[4] || 12), Number(m[5] || 0), Number(m[6] || 0))
  if (t.getMonth() !== mo - 1 || t.getDate() !== d) return null // Feb 31
  return t.getTime()
}

export const photoTime = (file) => {
  const taken = Number(file?.meta?.taken)
  if (Number.isFinite(taken) && taken > 0) return taken
  return dateFromName(file?.name) ?? (Number(file?.mtime) || 0)
}

const dayKey = (t) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

export const onThisDay = (photos, now = Date.now()) => {
  const today = new Date(now)
  const groups = new Map()
  for (const p of photos) {
    const d = new Date(p.time)
    if (!p.time || d.getMonth() !== today.getMonth() || d.getDate() !== today.getDate() || d.getFullYear() >= today.getFullYear()) continue
    const year = d.getFullYear()
    if (!groups.has(year)) groups.set(year, [])
    groups.get(year).push(p)
  }
  return [...groups.entries()]
    .map(([year, items]) => ({ year, yearsAgo: today.getFullYear() - year, items: items.sort((a, b) => a.time - b.time) }))
    .sort((a, b) => a.yearsAgo - b.yearsAgo)
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
const SHORT = MONTHS.map((m) => m.slice(0, 3))
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

export const rangeTitle = (start, end) => {
  const a = new Date(start)
  const b = new Date(end)
  if (dayKey(start) === dayKey(end)) return `${WEEKDAYS[a.getDay()]}, ${MONTHS[a.getMonth()]} ${a.getDate()}, ${a.getFullYear()}`
  if (a.getFullYear() !== b.getFullYear()) return `${SHORT[a.getMonth()]} ${a.getDate()}, ${a.getFullYear()} – ${SHORT[b.getMonth()]} ${b.getDate()}, ${b.getFullYear()}`
  if (a.getMonth() !== b.getMonth()) return `${SHORT[a.getMonth()]} ${a.getDate()} – ${SHORT[b.getMonth()]} ${b.getDate()}, ${a.getFullYear()}`
  return `${MONTHS[a.getMonth()]} ${a.getDate()} – ${b.getDate()}, ${a.getFullYear()}`
}

// Pictures close together in time: a new group starts after a gap of more than `gapMs`.
// A group of at least `minItems` that spans 2+ days is a trip; one day with at least
// `minDay` pictures is a day out. Newest first.
export const clusters = (photos, { gapMs = 36 * 3600_000, minItems = 6, minDay = 8, max = 40 } = {}) => {
  const sorted = photos.filter((p) => p.time > 0).sort((a, b) => a.time - b.time)
  const groups = []
  let cur = []
  for (const p of sorted) {
    if (cur.length && p.time - cur[cur.length - 1].time > gapMs) {
      groups.push(cur)
      cur = []
    }
    cur.push(p)
  }
  if (cur.length) groups.push(cur)
  const out = []
  for (const items of groups) {
    const start = items[0].time
    const end = items[items.length - 1].time
    const days = new Set(items.map((p) => dayKey(p.time))).size
    const kind = days > 1 ? "trip" : "day"
    if (kind === "trip" ? items.length < minItems : items.length < minDay) continue
    out.push({ id: `${kind}-${start}`, kind, start, end, days, items, title: rangeTitle(start, end) })
  }
  return out.sort((a, b) => b.start - a.start).slice(0, max)
}

export const yearsAgoText = (n) => (n === 1 ? "1 year ago" : `${n} years ago`)

export const memoriesOf = (photos, now = Date.now()) => ({ onThisDay: onThisDay(photos, now), trips: clusters(photos) })

// for the Notification Center once a day: "On this day: 6 photos from 2 years ago"
export const dailyNotice = (photos, now = Date.now()) => {
  const groups = onThisDay(photos, now)
  if (!groups.length) return null
  const count = groups.reduce((s, g) => s + g.items.length, 0)
  const years = groups.map((g) => g.yearsAgo)
  const when = years.length === 1 ? yearsAgoText(years[0]) : `${years.length} years`
  return { title: "Memories: On this day", text: `${count} photo${count === 1 ? "" : "s"} from ${when}`, count }
}

export const DAY_MS = DAY
