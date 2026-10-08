// Small cards sent in an IM (aim:im { card }): a few hundred bytes of plain data the server
// checks field by field, keeps with the message (history doc `v`) and passes on. No files, no
// links: the buddy's 98ish decides what a card's buttons do.
//
//   venue: "Meet me at <venue>" (Pickleball 98's real venues, or a Venue Finder court)
//     { k: "venue", id, n (name), lat, lon, a? (street address), c? (town), sh? (Venue Finder
//       index shard) } -> the buddy can open My Park there or get directions (Maps 98)
//
// Anything else, or a field that doesn't fit, and the card is refused (the message isn't sent).

const MAX_BYTES = 400
const CONTROL = /[\x00-\x1F\x7F]/g
const text = (v, max) => (typeof v === "string" ? v.replace(CONTROL, " ").replace(/\s+/g, " ").trim().slice(0, max) : "")
const coord = (v, limit) => (typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= limit ? Math.round(v * 1e6) / 1e6 : null)

// a card as sent -> the card as kept and passed on, or null when it isn't one
const cleanCard = (input) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null
  if (input.k !== "venue") return null
  // real venues are short words ("loscab"); Venue Finder courts are OSM ids ("ow123456", "or9b")
  const id = typeof input.id === "string" && /^[a-z0-9]{1,24}$/.test(input.id) ? input.id : null
  const n = text(input.n, 60)
  const lat = coord(input.lat, 90)
  const lon = coord(input.lon, 180)
  if (!id || !n || lat === null || lon === null) return null
  const card = { k: "venue", id, n, lat, lon }
  const a = text(input.a, 120)
  if (a) card.a = a
  const c = text(input.c, 40)
  if (c) card.c = c
  if (typeof input.sh === "string" && /^[a-z0-9]{1,12}$/.test(input.sh)) card.sh = input.sh
  return JSON.stringify(card).length <= MAX_BYTES ? card : null
}

// what a notification says for a card
const cardPreview = (card, message = "") => (card?.k === "venue" ? `📍 Meet me at ${card.n}${message ? `: ${message}` : ""}` : message)

module.exports = { cleanCard, cardPreview, CARD_MAX_BYTES: MAX_BYTES }
