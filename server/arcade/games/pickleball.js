// Pickleball 98 on the online room system (server/arcade/rooms.js): a real-time game in
// relay mode. The host's browser runs the match (client/src/components/applets/pickleball/
// netplay.js); the server only seats people, checks the room's settings, relays snapshots,
// inputs and hits, and records the result.
//
// Seats alternate sides (0 and 2 near, 1 and 3 far). Singles is two people; doubles is up to
// four, and computer partners fill any empty spots (two people in doubles = each with a
// computer partner). Three people always play doubles.

const { sanitizeLook } = require("./pickleballLooks")

const FORMATS = ["singles", "doubles"]
const TARGETS = [7, 11, 15]
const SCORING = ["sideout", "rally"]
const VENUES = ["park", "club", "stadium", "beach", "winter"]

const defaultSettings = { format: "singles", target: 11, scoring: "sideout", venue: "stadium" }

module.exports = {
  id: "pickleball",
  name: "Pickleball 98",
  minPlayers: 2,
  maxPlayers: 4,
  relay: true,
  spectate: false, // the browser game has no watch mode (yet): everyone in the room plays
  defaultSettings,
  validateSettings: (s = {}) => {
    const out = { ...defaultSettings }
    if (s.format !== undefined) {
      if (!FORMATS.includes(s.format)) return { error: "Pick singles or doubles." }
      out.format = s.format
    }
    if (s.target !== undefined) {
      const t = Number(s.target)
      if (!TARGETS.includes(t)) return { error: "Games go to 7, 11 or 15." }
      out.target = t
    }
    if (s.scoring !== undefined) {
      if (!SCORING.includes(s.scoring)) return { error: "Pick side-out or rally scoring." }
      out.scoring = s.scoring
    }
    if (s.venue !== undefined) {
      if (!VENUES.includes(s.venue)) return { error: "That venue doesn't exist." }
      out.venue = s.venue
    }
    return out
  },
  // Quick Match pairs people who want the same game; the venue is the host's choice
  bucket: (s) => `${s.format}:${s.target}:${s.scoring}`,
  // singles is full with two (start right away); doubles waits a moment for more
  quickSeats: (s) => (s.format === "singles" ? 2 : 4),
  // what people's browsers tell each other about their players ("hello": who I am and what
  // I'm wearing; "start": the host's line-up) goes through the look checks; the rest (hits,
  // the final score) passes as it is
  filterRelay: (data) => {
    if (!data || typeof data !== "object" || Array.isArray(data)) return null
    if (data.type === "hello") return { type: "hello", character: cleanId(data.character), outfit: cleanId(data.outfit), look: sanitizeLook(data.look) }
    if (data.type === "start") {
      if (!Array.isArray(data.people) || data.people.length > 4) return null
      const people = data.people.map((p) => (p && typeof p === "object" ? { seat: Number.isInteger(p.seat) ? p.seat : null, name: typeof p.name === "string" ? p.name.slice(0, 40) : "", character: cleanId(p.character), outfit: cleanId(p.outfit), look: sanitizeLook(p.look) } : null)).filter(Boolean)
      return { ...data, people }
    }
    return data
  },
}

// a character or outfit id: short letters and digits, or nothing
const cleanId = (v) => (typeof v === "string" && /^[a-z0-9]{1,24}$/i.test(v) ? v : null)
