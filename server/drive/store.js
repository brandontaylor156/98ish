// One online drive copy per 98 Messenger account. MongoDB (collection "drives") when
// MONGODB_URI is set, otherwise memory (lost on restart). Every save bumps a revision;
// a save names the revision it was based on and is refused if someone saved since.

const mongoose = require("mongoose")

const driveSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, index: true }, // the screen name key
  data: { type: String, required: true }, // the snapshot as JSON text (keeps any key names safe)
  size: { type: Number, required: true },
  revision: { type: Number, required: true },
  savedAt: { type: Date, required: true },
})

const info = (doc) => doc && { revision: doc.revision, savedAt: new Date(doc.savedAt).toISOString(), size: doc.size }

// put() -> { ok: true, doc } | { ok: false, conflict: true, doc (the newer one, or null) }
const memoryStore = () => {
  const docs = new Map()
  return {
    kind: "memory",
    get: async (key) => docs.get(key) || null,
    put: async (key, { data, size }, baseRevision) => {
      const current = docs.get(key) || null
      if ((current?.revision || 0) !== baseRevision) return { ok: false, conflict: true, doc: current }
      const doc = { key, data, size, revision: baseRevision + 1, savedAt: new Date() }
      docs.set(key, doc)
      return { ok: true, doc }
    },
    remove: async (key) => docs.delete(key),
  }
}

const mongoStore = (Drive) => ({
  kind: "mongodb",
  get: async (key) => Drive.findOne({ key }).lean(),
  put: async (key, { data, size }, baseRevision) => {
    const savedAt = new Date()
    if (baseRevision === 0) {
      try {
        const doc = await Drive.create({ key, data, size, revision: 1, savedAt })
        return { ok: true, doc: doc.toObject() }
      } catch (error) {
        if (error.code !== 11000) throw error
        return { ok: false, conflict: true, doc: await Drive.findOne({ key }).lean() }
      }
    }
    // only if nobody saved since the revision this was based on
    const doc = await Drive.findOneAndUpdate(
      { key, revision: baseRevision },
      { $set: { data, size, savedAt }, $inc: { revision: 1 } },
      { returnDocument: "after" }
    ).lean()
    if (doc) return { ok: true, doc }
    return { ok: false, conflict: true, doc: await Drive.findOne({ key }).lean() }
  },
  remove: async (key) => (await Drive.deleteOne({ key })).deletedCount > 0,
})

const createDriveStore = async (uri = process.env.MONGODB_URI) => {
  if (!uri) {
    console.warn("[drive] MONGODB_URI not set: online drives are kept in memory and lost on restart")
    return memoryStore()
  }
  const connection = await mongoose.createConnection(uri, { maxPoolSize: 3 }).asPromise()
  console.log("[drive] connected to MongoDB")
  return mongoStore(connection.model("Drive", driveSchema))
}

module.exports = { createDriveStore, memoryStore, info }
