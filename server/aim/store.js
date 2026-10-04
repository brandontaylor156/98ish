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
    // set while the account is being deleted (../account): what the deletion needs to finish
    // if it's tried again, and a sign that nobody may sign on meanwhile
    deleting: { type: Object, default: null },
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
    deleting: doc.deleting || null,
    createdAt: doc.createdAt,
  }

// "cooldude98" matches "Cool Dude 98", "cool  dude98"... (screen names ignore case and spaces)
const nameRegex = (key) => new RegExp(`^\\s*${[...String(key).replace(/[^a-z0-9]/g, "")].join("\\s*")}\\s*$`, "i")
const sameName = (name, key) => String(name || "").replace(/\s+/g, "").toLowerCase() === key

const mongoStore = (User) => ({
  kind: "mongodb",
  find: async (key) => plain(await User.findOne({ key }).lean()),
  create: async (user) => plain(await User.create(user)),
  update: async (key, patch) => plain(await User.findOneAndUpdate({ key }, patch, { returnDocument: "after" }).lean()),
  // deleting an account: the account itself, and its name in everyone else's Buddy List and
  // block list (so whoever takes the name next isn't anyone's buddy, or blocked, by mistake)
  remove: async (key) => (await User.deleteOne({ key })).deletedCount > 0,
  forgetEverywhere: async (key) => {
    const name = nameRegex(key)
    const result = await User.updateMany({ key: { $ne: key }, $or: [{ blocked: key }, { "groups.buddies": name }] }, { $pull: { blocked: key, "groups.$[].buddies": name } })
    return result.modifiedCount || 0
  },
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
    remove: async (key) => users.delete(key),
    forgetEverywhere: async (key) => {
      let changed = 0
      for (const [other, doc] of users) {
        if (other === key) continue
        const blocked = (doc.blocked || []).filter((k) => k !== key)
        const groups = (doc.groups || []).map((g) => ({ name: g.name, buddies: g.buddies.filter((b) => !sameName(b, key)) }))
        if (blocked.length !== (doc.blocked || []).length || groups.some((g, i) => g.buddies.length !== doc.groups[i].buddies.length)) {
          Object.assign(doc, { blocked, groups })
          changed++
        }
      }
      return changed
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

module.exports = { createStore, DEFAULT_GROUPS, nameRegex, sameName }
