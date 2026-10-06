// Visual Basic 98 programs shared in 98 Messenger ("programs in a message"): each shared
// copy is one record with the program and its Shared state, used by everyone in the
// conversation it was sent to. MongoDB collection "vbapps" when MONGODB_URI is set,
// otherwise memory (lost on restart). A record:
//   { id, owner, members: [keys], names: { key: screenName }, title, conv, app: JSON text,
//     state: { key: value }, bytes, counts: { key: { d: "YYYY-MM-DD", n } },
//     createdAt, changedAt, expireAt: Date (MongoDB deletes it then: 30 days after the last change) }

const mongoose = require("mongoose")

const schema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    owner: { type: String, required: true, index: true },
    members: { type: [String], index: true },
    names: { type: mongoose.Schema.Types.Mixed, default: {} },
    title: { type: String, default: "" },
    conv: { type: String, default: "" },
    app: { type: String, default: "" },
    state: { type: mongoose.Schema.Types.Mixed, default: {} },
    bytes: { type: Number, default: 0 },
    counts: { type: mongoose.Schema.Types.Mixed, default: {} },
    createdAt: { type: Number, required: true },
    changedAt: { type: Number, required: true },
    expireAt: { type: Date, index: { expires: 0 } },
  },
  { minimize: false }
)

const copy = (r) => (r ? JSON.parse(JSON.stringify(r)) : null)

const memoryStore = () => {
  const recs = new Map()
  const live = () => [...recs.values()].filter((r) => !r.expireAt || new Date(r.expireAt) > new Date())
  return {
    kind: "memory",
    get: async (id) => {
      const r = recs.get(id)
      if (r && r.expireAt && new Date(r.expireAt) <= new Date()) return recs.delete(id), null
      return copy(r)
    },
    create: async (r) => {
      if (recs.has(r.id)) return false
      recs.set(r.id, copy(r))
      return true
    },
    update: async (id, patch) => {
      const r = recs.get(id)
      if (!r) return false
      recs.set(id, copy({ ...r, ...patch }))
      return true
    },
    remove: async (id) => recs.delete(id),
    listFor: async (key, limit = 50) =>
      live()
        .filter((r) => r.members.includes(key))
        .sort((a, b) => b.changedAt - a.changedAt)
        .slice(0, limit)
        .map((r) => copy({ ...r, app: undefined, state: undefined })),
    countOwned: async (key) => live().filter((r) => r.owner === key).length,
    totalBytes: async () => live().reduce((n, r) => n + (r.bytes || 0), 0),
    forKey: async (key) => live().filter((r) => r.members.includes(key) || r.owner === key).map(copy),
    size: () => recs.size,
  }
}

const mongoStore = (Model) => ({
  kind: "mongodb",
  get: async (id) => Model.findOne({ id }, { _id: 0, __v: 0 }).lean(),
  create: async (r) => {
    try {
      await Model.create(r)
      return true
    } catch (error) {
      if (error?.code === 11000) return false
      throw error
    }
  },
  update: async (id, patch) => (await Model.updateOne({ id }, { $set: patch })).matchedCount > 0,
  remove: async (id) => (await Model.deleteOne({ id })).deletedCount > 0,
  listFor: async (key, limit = 50) => Model.find({ members: key }, { _id: 0, __v: 0, app: 0, state: 0 }).sort({ changedAt: -1 }).limit(limit).lean(),
  countOwned: async (key) => Model.countDocuments({ owner: key }),
  totalBytes: async () => {
    const [row] = await Model.aggregate([{ $group: { _id: null, n: { $sum: "$bytes" } } }])
    return row?.n || 0
  },
  forKey: async (key) => Model.find({ $or: [{ members: key }, { owner: key }] }, { _id: 0, __v: 0 }).lean(),
})

const createVbappStore = async (uri = process.env.MONGODB_URI) => {
  if (!uri) {
    console.warn("[vb98] MONGODB_URI not set: shared programs are kept in memory and lost on restart")
    return memoryStore()
  }
  const connection = await mongoose.createConnection(uri, { maxPoolSize: 2 }).asPromise()
  console.log("[vb98] connected to MongoDB")
  return mongoStore(connection.model("VbApp", schema, "vbapps"))
}

module.exports = { createVbappStore, memoryStore }
