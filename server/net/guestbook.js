// The 98ish guestbook and hit counters, served over plain HTTP from the chat server:
//   GET  /api/guestbook?page=1   newest entries first, 10 a page
//   POST /api/guestbook          { name, homepage, message, mood, website (a trap: must be empty) }
//   POST /api/hits/:page         counts a visit (once per visitor per page every 10 minutes)
// Entries and counters live in MongoDB when MONGODB_URI is set, otherwise in memory (lost
// when the server restarts). Entries are stored as plain text; the page renders them as
// text, never HTML.

const express = require("express")
const mongoose = require("mongoose")
const { limiter } = require("./limiter")

const PER_PAGE = 10
const MAX_NAME = 32
const MAX_MESSAGE = 500
const MAX_HOMEPAGE = 100
const MAX_LINES = 12
const MOODS = ["smile", "grin", "wink", "cool", "love", "tongue", "wow", "sad", "angry", "alien"]
const COUNTERS = ["guestbook", "shrine", "links", "rock"]
const HIT_DEDUPE_MS = 10 * 60_000

// ---------- validation ----------

const clean = (text, max) =>
  String(text ?? "")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F​-‏‪-‮⁦-⁩]/g, "")
    .replace(/\r\n?/g, "\n")
    .slice(0, max + 1)

// Swear words and slurs, matched as whole words after undoing common disguises (sh1t, f*ck)
const BAD_WORDS = [
  "fuck", "fucker", "fucking", "fuk", "shit", "shitty", "shithead", "dumbass", "jackass", "bullshit", "cunt", "bitch", "bitches", "asshole", "dickhead",
  "pussy", "bastard", "whore", "slut", "twat", "wanker", "motherfucker", "fag", "faggot", "nigger", "nigga",
  "retard", "spic", "chink", "kike", "tranny", "porn", "porno", "xxx", "viagra", "cialis", "casino",
]
const BAD_PATTERN = new RegExp(`\\b(${BAD_WORDS.join("|")})s?\\b`, "i")

const unmask = (text) =>
  String(text)
    .toLowerCase()
    .replace(/[0@4]/g, (c) => ({ 0: "o", "@": "a", 4: "a" })[c])
    .replace(/[1!|]/g, "i")
    .replace(/3/g, "e")
    .replace(/[5$]/g, "s")
    .replace(/7/g, "t")
    .replace(/(\w)[*.\-_]+(?=\w)/g, "$1") // f*ck, s.h.i.t
    .replace(/(\w)\1{2,}/g, "$1$1") // fuuuuck -> fuuck
    .replace(/(\w)\1/g, "$1") // then -> fuck

// "f*ck": a star could be any vowel
const isProfane = (text) =>
  BAD_PATTERN.test(String(text)) || ["", ..."aeiou"].some((vowel) => BAD_PATTERN.test(unmask(String(text).replace(/\*/g, vowel))))

// Links belong in the Homepage field, not the message
const LINK = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|ru|cn|io|xyz|info|biz|top|click|link|shop|online|site|club|co|me|us|tk)\b)/i

const normalizeHomepage = (value) => {
  let url = String(value || "").trim()
  if (!url) return ""
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`
  try {
    const parsed = new URL(url)
    if (!/^https?:$/.test(parsed.protocol) || !/\.[a-z]{2,}$/i.test(parsed.hostname) || parsed.username || parsed.password) return null
    return parsed.href.length <= MAX_HOMEPAGE ? parsed.href : null
  } catch {
    return null
  }
}

// -> { ok: true, entry } | { ok: false, error }
const validateEntry = (body = {}) => {
  if (body.website) return { ok: false, error: "Sorry, your entry couldn't be saved." } // the bot trap
  const name = clean(body.name, MAX_NAME).replace(/\s+/g, " ").trim()
  const message = clean(body.message, MAX_MESSAGE).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim()
  const mood = MOODS.includes(body.mood) ? body.mood : "smile"
  if (!name) return { ok: false, error: "Please type your name." }
  if (name.length > MAX_NAME) return { ok: false, error: `Names can be at most ${MAX_NAME} characters.` }
  if (!message) return { ok: false, error: "Please write a message." }
  if (message.length > MAX_MESSAGE) return { ok: false, error: `Messages can be at most ${MAX_MESSAGE} characters.` }
  if (message.split("\n").length > MAX_LINES) return { ok: false, error: "That message has too many lines." }
  const homepage = normalizeHomepage(body.homepage)
  if (homepage === null) return { ok: false, error: "That homepage address doesn't look right." }
  if (LINK.test(name) || LINK.test(message)) return { ok: false, error: "Please put links in the Homepage box, not in your name or message." }
  if (isProfane(name) || isProfane(message) || isProfane(homepage)) return { ok: false, error: "Please keep it family friendly!" }
  if (/(.)\1{11,}/.test(message.replace(/\s/g, ""))) return { ok: false, error: "That message looks like spam." }
  return { ok: true, entry: { name, homepage, message, mood } }
}

// ---------- storage ----------

const entrySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, maxlength: MAX_NAME },
    homepage: { type: String, default: "", maxlength: MAX_HOMEPAGE },
    message: { type: String, required: true, maxlength: MAX_MESSAGE },
    mood: { type: String, default: "smile" },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
)
entrySchema.index({ createdAt: -1 })

const counterSchema = new mongoose.Schema({ _id: String, n: { type: Number, default: 0 } }, { versionKey: false })

const publicEntry = (doc) => ({
  id: String(doc._id ?? doc.id),
  name: doc.name,
  homepage: doc.homepage || "",
  message: doc.message,
  mood: doc.mood || "smile",
  time: new Date(doc.createdAt).getTime(),
})

const memoryStore = () => {
  const entries = [] // newest first
  const counters = new Map()
  let nextId = 1
  return {
    kind: "memory",
    add: async (entry) => {
      const doc = { ...entry, id: String(nextId++), createdAt: new Date() }
      entries.unshift(doc)
      entries.length = Math.min(entries.length, 2000)
      return publicEntry(doc)
    },
    page: async (page, per) => ({ total: entries.length, entries: entries.slice((page - 1) * per, page * per).map(publicEntry) }),
    recent: async (n) => entries.slice(0, n).map(publicEntry),
    hit: async (key, increment) => {
      const n = (counters.get(key) || 0) + (increment ? 1 : 0)
      counters.set(key, n)
      return n
    },
  }
}

const mongoStore = (connection) => {
  const Entry = connection.model("GuestbookEntry", entrySchema)
  const Counter = connection.model("HitCounter", counterSchema)
  return {
    kind: "mongodb",
    add: async (entry) => publicEntry(await Entry.create(entry)),
    page: async (page, per) => {
      const [total, docs] = await Promise.all([
        Entry.estimatedDocumentCount(),
        Entry.find().sort({ createdAt: -1 }).skip((page - 1) * per).limit(per).lean(),
      ])
      return { total, entries: docs.map(publicEntry) }
    },
    recent: async (n) => (await Entry.find().sort({ createdAt: -1 }).limit(n).lean()).map(publicEntry),
    hit: async (key, increment) => {
      if (!increment) return (await Counter.findById(key).lean())?.n || 0
      const doc = await Counter.findOneAndUpdate({ _id: key }, { $inc: { n: 1 } }, { upsert: true, returnDocument: "after" }).lean()
      return doc.n
    },
  }
}

const createGuestbookStore = async (uri = process.env.MONGODB_URI) => {
  if (!uri) {
    console.warn("[guestbook] MONGODB_URI not set: guestbook entries and hit counts are kept in memory")
    return memoryStore()
  }
  const connection = await mongoose.createConnection(uri, { maxPoolSize: 5 }).asPromise()
  console.log("[guestbook] connected to MongoDB")
  return mongoStore(connection)
}

// ---------- HTTP ----------

const ipOf = (request) => String(request.headers["x-forwarded-for"] || request.socket.remoteAddress || "").split(",")[0].trim()

const guestbookRouter = ({ store: storeOrPromise } = {}) => {
  let storePromise = null
  const getStore = () => (storePromise ??= Promise.resolve(storeOrPromise || createGuestbookStore()))
  getStore().catch((error) => {
    console.error("[guestbook] storage failed to start", error.message)
    storePromise = null
  })

  const postsPerMinute = limiter(1, 30_000) // one entry every 30 seconds
  const postsPerDay = limiter(10, 24 * 60 * 60_000)
  // everyone together, in case a spammer fakes their address
  const allPosts = limiter(20, 60_000)
  const reads = limiter(120, 60_000)
  const recentHits = new Map() // "ip page" -> time

  const router = express.Router()
  router.use(express.json({ limit: "4kb" }))

  const handle = (fn) => async (request, response) => {
    try {
      await fn(request, response)
    } catch (error) {
      console.error("[guestbook]", error.message)
      response.status(503).json({ ok: false, error: "The guestbook is taking a nap. Please try again later." })
    }
  }

  router.get(
    "/guestbook",
    handle(async (request, response) => {
      if (reads(ipOf(request))) return response.status(429).json({ ok: false, error: "Slow down!" })
      const page = Math.max(1, Math.min(1000, parseInt(request.query.page, 10) || 1))
      const { total, entries } = await (await getStore()).page(page, PER_PAGE)
      response.json({ ok: true, page, pages: Math.max(1, Math.ceil(total / PER_PAGE)), total, entries })
    })
  )

  router.post(
    "/guestbook",
    handle(async (request, response) => {
      const ip = ipOf(request)
      const result = validateEntry(request.body || {})
      if (!result.ok) return response.status(400).json(result)
      if (postsPerMinute.over(ip) || postsPerDay.over(ip)) {
        return response.status(429).json({ ok: false, error: "You just signed! Please wait a bit before signing again." })
      }
      if (allPosts.over("all")) return response.status(429).json({ ok: false, error: "Lots of people are signing right now. Please try again in a minute." })
      const store = await getStore()
      const recent = await store.recent(30)
      if (recent.some((e) => e.message.toLowerCase() === result.entry.message.toLowerCase())) {
        return response.status(400).json({ ok: false, error: "Someone already wrote exactly that!" })
      }
      postsPerMinute(ip)
      postsPerDay(ip)
      allPosts("all")
      response.json({ ok: true, entry: await store.add(result.entry) })
    })
  )

  router.post(
    "/hits/:page",
    handle(async (request, response) => {
      const page = String(request.params.page)
      if (!COUNTERS.includes(page)) return response.status(404).json({ ok: false })
      const key = `${ipOf(request)} ${page}`
      const now = Date.now()
      const fresh = !recentHits.has(key) || now - recentHits.get(key) > HIT_DEDUPE_MS
      if (fresh) recentHits.set(key, now)
      if (recentHits.size > 20000) {
        for (const [k, t] of recentHits) if (now - t > HIT_DEDUPE_MS) recentHits.delete(k)
      }
      response.json({ ok: true, count: await (await getStore()).hit(page, fresh) })
    })
  )

  return router
}

module.exports = { validateEntry, isProfane, LINK, normalizeHomepage, memoryStore, createGuestbookStore, guestbookRouter, MOODS, PER_PAGE, MAX_MESSAGE, MAX_NAME }
