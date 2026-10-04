// The whole server's outgoing traffic, per calendar month (UTC), kept across restarts.
//
// Why: Render's Hobby workspace includes 5 GB of outbound bandwidth a month for everything
// (render.com/docs/outbound-bandwidth), and without a payment method going over can suspend
// every free service for the rest of the month (render.com/docs/free). 98 Messenger,
// socket.io, drive sync (photos), calendar, push, the APIs and Compass's relay all count, so
// Compass (the only part that can use a lot) stops for the month well before that.
//
// How: every TCP socket the HTTP server accepts is tracked; its bytesWritten (headers, bodies,
// websocket frames: everything Node writes) is added when it closes and sampled every few
// seconds while it lives (websockets stay open for hours). The sum goes into the counter
// ("month", "server", "YYYY-MM") of counters.js, which is saved to MongoDB.
//
// Render's edge measures somewhat differently (TLS framing adds a little, compression at the
// edge can take some away), and traffic before this meter started isn't in it, so the caps
// leave a wide margin under 5 GB (see server/web: WEB_MONTHLY_TOTAL_MB).

const { monthOf } = require("./counters")

const MB = 1024 * 1024

const createMeter = ({ counters, now = Date.now, sampleMs = 10000, warnBytes = 4000 * MB, log = console } = {}) => {
  const live = new Map() // socket -> bytes already counted
  const servers = new Set()
  let timer = null
  let warned = null // the month a warning was logged for
  let counted = 0 // this process, for tests and logs

  const add = (n) => {
    if (!(n > 0)) return
    counted += n
    counters.add("month", "server", monthOf(now()), n)
  }
  const settle = (socket) => {
    const written = Number(socket.bytesWritten) || 0
    const before = live.get(socket) || 0
    if (written > before) {
      add(written - before)
      live.set(socket, written)
    }
  }
  const track = (socket) => {
    if (live.has(socket)) return
    live.set(socket, 0)
    socket.once("close", () => {
      settle(socket)
      live.delete(socket)
    })
  }

  // this month's total so far (null until it has been read back from the store)
  const total = () => counters.value("month", "server", monthOf(now()))

  const sample = () => {
    for (const socket of live.keys()) settle(socket)
    const t = total()
    const month = monthOf(now())
    if (t !== null && t >= warnBytes && warned !== month) {
      warned = month
      log.warn?.(`[meter] the server has sent ${Math.round(t / MB)} MB this month (Render's free allowance is 5 GB; Compass is closed above WEB_MONTHLY_TOTAL_MB)`)
    }
  }

  return {
    // count every connection of this HTTP server (socket.io's websockets too: they start as
    // connections of the same server)
    attach(server) {
      if (servers.has(server)) return
      servers.add(server)
      server.on("connection", track)
    },
    track,
    sample,
    total,
    start() {
      if (timer) return
      total() // start reading the month's total back
      timer = setInterval(sample, sampleMs)
      timer.unref?.()
    },
    stop() {
      clearInterval(timer)
      timer = null
    },
    // count what the open connections have sent so far (on shutdown, before the last flush)
    settleAll() {
      for (const socket of live.keys()) settle(socket)
    },
    get counted() {
      return counted
    },
    get sockets() {
      return live.size
    },
  }
}

module.exports = { createMeter }
