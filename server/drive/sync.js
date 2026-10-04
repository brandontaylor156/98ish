// File sync between your devices, per 98 Messenger account. Every file and folder is an
// entry keyed by its path ("C:/My Pictures/PHOTO001.JPG") with a revision number from the
// account's counter; contents are stored once per account by their content key (the hash
// the client's drive uses, checked here). Devices pull what changed since the last
// revision they saw, upload the contents the server doesn't have, then push their own
// changes, each naming the revision it was based on: a change based on an old revision is
// refused as a conflict and the device keeps both copies (see client/src/utils/driveSync.js).
//
//   POST   /api/drive/sync/device        a sync token for this device (needs the 98 Messenger
//                                       session token): keeps syncing after the session ends
//   DELETE /api/drive/sync/device        forget this device's sync token
//   GET    /api/drive/sync/state         { seq, usage, quota, files, maxFile }
//   GET    /api/drive/sync/changes?since=N&limit=M   { seq, entries: [entry], more }
//   POST   /api/drive/sync/have          { hashes } -> { missing }
//   PUT    /api/drive/sync/blob/:hash    the contents as text -> { stored }
//   GET    /api/drive/sync/blob/:hash    the contents as text
//   POST   /api/drive/sync/push          { device, changes: [change] } -> { seq, results }
//          change = { path, kind, type, hash, size, mtime, deleted, baseRev }
//   GET    /api/drive/sync/achievements  { achievements }
//   PUT    /api/drive/sync/achievements  { achievements } -> merged with what's there
//   DELETE /api/drive/sync               everything synced for this account
//
// Every request needs "Authorization: Bearer <token>": the 98 Messenger session token (48 hex
// characters) or a device sync token from POST /device (64 hex characters, kept as a hash).
// Env: DRIVE_SYNC_QUOTA_MB (stored contents per account, default 100), DRIVE_SYNC_MAX_FILE_MB
// (one file, default 12), DRIVE_SYNC_TOTAL_MB (all accounts together, default 380).
// Room: MongoDB Atlas's free tier (M0) holds 512 MB in all (data and indexes, every
// collection). Photos are kept as their binary bytes, and Camera/Photos save JPEGs of at
// most about 400 KB (usually 250-350 KB), so 100 MB is roughly 300 photos per account: a
// couple's two accounts use at most 200 MB. The total cap keeps file sync from filling the
// database (mail, calendars, couples and accounts need the rest, and MongoDB refuses every
// write once the tier is full); past it new files wait on each device with a clear message.

const crypto = require("node:crypto")
const express = require("express")
const { limiter } = require("../net/limiter")
const { createSyncStore, encodeBlob, decodeBlob } = require("./syncStore")
const { validateDrive, validateAchievements } = require("./validate")

const MB = 1024 * 1024
const WINDOW_MS = 10 * 60_000
const DEVICE_DAYS = 60
const MAX_DEVICES = 10
const MAX_BATCH = 200
const MAX_PATH = 1024
const MAX_DEPTH = 40
const PAGE = 500
const MAX_ENTRIES = 20_000 // files, folders and tombstones per account (empty files cost no quota)
const SWEEP_MS = 60 * 60_000 // look for unused contents at most hourly per account
const ORPHAN_MS = 24 * 60 * 60_000 // contents nobody points at are kept a day (an upload in progress)

const BAD_NAME = /[\\/:"<>|\u0000-\u001F\u007F]/
const TYPE = /^[a-z][a-z0-9]{0,31}$/
const HASH = /^[0-9a-z]{1,14}-[0-9a-z]{1,9}$/
const SKIP_FOLDERS = new Set(["Programs", "Windows", "Bookmarks"]) // never converted from old copies

const envMb = (name, fallback) => {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

// The same hash the client's drive uses for content keys (client/src/utils/driveStore.js)
const hashText = (text) => {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}
const contentKey = (text) => `${hashText(text)}-${text.length.toString(36)}`

const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex")

// "C:/Documents/notes" -> null if fine, else what's wrong
const pathProblem = (path) => {
  if (typeof path !== "string" || !path || path.length > MAX_PATH) return "A path is missing or too long."
  const parts = path.split("/")
  if (parts[0] !== "C:" || parts.length < 2 || parts.length > MAX_DEPTH) return "Only files on drive C: can sync."
  for (const part of parts.slice(1)) {
    if (!part || part !== part.trim() || part.length > 64 || BAD_NAME.test(part)) return `"${part}" isn't a valid name.`
  }
  return null
}

// A change from a device -> { change } | { error }
const checkChange = (raw) => {
  if (!raw || typeof raw !== "object") return { error: "A change is damaged." }
  const problem = pathProblem(raw.path)
  if (problem) return { error: problem }
  const kind = raw.kind === "d" ? "d" : raw.kind === "f" ? "f" : null
  if (!kind) return { error: "A change is damaged." }
  if (!Number.isInteger(raw.baseRev) || raw.baseRev < 0) return { error: "A change is missing its revision." }
  const deleted = raw.deleted === true
  const type = String(raw.type || (kind === "d" ? "folder" : "text"))
  if (!TYPE.test(type)) return { error: "A file has an unknown type." }
  const change = { path: raw.path, kind, type, deleted, baseRev: raw.baseRev, hash: null, size: 0, mtime: Number(raw.mtime) || 0 }
  if (kind === "f" && !deleted) {
    if (typeof raw.hash !== "string" || !HASH.test(raw.hash)) return { error: "A file is missing its contents." }
    change.hash = raw.hash
    change.size = Math.max(0, Math.floor(Number(raw.size) || 0))
  }
  return { change }
}

// One thing at a time per account (pushes and reads see each other whole)
const keyedLock = () => {
  const tails = new Map()
  return (key, fn) => {
    const prev = tails.get(key) || Promise.resolve()
    const run = prev.then(fn, fn)
    const tail = run.catch(() => {})
    tails.set(key, tail)
    tail.then(() => tails.get(key) === tail && tails.delete(key))
    return run
  }
}

// achievements: every one found anywhere (earliest time wins), every step taken
const mergeAchievements = (a = {}, b = {}) => {
  const unlocked = { ...(a.unlocked || {}) }
  for (const [id, time] of Object.entries(b.unlocked || {})) unlocked[id] = unlocked[id] ? Math.min(unlocked[id], time) : time
  const progress = { ...(a.progress || {}) }
  for (const [id, steps] of Object.entries(b.progress || {})) progress[id] = [...new Set([...(progress[id] || []), ...steps])].slice(0, 64)
  return { unlocked, progress }
}

const syncRouter = ({ aim, store, legacy, quotaBytes, totalBytes, maxFileChars, maxEntries = MAX_ENTRIES, limits = {}, now = () => Date.now() } = {}) => {
  const router = express.Router()
  const quota = quotaBytes ?? envMb("DRIVE_SYNC_QUOTA_MB", 100) * MB
  const total = totalBytes ?? envMb("DRIVE_SYNC_TOTAL_MB", 380) * MB
  const maxFile = maxFileChars ?? envMb("DRIVE_SYNC_MAX_FILE_MB", 12) * MB
  const storeReady = Promise.resolve(store || createSyncStore())
  storeReady.catch((error) => console.error("[drive sync] store failed", error))
  const lock = keyedLock()

  const reads = limiter(limits.reads ?? 900, WINDOW_MS) // per account
  const writes = limiter(limits.writes ?? 600, WINDOW_MS) // per account
  const badTokens = limiter(limits.badTokens ?? 30, WINDOW_MS) // per IP
  const uploadBytes = new Map() // key -> [{ at, bytes }]
  const maxUploadBytes = limits.uploadBytes ?? 300 * MB // per account per window

  const json = (response, status, body) => response.status(status).json(body)
  const ipOf = (request) => String(request.headers["x-forwarded-for"] || request.socket.remoteAddress || "").split(",")[0].trim()

  const sessionAccount = async (token) => {
    const service = await (typeof aim === "function" ? aim() : aim)
    for (const session of service?.sessions?.values() || []) {
      if (session.token === token) return { key: session.key, screenName: session.user?.screenName, via: "session" }
    }
    return null
  }

  const deviceAccount = async (db, token) => {
    const hash = sha256(token)
    const device = await db.findDevice(hash)
    if (!device || new Date(device.expiresAt).getTime() < now()) return null
    // in use: good for another full stretch (written at most daily)
    if (now() - new Date(device.lastSeen).getTime() > 24 * 60 * 60_000) {
      await db.touchDevice(hash, { lastSeen: new Date(now()), expiresAt: new Date(now() + DEVICE_DAYS * 24 * 60 * 60_000) })
    }
    return { key: device.key, via: "device", deviceHash: hash }
  }

  // Old whole-drive online copies become synced files the first time sync is used
  const fromLegacy = async (db, key) => {
    const legacyStore = await (typeof legacy === "function" ? legacy() : legacy)
    const doc = legacyStore && (await legacyStore.get(key))
    if (!doc) return
    let snapshot
    try {
      snapshot = JSON.parse(doc.data)
    } catch {
      return
    }
    if (validateDrive(snapshot?.drive)) return
    const c = snapshot.drive.root.find((node) => node.k === "d" && node.n === "C:")
    const walk = async (nodes, prefix) => {
      for (const node of nodes || []) {
        const path = `${prefix}/${node.n}`
        if (prefix === "C:" && node.k === "d" && SKIP_FOLDERS.has(node.n)) continue
        if (node.k === "d") {
          await db.putEntry(key, { path, kind: "d", type: node.t, hash: null, size: 0, mtime: 0, rev: await db.bumpSeq(key), deleted: false, device: "Online Copy", at: new Date(now()) })
          await walk(node.c, path)
          continue
        }
        const text = String(node.x || "")
        const hash = contentKey(text)
        const account = await db.getAccount(key)
        const blob = { ...encodeBlob(text), at: new Date(now()) }
        if (account.usage + blob.size > quota) continue
        await db.putBlob(key, hash, blob)
        await db.putEntry(key, { path, kind: "f", type: node.t, hash, size: blob.size, mtime: 0, rev: await db.bumpSeq(key), deleted: false, device: "Online Copy", at: new Date(now()) })
      }
    }
    await walk(c?.c, "C:")
    const achievements = snapshot.achievements && !validateAchievements(snapshot.achievements) ? snapshot.achievements : {}
    await db.updateAccount(key, { achievements: JSON.stringify(mergeAchievements({}, achievements)) })
  }

  const accountFor = (db, key) =>
    lock(key, async () => {
      const found = await db.getAccount(key)
      if (found) return found
      const made = await db.createAccount(key)
      try {
        await fromLegacy(db, key)
      } catch (error) {
        console.error("[drive sync] the old online copy couldn't be converted", error)
      }
      return (await db.getAccount(key)) || made
    })

  // ---- sign in ----

  router.use(async (request, response, next) => {
    try {
      const ip = ipOf(request)
      if (badTokens.over(ip)) return json(response, 429, { ok: false, error: "Too many tries. Please wait a few minutes." })
      const token = String(request.headers.authorization || "").replace(/^Bearer\s+/i, "")
      const db = await storeReady
      let account = null
      if (/^[0-9a-f]{48}$/.test(token)) account = await sessionAccount(token)
      else if (/^[0-9a-f]{64}$/.test(token)) account = await deviceAccount(db, token)
      if (!account) {
        badTokens(ip)
        return json(response, 401, { ok: false, error: "Sign on to 98 Messenger to sync your files." })
      }
      const limited = request.method === "GET" ? reads : writes
      if (limited(account.key)) return json(response, 429, { ok: false, error: "Your files are syncing too often. Please wait a few minutes." })
      request.account = account
      request.db = db
      next()
    } catch (error) {
      next(error)
    }
  })

  // ---- devices ----

  router.post("/device", express.json({ limit: "4kb" }), async (request, response) => {
    if (request.account.via !== "session") return json(response, 403, { ok: false, error: "Sign on to 98 Messenger on this device first." })
    const { db, account } = request
    const token = crypto.randomBytes(32).toString("hex")
    const name = String(request.body?.name || "").replace(/[^\w .()'-]/g, "").slice(0, 40) || "Computer"
    const at = new Date(now())
    await db.addDevice({ hash: sha256(token), key: account.key, name, expiresAt: new Date(now() + DEVICE_DAYS * 24 * 60 * 60_000), lastSeen: at })
    const all = await db.devicesOf(account.key)
    for (const old of all.slice(0, Math.max(0, all.length - MAX_DEVICES))) await db.removeDevice(old.hash)
    json(response, 200, { ok: true, token, days: DEVICE_DAYS })
  })

  router.delete("/device", async (request, response) => {
    if (request.account.deviceHash) await request.db.removeDevice(request.account.deviceHash)
    json(response, 200, { ok: true })
  })

  // ---- reading ----

  router.get("/state", async (request, response) => {
    const { db, account } = request
    const info = await accountFor(db, account.key)
    json(response, 200, { ok: true, seq: info.seq, usage: info.usage, quota, maxFile, files: await db.countFiles(account.key) })
  })

  router.get("/changes", async (request, response) => {
    const { db, account } = request
    const since = Math.max(0, Math.floor(Number(request.query.since) || 0))
    const limit = Math.min(PAGE, Math.max(1, Math.floor(Number(request.query.limit) || PAGE)))
    await accountFor(db, account.key)
    const result = await lock(account.key, async () => {
      const info = await db.getAccount(account.key)
      const entries = await db.changes(account.key, since, limit)
      const more = entries.length === limit && entries.at(-1).rev < info.seq
      return { seq: more ? entries.at(-1).rev : info.seq, entries, more, usage: info.usage }
    })
    json(response, 200, { ok: true, quota, ...result })
  })

  router.post("/have", express.json({ limit: "64kb" }), async (request, response) => {
    const hashes = Array.isArray(request.body?.hashes) ? request.body.hashes.filter((h) => typeof h === "string" && HASH.test(h)).slice(0, PAGE) : []
    const present = await request.db.hasBlobs(request.account.key, hashes)
    json(response, 200, { ok: true, missing: hashes.filter((h) => !present.has(h)) })
  })

  router.get("/blob/:hash", async (request, response) => {
    const hash = String(request.params.hash)
    if (!HASH.test(hash)) return json(response, 400, { ok: false, error: "That isn't a file." })
    const blob = await request.db.getBlob(request.account.key, hash)
    if (!blob) return json(response, 404, { ok: false, error: "That file isn't in your online drive." })
    response.status(200).set("X-Content-Type-Options", "nosniff").type("text/plain; charset=utf-8").send(decodeBlob(blob))
  })

  // ---- writing ----

  router.put("/blob/:hash", express.text({ type: () => true, limit: Math.ceil(maxFile * 1.05) + 1024 }), async (request, response) => {
    const { db, account } = request
    const hash = String(request.params.hash)
    const text = typeof request.body === "string" ? request.body : ""
    if (!HASH.test(hash)) return json(response, 400, { ok: false, error: "That isn't a file." })
    if (text.length > maxFile) return json(response, 413, { ok: false, error: `One file can be at most ${Math.round(maxFile / MB)} MB to sync.` })
    if (contentKey(text) !== hash) return json(response, 400, { ok: false, error: "The file was damaged on the way. It will be sent again." })
    // upload volume per account
    const recent = (uploadBytes.get(account.key) || []).filter((u) => now() - u.at < WINDOW_MS)
    const sent = recent.reduce((sum, u) => sum + u.bytes, 0)
    if (sent + text.length > maxUploadBytes) return json(response, 429, { ok: false, error: "That's a lot of files at once. Sync continues in a few minutes." })
    recent.push({ at: now(), bytes: text.length })
    uploadBytes.set(account.key, recent)
    const result = await lock(account.key, async () => {
      const info = (await db.getAccount(account.key)) || (await db.createAccount(account.key))
      if ((await db.hasBlobs(account.key, [hash])).has(hash)) return { ok: true, stored: false, usage: info.usage }
      const blob = { ...encodeBlob(text), at: new Date(now()) }
      if (info.usage + blob.size > quota) return { full: true, usage: info.usage }
      if (db.totalUsage && (await db.totalUsage()) + blob.size > total) return { serverFull: true, usage: info.usage }
      await db.putBlob(account.key, hash, blob)
      return { ok: true, stored: true, usage: info.usage + blob.size }
    })
    if (result.serverFull) {
      return json(response, 413, { ok: false, full: true, usage: result.usage, quota, error: "98ish's online storage is full right now, so new files stay on this device for now. Your synced files are safe." })
    }
    if (result.full) {
      return json(response, 413, { ok: false, full: true, usage: result.usage, quota, error: `Your online drive is full (${Math.round(quota / MB)} MB). Delete some files, or sync fewer folders.` })
    }
    json(response, 200, { ok: true, stored: result.stored, usage: result.usage, quota })
  })

  // contents nothing points at any more (and old enough not to be an upload in progress)
  const sweep = async (db, key) => {
    const info = await db.getAccount(key)
    if (!info || now() - new Date(info.sweptAt).getTime() < SWEEP_MS) return
    await db.updateAccount(key, { sweptAt: new Date(now()) })
    for (const hash of await db.blobsBefore(key, new Date(now() - ORPHAN_MS))) {
      if (!(await db.hashInUse(key, hash))) await db.deleteBlob(key, hash)
    }
  }

  router.post("/push", express.json({ limit: "1mb" }), async (request, response) => {
    const { db, account } = request
    const list = Array.isArray(request.body?.changes) ? request.body.changes : null
    if (!list) return json(response, 400, { ok: false, error: "There's nothing to sync in that." })
    if (list.length > MAX_BATCH) return json(response, 400, { ok: false, error: `At most ${MAX_BATCH} changes at a time.` })
    const device = String(request.body?.device || "").replace(/[^\w .()'-]/g, "").slice(0, 40)
    await accountFor(db, account.key)
    const out = await lock(account.key, async () => {
      const results = []
      const freed = new Set()
      let entries = await db.countEntries(account.key)
      for (const raw of list) {
        const checked = checkChange(raw)
        if (checked.error) {
          results.push({ path: typeof raw?.path === "string" ? raw.path.slice(0, MAX_PATH) : "", ok: false, error: checked.error })
          continue
        }
        const change = checked.change
        const current = await db.entry(account.key, change.path)
        const currentRev = current?.rev || 0
        if (change.baseRev !== currentRev) {
          results.push({ path: change.path, ok: false, conflict: true, current })
          continue
        }
        // nothing to do: deleting what isn't there
        if (change.deleted && (!current || current.deleted)) {
          results.push({ path: change.path, ok: true, rev: currentRev })
          continue
        }
        if (!current && entries >= maxEntries) {
          results.push({ path: change.path, ok: false, error: "There are too many files to sync." })
          continue
        }
        if (change.hash && !(await db.hasBlobs(account.key, [change.hash])).has(change.hash)) {
          results.push({ path: change.path, ok: false, missing: true, error: "Its contents haven't been uploaded." })
          continue
        }
        const rev = await db.bumpSeq(account.key)
        const entry = { path: change.path, kind: change.kind, type: change.type, hash: change.hash, size: change.size, mtime: change.mtime, rev, deleted: change.deleted, device, at: new Date(now()) }
        await db.putEntry(account.key, entry)
        if (!current) entries++
        if (current?.hash && current.hash !== entry.hash) freed.add(current.hash)
        results.push({ path: change.path, ok: true, rev })
      }
      for (const hash of freed) if (!(await db.hashInUse(account.key, hash))) await db.deleteBlob(account.key, hash)
      await sweep(db, account.key)
      const info = await db.getAccount(account.key)
      return { seq: info.seq, usage: info.usage, results }
    })
    json(response, 200, { ok: true, quota, ...out })
  })

  // ---- achievements ----

  router.get("/achievements", async (request, response) => {
    const info = await accountFor(request.db, request.account.key)
    let achievements = {}
    try {
      achievements = JSON.parse(info.achievements || "{}")
    } catch {
      achievements = {}
    }
    json(response, 200, { ok: true, achievements: mergeAchievements({}, achievements) })
  })

  router.put("/achievements", express.json({ limit: "64kb" }), async (request, response) => {
    const { db, account } = request
    const incoming = request.body?.achievements
    const problem = validateAchievements(incoming)
    if (problem) return json(response, 400, { ok: false, error: problem })
    await accountFor(db, account.key)
    const merged = await lock(account.key, async () => {
      const info = await db.getAccount(account.key)
      let current = {}
      try {
        current = JSON.parse(info.achievements || "{}")
      } catch {
        current = {}
      }
      const next = mergeAchievements(current, incoming || {})
      await db.updateAccount(account.key, { achievements: JSON.stringify(next) })
      return next
    })
    json(response, 200, { ok: true, achievements: merged })
  })

  // ---- forgetting everything ----

  router.delete("/", async (request, response) => {
    const { db, account } = request
    await lock(account.key, async () => {
      await db.removeAll(account.key)
      const legacyStore = await (typeof legacy === "function" ? legacy() : legacy)
      if (legacyStore) await legacyStore.remove(account.key)
      // the account starts empty (not from the old copy) next time
      await db.createAccount(account.key)
    })
    json(response, 200, { ok: true })
  })

  // Delete My Account (../account): every synced file, its contents and device tokens, and the
  // old whole-drive copy, with nothing made again (unlike DELETE / above)
  router.eraseAccount = async ({ key }) => {
    const db = await storeReady
    await lock(key, async () => {
      await db.removeAll(key)
      const legacyStore = await (typeof legacy === "function" ? legacy() : legacy)
      if (legacyStore) await legacyStore.remove(key)
    })
    uploadBytes.delete(key)
    return { files: "deleted" }
  }

  router.use((request, response) => json(response, 404, { ok: false, error: "Not found." }))

  // always answer in JSON
  router.use((error, request, response, next) => {
    if (response.headersSent) return next(error)
    if (error.type === "entity.too.large") return json(response, 413, { ok: false, error: `One file can be at most ${Math.round(maxFile / MB)} MB to sync.` })
    if (error.type === "entity.parse.failed") return json(response, 400, { ok: false, error: "That isn't something to sync." })
    console.error("[drive sync] request failed", error)
    json(response, 500, { ok: false, error: "File sync is unavailable right now. Your files are safe on your device; sync will try again." })
  })

  return router
}

module.exports = { syncRouter, contentKey, pathProblem, mergeAchievements }
