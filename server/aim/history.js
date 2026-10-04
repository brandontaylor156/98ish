// 98 Messenger's saved conversations: so a second device (or a phone that was reset) catches
// up, and a reload never loses a conversation. Devices keep their own copy (IndexedDB, see
// client/src/components/applets/aim/history/); this is the server's.
//
// ONE DOCUMENT PER MESSAGE, text only (MongoDB collection `imhistory`, short field names):
//   _id  message id (20 hex characters)
//   c    conversation: "<key>|<key>" for two people (sorted), "#<room key>" for a Buddy Chat room
//   p    keys who can read it: the two people (or the room's members at the time) who have
//        "Save my conversations on the server" on. Nobody left -> the document is deleted.
//   f    sender's screen name, fk its key ("" once the account is deleted: f = "(deleted account)")
//   to   recipient's screen name (two people) or the room's name
//   t    text (at most 1,024 characters)
//   s    style, only when it isn't the default ("font,size,rrggbb,flags")
//   at   sent (ms)        u   change counter (ms * 1000, increasing), what devices sync by
//   x    expires (Date, TTL index): a year after it was sent
//   m    picture / voice message: { id, k: "image" | "audio", w, h, d (seconds), z (bytes),
//        wf (voice waveform, 40 digits) }. The bytes are in the online storage bucket for 90
//        days (media.js); the small preview picture is never stored here.
//   r    reactions { key: "heart" | "lol" | "wow" | "sad" | "up" | "bang" }
//   h    1 while it waits for someone signed off (held with their notifications)
//
// SIZE: a typical document is about 250 bytes, plus about 200 bytes of indexes (_id, p+u,
// c+at, x): ~450 bytes a message. Caps: the newest 2,000 messages per pair (about 0.9 MB),
// 1,000 per room, a year at most, and IM_HISTORY_MAX_DOCS (default 120,000, ~55 MB) for
// everyone together: past it the oldest messages go first. That keeps Atlas's free 512 MB
// safe next to everything else (see CLAUDE.md "98 Messenger history").
//
// Also: `imclears` ({ k, c, at, u }: "Clear history" on one device reaches the others) and
// `imreads` ({ _id: "<reader>|<c>", r, o, c, at, w }: the newest message the reader has seen
// in a two-person conversation, and when; only kept while the reader has read receipts on).

const mongoose = require("mongoose")
const { DELETED_NAME } = require("../account")

const DAY = 86_400_000
const KEEP_DAYS = 365
const PER_PAIR = 2000
const PER_ROOM = 1000
const MAX_DOCS = 120_000
const REACTIONS = ["heart", "lol", "wow", "sad", "up", "bang"]

const envNum = (name, fallback) => {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

const pairConv = (a, b) => [a, b].sort().join("|")
const roomConv = (roomKey) => `#${roomKey}`
const isRoom = (c) => String(c).startsWith("#")
// the other person in a two-person conversation
const otherIn = (c, key) => {
  const [a, b] = String(c).split("|")
  return a === key ? b : b === key ? a : null
}

// ---- style, packed ----

const FONTS = ["Times New Roman", "Arial", "Comic Sans MS", "Courier New", "Verdana"]
const packStyle = (style = {}) => {
  const flags = (style.bold ? 1 : 0) + (style.italic ? 2 : 0) + (style.underline ? 4 : 0)
  const font = Math.max(0, FONTS.indexOf(style.font))
  const color = String(style.color || "#000000").slice(1).toLowerCase()
  if (font === 1 && (style.size || 12) === 12 && color === "000000" && !flags) return undefined
  return [font, style.size || 12, color, flags].join(",")
}
const unpackStyle = (s) => {
  if (!s) return { font: "Arial", size: 12, color: "#000000", bold: false, italic: false, underline: false }
  const [font, size, color, flags] = String(s).split(",")
  const f = Number(flags) || 0
  return { font: FONTS[Number(font)] || "Arial", size: Number(size) || 12, color: `#${color || "000000"}`, bold: !!(f & 1), italic: !!(f & 2), underline: !!(f & 4) }
}

// what a device gets: a message as `key` sees it
const toWire = (doc, key) => {
  const room = isRoom(doc.c)
  const mine = !!doc.fk && doc.fk === key
  return {
    id: String(doc._id),
    conv: room ? `#${doc.to}` : mine ? doc.to : doc.f,
    ck: room ? doc.c : otherIn(doc.c, key),
    ...(room ? { room: doc.to } : {}),
    from: doc.f,
    mine,
    text: doc.t || "",
    style: unpackStyle(doc.s),
    time: doc.at,
    u: doc.u,
    ...(doc.m ? { media: { ...doc.m } } : {}),
    ...(doc.r && Object.keys(doc.r).length ? { r: { ...doc.r } } : {}),
    ...(doc.h ? { held: true } : {}),
  }
}

// increasing change counter: ms * 1000 plus a count within the same ms
const createClock = () => {
  let last = 0
  return { next: () => (last = Math.max(last + 1, Date.now() * 1000)), peek: () => Math.max(last, Date.now() * 1000), seen: (u) => void (u > last && (last = u)) }
}

const rand = () => Math.random().toString(36).slice(2, 10)

// ---------- in memory (no MONGODB_URI: lost on restart) ----------

const memoryHistory = ({ perPair = PER_PAIR, perRoom = PER_ROOM, maxDocs = MAX_DOCS, keepDays = KEEP_DAYS, now = () => Date.now() } = {}) => {
  const docs = new Map()
  const clears = []
  const reads = new Map()
  const clock = createClock()
  const copy = (d) => d && structuredClone(d)
  const live = (d) => d.x > now()
  const capOf = (c) => (isRoom(c) ? perRoom : perPair)
  const inConv = (c) => [...docs.values()].filter((d) => d.c === c && live(d)).sort((a, b) => a.at - b.at || a.u - b.u)

  const trim = (c) => {
    const list = inConv(c)
    for (const d of list.slice(0, Math.max(0, list.length - capOf(c)))) docs.delete(d._id)
    if (docs.size > maxDocs) {
      const all = [...docs.values()].sort((a, b) => a.u - b.u)
      for (const d of all.slice(0, docs.size - Math.floor(maxDocs * 0.95))) docs.delete(d._id)
    }
  }
  const bump = (d) => (d.u = clock.next())
  const pull = (d, key) => {
    d.p = d.p.filter((k) => k !== key)
    if (!d.p.length) docs.delete(d._id)
  }

  return {
    kind: "memory",
    has: async (id) => docs.has(id),
    get: async (id) => copy(docs.get(id)),
    add: async (doc) => {
      const d = { ...structuredClone(doc), u: clock.next(), x: doc.at + keepDays * DAY }
      docs.set(d._id, d)
      trim(d.c)
      return copy(d)
    },
    react: async (id, key, emoji) => {
      const d = docs.get(id)
      if (!d) return null
      const r = { ...(d.r || {}) }
      if (emoji) r[key] = emoji
      else delete r[key]
      d.r = r
      bump(d)
      return copy(d)
    },
    delivered: async (ids) => {
      const out = []
      for (const id of ids) {
        const d = docs.get(id)
        if (!d?.h) continue
        delete d.h
        bump(d)
        out.push(copy(d))
      }
      return out
    },
    changes: async (key, since, limit = 300) => {
      const list = [...docs.values()].filter((d) => d.p.includes(key) && live(d) && d.u > since).sort((a, b) => a.u - b.u)
      return { docs: list.slice(0, limit).map(copy), more: list.length > limit }
    },
    recent: async (key, perConv = 50, maxConvs = 200) => {
      const byConv = new Map()
      for (const d of [...docs.values()].filter((d) => d.p.includes(key) && live(d)).sort((a, b) => b.at - a.at)) {
        const list = byConv.get(d.c) || []
        if (list.length < perConv) list.push(d)
        byConv.set(d.c, list)
      }
      return [...byConv.values()].slice(0, maxConvs).flat().map(copy)
    },
    older: async (key, c, before, limit = 50) =>
      inConv(c)
        .filter((d) => d.p.includes(key) && d.at < before)
        .reverse()
        .slice(0, limit)
        .map(copy),
    peek: async () => clock.peek(),
    clear: async (key, c, upTo) => {
      for (const d of [...docs.values()]) if (d.c === c && d.at <= upTo && d.p.includes(key)) pull(d, key)
      const entry = { k: key, c, at: upTo, u: clock.next() }
      clears.push(entry)
      return entry
    },
    clearsSince: async (key, since) => clears.filter((e) => e.k === key && e.u > since).map(copy),
    forget: async (key) => {
      for (const d of [...docs.values()]) if (d.p.includes(key)) pull(d, key)
    },
    setRead: async (r, o, c, at, w) => {
      const id = `${r}|${c}`
      const prev = reads.get(id)
      if (prev && prev.at >= at) return copy(prev)
      reads.set(id, { _id: id, r, o, c, at, w })
      return copy(reads.get(id))
    },
    readsFor: async (key) => [...reads.values()].filter((x) => x.o === key).map(copy),
    forgetReads: async (key) => {
      for (const [id, x] of reads) if (x.r === key) reads.delete(id)
    },
    count: async () => docs.size,
    eraseAccount: async (key) => {
      let removed = 0
      const renamed = new Map() // conversation -> its new name for the other person
      for (const d of [...docs.values()]) {
        const room = isRoom(d.c)
        const partner = room ? null : otherIn(d.c, key)
        const touched = d.p.includes(key) || d.fk === key || (!room && partner !== null) || (d.r && key in d.r)
        if (!touched) continue
        d.p = d.p.filter((k) => k !== key)
        if (d.r) delete d.r[key]
        if (!d.p.length) {
          docs.delete(d._id)
          removed++
          continue
        }
        if (d.fk === key) Object.assign(d, { f: DELETED_NAME, fk: "" })
        if (!room && partner !== null) {
          if (d.fk === partner) d.to = DELETED_NAME
          if (!renamed.has(d.c)) renamed.set(d.c, pairConv(partner, `~${rand()}`))
          d.c = renamed.get(d.c)
        }
      }
      for (const [id, x] of reads) if (x.r === key || x.o === key) reads.delete(id)
      for (let i = clears.length - 1; i >= 0; i--) if (clears[i].k === key) clears.splice(i, 1)
      return removed
    },
  }
}

// ---------- MongoDB ----------

const mongoHistory = async (connection, { perPair = PER_PAIR, perRoom = PER_ROOM, maxDocs = MAX_DOCS, keepDays = KEEP_DAYS, log = console } = {}) => {
  const History = connection.collection("imhistory")
  const Clears = connection.collection("imclears")
  const Reads = connection.collection("imreads")
  await Promise.all([
    History.createIndex({ p: 1, u: 1 }),
    History.createIndex({ c: 1, at: -1 }),
    History.createIndex({ x: 1 }, { expireAfterSeconds: 0 }),
    Clears.createIndex({ k: 1, u: 1 }),
    Clears.createIndex({ x: 1 }, { expireAfterSeconds: 0 }),
    Reads.createIndex({ o: 1 }),
    Reads.createIndex({ r: 1 }),
  ]).catch((error) => log.error?.("[aim history] indexes", error.message))
  const clock = createClock()
  const newest = await History.find({}, { projection: { u: 1 } }).sort({ u: -1 }).limit(1).toArray().catch(() => [])
  if (newest[0]) clock.seen(newest[0].u)
  const nowDate = () => new Date()
  const capOf = (c) => (isRoom(c) ? perRoom : perPair)

  // per-conversation caps: counted once, then tracked; trimmed 50 past the cap
  const counts = new Map()
  const trim = async (c) => {
    if (!counts.has(c)) counts.set(c, await History.countDocuments({ c }))
    else counts.set(c, counts.get(c) + 1)
    if (counts.get(c) <= capOf(c) + 50) return
    const keep = await History.find({ c }, { projection: { at: 1 } }).sort({ at: -1 }).skip(capOf(c) - 1).limit(1).toArray()
    if (keep[0]) await History.deleteMany({ c, at: { $lt: keep[0].at } })
    counts.set(c, await History.countDocuments({ c }))
    if (counts.size > 5000) counts.clear()
  }
  // everyone together: checked every 200 messages
  let sinceGuard = 200
  const guard = async () => {
    if (--sinceGuard > 0) return
    sinceGuard = 200
    const total = await History.estimatedDocumentCount()
    if (total <= maxDocs) return
    const cut = await History.find({}, { projection: { u: 1 } }).sort({ u: 1 }).skip(total - Math.floor(maxDocs * 0.95)).limit(1).toArray()
    if (cut[0]) {
      const { deletedCount } = await History.deleteMany({ u: { $lt: cut[0].u } })
      log.warn?.(`[aim history] over ${maxDocs} saved messages: the oldest ${deletedCount} went`)
      counts.clear()
    }
  }

  const pullFrom = async (filter, key) => {
    await History.updateMany({ ...filter, p: key }, { $pull: { p: key } })
    await History.deleteMany({ p: { $size: 0 } })
  }

  return {
    kind: "mongodb",
    has: async (id) => !!(await History.findOne({ _id: id }, { projection: { _id: 1 } })),
    get: (id) => History.findOne({ _id: id }),
    add: async (doc) => {
      const d = { ...doc, u: clock.next(), x: new Date(doc.at + keepDays * DAY) }
      await History.insertOne(d)
      await trim(d.c).catch(() => {})
      await guard().catch(() => {})
      return d
    },
    react: (id, key, emoji) =>
      History.findOneAndUpdate({ _id: id }, emoji ? { $set: { [`r.${key}`]: emoji, u: clock.next() } } : { $unset: { [`r.${key}`]: "" }, $set: { u: clock.next() } }, { returnDocument: "after" }),
    delivered: async (ids) => {
      const found = await History.find({ _id: { $in: ids }, h: 1 }).toArray()
      for (const d of found) {
        d.u = clock.next()
        delete d.h
        await History.updateOne({ _id: d._id }, { $unset: { h: "" }, $set: { u: d.u } })
      }
      return found
    },
    changes: async (key, since, limit = 300) => {
      const list = await History.find({ p: key, u: { $gt: since }, x: { $gt: nowDate() } }).sort({ u: 1 }).limit(limit + 1).toArray()
      return { docs: list.slice(0, limit), more: list.length > limit }
    },
    recent: async (key, perConv = 50, maxConvs = 200) => {
      const match = { $match: { p: key, x: { $gt: nowDate() } } }
      try {
        const groups = await History.aggregate([match, { $group: { _id: "$c", docs: { $topN: { n: perConv, sortBy: { at: -1 }, output: "$$ROOT" } } } }, { $limit: maxConvs }]).toArray()
        return groups.flatMap((g) => g.docs)
      } catch {
        // an older MongoDB without $topN
        const groups = await History.aggregate([match, { $sort: { at: -1 } }, { $group: { _id: "$c", docs: { $push: "$$ROOT" } } }, { $project: { docs: { $slice: ["$docs", perConv] } } }, { $limit: maxConvs }], { allowDiskUse: true }).toArray()
        return groups.flatMap((g) => g.docs)
      }
    },
    older: (key, c, before, limit = 50) => History.find({ c, p: key, at: { $lt: before }, x: { $gt: nowDate() } }).sort({ at: -1 }).limit(limit).toArray(),
    peek: async () => clock.peek(),
    clear: async (key, c, upTo) => {
      await pullFrom({ c, at: { $lte: upTo } }, key)
      counts.delete(c)
      const entry = { k: key, c, at: upTo, u: clock.next(), x: new Date(Date.now() + keepDays * DAY) }
      await Clears.insertOne(entry)
      return entry
    },
    clearsSince: (key, since) => Clears.find({ k: key, u: { $gt: since } }).sort({ u: 1 }).limit(500).toArray(),
    forget: async (key) => {
      await pullFrom({}, key)
      counts.clear()
    },
    setRead: async (r, o, c, at, w) => {
      const id = `${r}|${c}`
      await Reads.updateOne({ _id: id, $or: [{ at: { $lt: at } }, { at: { $exists: false } }] }, { $set: { r, o, c, at, w } }, { upsert: true }).catch((error) => {
        if (error.code !== 11000) throw error // an older read: the newer one stays
      })
      return Reads.findOne({ _id: id })
    },
    readsFor: (key) => Reads.find({ o: key }).limit(1000).toArray(),
    forgetReads: (key) => Reads.deleteMany({ r: key }),
    count: () => History.estimatedDocumentCount(),
    eraseAccount: async (key) => {
      let removed = 0
      // two-person conversations: one at a time, so the other person keeps theirs under a new name
      const convs = await History.distinct("c", { c: { $in: [new RegExp(`^${key}\\|`), new RegExp(`\\|${key}$`)] } })
      for (const c of convs) {
        const partner = otherIn(c, key)
        if (partner === null) continue
        removed += (await History.deleteMany({ c, p: { $not: { $elemMatch: { $ne: key } } } })).deletedCount
        const next = pairConv(partner, `~${rand()}`)
        await History.updateMany({ c, fk: key }, { $set: { f: DELETED_NAME, fk: "" } })
        await History.updateMany({ c, fk: { $ne: key } }, { $set: { to: DELETED_NAME } })
        await History.updateMany({ c }, { $pull: { p: key }, $unset: { [`r.${key}`]: "" }, $set: { c: next } })
        counts.delete(c)
      }
      // rooms: their name comes off what they said; their copies go
      await History.updateMany({ c: /^#/, fk: key }, { $set: { f: DELETED_NAME, fk: "" } })
      await History.updateMany({ p: key }, { $pull: { p: key }, $unset: { [`r.${key}`]: "" } })
      await History.updateMany({ [`r.${key}`]: { $exists: true } }, { $unset: { [`r.${key}`]: "" } })
      removed += (await History.deleteMany({ p: { $size: 0 } })).deletedCount
      await Promise.all([Reads.deleteMany({ $or: [{ r: key }, { o: key }] }), Clears.deleteMany({ k: key })])
      return removed
    },
  }
}

const createHistoryStore = async (uri = process.env.MONGODB_URI, options = {}) => {
  const opts = { maxDocs: envNum("IM_HISTORY_MAX_DOCS", MAX_DOCS), ...options }
  if (!uri) return memoryHistory(opts)
  const connection = await mongoose.createConnection(uri, { maxPoolSize: 3 }).asPromise()
  return mongoHistory(connection, opts)
}

module.exports = { createHistoryStore, memoryHistory, mongoHistory, toWire, packStyle, unpackStyle, pairConv, roomConv, isRoom, otherIn, REACTIONS, PER_PAIR, PER_ROOM, MAX_DOCS, KEEP_DAYS }
