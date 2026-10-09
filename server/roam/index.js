// Roam (the open world, client/src/roam/; docs/open-world.md): who is in which town, where
// they are, who's driving which car and who's riding along. Everything lives in memory and is
// gone when you leave; nothing is stored per account.
//
// Instances: a town holds at most CAP people; joining puts you in the fullest instance of that
// town with room (so friends meet), or opens a new one.
//
// Positions: six small integers (roam:pos, fire and forget: x, z, y in decimetres, heading in
// 1/256 turns, speed in 0.1 m/s, what you're doing), checked the same way as the browser's
// sim/sync.js cleanPos and capped at 15 a second; every batch interval each person gets ONE
// volatile message with everyone else who moved (roam:m { t, m: [[num, x, z, y, yaw, speed,
// act], ...] }). When the month's traffic meter runs high, batches go out less often.
//
// Cars: you name the car you got into once (roam:car { car: { id, model, color } }); getting
// out you say where you left it (left: { id, x, z, yaw }) and everyone in the town sees it
// parked there (the last 200 left cars an instance remembers). Riding along (roam:ride
// { num }): only in a car someone is driving, within 8 m of it, up to 3 riders.
//
// Going to another town (roam:hop { town }): a driver's riders are told (roam:hop { town,
// driver }) and come too; each gets a ticket (30 s, memory only) so that joining that town puts
// them in the driver's instance and, once the driver's car is there, in its passenger seat
// (roam:seat { num, car }).
//
// Socket events (client -> server, with an ack unless noted):
//   roam:join  { town, look }  -> { ok, n, town, you, people: [person], moved: [{ id, x, z, yaw }], rate, cap }
//   roam:leave {}
//   roam:pos   [x, z, y, yaw, speed, act]   (no ack)
//   roam:look  { look }
//   roam:car   { car: { id, model, color } | null, left?: { id, x, z, yaw } }
//   roam:ride  { num }  -> { ok, car } | { ok: false, error }
//   roam:hop   { town } -> { ok, riders }
//   roam:vc    { on } -> { ok, on, ice }   roam:sig { to, kind, data }   (spatial voice, server/voice/relay.js)
// Server -> client: roam:m, roam:person, roam:gone { num }, roam:car { num, car, left? },
// roam:ride { num, car } (to the driver), roam:hop { town, driver } (to riders), roam:seat
// { num, car } (to a rider who followed), roam:vc, roam:sig.

const { sanitizeLook } = require("../arcade/games/pickleballLooks")
const { createVoiceRelay } = require("../voice/relay")

const CAP = 16
// the towns (client/src/roam/towns/): how far from the origin a position may be (decimetres)
const TOWNS = { valencia: { reach: 300000 }, simi: { reach: 300000 }, northridge: { reach: 300000 }, newport: { reach: 300000 } }
const HOP_MS = 30_000
const MODELS = ["sedan", "hatch", "suv", "pickup", "turbo"]
const LIMIT = { y: 30000, speed: 900, act: 15 }
const ACT_RIDE = 8
const MOVED_CAP = 200
const RIDERS = 3
const RIDE_DM = 80 // 8 m
const BATCH_MS = { normal: 160, low: 400, min: 1000 }
const MB = 1024 * 1024

const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v)
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

// a position from a browser -> [6 ints] or null (client/src/roam/sim/sync.js cleanPos)
const cleanPos = (a, reach = TOWNS.valencia.reach) => {
  if (!Array.isArray(a) || a.length !== 6 || !a.every(Number.isInteger)) return null
  if (Math.abs(a[0]) > reach || Math.abs(a[1]) > reach || Math.abs(a[2]) > LIMIT.y) return null
  if (a[3] < 0 || a[3] > 255 || a[4] < 0 || a[4] > LIMIT.speed || a[5] < 0 || a[5] > LIMIT.act) return null
  return a.slice()
}
// a car's name -> { id, model, color } or null
const cleanCar = (c) => {
  if (!isObject(c)) return null
  const id = typeof c.id === "string" && c.id.length <= 40 && /^[\w:/.-]+$/.test(c.id) ? c.id : null
  const model = MODELS.includes(c.model) ? c.model : null
  const color = Number.isInteger(c.color) && c.color >= 0 && c.color <= 0xffffff ? c.color : null
  return id && model && color !== null ? { id, model, color } : null
}
const cleanLeft = (l, reach) => {
  if (!isObject(l)) return null
  const car = typeof l.id === "string" && l.id.length <= 40 && /^[\w:/.-]+$/.test(l.id) ? l.id : null
  const ok = [l.x, l.z, l.yaw].every(Number.isInteger) && Math.abs(l.x) <= reach && Math.abs(l.z) <= reach && l.yaw >= 0 && l.yaw <= 255
  return car && ok ? { id: car, x: l.x, z: l.z, yaw: l.yaw } : null
}
const pickInstance = (instances, cap = CAP) => {
  let best = null
  for (const inst of instances) {
    if (inst.size >= cap) continue
    if (!best || inst.size > best.size || (inst.size === best.size && inst.n < best.n)) best = inst
  }
  return best
}
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

const createRoam = ({ emit = () => {}, emitVolatile = null, clock = realClock, meterTotal = () => null, capBytes = 3000 * MB, cap = CAP, ice = null } = {}) => {
  const volatile = emitVolatile || emit
  const instances = new Map()
  const where = new Map() // pid -> n
  const tickets = new Map() // rider pid -> { driver: pid, town, until } (following a driver to a town)
  let nextN = 1
  const posLimit = windowLimiter(30, 2000, clock.now)
  const carLimit = windowLimiter(20, 60_000, clock.now)
  const joinLimit = windowLimiter(20, 60_000, clock.now)
  const lookLimit = windowLimiter(8, 10_000, clock.now)
  let rate = "normal"
  let rateCheckedAt = 0
  const sent = { bytes: 0, messages: 0, positions: 0 }
  const send = (pid, event, payload, { fast = false } = {}) => {
    sent.bytes += JSON.stringify(payload ?? null).length + event.length + 6
    sent.messages++
    ;(fast ? volatile : emit)(pid, event, payload)
  }
  const toAll = (inst, event, payload, except = null) => {
    for (const p of inst.people.values()) if (p.pid !== except) send(p.pid, event, payload)
  }
  const personView = (p) => ({ num: p.num, name: p.name, user: !!p.key, look: p.look, pos: p.pos, car: p.car })

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
        for (const inst of instances.values()) restartBatch(inst)
      }
    }
    return rate
  }
  const flush = (inst) => {
    const dirty = [...inst.people.values()].filter((p) => p.dirty && p.pos)
    if (!dirty.length) return
    const t = clock.now()
    for (const p of dirty) p.dirty = false
    for (const to of inst.people.values()) {
      const m = dirty.filter((p) => p.pid !== to.pid).map((p) => [p.num, ...p.pos])
      if (!m.length) continue
      sent.positions += m.length
      send(to.pid, "roam:m", { t, m }, { fast: true })
    }
  }
  const restartBatch = (inst) => {
    if (inst.timer) clock.clearInterval(inst.timer)
    inst.timer = clock.setInterval(() => flush(inst), BATCH_MS[rate] || BATCH_MS.normal)
  }
  const makeInstance = (town) => {
    const inst = { n: nextN++, town, reach: TOWNS[town].reach, people: new Map(), nums: 0, moved: new Map(), timer: null }
    instances.set(inst.n, inst)
    restartBatch(inst)
    return inst
  }
  const closeInstance = (inst) => {
    voice.drop(`t${inst.n}`)
    if (inst.timer) clock.clearInterval(inst.timer)
    instances.delete(inst.n)
  }
  const instanceOf = (pid) => {
    const n = where.get(pid)
    return n === undefined ? null : instances.get(n) || null
  }
  const byNum = (inst, num) => [...inst.people.values()].find((q) => q.num === num) || null

  const join = (me, { town, look } = {}) => {
    if (joinLimit(me.pid)) return { ok: false, error: "Slow down a little and try again in a minute." }
    if (typeof town !== "string" || !Object.prototype.hasOwnProperty.call(TOWNS, town)) return { ok: false, error: "There's no such town." }
    if (where.has(me.pid)) leave(me.pid)
    // (following a driver, or a driver whose riders are already there: the same instance)
    const now = clock.now()
    for (const [k, t] of tickets) if (t.until < now) tickets.delete(k)
    const mine = tickets.get(me.pid)
    const partners = [mine && mine.town === town ? mine.driver : null, ...[...tickets].filter(([, t]) => t.driver === me.pid && t.town === town).map(([k]) => k)].filter(Boolean)
    let inst = null
    for (const other of partners) {
      const i = instanceOf(other)
      if (i && i.town === town && i.people.size < cap) {
        inst = i
        break
      }
    }
    if (!inst) {
      const pick = pickInstance([...instances.values()].filter((i) => i.town === town).map((i) => ({ n: i.n, size: i.people.size })), cap)
      inst = pick ? instances.get(pick.n) : makeInstance(town)
    }
    const p = { pid: me.pid, me, name: String(me.name || "Guest").slice(0, 40), key: me.key || null, num: ++inst.nums, look: sanitizeLook(look), pos: null, dirty: false, car: null }
    inst.people.set(me.pid, p)
    where.set(me.pid, inst.n)
    toAll(inst, "roam:person", personView(p), me.pid)
    if (partners.length) queueMicrotask(() => seatFollowers(inst))
    return { ok: true, n: inst.n, town, you: p.num, people: [...inst.people.values()].filter((q) => q.pid !== me.pid).map(personView), moved: [...inst.moved.values()], rate: currentRate(), cap }
  }
  // riders who followed their driver here: into the passenger seat once the driver's car is here
  const seatFollowers = (inst) => {
    if (!instances.has(inst.n)) return
    const now = clock.now()
    for (const [pid, t] of tickets) {
      if (t.until < now || t.town !== inst.town) continue
      const q = inst.people.get(pid)
      const d = inst.people.get(t.driver)
      if (!q || !d || d.car?.seat !== 0 || q.car) continue
      const riders = [...inst.people.values()].filter((x) => x.car?.seat === 1 && x.car.driver === d.num).length
      if (riders >= RIDERS) continue
      tickets.delete(pid)
      q.car = { id: d.car.id, model: d.car.model, color: d.car.color, seat: 1, driver: d.num }
      if (d.pos) {
        q.pos = [...d.pos.slice(0, 5), ACT_RIDE]
        q.dirty = true
      }
      toAll(inst, "roam:car", { num: q.num, car: q.car }, pid)
      send(pid, "roam:seat", { num: d.num, car: q.car })
      send(d.pid, "roam:ride", { num: q.num, car: q.car })
    }
  }
  // off to another town: a driver's riders come too
  const hop = (pid, { town } = {}) => {
    if (typeof town !== "string" || !Object.prototype.hasOwnProperty.call(TOWNS, town)) return { ok: false, error: "There's no such town." }
    const inst = instanceOf(pid)
    if (!inst) return { ok: true, riders: 0 }
    if (carLimit(pid)) return { ok: false, error: "Slow down a little." }
    const p = inst.people.get(pid)
    const riders = p.car?.seat === 0 ? [...inst.people.values()].filter((q) => q.car?.seat === 1 && q.car.driver === p.num) : []
    const until = clock.now() + HOP_MS
    for (const q of riders) {
      tickets.set(q.pid, { driver: pid, town, until })
      send(q.pid, "roam:hop", { town, driver: p.name })
    }
    return { ok: true, riders: riders.length }
  }
  // a driver's riders lose their seat when the driver gets out or goes
  const dropRiders = (inst, driver) => {
    for (const q of inst.people.values()) {
      if (q.car?.seat === 1 && q.car.driver === driver.num) {
        q.car = null
        toAll(inst, "roam:car", { num: q.num, car: null })
      }
    }
  }
  const leave = (pid) => {
    const inst = instanceOf(pid)
    if (!inst) return { ok: true }
    const p = inst.people.get(pid)
    if (p) voice.set(`t${inst.n}`, p.num, false)
    inst.people.delete(pid)
    where.delete(pid)
    if (p) {
      if (p.car?.seat === 0) dropRiders(inst, p)
      toAll(inst, "roam:gone", { num: p.num })
    }
    if (!inst.people.size) closeInstance(inst)
    return { ok: true }
  }

  const pos = (pid, data) => {
    const inst = instanceOf(pid)
    if (!inst || posLimit(pid)) return false
    const clean = cleanPos(data, inst.reach)
    if (!clean) return false
    const p = inst.people.get(pid)
    p.pos = clean
    p.dirty = true
    return true
  }
  const setLook = (pid, look) => {
    const inst = instanceOf(pid)
    if (!inst || lookLimit(pid)) return { ok: false }
    const p = inst.people.get(pid)
    p.look = sanitizeLook(look)
    toAll(inst, "roam:person", personView(p), pid)
    return { ok: true }
  }
  const car = (pid, { car: c, left } = {}) => {
    const inst = instanceOf(pid)
    if (!inst) return { ok: false, error: "You're not in town." }
    if (carLimit(pid)) return { ok: false, error: "Slow down a little." }
    const p = inst.people.get(pid)
    const next = c === null || c === undefined ? null : cleanCar(c)
    if (c && !next) return { ok: false, error: "That's not a car." }
    if (p.car?.seat === 0 && (!next || next.id !== p.car.id)) dropRiders(inst, p)
    p.car = next ? { ...next, seat: 0 } : null
    const l = !next && left ? cleanLeft(left, inst.reach) : null
    if (l) {
      inst.moved.delete(l.id)
      inst.moved.set(l.id, l)
      while (inst.moved.size > MOVED_CAP) inst.moved.delete(inst.moved.keys().next().value)
    }
    toAll(inst, "roam:car", { num: p.num, car: p.car, ...(l ? { left: l } : {}) }, pid)
    if (next) seatFollowers(inst)
    return { ok: true }
  }
  const ride = (pid, { num } = {}) => {
    const inst = instanceOf(pid)
    if (!inst) return { ok: false, error: "You're not in town." }
    if (carLimit(pid)) return { ok: false, error: "Slow down a little." }
    const p = inst.people.get(pid)
    const d = Number.isInteger(num) ? byNum(inst, num) : null
    if (!d || d === p || d.car?.seat !== 0) return { ok: false, error: "They're not driving." }
    if (!p.pos || !d.pos || Math.hypot(p.pos[0] - d.pos[0], p.pos[1] - d.pos[1]) > RIDE_DM) return { ok: false, error: "Walk up to their car first." }
    const riders = [...inst.people.values()].filter((q) => q.car?.seat === 1 && q.car.driver === d.num).length
    if (riders >= RIDERS) return { ok: false, error: "That car is full." }
    p.car = { id: d.car.id, model: d.car.model, color: d.car.color, seat: 1, driver: d.num }
    p.pos = [...d.pos.slice(0, 5), ACT_RIDE]
    p.dirty = true
    toAll(inst, "roam:car", { num: p.num, car: p.car }, pid)
    send(d.pid, "roam:ride", { num: p.num, car: p.car })
    return { ok: true, car: p.car }
  }

  const voice = createVoiceRelay({
    prefix: "roam",
    now: clock.now,
    emit: (num, event, payload) => {
      const inst = instances.get(Number(String(payload.room).slice(1)))
      if (!inst) return
      const q = byNum(inst, num)
      if (q) send(q.pid, event, payload)
    },
  })
  let iceSource = ice
  const iceConfig = async () => {
    try {
      iceSource ??= require("../aim/ice").createIce()
      return await iceSource.config()
    } catch {
      return { iceServers: [{ urls: "stun:stun.l.google.com:19302" }], turn: false }
    }
  }
  const voiceOn = async (pid, on) => {
    const inst = instanceOf(pid)
    if (!inst) return { ok: false, error: "You're not in town." }
    const r = voice.set(`t${inst.n}`, inst.people.get(pid).num, !!on)
    if (!r.ok || !on) return r
    return { ...r, ice: await iceConfig() }
  }
  const voiceSignal = (pid, { to, kind, data } = {}) => {
    const inst = instanceOf(pid)
    if (!inst) return { ok: false, error: "You're not in town." }
    if (!Number.isInteger(to)) return { ok: false, error: "Who to?" }
    return voice.signal(`t${inst.n}`, inst.people.get(pid).num, to, { kind, data })
  }

  const wire = (socket, current, who) => {
    const on = (event, handler) =>
      socket.on(event, (payload = {}, ack = () => {}) => {
        if (typeof ack !== "function") ack = () => {}
        const computer = current()
        if (!computer) return ack({ ok: false, error: "Not connected to the network." })
        const fail = (error) => {
          console.error(`[roam] ${event} failed`, error)
          ack({ ok: false, error: "Something went wrong. Please try again." })
        }
        try {
          const out = handler(who(computer), isObject(payload) ? payload : {})
          if (out && typeof out.then === "function") out.then((r) => ack(r || { ok: true }), fail)
          else ack(out || { ok: true })
        } catch (error) {
          fail(error)
        }
      })
    on("roam:join", (me, p) => join(me, p))
    on("roam:leave", (me) => leave(me.pid))
    on("roam:look", (me, p) => setLook(me.pid, p.look))
    on("roam:car", (me, p) => car(me.pid, p))
    on("roam:ride", (me, p) => ride(me.pid, p))
    on("roam:hop", (me, p) => hop(me.pid, p))
    on("roam:vc", (me, p) => voiceOn(me.pid, p.on))
    on("roam:sig", (me, p) => voiceSignal(me.pid, p))
    socket.on("roam:pos", (data) => {
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
    drop: (pid) => leave(pid),
    pos,
    setLook,
    car,
    ride,
    hop,
    tickets,
    voiceOn,
    voiceSignal,
    flush: (n) => {
      const inst = instances.get(n)
      if (inst) flush(inst)
    },
    instances,
    instanceOf: (pid) => instanceOf(pid)?.n ?? null,
    checkRate: () => {
      rateCheckedAt = 0
      return currentRate()
    },
    stats: () => ({ ...sent }),
    stop: () => {
      for (const inst of instances.values()) if (inst.timer) clock.clearInterval(inst.timer)
    },
  }
}

module.exports = { createRoam, cleanPos, cleanCar, pickInstance, rateFor, CAP, TOWNS, MOVED_CAP, RIDERS, BATCH_MS }
