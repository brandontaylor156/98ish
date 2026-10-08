// Buddy Locator: share where you are with chosen 98 Messenger buddies, see the buddies who
// share with you on a map, and get told when one arrives at or leaves a place you named.
// Opt-in and per buddy: nothing is shared until you share with someone, only with people in
// your Buddy List (or someone who asked you and you said yes), for an hour, until the end of
// the day, or until you stop. The rules are client/src/components/applets/locator/locateCore.js
// (the same file the app uses).
//
// Every route needs "Authorization: Bearer <token>" from a signed-on 98 Messenger session.
// All POST, JSON in and out ({ ok, ... }):
//   /state                         -> { me, friends, now }: my settings, shares, places,
//                                     watches and asks; the buddies sharing with me (and where)
//   /share     { to, until }       share with a buddy (until: ms, or null = indefinitely);
//                                  sharing again with someone changes the end time
//   /unshare   { to } | { all }    stop sharing with one buddy, or with everyone
//   /pause     { paused }          pause everything (my position is forgotten until I resume)
//   /settings  { coarse }          approximate location (about 1 km; the device rounds too)
//   /update    { lat, lon, acc }   my position now (kept only if someone may see it)
//   /ask       { to }              ask a buddy to share with me
//   /answer    { from, accept, until }  answer someone's ask (accepting shares with them)
//   /places    { places }          replace my named places
//   /watch     { who, place, on }  on: "arrive" | "leave" | "both" | "off"
// Live, on the 98 Messenger socket: "loc:pos" { key, name, pos } and "loc:gone" { key,
// reason } to the people who may see me; "loc:shared" { key, name, until } when someone starts
// sharing with you, "loc:ask" { from, name }, "loc:alert" { key, name, place, event }, and
// "loc:changed" to my own other devices (they read /state again). Push (category "places")
// for asks, new shares and arrive/leave alerts when the person is away from 98ish.
//
// Live Venue Presence (presence.js): a sharer at one of Pickleball 98's real venues gets a
// `venue` ({ id, area: "c<court>" | "site" } or { id, nearby } with approximate location) next
// to their position in /state and "loc:pos", for the same people who may see the position.
// It's worked out from the latest position and kept in memory only.
//
// Privacy: only the LATEST position is kept, never a history; it's dropped when sharing ends,
// when you pause, and when the last share runs out (a sweep every minute). With approximate
// location on, the position is snapped to a ~1 km grid before it's kept or sent anywhere.
// Delete My Account removes the record and takes the account out of everyone else's.
//
// Caps (MongoDB's free tier is 512 MB for everything): one record per account of about
// 1-3 KB (50 shares, 20 places, 40 watches, 20 asks); 60 position updates per account per
// 10 minutes (the app sends at most one every 30 s); traffic is ~200 bytes per update per
// viewer, nothing against Render's 5 GB a month.

const path = require("path")
const { pathToFileURL } = require("url")
const crypto = require("crypto")
const express = require("express")
const { limiter } = require("../net/limiter")
const { validate: validateName, normalize } = require("../aim/screenNames")
const { createLocateStore, memoryStore, blank } = require("./store")
const { createPresence } = require("./presence")

const WINDOW_MS = 10 * 60_000
const BOT_KEY = "smarterchild"

let coreModule = null
const loadCore = () => (coreModule ??= import(pathToFileURL(path.join(__dirname, "../../client/src/components/applets/locator/locateCore.js")).href))

class Refused extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}
const refuse = (status, message) => {
  throw new Refused(status, message)
}
const newId = () => crypto.randomBytes(6).toString("hex")

// aim: 98 Messenger's service ({ sessions, store }), a promise of it, or a function returning
// either; push: server/push's service (or null)
const createLocate = ({ aim, store, push = null, now = Date.now, limits = {}, sweepMs = 60_000, presence = createPresence() } = {}) => {
  const storeReady = Promise.resolve(store || createLocateStore())
  storeReady.catch((error) => console.error("[locate] store failed", error))
  const getAim = async () => (typeof aim === "function" ? aim() : aim)

  const emitTo = async (key, event, payload) => {
    const socket = (await getAim())?.sessions?.get(key)?.socket
    if (socket) socket.emit(event, payload)
    return !!socket
  }
  const pushTo = (key, message) => {
    if (!push) return
    Promise.resolve(push.notify(key, "places", { app: "locator", ...message })).catch(() => {})
  }

  // a person's blocked list and display name (signed on or not)
  const userOf = async (key) => {
    const service = await getAim()
    const session = service?.sessions?.get(key)
    if (session) return { name: session.user?.screenName || key, blocked: session.user?.blocked || [] }
    const user = await service?.store?.find?.(key)
    return user ? { name: user.screenName, blocked: user.blocked || [] } : null
  }
  const blockedBetween = async (a, b) => {
    const [ua, ub] = await Promise.all([userOf(a), userOf(b)])
    return !ua || !ub || ua.blocked.includes(b) || ub.blocked.includes(a)
  }

  const load = async (key, name) => (await (await storeReady).get(key)) || blank(key, name)
  const save = async (doc) => {
    doc.changedAt = now()
    await (await storeReady).put(doc)
  }

  const meView = (doc) => ({
    shares: doc.shares,
    paused: !!doc.paused,
    coarse: !!doc.coarse,
    pos: doc.pos,
    places: doc.places,
    watches: doc.watches,
    asks: doc.asks,
  })

  // tell everyone who could see me that they no longer can
  const goneFor = async (keys, from, reason) => {
    for (const key of keys) await emitTo(key, "loc:gone", { key: from, reason })
  }

  // ---- reading ----

  const state = async (account) => {
    const core = await loadCore()
    const s = await storeReady
    const mine = await load(account.key, account.name)
    const t = now()
    const friends = []
    for (const doc of await s.sharingWith(account.key)) {
      const share = doc.shares.find((x) => x.to === account.key)
      if (!core.shareActive(share, t)) continue
      if (await blockedBetween(doc.key, account.key)) continue
      friends.push({ key: doc.key, name: doc.name, until: share.until, since: share.since, paused: !!doc.paused, pos: doc.paused ? null : doc.pos, venue: doc.paused ? null : await presence.of(doc.key, doc.pos) })
    }
    friends.sort((a, b) => a.name.localeCompare(b.name))
    return { me: { ...meView(mine), venue: mine.paused ? null : await presence.of(account.key, mine.pos) }, friends, now: t }
  }

  // ---- sharing ----

  const findPerson = async (account, input) => {
    const target = validateName(input)
    if (target.error) refuse(400, "That isn't a screen name.")
    if (target.key === account.key) refuse(400, "That's you!")
    if (target.key === BOT_KEY) refuse(400, "SmarterChild stays right here in the computer.")
    const user = await userOf(target.key)
    if (!user) refuse(404, `${target.screenName} isn't a registered screen name.`)
    if (await blockedBetween(account.key, target.key)) refuse(403, `You can't share with ${user.name}.`)
    return { key: target.key, name: user.name }
  }

  const startShare = async (account, mine, person, until) => {
    const core = await loadCore()
    const t = now()
    const checked = core.cleanUntil(until, t)
    if (!checked.ok) refuse(400, checked.error)
    const existing = mine.shares.find((s) => s.to === person.key)
    const wasActive = core.shareActive(existing, t)
    const live = mine.shares.filter((s) => core.shareActive(s, t))
    if (!existing && live.length >= core.MAX_SHARES) refuse(413, `You can share with up to ${core.MAX_SHARES} people.`)
    mine.shares = [...mine.shares.filter((s) => s.to !== person.key && core.shareActive(s, t)), { to: person.key, name: person.name, until: checked.until, since: wasActive ? existing.since : t }]
    mine.asks = mine.asks.filter((a) => a.from !== person.key)
    await save(mine)
    await (await storeReady).removeAsk(account.key, person.key) // answered by sharing
    await emitTo(person.key, "loc:shared", { key: account.key, name: account.name, until: checked.until, pos: mine.paused ? null : mine.pos })
    if (!wasActive)
      pushTo(person.key, {
        title: `${account.name} is sharing their location with you`,
        body: `${core.untilText(checked.until, t)}. Open Buddy Locator to see where they are.`,
        tag: `loc-share-${account.key}`,
        key: `loc-share-${account.key}`,
        url: `/?open=program&name=Buddy%20Locator`,
      })
    await emitTo(account.key, "loc:changed", {})
    return { me: meView(mine) }
  }

  const share = async (account, { to, until = null } = {}) => {
    const person = await findPerson(account, to)
    const mine = await load(account.key, account.name)
    const asked = mine.asks.some((a) => a.from === person.key)
    if (!account.buddies.has(person.key) && !asked) refuse(403, `Add ${person.name} to your Buddy List first.`)
    return startShare(account, mine, person, until)
  }

  const unshare = async (account, { to, all = false } = {}) => {
    const mine = await load(account.key, account.name)
    let stopped
    if (all) {
      stopped = mine.shares.map((s) => s.to)
      mine.shares = []
    } else {
      const key = normalize(String(to || ""))
      stopped = mine.shares.filter((s) => s.to === key).map((s) => s.to)
      mine.shares = mine.shares.filter((s) => s.to !== key)
    }
    const core = await loadCore()
    if (!mine.shares.some((s) => core.shareActive(s, now()))) {
      mine.pos = null
      presence.forget(account.key)
    }
    await save(mine)
    await goneFor(stopped, account.key, "stopped")
    await emitTo(account.key, "loc:changed", {})
    return { me: meView(mine), stopped: stopped.length }
  }

  const pause = async (account, { paused } = {}) => {
    const mine = await load(account.key, account.name)
    mine.paused = !!paused
    if (mine.paused) {
      mine.pos = null
      presence.forget(account.key)
    }
    await save(mine)
    const core = await loadCore()
    const viewers = mine.shares.filter((s) => core.shareActive(s, now())).map((s) => s.to)
    if (mine.paused) await goneFor(viewers, account.key, "paused")
    else for (const key of viewers) await emitTo(key, "loc:pos", { key: account.key, name: account.name, pos: null, paused: false })
    await emitTo(account.key, "loc:changed", {})
    return { me: meView(mine) }
  }

  const settings = async (account, { coarse } = {}) => {
    const core = await loadCore()
    const mine = await load(account.key, account.name)
    mine.coarse = !!coarse
    if (mine.coarse && mine.pos && !mine.pos.coarse) mine.pos = { ...core.coarsen(mine.pos), at: mine.pos.at }
    await save(mine)
    await emitTo(account.key, "loc:changed", {})
    return { me: meView(mine) }
  }

  // ---- positions ----

  const update = async (account, input = {}) => {
    const core = await loadCore()
    const checked = core.cleanPos(input)
    if (!checked.ok) refuse(400, checked.error)
    const mine = await load(account.key, account.name)
    const t = now()
    const viewers = mine.shares.filter((s) => core.shareActive(s, t))
    if (mine.paused || !viewers.length) return { kept: false, paused: !!mine.paused }
    const pos = mine.coarse ? { ...core.coarsen(checked.pos), at: t } : { ...checked.pos, at: t }
    mine.pos = pos
    await save(mine)
    // Live Venue Presence: which real venue (and court) they're at, if any (presence.js)
    const venue = (await presence.step(account.key, pos)).now
    const s = await storeReady
    for (const share of viewers) {
      if (await blockedBetween(account.key, share.to)) continue
      await emitTo(share.to, "loc:pos", { key: account.key, name: account.name, pos, venue })
      // the viewer's "tell me when ..." on me
      const viewer = await s.get(share.to)
      for (const watch of viewer?.watches || []) {
        if (watch.who !== account.key) continue
        const place = viewer.places.find((p) => p.id === watch.place)
        if (!place) continue
        const step = core.fenceStep(watch.inside ?? null, pos, place)
        if (step.inside !== (watch.inside ?? null)) await s.setInside(share.to, watch.id, step.inside)
        if (!core.watchWants(watch.on, step.event)) continue
        const words = step.event === "arrive" ? `arrived at ${place.name}` : `left ${place.name}`
        await emitTo(share.to, "loc:alert", { key: account.key, name: account.name, place: place.name, event: step.event, at: t })
        pushTo(share.to, { title: `${account.name} ${words}`, body: "Buddy Locator", tag: `loc-${watch.id}`, key: `loc-alert-${watch.id}`, url: `/?open=program&name=Buddy%20Locator` })
      }
    }
    return { kept: true, pos, venue }
  }

  // ---- asking ----

  const ask = async (account, { to } = {}) => {
    const core = await loadCore()
    const person = await findPerson(account, to)
    if (!account.buddies.has(person.key)) refuse(403, `Add ${person.name} to your Buddy List first.`)
    const theirs = await load(person.key, person.name)
    if (core.shareActive(theirs.shares.find((s) => s.to === account.key), now())) return { already: true }
    await (await storeReady).addAsk(person.key, person.name, { from: account.key, name: account.name, at: now() }, core.MAX_ASKS)
    await emitTo(person.key, "loc:ask", { from: account.key, name: account.name })
    pushTo(person.key, { title: `${account.name} would like to see your location`, body: "Open Buddy Locator to share or say no.", tag: `loc-ask-${account.key}`, key: `loc-ask-${account.key}`, url: `/?open=program&name=Buddy%20Locator` })
    return { asked: true }
  }

  const answer = async (account, { from, accept = false, until = null } = {}) => {
    const key = normalize(String(from || ""))
    const mine = await load(account.key, account.name)
    const asked = mine.asks.find((a) => a.from === key)
    if (!asked) refuse(404, "That request isn't there anymore.")
    if (!accept) {
      await (await storeReady).removeAsk(account.key, key)
      await emitTo(account.key, "loc:changed", {})
      return { me: meView(await load(account.key, account.name)) }
    }
    const person = await findPerson(account, asked.name || key)
    return startShare(account, mine, person, until)
  }

  // ---- places and alerts ----

  const places = async (account, { places: list } = {}) => {
    const core = await loadCore()
    if (!Array.isArray(list)) refuse(400, "That isn't a list of places.")
    if (list.length > core.MAX_PLACES) refuse(413, `You can name up to ${core.MAX_PLACES} places.`)
    const clean = []
    for (const input of list) {
      const checked = core.cleanPlace(input)
      if (!checked.ok) refuse(400, checked.error)
      // (an id given twice keeps it once: a venue place, "pbloscab", is one place)
      clean.push({ ...checked.place, id: checked.place.id && !clean.some((p) => p.id === checked.place.id) ? checked.place.id : newId() })
    }
    const mine = await load(account.key, account.name)
    const before = new Map(mine.places.map((p) => [p.id, p]))
    mine.places = clean
    const ids = new Set(clean.map((p) => p.id))
    // a moved or resized place starts over (not known whether they're in it)
    mine.watches = mine.watches
      .filter((w) => ids.has(w.place))
      .map((w) => {
        const was = before.get(w.place)
        const next = clean.find((p) => p.id === w.place)
        return was && (was.lat !== next.lat || was.lon !== next.lon || was.r !== next.r) ? { ...w, inside: null } : w
      })
    await save(mine)
    await emitTo(account.key, "loc:changed", {})
    return { me: meView(mine) }
  }

  const watch = async (account, { who, place, on = "both" } = {}) => {
    const core = await loadCore()
    const key = normalize(String(who || ""))
    const mine = await load(account.key, account.name)
    if (!mine.places.some((p) => p.id === place)) refuse(404, "Name the place first.")
    mine.watches = mine.watches.filter((w) => !(w.who === key && w.place === place))
    if (on !== "off") {
      if (!["arrive", "leave", "both"].includes(on)) refuse(400, "Pick arrive, leave or both.")
      const theirs = await load(key)
      if (!core.shareActive(theirs.shares.find((s) => s.to === account.key), now()) || (await blockedBetween(key, account.key))) refuse(403, "They aren't sharing their location with you.")
      if (mine.watches.length >= core.MAX_WATCHES) refuse(413, `You can have up to ${core.MAX_WATCHES} alerts.`)
      const spot = mine.places.find((p) => p.id === place)
      const inside = theirs.pos && !theirs.paused ? core.fenceStep(null, theirs.pos, spot).inside : null
      mine.watches.push({ id: newId(), who: key, place, on, inside })
    }
    await save(mine)
    await emitTo(account.key, "loc:changed", {})
    return { me: meView(mine) }
  }

  // ---- upkeep ----

  // shares that ran out: tell the viewers, forget the position if nobody can see it anymore;
  // asks older than a week go
  const sweep = async () => {
    const core = await loadCore()
    const s = await storeReady
    const t = now()
    const askBefore = t - core.ASK_DAYS * 86400_000
    let ended = 0
    for (const doc of await s.expired(t, askBefore)) {
      const done = doc.shares.filter((x) => !core.shareActive(x, t)).map((x) => x.to)
      doc.shares = doc.shares.filter((x) => core.shareActive(x, t))
      doc.asks = doc.asks.filter((a) => a.at >= askBefore)
      if (!doc.shares.length) {
        doc.pos = null
        presence.forget(doc.key)
      }
      await save(doc)
      await goneFor(done, doc.key, "ended")
      if (done.length) await emitTo(doc.key, "loc:changed", {})
      ended += done.length
    }
    return { ended }
  }
  let timer = null
  const start = () => {
    if (timer || !sweepMs) return
    timer = setInterval(() => sweep().catch((error) => console.error("[locate] sweep failed", error?.message)), sweepMs)
    timer.unref?.()
  }
  const stop = () => {
    clearInterval(timer)
    timer = null
  }

  // Delete My Account: my record goes (the people who could see me are told), and I'm taken
  // out of everyone else's (their shares with me, my asks, their alerts about me)
  const eraseAccount = async ({ key }) => {
    const core = await loadCore()
    const s = await storeReady
    const mine = await s.get(key)
    const viewers = mine ? mine.shares.filter((x) => core.shareActive(x, now())).map((x) => x.to) : []
    const removed = mine ? await s.remove(key) : false
    presence.forget(key)
    const changed = await s.pullMentions(key)
    await goneFor(viewers, key, "deleted")
    return { removed: removed ? 1 : 0, changed }
  }

  // ---- HTTP ----

  const router = () => {
    const r = express.Router()
    const requests = limiter(limits.requests ?? 400, WINDOW_MS) // per account
    const updates = limiter(limits.updates ?? 60, WINDOW_MS)
    const asks = limiter(limits.asks ?? 30, 60 * 60_000)
    const badTokens = limiter(limits.badTokens ?? 30, WINDOW_MS) // per IP
    const ipOf = (request) => String(request.headers["x-forwarded-for"] || request.socket.remoteAddress || "").split(",")[0].trim()

    const accountFor = async (token) => {
      if (!/^[0-9a-f]{48}$/.test(token)) return null
      const service = await getAim()
      for (const session of service?.sessions?.values() || []) {
        if (session.token !== token) continue
        const buddies = new Set()
        for (const group of session.user?.groups || []) for (const name of group.buddies || []) buddies.add(normalize(name))
        return { key: session.key, name: session.user?.screenName || session.key, blocked: session.user?.blocked || [], buddies }
      }
      return null
    }

    r.use(async (request, response, next) => {
      try {
        const ip = ipOf(request)
        if (badTokens.over(ip)) return response.status(429).json({ ok: false, error: "Too many tries. Please wait a few minutes." })
        const account = await accountFor(String(request.headers.authorization || "").replace(/^Bearer\s+/i, ""))
        if (!account) {
          badTokens(ip)
          return response.status(401).json({ ok: false, error: "Sign on to 98 Messenger to use Buddy Locator." })
        }
        if (requests(account.key)) return response.status(429).json({ ok: false, error: "Buddy Locator is busy. Please wait a few minutes." })
        request.account = account
        next()
      } catch (error) {
        next(error)
      }
    })
    r.use(express.json({ limit: "32kb" }))

    const handle = (fn) => async (request, response) => {
      try {
        response.json({ ok: true, ...(await fn(request.account, request.body || {})) })
      } catch (error) {
        if (error instanceof Refused) return response.status(error.status).json({ ok: false, error: error.message })
        console.error("[locate]", error?.message)
        response.status(503).json({ ok: false, error: "Buddy Locator isn't answering. Try again in a minute." })
      }
    }

    r.post("/state", handle(state))
    r.post("/share", handle(share))
    r.post("/unshare", handle(unshare))
    r.post("/pause", handle(pause))
    r.post("/settings", handle(settings))
    r.post(
      "/update",
      handle((account, body) => {
        if (updates(account.key)) refuse(429, "Your location is updating too often.")
        return update(account, body)
      })
    )
    r.post(
      "/ask",
      handle((account, body) => {
        if (asks(account.key)) refuse(429, "That's a lot of asking. Try again later.")
        return ask(account, body)
      })
    )
    r.post("/answer", handle(answer))
    r.post("/places", handle(places))
    r.post("/watch", handle(watch))

    r.use((error, request, response, next) => {
      if (response.headersSent) return next(error)
      if (error.type === "entity.too.large") return response.status(413).json({ ok: false, error: "That's too much at once." })
      if (error.type === "entity.parse.failed") return response.status(400).json({ ok: false, error: "That request didn't make sense." })
      console.error("[locate] request failed", error)
      response.status(500).json({ ok: false, error: "Buddy Locator is unavailable right now. Please try again later." })
    })
    return r
  }

  return { router, state, share, unshare, pause, settings, update, ask, answer, places, watch, sweep, start, stop, eraseAccount, getStore: () => storeReady }
}

const locateService = ({ aim, push } = {}) => createLocate({ aim, push, store: process.env.MONGODB_URI ? undefined : memoryStore() })

module.exports = { createLocate, locateService, loadCore }
