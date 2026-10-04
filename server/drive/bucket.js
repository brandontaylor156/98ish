// Where synced file contents live when an online storage bucket is set up: devices upload and
// download them directly with short-lived signed URLs, and MongoDB keeps only the records (see
// sync.js). Two kinds of bucket, chosen by env:
//
//   Vercel Blob (primary)   BLOB_READ_WRITE_TOKEN (a private store's read-write token)
//   S3-compatible (option)  BLOB_S3_ENDPOINT, BLOB_S3_BUCKET, BLOB_S3_KEY_ID, BLOB_S3_SECRET
//                           (+ BLOB_S3_REGION, else read from the endpoint), e.g. Backblaze B2
//
// With neither, contents stay in MongoDB exactly as before.
//
// FREE ONLY. Every operation the bucket would bill is counted here before it happens, in
// MongoDB (collection `blobusage`, one small document per UTC day, so the counts survive
// restarts), and refused once a budget is used up: the person sees "Online storage is resting
// until <date>" and their files stay on their device. The budgets sit well under the free
// allowances (defaults below; every number can be lowered or raised by env):
//
//   Vercel Blob, Hobby (https://vercel.com/docs/vercel-blob/usage-and-pricing, 2026-09-23):
//   per month 1 GB stored (monthly average), 10,000 simple operations (head, and a GET that
//   misses the cache), 2,000 advanced operations (put, copy, list), 10 GB data transfer;
//   del is free. Past them a Hobby store stops working for up to 30 days, and the website's
//   own Vercel allowances are shared, so we never get near:
//     stored, all accounts      750 MB      BLOB_TOTAL_MB
//     advanced ops, 31 days     1,400       BLOB_MONTHLY_ADVANCED_OPS   (each upload URL, list page, signing token)
//     simple ops, 31 days       7,000       BLOB_MONTHLY_SIMPLE_OPS     (each download URL issued, each head)
//     downloads, 31 days        6 GB        BLOB_MONTHLY_DOWNLOAD_MB
//   A rolling 31-day window (not the calendar month): Vercel's billing month may start on any
//   day, and any 30-31 days in a row stay under the budget this way.
//
//   Backblaze B2 (https://www.backblaze.com/cloud-storage/pricing,
//   https://www.backblaze.com/cloud-storage/transaction-pricing, read 2026-10-04): 10 GB
//   stored free, egress free up to 3x the average stored, Class A/B/C calls free on
//   pay-as-you-go; accounts without a card have long had daily free caps of 1 GB download
//   and 2,500 Class B (download/head) and 2,500 Class C (list) calls, which B2 resets at
//   00:00 UTC. We stay under the stricter of the two:
//     stored 8 GB; per UTC day 2,000 head/download URLs, 2,000 list pages, 800 MB downloads;
//     15 GB downloads per 31 days. (Also set B2's own Caps & Alerts to $0.)
//
// Background jobs (moving old MongoDB contents, checking moved copies, tidying the bucket) may
// use only 70% of each budget, so people syncing always have room.
//
// Signed URLs are counted when issued (a URL that's never used still counts: conservative).
// If the bucket itself says its limits are reached (Vercel: store suspended; B2: 403 "cap
// exceeded"), everything rests for a day (kept in `blobusage` too).

const crypto = require("node:crypto")

const MB = 1024 * 1024
const DAY = 24 * 60 * 60_000
const TYPE = "application/octet-stream" // every object; the real type is in the record
const WINDOW = 31

const envNum = (env, name, fallback) => {
  const value = Number(env[name])
  return Number.isFinite(value) && value >= 0 && env[name] !== "" && env[name] !== undefined ? value : fallback
}

const dayOf = (t) => new Date(t).toISOString().slice(0, 10)
const dayStart = (day) => Date.parse(`${day}T00:00:00Z`)

class Resting extends Error {
  constructor(until, reason = "") {
    super(`Online storage is resting until ${new Date(until).toISOString()}`)
    this.resting = true
    this.until = until
    this.reason = reason
  }
}

// ---------- Vercel Blob ----------

const vercelAdapter = ({ token, env = process.env, maxBytes, onOp = () => {} }) => {
  // the SDK retries failed calls up to 10 times; each try may count, so fewer
  if (!process.env.VERCEL_BLOB_RETRIES) process.env.VERCEL_BLOB_RETRIES = "2"
  const blob = require("@vercel/blob")
  const storeId = String(token).split("_")[3] || ""
  const origin = `https://${storeId}.private.blob.vercel-storage.com`
  // tests serve the store from a fake (the SDK reads VERCEL_BLOB_API_URL for its API calls)
  const storeUrl = String(env.BLOB_STORE_URL || origin).replace(/\/+$/, "")
  const rewrite = (url) => (url.startsWith(origin) ? storeUrl + url.slice(origin.length) : url)
  const urlOf = (pathname) => `${origin}/${pathname}`
  let signing = null

  // one signing token for a week (asking for it is a call to Vercel's API)
  const signer = async () => {
    if (signing && signing.validUntil - Date.now() > 60 * 60_000) return signing
    onOp({ adv: 1 })
    signing = await blob.issueSignedToken({ token, pathname: "*", operations: ["get", "put"], validUntil: Date.now() + 7 * DAY - 60_000, allowedContentTypes: [TYPE], maximumSizeInBytes: maxBytes })
    return signing
  }

  return {
    kind: "vercel",
    name: "Vercel Blob",
    costs: { put: { adv: 1 }, head: { simple: 1 }, get: { simple: 1 }, list: { adv: 1 }, del: {} },
    budgets: (e) => ({
      totalBytes: envNum(e, "BLOB_TOTAL_MB", 750) * MB,
      rules: [
        { field: "adv", days: WINDOW, limit: envNum(e, "BLOB_MONTHLY_ADVANCED_OPS", 1400), label: "uploads" },
        { field: "simple", days: WINDOW, limit: envNum(e, "BLOB_MONTHLY_SIMPLE_OPS", 7000), label: "downloads" },
        { field: "down", days: WINDOW, limit: envNum(e, "BLOB_MONTHLY_DOWNLOAD_MB", 6 * 1024) * MB, label: "download size" },
      ],
    }),
    presignPut: async (pathname, size) => {
      const { presignedUrl } = await blob.presignUrl(await signer(), {
        operation: "put",
        pathname,
        access: "private",
        allowedContentTypes: [TYPE],
        maximumSizeInBytes: Math.max(1, size),
        addRandomSuffix: false,
        allowOverwrite: false,
        validUntil: Date.now() + 10 * 60_000,
      })
      // the headers the SDK's own browser upload sends with a presigned URL
      return { url: presignedUrl, method: "PUT", headers: { "x-api-version": "12", "x-vercel-blob-access": "private", "x-content-type": TYPE } }
    },
    presignGet: async (pathname) => {
      const { presignedUrl } = await blob.presignUrl(await signer(), { operation: "get", pathname, access: "private", validUntil: Date.now() + 5 * 60_000 })
      return rewrite(presignedUrl)
    },
    head: async (pathname) => {
      try {
        const found = await blob.head(urlOf(pathname), { token })
        return { size: Number(found.size) || 0 }
      } catch (error) {
        if (error instanceof blob.BlobNotFoundError) return null
        throw error
      }
    },
    get: async (pathname) => {
      const response = await fetch(`${storeUrl}/${pathname}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60_000) })
      if (response.status === 404) return null
      if (!response.ok) {
        const text = await response.text().catch(() => "")
        if (/store_suspended|suspended/i.test(text)) throw new blob.BlobStoreSuspendedError()
        throw Object.assign(new Error(`Vercel Blob GET ${response.status}`), { status: response.status })
      }
      return Buffer.from(await response.arrayBuffer())
    },
    put: async (pathname, body) => {
      await blob.put(pathname, body, { token, access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: TYPE })
    },
    del: async (pathnames) => {
      for (let i = 0; i < pathnames.length; i += 100) await blob.del(pathnames.slice(i, i + 100).map(urlOf), { token })
    },
    list: async ({ prefix, cursor } = {}) => {
      const page = await blob.list({ token, prefix, cursor: cursor || undefined, limit: 1000 })
      return { items: page.blobs.map((b) => ({ pathname: b.pathname, size: b.size, at: new Date(b.uploadedAt).getTime() })), cursor: page.hasMore ? page.cursor : "" }
    },
    limitError: (error) => error instanceof blob.BlobStoreSuspendedError,
  }
}

// ---------- S3-compatible (Backblaze B2) ----------

const s3Adapter = ({ env = process.env }) => {
  const { createS3 } = require("./s3")
  const s3 = createS3({ endpoint: env.BLOB_S3_ENDPOINT, region: env.BLOB_S3_REGION, bucket: env.BLOB_S3_BUCKET, keyId: env.BLOB_S3_KEY_ID, secret: env.BLOB_S3_SECRET })
  return {
    kind: "s3",
    name: "S3 bucket",
    // B2: uploads and deletes are Class A (free); head/get Class B; list Class C
    costs: { put: {}, head: { simple: 1 }, get: { simple: 1 }, list: { adv: 1 }, del: {} },
    budgets: (e) => ({
      totalBytes: envNum(e, "BLOB_TOTAL_MB", 8 * 1024) * MB,
      rules: [
        { field: "simple", days: 1, limit: envNum(e, "BLOB_DAILY_SIMPLE_OPS", 2000), label: "downloads" },
        { field: "adv", days: 1, limit: envNum(e, "BLOB_DAILY_ADVANCED_OPS", 2000), label: "listing" },
        { field: "down", days: 1, limit: envNum(e, "BLOB_DAILY_DOWNLOAD_MB", 800) * MB, label: "download size" },
        { field: "down", days: WINDOW, limit: envNum(e, "BLOB_MONTHLY_DOWNLOAD_MB", 15 * 1024) * MB, label: "download size" },
      ],
    }),
    presignPut: async (pathname, size) => ({
      url: s3.presign("PUT", pathname, { expires: 600, headers: { "content-type": TYPE, "content-length": String(size) } }),
      method: "PUT",
      headers: { "Content-Type": TYPE },
    }),
    presignGet: async (pathname) => s3.presign("GET", pathname, { expires: 300 }),
    head: async (pathname) => {
      const found = await s3.head(pathname)
      return found && { size: found.size }
    },
    get: (pathname) => s3.get(pathname),
    put: (pathname, body) => s3.put(pathname, body, TYPE),
    del: (pathnames) => s3.deleteMany(pathnames),
    list: async ({ prefix, cursor } = {}) => {
      const page = await s3.list({ prefix, token: cursor })
      return { items: page.items.map((i) => ({ pathname: i.key, size: i.size, at: Date.parse(i.lastModified) || 0 })), cursor: page.next }
    },
    // B2 answers 403 "cap exceeded"; HEAD has no body, so any 403 on it counts too
    limitError: (error) => !!error?.capped || (error?.status === 403 && !error.code),
  }
}

// Which bucket the env sets up (or null: contents stay in MongoDB)
const adapterFromEnv = ({ env = process.env, maxBytes, onOp } = {}) => {
  if (env.BLOB_READ_WRITE_TOKEN) return vercelAdapter({ token: env.BLOB_READ_WRITE_TOKEN, env, maxBytes, onOp })
  if (env.BLOB_S3_ENDPOINT && env.BLOB_S3_BUCKET && env.BLOB_S3_KEY_ID && env.BLOB_S3_SECRET) return s3Adapter({ env })
  return null
}

// ---------- the budget ----------

// db: the sync store's usage methods (usageDays, usageInc, usageGet, usageSet)
const createBucket = ({ adapter, db, env = process.env, now = () => Date.now(), log = console, secret } = {}) => {
  const { totalBytes, rules } = adapter.budgets(env)
  const prefixKey = secret || env.BLOB_KEY_SECRET || crypto.createHash("sha256").update(`98ish-blob-prefix:${env.BLOB_READ_WRITE_TOKEN || env.BLOB_S3_SECRET || ""}`).digest("hex")
  const prefixFor = (accountKey) => `u/${crypto.createHmac("sha256", prefixKey).update(String(accountKey)).digest("hex").slice(0, 24)}/`
  const pathFor = (accountKey, hash) => `${prefixFor(accountKey)}${hash}`
  let queue = Promise.resolve()
  const serial = (fn) => {
    const run = queue.then(fn, fn)
    queue = run.catch(() => {})
    return run
  }
  let restCache = null

  const restingUntil = async () => {
    if (!restCache || now() - restCache.read > 60_000) restCache = { read: now(), doc: await db.usageGet("rest") }
    const until = Number(restCache.doc?.until) || 0
    return until > now() ? until : 0
  }

  // the bucket said its limits are reached: rest a day
  const rest = async (reason) => {
    const until = dayStart(dayOf(now() + DAY)) + 60_000
    restCache = { read: now(), doc: { until, reason } }
    await db.usageSet("rest", { until, reason, at: new Date(now()) })
    log.warn?.(`[drive sync] online storage says its limits are reached (${reason}); resting until ${new Date(until).toISOString()}`)
    return until
  }

  const windowDays = async () => {
    const from = dayOf(now() - (Math.max(...rules.map((r) => r.days), 1) - 1) * DAY)
    return (await db.usageDays(from)).sort((a, b) => (a.day < b.day ? -1 : 1))
  }

  // when enough of the window has passed for `cost` to fit
  const untilFits = (rule, days, cost) => {
    const today = dayOf(now())
    const inWindow = days.filter((d) => d.day > dayOf(now() - rule.days * DAY) && d.day <= today)
    let sum = inWindow.reduce((s, d) => s + (Number(d[rule.field]) || 0), 0)
    for (const d of inWindow) {
      sum -= Number(d[rule.field]) || 0
      if (sum + cost <= rule.limit) return dayStart(d.day) + rule.days * DAY
    }
    return dayStart(today) + rule.days * DAY
  }

  // Count `cost` ({ simple, adv, down }) if it fits every budget. -> { ok } | { ok: false, until, label }
  const charge = (cost, { background = false } = {}) =>
    serial(async () => {
      const until = await restingUntil()
      if (until) return { ok: false, until, label: "rest" }
      const days = await windowDays()
      for (const rule of rules) {
        const amount = Number(cost[rule.field]) || 0
        if (!amount) continue
        const from = dayOf(now() - (rule.days - 1) * DAY)
        const used = days.filter((d) => d.day >= from).reduce((s, d) => s + (Number(d[rule.field]) || 0), 0)
        const limit = background ? Math.floor(rule.limit * 0.7) : rule.limit
        if (used + amount > limit) return { ok: false, until: untilFits({ ...rule, limit }, days, amount), label: rule.label }
      }
      await db.usageInc(dayOf(now()), cost)
      return { ok: true }
    })

  // counted without asking (signing tokens, deletes, uploads already made)
  const note = (cost) => serial(() => db.usageInc(dayOf(now()), cost)).catch(() => {})

  // run a bucket call; its "limits reached" answer becomes a Resting error
  const call = async (fn) => {
    try {
      return await fn()
    } catch (error) {
      if (adapter.limitError(error)) throw new Resting(await rest(error.message || "limits reached"), "bucket")
      throw error
    }
  }

  const status = async (storedBytes) => {
    const days = await windowDays()
    const until = await restingUntil()
    return {
      bucket: adapter.kind,
      stored: storedBytes,
      storedCap: totalBytes,
      resting: until ? new Date(until).toISOString() : null,
      budgets: rules.map((rule) => {
        const from = dayOf(now() - (rule.days - 1) * DAY)
        return { what: rule.field, days: rule.days, used: days.filter((d) => d.day >= from).reduce((s, d) => s + (Number(d[rule.field]) || 0), 0), limit: rule.limit }
      }),
    }
  }

  return { adapter, kind: adapter.kind, totalBytes, rules, prefixFor, pathFor, charge, note, call, rest, restingUntil, status }
}

module.exports = { createBucket, adapterFromEnv, vercelAdapter, s3Adapter, Resting, TYPE, dayOf }
