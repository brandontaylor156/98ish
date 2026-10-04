// What Compass's relay keeps about signed-on people, for answering abuse complaints, and the
// pages people report. Nothing else (no paths, no query strings, no page contents).
//
//   weblog      { account, host, day, bytes }   one row per account, site and UTC day: how many
//                                               bytes the relay brought that account from that
//                                               host. Kept 7 days after the day (TTL index on
//                                               expiresAt). Guests aren't logged: they can only
//                                               reach the allowlist (Wikipedia and friends).
//   webreports  { account, guest, host, url,    "Report This Page" in Compass (Tools menu): the
//                 note, time }                  page someone reported and their note. Kept 90
//                                               days (TTL). Nobody is notified; the owner reads
//                                               them with a MongoDB query (see CLAUDE.md).
//
// Delete My Account removes the account's rows from both (eraseAccount). Without MONGODB_URI
// both live in memory.
//
// Log bytes are added up in memory and written every few seconds as one bulk $inc (like the
// usage counters), so a relayed chunk never waits for the database.

const DAY_MS = 24 * 3600 * 1000
const LOG_DAYS = 7
const REPORT_DAYS = 90

const dayOf = (t) => new Date(t).toISOString().slice(0, 10)
// a day's rows go 7 days after that day ends
const logExpiry = (day) => new Date(Date.parse(`${day}T00:00:00Z`) + (LOG_DAYS + 1) * DAY_MS)

const memoryRecordsStore = () => {
  const log = new Map() // _id -> row
  const reports = []
  return {
    kind: "memory",
    log,
    reports,
    incLog: async (rows) => {
      for (const r of rows) {
        const id = `${r.account}|${r.host}|${r.day}`
        const row = log.get(id) || { account: r.account, host: r.host, day: r.day, bytes: 0, expiresAt: r.expiresAt }
        row.bytes += r.bytes
        log.set(id, row)
      }
    },
    addReport: async (report) => {
      reports.push({ ...report })
    },
    findLog: async (account) => [...log.values()].filter((r) => r.account === account).map((r) => ({ ...r })),
    findReports: async (account) => reports.filter((r) => r.account === account).map((r) => ({ ...r })),
    eraseAccount: async (account) => {
      let rows = 0
      for (const [id, r] of log) if (r.account === account) log.delete(id), rows++
      let removed = 0
      for (let i = reports.length - 1; i >= 0; i--) if (reports[i].account === account) reports.splice(i, 1), removed++
      return { log: rows, reports: removed }
    },
    // TTL indexes do this in MongoDB
    expire: (now = Date.now()) => {
      for (const [id, r] of log) if (r.expiresAt.getTime() <= now) log.delete(id)
      for (let i = reports.length - 1; i >= 0; i--) if (reports[i].expiresAt.getTime() <= now) reports.splice(i, 1)
    },
  }
}

const mongoRecordsStore = (uri) => {
  const mongoose = require("mongoose")
  let models = null
  let connecting = null
  const connect = () =>
    (connecting ??= (async () => {
      const connection = await mongoose.createConnection(uri, { maxPoolSize: 2, serverSelectionTimeoutMS: 8000, bufferCommands: false }).asPromise()
      const logSchema = new mongoose.Schema({ _id: String, account: String, host: String, day: String, bytes: Number, expiresAt: Date }, { versionKey: false, collection: "weblog", bufferCommands: false })
      logSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })
      logSchema.index({ account: 1 })
      const reportSchema = new mongoose.Schema({ account: String, guest: Boolean, host: String, url: String, note: String, time: Date, expiresAt: Date }, { versionKey: false, collection: "webreports", bufferCommands: false })
      reportSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })
      reportSchema.index({ account: 1 })
      const Log = connection.model("WebLog", logSchema)
      const Report = connection.model("WebReport", reportSchema)
      await Promise.all([Log.init(), Report.init()]).catch(() => {})
      models = { Log, Report }
      return models
    })().catch((error) => {
      connecting = null
      throw error
    }))
  const m = async () => models || connect()
  return {
    kind: "mongo",
    incLog: async (rows) => {
      const { Log } = await m()
      await Log.bulkWrite(
        rows.map((r) => ({
          updateOne: {
            filter: { _id: `${r.account}|${r.host}|${r.day}` },
            update: { $inc: { bytes: r.bytes }, $setOnInsert: { account: r.account, host: r.host, day: r.day, expiresAt: r.expiresAt } },
            upsert: true,
          },
        })),
        { ordered: false }
      )
    },
    addReport: async (report) => {
      const { Report } = await m()
      await Report.create(report)
    },
    findLog: async (account) => (await m()).Log.find({ account }).lean(),
    findReports: async (account) => (await m()).Report.find({ account }).lean(),
    eraseAccount: async (account) => {
      const { Log, Report } = await m()
      const [a, b] = await Promise.all([Log.deleteMany({ account }), Report.deleteMany({ account })])
      return { log: a.deletedCount || 0, reports: b.deletedCount || 0 }
    },
  }
}

const createRecords = ({ store = memoryRecordsStore(), flushMs = 10000, now = Date.now, log = console } = {}) => {
  const pending = new Map() // "account|host|day" -> bytes
  let timer = null
  let lastError = 0

  // n bytes relayed to `account` from `host` (a host name only: never a path)
  const logBytes = (account, host, n) => {
    if (!account || !host || !(n > 0)) return
    const k = `${account}|${String(host).toLowerCase().slice(0, 253)}|${dayOf(now())}`
    pending.set(k, (pending.get(k) || 0) + n)
  }

  const flush = async () => {
    if (!pending.size) return 0
    const rows = [...pending].map(([k, bytes]) => {
      const [account, host, day] = k.split("|")
      return { account, host, day, bytes, expiresAt: logExpiry(day) }
    })
    pending.clear()
    try {
      await store.incLog(rows)
      return rows.length
    } catch (error) {
      // keep them for the next try
      for (const r of rows) {
        const k = `${r.account}|${r.host}|${r.day}`
        pending.set(k, (pending.get(k) || 0) + r.bytes)
      }
      if (now() - lastError > 5 * 60 * 1000) {
        lastError = now()
        log.warn?.("[web] couldn't save the relay log (will retry):", error.message)
      }
      return 0
    }
  }

  const addReport = async ({ account = null, guest = false, url, note = "" }) => {
    let parsed
    try {
      parsed = new URL(String(url || ""))
    } catch {
      return { ok: false, error: "That isn't a web address." }
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { ok: false, error: "That isn't a web address." }
    const time = new Date(now())
    await store.addReport({
      account: account || null,
      guest: !!guest,
      host: parsed.hostname.toLowerCase(),
      url: parsed.href.slice(0, 2000),
      note: String(note || "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(0, 1000),
      time,
      expiresAt: new Date(time.getTime() + REPORT_DAYS * DAY_MS),
    })
    return { ok: true }
  }

  const eraseAccount = async (account) => {
    for (const k of [...pending.keys()]) if (k.startsWith(`${account}|`)) pending.delete(k)
    return store.eraseAccount(account)
  }

  const start = () => {
    if (timer) return
    timer = setInterval(() => flush(), flushMs)
    timer.unref?.()
  }
  const stop = () => {
    clearInterval(timer)
    timer = null
  }

  return { logBytes, flush, addReport, eraseAccount, start, stop, store, pending }
}

let shared = null
// One per process: MongoDB ("weblog", "webreports") with MONGODB_URI, else memory
const defaultRecords = () => {
  if (shared) return shared
  const uri = process.env.MONGODB_URI
  shared = createRecords({ store: uri ? mongoRecordsStore(uri) : memoryRecordsStore() })
  shared.start()
  return shared
}

module.exports = { createRecords, memoryRecordsStore, mongoRecordsStore, defaultRecords, logExpiry, LOG_DAYS, REPORT_DAYS }
