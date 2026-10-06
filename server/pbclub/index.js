// Pickleball Club 98: the real-life side of pickleball for a group of 98 Messenger friends.
// Log the games you play at real courts (the opponent confirms, so the friends' ratings stay
// honest), see a friends-only rating ladder, and plan play sessions ("Who's in?") with RSVPs,
// a waitlist, a little chat and the courts' rotation everyone at the session sees. The rules
// are client/src/components/applets/pbclub/clubCore.js (the same file the app uses).
//
// Every route needs "Authorization: Bearer <token>" from a signed-on 98 Messenger session.
// All POST, JSON in and out ({ ok, ... }):
//   /state      { season }              -> { me, sessions, matches, ladder, names, now }
//                                          season: ratings only from matches since (ms)
//   /match      { match }               log a match (pending until an opponent confirms;
//                                        "unrated" when there's no opponent on 98 Messenger)
//   /match/:id  { act }                 confirm | dispute | delete (who logged it, while it
//                                        doesn't count) | remove (ask to take a confirmed one
//                                        back) | agree (the other team agrees) | keep
//   /session    { session, id?, invite } create (or the host changes) a session; invite:
//                                        screen names
//   /session/:id/rsvp     { s, late }   in | maybe | out; late: 5 | 10 | 15 | 30 | "here" | null
//   /session/:id/invite   { to: [names] }  the host, or anyone in it when it's open
//   /session/:id/say      { text }      the session's chat (100 lines kept)
//   /session/:id/rotation { rotation }  the courts for this round (anyone who's in)
//   /session/:id/cancel   {}            the host
// Live, on the 98 Messenger socket: "pb:changed" { kind, id, by } to everyone it concerns
// (they read /state again). Push (category "pickleball") when they're away: invitations,
// a session cancelled or moved, a waitlist spot opening, a match to confirm or disputed.
//
// Caps (MongoDB's free tier is 512 MB for everything): a match record is ~0.5 KB, at most
// 2,000 logged per account (60 a day); a session is ~1-6 KB (32 players, 40 invited, 100
// chat lines), 30 upcoming hosted per account, deleted 30 days after it starts. 20 friends
// playing three times a week for a year is ~5 MB. Pending matches expire after 7 days.

const path = require("path")
const crypto = require("crypto")
const { pathToFileURL } = require("url")
const express = require("express")
const { limiter } = require("../net/limiter")
const { validate: validateName } = require("../aim/screenNames")
const { createClubStore, memoryStore } = require("./store")

const WINDOW_MS = 10 * 60_000
const SWEEP_MS = 60 * 60_000
const BOT_KEY = "smarterchild"
const OPEN_URL = "/?open=program&name=Pickleball%20Club%2098"

let coreModule = null
const loadCore = () => (coreModule ??= import(pathToFileURL(path.join(__dirname, "../../client/src/components/applets/pbclub/clubCore.js")).href))

class Refused extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}
const refuse = (status, message) => {
  throw new Refused(status, message)
}
const newId = () => crypto.randomBytes(8).toString("hex")

const createClub = ({ aim, store, push = null, now = Date.now, limits = {} } = {}) => {
  const storeReady = Promise.resolve(store || createClubStore())
  storeReady.catch((error) => console.error("[pbclub] store failed", error))
  const getAim = async () => (typeof aim === "function" ? aim() : aim)
  let ratingsVersion = 0
  const ratingsCache = new Map() // `${version}|${since}` -> ratings

  const emitTo = async (key, payload) => {
    const socket = (await getAim())?.sessions?.get(key)?.socket
    if (socket) socket.emit("pb:changed", payload)
  }
  const tell = async (keys, payload, skip = null) => {
    for (const key of new Set(keys)) if (key && key !== skip) await emitTo(key, payload)
  }
  const pushTo = (key, message) => {
    if (!push || !key) return
    Promise.resolve(push.notify(key, "pickleball", { app: "pbclub", url: OPEN_URL, ...message })).catch(() => {})
  }

  // a screen name -> { key, name } of a real account that hasn't blocked (or been blocked by) me
  const accountOf = async (me, raw) => {
    const target = validateName(raw)
    if (target.error) refuse(400, `"${String(raw).slice(0, 20)}" isn't a 98 Messenger screen name.`)
    if (target.key === BOT_KEY) refuse(400, "SmarterChild doesn't play pickleball.")
    if (target.key === me.key) return { key: me.key, name: me.name }
    const user = await (await getAim())?.store?.find?.(target.key)
    if (!user) refuse(404, `${target.screenName} is not a 98 Messenger screen name.`)
    if ((user.blocked || []).includes(me.key) || (me.blocked || []).includes(target.key)) refuse(409, `You can't add ${user.screenName} right now.`)
    return { key: target.key, name: user.screenName || target.screenName }
  }

  // ---- sessions ----

  const sessionView = (doc) => {
    const { rev, members, ...rest } = doc
    return rest
  }
  const visible = (doc, key) => doc.host === key || doc.members.includes(key)
  const getSession = async (key, id) => {
    const doc = /^[a-f0-9]{16}$/.test(String(id)) ? await (await storeReady).sessions.get(String(id)) : null
    if (!doc || !visible(doc, key)) refuse(404, "That session isn't here, or you weren't invited.")
    return doc
  }
  const changeSession = async (key, id, change) => {
    const s = await storeReady
    for (let attempt = 0; attempt < 4; attempt++) {
      const doc = await getSession(key, id)
      const next = await change(doc)
      if (!next) return doc
      const members = [...new Set([next.host, ...(next.invited || []), ...Object.keys(next.rsvps || {})])]
      const saved = await s.sessions.put({ ...next, members, changedAt: now() }, doc.rev)
      if (saved.ok) return { ...next, members, rev: saved.rev }
    }
    refuse(409, "Someone else is changing that session. Try again in a moment.")
  }

  const inviteKeys = async (me, names, doc, core) => {
    const added = []
    for (const raw of (Array.isArray(names) ? names : []).slice(0, core.LIMITS.invited)) {
      if (!String(raw || "").trim()) continue
      const who = await accountOf(me, raw)
      if (who.key === me.key || doc.invited.includes(who.key) || doc.host === who.key || added.some((a) => a.key === who.key)) continue
      added.push(who)
    }
    if (doc.invited.length + added.length > core.LIMITS.invited) refuse(413, `A session can invite at most ${core.LIMITS.invited} people.`)
    return added
  }

  const whenText = (core, doc) => core.sessionWhen(doc.start, doc.minutes, { timeZone: "America/Los_Angeles" })

  const saveSession = async (me, { session, id, invite } = {}) => {
    const core = await loadCore()
    const s = await storeReady
    const checked = core.cleanSession(session, now())
    if (!checked.ok) refuse(400, checked.error)
    if (id) {
      let moved = false
      let before = []
      const doc = await changeSession(me.key, id, async (doc) => {
        before = doc.invited
        if (doc.host !== me.key) refuse(403, "Only the host can change the session.")
        if (doc.cancelled) refuse(409, "That session was cancelled.")
        moved = doc.start !== checked.session.start || doc.venue?.id !== checked.session.venue?.id || doc.venue?.name !== checked.session.venue?.name
        const added = await inviteKeys(me, invite, doc, core)
        return { ...doc, ...checked.session, invited: [...doc.invited, ...added.map((a) => a.key)], names: { ...doc.names, ...Object.fromEntries(added.map((a) => [a.key, a.name])) } }
      })
      const fresh = doc.invited.filter((k) => !before.includes(k))
      for (const key of fresh) {
        await emitTo(key, { kind: "session", id: doc.id, by: me.name, invited: true })
        pushTo(key, { title: `${me.name} invited you to play pickleball`, body: `${core.venueName(doc.venue, { short: true })} · ${whenText(core, doc)}. In or out?`, tag: `pb-s-${doc.id}`, key: `pb-s-${doc.id}`, url: `${OPEN_URL}&pbsession=${doc.id}` })
      }
      await tell(doc.members.filter((k) => !fresh.includes(k)), { kind: "session", id: doc.id, by: me.name }, me.key)
      if (moved) for (const key of doc.members) if (key !== me.key && doc.rsvps?.[key]?.s !== "out") pushTo(key, { title: `${me.name} changed ${doc.title}`, body: `${core.venueName(doc.venue, { short: true })} · ${whenText(core, doc)}`, tag: `pb-s-${doc.id}`, key: `pb-s-${doc.id}`, url: `${OPEN_URL}&pbsession=${doc.id}` })
      return { session: sessionView(doc) }
    }
    if ((await s.sessions.hostedSince(me.key, now() - 6 * 3_600_000)) >= core.LIMITS.sessionsHosted) refuse(413, `You're hosting ${core.LIMITS.sessionsHosted} upcoming sessions already. Cancel one first.`)
    const t = now()
    const blank = { invited: [], host: me.key }
    const added = await inviteKeys(me, invite, blank, core)
    const doc = {
      id: newId(),
      host: me.key,
      names: { [me.key]: me.name, ...Object.fromEntries(added.map((a) => [a.key, a.name])) },
      ...checked.session,
      invited: added.map((a) => a.key),
      rsvps: { [me.key]: { s: "in", at: t } },
      chat: [],
      rotation: null,
      cancelled: false,
      changedAt: t,
      createdAt: t,
    }
    doc.members = [...new Set([me.key, ...doc.invited])]
    await s.sessions.create(doc)
    for (const a of added) {
      await emitTo(a.key, { kind: "session", id: doc.id, by: me.name, invited: true })
      pushTo(a.key, { title: `${me.name} invited you to play pickleball`, body: `${core.venueName(doc.venue, { short: true })} · ${whenText(core, doc)}. In or out?`, tag: `pb-s-${doc.id}`, key: `pb-s-${doc.id}`, url: `${OPEN_URL}&pbsession=${doc.id}` })
    }
    return { session: sessionView({ ...doc, rev: 1 }) }
  }

  const rsvp = async (me, id, { s: answer, late } = {}) => {
    const core = await loadCore()
    if (!["in", "maybe", "out"].includes(answer) && late === undefined) refuse(400, "In, maybe or out?")
    let before = null
    const doc = await changeSession(me.key, id, async (doc) => {
      if (doc.cancelled) refuse(409, "That session was cancelled.")
      before = core.rsvpLists(doc)
      const current = doc.rsvps?.[me.key] || null
      const next = { ...(current || { s: "maybe", at: now() }) }
      if (answer && answer !== current?.s) {
        next.s = answer
        next.at = now() // the waitlist goes by when you said in
        if (answer !== "in") delete next.late
      }
      if (late !== undefined) {
        if (late === null) delete next.late
        else if (late === "here" || core.LATE.includes(Number(late))) next.late = late === "here" ? "here" : Number(late)
        else refuse(400, "How late?")
      }
      return { ...doc, rsvps: { ...doc.rsvps, [me.key]: next }, names: { ...doc.names, [me.key]: me.name } }
    })
    const after = core.rsvpLists(doc)
    await tell(doc.members, { kind: "session", id: doc.id, by: me.name }, me.key)
    // a waitlist spot opened: tell whoever moved up
    for (const key of after.in) if (before && before.waitlist.includes(key)) pushTo(key, { title: "You're in!", body: `A spot opened at ${doc.title} (${whenText(core, doc)}).`, tag: `pb-s-${doc.id}`, key: `pb-in-${doc.id}`, url: `${OPEN_URL}&pbsession=${doc.id}` })
    if (late !== undefined && late !== null && late !== "here" && doc.host !== me.key) pushTo(doc.host, { title: `${me.name} is running ${late} min late`, body: doc.title, tag: `pb-late-${doc.id}`, key: `pb-late-${doc.id}-${me.key}`, url: `${OPEN_URL}&pbsession=${doc.id}` })
    return { session: sessionView(doc) }
  }

  const inviteMore = async (me, id, to) => {
    const core = await loadCore()
    let added = []
    const doc = await changeSession(me.key, id, async (doc) => {
      if (doc.cancelled) refuse(409, "That session was cancelled.")
      if (doc.host !== me.key && !doc.open) refuse(403, "Only the host can invite people to this one.")
      added = await inviteKeys(me, to, doc, core)
      if (!added.length) return null
      return { ...doc, invited: [...doc.invited, ...added.map((a) => a.key)], names: { ...doc.names, ...Object.fromEntries(added.map((a) => [a.key, a.name])) } }
    })
    for (const a of added) pushTo(a.key, { title: `${me.name} invited you to play pickleball`, body: `${core.venueName(doc.venue, { short: true })} · ${whenText(core, doc)}. In or out?`, tag: `pb-s-${doc.id}`, key: `pb-s-${doc.id}`, url: `${OPEN_URL}&pbsession=${doc.id}` })
    for (const a of added) await emitTo(a.key, { kind: "session", id: doc.id, by: me.name, invited: true })
    await tell(doc.members.filter((k) => !added.some((a) => a.key === k)), { kind: "session", id: doc.id, by: me.name }, me.key)
    return { session: sessionView(doc), added: added.map((a) => a.name) }
  }

  const say = async (me, id, raw) => {
    const core = await loadCore()
    const t = String(raw ?? "")
      .replace(/[\u0000-\u001F\u007F]/g, " ")
      .trim()
      .slice(0, core.LIMITS.chatText)
    if (!t) refuse(400, "Type something first.")
    const doc = await changeSession(me.key, id, async (doc) => ({ ...doc, chat: [...(doc.chat || []), { k: me.key, t, at: now() }].slice(-core.LIMITS.chat), names: { ...doc.names, [me.key]: me.name } }))
    await tell(doc.members, { kind: "session", id: doc.id, by: me.name, chat: true }, me.key)
    return { session: sessionView(doc) }
  }

  const setRotation = async (me, id, rotation) => {
    const core = await loadCore()
    const json = JSON.stringify(rotation ?? null)
    if (json.length > 12_000) refuse(413, "That rotation is too big.")
    const doc = await changeSession(me.key, id, async (doc) => {
      const lists = core.rsvpLists(doc)
      if (doc.host !== me.key && !lists.in.includes(me.key)) refuse(403, "Say you're in to run the courts.")
      return { ...doc, rotation: rotation ? { ...JSON.parse(json), by: me.key, at: now() } : null }
    })
    await tell(doc.members, { kind: "session", id: doc.id, by: me.name, rotation: true }, me.key)
    return { session: sessionView(doc) }
  }

  const cancel = async (me, id) => {
    const core = await loadCore()
    const doc = await changeSession(me.key, id, async (doc) => {
      if (doc.host !== me.key) refuse(403, "Only the host can cancel the session.")
      if (doc.cancelled) return null
      return { ...doc, cancelled: true }
    })
    await tell(doc.members, { kind: "session", id: doc.id, by: me.name }, me.key)
    for (const key of doc.members) if (key !== me.key && doc.rsvps?.[key]?.s !== "out") pushTo(key, { title: `${doc.title} is cancelled`, body: `${me.name} cancelled ${whenText(core, doc)}.`, tag: `pb-s-${doc.id}`, key: `pb-x-${doc.id}`, url: `${OPEN_URL}&pbsession=${doc.id}` })
    return { session: sessionView(doc) }
  }

  // ---- matches ----

  const logMatch = async (me, input) => {
    const core = await loadCore()
    const s = await storeReady
    const checked = core.cleanMatch(input, now())
    if (!checked.ok) refuse(400, checked.error)
    const m = checked.match
    if (m.id && (await s.matches.get(m.id))) {
      const existing = await s.matches.get(m.id)
      if (existing.by === me.key) return { match: existing, duplicate: true } // sent twice (offline queue)
      m.id = null
    }
    if ((await s.matches.countBy(me.key)) >= core.LIMITS.matchesPerAccount) refuse(413, `You've logged ${core.LIMITS.matchesPerAccount} matches, the most there's room for.`)
    if ((await s.matches.countBy(me.key, now() - core.DAY)) >= core.LIMITS.matchesPerDay) refuse(429, "That's a lot of matches for one day. Try again tomorrow.")
    // every account in it must be real (and not blocking you)
    const names = { [me.key]: me.name }
    for (const p of m.teams.flat()) {
      if (!p.k) continue
      const who = await accountOf(me, p.k)
      p.k = who.key
      names[who.key] = who.name
    }
    const keys = core.keysIn(m)
    if (!keys.includes(me.key)) {
      // logging someone else's game: only at a session you're both part of
      const sess = m.session ? await s.sessions.get(m.session) : null
      if (!sess || !visible(sess, me.key) || keys.some((k) => !visible(sess, k))) refuse(403, "You can only log matches you played (or ones at a session you're in).")
    }
    const t = now()
    const doc = { ...m, id: m.id || newId(), by: me.key, keys, names, status: core.startStatus(m, me.key), createdAt: t, changedAt: t }
    await s.matches.create(doc)
    if (doc.status === "pending") {
      for (const key of keys) {
        if (key === me.key) continue
        await emitTo(key, { kind: "match", id: doc.id, by: me.name, confirm: core.canConfirm(doc, key) })
        if (core.canConfirm(doc, key)) pushTo(key, { title: `${me.name} logged a match with you`, body: `${scoreLine(doc)} at ${core.venueName(doc.venue, { short: true })}. Confirm it?`, tag: `pb-m-${doc.id}`, key: `pb-m-${doc.id}`, url: `${OPEN_URL}&pbmatch=${doc.id}` })
      }
    } else await tell(keys, { kind: "match", id: doc.id, by: me.name }, me.key)
    if (doc.status === "confirmed") ratingsVersion++
    return { match: doc }
  }

  const scoreLine = (m) => m.games.map(([a, b]) => `${a}-${b}`).join(", ")

  const actOnMatch = async (me, id, act) => {
    const core = await loadCore()
    const s = await storeReady
    for (let attempt = 0; attempt < 4; attempt++) {
      const doc = /^[a-f0-9]{16}$/.test(String(id)) ? await s.matches.get(String(id)) : null
      if (!doc || (!doc.keys.includes(me.key) && doc.by !== me.key)) refuse(404, "That match isn't here.")
      doc.status = core.expireStatus(doc, now())
      let next = null
      let removeIt = false
      let note = null
      if (act === "confirm") {
        if (!core.canConfirm(doc, me.key)) refuse(409, doc.status === "pending" ? "Someone on the other team confirms it." : "That match isn't waiting for anyone.")
        next = { ...doc, status: "confirmed", confirmedBy: me.key }
        note = { title: `${me.name} confirmed your match`, body: scoreLine(doc) }
      } else if (act === "dispute") {
        if (!core.canConfirm(doc, me.key)) refuse(409, "That match isn't waiting for you.")
        next = { ...doc, status: "disputed", disputedBy: me.key }
        note = { title: `${me.name} says that score isn't right`, body: `${scoreLine(doc)}: fix it and log it again, or delete it.` }
      } else if (act === "delete") {
        if (doc.by !== me.key) refuse(403, "Only the person who logged it can delete it.")
        if (core.counts(doc) && doc.status !== "unrated") refuse(409, "It's confirmed: ask to remove it instead.")
        removeIt = true
      } else if (act === "remove") {
        if (doc.status === "unrated" && doc.by === me.key) removeIt = true
        else {
          if (doc.status !== "confirmed") refuse(409, "Only a confirmed match can be taken back.")
          const t = core.teamOf(doc, me.key)
          if (t < 0) refuse(403, "You didn't play in it.")
          next = { ...doc, status: "removing", removeTeam: t, removeBy: me.key }
          note = { title: `${me.name} asked to remove a match`, body: `${scoreLine(doc)}. Agree in Pickleball Club 98 to take it off your record.` }
        }
      } else if (act === "agree") {
        if (!core.canAgreeRemove(doc, me.key)) refuse(409, "That isn't waiting for you.")
        removeIt = true
      } else if (act === "keep") {
        if (doc.status !== "removing" || !doc.keys.includes(me.key)) refuse(409, "That isn't waiting for anyone.")
        if (core.teamOf(doc, me.key) === doc.removeTeam && doc.removeBy !== me.key) refuse(403, "Someone on the other team decides.")
        next = { ...doc, status: "confirmed", removeTeam: null, removeBy: null }
      } else refuse(400, "Confirm, dispute, delete or remove?")
      if (removeIt) {
        await s.matches.remove(doc.id)
        ratingsVersion++
        await tell(doc.keys, { kind: "match", id: doc.id, by: me.name, gone: true }, me.key)
        return { removed: doc.id }
      }
      const saved = await s.matches.put({ ...next, changedAt: now() }, doc.rev)
      if (!saved.ok) continue
      ratingsVersion++
      await tell([...doc.keys, doc.by], { kind: "match", id: doc.id, by: me.name }, me.key)
      if (note) {
        const to = act === "remove" ? doc.keys.filter((k) => core.teamOf(doc, k) !== core.teamOf(doc, me.key)) : [doc.by]
        for (const key of to) if (key !== me.key) pushTo(key, { ...note, tag: `pb-m-${doc.id}`, key: `pb-m-${doc.id}-${act}`, url: `${OPEN_URL}&pbmatch=${doc.id}` })
      }
      return { match: { ...next, rev: saved.rev } }
    }
    refuse(409, "That match is being changed somewhere else. Try again in a moment.")
  }

  // ---- what one person sees ----

  const ratingsSince = async (since) => {
    const core = await loadCore()
    const k = `${ratingsVersion}|${since}`
    if (!ratingsCache.has(k)) {
      if (ratingsCache.size > 20) ratingsCache.clear()
      ratingsCache.set(k, core.computeRatings(await (await storeReady).matches.rated(), { since }))
    }
    return ratingsCache.get(k)
  }

  const state = async (me, { season = 0 } = {}) => {
    const core = await loadCore()
    const s = await storeReady
    const t = now()
    const matches = (await s.matches.forKey(me.key, 500)).map((m) => ({ ...m, status: core.expireStatus(m, t) }))
    const sessions = (await s.sessions.forKey(me.key)).filter((d) => d.start > t - core.SESSION_KEEP_DAYS * core.DAY).sort((a, b) => a.start - b.start)
    // the ladder: me and everyone I've played or planned with
    const circle = new Set([me.key])
    const names = { [me.key]: me.name }
    for (const m of matches) for (const k of m.keys) circle.add(k), (names[k] ??= m.names?.[k] || k)
    for (const d of sessions) for (const k of d.members) circle.add(k), (names[k] ??= d.names?.[k] || k)
    const since = Number.isFinite(Number(season)) ? Math.max(0, Number(season)) : 0
    const ratings = await ratingsSince(since)
    const pick = (table) => Object.fromEntries(Object.entries(table).filter(([id]) => id.startsWith("k:") && circle.has(id.slice(2))))
    return { me: me.key, now: t, sessions: sessions.map(sessionView), matches, ladder: { singles: pick(ratings.singles), doubles: pick(ratings.doubles) }, names }
  }

  // tidy up: sessions 30 days after they started; pending matches nobody confirmed
  const sweep = async () => {
    const core = await loadCore()
    const s = await storeReady
    for (const id of await s.sessions.startedBefore(now() - core.SESSION_KEEP_DAYS * core.DAY)) await s.sessions.remove(id)
    for (const m of await s.matches.pendingBefore(now() - core.CONFIRM_DAYS * core.DAY)) await s.matches.put({ ...m, status: "expired", changedAt: now() }, m.rev)
  }
  let sweeper = null
  const start = () => {
    if (!sweeper) {
      sweeper = setInterval(() => sweep().catch((error) => console.error("[pbclub] sweep failed", error?.message)), SWEEP_MS)
      sweeper.unref?.()
    }
  }
  const stop = () => {
    clearInterval(sweeper)
    sweeper = null
  }

  // Delete My Account (../account): sessions they host are deleted (the others are told);
  // they're taken out of everyone else's sessions (RSVP, invitation, chat lines). In matches
  // they played they become "Deleted player": a random id that isn't linked to them, so the
  // other players' records and ratings stay as they were; a match with no other account in
  // it, and ones they logged that nobody confirmed, are deleted.
  const eraseAccount = async ({ key }) => {
    const s = await storeReady
    const anon = `x${crypto.randomBytes(6).toString("hex")}`
    let sessionsRemoved = 0
    let sessionsLeft = 0
    let matchesAnon = 0
    let matchesRemoved = 0
    for (const doc of await s.sessions.forKey(key)) {
      if (doc.host === key) {
        await s.sessions.remove(doc.id)
        sessionsRemoved++
        await tell(doc.members, { kind: "session", id: doc.id, gone: true }, key)
        continue
      }
      for (let attempt = 0; attempt < 4; attempt++) {
        const fresh = attempt ? await s.sessions.get(doc.id) : doc
        if (!fresh) break
        const { [key]: dropR, ...rsvps } = fresh.rsvps || {}
        const { [key]: dropN, ...names } = fresh.names || {}
        const rotation = fresh.rotation ? JSON.parse(JSON.stringify(fresh.rotation).split(`"k:${key}"`).join('"g:Deleted player"')) : null
        const next = { ...fresh, rsvps, names, rotation, invited: (fresh.invited || []).filter((k) => k !== key), members: (fresh.members || []).filter((k) => k !== key), chat: (fresh.chat || []).filter((c) => c.k !== key), changedAt: now() }
        if ((await s.sessions.put(next, fresh.rev)).ok) {
          sessionsLeft++
          await tell(next.members, { kind: "session", id: doc.id }, key)
          break
        }
      }
    }
    for (const m of await s.matches.forKey(key, 1e6)) {
      const others = m.keys.filter((k) => k !== key)
      if (!others.length || (m.by === key && (m.status === "pending" || m.status === "disputed"))) {
        await s.matches.remove(m.id)
        matchesRemoved++
        continue
      }
      for (let attempt = 0; attempt < 4; attempt++) {
        const fresh = attempt ? await s.matches.get(m.id) : m
        if (!fresh) break
        const { [key]: drop, ...names } = fresh.names || {}
        const swap = (k) => (k === key ? anon : k)
        const next = {
          ...fresh,
          by: swap(fresh.by),
          keys: fresh.keys.map(swap),
          names: { ...names, [anon]: "Deleted player" },
          teams: fresh.teams.map((t) => t.map((p) => (p.k === key ? { k: anon } : p))),
          confirmedBy: fresh.confirmedBy === key ? anon : fresh.confirmedBy,
          disputedBy: fresh.disputedBy === key ? anon : fresh.disputedBy,
          removeBy: fresh.removeBy === key ? anon : fresh.removeBy,
          changedAt: now(),
        }
        if ((await s.matches.put(next, fresh.rev)).ok) {
          matchesAnon++
          await tell(others, { kind: "match", id: m.id }, key)
          break
        }
      }
    }
    ratingsVersion++
    return { sessionsRemoved, sessionsLeft, matchesAnon, matchesRemoved }
  }

  // ---- HTTP ----

  const router = () => {
    const r = express.Router()
    const writes = limiter(limits.writes ?? 400, WINDOW_MS) // per account
    const badTokens = limiter(limits.badTokens ?? 30, WINDOW_MS) // per IP
    const ipOf = (request) => String(request.headers["x-forwarded-for"] || request.socket.remoteAddress || "").split(",")[0].trim()

    const accountFor = async (token) => {
      if (!/^[0-9a-f]{48}$/.test(token)) return null
      const service = await getAim()
      for (const session of service?.sessions?.values() || []) {
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
          return response.status(401).json({ ok: false, error: "Sign on to 98 Messenger to use Pickleball Club 98 with your friends." })
        }
        if (writes(account.key)) return response.status(429).json({ ok: false, error: "That's a lot at once. Please wait a few minutes." })
        request.account = account
        next()
      } catch (error) {
        next(error)
      }
    })
    r.use(express.json({ limit: "64kb" }))

    const handle = (fn) => async (request, response) => {
      try {
        response.json({ ok: true, ...(await fn(request)) })
      } catch (error) {
        if (error instanceof Refused) return response.status(error.status).json({ ok: false, error: error.message })
        console.error("[pbclub]", error?.message)
        response.status(503).json({ ok: false, error: "Pickleball Club isn't answering. Try again in a minute." })
      }
    }
    const b = (request) => request.body || {}

    r.post("/state", handle((q) => state(q.account, b(q))))
    r.post("/match", handle((q) => logMatch(q.account, b(q).match)))
    r.post("/match/:id", handle((q) => actOnMatch(q.account, q.params.id, b(q).act)))
    r.post("/session", handle((q) => saveSession(q.account, b(q))))
    r.post("/session/:id/rsvp", handle((q) => rsvp(q.account, q.params.id, b(q))))
    r.post("/session/:id/invite", handle((q) => inviteMore(q.account, q.params.id, b(q).to)))
    r.post("/session/:id/say", handle((q) => say(q.account, q.params.id, b(q).text)))
    r.post("/session/:id/rotation", handle((q) => setRotation(q.account, q.params.id, b(q).rotation)))
    r.post("/session/:id/cancel", handle((q) => cancel(q.account, q.params.id)))

    r.use((error, request, response, next) => {
      if (response.headersSent) return next(error)
      if (error.type === "entity.too.large") return response.status(413).json({ ok: false, error: "That's too much at once." })
      if (error.type === "entity.parse.failed") return response.status(400).json({ ok: false, error: "That didn't make sense to the server." })
      console.error("[pbclub] request failed", error)
      response.status(500).json({ ok: false, error: "Pickleball Club is unavailable right now. Please try again later." })
    })
    return r
  }

  return { router, state, logMatch, actOnMatch, saveSession, rsvp, inviteMore, say, setRotation, cancel, sweep, start, stop, eraseAccount, getStore: () => storeReady }
}

const clubService = ({ aim, push } = {}) => createClub({ aim, push, store: process.env.MONGODB_URI ? undefined : memoryStore() })

module.exports = { createClub, clubService, loadCore }
