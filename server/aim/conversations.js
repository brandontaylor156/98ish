// 98 Messenger socket events for saved conversations, reactions, read receipts, preferences
// and pictures / voice messages (the stores are ./history.js and ./media.js):
//
//   aim:history { since }            -> { cursor, fresh?, more?, messages, clears, reads }
//       since 0 (a new device): the newest 50 messages of each conversation; then every
//       change after `since` (new messages, reactions, "Delivered"), 300 at a time
//   aim:historyOlder { ck, before }  -> { messages } older than `before` (scrolling back)
//   aim:clearHistory { ck, upTo }    this account's saved copy of a conversation goes
//   aim:react { id, ck, emoji|null } one reaction per person per message; passed on live
//   aim:read { ck, at }              "Read" for the other person (two-person IMs only)
//   aim:setPrefs { saveHistory?, receipts? }
//   aim:mediaUpload { kind, mime, size, w, h, d, wf } -> { id, url, method, headers }
//   aim:mediaCommit { id }           after the upload; then aim:im { media: { id } }
//   aim:mediaUrl { id }              -> { url, mime, size } | { expired } | { resting }
//
// `ck` is the conversation as a device names it: the other person's key, or "#<room key>".
// Read receipts work both ways or not at all: someone who turned them off neither sends nor
// sees them.

const crypto = require("node:crypto")
const { toWire, pairConv, isRoom, otherIn, REACTIONS } = require("./history")
const { normalize } = require("./screenNames")

const newId = () => crypto.randomBytes(10).toString("hex")
const ID = /^[0-9a-f]{20}$/
const CK = /^(#[a-z0-9'!?.-]{1,32}|~?[a-z0-9]{1,32})$/

// the preview picture passed with a picture IM: a small JPEG data URL, else nothing
const cleanThumb = (thumb) => (typeof thumb === "string" && thumb.length <= 24_000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(thumb) ? thumb : null)

// what notifications say for a picture or voice message (never the media itself)
const mediaPreview = (media, text = "") => (media?.k === "image" ? `📷 Picture${text ? `: ${text}` : ""}` : media?.k === "audio" ? "🎤 Voice message" : media?.k === "model" ? `🧊 3D model${media.t ? `: ${media.t}` : ""}` : text)

const bindConversations = (on, { io, history, media, sessions, rooms, hidden, emitTo, persist, prefsOf, botKey }) => {
  const reactLimit = new Map() // key -> times (60 a minute)
  const tooFast = (key) => {
    const now = Date.now()
    const recent = (reactLimit.get(key) || []).filter((t) => now - t < 60_000)
    recent.push(now)
    reactLimit.set(key, recent)
    return recent.length > 60
  }
  const convOf = (key, ck) => (ck.startsWith("#") ? ck : pairConv(key, ck))
  const readsOut = async (session) => {
    if (!prefsOf(session.user).receipts) return []
    return (await history.readsFor(session.key)).map((r) => ({ ck: r.r, at: r.at, when: r.w }))
  }

  on("aim:history", async (session, { since }, ack) => {
    const key = session.key
    const from = Number(since) || 0
    if (from <= 0) {
      const cursor = await history.peek()
      const docs = await history.recent(key, 50)
      return ack({ ok: true, fresh: true, cursor, messages: docs.map((d) => toWire(d, key)), clears: [], reads: await readsOut(session), prefs: prefsOf(session.user) })
    }
    const { docs, more } = await history.changes(key, from, 300)
    const clears = await history.clearsSince(key, from)
    const cursor = Math.max(from, ...docs.map((d) => d.u), ...clears.map((c) => c.u))
    ack({
      ok: true,
      cursor,
      more,
      messages: docs.map((d) => toWire(d, key)),
      clears: clears.map((c) => ({ ck: isRoom(c.c) ? c.c : otherIn(c.c, key), upTo: c.at })),
      reads: await readsOut(session),
      prefs: prefsOf(session.user),
    })
  })

  on("aim:historyOlder", async (session, { ck, before, limit }, ack) => {
    if (typeof ck !== "string" || !CK.test(ck)) return ack({ ok: false, error: "Which conversation?" })
    const docs = await history.older(session.key, convOf(session.key, ck), Number(before) || Date.now(), Math.min(100, Math.max(1, Number(limit) || 50)))
    ack({ ok: true, messages: docs.map((d) => toWire(d, session.key)) })
  })

  on("aim:clearHistory", async (session, { ck, upTo }, ack) => {
    if (typeof ck !== "string" || !CK.test(ck)) return ack({ ok: false, error: "Which conversation?" })
    await history.clear(session.key, convOf(session.key, ck), Math.min(Number(upTo) || Date.now(), Date.now()))
    ack({ ok: true })
  })

  on("aim:react", async (session, { id, ck, emoji }, ack) => {
    const value = emoji === null || emoji === "" ? null : REACTIONS.includes(emoji) ? emoji : undefined
    if (typeof id !== "string" || !ID.test(id) || value === undefined || typeof ck !== "string" || !CK.test(ck)) return ack({ ok: false, error: "That reaction can't be sent." })
    if (tooFast(session.key)) return ack({ ok: false, error: "Slow down a little!" })
    const key = session.key
    const room = ck.startsWith("#")
    if (room) {
      const live = rooms.get(ck.slice(1))
      if (!live?.members.has(key)) return ack({ ok: false, error: "You are not in that chat room." })
    } else if (ck === botKey) return ack({ ok: true })
    // saved: only someone in the conversation may react, and the saved copy keeps it
    const doc = await history.get(id)
    if (doc) {
      if (doc.c !== convOf(key, ck)) return ack({ ok: false, error: "That message isn't in this conversation." })
      await history.react(id, key, value)
    }
    const notice = { id, from: session.user.screenName, key, emoji: value }
    if (room) {
      io.to(`chat:${ck.slice(1)}`).emit("aim:react", { ...notice, ck })
    } else {
      const other = sessions.get(ck)
      if (other && !hidden(session, other)) emitTo(other.key, "aim:react", { ...notice, ck: key })
    }
    ack({ ok: true })
  })

  on("aim:read", async (session, { ck, at }, ack) => {
    const time = Number(at)
    if (typeof ck !== "string" || !/^[a-z0-9]{1,32}$/.test(ck) || !Number.isFinite(time) || ck === botKey) return ack({ ok: false })
    if (!prefsOf(session.user).receipts) return ack({ ok: true, off: true })
    const when = Date.now()
    await history.setRead(session.key, ck, pairConv(session.key, ck), Math.min(time, when), when)
    const other = sessions.get(ck)
    if (other && !hidden(session, other) && prefsOf(other.user).receipts) emitTo(other.key, "aim:read", { ck: session.key, at: Math.min(time, when), when })
    ack({ ok: true })
  })

  on("aim:setPrefs", async (session, payload, ack) => {
    const current = prefsOf(session.user)
    const next = {
      saveHistory: typeof payload.saveHistory === "boolean" ? payload.saveHistory : current.saveHistory,
      receipts: typeof payload.receipts === "boolean" ? payload.receipts : current.receipts,
    }
    await persist(session, { prefs: next })
    // turning saving off deletes this account's saved copies; receipts off forgets its reads
    if (current.saveHistory && !next.saveHistory) await history.forget(session.key)
    if (current.receipts && !next.receipts) await history.forgetReads(session.key)
    ack({ ok: true, prefs: prefsOf(session.user) })
  })

  const mediaOff = { ok: false, resting: true }
  on("aim:mediaUpload", async (session, payload, ack) => {
    const service = media()
    if (!service) return ack(mediaOff)
    ack(await service.upload(session.key, payload))
  })
  on("aim:mediaCommit", async (session, { id }, ack) => {
    const service = media()
    if (!service) return ack(mediaOff)
    ack(await service.commit(session.key, String(id || "")))
  })
  on("aim:mediaUrl", async (session, { id }, ack) => {
    const service = media()
    if (!service) return ack(mediaOff)
    ack(await service.url(session.key, String(id || "")))
  })
}

module.exports = { bindConversations, newId, cleanThumb, mediaPreview, normalizeKey: normalize }
