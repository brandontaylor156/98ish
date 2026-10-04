// The online copy of your C: drive, tied to your 98 Messenger account:
//   GET    /api/drive        { revision, savedAt, size, snapshot }   (revision 0: nothing saved yet)
//   GET    /api/drive/info   the same without the snapshot
//   PUT    /api/drive        { baseRevision, snapshot } -> { revision, savedAt, size }
//                            409 { conflict, revision, savedAt } if someone saved since baseRevision
//   DELETE /api/drive        forget the online copy
// Every request needs "Authorization: Bearer <token>", the token 98 Messenger hands out at
// sign on: it works only while that session is signed on (and for its 20 second reconnect
// grace), so signing on somewhere else or signing off ends it.

const express = require("express")
const { limiter } = require("../net/limiter")
const { createDriveStore, info } = require("./store")
const { validateSnapshot, MAX_BYTES } = require("./validate")

const WINDOW_MS = 10 * 60_000

// aim: 98 Messenger's service ({ sessions }), a promise of it, or a function returning either
const driveRouter = ({ aim, store, maxBytes = MAX_BYTES, limits = {} } = {}) => {
  const router = express.Router()
  // the store connects in the background; requests wait for it
  const storeReady = Promise.resolve(store || createDriveStore())
  storeReady.catch((error) => console.error("[drive] store failed", error))

  const writes = limiter(limits.writes ?? 30, WINDOW_MS) // per account
  const reads = limiter(limits.reads ?? 120, WINDOW_MS) // per account
  const badTokens = limiter(limits.badTokens ?? 30, WINDOW_MS) // per IP

  const ipOf = (request) => String(request.headers["x-forwarded-for"] || request.socket.remoteAddress || "").split(",")[0].trim()

  // Which signed-on 98 Messenger account this token belongs to (null if none)
  const accountFor = async (token) => {
    if (!/^[0-9a-f]{48}$/.test(token)) return null
    const service = await (typeof aim === "function" ? aim() : aim)
    for (const session of service?.sessions?.values() || []) {
      if (session.token === token) return { key: session.key, screenName: session.user?.screenName }
    }
    return null
  }

  const json = (response, status, body) => response.status(status).json(body)

  router.use(async (request, response, next) => {
    try {
      const ip = ipOf(request)
      if (badTokens.over(ip)) return json(response, 429, { ok: false, error: "Too many tries. Please wait a few minutes." })
      const token = String(request.headers.authorization || "").replace(/^Bearer\s+/i, "")
      const account = await accountFor(token)
      if (!account) {
        badTokens(ip)
        return json(response, 401, { ok: false, error: "Sign on to 98 Messenger to use your online drive." })
      }
      const limited = request.method === "GET" ? reads : writes
      if (limited(account.key)) return json(response, 429, { ok: false, error: "Your files are syncing too often. Please wait a few minutes." })
      request.account = account
      request.store = await storeReady
      next()
    } catch (error) {
      next(error)
    }
  })

  router.get("/info", async (request, response) => {
    const doc = await request.store.get(request.account.key)
    json(response, 200, { ok: true, ...(info(doc) || { revision: 0, savedAt: null, size: 0 }) })
  })

  router.get("/", async (request, response) => {
    const doc = await request.store.get(request.account.key)
    if (!doc) return json(response, 200, { ok: true, revision: 0, savedAt: null, size: 0, snapshot: null })
    json(response, 200, { ok: true, ...info(doc), snapshot: JSON.parse(doc.data) })
  })

  router.put("/", express.json({ limit: maxBytes + 256 * 1024 }), async (request, response) => {
    const body = request.body || {}
    const base = body.baseRevision
    if (!Number.isInteger(base) || base < 0) return json(response, 400, { ok: false, error: "Missing the revision this copy is based on." })
    const checked = validateSnapshot(body.snapshot, maxBytes)
    if (!checked.ok) return json(response, checked.status, { ok: false, error: checked.error })
    const result = await request.store.put(request.account.key, { data: checked.json, size: checked.size }, base)
    if (!result.ok) {
      return json(response, 409, {
        ok: false,
        conflict: true,
        error: "Your online copy was changed somewhere else.",
        ...(info(result.doc) || { revision: 0, savedAt: null, size: 0 }),
      })
    }
    json(response, 200, { ok: true, ...info(result.doc) })
  })

  router.delete("/", async (request, response) => {
    await request.store.remove(request.account.key)
    json(response, 200, { ok: true, revision: 0 })
  })

  // body too big, broken JSON, or a server error: always answer in JSON
  router.use((error, request, response, next) => {
    if (response.headersSent) return next(error)
    if (error.type === "entity.too.large") {
      return json(response, 413, { ok: false, error: `An online copy can hold ${(maxBytes / 1024 / 1024).toFixed(1)} MB. Delete some pictures or sounds and try again.` })
    }
    if (error.type === "entity.parse.failed") return json(response, 400, { ok: false, error: "That isn't a drive copy." })
    console.error("[drive] request failed", error)
    json(response, 500, { ok: false, error: "The online drive is unavailable right now. Please try again later." })
  })

  return router
}

const { syncRouter } = require("./sync")

module.exports = { driveRouter, syncRouter, createDriveStore, MAX_BYTES }
