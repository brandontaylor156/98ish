// Roam life (Explore in Pickleball 98, client/src/roam/; docs/open-world.md "Home, work, the
// stores and your Bag"), kept per 98 Messenger account: your private Home and Work places, the
// Bag (what you bought with play chips), gifts waiting for you, and your time worked at the
// office. One small record per account (MongoDB collection "roamlife" when MONGODB_URI is set,
// otherwise memory). The rules are the client's own pure files, loaded here like Buddy
// Locator's: client/src/roam/life/places.js and catalog.js.
//
// Privacy (Buddy Locator's design, docs/find-friends.md): a place is PRIVATE until you share it,
// one buddy at a time (people in your Buddy List, never someone who blocks you or you block).
// The people you share it with see it on their own map as "Ava's home"; nobody else ever sees
// it. Nothing about a real address is stored: a place is a building you picked in the game's
// town (its id, the town, metres from the town's origin, the door).
//
// Every route needs "Authorization: Bearer <token>" from a signed-on 98 Messenger session.
// All POST, JSON in and out ({ ok, ... }):
//   /state                       -> { places, shared, bag, gifts, work }   (shared: the places
//                                   buddies share with you: [{ owner, ownerName, label, ...place }])
//   /places/save  { place }      add or change one of mine (10 at most)
//   /places/remove { id }
//   /places/share { id, with: [screen names] }   who sees it (replaces the list; [] = private)
//   /bag/add      { items: { id: purchases } }    bought (a pack brings its count)
//   /bag/use      { id, n }      used up (eaten, put down, ridden off...)
//   /bag/gift     { to, id, note }   one of mine to a buddy (out of my Bag into their gifts)
//   /gifts/accept { id }         into my Bag;  /gifts/decline { id }  back to the sender's Bag
//   /work         { secs }       time worked (clocked out): the total and the count
// Live, on the 98 Messenger socket: "roamlife:gift" { from, name, item } to the one given to,
// "roamlife:changed" to my own other devices.
//
// Caps (Atlas' free 512 MB): 10 places (each shared with 10 at most), 80 kinds / 2,000 things in
// the Bag, 20 gifts waiting a person, notes 140 characters: a record is ~1-4 KB. Rates per
// account per 10 minutes: 300 requests, 60 gifts.

const path = require("path")
const { pathToFileURL } = require("url")
const crypto = require("crypto")
const express = require("express")
const mongoose = require("mongoose")
const { limiter } = require("../net/limiter")
const { validate: validateName, normalize } = require("../aim/screenNames")

const WINDOW_MS = 10 * 60_000
const BOT_KEY = "smarterchild"
const root = path.join(__dirname, "../../client/src/roam/life")
let mods = null
const loadRules = () => (mods ??= Promise.all([import(pathToFileURL(path.join(root, "places.js")).href), import(pathToFileURL(path.join(root, "catalog.js")).href)]).then(([places, catalog]) => ({ places, catalog })))

class Refused extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}
const refuse = (status, message) => {
  throw new Refused(status, message)
}
const copy = (d) => (d ? JSON.parse(JSON.stringify(d)) : null)
const blank = (key, name) => ({ key, name: name || key, places: [], bag: {}, gifts: [], work: { secs: 0, shifts: 0 }, changedAt: 0 })

const memoryLifeStore = () => {
  const docs = new Map()
  return {
    docs,
    get: async (key) => copy(docs.get(key)),
    put: async (doc) => {
      docs.set(doc.key, copy(doc))
    },
    remove: async (key) => docs.delete(key),
    sharedWith: async (key) => [...docs.values()].filter((d) => d.places.some((p) => p.shared.includes(key))).map(copy),
    // a gift into someone's record (made if need be), unless 20 are waiting -> bool
    pushGift: async (key, name, gift, max) => {
      const d = docs.get(key) || blank(key, name)
      if (d.gifts.length >= max) return false
      d.gifts.push(copy(gift))
      docs.set(key, d)
      return true
    },
    // a gift sent back (declined): into the sender's Bag (made if need be)
    giveBack: async (key, id, n) => {
      const d = docs.get(key)
      if (!d) return false
      d.bag[id] = (d.bag[id] || 0) + n
      return true
    },
    pullMentions: async (key) => {
      let n = 0
      for (const d of docs.values()) {
        const before = JSON.stringify([d.places, d.gifts])
        for (const p of d.places) p.shared = p.shared.filter((k) => k !== key)
        d.gifts = d.gifts.filter((g) => g.from !== key)
        if (JSON.stringify([d.places, d.gifts]) !== before) n++
      }
      return n
    },
  }
}

const mongoLifeStore = () => {
  const schema = new mongoose.Schema(
    { key: { type: String, required: true, unique: true }, name: String, places: { type: Array, default: [] }, bag: { type: mongoose.Schema.Types.Mixed, default: {} }, gifts: { type: Array, default: [] }, work: { type: mongoose.Schema.Types.Mixed, default: {} }, changedAt: Number },
    { minimize: false }
  )
  schema.index({ "places.shared": 1 })
  schema.index({ "gifts.from": 1 })
  const Model = mongoose.models.RoamLife || mongoose.model("RoamLife", schema, "roamlife")
  const clean = (d) => (d ? { key: d.key, name: d.name, places: d.places || [], bag: d.bag || {}, gifts: d.gifts || [], work: d.work || { secs: 0, shifts: 0 }, changedAt: d.changedAt || 0 } : null)
  return {
    get: async (key) => clean(await Model.findOne({ key }).lean()),
    put: async (doc) => {
      await Model.updateOne({ key: doc.key }, { $set: { name: doc.name, places: doc.places, bag: doc.bag, gifts: doc.gifts, work: doc.work, changedAt: doc.changedAt } }, { upsert: true })
    },
    remove: async (key) => (await Model.deleteOne({ key })).deletedCount > 0,
    sharedWith: async (key) => (await Model.find({ "places.shared": key }).lean()).map(clean),
    pushGift: async (key, name, gift, max) => {
      await Model.updateOne({ key }, { $setOnInsert: { name, places: [], bag: {}, gifts: [], work: { secs: 0, shifts: 0 }, changedAt: Date.now() } }, { upsert: true })
      const r = await Model.updateOne({ key, [`gifts.${max - 1}`]: { $exists: false } }, { $push: { gifts: gift } })
      return r.modifiedCount > 0
    },
    giveBack: async (key, id, n) => (await Model.updateOne({ key }, { $inc: { [`bag.${id}`]: n } })).modifiedCount > 0,
    pullMentions: async (key) => {
      const a = await Model.updateMany({ "places.shared": key }, { $pull: { "places.$[].shared": key } })
      const b = await Model.updateMany({ "gifts.from": key }, { $pull: { gifts: { from: key } } })
      return (a.modifiedCount || 0) + (b.modifiedCount || 0)
    },
  }
}

const createRoamLife = ({ aim, store = null, now = Date.now, limits = {} } = {}) => {
  const db = store || (process.env.MONGODB_URI ? mongoLifeStore() : memoryLifeStore())
  const getAim = async () => (typeof aim === "function" ? aim() : aim)
  const emitTo = async (key, event, payload) => {
    const socket = (await getAim())?.sessions?.get(key)?.socket
    if (socket) socket.emit(event, payload)
    return !!socket
  }
  const userOf = async (key) => {
    const service = await getAim()
    const session = service?.sessions?.get(key)
    if (session) return { name: session.user?.screenName || key, blocked: session.user?.blocked || [] }
    const user = await service?.store?.find?.(key)
    return user ? { name: user.screenName, blocked: user.blocked || [] } : null
  }
  const blockedBetween = async (a, b) => {
    const [ua, ub] = await Promise.all([userOf(a), userOf(b)])
    return !ua || !ub || ua.blocked.includes(b) || ub.blocked.includes(a)
  }
  const load = async (account) => {
    const d = (await db.get(account.key)) || blank(account.key, account.name)
    d.name = account.name
    return d
  }
  const save = async (doc) => {
    doc.changedAt = now()
    await db.put(doc)
  }
  const mine = (doc) => ({ places: doc.places, bag: doc.bag, gifts: doc.gifts, work: doc.work })
  const changed = (key) => emitTo(key, "roamlife:changed", {})

  // a buddy to share with or give to (in my Buddy List, a real account, not blocked either way)
  const findBuddy = async (account, input) => {
    const target = validateName(input)
    if (target.error) refuse(400, "That isn't a screen name.")
    if (target.key === account.key) refuse(400, "That's you!")
    if (target.key === BOT_KEY) refuse(400, "SmarterChild stays right here in the computer.")
    const user = await userOf(target.key)
    if (!user) refuse(404, `${target.screenName} isn't a registered screen name.`)
    if (!account.buddies.has(target.key)) refuse(403, `Add ${user.name} to your Buddy List first.`)
    if (await blockedBetween(account.key, target.key)) refuse(403, `You can't share with ${user.name}.`)
    return { key: target.key, name: user.name }
  }

  const state = async (account) => {
    const doc = await load(account)
    const shared = []
    for (const d of await db.sharedWith(account.key)) {
      if (await blockedBetween(d.key, account.key)) continue
      for (const p of d.places) if (p.shared.includes(account.key)) shared.push({ owner: d.key, ownerName: d.name, id: p.id, kind: p.kind, label: p.label, town: p.town, x: p.x, z: p.z, door: p.door })
    }
    return { ...mine(doc), shared }
  }

  const savePlace = async (account, { place } = {}) => {
    const { places } = await loadRules()
    const c = places.cleanPlace(place)
    if (!c) refuse(400, "That place didn't make sense.")
    const doc = await load(account)
    const old = doc.places.find((p) => p.id === c.id)
    // (who it's shared with only changes through /places/share)
    c.shared = old ? old.shared : []
    if (!old && doc.places.length >= places.PLACE_MAX) refuse(413, `You can keep up to ${places.PLACE_MAX} places.`)
    doc.places = old ? doc.places.map((p) => (p.id === c.id ? c : p)) : [...doc.places, c]
    await save(doc)
    changed(account.key)
    return mine(doc)
  }
  const removePlace = async (account, { id } = {}) => {
    const doc = await load(account)
    doc.places = doc.places.filter((p) => p.id !== id)
    await save(doc)
    changed(account.key)
    return mine(doc)
  }
  const sharePlace = async (account, { id, with: names } = {}) => {
    const { places } = await loadRules()
    const doc = await load(account)
    const p = doc.places.find((q) => q.id === id)
    if (!p) refuse(404, "That place isn't yours.")
    const list = Array.isArray(names) ? names : []
    if (list.length > places.SHARE_MAX) refuse(413, `A place can be shared with up to ${places.SHARE_MAX} people.`)
    const keys = []
    for (const n of list) keys.push((await findBuddy(account, n)).key)
    const before = new Set(p.shared)
    p.shared = [...new Set(keys)]
    await save(doc)
    changed(account.key)
    for (const k of p.shared) if (!before.has(k)) emitTo(k, "roamlife:shared", { from: account.name, kind: p.kind })
    for (const k of before) if (!p.shared.includes(k)) emitTo(k, "roamlife:shared", { from: account.name, kind: p.kind, gone: true })
    return mine(doc)
  }

  const addBag = async (account, { items } = {}) => {
    const { catalog } = await loadRules()
    const doc = await load(account)
    const r = catalog.addToBag(doc.bag, items)
    if (!r.ok) refuse(400, r.error)
    doc.bag = r.bag
    await save(doc)
    changed(account.key)
    return mine(doc)
  }
  const useBag = async (account, { id, n = 1 } = {}) => {
    const { catalog } = await loadRules()
    const doc = await load(account)
    const r = catalog.takeFromBag(doc.bag, id, n)
    if (!r.ok) refuse(400, r.error)
    doc.bag = r.bag
    await save(doc)
    changed(account.key)
    return mine(doc)
  }
  const gift = async (account, { to, id, note = "", n = 1 } = {}) => {
    const { catalog } = await loadRules()
    const person = await findBuddy(account, to)
    const doc = await load(account)
    const q = Math.max(1, Math.min(catalog.BAG.each, Math.floor(Number(n) || 1)))
    const r = catalog.takeFromBag(doc.bag, id, q)
    if (!r.ok) refuse(400, r.error)
    const g = { id: crypto.randomBytes(6).toString("hex"), from: account.key, fromName: account.name, item: id, n: q, note: String(note || "").replace(/[\u0000-\u001f<>]/g, "").slice(0, catalog.BAG.note), at: now() }
    if (!(await db.pushGift(person.key, person.name, g, catalog.BAG.gifts))) refuse(413, `${person.name} has a lot of gifts waiting already.`)
    doc.bag = r.bag
    await save(doc)
    changed(account.key)
    emitTo(person.key, "roamlife:gift", { from: account.name, item: id, note: g.note })
    return { ...mine(doc), to: person.name }
  }
  const acceptGift = async (account, { id } = {}) => {
    const { catalog } = await loadRules()
    const doc = await load(account)
    const g = doc.gifts.find((x) => x.id === id)
    if (!g) refuse(404, "That gift has gone.")
    const r = catalog.addUses(doc.bag, g.item, g.n)
    if (!r.ok) refuse(413, r.error)
    doc.bag = r.bag
    doc.gifts = doc.gifts.filter((x) => x.id !== id)
    await save(doc)
    changed(account.key)
    return mine(doc)
  }
  const declineGift = async (account, { id } = {}) => {
    const doc = await load(account)
    const g = doc.gifts.find((x) => x.id === id)
    if (!g) refuse(404, "That gift has gone.")
    doc.gifts = doc.gifts.filter((x) => x.id !== id)
    await save(doc)
    await db.giveBack(g.from, g.item, g.n)
    changed(account.key)
    return mine(doc)
  }
  const work = async (account, { secs } = {}) => {
    const s = Math.floor(Number(secs))
    if (!(s > 0) || s > 12 * 3600) refuse(400, "That shift didn't make sense.")
    const doc = await load(account)
    doc.work = { secs: (doc.work?.secs || 0) + s, shifts: (doc.work?.shifts || 0) + 1 }
    await save(doc)
    return mine(doc)
  }

  // Delete My Account: my record goes (places, Bag, gifts waiting, time worked), my name comes
  // off the places others share with me, and gifts I sent that weren't taken yet go
  const eraseAccount = async ({ key }) => {
    if (typeof key !== "string" || !key) return { removed: 0, changed: 0 }
    const removed = await db.remove(key)
    const changedN = await db.pullMentions(key)
    return { removed: removed ? 1 : 0, changed: changedN }
  }

  const router = () => {
    const r = express.Router()
    const requests = limiter(limits.requests ?? 300, WINDOW_MS)
    const gifts = limiter(limits.gifts ?? 60, WINDOW_MS)
    const badTokens = limiter(limits.badTokens ?? 30, WINDOW_MS)
    const ipOf = (request) => String(request.headers["x-forwarded-for"] || request.socket.remoteAddress || "").split(",")[0].trim()
    const accountFor = async (token) => {
      if (!/^[0-9a-f]{48}$/.test(token)) return null
      const service = await getAim()
      for (const session of service?.sessions?.values() || []) {
        if (session.token !== token) continue
        const buddies = new Set()
        for (const group of session.user?.groups || []) for (const name of group.buddies || []) buddies.add(normalize(name))
        return { key: session.key, name: session.user?.screenName || session.key, buddies }
      }
      return null
    }
    r.use(async (request, response, next) => {
      try {
        const ip = ipOf(request)
        if (badTokens.over(ip)) return response.status(429).json({ ok: false, error: "Too many tries. Please wait a few minutes." })
        const account = await accountFor(String(request.headers.authorization || "").replace(/^Bearer\s+/i, ""))
        if (!account) {
          badTokens(ip)
          return response.status(401).json({ ok: false, error: "Sign on to 98 Messenger to keep your places and Bag on your account." })
        }
        if (requests(account.key)) return response.status(429).json({ ok: false, error: "Slow down a little and try again in a few minutes." })
        request.account = account
        next()
      } catch (error) {
        next(error)
      }
    })
    r.use(express.json({ limit: "16kb" }))
    const handle = (fn) => async (request, response) => {
      try {
        response.json({ ok: true, ...(await fn(request.account, request.body || {})) })
      } catch (error) {
        if (error instanceof Refused) return response.status(error.status).json({ ok: false, error: error.message })
        console.error("[roamlife]", error?.message)
        response.status(503).json({ ok: false, error: "The server isn't answering. Try again in a minute." })
      }
    }
    r.post("/state", handle(state))
    r.post("/places/save", handle(savePlace))
    r.post("/places/remove", handle(removePlace))
    r.post("/places/share", handle(sharePlace))
    r.post("/bag/add", handle(addBag))
    r.post("/bag/use", handle(useBag))
    r.post(
      "/bag/gift",
      handle((account, body) => {
        if (gifts(account.key)) refuse(429, "That's a lot of gifts. Try again later.")
        return gift(account, body)
      })
    )
    r.post("/gifts/accept", handle(acceptGift))
    r.post("/gifts/decline", handle(declineGift))
    r.post("/work", handle(work))
    r.use((error, request, response, next) => {
      if (response.headersSent) return next(error)
      if (error.type === "entity.too.large") return response.status(413).json({ ok: false, error: "That's too much at once." })
      if (error.type === "entity.parse.failed") return response.status(400).json({ ok: false, error: "That request didn't make sense." })
      response.status(500).json({ ok: false, error: "That's unavailable right now. Please try again later." })
    })
    return r
  }

  return { router, state, savePlace, removePlace, sharePlace, addBag, useBag, gift, acceptGift, declineGift, work, eraseAccount, store: db }
}

module.exports = { createRoamLife, memoryLifeStore, mongoLifeStore }
