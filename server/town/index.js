// Sunny Acres together: towns saved in the cloud, visits, help requests, gifts and the
// couple's weekly goal. Every request needs a signed-on 98 Messenger session
// (Authorization: Bearer, see ../aim/auth.js).
//
//   GET    /api/town/me                      my town (snapshot + savedAt), notes, hearts, help
//                                            requests, mailbox, changes waiting, the joint goal
//   PUT    /api/town/me                      { snap, base, force? } save (409 when the cloud
//                                            copy changed since `base`, unless force)
//   PUT    /api/town/settings                { allowBuddies }
//   GET    /api/town/friends                 whose towns I can visit (partner, buddies)
//   GET    /api/town/visit/:name             a friend's town, read only
//   POST   /api/town/visit/:name/heart       { obj } like (or unlike) a building
//   POST   /api/town/visit/:name/notes       { text, x, y } leave a little sign
//   DELETE /api/town/visit/:name/notes/:id   take back my sign
//   DELETE /api/town/notes/:id               the owner clears a sign from their town
//   POST   /api/town/requests                { kind: "order" | "car", slot } ask friends for help
//   DELETE /api/town/requests/:id
//   POST   /api/town/visit/:name/help/:id    fill a friend's request from my Barn
//   POST   /api/town/gifts                   { goods } or { decor }, + note: a gift for my partner
//   POST   /api/town/mailbox/:id/open        open a gift
//
// Who can visit: your partner (paired in Us) always; buddies only when the owner turns on
// "Let buddies visit" AND has them on their Buddy List; anyone else gets 403.
//
// The browser's copy of a town is the real one: the server never edits a snapshot. What
// others do for you arrives as "effects" (ids the game applies once and lists in
// snap.claimed); they wait here until a saved snapshot says it has them. A helper's Barn is
// checked against their latest saved snapshot minus what's already promised away, and each
// help or gift runs alone (one at a time on this server), so a request can't be filled twice
// and goods can't be given twice.
//
// Live: the owner's 98 Messenger socket gets town:visitor { name, arrived | u, v | leave }
// while someone walks around their town, and town:news { type, by } when something
// changes (a note, a heart, help, a gift, the goal).

const crypto = require("crypto")
const express = require("express")
const { limiter } = require("../net/limiter")
const { sessionFrom } = require("../aim/auth")
const { validate, normalize } = require("../aim/screenNames")
const { checkText } = require("../gamechat")
const { memoryStore, createTownStore } = require("./store")
const { DELETED_NAME } = require("../account")
const { ready, rules, checkSnapshot, summary, Invalid, fail, MAX_BYTES } = require("./snapshot")

let couplesModule = null
try {
  couplesModule = require("../couples")
} catch {
  couplesModule = null
}

const DAY = 24 * 60 * 60_000
const WEEK = 7 * DAY
const EFFECT_TTL = 30 * DAY
const MAX_REQUESTS = 3
const MAX_NOTES = 30
const NOTES_PER_VISITOR = 3
const MAX_NOTE = 80
const MAX_GIFT_NOTE = 120
const GIFTS_PER_DAY = 3
const MAX_MAILBOX = 30
const MAX_HEARTS_PER_OBJ = 50
const MAX_BUDDIES = 60

const newId = () => crypto.randomBytes(9).toString("hex")
const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10)
// weeks start on Monday (UTC)
const weekStart = (ms) => {
  const d = new Date(ms)
  const day = (d.getUTCDay() + 6) % 7
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - day * DAY
}

class Refused extends Error {
  constructor(status, message, extra = {}) {
    super(message)
    this.status = status
    this.extra = extra
  }
}
const refuse = (status, message, extra) => {
  throw new Refused(status, message, extra)
}

const blankDoc = (key, name) => ({
  _id: `u:${key}`,
  key,
  name,
  snap: null,
  savedAt: 0,
  level: 1,
  allowBuddies: false,
  hearts: {},
  notes: [],
  requests: [],
  effects: [],
  mailbox: [],
  giftDay: "",
  giftsToday: 0,
  lastHarvests: null,
  stats: { helped: 0, gifts: 0 },
  updatedAt: 0,
})

// ---------- the service ----------

const createTown = ({ store: storeOrPromise, aim: initialAim = null, couples = couplesModule, now = Date.now, testClock = false } = {}) => {
  let aim = initialAim
  let offset = 0
  const clock = () => now() + offset

  let storePromise = null
  const getStore = () => (storePromise ??= Promise.resolve(storeOrPromise || createTownStore()))

  // one change at a time: helping, gifting and saving read and write two towns
  let chain = Promise.resolve()
  const serial = (fn) => {
    const run = chain.then(fn)
    chain = run.catch(() => {})
    return run
  }

  const partnerKeyOf = (key) => {
    try {
      const name = couples?.partnerOf?.(key)
      return name ? normalize(name) : null
    } catch {
      return null
    }
  }
  const coupleIdOf = (key) => {
    try {
      return couples?.coupleIdOf?.(key) || null
    } catch {
      return null
    }
  }

  const load = async (key, name = key) => {
    const doc = await (await getStore()).get(`u:${key}`)
    return doc ? { ...blankDoc(key, name), ...doc } : blankDoc(key, name)
  }
  const put = async (doc) => {
    doc.updatedAt = clock()
    await (await getStore()).put(doc)
  }

  // old weeks' goals are cleared away now and then
  const sweepTimer = setInterval(async () => {
    try {
      await (await getStore()).removeOlder("g:", clock() - 5 * WEEK)
    } catch {
      // next time
    }
  }, 12 * 60 * 60_000)
  sweepTimer.unref?.()

  const socketOf = (key) => aim?.sessions?.get(key)?.socket || null
  const emitTo = (key, event, payload) => socketOf(key)?.emit(event, payload)

  // changes for this player that their saved town doesn't have yet
  const pending = (doc, sum = doc.snap ? summary(doc.snap) : null) => {
    const claimed = sum?.claimed || new Set()
    return doc.effects.filter((e) => !claimed.has(e.id))
  }
  // what a player can give: their saved Barn, minus what they've already promised away
  const available = (doc) => {
    const sum = summary(doc.snap)
    if (!sum) return null
    const goods = { ...sum.goods }
    let coins = sum.coins
    for (const e of pending(doc, sum)) {
      if (e.kind !== "helped" && e.kind !== "gave") continue
      for (const [g, n] of Object.entries(e.goods || {})) goods[g] = (goods[g] || 0) - n
      coins -= e.kind === "gave" ? e.coins || 0 : 0
    }
    return { goods, coins, level: sum.level }
  }

  // "partner", "buddy" or null: may `viewer` visit `owner`'s town?
  const relation = async (viewerKey, ownerKey, ownerDoc) => {
    if (viewerKey === ownerKey) return "self"
    if (partnerKeyOf(viewerKey) === ownerKey) return "partner"
    if (!ownerDoc?.allowBuddies) return null
    const user = await aim?.store?.find(ownerKey)
    if (!user || (user.blocked || []).includes(viewerKey)) return null
    const buddies = (user.groups || []).flatMap((g) => g.buddies || []).map(normalize)
    return buddies.includes(viewerKey) ? "buddy" : null
  }

  // the town behind /visit/:name, if this session may see it
  const visitable = async (session, name) => {
    const target = validate(name)
    if (target.error) refuse(404, "There's no one by that name.")
    if (target.key === session.key) refuse(400, "That's your own town!")
    const user = await aim?.store?.find(target.key)
    if (!user) refuse(404, `${target.screenName} isn't a 98 Messenger screen name.`)
    const doc = await load(target.key, user.screenName)
    const rel = await relation(session.key, target.key, doc)
    if (!rel) refuse(403, `${user.screenName}'s Sunny Acres is private. Partners can always visit; buddies can when ${user.screenName} lets them.`)
    if (!doc.snap) refuse(404, `${user.screenName} hasn't saved a Sunny Acres town yet.`)
    doc.name = user.screenName
    return { doc, rel, owner: user }
  }

  // ---------- the couple's weekly goal ----------

  const goalId = (coupleId, ms) => `g:${coupleId}:${weekStart(ms)}`
  const goalView = async (key) => {
    const coupleId = coupleIdOf(key)
    const partner = partnerKeyOf(key)
    if (!coupleId || !partner) return null
    const t = clock()
    const goal = (await (await getStore()).get(goalId(coupleId, t))) || { progress: {}, rewarded: false }
    const { GOAL_TARGET, GOAL_REWARD } = rules.G
    const mine = goal.progress[key] || 0
    const theirs = goal.progress[partner] || 0
    return { week: weekStart(t), endsAt: weekStart(t) + WEEK, target: GOAL_TARGET, mine, theirs, total: mine + theirs, done: !!goal.rewarded, reward: GOAL_REWARD }
  }
  const addGoal = async (key, n) => {
    const coupleId = coupleIdOf(key)
    const partner = partnerKeyOf(key)
    if (!coupleId || !partner || n <= 0) return
    const store = await getStore()
    const t = clock()
    const id = goalId(coupleId, t)
    const goal = (await store.get(id)) || { _id: id, progress: {}, rewarded: false }
    goal.progress[key] = (goal.progress[key] || 0) + n
    const total = Object.values(goal.progress).reduce((a, b) => a + b, 0)
    const { GOAL_TARGET, GOAL_REWARD } = rules.G
    let finished = false
    if (total >= GOAL_TARGET && !goal.rewarded) {
      goal.rewarded = true
      finished = true
    }
    goal.updatedAt = t
    await store.put(goal)
    if (finished) {
      for (const k of [key, partner]) {
        const doc = await load(k)
        doc.effects.push({ id: newId(), kind: "goal", ...GOAL_REWARD, week: weekStart(t), at: t })
        await put(doc)
      }
    }
    for (const k of [key, partner]) emitTo(k, "town:news", { type: finished ? "goal-done" : "goal" })
  }

  // Delete My Account (server/account): their town; the couple's weekly goals; in everyone
  // else's town their hearts and signs go, and help or gifts they gave read "(deleted
  // account)" (the goods stay: they're part of that person's game now; a gift's note goes)
  const eraseAccount = async ({ key, coupleIds = [] }) =>
    serial(async () => {
      const store = await getStore()
      await store.remove(`u:${key}`)
      for (const cid of coupleIds) for (const goal of await store.scan(`g:${cid}:`)) await store.remove(goal._id)
      const named = (name) => !!name && normalize(name) === key
      let towns = 0
      for (const doc of await store.scan("u:")) {
        let changed = false
        for (const [obj, keys] of Object.entries(doc.hearts || {})) {
          if (!keys.includes(key)) continue
          doc.hearts[obj] = keys.filter((k) => k !== key)
          changed = true
        }
        const notes = (doc.notes || []).filter((n) => n.by !== key)
        if (notes.length !== (doc.notes || []).length) {
          doc.notes = notes
          changed = true
        }
        for (const gift of doc.mailbox || []) {
          if (gift.from !== key && !named(gift.fromName)) continue
          Object.assign(gift, { from: null, fromName: DELETED_NAME, note: "" })
          changed = true
        }
        for (const r of doc.requests || []) {
          if (!named(r.byName)) continue
          r.byName = DELETED_NAME
          changed = true
        }
        for (const e of doc.effects || []) {
          for (const field of ["by", "from"]) {
            if (!named(e[field])) continue
            e[field] = DELETED_NAME
            changed = true
          }
        }
        if (changed) {
          await put(doc)
          towns++
        }
      }
      for (const [visitor, owner] of visits) if (visitor === key || owner === key) visits.delete(visitor)
      return { towns }
    })

  const visits = new Map() // visitor key -> owner key, while they walk around

  return {
    eraseAccount,
    couples,
    clock,
    setOffset: (ms) => (offset = ms),
    testClock,
    getStore,
    serial,
    load,
    put,
    pending,
    available,
    relation,
    visitable,
    partnerKeyOf,
    coupleIdOf,
    goalView,
    addGoal,
    emitTo,
    socketOf,
    getAim: () => aim,
    useAim: (value) => (aim = value),
    visits,
  }
}

// ---------- views ----------

const noteView = (n, me) => ({ id: n.id, by: n.byName, mine: n.by === me, text: n.text, x: n.x, y: n.y, at: n.at })
const requestView = (r) => ({ id: r.id, kind: r.kind, slot: r.slot, need: r.need, at: r.at, status: r.status, by: r.byName || null, filledAt: r.filledAt || null })
const giftView = (g) => ({ id: g.id, from: g.fromName, goods: g.goods || null, decor: g.decor || null, note: g.note || "", at: g.at, openedAt: g.openedAt || null })
const heartCounts = (hearts, me) => {
  const counts = {}
  const mine = []
  for (const [obj, keys] of Object.entries(hearts || {})) {
    if (!keys.length) continue
    counts[obj] = keys.length
    if (keys.includes(me)) mine.push(Number(obj))
  }
  return { counts, mine }
}

// ---------- checks ----------

const cleanNote = (text, max) => {
  if (typeof text !== "string") fail("Write something first.")
  const checked = checkText(text)
  if (!checked.ok) fail(checked.error)
  if (checked.text.length > max) fail(`Keep it to ${max} characters.`)
  return checked.masked || checked.text
}

// ---------- HTTP ----------

const townRouter = ({ service = defaultService(), limits = {} } = {}) => {
  const reads = limiter(limits.readsPerMinute ?? 300, 60_000)
  const writes = limiter(limits.writesPerMinute ?? 40, 60_000)
  const saves = limiter(limits.savesPerMinute ?? 12, 60_000)
  const notes = limiter(limits.notesPerHour ?? 12, 60 * 60_000)
  const anonymous = limiter(60, 60_000)

  const router = express.Router()
  const small = express.json({ limit: "16kb" })
  const big = express.json({ limit: Math.ceil(MAX_BYTES * 1.25) + 4096 })

  router.use((request, response, next) => {
    const session = sessionFrom(service.getAim(), request)
    if (!session) {
      anonymous(String(request.socket.remoteAddress || ""))
      return response.status(401).json({ ok: false, error: "Sign on to 98 Messenger to play Sunny Acres with friends." })
    }
    if (reads(session.key)) return response.status(429).json({ ok: false, error: "Slow down!" })
    request.townSession = session
    next()
  })

  const handle = (fn, { write = false, limit = writes } = {}) => async (request, response) => {
    const session = request.townSession
    try {
      if (write) {
        if (limit.over(session.key)) refuse(429, "You're doing that a lot. Try again in a minute.")
        limit(session.key)
      }
      await ready
      const result = await fn(request, session)
      response.json({ ok: true, now: service.clock(), ...result })
    } catch (error) {
      if (error instanceof Invalid) return response.status(400).json({ ok: false, error: error.message })
      if (error instanceof Refused) return response.status(error.status).json({ ok: false, error: error.message, ...error.extra })
      console.error("[town]", error.message)
      response.status(503).json({ ok: false, error: "The 98ish server isn't answering. Please try again in a minute." })
    }
  }

  // ---- my town ----

  const meView = async (session, doc) => {
    const sum = doc.snap ? summary(doc.snap) : null
    const { counts } = heartCounts(doc.hearts, session.key)
    const day = utcDay(service.clock())
    return {
      town: sum ? { snap: sum.state, savedAt: doc.savedAt } : null,
      allowBuddies: !!doc.allowBuddies,
      hearts: counts,
      notes: doc.notes.map((n) => noteView(n, session.key)),
      requests: doc.requests.map(requestView),
      mailbox: doc.mailbox.map(giftView),
      effects: service.pending(doc, sum),
      goal: await service.goalView(session.key),
      partner: service.partnerKeyOf(session.key) ? couplesName(service, session.key) : null,
      giftsLeft: doc.giftDay === day ? Math.max(0, GIFTS_PER_DAY - doc.giftsToday) : GIFTS_PER_DAY,
      stats: doc.stats,
    }
  }

  router.get("/me", handle(async (request, session) => meView(session, await service.load(session.key, session.user.screenName))))

  router.put(
    "/me",
    big,
    handle(
      async (request, session) => {
        const body = request.body || {}
        return service.serial(async () => {
          const doc = await service.load(session.key, session.user.screenName)
          const base = Number(body.base) || 0
          if (doc.snap && body.force !== true && base !== doc.savedAt) {
            refuse(409, "This town was saved from somewhere else.", { conflict: true, savedAt: doc.savedAt, snap: summary(doc.snap)?.state || null })
          }
          const checked = checkSnapshot(body.snap)
          const t = service.clock()
          doc.name = session.user.screenName
          doc.snap = checked.text
          doc.savedAt = Math.max(t, doc.savedAt + 1)
          doc.level = checked.data.level
          // effects the town now has are done; very old ones go too
          const claimed = new Set(checked.data.claimed || [])
          doc.effects = doc.effects.filter((e) => !claimed.has(e.id) && t - e.at < EFFECT_TTL)
          // hearts on buildings that are gone
          const ids = new Set(checked.data.objs.map((o) => String(o.i)))
          for (const obj of Object.keys(doc.hearts)) if (!ids.has(obj)) delete doc.hearts[obj]
          // crops harvested since the last save count toward the couple's goal
          const harvests = Number(checked.data.stats?.harvests)
          let grew = 0
          if (Number.isInteger(harvests) && harvests >= 0) {
            if (doc.lastHarvests != null && harvests > doc.lastHarvests) grew = Math.min(harvests - doc.lastHarvests, 2000)
            doc.lastHarvests = harvests
          }
          await service.put(doc)
          if (grew) await service.addGoal(session.key, grew)
          const fresh = grew ? await service.load(session.key) : doc
          return { savedAt: doc.savedAt, effects: service.pending(fresh, summary(fresh.snap)), goal: await service.goalView(session.key) }
        })
      },
      { write: true, limit: saves }
    )
  )

  router.put(
    "/settings",
    small,
    handle(
      async (request, session) =>
        service.serial(async () => {
          const doc = await service.load(session.key, session.user.screenName)
          doc.allowBuddies = request.body?.allowBuddies === true
          await service.put(doc)
          return { allowBuddies: doc.allowBuddies }
        }),
      { write: true }
    )
  )

  // whose towns I can visit
  router.get(
    "/friends",
    handle(async (request, session) => {
      const aim = service.getAim()
      const me = await aim?.store?.find(session.key)
      const out = []
      const seen = new Set([session.key])
      const add = async (name, rel) => {
        const key = normalize(name)
        if (seen.has(key)) return
        seen.add(key)
        const user = await aim?.store?.find(key)
        if (!user) return
        const doc = await service.load(key, user.screenName)
        const allowed = await service.relation(session.key, key, doc)
        if (!allowed && rel !== "buddy") return
        out.push({ name: user.screenName, relation: allowed || rel, canVisit: !!allowed && !!doc.snap, hasTown: !!doc.snap, level: doc.snap ? doc.level : null, online: !!service.socketOf(key) })
      }
      const partner = couplesName(service, session.key)
      if (partner) await add(partner, "partner")
      const buddies = (me?.groups || []).flatMap((g) => g.buddies || []).filter((n) => normalize(n) !== "smarterchild")
      for (const name of buddies.slice(0, MAX_BUDDIES)) await add(name, "buddy")
      return { friends: out }
    })
  )

  // ---- visiting ----

  router.get(
    "/visit/:name",
    handle(async (request, session) => {
      const { doc, rel } = await service.visitable(session, request.params.name)
      const sum = summary(doc.snap)
      const hearts = heartCounts(doc.hearts, session.key)
      service.visits.set(session.key, doc.key)
      service.emitTo(doc.key, "town:visitor", { name: session.user.screenName, arrived: true })
      return {
        owner: doc.name,
        relation: rel,
        snap: sum.state,
        savedAt: doc.savedAt,
        hearts: hearts.counts,
        myHearts: hearts.mine,
        notes: doc.notes.map((n) => noteView(n, session.key)),
        requests: doc.requests.filter((r) => r.status === "open").map(requestView),
        ownerOnline: !!service.socketOf(doc.key),
      }
    })
  )

  router.post(
    "/visit/:name/heart",
    small,
    handle(
      async (request, session) =>
        service.serial(async () => {
          const { doc } = await service.visitable(session, request.params.name)
          const obj = Number(request.body?.obj)
          if (!Number.isInteger(obj) || !summary(doc.snap).objIds.has(obj)) refuse(404, "That building isn't there any more.")
          const list = doc.hearts[obj] || []
          const mine = !list.includes(session.key)
          doc.hearts[obj] = mine ? [...list, session.key].slice(-MAX_HEARTS_PER_OBJ) : list.filter((k) => k !== session.key)
          if (!doc.hearts[obj].length) delete doc.hearts[obj]
          await service.put(doc)
          if (mine) service.emitTo(doc.key, "town:news", { type: "heart", by: session.user.screenName })
          return { obj, count: (doc.hearts[obj] || []).length, mine }
        }),
      { write: true }
    )
  )

  router.post(
    "/visit/:name/notes",
    small,
    handle(
      async (request, session) => {
        const text = cleanNote(request.body?.text, MAX_NOTE)
        const x = Number(request.body?.x)
        const y = Number(request.body?.y)
        if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > 30 || y > 30) fail("Put your sign somewhere in the town.")
        if (notes.over(session.key)) refuse(429, "That's a lot of signs! Try again later.")
        notes(session.key)
        return service.serial(async () => {
          const { doc } = await service.visitable(session, request.params.name)
          const t = service.clock()
          // a few signs per visitor (the oldest goes), and a few dozen per town
          const mine = doc.notes.filter((n) => n.by === session.key)
          if (mine.length >= NOTES_PER_VISITOR) doc.notes = doc.notes.filter((n) => n.id !== mine[0].id)
          const note = { id: newId(), by: session.key, byName: session.user.screenName, text, x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, at: t }
          doc.notes = [...doc.notes, note].slice(-MAX_NOTES)
          await service.put(doc)
          service.emitTo(doc.key, "town:news", { type: "note", by: session.user.screenName })
          return { note: noteView(note, session.key) }
        })
      },
      { write: true }
    )
  )

  router.delete(
    "/visit/:name/notes/:id",
    handle(
      async (request, session) =>
        service.serial(async () => {
          const { doc } = await service.visitable(session, request.params.name)
          const note = doc.notes.find((n) => n.id === request.params.id && n.by === session.key)
          if (!note) refuse(404, "That sign is gone.")
          doc.notes = doc.notes.filter((n) => n !== note)
          await service.put(doc)
          return { removed: true }
        }),
      { write: true }
    )
  )

  router.delete(
    "/notes/:id",
    handle(
      async (request, session) =>
        service.serial(async () => {
          const doc = await service.load(session.key, session.user.screenName)
          const before = doc.notes.length
          doc.notes = doc.notes.filter((n) => n.id !== request.params.id)
          if (doc.notes.length === before) refuse(404, "That sign is gone.")
          await service.put(doc)
          return { removed: true }
        }),
      { write: true }
    )
  )

  // ---- help requests ----

  router.post(
    "/requests",
    small,
    handle(
      async (request, session) =>
        service.serial(async () => {
          const kind = request.body?.kind === "car" ? "car" : request.body?.kind === "order" ? "order" : fail("Ask for help with an order or a train car.")
          const slot = Number(request.body?.slot)
          if (!Number.isInteger(slot) || slot < 0 || slot > 20) fail("Ask for help with an order or a train car.")
          const doc = await service.load(session.key, session.user.screenName)
          const sum = doc.snap && summary(doc.snap)
          if (!sum) refuse(409, "Your town isn't saved in the cloud yet. Try again in a moment.")
          const need = rules.G.requestNeed(sum.state, kind, slot)
          if (!need) refuse(409, kind === "car" ? "That car is already loaded." : "There's no order there right now.")
          const t = service.clock()
          // old answered requests fall away
          doc.requests = doc.requests.filter((r) => r.status === "open" || t - (r.filledAt || r.at) < DAY)
          const same = doc.requests.find((r) => r.status === "open" && r.kind === kind && r.slot === slot)
          if (same && rules.G.sameNeed(same.need, need)) return { request: requestView(same) }
          if (same) same.status = "gone"
          if (doc.requests.filter((r) => r.status === "open").length >= MAX_REQUESTS) refuse(409, `You can ask for help with ${MAX_REQUESTS} things at a time.`)
          const req = { id: newId(), kind, slot, need, at: t, status: "open" }
          doc.requests.push(req)
          await service.put(doc)
          const partner = service.partnerKeyOf(session.key)
          if (partner) service.emitTo(partner, "town:news", { type: "request", by: session.user.screenName })
          return { request: requestView(req) }
        }),
      { write: true }
    )
  )

  router.delete(
    "/requests/:id",
    handle(
      async (request, session) =>
        service.serial(async () => {
          const doc = await service.load(session.key, session.user.screenName)
          const req = doc.requests.find((r) => r.id === request.params.id && r.status === "open")
          if (!req) refuse(404, "That request is gone.")
          req.status = "cancelled"
          req.filledAt = service.clock()
          await service.put(doc)
          return { request: requestView(req) }
        }),
      { write: true }
    )
  )

  router.post(
    "/visit/:name/help/:id",
    handle(
      async (request, session) =>
        service.serial(async () => {
          const { doc: owner } = await service.visitable(session, request.params.name)
          const req = owner.requests.find((r) => r.id === request.params.id)
          if (!req) refuse(404, "That request is gone.")
          if (req.status === "filled") refuse(409, `${req.byName || "Someone"} already helped with that one.`)
          if (req.status !== "open") refuse(409, "That request is gone.")
          // still what their town needs?
          const now = rules.G.requestNeed(summary(owner.snap).state, req.kind, req.slot)
          if (!rules.G.sameNeed(now, req.need)) {
            req.status = "gone"
            req.filledAt = service.clock()
            await service.put(owner)
            refuse(409, req.kind === "car" ? "That car isn't waiting any more." : "That order isn't there any more.")
          }
          const helper = await service.load(session.key, session.user.screenName)
          const have = helper.snap && service.available(helper)
          if (!have) refuse(409, "Open your own Sunny Acres first so your Barn is saved.")
          for (const [g, n] of Object.entries(req.need)) {
            if ((have.goods[g] || 0) < n) refuse(409, `You need ${n - Math.max(0, have.goods[g] || 0)} more ${rules.D.itemName(g)} in your Barn.`, { short: g })
          }
          const t = service.clock()
          const reward = rules.G.helpReward(req.need)
          const mine = { id: newId(), kind: "helped", goods: { ...req.need }, ...reward, owner: owner.name, at: t }
          const theirs = { id: newId(), kind: "help", req: { kind: req.kind, slot: req.slot, need: { ...req.need } }, by: session.user.screenName, at: t }
          req.status = "filled"
          req.by = session.key
          req.byName = session.user.screenName
          req.filledAt = t
          owner.effects.push(theirs)
          helper.effects.push(mine)
          helper.stats = { ...helper.stats, helped: (helper.stats?.helped || 0) + 1 }
          // the request is marked filled before the helper is charged: if the second write
          // failed, nobody could fill it again, and the worst case is a free gift
          await service.put(owner)
          await service.put(helper)
          service.emitTo(owner.key, "town:news", { type: "helped", by: session.user.screenName })
          return { effect: mine, request: requestView(req), reward }
        }),
      { write: true }
    )
  )

  // ---- gifts for your partner ----

  router.post(
    "/gifts",
    small,
    handle(
      async (request, session) => {
        const partnerKey = service.partnerKeyOf(session.key)
        if (!partnerKey) refuse(403, "Gifts are for your partner. Pair up in Us first. ♥")
        const body = request.body || {}
        const { GOODS, DECOR } = rules.D
        let goods = null
        let decor = null
        if (body.decor !== undefined) {
          decor = String(body.decor)
          if (!DECOR[decor] || DECOR[decor].couple) fail("That decoration can't be wrapped up.")
        } else {
          if (!body.goods || typeof body.goods !== "object" || Array.isArray(body.goods)) fail("Pick something to give.")
          goods = {}
          let total = 0
          for (const [g, n] of Object.entries(body.goods)) {
            if (!GOODS[g] || !Number.isInteger(n) || n < 1) fail("Pick something to give.")
            goods[g] = n
            total += n
          }
          if (!total) fail("Pick something to give.")
          if (total > rules.G.MAX_GIFT_ITEMS) fail(`A gift can hold up to ${rules.G.MAX_GIFT_ITEMS} things.`)
        }
        const note = body.note ? cleanNote(body.note, MAX_GIFT_NOTE) : ""
        return service.serial(async () => {
          const sender = await service.load(session.key, session.user.screenName)
          const have = sender.snap && service.available(sender)
          if (!have) refuse(409, "Open your own Sunny Acres first so your Barn is saved.")
          const t = service.clock()
          const day = utcDay(t)
          const sent = sender.giftDay === day ? sender.giftsToday : 0
          if (sent >= GIFTS_PER_DAY) refuse(429, `That's ${GIFTS_PER_DAY} gifts today! More tomorrow. ♥`, { giftsLeft: 0 })
          let coins = 0
          if (decor) {
            const d = DECOR[decor]
            if (d.lvl > have.level) refuse(409, `That unlocks at level ${d.lvl}.`)
            coins = d.cost
            if (have.coins < coins) refuse(409, `You need ${coins} coins for that.`)
          } else {
            for (const [g, n] of Object.entries(goods)) if ((have.goods[g] || 0) < n) refuse(409, `You don't have ${n} ${rules.D.itemName(g)} in your Barn.`)
          }
          const recipient = await service.load(partnerKey)
          if (recipient.mailbox.filter((m) => !m.openedAt).length >= MAX_MAILBOX) refuse(409, "Their mailbox is full! Wait until they open some gifts.")
          const gift = { id: newId(), from: session.key, fromName: session.user.screenName, goods, decor, note, at: t, openedAt: null }
          const mine = { id: newId(), kind: "gave", goods: goods || {}, coins, to: recipient.name, at: t }
          recipient.mailbox = [...recipient.mailbox.filter((m) => !m.openedAt), ...recipient.mailbox.filter((m) => m.openedAt).slice(-10), gift].sort((a, b) => a.at - b.at)
          sender.effects.push(mine)
          sender.giftDay = day
          sender.giftsToday = sent + 1
          sender.stats = { ...sender.stats, gifts: (sender.stats?.gifts || 0) + 1 }
          await service.put(recipient)
          await service.put(sender)
          service.emitTo(partnerKey, "town:news", { type: "gift", by: session.user.screenName })
          return { effect: mine, gift: giftView(gift), giftsLeft: GIFTS_PER_DAY - sender.giftsToday }
        })
      },
      { write: true }
    )
  )

  router.post(
    "/mailbox/:id/open",
    handle(
      async (request, session) =>
        service.serial(async () => {
          const doc = await service.load(session.key, session.user.screenName)
          const gift = doc.mailbox.find((m) => m.id === request.params.id)
          if (!gift) refuse(404, "That gift isn't here.")
          if (gift.openedAt) {
            const effect = service.pending(doc).find((e) => e.gift === gift.id) || null
            return { gift: giftView(gift), effect }
          }
          const t = service.clock()
          gift.openedAt = t
          const effect = { id: newId(), kind: "gift", gift: gift.id, goods: gift.goods || {}, decor: gift.decor || null, from: gift.fromName, at: t }
          doc.effects.push(effect)
          await service.put(doc)
          service.emitTo(gift.from, "town:news", { type: "opened", by: session.user.screenName })
          return { gift: giftView(gift), effect }
        }),
      { write: true }
    )
  )

  // ---- tests: move the server's clock (memory mode only) ----
  if (service.testClock) {
    router.post(
      "/test/clock",
      small,
      handle(async (request) => {
        const offsetMs = Number(request.body?.offsetMs)
        if (!Number.isFinite(offsetMs)) fail("offsetMs must be a number.")
        service.setOffset(offsetMs)
        return {}
      })
    )
  }

  router.use((error, request, response, next) => {
    if (error?.type === "entity.too.large") return response.status(413).json({ ok: false, error: "That town is too big to save in the cloud." })
    if (error?.type === "entity.parse.failed") return response.status(400).json({ ok: false, error: "That couldn't be read." })
    next(error)
  })

  return Object.assign(router, { service, useAim: (value) => service.useAim(value) })
}

// the partner's screen name as they spell it
const couplesName = (service, key) => {
  try {
    return service.couples?.partnerOf?.(key) || null
  } catch {
    return null
  }
}

// ---------- live visits ----------

const attachTown = (io, { service = defaultService() } = {}) => {
  const walk = limiter(8, 1000)
  io.on("connection", (socket) => {
    const sessionOf = () => {
      const aim = service.getAim()
      const session = aim?.sessions?.get(socket.data.key)
      return session && session.socket === socket ? session : null
    }
    const leave = (session) => {
      const owner = service.visits.get(session.key)
      if (!owner) return
      service.visits.delete(session.key)
      service.emitTo(owner, "town:visitor", { name: session.user.screenName, leave: true })
    }
    socket.on("town:walk", (payload) => {
      const session = sessionOf()
      if (!session || !payload || typeof payload !== "object") return
      const owner = service.visits.get(session.key)
      if (!owner || owner !== normalize(payload.owner)) return
      if (payload.leave) return leave(session)
      if (walk(socket.id)) return
      const u = Number(payload.u)
      const v = Number(payload.v)
      if (!Number.isFinite(u) || !Number.isFinite(v)) return
      service.emitTo(owner, "town:visitor", { name: session.user.screenName, u: Math.max(0, Math.min(30, u)), v: Math.max(0, Math.min(30, v)) })
    })
    socket.on("disconnect", () => {
      const key = socket.data.key
      if (!key || !service.visits.has(key)) return
      const aim = service.getAim()
      const session = aim?.sessions?.get(key)
      if (session?.socket && session.socket !== socket && session.socket.connected) return
      const owner = service.visits.get(key)
      service.visits.delete(key)
      service.emitTo(owner, "town:visitor", { name: session?.user?.screenName || key, leave: true })
    })
  })
  return service
}

// ---------- the one service the server runs ----------

let shared = null
function defaultService() {
  return (shared ??= createTown({
    testClock: process.env.COUPLES_TEST_CLOCK === "1" && !process.env.MONGODB_URI,
    store: process.env.MONGODB_URI ? undefined : memoryStore(),
  }))
}

module.exports = { createTown, townRouter, attachTown, memoryStore, weekStart, townService: () => defaultService(), GIFTS_PER_DAY, MAX_REQUESTS, MAX_NOTES }
