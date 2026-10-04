// vCard (.vcf) files: reading what phones and mail programs write (iPhone, Android/Google,
// Outlook's 2.1 with quoted-printable, vCard 4.0) and writing vCard 3.0, which iPhone,
// Android and Outlook all read. No browser APIs: tested in Node (vcard.test.js).
//
// parseVCards(text) -> [contact-like objects] (no id; utils/contactsCore normalizeContact
// finishes them). toVCard(contact) / toVCards(contacts) -> text with CRLF line ends.

import { cleanDate } from "../../../utils/contactsCore.js"

// ---- reading ----

// lines folded with a leading space or tab, and quoted-printable soft breaks ("=" at the end)
const unfold = (text) => {
  const lines = []
  for (const raw of String(text).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n")) {
    const last = lines.length - 1
    if ((raw.startsWith(" ") || raw.startsWith("\t")) && last >= 0) {
      lines[last] += raw.slice(1)
      continue
    }
    const prev = lines[last]
    if (prev !== undefined && prev.endsWith("=") && /QUOTED-PRINTABLE/i.test(prev.slice(0, prev.indexOf(":") + 1 || prev.length))) {
      lines[last] = prev.slice(0, -1) + raw
      continue
    }
    lines.push(raw)
  }
  return lines
}

// "item1.TEL;type=CELL;type=pref:555" -> { group, name, params, types, value }
const parseLine = (line) => {
  let at = -1
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted
    else if (line[i] === ":" && !quoted) {
      at = i
      break
    }
  }
  if (at < 0) return null
  const head = line.slice(0, at).split(";")
  let name = head[0].trim()
  let group = ""
  const dot = name.indexOf(".")
  if (dot >= 0) {
    group = name.slice(0, dot).toLowerCase()
    name = name.slice(dot + 1)
  }
  const params = {}
  const types = []
  for (const part of head.slice(1)) {
    const eq = part.indexOf("=")
    if (eq < 0) {
      types.push(part.trim().toLowerCase())
      continue
    }
    const key = part.slice(0, eq).trim().toUpperCase()
    const value = part.slice(eq + 1).trim().replace(/^"|"$/g, "")
    if (key === "TYPE") types.push(...value.toLowerCase().split(",").map((t) => t.trim()))
    else params[key] = value
  }
  // vCard 2.1 writes the encoding bare: TEL;CELL;QUOTED-PRINTABLE
  if (types.includes("quoted-printable")) params.ENCODING = "QUOTED-PRINTABLE"
  if (types.includes("base64")) params.ENCODING = "BASE64"
  return { group, name: name.toUpperCase(), params, types, value: line.slice(at + 1) }
}

const decodeQP = (value, charset = "utf-8") => {
  const bytes = []
  for (let i = 0; i < value.length; i++) {
    const hex = value.slice(i + 1, i + 3)
    if (value[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(hex)) {
      bytes.push(parseInt(hex, 16))
      i += 2
    } else {
      const code = value.charCodeAt(i)
      if (code < 128) bytes.push(code)
      else bytes.push(...new TextEncoder().encode(value[i]))
    }
  }
  try {
    return new TextDecoder(charset).decode(new Uint8Array(bytes))
  } catch {
    return new TextDecoder("utf-8").decode(new Uint8Array(bytes))
  }
}

// split on a separator that isn't escaped with a backslash
const splitEscaped = (value, sep) => {
  const out = []
  let current = ""
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "\\" && i + 1 < value.length) {
      current += value[i] + value[i + 1]
      i++
    } else if (value[i] === sep) {
      out.push(current)
      current = ""
    } else current += value[i]
  }
  out.push(current)
  return out
}
const unescape = (value) => value.replace(/\\([\\,;nN:])/g, (_, ch) => (ch === "n" || ch === "N" ? "\n" : ch))

// iPhone's labels: "_$!<Mobile>!$_" -> "mobile"; anything else as typed
const cleanLabel = (label) => String(label || "").replace(/^_\$!<(.*)>!\$_$/, "$1").trim().toLowerCase()

const PHONE_TYPES = ["cell", "mobile", "iphone", "home", "work", "main", "pager", "fax", "other"]
const phoneLabel = (types) => {
  if (types.includes("iphone")) return "iphone"
  if (types.includes("fax")) return types.includes("work") ? "work fax" : "home fax"
  if (types.includes("cell") || types.includes("mobile")) return "mobile"
  const known = PHONE_TYPES.find((t) => types.includes(t))
  return known || "other"
}
const emailLabel = (types) => ["home", "work"].find((t) => types.includes(t)) || "other"

const MIME = { jpeg: "jpeg", jpg: "jpeg", png: "png", gif: "gif", webp: "webp" }
const photoOf = (prop) => {
  const value = prop.value.trim()
  if (/^data:image\//i.test(value)) return value.replace(/\s+/g, "")
  const encoding = String(prop.params.ENCODING || "").toLowerCase()
  if (!["b", "base64"].includes(encoding)) return "" // a link to a picture somewhere: can't fetch it
  const kind = prop.types.map((t) => MIME[t.replace(/^image\//, "")]).find(Boolean) || MIME[String(prop.params.TYPE || "").toLowerCase()] || "jpeg"
  const data = value.replace(/[^A-Za-z0-9+/=]/g, "")
  return data ? `data:image/${kind};base64,${data}` : ""
}

// iPhone marks a date with no year with X-APPLE-OMIT-YEAR (the year written is then 1604)
const dateIn = (prop) => {
  const date = cleanDate(prop.value)
  return prop.params["X-APPLE-OMIT-YEAR"] && date && !date.startsWith("--") ? `--${date.slice(5)}` : date
}

// one BEGIN:VCARD ... END:VCARD block's properties -> a contact-like object
const cardFrom = (props) => {
  const labels = {} // itemN group -> its X-ABLabel
  for (const p of props) if (p.name === "X-ABLABEL" && p.group) labels[p.group] = cleanLabel(p.value)
  const card = { first: "", last: "", nickname: "", company: "", screenName: "", mail: "", emails: [], phones: [], birthday: "", anniversary: "", address: null, notes: "", picture: "", groups: [], favorite: false }
  let fullName = ""
  let addressRank = -1
  for (const p of props) {
    const label = p.group ? labels[p.group] : ""
    const textValue = () => unescape(p.value).trim()
    switch (p.name) {
      case "FN":
        fullName = textValue()
        break
      case "N": {
        const [last = "", first = "", middle = ""] = splitEscaped(p.value, ";").map((v) => unescape(v).trim())
        card.last = last
        card.first = [first, middle].filter(Boolean).join(" ")
        break
      }
      case "NICKNAME":
        card.nickname = splitEscaped(p.value, ",").map(unescape)[0].trim()
        break
      case "ORG":
        card.company = unescape(splitEscaped(p.value, ";")[0]).trim()
        break
      case "TEL":
        card.phones.push({ label: label || phoneLabel(p.types), value: textValue() })
        break
      case "EMAIL":
        card.emails.push({ label: label || emailLabel(p.types), value: textValue() })
        break
      case "BDAY":
        card.birthday = dateIn(p)
        break
      case "ANNIVERSARY":
      case "X-ANNIVERSARY":
      case "X-MS-ANNIVERSARY":
      case "X-EVOLUTION-ANNIVERSARY":
        card.anniversary = cleanDate(p.value)
        break
      case "X-ABDATE":
        if (/anniversary/.test(label)) card.anniversary = dateIn(p)
        break
      case "ADR": {
        // the preferred or home address wins over the others
        const rank = (p.types.includes("pref") ? 2 : 0) + (p.types.includes("home") ? 1 : 0)
        if (rank <= addressRank) break
        addressRank = rank
        const [, ext = "", street = "", city = "", region = "", postal = "", country = ""] = splitEscaped(p.value, ";").map((v) => unescape(v).trim())
        card.address = { street: [street, ext].filter(Boolean).join("\n"), city, region, postal, country }
        break
      }
      case "NOTE":
        card.notes = textValue()
        break
      case "PHOTO":
        card.picture = photoOf(p) || card.picture
        break
      case "CATEGORIES":
        for (const g of splitEscaped(p.value, ",").map((v) => unescape(v).trim())) {
          // Google Contacts' own markers
          if (/^starred$/i.test(g)) card.favorite = true
          else if (g && !/^mycontacts$/i.test(g)) card.groups.push(g)
        }
        break
      case "X-98ISH-SCREENNAME":
        card.screenName = textValue()
        break
      case "X-98ISH-MAIL":
        card.mail = textValue()
        break
      case "X-98ISH-FAVORITE":
        card.favorite = /^(1|true|yes)$/i.test(p.value.trim())
        break
      case "IMPP":
        if (!card.screenName && /^aim:/i.test(p.value.trim())) card.screenName = p.value.trim().replace(/^aim:/i, "")
        break
      case "X-AIM":
        if (!card.screenName) card.screenName = textValue()
        break
    }
  }
  if (!card.first && !card.last && fullName) {
    const words = fullName.split(/\s+/)
    if (words.length > 1) {
      card.last = words.pop()
      card.first = words.join(" ")
    } else card.first = fullName
  }
  if (!card.address) card.address = { street: "", city: "", region: "", postal: "", country: "" }
  return card
}

export const parseVCards = (text) => {
  const cards = []
  let props = null
  for (const line of unfold(text)) {
    if (!line.trim()) continue
    const prop = parseLine(line)
    if (!prop) continue
    if (prop.name === "BEGIN" && /^vcard$/i.test(prop.value.trim())) {
      props = []
      continue
    }
    if (prop.name === "END" && /^vcard$/i.test(prop.value.trim())) {
      if (props) cards.push(cardFrom(props))
      props = null
      continue
    }
    if (!props) continue
    if (String(prop.params.ENCODING || "").toUpperCase() === "QUOTED-PRINTABLE") {
      prop.value = decodeQP(prop.value, prop.params.CHARSET || "utf-8")
      // decoded text has real line breaks: escape them like a 3.0 value so it reads the same
      prop.value = prop.value.replace(/\r?\n/g, "\\n")
    }
    props.push(prop)
  }
  return cards.filter((c) => c.first || c.last || c.nickname || c.company || c.emails.length || c.phones.length || c.screenName)
}

// Does this text look like a vCard file?
export const isVCard = (text) => /BEGIN:VCARD/i.test(String(text || "").slice(0, 2000))

// ---- writing ----

const esc = (value) => String(value ?? "").replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;")

// lines longer than 75 characters continue on the next line after a space
const fold = (line) => {
  if (line.length <= 75) return line
  const parts = [line.slice(0, 75)]
  for (let i = 75; i < line.length; i += 74) parts.push(" " + line.slice(i, i + 74))
  return parts.join("\r\n")
}

const PHONE_OUT = { mobile: "CELL", iphone: "IPHONE", home: "HOME", work: "WORK", main: "MAIN", pager: "PAGER", "home fax": "HOME,FAX", "work fax": "WORK,FAX", other: "OTHER" }
const dateOut = (value) => (String(value).startsWith("--") ? { params: ";X-APPLE-OMIT-YEAR=1604", value: `1604-${value.slice(2)}` } : { params: "", value })

export const toVCard = (c) => {
  const out = ["BEGIN:VCARD", "VERSION:3.0", "PRODID:-//98ish//Address Book//EN"]
  const fn = [c.first, c.last].filter(Boolean).join(" ") || c.nickname || c.company || c.screenName || "Contact"
  out.push(`N:${esc(c.last)};${esc(c.first)};;;`)
  out.push(`FN:${esc(fn)}`)
  if (c.nickname) out.push(`NICKNAME:${esc(c.nickname)}`)
  if (c.company) out.push(`ORG:${esc(c.company)};`)
  let item = 0
  for (const e of c.emails || []) {
    const type = ["home", "work"].includes(e.label) ? `;TYPE=${e.label.toUpperCase()}` : ""
    if (type || e.label === "other" || !e.label) out.push(`EMAIL;TYPE=INTERNET${type}:${esc(e.value)}`)
    else {
      item++
      out.push(`item${item}.EMAIL;TYPE=INTERNET:${esc(e.value)}`, `item${item}.X-ABLabel:${esc(e.label)}`)
    }
  }
  for (const p of c.phones || []) {
    const type = PHONE_OUT[p.label]
    if (type) out.push(`TEL;TYPE=${type}:${esc(p.value)}`)
    else {
      item++
      out.push(`item${item}.TEL:${esc(p.value)}`, `item${item}.X-ABLabel:${esc(p.label)}`)
    }
  }
  const a = c.address || {}
  if (a.street || a.city || a.region || a.postal || a.country) out.push(`ADR;TYPE=HOME:;;${esc(a.street)};${esc(a.city)};${esc(a.region)};${esc(a.postal)};${esc(a.country)}`)
  if (c.birthday) {
    const d = dateOut(c.birthday)
    out.push(`BDAY${d.params}:${d.value}`)
  }
  if (c.anniversary) {
    const d = dateOut(c.anniversary)
    item++
    // iPhone reads its own labeled date; others read X-ANNIVERSARY
    out.push(`item${item}.X-ABDATE${d.params}:${d.value}`, `item${item}.X-ABLabel:_$!<Anniversary>!$_`, `X-ANNIVERSARY:${c.anniversary.startsWith("--") ? c.anniversary : d.value}`)
  }
  if (c.notes) out.push(`NOTE:${esc(c.notes)}`)
  if (c.groups?.length) out.push(`CATEGORIES:${c.groups.map(esc).join(",")}`)
  if (c.screenName) out.push(`X-98ISH-SCREENNAME:${esc(c.screenName)}`)
  if (c.mail) out.push(`X-98ISH-MAIL:${esc(c.mail)}`)
  if (c.favorite) out.push("X-98ISH-FAVORITE:TRUE")
  const photo = String(c.picture || "").match(/^data:image\/(jpeg|png|gif|webp);base64,(.+)$/)
  if (photo) out.push(`PHOTO;ENCODING=b;TYPE=${photo[1].toUpperCase()}:${photo[2]}`)
  out.push("END:VCARD")
  return out.map(fold).join("\r\n") + "\r\n"
}

export const toVCards = (contacts) => contacts.filter((c) => !c.deleted).map(toVCard).join("")
