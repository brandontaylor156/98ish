// Checks for everything couples send: plain text (never HTML: the client draws it as
// text), dates, choices from fixed lists, and pictures (PNG, JPEG or WebP data URLs whose
// bytes really are that kind of picture, at most MAX_IMAGE_BYTES and MAX_IMAGE_SIDE).

const MAX_IMAGE_BYTES = 320 * 1024
const MAX_IMAGE_SIDE = 1280

class Invalid extends Error {}
const fail = (message) => {
  throw new Invalid(message)
}

const clean = (value) =>
  String(value ?? "")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F​-‏‪-‮⁦-⁩]/g, "")
    .replace(/\r\n?/g, "\n")

// text(value, { max, min, label, lines }): trimmed text, or throws Invalid
const text = (value, { max, min = 0, label = "Text", lines = true } = {}) => {
  if (value !== undefined && value !== null && typeof value !== "string") fail(`${label} must be text.`)
  let result = clean(value)
  result = lines ? result.replace(/[ \t]+\n/g, "\n").replace(/\n{4,}/g, "\n\n\n") : result.replace(/\s+/g, " ")
  result = result.trim()
  if (result.length < min) fail(min === 1 ? `${label} can't be empty.` : `${label} must be at least ${min} characters.`)
  if (result.length > max) fail(`${label} can be at most ${max.toLocaleString("en-US")} characters.`)
  return result
}

const pick = (value, allowed, fallback, label = "That choice") => {
  if (value === undefined || value === null || value === "") {
    if (fallback === undefined) fail(`${label} is missing.`)
    return fallback
  }
  if (!allowed.includes(value)) fail(`${label} isn't one of the choices.`)
  return value
}

// "2024-02-14" (a real calendar date between 1900 and 2100), or "" when optional
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const date = (value, { label = "Date", optional = false } = {}) => {
  if (optional && (value === undefined || value === null || value === "")) return ""
  const match = DATE.exec(String(value ?? ""))
  if (!match) fail(`${label} must be a date.`)
  const [y, m, d] = match.slice(1).map(Number)
  const real = new Date(Date.UTC(y, m - 1, d))
  if (y < 1900 || y > 2100 || real.getUTCMonth() !== m - 1 || real.getUTCDate() !== d) fail(`${label} isn't a real date.`)
  return match[0]
}

// ---- pictures ----

const MAGIC = {
  png: (b) => b.length > 24 && b[0] === 0x89 && b.toString("latin1", 1, 4) === "PNG",
  jpeg: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  webp: (b) => b.length > 30 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP",
}

// width and height from the picture's own header (null if it can't be found)
const sizeOf = (kind, b) => {
  if (kind === "png") return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
  if (kind === "webp") {
    const chunk = b.toString("latin1", 12, 16)
    if (chunk === "VP8 " && b.length > 30) return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff }
    if (chunk === "VP8L" && b.length > 25) {
      const bits = b.readUInt32LE(21)
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
    }
    if (chunk === "VP8X" && b.length > 30) return { width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 }
    return null
  }
  // JPEG: walk the segments to the frame header
  let i = 2
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null
    const marker = b[i + 1]
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2
      continue
    }
    const length = b.readUInt16BE(i + 2)
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) }
    }
    i += 2 + length
  }
  return null
}

const IMAGE_URL = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/

// -> { data, bytes } or throws Invalid
const image = (value, label = "That picture") => {
  if (typeof value !== "string" || value.length > MAX_IMAGE_BYTES * 1.4 + 64) fail(`${label} is too big. Pictures can be at most ${MAX_IMAGE_BYTES / 1024} KB.`)
  const match = IMAGE_URL.exec(value)
  if (!match) fail(`${label} must be a PNG, JPEG or WebP picture.`)
  const bytes = Buffer.from(match[2], "base64")
  if (bytes.length > MAX_IMAGE_BYTES) fail(`${label} is too big. Pictures can be at most ${MAX_IMAGE_BYTES / 1024} KB.`)
  if (!MAGIC[match[1]](bytes)) fail(`${label} is damaged.`)
  const size = sizeOf(match[1], bytes)
  if (!size || !size.width || !size.height) fail(`${label} is damaged.`)
  if (size.width > MAX_IMAGE_SIDE || size.height > MAX_IMAGE_SIDE) fail(`${label} is too large. Pictures can be at most ${MAX_IMAGE_SIDE} pixels across.`)
  return { data: value, bytes: bytes.length }
}

module.exports = { Invalid, fail, clean, text, pick, date, image, sizeOf, MAX_IMAGE_BYTES, MAX_IMAGE_SIDE }
