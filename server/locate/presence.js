// Live Venue Presence on the server: which of Pickleball 98's real venues a sharing friend is
// physically at, worked out here from the latest position Buddy Locator already keeps, so the
// people who may see them get only { id, area } (a venue and a court, never a finer spot).
// The rules are client/src/components/applets/pickleball/park/presence.js (the same file the
// app uses); the venues are My Park's hand-tuned specs (their origin and courts) with the
// walkable bounds from server/park/venues.json. Nothing is stored: the answer sits in memory
// next to the position (for the hysteresis at the gate) and goes when the position goes.

const fs = require("fs")
const path = require("path")
const { pathToFileURL } = require("url")

const VENUE_DIR = path.join(__dirname, "../../client/src/components/applets/pickleball/park/venues")
const BOUNDS_FILE = path.join(__dirname, "../park/venues.json")

let rulesModule = null
const loadRules = () => (rulesModule ??= import(pathToFileURL(path.join(__dirname, "../../client/src/components/applets/pickleball/park/presence.js")).href))

let table = null
// the real venues (Riverside is made up: nobody is ever "at" it)
const loadVenues = async () => {
  if (table) return table
  const rules = await loadRules()
  let bounds = {}
  try {
    bounds = JSON.parse(fs.readFileSync(BOUNDS_FILE, "utf8"))
  } catch {
    bounds = {}
  }
  const out = []
  for (const id of Object.keys(bounds)) {
    if (id === "riverside") continue
    try {
      const spec = JSON.parse(fs.readFileSync(path.join(VENUE_DIR, `${id}.json`), "utf8"))
      if (Array.isArray(spec.origin)) out.push(rules.venueRecord(spec, bounds[id].bounds))
    } catch {
      // a venue without a spec file is skipped
    }
  }
  table = out
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
