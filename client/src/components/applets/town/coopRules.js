// Sunny Acres co-op: what players send ("intents"), applying them with the game's own rules,
// and the small patches the server sends back. Plain ES module, shared by the browser
// (optimistic moves) and the server (server/town/coop.js, the real town).
//
// An intent is { a: action, ...args }. Planting, harvesting, feeding and collecting take a
// list of ids, so one swipe across the fields is one intent.

import * as G from "./game.js"
import { CROPS, GOODS, PENS, itemName, typeName } from "./data.js"

export const MAX_PLAYERS = 4
export const MAX_IDS = 40 // things one intent may touch
export const MAX_INTENT_BYTES = 2048
// a player's color, by their place in the town's member list
export const COLORS = ["#ff5f8f", "#3d8bff", "#f59a00", "#2fae5a"]
// a player may act this often: a burst of BURST, then RATE a second
export const BURST = 20
export const RATE = 10
// "is it ready?" checks allow for the two clocks being a little apart
export const SLACK_MS = 1500

const BATCH = { plant: true, harvest: true, feed: true, collect: true }
export const isBatch = (a) => !!BATCH[a]

const isId = (v) => Number.isInteger(v) && v > 0 && v < 1e7
const isIdx = (v, max) => Number.isInteger(v) && v >= 0 && v < max
// (never a built-in like "constructor": GOODS["constructor"] is Object, and selling it made the coins NaN)
const isKey = (v) => typeof v === "string" && /^[a-z0-9]{1,24}$/.test(v) && !(v in Object.prototype)
const isTile = (v) => Number.isInteger(v) && v >= -1 && v <= 31

// a clean copy of an intent from the network, or null if it doesn't look right
export const checkIntent = (it) => {
  if (!it || typeof it !== "object" || Array.isArray(it) || typeof it.a !== "string") return null
  const a = it.a
  const ids = () => {
    if (!Array.isArray(it.ids) || !it.ids.length || it.ids.length > MAX_IDS || !it.ids.every(isId)) return null
    return [...new Set(it.ids)]
  }
  switch (a) {
    case "plant": {
      const list = ids()
      return list && isKey(it.crop) ? { a, ids: list, crop: it.crop } : null
    }
    case "harvest":
    case "feed":
    case "collect": {
      const list = ids()
      return list ? { a, ids: list } : null
    }
    case "make":
      return isId(it.id) && isKey(it.g) ? { a, id: it.id, g: it.g } : null
    case "collectGoods":
    case "addSlot":
    case "sell":
      return isId(it.id) ? { a, id: it.id } : null
    case "deliver": {
      if (!isIdx(it.i, 20) || !it.need || typeof it.need !== "object" || Array.isArray(it.need)) return null
      const need = {}
      for (const [k, n] of Object.entries(it.need)) {
        if (!GOODS[k] || !Number.isInteger(n) || n < 1 || n > 99) return null
        need[k] = n
      }
      return Object.keys(need).length ? { a, i: it.i, need } : null
    }
    case "skip":
      return isIdx(it.i, 20) ? { a, i: it.i } : null
    case "load":
      return isIdx(it.k, 10) ? { a, k: it.k } : null
    case "send":
    case "barn":
      return { a }
    case "build":
      return isKey(it.type) && isTile(it.x) && isTile(it.y) ? { a, type: it.type, x: it.x, y: it.y, f: it.f ? 1 : 0 } : null
    case "move":
      return isId(it.id) && isTile(it.x) && isTile(it.y) ? { a, id: it.id, x: it.x, y: it.y, f: it.f ? 1 : 0 } : null
    case "sellGood":
      return isKey(it.g) && Number.isInteger(it.n) && it.n >= 1 && it.n <= 999 ? { a, g: it.g, n: it.n } : null
    case "expand":
      return isIdx(it.k, 8) ? { a, k: it.k } : null
    case "hurry": {
      const t = it.target
      if (!t || typeof t !== "object") return null
      if (t.train === true) return { a, target: { train: true } }
      if (isIdx(t.order, 20)) return { a, target: { order: t.order } }
      if (isId(t.obj)) return { a, target: { obj: t.obj } }
      return null
    }
    default:
      return null
  }
}

// one thing in a batch: (state, id, intent, now) -> result
const ONE = {
  plant: (s, id, it, now) => G.plant(s, id, it.crop, now),
  harvest: (s, id, it, now) => G.harvest(s, id, now),
  feed: (s, id, it, now) => G.feedPen(s, id, now),
  collect: (s, id, it, now) => G.collectPen(s, id, now),
}

// "not yet" answers that a moment more on the clock could change
const NOT_YET = new Set(["Not ripe yet.", "Nothing ready yet."])
const tryAt = (fn, now, slack) => {
  const r = fn(now)
  return !r.ok && slack && NOT_YET.has(r.reason) ? fn(now + slack) : r
}

// Apply an intent with the game's rules. -> { ok, reason, done: [ids], failed: [ids], ...extra }
// slack: how far ahead "is it ready yet?" may look (the server allows for clock skew)
export const applyIntent = (s, it, now, { slack = 0 } = {}) => {
  if (isBatch(it.a)) {
    const done = []
    const failed = []
    let reason = null
    let got = 0
    for (const id of it.ids) {
      const r = tryAt((t) => ONE[it.a](s, id, it, t), now, slack)
      if (r.ok) {
        done.push(id)
        got += r.n || 0
      } else {
        failed.push(id)
        reason ||= r.reason
      }
    }
    return done.length ? { ok: true, done, failed, reason, n: got } : { ok: false, done, failed, reason: reason || "Nothing to do." }
  }
  const one = (r, id) => (r.ok ? { ...r, done: id ? [id] : [], failed: [] } : { ...r, done: [], failed: id ? [id] : [] })
  switch (it.a) {
    case "make":
      return one(G.queueProduct(s, it.id, it.g, now), it.id)
    case "collectGoods":
      return one(tryAt((t) => G.collectFactory(s, it.id, t), now, slack), it.id)
    case "addSlot":
      return one(G.addSlot(s, it.id), it.id)
    case "deliver": {
      if (!G.sameNeed(G.requestNeed(s, "order", it.i), it.need)) return one({ ok: false, reason: "That order changed. Have another look!" })
      return one(G.deliverOrder(s, it.i, now))
    }
    case "skip":
      return one(G.skipOrder(s, it.i, now))
    case "load":
      return one(G.loadCar(s, it.k, now))
    case "send":
      return one(G.sendTrain(s, now))
    case "barn":
      return one(G.upgradeBarn(s))
    case "build": {
      const r = G.build(s, it.type, it.x, it.y, now)
      if (r.ok && it.f) r.obj.f = 1
      return one(r.ok ? { ok: true, id: r.obj.i } : r)
    }
    case "move":
      return one(G.move(s, it.id, it.x, it.y, !!it.f), it.id)
    case "sell":
      return one(G.sellObj(s, it.id), it.id)
    case "sellGood":
      return one(G.sellGood(s, it.g, it.n))
    case "expand":
      return one(G.expand(s, it.k, now))
    case "hurry":
      return one(G.speedUp(s, it.target, now), it.target.obj)
    default:
      return { ok: false, reason: "That isn't something we know.", done: [], failed: [] }
  }
}

// ---- what a player is doing, in words ----

const cropName = (id) => (CROPS.find((c) => c.id === id)?.name || itemName(id)).toLowerCase()
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const aOrAn = (word) => `${/^[aeiou]/i.test(word) ? "an" : "a"} ${word}`

// "planting wheat": for the little label over a player's head
export const doing = (it, s) => {
  const o = (id) => (s && id ? G.objById(s, id) : null)
  switch (it.a) {
    case "plant":
      return `planting ${cropName(it.crop)}`
    case "harvest":
      return "harvesting"
    case "feed":
      return "feeding the animals"
    case "collect":
      return "collecting"
    case "make":
      return `making ${itemName(it.g).toLowerCase()}`
    case "collectGoods":
      return "collecting goods"
    case "deliver":
      return "delivering an order"
    case "load":
      return "loading the train"
    case "send":
      return "waving the train off"
    case "build":
      return `building ${aOrAn(typeName(it.type).toLowerCase())}`
    case "move":
      return `moving the ${typeName(o(it.id)?.t || "field").toLowerCase()}`
    default:
      return "busy"
  }
}

// "Alice harvested 6 wheat": a line for the activity feed. `before` is the state the intent
// was applied to (for names of things that are gone afterwards); r is applyIntent's result.
export const describe = (name, it, r, before) => {
  const objName = (id) => typeName(G.objById(before, id)?.t || "field")
  switch (it.a) {
    case "plant":
      return `${name} planted ${plural(r.done.length, "field")} of ${cropName(it.crop)}`
    case "harvest":
      return `${name} harvested ${plural(r.done.length, "field")}`
    case "feed":
      return `${name} fed the ${PENS[G.objById(before, r.done[0])?.t]?.animalName?.toLowerCase() || "animals"}`
    case "collect":
      return `${name} collected ${r.n || 1} ${itemName(PENS[G.objById(before, r.done[0])?.t]?.good || "milk").toLowerCase()}`
    case "make":
      return `${name} started some ${itemName(it.g).toLowerCase()}`
    case "collectGoods":
      return `${name} collected goods at the ${objName(it.id)}`
    case "addSlot":
      return `${name} added a slot to the ${objName(it.id)}`
    case "deliver":
      return `${name} delivered an order ♥`
    case "skip":
      return `${name} turned down an order`
    case "load":
      return `${name} loaded a train car`
    case "send":
      return `${name} sent the train off`
    case "barn":
      return `${name} made the Barn bigger`
    case "build":
      return `${name} built ${aOrAn(typeName(it.type))}`
    case "move":
      return `${name} moved the ${objName(it.id)}`
    case "sell":
      return `${name} sold the ${objName(it.id)}`
    case "sellGood":
      return `${name} sold ${it.n} ${itemName(it.g).toLowerCase()}`
    case "expand":
      return `${name} cleared new land!`
    case "hurry":
      return `${name} hurried things along with clovers`
    default:
      return `${name} did something`
  }
}

// the past tense, for "Already harvested by Bob"
export const DONE_WORDS = { plant: "planted", harvest: "harvested", feed: "fed", collect: "collected", collectGoods: "collected", sell: "sold", move: "moved" }

// ---- patches: what changed in a town ----

// remember the town as it is, cheaply, to diff against later (not s.t, the time of the last
// tick, which changes every time and nobody needs)
const SKIP = new Set(["objs", "ev", "t"])
export const snapshotOf = (s) => {
  const top = {}
  for (const [k, v] of Object.entries(s)) if (!SKIP.has(k)) top[k] = JSON.stringify(v)
  const objs = new Map()
  for (const o of s.objs) objs.set(o.i, JSON.stringify(o))
  return { top, objs }
}

// -> { set, unset, objs, del } or null when nothing changed
export const diffState = (before, s) => {
  const after = snapshotOf(s)
  const patch = {}
  for (const [k, j] of Object.entries(after.top)) {
    if (before.top[k] !== j) (patch.set ||= {})[k] = JSON.parse(j)
  }
  for (const k of Object.keys(before.top)) if (!(k in after.top)) (patch.unset ||= []).push(k)
  for (const [i, j] of after.objs) if (before.objs.get(i) !== j) (patch.objs ||= []).push(JSON.parse(j))
  for (const i of before.objs.keys()) if (!after.objs.has(i)) (patch.del ||= []).push(i)
  return Object.keys(patch).length ? patch : null
}

const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)))

export const applyPatch = (s, p) => {
  if (!p) return s
  for (const [k, v] of Object.entries(p.set || {})) s[k] = clone(v)
  for (const k of p.unset || []) delete s[k]
  if (p.del?.length) {
    const gone = new Set(p.del)
    s.objs = s.objs.filter((o) => !gone.has(o.i))
  }
  for (const o of p.objs || []) {
    const k = s.objs.findIndex((x) => x.i === o.i)
    if (k >= 0) s.objs[k] = clone(o)
    else s.objs.push(clone(o))
  }
  return s
}

// ---- a fresh co-op town ----

export const newCoopTown = (now, seed) => {
  const s = G.newGame(now, seed)
  s.tut = 6 // two farmers don't need the tutorial
  s.coins += 150 // ...but they do get a little more to start with
  return s
}

// ---- playing together: achievements for the whole town ----

export const COOP_ACHIEVEMENTS = [
  { id: "together", name: "Two Farmers, One Farm", text: "Two of you played in the town at the same time." },
  { id: "first-harvest", name: "First Harvest Together", text: "Everyone in town harvested something." },
  { id: "crops-100", name: "Bumper Crop", text: "Harvested 100 crops together." },
  { id: "orders-10", name: "Busy Helipad", text: "Delivered 10 orders together." },
  { id: "builders", name: "Barn Raising", text: "Built 5 things together." },
  { id: "level-5", name: "Growing Up Together", text: "The co-op town reached level 5." },
  { id: "full-house", name: "Full House", text: "Three or more farmers at once!" },
]

// which achievements a town has earned now: stats = { [key]: { total: {...} } }, online = players now
export const earned = (s, stats, online) => {
  const totals = Object.values(stats || {}).map((p) => p.total || {})
  const sum = (k) => totals.reduce((n, t) => n + (t[k] || 0), 0)
  const out = []
  if (online >= 2) out.push("together")
  if (totals.length >= 2 && totals.every((t) => (t.crops || 0) > 0)) out.push("first-harvest")
  if (sum("crops") >= 100) out.push("crops-100")
  if (sum("orders") >= 10) out.push("orders-10")
  if (sum("built") >= 5) out.push("builders")
  if (s.level >= 5) out.push("level-5")
  if (online >= 3) out.push("full-house")
  return out
}

// what an intent adds to the player's stats
export const statsFor = (it, r) => {
  const out = {}
  if (!r.ok) return out
  if (it.a === "harvest") out.crops = r.n || r.done.length * G.HARVEST_YIELD
  else if (it.a === "plant") out.planted = r.done.length
  else if (it.a === "collect") out.animals = r.n || r.done.length
  else if (it.a === "collectGoods") out.made = r.goods?.length || 1
  else if (it.a === "deliver") out.orders = 1
  else if (it.a === "load") out.cars = 1
  else if (it.a === "build") out.built = 1
  return out
}
