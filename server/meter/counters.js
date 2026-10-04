// Counters that survive restarts (Render's free plan restarts the server often): byte budgets
// per account / guest address / day, Compass's monthly total and the whole server's monthly
// outgoing traffic (meter.js).
//
// A counter is { scope, id, window } -> n, e.g. ("day", "u:alice", "2026-10-04") or
// ("month", "server", "2026-10"). Writes go to memory first and reach the store every few
// seconds as $inc batches (write-behind), so a relayed chunk never waits for MongoDB. Reads
// come from memory once the counter has been read back from the store (value() starts that;
// ensure() waits for it). A counter that couldn't be read back has no value (null): callers
// that guard money-like limits treat that as "over" (fail closed).
//
// Consistency: $inc is commutative, so increments flushed before the read-back are simply part
// of what is read back. The one thing that must not happen is a read and a flush of the same
// counter at the same time (the read might or might not include the flush), so a counter that
// is being read is never flushed in that moment.
//
// Store interface: get(k) -> { n } | null, inc([{ k, scope, id, window, n, expiresAt }]).

const DAY_MS = 24 * 3600 * 1000

const dayOf = (t) => new Date(t).toISOString().slice(0, 10) // "2026-10-04" (UTC)
const monthOf = (t) => new Date(t).toISOString().slice(0, 7) // "2026-10" (UTC, as Render bills)
// the first moment of the next UTC month
const nextMonthStart = (t) => {
  const d = new Date(t)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))
}
// how long a window's counter is kept (the TTL index removes it afterwards)
const TTL = { day: 3 * DAY_MS, month: 70 * DAY_MS, minute: 2 * 60 * 1000 }

const createCounters = ({ store, flushMs = 5000, retryMs = 20000, idleMs = 60 * 60 * 1000, now = Date.now, log = console } = {}) => {
  if (!store) throw new Error("createCounters needs a store")
  const cells = new Map() // k -> cell
  let timer = null
  let flushing = null

  const keyOf = (scope, id, window) => `${scope}|${id}|${window}`
  const cellOf = (scope, id, window) => {
    const k = keyOf(scope, id, window)
    let c = cells.get(k)
    if (!c) {
      c = { k, scope, id: String(id), window: String(window), base: 0, pending: 0, inflight: 0, state: "new", error: null, failedAt: 0, promise: null, touched: now() }
      cells.set(k, c)
    }
    c.touched = now()
    return c
  }

  const load = (c) => {
    if (c.state === "ready") return Promise.resolve(c)
    if (c.state === "loading") return c.promise
    if (c.state === "failed" && now() - c.failedAt < retryMs) return Promise.reject(c.error)
    c.state = "loading"
    c.promise = (async () => {
      // never while this counter's own flush is on its way (see the top)
      if (flushing && c.inflight) await flushing.catch(() => {})
      try {
        const doc = await store.get(c.k)
        c.base = Number(doc?.n) || 0
        c.state = "ready"
        c.error = null
        return c
      } catch (error) {
        c.state = "failed"
        c.failedAt = now()
        c.error = error
        throw error
      }
    })()
    c.promise.catch(() => {})
    return c.promise
  }

  // n more for this counter (written to the store with the next flush)
  const add = (scope, id, window, n) => {
    if (!(n > 0)) return
    cellOf(scope, id, window).pending += n
  }

  // the counter's value, or null until it has been read back from the store (reading starts)
  const value = (scope, id, window) => {
    const c = cellOf(scope, id, window)
    if (c.state !== "ready") {
      load(c).catch(() => {})
      return null
    }
    return c.base + c.inflight + c.pending
  }

  // wait until these counters are read back: [[scope, id, window], ...]; throws when the store
  // can't be reached
  const ensure = async (list) => {
    await Promise.all(list.map(([scope, id, window]) => load(cellOf(scope, id, window))))
  }

  const flushOnce = async () => {
    const batch = []
    for (const c of cells.values()) {
      if (!c.pending || c.state === "loading") continue
      c.inflight = c.pending
      c.pending = 0
      const ttl = TTL[c.scope] || 70 * DAY_MS
      batch.push({ c, op: { k: c.k, scope: c.scope, id: c.id, window: c.window, n: c.inflight, expiresAt: new Date(now() + ttl) } })
    }
    if (!batch.length) return 0
    try {
      await store.inc(batch.map((b) => b.op))
      for (const { c } of batch) {
        // a counter that was read back gets it in its base; one that wasn't will read it back
        if (c.state === "ready") c.base += c.inflight
        c.inflight = 0
      }
      return batch.length
    } catch (error) {
      for (const { c } of batch) {
        c.pending += c.inflight
        c.inflight = 0
      }
      throw error
    }
  }

  let lastError = 0
  const flush = async () => {
    if (flushing) await flushing.catch(() => {})
    flushing = flushOnce()
    try {
      return await flushing
    } catch (error) {
      if (now() - lastError > 5 * 60 * 1000) {
        lastError = now()
        log.warn?.("[usage] couldn't save usage counters (will retry):", error.message)
      }
      return 0
    } finally {
      flushing = null
      sweep()
    }
  }

  // forget counters nobody has used for a while (they are read back again when needed)
  const sweep = () => {
    const t = now()
    for (const [k, c] of cells) if (!c.pending && !c.inflight && c.state !== "loading" && t - c.touched > idleMs) cells.delete(k)
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

  // delete every counter of this id (Delete My Account: "u:<account>"), in memory and stored
  const forget = async (id) => {
    for (const [k, c] of cells) if (c.id === String(id)) cells.delete(k)
    // a write already on its way lands first, then everything of this id goes
    if (flushing) await flushing.catch(() => {})
    return store.removeId ? store.removeId(String(id)) : 0
  }

  return { add, value, ensure, flush, forget, start, stop, store, cells, kind: store.kind }
}

// ---------- stores ----------

// In memory: pass the same `data` Map to a second createCounters to act like a restart
const memoryUsageStore = (data = new Map(), { fail = () => false } = {}) => ({
  kind: "memory",
  data,
  get: async (k) => {
    if (fail("get", k)) throw new Error("store unavailable")
    const doc = data.get(k)
    return doc ? { ...doc } : null
  },
  inc: async (ops) => {
    if (fail("inc", ops)) throw new Error("store unavailable")
    for (const op of ops) {
      const doc = data.get(op.k) || { scope: op.scope, id: op.id, window: op.window, n: 0, expiresAt: op.expiresAt }
      doc.n += op.n
      doc.expiresAt = op.expiresAt
      data.set(op.k, doc)
    }
  },
  removeId: async (id) => {
    let n = 0
    for (const [k, doc] of data) if (doc.id === id) data.delete(k), n++
    return n
  },
})

// MongoDB collection "webusage": { _id: "<scope>|<id>|<window>", scope, id, window, n, expiresAt }
// with a TTL index on expiresAt. Commands aren't buffered while disconnected, so a missing
// database fails fast (and the guarded limits fail closed) instead of hanging requests.
const mongoUsageStore = (uri) => {
  const mongoose = require("mongoose")
  let model = null
  let connecting = null
  const connect = () =>
    (connecting ??= (async () => {
      const connection = await mongoose.createConnection(uri, { maxPoolSize: 2, serverSelectionTimeoutMS: 8000, bufferCommands: false }).asPromise()
      const schema = new mongoose.Schema(
        { _id: String, scope: String, id: String, window: String, n: { type: Number, default: 0 }, expiresAt: Date },
        { versionKey: false, collection: "webusage", bufferCommands: false }
      )
      schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })
      model = connection.model("WebUsage", schema)
      await model.init().catch(() => {})
      return model
    })().catch((error) => {
      connecting = null
      throw error
    }))
  return {
    kind: "mongo",
    get: async (k) => {
      const m = model || (await connect())
      return m.findById(k).maxTimeMS(8000).lean()
    },
    inc: async (ops) => {
      const m = model || (await connect())
      await m.bulkWrite(
        ops.map((op) => ({
          updateOne: {
            filter: { _id: op.k },
            update: { $inc: { n: op.n }, $set: { expiresAt: op.expiresAt }, $setOnInsert: { scope: op.scope, id: op.id, window: op.window } },
            upsert: true,
          },
        })),
        { ordered: false }
      )
    },
    removeId: async (id) => {
      const m = model || (await connect())
      return (await m.deleteMany({ id })).deletedCount || 0
    },
  }
}

module.exports = { createCounters, memoryUsageStore, mongoUsageStore, dayOf, monthOf, nextMonthStart, TTL, DAY_MS }
