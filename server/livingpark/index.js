// Living Park (Pickleball 98's My Park): leave your Twin Clone at a venue's park while you're
// away, and your buddies can challenge it there. It plays in your measured style (the clone
// profile, twin/clone/profile.js) and says only lines from your own phrasebook. Results go
// into its memory log, you get a push ("Your clone lost to Sam 7-11 at Los Cab"), and a
// "while you were away" card when you come back. The rules: client/.../pickleball/park/living.js
// (the same file the app uses).
//
// Consent: only your own clone ("self", the one you made of yourself) can be left, only by
// you, and only your buddies (on your Buddy List, not blocked either way) see it, only while
// you're signed off. Nothing here moves a real person's player: a clone only plays for its
// absent owner.
//
// Every route needs "Authorization: Bearer <token>" from a signed-on 98 Messenger session.
// All POST, JSON in and out ({ ok, ... }):
//   /mine    {}                              -> { record|null, away: { games, won, lost, entries, headline } }
//   /leave   { venue, clone, look, phrases } leave (or update) yours; one venue at a time
//   /recall  {}                              take it back (its log goes too)
//   /seen    {}                              the "while you were away" card was read
//   /venue   { venue }                       -> { clones: [{ owner, name, clone, look, phrases }] }
//                                               your buddies' clones there whose owners are away
//   /result  { owner, cloneWon, score: [clone, visitor] }  you played someone's clone
//
// Caps (MongoDB's free tier is 512 MB for everything): one record per account (~4-20 KB: the
// clone is ≤ 16 KB, 20 lines, 50 log entries), at most MAX_RECORDS in all; 20 results a day
// per visitor and clone; records left alone for 60 days are taken back.

const path = require("path")
const crypto = require("crypto")
const { pathToFileURL } = require("url")
const express = require("express")
const { limiter } = require("../net/limiter")
const { sanitizeLook } = require("../arcade/games/pickleballLooks")
const { createLivingStore, memoryStore } = require("./store")

const WINDOW_MS = 10 * 60_000
const DAY = 86_400_000
const STALE_MS = 60 * DAY
const MAX_RECORDS = 2000
const RESULTS_PER_DAY = 20
const OPEN_URL = "/?open=program&name=Pickleball%2098"
const VENUES = require("../park/venues.json")
const VENUE_NAMES = { riverside: "Riverside Park", loscab: "Los Cab", newport: "Newport Beach Club", wolfbear: "Wolf + Bear", whittier: "Whittier Narrows", paseo: "The Paseo Club", sinaloa: "Sinaloa", smash: "California SMASH", bouquet: "Bouquet Canyon" }

let rules = null
let profiles = null
const loadRules = () => (rules ??= import(pathToFileURL(path.join(__dirname, "../../client/src/components/applets/pickleball/park/living.js")).href))
const loadProfiles = () => (profiles ??= import(pathToFileURL(path.join(__dirname, "../../client/src/components/applets/pickleball/twin/clone/profile.js")).href))

class Refused extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}
const refuse = (status, message) => {
  throw new Refused(status, message)
}
const venueOk = (v) => typeof v === "string" && Object.prototype.hasOwnProperty.call(VENUES, v)
const keyOf = (name) => String(name || "").replace(/\s+/g, "").toLowerCase()

const createLivingPark = ({ aim, store, push = null, now = Date.now, limits = {} } = {}) => {
  const storeReady = Promise.resolve(store || createLivingStore())
  storeReady.catch((error) => console.error("[livingpark] store failed", error))
  const getAim = async () => (typeof aim === "function" ? aim() : aim)
  const resultHits = new Map() // `${visitor}|${owner}|${day}` -> count

  const online = async (key) => !!(await getAim())?.sessions?.get(key)
  const userOf = async (key) => (await getAim())?.store?.find?.(key)
  const buddiesOf = (user) => new Set((user?.groups || []).flatMap((g) => (g.buddies || []).map(keyOf)))

  // ---- yours ----
  const mine = async (me) => {
    const r = await loadRules()
    const record = await (await storeReady).get(me.key)
    return { record, away: r.awaySummary(record?.log || [], record?.unseen || 0) }
  }

  const leave = async (me, { venue, clone, look, phrases } = {}) => {
    const r = await loadRules()
    const p = await loadProfiles()
    if (!venueOk(venue)) refuse(400, "Pick one of the venues to leave your clone at.")
    if (!clone || clone.origin !== "self") refuse(403, "Only the clone you made of yourself can be left in the park.")
    let profile
    try {
      // (the share-file checks: bounded counts, known fields; "self" is kept as yours)
      profile = { ...p.fromCloneFile({ ...clone }, { from: me.name }), origin: "self" }
    } catch (error) {
      refuse(400, error.message || "That clone couldn't be read.")
    }
    const s = await storeReady
    for (let attempt = 0; attempt < 4; attempt++) {
      const cur = await s.get(me.key)
      if (!cur && (await s.count()) >= (limits.records ?? MAX_RECORDS)) refuse(507, "The park is full of clones right now. Try again later.")
      const next = {
        key: me.key,
        name: me.name,
        venue,
        clone: profile,
        look: sanitizeLook(look) || null,
        phrases: r.cleanPhrases(phrases),
        log: cur?.log || [],
        unseen: cur?.unseen || 0,
        leftAt: cur?.leftAt && cur.venue === venue ? cur.leftAt : now(),
        changedAt: now(),
      }
      const saved = await s.put(next, cur ? cur.rev : null)
      if (saved.ok) return { record: { ...next, rev: saved.rev } }
    }
    refuse(409, "Your clone is being changed somewhere else. Try again in a moment.")
  }

  const recall = async (me) => {
    await (await storeReady).remove(me.key)
    return { recalled: true }
  }

  const seen = async (me) => {
    const s = await storeReady
    for (let attempt = 0; attempt < 4; attempt++) {
      const cur = await s.get(me.key)
      if (!cur || !cur.unseen) return { seen: true }
      const saved = await s.put({ ...cur, unseen: 0 }, cur.rev)
      if (saved.ok) return { seen: true }
    }
    return { seen: false }
  }

  // ---- visiting ----
  const atVenue = async (me, { venue } = {}) => {
    if (!venueOk(venue)) return { clones: [] }
    const list = await (await storeReady).atVenue(venue)
    const out = []
    for (const rec of list) {
      if (rec.key === me.key) continue
      if (await online(rec.key)) continue // (they're here: the clone stands down)
      const owner = await userOf(rec.key)
      if (!owner) continue
      if ((owner.blocked || []).includes(me.key) || (me.blocked || []).includes(rec.key)) continue
      if (!buddiesOf(owner).has(me.key)) continue // only their buddies
      out.push({ owner: rec.key, name: rec.name, clone: rec.clone, look: rec.look, phrases: rec.phrases })
      if (out.length >= 12) break
    }
    return { clones: out }
  }

  const result = async (me, { owner, cloneWon, score } = {}) => {
    const r = await loadRules()
    const ownerKey = keyOf(owner)
    if (!ownerKey || ownerKey === me.key) refuse(400, "That isn't someone else's clone.")
    const sc = Array.isArray(score) ? score.slice(0, 2).map((n) => Math.max(0, Math.min(99, Math.round(Number(n) || 0)))) : null
    if (!sc || sc.length !== 2 || sc[0] === sc[1]) refuse(400, "That score doesn't look finished.")
    if (!!cloneWon !== sc[0] > sc[1]) refuse(400, "The score and the winner don't agree.")
    const day = Math.floor(now() / DAY)
    const hitKey = `${me.key}|${ownerKey}|${day}`
    const hits = (resultHits.get(hitKey) || 0) + 1
    if (hits > (limits.resultsPerDay ?? RESULTS_PER_DAY)) refuse(429, "That's a lot of games against one clone today.")
    resultHits.set(hitKey, hits)
    if (resultHits.size > 5000) for (const k of resultHits.keys()) if (!k.endsWith(`|${day}`)) resultHits.delete(k)
    const s = await storeReady
    for (let attempt = 0; attempt < 4; attempt++) {
      const cur = await s.get(ownerKey)
      if (!cur) refuse(404, "That clone has gone home.")
      const ownerUser = await userOf(ownerKey)
      if (!ownerUser || !buddiesOf(ownerUser).has(me.key) || (ownerUser.blocked || []).includes(me.key)) refuse(404, "That clone has gone home.")
      const entry = { id: crypto.randomBytes(6).toString("hex"), at: now(), by: me.name, byKey: me.key, cloneWon: !!cloneWon, score: sc, venue: cur.venue }
      const next = { ...cur, log: r.addToLog(cur.log, entry), unseen: Math.min(r.LIMITS.log, (cur.unseen || 0) + 1), changedAt: now() }
      const saved = await s.put(next, cur.rev)
      if (saved.ok) {
        if (push) {
          const body = r.resultText({ by: me.name, cloneWon: !!cloneWon, score: sc, venueName: VENUE_NAMES[cur.venue] })
          Promise.resolve(push.notify(ownerKey, "pickleball", { app: "pbclub", title: "Living Park", body, url: OPEN_URL, tag: `clone-${ownerKey}`, key: `clone-${entry.id}` }, { from: me.key })).catch(() => {})
        }
        return { logged: entry.id }
      }
    }
    refuse(409, "Try again in a moment.")
  }

  // ---- upkeep and Delete My Account ----
  const sweep = async () => {
    const s = await storeReady
    let removed = 0
    for (const rec of await s.all()) if (now() - (rec.changedAt || 0) > STALE_MS) removed += (await s.remove(rec.key)) ? 1 : 0
    return { removed }
  }
  let timer = null
  const start = () => {
    if (!timer) timer = setInterval(() => sweep().catch(() => {}), 6 * 60 * 60_000)
    timer.unref?.()
  }
  const stop = () => {
    clearInterval(timer)
    timer = null
  }

  // their clone goes; in other clones' logs they become "Deleted player"
  const eraseAccount = async ({ key }) => {
    const s = await storeReady
    let removed = (await s.remove(key)) ? 1 : 0
    let changed = 0
    for (const rec of await s.all()) {
      if (!(rec.log || []).some((e) => e.byKey === key)) continue
      const next = { ...rec, log: rec.log.map((e) => (e.byKey === key ? { ...e, by: "Deleted player", byKey: null } : e)) }
      if ((await s.put(next, rec.rev)).ok) changed++
    }
    return { removed, changed }
  }

  const router = () => {
    const r = express.Router()
    const writes = limiter(limits.writes ?? 300, WINDOW_MS)
    const badTokens = limiter(limits.badTokens ?? 30, WINDOW_MS)
    const ipOf = (request) => String(request.headers["x-forwarded-for"] || request.socket.remoteAddress || "").split(",")[0].trim()
    const accountFor = async (token) => {
      if (!/^[0-9a-f]{48}$/.test(token)) return null
      for (const session of (await getAim())?.sessions?.values() || []) {
        if (session.token === token) return { key: session.key, name: session.user?.screenName || session.key, blocked: session.user?.blocked || [] }
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
          return response.status(401).json({ ok: false, error: "Sign on to 98 Messenger to use Living Park." })
        }
        if (writes(account.key)) return response.status(429).json({ ok: false, error: "That's a lot at once. Please wait a few minutes." })
        request.account = account
        next()
      } catch (error) {
        next(error)
      }
    })
    r.use(express.json({ limit: "48kb" }))
    const handle = (fn) => async (request, response) => {
      try {
        response.json({ ok: true, ...(await fn(request.account, request.body || {})) })
      } catch (error) {
        if (error instanceof Refused) return response.status(error.status).json({ ok: false, error: error.message })
        console.error("[livingpark]", error?.message)
        response.status(503).json({ ok: false, error: "Living Park isn't answering. Try again in a minute." })
      }
    }
    r.post("/mine", handle(mine))
    r.post("/leave", handle(leave))
    r.post("/recall", handle(recall))
    r.post("/seen", handle(seen))
    r.post("/venue", handle(atVenue))
    r.post("/result", handle(result))
    r.use((error, request, response, next) => {
      if (response.headersSent) return next(error)
      if (error.type === "entity.too.large") return response.status(413).json({ ok: false, error: "That's too much at once." })
      if (error.type === "entity.parse.failed") return response.status(400).json({ ok: false, error: "That didn't make sense to the server." })
      response.status(500).json({ ok: false, error: "Living Park is unavailable right now." })
    })
    return r
  }

  return { router, mine, leave, recall, seen, atVenue, result, sweep, start, stop, eraseAccount, getStore: () => storeReady }
}

const livingParkService = ({ aim, push } = {}) => createLivingPark({ aim, push, store: process.env.MONGODB_URI ? undefined : memoryStore() })

module.exports = { createLivingPark, livingParkService }
