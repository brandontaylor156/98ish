// Push storage: each 98 Messenger account's push subscriptions (one per device or browser),
// its notification settings, and IMs that arrived while it was signed off. MongoDB when
// MONGODB_URI is set; otherwise in memory (lost when the server restarts).
//
//   subs.save({ key, endpoint, p256dh, auth, device })   one endpoint belongs to one account
//   subs.forKey(key) / subs.remove(endpoint) / subs.removeFor(key, endpoint) / subs.keys()
//   prefs.get(key) -> {} or the saved settings / prefs.set(key, patch)
//   inbox.add(key, message) / inbox.take(key) -> messages, oldest first (and forgets them)

const mongoose = require("mongoose")

const MAX_SUBS = 10 // per account: the oldest is dropped first
const MAX_INBOX = 100 // offline IMs kept per account
const INBOX_DAYS = 30

const memoryStore = () => {
  const subs = new Map() // endpoint -> sub
  const prefs = new Map() // key -> settings
  const inbox = new Map() // key -> [message]
  const copy = (value) => (value ? structuredClone(value) : value)
  return {
    kind: "memory",
    subs: {
      save: async (sub) => {
        const existing = subs.get(sub.endpoint)
        subs.set(sub.endpoint, { ...sub, createdAt: existing?.key === sub.key ? existing.createdAt : Date.now(), updatedAt: Date.now() })
        const mine = [...subs.values()].filter((s) => s.key === sub.key).sort((a, b) => a.updatedAt - b.updatedAt)
        for (const old of mine.slice(0, Math.max(0, mine.length - MAX_SUBS))) subs.delete(old.endpoint)
        return copy(subs.get(sub.endpoint))
      },
      forKey: async (key) => [...subs.values()].filter((s) => s.key === key).map(copy),
      remove: async (endpoint) => subs.delete(endpoint),
      removeFor: async (key, endpoint) => (subs.get(endpoint)?.key === key ? subs.delete(endpoint) : false),
      keys: async () => [...new Set([...subs.values()].map((s) => s.key))],
    },
    prefs: {
      get: async (key) => copy(prefs.get(key)) || {},
      set: async (key, patch) => {
        const next = { ...(prefs.get(key) || {}), ...patch }
        prefs.set(key, next)
        return copy(next)
      },
    },
    inbox: {
      add: async (key, message) => {
        const list = [...(inbox.get(key) || []), { ...message, at: Date.now() }]
        inbox.set(key, list.slice(-MAX_INBOX))
      },
      take: async (key) => {
        const list = (inbox.get(key) || []).filter((m) => Date.now() - m.at < INBOX_DAYS * 86_400_000)
        inbox.delete(key)
        return list.map(({ at, ...m }) => m)
      },
    },
    // deleting an account: its devices, settings and held IMs, and IMs it sent that are
    // still waiting for someone (from: its screen name, any spelling)
    eraseAccount: async (key) => {
      let removed = 0
      for (const [endpoint, s] of subs) if (s.key === key && subs.delete(endpoint)) removed++
      prefs.delete(key)
      inbox.delete(key)
      for (const [other, list] of inbox) inbox.set(other, list.filter((m) => normalizeName(m.from) !== key))
      return removed
    },
  }
}

const normalizeName = (name) => String(name || "").replace(/\s+/g, "").toLowerCase()

const subSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, index: true },
    endpoint: { type: String, required: true, unique: true },
    p256dh: String,
    auth: String,
    device: String,
  },
  { timestamps: true }
)
const prefsSchema = new mongoose.Schema({ key: { type: String, required: true, unique: true }, data: { type: Object, default: {} } }, { minimize: false })
const inboxSchema = new mongoose.Schema({
  key: { type: String, required: true, index: true },
  message: Object,
  at: { type: Date, default: Date.now, expires: INBOX_DAYS * 86_400 },
})

const mongoStore = (connection) => {
  const Sub = connection.model("PushSub", subSchema)
  const Prefs = connection.model("PushPrefs", prefsSchema)
  const Inbox = connection.model("PushInbox", inboxSchema)
  const plain = (doc) => doc && { key: doc.key, endpoint: doc.endpoint, p256dh: doc.p256dh, auth: doc.auth, device: doc.device || "", createdAt: doc.createdAt, updatedAt: doc.updatedAt }
  return {
    kind: "mongodb",
    subs: {
      save: async (sub) => {
        const doc = await Sub.findOneAndUpdate({ endpoint: sub.endpoint }, { $set: sub }, { upsert: true, returnDocument: "after" }).lean()
        const mine = await Sub.find({ key: sub.key }, { _id: 1 }).sort({ updatedAt: -1 }).lean()
        if (mine.length > MAX_SUBS) await Sub.deleteMany({ _id: { $in: mine.slice(MAX_SUBS).map((d) => d._id) } })
        return plain(doc)
      },
      forKey: async (key) => (await Sub.find({ key }).limit(MAX_SUBS * 2).lean()).map(plain),
      remove: async (endpoint) => (await Sub.deleteOne({ endpoint })).deletedCount > 0,
      removeFor: async (key, endpoint) => (await Sub.deleteOne({ key, endpoint })).deletedCount > 0,
      keys: async () => Sub.distinct("key"),
    },
    prefs: {
      get: async (key) => (await Prefs.findOne({ key }).lean())?.data || {},
      set: async (key, patch) => {
        const $set = Object.fromEntries(Object.entries(patch).map(([k, value]) => [`data.${k}`, value]))
        return (await Prefs.findOneAndUpdate({ key }, { $set }, { upsert: true, returnDocument: "after" }).lean()).data
      },
    },
    inbox: {
      add: async (key, message) => {
        await Inbox.create({ key, message })
        const ids = await Inbox.find({ key }, { _id: 1 }).sort({ at: -1 }).skip(MAX_INBOX).lean()
        if (ids.length) await Inbox.deleteMany({ _id: { $in: ids.map((d) => d._id) } })
      },
      take: async (key) => {
        const docs = await Inbox.find({ key }).sort({ at: 1 }).lean()
        if (docs.length) await Inbox.deleteMany({ _id: { $in: docs.map((d) => d._id) } })
        return docs.map((d) => d.message)
      },
    },
    eraseAccount: async (key) => {
      const { nameRegex } = require("../aim/store")
      const [subs] = await Promise.all([Sub.deleteMany({ key }), Prefs.deleteOne({ key }), Inbox.deleteMany({ key }), Inbox.deleteMany({ "message.from": nameRegex(key) })])
      return subs.deletedCount || 0
    },
  }
}

const createPushStore = async (uri = process.env.MONGODB_URI) => {
  if (!uri) return memoryStore()
  const connection = await mongoose.createConnection(uri, { maxPoolSize: 3 }).asPromise()
  console.log("[push] connected to MongoDB")
  return mongoStore(connection)
}

module.exports = { memoryStore, createPushStore, MAX_SUBS, MAX_INBOX }
