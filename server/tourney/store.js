// Pickleball 98 tournaments on the 98ish server: tournament records (MongoDB "pbtourneys")
// and each account's trophy shelf ("pbtrophies"), or memory without MONGODB_URI. Writes name
// the rev they read (two players reporting at once can't overwrite each other).
//   tourney: { id, start, status, members: [keys], doc: { ...the record (tourneyCore.js) }, rev }
//   trophies: { key, list: [trophy] }

const mongoose = require("mongoose")

const Mixed = mongoose.Schema.Types.Mixed
const tourneySchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    start: { type: Number, index: true },
    status: { type: String, index: true },
    members: { type: [String], index: true },
    doc: Mixed,
    rev: { type: Number, required: true },
  },
  { minimize: false }
)
const trophySchema = new mongoose.Schema({ key: { type: String, required: true, unique: true }, list: { type: Mixed, default: [] } }, { minimize: false })

const copy = (x) => (x ? JSON.parse(JSON.stringify(x)) : null)
const row = (doc) => ({ id: doc.id, start: doc.start, status: doc.status, members: doc.members || [], doc })

const memoryStore = () => {
  const tourneys = new Map()
  const shelves = new Map()
  return {
    kind: "memory",
    tourneys: {
      get: async (id) => copy(tourneys.get(id)?.doc ? { ...tourneys.get(id).doc, rev: tourneys.get(id).rev } : null),
      create: async (doc) => {
        if (tourneys.has(doc.id)) return false
        tourneys.set(doc.id, { ...row(copy(doc)), rev: 1 })
        return true
      },
      put: async (doc, baseRev) => {
        const cur = tourneys.get(doc.id)
        if (!cur || cur.rev !== baseRev) return { ok: false }
        const { rev, ...clean } = doc
        tourneys.set(doc.id, { ...row(copy(clean)), rev: baseRev + 1 })
        return { ok: true, rev: baseRev + 1 }
      },
      remove: async (id) => tourneys.delete(id),
      forKey: async (key) => [...tourneys.values()].filter((t) => t.members.includes(key)).map((t) => copy({ ...t.doc, rev: t.rev })),
      inRange: async (from, to) => [...tourneys.values()].filter((t) => t.start >= from && t.start <= to).map((t) => copy({ ...t.doc, rev: t.rev })),
      due: async (now) => [...tourneys.values()].filter((t) => t.status !== "done" && t.start <= now).map((t) => copy({ ...t.doc, rev: t.rev })),
      startedBefore: async (t) => [...tourneys.values()].filter((x) => x.start < t).map((x) => x.id),
      count: async () => tourneys.size,
    },
    trophies: {
      get: async (key) => copy(shelves.get(key) || []),
      put: async (key, list) => void shelves.set(key, copy(list)),
      remove: async (key) => shelves.delete(key),
    },
  }
}

const mongoStore = (Tourney, Trophy) => {
  const view = (r) => (r ? { ...r.doc, rev: r.rev } : null)
  return {
    kind: "mongodb",
    tourneys: {
      get: async (id) => view(await Tourney.findOne({ id }, { _id: 0, __v: 0 }).lean()),
      create: async (doc) => {
        try {
          await Tourney.create({ ...row(doc), rev: 1 })
          return true
        } catch (error) {
          if (error.code === 11000) return false
          throw error
        }
      },
      put: async (doc, baseRev) => {
        const { rev, ...clean } = doc
        const r = row(clean)
        const saved = await Tourney.findOneAndUpdate({ id: doc.id, rev: baseRev }, { $set: { start: r.start, status: r.status, members: r.members, doc: r.doc }, $inc: { rev: 1 } }, { returnDocument: "after", projection: { rev: 1 } }).lean()
        return saved ? { ok: true, rev: saved.rev } : { ok: false }
      },
      remove: async (id) => (await Tourney.deleteOne({ id })).deletedCount > 0,
      forKey: async (key) => (await Tourney.find({ members: key }, { _id: 0, __v: 0 }).lean()).map(view),
      inRange: async (from, to) => (await Tourney.find({ start: { $gte: from, $lte: to } }, { _id: 0, __v: 0 }).lean()).map(view),
      due: async (now) => (await Tourney.find({ status: { $ne: "done" }, start: { $lte: now } }, { _id: 0, __v: 0 }).lean()).map(view),
      startedBefore: async (t) => (await Tourney.find({ start: { $lt: t } }, { id: 1 }).lean()).map((d) => d.id),
      count: async () => Tourney.estimatedDocumentCount(),
    },
    trophies: {
      get: async (key) => (await Trophy.findOne({ key }, { _id: 0, list: 1 }).lean())?.list || [],
      put: async (key, list) => void (await Trophy.updateOne({ key }, { $set: { list } }, { upsert: true })),
      remove: async (key) => void (await Trophy.deleteOne({ key })),
    },
  }
}

const createTourneyStore = async (uri = process.env.MONGODB_URI) => {
  if (!uri) {
    console.warn("[tourney] MONGODB_URI not set: tournaments and trophies are kept in memory and lost on restart")
    return memoryStore()
  }
  const connection = await mongoose.createConnection(uri, { maxPoolSize: 2 }).asPromise()
  console.log("[tourney] connected to MongoDB")
  return mongoStore(connection.model("PbTourney", tourneySchema, "pbtourneys"), connection.model("PbTrophy", trophySchema, "pbtrophies"))
}

module.exports = { createTourneyStore, memoryStore }
