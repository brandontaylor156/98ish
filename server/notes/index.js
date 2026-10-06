// Notes (sticky notes) for 98 Messenger accounts: every note follows its owner to each device
// they sign on with, and a note can be shared with buddies, who all edit it (a grocery list,
// date ideas). The merge is client/src/components/applets/notes/notesCore.js, the same file
// the client uses: each field is newest-wins, each checklist item is its own entry
// (newest-wins, deleted ones kept as tombstones), so edits made apart never clobber a whole
// list. Tasks are not here: they're to-do events in 98ish Calendar (server/calendar).
//
// Every route needs "Authorization: Bearer <token>" from a signed-on 98 Messenger session.
//   POST /api/notes/sync           { since, notes: [changed notes] } -> { now, notes: [{ note,
//                                  share }], gone: [ids], rejected: [{ id, error }] }: merges
//                                  what was sent, then everything changed for you since `since`
//   POST /api/notes/:id/share      { to }   add a buddy (any member can)
//   POST /api/notes/:id/leave      { copy, trash }  leave a shared note; with copy, you keep
//                                  a personal copy (in your Recycle Bin with trash)
//   POST /api/notes/:id/unshare    { key? } the owner removes one person (or everyone else);
//                                  each person removed keeps a personal copy
// Live: "notes:changed" { ids, by } to the members' 98 Messenger sockets; push (category
// "notes") to members who are away, at most every 15 minutes per note.
//
// Caps (MongoDB's free tier is 512 MB for everything): 2,000 notes per account, 20 KB per
// note, 3 MB of notes owned per account, 10 people per shared note. A record is the note
// as JSON plus ~200 bytes; a typical note is 0.3-2 KB, so 20 people with 300 notes each is
// about 10 MB, and the worst case (an account at its 3 MB cap) is bounded per account.
// Deleted notes (out of the Recycle Bin) stay as tombstones (~150 bytes) for 180 days so
// every device hears about it.

const path = require("path")
const crypto = require("crypto")
const { pathToFileURL } = require("url")
const express = require("express")
const { limiter } = require("../net/limiter")
const { validate: validateName } = require("../aim/screenNames")
const { createNotesStore, memoryStore } = require("./store")

const WINDOW_MS = 10 * 60_000
const PUSH_QUIET_MS = 15 * 60_000
const MAX_PER_SYNC = 200
const BOT_KEY = "smarterchild"

let coreModule = null
const loadCore = () => (coreModule ??= import(pathToFileURL(path.join(__dirname, "../../client/src/components/applets/notes/notesCore.js")).href))

class Refused extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}
const refuse = (status, message) => {
  throw new Refused(status, message)
}

const newId = () => crypto.randomBytes(8).toString("hex")

// aim: 98 Messenger's service ({ sessions, store }), a promise of it, or a function returning
// either; push: server/push's service (or null)
const createNotes = ({ aim, store, push = null, now = Date.now, limits = {} } = {}) => {
  const storeReady = Promise.resolve(store || createNotesStore())
  storeReady.catch((error) => console.error("[notes] store failed", error))
  const getAim = async () => (typeof aim === "function" ? aim() : aim)
  const pushedAt = new Map() // `${id}|${key}` -> time of the last push about it

  const emitTo = async (key, event, payload) => {
    const socket = (await getAim())?.sessions?.get(key)?.socket
    if (socket) socket.emit(event, payload)
  }

  const shareOf = (doc) =>
    doc.members.length > 1
      ? { owner: doc.owner, ownerName: doc.names?.[doc.owner] || doc.owner, members: doc.members.map((k) => ({ key: k, name: doc.names?.[k] || k })) }
      : null
  const view = (doc) => ({ note: JSON.parse(doc.data), share: shareOf(doc) })

  const record = (core, note, key, name, extra = {}) => {
    const data = JSON.stringify(note)
    const t = now()
    return { id: note.id, owner: key, members: [key], names: { [key]: name }, gone: [], data, size: Buffer.byteLength(data), changedAt: t, purged: core.isPurged(note), createdAt: t, ...extra }
  }

  // tell the other members (and my other devices) something changed; push to the away ones
  const announce = async (doc, byKey, byName, { pushText = null } = {}) => {
    const payload = { ids: [doc.id], by: byName }
    for (const key of new Set([...doc.members, ...(doc.gone || [])])) if (key !== byKey) await emitTo(key, "notes:changed", payload)
    if (!push || !pushText) return
    const note = JSON.parse(doc.data)
    const core = await loadCore()
    const title = core.noteTitle(note) || "a note"
    for (const key of doc.members) {
      if (key === byKey) continue
      const k = `${doc.id}|${key}`
      if (now() - (pushedAt.get(k) || 0) < PUSH_QUIET_MS) continue
      pushedAt.set(k, now())
      push
        .notify(key, "notes", {
          title: pushText(title),
          body: core.noteText(note).slice(0, 140),
          tag: `note-${doc.id}`,
          key: `note-${doc.id}`,
          app: "notes",
          url: `/?open=program&name=Notes&note=${doc.id}`,
        })
        .catch?.(() => {})
    }
  }

  // ---- sync ----

  const sync = async (account, { since = 0, notes = [] } = {}) => {
    const core = await loadCore()
    const s = await storeReady
    const rejected = []
    const t0 = now()
    if (!Array.isArray(notes)) refuse(400, "That isn't a list of notes.")
    if (notes.length > MAX_PER_SYNC) refuse(413, `Send at most ${MAX_PER_SYNC} notes at a time.`)
    for (const input of notes) {
      const checked = core.cleanNote(input, t0)
      if (!checked.ok) {
        rejected.push({ id: String(input?.id || "").slice(0, 32), error: checked.error })
        continue
      }
      const incoming = checked.note
      try {
        await saveOne(core, s, account, incoming)
      } catch (error) {
        if (!(error instanceof Refused)) throw error
        rejected.push({ id: incoming.id, error: error.message })
      }
    }
    const since0 = Number.isFinite(Number(since)) ? Math.max(0, Number(since)) : 0
    // "now" for the device's next sync is read after this request's own saves (their
    // changedAt is later than t0): reading it before sent a busy server's fresh saves back
    // on the next sync (the root npm test caught it under load)
    const t1 = now()
    const changed = await s.changedFor(account.key, since0)
    const out = []
    const gone = []
    for (const doc of changed) {
      if (!doc.members.includes(account.key)) gone.push(doc.id)
      else out.push(view(doc))
      // tombstones nobody needs any more
      if (doc.purged && t0 - doc.changedAt > core.TOMBSTONE_MS && doc.members.length <= 1) await s.remove(doc.id)
    }
    return { now: t1, notes: out, gone, rejected }
  }

  const saveOne = async (core, s, account, incoming) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const doc = await s.get(incoming.id)
      if (!doc) {
        if (core.isPurged(incoming)) return // never reached the server: nothing to tell anyone
        if ((await s.countFor(account.key)) >= core.LIMITS.notes) refuse(413, `You can keep at most ${core.LIMITS.notes} notes. Empty the Recycle Bin or delete some.`)
        const fresh = record(core, incoming, account.key, account.name)
        if ((await s.bytesOwned(account.key)) + fresh.size > core.LIMITS.accountBytes) refuse(413, "Your notes are full (3 MB). Delete some long notes.")
        if (await s.create(fresh)) return
        continue // someone made it a moment ago: merge into theirs
      }
      if (!doc.members.includes(account.key)) {
        if (doc.gone?.includes(account.key)) return // they left it: their devices drop it
        refuse(404, "That note isn't yours.")
      }
      // a shared note isn't deleted for everyone: deleting it means leaving it
      if (core.isPurged(incoming) && doc.members.length > 1) {
        await leave(account, doc.id, { copy: false })
        return
      }
      const stored = JSON.parse(doc.data)
      const merged = core.pruneNote(core.mergeNotes(stored, incoming), now())
      if (core.sameNote(merged, stored)) return
      const data = JSON.stringify(merged)
      const size = Buffer.byteLength(data)
      if (size > core.LIMITS.noteBytes) refuse(413, "That note is too long (20 KB at most). Split it into two notes.")
      if (doc.owner === account.key && size > doc.size && (await s.bytesOwned(account.key)) - doc.size + size > core.LIMITS.accountBytes) refuse(413, "Your notes are full (3 MB). Delete some long notes.")
      const next = { ...doc, data, size, changedAt: now(), purged: core.isPurged(merged), names: { ...doc.names, [account.key]: account.name } }
      const saved = await s.put(next, doc.rev)
      if (!saved.ok) continue
      const shared = doc.members.length > 1
      await announce(next, account.key, account.name, { pushText: shared ? (title) => `${account.name} changed "${title}"` : null })
      return
    }
    refuse(409, "That note is being changed somewhere else. Try again in a moment.")
  }

  // ---- sharing ----

  const memberDoc = async (key, id) => {
    const doc = /^[a-f0-9]{16}$/.test(String(id)) ? await (await storeReady).get(String(id)) : null
    if (!doc || !doc.members.includes(key) || doc.purged) refuse(404, "That note isn't here, or it isn't shared with you.")
    return doc
  }

  // save a changed record, reading again if someone saved in between
  const update = async (key, id, change) => {
    const s = await storeReady
    for (let attempt = 0; attempt < 4; attempt++) {
      const doc = await memberDoc(key, id)
      const next = await change(doc)
      if (!next) return doc
      const saved = await s.put({ ...next, changedAt: now() }, doc.rev)
      if (saved.ok) return { ...next, rev: saved.rev }
    }
    refuse(409, "That note is being changed somewhere else. Try again in a moment.")
  }

  // a personal copy of a note for someone leaving it (a new id)
  const copyFor = async (doc, key, name, { trash = false } = {}) => {
    const core = await loadCore()
    const id = newId()
    let note = { ...JSON.parse(doc.data), id }
    if (trash) note = core.trashNote(note, now())
    await (await storeReady).create(record(core, note, key, name))
    return id
  }

  const share = async (account, id, to) => {
    const target = validateName(to)
    if (target.error) refuse(400, "That isn't a 98 Messenger screen name.")
    if (target.key === account.key) refuse(400, "That's you!")
    if (target.key === BOT_KEY) refuse(400, "SmarterChild doesn't keep notes.")
    const user = await (await getAim())?.store?.find?.(target.key)
    if (!user) refuse(404, `${target.screenName} is not a 98 Messenger screen name. Check the spelling and try again.`)
    if ((user.blocked || []).includes(account.key) || (account.blocked || []).includes(target.key)) refuse(409, `You can't share with ${user.screenName} right now.`)
    const core = await loadCore()
    if ((await (await storeReady).countFor(target.key)) >= core.LIMITS.notes) refuse(413, `${user.screenName} has too many notes to get another.`)
    const doc = await update(account.key, id, async (doc) => {
      if (doc.members.includes(target.key)) return null
      if (doc.members.length >= core.LIMITS.members) refuse(413, `A note can be shared with at most ${core.LIMITS.members} people.`)
      if (core.isTrashed(JSON.parse(doc.data))) refuse(409, "Take the note out of the Recycle Bin first.")
      return { ...doc, members: [...doc.members, target.key], gone: (doc.gone || []).filter((k) => k !== target.key), names: { ...doc.names, [account.key]: account.name, [target.key]: user.screenName } }
    })
    await announce(doc, account.key, account.name, { pushText: (title) => `${account.name} shared "${title}" with you` })
    return view(doc)
  }

  const leave = async (account, id, { copy = true, trash = false } = {}) => {
    const doc = await update(account.key, id, async (doc) => {
      if (doc.members.length < 2) refuse(409, "That note isn't shared.")
      const members = doc.members.filter((k) => k !== account.key)
      return { ...doc, members, owner: doc.owner === account.key ? members[0] : doc.owner, gone: [...new Set([...(doc.gone || []), account.key])] }
    })
    const copied = copy ? await copyFor(doc, account.key, account.name, { trash }) : null
    await announce(doc, account.key, account.name)
    return { left: id, copy: copied }
  }

  const unshare = async (account, id, key = null) => {
    const removed = []
    const doc = await update(account.key, id, async (doc) => {
      if (doc.owner !== account.key) refuse(403, "Only the person who shared the note can remove people. You can leave it.")
      const out = key ? doc.members.filter((k) => k === key && k !== account.key) : doc.members.filter((k) => k !== account.key)
      if (!out.length) return null
      removed.push(...out.map((k) => ({ key: k, name: doc.names?.[k] || k })))
      return { ...doc, members: doc.members.filter((k) => !out.includes(k)), gone: [...new Set([...(doc.gone || []), ...out])] }
    })
    for (const r of removed) await copyFor(doc, r.key, r.name)
    await announce(doc, account.key, account.name)
    return view(doc)
  }

  // Delete My Account (../account): personal notes go; in shared notes they leave (the others
  // keep the note: ownership passes on), and every trace of them in `gone` goes
  const eraseAccount = async ({ key }) => {
    const s = await storeReady
    let removed = 0
    let left = 0
    for (const doc of await s.forKey(key)) {
      const others = doc.members.filter((k) => k !== key)
      if (!others.length) {
        await s.remove(doc.id)
        removed++
        continue
      }
      for (let attempt = 0; attempt < 4; attempt++) {
        const fresh = attempt ? await s.get(doc.id) : doc
        if (!fresh) break
        const members = fresh.members.filter((k) => k !== key)
        const { [key]: drop, ...names } = fresh.names || {}
        const next = { ...fresh, members, names, owner: fresh.owner === key ? members[0] : fresh.owner, gone: (fresh.gone || []).filter((k) => k !== key), changedAt: now() }
        if ((await s.put(next, fresh.rev)).ok) {
          if (doc.members.includes(key)) left++
          await announce(next, key, "(deleted account)")
          break
        }
      }
    }
    return { removed, left }
  }

  // ---- HTTP ----

  const router = () => {
    const r = express.Router()
    const writes = limiter(limits.writes ?? 600, WINDOW_MS) // per account
    const shares = limiter(limits.shares ?? 40, 60 * 60_000)
    const badTokens = limiter(limits.badTokens ?? 30, WINDOW_MS) // per IP
    const ipOf = (request) => String(request.headers["x-forwarded-for"] || request.socket.remoteAddress || "").split(",")[0].trim()

    const accountFor = async (token) => {
      if (!/^[0-9a-f]{48}$/.test(token)) return null
      const service = await getAim()
      for (const session of service?.sessions?.values() || []) {
        if (session.token === token) return { key: session.key, name: session.user?.screenName || session.key, blocked: session.user?.blocked || [] }
      }
      return null
    }

    r.use(async (request, response, next) => {
      try {
        const ip = ipOf(request)
        if (badTokens.over(ip)) return response.status(429).json({ ok: false, error: "Too many tries. Please wait a few minutes." })
        const account = await accountFor(String(request.headers.authorization || "").replace(/^Bearer\s+/i, ""))
        if (!account) {
          badTokens(ip)
          return response.status(401).json({ ok: false, error: "Sign on to 98 Messenger to keep your notes online." })
        }
        if (writes(account.key)) return response.status(429).json({ ok: false, error: "Your notes are syncing too often. Please wait a few minutes." })
        request.account = account
        next()
      } catch (error) {
        next(error)
      }
    })
    r.use(express.json({ limit: "4mb" }))

    const handle = (fn) => async (request, response) => {
      try {
        response.json({ ok: true, ...(await fn(request)) })
      } catch (error) {
        if (error instanceof Refused) return response.status(error.status).json({ ok: false, error: error.message })
        console.error("[notes]", error?.message)
        response.status(503).json({ ok: false, error: "The notes service isn't answering. Your notes are safe on this device; try again in a minute." })
      }
    }
    const shareLimit = (request) => {
      if (shares(request.account.key)) refuse(429, "That's a lot of sharing. Try again later.")
    }

    r.post("/sync", handle((request) => sync(request.account, request.body || {})))
    r.post(
      "/:id/share",
      handle(async (request) => {
        shareLimit(request)
        return share(request.account, request.params.id, request.body?.to)
      })
    )
    r.post("/:id/leave", handle((request) => leave(request.account, request.params.id, { copy: request.body?.copy !== false, trash: request.body?.trash === true })))
    r.post("/:id/unshare", handle((request) => unshare(request.account, request.params.id, typeof request.body?.key === "string" ? request.body.key : null)))

    r.use((error, request, response, next) => {
      if (response.headersSent) return next(error)
      if (error.type === "entity.too.large") return response.status(413).json({ ok: false, error: "That's too much to sync at once." })
      if (error.type === "entity.parse.failed") return response.status(400).json({ ok: false, error: "Those aren't notes." })
      console.error("[notes] request failed", error)
      response.status(500).json({ ok: false, error: "The notes service is unavailable right now. Please try again later." })
    })
    return r
  }

  return { router, sync, share, leave, unshare, eraseAccount, getStore: () => storeReady }
}

const notesService = ({ aim, push } = {}) => createNotes({ aim, push, store: process.env.MONGODB_URI ? undefined : memoryStore() })

module.exports = { createNotes, notesService, loadCore }
