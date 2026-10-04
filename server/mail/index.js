// 98ish Mail: Outlook Express-style mail between 98 Messenger accounts, over plain HTTP.
// Every request needs a signed-on 98 Messenger session (see ../aim/auth.js).
//   GET    /api/mail/folders              message counts per folder, mailbox usage
//   GET    /api/mail/messages?folder=inbox  headers, newest first
//   GET    /api/mail/messages/:id         one message with its attachments
//   PATCH  /api/mail/messages/:id         { read } | { action: "delete" | "restore" }
//   DELETE /api/mail/messages/:id         to Deleted Items; from there, gone for good
//   POST   /api/mail/send                 { to, cc, subject, body, attachments, draftId }
//   POST   /api/mail/drafts               { id, to, cc, subject, body, attachments }
//   POST   /api/mail/empty-deleted
// Mail is plain text only (never HTML). Each person keeps their own copy of a message;
// mailboxes have a size cap, and the oldest Deleted Items make room first. A recipient
// who has blocked the sender in 98 Messenger never gets their mail (the sender isn't
// told, just as a block looks like being offline). Someone signed on gets a live
// "mail:new" notice on their 98 Messenger socket. Stored in MongoDB when MONGODB_URI is
// set, otherwise in memory.

const crypto = require("crypto")
const express = require("express")
const mongoose = require("mongoose")
const { limiter } = require("../net/limiter")
const { sessionFrom } = require("../aim/auth")
const { validate, normalize } = require("../aim/screenNames")
const { BOT_NAME, mailReply } = require("../aim/bot")

const MAX_MESSAGE_BYTES = 1024 * 1024 // subject, body and attachments together
const MAILBOX_BYTES = 5 * 1024 * 1024
const MAX_SUBJECT = 120
const MAX_BODY = 20000
const MAX_RECIPIENTS = 20
const MAX_ATTACHMENTS = 5
const FOLDERS = ["inbox", "sent", "deleted", "drafts"]
// File types that can travel by mail: documents, pictures, and whatever else the drive
// keeps as a string (rich text, sound recordings, songs)
const ATTACH_TYPES = ["text", "note", "image", "richtext", "sound", "music"]
const INVALID_NAME = /[\\/:"<>|\u0000-\u001F]/

const BOT_KEY = normalize(BOT_NAME)

class Invalid extends Error {}
const fail = (message) => {
  throw new Invalid(message)
}

const clean = (text) =>
  String(text ?? "")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F‪-‮⁦-⁩]/g, "")
    .replace(/\r\n?/g, "\n")

const newId = () => crypto.randomBytes(12).toString("hex")
const bytes = (value) => Buffer.byteLength(String(value ?? ""))

// "Cool Dude, bob98; alice" -> unique, valid screen names (as typed)
const parseNames = (value) => {
  const list = Array.isArray(value) ? value : String(value ?? "").split(/[,;\n]+/)
  const seen = new Map()
  for (const raw of list) {
    const name = String(raw ?? "").trim()
    if (!name) continue
    const valid = validate(name)
    if (valid.error) fail(`"${name.slice(0, 32)}" isn't a 98 Messenger screen name.`)
    if (!seen.has(valid.key)) seen.set(valid.key, valid.screenName)
  }
  return [...seen.values()]
}

const DATA_URL = /^data:([a-z]+\/[a-z0-9.+-]+);base64,[A-Za-z0-9+/]+={0,2}$/
const IMAGE_URL = /^data:image\/(png|jpeg|gif|webp|bmp);base64,[A-Za-z0-9+/]+={0,2}$/

const cleanAttachments = (list) => {
  if (list === undefined || list === null) return []
  if (!Array.isArray(list)) fail("Attachments must be a list of files.")
  if (list.length > MAX_ATTACHMENTS) fail(`A message can have at most ${MAX_ATTACHMENTS} attachments.`)
  return list.map((file) => {
    const name = String(file?.name ?? "").trim()
    if (!name || name.length > 64 || INVALID_NAME.test(name) || name === "." || name === "..") fail("One of the attachments has a name that isn't allowed.")
    if (!ATTACH_TYPES.includes(file?.type)) fail(`"${name}" is a kind of file that can't be sent by mail.`)
    if (typeof file.content !== "string") fail(`"${name}" couldn't be read.`)
    let content = file.content
    if (file.type === "image") {
      if (!IMAGE_URL.test(content)) fail(`"${name}" isn't a picture 98ish can show.`)
    } else if (content.startsWith("data:")) {
      if (!DATA_URL.test(content)) fail(`"${name}" couldn't be read.`)
    } else content = clean(content)
    return { name, type: file.type, content, size: bytes(content) }
  })
}

// The parts every message has, checked; -> { subject, body, attachments, size }
const cleanContent = (input) => {
  const subject = clean(input.subject).replace(/\s+/g, " ").trim()
  if (subject.length > MAX_SUBJECT) fail(`Subjects can be at most ${MAX_SUBJECT} characters.`)
  if (input.body !== undefined && typeof input.body !== "string") fail("The message must be plain text.")
  const body = clean(input.body).replace(/\s+$/, "")
  if (body.length > MAX_BODY) fail(`Messages can be at most ${MAX_BODY.toLocaleString("en-US")} characters.`)
  const attachments = cleanAttachments(input.attachments)
  const size = bytes(subject) + bytes(body) + attachments.reduce((sum, a) => sum + a.size + bytes(a.name), 0)
  if (size > MAX_MESSAGE_BYTES) fail(`That message is too big (${Math.ceil(size / 1024)} KB). Messages can be at most ${MAX_MESSAGE_BYTES / 1024} KB with attachments.`)
  return { subject, body, attachments, size }
}

// -> { ok: true, message: { to, cc, subject, body, attachments, size } } | { ok: false, error }
const validateMessage = (input = {}) => {
  try {
    const to = parseNames(input.to)
    const cc = parseNames(input.cc)
    if (!to.length) fail("Type at least one screen name in the To box.")
    if (to.length + cc.length > MAX_RECIPIENTS) fail(`A message can go to at most ${MAX_RECIPIENTS} people.`)
    return { ok: true, message: { to, cc, ...cleanContent(input) } }
  } catch (error) {
    if (error instanceof Invalid) return { ok: false, error: error.message }
    throw error
  }
}

// ---------- storage ----------

const header = (m) => ({
  id: m.id ?? m._id,
  folder: m.folder,
  from: m.from,
  to: m.to,
  cc: m.cc,
  subject: m.subject,
  time: m.time,
  read: m.read,
  size: m.size,
  attachments: (m.attachments || []).map((a) => ({ name: a.name, type: a.type, size: a.size })),
  ...(m.folder === "drafts" ? { draftTo: m.draftTo || "", draftCc: m.draftCc || "" } : {}),
})
const fullMessage = (m) => m && { ...header(m), body: m.body, attachments: (m.attachments || []).map((a) => ({ name: a.name, type: a.type, size: a.size, content: a.content })) }

const emptyCounts = () => Object.fromEntries(FOLDERS.map((f) => [f, { total: 0, unread: 0 }]))

const memoryStore = () => {
  const boxes = new Map() // owner -> Map(id -> message)
  const box = (owner) => boxes.get(owner) || boxes.set(owner, new Map()).get(owner)
  return {
    kind: "memory",
    insert: async (message) => {
      box(message.owner).set(message.id, { ...message })
      return message
    },
    list: async (owner, folder) => [...box(owner).values()].filter((m) => m.folder === folder).sort((a, b) => b.time - a.time),
    get: async (owner, id) => box(owner).get(id) || null,
    update: async (owner, id, patch) => {
      const m = box(owner).get(id)
      if (!m) return null
      Object.assign(m, patch)
      return m
    },
    remove: async (owner, id) => box(owner).delete(id),
    usage: async (owner) => [...box(owner).values()].reduce((sum, m) => sum + m.size, 0),
    counts: async (owner) => {
      const counts = emptyCounts()
      for (const m of box(owner).values()) {
        counts[m.folder].total++
        if (!m.read) counts[m.folder].unread++
      }
      return counts
    },
    oldest: async (owner, folder) => [...box(owner).values()].filter((m) => m.folder === folder).sort((a, b) => a.time - b.time)[0] || null,
  }
}

const messageSchema = new mongoose.Schema(
  {
    _id: String,
    owner: { type: String, index: true },
    folder: String,
    prevFolder: String,
    from: String,
    to: [String],
    cc: [String],
    draftTo: String,
    draftCc: String,
    subject: String,
    body: String,
    attachments: [{ _id: false, name: String, type: { type: String }, content: String, size: Number }],
    size: Number,
    read: Boolean,
    time: Number,
  },
  { versionKey: false }
)
messageSchema.index({ owner: 1, folder: 1, time: -1 })

const mongoStore = (connection) => {
  const Message = connection.model("MailMessage", messageSchema)
  const plain = (doc) => doc && { ...doc, id: doc._id }
  return {
    kind: "mongodb",
    insert: async (message) => {
      await Message.create({ ...message, _id: message.id })
      return message
    },
    list: async (owner, folder) => (await Message.find({ owner, folder }, { body: 0, "attachments.content": 0 }).sort({ time: -1 }).limit(1000).lean()).map(plain),
    get: async (owner, id) => plain(await Message.findOne({ _id: id, owner }).lean()),
    update: async (owner, id, patch) => plain(await Message.findOneAndUpdate({ _id: id, owner }, { $set: patch }, { returnDocument: "after" }).lean()),
    remove: async (owner, id) => (await Message.deleteOne({ _id: id, owner })).deletedCount > 0,
    usage: async (owner) => (await Message.aggregate([{ $match: { owner } }, { $group: { _id: null, n: { $sum: "$size" } } }]))[0]?.n || 0,
    counts: async (owner) => {
      const counts = emptyCounts()
      const rows = await Message.aggregate([{ $match: { owner } }, { $group: { _id: "$folder", total: { $sum: 1 }, unread: { $sum: { $cond: ["$read", 0, 1] } } } }])
      for (const row of rows) if (counts[row._id]) counts[row._id] = { total: row.total, unread: row.unread }
      return counts
    },
    oldest: async (owner, folder) => plain(await Message.findOne({ owner, folder }, { body: 0, "attachments.content": 0 }).sort({ time: 1 }).lean()),
  }
}

const createMailStore = async (uri = process.env.MONGODB_URI) => {
  if (!uri) {
    console.warn("[mail] MONGODB_URI not set: mail is kept in memory")
    return memoryStore()
  }
  const connection = await mongoose.createConnection(uri, { maxPoolSize: 5 }).asPromise()
  console.log("[mail] connected to MongoDB")
  return mongoStore(connection)
}

// ---------- HTTP ----------

const mailRouter = ({ store: storeOrPromise, aim: initialAim = null, limits = {}, botDelayMs = 4000, mailboxBytes = MAILBOX_BYTES } = {}) => {
  let aim = initialAim
  let storePromise = null
  const getStore = () => (storePromise ??= Promise.resolve(storeOrPromise || createMailStore()))
  getStore().catch((error) => {
    console.error("[mail] storage failed to start", error.message)
    storePromise = null
  })

  const sends = limiter(limits.sendsPerHour ?? 20, 60 * 60_000)
  const drafts = limiter(limits.draftsPerHour ?? 60, 60 * 60_000)
  const requests = limiter(limits.requestsPerMinute ?? 300, 60_000)

  // Make room for `size` more bytes in someone's mailbox, emptying their oldest Deleted
  // Items first. -> true if it fits now
  const makeRoom = async (store, owner, size) => {
    let usage = await store.usage(owner)
    while (usage + size > mailboxBytes) {
      const old = await store.oldest(owner, "deleted")
      if (!old) return false
      await store.remove(owner, old.id)
      usage -= old.size
    }
    return true
  }

  const notify = async (store, owner, message) => {
    // a notification too when they're away from 98ish (Web Push, ../push)
    aim?.push
      ?.notify(owner, "mail", {
        title: `New mail from ${message.from}`,
        body: message.subject || "(no subject)",
        tag: "mail",
        key: `mail:${message.id}`,
        app: "mail",
        url: "/?open=mail",
      })
      .catch(() => {})
    const socket = aim?.sessions.get(owner)?.socket
    if (!socket) return
    const counts = await store.counts(owner)
    socket.emit("mail:new", { id: message.id, from: message.from, subject: message.subject, unread: counts.inbox.unread })
  }

  // A copy of a message in someone's folder
  const copyFor = (owner, folder, message, extra = {}) => ({
    id: newId(),
    owner,
    folder,
    from: message.from,
    to: message.to,
    cc: message.cc,
    subject: message.subject,
    body: message.body,
    attachments: message.attachments,
    size: message.size,
    read: folder !== "inbox",
    time: Date.now(),
    ...extra,
  })

  // SmarterChild answers its mail with something scripted, a few seconds later
  const botAnswer = (session, message) => {
    const owner = session.key
    setTimeout(async () => {
      try {
        const store = await getStore()
        const body = mailReply(session.user.screenName, message.subject, message.body)
        const subject = `Re: ${message.subject || "(no subject)"}`.slice(0, MAX_SUBJECT)
        const reply = { from: BOT_NAME, to: [session.user.screenName], cc: [], subject, body, attachments: [], size: bytes(subject) + bytes(body) }
        if (!(await makeRoom(store, owner, reply.size))) return
        const copy = copyFor(owner, "inbox", reply)
        await store.insert(copy)
        await notify(store, owner, copy)
      } catch (error) {
        console.error("[mail] bot reply failed", error.message)
      }
    }, botDelayMs).unref?.()
  }

  const router = express.Router()

  // Signed on before anything else (even reading the body)
  router.use((request, response, next) => {
    const session = sessionFrom(aim, request)
    if (!session) return response.status(401).json({ ok: false, error: "Sign on to 98 Messenger to use 98ish Mail." })
    if (requests(session.key)) return response.status(429).json({ ok: false, error: "Slow down!" })
    request.mailSession = session
    next()
  })

  const handle = (fn) => async (request, response) => {
    try {
      await fn(request, response, request.mailSession, await getStore())
    } catch (error) {
      if (error instanceof Invalid) return response.status(400).json({ ok: false, error: error.message })
      console.error("[mail]", error.message)
      response.status(503).json({ ok: false, error: "The mail server isn't answering. Please try again later." })
    }
  }

  const body = express.json({ limit: Math.ceil(MAX_MESSAGE_BYTES * 1.5) })

  router.get(
    "/folders",
    handle(async (request, response, session, store) => {
      const [folders, usage] = await Promise.all([store.counts(session.key), store.usage(session.key)])
      response.json({ ok: true, folders, usage, cap: mailboxBytes })
    })
  )

  router.get(
    "/messages",
    handle(async (request, response, session, store) => {
      const folder = FOLDERS.includes(request.query.folder) ? request.query.folder : "inbox"
      response.json({ ok: true, folder, messages: (await store.list(session.key, folder)).map(header) })
    })
  )

  router.get(
    "/messages/:id",
    handle(async (request, response, session, store) => {
      const message = await store.get(session.key, String(request.params.id))
      if (!message) return response.status(404).json({ ok: false, error: "That message is gone." })
      response.json({ ok: true, message: fullMessage(message) })
    })
  )

  router.patch(
    "/messages/:id",
    express.json({ limit: "1kb" }),
    handle(async (request, response, session, store) => {
      const id = String(request.params.id)
      const message = await store.get(session.key, id)
      if (!message) return response.status(404).json({ ok: false, error: "That message is gone." })
      const { read, action } = request.body || {}
      const patch = {}
      if (typeof read === "boolean") patch.read = read
      if (action === "delete" && message.folder !== "deleted") Object.assign(patch, { folder: "deleted", prevFolder: message.folder })
      if (action === "restore" && message.folder === "deleted") Object.assign(patch, { folder: FOLDERS.includes(message.prevFolder) && message.prevFolder !== "deleted" ? message.prevFolder : "inbox" })
      const updated = Object.keys(patch).length ? await store.update(session.key, id, patch) : message
      response.json({ ok: true, message: header(updated) })
    })
  )

  router.delete(
    "/messages/:id",
    handle(async (request, response, session, store) => {
      const id = String(request.params.id)
      const message = await store.get(session.key, id)
      if (!message) return response.status(404).json({ ok: false, error: "That message is gone." })
      if (message.folder === "deleted") {
        await store.remove(session.key, id)
        return response.json({ ok: true, removed: true })
      }
      const updated = await store.update(session.key, id, { folder: "deleted", prevFolder: message.folder })
      response.json({ ok: true, message: header(updated) })
    })
  )

  router.post(
    "/empty-deleted",
    handle(async (request, response, session, store) => {
      const deleted = await store.list(session.key, "deleted")
      for (const m of deleted) await store.remove(session.key, m.id)
      response.json({ ok: true, removed: deleted.length })
    })
  )

  router.post(
    "/drafts",
    body,
    handle(async (request, response, session, store) => {
      const input = request.body || {}
      const content = cleanContent(input)
      const draftTo = clean(input.to).replace(/\s+/g, " ").trim().slice(0, 400)
      const draftCc = clean(input.cc).replace(/\s+/g, " ").trim().slice(0, 400)
      if (drafts(session.key)) return response.status(429).json({ ok: false, error: "You're saving drafts too often. Wait a bit." })
      const existing = input.id ? await store.get(session.key, String(input.id)) : null
      const previous = existing?.folder === "drafts" ? existing.size : 0
      if (!(await makeRoom(store, session.key, content.size - previous))) {
        return response.status(400).json({ ok: false, error: "Your mailbox is full. Empty Deleted Items or delete some messages." })
      }
      const fields = { ...content, from: session.user.screenName, to: [], cc: [], draftTo, draftCc, read: true, time: Date.now() }
      const saved = existing?.folder === "drafts" ? await store.update(session.key, existing.id, fields) : await store.insert({ id: newId(), owner: session.key, folder: "drafts", ...fields })
      response.json({ ok: true, message: header(saved) })
    })
  )

  router.post(
    "/send",
    body,
    handle(async (request, response, session, store) => {
      const result = validateMessage(request.body || {})
      if (!result.ok) return response.status(400).json(result)
      const message = { ...result.message, from: session.user.screenName }

      // Everyone must be a real screen name
      const recipients = []
      for (const name of [...message.to, ...message.cc]) {
        const key = normalize(name)
        if (recipients.some((r) => r.key === key)) continue
        if (key === BOT_KEY) {
          recipients.push({ key, bot: true, screenName: BOT_NAME })
          continue
        }
        const user = await aim.store.find(key)
        if (!user) return response.status(400).json({ ok: false, error: `${name} is not a 98 Messenger screen name. Check the spelling and try again.` })
        recipients.push({ key, user, screenName: user.screenName })
      }
      // Show names the way their owners spell them
      const proper = (name) => recipients.find((r) => r.key === normalize(name))?.screenName || name
      message.to = message.to.map(proper)
      message.cc = message.cc.map(proper)

      if (sends.over(session.key)) return response.status(429).json({ ok: false, error: "You've sent a lot of mail this hour. Please wait a while before sending more." })
      if (!(await makeRoom(store, session.key, message.size))) {
        return response.status(400).json({ ok: false, error: "Your mailbox is full. Empty Deleted Items or delete some messages before sending." })
      }
      sends(session.key)

      const failed = []
      for (const r of recipients) {
        if (r.bot) {
          botAnswer(session, message)
          continue
        }
        // Blocked: quietly not delivered
        if (r.user.blocked?.includes(session.key)) continue
        if (!(await makeRoom(store, r.key, message.size))) {
          failed.push({ to: r.screenName, error: `${r.screenName}'s mailbox is full.` })
          continue
        }
        const copy = copyFor(r.key, "inbox", message)
        await store.insert(copy)
        await notify(store, r.key, copy)
      }

      const sent = await store.insert(copyFor(session.key, "sent", message))
      const draftId = request.body?.draftId
      if (draftId) {
        const draft = await store.get(session.key, String(draftId))
        if (draft?.folder === "drafts") await store.remove(session.key, draft.id)
      }
      response.json({ ok: true, message: header(sent), failed })
    })
  )

  router.use((error, request, response, next) => {
    if (error?.type === "entity.too.large") return response.status(413).json({ ok: false, error: `That message is too big. Messages can be at most ${MAX_MESSAGE_BYTES / 1024} KB with attachments.` })
    if (error?.type === "entity.parse.failed") return response.status(400).json({ ok: false, error: "That message couldn't be read." })
    next(error)
  })

  return Object.assign(router, { useAim: (value) => (aim = value) })
}

module.exports = { mailRouter, validateMessage, memoryStore, createMailStore, ATTACH_TYPES, MAX_MESSAGE_BYTES, MAILBOX_BYTES, FOLDERS }
