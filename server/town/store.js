// Sunny Acres' cloud storage: one small document per player (their town snapshot, notes and
// hearts from visitors, help requests, gifts in the mailbox, changes waiting for their
// browser) and one per couple per week (the joint goal). MongoDB when MONGODB_URI is set,
// otherwise kept in memory.

const mongoose = require("mongoose")

const clone = (value) => (value == null ? value : JSON.parse(JSON.stringify(value)))

const memoryStore = () => {
  const docs = new Map()
  return {
    kind: "memory",
    get: async (id) => clone(docs.get(id)) || null,
    put: async (doc) => void docs.set(doc._id, clone(doc)),
    remove: async (id) => docs.delete(id),
    removeOlder: async (prefix, before) => {
      for (const [id, doc] of docs) if (id.startsWith(prefix) && (doc.updatedAt || 0) < before) docs.delete(id)
    },
    size: () => docs.size,
  }
}

const townSchema = new mongoose.Schema(
  {
    _id: String,
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    updatedAt: { type: Number, index: true },
  },
  { versionKey: false, minimize: false }
)

const mongoStore = (connection) => {
  const Town = connection.model("TownDoc", townSchema)
  return {
    kind: "mongodb",
    get: async (id) => {
      const row = await Town.findById(id).lean()
      return row ? { ...row.data, _id: row._id } : null
    },
    put: async (doc) => {
      const { _id, ...data } = doc
      await Town.replaceOne({ _id }, { _id, data, updatedAt: doc.updatedAt || Date.now() }, { upsert: true })
    },
    remove: async (id) => (await Town.deleteOne({ _id: id })).deletedCount > 0,
    removeOlder: async (prefix, before) => {
      await Town.deleteMany({ _id: { $regex: `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}` }, updatedAt: { $lt: before } })
    },
  }
}

const createTownStore = async (uri = process.env.MONGODB_URI) => {
  if (!uri) {
    console.warn("[town] MONGODB_URI not set: towns are kept in memory")
    return memoryStore()
  }
  const connection = await mongoose.createConnection(uri, { maxPoolSize: 3 }).asPromise()
  console.log("[town] connected to MongoDB")
  return mongoStore(connection)
}

module.exports = { memoryStore, createTownStore }
