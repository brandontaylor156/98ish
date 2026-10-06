// Venue Finder's cache of built venues (MongoDB collection "venuespecs" when MONGODB_URI is
// set, otherwise memory). Public map data only: a venue spec made from OpenStreetMap (ODbL),
// nothing about anyone. A record: { id, data (the spec as JSON text), size, info: { courts,
// bounds }, builtAt, usedAt }. Caps: `maxDocs` records (least recently used go first) and
// `maxBytes` in total.

const mongoose = require("mongoose")

const specSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    data: { type: String, required: true },
    size: { type: Number, required: true },
    info: { type: mongoose.Schema.Types.Mixed, required: true },
    builtAt: { type: Number, required: true },
    usedAt: { type: Number, required: true, index: true },
  },
  { minimize: false }
)

const memoryStore = ({ maxDocs = 2000, maxBytes = 40 * 1024 * 1024 } = {}) => {
  const docs = new Map()
  const bytes = () => [...docs.values()].reduce((n, d) => n + d.size, 0)
  const evict = () => {
    while (docs.size > maxDocs || (docs.size > 1 && bytes() > maxBytes)) {
      const oldest = [...docs.values()].sort((a, b) => a.usedAt - b.usedAt)[0]
      docs.delete(oldest.id)
    }
  }
  return {
    kind: "memory",
    get: async (id) => (docs.has(id) ? { ...docs.get(id) } : null),
    put: async (doc) => {
      docs.set(doc.id, { ...doc })
      evict()
    },
    touch: async (id, at) => {
      if (docs.has(id)) docs.get(id).usedAt = at
    },
    count: async () => docs.size,
    bytes: async () => bytes(),
  }
}

const mongoStore = (Spec, { maxDocs = 2000, maxBytes = 40 * 1024 * 1024 } = {}) => ({
  kind: "mongodb",
  get: async (id) => Spec.findOne({ id }, { _id: 0, __v: 0 }).lean(),
  put: async (doc) => {
    await Spec.updateOne({ id: doc.id }, { $set: doc }, { upsert: true })
    // over a cap: the least recently used go, 25 at a time
    const n = await Spec.countDocuments()
    if (n > maxDocs) {
      const old = await Spec.find({}, { id: 1 }).sort({ usedAt: 1 }).limit(Math.max(25, n - maxDocs)).lean()
      await Spec.deleteMany({ id: { $in: old.map((d) => d.id) } })
    }
    const [row] = await Spec.aggregate([{ $group: { _id: null, bytes: { $sum: "$size" } } }])
    if ((row?.bytes || 0) > maxBytes) {
      const old = await Spec.find({}, { id: 1 }).sort({ usedAt: 1 }).limit(50).lean()
      await Spec.deleteMany({ id: { $in: old.map((d) => d.id) } })
    }
  },
  touch: async (id, at) => {
    await Spec.updateOne({ id }, { $set: { usedAt: at } })
  },
  count: async () => Spec.countDocuments(),
  bytes: async () => {
    const [row] = await Spec.aggregate([{ $group: { _id: null, bytes: { $sum: "$size" } } }])
    return row?.bytes || 0
  },
})

const createVenueStore = async (uri = process.env.MONGODB_URI, caps = {}) => {
  if (!uri) {
    console.warn("[venues] MONGODB_URI not set: built venues are cached in memory")
    return memoryStore(caps)
  }
  const connection = await mongoose.createConnection(uri, { maxPoolSize: 2 }).asPromise()
  console.log("[venues] connected to MongoDB")
  return mongoStore(connection.model("VenueSpec", specSchema, "venuespecs"), caps)
}

module.exports = { createVenueStore, memoryStore }
