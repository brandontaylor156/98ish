// Web Push: notifications on a phone or computer when 98ish isn't open (or is in the
// background). Free: the browser's own push service carries them (Apple, Google, Mozilla),
// signed with our VAPID key pair. Off unless VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and
// VAPID_SUBJECT (mailto:you@example.com) are set; generate a pair with
// `npx web-push generate-vapid-keys`.
//
// Each 98 Messenger account has push subscriptions (one per device) and settings: which
// kinds of notification it wants, quiet hours, and its time zone. Other services call
// notify(key, category, message, { ifAway }) and this decides whether to send:
//   - the category is on, it isn't quiet hours (calls can ring through), the account has
//     subscriptions, and (ifAway, the default) they have no 98ish in front of them: signed
//     off, the connection gone, or the tab hidden (the client reports aim:visibility)
//   - a subscription the push service says is gone (404/410) is forgotten
// Categories: im, calls (incoming and missed), calendar (and Tasks), couples, mail, games,
// notes (a buddy shared or changed a shared note: server/notes).
// It also runs two schedules: calendar reminders for accounts with push (from the server
// calendars; the in-app reminders cover 98ish while it's open) and Our Pet asking for care.
//
// Every route but /config needs a signed-on 98 Messenger session (Bearer token).
//   GET  /api/push/config        { enabled, publicKey, categories }
//   POST /api/push/subscribe     { subscription: { endpoint, keys: { p256dh, auth } }, device, tz }
//   POST /api/push/unsubscribe   { endpoint }
//   GET  /api/push/settings      { settings, devices }        PUT { categories?, quiet?, callsInQuiet?, tz?, mutedCalendars? }
//   POST /api/push/test          a test notification to this account's devices
//   GET  /api/push/seen          { seenAt }   PUT { seenAt }  (Notification Center read state)
//   GET  /api/push/dnd           { dnd }      PUT { dnd, tz }  (Do Not Disturb; the newest change wins)
//   POST /api/push/held          { held: [message] }: pushes held back by Do Not Disturb (and forgets them)
//
// Do Not Disturb (rules shared with the client: client/src/utils/dndCore.js): while it's on
// (by hand or by its schedule, in the account's time zone) a push isn't sent but held, and
// the client puts held ones in the Notification Center next time it's open. Calls from
// favorites (or everyone) still ring and calendar reminders can still come through, as the
// person chose; aim:call asks callAllowed() before ringing at all.

const path = require("path")
const { pathToFileURL } = require("url")
const express = require("express")
const { limiter } = require("../net/limiter")
const { sessionFrom } = require("../aim/auth")
const { memoryStore, createPushStore } = require("./store")

const CATEGORIES = ["im", "calls", "calendar", "couples", "mail", "games", "notes"]
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const REMINDER_EVERY_MS = MINUTE
const REMINDER_CATCH_UP_MS = 30 * MINUTE // a server that slept (Render's free tier) sends ones this late
const PET_EVERY_MS = 30 * MINUTE
const PET_QUIET_MS = 8 * HOUR // at most one "your pet needs you" this often
const PET_NEEDS = { hungry: "is hungry", sad: "misses you", messy: "needs a bath", sleepy: "is sleepy" }
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

const DEFAULT_SETTINGS = {
  categories: Object.fromEntries(CATEGORIES.map((c) => [c, true])),
  quiet: { on: false, from: "22:00", to: "07:00" },
  callsInQuiet: true,
  tz: "UTC",
  mutedCalendars: [],
}

const validZone = (tz) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz })
    return typeof tz === "string" && tz.length <= 64
  } catch {
    return false
  }
}

// saved settings over the defaults (anything unknown dropped)
const settingsOf = (saved = {}) => ({
  categories: { ...DEFAULT_SETTINGS.categories, ...Object.fromEntries(CATEGORIES.filter((c) => typeof saved.categories?.[c] === "boolean").map((c) => [c, saved.categories[c]])) },
  quiet: {
    on: !!saved.quiet?.on,
    from: TIME.test(saved.quiet?.from) ? saved.quiet.from : DEFAULT_SETTINGS.quiet.from,
    to: TIME.test(saved.quiet?.to) ? saved.quiet.to : DEFAULT_SETTINGS.quiet.to,
  },
  callsInQuiet: saved.callsInQuiet !== false,
  tz: validZone(saved.tz) ? saved.tz : "UTC",
  mutedCalendars: Array.isArray(saved.mutedCalendars) ? saved.mutedCalendars.filter((id) => typeof id === "string" && id.length <= 40).slice(0, 50) : [],
})

// minutes since midnight at `time` in time zone `tz`
const minutesIn = (time, tz) => {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date(time))
  const get = (type) => Number(parts.find((p) => p.type === type)?.value || 0)
  return (get("hour") % 24) * 60 + get("minute")
}
const toMinutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3))

// quiet hours can wrap midnight (22:00 to 07:00)
const inQuietHours = (settings, time) => {
  if (!settings.quiet.on) return false
  const now = minutesIn(time, settings.tz)
  const from = toMinutes(settings.quiet.from)
  const to = toMinutes(settings.quiet.to)
  if (from === to) return true // all day
  return from < to ? now >= from && now < to : now >= from || now < to
}

// what a subscription from the browser has to look like
const B64URL = /^[A-Za-z0-9_-]+=*$/
const cleanSubscription = (sub) => {
  const endpoint = String(sub?.endpoint || "")
  const p256dh = String(sub?.keys?.p256dh || "")
  const auth = String(sub?.keys?.auth || "")
  let url
  try {
    url = new URL(endpoint)
  } catch {
    return null
  }
  if (url.protocol !== "https:") return null
  if (endpoint.length > 1024 || !B64URL.test(p256dh) || p256dh.length < 40 || p256dh.length > 200 || !B64URL.test(auth) || auth.length < 8 || auth.length > 64) return null
  return { endpoint, p256dh, auth }
}

const cleanText = (text, max) => String(text ?? "").replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "").slice(0, max)

// recurrences and reminder times are shared with the client (an ES module)
let recurModule = null
const loadRecur = () => (recurModule ??= import(pathToFileURL(path.join(__dirname, "../../client/src/components/applets/calendar/recur.js")).href))
let dndModule = null
const loadDnd = () => (dndModule ??= import(pathToFileURL(path.join(__dirname, "../../client/src/utils/dndCore.js")).href))
const MAX_HELD = 50
const HELD_DAYS = 7

const createPush = ({ store: storeOrPromise, webpush, vapid = {}, now = Date.now, log = console } = {}) => {
  const keys = {
    publicKey: vapid.publicKey ?? process.env.VAPID_PUBLIC_KEY ?? "",
    privateKey: vapid.privateKey ?? process.env.VAPID_PRIVATE_KEY ?? "",
    subject: vapid.subject ?? process.env.VAPID_SUBJECT ?? "",
  }
  if (keys.subject && !/^(mailto:|https:)/.test(keys.subject)) keys.subject = `mailto:${keys.subject}`
  if (!webpush && keys.publicKey && keys.privateKey) {
    try {
      webpush = require("web-push")
    } catch {
      log.warn?.("[push] the web-push package is missing: push is off")
    }
  }
  const enabled = !!(webpush && keys.publicKey && keys.privateKey && keys.subject)
  let storePromise = null
  const getStore = () => (storePromise ??= Promise.resolve(storeOrPromise || createPushStore()))
  let aim = null
  const timers = []

  // no 98ish in front of them: signed off, connection gone, or the tab in the background
  const isAway = (key) => {
    const session = aim?.sessions?.get(key)
    return !session || !session.socket || session.visible === false
  }

  const settingsFor = async (key) => settingsOf(await (await getStore()).prefs.get(key))

  const hasSubs = async (key) => enabled && (await (await getStore()).subs.forKey(key)).length > 0

  // would a notification of this kind reach them right now (ignoring whether they're away)?
  const wouldSend = async (key, category) => {
    if (!(await hasSubs(key))) return false
    const settings = await settingsFor(key)
    if (settings.categories[category] === false) return false
    return !inQuietHours(settings, now()) || (category === "calls" && settings.callsInQuiet)
  }

  // message: { title, body, tag, url, icon, key, requireInteraction, ... } (all go to the
  // service worker); returns { sent, removed, skipped? }
  // Do Not Disturb: { active, state } for an account right now
  const dndFor = async (key) => {
    const dnd = await loadDnd()
    const saved = await (await getStore()).prefs.get(key)
    const state = dnd.cleanDnd(saved.dnd)
    const tz = validZone(saved.tz) ? saved.tz : "UTC"
    return { dnd, state, tz, active: dnd.dndActive(state, now(), tz) }
  }

  // may `fromKey` ring `key` right now? (Do Not Disturb's "Allow calls from")
  const callAllowed = async (key, fromKey) => {
    try {
      const { dnd, state, tz, active } = await dndFor(key)
      return !active || dnd.dndAllows(state, { kind: "calls", from: fromKey }, now(), tz)
    } catch {
      return true
    }
  }

  // a push Do Not Disturb kept back: the Notification Center gets it later
  const hold = async (store, key, payload) => {
    const saved = await store.prefs.get(key)
    const cutoff = now() - HELD_DAYS * 24 * HOUR
    const held = [...(Array.isArray(saved.held) ? saved.held : []).filter((m) => (m.time || 0) > cutoff), payload].slice(-MAX_HELD)
    await store.prefs.set(key, { held })
  }

  const notify = async (key, category, message, { ifAway = true, urgency = "normal", ttl = 4 * HOUR, from = null } = {}) => {
    try {
      if (!enabled) return { sent: 0, skipped: "disabled" }
      if (ifAway && !isAway(key)) return { sent: 0, skipped: "active" }
      const store = await getStore()
      const settings = await settingsFor(key)
      if (CATEGORIES.includes(category) && settings.categories[category] === false) return { sent: 0, skipped: "off" }
      const subs = await store.subs.forKey(key)
      if (!subs.length) return { sent: 0, skipped: "none" }
      if (category !== "system") {
        const { dnd, state, tz, active } = await dndFor(key)
        if (active && !dnd.dndAllows(state, { kind: category, from }, now(), tz)) {
          // a ringing call is over by the time anyone would look: only its missed call counts
          if (!message.requireInteraction) await hold(store, key, { ...message, title: cleanText(message.title, 120), body: cleanText(message.body, 300), category, time: message.time || now() })
          return { sent: 0, skipped: "dnd" }
        }
      }
      if (category !== "system" && inQuietHours(settings, now()) && !(category === "calls" && settings.callsInQuiet)) return { sent: 0, skipped: "quiet" }
      const payload = JSON.stringify({
        ...message,
        title: cleanText(message.title, 120),
        body: cleanText(message.body, 300),
        category,
        time: message.time || now(),
      })
      let sent = 0
      let removed = 0
      await Promise.all(
        subs.map(async (sub) => {
          try {
            await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, {
              TTL: Math.round(ttl / 1000),
              urgency,
              vapidDetails: keys,
            })
            sent++
          } catch (error) {
            // gone for good (unsubscribed, app deleted, expired)
            if (error?.statusCode === 404 || error?.statusCode === 410) {
              await store.subs.remove(sub.endpoint)
              removed++
            } else log.warn?.(`[push] send failed (${error?.statusCode || error?.message || "error"})`)
          }
        })
      )
      if (process.env.PUSH_DEBUG) log.log?.(`[push] ${category}: sent ${sent}, removed ${removed}`)
      return { sent, removed }
    } catch (error) {
      log.error?.("[push] notify failed", error?.message)
      return { sent: 0, skipped: "error" }
    }
  }

  // ---------- calendar reminders ----------

  // every account with push: reminders due since the last look (on the server calendars)
  const checkReminders = async ({ calendars }) => {
    if (!enabled || !calendars) return 0
    const store = await getStore()
    const cal = await calendars.getStore()
    const recur = await loadRecur()
    const t = now()
    let count = 0
    for (const key of await store.subs.keys()) {
      const saved = await store.prefs.get(key)
      const settings = settingsOf(saved)
      const since = Math.max(saved.calCheckedAt || t - 2 * REMINDER_EVERY_MS, t - REMINDER_CATCH_UP_MS)
      await store.prefs.set(key, { calCheckedAt: t })
      if (!settings.categories.calendar || since >= t) continue
      const mine = (await cal.calendars.forMember(key)).filter((c) => calendars.isMember(c, key) && !settings.mutedCalendars.includes(c.id))
      const events = []
      for (const c of mine) for (const e of await cal.events.list(c.id)) events.push({ ...e, calendarId: c.id, calendarName: c.name, shared: c.kind !== "personal" && c.members.length > 1 })
      const wants = (occ) => !occ.done && !(occ.shared && occ.attendees?.length && !occ.attendees.includes(key))
      const due = recur.dueReminders(events, since, t, settings.tz, { wants })
      // one notification per occurrence (its latest reminder), a few at most
      const seen = new Set()
      for (const d of due.reverse()) {
        const occKey = `${d.occ.id}|${d.occ.key}`
        if (seen.has(occKey) || seen.size >= 5) continue
        seen.add(occKey)
        // a task (a to-do event) opens Tasks; anything else opens Calendar
        const task = !!d.occ.event?.todo
        const result = await notify(key, "calendar", {
          title: `${task ? "Task" : "Reminder"}: ${d.occ.title || "(untitled)"}`,
          body: `${recur.whenLabel(d.occ, settings.tz)}${d.occ.location ? ` · ${d.occ.location}` : ""} (${d.occ.calendarName})`,
          tag: `cal-rem-${d.fireKey}`,
          key: `cal-rem-${d.fireKey}`,
          app: "calendar",
          url: task ? `/?open=program&name=Tasks&cal=${encodeURIComponent(d.occ.calendarId)}&event=${encodeURIComponent(d.occ.id)}` : `/?open=calendar&cal=${encodeURIComponent(d.occ.calendarId)}&event=${encodeURIComponent(d.occ.id)}`,
          time: d.at,
        })
        count += result.sent
      }
    }
    return count
  }

  // ---------- Our Pet ----------

  const checkPets = async ({ couples, petLogic = require("../pet/logic") }) => {
    if (!enabled || !couples) return 0
    const store = await getStore()
    const t = now()
    let count = 0
    const coupleStore = await couples.getStore()
    for (const key of await store.subs.keys()) {
      const pair = couples.pairedWith(key)
      if (!pair) continue
      const saved = await store.prefs.get(key)
      if (t - (saved.petNotifiedAt || 0) < PET_QUIET_MS) continue
      const item = await coupleStore.items.get(pair.id, `pet-${pair.id}`)
      const pet = item?.kind === "pet" ? item.data : null
      if (!pet || petLogic.isAway(pet, t)) continue
      const mood = petLogic.moodOf(petLogic.advance(pet, t), t)
      if (!PET_NEEDS[mood]) continue
      const result = await notify(key, "couples", {
        title: `${pet.name} ${PET_NEEDS[mood]}`,
        body: `Our Pet: come say hi to ${pet.name}. ♥`,
        tag: "pet-needs",
        key: `pet-needs-${Math.floor(t / PET_QUIET_MS)}`,
        app: "couples",
        url: "/?open=program&name=Our%20Pet",
      })
      if (result.sent) {
        await store.prefs.set(key, { petNotifiedAt: t })
        count += result.sent
      }
    }
    return count
  }

  const start = ({ calendars, couples } = {}) => {
    if (!enabled) return
    const every = (fn, ms) => {
      const timer = setInterval(() => fn().catch((error) => log.error?.("[push] schedule failed", error?.message)), ms)
      timer.unref?.()
      timers.push(timer)
    }
    every(() => checkReminders({ calendars }), REMINDER_EVERY_MS)
    every(() => checkPets({ couples }), PET_EVERY_MS)
  }

  // ---------- HTTP ----------

  const router = ({ limits = {} } = {}) => {
    const r = express.Router()
    const requests = limiter(limits.perMinute ?? 60, 60_000)
    const tests = limiter(limits.testsPerHour ?? 10, 60 * 60_000)
    r.use(express.json({ limit: "8kb" }))

    r.get("/config", (request, response) => response.json({ ok: true, enabled, publicKey: enabled ? keys.publicKey : null, categories: CATEGORIES }))

    r.use((request, response, next) => {
      const session = sessionFrom(aim, request)
      if (!session) return response.status(401).json({ ok: false, error: "Sign on to 98 Messenger first." })
      if (requests(session.key)) return response.status(429).json({ ok: false, error: "Slow down!" })
      request.session = session
      next()
    })
    const handle = (fn) => async (request, response) => {
      try {
        await fn(request, response, await getStore(), request.session.key)
      } catch (error) {
        log.error?.("[push]", error?.message)
        response.status(503).json({ ok: false, error: "The 98ish server isn't answering. Please try again in a minute." })
      }
    }
    const needEnabled = (response) => {
      if (enabled) return false
      response.status(503).json({ ok: false, error: "Notifications aren't set up on this 98ish server." })
      return true
    }

    r.post(
      "/subscribe",
      handle(async (request, response, store, key) => {
        if (needEnabled(response)) return
        const sub = cleanSubscription(request.body?.subscription)
        if (!sub) return response.status(400).json({ ok: false, error: "That push subscription doesn't look right." })
        await store.subs.save({ key, ...sub, device: cleanText(request.body?.device, 60) })
        if (validZone(request.body?.tz)) await store.prefs.set(key, { tz: request.body.tz })
        response.json({ ok: true, settings: await settingsFor(key) })
      })
    )
    r.post(
      "/unsubscribe",
      handle(async (request, response, store, key) => {
        const removed = await store.subs.removeFor(key, String(request.body?.endpoint || ""))
        response.json({ ok: true, removed })
      })
    )
    r.get(
      "/settings",
      handle(async (request, response, store, key) => {
        const devices = (await store.subs.forKey(key)).map((s) => ({ device: s.device || "A device", since: s.createdAt, endpoint: s.endpoint.slice(-12) }))
        response.json({ ok: true, enabled, settings: await settingsFor(key), devices })
      })
    )
    r.put(
      "/settings",
      handle(async (request, response, store, key) => {
        const body = request.body || {}
        const current = await settingsFor(key)
        const next = settingsOf({
          ...current,
          ...(body.categories ? { categories: { ...current.categories, ...body.categories } } : {}),
          ...(body.quiet ? { quiet: { ...current.quiet, ...body.quiet } } : {}),
          ...(body.callsInQuiet !== undefined ? { callsInQuiet: body.callsInQuiet } : {}),
          ...(body.tz !== undefined ? { tz: body.tz } : {}),
          ...(body.mutedCalendars !== undefined ? { mutedCalendars: body.mutedCalendars } : {}),
        })
        if (body.tz !== undefined && !validZone(body.tz)) return response.status(400).json({ ok: false, error: "That time zone isn't one I know." })
        if (body.quiet && ((body.quiet.from !== undefined && !TIME.test(body.quiet.from)) || (body.quiet.to !== undefined && !TIME.test(body.quiet.to)))) {
          return response.status(400).json({ ok: false, error: "Quiet hours need times like 22:00." })
        }
        await store.prefs.set(key, next)
        response.json({ ok: true, settings: next })
      })
    )
    r.post(
      "/test",
      handle(async (request, response, store, key) => {
        if (needEnabled(response)) return
        if (tests(key)) return response.status(429).json({ ok: false, error: "That's plenty of tests for now." })
        const result = await notify(
          key,
          "system",
          { title: "98ish", body: "Notifications are working! ♪ Ta-da!", tag: "test", key: `test-${now()}`, app: "system", url: "/?open=notifications" },
          { ifAway: false }
        )
        response.json({ ok: true, sent: result.sent })
      })
    )
    r.get(
      "/seen",
      handle(async (request, response, store, key) => response.json({ ok: true, seenAt: (await store.prefs.get(key)).seenAt || 0 }))
    )
    r.put(
      "/seen",
      handle(async (request, response, store, key) => {
        const at = Number(request.body?.seenAt)
        if (!Number.isFinite(at) || at < 0 || at > now() + 5 * MINUTE) return response.status(400).json({ ok: false, error: "Bad time." })
        const saved = await store.prefs.get(key)
        const seenAt = Math.max(saved.seenAt || 0, at)
        await store.prefs.set(key, { seenAt })
        response.json({ ok: true, seenAt })
      })
    )
    r.get(
      "/dnd",
      handle(async (request, response, store, key) => {
        const dnd = await loadDnd()
        response.json({ ok: true, dnd: dnd.cleanDnd((await store.prefs.get(key)).dnd) })
      })
    )
    r.put(
      "/dnd",
      handle(async (request, response, store, key) => {
        const dnd = await loadDnd()
        const incoming = dnd.cleanDnd(request.body?.dnd)
        if (!incoming.updatedAt || incoming.updatedAt > now() + 5 * MINUTE) incoming.updatedAt = now()
        const saved = await store.prefs.get(key)
        const current = dnd.cleanDnd(saved.dnd)
        // the newest change wins (two devices changing it at once)
        const next = incoming.updatedAt >= current.updatedAt ? incoming : current
        await store.prefs.set(key, { dnd: next, ...(validZone(request.body?.tz) ? { tz: request.body.tz } : {}) })
        response.json({ ok: true, dnd: next })
      })
    )
    r.post(
      "/held",
      handle(async (request, response, store, key) => {
        const saved = await store.prefs.get(key)
        const held = Array.isArray(saved.held) ? saved.held : []
        if (held.length) await store.prefs.set(key, { held: [] })
        response.json({ ok: true, held })
      })
    )
    return r
  }

  // Delete My Account (../account): its devices, settings and held IMs (and IMs it sent)
  const eraseAccount = async ({ key }) => ({ devices: await (await getStore()).eraseAccount(key) })

  return {
    enabled,
    publicKey: enabled ? keys.publicKey : null,
    getStore,
    eraseAccount,
    useAim: (value) => (aim = value),
    isAway,
    hasSubs,
    wouldSend,
    settingsFor,
    dndFor,
    callAllowed,
    notify,
    checkReminders,
    checkPets,
    start,
    stop: () => timers.splice(0).forEach(clearInterval),
    router,
  }
}

// ---------- the one service the server runs ----------

let shared = null
const defaultPush = () => (shared ??= createPush({ store: process.env.MONGODB_URI ? undefined : memoryStore() }))

module.exports = { createPush, defaultPush, settingsOf, inQuietHours, minutesIn, cleanSubscription, CATEGORIES, DEFAULT_SETTINGS, PET_NEEDS }
