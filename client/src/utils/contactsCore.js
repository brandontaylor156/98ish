// The Address Book's data rules, with no browser or React in them (tested in Node:
// node --test client/src/components/applets/addressbook/contacts.test.js). The store that
// keeps and syncs contacts is ./contacts.js; the server checks the same shape
// (server/contacts/validate.js).
//
// A contact: { id, updatedAt, first, last, nickname, company, screenName (98 Messenger),
//   mail (98ish Mail address, blank = the screen name), emails: [{ label, value }],
//   phones: [{ label, value }], birthday, anniversary ("1990-05-17", or "--05-17" with no
//   year), address: { street, city, region, postal, country }, notes, picture (a small
//   JPEG data URL), groups: [name], favorite }
// A deleted one is a tombstone { id, updatedAt, deleted: true }, so other devices hear of it.

export const DEFAULT_GROUPS = ["Family", "Friends", "Us"]
export const MAX_PICTURE = 80_000
export const PHONE_LABELS = ["mobile", "home", "work", "iphone", "main", "other"]
export const EMAIL_LABELS = ["home", "work", "other"]

export const newId = () => {
  const bytes = new Uint8Array(8)
  globalThis.crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(36).padStart(2, "0")).join("").slice(0, 16)
}

const text = (value, max) =>
  String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, max)
const line = (value, max) => text(value, max).replace(/[\r\n]+/g, " ")
const isPlain = (value) => !!value && typeof value === "object" && !Array.isArray(value)

// "1990-05-17", "19900517", "--05-17", "--0517", "1990-05-17T00:00:00Z" -> "1990-05-17" |
// "--05-17" | "" (a year of 1604 or earlier is iPhone's "no year")
export const cleanDate = (value) => {
  const m = String(value ?? "").trim().match(/^(\d{4}|--)-?(\d{2})-?(\d{2})(?:T.*)?$/)
  if (!m) return ""
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]) return ""
  return m[1] === "--" || Number(m[1]) <= 1604 ? `--${m[2]}-${m[3]}` : `${m[1]}-${m[2]}-${m[3]}`
}

// "1990-05-17" -> { year: 1990, month: 5, day: 17 }; "--05-17" -> { year: null, ... }
export const dateParts = (value) => {
  const clean = cleanDate(value)
  if (!clean) return null
  const [y, m, d] = clean.startsWith("--") ? [null, clean.slice(2, 4), clean.slice(5, 7)] : clean.split("-")
  return { year: y === null ? null : Number(y), month: Number(m), day: Number(d) }
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
export const dateText = (value) => {
  const p = dateParts(value)
  if (!p) return ""
  return `${MONTHS[p.month - 1]} ${p.day}${p.year ? `, ${p.year}` : ""}`
}

const list = (value, labels) =>
  (Array.isArray(value) ? value : [])
    .filter(isPlain)
    .map((v) => ({ label: line(v.label, 30).toLowerCase() || labels[0], value: line(v.value, 120) }))
    .filter((v) => v.value)
    .slice(0, 8)

// Any object -> a contact in the shape above (a new id and time if it has none)
export const normalizeContact = (raw = {}, { now = Date.now() } = {}) => {
  const id = typeof raw.id === "string" && /^[a-z0-9]{8,32}$/.test(raw.id) ? raw.id : newId()
  const updatedAt = Number.isFinite(raw.updatedAt) && raw.updatedAt > 0 ? Math.floor(raw.updatedAt) : now
  if (raw.deleted) return { id, updatedAt, deleted: true }
  const address = isPlain(raw.address) ? raw.address : {}
  const picture = typeof raw.picture === "string" && raw.picture.length <= MAX_PICTURE && /^data:image\/(jpeg|png|gif|webp);base64,[A-Za-z0-9+/]+=*$/.test(raw.picture) ? raw.picture : ""
  return {
    id,
    updatedAt,
    first: line(raw.first, 60),
    last: line(raw.last, 60),
    nickname: line(raw.nickname, 60),
    company: line(raw.company, 80),
    screenName: line(raw.screenName, 32),
    mail: line(raw.mail, 120),
    emails: list(raw.emails, EMAIL_LABELS),
    phones: list(raw.phones, PHONE_LABELS),
    birthday: cleanDate(raw.birthday),
    anniversary: cleanDate(raw.anniversary),
    address: {
      street: text(address.street, 200),
      city: line(address.city, 80),
      region: line(address.region, 80),
      postal: line(address.postal, 20),
      country: line(address.country, 80),
    },
    notes: text(raw.notes, 4000),
    picture,
    groups: [...new Set((Array.isArray(raw.groups) ? raw.groups : []).map((g) => line(g, 30)).filter(Boolean))].slice(0, 20),
    favorite: !!raw.favorite,
  }
}

export const screenKey = (name) => String(name || "").replace(/\s+/g, "").toLowerCase()

// What the list shows: "Jane Doe", else the nickname, company, screen name or an address
export const displayName = (c) =>
  [c.first, c.last].filter(Boolean).join(" ") || c.nickname || c.company || c.screenName || c.mail || c.emails?.[0]?.value || c.phones?.[0]?.value || "(No name)"
export const sortName = (c) => (c.last ? `${c.last} ${c.first}` : displayName(c)).toLowerCase()
export const initials = (c) => {
  const words = displayName(c).replace(/[^\p{L}\p{N} ]/gu, "").split(/\s+/).filter(Boolean)
  return ((words[0]?.[0] || "?") + (words.length > 1 ? words.at(-1)[0] : "")).toUpperCase()
}
export const sortContacts = (contacts) => [...contacts].sort((a, b) => sortName(a).localeCompare(sortName(b)) || a.id.localeCompare(b.id))

// Where 98ish Mail sends to: the 98ish Mail address, else the screen name
export const mailAddressOf = (c) => c.mail || c.screenName || ""

export const addressText = (a = {}) =>
  [a.street, [a.city, [a.region, a.postal].filter(Boolean).join(" ")].filter(Boolean).join(", "), a.country].filter(Boolean).join("\n")

// Everything about a contact as one lowercase string, for finding them
export const searchText = (c) =>
  [displayName(c), c.first, c.last, c.nickname, c.company, c.screenName, c.mail, ...c.emails.map((e) => e.value), ...c.phones.map((p) => p.value), addressText(c.address), c.notes, ...c.groups]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()

export const matchesContact = (c, query) => {
  const words = String(query || "").toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const hay = searchText(c)
  const digits = hay.replace(/[^\d]/g, "")
  return words.every((w) => hay.includes(w) || (/^\d{3,}$/.test(w.replace(/[^\d]/g, "")) && digits.includes(w.replace(/[^\d]/g, ""))))
}

// The contact linked to a screen name (98 Messenger buddies), if any
export const contactForScreenName = (contacts, screenName) => {
  const key = screenKey(screenName)
  return key ? contacts.find((c) => !c.deleted && screenKey(c.screenName) === key) || null : null
}

// ---- syncing ----

// The server's book merged with this device's: the newer of each contact wins; local
// contacts the server doesn't know (made while signed off) stay and are sent next time.
// -> { contacts, dirty: [ids still to send] }
export const mergeBooks = (local, server, dirtyIds = []) => {
  const dirty = new Set(dirtyIds)
  const byId = new Map()
  for (const c of server) byId.set(c.id, c)
  const stillDirty = new Set()
  for (const c of local) {
    const theirs = byId.get(c.id)
    if (!theirs) {
      byId.set(c.id, c)
      if (!c.deleted) stillDirty.add(c.id)
    } else if (c.updatedAt > theirs.updatedAt) {
      byId.set(c.id, c)
      stillDirty.add(c.id)
    } else if (c.updatedAt === theirs.updatedAt && dirty.has(c.id) && JSON.stringify(c) !== JSON.stringify(theirs)) {
      byId.set(c.id, c)
      stillDirty.add(c.id)
    }
  }
  return { contacts: [...byId.values()], dirty: [...stillDirty] }
}

// ---- birthdays and anniversaries on the calendar ----

export const BIRTHDAYS_ID = "birthdays"

// A yearly all-day event per birthday and anniversary (98ish Calendar's event shape), with a
// reminder on the day. Years without a year use 2000 as the first one (a leap year, so
// February 29 works).
export const birthdayEvents = (contacts) => {
  const out = []
  for (const c of contacts) {
    if (c.deleted) continue
    const name = displayName(c)
    for (const [kind, value] of [["birthday", c.birthday], ["anniversary", c.anniversary]]) {
      const p = dateParts(value)
      if (!p) continue
      const start = `${p.year || 2000}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`
      out.push({
        id: `${kind === "birthday" ? "bd" : "an"}-${c.id}`,
        calendarId: BIRTHDAYS_ID,
        kind: "event",
        title: kind === "birthday" ? `${name}'s birthday` : `${name}'s anniversary`,
        allDay: true,
        start,
        end: start,
        tz: "UTC",
        location: "",
        notes: p.year ? `${kind === "birthday" ? "Born" : "Since"} ${dateText(value)}` : "",
        label: "",
        repeat: { freq: "yearly", interval: 1 },
        reminders: [0],
        attendees: [],
        todo: false,
        done: false,
        checklist: [],
        exceptions: {},
        contactId: c.id,
        readOnly: true,
        createdBy: "me",
        createdByName: "Address Book",
        createdAt: 0,
        updatedAt: c.updatedAt,
        comments: 0,
      })
    }
  }
  return out
}

// How old someone turns (or how many years) on their next one after `today` ("YYYY-MM-DD")
export const yearsOn = (value, today) => {
  const p = dateParts(value)
  if (!p?.year) return null
  const [ty, tm, td] = today.split("-").map(Number)
  const passed = tm > p.month || (tm === p.month && td > p.day)
  return ty - p.year + (passed ? 1 : 0)
}

// Days from today ("YYYY-MM-DD") to the next birthday/anniversary (0 = today)
export const daysUntil = (value, today) => {
  const p = dateParts(value)
  if (!p) return null
  const [ty, tm, td] = today.split("-").map(Number)
  const t = Date.UTC(ty, tm - 1, td)
  const leapless = (y) => (p.month === 2 && p.day === 29 && !(y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 28 : p.day)
  let next = Date.UTC(ty, p.month - 1, leapless(ty))
  if (next < t) next = Date.UTC(ty + 1, p.month - 1, leapless(ty + 1))
  return Math.round((next - t) / 86_400_000)
}
