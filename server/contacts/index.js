// The Address Book's online copy, one per 98 Messenger account, so contacts follow you to
// every device you sign on with (the client keeps working on its own copy while signed off):
//   GET    /api/contacts        { revision, savedAt, now, contacts }   (tombstones included)
//   POST   /api/contacts/sync   { contacts: [changed or deleted ones] } -> the same as GET,
//                               after merging: for each id the newer updatedAt wins
//   DELETE /api/contacts        forget the online copy
// Every request needs "Authorization: Bearer <token>", the token 98 Messenger hands out at
// sign on (it works only while that session is signed on), like the online drive.

const express = require("express")
const { limiter } = require("../net/limiter")
const { createContactsStore } = require("./store")
const { cleanContacts, MAX_BYTES, MAX_CONTACTS } = require("./validate")

const WINDOW_MS = 10 * 60_000
const TOMBSTONE_MS = 180 * 24 * 60 * 60_000 // a deleted contact is remembered this long

// The newer of each contact wins; old tombstones are dropped. -> the merged list
const mergeContacts = (existing, incoming, now = Date.now()) => {
  const byId = new Map(existing.map((c) => [c.id, c]))
  for (const contact of incoming) {
    const old = byId.get(contact.id)
    if (!old || contact.updatedAt > old.updatedAt) byId.set(contact.id, contact)
  }
  return [...byId.values()].filter((c) => !c.deleted || now - c.updatedAt < TOMBSTONE_MS)
}

// aim: 98 Messenger's service ({ sessions }), a promise of it, or a function returning either
const contactsRouter = ({ aim, store, maxBytes = MAX_BYTES, maxContacts = MAX_CONTACTS, limits = {} } = {}) => {
  const router = express.Router()
  const storeReady = Promise.resolve(store || createContactsStore())
  storeReady.catch((error) => console.error("[contacts] store failed", error))

  const writes = limiter(limits.writes ?? 60, WINDOW_MS) // per account
  const reads = limiter(limits.reads ?? 120, WINDOW_MS) // per account
  const badTokens = limiter(limits.badTokens ?? 30, WINDOW_MS) // per IP

  const ipOf = (request) => String(request.headers["x-forwarded-for"] || request.socket.remoteAddress || "").split(",")[0].trim()

  const accountFor = async (token) => {
    if (!/^[0-9a-f]{48}$/.test(token)) return null
    const service = await (typeof aim === "function" ? aim() : aim)
    for (const session of service?.sessions?.values() || []) {
      if (session.token === token) return { key: session.key, screenName: session.user?.screenName }
    }
    return null
  }

  const json = (response, status, body) => response.status(status).json(body)
  const answer = (response, book) => json(response, 200, { ok: true, revision: book.revision, savedAt: book.savedAt, now: Date.now(), contacts: book.contacts })

  router.use(async (request, response, next) => {
    try {
      const ip = ipOf(request)
      if (badTokens.over(ip)) return json(response, 429, { ok: false, error: "Too many tries. Please wait a few minutes." })
      const token = String(request.headers.authorization || "").replace(/^Bearer\s+/i, "")
      const account = await accountFor(token)
      if (!account) {
        badTokens(ip)
        return json(response, 401, { ok: false, error: "Sign on to 98 Messenger to keep your Address Book online." })
      }
      const limited = request.method === "GET" ? reads : writes
      if (limited(account.key)) return json(response, 429, { ok: false, error: "Your Address Book is syncing too often. Please wait a few minutes." })
      request.account = account
      request.store = await storeReady
      next()
    } catch (error) {
      next(error)
    }
  })

  router.get("/", async (request, response) => answer(response, await request.store.get(request.account.key)))

  router.post("/sync", express.json({ limit: maxBytes + 64 * 1024 }), async (request, response) => {
    const checked = cleanContacts(request.body?.contacts)
    if (!checked.ok) return json(response, 400, { ok: false, error: checked.error })
    // read, merge, save; if another device saved in between, read again (a few times)
    for (let attempt = 0; attempt < 4; attempt++) {
      const book = await request.store.get(request.account.key)
      if (!checked.contacts.length) return answer(response, book)
      const merged = mergeContacts(book.contacts, checked.contacts)
      if (merged.length > maxContacts) return json(response, 413, { ok: false, error: `An address book can hold ${maxContacts} contacts.` })
      const data = JSON.stringify(merged)
      if (Buffer.byteLength(data) > maxBytes) return json(response, 413, { ok: false, error: "Your Address Book is full. Remove some pictures or contacts." })
      const saved = await request.store.put(request.account.key, data, book.revision)
      if (saved.ok) return answer(response, { revision: saved.revision, savedAt: Date.now(), contacts: merged })
    }
    json(response, 409, { ok: false, error: "Your Address Book is being changed somewhere else. Try again in a moment." })
  })

  router.delete("/", async (request, response) => {
    await request.store.remove(request.account.key)
    json(response, 200, { ok: true, revision: 0 })
  })

  // Delete My Account (../account)
  router.eraseAccount = async ({ key }) => ({ removed: !!(await (await storeReady).remove(key)) })

  router.use((error, request, response, next) => {
    if (response.headersSent) return next(error)
    if (error.type === "entity.too.large") return json(response, 413, { ok: false, error: "That's too much to sync at once. Remove some pictures and try again." })
    if (error.type === "entity.parse.failed") return json(response, 400, { ok: false, error: "That isn't an address book." })
    console.error("[contacts] request failed", error)
    json(response, 500, { ok: false, error: "The Address Book service is unavailable right now. Please try again later." })
  })

  return router
}

module.exports = { contactsRouter, mergeContacts }
