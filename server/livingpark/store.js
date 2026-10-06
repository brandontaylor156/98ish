// Living Park on the 98ish server: clones left in My Park (MongoDB collection "parkclones")
// when MONGODB_URI is set, otherwise memory (lost on restart). One record per owner (you can
// leave your clone at one venue at a time). Every save names the rev it read, so two writes
// at once can't overwrite each other (the caller reads again and retries).
//
// A record: { key (the owner's account), name, venue, clone (a validated Twin Clone profile,
//   twin/clone/profile.js), look (a sanitized Pickleball look), phrases: { greet, win, loss,
//   trash, cheer: [line] }, log: [{ id, at, by, byKey, cloneWon, score: [clone, visitor],
//   venue }], unseen, rev, leftAt, changedAt }

const mongoose = require("mongoose")

const Mixed = mongoose.Schema.Types.Mixed
const schema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    name: String,
    venue: { type: String, index: true },
    clone: Mixed,
    look: Mixed,
    phrases: Mixed,
    log: { type: Mixed, default: [] },
    unseen: { type: Number, default: 0 },
    rev: { type: Number, required: true },
    leftAt: Number,
    changedAt: { type: Number, index: true },
  },
  { minimize: false }
)

const FIELDS = ["name", "venue", "clone", "look", "phrases", "log", "unseen", "leftAt", "changedAt"]
const copy = (doc) => (doc ? JSON.parse(JSON.stringify(doc)) : null)

const memoryStore = () => {
  const docs = new Map()
  return {
    docs,
    get: async (key) => copy(docs.get(key)),
    atVenue: async (venue) => [...docs.values()].filter((d) => d.venue === venue).map(copy),
    all: async () => [...docs.values()].map(copy),
    count: async () => docs.size,
    // rev: the rev read (null: a new record); -> { ok, rev }
    put: async (doc, rev) => {
      const cur = docs.get(doc.key)
      if ((cur ? cur.rev : null) !== (rev ?? null)) return { ok: false }
      const next = { ...copy(doc), rev: (cur?.rev || 0) + 1 }
      docs.set(doc.key, next)
      return { ok: true, rev: next.rev }
    },
    remove: async (key) => docs.delete(key),
  }
}

const createLivingStore = () => {
  const Model = mongoose.models.ParkClone || mongoose.model("ParkClone", schema, "parkclones")
  const clean = (d) => {
    if (!d) return null
    const o = { key: d.key, rev: d.rev }
    for (const f of FIELDS) o[f] = d[f]
    return copy(o)
  }
  return {
    get: async (key) => clean(await Model.findOne({ key }).lean()),
    atVenue: async (venue) => (await Model.find({ venue }).limit(200).lean()).map(clean),
    all: async () => (await Model.find({}).limit(5000).lean()).map(clean),
    count: async () => Model.countDocuments({}),
    put: async (doc, rev) => {
      const set = { rev: (rev || 0) + 1 }
      for (const f of FIELDS) set[f] = doc[f]
      if (rev === null || rev === undefined) {
        try {
          await Model.create({ key: doc.key, ...set })
          return { ok: true, rev: set.rev }
        } catch {
          return { ok: false }
        }
      }
      const r = await Model.updateOne({ key: doc.key, rev }, { $set: set })
      return r.modifiedCount ? { ok: true, rev: set.rev } : { ok: false }
    },
    remove: async (key) => (await Model.deleteOne({ key })).deletedCount > 0,
  }
}

module.exports = { memoryStore, createLivingStore }
