// One Address Book per 98 Messenger account. MongoDB (collection "addressbooks") when
// MONGODB_URI is set, otherwise memory (lost on restart). Every save bumps a revision and
// names the revision it read, so two devices syncing at once can't overwrite each other
// (the router reads again and merges again).

const mongoose = require("mongoose")

const bookSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, index: true }, // the screen name key
  data: { type: String, required: true }, // the contacts as JSON text
  revision: { type: Number, required: true },
  savedAt: { type: Date, required: true },
})

const read = (doc) => (doc ? { revision: doc.revision, savedAt: new Date(doc.savedAt).getTime(), contacts: JSON.parse(doc.data) } : { revision: 0, savedAt: null, contacts: [] })

// put() -> { ok: true, revision } | { ok: false } (someone saved since baseRevision)
const memoryStore = () => {
  const docs = new Map()
  return {
    kind: "memory",
    get: async (key) => read(docs.get(key)),
    put: async (key, data, baseRevision) => {
      const current = docs.get(key)
      if ((current?.revision || 0) !== baseRevision) return { ok: false }
      docs.set(key, { key, data, revision: baseRevision + 1, savedAt: new Date() })
      return { ok: true, revision: baseRevision + 1 }
    },
    remove: async (key) => docs.delete(key),
  }
}

const mongoStore = (Book) => ({
  kind: "mongodb",
  get: async (key) => read(await Book.findOne({ key }).lean()),
  put: async (key, data, baseRevision) => {
    const savedAt = new Date()
    if (baseRevision === 0) {
      try {
        await Book.create({ key, data, revision: 1, savedAt })
        return { ok: true, revision: 1 }
      } catch (error) {
        if (error.code !== 11000) throw error
        return { ok: false }
      }
    }
    const doc = await Book.findOneAndUpdate({ key, revision: baseRevision }, { $set: { data, savedAt }, $inc: { revision: 1 } }, { returnDocument: "after" }).lean()
    return doc ? { ok: true, revision: doc.revision } : { ok: false }
  },
  remove: async (key) => (await Book.deleteOne({ key })).deletedCount > 0,
})

const createContactsStore = async (uri = process.env.MONGODB_URI) => {
  if (!uri) {
    console.warn("[contacts] MONGODB_URI not set: address books are kept in memory and lost on restart")
    return memoryStore()
  }
  const connection = await mongoose.createConnection(uri, { maxPoolSize: 3 }).asPromise()
  console.log("[contacts] connected to MongoDB")
  return mongoStore(connection.model("AddressBook", bookSchema, "addressbooks"))
}

module.exports = { createContactsStore, memoryStore }
