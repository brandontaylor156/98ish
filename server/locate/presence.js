// Live Venue Presence on the server: which of Pickleball 98's real venues a sharing friend is
// physically at, worked out here from the latest position Buddy Locator already keeps, so the
// people who may see them get only { id, area } (a venue and a court, never a finer spot).
// The rules are client/src/utils/courts/presence.js (a copy of Pickleball 98's own, which now
// lives in its own repo, brandontaylor156/pickleball-98); the venues are prebuilt records
// (origin, walkable bounds, courts) in server/locate/venues.json, made from Pickleball 98's
// hand-tuned specs. Nothing is stored: the answer sits in memory next to the position (for the
// hysteresis at the gate) and goes when the position goes.

const fs = require("fs")
const path = require("path")
const { pathToFileURL } = require("url")

const VENUES_FILE = path.join(__dirname, "venues.json")

let rulesModule = null
const loadRules = () => (rulesModule ??= import(pathToFileURL(path.join(__dirname, "../../client/src/utils/courts/presence.js")).href))

let table = null
// the real venues (Riverside, the made-up park, was never in the list)
const loadVenues = async () => {
  if (table) return table
  try {
    table = JSON.parse(fs.readFileSync(VENUES_FILE, "utf8"))
  } catch {
    table = []
  }
  return table
}

// one per Buddy Locator service: key -> { id, area } | { id, nearby } (in memory only)
const createPresence = ({ venues = null } = {}) => {
  const at = new Map()
  const list = async () => venues || (await loadVenues())
  return {
    // a new position for `key`: -> { now, changed }
    async step(key, pos) {
      const rules = await loadRules()
      const prev = at.get(key) || null
      const now = rules.presenceStep(await list(), prev, pos)
      if (now) at.set(key, now)
      else at.delete(key)
      return { now, changed: !rules.samePresence(prev, now) }
    },
    // what's known for `key` (a position without a step yet, after a restart: worked out now)
    async of(key, pos) {
      if (!pos) return null
      if (at.has(key)) return at.get(key)
      return (await this.step(key, pos)).now
    },
    forget(key) {
      at.delete(key)
    },
    get size() {
      return at.size
    },
  }
}

module.exports = { createPresence, loadVenues, loadRules }
