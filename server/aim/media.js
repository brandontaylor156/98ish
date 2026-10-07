// Pictures and voice messages in 98 Messenger IMs. The bytes go to the same online storage
// bucket as synced files (Vercel Blob; ../drive/bucket.js), under their own names
// m/<HMAC of the sender's account>/<id>, sent and fetched by the devices themselves with
// short-lived signed URLs (the server never carries them). MongoDB keeps a small record per
// file (collection `immedia`):
//
//   { _id: id (20 hex), k: sender's key ("" once their account is deleted), kind: "image" |
//     "audio", mime, z: bytes, w, h, d (seconds), wf (waveform), path, pending (until the
//     upload is checked), at, x: expires (Date), a: [keys allowed to fetch it: the sender and
//     whoever it was sent to] }
//
// FREE ONLY, inside the bucket's budgets (bucket.js counts every operation before it
// happens): pictures and voice messages may use at most MSG_MEDIA_SHARE (default 0.5) of each
// monthly budget, so file sync always keeps the other half. Each one sent costs an upload
// (advanced op) and a size check (simple op); each first view on a device costs a download
// (simple op + its bytes; devices keep what they fetched). Also:
//   MSG_MEDIA_QUOTA_MB  50    per account, what it sent in the last MSG_MEDIA_DAYS
//   MSG_MEDIA_TOTAL_MB  200   everyone together (and the bucket's total with synced files)
//   MSG_MEDIA_DAYS      90    then the file is deleted and the message says "expired"
// With no bucket, or a budget used up, nothing is sent and the person reads "Picture couldn't
// be sent: online storage is resting" (texts keep working).

const crypto = require("node:crypto")
const mongoose = require("mongoose")

const MB = 1024 * 1024
const DAY = 86_400_000
const RESERVE_MS = 30 * 60_000
// (model: a 3D model from 3D Viewer 98, a .glb shrunk on the device to fit; kept as t: title, tr: triangles)
const MAX_BYTES = { image: 900 * 1024, audio: 1.5 * MB, model: 2 * MB }
const AUDIO_MIME = /^audio\/(mp4|webm|ogg|aac|mpeg|x-m4a)$/
const SCOPE = "media"

const envNum = (env, name, fallback) => {
  const value = Number(env[name])
  return Number.isFinite(value) && value > 0 && env[name] !== "" && env[name] !== undefined ? value : fallback
}

// ---------- records ----------

const memoryMediaStore = () => {
  const recs = new Map()
  const copy = (r) => (r ? structuredClone(r) : null)
  const live = (r, now) => new Date(r.x).getTime() > now.getTime()
  return {
    kind: "memory",
    reserve: async (rec) => void recs.set(rec._id, structuredClone(rec)),
    get: async (id) => copy(recs.get(id)),
    update: async (id, patch) => void (recs.has(id) && Object.assign(recs.get(id), structuredClone(patch))),
    allow: async (id, keys) => {
      const r = recs.get(id)
      if (r) r.a = [...new Set([...r.a, ...keys])]
    },
    usageOf: async (key, now) => [...recs.values()].filter((r) => r.k === key && live(r, now)).reduce((s, r) => s + r.z, 0),
    total: async (now) => [...recs.values()].filter((r) => live(r, now)).reduce((s, r) => s + r.z, 0),
    expired: async (now, limit) => [...recs.values()].filter((r) => !live(r, now)).slice(0, limit).map(copy),
    remove: async (ids) => ids.forEach((id) => recs.delete(id)),
    ownedBy: async (key) => [...recs.values()].filter((r) => r.k === key).map(copy),
    pullAccess: async (key) => {
      for (const r of recs.values()) r.a = r.a.filter((k) => k !== key)
    },
    orphans: async () => [...recs.values()].filter((r) => !r.k && !r.a.length).map(copy),
  }
}

const mongoMediaStore = (connection) => {
  const Media = connection.collection("immedia")
  Media.createIndex({ k: 1 }).catch(() => {})
  Media.createIndex({ x: 1 }).catch(() => {})
  Media.createIndex({ a: 1 }).catch(() => {})
  const sum = async (match) => (await Media.aggregate([{ $match: match }, { $group: { _id: null, n: { $sum: "$z" } } }]).toArray())[0]?.n || 0
  return {
    kind: "mongodb",
    reserve: (rec) => Media.insertOne(rec),
    get: (id) => Media.findOne({ _id: id }),
    update: (id, patch) => Media.updateOne({ _id: id }, { $set: patch }),
    allow: (id, keys) => Media.updateOne({ _id: id }, { $addToSet: { a: { $each: keys } } }),
    usageOf: (key, now) => sum({ k: key, x: { $gt: now } }),
    total: (now) => sum({ x: { $gt: now } }),
    expired: (now, limit) => Media.find({ x: { $lte: now } }).limit(limit).toArray(),
    remove: (ids) => Media.deleteMany({ _id: { $in: ids } }),
    ownedBy: (key) => Media.find({ k: key }).toArray(),
    pullAccess: (key) => Media.updateMany({ a: key }, { $pull: { a: key } }),
    orphans: () => Media.find({ k: "", a: { $size: 0 } }).toArray(),
  }
}

const createMediaStore = async (uri = process.env.MONGODB_URI) => {
  if (!uri) return memoryMediaStore()
  const connection = await mongoose.createConnection(uri, { maxPoolSize: 2 }).asPromise()
  return mongoMediaStore(connection)
}

// ---------- the service ----------

// storage: () -> promise of { bucket, adapter, syncedBytes() } (file sync's bucket) or null
const createMedia = ({ store, storage = async () => null, env = process.env, now = () => Date.now(), log = console, background = true } = {}) => {
  const quota = envNum(env, "MSG_MEDIA_QUOTA_MB", 50) * MB
  const total = envNum(env, "MSG_MEDIA_TOTAL_MB", 200) * MB
  const days = envNum(env, "MSG_MEDIA_DAYS", 90)
  const share = Math.min(1, envNum(env, "MSG_MEDIA_SHARE", 0.5))
  const storeReady = Promise.resolve(store || createMediaStore())
  storeReady.catch((error) => log.error?.("[aim media] store failed", error.message))
  const sends = new Map() // key -> [times] (60 an hour)
  let registered = null

  const bucketOf = async () => {
    let s = null
    try {
      s = await storage()
    } catch {
      s = null
    }
    if (s && registered !== s.bucket) {
      registered = s.bucket
      const db = await storeReady
      s.bucket.addStored(() => db.total(new Date(now())))
    }
    return s
  }

  const resting = (until) => ({ ok: false, resting: true, ...(until ? { until: new Date(until).toISOString() } : {}) })
  const tooFast = (key) => {
    const recent = (sends.get(key) || []).filter((t) => now() - t < 60 * 60_000)
    if (recent.length >= 60) return true
    recent.push(now())
    sends.set(key, recent)
    return false
  }

  // -> { ok, id, url, method, headers } | { ok: false, error | resting }
  const upload = async (key, info = {}) => {
    const kind = info.kind === "audio" ? "audio" : info.kind === "image" ? "image" : info.kind === "model" ? "model" : null
    const mime = String(info.mime || "").split(";")[0].trim().toLowerCase()
    const size = Number(info.size)
    if (!kind || (kind === "image" ? mime !== "image/jpeg" : kind === "model" ? mime !== "model/gltf-binary" : !AUDIO_MIME.test(mime))) return { ok: false, error: "That kind of file can't be sent." }
    if (!Number.isInteger(size) || size <= 0) return { ok: false, error: "That file is empty." }
    if (size > MAX_BYTES[kind]) return { ok: false, error: kind === "image" ? "That picture is too big to send." : kind === "model" ? "That 3D model is too big to send." : "That voice message is too long to send." }
    const num = (v, max) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)))
    const meta =
      kind === "image"
        ? { w: num(info.w, 4096), h: num(info.h, 4096) }
        : kind === "model"
          ? { t: String(info.title || "3D model").replace(/[\u0000-\u001f]/g, "").slice(0, 40), tr: num(info.tris, 1e6) }
          : { d: num(info.d, 61), wf: /^[0-9]{1,64}$/.test(String(info.wf || "")) ? String(info.wf) : "" }
    if (tooFast(key)) return { ok: false, error: "That's a lot of pictures and voice messages at once. Try again in a little while." }
    const s = await bucketOf()
    if (!s) return resting(null)
    const { bucket, adapter } = s
    const db = await storeReady
    const until = await bucket.restingUntil()
    if (until) return resting(until)
    const at = new Date(now())
    if ((await db.usageOf(key, at)) + size > quota) {
      return { ok: false, full: true, error: `You've sent ${Math.round(quota / MB)} MB of pictures and voice messages in the last ${days} days. Older ones expire and make room.` }
    }
    const mediaTotal = await db.total(at)
    if (mediaTotal + size > total || (await s.syncedBytes()) + (await bucket.otherBytes()) + size > bucket.totalBytes) return resting(null)
    const charged = await bucket.charge(adapter.costs.put, { scope: SCOPE, share })
    if (!charged.ok) return resting(charged.until)
    const id = crypto.randomBytes(10).toString("hex")
    const path = `m/${bucket.prefixFor(key).slice(2)}${id}`
    await db.reserve({ _id: id, k: key, kind, mime, z: size, ...meta, path, pending: true, at, x: new Date(now() + RESERVE_MS), a: [key] })
    const ticket = await bucket.call(() => adapter.presignPut(path, size))
    return { ok: true, id, url: ticket.url, method: ticket.method, headers: ticket.headers }
  }

  // the device says the upload is done: the bucket must hold exactly that many bytes
  const commit = async (key, id) => {
    const db = await storeReady
    const rec = typeof id === "string" ? await db.get(id) : null
    if (!rec || rec.k !== key) return { ok: false, error: "That upload wasn't started." }
    if (!rec.pending) return { ok: true }
    const s = await bucketOf()
    if (!s) return resting(null)
    const charged = await s.bucket.charge(s.adapter.costs.head, { scope: SCOPE, share })
    if (!charged.ok) return resting(charged.until)
    const found = await s.bucket.call(() => s.adapter.head(rec.path))
    if (!found || found.size !== rec.z) {
      if (found) await s.bucket.call(() => s.adapter.del([rec.path])).catch(() => {})
      await db.remove([id])
      return { ok: false, error: "The file didn't arrive. Please try again." }
    }
    await db.update(id, { pending: false, x: new Date(now() + days * DAY) })
    return { ok: true }
  }

  // an IM carries it to `keys`: they may fetch it too. -> what the message keeps, or null
  const attach = async (key, id, keys) => {
    const db = await storeReady
    const rec = typeof id === "string" && /^[0-9a-f]{20}$/.test(id) ? await db.get(id) : null
    if (!rec || rec.k !== key || rec.pending || new Date(rec.x).getTime() <= now()) return null
    await db.allow(id, keys)
    if (rec.kind === "model") return { id, k: "model", t: rec.t || "3D model", tr: rec.tr || 0, z: rec.z }
    return rec.kind === "image" ? { id, k: "image", w: rec.w, h: rec.h, z: rec.z } : { id, k: "audio", d: rec.d, wf: rec.wf || "", z: rec.z }
  }

  // a signed URL to fetch it (5 minutes) -> { ok, url, mime, size } | { ok: false, expired | resting | error }
  const url = async (key, id) => {
    const db = await storeReady
    const rec = typeof id === "string" && /^[0-9a-f]{20}$/.test(id) ? await db.get(id) : null
    if (!rec || !rec.a.includes(key)) return { ok: false, expired: true }
    if (rec.pending) return { ok: false, error: "That file is still being sent." }
    if (new Date(rec.x).getTime() <= now()) return { ok: false, expired: true }
    const s = await bucketOf()
    if (!s) return resting(null)
    const charged = await s.bucket.charge({ ...s.adapter.costs.get, down: rec.z }, { scope: SCOPE, share })
    if (!charged.ok) return resting(charged.until)
    return { ok: true, url: await s.bucket.call(() => s.adapter.presignGet(rec.path)), mime: rec.mime, size: rec.z }
  }

  const dropObjects = async (recs) => {
    if (!recs.length) return
    const s = await bucketOf()
    const paths = recs.map((r) => r.path).filter(Boolean)
    if (s && paths.length) {
      s.bucket.note({ del: paths.length })
      await s.bucket.call(() => s.adapter.del(paths))
    }
    await (await storeReady).remove(recs.map((r) => r._id))
  }

  // expired files (and uploads never finished) are deleted (deleting is free)
  const maintain = async () => {
    const db = await storeReady
    const old = await db.expired(new Date(now()), 200)
    await dropObjects(old)
    return { removed: old.length }
  }

  // Delete My Account: what they sent goes, unless someone they sent it to can still see it
  // (theirs, like received mail: kept until it expires, no longer tied to the account);
  // what they received is no longer theirs to fetch
  const eraseAccount = async ({ key }) => {
    const db = await storeReady
    const owned = await db.ownedBy(key)
    const gone = []
    let kept = 0
    for (const rec of owned) {
      const others = rec.a.filter((k) => k !== key)
      if (others.length && !rec.pending && new Date(rec.x).getTime() > now()) {
        await db.update(rec._id, { k: "", a: others })
        kept++
      } else gone.push(rec)
    }
    await dropObjects(gone)
    await db.pullAccess(key)
    await dropObjects(await db.orphans())
    sends.delete(key)
    return { deleted: gone.length, keptForOthers: kept }
  }

  if (background) {
    const tick = async () => {
      try {
        await maintain()
      } catch (error) {
        log.error?.("[aim media] upkeep failed", error.message)
      }
      setTimeout(tick, 30 * 60_000).unref?.()
    }
    setTimeout(tick, 60_000).unref?.()
  }

  return { upload, commit, attach, url, maintain, eraseAccount, getStore: () => storeReady, limits: { quota, total, days, share } }
}

module.exports = { createMedia, createMediaStore, memoryMediaStore, MAX_BYTES }
