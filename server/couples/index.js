// Couples: two 98 Messenger accounts pair up ("Us"), and then keep things only the two of
// them can see: love letters (some sealed until a date), Our Story (a shared timeline
// with photos) and bouquets of virtual flowers.
//
// Every request needs a signed-on 98 Messenger session (see ../aim/auth.js). A couple's
// things are readable and writable only by its two accounts; anyone else gets 403 (not
// paired) or 404 (not theirs). Unpairing hides everything at once; it's kept 30 days
// (pairing up again within that time brings it back) and then deleted, or deleted right
// away on request.
//
//   GET    /api/couples                     { status, me, partner, coupleId, since, incoming, outgoing }
//   POST   /api/couples/request             { to }          ask someone to pair
//   POST   /api/couples/accept|decline      { from? }       answer a request
//   POST   /api/couples/cancel                              take back your request
//   POST   /api/couples/unpair              { deleteNow? }
//   GET    /api/couples/letters             inbox and outbox (never a sealed letter's words)
//   GET    /api/couples/letters/:id         one letter (403 while it's sealed)
//   POST   /api/couples/letters             { letter } or { series: { letters, startAt } }
//   POST   /api/couples/letters/:id/open    read receipt
//   POST   /api/couples/letters/:id/favorite { favorite }
//   DELETE /api/couples/letters/:id
//   GET    /api/couples/story               the header, moments, and which photos are private
//   PUT    /api/couples/story               { title, howWeMet, metOn, togetherSince }
//   POST   /api/couples/moments             PUT|DELETE /api/couples/moments/:id
//   POST   /api/couples/photos              { data, private } -> { id }
//   GET    /api/couples/photos              ids; GET|PATCH|DELETE /api/couples/photos/:id
//   GET    /api/couples/flowers             POST /api/couples/flowers, POST .../:id/water, DELETE .../:id
// Live notices go to the partner's 98 Messenger socket: couple:update, couple:request,
// couple:letter, couple:letter-opened, couple:flowers, couple:watered, couple:story.
//
// For other couple features: partnerOf(key), coupleIdOf(key), coupleAuth (Express
// middleware that sets request.couple = { id, me, meName, partner, partnerName }),
// emitToCouple(coupleId, event, payload, { except }), isActiveCouple(coupleId).

const crypto = require("crypto")
const express = require("express")
const { limiter } = require("../net/limiter")
const { sessionFrom } = require("../aim/auth")
const { validate, normalize } = require("../aim/screenNames")
const { BOT_NAME } = require("../aim/bot")
const { memoryStore, createCoupleStore } = require("./store")
const v = require("./validate")

const DAY = 24 * 60 * 60_000
const KEEP_AFTER_UNPAIR_MS = 30 * DAY
const CAP_BYTES = 15 * 1024 * 1024 // everything one couple keeps
const MAX_INCOMING = 5
const MAX_MOMENTS = 500
const MAX_LETTERS = 1000
const MAX_BOUQUETS = 20
const MAX_SERIES = 14
const WILT_DEAD_MS = 5 * DAY // a bouquet nobody watered this long can't be saved

const STATIONERY = ["parchment", "hearts", "floral", "notepad"]
const ENVELOPES = ["rose", "blush", "lavender", "sky", "mint", "cream"]
const LETTER_FONTS = ["script", "typewriter", "print", "pixel"]
const DELIVERY = ["now", "date", "openwhen", "series"]
const MOODS = ["love", "happy", "laugh", "wow", "cozy", "sad", "party", "travel", "food", "star"]
const FLOWERS = ["rose", "tulip", "daisy", "sunflower", "lily"]
const VASES = ["glass", "pink", "blue", "basket"]
const RIBBONS = ["red", "pink", "lavender", "gold", "white"]

const BOT_KEY = normalize(BOT_NAME)
const newId = () => crypto.randomBytes(9).toString("hex")
const bytes = (value) => Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value ?? null))
const ipOf = (request) => String(request.headers["x-forwarded-for"] || request.socket.remoteAddress || "").split(",")[0].trim()

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

// ---------- the service ----------

const createCouples = ({ store: storeOrPromise, aim: initialAim = null, now = Date.now, testClock = false, limits = {}, capBytes = CAP_BYTES } = {}) => {
  let aim = initialAim
  let offset = 0 // the test clock (memory mode only)
  const clock = () => now() + offset

  let storePromise = null
  const getStore = () => (storePromise ??= Promise.resolve(storeOrPromise || createCoupleStore()))

  // Every pair, in memory (there are few), so partnerOf() can answer right away
  const pairs = new Map()
  let loaded = null
  const ready = () =>
    (loaded ??= (async () => {
      const store = await getStore()
      for (const pair of await store.pairs.all()) pairs.set(pair.id, pair)
      await sweep()
    })().catch((error) => {
      loaded = null
      throw error
    }))

  const other = (pair, key) => (pair.a === key ? pair.b : pair.a)
  const has = (pair, key) => pair.a === key || pair.b === key
  const list = () => [...pairs.values()]
  const pairedWith = (key) => list().find((p) => p.status === "paired" && has(p, key)) || null
  const outgoing = (key) => list().find((p) => p.status === "pending" && p.requestedBy === key) || null
  const incoming = (key) => list().filter((p) => p.status === "pending" && p.requestedBy !== key && has(p, key)).sort((x, y) => x.createdAt - y.createdAt)

  const partnerOf = (key) => {
    const pair = pairedWith(key)
    return pair ? pair.names[other(pair, key)] : null
  }
  const coupleIdOf = (key) => pairedWith(key)?.id || null
  const isActiveCouple = (coupleId) => pairs.get(coupleId)?.status === "paired"

  const save = async (pair) => {
    pairs.set(pair.id, pair)
    await (await getStore()).pairs.save(pair)
  }
  const drop = async (pair) => {
    pairs.delete(pair.id)
    await (await getStore()).pairs.remove(pair.id)
  }

  // Unpaired more than 30 days ago: gone for good
  const sweep = async () => {
    const store = await getStore()
    for (const pair of list()) {
      if (pair.status === "ended" && clock() - pair.endedAt > KEEP_AFTER_UNPAIR_MS) {
        await store.items.purge(pair.id)
        await drop(pair)
      }
    }
  }
  const sweepTimer = setInterval(() => sweep().catch(() => {}), 6 * 60 * 60_000)
  sweepTimer.unref?.()

  const emitTo = (key, event, payload) => {
    const socket = aim?.sessions?.get(key)?.socket
    if (socket) socket.emit(event, payload)
    // the notices worth a notification when they're away from 98ish (Web Push, ../push)
    const message = aim?.push && pushNotice(event, payload)
    if (message) aim.push.notify(key, "couples", { app: "couples", ...message }).catch(() => {})
  }
  const emitToCouple = (coupleId, event, payload, { except } = {}) => {
    const pair = pairs.get(coupleId)
    if (!pair || pair.status !== "paired") return
    for (const key of [pair.a, pair.b]) if (key !== except) emitTo(key, event, payload)
  }

  const statusFor = (key, screenName) => {
    const pair = pairedWith(key)
    const out = outgoing(key)
    const ins = incoming(key)
    return {
      status: pair ? "paired" : out ? "pending-out" : ins.length ? "pending-in" : "single",
      me: screenName,
      partner: pair ? pair.names[other(pair, key)] : null,
      coupleId: pair?.id || null,
      since: pair?.pairedAt || null,
      incoming: pair ? [] : ins.map((p) => p.names[p.requestedBy]),
      outgoing: !pair && out ? out.names[other(out, key)] : null,
      now: clock(),
    }
  }

  // ---------- pairing ----------

  const request = async (session, to) => {
    const target = validate(to)
    if (target.error) refuse(400, "That isn't a 98 Messenger screen name.")
    const me = session.key
    if (target.key === me) refuse(400, "You can't pair with yourself, silly! ♥")
    if (target.key === BOT_KEY) refuse(400, `${BOT_NAME} is flattered, but it's a robot.`)
    if (pairedWith(me)) refuse(409, `You're already paired with ${partnerOf(me)}.`)
    const user = await aim.store.find(target.key)
    if (!user) refuse(404, `${target.screenName} is not a 98 Messenger screen name. Check the spelling and try again.`)
    // they asked first: that's a yes
    const theirs = outgoing(target.key)
    if (theirs && has(theirs, me)) return accept(session, user.screenName)
    const mine = outgoing(me)
    if (mine) {
      if (has(mine, target.key)) return statusFor(me, session.user.screenName)
      refuse(409, `You already asked ${mine.names[other(mine, me)]}. Cancel that request first.`)
    }
    if (pairedWith(target.key)) refuse(409, `${user.screenName} is already paired with someone.`)
    if ((user.blocked || []).includes(me) || incoming(target.key).length >= MAX_INCOMING) refuse(409, `${user.screenName} can't get pair requests right now.`)
    const pair = {
      id: newId(),
      a: me,
      b: target.key,
      names: { [me]: session.user.screenName, [target.key]: user.screenName },
      status: "pending",
      requestedBy: me,
      createdAt: clock(),
      pairedAt: null,
      endedAt: null,
    }
    await save(pair)
    emitTo(target.key, "couple:request", { from: session.user.screenName })
    emitTo(target.key, "couple:update", {})
    return statusFor(me, session.user.screenName)
  }

  const findIncoming = (key, from) => {
    const ins = incoming(key)
    if (!from) return ins[0] || null
    const fromKey = normalize(from)
    return ins.find((p) => p.requestedBy === fromKey) || null
  }

  const accept = async (session, from) => {
    const me = session.key
    const pending = findIncoming(me, from)
    if (!pending) refuse(404, "That pair request is gone.")
    const them = pending.requestedBy
    if (pairedWith(me) || pairedWith(them)) refuse(409, "One of you is already paired.")
    // pairing again within 30 days of unpairing brings everything back
    const old = list().find((p) => p.status === "ended" && has(p, me) && has(p, them))
    const pair = old
      ? { ...old, names: { ...pending.names, [me]: session.user.screenName }, status: "paired", endedAt: null }
      : { ...pending, names: { ...pending.names, [me]: session.user.screenName }, status: "paired", pairedAt: clock() }
    if (old) await drop(pending)
    await save(pair)
    // nobody else is waiting on either of them any more
    for (const p of list()) {
      if (p.status === "pending" && (has(p, me) || has(p, them))) {
        await drop(p)
        for (const key of [p.a, p.b]) if (key !== me && key !== them) emitTo(key, "couple:update", {})
      }
    }
    emitTo(them, "couple:update", { paired: session.user.screenName })
    emitTo(me, "couple:update", {})
    return statusFor(me, session.user.screenName)
  }

  const decline = async (session, from) => {
    const pending = findIncoming(session.key, from)
    if (!pending) refuse(404, "That pair request is gone.")
    await drop(pending)
    emitTo(pending.requestedBy, "couple:update", { declined: session.user.screenName })
    return statusFor(session.key, session.user.screenName)
  }

  const cancel = async (session) => {
    const mine = outgoing(session.key)
    if (mine) {
      await drop(mine)
      emitTo(other(mine, session.key), "couple:update", {})
    }
    return statusFor(session.key, session.user.screenName)
  }

  const unpair = async (session, deleteNow) => {
    const pair = pairedWith(session.key)
    if (!pair) refuse(409, "You're not paired.")
    const ended = { ...pair, status: "ended", endedAt: clock() }
    if (deleteNow) {
      await (await getStore()).items.purge(pair.id)
      await drop(pair)
    } else await save(ended)
    emitTo(other(pair, session.key), "couple:update", { unpaired: session.user.screenName })
    emitTo(session.key, "couple:update", {})
    return statusFor(session.key, session.user.screenName)
  }

  return {
    ready,
    clock,
    setOffset: (ms) => (offset = ms),
    testClock,
    limits,
    capBytes,
    getStore,
    partnerOf,
    coupleIdOf,
    isActiveCouple,
    pairedWith,
    other,
    emitTo,
    emitToCouple,
    statusFor,
    request,
    accept,
    decline,
    cancel,
    unpair,
    sweep,
    getAim: () => aim,
    useAim: (value) => (aim = value),
    close: () => clearInterval(sweepTimer),
  }
}

// ---------- notifications ----------

const openProgram = (name) => `/?open=program&name=${encodeURIComponent(name)}`
// what a live notice says as a push notification (null: not worth one)
const pushNotice = (event, p = {}) => {
  if (event === "couple:request" && p.from) return { title: "Us", body: `${p.from} wants to pair up with you on 98ish. ♥`, tag: "couple-request", key: `couple-request:${p.from}`, url: openProgram("Us") }
  if (event === "couple:update" && p.paired) return { title: "Us", body: `${p.paired} said yes! You're paired now. ♥`, tag: "couple-update", key: `couple-paired:${p.paired}`, url: openProgram("Us") }
  if (event === "couple:letter" && !p.removed && p.from) {
    const body = p.locked ? `${p.from} sealed a letter for you: "${p.title}"` : p.delivery === "openwhen" ? `${p.from} left you a letter to open when ${p.label}.` : `A new love letter from ${p.from}: "${p.title}"`
    return { title: "Love Letters 💌", body, tag: `letter-${p.id}`, key: `letter:${p.id}`, url: openProgram("Love Letters") }
  }
  if (event === "couple:flowers" && p.from) return { title: "Flowers! 💐", body: `${p.from} sent you flowers. Remember to water them.`, tag: `flowers-${p.id}`, key: `flowers:${p.id}`, url: "/?open=notifications" }
  return null
}

// ---------- views ----------

const letterView = (item, me, now, full = false) => {
  const d = item.data
  const mine = d.from === me
  const locked = !mine && d.unlockAt > now
  const view = {
    id: item.id,
    from: d.fromName,
    to: d.toName,
    mine,
    title: d.title,
    delivery: d.delivery,
    label: d.label || "",
    unlockAt: d.unlockAt,
    sentAt: item.createdAt,
    stationery: d.stationery,
    envelope: d.envelope,
    font: d.font,
    seriesId: d.seriesId || null,
    seriesIndex: d.seriesIndex ?? null,
    seriesTotal: d.seriesTotal ?? null,
    openedAt: d.openedAt || null,
    favorite: (d.favs || []).includes(me),
    hasPhoto: !!d.hasPhoto,
    locked,
  }
  // a sealed letter's words and picture never leave the server before its time
  if (full && !locked) Object.assign(view, { text: d.text, photo: item.blob || null })
  return view
}

const momentView = (item, photos) => ({
  id: item.id,
  date: item.data.date,
  title: item.data.title,
  text: item.data.text,
  location: item.data.location,
  mood: item.data.mood,
  photos: (item.data.photos || []).filter((id) => photos.has(id)).map((id) => ({ id, private: !!photos.get(id).data.private })),
  by: item.data.byName,
  updatedBy: item.data.updatedByName,
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
})

const bouquetView = (item, me) => ({
  id: item.id,
  from: item.data.fromName,
  mine: item.data.from === me,
  stems: item.data.stems,
  vase: item.data.vase,
  ribbon: item.data.ribbon,
  note: item.data.note,
  sentAt: item.createdAt,
  wateredAt: item.data.wateredAt,
  waterDays: item.data.waterDays || [],
  dismissed: !!item.data.dismissed,
})

// ---------- checks ----------

const cleanLetter = (input, { series = false } = {}) => {
  if (!input || typeof input !== "object") v.fail("That letter is empty.")
  return {
    title: v.text(input.title, { max: 80, label: "The title", lines: false }) || "A letter for you",
    text: v.text(input.text, { max: 5000, min: 1, label: "Your letter" }),
    stationery: v.pick(input.stationery, STATIONERY, "parchment", "That stationery"),
    envelope: v.pick(input.envelope, ENVELOPES, "rose", "That envelope"),
    font: v.pick(input.font, LETTER_FONTS, "script", "That handwriting"),
    photo: !series && input.photo ? v.image(input.photo, "The photo") : null,
  }
}

const cleanMoment = (input) => {
  if (!input || typeof input !== "object") v.fail("That moment is empty.")
  const photos = input.photos === undefined ? [] : input.photos
  if (!Array.isArray(photos) || photos.length > 4 || photos.some((id) => typeof id !== "string" || !/^[a-f0-9]{18}$/.test(id))) v.fail("A moment can have at most 4 photos.")
  return {
    date: v.date(input.date, { label: "The moment's date" }),
    title: v.text(input.title, { max: 80, min: 1, label: "The title", lines: false }),
    text: v.text(input.text, { max: 2000, label: "The story" }),
    location: v.text(input.location, { max: 80, label: "The place", lines: false }),
    mood: v.pick(input.mood, MOODS, "love", "That sticker"),
    photos: [...new Set(photos)],
  }
}

// ---------- HTTP ----------

const couplesRouter = ({ service = defaultService() } = {}) => {
  const { limits } = service
  const reads = limiter(limits.readsPerMinute ?? 300, 60_000)
  const writes = limiter(limits.writesPerMinute ?? 30, 60_000)
  const writesHourly = limiter(limits.writesPerHour ?? 400, 60 * 60_000)
  const pairRequests = limiter(limits.pairRequestsPerHour ?? 10, 60 * 60_000)
  const anonymous = limiter(60, 60_000)

  const router = express.Router()
  const small = express.json({ limit: "32kb" })
  const big = express.json({ limit: "700kb" })

  // Signed on before anything else (even reading a body)
  router.use((request, response, next) => {
    const session = sessionFrom(service.getAim(), request)
    if (!session) {
      anonymous(ipOf(request))
      return response.status(401).json({ ok: false, error: "Sign on to 98 Messenger first." })
    }
    if (reads(session.key)) return response.status(429).json({ ok: false, error: "Slow down!" })
    request.coupleSession = session
    next()
  })

  const handle = (fn, { write = false } = {}) => async (request, response) => {
    const session = request.coupleSession
    try {
      if (write) {
        if (writes.over(session.key) || writesHourly.over(session.key)) refuse(429, "You're doing that a lot. Take a breath and try again in a minute. ♥")
        writes(session.key)
        writesHourly(session.key)
      }
      await service.ready()
      const result = await fn(request, session, await service.getStore())
      response.json({ ok: true, now: service.clock(), ...result })
    } catch (error) {
      if (error instanceof v.Invalid) return response.status(400).json({ ok: false, error: error.message })
      if (error instanceof Refused) return response.status(error.status).json({ ok: false, error: error.message, ...error.extra })
      console.error("[couples]", error.message)
      response.status(503).json({ ok: false, error: "The 98ish server isn't answering. Please try again in a minute." })
    }
  }

  // The couple behind a request, or 403
  const coupleOf = (session) => {
    const pair = service.pairedWith(session.key)
    if (!pair) refuse(403, "You're not paired with anyone. Open Us to pair with your partner.")
    const partner = service.other(pair, session.key)
    return { id: pair.id, me: session.key, meName: session.user.screenName, partner, partnerName: pair.names[partner] }
  }

  const fits = async (store, couple, add) => {
    if ((await store.items.usage(couple.id)) + add > service.capBytes) {
      refuse(413, `Your shared space is full (${Math.round(service.capBytes / 1024 / 1024)} MB). Delete some photos or letters to make room.`)
    }
  }

  const getItem = async (store, couple, id, kind) => {
    const item = /^[a-f0-9]{18}$/.test(String(id)) ? await store.items.get(couple.id, String(id)) : null
    if (!item || item.kind !== kind) refuse(404, "That's not here any more.")
    return item
  }

  // ---- pairing ----

  router.get("/", handle(async (request, session) => service.statusFor(session.key, session.user.screenName)))

  router.post(
    "/request",
    small,
    handle(
      async (request, session) => {
        if (pairRequests.over(session.key)) refuse(429, "That's a lot of pair requests. Try again later.")
        pairRequests(session.key)
        return service.request(session, request.body?.to)
      },
      { write: true }
    )
  )
  router.post("/accept", small, handle(async (request, session) => service.accept(session, request.body?.from), { write: true }))
  router.post("/decline", small, handle(async (request, session) => service.decline(session, request.body?.from), { write: true }))
  router.post("/cancel", small, handle(async (request, session) => service.cancel(session), { write: true }))
  router.post("/unpair", small, handle(async (request, session) => service.unpair(session, request.body?.deleteNow === true), { write: true }))

  // ---- love letters ----

  router.get(
    "/letters",
    handle(async (request, session, store) => {
      const couple = coupleOf(session)
      const now = service.clock()
      const letters = (await store.items.list(couple.id, "letter")).map((item) => letterView(item, couple.me, now))
      return {
        inbox: letters.filter((l) => !l.mine).sort((a, b) => b.unlockAt - a.unlockAt),
        outbox: letters.filter((l) => l.mine).sort((a, b) => b.sentAt - a.sentAt),
      }
    })
  )

  router.get(
    "/letters/:id",
    handle(async (request, session, store) => {
      const couple = coupleOf(session)
      const item = await getItem(store, couple, request.params.id, "letter")
      const letter = letterView(item, couple.me, service.clock(), true)
      if (letter.locked) refuse(403, "This letter is still sealed. ♥", { locked: true, unlockAt: letter.unlockAt })
      return { letter }
    })
  )

  router.post(
    "/letters",
    big,
    handle(
      async (request, session, store) => {
        const couple = coupleOf(session)
        const body = request.body || {}
        const now = service.clock()
        const drafts = []
        if (body.series) {
          const pages = body.series.letters
          if (!Array.isArray(pages) || pages.length < 2 || pages.length > MAX_SERIES) v.fail(`A countdown has 2 to ${MAX_SERIES} letters.`)
          const startAt = Number(body.series.startAt) || now
          if (startAt < now - 60_000 || startAt > now + 366 * DAY) v.fail("The countdown has to start within the next year.")
          const seriesId = newId()
          const shared = cleanLetter({ ...pages[0], text: "x" }, { series: true })
          pages.forEach((page, i) => {
            const letter = cleanLetter({ ...page, stationery: shared.stationery, envelope: shared.envelope, font: shared.font }, { series: true })
            drafts.push({ ...letter, delivery: "series", label: "", unlockAt: startAt + i * DAY, seriesId, seriesIndex: i + 1, seriesTotal: pages.length })
          })
        } else {
          const input = body.letter || {}
          const letter = cleanLetter(input)
          const delivery = v.pick(input.delivery, DELIVERY.filter((d) => d !== "series"), "now", "That delivery")
          let unlockAt = now
          let label = ""
          if (delivery === "date") {
            unlockAt = Number(input.unlockAt)
            if (!Number.isFinite(unlockAt) || unlockAt < now - 60_000 || unlockAt > now + 5 * 366 * DAY) v.fail("Pick a time to open it, within the next five years.")
          }
          if (delivery === "openwhen") label = v.text(input.label, { max: 60, min: 1, label: "The \"Open when...\" label", lines: false })
          drafts.push({ ...letter, delivery, label, unlockAt })
        }
        const existing = await store.items.list(couple.id, "letter")
        if (existing.length + drafts.length > MAX_LETTERS) v.fail("You've written so many letters that the mailbox is full! Delete a few old ones.")
        const sizes = drafts.map((d) => bytes(d.text) + bytes(d.title) + (d.photo?.bytes ? d.photo.data.length : 0) + 300)
        await fits(store, couple, sizes.reduce((a, b) => a + b, 0))

        const sent = []
        for (const [i, d] of drafts.entries()) {
          const { photo, ...rest } = d
          const item = {
            id: newId(),
            coupleId: couple.id,
            kind: "letter",
            by: couple.me,
            data: { ...rest, from: couple.me, fromName: couple.meName, to: couple.partner, toName: couple.partnerName, openedAt: null, favs: [], hasPhoto: !!photo },
            blob: photo?.data || null,
            size: sizes[i],
            createdAt: now,
            updatedAt: now,
          }
          await store.items.insert(item)
          sent.push(item)
        }
        for (const item of sent) {
          const view = letterView(item, couple.partner, now)
          service.emitTo(couple.partner, "couple:letter", view)
        }
        return { letters: sent.map((item) => letterView(item, couple.me, now)) }
      },
      { write: true }
    )
  )

  router.post(
    "/letters/:id/open",
    handle(
      async (request, session, store) => {
        const couple = coupleOf(session)
        const item = await getItem(store, couple, request.params.id, "letter")
        const now = service.clock()
        const letter = letterView(item, couple.me, now)
        if (letter.mine) refuse(400, "That's your own letter.")
        if (letter.locked) refuse(403, "This letter is still sealed. ♥", { locked: true, unlockAt: letter.unlockAt })
        if (!item.data.openedAt) {
          const updated = await store.items.update(couple.id, item.id, { data: { ...item.data, openedAt: now } })
          service.emitTo(couple.partner, "couple:letter-opened", { id: item.id, title: item.data.title, openedAt: now, by: couple.meName })
          return { letter: letterView(updated, couple.me, now) }
        }
        return { letter }
      },
      { write: true }
    )
  )

  router.post(
    "/letters/:id/favorite",
    small,
    handle(
      async (request, session, store) => {
        const couple = coupleOf(session)
        const item = await getItem(store, couple, request.params.id, "letter")
        const favs = new Set(item.data.favs || [])
        request.body?.favorite ? favs.add(couple.me) : favs.delete(couple.me)
        const updated = await store.items.update(couple.id, item.id, { data: { ...item.data, favs: [...favs] } })
        return { letter: letterView(updated, couple.me, service.clock()) }
      },
      { write: true }
    )
  )

  router.delete(
    "/letters/:id",
    handle(
      async (request, session, store) => {
        const couple = coupleOf(session)
        const item = await getItem(store, couple, request.params.id, "letter")
        const letter = letterView(item, couple.me, service.clock())
        // the recipient can throw away a letter once they've read it; the writer any time
        if (!letter.mine && !letter.openedAt) refuse(403, "Open it first. ♥")
        await store.items.remove(couple.id, item.id)
        service.emitTo(couple.partner, "couple:letter", { id: item.id, removed: true })
        return { removed: true }
      },
      { write: true }
    )
  )

  // ---- our story ----

  const storyId = (couple) => `story${couple.id}`

  const photosOf = async (store, couple) => new Map((await store.items.list(couple.id, "photo")).map((p) => [p.id, p]))

  router.get(
    "/story",
    handle(async (request, session, store) => {
      const couple = coupleOf(session)
      const story = await store.items.get(couple.id, storyId(couple))
      const photos = await photosOf(store, couple)
      const moments = (await store.items.list(couple.id, "moment")).map((m) => momentView(m, photos)).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt)
      return {
        story: {
          title: story?.data.title || "",
          howWeMet: story?.data.howWeMet || "",
          metOn: story?.data.metOn || "",
          togetherSince: story?.data.togetherSince || "",
          updatedAt: story?.updatedAt || null,
        },
        moments,
        since: service.pairedWith(couple.me)?.pairedAt || null,
      }
    })
  )

  router.put(
    "/story",
    small,
    handle(
      async (request, session, store) => {
        const couple = coupleOf(session)
        const body = request.body || {}
        const data = {
          title: v.text(body.title, { max: 60, label: "The title", lines: false }),
          howWeMet: v.text(body.howWeMet, { max: 2000, label: "How we met" }),
          metOn: v.date(body.metOn, { label: "The day you met", optional: true }),
          togetherSince: v.date(body.togetherSince, { label: "Your anniversary", optional: true }),
        }
        const now = service.clock()
        const existing = await store.items.get(couple.id, storyId(couple))
        if (existing) await store.items.update(couple.id, existing.id, { data, size: bytes(data), updatedAt: now })
        else {
          await fits(store, couple, bytes(data))
          await store.items.insert({ id: storyId(couple), coupleId: couple.id, kind: "story", by: couple.me, data, blob: null, size: bytes(data), createdAt: now, updatedAt: now })
        }
        service.emitTo(couple.partner, "couple:story", { by: couple.meName })
        return { story: { ...data, updatedAt: now } }
      },
      { write: true }
    )
  )

  // Photos named by a moment must be this couple's; ones it no longer uses are deleted
  const attachPhotos = async (store, couple, momentId, wanted, previous = []) => {
    const photos = await photosOf(store, couple)
    for (const id of wanted) {
      const photo = photos.get(id)
      if (!photo || (photo.data.momentId && photo.data.momentId !== momentId)) v.fail("One of the photos is missing. Add it again.")
    }
    for (const id of wanted) await store.items.update(couple.id, id, { data: { ...photos.get(id).data, momentId } })
    for (const id of previous) if (!wanted.includes(id) && photos.has(id)) await store.items.remove(couple.id, id)
  }

  router.post(
    "/moments",
    small,
    handle(
      async (request, session, store) => {
        const couple = coupleOf(session)
        const data = cleanMoment(request.body?.moment)
        if ((await store.items.list(couple.id, "moment")).length >= MAX_MOMENTS) v.fail(`Your story has ${MAX_MOMENTS} moments already. What a story!`)
        await fits(store, couple, bytes(data))
        const now = service.clock()
        const id = newId()
        await attachPhotos(store, couple, id, data.photos)
        const item = { id, coupleId: couple.id, kind: "moment", by: couple.me, data: { ...data, byName: couple.meName, updatedByName: couple.meName }, blob: null, size: bytes(data) + 200, createdAt: now, updatedAt: now }
        await store.items.insert(item)
        service.emitTo(couple.partner, "couple:story", { by: couple.meName, moment: id })
        return { moment: momentView(item, await photosOf(store, couple)) }
      },
      { write: true }
    )
  )

  router.put(
    "/moments/:id",
    small,
    handle(
      async (request, session, store) => {
        const couple = coupleOf(session)
        const item = await getItem(store, couple, request.params.id, "moment")
        const data = cleanMoment(request.body?.moment)
        await attachPhotos(store, couple, item.id, data.photos, item.data.photos)
        const now = service.clock()
        const updated = await store.items.update(couple.id, item.id, { data: { ...data, byName: item.data.byName, updatedByName: couple.meName }, size: bytes(data) + 200, updatedAt: now })
        service.emitTo(couple.partner, "couple:story", { by: couple.meName, moment: item.id })
        return { moment: momentView(updated, await photosOf(store, couple)) }
      },
      { write: true }
    )
  )

  router.delete(
    "/moments/:id",
    handle(
      async (request, session, store) => {
        const couple = coupleOf(session)
        const item = await getItem(store, couple, request.params.id, "moment")
        for (const id of item.data.photos || []) await store.items.remove(couple.id, id)
        await store.items.remove(couple.id, item.id)
        service.emitTo(couple.partner, "couple:story", { by: couple.meName })
        return { removed: true }
      },
      { write: true }
    )
  )

  router.post(
    "/photos",
    // paired before the (big) body is even read
    (request, response, next) => (service.pairedWith(request.coupleSession.key) ? next() : response.status(403).json({ ok: false, error: "You're not paired with anyone." })),
    big,
    handle(
      async (request, session, store) => {
        const couple = coupleOf(session)
        const picture = v.image(request.body?.data, "That photo")
        const now = service.clock()
        // photos uploaded but never saved in a moment are cleared out after a day
        for (const p of (await photosOf(store, couple)).values()) if (!p.data.momentId && now - p.createdAt > DAY) await store.items.remove(couple.id, p.id)
        await fits(store, couple, picture.data.length)
        const item = { id: newId(), coupleId: couple.id, kind: "photo", by: couple.me, data: { momentId: null, private: request.body?.private === true }, blob: picture.data, size: picture.data.length + 100, createdAt: now, updatedAt: now }
        await store.items.insert(item)
        return { photo: { id: item.id, private: item.data.private } }
      },
      { write: true }
    )
  )

  router.get(
    "/photos",
    handle(async (request, session, store) => {
      const couple = coupleOf(session)
      const photos = [...(await photosOf(store, couple)).values()].filter((p) => p.data.momentId)
      return { photos: photos.map((p) => ({ id: p.id, momentId: p.data.momentId, private: !!p.data.private })) }
    })
  )

  router.get(
    "/photos/:id",
    handle(async (request, session, store) => {
      const couple = coupleOf(session)
      const item = await getItem(store, couple, request.params.id, "photo")
      return { photo: { id: item.id, data: item.blob, private: !!item.data.private } }
    })
  )

  router.patch(
    "/photos/:id",
    small,
    handle(
      async (request, session, store) => {
        const couple = coupleOf(session)
        const item = await getItem(store, couple, request.params.id, "photo")
        await store.items.update(couple.id, item.id, { data: { ...item.data, private: request.body?.private === true } })
        service.emitTo(couple.partner, "couple:story", { by: couple.meName })
        return { photo: { id: item.id, private: request.body?.private === true } }
      },
      { write: true }
    )
  )

  router.delete(
    "/photos/:id",
    handle(
      async (request, session, store) => {
        const couple = coupleOf(session)
        const item = await getItem(store, couple, request.params.id, "photo")
        if (item.data.momentId) {
          const moment = await store.items.get(couple.id, item.data.momentId)
          if (moment) await store.items.update(couple.id, moment.id, { data: { ...moment.data, photos: moment.data.photos.filter((id) => id !== item.id) } })
        }
        await store.items.remove(couple.id, item.id)
        return { removed: true }
      },
      { write: true }
    )
  )

  // ---- flowers ----

  router.get(
    "/flowers",
    handle(async (request, session, store) => {
      const couple = coupleOf(session)
      const all = (await store.items.list(couple.id, "bouquet")).map((b) => bouquetView(b, couple.me)).reverse()
      return { received: all.filter((b) => !b.mine), sent: all.filter((b) => b.mine) }
    })
  )

  router.post(
    "/flowers",
    small,
    handle(
      async (request, session, store) => {
        const couple = coupleOf(session)
        const body = request.body?.bouquet || {}
        const stems = body.stems
        if (!Array.isArray(stems) || stems.length < 1 || stems.length > 12) v.fail("A bouquet has 1 to 12 flowers.")
        const data = {
          stems: stems.map((s) => v.pick(s, FLOWERS, undefined, "That flower")),
          vase: v.pick(body.vase, VASES, "glass", "That vase"),
          ribbon: v.pick(body.ribbon, RIBBONS, "red", "That ribbon"),
          note: v.text(body.note, { max: 200, label: "The card" }),
        }
        const now = service.clock()
        await fits(store, couple, bytes(data))
        const item = {
          id: newId(),
          coupleId: couple.id,
          kind: "bouquet",
          by: couple.me,
          data: { ...data, from: couple.me, fromName: couple.meName, to: couple.partner, wateredAt: now, waterDays: [], dismissed: false },
          blob: null,
          size: bytes(data) + 200,
          createdAt: now,
          updatedAt: now,
        }
        await store.items.insert(item)
        // only the newest bouquets are kept
        const all = await store.items.list(couple.id, "bouquet")
        for (const old of all.slice(0, Math.max(0, all.length - MAX_BOUQUETS))) await store.items.remove(couple.id, old.id)
        service.emitTo(couple.partner, "couple:flowers", bouquetView(item, couple.partner))
        return { bouquet: bouquetView(item, couple.me) }
      },
      { write: true }
    )
  )

  router.post(
    "/flowers/:id/water",
    small,
    handle(
      async (request, session, store) => {
        const couple = coupleOf(session)
        const item = await getItem(store, couple, request.params.id, "bouquet")
        if (item.data.from === couple.me) refuse(403, "Only the person you gave them to can water them. ♥")
        const now = service.clock()
        if (item.data.dismissed || now - item.data.wateredAt >= WILT_DEAD_MS) refuse(409, "These flowers are past saving. Ask for a fresh bouquet! ♥")
        // once a day, by the waterer's own calendar
        const tz = Number(request.body?.tz)
        const minutes = Number.isFinite(tz) && Math.abs(tz) <= 840 ? Math.round(tz) : 0
        const day = new Date(now - minutes * 60_000).toISOString().slice(0, 10)
        const days = item.data.waterDays || []
        if (days.includes(day)) refuse(409, "Already watered today. Too much water drowns them!", { day })
        const updated = await store.items.update(couple.id, item.id, { data: { ...item.data, wateredAt: now, waterDays: [...days, day].slice(-30) }, updatedAt: now })
        service.emitTo(couple.partner, "couple:watered", { id: item.id, by: couple.meName })
        return { bouquet: bouquetView(updated, couple.me) }
      },
      { write: true }
    )
  )

  router.delete(
    "/flowers/:id",
    handle(
      async (request, session, store) => {
        const couple = coupleOf(session)
        const item = await getItem(store, couple, request.params.id, "bouquet")
        if (item.data.from === couple.me) await store.items.remove(couple.id, item.id)
        else await store.items.update(couple.id, item.id, { data: { ...item.data, dismissed: true } })
        return { removed: true }
      },
      { write: true }
    )
  )

  // ---- tests: move the server's clock (memory mode only, never with a real database) ----

  if (service.testClock) {
    router.post(
      "/test/clock",
      small,
      handle(async (request) => {
        const offsetMs = Number(request.body?.offsetMs)
        if (!Number.isFinite(offsetMs)) v.fail("offsetMs must be a number.")
        service.setOffset(offsetMs)
        return {}
      })
    )
  }

  router.use((error, request, response, next) => {
    if (error?.type === "entity.too.large") return response.status(413).json({ ok: false, error: "That's too big to send. Pictures can be at most 300 KB." })
    if (error?.type === "entity.parse.failed") return response.status(400).json({ ok: false, error: "That couldn't be read." })
    next(error)
  })

  return router
}

// ---------- the one service the server runs ----------

let shared = null
function defaultService() {
  return (shared ??= createCouples({
    testClock: process.env.COUPLES_TEST_CLOCK === "1" && !process.env.MONGODB_URI,
    store: process.env.MONGODB_URI ? undefined : memoryStore(),
  }))
}

// Live notices ride on 98 Messenger's sockets; this hands the service the signed-on sessions
const attachCouples = (io, { aim, service = defaultService() } = {}) => {
  service.useAim(aim)
  service.ready().catch((error) => console.error("[couples] storage failed to start", error.message))
  io.on("connection", (socket) => {
    socket.on("couple:status", (payload, ack) => {
      if (typeof ack !== "function") return
      const session = aim.sessions.get(socket.data.key)
      if (!session || session.socket !== socket) return ack({ ok: false, error: "You are not signed on." })
      ack({ ok: true, ...service.statusFor(session.key, session.user.screenName) })
    })
  })
  return service
}

// Express middleware for other couple features: 401 signed off, 403 not paired, else
// request.couple = { id, me, meName, partner, partnerName }
const coupleAuth = (request, response, next) => {
  const service = defaultService()
  const session = sessionFrom(service.getAim(), request)
  if (!session) return response.status(401).json({ ok: false, error: "Sign on to 98 Messenger first." })
  const pair = service.pairedWith(session.key)
  if (!pair) return response.status(403).json({ ok: false, error: "You're not paired with anyone." })
  const partner = service.other(pair, session.key)
  request.couple = { id: pair.id, me: session.key, meName: session.user.screenName, partner, partnerName: pair.names[partner] }
  next()
}

module.exports = {
  createCouples,
  couplesRouter,
  attachCouples,
  coupleAuth,
  partnerOf: (key) => defaultService().partnerOf(normalize(key)),
  coupleIdOf: (key) => defaultService().coupleIdOf(normalize(key)),
  isActiveCouple: (coupleId) => defaultService().isActiveCouple(coupleId),
  emitToCouple: (...args) => defaultService().emitToCouple(...args),
  coupleService: () => defaultService(), // its clock (and test clock), store and pairs, for other couple features
  letterView,
  STATIONERY,
  ENVELOPES,
  LETTER_FONTS,
  MOODS,
  FLOWERS,
  VASES,
  RIBBONS,
  CAP_BYTES,
}
