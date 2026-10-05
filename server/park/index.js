// My Park (Pickleball 98's walk-around park): who is in which park, where they are, the
// paddle racks for real people, and handing a court's people into a Pickleball match.
//
// Instances: a park holds at most CAP people; joining puts you in the fullest park with room
// (so people meet), or opens a new one. Everything lives in memory.
//
// Positions: each browser sends its own walker a few times a second as five small integers
// (park:pos, fire and forget: x and z in 5 cm steps, heading in 1/256 turns, speed in 0.1
// m/s, what they're doing). The server keeps the latest, clamped to the park, and every batch
// interval sends each person ONE volatile message with everyone else who moved
// (park:m { t, m: [[num, x, z, yaw, speed, act], ...] }). People are small numbers here,
// not network ids. When the month's traffic meter (server/meter) is running high, batches go
// out less often and browsers are told to send less ("rate": normal | low | min).
//
// Courts: the AI games on the courts run in each browser; the server only keeps real
// people's paddles in each court's rack and who is playing. A browser whose court has
// finished its game says park:up; the people at the front of that rack go on: one person
// plays the park's computer players on their own (kind "solo"), two or more get a private
// Pickleball room made for them (server/arcade/rooms.js, relay mode, host-authoritative),
// seated, readied and started, and park:go tells each of them. The court is busy until the
// game ends (park:done, the room finishing or closing, or everyone leaving).
//
// Socket events (client -> server, with an ack unless noted):
//   park:join  { look, rep }      -> { ok, park, you, people: [person], courts, rate, lines }
//   park:leave {}
//   park:pos   [x, z, yaw, speed, act]   (no ack)
//   park:look  { look }  park:rep { rep }
//   park:fx    { emote } | { line }      a quick emote or one of the canned lines
//   park:call  { court }   park:uncall {}   (the rack)
//   park:up    { court }   park:score { court, score }   park:done { court }
// Server -> client: park:m (positions), park:person (someone joined / changed), park:gone
// { num }, park:fx { num, emote | line }, park:courts [court], park:go { court, kind,
// roomId? }, park:rate { rate }.


const { sanitizeLook } = require("../arcade/games/pickleballLooks")

const CAP = 16
const COURTS = 4
const BOUNDS = { x0: -30.5, x1: 47.5, z0: -15.5, z1: 15.5 } // (park/layout.js BOUNDS)
const BATCH_MS = { normal: 160, low: 400, min: 1000 }
// the canned lines (park/lines.js CHAT_LINES has the words; this many of them)
const LINE_COUNT = 8
const EMOTES = ["cheer", "pump", "clap"]
const ACT_MAX = 15
const REP_LEVELS = 5
const MB = 1024 * 1024

const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v)
// a sliding-window counter on the park's clock (net/limiter.js, but testable with a fake clock):
// hit(key) records one and says whether the key is now over the limit
const windowLimiter = (limit, windowMs, now) => {
  const hits = new Map()
  let swept = now()
  return (key) => {
    const t = now()
    if (t - swept > windowMs * 4) {
      swept = t
      for (const [k, list] of hits) if (!list.length || t - list[list.length - 1] >= windowMs) hits.delete(k)
    }
    const list = (hits.get(key) || []).filter((x) => t - x < windowMs)
    list.push(t)
    hits.set(key, list)
    return list.length > limit
  }
}
const int = (v, lo, hi) => (Number.isInteger(v) ? Math.max(lo, Math.min(hi, v)) : null)

// a position from a browser, checked and clamped to the park: -> [5 ints] or null
const cleanPos = (a) => {
  if (!Array.isArray(a) || a.length !== 5) return null
  const x = int(a[0], Math.round(BOUNDS.x0 * 20), Math.round(BOUNDS.x1 * 20))
  const z = int(a[1], Math.round(BOUNDS.z0 * 20), Math.round(BOUNDS.z1 * 20))
  const yaw = int(a[2], 0, 255)
  const speed = int(a[3], 0, 90)
  const act = int(a[4], 0, ACT_MAX)
  if ([x, z, yaw, speed, act].some((v) => v === null)) return null
  return [x, z, yaw, speed, act]
}
// the nameplate's park rep: { level 0..4, wins, losses, streak }
const cleanRep = (r) => {
  if (!isObject(r)) return { level: 0, wins: 0, losses: 0, streak: 0 }
  const n = (v, max) => int(Number(v) | 0, 0, max) ?? 0
  return { level: n(r.level, REP_LEVELS - 1), wins: n(r.wins, 1e6), losses: n(r.losses, 1e6), streak: n(r.streak, 1e4) }
}

// which park to put a newcomer in: the fullest one with room (lowest number on a tie), or
// null for a new one. instances: [{ n, size }]
const pickInstance = (instances, cap = CAP) => {
  let best = null
  for (const inst of instances) {
    if (inst.size >= cap) continue
    if (!best || inst.size > best.size || (inst.size === best.size && inst.n < best.n)) best = inst
  }
  return best
}

// the meter's month so far against the cap -> how often to send
const rateFor = (total, cap) => {
  if (!(cap > 0) || total === null || total === undefined) return "normal"
  const k = total / cap
  return k >= 0.95 ? "min" : k >= 0.8 ? "low" : "normal"
}

const realClock = {
  now: () => Date.now(),
  setInterval: (fn, ms) => {
    const h = setInterval(fn, ms)
    h.unref?.()
    return h
  },
  clearInterval: (h) => clearInterval(h),
}

const createPark = ({ emit = () => {}, emitVolatile = null, rooms = null, clock = realClock, meterTotal = () => null, capBytes = 3000 * MB, cap = CAP } = {}) => {
  const volatile = emitVolatile || emit
  const instances = new Map() // n -> instance
  const where = new Map() // pid -> instance n
  let nextN = 1
  const posLimit = windowLimiter(30, 2000, clock.now) // 15 a second at most
  const fxLimit = windowLimiter(8, 10_000, clock.now)
  const callLimit = windowLimiter(20, 60_000, clock.now)
  const joinLimit = windowLimiter(20, 60_000, clock.now)
  let rate = "normal"
  let rateCheckedAt = 0
  // bytes sent per person (approximate: the JSON of each payload), for the tests and logs
  const sent = { bytes: 0, messages: 0, positions: 0 }

  const size = (inst) => inst.people.size
  const send = (pid, event, payload, { fast = false } = {}) => {
    const n = JSON.stringify(payload ?? null).length + event.length + 6
    sent.bytes += n
    sent.messages++
    ;(fast ? volatile : emit)(pid, event, payload)
  }
  const toAll = (inst, event, payload, except = null) => {
    for (const p of inst.people.values()) if (p.pid !== except) send(p.pid, event, payload)
  }

  const personView = (p) => ({ num: p.num, name: p.name, user: !!p.key, look: p.look, rep: p.rep, pos: p.pos, playing: p.playing })
  const courtsView = (inst) =>
    inst.courts.map((c) => ({
      q: c.queue.map((pid) => inst.people.get(pid)?.num).filter(Boolean),
      g: c.game ? { k: c.game.kind, p: c.game.players.map((pid) => inst.people.get(pid)?.num ?? 0), s: c.game.score } : null,
    }))
  const publishCourts = (inst) => toAll(inst, "park:courts", courtsView(inst))

  const currentRate = () => {
    const now = clock.now()
    if (now - rateCheckedAt > 30_000) {
      rateCheckedAt = now
      let total = null
      try {
        total = meterTotal()
      } catch {
        total = null
      }
      const next = rateFor(total, capBytes)
      if (next !== rate) {
        rate = next
        for (const inst of instances.values()) {
          toAll(inst, "park:rate", { rate })
          restartBatch(inst)
        }
      }
    }
    return rate
  }

  // ---------- batches ----------
  const flush = (inst) => {
    const dirty = [...inst.people.values()].filter((p) => p.dirty && p.pos)
    if (!dirty.length) return
    const t = clock.now()
    for (const p of dirty) p.dirty = false
    for (const to of inst.people.values()) {
      const m = dirty.filter((p) => p.pid !== to.pid).map((p) => [p.num, ...p.pos])
      if (!m.length) continue
      sent.positions += m.length
      send(to.pid, "park:m", { t, m }, { fast: true })
    }
  }
  const restartBatch = (inst) => {
    if (inst.timer) clock.clearInterval(inst.timer)
    inst.timer = clock.setInterval(() => flush(inst), BATCH_MS[rate] || BATCH_MS.normal)
  }

  const makeInstance = () => {
    const inst = { n: nextN++, people: new Map(), nums: 0, courts: Array.from({ length: COURTS }, () => ({ queue: [], game: null })), timer: null }
    instances.set(inst.n, inst)
    restartBatch(inst)
    return inst
  }
  const closeInstance = (inst) => {
    if (inst.timer) clock.clearInterval(inst.timer)
    inst.timer = null
    instances.delete(inst.n)
  }

  // ---------- joining and leaving ----------
  const join = (me, { look, rep } = {}) => {
    if (joinLimit(me.pid)) return { ok: false, error: "Slow down a little and try again in a minute." }
    const was = where.get(me.pid)
    if (was !== undefined) leave(me.pid)
    const pick = pickInstance([...instances.values()].map((i) => ({ n: i.n, size: size(i) })), cap)
    const inst = pick ? instances.get(pick.n) : makeInstance()
    const p = { pid: me.pid, me, name: String(me.name || "Guest").slice(0, 40), key: me.key || null, num: ++inst.nums, look: sanitizeLook(look), rep: cleanRep(rep), pos: null, dirty: false, playing: null }
    inst.people.set(me.pid, p)
    where.set(me.pid, inst.n)
    toAll(inst, "park:person", personView(p), me.pid)
    return { ok: true, park: inst.n, you: p.num, people: [...inst.people.values()].filter((q) => q.pid !== me.pid).map(personView), courts: courtsView(inst), rate: currentRate(), cap }
  }
  const instanceOf = (pid) => {
    const n = where.get(pid)
    return n === undefined ? null : instances.get(n) || null
  }
  const leave = (pid) => {
    const inst = instanceOf(pid)
    if (!inst) return { ok: true }
    const p = inst.people.get(pid)
    inst.people.delete(pid)
    where.delete(pid)
    let changed = false
    for (const c of inst.courts) {
      if (c.queue.includes(pid)) {
        c.queue = c.queue.filter((x) => x !== pid)
        changed = true
      }
      if (c.game?.players.includes(pid)) {
        c.game.players = c.game.players.filter((x) => x !== pid)
        if (!c.game.players.length) c.game = null
        changed = true
      }
    }
    if (p) toAll(inst, "park:gone", { num: p.num })
    if (changed) publishCourts(inst)
    if (!size(inst)) closeInstance(inst)
    return { ok: true }
  }

  // ---------- moving ----------
  const pos = (pid, data) => {
    const inst = instanceOf(pid)
    if (!inst || posLimit(pid)) return false
    const clean = cleanPos(data)
    if (!clean) return false
    const p = inst.people.get(pid)
    p.pos = clean
    p.dirty = true
    return true
  }
  const setLook = (pid, look) => {
    const inst = instanceOf(pid)
    if (!inst || fxLimit(pid)) return { ok: false }
    const p = inst.people.get(pid)
    p.look = sanitizeLook(look)
    toAll(inst, "park:person", personView(p), pid)
    return { ok: true }
  }
  const setRep = (pid, rep) => {
    const inst = instanceOf(pid)
    if (!inst) return { ok: false }
    const p = inst.people.get(pid)
    p.rep = cleanRep(rep)
    toAll(inst, "park:person", personView(p), pid)
    return { ok: true }
  }
  const fx = (pid, { emote, line } = {}) => {
    const inst = instanceOf(pid)
    if (!inst) return { ok: false }
    if (fxLimit(pid)) return { ok: false, error: "Slow down a little." }
    const p = inst.people.get(pid)
    if (EMOTES.includes(emote)) toAll(inst, "park:fx", { num: p.num, emote }, pid)
    else if (Number.isInteger(line) && line >= 0 && line < LINE_COUNT) toAll(inst, "park:fx", { num: p.num, line }, pid)
    else return { ok: false }
    return { ok: true }
  }

  // ---------- the racks ----------
  const courtOf = (inst, court) => (Number.isInteger(court) && court >= 0 && court < COURTS ? inst.courts[court] : null)
  const call = (pid, court) => {
    const inst = instanceOf(pid)
    if (!inst) return { ok: false, error: "You're not in the park." }
    if (callLimit(pid)) return { ok: false, error: "Slow down a little." }
    const c = courtOf(inst, court)
    if (!c) return { ok: false, error: "There's no such court." }
    // one rack at a time
    for (const other of inst.courts) if (other !== c) other.queue = other.queue.filter((x) => x !== pid)
    if (!c.queue.includes(pid)) c.queue.push(pid)
    publishCourts(inst)
    return { ok: true, position: c.queue.indexOf(pid), busy: !!c.game }
  }
  const uncall = (pid) => {
    const inst = instanceOf(pid)
    if (!inst) return { ok: true }
    for (const c of inst.courts) c.queue = c.queue.filter((x) => x !== pid)
    publishCourts(inst)
    return { ok: true }
  }

  // a court's game is over in someone's browser: the people at the front go on
  const up = (pid, court) => {
    const inst = instanceOf(pid)
    if (!inst) return { ok: false }
    const c = courtOf(inst, court)
    if (!c) return { ok: false }
    if (c.game) return { ok: false, error: "That court is busy." }
    // (only someone in the rack can start their court's turn)
    if (!c.queue.includes(pid)) return { ok: false, error: "Put your paddle in the rack first." }
    const players = c.queue.slice(0, 4)
    c.queue = c.queue.slice(4)
    for (const q of players) {
      const p = inst.people.get(q)
      if (p) p.playing = court
    }
    if (players.length === 1 || !rooms) {
      c.game = { kind: "solo", players, score: [0, 0], since: clock.now() }
      for (const q of players) send(q, "park:go", { court, kind: "solo" })
      publishCourts(inst)
      return { ok: true, kind: "solo" }
    }
    // two or more: a private Pickleball room, everyone seated and the game started
    const people = players.map((q) => inst.people.get(q)).filter(Boolean)
    const host = people[0]
    const made = rooms.create(host.me, "pickleball", { format: "doubles", target: 11, scoring: "sideout", venue: "park" })
    if (!made?.ok) {
      // (no room: everyone plays their own game against the computer)
      c.game = { kind: "solo", players, score: [0, 0], since: clock.now() }
      for (const q of players) send(q, "park:go", { court, kind: "solo" })
      publishCourts(inst)
      return { ok: true, kind: "solo" }
    }
    for (const p of people.slice(1)) {
      rooms.allow(p.pid, made.roomId)
      rooms.join(p.me, { roomId: made.roomId })
      rooms.ready(p.pid, made.roomId, true)
    }
    const started = rooms.start(host.pid, made.roomId)
    c.game = { kind: "room", roomId: made.roomId, players, score: [0, 0], since: clock.now() }
    for (const q of players) send(q, "park:go", { court, kind: "room", roomId: made.roomId, started: !!started?.ok })
    publishCourts(inst)
    return { ok: true, kind: "room", roomId: made.roomId }
  }
  const score = (pid, court, s) => {
    const inst = instanceOf(pid)
    const c = inst && courtOf(inst, court)
    if (!c?.game || !c.game.players.includes(pid) || !Array.isArray(s) || s.length !== 2) return { ok: false }
    const a = int(s[0], 0, 99)
    const b = int(s[1], 0, 99)
    if (a === null || b === null) return { ok: false }
    if (c.game.score[0] === a && c.game.score[1] === b) return { ok: true }
    c.game.score = [a, b]
    publishCourts(inst)
    return { ok: true }
  }
  const endGame = (inst, c) => {
    for (const q of c.game?.players || []) {
      const p = inst.people.get(q)
      if (p) p.playing = null
    }
    c.game = null
    publishCourts(inst)
  }
  const done = (pid, court) => {
    const inst = instanceOf(pid)
    const c = inst && courtOf(inst, court)
    if (!c?.game || !c.game.players.includes(pid)) return { ok: false }
    if (c.game.kind === "solo") endGame(inst, c)
    else {
      // a room game: this person is back in the park; the court is free once they all are
      // (or the room says it's over)
      c.game.players = c.game.players.filter((x) => x !== pid)
      const p = inst.people.get(pid)
      if (p) p.playing = null
      if (!c.game.players.length) endGame(inst, c)
      else publishCourts(inst)
    }
    return { ok: true }
  }
  // room games end on the room's word too (finished, closed, or everyone gone)
  const watchRooms = () => {
    if (!rooms) return
    for (const inst of instances.values()) {
      for (const c of inst.courts) {
        if (c.game?.kind !== "room") continue
        const room = rooms.rooms?.get(c.game.roomId)
        const over = !room || room.phase === "over" || room.phase === "lobby"
        if (over && clock.now() - c.game.since > 3000) endGame(inst, c)
      }
    }
  }
  const watcher = clock.setInterval(watchRooms, 2000)

  const drop = (pid) => leave(pid)

  // ---------- sockets ----------
  const wire = (socket, current, who) => {
    const on = (event, handler) =>
      socket.on(event, (payload = {}, ack = () => {}) => {
        if (typeof ack !== "function") ack = () => {}
        const computer = current()
        if (!computer) return ack({ ok: false, error: "Not connected to the network." })
        try {
          ack(handler(who(computer), isObject(payload) ? payload : {}) || { ok: true })
        } catch (error) {
          console.error(`[park] ${event} failed`, error)
          ack({ ok: false, error: "Something went wrong. Please try again." })
        }
      })
    on("park:join", (me, p) => join(me, p))
    on("park:leave", (me) => leave(me.pid))
    on("park:look", (me, p) => setLook(me.pid, p.look))
    on("park:rep", (me, p) => setRep(me.pid, p.rep))
    on("park:fx", (me, p) => fx(me.pid, p))
    on("park:call", (me, p) => call(me.pid, p.court))
    on("park:uncall", (me) => uncall(me.pid))
    on("park:up", (me, p) => up(me.pid, p.court))
    on("park:score", (me, p) => score(me.pid, p.court, p.score))
    on("park:done", (me, p) => done(me.pid, p.court))
    // fire and forget, a few times a second: no ack, no logging
    socket.on("park:pos", (data) => {
      const computer = current()
      if (!computer) return
      try {
        pos(computer.pid, data)
      } catch {
        // a bad position is just dropped
      }
    })
  }

  return {
    wire,
    join,
    leave,
    drop,
    pos,
    setLook,
    setRep,
    fx,
    call,
    uncall,
    up,
    score,
    done,
    flush: (n) => {
      const inst = instances.get(n)
      if (inst) flush(inst)
    },
    watchRooms,
    instances,
    instanceOf: (pid) => instanceOf(pid)?.n ?? null,
    get rate() {
      return currentRate()
    },
    checkRate: () => {
      rateCheckedAt = 0
      return currentRate()
    },
    stats: () => ({ ...sent }),
    stop: () => {
      clock.clearInterval(watcher)
      for (const inst of instances.values()) if (inst.timer) clock.clearInterval(inst.timer)
    },
  }
}

module.exports = { createPark, pickInstance, cleanPos, cleanRep, rateFor, CAP, LINE_COUNT, EMOTES, BATCH_MS, BOUNDS }
