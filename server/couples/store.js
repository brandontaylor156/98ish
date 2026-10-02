// Storage for couples: the pairs themselves (collection "couples") and everything a couple
// keeps together (collection "coupleitems": letters, story moments, photos, bouquets).
// MongoDB when MONGODB_URI is set, otherwise memory (lost on restart).
// An item's picture lives in `blob`, kept out of lists so they stay small.

const mongoose = require("mongoose")

// pair: { id, a, b, names: { [key]: screenName }, status: "pending" | "paired" | "ended",
//         requestedBy, createdAt, pairedAt, endedAt }
// item: { id, coupleId, kind, by, data, blob, size, createdAt, updatedAt }

const copy = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)))
const listed = (item) => item && { ...item, data: copy(item.data), blob: undefined }
const whole = (item) => item && { ...item, data: copy(item.data) }

const memoryStore = () => {
  const pairs = new Map()
  const items = new Map() // coupleId -> Map(id -> item)
  const box = (coupleId) => items.get(coupleId) || items.set(coupleId, new Map()).get(coupleId)
  return {
    kind: "memory",
    pairs: {
      all: async () => [...pairs.values()].map((p) => ({ ...p, names: { ...p.names } })),
      save: async (pair) => {
        pairs.set(pair.id, { ...pair, names: { ...pair.names } })
        return pair
      },
      remove: async (id) => pairs.delete(id),
    },
    items: {
      insert: async (item) => {
        box(item.coupleId).set(item.id, whole(item))
        return item
      },
      get: async (coupleId, id) => whole(box(coupleId).get(id)) || null,
      list: async (coupleId, kind) =>
        [...box(coupleId).values()].filter((i) => i.kind === kind).sort((a, b) => a.createdAt - b.createdAt).map(listed),
      update: async (coupleId, id, patch) => {
        const item = box(coupleId).get(id)
        if (!item) return null
        Object.assign(item, copy(patch))
        return listed(item)
      },
      remove: async (coupleId, id) => box(coupleId).delete(id),
      usage: async (coupleId) => [...box(coupleId).values()].reduce((sum, i) => sum + (i.size || 0), 0),
      purge: async (coupleId) => items.delete(coupleId),
    },
  }
}

const pairSchema = new mongoose.Schema(
  {
    _id: String,
    a: { type: String, index: true },
    b: { type: String, index: true },
    names: mongoose.Schema.Types.Mixed,
    status: String,
    requestedBy: String,
    createdAt: Number,
    pairedAt: Number,
    endedAt: Number,
  },
  { versionKey: false, collection: "couples" }
)

const itemSchema = new mongoose.Schema(
  {
    _id: String,
    coupleId: { type: String, index: true },
    kind: String,
    by: String,
    data: mongoose.Schema.Types.Mixed,
    blob: String,
    size: Number,
    createdAt: Number,
    updatedAt: Number,
  },
  { versionKey: false, collection: "coupleitems", minimize: false }
)
itemSchema.index({ coupleId: 1, kind: 1, createdAt: 1 })

const mongoStore = (connection) => {
  const Pair = connection.model("Couple", pairSchema)
  const Item = connection.model("CoupleItem", itemSchema)
  const plain = (doc) => {
    if (!doc) return null
    const { _id, ...rest } = doc
    return { id: _id, ...rest }
  }
  return {
    kind: "mongodb",
    pairs: {
      all: async () => (await Pair.find({}).lean()).map(plain),
      save: async (pair) => {
        const { id, ...rest } = pair
        await Pair.replaceOne({ _id: id }, { _id: id, ...rest }, { upsert: true })
        return pair
      },
      remove: async (id) => (await Pair.deleteOne({ _id: id })).deletedCount > 0,
    },
    items: {
      insert: async (item) => {
        const { id, ...rest } = item
        await Item.create({ _id: id, ...rest })
        return item
      },
      get: async (coupleId, id) => plain(await Item.findOne({ _id: id, coupleId }).lean()),
      list: async (coupleId, kind) => (await Item.find({ coupleId, kind }, { blob: 0 }).sort({ createdAt: 1 }).limit(2000).lean()).map(plain),
      update: async (coupleId, id, patch) =>
        plain(await Item.findOneAndUpdate({ _id: id, coupleId }, { $set: patch }, { returnDocument: "after", projection: { blob: 0 } }).lean()),
      remove: async (coupleId, id) => (await Item.deleteOne({ _id: id, coupleId })).deletedCount > 0,
      usage: async (coupleId) => (await Item.aggregate([{ $match: { coupleId } }, { $group: { _id: null, n: { $sum: "$size" } } }]))[0]?.n || 0,
      purge: async (coupleId) => Item.deleteMany({ coupleId }),
    },
  }
}

const createCoupleStore = async (uri = process.env.MONGODB_URI) => {
  if (!uri) {
    console.warn("[couples] MONGODB_URI not set: couples are kept in memory")
    return memoryStore()
  }
  const connection = await mongoose.createConnection(uri, { maxPoolSize: 5 }).asPromise()
  console.log("[couples] connected to MongoDB")
  return mongoStore(connection)
}

module.exports = { memoryStore, createCoupleStore }
