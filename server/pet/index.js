// Our Pet: a little creature a couple raises together. One pet per couple, kept with the
// couple's other things (server/couples' store, kind "pet"), so it's private to the two of
// them, hidden when they unpair and deleted with everything else. Its stats drift over
// real time, worked out from timestamps when asked (see ./logic.js); the test clock in
// server/couples moves it too.
//
// Mounted at /api/couples/pet (ahead of the couples router), so the client's coupleApi()
// signs and times these requests like any other couple request.
//   GET  /api/couples/pet             { pet: view | null, partnerHere }
//   POST /api/couples/pet/adopt       { species, name, body, accent, tz }
//   POST /api/couples/pet/act         { action: feed|play|pet|bathe|sleep|wake|dress, food?, score?, worn? }
//   POST /api/couples/pet/visit       bring it home from Grandma's (both of you)
//   POST /api/couples/pet/name        { name }    suggest a new name
//   POST /api/couples/pet/name/answer { yes }     your partner's suggestion (or take back your own)
//   POST /api/couples/pet/here        { open }    the app is open (pinged while it is)
//   POST /api/couples/pet/touch       { kind, x, y } a cuddle or scrub, shown live to your partner
// Live notices to the partner: couple:pet (something happened), couple:pet-touch,
// couple:pet-here. Every request needs a signed-on, paired 98 Messenger account
// (401 signed off, 403 not paired).

const express = require("express")
const { limiter } = require("../net/limiter")
const { sessionFrom } = require("../aim/auth")
const couples = require("../couples")
const v = require("../couples/validate")
const logic = require("./logic")

const HERE_MS = 75_000 // the app pings every 30 seconds while it's open
const bytes = (value) => Buffer.byteLength(JSON.stringify(value ?? null))

// coupleAuth, for a given couples service (the tests run their own)
const authFor = (service) => (request, response, next) => {
  const session = sessionFrom(service.getAim(), request)
  if (!session) return response.status(401).json({ ok: false, error: "Sign on to 98 Messenger first." })
  const pair = service.pairedWith(session.key)
  if (!pair) return response.status(403).json({ ok: false, error: "You're not paired with anyone." })
  const partner = service.other(pair, session.key)
  request.couple = { id: pair.id, me: session.key, meName: session.user.screenName, partner, partnerName: pair.names[partner] }
  next()
}

const petRouter = ({ service, limits = {} } = {}) => {
  const svc = service || couples.coupleService()
  const auth = service ? authFor(service) : couples.coupleAuth
  const reads = limiter(limits.readsPerMinute ?? 120, 60_000)
  const writes = limiter(limits.writesPerMinute ?? 30, 60_000)
  const writesHourly = limiter(limits.writesPerHour ?? 400, 60 * 60_000)
  const touches = limiter(limits.touchesPerMinute ?? 240, 60_000)
  const here = new Map() // coupleId -> Map(key -> last ping)
  const queues = new Map() // coupleId -> the last change in line (one change at a time)

  const router = express.Router()
  const small = express.json({ limit: "8kb" })

  const idOf = (couple) => `pet-${couple.id}`
  const load = async (couple) => {
    const store = await svc.getStore()
    const item = await store.items.get(couple.id, idOf(couple))
    return item?.kind === "pet" ? item.data : null
  }
  const save = async (couple, pet, isNew = false) => {
    const store = await svc.getStore()
    const now = svc.clock()
    if (isNew) await store.items.insert({ id: idOf(couple), coupleId: couple.id, kind: "pet", by: couple.me, data: pet, size: bytes(pet), createdAt: now, updatedAt: now })
    else await store.items.update(couple.id, idOf(couple), { data: pet, size: bytes(pet), updatedAt: now })
  }
  // changes to one couple's pet happen one after another (two partners at once)
  const inLine = (coupleId, fn) => {
    const run = (queues.get(coupleId) || Promise.resolve()).then(fn, fn)
    const tail = run.catch(() => {})
    queues.set(coupleId, tail)
    tail.then(() => queues.get(coupleId) === tail && queues.delete(coupleId))
    return run
  }

  const partnerHere = (couple) => svc.clock() - (here.get(couple.id)?.get(couple.partner) || 0) < HERE_MS
  const viewOf = (couple, pet) => (pet ? logic.view(pet, couple.me, couple.partner, couple.partnerName, svc.clock()) : null)

  const handle = (fn, { write = false } = {}) => async (request, response) => {
    const couple = request.couple
    try {
      if (reads(couple.me)) return response.status(429).json({ ok: false, error: "Slow down!" })
      if (write) {
        if (writes.over(couple.me) || writesHourly.over(couple.me)) return response.status(429).json({ ok: false, error: "You're doing that a lot. Take a breath and try again in a minute. ♥" })
        writes(couple.me)
        writesHourly(couple.me)
      }
      await svc.ready()
      const result = write ? await inLine(couple.id, () => fn(request, couple)) : await fn(request, couple)
      response.json({ ok: true, now: svc.clock(), partnerHere: partnerHere(couple), ...result })
    } catch (error) {
      if (error instanceof v.Invalid) return response.status(400).json({ ok: false, error: error.message })
      if (error instanceof logic.Nope) return response.status(error.status).json({ ok: false, error: error.message })
      console.error("[pet]", error.message)
      response.status(503).json({ ok: false, error: "The 98ish server isn't answering. Please try again in a minute." })
    }
  }

  const tell = (couple, payload) => svc.emitToCouple(couple.id, "couple:pet", { by: couple.meName, ...payload }, { except: couple.me })
  const needPet = async (couple) => {
    const pet = await load(couple)
    if (!pet) throw new logic.Nope(404, "You haven't adopted a pet yet.")
    return pet
  }
  const petName = (value) => {
    const name = v.text(value, { max: 16, min: 1, label: "The name", lines: false })
    if (!/^[\p{L}\p{N}][\p{L}\p{N} '.-]*$/u.test(name)) v.fail("Names can have letters, numbers, spaces, ' . and -.")
    return name
  }
  const tzOf = (value) => (Number.isInteger(value) && Math.abs(value) <= 14 * 60 ? value : 0)

  router.use(auth)

  router.get("/", handle(async (request, couple) => ({ pet: viewOf(couple, await load(couple)) })))

  router.post(
    "/adopt",
    small,
    handle(
      async (request, couple) => {
        if (await load(couple)) throw new logic.Nope(409, "You already have a pet! ♥")
        const body = request.body || {}
        const pet = logic.newPet(
          {
            species: v.pick(body.species, logic.SPECIES, undefined, "That kind of pet"),
            name: petName(body.name),
            body: v.pick(body.body, logic.COLORS, "cream", "That color"),
            accent: v.pick(body.accent, logic.COLORS, "pink", "That color"),
            tz: tzOf(body.tz),
          },
          couple.me,
          couple.meName,
          svc.clock()
        )
        await save(couple, pet, true)
        tell(couple, { kind: "adopt", text: pet.log[0].text })
        return { pet: viewOf(couple, pet) }
      },
      { write: true }
    )
  )

  router.post(
    "/act",
    small,
    handle(
      async (request, couple) => {
        const pet = await needPet(couple)
        const result = logic.act(pet, couple.me, couple.meName, request.body || {}, svc.clock())
        await save(couple, result.pet)
        tell(couple, { kind: result.entry.kind, text: result.entry.text, detail: result.entry.detail, together: result.together })
        return { pet: viewOf(couple, result.pet), together: result.together }
      },
      { write: true }
    )
  )

  router.post(
    "/visit",
    small,
    handle(
      async (request, couple) => {
        const result = logic.visit(await needPet(couple), couple.me, couple.meName, couple.partner, svc.clock())
        await save(couple, result.pet)
        tell(couple, { kind: result.home ? "home" : "visit", text: result.pet.log[result.pet.log.length - 1].text, together: result.together })
        return { pet: viewOf(couple, result.pet), home: result.home, together: result.together }
      },
      { write: true }
    )
  )

  router.post(
    "/name",
    small,
    handle(
      async (request, couple) => {
        const pet = logic.propose(await needPet(couple), couple.me, couple.meName, petName(request.body?.name), svc.clock())
        await save(couple, pet)
        tell(couple, { kind: "name", text: pet.log[pet.log.length - 1].text })
        return { pet: viewOf(couple, pet) }
      },
      { write: true }
    )
  )

  router.post(
    "/name/answer",
    small,
    handle(
      async (request, couple) => {
        const pet = logic.answer(await needPet(couple), couple.me, couple.meName, request.body?.yes === true, svc.clock())
        await save(couple, pet)
        tell(couple, { kind: "name", text: pet.log[pet.log.length - 1].text })
        return { pet: viewOf(couple, pet) }
      },
      { write: true }
    )
  )

  // live only (nothing stored): the app is open, and where a hand is cuddling or scrubbing
  const live = (fn) => (request, response) => {
    const couple = request.couple
    if (touches(couple.me)) return response.status(429).json({ ok: false, error: "Slow down!" })
    fn(request.body || {}, couple)
    response.json({ ok: true, now: svc.clock(), partnerHere: partnerHere(couple) })
  }

  router.post(
    "/here",
    small,
    live((body, couple) => {
      const open = body.open !== false
      const map = here.get(couple.id) || here.set(couple.id, new Map()).get(couple.id)
      const was = svc.clock() - (map.get(couple.me) || 0) < HERE_MS
      if (open) map.set(couple.me, svc.clock())
      else map.delete(couple.me)
      if (!map.size) here.delete(couple.id)
      if (was !== open) svc.emitToCouple(couple.id, "couple:pet-here", { by: couple.meName, open }, { except: couple.me })
    })
  )

  router.post(
    "/touch",
    small,
    live((body, couple) => {
      const x = Number(body.x)
      const y = Number(body.y)
      if (!["cuddle", "scrub", "end"].includes(body.kind) || !Number.isFinite(x) || !Number.isFinite(y)) return
      svc.emitToCouple(couple.id, "couple:pet-touch", { by: couple.meName, kind: body.kind, x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) }, { except: couple.me })
    })
  )

  router.use((request, response) => response.status(404).json({ ok: false, error: "Not found." }))
  router.use((error, request, response, next) => {
    if (error?.type === "entity.too.large") return response.status(413).json({ ok: false, error: "That's too much." })
    if (error?.type === "entity.parse.failed") return response.status(400).json({ ok: false, error: "That couldn't be read." })
    next(error)
  })

  return router
}

module.exports = { petRouter, authFor }
