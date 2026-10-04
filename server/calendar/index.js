// 98ish Calendar: shared calendars for 98 Messenger accounts.
//
// Everyone signed on has a personal calendar ("My Calendar"); a paired couple (see
// ../couples) gets an "Us" calendar both of them see, for as long as they're paired; and
// anyone can start a group calendar (family, friends) and invite people by screen name or
// with an invite code / link. Members are "owner" or "member"; every member can add, change
// and comment on events, and only the owner renames or deletes a calendar or removes people.
// Only members can read or write a calendar: anyone else gets 404.
//
// Every route needs a signed-on 98 Messenger session (Authorization: Bearer <token>).
//   GET    /api/calendar                                  { calendars, invites }
//   POST   /api/calendar/calendars                        { name, color }       a new group calendar
//   PATCH  /api/calendar/calendars/:id                    { name?, color?, labels? }
//   DELETE /api/calendar/calendars/:id                    owner only
//   PATCH  /api/calendar/calendars/:id/me                 { color }             my color there
//   POST   /api/calendar/calendars/:id/invite             { to }                by screen name
//   POST   /api/calendar/calendars/:id/code               a new invite code (DELETE: none)
//   POST   /api/calendar/join                             { code }
//   POST   /api/calendar/calendars/:id/accept|decline     an invitation
//   POST   /api/calendar/calendars/:id/leave
//   DELETE /api/calendar/calendars/:id/members/:key       owner only
//   GET    /api/calendar/calendars/:id/events             every event and memo
//   POST   /api/calendar/calendars/:id/events             { event }
//   POST   /api/calendar/calendars/:id/import             { events } (up to 500, from this device)
//   PUT    /api/calendar/calendars/:id/events/:eid        { event }             the whole series
//   PATCH  /api/calendar/calendars/:id/events/:eid/occurrence  { key, change } just this one (change null: undo)
//   DELETE /api/calendar/calendars/:id/events/:eid
//   GET|POST /api/calendar/calendars/:id/events/:eid/comments  { text }
//   DELETE /api/calendar/calendars/:id/events/:eid/comments/:cid  your own
//   GET    /api/calendar/calendars/:id/activity
//   GET    /api/calendar/calendars/:id/feed               { token } my secret subscription feed (POST: a new one)
//   GET    /api/calendar/feed/:token.ics                  the calendar as iCalendar, no sign-on (the token is the secret)
// Live notices go to members' 98 Messenger sockets: cal:event { calendarId, event | removed,
// activity }, cal:comment { calendarId, eventId, comment, title }, cal:calendar { calendarId },
// cal:invite { calendarId, name, by }.

const crypto = require("crypto")
const path = require("path")
const { pathToFileURL } = require("url")
const express = require("express")
const { limiter } = require("../net/limiter")
const { sessionFrom } = require("../aim/auth")
const { validate: validateName, normalize } = require("../aim/screenNames")
const { BOT_NAME } = require("../aim/bot")
const { memoryStore, createCalendarStore } = require("./store")
const v = require("./validate")

const MAX_CALENDARS = 20 // that one account belongs to
const MAX_MEMBERS = 30
const MAX_INVITES = 30
const MAX_EVENTS = 3000 // per calendar
const MAX_COMMENTS = 300 // per event
const MAX_IMPORT = 500
const LABEL_COUNT = 11

const BOT_KEY = normalize(BOT_NAME)
const newId = () => crypto.randomBytes(9).toString("hex")
const newFeed = () => crypto.randomBytes(18).toString("hex")
// 8 letters and digits people can read out (no 0/O, 1/I/L)
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
const newCode = () => [...crypto.randomBytes(8)].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join("")
const ipOf = (request) => String(request.headers["x-forwarded-for"] || request.socket.remoteAddress || "").split(",")[0].trim()

// the iCalendar writer is shared with the client (an ES module)
let icsModule = null
const loadIcs = () => (icsModule ??= import(pathToFileURL(path.join(__dirname, "../../client/src/components/applets/calendar/ics.js")).href))

class Refused extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}
const refuse = (status, message) => {
  throw new Refused(status, message)
}

const defaultLabels = () => v.COLORS.slice(0, LABEL_COUNT).map((color) => ({ id: color, color, name: "" }))

// ---------- the service ----------

const createCalendars = ({ store: storeOrPromise, aim: initialAim = null, couples = null, now = Date.now, limits = {} } = {}) => {
  let aim = initialAim
  let storePromise = null
  const getStore = () => (storePromise ??= Promise.resolve(storeOrPromise || createCalendarStore()))
  const clock = () => now()
  const couplesNow = () => (typeof couples === "function" ? couples() : couples)

  const emitTo = (key, event, payload) => {
    const socket = aim?.sessions?.get(key)?.socket
    if (socket) socket.emit(event, payload)
  }

  // a couple calendar is open to its two people while they're paired
  const coupleActive = (calendar) => !!calendar?.coupleId && !!couplesNow()?.isActiveCouple?.(calendar.coupleId)

  const isMember = (calendar, key) => {
    if (!calendar) return false
    if (calendar.coupleId && !coupleActive(calendar)) return false
    return calendar.members.some((m) => m.key === key)
  }
  const memberKeys = (calendar) => (calendar.coupleId && !coupleActive(calendar) ? [] : calendar.members.map((m) => m.key))
  const emitToMembers = (calendar, event, payload, { except } = {}) => {
    for (const key of memberKeys(calendar)) if (key !== except) emitTo(key, event, payload)
  }

  // a color nobody in the calendar has yet
  const freeColor = (calendar, prefer) => {
    const used = new Set(calendar.members.map((m) => m.color))
    if (prefer && !used.has(prefer)) return prefer
    return v.COLORS.find((c) => !used.has(c)) || v.COLORS[calendar.members.length % v.COLORS.length]
  }

  const member = (key, name, role, color) => ({ key, name, role, color, joinedAt: clock(), feed: null })

  const calendarView = (calendar, key) => ({
    id: calendar.id,
    kind: calendar.kind,
    name: calendar.name,
    color: calendar.color,
    role: calendar.members.find((m) => m.key === key)?.role || "member",
    members: calendar.members.filter((m) => memberKeys(calendar).includes(m.key)).map((m) => ({ key: m.key, name: m.name, role: m.role, color: m.color })),
    invites: (calendar.invites || []).map((i) => ({ key: i.key, name: i.name, by: i.byName })),
    code: calendar.kind === "group" ? calendar.code || null : null,
    labels: calendar.labels || defaultLabels(),
    createdAt: calendar.createdAt,
  })

  // Make sure someone has their personal calendar and (when paired) the couple calendar
  const ensure = async (session) => {
    const store = await getStore()
    const key = session.key
    let mine = await store.calendars.forMember(key)
    const name = session.user.screenName
    if (!mine.some((c) => c.kind === "personal" && c.members[0]?.key === key)) {
      const t = clock()
      const calendar = { id: newId(), kind: "personal", name: "My Calendar", color: "blue", coupleId: null, code: null, members: [member(key, name, "owner", "blue")], invites: [], labels: defaultLabels(), createdAt: t, updatedAt: t }
      await store.calendars.save(calendar)
      mine = [...mine, calendar]
    }
    const pair = couplesNow()?.pairedWith?.(key)
    if (pair) {
      let us = await store.calendars.byCouple(pair.id)
      const t = clock()
      if (!us) {
        us = { id: newId(), kind: "couple", name: "Us", color: "pink", coupleId: pair.id, code: null, members: [], invites: [], labels: defaultLabels(), createdAt: t, updatedAt: t }
      }
      let changed = !us.members.length
      for (const [k, n] of Object.entries(pair.names || {})) {
        const existing = us.members.find((m) => m.key === k)
        if (!existing) {
          us.members.push(member(k, n, "member", freeColor(us, k === pair.a ? "pink" : "blue")))
          changed = true
        } else if (existing.name !== n) {
          existing.name = n
          changed = true
        }
      }
      if (changed) await store.calendars.save(us)
      if (!mine.some((c) => c.id === us.id)) mine = [...mine, us]
    }
    return mine.filter((c) => isMember(c, key))
  }

  const calendarFor = async (key, id) => {
    const store = await getStore()
    const calendar = /^[a-f0-9]{18}$/.test(String(id)) ? await store.calendars.get(String(id)) : null
    if (!calendar || !isMember(calendar, key)) refuse(404, "That calendar isn't here, or you're not in it.")
    return calendar
  }

  const memberName = (calendar, key) => calendar.members.find((m) => m.key === key)?.name || key

  const log = async (calendar, session, action, extra = {}) => {
    const entry = { id: newId(), calendarId: calendar.id, by: session.key, byName: session.user.screenName, action, at: clock(), ...extra }
    await (await getStore()).activity.add(entry)
    return entry
  }

  return {
    clock,
    getStore,
    emitTo,
    emitToMembers,
    isMember,
    memberKeys,
    memberName,
    freeColor,
    member,
    calendarView,
    ensure,
    calendarFor,
    log,
    limits,
    getAim: () => aim,
    useAim: (value) => (aim = value),
    useCouples: (value) => (couples = value),
  }
}

// ---------- views ----------

const eventView = (event, commentCount = 0) => ({ ...event, comments: commentCount })

// "Fri Oct 9, 7:00 PM" in the zone the event was planned in (for the activity feed)
const whenText = (event) => {
  if (event.kind === "memo" || event.start === null) return ""
  try {
    if (event.allDay) {
      const d = new Date(`${event.start}T12:00:00Z`)
      return d.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" })
    }
    return new Date(event.start).toLocaleString("en-US", { timeZone: event.tz || "UTC", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
  } catch {
    return ""
  }
}

// ---------- HTTP ----------

const calendarRouter = ({ service = defaultService() } = {}) => {
  const { limits } = service
  const reads = limiter(limits.readsPerMinute ?? 300, 60_000)
  const writes = limiter(limits.writesPerMinute ?? 60, 60_000)
  const writesHourly = limiter(limits.writesPerHour ?? 800, 60 * 60_000)
  const invitesHourly = limiter(limits.invitesPerHour ?? 30, 60 * 60_000)
  const joins = limiter(limits.joinsPerHour ?? 20, 60 * 60_000)
  const feeds = limiter(limits.feedsPerMinute ?? 30, 60_000)
  const anonymous = limiter(60, 60_000)

  const router = express.Router()
  const small = express.json({ limit: "48kb" })
  const big = express.json({ limit: "600kb" })

  // The subscription feed: no session (Calendar apps can't sign on), the token is the secret
  router.get("/feed/:file", async (request, response) => {
    if (feeds(ipOf(request))) return response.status(429).type("text/plain").send("Slow down")
    const match = /^([a-f0-9]{36})\.ics$/.exec(String(request.params.file))
    try {
      const store = await service.getStore()
      const calendar = match ? await store.calendars.byFeed(match[1]) : null
      const owner = calendar?.members.find((m) => m.feed === match[1])
      if (!calendar || !owner || !service.isMember(calendar, owner.key)) return response.status(404).type("text/plain").send("No such calendar")
      const events = await store.events.list(calendar.id)
      const { toICS } = await service.loadIcs()
      const host = String(request.headers["x-forwarded-host"] || request.headers.host || "98ish").replace(/[^a-zA-Z0-9.:-]/g, "")
      response
        .status(200)
        .set({ "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "private, max-age=300", "Content-Disposition": `inline; filename="calendar.ics"` })
        .send(toICS(events, { name: `${calendar.name} (98ish)`, stamp: service.clock(), domain: host, byName: (e) => e.createdByName || "" }))
    } catch (error) {
      console.error("[calendar] feed", error.message)
      response.status(503).type("text/plain").send("Try again later")
    }
  })

  // Signed on before anything else (even reading a body)
  router.use((request, response, next) => {
    const session = sessionFrom(service.getAim(), request)
    if (!session) {
      anonymous(ipOf(request))
      return response.status(401).json({ ok: false, error: "Sign on to 98 Messenger first." })
    }
    if (reads(session.key)) return response.status(429).json({ ok: false, error: "Slow down!" })
    request.calSession = session
    next()
  })

  const handle = (fn, { write = false } = {}) => async (request, response) => {
    const session = request.calSession
    try {
      if (write) {
        if (writes.over(session.key) || writesHourly.over(session.key)) refuse(429, "You're doing that a lot. Try again in a minute.")
        writes(session.key)
        writesHourly(session.key)
      }
      const result = await fn(request, session, await service.getStore())
      response.json({ ok: true, now: service.clock(), ...result })
    } catch (error) {
      if (error instanceof v.Invalid) return response.status(400).json({ ok: false, error: error.message })
      if (error instanceof Refused) return response.status(error.status).json({ ok: false, error: error.message })
      console.error("[calendar]", error.message)
      response.status(503).json({ ok: false, error: "The 98ish server isn't answering. Please try again in a minute." })
    }
  }

  const listFor = async (session, store) => {
    const calendars = await service.ensure(session)
    const invites = (await store.calendars.invitedTo(session.key)).map((c) => {
      const invite = c.invites.find((i) => i.key === session.key)
      return { id: c.id, name: c.name, by: invite.byName, members: c.members.length }
    })
    return { calendars: calendars.map((c) => service.calendarView(c, session.key)).sort((a, b) => ["personal", "couple", "group"].indexOf(a.kind) - ["personal", "couple", "group"].indexOf(b.kind) || a.createdAt - b.createdAt), invites }
  }

  const owner = (calendar, session) => {
    const me = calendar.members.find((m) => m.key === session.key)
    if (calendar.kind === "couple") refuse(403, "The Us calendar belongs to both of you.")
    if (me?.role !== "owner") refuse(403, "Only the calendar's owner can do that.")
  }

  const ownCount = async (store, key) => (await store.calendars.forMember(key)).length

  router.get("/", handle(async (request, session, store) => listFor(session, store)))

  router.post(
    "/calendars",
    small,
    handle(
      async (request, session, store) => {
        const body = request.body || {}
        const name = v.calendarName(body.name)
        const color = v.color(body.color, "green")
        if ((await ownCount(store, session.key)) >= MAX_CALENDARS) v.fail(`You can be in at most ${MAX_CALENDARS} calendars.`)
        const t = service.clock()
        const calendar = { id: newId(), kind: "group", name, color, coupleId: null, code: newCode(), members: [service.member(session.key, session.user.screenName, "owner", color)], invites: [], labels: defaultLabels(), createdAt: t, updatedAt: t }
        await store.calendars.save(calendar)
        await service.log(calendar, session, "created", { title: name })
        return { calendar: service.calendarView(calendar, session.key) }
      },
      { write: true }
    )
  )

  router.patch(
    "/calendars/:id",
    small,
    handle(
      async (request, session, store) => {
        const calendar = await service.calendarFor(session.key, request.params.id)
        const body = request.body || {}
        if (body.name !== undefined || body.color !== undefined) {
          if (calendar.kind === "group") owner(calendar, session)
          if (body.name !== undefined) calendar.name = v.calendarName(body.name)
          if (body.color !== undefined) calendar.color = v.color(body.color, calendar.color)
        }
        if (body.labels !== undefined) {
          // any member can name the color labels
          if (!Array.isArray(body.labels) || body.labels.length > LABEL_COUNT) v.fail("Too many labels.")
          const names = new Map(body.labels.map((l) => [String(l?.id), v.text(l?.name, { max: 24, label: "A label's name", lines: false })]))
          calendar.labels = (calendar.labels || defaultLabels()).map((l) => (names.has(l.id) ? { ...l, name: names.get(l.id) } : l))
        }
        calendar.updatedAt = service.clock()
        await store.calendars.save(calendar)
        service.emitToMembers(calendar, "cal:calendar", { calendarId: calendar.id }, { except: session.key })
        return { calendar: service.calendarView(calendar, session.key) }
      },
      { write: true }
    )
  )

  router.patch(
    "/calendars/:id/me",
    small,
    handle(
      async (request, session, store) => {
        const calendar = await service.calendarFor(session.key, request.params.id)
        const me = calendar.members.find((m) => m.key === session.key)
        if (!me) refuse(404, "You're not in that calendar.")
        me.color = v.color(request.body?.color, me.color)
        await store.calendars.save(calendar)
        service.emitToMembers(calendar, "cal:calendar", { calendarId: calendar.id }, { except: session.key })
        return { calendar: service.calendarView(calendar, session.key) }
      },
      { write: true }
    )
  )

  router.delete(
    "/calendars/:id",
    handle(
      async (request, session, store) => {
        const calendar = await service.calendarFor(session.key, request.params.id)
        owner(calendar, session)
        const keys = service.memberKeys(calendar)
        await store.calendars.remove(calendar.id)
        for (const key of keys) if (key !== session.key) service.emitTo(key, "cal:calendar", { calendarId: calendar.id, removed: true, by: session.user.screenName, name: calendar.name })
        return { removed: true }
      },
      { write: true }
    )
  )

  // ---- people ----

  router.post(
    "/calendars/:id/invite",
    small,
    handle(
      async (request, session, store) => {
        if (invitesHourly.over(session.key)) refuse(429, "That's a lot of invitations. Try again later.")
        invitesHourly(session.key)
        const calendar = await service.calendarFor(session.key, request.params.id)
        if (calendar.kind !== "group") refuse(403, calendar.kind === "couple" ? "The Us calendar is just for the two of you. Make a group calendar to share with others." : "Your personal calendar is just for you. Make a group calendar to share.")
        const target = validateName(request.body?.to)
        if (target.error) v.fail("That isn't a 98 Messenger screen name.")
        if (target.key === BOT_KEY) v.fail(`${BOT_NAME} doesn't keep a calendar.`)
        if (calendar.members.some((m) => m.key === target.key)) v.fail(`${target.screenName} is already in this calendar.`)
        const user = await service.getAim()?.store?.find(target.key)
        if (!user) refuse(404, `${target.screenName} is not a 98 Messenger screen name. Check the spelling and try again.`)
        if ((user.blocked || []).includes(session.key)) refuse(409, `${user.screenName} can't be invited right now.`)
        calendar.invites ||= []
        if (!calendar.invites.some((i) => i.key === target.key)) {
          if (calendar.invites.length >= MAX_INVITES || calendar.members.length + calendar.invites.length >= MAX_MEMBERS) v.fail(`A calendar can have at most ${MAX_MEMBERS} people.`)
          calendar.invites.push({ key: target.key, name: user.screenName, by: session.key, byName: session.user.screenName, at: service.clock() })
          await store.calendars.save(calendar)
          service.emitTo(target.key, "cal:invite", { calendarId: calendar.id, name: calendar.name, by: session.user.screenName })
        }
        service.emitToMembers(calendar, "cal:calendar", { calendarId: calendar.id }, { except: session.key })
        return { calendar: service.calendarView(calendar, session.key) }
      },
      { write: true }
    )
  )

  router.post(
    "/calendars/:id/code",
    handle(
      async (request, session, store) => {
        const calendar = await service.calendarFor(session.key, request.params.id)
        if (calendar.kind !== "group") refuse(403, "Only group calendars have invite codes.")
        owner(calendar, session)
        calendar.code = newCode()
        await store.calendars.save(calendar)
        return { calendar: service.calendarView(calendar, session.key) }
      },
      { write: true }
    )
  )
  router.delete(
    "/calendars/:id/code",
    handle(
      async (request, session, store) => {
        const calendar = await service.calendarFor(session.key, request.params.id)
        owner(calendar, session)
        calendar.code = null
        await store.calendars.save(calendar)
        return { calendar: service.calendarView(calendar, session.key) }
      },
      { write: true }
    )
  )

  const addMember = async (store, calendar, session) => {
    if (calendar.members.some((m) => m.key === session.key)) return
    if (calendar.members.length >= MAX_MEMBERS) refuse(409, `${calendar.name} is full (${MAX_MEMBERS} people).`)
    if ((await ownCount(store, session.key)) >= MAX_CALENDARS) v.fail(`You can be in at most ${MAX_CALENDARS} calendars. Leave one first.`)
    calendar.members.push(service.member(session.key, session.user.screenName, "member", service.freeColor(calendar)))
    calendar.invites = (calendar.invites || []).filter((i) => i.key !== session.key)
    await store.calendars.save(calendar)
    const entry = await service.log(calendar, session, "joined", { title: calendar.name })
    service.emitToMembers(calendar, "cal:calendar", { calendarId: calendar.id, joined: session.user.screenName, activity: entry }, { except: session.key })
  }

  router.post(
    "/join",
    small,
    handle(
      async (request, session, store) => {
        if (joins.over(session.key)) refuse(429, "That's a lot of tries. Wait a while and try again.")
        joins(session.key)
        const code = String(request.body?.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "")
        const calendar = code.length === 8 ? await store.calendars.byCode(code) : null
        if (!calendar || calendar.kind !== "group") refuse(404, "There's no calendar with that code. Check it, or ask for a new one.")
        await addMember(store, calendar, session)
        return { calendar: service.calendarView(calendar, session.key) }
      },
      { write: true }
    )
  )

  const invitation = async (store, session, id) => {
    const calendar = /^[a-f0-9]{18}$/.test(String(id)) ? await store.calendars.get(String(id)) : null
    if (!calendar || !(calendar.invites || []).some((i) => i.key === session.key)) refuse(404, "That invitation is gone.")
    return calendar
  }

  router.post(
    "/calendars/:id/accept",
    handle(
      async (request, session, store) => {
        const calendar = await invitation(store, session, request.params.id)
        await addMember(store, calendar, session)
        return { calendar: service.calendarView(calendar, session.key) }
      },
      { write: true }
    )
  )
  router.post(
    "/calendars/:id/decline",
    handle(
      async (request, session, store) => {
        const calendar = await invitation(store, session, request.params.id)
        calendar.invites = calendar.invites.filter((i) => i.key !== session.key)
        await store.calendars.save(calendar)
        service.emitToMembers(calendar, "cal:calendar", { calendarId: calendar.id })
        return { declined: true }
      },
      { write: true }
    )
  )

  const removeMember = async (store, calendar, key, session) => {
    const leaving = calendar.members.find((m) => m.key === key)
    calendar.members = calendar.members.filter((m) => m.key !== key)
    if (!calendar.members.length) {
      await store.calendars.remove(calendar.id)
      return
    }
    // the owner left: the longest-standing member takes over
    if (leaving?.role === "owner" && !calendar.members.some((m) => m.role === "owner")) calendar.members.sort((a, b) => a.joinedAt - b.joinedAt)[0].role = "owner"
    await store.calendars.save(calendar)
    const entry = await service.log(calendar, session, key === session.key ? "left" : "removed", { title: leaving?.name || key })
    service.emitToMembers(calendar, "cal:calendar", { calendarId: calendar.id, activity: entry }, { except: session.key })
    if (key !== session.key) service.emitTo(key, "cal:calendar", { calendarId: calendar.id, removed: true, by: session.user.screenName, name: calendar.name })
  }

  router.post(
    "/calendars/:id/leave",
    handle(
      async (request, session, store) => {
        const calendar = await service.calendarFor(session.key, request.params.id)
        if (calendar.kind === "couple") refuse(403, "The Us calendar goes away when you unpair in Us.")
        if (calendar.kind === "personal") refuse(403, "That's your own calendar.")
        await removeMember(store, calendar, session.key, session)
        return { left: true }
      },
      { write: true }
    )
  )

  router.delete(
    "/calendars/:id/members/:key",
    handle(
      async (request, session, store) => {
        const calendar = await service.calendarFor(session.key, request.params.id)
        owner(calendar, session)
        const key = normalize(request.params.key)
        if (key === session.key) v.fail("Use Leave to leave.")
        if (!calendar.members.some((m) => m.key === key)) {
          // or take back an invitation
          if (!(calendar.invites || []).some((i) => i.key === key)) refuse(404, "They're not in this calendar.")
          calendar.invites = calendar.invites.filter((i) => i.key !== key)
          await store.calendars.save(calendar)
          return { calendar: service.calendarView(calendar, session.key) }
        }
        await removeMember(store, calendar, key, session)
        return { calendar: service.calendarView(calendar, session.key) }
      },
      { write: true }
    )
  )

  // ---- events ----

  const eventFor = async (store, calendar, id) => {
    const event = /^[a-f0-9]{18}$/.test(String(id)) ? await store.events.get(calendar.id, String(id)) : null
    if (!event) refuse(404, "That event isn't here any more.")
    return event
  }

  const announce = async (calendar, session, action, event, extra = {}) => {
    const entry = await service.log(calendar, session, action, { title: event.title, eventId: event.id, when: whenText(event), kind: event.kind, ...extra })
    return entry
  }

  router.get(
    "/calendars/:id/events",
    handle(async (request, session, store) => {
      const calendar = await service.calendarFor(session.key, request.params.id)
      const events = await store.events.list(calendar.id)
      const counts = await Promise.all(events.map((e) => store.comments.count(e.id)))
      return { calendar: service.calendarView(calendar, session.key), events: events.map((e, i) => eventView(e, counts[i])) }
    })
  )

  const create = async (store, calendar, session, input) => {
    const data = v.event(input, { memberKeys: service.memberKeys(calendar) })
    const t = service.clock()
    const event = { ...data, id: newId(), calendarId: calendar.id, createdBy: session.key, createdByName: session.user.screenName, updatedBy: session.key, updatedByName: session.user.screenName, createdAt: t, updatedAt: t }
    await store.events.save(event)
    return event
  }

  router.post(
    "/calendars/:id/events",
    small,
    handle(
      async (request, session, store) => {
        const calendar = await service.calendarFor(session.key, request.params.id)
        if ((await store.events.count(calendar.id)) >= MAX_EVENTS) v.fail(`${calendar.name} is full (${MAX_EVENTS} events). Delete some old ones.`)
        const event = await create(store, calendar, session, request.body?.event)
        const activity = await announce(calendar, session, "added", event)
        service.emitToMembers(calendar, "cal:event", { calendarId: calendar.id, event: eventView(event), activity }, { except: session.key })
        return { event: eventView(event) }
      },
      { write: true }
    )
  )

  router.post(
    "/calendars/:id/import",
    big,
    handle(
      async (request, session, store) => {
        const calendar = await service.calendarFor(session.key, request.params.id)
        const list = request.body?.events
        if (!Array.isArray(list) || list.length > MAX_IMPORT) v.fail(`Send 0 to ${MAX_IMPORT} events at a time.`)
        if ((await store.events.count(calendar.id)) + list.length > MAX_EVENTS) v.fail(`${calendar.name} would be too full (${MAX_EVENTS} events).`)
        // check them all first, so nothing half-uploads
        list.forEach((input) => v.event(input, { memberKeys: service.memberKeys(calendar) }))
        const events = []
        for (const input of list) events.push(await create(store, calendar, session, input))
        if (events.length) {
          const activity = await service.log(calendar, session, "imported", { title: `${events.length} event${events.length === 1 ? "" : "s"}` })
          service.emitToMembers(calendar, "cal:calendar", { calendarId: calendar.id, activity }, { except: session.key })
        }
        return { events: events.map((e) => eventView(e)) }
      },
      { write: true }
    )
  )

  router.put(
    "/calendars/:id/events/:eid",
    small,
    handle(
      async (request, session, store) => {
        const calendar = await service.calendarFor(session.key, request.params.id)
        const old = await eventFor(store, calendar, request.params.eid)
        const data = v.event({ ...request.body?.event, kind: old.kind }, { memberKeys: service.memberKeys(calendar) })
        const event = { ...old, ...data, updatedBy: session.key, updatedByName: session.user.screenName, updatedAt: service.clock() }
        await store.events.save(event)
        // ticking a to-do off reads better than "changed"
        const action = old.done !== event.done && event.title === old.title && event.start === old.start ? (event.done ? "completed" : "reopened") : "changed"
        const activity = await announce(calendar, session, action, event)
        const comments = await store.comments.count(event.id)
        service.emitToMembers(calendar, "cal:event", { calendarId: calendar.id, event: eventView(event, comments), activity }, { except: session.key })
        return { event: eventView(event, comments) }
      },
      { write: true }
    )
  )

  router.patch(
    "/calendars/:id/events/:eid/occurrence",
    small,
    handle(
      async (request, session, store) => {
        const calendar = await service.calendarFor(session.key, request.params.id)
        const event = await eventFor(store, calendar, request.params.eid)
        if (!event.repeat) v.fail("That event doesn't repeat.")
        const key = v.date(request.body?.key, "Which day")
        const exceptions = { ...(event.exceptions || {}) }
        if (request.body?.change === null) delete exceptions[key]
        else exceptions[key] = { ...(exceptions[key]?.deleted ? {} : exceptions[key]), ...v.change(request.body?.change, event.allDay) }
        if (Object.keys(exceptions).length > 400) v.fail("That event has too many changed days.")
        const updated = { ...event, exceptions, updatedBy: session.key, updatedByName: session.user.screenName, updatedAt: service.clock() }
        await store.events.save(updated)
        const change = exceptions[key]
        const action = change?.deleted ? "skipped" : change?.done !== undefined && Object.keys(request.body.change).length === 1 ? (change.done ? "completed" : "reopened") : "changed"
        const activity = await announce(calendar, session, action, { ...updated, title: change?.title || updated.title }, { occurrence: key })
        const comments = await store.comments.count(event.id)
        service.emitToMembers(calendar, "cal:event", { calendarId: calendar.id, event: eventView(updated, comments), activity }, { except: session.key })
        return { event: eventView(updated, comments) }
      },
      { write: true }
    )
  )

  router.delete(
    "/calendars/:id/events/:eid",
    handle(
      async (request, session, store) => {
        const calendar = await service.calendarFor(session.key, request.params.id)
        const event = await eventFor(store, calendar, request.params.eid)
        await store.events.remove(calendar.id, event.id)
        const activity = await announce(calendar, session, "deleted", event)
        service.emitToMembers(calendar, "cal:event", { calendarId: calendar.id, removed: event.id, activity }, { except: session.key })
        return { removed: true }
      },
      { write: true }
    )
  )

  // ---- comments ----

  router.get(
    "/calendars/:id/events/:eid/comments",
    handle(async (request, session, store) => {
      const calendar = await service.calendarFor(session.key, request.params.id)
      const event = await eventFor(store, calendar, request.params.eid)
      return { comments: await store.comments.list(event.id) }
    })
  )

  router.post(
    "/calendars/:id/events/:eid/comments",
    small,
    handle(
      async (request, session, store) => {
        const calendar = await service.calendarFor(session.key, request.params.id)
        const event = await eventFor(store, calendar, request.params.eid)
        const text = v.text(request.body?.text, { max: 1000, min: 1, label: "Your comment" })
        if ((await store.comments.count(event.id)) >= MAX_COMMENTS) v.fail("This event has a lot of comments already.")
        const comment = { id: newId(), calendarId: calendar.id, eventId: event.id, by: session.key, byName: session.user.screenName, text, at: service.clock() }
        await store.comments.add(comment)
        const activity = await announce(calendar, session, "commented", event, { text: text.slice(0, 80) })
        service.emitToMembers(calendar, "cal:comment", { calendarId: calendar.id, eventId: event.id, title: event.title, comment, activity }, { except: session.key })
        return { comment }
      },
      { write: true }
    )
  )

  router.delete(
    "/calendars/:id/events/:eid/comments/:cid",
    handle(
      async (request, session, store) => {
        const calendar = await service.calendarFor(session.key, request.params.id)
        const event = await eventFor(store, calendar, request.params.eid)
        const comment = (await store.comments.list(event.id)).find((c) => c.id === request.params.cid)
        if (!comment) refuse(404, "That comment is gone.")
        if (comment.by !== session.key) refuse(403, "You can only delete your own comments.")
        await store.comments.remove(event.id, comment.id)
        service.emitToMembers(calendar, "cal:comment", { calendarId: calendar.id, eventId: event.id, removed: comment.id }, { except: session.key })
        return { removed: true }
      },
      { write: true }
    )
  )

  // ---- activity and the subscription feed ----

  router.get(
    "/calendars/:id/activity",
    handle(async (request, session, store) => {
      const calendar = await service.calendarFor(session.key, request.params.id)
      return { activity: await store.activity.list(calendar.id, 100) }
    })
  )

  const feedOf = async (store, request, session, fresh) => {
    const calendar = await service.calendarFor(session.key, request.params.id)
    let me = calendar.members.find((m) => m.key === session.key)
    if (!me) refuse(404, "You're not in that calendar.")
    if (!me.feed || fresh) {
      me.feed = newFeed()
      await store.calendars.save(calendar)
    }
    return { token: me.feed }
  }
  router.get("/calendars/:id/feed", handle(async (request, session, store) => feedOf(store, request, session, false)))
  router.post("/calendars/:id/feed", handle(async (request, session, store) => feedOf(store, request, session, true), { write: true }))

  router.use((error, request, response, next) => {
    if (error?.type === "entity.too.large") return response.status(413).json({ ok: false, error: "That's too much to send at once." })
    if (error?.type === "entity.parse.failed") return response.status(400).json({ ok: false, error: "That couldn't be read." })
    next(error)
  })

  return router
}

// ---------- the one service the server runs ----------

let shared = null
function defaultService() {
  if (!shared) {
    shared = createCalendars({ store: process.env.MONGODB_URI ? undefined : memoryStore() })
    shared.loadIcs = loadIcs
  }
  return shared
}

const attachCalendar = (io, { aim, couples, service = defaultService() } = {}) => {
  service.useAim(aim)
  if (couples) service.useCouples(couples)
  service.getStore().catch((error) => console.error("[calendar] storage failed to start", error.message))
  return service
}

const withIcs = (service) => Object.assign(service, { loadIcs })

module.exports = { createCalendars: (options) => withIcs(createCalendars(options)), calendarRouter, attachCalendar, defaultLabels, MAX_EVENTS, MAX_MEMBERS }
