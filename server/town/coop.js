// Sunny Acres co-op: one town that up to four people farm at the same time. The server keeps
// the real town and changes it only with the game's own rules (client/src/components/
// applets/town/game.js and coopRules.js, the same modules the browser runs). Players send
// intents ("harvest these fields"); each is checked, applied in the order it arrives, and
// everyone in the town gets a small patch of what changed, with a revision number.
//
// Who may come in: a couple's co-op town is always open to both partners (paired in Us);
// anyone else needs to be invited (98 Messenger / Network Neighborhood invitations, through
// server/net/games.js like Tetris Online and the Quiz Show) and is then a member for good,
// until they leave. Everyone must be signed on to 98 Messenger.
//
// Towns are saved in the town store (MongoDB, or memory): "coop:<id>". While nobody is in a
// town nothing runs for it; when someone comes back, the rules catch up from timestamps.
//
// Socket events (all with an ack), wired from server/net (the same connection as 98
// Messenger and Network Neighborhood):
//   coop:list                          -> { towns, partner, canConvert }
//   coop:create { kind, from, replace } -> { id }    kind: couple | group, from: new | convert
//   coop:join   { id }                  -> { town, state, rev, now, players, feed, stats, ach, you }
//   coop:leave  { id }
//   coop:act    { id, seq, it }         -> { ok, seq, rev, failed?, reason? } | { ok: false, seq, reason }
//   coop:cursor { id, u, v }            (no answer needed)
//   coop:sync   { id }                  -> the whole town again
//   coop:stats  { id }                  -> { stats, ach, feed } who did what, today and in all
//   coop:quit   { id }                  stop being a member (not for the couple themselves)
// Sent to the town: coop:patch { id, rev, now, from, by, seq, patch, ev, line, doing, done },
// coop:players { id, players, invited }, coop:cursor { id, pid, u, v }, coop:feed { id, item }.
// Members elsewhere get coop:nudge { id, by, name } on their 98 Messenger socket when someone
// starts farming.

const crypto = require("crypto")
const path = require("path")
const { pathToFileURL } = require("url")
const { normalize } = require("../aim/screenNames")

const TOWN_DIR = path.join(__dirname, "../../client/src/components/applets/town")
const load = (name) => import(pathToFileURL(path.join(TOWN_DIR, `${name}.js`)).href)
const R = { G: null, C: null }
const ready = Promise.all([load("game"), load("coopRules")]).then(([G, C]) => {
  R.G = G
  R.C = C
  return R
})
ready.catch((error) => console.error("[coop] couldn't load the game rules", error))

const DAY = 24 * 60 * 60_000
const KEEP_AFTER_UNPAIR_MS = 30 * DAY
const MAX_GROUP_TOWNS = 3 // co-op towns (besides the couple's) one person can belong to
const MAX_FEED = 40
const TOUCH_MS = 20_000 // how long "Bob already harvested that" is worth saying
const CURSOR = { burst: 15, perSec: 12 }
const NAME = /^[A-Za-z0-9 '!&.,-]{1,32}$/
const ID = /^[a-f0-9]{12}$/

const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10)
const coupleTownId = (coupleId) => crypto.createHash("sha1").update(`couple:${coupleId}`).digest("hex").slice(0, 12)
const newTownId = () => crypto.randomBytes(6).toString("hex")

// a token bucket: up to `burst` at once, then `perSec` a second
const bucket = (burst, perSec) => ({ tokens: burst, at: 0, burst, perSec })
const take = (b, now, n = 1) => {
  b.tokens = Math.min(b.burst, b.tokens + ((now - (b.at || now)) / 1000) * b.perSec)
  b.at = now
  if (b.tokens < n) return false
  b.tokens -= n
  return true
}

// service: the Sunny Acres service (./index.js createTown) for its store, clock, couples and
// players' own towns. emit(pid, event, payload) reaches one computer; who(pid) -> { pid, name, key }.
const createCoop = ({ emit = () => {}, who = () => null, service: serviceOrGetter = null, saveMs = 5000, tickMs = 1000, rate = null } = {}) => {
  const getService = typeof serviceOrGetter === "function" ? serviceOrGetter : () => serviceOrGetter
  const svc = () => {
    const s = getService()
    if (!s) throw new Error("Sunny Acres isn't running.")
    return s
  }
  const clock = () => svc().clock()
  const store = () => svc().getStore()
  const couples = () => svc().couples || null
  const coupleIdOf = (key) => svc().coupleIdOf(key)
  const coupleActive = (cid) => {
    const c = couples()
    try {
      return c?.isActiveCouple ? !!c.isActiveCouple(cid) : true
    } catch {
      return false
    }
  }
  const partnerName = (key) => {
    try {
      return couples()?.partnerOf?.(key) || null
    } catch {
      return null
    }
  }
  const BURST = rate?.burst ?? null
  const PER_SEC = rate?.perSec ?? null

  const rooms = new Map() // town id -> room, only while someone is in it
  const loading = new Map() // town id -> Promise(room)
  const roomOfPid = new Map() // pid -> town id
  const send = (pid, event, payload) => pid && emit(pid, event, payload)
  const toRoom = (room, event, payload, except = null) => {
    for (const pid of room.players.keys()) if (pid !== except) send(pid, event, payload)
  }

  // ---------- storage ----------

  const getDoc = async (id) => (ID.test(id) ? (await (await store()).get(`coop:${id}`)) || null : null)
  const putDoc = async (doc) => {
    doc.updatedAt = clock()
    await (await store()).put(doc)
  }
  const indexOf = async (key) => (await (await store()).get(`coopu:${key}`)) || { _id: `coopu:${key}`, ids: [] }
  const putIndex = async (idx) => {
    idx.updatedAt = clock()
    await (await store()).put(idx)
  }
  const addToIndex = async (key, id) => {
    const idx = await indexOf(key)
    if (!idx.ids.includes(id)) idx.ids.push(id)
    await putIndex(idx)
  }
  const dropFromIndex = async (key, id) => {
    const idx = await indexOf(key)
    idx.ids = idx.ids.filter((x) => x !== id)
    await putIndex(idx)
  }
  // couple towns, so they can be cleared away 30 days after a couple unpairs
  const registerCouple = async (id, coupleId) => {
    const s = await store()
    const reg = (await s.get("coopc:all")) || { _id: "coopc:all", towns: {} }
    reg.towns[id] = { coupleId, endedAt: reg.towns[id]?.endedAt || null }
    reg.updatedAt = clock()
    await s.put(reg)
  }
  const sweep = async () => {
    const s = await store()
    const reg = await s.get("coopc:all")
    if (!reg) return
    const t = clock()
    for (const [id, entry] of Object.entries(reg.towns)) {
      if (coupleActive(entry.coupleId)) entry.endedAt = null
      else if (!entry.endedAt) entry.endedAt = t
      else if (t - entry.endedAt > KEEP_AFTER_UNPAIR_MS && !rooms.has(id)) {
        await s.remove(`coop:${id}`)
        delete reg.towns[id]
      }
    }
    reg.updatedAt = t
    await s.put(reg)
  }
  const sweepTimer = setInterval(() => sweep().catch(() => {}), 12 * 60 * 60_000)
  sweepTimer.unref?.()

  // ---------- who may come in ----------

  const membersOf = (doc) => {
    const keys = new Set(doc.members.map((m) => m.key))
    return keys
  }
  const isMember = (doc, key) => {
    if (!key) return false
    if (doc.kind === "couple") {
      if (!coupleActive(doc.coupleId)) return false
      return coupleIdOf(key) === doc.coupleId || doc.members.some((m) => m.key === key)
    }
    return doc.members.some((m) => m.key === key)
  }
  const colorOf = (doc, key) => {
    const { COLORS } = R.C
    const k = doc.members.findIndex((m) => m.key === key)
    return COLORS[(k >= 0 ? k : doc.members.length) % COLORS.length]
  }
  const addMember = (doc, key, name) => {
    if (doc.members.some((m) => m.key === key)) return false
    doc.members.push({ key, name, at: clock() })
    return true
  }

  // ---------- views ----------

  const playerView = (p) => ({ pid: p.pid, name: p.name, color: p.color, cursor: p.cursor, doing: p.doing })
  const memberView = (doc, room) =>
    doc.members.map((m) => ({
      name: m.name,
      color: colorOf(doc, m.key),
      online: !!room && [...room.players.values()].some((p) => p.key === m.key),
    }))
  const townView = (doc, room = rooms.get(doc.id)) => {
    let level = 1
    try {
      level = JSON.parse(doc.state).level || 1
    } catch {
      level = 1
    }
    return { id: doc.id, name: doc.name, kind: doc.kind, members: memberView(doc, room), level, updatedAt: doc.updatedAt }
  }
  const publishPlayers = (room) => {
    toRoom(room, "coop:players", { id: room.id, players: [...room.players.values()].map(playerView), members: memberView(room.doc, room), invited: [...room.invited] })
  }

  // ---------- rooms: a town while people are in it ----------

  const openRoom = (id) => {
    if (rooms.has(id)) return Promise.resolve(rooms.get(id))
    if (loading.has(id)) return loading.get(id)
    const p = (async () => {
      await ready
      const doc = await getDoc(id)
      if (!doc) return null
      if (rooms.has(id)) return rooms.get(id)
      const { G } = R
      let s = null
      try {
        s = G.migrate(JSON.parse(doc.state))
      } catch {
        s = null
      }
      if (!s) s = R.C.newCoopTown(clock())
      // catch up on everything that happened while nobody was here
      G.tick(s, clock())
      G.drainEvents(s)
      const room = { id, doc, s, rev: doc.rev || 0, players: new Map(), invited: new Set(), touched: new Map(), saveTimer: null, dirty: false }
      rooms.set(id, room)
      startTicking()
      return room
    })().finally(() => loading.delete(id))
    loading.set(id, p)
    return p
  }

  const save = async (room) => {
    clearTimeout(room.saveTimer)
    room.saveTimer = null
    if (!room.dirty) return
    room.dirty = false
    room.doc.state = R.G.serialize(room.s)
    room.doc.rev = room.rev
    try {
      await putDoc(room.doc)
    } catch (error) {
      room.dirty = true
      console.error("[coop] couldn't save", error.message)
    }
  }
  const markDirty = (room) => {
    room.dirty = true
    if (!room.saveTimer) {
      room.saveTimer = setTimeout(() => save(room), saveMs)
      room.saveTimer.unref?.()
    }
  }
  const closeRoom = async (room) => {
    if (rooms.get(room.id) !== room) return
    rooms.delete(room.id)
    await save(room)
    if (!rooms.size) stopTicking()
  }

  // ---------- time passing (only for towns somebody is in) ----------

  let ticker = null
  const tickRoom = (room) => {
    const { C, G } = R
    const before = C.snapshotOf(room.s)
    const now = clock()
    G.tick(room.s, now)
    const ev = G.drainEvents(room.s)
    const patch = C.diffState(before, room.s)
    if (!patch && !ev.length) return
    room.rev++
    markDirty(room)
    checkAchievements(room, ev)
    toRoom(room, "coop:patch", { id: room.id, rev: room.rev, now, from: null, patch, ev })
  }
  const startTicking = () => {
    if (ticker || !tickMs) return
    ticker = setInterval(() => {
      for (const room of rooms.values()) if (room.players.size) tickRoom(room)
    }, tickMs)
    ticker.unref?.()
  }
  const stopTicking = () => {
    clearInterval(ticker)
    ticker = null
  }

  // ---------- achievements and stats ----------

  const checkAchievements = (room, ev) => {
    const { C } = R
    const doc = room.doc
    doc.ach ||= []
    const have = new Set(doc.ach.map((a) => a.id))
    const online = new Set([...room.players.values()].map((p) => p.key)).size
    for (const id of C.earned(room.s, doc.stats, online)) {
      if (have.has(id)) continue
      const a = C.COOP_ACHIEVEMENTS.find((x) => x.id === id)
      doc.ach.push({ id, at: clock() })
      ev.push({ type: "coop-ach", id, name: a?.name || id, text: a?.text || "" })
      markDirty(room)
    }
  }
  const addStats = (room, player, add) => {
    if (!Object.keys(add).length) return
    const doc = room.doc
    doc.stats ||= {}
    const day = utcDay(clock())
    const st = (doc.stats[player.key] ||= { name: player.name, day, today: {}, total: {} })
    st.name = player.name
    if (st.day !== day) {
      st.day = day
      st.today = {}
    }
    for (const [k, n] of Object.entries(add)) {
      st.today[k] = (st.today[k] || 0) + n
      st.total[k] = (st.total[k] || 0) + n
    }
  }
  const statsView = (doc) => {
    const day = utcDay(clock())
    return Object.values(doc.stats || {}).map((st) => ({ name: st.name, today: st.day === day ? st.today : {}, total: st.total }))
  }

  // ---------- the socket API ----------

  const requireKey = (me) => {
    if (!me?.key) return { ok: false, error: "Sign on to 98 Messenger to farm together." }
    return null
  }

  const list = async (me) => {
    const no = requireKey(me)
    if (no) return no
    await ready
    const out = []
    const cid = coupleIdOf(me.key)
    const partner = partnerName(me.key)
    if (cid) {
      const doc = await getDoc(coupleTownId(cid))
      if (doc) out.push(townView(doc))
    }
    const idx = await indexOf(me.key)
    for (const id of idx.ids) {
      if (out.some((t) => t.id === id)) continue
      const doc = await getDoc(id)
      if (doc && isMember(doc, me.key)) out.push(townView(doc))
    }
    const own = await svc().load(me.key)
    return { ok: true, towns: out, partner, coupleTown: cid ? coupleTownId(cid) : null, canConvert: !!own?.snap }
  }

  const create = async (me, { kind, from, replace, name }) => {
    const no = requireKey(me)
    if (no) return no
    await ready
    const { G, C } = R
    const t = clock()
    let id
    let doc = null
    let partner = null
    if (kind === "couple") {
      const cid = coupleIdOf(me.key)
      if (!cid) return { ok: false, error: "Pair up with your partner in Us first. ♥" }
      partner = partnerName(me.key)
      id = coupleTownId(cid)
      const old = await getDoc(id)
      if (old && !replace) return { ok: false, exists: true, id, error: "You already have a co-op town together." }
      const room = rooms.get(id)
      if (old && room && [...room.players.values()].some((p) => p.key !== me.key)) return { ok: false, error: `${[...room.players.values()].find((p) => p.key !== me.key).name} is farming there right now. Start over together when you're both out.` }
      if (room) {
        for (const pid of [...room.players.keys()]) leave(pid, id, { quiet: true })
        await closeRoom(room)
      }
      doc = old ? { ...old } : null
    } else if (kind === "group") {
      const idx = await indexOf(me.key)
      const live = []
      for (const x of idx.ids) {
        const d = await getDoc(x)
        if (d && d.kind === "group" && isMember(d, me.key)) live.push(x)
      }
      if (live.length >= MAX_GROUP_TOWNS) return { ok: false, error: `You're already in ${MAX_GROUP_TOWNS} co-op towns. Leave one first.` }
      id = newTownId()
    } else return { ok: false, error: "What kind of co-op town?" }

    let s = null
    if (from === "convert") {
      const own = await svc().load(me.key)
      try {
        s = own?.snap ? G.migrate(JSON.parse(own.snap)) : null
      } catch {
        s = null
      }
      if (!s) return { ok: false, error: "Your town isn't saved in the cloud yet. Play a moment, then try again." }
      // things that belong to one player's town, not a shared one
      delete s.claimed
      delete s.rev
      s.tut = Math.max(s.tut || 0, 6)
      G.tick(s, t)
      G.drainEvents(s)
    } else s = C.newCoopTown(t)
    if (kind === "couple" && partner) G.setPartner(s, partner)
    G.drainEvents(s)

    const townName = typeof name === "string" && NAME.test(name.trim()) ? name.trim() : kind === "couple" ? "Our Co-op Town" : `${me.name}'s Co-op Town`
    doc = {
      _id: `coop:${id}`,
      id,
      kind,
      coupleId: kind === "couple" ? coupleIdOf(me.key) : null,
      name: townName,
      owner: me.key,
      members: doc?.members?.filter((m) => m.key !== me.key) || [],
      state: G.serialize(s),
      rev: (doc?.rev || 0) + 1,
      stats: {},
      ach: [],
      feed: [],
      createdAt: t,
    }
    doc.members.unshift({ key: me.key, name: me.name, at: t })
    if (kind === "couple" && partner) {
      const pk = normalize(partner)
      if (!doc.members.some((m) => m.key === pk)) doc.members.splice(1, 0, { key: pk, name: partner, at: t })
      await registerCouple(id, doc.coupleId)
    }
    await putDoc(doc)
    for (const m of doc.members) await addToIndex(m.key, id)
    return { ok: true, id, town: townView(doc) }
  }

  const fullState = (room) => R.G.serialize(room.s)

  const join = async (me, { id }) => {
    const no = requireKey(me)
    if (no) return no
    if (typeof id !== "string" || !ID.test(id)) return { ok: false, error: "There's no co-op town like that." }
    const doc = rooms.get(id)?.doc || (await getDoc(id))
    if (!doc) return { ok: false, error: "That co-op town is gone." }
    if (!isMember(doc, me.key)) return { ok: false, private: true, error: "This co-op town is private. Ask someone who farms there to invite you." }
    const room = await openRoom(id)
    if (!room) return { ok: false, error: "That co-op town is gone." }
    // one co-op town at a time per computer
    const prev = roomOfPid.get(me.pid)
    if (prev && prev !== id) leave(me.pid, prev)
    // a couple partner (or an old member) joins the member list the first time they come
    if (addMember(room.doc, me.key, me.name)) {
      markDirty(room)
      addToIndex(me.key, id).catch(() => {})
    }
    const member = room.doc.members.find((m) => m.key === me.key)
    if (member && member.name !== me.name) member.name = me.name
    const fresh = !room.players.has(me.pid)
    const player = room.players.get(me.pid) || {
      pid: me.pid,
      key: me.key,
      name: me.name,
      color: colorOf(room.doc, me.key),
      cursor: null,
      doing: null,
      acts: bucket(BURST ?? R.C.BURST, PER_SEC ?? R.C.RATE),
      cursors: bucket(CURSOR.burst, CURSOR.perSec),
    }
    room.players.set(me.pid, player)
    roomOfPid.set(me.pid, id)
    room.invited.delete(me.name)
    if (fresh) {
      const ev = []
      checkAchievements(room, ev)
      if (ev.length) {
        room.rev++
        toRoom(room, "coop:patch", { id, rev: room.rev, now: clock(), from: null, patch: null, ev }, me.pid)
      }
      pushFeed(room, { text: `${me.name} came to farm! ♥`, color: player.color })
      // the other members (online elsewhere) hear that someone's farming
      const inRoom = new Set([...room.players.values()].map((p) => p.key))
      for (const m of room.doc.members) {
        if (!inRoom.has(m.key)) {
          try {
            svc().emitTo?.(m.key, "coop:nudge", { id, by: me.name, name: room.doc.name })
          } catch {
            // they'll see it next time
          }
        }
      }
    }
    publishPlayers(room)
    return {
      ok: true,
      town: townView(room.doc, room),
      state: fullState(room),
      rev: room.rev,
      now: clock(),
      players: [...room.players.values()].map(playerView),
      members: memberView(room.doc, room),
      invited: [...room.invited],
      feed: room.doc.feed || [],
      stats: statsView(room.doc),
      ach: achView(room.doc),
      you: { pid: me.pid, color: player.color, canQuit: room.doc.kind === "group" || coupleIdOf(me.key) !== room.doc.coupleId },
    }
  }

  const pushFeed = (room, entry) => {
    const doc = room.doc
    doc.feed ||= []
    const item = { at: clock(), ...entry }
    doc.feed.push(item)
    if (doc.feed.length > MAX_FEED) doc.feed.splice(0, doc.feed.length - MAX_FEED)
    markDirty(room)
    toRoom(room, "coop:feed", { id: room.id, item })
  }

  const leave = (pid, id, { quiet = false } = {}) => {
    const room = rooms.get(id)
    const player = room?.players.get(pid)
    if (roomOfPid.get(pid) === id) roomOfPid.delete(pid)
    if (!player) return { ok: true }
    room.players.delete(pid)
    if (!quiet) {
      if (![...room.players.values()].some((p) => p.key === player.key)) pushFeed(room, { text: `${player.name} went home.`, color: player.color })
      publishPlayers(room)
    }
    if (!room.players.size) closeRoom(room).catch(() => {})
    return { ok: true }
  }

  // why an intent (or part of a batch) didn't work, in friendly words
  const whyNot = (room, me, it, r) => {
    const { G, C } = R
    const t = clock()
    const recent = (k) => {
      const x = room.touched.get(k)
      return x && x.key !== me.key && t - x.at < TOUCH_MS ? x : null
    }
    if (C.isBatch(it.a) || it.a === "collectGoods" || it.a === "sell" || it.a === "move") {
      for (const id of r.failed || []) {
        const x = recent(id)
        if (!x) continue
        if (!G.objById(room.s, id)) return `${x.name} already ${x.a === "sell" ? "sold" : "moved"} that.`
        return `Already ${C.DONE_WORDS[x.a] || "done"} by ${x.name}`
      }
    }
    if (it.a === "deliver") {
      const x = recent(`o${it.i}`)
      if (x) return `${x.name} already delivered that order!`
    }
    if (it.a === "load") {
      const x = recent(`c${it.k}`)
      if (x) return `${x.name} already loaded that car!`
    }
    if (it.a === "send" && recent("train")) return `${recent("train").name} already sent the train off!`
    if ((it.a === "build" || it.a === "move") && r.reason === "It doesn't fit there.") {
      for (let dy = 0; dy < 3; dy++)
        for (let dx = 0; dx < 3; dx++) {
          const o = G.occupant(room.s, it.x + dx, it.y + dy, it.id)
          const x = o && recent(o.i)
          if (x) return `${x.name} just built there!`
        }
    }
    return r.reason
  }

  const act = (me, { id, seq, it: raw }) => {
    const { G, C } = R
    const room = typeof id === "string" && rooms.get(id)
    const player = room && room.players.get(me.pid)
    const n = Number.isInteger(seq) ? seq : null
    if (!player) return { ok: false, seq: n, reason: "Join the town first.", gone: true }
    let size = 0
    try {
      size = JSON.stringify(raw ?? null).length
    } catch {
      size = Infinity
    }
    if (size > C.MAX_INTENT_BYTES) return { ok: false, seq: n, reason: "That's too much at once." }
    const now = clock()
    if (!take(player.acts, now)) return { ok: false, seq: n, reason: "Whoa, slow down a little!", slow: true }
    const it = C.checkIntent(raw)
    if (!it) return { ok: false, seq: n, reason: "That doesn't look right." }

    // time passes first, so everyone agrees on what's ripe
    tickRoom(room)
    const before = C.snapshotOf(room.s)
    const objsBefore = { objs: room.s.objs.slice() }
    const r = C.applyIntent(room.s, it, now, { slack: C.SLACK_MS })
    if (!r.ok) return { ok: false, seq: n, reason: whyNot(room, me, it, r) }

    room.rev++
    const ev = G.drainEvents(room.s)
    const patch = C.diffState(before, room.s)
    // remember who touched what, to explain conflicts kindly
    const touch = { key: me.key, name: me.name, a: it.a, at: now }
    for (const x of r.done) room.touched.set(x, touch)
    if (it.a === "build" && r.id) room.touched.set(r.id, touch)
    if (it.a === "deliver") room.touched.set(`o${it.i}`, touch)
    if (it.a === "load") room.touched.set(`c${it.k}`, touch)
    if (it.a === "send") room.touched.set("train", touch)
    if (room.touched.size > 400) for (const [k, x] of room.touched) if (now - x.at > TOUCH_MS) room.touched.delete(k)

    addStats(room, player, C.statsFor(it, r))
    checkAchievements(room, ev)
    player.doing = C.doing(it, room.s)
    const line = C.describe(me.name, it, r, objsBefore)
    const item = { at: now, text: line, color: player.color }
    room.doc.feed ||= []
    room.doc.feed.push(item)
    if (room.doc.feed.length > MAX_FEED) room.doc.feed.splice(0, room.doc.feed.length - MAX_FEED)
    markDirty(room)
    toRoom(room, "coop:patch", { id, rev: room.rev, now, from: me.pid, by: me.name, color: player.color, seq: n, patch, ev, line: item, doing: player.doing, a: it.a, done: it.a === "build" && r.id ? [r.id] : r.done.slice(0, C.MAX_IDS) })
    const out = { ok: true, seq: n, rev: room.rev, now }
    if (r.failed?.length) {
      out.failed = r.failed
      out.reason = whyNot(room, me, it, r)
    }
    return out
  }

  const statsOf = (me, { id }) => {
    const room = typeof id === "string" && rooms.get(id)
    if (!room || !room.players.has(me.pid)) return { ok: false, error: "Join the town first.", gone: true }
    return { ok: true, stats: statsView(room.doc), ach: achView(room.doc), feed: room.doc.feed || [] }
  }
  const achView = (doc) => (doc.ach || []).map((a) => ({ ...a, ...(R.C.COOP_ACHIEVEMENTS.find((x) => x.id === a.id) || {}) }))

  const sync = (me, { id }) => {
    const room = typeof id === "string" && rooms.get(id)
    if (!room || !room.players.has(me.pid)) return { ok: false, error: "Join the town first.", gone: true }
    return { ok: true, state: fullState(room), rev: room.rev, now: clock() }
  }

  const cursor = (me, { id, u, v }) => {
    const room = typeof id === "string" && rooms.get(id)
    const player = room?.players.get(me.pid)
    if (!player) return { ok: false }
    const x = Number(u)
    const y = Number(v)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false }
    if (!take(player.cursors, clock())) return { ok: false }
    player.cursor = { u: Math.round(Math.max(0, Math.min(30, x)) * 100) / 100, v: Math.round(Math.max(0, Math.min(30, y)) * 100) / 100 }
    toRoom(room, "coop:cursor", { id, pid: me.pid, ...player.cursor }, me.pid)
    return { ok: true }
  }

  const quit = async (me, { id }) => {
    const no = requireKey(me)
    if (no) return no
    const doc = rooms.get(id)?.doc || (await getDoc(id))
    if (!doc || !doc.members.some((m) => m.key === me.key)) return { ok: true }
    if (doc.kind === "couple" && coupleIdOf(me.key) === doc.coupleId) return { ok: false, error: "This is your town together. It stays as long as you're a couple." }
    const room = rooms.get(id)
    for (const p of [...(room?.players.values() || [])]) if (p.key === me.key) leave(p.pid, id)
    doc.members = doc.members.filter((m) => m.key !== me.key)
    await dropFromIndex(me.key, id)
    if (doc.kind === "group" && !doc.members.length) {
      await (await store()).remove(`coop:${id}`)
      return { ok: true, removed: true }
    }
    if (room) {
      markDirty(room)
      publishPlayers(room)
    } else await putDoc(doc)
    return { ok: true }
  }

  // ---------- Delete My Account (server/account) ----------

  // They leave every co-op town they're in; the couple's town (coupleIds: every couple they
  // were in) and a group town left with nobody are deleted. Their stats and feed lines go.
  const eraseAccount = async ({ key, screenName = "", coupleIds = [] }) => {
    const s = await store()
    const ids = new Set((await indexOf(key)).ids)
    for (const cid of coupleIds) ids.add(coupleTownId(cid))
    const said = (text) => !!screenName && String(text || "").toLowerCase().includes(screenName.toLowerCase())
    let left = 0
    let removed = 0
    for (const id of ids) {
      const room = rooms.get(id)
      const doc = room?.doc || (await getDoc(id))
      if (!doc) continue
      const gone = (doc.kind === "couple" && coupleIds.includes(doc.coupleId)) || (doc.kind === "group" && !doc.members.some((m) => m.key !== key))
      if (gone) {
        if (room) {
          clearTimeout(room.saveTimer)
          rooms.delete(id)
          for (const pid of room.players.keys()) {
            roomOfPid.delete(pid)
            send(pid, "coop:gone", { id })
          }
        }
        await s.remove(`coop:${id}`)
        removed++
        continue
      }
      if (room) for (const p of [...room.players.values()]) if (p.key === key) leave(p.pid, id, { quiet: true })
      doc.members = doc.members.filter((m) => m.key !== key)
      if (doc.stats) delete doc.stats[key]
      doc.feed = (doc.feed || []).filter((f) => !said(f.text))
      if (rooms.get(id)) {
        markDirty(rooms.get(id))
        publishPlayers(rooms.get(id))
      } else await putDoc(doc)
      left++
    }
    await s.remove(`coopu:${key}`)
    const reg = await s.get("coopc:all")
    if (reg && Object.values(reg.towns).some((t) => coupleIds.includes(t.coupleId))) {
      for (const [id, t] of Object.entries(reg.towns)) if (coupleIds.includes(t.coupleId)) delete reg.towns[id]
      reg.updatedAt = clock()
      await s.put(reg)
    }
    return { left, removed }
  }

  // ---------- invitations (server/net/games.js) ----------

  const roomOf = (pid) => roomOfPid.get(pid) || null
  const seats = (doc) => new Set(membersOf(doc)).size
  const canInvite = (pid, id) => {
    const room = rooms.get(id)
    if (!room || !room.players.has(pid)) return { ok: false, error: "Open your co-op town in Sunny Acres first, then invite someone." }
    if (seats(room.doc) + room.invited.size >= R.C.MAX_PLAYERS) return { ok: false, error: `A co-op town has room for ${R.C.MAX_PLAYERS} farmers.` }
    return { ok: true, name: room.doc.name }
  }
  const invitedTo = (id, name) => {
    const room = rooms.get(id)
    if (!room) return
    room.invited.add(name)
    publishPlayers(room)
  }
  const inviteEnded = (id, name) => {
    const room = rooms.get(id)
    if (room && room.invited.delete(name)) publishPlayers(room)
  }
  const allow = (pid, id) => {
    const room = rooms.get(id)
    if (!room) return { ok: false, error: "That co-op town has closed. Ask them to invite you again." }
    const me = who(pid)
    if (!me?.key) return { ok: false, error: "Sign on to 98 Messenger to farm together." }
    if (!room.doc.members.some((m) => m.key === me.key)) {
      if (seats(room.doc) >= R.C.MAX_PLAYERS) return { ok: false, error: "That co-op town is full." }
      addMember(room.doc, me.key, me.name)
      room.invited.delete(me.name)
      markDirty(room)
      addToIndex(me.key, id).catch(() => {})
      publishPlayers(room)
    }
    return { ok: true, townCoop: id }
  }

  const playersOf = (id) => {
    const room = rooms.get(id)
    return room ? [...room.players.keys()] : null
  }
  const drop = (pid) => {
    const id = roomOfPid.get(pid)
    if (id) leave(pid, id)
  }

  // ---------- sockets ----------

  // current(): this socket's computer or null; whoOf(computer): { pid, name, key }
  const wire = (socket, current, whoOf) => {
    const on = (event, handler) =>
      socket.on(event, (payload = {}, ack = () => {}) => {
        if (typeof ack !== "function") ack = () => {}
        const computer = current()
        if (!computer) return ack({ ok: false, error: "Not connected to the network." })
        let result
        try {
          result = handler(whoOf(computer), payload && typeof payload === "object" ? payload : {})
        } catch (error) {
          console.error(`[coop] ${event} failed`, error)
          return ack({ ok: false, error: "Something went wrong. Please try again." })
        }
        Promise.resolve(result)
          .then((value) => ack(value || { ok: true }))
          .catch((error) => {
            console.error(`[coop] ${event} failed`, error)
            ack({ ok: false, error: "The 98ish server isn't answering. Please try again in a minute." })
          })
      })
    on("coop:list", (me) => list(me))
    on("coop:create", (me, p) => create(me, { kind: String(p.kind || ""), from: p.from === "convert" ? "convert" : "new", replace: p.replace === true, name: p.name }))
    on("coop:join", (me, p) => join(me, { id: String(p.id || "") }))
    on("coop:leave", (me, p) => leave(me.pid, String(p.id || "")))
    on("coop:act", (me, p) => (R.C ? act(me, p) : { ok: false, reason: "Still starting up." }))
    on("coop:sync", (me, p) => sync(me, { id: String(p.id || "") }))
    on("coop:stats", (me, p) => statsOf(me, { id: String(p.id || "") }))
    on("coop:cursor", (me, p) => cursor(me, p))
    on("coop:quit", (me, p) => quit(me, { id: String(p.id || "") }))
  }

  return {
    ready,
    wire,
    // straight calls (tests, and the socket handlers above)
    list,
    create,
    join,
    leave,
    act,
    sync,
    stats: statsOf,
    cursor,
    quit,
    sweep,
    eraseAccount,
    // games.js room app
    rooms,
    roomOf,
    canInvite,
    invitedTo,
    inviteEnded,
    allow,
    playersOf,
    drop,
    setAway: () => {},
    busy: () => false,
    flush: async () => {
      for (const room of rooms.values()) await save(room)
    },
    close: () => {
      stopTicking()
      clearInterval(sweepTimer)
      for (const room of rooms.values()) clearTimeout(room.saveTimer)
    },
    coupleTownId,
  }
}

module.exports = { createCoop, coupleTownId, ready }
