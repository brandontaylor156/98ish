// Records for Shared Albums (see index.js). Two collections:
//
//   albums      { _id: id (16 hex), name, owner, members: [keys], names: { key: screen name },
//                 count, bytes, createdAt, changedAt, lastBy, lastWhat, burst?, rev }
//   albumitems  { _id: id (20 hex), a: album id, k: who added it ("" never: erased with the
//                 account), n: their name, kind: "image" | "video", mime, z: bytes, w, h, d,
//                 path, thumb (small JPEG data URL), cap, taken, at, pending, x (until when a
//                 pending upload may finish), likes: [keys], comments: [{ id, k, n, t, at }] }
//
// Without MONGODB_URI everything is kept in memory (development and tests).

const mongoose = require("mongoose")

const copy = (r) => (r ? structuredClone(r) : null)
const noThumb = ({ thumb, ...rest }) => rest

const memoryAlbumStore = () => {
  const albums = new Map()
  const items = new Map()
  const live = (r) => !r.pending
  return {
    kind: "memory",
    // ---- albums ----
    createAlbum: async (doc) => void albums.set(doc._id, structuredClone({ ...doc, rev: 1 })),
    getAlbum: async (id) => copy(albums.get(id)),
    // optimistic: only if nobody changed it since `rev` -> { ok }
    putAlbum: async (doc, rev) => {
      const cur = albums.get(doc._id)
      if (!cur || cur.rev !== rev) return { ok: false }
      albums.set(doc._id, structuredClone({ ...doc, rev: rev + 1 }))
      return { ok: true }
    },
    removeAlbum: async (id) => void albums.delete(id),
    albumsFor: async (key) => [...albums.values()].filter((a) => a.members.includes(key)).map(copy),
    countOwned: async (key) => [...albums.values()].filter((a) => a.owner === key).length,
    // ---- items ----
    addItem: async (rec) => void items.set(rec._id, structuredClone(rec)),
    getItem: async (id) => copy(items.get(id)),
    updateItem: async (id, patch) => void (items.has(id) && Object.assign(items.get(id), structuredClone(patch))),
    itemsOf: async (albumId) => [...items.values()].filter((r) => r.a === albumId && live(r)).map((r) => noThumb(copy(r))),
    allItemsOf: async (albumId) => [...items.values()].filter((r) => r.a === albumId).map((r) => noThumb(copy(r))),
    thumbsOf: async (albumId, ids) => [...items.values()].filter((r) => r.a === albumId && live(r) && ids.includes(r._id)).map((r) => ({ _id: r._id, thumb: r.thumb })),
    countItems: async (albumId) => [...items.values()].filter((r) => r.a === albumId).length,
    countAll: async () => items.size,
    bytesBy: async (key) => [...items.values()].filter((r) => r.k === key).reduce((s, r) => s + r.z, 0),
    bytesTotal: async () => [...items.values()].reduce((s, r) => s + r.z, 0),
    itemsBy: async (key) => [...items.values()].filter((r) => r.k === key).map((r) => noThumb(copy(r))),
    removeItems: async (ids) => ids.forEach((id) => items.delete(id)),
    stalePending: async (now, limit) => [...items.values()].filter((r) => r.pending && new Date(r.x).getTime() <= now.getTime()).slice(0, limit).map((r) => noThumb(copy(r))),
    like: async (id, key, on) => {
      const r = items.get(id)
      if (r) r.likes = on ? [...new Set([...r.likes, key])] : r.likes.filter((k) => k !== key)
    },
    comment: async (id, c, max) => {
      const r = items.get(id)
      if (r) r.comments = [...r.comments, structuredClone(c)].slice(-max)
    },
    uncomment: async (id, cid) => {
      const r = items.get(id)
      if (r) r.comments = r.comments.filter((c) => c.id !== cid)
    },
    // Delete My Account: their likes and comments everywhere
    forgetTraces: async (key) => {
      let n = 0
      for (const r of items.values()) {
        const before = r.likes.length + r.comments.length
        r.likes = r.likes.filter((k) => k !== key)
        r.comments = r.comments.filter((c) => c.k !== key)
        if (r.likes.length + r.comments.length !== before) n++
      }
      return n
    },
    tracesOf: async (key) => [...new Set([...items.values()].filter((r) => r.likes.includes(key) || r.comments.some((c) => c.k === key)).map((r) => r.a))],
  }
}

const mongoAlbumStore = (connection) => {
  const Albums = connection.collection("albums")
  const Items = connection.collection("albumitems")
  Albums.createIndex({ members: 1 }).catch(() => {})
  Albums.createIndex({ owner: 1 }).catch(() => {})
  Items.createIndex({ a: 1, at: 1 }).catch(() => {})
  Items.createIndex({ k: 1 }).catch(() => {})
  Items.createIndex({ pending: 1, x: 1 }).catch(() => {})
  Items.createIndex({ likes: 1 }).catch(() => {})
  Items.createIndex({ "comments.k": 1 }).catch(() => {})
  const sum = async (match) => (await Items.aggregate([{ $match: match }, { $group: { _id: null, n: { $sum: "$z" } } }]).toArray())[0]?.n || 0
  const NO_THUMB = { projection: { thumb: 0 } }
  return {
    kind: "mongodb",
    createAlbum: (doc) => Albums.insertOne({ ...doc, rev: 1 }),
    getAlbum: (id) => Albums.findOne({ _id: id }),
    putAlbum: async (doc, rev) => {
      const { _id, ...rest } = doc
      const r = await Albums.replaceOne({ _id, rev }, { ...rest, rev: rev + 1 })
      return { ok: r.matchedCount === 1 }
    },
    removeAlbum: (id) => Albums.deleteOne({ _id: id }),
    albumsFor: (key) => Albums.find({ members: key }).toArray(),
    countOwned: (key) => Albums.countDocuments({ owner: key }),
    addItem: (rec) => Items.insertOne(rec),
    getItem: (id) => Items.findOne({ _id: id }),
    updateItem: (id, patch) => Items.updateOne({ _id: id }, { $set: patch }),
    itemsOf: (albumId) => Items.find({ a: albumId, pending: false }, NO_THUMB).sort({ at: 1 }).toArray(),
    allItemsOf: (albumId) => Items.find({ a: albumId }, NO_THUMB).toArray(),
    thumbsOf: (albumId, ids) => Items.find({ a: albumId, pending: false, _id: { $in: ids } }, { projection: { thumb: 1 } }).toArray(),
    countItems: (albumId) => Items.countDocuments({ a: albumId }),
    countAll: () => Items.estimatedDocumentCount(),
    bytesBy: (key) => sum({ k: key }),
    bytesTotal: () => sum({}),
    itemsBy: (key) => Items.find({ k: key }, NO_THUMB).toArray(),
    removeItems: (ids) => Items.deleteMany({ _id: { $in: ids } }),
    stalePending: (now, limit) => Items.find({ pending: true, x: { $lte: now } }, NO_THUMB).limit(limit).toArray(),
    like: (id, key, on) => Items.updateOne({ _id: id }, on ? { $addToSet: { likes: key } } : { $pull: { likes: key } }),
    comment: (id, c, max) => Items.updateOne({ _id: id }, { $push: { comments: { $each: [c], $slice: -max } } }),
    uncomment: (id, cid) => Items.updateOne({ _id: id }, { $pull: { comments: { id: cid } } }),
    forgetTraces: async (key) => (await Items.updateMany({ $or: [{ likes: key }, { "comments.k": key }] }, { $pull: { likes: key, comments: { k: key } } })).modifiedCount,
    tracesOf: async (key) => Items.distinct("a", { $or: [{ likes: key }, { "comments.k": key }] }),
  }
}

const createAlbumStore = async (uri = process.env.MONGODB_URI) => {
  if (!uri) return memoryAlbumStore()
  const connection = await mongoose.createConnection(uri, { maxPoolSize: 2 }).asPromise()
  return mongoAlbumStore(connection)
}

module.exports = { createAlbumStore, memoryAlbumStore }
