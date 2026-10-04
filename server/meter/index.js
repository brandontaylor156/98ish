// Usage counters kept across restarts (counters.js) and the server's monthly outgoing-traffic
// meter (meter.js). One of each per process: defaultUsage().
// MongoDB collection "webusage" when MONGODB_URI is set, otherwise memory (lost on restart).
// Env: WEB_MONTHLY_WARN_MB (4000): log a warning when the server has sent this much in a month.

const { createCounters, memoryUsageStore, mongoUsageStore, dayOf, monthOf, nextMonthStart, TTL } = require("./counters")
const { createMeter } = require("./meter")

const MB = 1024 * 1024

let shared = null
const defaultUsage = () => {
  if (shared) return shared
  const uri = process.env.MONGODB_URI
  if (!uri) console.warn("[usage] MONGODB_URI not set: Compass's allowances and the traffic meter are kept in memory and start again after a restart")
  const counters = createCounters({ store: uri ? mongoUsageStore(uri) : memoryUsageStore() })
  const warn = Number(process.env.WEB_MONTHLY_WARN_MB)
  const meter = createMeter({ counters, warnBytes: (Number.isFinite(warn) && warn > 0 ? warn : 4000) * MB })
  counters.start()
  meter.start()
  // save what's counted when Render stops the server (it sends SIGTERM, then waits a little)
  const shutdown = async () => {
    meter.settleAll()
    await Promise.race([counters.flush(), new Promise((r) => setTimeout(r, 3000))])
  }
  shared = { counters, meter, shutdown }
  return shared
}

module.exports = { defaultUsage, createCounters, memoryUsageStore, mongoUsageStore, createMeter, dayOf, monthOf, nextMonthStart, TTL }
