// Visual Basic 98 "programs in a message": a program sent in an IM, a chat room or a Come
// Over hangout becomes one shared copy that everyone there opens and runs on their own
// 98ish, with Shared values kept in step (webxdc-style: the server keeps and relays small
// key/value updates; the program itself runs in each person's sandbox).
//
// client -> server (all acked with { ok, ... })
//   vb:share { app, title?, with? | room? | hangout: true }  -> { ok, id }
//   vb:open { id }        -> { ok, id, app, title, state, people: [names], owner, from }
//   vb:set { id, k, v }   -> { ok }            (relayed to everyone else who has it open)
//   vb:close { id }
//   vb:mine {}            -> { ok, list: [{ id, title, from, people, changedAt }] }
//   vb:forget { id }      leaves a program shared with you (it's deleted when nobody's left)
// server -> client
//   vb:invite { id, from, title, with?, room?, hangout? }   vb:update { id, k, v, from }
//
// Who may open it: the people it was sent to (the two in an IM, whoever was in the chat
// room or hangout then, and anyone in that room later). Caps: the program 256 KB, its
// Shared state 64 KB, 200 changes a day per person per program, 30 shared programs per
// person, 40 MB server-wide; a program nobody changes for 30 days is deleted.

const crypto = require("crypto")
const path = require("path")
const { normalize } = require("./screenNames")
const { pathToFileURL } = require("url")

const STATE_MAX = 64 * 1024
const VALUE_MAX = 8000
const UPDATES_PER_DAY = 200
const MAX_OWNED = Number(process.env.VB98_PER_OWNER) || 30
const TOTAL_MAX = (Number(process.env.VB98_TOTAL_MB) || 40) * 1024 * 1024
const TTL_DAYS = 30
const MAX_PEOPLE = 30
const SAVE_AFTER_MS = 1500
const SHARES_PER_MINUTE = 10
const SETS_PER_10S = 40
const KEY = /^[\w .:\-#@!?+=]{1,64}$/

let fileModule = null
const loadFile = () => (fileModule ??= import(pathToFileURL(path.join(__dirname, "../../client/src/components/applets/vb98/vbfile.js")).href))

const today = (t = Date.now()) => new Date(t).toISOString().slice(0, 10)
const bytesOf = (app, state) => app.length + Object.entries(state).reduce((n, [k, v]) => n + k.length + JSON.stringify(v).length, 0)

const createVbApps = ({ store, sessions, hidden, emitTo, limiter, rooms, findUser, pushTo = null, hangoutPeople = () => [], now = () => Date.now(), saveAfterMs = SAVE_AFTER_MS }) => {
  const open = new Map() // id -> Set of keys with it open right now
  const cache = new Map() // id -> record (while open), saved shortly after changes
  const saveTimers = new Map()
  const shareLimited = limiter(SHARES_PER_MINUTE, 60_000)
  const setLimited = limiter(SETS_PER_10S, 10_000)

  const nameOf = (key) => sessions.get(key)?.user.screenName || key
  const expiry = () => new Date(now() + TTL_DAYS * 86400_000)

  const load = async (id) => {
    if (cache.has(id)) return cache.get(id)
    const r = await store.get(id)
    if (r) cache.set(id, r)
    return r
  }
  const save = (r) => {
    clearTimeout(saveTimers.get(r.id))
    saveTimers.set(
      r.id,
      setTimeout(() => {
        saveTimers.delete(r.id)
        store.update(r.id, { state: r.state, counts: r.counts, bytes: r.bytes, changedAt: r.changedAt, expireAt: r.expireAt, members: r.members, names: r.names, owner: r.owner }).catch((error) => console.error("[vb98] saving failed", error?.message))
        if (!open.get(r.id)?.size) cache.delete(r.id)
      }, saveAfterMs)
    )
  }
  const flush = async () => {
    for (const [id, t] of saveTimers) {
      clearTimeout(t)
      saveTimers.delete(id)
      const r = cache.get(id)
      if (r) await store.update(id, { state: r.state, counts: r.counts, bytes: r.bytes, changedAt: r.changedAt, expireAt: r.expireAt, members: r.members, names: r.names, owner: r.owner })
    }
  }

  // may this person open it? (people in its chat room now count too: they're added)
  const allowed = (r, session) => {
    if (r.members.includes(session.key)) return true
    if (r.conv.startsWith("room:")) {
      const room = rooms.get(r.conv.slice(5))
      if (room?.members.has(session.key) && r.members.length < MAX_PEOPLE) {
        r.members.push(session.key)
        r.names[session.key] = session.user.screenName
        save(r)
        return true
      }
    }
    return false
  }

  const people = (r) => r.members.map((k) => r.names[k] || nameOf(k))

  const bind = (on) => {
    on("vb:share", async (session, payload, ack) => {
      if (shareLimited(session.key)) return ack({ ok: false, error: "That's a lot of sharing at once. Wait a minute and try again." })
      const { validateProject } = await loadFile()
      const checked = validateProject(payload.app)
      if (!checked.ok) return ack({ ok: false, error: checked.error })
      const app = JSON.stringify(checked.project)
      const title = String(payload.title || checked.project.form.caption || checked.project.name).replace(/[\u0000-\u001F]/g, " ").trim().slice(0, 60) || "A program"
      // who it's for
      let members = [session.key]
      let conv = ""
      let invite = {}
      if (payload.with) {
        const otherKey = normalize(payload.with)
        const user = otherKey ? await findUser(otherKey) : null
        if (!user) return ack({ ok: false, error: `${String(payload.with).slice(0, 30)} isn't a 98 Messenger screen name.` })
        if (otherKey === session.key) return ack({ ok: false, error: "Send it to someone else." })
        if ((user.blocked || []).includes(session.key) || session.user.blocked.includes(otherKey)) return ack({ ok: false, error: `You can't send programs to ${user.screenName}.` })
        members = [session.key, otherKey]
        conv = `im:${[session.key, otherKey].sort().join("|")}`
        invite = { with: session.user.screenName }
      } else if (payload.room) {
        const roomKey = normalize(payload.room)
        const room = rooms.get(roomKey)
        if (!room?.members.has(session.key)) return ack({ ok: false, error: "Join that chat room first." })
        members = [...room.members].slice(0, MAX_PEOPLE)
        conv = `room:${roomKey}`
        invite = { room: room.name }
      } else if (payload.hangout) {
        const keys = hangoutPeople(session.key)
        if (!keys.includes(session.key)) return ack({ ok: false, error: "Come Over with someone first." })
        members = keys.slice(0, MAX_PEOPLE)
        conv = `hangout:${members.slice().sort().join("|")}`
        invite = { hangout: true }
      } else return ack({ ok: false, error: "Pick who to send it to." })
      if ((await store.countOwned(session.key)) >= MAX_OWNED) return ack({ ok: false, error: `You've shared ${MAX_OWNED} programs. Remove one in Visual Basic 98 > Shared with Me first.` })
      if ((await store.totalBytes()) + app.length > TOTAL_MAX) return ack({ ok: false, error: "Program sharing is full right now. Try again later." })
      const names = {}
      for (const k of members) names[k] = k === session.key ? session.user.screenName : sessions.get(k)?.user.screenName || (await findUser(k))?.screenName || k
      const t = now()
      const r = { id: crypto.randomBytes(9).toString("hex"), owner: session.key, members, names, title, conv, app, state: {}, bytes: app.length, counts: {}, createdAt: t, changedAt: t, expireAt: expiry() }
      await store.create(r)
      for (const k of members) {
        if (k === session.key) continue
        const s = sessions.get(k)
        if (s && hidden(session, s)) continue
        const note = { id: r.id, from: session.user.screenName, title, ...invite }
        if (s?.socket) emitTo(k, "vb:invite", note)
        else if (pushTo && payload.with)
          pushTo(k, "im", { title: session.user.screenName, body: `Sent you a program: ${title}. Tap to open it.`, tag: `vb-${r.id}`, key: `vb:${r.id}`, app: "im", url: `/?open=program&name=Visual%20Basic%2098&vbapp=${r.id}` })
      }
      ack({ ok: true, id: r.id })
    })

    on("vb:open", async (session, { id }, ack) => {
      const r = await load(String(id || ""))
      if (!r) return ack({ ok: false, error: "That program isn't shared any more." })
      if (!allowed(r, session)) return ack({ ok: false, error: "That program wasn't sent to you." })
      if (!open.has(r.id)) open.set(r.id, new Set())
      open.get(r.id).add(session.key)
      ack({ ok: true, id: r.id, app: r.app, title: r.title, state: r.state, people: people(r), owner: r.names[r.owner] || nameOf(r.owner), me: session.user.screenName })
    })

    on("vb:set", async (session, { id, k, v }, ack) => {
      const r = await load(String(id || ""))
      if (!r || !r.members.includes(session.key)) return ack({ ok: false, error: "That program isn't open." })
      if (setLimited(session.key)) return ack({ ok: false, error: "Too many changes at once." })
      if (typeof k !== "string" || !KEY.test(k)) return ack({ ok: false, error: "That Shared name isn't allowed." })
      if (!(typeof v === "string" ? v.length <= VALUE_MAX : typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v)))) return ack({ ok: false, error: "That Shared value is too big." })
      const d = today(now())
      const c = r.counts[session.key]
      const used = c && c.d === d ? c.n : 0
      if (used >= UPDATES_PER_DAY) return ack({ ok: false, error: `This program has used its ${UPDATES_PER_DAY} changes for today. Try again tomorrow.` })
      const next = { ...r.state }
      if (v === "") delete next[k]
      else next[k] = v
      const bytes = bytesOf(r.app, next)
      if (bytes - r.app.length > STATE_MAX) return ack({ ok: false, error: "This program's Shared values are full (64 KB)." })
      r.state = next
      r.bytes = bytes
      r.counts[session.key] = { d, n: used + 1 }
      r.changedAt = now()
      r.expireAt = expiry()
      save(r)
      for (const key of open.get(r.id) || []) if (key !== session.key) emitTo(key, "vb:update", { id: r.id, k, v, from: session.user.screenName })
      ack({ ok: true })
    })

    on("vb:close", async (session, { id }, ack) => {
      open.get(String(id || ""))?.delete(session.key)
      ack?.({ ok: true })
    })

    on("vb:mine", async (session, _payload, ack) => {
      const list = await store.listFor(session.key, 50)
      ack({ ok: true, list: list.map((r) => ({ id: r.id, title: r.title, from: r.names?.[r.owner] || r.owner, people: (r.members || []).map((k) => r.names?.[k] || k), changedAt: r.changedAt })) })
    })

    on("vb:forget", async (session, { id }, ack) => {
      const r = await load(String(id || ""))
      if (!r || !r.members.includes(session.key)) return ack({ ok: true })
      await leaveRecord(r, session.key)
      ack({ ok: true })
    })
  }

  // someone leaves a shared program (Remove, or Delete My Account): the next person owns it;
  // nobody left: it's deleted
  const leaveRecord = async (r, key) => {
    r.members = r.members.filter((k) => k !== key)
    delete r.names[key]
    delete r.counts[key]
    open.get(r.id)?.delete(key)
    if (!r.members.length) {
      clearTimeout(saveTimers.get(r.id))
      saveTimers.delete(r.id)
      cache.delete(r.id)
      open.delete(r.id)
      await store.remove(r.id)
      return "deleted"
    }
    if (r.owner === key) r.owner = r.members[0]
    await store.update(r.id, { members: r.members, names: r.names, counts: r.counts, owner: r.owner })
    if (cache.has(r.id)) cache.set(r.id, r)
    return "left"
  }

  // Delete My Account: out of every shared program (their past Shared values stay part of it)
  const eraseAccount = async ({ key }) => {
    const recs = await store.forKey(key)
    let deleted = 0
    let left = 0
    for (const rec of recs) {
      const r = cache.get(rec.id) || rec
      if ((await leaveRecord(r, key)) === "deleted") deleted++
      else left++
    }
    return { deleted, left }
  }

  const dropped = (key) => {
    for (const set of open.values()) set.delete(key)
  }

  const close = async () => {
    await flush()
    open.clear()
    cache.clear()
  }

  return { bind, eraseAccount, dropped, flush, close, open }
}

module.exports = { createVbApps, STATE_MAX, UPDATES_PER_DAY }
