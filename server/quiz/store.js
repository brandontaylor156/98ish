// Quiz Show storage: challenges (a quiz sent from one 98 Messenger account to another,
// with both sides' answers once it's taken), saved custom quizzes, and the running scores
// of each pair of players. MongoDB when MONGODB_URI is set, otherwise memory.
// Everything is keyed by normalized screen names; a pair is "a|b" in sorted order.

const mongoose = require("mongoose")

const CHALLENGE_DAYS = 90 // a challenge (and its result) is deleted after this long
const MAX_PAIR_HISTORY = 30

const pairKey = (a, b) => [a, b].sort().join("|")

const emptyScore = (pair) => ({ pair, games: 0, totalPercent: 0, best: 0, perfect: 0, modes: {}, history: [], lastAt: 0 })

// One finished game between two people -> their pair's running score
const addTo = (score, { mode, percent, at = Date.now() }) => {
  score.games++
  score.totalPercent += percent
  score.best = Math.max(score.best, percent)
  if (percent >= 100) score.perfect++
  score.modes = { ...score.modes, [mode]: (score.modes?.[mode] || 0) + 1 }
  score.history = [...(score.history || []), { mode, percent, at }].slice(-MAX_PAIR_HISTORY)
  score.lastAt = at
  return score
}

const memoryStore = () => {
  const challenges = new Map()
  const quizzes = new Map() // owner -> Map(id -> quiz)
  const scores = new Map() // pair -> score
  const mine = (owner) => quizzes.get(owner) || quizzes.set(owner, new Map()).get(owner)
  const copy = (x) => x && structuredClone(x)
  const sweep = () => {
    const cutoff = Date.now() - CHALLENGE_DAYS * 86_400_000
    for (const [id, c] of challenges) if (c.createdAt < cutoff) challenges.delete(id)
  }
  return {
    kind: "memory",
    insertChallenge: async (c) => {
      sweep()
      challenges.set(c.id, copy(c))
      return copy(c)
    },
    getChallenge: async (id) => copy(challenges.get(id)) || null,
    updateChallenge: async (id, patch, where = {}) => {
      const c = challenges.get(id)
      if (!c || Object.entries(where).some(([k, v]) => c[k] !== v)) return null
      Object.assign(c, copy(patch))
      return copy(c)
    },
    removeChallenge: async (id) => challenges.delete(id),
    challengesFor: async (key) =>
      [...challenges.values()]
        .filter((c) => (c.from === key || c.to === key) && !c.hiddenBy?.includes(key))
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 200)
        .map(copy),
    pendingFrom: async (key) => [...challenges.values()].filter((c) => c.from === key && c.status === "waiting").length,
    listQuizzes: async (owner) => [...mine(owner).values()].sort((a, b) => b.updatedAt - a.updatedAt).map(copy),
    getQuiz: async (owner, id) => copy(mine(owner).get(id)) || null,
    saveQuiz: async (owner, quiz) => {
      mine(owner).set(quiz.id, copy({ ...quiz, owner }))
      return copy(quiz)
    },
    removeQuiz: async (owner, id) => mine(owner).delete(id),
    countQuizzes: async (owner) => mine(owner).size,
    addScore: async (a, b, entry) => {
      const pair = pairKey(a, b)
      const score = addTo(scores.get(pair) || emptyScore(pair), entry)
      scores.set(pair, score)
      return copy(score)
    },
    scoresFor: async (key) => [...scores.values()].filter((s) => s.pair.split("|").includes(key)).map(copy),
  }
}

const challengeSchema = new mongoose.Schema(
  {
    _id: String,
    kind: String,
    from: { type: String, index: true },
    fromName: String,
    to: { type: String, index: true },
    toName: String,
    payload: mongoose.Schema.Types.Mixed,
    key: mongoose.Schema.Types.Mixed,
    answers: mongoose.Schema.Types.Mixed,
    result: mongoose.Schema.Types.Mixed,
    status: String,
    note: String,
    hiddenBy: [String],
    createdAt: Number,
    doneAt: Number,
    expiresAt: Date,
  },
  { versionKey: false, minimize: false }
)
challengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

const quizSchema = new mongoose.Schema(
  { _id: String, owner: { type: String, index: true }, title: String, questions: mongoose.Schema.Types.Mixed, key: mongoose.Schema.Types.Mixed, updatedAt: Number },
  { versionKey: false, minimize: false }
)

const scoreSchema = new mongoose.Schema(
  { _id: String, members: { type: [String], index: true }, games: Number, totalPercent: Number, best: Number, perfect: Number, modes: mongoose.Schema.Types.Mixed, history: mongoose.Schema.Types.Mixed, lastAt: Number },
  { versionKey: false, minimize: false }
)

const mongoStore = (connection) => {
  const Challenge = connection.model("QuizChallenge", challengeSchema)
  const Quiz = connection.model("QuizSaved", quizSchema)
  const Score = connection.model("QuizScore", scoreSchema)
  const plain = (doc) => {
    if (!doc) return null
    const { _id, expiresAt, members, ...rest } = doc
    return { ...rest, id: _id }
  }
  return {
    kind: "mongodb",
    insertChallenge: async (c) => {
      await Challenge.create({ ...c, _id: c.id, expiresAt: new Date(c.createdAt + CHALLENGE_DAYS * 86_400_000) })
      return c
    },
    getChallenge: async (id) => plain(await Challenge.findById(id).lean()),
    updateChallenge: async (id, patch, where = {}) => plain(await Challenge.findOneAndUpdate({ _id: id, ...where }, { $set: patch }, { returnDocument: "after" }).lean()),
    removeChallenge: async (id) => (await Challenge.deleteOne({ _id: id })).deletedCount > 0,
    challengesFor: async (key) =>
      (await Challenge.find({ $or: [{ from: key }, { to: key }], hiddenBy: { $ne: key } }).sort({ createdAt: -1 }).limit(200).lean()).map(plain),
    pendingFrom: async (key) => Challenge.countDocuments({ from: key, status: "waiting" }),
    listQuizzes: async (owner) => (await Quiz.find({ owner }).sort({ updatedAt: -1 }).limit(100).lean()).map(plain),
    getQuiz: async (owner, id) => plain(await Quiz.findOne({ _id: id, owner }).lean()),
    saveQuiz: async (owner, quiz) => {
      await Quiz.replaceOne({ _id: quiz.id, owner }, { ...quiz, _id: quiz.id, owner }, { upsert: true })
      return quiz
    },
    removeQuiz: async (owner, id) => (await Quiz.deleteOne({ _id: id, owner })).deletedCount > 0,
    countQuizzes: async (owner) => Quiz.countDocuments({ owner }),
    addScore: async (a, b, entry) => {
      const pair = pairKey(a, b)
      const existing = await Score.findById(pair).lean()
      const score = addTo(existing ? { ...existing, pair } : emptyScore(pair), entry)
      const { pair: _p, _id, ...fields } = score
      await Score.replaceOne({ _id: pair }, { ...fields, _id: pair, members: pair.split("|") }, { upsert: true })
      return score
    },
    scoresFor: async (key) => (await Score.find({ members: key }).limit(100).lean()).map((s) => ({ ...plain(s), pair: s._id })),
  }
}

const createQuizStore = async (uri = process.env.MONGODB_URI) => {
  if (!uri) {
    console.warn("[quiz] MONGODB_URI not set: quizzes are kept in memory")
    return memoryStore()
  }
  const connection = await mongoose.createConnection(uri, { maxPoolSize: 3 }).asPromise()
  console.log("[quiz] connected to MongoDB")
  return mongoStore(connection)
}

// One store for the HTTP API and the live games (which record couple scores too)
let shared = null
const sharedQuizStore = () => {
  shared ??= createQuizStore().catch((error) => {
    console.error("[quiz] storage failed to start", error.message)
    shared = null
    throw error
  })
  return shared
}

module.exports = { memoryStore, createQuizStore, sharedQuizStore, pairKey, CHALLENGE_DAYS }
