// Notes on the 98ish server: one record per note (MongoDB collection "notes" when MONGODB_URI
// is set, otherwise memory, lost on restart). A record:
//   { id, owner, members: [keys], names: { key: screenName }, gone: [keys that left or were
//     removed: their devices drop it], data: the note as JSON text (client/src/components/
//     applets/notes/notesCore.js), size, rev, changedAt, purged, createdAt }
// A note with one member is a personal note; with more it's shared. Every save names the rev
// it read, so two devices saving at once can't overwrite each other (the caller reads again
// and merges again).

const mongoose = require("mongoose")

const noteSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    owner: { type: String, required: true },
    members: { type: [String], index: true },
    names: { type: mongoose.Schema.Types.Mixed, default: {} },
    gone: { type: [String], index: true },
    data: { type: String, required: true },
    size: { type: Number, required: true },
    rev: { type: Number, required: true },
    changedAt: { type: Number, required: true },
    purged: { type: Boolean, default: false },
    createdAt: { type: Number, required: true },
  },
  { minimize: false }
)
noteSchema.index({ members: 1, changedAt: 1 })
noteSchema.index({ owner: 1, purged: 1 })

const copy = (doc) => (doc ? { ...doc, members: [...doc.members], gone: [...(doc.gone || [])], names: { ...(doc.names || {}) } } : null)
const FIELDS = ["owner", "members", "names", "gone", "data", "size", "changedAt", "purged"]

const memoryStore = () => {
  const docs = new Map()
  const all = () => [...docs.values()]
  return {
    kind: "memory",
    get: async (id) => copy(docs.get(id)),
    // -> true, or false when the id is taken
    create: async (doc) => {
      if (docs.has(doc.id)) return false
      docs.set(doc.id, copy({ ...doc, rev: 1 }))
      return true
    },
    // -> { ok: true, rev } | { ok: false } (someone saved since baseRev)
    put: async (doc, baseRev) => {
      const current = docs.get(doc.id)
      if (!current || current.rev !== baseRev) return { ok: false }
      const next = copy({ ...current, ...Object.fromEntries(FIELDS.map((f) => [f, doc[f]])), rev: baseRev + 1 })
      docs.set(doc.id, next)
      return { ok: true, rev: next.rev }
    },
    // everything that changed for someone since a time (theirs, and ones they left)
    changedFor: async (key, since) => all().filter((d) => (d.members.includes(key) || d.gone?.includes(key)) && d.changedAt > since).map(copy),
    countFor: async (key) => all().filter((d) => d.members.includes(key) && !d.purged).length,
    bytesOwned: async (key) => all().reduce((n, d) => n + (d.owner === key && !d.purged ? d.size : 0), 0),
    forKey: async (key) => all().filter((d) => d.members.includes(key) || d.gone?.includes(key)).map(copy),
    remove: async (id) => docs.delete(id),
    size: () => docs.size,
  }
}

const mongoStore = (Note) => ({
  kind: "mongodb",
  get: async (id) => Note.findOne({ id }, { _id: 0, __v: 0 }).lean(),
  create: async (doc) => {
    try {
      await Note.create({ ...doc, rev: 1 })
      return true
    } catch (error) {
      if (error.code === 11000) return false
      throw error
    }
  },
  put: async (doc, baseRev) => {
    const set = Object.fromEntries(FIELDS.map((f) => [f, doc[f]]))
    const saved = await Note.findOneAndUpdate({ id: doc.id, rev: baseRev }, { $set: set, $inc: { rev: 1 } }, { returnDocument: "after", projection: { rev: 1 } }).lean()
    return saved ? { ok: true, rev: saved.rev } : { ok: false }
  },
  changedFor: async (key, since) => Note.find({ $or: [{ members: key }, { gone: key }], changedAt: { $gt: since } }, { _id: 0, __v: 0 }).lean(),
  countFor: async (key) => Note.countDocuments({ members: key, purged: false }),
  bytesOwned: async (key) => {
    const [row] = await Note.aggregate([{ $match: { owner: key, purged: false } }, { $group: { _id: null, bytes: { $sum: "$size" } } }])
    return row?.bytes || 0
  },
  forKey: async (key) => Note.find({ $or: [{ members: key }, { gone: key }] }, { _id: 0, __v: 0 }).lean(),
  remove: async (id) => (await Note.deleteOne({ id })).deletedCount > 0,
})

const createNotesStore = async (uri = process.env.MONGODB_URI) => {
  if (!uri) {
    console.warn("[notes] MONGODB_URI not set: notes are kept in memory and lost on restart")
    return memoryStore()
  }
  const connection = await mongoose.createConnection(uri, { maxPoolSize: 3 }).asPromise()
  console.log("[notes] connected to MongoDB")
  return mongoStore(connection.model("Note", noteSchema, "notes"))
}

module.exports = { createNotesStore, memoryStore }
