// Shared documents for "Come Over" (the multiplayer desktop): a Notepad text, a Paint
// canvas or a Shared with Friends folder that several people edit at once. Each is a Yjs
// document (a CRDT); the server keeps its merged state so people who open it later (or come
// back from offline) catch up. MongoDB collection "shareddocs" when MONGODB_URI is set,
// otherwise memory (lost on restart). A record:
//   { id, owner, members: [keys], names: { key: screenName }, kind: "text" | "paint" | "folder",
//     title, state: the Yjs update (base64), size: bytes, changedAt, createdAt }

const mongoose = require("mongoose")

const docSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    owner: { type: String, required: true, index: true },
    members: { type: [String], index: true },
    names: { type: mongoose.Schema.Types.Mixed, default: {} },
    kind: { type: String, required: true },
    title: { type: String, default: "" },
    state: { type: String, default: "" },
    size: { type: Number, default: 0 },
    changedAt: { type: Number, required: true },
    createdAt: { type: Number, required: true },
  },
  { minimize: false }
)

const copy = (doc) => (doc ? { ...doc, members: [...doc.members], names: { ...(doc.names || {}) } } : null)
const META = { state: 0 }

const memoryStore = () => {
  const docs = new Map()
  const all = () => [...docs.values()]
  return {
    kind: "memory",
    get: async (id) => copy(docs.get(id)),
    create: async (doc) => {
      if (docs.has(doc.id)) return false
      docs.set(doc.id, copy(doc))
      return true
    },
    // fields to change (state, size, members, names, owner, title, changedAt)
    update: async (id, patch) => {
      const d = docs.get(id)
      if (!d) return false
      docs.set(id, copy({ ...d, ...patch }))
      return true
    },
    listFor: async (key) => all().filter((d) => d.members.includes(key)).map((d) => copy({ ...d, state: undefined })),
    countOwned: async (key) => all().filter((d) => d.owner === key).length,
    bytesOwned: async (key) => all().reduce((n, d) => n + (d.owner === key ? d.size : 0), 0),
    totalBytes: async () => all().reduce((n, d) => n + d.size, 0),
    forKey: async (key) => all().filter((d) => d.members.includes(key) || d.owner === key).map(copy),
    remove: async (id) => docs.delete(id),
    size: () => docs.size,
  }
}

const mongoStore = (Doc) => ({
  kind: "mongodb",
  get: async (id) => Doc.findOne({ id }, { _id: 0, __v: 0 }).lean(),
  create: async (doc) => {
    try {
      await Doc.create(doc)
      return true
    } catch (error) {
      if (error.code === 11000) return false
      throw error
    }
  },
  update: async (id, patch) => (await Doc.updateOne({ id }, { $set: patch })).matchedCount > 0,
  listFor: async (key) => Doc.find({ members: key }, { _id: 0, __v: 0, ...META }).lean(),
  countOwned: async (key) => Doc.countDocuments({ owner: key }),
  bytesOwned: async (key) => {
    const [row] = await Doc.aggregate([{ $match: { owner: key } }, { $group: { _id: null, bytes: { $sum: "$size" } } }])
    return row?.bytes || 0
  },
  totalBytes: async () => {
    const [row] = await Doc.aggregate([{ $group: { _id: null, bytes: { $sum: "$size" } } }])
    return row?.bytes || 0
  },
  forKey: async (key) => Doc.find({ $or: [{ members: key }, { owner: key }] }, { _id: 0, __v: 0 }).lean(),
  remove: async (id) => (await Doc.deleteOne({ id })).deletedCount > 0,
})

const createYdocStore = async (uri = process.env.MONGODB_URI) => {
  if (!uri) {
    console.warn("[come over] MONGODB_URI not set: shared documents are kept in memory and lost on restart")
    return memoryStore()
  }
  const connection = await mongoose.createConnection(uri, { maxPoolSize: 3 }).asPromise()
  console.log("[come over] connected to MongoDB")
  return mongoStore(connection.model("SharedDoc", docSchema, "shareddocs"))
}

module.exports = { createYdocStore, memoryStore }
