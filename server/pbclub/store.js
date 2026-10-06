// Pickleball 98's Real Games on the 98ish server: play sessions (MongoDB collection "pbsessions")
// and logged matches ("pbmatches") when MONGODB_URI is set, otherwise memory (lost on
// restart). Every save names the rev it read, so two people answering at once can't
// overwrite each other (the caller reads again and retries).
//
// A session record: { id, host, members: [keys who can see it], names: { key: screenName },
//   title, venue, start, minutes, max, courts, skill, note, open, invited: [keys],
//   rsvps: { key: { s, at, late } }, chat: [{ k, t, at }], rotation, cancelled, rev,
//   changedAt, createdAt }
// A match record: { id, by, keys: [account keys playing], names, at, venue, kind, teams,
//   games, note, session, to, status, confirmedBy, disputedBy, removeTeam, removeBy, rev,
//   changedAt, createdAt } (statuses: client/src/components/applets/pbclub/clubCore.js)

const mongoose = require("mongoose")

const Mixed = mongoose.Schema.Types.Mixed
const sessionSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    host: { type: String, required: true, index: true },
    members: { type: [String], index: true },
    names: { type: Mixed, default: {} },
    title: String,
    venue: Mixed,
    start: { type: Number, index: true },
    minutes: Number,
    max: Number,
    courts: Number,
    skill: Mixed,
    note: String,
    open: Boolean,
    invited: [String],
    rsvps: { type: Mixed, default: {} },
    chat: { type: Mixed, default: [] },
    rotation: Mixed,
    cancelled: { type: Boolean, default: false },
    rev: { type: Number, required: true },
    changedAt: Number,
    createdAt: Number,
  },
  { minimize: false }
)
const matchSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    by: { type: String, index: true },
    keys: { type: [String], index: true },
    names: { type: Mixed, default: {} },
    at: Number,
    venue: Mixed,
    kind: String,
    teams: Mixed,
    games: Mixed,
    note: String,
    session: String,
    to: Number,
    status: { type: String, index: true },
    confirmedBy: String,
    disputedBy: String,
    removeTeam: Number,
    removeBy: String,
    rev: { type: Number, required: true },
    changedAt: Number,
    createdAt: Number,
  },
  { minimize: false }
)
matchSchema.index({ by: 1, createdAt: 1 })

const SESSION_FIELDS = ["host", "members", "names", "title", "venue", "start", "minutes", "max", "courts", "skill", "note", "open", "invited", "rsvps", "chat", "rotation", "cancelled", "changedAt"]
const MATCH_FIELDS = ["by", "keys", "names", "at", "venue", "kind", "teams", "games", "note", "session", "to", "status", "confirmedBy", "disputedBy", "removeTeam", "removeBy", "changedAt"]
const RATED = ["confirmed", "removing"]

const copy = (doc) => (doc ? JSON.parse(JSON.stringify(doc)) : null)

const memoryCollection = (fields) => {
  const docs = new Map()
  return {
    docs,
    get: async (id) => copy(docs.get(id)),
    create: async (doc) => {
      if (docs.has(doc.id)) return false
      docs.set(doc.id, copy({ ...doc, rev: 1 }))
      return true
    },
    put: async (doc, baseRev) => {
      const current = docs.get(doc.id)
      if (!current || current.rev !== baseRev) return { ok: false }
      const next = copy({ ...current, ...Object.fromEntries(fields.map((f) => [f, doc[f]])), rev: baseRev + 1 })
      docs.set(doc.id, next)
      return { ok: true, rev: next.rev }
    },
    remove: async (id) => docs.delete(id),
    all: () => [...docs.values()],
  }
}

const memoryStore = () => {
  const sessions = memoryCollection(SESSION_FIELDS)
  const matches = memoryCollection(MATCH_FIELDS)
  return {
    kind: "memory",
    sessions: {
      ...sessions,
      forKey: async (key) => sessions.all().filter((d) => d.members.includes(key) || d.host === key).map(copy),
      hostedSince: async (key, since) => sessions.all().filter((d) => d.host === key && !d.cancelled && d.start >= since).length,
      startedBefore: async (t) => sessions.all().filter((d) => d.start < t).map((d) => d.id),
    },
    matches: {
      ...matches,
      forKey: async (key, limit = 500) =>
        matches
          .all()
          .filter((d) => d.keys.includes(key) || d.by === key)
          .sort((a, b) => b.at - a.at)
          .slice(0, limit)
          .map(copy),
      countBy: async (key, since = 0) => matches.all().filter((d) => d.by === key && (d.createdAt || 0) >= since).length,
      rated: async () => matches.all().filter((d) => RATED.includes(d.status)).map(copy),
      pendingBefore: async (t) => matches.all().filter((d) => d.status === "pending" && (d.createdAt || 0) < t).map(copy),
    },
  }
}

const mongoCollection = (Model, fields) => ({
  get: async (id) => Model.findOne({ id }, { _id: 0, __v: 0 }).lean(),
  create: async (doc) => {
    try {
      await Model.create({ ...doc, rev: 1 })
      return true
    } catch (error) {
      if (error.code === 11000) return false
      throw error
    }
  },
  put: async (doc, baseRev) => {
    const set = Object.fromEntries(fields.map((f) => [f, doc[f]]))
    const saved = await Model.findOneAndUpdate({ id: doc.id, rev: baseRev }, { $set: set, $inc: { rev: 1 } }, { returnDocument: "after", projection: { rev: 1 } }).lean()
    return saved ? { ok: true, rev: saved.rev } : { ok: false }
  },
  remove: async (id) => (await Model.deleteOne({ id })).deletedCount > 0,
})

const mongoStore = (Session, Match) => ({
  kind: "mongodb",
  sessions: {
    ...mongoCollection(Session, SESSION_FIELDS),
    forKey: async (key) => Session.find({ $or: [{ members: key }, { host: key }] }, { _id: 0, __v: 0 }).lean(),
    hostedSince: async (key, since) => Session.countDocuments({ host: key, cancelled: false, start: { $gte: since } }),
    startedBefore: async (t) => (await Session.find({ start: { $lt: t } }, { id: 1 }).lean()).map((d) => d.id),
  },
  matches: {
    ...mongoCollection(Match, MATCH_FIELDS),
    forKey: async (key, limit = 500) =>
      Match.find({ $or: [{ keys: key }, { by: key }] }, { _id: 0, __v: 0 })
        .sort({ at: -1 })
        .limit(limit)
        .lean(),
    countBy: async (key, since = 0) => Match.countDocuments({ by: key, createdAt: { $gte: since } }),
    rated: async () => Match.find({ status: { $in: RATED } }, { _id: 0, id: 1, at: 1, kind: 1, teams: 1, games: 1, status: 1 }).lean(),
    pendingBefore: async (t) => Match.find({ status: "pending", createdAt: { $lt: t } }, { _id: 0, __v: 0 }).lean(),
  },
})

const createClubStore = async (uri = process.env.MONGODB_URI) => {
  if (!uri) {
    console.warn("[pbclub] MONGODB_URI not set: sessions and matches are kept in memory and lost on restart")
    return memoryStore()
  }
  const connection = await mongoose.createConnection(uri, { maxPoolSize: 3 }).asPromise()
  console.log("[pbclub] connected to MongoDB")
  return mongoStore(connection.model("PbSession", sessionSchema, "pbsessions"), connection.model("PbMatch", matchSchema, "pbmatches"))
}

module.exports = { createClubStore, memoryStore }
