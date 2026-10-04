// Photo Puzzle: puzzles sent from one 98 Messenger account to another (usually your
// partner), each a picture cut into a jigsaw or a slide puzzle, with a hidden message that
// shows up only once the puzzle is solved. Every request needs a signed-on 98 Messenger
// session (Authorization: Bearer, see ../aim/auth.js).
//   GET    /api/puzzles              { inbox, sent } headers (no pictures), storage used
//   GET    /api/puzzles/:id          one puzzle with its picture (its message only for the
//                                    sender, or once the recipient has solved it)
//   POST   /api/puzzles              { to, title, mode, pieces | size, rotate, image, message }
//   POST   /api/puzzles/:id/solved   { ms, moves } recipient only -> { message }
//   DELETE /api/puzzles/:id          either of the two
// Only the sender and the recipient can ever read a puzzle. Pictures are PNG, JPEG or WebP
// data URLs (the browser shrinks them to 1280 px and about 300 KB first); each sender (or
// couple, when they're paired) has a storage cap. Text is stored and shown as plain text.
// Live notices go to a signed-on recipient ("puzzle:new") and to the sender when it's
// solved ("puzzle:solved"). Stored in MongoDB when MONGODB_URI is set, otherwise in memory.

const crypto = require("crypto")
const express = require("express")
const mongoose = require("mongoose")
const { limiter } = require("../net/limiter")
const { sessionFrom } = require("../aim/auth")
const { validate } = require("../aim/screenNames")

const MAX_IMAGE_CHARS = 420_000 // about 300 KB of picture as base64
const STORAGE_BYTES = 15 * 1024 * 1024
const MAX_MESSAGE = 500
const MAX_TITLE = 60
const JIGSAW_PIECES = [12, 24, 48, 96]
const SLIDE_SIZES = [3, 4, 5]
const MAX_SOLVE_MS = 7 * 24 * 60 * 60 * 1000
const IMAGE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/

// the couples module (if this server has it): a pair's shared storage cap
let couples = null
try {
  couples = require("../couples")
} catch {
  couples = null
}

class Invalid extends Error {}
const fail = (message) => {
  throw new Invalid(message)
}

const clean = (text) =>
  String(text ?? "")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F‪-‮⁦-⁩]/g, "")
    .replace(/\r\n?/g, "\n")

const newId = () => crypto.randomBytes(12).toString("hex")

// -> { ok: true, puzzle: { to, title, mode, pieces, size, rotate, image, message } } | { ok: false, error }
const validatePuzzle = (input = {}) => {
  try {
    const to = validate(String(input.to ?? "").trim())
    if (to.error) fail("Choose who the puzzle is for.")
    const title = clean(input.title).replace(/\s+/g, " ").trim()
    if (title.length > MAX_TITLE) fail(`Titles can be at most ${MAX_TITLE} characters.`)
    if (input.message !== undefined && typeof input.message !== "string") fail("The hidden message must be plain text.")
    const message = clean(input.message).trim()
    if (message.length > MAX_MESSAGE) fail(`Hidden messages can be at most ${MAX_MESSAGE} characters.`)
    const mode = input.mode === "slide" ? "slide" : input.mode === "jigsaw" ? "jigsaw" : fail("Pick Jigsaw or Slide puzzle.")
    const pieces = mode === "jigsaw" ? Number(input.pieces) : 0
    const size = mode === "slide" ? Number(input.size) : 0
    if (mode === "jigsaw" && !JIGSAW_PIECES.includes(pieces)) fail("A jigsaw can have 12, 24, 48 or 96 pieces.")
    if (mode === "slide" && !SLIDE_SIZES.includes(size)) fail("A slide puzzle can be 3x3, 4x4 or 5x5.")
    const image = typeof input.image === "string" ? input.image : ""
    if (!IMAGE.test(image)) fail("The picture must be a PNG, JPEG or WebP image.")
    if (image.length > MAX_IMAGE_CHARS) fail("That picture is too big. Pictures can be at most about 300 KB.")
    return { ok: true, puzzle: { to: to.screenName, toKey: to.key, title: title || "A puzzle for you", mode, pieces, size, rotate: mode === "jigsaw" && !!input.rotate, image, message } }
  } catch (error) {
    if (error instanceof Invalid) return { ok: false, error: error.message }
    throw error
  }
}

// ---------- storage ----------

const header = (p, viewer) => ({
  id: p.id ?? p._id,
  from: p.from,
  to: p.to,
  title: p.title,
  mode: p.mode,
  pieces: p.pieces,
  size: p.size,
  rotate: !!p.rotate,
  time: p.time,
  solvedAt: p.solvedAt || null,
  solveMs: p.solveMs ?? null,
  moves: p.moves ?? null,
  bytes: p.bytes,
  mine: p.fromKey === viewer,
  hasMessage: !!p.message,
})

const memoryStore = () => {
  const puzzles = new Map()
  return {
    kind: "memory",
    insert: async (puzzle) => void puzzles.set(puzzle.id, { ...puzzle }),
    get: async (id) => puzzles.get(id) || null,
    listFor: async (key) =>
      [...puzzles.values()].filter((p) => p.fromKey === key || p.toKey === key).sort((a, b) => b.time - a.time),
    update: async (id, patch) => {
      const p = puzzles.get(id)
      if (p) Object.assign(p, patch)
      return p || null
    },
    remove: async (id) => puzzles.delete(id),
    usage: async (bucket) => [...puzzles.values()].filter((p) => p.bucket === bucket).reduce((sum, p) => sum + p.bytes, 0),
    removeFor: async (key) => {
      let n = 0
      for (const [id, p] of puzzles) if ((p.fromKey === key || p.toKey === key) && puzzles.delete(id)) n++
      return n
    },
  }
}

const puzzleSchema = new mongoose.Schema(
  {
    _id: String,
    from: String,
    fromKey: { type: String, index: true },
    to: String,
    toKey: { type: String, index: true },
    bucket: { type: String, index: true },
    title: String,
    mode: String,
    pieces: Number,
    size: Number,
    rotate: Boolean,
    image: String,
    message: String,
    bytes: Number,
    time: Number,
    solvedAt: Number,
    solveMs: Number,
    moves: Number,
  },
  { versionKey: false }
)

const mongoStore = (connection) => {
  const Puzzle = connection.model("Puzzle", puzzleSchema)
  const plain = (doc) => doc && { ...doc, id: doc._id }
  return {
    kind: "mongodb",
    insert: async (puzzle) => void (await Puzzle.create({ ...puzzle, _id: puzzle.id })),
    get: async (id) => plain(await Puzzle.findById(id).lean()),
    listFor: async (key) => (await Puzzle.find({ $or: [{ fromKey: key }, { toKey: key }] }, { image: 0, message: 0 }).sort({ time: -1 }).limit(300).lean()).map(plain),
    update: async (id, patch) => plain(await Puzzle.findByIdAndUpdate(id, { $set: patch }, { returnDocument: "after" }).lean()),
    remove: async (id) => (await Puzzle.deleteOne({ _id: id })).deletedCount > 0,
    usage: async (bucket) => (await Puzzle.aggregate([{ $match: { bucket } }, { $group: { _id: null, n: { $sum: "$bytes" } } }]))[0]?.n || 0,
    removeFor: async (key) => (await Puzzle.deleteMany({ $or: [{ fromKey: key }, { toKey: key }] })).deletedCount || 0,
  }
}

const createPuzzleStore = async (uri = process.env.MONGODB_URI) => {
  if (!uri) {
    console.warn("[puzzles] MONGODB_URI not set: puzzles are kept in memory")
    return memoryStore()
  }
  const connection = await mongoose.createConnection(uri, { maxPoolSize: 3 }).asPromise()
  console.log("[puzzles] connected to MongoDB")
  return mongoStore(connection)
}

// ---------- HTTP ----------

// couple(key): the pair's id, if paired (storage is shared by the two of them)
const puzzleRouter = ({ store: storeOrPromise, aim: initialAim = null, limits = {}, storageBytes = STORAGE_BYTES, coupleIdOf = couples?.coupleIdOf } = {}) => {
  let aim = initialAim
  let storePromise = null
  const getStore = () => (storePromise ??= Promise.resolve(storeOrPromise || createPuzzleStore()))
  getStore().catch((error) => {
    console.error("[puzzles] storage failed to start", error.message)
    storePromise = null
  })

  const sends = limiter(limits.sendsPerHour ?? 30, 60 * 60_000)
  const writes = limiter(limits.writesPerMinute ?? 30, 60_000)
  const requests = limiter(limits.requestsPerMinute ?? 240, 60_000)

  const bucketOf = (key) => {
    try {
      const couple = coupleIdOf?.(key)
      return couple ? `couple:${couple}` : `user:${key}`
    } catch {
      return `user:${key}`
    }
  }
  const socketOf = (key) => aim?.sessions?.get(key)?.socket || null

  const router = express.Router()

  router.use((request, response, next) => {
    const session = sessionFrom(aim, request)
    if (!session) return response.status(401).json({ ok: false, error: "Sign on to 98 Messenger to send and get puzzles." })
    if (requests(session.key)) return response.status(429).json({ ok: false, error: "Slow down!" })
    request.puzzleSession = session
    next()
  })

  const handle = (fn) => async (request, response) => {
    try {
      await fn(request, response, request.puzzleSession, await getStore())
    } catch (error) {
      if (error instanceof Invalid) return response.status(400).json({ ok: false, error: error.message })
      console.error("[puzzles]", error.message)
      response.status(503).json({ ok: false, error: "The puzzle server isn't answering. Please try again later." })
    }
  }

  // a puzzle this session may see (the sender or the recipient), else a 404 for everyone else
  const ownPuzzle = async (store, session, id) => {
    const p = await store.get(String(id))
    return p && (p.fromKey === session.key || p.toKey === session.key) ? p : null
  }

  router.get(
    "/",
    handle(async (request, response, session, store) => {
      const list = await store.listFor(session.key)
      const bucket = bucketOf(session.key)
      response.json({
        ok: true,
        inbox: list.filter((p) => p.toKey === session.key).map((p) => header(p, session.key)),
        sent: list.filter((p) => p.fromKey === session.key).map((p) => header(p, session.key)),
        usage: await store.usage(bucket),
        cap: storageBytes,
      })
    })
  )

  router.get(
    "/:id",
    handle(async (request, response, session, store) => {
      const p = await ownPuzzle(store, session, request.params.id)
      if (!p) return response.status(404).json({ ok: false, error: "That puzzle is gone." })
      const showMessage = p.fromKey === session.key || !!p.solvedAt
      response.json({ ok: true, puzzle: { ...header(p, session.key), image: p.image, ...(showMessage ? { message: p.message || "" } : {}) } })
    })
  )

  router.post(
    "/",
    express.json({ limit: Math.ceil(MAX_IMAGE_CHARS * 1.1) + 4096 }),
    handle(async (request, response, session, store) => {
      const result = validatePuzzle(request.body || {})
      if (!result.ok) return response.status(400).json(result)
      const input = result.puzzle
      if (input.toKey === session.key) return response.status(400).json({ ok: false, error: "Send it to someone else! (You can play it yourself from New Puzzle.)" })
      const user = await aim?.store?.find(input.toKey)
      if (!user) return response.status(400).json({ ok: false, error: `${input.to} is not a 98 Messenger screen name. Check the spelling and try again.` })
      if (writes(session.key) || sends.over(session.key)) return response.status(429).json({ ok: false, error: "You've sent a lot of puzzles. Wait a while before sending more." })
      const bytes = Buffer.byteLength(input.image) + Buffer.byteLength(input.message) + Buffer.byteLength(input.title)
      const bucket = bucketOf(session.key)
      if ((await store.usage(bucket)) + bytes > storageBytes) {
        return response.status(400).json({ ok: false, error: "Your puzzle box is full. Delete some old puzzles first." })
      }
      sends(session.key)
      const puzzle = {
        id: newId(),
        from: session.user.screenName,
        fromKey: session.key,
        to: user.screenName,
        toKey: input.toKey,
        bucket,
        title: input.title,
        mode: input.mode,
        pieces: input.pieces,
        size: input.size,
        rotate: input.rotate,
        image: input.image,
        message: input.message,
        bytes,
        time: Date.now(),
        solvedAt: null,
        solveMs: null,
        moves: null,
      }
      // Blocked: it looks sent, but it's never delivered (as with mail)
      if (user.blocked?.includes(session.key)) return response.json({ ok: true, puzzle: header(puzzle, session.key) })
      await store.insert(puzzle)
      socketOf(input.toKey)?.emit("puzzle:new", { id: puzzle.id, from: puzzle.from, title: puzzle.title })
      response.json({ ok: true, puzzle: header(puzzle, session.key) })
    })
  )

  router.post(
    "/:id/solved",
    express.json({ limit: "1kb" }),
    handle(async (request, response, session, store) => {
      const p = await ownPuzzle(store, session, request.params.id)
      if (!p) return response.status(404).json({ ok: false, error: "That puzzle is gone." })
      if (p.toKey !== session.key) return response.status(403).json({ ok: false, error: "Only the person it was sent to can solve it." })
      const ms = Math.round(Number(request.body?.ms))
      const moves = Math.round(Number(request.body?.moves ?? 0))
      if (!Number.isFinite(ms) || ms < 1000 || ms > MAX_SOLVE_MS) fail("That time doesn't look right.")
      let updated = p
      if (!p.solvedAt) {
        if (writes(session.key)) return response.status(429).json({ ok: false, error: "Slow down!" })
        updated = await store.update(p.id, { solvedAt: Date.now(), solveMs: ms, moves: Number.isFinite(moves) && moves >= 0 ? Math.min(moves, 1e6) : 0 })
        socketOf(p.fromKey)?.emit("puzzle:solved", { id: p.id, by: session.user.screenName, title: p.title, ms })
      }
      response.json({ ok: true, message: p.message || "", puzzle: header(updated, session.key) })
    })
  )

  router.delete(
    "/:id",
    handle(async (request, response, session, store) => {
      const p = await ownPuzzle(store, session, request.params.id)
      if (!p) return response.status(404).json({ ok: false, error: "That puzzle is gone." })
      if (writes(session.key)) return response.status(429).json({ ok: false, error: "Slow down!" })
      await store.remove(p.id)
      response.json({ ok: true })
    })
  )

  router.use((error, request, response, next) => {
    if (error?.type === "entity.too.large") return response.status(413).json({ ok: false, error: "That picture is too big. Pictures can be at most about 300 KB." })
    if (error?.type === "entity.parse.failed") return response.status(400).json({ ok: false, error: "That puzzle couldn't be read." })
    next(error)
  })

  // Delete My Account (../account): puzzles they sent (their pictures) and got
  const eraseAccount = async ({ key }) => ({ removed: await (await getStore()).removeFor(key) })

  return Object.assign(router, { useAim: (value) => (aim = value), eraseAccount })
}

module.exports = { puzzleRouter, validatePuzzle, memoryStore, createPuzzleStore, MAX_IMAGE_CHARS, STORAGE_BYTES, MAX_MESSAGE }
