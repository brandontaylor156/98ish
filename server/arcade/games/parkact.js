// Pickleball 98 > My Park activities with a friend (client park/acts/): tennis on a venue's
// tennis court, H-O-R-S-E on a basketball court, a workout together in a gym. Always two
// people who said yes to each other in the park (server/park/together.js kinds "tennis",
// "horse", "workout"); the park server makes the room, seats both and starts it.
//
// Relay mode (rooms.js): the asker's browser hosts. Tennis: the host runs the game and sends
// snapshots (room:snap, 8 a second, ~150 bytes), the guest its own position (room:input, ~10
// a second, ~40 bytes) and its swings (room:relay). H-O-R-S-E and the workout send only
// reliable messages: a shot's launch (the other browser flies the same ball), a turn's
// result, a workout's beats and scores (a few a second at most).

const ACTS = { tennis: ["match", "rally"], horse: ["horse"], workout: ["daily", "quick", "together"] }
const ID = /^[a-z0-9-]{1,40}$/
const LEVELS = ["easy", "normal", "hard"]

const defaultSettings = { act: "tennis", mode: "match", venue: "park", spot: "tennis1", seed: 1, level: "normal" }

// relay messages: { t: type, ... } with small numbers and short strings only
const TYPES = new Set(["swing", "again", "shot", "result", "turn", "spot", "ready", "beat", "score", "done", "bye", "hello"])
const cleanValue = (v, depth = 0) => {
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 1000) / 1000 : 0
  if (typeof v === "boolean") return v
  if (typeof v === "string") return v.slice(0, 60)
  if (v === null) return null
  if (Array.isArray(v) && depth < 2) return v.slice(0, 24).map((x) => cleanValue(x, depth + 1))
  if (v && typeof v === "object" && depth < 2) {
    const out = {}
    for (const k of Object.keys(v).slice(0, 16)) if (/^[a-zA-Z0-9_]{1,12}$/.test(k)) out[k] = cleanValue(v[k], depth + 1)
    return out
  }
  return null
}

module.exports = {
  id: "parkact",
  name: "My Park together",
  minPlayers: 2,
  maxPlayers: 2,
  relay: true,
  spectate: false,
  defaultSettings,
  validateSettings: (s = {}) => {
    const act = s.act ?? defaultSettings.act
    if (!ACTS[act]) return { error: "That isn't something to do together." }
    const mode = s.mode ?? ACTS[act][0]
    if (!ACTS[act].includes(mode)) return { error: "Pick a game." }
    const venue = String(s.venue ?? "park")
    const spot = String(s.spot ?? "")
    if (!ID.test(venue) || !ID.test(spot)) return { error: "That place doesn't exist." }
    const seed = Number.isInteger(s.seed) && s.seed > 0 && s.seed < 2 ** 31 ? s.seed : 1
    const level = LEVELS.includes(s.level) ? s.level : "normal"
    return { act, mode, venue, spot, seed, level }
  },
  seats: () => 2,
  quickSeats: () => 2,
  bucket: (s) => `${s.act}:${s.mode}`,
  filterRelay: (data) => {
    if (!data || typeof data !== "object" || Array.isArray(data) || !TYPES.has(data.t)) return null
    const out = cleanValue(data)
    return out && JSON.stringify(out).length <= 2048 ? out : null
  },
}
