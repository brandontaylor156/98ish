// Sunny Acres snapshots: what a browser uploads is checked here before it's stored. The game's
// own rules (client/src/components/applets/town: plain ES modules) are loaded once, so the
// server knows every good, building and price exactly as the game does.

const path = require("path")
const { pathToFileURL } = require("url")

const TOWN_DIR = path.join(__dirname, "../../client/src/components/applets/town")
const load = (name) => import(pathToFileURL(path.join(TOWN_DIR, `${name}.js`)).href)

const rules = { G: null, D: null }
const ready = Promise.all([load("game"), load("data")]).then(([G, D]) => {
  rules.G = G
  rules.D = D
  return rules
})
ready.catch((error) => console.error("[town] couldn't load the game rules", error))

const MAX_BYTES = 200 * 1024
const MAX_OBJS = 1500
const ID = /^[a-z0-9]{1,24}$/
const EFFECT_ID = /^[a-f0-9]{18}$/

class Invalid extends Error {}
const fail = (message) => {
  throw new Invalid(message)
}

const int = (value, min, max, label) => {
  if (!Number.isInteger(value) || value < min || value > max) fail(`${label} doesn't look right.`)
  return value
}
const counts = (value, label, known) => {
  if (value === undefined) return {}
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} don't look right.`)
  const out = {}
  for (const [k, n] of Object.entries(value)) {
    if (!ID.test(k) || (known && !known(k))) fail(`${label} have something unknown in them.`)
    out[k] = int(n, -1, 1e6, label)
  }
  return out
}

// -> { data, text, bytes } for a snapshot that can be stored, or throws Invalid
const checkSnapshot = (input) => {
  const { D } = rules
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("That town couldn't be read.")
  const text = JSON.stringify(input)
  const bytes = Buffer.byteLength(text)
  if (bytes > MAX_BYTES) fail("That town is too big to save in the cloud.")
  if (!Array.isArray(input.objs) || input.objs.length > MAX_OBJS) fail("That town couldn't be read.")
  int(input.level, 1, 1000, "The level")
  int(input.xp, 0, 1e9, "The XP")
  int(input.coins, -1e6, 1e9, "The coins")
  int(input.clovers, -1e6, 1e9, "The clovers")
  counts(input.goods, "The Barn's goods", (k) => !!D.GOODS[k])
  counts(input.mats, "The tools", (k) => !!D.MATERIALS[k])
  counts(input.inv, "The gifts", (k) => !!D.DECOR[k])
  for (const o of input.objs) {
    if (!o || typeof o !== "object" || typeof o.t !== "string" || !ID.test(o.t)) fail("A building in that town doesn't look right.")
    if (!Number.isInteger(o.i) || !Number.isFinite(o.x) || !Number.isFinite(o.y)) fail("A building in that town doesn't look right.")
    if (o.x < -1 || o.y < -1 || o.x > D.MAP_W || o.y > D.MAP_H) fail("A building in that town is off the map.")
  }
  if (input.orders !== undefined && (!Array.isArray(input.orders) || input.orders.length > 20)) fail("The orders don't look right.")
  if (input.claimed !== undefined && (!Array.isArray(input.claimed) || input.claimed.length > 400 || input.claimed.some((id) => typeof id !== "string" || id.length > 40))) {
    fail("That town couldn't be read.")
  }
  if (input.paired !== undefined && (typeof input.paired !== "string" || input.paired.length > 40)) fail("That town couldn't be read.")
  return { data: input, text, bytes }
}

// the bits of a stored snapshot the server works with
const summary = (text) => {
  try {
    const s = JSON.parse(text)
    return {
      goods: s.goods || {},
      coins: s.coins || 0,
      level: s.level || 1,
      claimed: new Set(Array.isArray(s.claimed) ? s.claimed : []),
      harvests: Number(s.stats?.harvests) || 0,
      objIds: new Set((s.objs || []).map((o) => o.i)),
      state: s,
    }
  } catch {
    return null
  }
}

module.exports = { rules, ready, checkSnapshot, summary, Invalid, fail, MAX_BYTES, EFFECT_ID }
