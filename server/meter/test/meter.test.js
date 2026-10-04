const test = require("node:test")
const assert = require("node:assert/strict")
const { EventEmitter } = require("node:events")
const http = require("node:http")
const { createCounters, memoryUsageStore, createMeter, monthOf, dayOf, nextMonthStart } = require("..")

const quiet = { warn: () => {} }

// a socket as the HTTP server hands it over: bytesWritten grows, then "close"
const fakeSocket = () => Object.assign(new EventEmitter(), { bytesWritten: 0 })

test("windows are UTC days and calendar months; the next month starts on the 1st", () => {
  const t = Date.parse("2026-10-31T23:59:59Z")
  assert.equal(dayOf(t), "2026-10-31")
  assert.equal(monthOf(t), "2026-10")
  assert.equal(nextMonthStart(t).toISOString(), "2026-11-01T00:00:00.000Z")
  assert.equal(nextMonthStart(Date.parse("2026-12-15T00:00:00Z")).toISOString(), "2027-01-01T00:00:00.000Z")
})

test("counters: writes wait in memory and reach the store as one $inc batch", async () => {
  const store = memoryUsageStore()
  let incs = 0
  const inc = store.inc
  store.inc = async (ops) => {
    incs++
    return inc(ops)
  }
  const c = createCounters({ store, log: quiet })
  await c.ensure([["day", "u:alice", "2026-10-04"]])
  for (let i = 0; i < 1000; i++) c.add("day", "u:alice", "2026-10-04", 10)
  assert.equal(c.value("day", "u:alice", "2026-10-04"), 10000)
  assert.equal(incs, 0, "nothing written per chunk")
  assert.equal(store.data.size, 0)
  await c.flush()
  assert.equal(incs, 1)
  assert.equal(store.data.get("day|u:alice|2026-10-04").n, 10000)
  assert.ok(store.data.get("day|u:alice|2026-10-04").expiresAt > new Date(), "a TTL for the index")
  // the value doesn't double after the flush
  assert.equal(c.value("day", "u:alice", "2026-10-04"), 10000)
})

test("counters survive a restart: a new process reads them back (and adds to them)", async () => {
  const data = new Map()
  const first = createCounters({ store: memoryUsageStore(data), log: quiet })
  first.add("month", "server", "2026-10", 5000)
  first.add("day", "u:alice", "2026-10-04", 700)
  await first.flush()
  first.add("month", "server", "2026-10", 1) // flushed on shutdown
  await first.flush()
  // "restart": a new counters object over the same store
  const second = createCounters({ store: memoryUsageStore(data), log: quiet })
  assert.equal(second.value("month", "server", "2026-10"), null, "unknown until read back")
  await second.ensure([["month", "server", "2026-10"], ["day", "u:alice", "2026-10-04"]])
  assert.equal(second.value("month", "server", "2026-10"), 5001)
  assert.equal(second.value("day", "u:alice", "2026-10-04"), 700)
  second.add("month", "server", "2026-10", 99)
  await second.flush()
  assert.equal(data.get("month|server|2026-10").n, 5100)
})

test("counters: counted before the read-back isn't lost or counted twice", async () => {
  const data = new Map([["month|server|2026-10", { n: 1000 }]])
  const c = createCounters({ store: memoryUsageStore(data), log: quiet })
  c.add("month", "server", "2026-10", 50) // before anyone read it
  await c.flush() // $inc while not read back yet
  assert.equal(data.get("month|server|2026-10").n, 1050)
  await c.ensure([["month", "server", "2026-10"]])
  assert.equal(c.value("month", "server", "2026-10"), 1050)
  // a read that starts while a flush of the same counter is on its way waits for it
  const d = createCounters({ store: memoryUsageStore(data), log: quiet })
  let release
  const slow = memoryUsageStore(data)
  const inc = slow.inc
  d.store.inc = async (ops) => {
    await new Promise((r) => (release = r))
    return inc(ops)
  }
  d.add("month", "server", "2026-10", 7)
  const flushing = d.flush()
  await new Promise((r) => setImmediate(r))
  const reading = d.ensure([["month", "server", "2026-10"]])
  release()
  await flushing
  await reading
  assert.equal(d.value("month", "server", "2026-10"), 1057)
  assert.equal(data.get("month|server|2026-10").n, 1057)
})

test("counters: a store that's down gives no value (callers fail closed) and keeps the counts for later", async () => {
  let down = true
  const data = new Map([["month|server|2026-10", { n: 123 }]])
  const c = createCounters({ store: memoryUsageStore(data, { fail: () => down }), retryMs: 0, log: quiet })
  c.add("month", "server", "2026-10", 10)
  await assert.rejects(c.ensure([["month", "server", "2026-10"]]))
  assert.equal(c.value("month", "server", "2026-10"), null)
  await c.flush() // fails quietly; the 10 stay pending
  assert.equal(data.get("month|server|2026-10").n, 123)
  down = false
  await c.flush()
  assert.equal(data.get("month|server|2026-10").n, 133)
  await c.ensure([["month", "server", "2026-10"]])
  assert.equal(c.value("month", "server", "2026-10"), 133)
})

test("meter: sockets are sampled while open and settled on close", async () => {
  const counters = createCounters({ store: memoryUsageStore(), log: quiet })
  const t = Date.parse("2026-10-04T12:00:00Z")
  const meter = createMeter({ counters, now: () => t, log: quiet })
  await counters.ensure([["month", "server", "2026-10"]])
  const ws = fakeSocket() // a websocket that stays open
  const short = fakeSocket()
  meter.track(ws)
  meter.track(short)
  ws.bytesWritten = 1000
  short.bytesWritten = 300
  meter.sample()
  assert.equal(meter.total(), 1300)
  ws.bytesWritten = 1500
  meter.sample()
  meter.sample() // nothing new: nothing added
  assert.equal(meter.total(), 1800)
  short.bytesWritten = 450
  short.emit("close")
  assert.equal(meter.total(), 1950)
  assert.equal(meter.sockets, 1)
  ws.bytesWritten = 1600
  ws.emit("close")
  assert.equal(meter.total(), 2050)
  assert.equal(meter.sockets, 0)
})

test("meter: a new month starts from zero; the old month keeps its total", async () => {
  const data = new Map()
  const counters = createCounters({ store: memoryUsageStore(data), log: quiet })
  let t = Date.parse("2026-10-31T23:59:50Z")
  const meter = createMeter({ counters, now: () => t, log: quiet })
  await counters.ensure([["month", "server", "2026-10"], ["month", "server", "2026-11"]])
  const s = fakeSocket()
  meter.track(s)
  s.bytesWritten = 4000
  meter.sample()
  t = Date.parse("2026-11-01T00:00:05Z")
  s.bytesWritten = 4100
  meter.sample()
  assert.equal(counters.value("month", "server", "2026-10"), 4000)
  assert.equal(meter.total(), 100)
  await counters.flush()
  assert.equal(data.get("month|server|2026-10").n, 4000)
  assert.equal(data.get("month|server|2026-11").n, 100)
})

test("meter: the month's total survives a restart, and a warning is logged once over WEB_MONTHLY_WARN_MB", async () => {
  const data = new Map()
  const t = Date.parse("2026-10-20T10:00:00Z")
  const first = createCounters({ store: memoryUsageStore(data), log: quiet })
  const m1 = createMeter({ counters: first, now: () => t, log: quiet })
  const s = fakeSocket()
  m1.track(s)
  s.bytesWritten = 3000
  m1.settleAll() // what server.js does on SIGTERM, then a flush
  await first.flush()
  const warnings = []
  const second = createCounters({ store: memoryUsageStore(data), log: quiet })
  const m2 = createMeter({ counters: second, now: () => t, warnBytes: 5000, log: { warn: (m) => warnings.push(m) } })
  await second.ensure([["month", "server", "2026-10"]])
  assert.equal(m2.total(), 3000)
  const s2 = fakeSocket()
  m2.track(s2)
  s2.bytesWritten = 2500
  m2.sample()
  m2.sample()
  assert.equal(m2.total(), 5500)
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /this month/)
})

test("meter: a real HTTP server's responses and an open connection are counted", async () => {
  const counters = createCounters({ store: memoryUsageStore(), log: quiet })
  const meter = createMeter({ counters, log: quiet })
  await counters.ensure([["month", "server", monthOf(Date.now())]])
  const body = "x".repeat(50000)
  const server = http.createServer((req, res) => res.end(body))
  meter.attach(server)
  await new Promise((r) => server.listen(0, "127.0.0.1", r))
  const port = server.address().port
  const agent = new http.Agent({ keepAlive: true })
  const get = () =>
    new Promise((resolve) =>
      http.get({ port, host: "127.0.0.1", agent }, (res) => {
        res.resume()
        res.on("end", resolve)
      })
    )
  await get()
  await get()
  meter.sample() // the kept-alive connection is still open
  const total = meter.total()
  assert.ok(total >= 100000 && total < 101000, String(total)) // bodies + headers
  agent.destroy()
  await new Promise((r) => server.close(r))
  for (let i = 0; i < 50 && meter.sockets; i++) await new Promise((r) => setTimeout(r, 10))
  assert.equal(meter.sockets, 0)
  assert.equal(meter.total(), total, "closing added nothing new")
})
