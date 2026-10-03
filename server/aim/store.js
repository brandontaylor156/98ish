// Account storage. MongoDB when MONGODB_URI is set; otherwise an in-memory map so local
// development works with no database (accounts vanish when the server restarts).

const mongoose = require("mongoose")

const DEFAULT_GROUPS = [
  { name: "Buddies", buddies: ["SmarterChild"] },
  { name: "Family", buddies: [] },
  { name: "Co-Workers", buddies: [] },
]

const userSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    screenName: { type: String, required: true },
    passwordHash: { type: String, required: true },
    profile: { type: String, default: "" },
    groups: {
      type: [{ _id: false, name: String, buddies: [String] }],
      default: () => DEFAULT_GROUPS,
    },
    blocked: { type: [String], default: [] },
    // "Remember me" devices: hashes of their sign-on tokens, each with an expiry (ms)
    remember: { type: [{ _id: false, hash: String, expiresAt: Number }], default: [] },
  },
  { timestamps: true }
)

const plain = (doc) =>
  doc && {
    key: doc.key,
    screenName: doc.screenName,
    passwordHash: doc.passwordHash,
    profile: doc.profile || "",
    groups: (doc.groups || []).map((g) => ({ name: g.name, buddies: [...g.buddies] })),
    blocked: [...(doc.blocked || [])],
    remember: (doc.remember || []).map((r) => ({ hash: r.hash, expiresAt: r.expiresAt })),
    createdAt: doc.createdAt,
  }

const mongoStore = (User) => ({
  kind: "mongodb",
  find: async (key) => plain(await User.findOne({ key }).lean()),
  create: async (user) => plain(await User.create(user)),
  update: async (key, patch) => plain(await User.findOneAndUpdate({ key }, patch, { returnDocument: "after" }).lean()),
})

const memoryStore = () => {
  const users = new Map()
  return {
    kind: "memory",
    find: async (key) => plain(users.get(key)),
    create: async (user) => {
      if (users.has(user.key)) throw Object.assign(new Error("duplicate"), { code: 11000 })
      const doc = { profile: "", groups: DEFAULT_GROUPS, blocked: [], createdAt: new Date(), ...user }
      users.set(user.key, doc)
      return plain(doc)
    },
    update: async (key, patch) => {
      const doc = users.get(key)
      if (!doc) return null
      Object.assign(doc, patch)
      return plain(doc)
    },
  }
}

const createStore = async (uri = process.env.MONGODB_URI) => {
  if (!uri) {
    console.warn("[aim] MONGODB_URI not set: accounts are kept in memory and lost on restart")
    return memoryStore()
  }
  const connection = await mongoose.createConnection(uri).asPromise()
  console.log("[aim] connected to MongoDB")
  return mongoStore(connection.model("AimUser", userSchema))
}

module.exports = { createStore, DEFAULT_GROUPS }
