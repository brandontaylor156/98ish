// Where synced files live on the server, per 98 Messenger account (see sync.js for the API):
//   accounts  { key, seq, usage, achievements (JSON text), sweptAt }
//             seq counts every change; usage is the bytes of stored contents
//   entries   { key, path, kind: "f" | "d", type, hash, size, mtime, rev, deleted, device, at }
//             one per file or folder ever synced; a delete keeps the entry as a tombstone
//   blobs     { key, hash, enc, mime, data: Buffer, size, length, at, store, path, pending,
//               expiresAt, movedAt }
//             a file's contents, once per account however many files share them. With an
//             online storage bucket (bucket.js) the bytes are in the bucket at `path`
//             (store "bucket", no data); `pending` is an upload a device was given a URL for
//             and hasn't confirmed (expiresAt). Contents moved from MongoDB keep their data
//             for 7 days after the move was checked (movedAt), then it's dropped.
//   usage     { _id: "d:YYYY-MM-DD", simple, adv, down, ... } what the bucket was asked to do
//             each UTC day (bucket.js keeps its free budgets with these), and { _id: "rest" }
//   devices   { hash, key, name, expiresAt, lastSeen }
//             sign-in tokens for sync that outlive a 98 Messenger session (stored hashed)
// MongoDB when MONGODB_URI is set (collections syncaccounts, syncentries, syncblobs,
// syncdevices, blobusage), otherwise memory (lost on restart). Contents are kept small: a data URL
// (a photo, a sound) is stored as its binary bytes, other text is deflated when that helps.
// The router runs one change at a time per account, so the store needs no locking.

const zlib = require("node:zlib")
const mongoose = require("mongoose")

// ---------- contents in, contents out ----------

const DATA_URL = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]*={0,2})$/i

// text -> { enc, mime, data: Buffer, size: stored bytes, length: characters }
const encodeBlob = (text) => {
  const match = text.length > 64 ? DATA_URL.exec(text) : null
  if (match) {
    const data = Buffer.from(match[2], "base64")
    // only if it comes back exactly the same
    if (`data:${match[1]};base64,${data.toString("base64")}` === text) return { enc: "b64", mime: match[1], data, size: data.length, length: text.length }
  }
  const raw = Buffer.from(text, "utf8")
  const deflated = raw.length > 256 ? zlib.deflateRawSync(raw) : raw
  if (deflated.length < raw.length * 0.9) return { enc: "z", mime: "", data: deflated, size: deflated.length, length: text.length }
  return { enc: "t", mime: "", data: raw, size: raw.length, length: text.length }
}

const bufferOf = (data) => (Buffer.isBuffer(data) ? data : Buffer.from(data.buffer || data))

// a record's contents as the bytes kept in a bucket: { enc: "b64" | "t", mime, bytes }
// (deflated text goes back to plain text so a device can read it without inflating)
const bucketBytes = (blob) => {
  const data = bufferOf(blob.data)
  if (blob.enc === "b64") return { enc: "b64", mime: blob.mime, bytes: data }
  if (blob.enc === "z") return { enc: "t", mime: "", bytes: zlib.inflateRawSync(data) }
  return { enc: "t", mime: "", bytes: data }
}

// bytes from a bucket -> the text the drive keeps
const fromBucket = (bytes, enc, mime) => (enc === "b64" ? `data:${mime};base64,${bytes.toString("base64")}` : bytes.toString("utf8"))

const decodeBlob = (blob) => {
  const data = bufferOf(blob.data)
  if (blob.enc === "b64") return `data:${blob.mime};base64,${data.toString("base64")}`
  if (blob.enc === "z") return zlib.inflateRawSync(data).toString("utf8")
  return data.toString("utf8")
}

const clean = (entry) =>
  entry && {
    path: entry.path,
    kind: entry.kind,
    type: entry.type,
    hash: entry.hash || null,
    size: entry.size || 0,
    mtime: entry.mtime || 0,
    rev: entry.rev,
    deleted: !!entry.deleted,
    device: entry.device || "",
    at: new Date(entry.at || Date.now()).toISOString(),
  }

// ---------- memory ----------

const memorySyncStore = () => {
  const accounts = new Map()
  const entries = new Map() // key -> Map(path -> entry)
  const blobs = new Map() // key -> Map(hash -> blob)
  const devices = new Map() // hash -> device
  const usage = new Map() // id -> counters
  const allBlobs = () => [...blobs.entries()].flatMap(([key, map]) => [...map.values()].map((b) => ({ ...b, key })))
  const entriesOf = (key) => entries.get(key) || entries.set(key, new Map()).get(key)
  const blobsOf = (key) => blobs.get(key) || blobs.set(key, new Map()).get(key)
  const accountOf = (key) => accounts.get(key) || null
  return {
    kind: "memory",
    getAccount: async (key) => accountOf(key),
    createAccount: async (key) => {
      if (!accounts.has(key)) accounts.set(key, { key, seq: 0, usage: 0, achievements: "{}", sweptAt: new Date(0) })
      return accounts.get(key)
    },
    updateAccount: async (key, patch) => Object.assign(accounts.get(key), patch),
    bumpSeq: async (key) => ++accounts.get(key).seq,
    changes: async (key, since, limit) =>
      [...entriesOf(key).values()]
        .filter((e) => e.rev > since)
        .sort((a, b) => a.rev - b.rev)
        .slice(0, limit)
        .map(clean),
    entry: async (key, path) => clean(entriesOf(key).get(path)) || null,
    putEntry: async (key, entry) => void entriesOf(key).set(entry.path, { ...entry }),
    countFiles: async (key) => [...entriesOf(key).values()].filter((e) => e.kind === "f" && !e.deleted).length,
    countEntries: async (key) => entriesOf(key).size,
    hashInUse: async (key, hash) => [...entriesOf(key).values()].some((e) => !e.deleted && e.hash === hash),
    hasBlobs: async (key, hashes) => new Set(hashes.filter((h) => blobsOf(key).has(h) && !blobsOf(key).get(h).pending)),
    getBlob: async (key, hash) => blobsOf(key).get(hash) || null,
    putBlob: async (key, hash, blob) => {
      if (blobsOf(key).has(hash)) return false
      blobsOf(key).set(hash, { ...blob, hash, at: blob.at || new Date() })
      accounts.get(key).usage += blob.size
      return true
    },
    deleteBlob: async (key, hash) => {
      const blob = blobsOf(key).get(hash)
      if (!blob) return 0
      blobsOf(key).delete(hash)
      if (!blob.pending && accounts.get(key)) accounts.get(key).usage = Math.max(0, accounts.get(key).usage - blob.size)
      return blob.size
    },
    blobsBefore: async (key, date) => [...blobsOf(key).values()].filter((b) => b.at < date && !b.pending).map((b) => b.hash),
    reserveBlob: async (key, hash, rec) => {
      const found = blobsOf(key).get(hash)
      if (found && !found.pending) return "exists"
      blobsOf(key).set(hash, { ...rec, hash, pending: true })
      return "reserved"
    },
    commitBlob: async (key, hash, at) => {
      const found = blobsOf(key).get(hash)
      if (!found?.pending) return false
      Object.assign(found, { pending: false, at, expiresAt: null })
      accounts.get(key).usage += found.size
      return true
    },
    pendingBytes: async (key, except) => [...blobsOf(key).values()].filter((b) => b.pending && b.hash !== except).reduce((sum, b) => sum + b.size, 0),
    bucketTotal: async () => allBlobs().filter((b) => b.store === "bucket").reduce((sum, b) => sum + b.size, 0),
    expiredPending: async (date, limit) => allBlobs().filter((b) => b.pending && b.expiresAt < date).slice(0, limit),
    pathsOf: async (key) => [...blobsOf(key).values()].filter((b) => b.path).map((b) => b.path),
    pathsPresent: async (paths) => new Set(allBlobs().filter((b) => paths.includes(b.path)).map((b) => b.path)),
    toMove: async (limit) => allBlobs().filter((b) => b.data && b.store !== "bucket" && !b.pending).slice(0, limit),
    countToMove: async () => allBlobs().filter((b) => b.data && b.store !== "bucket" && !b.pending).length,
    markMoved: async (key, hash, patch, delta) => {
      const found = blobsOf(key).get(hash)
      if (!found || found.store === "bucket") return false
      Object.assign(found, patch)
      if (accounts.get(key)) accounts.get(key).usage += delta
      return true
    },
    movedBefore: async (date, limit) => allBlobs().filter((b) => b.store === "bucket" && b.data && b.movedAt < date).slice(0, limit),
    dropData: async (key, hash) => {
      const found = blobsOf(key).get(hash)
      if (found) delete found.data
    },
    usageDays: async (from) => [...usage.entries()].filter(([id]) => id.startsWith("d:") && id.slice(2) >= from).map(([id, doc]) => ({ ...doc, day: id.slice(2) })),
    usageInc: async (day, inc) => {
      const doc = usage.get(`d:${day}`) || {}
      for (const [field, n] of Object.entries(inc)) if (n) doc[field] = (doc[field] || 0) + n
      usage.set(`d:${day}`, doc)
    },
    usageGet: async (id) => usage.get(id) || null,
    usageSet: async (id, patch) => void usage.set(id, { ...(usage.get(id) || {}), ...patch }),
    totalUsage: async () => [...accounts.values()].reduce((sum, a) => sum + (a.usage || 0), 0),
    addDevice: async (device) => void devices.set(device.hash, { ...device }),
    findDevice: async (hash) => devices.get(hash) || null,
    touchDevice: async (hash, patch) => devices.has(hash) && Object.assign(devices.get(hash), patch),
    removeDevice: async (hash) => devices.delete(hash),
    devicesOf: async (key) => [...devices.values()].filter((d) => d.key === key).sort((a, b) => a.lastSeen - b.lastSeen),
    removeAll: async (key) => {
      accounts.delete(key)
      entries.delete(key)
      blobs.delete(key)
      for (const [hash, d] of devices) if (d.key === key) devices.delete(hash)
    },
  }
}

// ---------- MongoDB ----------

const schemas = () => ({
  account: new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    seq: { type: Number, default: 0 },
    usage: { type: Number, default: 0 },
    achievements: { type: String, default: "{}" },
    sweptAt: { type: Date, default: () => new Date(0) },
  }),
  entry: (() => {
    const schema = new mongoose.Schema({
      key: { type: String, required: true },
      path: { type: String, required: true },
      kind: String,
      type: String,
      hash: String,
      size: Number,
      mtime: Number,
      rev: Number,
      deleted: Boolean,
      device: String,
      at: Date,
    })
    schema.index({ key: 1, path: 1 }, { unique: true })
    schema.index({ key: 1, rev: 1 })
    schema.index({ key: 1, hash: 1 })
    return schema
  })(),
  blob: (() => {
    const schema = new mongoose.Schema({ key: String, hash: String, enc: String, mime: String, data: Buffer, size: Number, length: Number, at: Date, store: String, path: String, benc: String, pending: Boolean, expiresAt: Date, movedAt: Date })
    schema.index({ key: 1, hash: 1 }, { unique: true })
    schema.index({ path: 1 }, { sparse: true })
    schema.index({ store: 1, movedAt: 1 }, { sparse: true })
    return schema
  })(),
  device: new mongoose.Schema({
    hash: { type: String, required: true, unique: true },
    key: { type: String, index: true },
    name: String,
    expiresAt: Date,
    lastSeen: Date,
  }),
})

const mongoSyncStore = (connection) => {
  const s = schemas()
  const Account = connection.model("SyncAccount", s.account, "syncaccounts")
  const Entry = connection.model("SyncEntry", s.entry, "syncentries")
  const Blob = connection.model("SyncBlob", s.blob, "syncblobs")
  const Device = connection.model("SyncDevice", s.device, "syncdevices")
  const Usage = connection.collection("blobusage")
  const sumSize = async (match) => (await Blob.aggregate([{ $match: match }, { $group: { _id: null, n: { $sum: "$size" } } }]))[0]?.n || 0
  const MOVABLE = { data: { $exists: true }, store: { $ne: "bucket" }, pending: { $ne: true } }
  return {
    kind: "mongodb",
    getAccount: async (key) => Account.findOne({ key }).lean(),
    createAccount: async (key) =>
      Account.findOneAndUpdate({ key }, { $setOnInsert: { key, seq: 0, usage: 0, achievements: "{}", sweptAt: new Date(0) } }, { upsert: true, returnDocument: "after" }).lean(),
    updateAccount: async (key, patch) => Account.updateOne({ key }, { $set: patch }),
    bumpSeq: async (key) => (await Account.findOneAndUpdate({ key }, { $inc: { seq: 1 } }, { returnDocument: "after" }).lean()).seq,
    changes: async (key, since, limit) => (await Entry.find({ key, rev: { $gt: since } }).sort({ rev: 1 }).limit(limit).lean()).map(clean),
    entry: async (key, path) => clean(await Entry.findOne({ key, path }).lean()) || null,
    putEntry: async (key, entry) => Entry.updateOne({ key, path: entry.path }, { $set: { ...entry, key } }, { upsert: true }),
    countFiles: async (key) => Entry.countDocuments({ key, kind: "f", deleted: false }),
    countEntries: async (key) => Entry.countDocuments({ key }),
    hashInUse: async (key, hash) => !!(await Entry.exists({ key, hash, deleted: false })),
    hasBlobs: async (key, hashes) => new Set((await Blob.find({ key, hash: { $in: hashes }, pending: { $ne: true } }, { hash: 1 }).lean()).map((b) => b.hash)),
    getBlob: async (key, hash) => Blob.findOne({ key, hash }).lean(),
    putBlob: async (key, hash, blob) => {
      try {
        await Blob.create({ key, hash, enc: blob.enc, mime: blob.mime, data: blob.data, size: blob.size, length: blob.length, at: blob.at || new Date(), ...(blob.store ? { store: blob.store, path: blob.path } : {}) })
      } catch (error) {
        if (error.code === 11000) return false
        throw error
      }
      await Account.updateOne({ key }, { $inc: { usage: blob.size } })
      return true
    },
    deleteBlob: async (key, hash) => {
      const blob = await Blob.findOneAndDelete({ key, hash }, { projection: { size: 1, pending: 1 } }).lean()
      if (!blob) return 0
      if (!blob.pending) await Account.updateOne({ key }, { $inc: { usage: -blob.size } })
      return blob.size
    },
    blobsBefore: async (key, date) => (await Blob.find({ key, at: { $lt: date }, pending: { $ne: true } }, { hash: 1 }).lean()).map((b) => b.hash),
    reserveBlob: async (key, hash, rec) => {
      const found = await Blob.findOne({ key, hash }, { pending: 1 }).lean()
      if (found && !found.pending) return "exists"
      await Blob.updateOne({ key, hash }, { $set: { ...rec, key, hash, pending: true }, $unset: { data: 1 } }, { upsert: true })
      return "reserved"
    },
    commitBlob: async (key, hash, at) => {
      const blob = await Blob.findOneAndUpdate({ key, hash, pending: true }, { $set: { pending: false, at }, $unset: { expiresAt: 1 } }, { projection: { size: 1 } }).lean()
      if (!blob) return false
      await Account.updateOne({ key }, { $inc: { usage: blob.size } })
      return true
    },
    pendingBytes: (key, except) => sumSize({ key, pending: true, hash: { $ne: except } }),
    bucketTotal: () => sumSize({ store: "bucket" }),
    expiredPending: async (date, limit) => Blob.find({ pending: true, expiresAt: { $lt: date } }, { key: 1, hash: 1, path: 1 }).limit(limit).lean(),
    pathsOf: async (key) => (await Blob.find({ key, path: { $exists: true } }, { path: 1 }).lean()).map((b) => b.path),
    pathsPresent: async (paths) => new Set((await Blob.find({ path: { $in: paths } }, { path: 1 }).lean()).map((b) => b.path)),
    toMove: async (limit) => Blob.find(MOVABLE).limit(limit).lean(),
    countToMove: () => Blob.countDocuments(MOVABLE),
    markMoved: async (key, hash, patch, delta) => {
      const result = await Blob.updateOne({ key, hash, store: { $ne: "bucket" } }, { $set: patch })
      if (!result.modifiedCount) return false
      if (delta) await Account.updateOne({ key }, { $inc: { usage: delta } })
      return true
    },
    movedBefore: async (date, limit) => Blob.find({ store: "bucket", movedAt: { $lt: date }, data: { $exists: true } }, { key: 1, hash: 1 }).limit(limit).lean(),
    dropData: (key, hash) => Blob.updateOne({ key, hash }, { $unset: { data: 1 } }),
    usageDays: async (from) => (await Usage.find({ _id: { $gte: `d:${from}`, $lt: "d;" } }).toArray()).map((doc) => ({ ...doc, day: doc._id.slice(2) })),
    usageInc: async (day, inc) => {
      const $inc = Object.fromEntries(Object.entries(inc).filter(([, n]) => n))
      if (Object.keys($inc).length) await Usage.updateOne({ _id: `d:${day}` }, { $inc }, { upsert: true })
    },
    usageGet: (id) => Usage.findOne({ _id: id }),
    usageSet: (id, patch) => Usage.updateOne({ _id: id }, { $set: patch }, { upsert: true }),
    totalUsage: async () => (await Account.aggregate([{ $group: { _id: null, n: { $sum: "$usage" } } }]))[0]?.n || 0,
    addDevice: async (device) => Device.create(device),
    findDevice: async (hash) => Device.findOne({ hash }).lean(),
    touchDevice: async (hash, patch) => Device.updateOne({ hash }, { $set: patch }),
    removeDevice: async (hash) => (await Device.deleteOne({ hash })).deletedCount > 0,
    devicesOf: async (key) => Device.find({ key }).sort({ lastSeen: 1 }).lean(),
    removeAll: async (key) => {
      await Promise.all([Entry.deleteMany({ key }), Blob.deleteMany({ key }), Device.deleteMany({ key })])
      await Account.deleteOne({ key })
    },
  }
}

const createSyncStore = async (uri = process.env.MONGODB_URI) => {
  if (!uri) {
    console.warn("[drive sync] MONGODB_URI not set: synced files are kept in memory and lost on restart")
    return memorySyncStore()
  }
  const connection = await mongoose.createConnection(uri, { maxPoolSize: 3 }).asPromise()
  console.log("[drive sync] connected to MongoDB")
  return mongoSyncStore(connection)
}

module.exports = { createSyncStore, memorySyncStore, encodeBlob, decodeBlob, bucketBytes, fromBucket, bufferOf }
