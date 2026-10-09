// Pickleball 98 tournaments (Real Games > Tournaments, and My Park at the venue): weekly
// in-game events at the real venues with original names; the rules, the schedule and the
// bracket are client/src/components/applets/pbclub/tourneyCore.js (the same file the game
// uses). An event exists only as a schedule until the first person signs up; then it's a
// record here.
//
// Every route needs "Authorization: Bearer <token>" from a signed-on 98 Messenger session.
// All POST, JSON in and out ({ ok, ... }):
//   /list      {}                         -> { now, events: [summary], trophies: [trophy] }
//   /get       { id }                     -> { now, tourney }   (the full record, brought up to now)
//   /enter     { id, div, partner }       sign up; partner: a screen name (they accept) or ""
//                                         (a computer partner)
//   /withdraw  { id }                     before the start (your partner's spot is freed too)
//   /partner   { id, act: accept|decline } the invited partner
//   /here      { id, match }              "we're here": checked in for that match
//   /room      { id, match, code }        the online room you made for that match (your
//                                         opponents see "Join")
//   /report    { id, match, score: [a, b] }  a player in the match, before the round's end
// Live: "pb:changed" { kind: "tourney", id, by, partner? } on the 98 Messenger socket to
// everyone in it. Push (category "pickleball"): a partner invitation, the draw (your first
// match), a trophy.
//
// Caps (MongoDB's free tier is 512 MB for everything): 16 teams per division, 4 divisions,
// so a record is at most ~30 KB (usually 2-5); 6 upcoming sign-ups per account; at most 300
// records, each deleted 14 days after its start; a trophy shelf keeps 60 trophies (~10 KB).
// Nine events a week with sign-ups is well under 1 MB. Traffic is JSON on demand.

const path = require("path")
const crypto = require("crypto")
const { pathToFileURL } = require("url")
const express = require("express")
const { limiter } = require("../net/limiter")
const { validate: validateName } = require("../aim/screenNames")
const { createTourneyStore, memoryStore } = require("./store")

const WINDOW_MS = 10 * 60_000
const SWEEP_MS = 60_000
const BOT_KEY = "smarterchild"
const OPEN_URL = "/?open=program&name=Pickleball%2098"

let coreModule = null
const loadCore = () => (coreModule ??= import(pathToFileURL(path.join(__dirname, "../../client/src/components/applets/pbclub/tourneyCore.js")).href))

class Refused extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}
const refuse = (status, message) => {
  throw new Refused(status, message)
}

const createTourneys = ({ aim, store, push = null, now = Date.now, limits = {} } = {}) => {
  const storeReady = Promise.resolve(store || createTourneyStore())
  storeReady.catch((error) => console.error("[tourney] store failed", error))
  const getAim = async () => (typeof aim === "function" ? aim() : aim)

  const emitTo = async (key, payload) => {
    const socket = (await getAim())?.sessions?.get(key)?.socket
    if (socket) socket.emit("pb:changed", payload)
  }
  const tell = async (keys, payload, skip = null) => {
    for (const key of new Set(keys)) if (key && key !== skip) await emitTo(key, payload)
  }
  const pushTo = (key, message) => {
    if (!push || !key) return
    Promise.resolve(push.notify(key, "pickleball", { app: "pbclub", ...message })).catch(() => {})
  }
  const openUrl = (id) => `${OPEN_URL}&tourney=${encodeURIComponent(id)}`

  const accountOf = async (me, raw) => {
    const target = validateName(raw)
    if (target.error) refuse(400, `"${String(raw).slice(0, 20)}" isn't a 98 Messenger screen name.`)
    if (target.key === BOT_KEY) refuse(400, "SmarterChild doesn't play pickleball.")
    if (target.key === me.key) refuse(400, "Pick someone else as your partner.")
    const user = await (await getAim())?.store?.find?.(target.key)
    if (!user) refuse(404, `${target.screenName} is not a 98 Messenger screen name.`)
    if ((user.blocked || []).includes(me.key) || (me.blocked || []).includes(target.key)) refuse(409, `You can't team up with ${user.screenName} right now.`)
    return { key: target.key, name: user.screenName || target.screenName }
  }

  // ---- records ----
  const fresh = (core, id) => {
    const inst = core.parseId(id)
    if (!inst) return null
    return core.freshTourney(inst, crypto.randomBytes(4).readUInt32BE(0))
  }
  // what changed between two versions of a record: the draw, the end (trophies)
  const announce = async (core, before, after, by = null) => {
    const members = core.membersOf(after)
    await tell(members, { kind: "tourney", id: after.id, by }, by)
    if (before.status === "open" && after.status === "live") {
      for (const k of members) {
        const next = core.nextMatchFor(after, k)
        if (!next) continue
        pushTo(k, { title: `${after.name} has started`, body: `Your first match: vs ${core.teamName(next.them)}. You have 30 minutes to play it in Pickleball 98.`, tag: `tourney-${after.id}`, url: openUrl(after.id) })
      }
    }
  }
  const award = async (core, doc) => {
    if (doc.status !== "done" || doc.awarded) return false
    const s = await storeReady
    const given = core.trophiesOf(doc)
    for (const { k, trophy } of given) {
      const list = (await s.trophies.get(k)).filter((t) => t.id !== trophy.id)
      await s.trophies.put(k, [trophy, ...list].slice(0, core.LIMITS.trophies))
      pushTo(k, { title: trophy.place === 1 ? `You won the ${trophy.name}!` : `Runner-up at the ${trophy.name}`, body: `${trophy.div}. Your trophy is in your Locker Room.`, tag: `trophy-${trophy.id}`, url: openUrl(doc.id) })
    }
    doc.awarded = true
    return true
  }

  // read a stored record (or the schedule's blank one), brought up to now; saved if that changed it
  const load = async (id, { create = false } = {}) => {
    const core = await loadCore()
    const s = await storeReady
    for (let attempt = 0; attempt < 4; attempt++) {
      let doc = await s.tourneys.get(String(id))
      if (!doc) {
        const blank = fresh(core, String(id))
        if (!blank) refuse(404, "That tournament isn't on the schedule.")
        if (!create) {
          core.progress(blank, now())
          return { core, doc: blank, stored: false }
        }
        if ((await s.tourneys.count()) >= (limits.stored ?? core.LIMITS.stored)) refuse(503, "Tournaments are full right now. Try again tomorrow.")
        await s.tourneys.create(blank)
        doc = await s.tourneys.get(blank.id)
        if (!doc) continue
      }
      const before = JSON.parse(JSON.stringify(doc))
      const moved = core.progress(doc, now())
      const awarded = await award(core, doc)
      if (!moved && !awarded) return { core, doc, stored: true }
      doc.members = core.membersOf(doc)
      const saved = await s.tourneys.put(doc, doc.rev)
      if (saved.ok) {
        doc.rev = saved.rev
        await announce(core, before, doc)
        return { core, doc, stored: true }
      }
    }
    refuse(409, "That tournament is busy. Try again in a moment.")
  }

  // change a record (re-read and retried if someone else changed it first)
  const change = async (id, fn, { create = false, by = null } = {}) => {
    const s = await storeReady
    for (let attempt = 0; attempt < 4; attempt++) {
      const { core, doc } = await load(id, { create })
      const before = JSON.parse(JSON.stringify(doc))
      const out = await fn(doc, core)
      core.progress(doc, now())
      await award(core, doc)
      doc.members = core.membersOf(doc)
      const saved = await s.tourneys.put(doc, doc.rev)
      if (saved.ok) {
        doc.rev = saved.rev
        await announce(core, before, doc, by)
        return { core, doc, out }
      }
    }
    refuse(409, "That tournament is busy. Try again in a moment.")
  }

  const view = (doc) => {
    const { seed, members, rev, ...rest } = doc
    return rest
  }
  const summary = (core, doc, key) => {
    const entry = core.entryOf(doc, key)
    const next = core.nextMatchFor(doc, key)
    return {
      id: doc.id,
      name: doc.name,
      venue: doc.venue,
      start: doc.start,
      status: doc.status,
      divisions: doc.divisions.map((d) => ({ id: d, name: core.DIVISIONS[d].name, kind: core.DIVISIONS[d].kind, count: doc.entries.filter((e) => e.div === d).length })),
      entry: entry ? { div: entry.div, partner: entry.partner, captain: entry.keys[0] === key, invited: entry.partner?.k === key && !entry.partner.ok } : null,
      next: next ? { match: next.match.id, vs: core.teamName(next.them), vsCpu: next.vsCpu, deadline: next.deadline, room: next.match.room } : null,
      place: core.placeOf(doc, key)?.place ?? null,
    }
  }

  // ---- the routes' work ----
  const list = async (me) => {
    const core = await loadCore()
    const s = await storeReady
    const t = now()
    const insts = core.upcoming(t)
    const stored = new Map((await s.tourneys.inRange(t - 3 * core.HOUR, t + core.LIMITS.showDays * core.DAY)).map((d) => [d.id, d]))
    const events = []
    for (const inst of insts) {
      let doc = stored.get(inst.id)
      if (doc && doc.status !== "done" && doc.start <= t) doc = (await load(inst.id)).doc
      if (!doc) {
        doc = core.freshTourney(inst, 0)
        core.progress(doc, t)
      }
      events.push(summary(core, doc, me.key))
    }
    // yours from the last two weeks that have dropped off the schedule
    for (const doc of await s.tourneys.forKey(me.key)) if (!events.some((e) => e.id === doc.id)) events.push(summary(core, doc, me.key))
    events.sort((a, b) => a.start - b.start)
    return { now: t, events, trophies: await s.trophies.get(me.key) }
  }

  const get = async (me, { id }) => {
    const { doc } = await load(id)
    return { now: now(), tourney: view(doc) }
  }

  const enter = async (me, { id, div, partner }) => {
    const core = await loadCore()
    const s = await storeReady
    if (!core.parseId(id)) refuse(404, "That tournament isn't on the schedule.")
    const mine = (await s.tourneys.forKey(me.key)).filter((d) => d.status === "open")
    if (mine.length >= core.LIMITS.myUpcoming) refuse(429, `You're signed up for ${core.LIMITS.myUpcoming} tournaments already. Play those first.`)
    const mate = partner && String(partner).trim() ? await accountOf(me, partner) : null
    const { doc } = await change(
      id,
      (d, c) => {
        const why = c.canEnter(d, me.key, String(div), mate?.key || null, now())
        if (why) refuse(409, why)
        d.entries.push({ id: crypto.randomBytes(6).toString("hex"), div: String(div), keys: [me.key], names: { [me.key]: me.name }, partner: mate ? { k: mate.key, name: mate.name, ok: false } : null, at: now() })
      },
      { create: true, by: me.key }
    )
    if (mate) {
      await emitTo(mate.key, { kind: "tourney", id, by: me.name, partner: true })
      pushTo(mate.key, { title: `${me.name} wants you as a partner`, body: `${doc.name}, ${core.DIVISIONS[div].name}. Accept in Pickleball 98 > Real Games > Tournaments.`, tag: `tourney-p-${id}`, url: openUrl(id) })
    }
    return { tourney: view(doc) }
  }

  const withdraw = async (me, { id }) => {
    const { doc } = await change(
      id,
      (d, c) => {
        if (d.status !== "open") refuse(409, "It has started: you can't withdraw now (just don't play: the round's clock decides).")
        const e = c.entryOf(d, me.key)
        if (!e) refuse(404, "You're not signed up for this one.")
        if (e.keys[0] === me.key) d.entries = d.entries.filter((x) => x !== e)
        else Object.assign(e, { partner: null, keys: e.keys.filter((k) => k !== me.key) })
      },
      { by: me.key }
    )
    return { tourney: view(doc) }
  }

  const answerPartner = async (me, { id, act }) => {
    if (act !== "accept" && act !== "decline") refuse(400, "Accept or decline?")
    const { doc } = await change(
      id,
      (d) => {
        if (d.status !== "open") refuse(409, "It has started already.")
        const e = d.entries.find((x) => x.partner?.k === me.key)
        if (!e) refuse(404, "There's no invitation for you in this one.")
        if (act === "accept") {
          e.partner.ok = true
          if (!e.keys.includes(me.key)) e.keys.push(me.key)
          e.names[me.key] = me.name
        } else {
          e.partner = null
          e.keys = e.keys.filter((k) => k !== me.key)
        }
      },
      { by: me.key }
    )
    return { tourney: view(doc) }
  }

  const inMatch = (core, d, key, matchId) => {
    const f = core.findMatch(d, String(matchId))
    if (!f) refuse(404, "That match isn't in this tournament.")
    const side = core.sideOf(f.bracket, f.match, key)
    if (!side) refuse(403, "You're not in that match.")
    if (f.match.w) refuse(409, "That match is already decided.")
    return { ...f, side }
  }

  const here = async (me, { id, match }) => {
    const { doc } = await change(
      id,
      (d, c) => {
        const f = inMatch(c, d, me.key, match)
        f.match.here[f.side] = true
      },
      { by: me.key }
    )
    return { tourney: view(doc) }
  }

  const room = async (me, { id, match, code }) => {
    const clean = String(code || "").toUpperCase()
    if (!/^[A-Z0-9]{4,8}$/.test(clean)) refuse(400, "That isn't a room code.")
    const { doc } = await change(
      id,
      (d, c) => {
        const f = inMatch(c, d, me.key, match)
        f.match.room = clean
        f.match.here[f.side] = true
      },
      { by: me.key }
    )
    return { tourney: view(doc) }
  }

  const reportScore = async (me, { id, match, score }) => {
    const { doc } = await change(
      id,
      (d, c) => {
        const why = c.report(d, String(match), me.key, Array.isArray(score) ? score.map(Number) : null, now())
        if (why) refuse(409, why)
      },
      { by: me.key }
    )
    return { tourney: view(doc) }
  }

  // ---- housekeeping ----
  const sweep = async () => {
    const core = await loadCore()
    const s = await storeReady
    for (const d of await s.tourneys.due(now())) await load(d.id).catch(() => null)
    for (const id of await s.tourneys.startedBefore(now() - core.LIMITS.keepDays * core.DAY)) await s.tourneys.remove(id)
  }
  let sweeper = null
  const start = () => {
    if (!sweeper) {
      sweeper = setInterval(() => sweep().catch((error) => console.error("[tourney] sweep failed", error?.message)), SWEEP_MS)
      sweeper.unref?.()
    }
  }
  const stop = () => {
    clearInterval(sweeper)
    sweeper = null
  }

  // Delete My Account (../account): sign-ups for events that haven't started are removed (a
  // partner they invited plays with a computer partner); in started or finished ones they
  // become "Deleted player" so the other teams' results stay; their trophy shelf is deleted.
  const eraseAccount = async ({ key }) => {
    const core = await loadCore()
    const s = await storeReady
    const anon = `x${crypto.randomBytes(6).toString("hex")}`
    let changed = 0
    for (const doc of await s.tourneys.forKey(key)) {
      for (let attempt = 0; attempt < 4; attempt++) {
        const d = attempt ? await s.tourneys.get(doc.id) : doc
        if (!d) break
        core.eraseFrom(d, key, anon)
        if ((await s.tourneys.put(d, d.rev)).ok) {
          changed++
          await tell(d.members, { kind: "tourney", id: d.id }, key)
          break
        }
      }
    }
    await s.trophies.remove(key)
    return { tourneysChanged: changed }
  }

  // ---- HTTP ----
  const router = () => {
    const r = express.Router()
    const writes = limiter(limits.writes ?? 300, WINDOW_MS)
    const badTokens = limiter(limits.badTokens ?? 30, WINDOW_MS)
    const ipOf = (request) => String(request.headers["x-forwarded-for"] || request.socket.remoteAddress || "").split(",")[0].trim()
    const accountFor = async (token) => {
      if (!/^[0-9a-f]{48}$/.test(token)) return null
      const service = await getAim()
      for (const session of service?.sessions?.values() || []) if (session.token === token) return { key: session.key, name: session.user?.screenName || session.key, blocked: session.user?.blocked || [] }
      return null
    }
    r.use(async (request, response, next) => {
      try {
        const ip = ipOf(request)
        if (badTokens.over(ip)) return response.status(429).json({ ok: false, error: "Too many tries. Please wait a few minutes." })
        const account = await accountFor(String(request.headers.authorization || "").replace(/^Bearer\s+/i, ""))
        if (!account) {
          badTokens(ip)
          return response.status(401).json({ ok: false, error: "Sign on to 98 Messenger to play in tournaments." })
        }
        if (writes(account.key)) return response.status(429).json({ ok: false, error: "That's a lot at once. Please wait a few minutes." })
        request.account = account
        next()
      } catch (error) {
        next(error)
      }
    })
    r.use(express.json({ limit: "8kb" }))
    const handle = (fn) => async (request, response) => {
      try {
        response.json({ ok: true, ...(await fn(request.account, request.body || {})) })
      } catch (error) {
        if (error instanceof Refused) return response.status(error.status).json({ ok: false, error: error.message })
        console.error("[tourney]", error?.message)
        response.status(503).json({ ok: false, error: "Tournaments aren't answering. Try again in a minute." })
      }
    }
    r.post("/list", handle(list))
    r.post("/get", handle(get))
    r.post("/enter", handle(enter))
    r.post("/withdraw", handle(withdraw))
    r.post("/partner", handle(answerPartner))
    r.post("/here", handle(here))
    r.post("/room", handle(room))
    r.post("/report", handle(reportScore))
    r.use((error, request, response, next) => {
      if (response.headersSent) return next(error)
      if (error.type === "entity.too.large") return response.status(413).json({ ok: false, error: "That's too much at once." })
      if (error.type === "entity.parse.failed") return response.status(400).json({ ok: false, error: "That didn't make sense to the server." })
      console.error("[tourney] request failed", error)
      response.status(500).json({ ok: false, error: "Tournaments are unavailable right now." })
    })
    return r
  }

  return { router, list, get, enter, withdraw, answerPartner, here, room, reportScore, sweep, start, stop, eraseAccount, getStore: () => storeReady }
}

// TOURNEY_TEST_CLOCK=1 (browser tests only, never in production): POST /api/tourney/test-clock
// { ms } moves this server's tournament clock ahead
const tourneyService = ({ aim, push } = {}) => {
  let offset = 0
  const service = createTourneys({ aim, push, store: process.env.MONGODB_URI ? undefined : memoryStore(), now: () => Date.now() + offset })
  if (process.env.TOURNEY_TEST_CLOCK !== "1" || process.env.RENDER) return service
  const router = service.router
  service.router = () => {
    const r = express.Router()
    r.post("/test-clock", express.json(), (request, response) => {
      offset += Math.max(0, Number(request.body?.ms) || 0)
      response.json({ ok: true, now: Date.now() + offset })
    })
    r.use(router())
    return r
  }
  return service
}

module.exports = { createTourneys, tourneyService, loadCore }
