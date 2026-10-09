// 98 Messenger passkeys: one record per passkey (WebAuthn credential). MongoDB collection
// "aimpasskeys" when MONGODB_URI is set, otherwise memory (lost on restart). A record:
//   { id: credential id (base64url), key: account (normalized screen name), userHandle
//     (random, base64url; the same for all of an account's passkeys), rpId ("98ish.vercel.app"
//     or "localhost"), alg (-7 | -257 | -8), jwk (the public key), counter, backedUp,
//     transports, name ("iPhone"), createdAt, lastUsedAt }
// Only public keys are kept: nothing here can sign on by itself. At most 10 per account
// (./passkeys.js), a few hundred bytes each. Delete My Account removes them all (eraser step
// "passkeys", server/account inventory).

const mongoose = require("mongoose")

const schema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    key: { type: String, required: true, index: true },
    userHandle: { type: String, required: true },
    rpId: { type: String, required: true },
    alg: { type: Number, required: true },
    jwk: { type: mongoose.Schema.Types.Mixed, required: true },
    counter: { type: Number, default: 0 },
    backedUp: { type: Boolean, default: false },
    transports: { type: [String], default: [] },
    name: { type: String, default: "" },
    createdAt: { type: Number, required: true },
    lastUsedAt: { type: Number, default: 0 },
  },
  { minimize: false }
)

const copy = (r) => (r ? JSON.parse(JSON.stringify(r)) : null)

const memoryStore = () => {
  const recs = new Map()
  return {
    kind: "memory",
    byId: async (id) => copy(recs.get(id)),
    list: async (key) => [...recs.values()].filter((r) => r.key === key).sort((a, b) => a.createdAt - b.createdAt).map(copy),
    count: async (key) => [...recs.values()].filter((r) => r.key === key).length,
    add: async (r) => {
      if (recs.has(r.id)) return false
      recs.set(r.id, copy(r))
      return true
    },
    update: async (id, patch) => {
      const r = recs.get(id)
      if (!r) return false
      recs.set(id, copy({ ...r, ...patch }))
      return true
    },
    remove: async (key, id) => {
      const r = recs.get(id)
      return !!r && r.key === key && recs.delete(id)
    },
    removeAll: async (key) => {
      let n = 0
      for (const [id, r] of recs) if (r.key === key) recs.delete(id), n++
      return n
    },
    size: () => recs.size,
  }
}

const mongoStore = (Model) => ({
  kind: "mongodb",
  byId: async (id) => Model.findOne({ id }, { _id: 0, __v: 0 }).lean(),
  list: async (key) => Model.find({ key }, { _id: 0, __v: 0 }).sort({ createdAt: 1 }).limit(50).lean(),
  count: async (key) => Model.countDocuments({ key }),
  add: async (r) => {
    try {
      await Model.create(r)
      return true
    } catch (error) {
      if (error?.code === 11000) return false
      throw error
    }
  },
  update: async (id, patch) => (await Model.updateOne({ id }, { $set: patch })).matchedCount > 0,
  remove: async (key, id) => (await Model.deleteOne({ id, key })).deletedCount > 0,
  removeAll: async (key) => (await Model.deleteMany({ key })).deletedCount || 0,
})

const createPasskeyStore = async (uri = process.env.MONGODB_URI) => {
  if (!uri) {
    console.warn("[passkeys] MONGODB_URI not set: passkeys are kept in memory and lost on restart")
    return memoryStore()
  }
  const connection = await mongoose.createConnection(uri, { maxPoolSize: 2 }).asPromise()
  console.log("[passkeys] connected to MongoDB")
  return mongoStore(connection.model("AimPasskey", schema, "aimpasskeys"))
}

module.exports = { createPasskeyStore, memoryStore }
