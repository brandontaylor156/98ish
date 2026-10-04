// Tetris Online ranks: stars per mode for signed-in 98 Messenger players, keyed by their
// screen name key. MongoDB when MONGODB_URI is set, otherwise memory (lost on restart).
// Every rank takes one more star than the last: rank 1 -> 2 needs 1 star, 2 -> 3 needs 2...

const mongoose = require("mongoose")

const MODES = ["battle", "arena", "race"]

const rankOf = (stars) => {
  let rank = 1
  let left = Math.max(0, stars | 0)
  while (left >= rank) {
    left -= rank
    rank++
  }
  return { rank, into: left, need: rank } // `into` of `need` stars toward the next rank
}

const blank = () => ({ stars: 0, wins: 0, played: 0 })

const memoryRanks = () => {
  const players = new Map() // key -> { screenName, modes }
  return {
    async get(key) {
      const p = players.get(key)
      return p ? { screenName: p.screenName, modes: structuredClone(p.modes) } : null
    },
    async record(key, screenName, mode, { stars = 0, win = false }) {
      const p = players.get(key) || { screenName, modes: {} }
      p.screenName = screenName
      const m = (p.modes[mode] ||= blank())
      m.stars += stars
      m.played += 1
      if (win) m.wins += 1
      players.set(key, p)
      return { ...m }
    },
    async top(mode, limit = 20) {
      return [...players.values()]
        .filter((p) => p.modes[mode])
        .map((p) => ({ screenName: p.screenName, ...p.modes[mode] }))
        .sort((a, b) => b.stars - a.stars || b.wins - a.wins || a.played - b.played)
        .slice(0, limit)
    },
    async remove(key) {
      return players.delete(key)
    },
  }
}

const mongoRanks = (connection) => {
  const schema = new mongoose.Schema(
    {
      _id: String,
      screenName: String,
      modes: { type: Map, of: new mongoose.Schema({ stars: Number, wins: Number, played: Number }, { _id: false }) },
    },
    { versionKey: false }
  )
  const Rank = connection.model("TetrisRank", schema, "tetrisranks")
  return {
    async get(key) {
      const doc = await Rank.findById(key).lean()
      return doc ? { screenName: doc.screenName, modes: doc.modes || {} } : null
    },
    async record(key, screenName, mode, { stars = 0, win = false }) {
      if (!MODES.includes(mode)) return null
      const doc = await Rank.findOneAndUpdate(
        { _id: key },
        { $set: { screenName }, $inc: { [`modes.${mode}.stars`]: stars, [`modes.${mode}.played`]: 1, [`modes.${mode}.wins`]: win ? 1 : 0 } },
        { upsert: true, returnDocument: "after" }
      ).lean()
      return { ...blank(), ...doc.modes[mode] }
    },
    async top(mode, limit = 20) {
      if (!MODES.includes(mode)) return []
      const docs = await Rank.find({ [`modes.${mode}`]: { $exists: true } })
        .sort({ [`modes.${mode}.stars`]: -1, [`modes.${mode}.wins`]: -1 })
        .limit(limit)
        .lean()
      return docs.map((d) => ({ screenName: d.screenName, ...blank(), ...d.modes[mode] }))
    },
    async remove(key) {
      return (await Rank.deleteOne({ _id: key })).deletedCount > 0
    },
  }
}

const createTetrisRanks = async (uri = process.env.MONGODB_URI) => {
  if (!uri) {
    console.warn("[tetris] MONGODB_URI not set: Tetris ranks are kept in memory")
    return memoryRanks()
  }
  const connection = await mongoose.createConnection(uri, { maxPoolSize: 3 }).asPromise()
  return mongoRanks(connection)
}

module.exports = { createTetrisRanks, memoryRanks, rankOf, MODES }
