// What an Address Book contact may look like on the server. The client keeps the same shape
// (client/src/utils/contactsCore.js normalizeContact):
//   { id, updatedAt, first, last, nickname, company, screenName, mail, emails: [{ label, value }],
//     phones: [{ label, value }], birthday, anniversary, address: { street, city, region,
//     postal, country }, notes, picture, groups: [name], favorite }
// A deleted contact is a tombstone { id, updatedAt, deleted: true } so other devices learn
// about it. Strings are trimmed and cut to their limits; a bad id, time or picture is refused.

const MAX_CONTACTS = 2_000 // tombstones included
const MAX_BYTES = 2 * 1024 * 1024 // a whole book, as JSON
const MAX_PICTURE = 80_000 // characters of data URL (pictures are 96 px JPEGs, about 6 KB)
const MAX_LIST = 8 // phones, e-mail addresses
const MAX_GROUPS = 20

const ID = /^[a-z0-9]{8,32}$/
const DATE = /^(\d{4}|--)-?(\d{2})-?(\d{2})$/
const PICTURE = /^data:image\/(jpeg|png|gif|webp);base64,[A-Za-z0-9+/]+=*$/

const isPlain = (value) => !!value && typeof value === "object" && !Array.isArray(value)
const text = (value, max) =>
  String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, max)
const line = (value, max) => text(value, max).replace(/[\r\n]+/g, " ")

// "1990-05-17", "--05-17" (no year), or "" -> the same, checked; anything else -> ""
const date = (value) => {
  const m = String(value ?? "").trim().match(DATE)
  if (!m) return ""
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return ""
  return `${m[1] === "--" ? "-" : m[1]}-${m[2]}-${m[3]}`
}

const list = (value) =>
  (Array.isArray(value) ? value : [])
    .filter(isPlain)
    .map((v) => ({ label: line(v.label, 30).toLowerCase(), value: line(v.value, 120) }))
    .filter((v) => v.value)
    .slice(0, MAX_LIST)

// -> { ok: true, contact } | { ok: false, error }
const cleanContact = (raw, now = Date.now()) => {
  if (!isPlain(raw)) return { ok: false, error: "A contact is damaged." }
  if (typeof raw.id !== "string" || !ID.test(raw.id)) return { ok: false, error: "A contact has a bad id." }
  if (typeof raw.updatedAt !== "number" || !Number.isFinite(raw.updatedAt) || raw.updatedAt < 0) return { ok: false, error: "A contact has a bad time." }
  // a clock far in the future would win every change from then on
  const updatedAt = Math.min(Math.floor(raw.updatedAt), now + 5 * 60_000)
  if (raw.deleted) return { ok: true, contact: { id: raw.id, updatedAt, deleted: true } }
  const picture = raw.picture ? String(raw.picture) : ""
  if (picture && (picture.length > MAX_PICTURE || !PICTURE.test(picture))) return { ok: false, error: "A contact's picture is too big or isn't a picture." }
  const address = isPlain(raw.address) ? raw.address : {}
  const groups = [...new Set((Array.isArray(raw.groups) ? raw.groups : []).map((g) => line(g, 30)).filter(Boolean))].slice(0, MAX_GROUPS)
  return {
    ok: true,
    contact: {
      id: raw.id,
      updatedAt,
      first: line(raw.first, 60),
      last: line(raw.last, 60),
      nickname: line(raw.nickname, 60),
      company: line(raw.company, 80),
      screenName: line(raw.screenName, 32),
      mail: line(raw.mail, 120),
      emails: list(raw.emails),
      phones: list(raw.phones),
      birthday: date(raw.birthday),
      anniversary: date(raw.anniversary),
      address: {
        street: text(address.street, 200),
        city: line(address.city, 80),
        region: line(address.region, 80),
        postal: line(address.postal, 20),
        country: line(address.country, 80),
      },
      notes: text(raw.notes, 4000),
      picture,
      groups,
      favorite: !!raw.favorite,
    },
  }
}

// A list of contacts from a request -> { ok, contacts } | { ok: false, error }
const cleanContacts = (raw, now = Date.now()) => {
  if (!Array.isArray(raw)) return { ok: false, error: "Send a list of contacts." }
  if (raw.length > MAX_CONTACTS) return { ok: false, error: `An address book can hold ${MAX_CONTACTS} contacts.` }
  const out = []
  for (const item of raw) {
    const checked = cleanContact(item, now)
    if (!checked.ok) return checked
    out.push(checked.contact)
  }
  return { ok: true, contacts: out }
}

module.exports = { cleanContact, cleanContacts, MAX_CONTACTS, MAX_BYTES, MAX_PICTURE }
