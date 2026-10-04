// Dream House, shared: one house per couple (98ish's couples module pairs two 98 Messenger
// accounts), decorated by both of them at once. Every request needs a signed-on 98
// Messenger session (Authorization: Bearer, see ../aim/auth.js) of one of the pair.
//   GET    /api/dollhouse        { house (compact form) or null, rev }
//   PUT    /api/dollhouse        { house } start (or replace) the shared house
//   POST   /api/dollhouse/ops    { ops: [...] } edits -> { rev, current: [newer versions of refused ops] }
//   DELETE /api/dollhouse        delete it (either partner)
// Edits merge per item: the higher version wins, ties go to the higher device tag (the
// very same rules file the client uses, client/.../dollhouse/model.js). The partner's
// signed-on 98 Messenger socket hears "dollhouse:ops" / "dollhouse:reset" /
// "dollhouse:deleted". Only the two partners can ever read or change their house; after
// they unpair it's out of reach, and 30 days later it's deleted. Stored in MongoDB
// (collection "dollhouses") when MONGODB_URI is set, otherwise in memory.

const path = require("path")
const { pathToFileURL } = require("url")
const express = require("express")
const mongoose = require("mongoose")
const { limiter } = require("../net/limiter")
const { sessionFrom } = require("../aim/auth")

const MAX_BYTES = 64 * 1024 // one house, as JSON (a full house is about 25 KB)
const MAX_OPS = 60 // per request
const KEEP_UNPAIRED_MS = 30 * 24 * 60 * 60 * 1000
const SWEEP_MS = 60 * 60 * 1000

// the couples module (if this server has it)
let couples = null
try {
  couples = require("../couples")
} catch {
  couples = null
}

const MODEL = path.join(__dirname, "../../client/src/components/applets/dollhouse/model.js")
let modelPromise = null
const loadModel = () => (modelPromise ??= import(pathToFileURL(MODEL).href))

// ---------- storage: { id (the couple), data (JSON text), rev, members, updatedAt, orphanedAt } ----------

const memoryStore = () => {
  const docs = new Map()
  return {
    kind: "memory",
    get: async (id) => (docs.has(id) ? { ...docs.get(id), members: [...docs.get(id).members] } : null),
    put: async (id, doc) => void docs.set(id, { ...doc, id }),
    remove: async (id) => docs.delete(id),
    all: async () => [...docs.values()].map((d) => ({ id: d.id, members: [...d.members], orphanedAt: d.orphanedAt || null })),
    mark: async (id, orphanedAt) => {
      const d = docs.get(id)
      if (d) d.orphanedAt = orphanedAt
    },
  }
}

const houseSchema = new mongoose.Schema(
  {
    _id: String,
    data: String,
    rev: Number,
    members: [String],
    updatedAt: Date,
    orphanedAt: Date,
  },
  { versionKey: false }
)

const mongoStore = (connection) => {
  const House = connection.model("Dollhouse", houseSchema)
  const plain = (d) => d && { id: d._id, data: d.data, rev: d.rev, members: d.members || [], updatedAt: d.updatedAt, orphanedAt: d.orphanedAt || null }
  return {
    kind: "mongodb",
    get: async (id) => plain(await House.findById(id).lean()),
    put: async (id, doc) => void (await House.replaceOne({ _id: id }, { _id: id, data: doc.data, rev: doc.rev, members: doc.members, updatedAt: doc.updatedAt, orphanedAt: doc.orphanedAt || null }, { upsert: true })),
    remove: async (id) => (await House.deleteOne({ _id: id })).deletedCount > 0,
    all: async () => (await House.find({}, { members: 1, orphanedAt: 1 }).lean()).map((d) => ({ id: d._id, members: d.members || [], orphanedAt: d.orphanedAt || null })),
    mark: async (id, orphanedAt) => void (await House.updateOne({ _id: id }, { $set: { orphanedAt } })),
  }
}

const createHouseStore = async (uri = process.env.MONGODB_URI) => {
  if (!uri) {
    console.warn("[dollhouse] MONGODB_URI not set: shared houses are kept in memory")
    return memoryStore()
  }
  const connection = await mongoose.createConnection(uri, { maxPoolSize: 2 }).asPromise()
  console.log("[dollhouse] connected to MongoDB")
  return mongoStore(connection)
}

// ---------- HTTP ----------

const dollhouseRouter = ({ store: storeOrPromise, aim: initialAim = null, limits = {}, coupleIdOf = couples?.coupleIdOf, maxBytes = MAX_BYTES, sweepEvery = SWEEP_MS } = {}) => {
  let aim = initialAim
  let storePromise = null
  const getStore = () => (storePromise ??= Promise.resolve(storeOrPromise || createHouseStore()))
  getStore().catch((error) => {
    console.error("[dollhouse] storage failed to start", error.message)
    storePromise = null
  })

  const requests = limiter(limits.requestsPerMinute ?? 240, 60_000)
  const writes = limiter(limits.writesPerMinute ?? 90, 60_000)
  const replaces = limiter(limits.replacesPerHour ?? 20, 60 * 60_000)

  const coupleOf = (key) => {
    try {
      return coupleIdOf?.(key) || null
    } catch {
      return null
    }
  }
  const socketOf = (key) => aim?.sessions?.get(key)?.socket || null
  const tellOthers = (doc, key, event, payload) => {
    for (const member of doc?.members || []) if (member !== key) socketOf(member)?.emit(event, payload)
  }

  // one edit at a time per house (read, merge, write)
  const queues = new Map()
  const serial = (id, fn) => {
    const run = (queues.get(id) || Promise.resolve()).then(fn, fn)
    const tail = run.catch(() => {})
    queues.set(id, tail)
    tail.then(() => queues.get(id) === tail && queues.delete(id))
    return run
  }

  const router = express.Router()

  router.use((request, response, next) => {
    const session = sessionFrom(aim, request)
    if (!session) return response.status(401).json({ ok: false, error: "Sign on to 98 Messenger to share your house." })
    if (requests(session.key)) return response.status(429).json({ ok: false, error: "Slow down!" })
    const couple = coupleOf(session.key)
    if (!couple) return response.status(403).json({ ok: false, error: "Pair up with your partner first to share a house." })
    request.house = { session, couple: String(couple) }
    next()
  })

  const handle = (fn) => async (request, response) => {
    try {
      await fn(request, response, request.house, await getStore(), await loadModel())
    } catch (error) {
      console.error("[dollhouse]", error.message)
      response.status(503).json({ ok: false, error: "The house server isn't answering. Please try again later." })
    }
  }

  // a house belongs to (at most) two accounts: a third can never get in, even with the id
  const allowed = (doc, key) => !doc || doc.members.includes(key) || doc.members.length < 2
  const withMember = (doc, key) => (doc.members.includes(key) ? doc.members : [...doc.members, key].slice(0, 2))
  const writeLimited = (key, response) => {
    if (!writes(key)) return false
    response.status(429).json({ ok: false, error: "You're decorating very fast! Wait a moment." })
    return true
  }

  router.get(
    "/",
    handle(async (request, response, { session, couple }, store) => {
      const doc = await store.get(couple)
      if (!allowed(doc, session.key)) return response.status(403).json({ ok: false, error: "That house isn't yours." })
      if (!doc) return response.json({ ok: true, house: null, rev: 0 })
      // the second partner's first visit makes the house theirs too (and nobody else's)
      if (!doc.members.includes(session.key)) {
        await serial(couple, async () => {
          const fresh = await store.get(couple)
          if (fresh && allowed(fresh, session.key)) await store.put(couple, { ...fresh, members: withMember(fresh, session.key) })
        })
      }
      response.json({ ok: true, house: JSON.parse(doc.data), rev: doc.rev })
    })
  )

  router.put(
    "/",
    express.json({ limit: maxBytes + 16 * 1024 }),
    handle(async (request, response, { session, couple }, store, M) => {
      const house = M.deserialize(request.body?.house)
      if (!house || typeof request.body?.house !== "object") return response.status(400).json({ ok: false, error: "That isn't a house." })
      const data = JSON.stringify(M.serialize(house))
      if (Buffer.byteLength(data) > maxBytes) return response.status(413).json({ ok: false, error: "That house is too big to share." })
      if (writeLimited(session.key, response)) return
      if (replaces(session.key)) return response.status(429).json({ ok: false, error: "You've replaced the house a lot. Wait a while." })
      await serial(couple, async () => {
        const doc = await store.get(couple)
        if (!allowed(doc, session.key)) return response.status(403).json({ ok: false, error: "That house isn't yours." })
        const next = { data, rev: (doc?.rev || 0) + 1, members: withMember(doc || { members: [] }, session.key), updatedAt: new Date(), orphanedAt: null }
        await store.put(couple, next)
        tellOthers(next, session.key, "dollhouse:reset", { rev: next.rev, by: session.user?.screenName })
        response.json({ ok: true, house: JSON.parse(data), rev: next.rev })
      })
    })
  )

  router.post(
    "/ops",
    express.json({ limit: "48kb" }),
    handle(async (request, response, { session, couple }, store, M) => {
      const ops = request.body?.ops
      if (!Array.isArray(ops) || !ops.length) return response.status(400).json({ ok: false, error: "No changes to save." })
      if (ops.length > MAX_OPS) return response.status(400).json({ ok: false, error: `At most ${MAX_OPS} changes at a time.` })
      if (writeLimited(session.key, response)) return
      await serial(couple, async () => {
        const doc = await store.get(couple)
        if (!allowed(doc, session.key)) return response.status(403).json({ ok: false, error: "That house isn't yours." })
        if (!doc) return response.status(404).json({ ok: false, error: "You don't have a shared house yet." })
        const house = M.deserialize(doc.data) || M.emptyHouse()
        const accepted = []
        const current = new Map()
        let invalid = 0
        for (const raw of ops) {
          const op = M.cleanOp(raw)
          if (!op) {
            invalid++
            continue
          }
          if (M.applyOp(house, op)) accepted.push(op)
          else {
            const now = M.currentOpFor(house, op)
            if (now) current.set(op.t === "r" ? `r:${op.id}` : `i:${op.e[0]}`, now)
          }
        }
        let rev = doc.rev
        if (accepted.length) {
          const data = JSON.stringify(M.serialize(house))
          if (Buffer.byteLength(data) > maxBytes) return response.status(413).json({ ok: false, error: "Your house is full! Delete some things first." })
          rev += 1
          const next = { data, rev, members: withMember(doc, session.key), updatedAt: new Date(), orphanedAt: null }
          await store.put(couple, next)
          tellOthers(next, session.key, "dollhouse:ops", { ops: accepted, rev, by: session.user?.screenName })
        }
        response.json({ ok: true, rev, accepted: accepted.length, invalid, current: [...current.values()] })
      })
    })
  )

  router.delete(
    "/",
    handle(async (request, response, { session, couple }, store) => {
      if (writeLimited(session.key, response)) return
      await serial(couple, async () => {
        const doc = await store.get(couple)
        if (!allowed(doc, session.key)) return response.status(403).json({ ok: false, error: "That house isn't yours." })
        if (doc) {
          await store.remove(couple)
          tellOthers(doc, session.key, "dollhouse:deleted", { by: session.user?.screenName })
        }
        response.json({ ok: true })
      })
    })
  )

  router.use((error, request, response, next) => {
    if (error?.type === "entity.too.large") return response.status(413).json({ ok: false, error: "That house is too big to share." })
    if (error?.type === "entity.parse.failed") return response.status(400).json({ ok: false, error: "That house couldn't be read." })
    next(error)
  })

  // Houses of couples who've unpaired: out of reach right away, deleted after 30 days
  const sweep = async (now = Date.now()) => {
    const store = await getStore()
    let removed = 0
    for (const doc of await store.all()) {
      const still = doc.members.length > 0 && doc.members.every((key) => coupleOf(key) === doc.id)
      if (still) {
        if (doc.orphanedAt) await store.mark(doc.id, null)
      } else if (!doc.orphanedAt) await store.mark(doc.id, new Date(now))
      else if (now - new Date(doc.orphanedAt).getTime() > KEEP_UNPAIRED_MS) {
        await store.remove(doc.id)
        removed++
      }
    }
    return removed
  }
  if (sweepEvery) {
    const timer = setInterval(() => sweep().catch((error) => console.error("[dollhouse] sweep failed", error.message)), sweepEvery)
    timer.unref?.()
  }

  // Delete My Account (../account): the house of every couple they were in
  const eraseAccount = async ({ key, coupleIds = [] }) => {
    const store = await getStore()
    let removed = 0
    for (const doc of await store.all()) {
      if (!coupleIds.includes(doc.id) && !doc.members.includes(key)) continue
      if (await store.remove(doc.id)) removed++
      for (const member of doc.members) if (member !== key) socketOf(member)?.emit("dollhouse:deleted", {})
    }
    return { removed }
  }

  return Object.assign(router, { useAim: (value) => (aim = value), sweep, eraseAccount })
}

module.exports = { dollhouseRouter, memoryStore, createHouseStore, MAX_BYTES, MAX_OPS, KEEP_UNPAIRED_MS }
