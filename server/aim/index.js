// 98 Messenger: an AIM-style service on Socket.io. Accounts persist through the store;
// saved conversations, reactions and read receipts are in ./history.js, pictures and voice
// messages in ./media.js (events in ./conversations.js); everything else (who's online, away
// messages, warnings, chat rooms) lives in memory.

const crypto = require("crypto")
const bcrypt = require("bcryptjs")
const { normalize, validate } = require("./screenNames")
const { createStore } = require("./store")
const { createBot, BOT_NAME } = require("./bot")
const { createCalls } = require("./calls")
const { createTogether } = require("./together")
const { createIce } = require("./ice")
const { createAccountEraser } = require("../account")
const { createHistoryStore, pairConv, roomConv, packStyle } = require("./history")
const { bindConversations, newId, cleanThumb, mediaPreview } = require("./conversations")

const MAX_MESSAGE = 1024
const MAX_PROFILE = 1024
const RESUME_GRACE_MS = 20_000 // a dropped connection stays signed on this long
const REMEMBER_MS = 60 * 86_400_000 // "Remember me" keeps a device signed on this long after its last use
const REMEMBERED_DEVICES = 6 // per account; the oldest is forgotten first
const WARN_DECAY_MS = 30_000 // warning level drops 1% this often
const IMS_PER_MINUTE = 30
// Failed sign-ons allowed per 5 minutes, per IP and per screen name (password guessing)
const FAILED_SIGN_ONS_PER_IP = 20
const FAILED_SIGN_ONS_PER_NAME = 8

const BOT_KEY = normalize(BOT_NAME)
const BOT_SIGN_ON = new Date()
const DELETING_TEXT = "This screen name is being deleted. To finish, choose Delete My Account again and type its password."
const DELETED_TEXT = "This 98 Messenger account was deleted."

// remember-me tokens are stored only as hashes
const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex")

const clean = (text, max) => String(text ?? "").replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "").slice(0, max)

// Only the formatting the client knows how to draw; anything else is dropped
const FONTS = ["Times New Roman", "Arial", "Comic Sans MS", "Courier New", "Verdana"]
const cleanStyle = (style = {}) => ({
  font: FONTS.includes(style.font) ? style.font : FONTS[1],
  size: [10, 12, 14, 18, 24].includes(style.size) ? style.size : 12,
  color: /^#[0-9a-f]{6}$/i.test(style.color) ? style.color : "#000000",
  bold: !!style.bold,
  italic: !!style.italic,
  underline: !!style.underline,
})

// Valid, de-duplicated buddy names (first spelling wins), at most 20 groups of 200
const cleanGroups = (groups) =>
  (Array.isArray(groups) ? groups : []).slice(0, 20).map((group) => {
    const buddies = new Map()
    for (const name of Array.isArray(group?.buddies) ? group.buddies : []) {
      const valid = validate(name)
      if (!valid.error && !buddies.has(valid.key)) buddies.set(valid.key, valid.screenName)
    }
    return { name: clean(group?.name, 32).trim() || "Buddies", buddies: [...buddies.values()].slice(0, 200) }
  })

// Sliding-window counter keyed by anything: hit(key) records one and says whether
// the key is now over the limit; over(key) checks without recording
const limiter = (limit, windowMs) => {
  const hits = new Map()
  const recent = (key) => (hits.get(key) || []).filter((t) => Date.now() - t < windowMs)
  const over = (key) => recent(key).length >= limit
  const hit = (key) => {
    const list = recent(key)
    list.push(Date.now())
    hits.set(key, list)
    return list.length > limit
  }
  return Object.assign(hit, { over })
}

// Web Push (../push) is optional: `push` notifies people who are away from 98ish about IMs
// and calls, and keeps IMs sent to someone signed off (who has notifications on) until
// they sign on again.
// `eraser` (../account): the steps that delete an account's data everywhere, for
// aim:deleteAccount; without one only the account record goes.
// `history` (./history.js, a store or a promise of one): saved conversations; in memory
// without one. `media` (./media.js): pictures and voice messages in IMs; off without one.
const attachAim = async (io, { store, bot, ice, callRingMs, callLostMs, push = null, eraser = null, history = null, media: imMedia = null } = {}) => {
  store ??= await createStore()
  bot ??= createBot()
  ice ??= createIce()
  eraser ??= createAccountEraser()
  // (a history store that failed to connect: 98 Messenger still runs, keeping history in memory)
  history = (await Promise.resolve(history).catch(() => null)) || (await createHistoryStore(""))
  const deletingNow = new Set() // keys being deleted right now (one try at a time)

  const sessions = new Map() // key -> session (signed on, possibly mid-reconnect)
  const tokens = new Map() // resume token -> key
  const warnings = new Map() // key -> { level, at } (survives signing off)
  const warnCredits = new Map() // "warner>target" -> IMs received from target not yet warned for
  const rooms = new Map() // room key -> { name, members: Set<key> }
  const failedByIp = limiter(FAILED_SIGN_ONS_PER_IP, 5 * 60_000)
  const failedByName = limiter(FAILED_SIGN_ONS_PER_NAME, 5 * 60_000)
  const imLimited = limiter(IMS_PER_MINUTE, 60_000)

  const warningOf = (key) => {
    const w = warnings.get(key)
    if (!w) return 0
    const level = Math.max(0, w.level - Math.floor((Date.now() - w.at) / WARN_DECAY_MS))
    if (level === 0) warnings.delete(key)
    return level
  }

  const presenceOf = (session) => ({
    screenName: session.user.screenName,
    online: true,
    away: !!session.away,
    idleSince: session.idleSince,
    warning: warningOf(session.key),
    signOnAt: session.signOnAt,
  })

  const botPresence = () => ({
    screenName: BOT_NAME,
    online: true,
    away: false,
    idleSince: null,
    warning: 0,
    signOnAt: BOT_SIGN_ON,
    bot: true,
  })

  // Preferences > "Save my conversations on the server" and "Read receipts" (both on unless
  // turned off)
  const prefsOf = (user) => ({ saveHistory: user?.prefs?.saveHistory !== false, receipts: user?.prefs?.receipts !== false })

  // a message into the saved history (./history.js), for whoever of `people` keeps theirs
  const record = (doc, people) => {
    const p = people.filter((x) => x.key && prefsOf(x.user).saveHistory).map((x) => x.key)
    if (!p.length) return Promise.resolve(null)
    return history.add({ ...doc, p: [...new Set(p)] }).catch((error) => {
      console.error("[aim] saving a message failed", error?.message)
      return null
    })
  }

  const blocks = (session, otherKey) => session.user.blocked.includes(otherKey)
  // Either side blocking hides them from each other, like the real service
  const hidden = (a, b) => blocks(a, b.key) || blocks(b, a.key)

  const emitTo = (key, event, payload) => {
    const session = sessions.get(key)
    if (session?.socket) session.socket.emit(event, payload)
  }

  // someone signed off who can still be reached with a notification: their screen name, or
  // null (not registered, blocked either way, or no notifications of this kind)
  const reachableOffline = async (from, key, category) => {
    if (!push?.enabled || !(await push.wouldSend(key, category))) return null
    const user = await store.find(key)
    if (!user || (user.blocked || []).includes(from.key) || from.user.blocked.includes(key)) return null
    return user.screenName
  }

  const pushTo = (key, category, message, options) => {
    if (!push?.enabled) return
    push.notify(key, category, message, options).catch(() => {})
  }

  const callNotices = push && {
    reachable: (from, key) => reachableOffline(from, key, "calls"),
    ring: (call) =>
      pushTo(
        call.to,
        "calls",
        {
          title: `${call.fromName} is calling`,
          body: `${call.video ? "Video call" : "Voice call"} on 98 Messenger. Tap to open 98ish and answer.`,
          tag: `call-${call.from}`,
          key: `call:${call.id}`,
          app: "calls",
          requireInteraction: true,
          renotify: true,
          url: `/?open=call&with=${encodeURIComponent(call.fromName)}`,
        },
        { urgency: "high", ttl: 45_000, from: call.from }
      ),
    missed: (key, notice) =>
      pushTo(key, "calls", {
        title: notice.busy ? `${notice.from} tried to call` : `Missed ${notice.video ? "video " : ""}call`,
        body: notice.busy ? `${notice.from} called while you were on another call.` : `${notice.from} called you on 98 Messenger.`,
        tag: `call-${normalize(notice.from)}`,
        key: `missed:${normalize(notice.from)}:${notice.time}`,
        app: "calls",
        renotify: true,
        url: `/?open=im&with=${encodeURIComponent(notice.from)}`,
        time: notice.time,
      }),
  }

  // voice and video calls (signaling only)
  const calls = createCalls({ sessions, hidden, emitTo, limiter, ice, botKey: BOT_KEY, ringMs: callRingMs, lostMs: callLostMs, offline: callNotices, allowed: push?.callAllowed ? (to, from) => push.callAllowed(to, from) : null })

  // Watch & Listen Together (a shared YouTube player; control state only, in memory)
  const together = createTogether({ sessions, hidden, emitTo, limiter, rooms, botKey: BOT_KEY, pushTo: push ? pushTo : null })

  const broadcastPresence = (subject, online = true) => {
    const payload = online ? presenceOf(subject) : { screenName: subject.user.screenName, online: false }
    for (const other of sessions.values()) {
      if (other.key === subject.key || !other.socket) continue
      if (hidden(subject, other)) continue
      other.socket.emit("aim:presence", payload)
    }
  }

  const onlineListFor = (session) => [
    botPresence(),
    ...[...sessions.values()].filter((s) => s.key !== session.key && !hidden(session, s)).map(presenceOf),
  ]

  const roomKey = (name) => normalize(name)
  const roomMembers = (room) => [...room.members].map((k) => sessions.get(k)?.user.screenName).filter(Boolean)

  const leaveRoom = (session, key, announce = true) => {
    const room = rooms.get(key)
    if (!room || !room.members.delete(session.key)) return
    session.socket?.leave(`chat:${key}`)
    together.leftRoom(session.key, key)
    if (announce) {
      io.to(`chat:${key}`).emit("aim:chat", {
        room: room.name,
        system: true,
        text: `${session.user.screenName} has left the room.`,
        time: Date.now(),
      })
    }
    io.to(`chat:${key}`).emit("aim:chatMembers", { room: room.name, members: roomMembers(room) })
    if (room.members.size === 0) rooms.delete(key)
  }

  const signOff = (session, { announce = true } = {}) => {
    if (sessions.get(session.key) !== session) return
    clearTimeout(session.dropTimer)
    calls.endFor(session.key, "signedoff")
    together.leaveAll(session.key)
    for (const key of rooms.keys()) leaveRoom(session, key)
    sessions.delete(session.key)
    tokens.delete(session.token)
    bot.forget(session.key)
    if (announce) broadcastPresence(session, false)
  }

  const welcome = (session) => ({
    ok: true,
    token: session.token,
    me: {
      screenName: session.user.screenName,
      profile: session.user.profile,
      groups: session.user.groups,
      blocked: session.user.blocked,
      warning: warningOf(session.key),
      createdAt: session.user.createdAt,
      prefs: prefsOf(session.user),
    },
    online: onlineListFor(session),
  })

  const attachSocket = (session, socket) => {
    clearTimeout(session.dropTimer)
    session.socket = socket
    session.visible = true // until the page says it's in the background (aim:visibility)
    socket.data.key = session.key
    socket.join("aim")
    for (const [key, room] of rooms) if (room.members.has(session.key)) socket.join(`chat:${key}`)
    calls.resumed(session)
    together.resumed(session)
    const pending = session.pendingIms || []
    session.pendingIms = []
    if (pending.length) setTimeout(() => pending.forEach((m) => session.socket?.emit("aim:im", m)), 300)
  }

  const persist = async (session, patch) => {
    const updated = await store.update(session.key, patch)
    if (updated) session.user = updated
  }

  // a new "Remember me" token for this account: returned once, stored as a hash
  const rememberDevice = async (user) => {
    const token = crypto.randomBytes(32).toString("hex")
    const now = Date.now()
    const list = [...(user.remember || []).filter((r) => r.expiresAt > now), { hash: hashToken(token), expiresAt: now + REMEMBER_MS }]
    const updated = await store.update(user.key, { remember: list.slice(-REMEMBERED_DEVICES) })
    if (updated) Object.assign(user, updated)
    return token
  }

  const conversations = { io, history, media: () => imMedia, sessions, rooms, hidden, emitTo, persist, prefsOf, botKey: BOT_KEY }

  io.on("connection", (socket) => {
    const ip = String(socket.handshake.headers["x-forwarded-for"] || socket.handshake.address).split(",")[0].trim()
    const current = () => {
      const session = sessions.get(socket.data.key)
      return session?.socket === socket ? session : null
    }
    // Wrap a handler so it only runs for a signed-on socket and never crashes the server
    const on = (event, handler) =>
      socket.on(event, async (payload = {}, ack = () => {}) => {
        if (typeof ack !== "function") ack = () => {}
        const session = current()
        if (!session) return ack({ ok: false, error: "You are not signed on." })
        try {
          await handler(session, payload || {}, ack)
        } catch (error) {
          console.error(`[aim] ${event} failed`, error)
          ack({ ok: false, error: "Something went wrong. Please try again." })
        }
      })
    calls.bind(on)
    together.bind(on)
    bindConversations(on, conversations)

    const startSession = (user, key, ack, remember) => {
      // Signing on somewhere else bumps the old session, like the real service
      const existing = sessions.get(key)
      if (existing) {
        if (existing.socket && existing.socket !== socket) {
          existing.socket.emit("aim:kicked", {
            reason:
              "You have been disconnected from the 98 Messenger service because you signed on at a different location.",
          })
          existing.socket.leave("aim")
        }
        signOff(existing, { announce: false })
      }

      // Signing on as someone new from the same window signs the old name off
      const previous = current()
      if (previous) signOff(previous)

      const session = {
        key,
        user,
        token: crypto.randomBytes(24).toString("hex"),
        signOnAt: new Date(),
        away: null,
        awayRepliedTo: new Set(),
        idleSince: null,
        socket: null,
      }
      sessions.set(key, session)
      tokens.set(session.token, key)
      attachSocket(session, socket)
      ack(remember ? { ...welcome(session), remember } : welcome(session))
      broadcastPresence(session)
      deliverOffline(session)
    }

    // IMs that came while they were signed off (kept because they have notifications on)
    const deliverOffline = (session) => {
      if (!push) return
      push
        .getStore()
        .then((s) => s.inbox.take(session.key))
        .then((messages) => {
          if (!messages.length) return
          // after the sign-on reply has landed
          setTimeout(() => {
            for (const m of messages) emitTo(session.key, "aim:im", { ...m, offline: true })
            // "Delivered" for whoever sent them (saved copies stop saying they're waiting)
            const ids = messages.map((m) => m.id).filter(Boolean)
            if (ids.length) history.delivered(ids).catch(() => [])
            const bySender = new Map()
            for (const m of messages) if (m.id) bySender.set(normalize(m.from), [...(bySender.get(normalize(m.from)) || []), m.id])
            for (const [sender, list] of bySender) emitTo(sender, "aim:delivered", { ck: session.key, to: session.user.screenName, ids: list, at: Date.now() })
          }, 300)
        })
        .catch(() => {})
    }

    socket.on("aim:signOn", async (payload = {}, ack = () => {}) => {
      if (typeof ack !== "function") return
      try {
        const { screenName, key, error } = validate(payload.screenName)
        if (failedByIp.over(ip) || (key && failedByName.over(key))) {
          return ack({ ok: false, error: "Too many failed sign on attempts. Please wait a few minutes." })
        }
        if (error) return ack({ ok: false, error })
        const password = String(payload.password || "")
        if (password.length < 4 || password.length > 64) {
          return ack({ ok: false, error: "Passwords must be 4-64 characters." })
        }
        if (key === BOT_KEY) return ack({ ok: false, error: "That screen name is not available." })

        let user
        if (payload.register) {
          if (await store.find(key)) return ack({ ok: false, error: `The screen name ${screenName} is already taken.` })
          try {
            user = await store.create({ key, screenName, passwordHash: await bcrypt.hash(password, 10) })
          } catch (err) {
            if (err.code === 11000) return ack({ ok: false, error: `The screen name ${screenName} is already taken.` })
            throw err
          }
        } else {
          user = await store.find(key)
          if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
            failedByIp(ip)
            failedByName(key)
            return ack({ ok: false, error: "Incorrect screen name or password." })
          }
          if (user.deleting) return ack({ ok: false, deleting: true, error: DELETING_TEXT })
        }

        const remember = payload.remember ? await rememberDevice(user) : undefined
        startSession(user, key, ack, remember)
      } catch (error) {
        console.error("[aim] sign on failed", error)
        ack({ ok: false, error: "The 98 Messenger service is temporarily unavailable. Please try again." })
      }
    })

    // 98ish's lock screen "Forgot PIN?": checks a screen name and password without signing
    // on (no session, no buddies told). Same failed-try limits as signing on.
    socket.on("aim:verify", async (payload = {}, ack = () => {}) => {
      if (typeof ack !== "function") return
      try {
        const { screenName, key, error } = validate(payload.screenName)
        if (failedByIp.over(ip) || (key && failedByName.over(key))) {
          return ack({ ok: false, error: "Too many failed attempts. Please wait a few minutes." })
        }
        if (error) return ack({ ok: false, error })
        const password = String(payload.password || "")
        const user = key === BOT_KEY || password.length < 4 || password.length > 64 ? null : await store.find(key)
        if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
          failedByIp(ip)
          failedByName(key)
          return ack({ ok: false, error: "Incorrect screen name or password." })
        }
        ack({ ok: true, screenName: user.screenName || screenName })
      } catch (error) {
        console.error("[aim] verify failed", error)
        ack({ ok: false, error: "The 98 Messenger service is temporarily unavailable. Please try again." })
      }
    })

    // Delete My Account (../account has what goes and why). The password is asked again. It
    // runs signed on as that account, or signed off when an earlier try stopped half way
    // (nobody can sign on to an account being deleted). -> { ok, screenName } |
    // { ok: false, error, retry? (some data is left: ask again to finish) }
    socket.on("aim:deleteAccount", async (payload = {}, ack = () => {}) => {
      if (typeof ack !== "function") return
      let key = null
      try {
        const valid = validate(payload.screenName)
        key = valid.key
        if (failedByIp.over(ip) || (key && failedByName.over(key))) return ack({ ok: false, error: "Too many failed attempts. Please wait a few minutes." })
        if (valid.error) return ack({ ok: false, error: valid.error })
        const password = String(payload.password || "")
        const user = key === BOT_KEY || password.length < 4 || password.length > 64 ? null : await store.find(key)
        if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
          failedByIp(ip)
          failedByName(key)
          return ack({ ok: false, error: "Incorrect screen name or password." })
        }
        const session = current()
        if (!user.deleting && session?.key !== key) return ack({ ok: false, error: `Sign on as ${user.screenName} first, then delete the account.` })
        if (deletingNow.has(key)) return ack({ ok: false, error: "This account is already being deleted. Please wait a moment." })
        deletingNow.add(key)
        try {
          // 1. what the steps need, kept with the account for a second try; no more sign ons
          const ctx = await eraser.context(key, user.screenName, user.deleting)
          await store.update(key, { deleting: { at: user.deleting?.at || Date.now(), screenName: user.screenName, coupleIds: ctx.coupleIds, partners: ctx.partners }, remember: [] })
          // 2. signed off everywhere (this window hears the answer below; others are told)
          const live = sessions.get(key)
          if (live) {
            if (live.socket && live.socket !== socket) {
              live.socket.emit("aim:kicked", { reason: DELETED_TEXT, deleted: true })
              live.socket.leave("aim")
            }
            if (live.socket === socket) socket.leave("aim")
            signOff(live)
          }
          // 3. everything else, step by step
          const result = await eraser.run(ctx)
          if (!result.ok) {
            return ack({ ok: false, retry: true, failed: result.failed, error: "Some of your information couldn't be deleted yet. Nothing more can be done with this account; choose Delete Account again to finish." })
          }
          // 4. the name off everyone's lists, then the account itself: the name is free
          await store.forgetEverywhere(key)
          for (const other of sessions.values()) {
            const blocked = other.user.blocked.filter((k) => k !== key)
            const groups = other.user.groups.map((g) => ({ name: g.name, buddies: g.buddies.filter((b) => normalize(b) !== key) }))
            const changed = blocked.length !== other.user.blocked.length || groups.some((g, i) => g.buddies.length !== other.user.groups[i].buddies.length)
            other.user = { ...other.user, blocked, groups }
            if (changed) emitTo(other.key, "aim:accountGone", { screenName: user.screenName, groups, blocked })
          }
          warnings.delete(key)
          for (const k of warnCredits.keys()) if (k.startsWith(`${key}>`) || k.endsWith(`>${key}`)) warnCredits.delete(k)
          bot.forget(key)
          await store.remove(key)
          console.log("[aim] an account was deleted")
          ack({ ok: true, screenName: user.screenName, steps: result.done.map((d) => d.name) })
        } finally {
          deletingNow.delete(key)
        }
      } catch (error) {
        console.error("[aim] delete account failed", error?.message)
        ack({ ok: false, retry: true, error: "The 98 Messenger service is temporarily unavailable. Please try again." })
      }
    })

    // Reattach after a dropped connection without buddies seeing a sign off
    socket.on("aim:resume", (payload = {}, ack = () => {}) => {
      if (typeof ack !== "function") return
      const key = tokens.get(String(payload.token || ""))
      const session = key && sessions.get(key)
      if (!session) return ack({ ok: false })
      if (session.socket && session.socket !== socket) session.socket.leave("aim")
      attachSocket(session, socket)
      ack(welcome(session))
    })

    // "Remember me": a device that signed on with it signs on again with its token (phones
    // reload pages and drop connections all the time), until it signs off or it expires
    socket.on("aim:signOnRemembered", async (payload = {}, ack = () => {}) => {
      if (typeof ack !== "function") return
      try {
        const { key, error } = validate(payload.screenName)
        const token = String(payload.token || "")
        if (error || key === BOT_KEY || !token || token.length > 128) return ack({ ok: false })
        if (failedByIp.over(ip) || failedByName.over(key)) return ack({ ok: false })
        const user = await store.find(key)
        const hash = hashToken(token)
        const now = Date.now()
        const found = user && !user.deleting && (user.remember || []).find((r) => r.hash === hash && r.expiresAt > now)
        if (!found) {
          failedByIp(ip)
          failedByName(key)
          return ack({ ok: false })
        }
        // used: good for another full stretch
        const remember = user.remember.filter((r) => r.expiresAt > now).map((r) => (r.hash === hash ? { ...r, expiresAt: now + REMEMBER_MS } : r))
        startSession((await store.update(key, { remember })) || user, key, ack)
      } catch (error) {
        console.error("[aim] remembered sign on failed", error)
        ack({ ok: false, error: "The 98 Messenger service is temporarily unavailable. Please try again." })
      }
    })

    // signing off on purpose forgets this device
    socket.on("aim:forget", async (payload = {}) => {
      const session = current()
      const token = String(payload?.token || "")
      if (!session || !token || token.length > 128) return
      const hash = hashToken(token)
      try {
        await persist(session, { remember: (session.user.remember || []).filter((r) => r.hash !== hash) })
      } catch (error) {
        console.error("[aim] forget failed", error)
      }
    })

    socket.on("aim:signOff", () => {
      const session = current()
      if (session) {
        socket.leave("aim")
        signOff(session)
      }
    })

    socket.on("disconnect", () => {
      const session = current()
      if (!session) return
      session.socket = null
      session.dropTimer = setTimeout(() => signOff(session), RESUME_GRACE_MS)
      calls.dropped(session.key)
      together.dropped(session.key)
    })

    // { to, text, style, media?: { id } (sent with aim:mediaUpload/aim:mediaCommit), thumb?
    // (a small preview picture, passed on live, never stored) } -> { ok, id, offline? }
    on("aim:im", async (session, { to, text, style, media: mediaRef, thumb }, ack) => {
      const message = clean(text, MAX_MESSAGE).trim()
      const wantsMedia = !!mediaRef?.id
      if (!message && !wantsMedia) return ack({ ok: false, error: "Message is empty." })
      if (warningOf(session.key) >= 100) {
        return ack({ ok: false, error: "Your warning level is too high to send messages right now. Try again later." })
      }
      if (imLimited(session.key)) return ack({ ok: false, error: "You are sending messages too fast. Slow down!" })
      const target = validate(to)
      if (target.error) return ack({ ok: false, error: "Invalid screen name." })
      const payloadStyle = cleanStyle(style)

      if (target.key === BOT_KEY) {
        if (wantsMedia) return ack({ ok: false, error: `${BOT_NAME} can't open pictures or voice messages. Try typing!` })
        ack({ ok: true, id: newId() })
        socket.emit("aim:typing", { from: BOT_NAME, state: "typing" })
        const reply = await bot.reply(session.key, session.user.screenName, message)
        if (sessions.get(session.key) !== session) return
        emitTo(session.key, "aim:typing", { from: BOT_NAME, state: "none" })
        emitTo(session.key, "aim:im", {
          id: newId(),
          from: BOT_NAME,
          text: reply,
          style: { ...cleanStyle(), font: "Arial", color: "#000080" },
          time: Date.now(),
        })
        return
      }

      const recipient = sessions.get(target.key)
      const shown = recipient && !hidden(session, recipient)
      // signed off with notifications on: it waits for them, and their phone hears about it
      const offlineUser = shown || recipient ? null : await reachableOffline(session, target.key, "im").then((name) => name && store.find(target.key)).catch(() => null)
      if (!shown && !offlineUser) return ack({ ok: false, error: `${target.screenName} is not currently signed on.` })
      const toName = shown ? recipient.user.screenName : offlineUser.screenName

      let media = null
      if (wantsMedia) {
        media = imMedia ? await imMedia.attach(session.key, String(mediaRef.id), [target.key]).catch(() => null) : null
        if (!media) return ack({ ok: false, error: "That picture or voice message couldn't be sent. Please try again." })
      }
      const id = newId()
      const time = Date.now()
      const im = { id, from: session.user.screenName, text: message, style: payloadStyle, time, ...(media ? { media } : {}) }
      const preview = mediaPreview(media, message)
      const imNotice = {
        title: session.user.screenName,
        body: preview,
        tag: `im-${session.key}`,
        key: `im:${session.key}`,
        app: "im",
        renotify: true,
        url: `/?open=im&with=${encodeURIComponent(session.user.screenName)}`,
      }
      const doc = { _id: id, c: pairConv(session.key, target.key), f: session.user.screenName, fk: session.key, to: toName, t: message, s: packStyle(payloadStyle), at: time, ...(media ? { m: media } : {}) }

      if (!shown) {
        await (await push.getStore()).inbox.add(target.key, im)
        pushTo(target.key, "im", imNotice)
        record({ ...doc, h: 1 }, [session, { key: target.key, user: offlineUser }])
        return ack({ ok: true, id, time, offline: true, notice: `${toName} is signed off. They'll get your message as a notification and see it when they sign on.` })
      }

      const live = { ...im, ...(media && cleanThumb(thumb) ? { thumb: cleanThumb(thumb) } : {}) }
      // a connection that blipped (a phone asleep) gets it when it comes back
      if (recipient.socket) emitTo(recipient.key, "aim:im", live)
      else recipient.pendingIms = [...(recipient.pendingIms || []), live].slice(-50)
      pushTo(recipient.key, "im", imNotice) // only if they're away from 98ish
      record(doc, [session, recipient])
      const creditKey = `${recipient.key}>${session.key}`
      warnCredits.set(creditKey, (warnCredits.get(creditKey) || 0) + 1)
      ack({ ok: true, id, time })

      // Away message goes back once per conversation for each time they go away
      if (recipient.away && !recipient.awayRepliedTo.has(session.key)) {
        recipient.awayRepliedTo.add(session.key)
        socket.emit("aim:im", {
          id: newId(),
          from: recipient.user.screenName,
          text: recipient.away,
          style: cleanStyle(),
          time: Date.now(),
          auto: true,
        })
      }
    })

    on("aim:typing", (session, { to, state }) => {
      const target = validate(to)
      if (target.error || !["typing", "entered", "none"].includes(state)) return
      const recipient = sessions.get(target.key)
      if (recipient && !hidden(session, recipient)) {
        emitTo(recipient.key, "aim:typing", { from: session.user.screenName, state })
      }
    })

    on("aim:setAway", (session, { message }, ack) => {
      const text = clean(message, MAX_MESSAGE).trim()
      session.away = text || null
      session.awayRepliedTo = new Set()
      broadcastPresence(session)
      ack({ ok: true })
    })

    // the page went to the background (another tab, the phone locked) or came back: while
    // it's hidden, IMs and calls also go out as notifications
    on("aim:visibility", (session, { visible }) => {
      session.visible = visible !== false
    })

    on("aim:setIdle", (session, { idle }) => {
      const next = idle ? session.idleSince || Date.now() : null
      if (next === session.idleSince) return
      session.idleSince = next
      broadcastPresence(session)
    })

    on("aim:setProfile", async (session, { profile }, ack) => {
      await persist(session, { profile: clean(profile, MAX_PROFILE) })
      ack({ ok: true, profile: session.user.profile })
    })

    on("aim:saveGroups", async (session, { groups }, ack) => {
      await persist(session, { groups: cleanGroups(groups) })
      ack({ ok: true, groups: session.user.groups })
    })

    on("aim:block", async (session, { screenName, blocked }, ack) => {
      const target = validate(screenName)
      if (target.error || target.key === BOT_KEY) return ack({ ok: false, error: "You can't block that screen name." })
      const other = sessions.get(target.key)
      const wasHidden = other && hidden(session, other)
      const list = new Set(session.user.blocked)
      blocked ? list.add(target.key) : list.delete(target.key)
      await persist(session, { blocked: [...list] })

      // Appear offline to (or reappear for) the other person
      if (other && wasHidden !== hidden(session, other)) {
        const nowHidden = hidden(session, other)
        if (nowHidden) calls.endBetween(session.key, other.key, "blocked")
        if (nowHidden) together.blocked(session.key, other.key)
        emitTo(other.key, "aim:presence", nowHidden ? { screenName: session.user.screenName, online: false } : presenceOf(session))
        emitTo(session.key, "aim:presence", nowHidden ? { screenName: other.user.screenName, online: false } : presenceOf(other))
      }
      ack({ ok: true, blocked: session.user.blocked })
    })

    on("aim:warn", (session, { to, anonymous }, ack) => {
      const target = validate(to)
      if (target.error) return ack({ ok: false, error: "Invalid screen name." })
      if (target.key === BOT_KEY) return ack({ ok: false, error: `${BOT_NAME} laughs off your warning. Nice try! :-)` })
      const recipient = sessions.get(target.key)
      if (!recipient) return ack({ ok: false, error: `${target.screenName} is not currently signed on.` })

      // You can only warn someone once for each message they've sent you
      const creditKey = `${session.key}>${recipient.key}`
      const credits = warnCredits.get(creditKey) || 0
      if (!credits) return ack({ ok: false, error: `You can only warn ${recipient.user.screenName} after they send you a message.` })
      warnCredits.set(creditKey, credits - 1)

      const level = Math.min(100, warningOf(recipient.key) + (anonymous ? 3 : 10))
      warnings.set(recipient.key, { level, at: Date.now() })
      emitTo(recipient.key, "aim:warned", { by: anonymous ? null : session.user.screenName, warning: level })
      broadcastPresence(recipient)
      ack({ ok: true, warning: level })
    })

    on("aim:getInfo", async (session, { screenName }, ack) => {
      const target = validate(screenName)
      if (target.error) return ack({ ok: false, error: "Invalid screen name." })
      if (target.key === BOT_KEY) {
        return ack({
          ok: true,
          info: {
            ...botPresence(),
            profile:
              "Hi! I'm SmarterChild, your friendly 98ish robot buddy. IM me anytime for jokes, trivia, games, or just to chat. I never sleep! :-)",
          },
        })
      }
      const online = sessions.get(target.key)
      if (online && !hidden(session, online)) {
        return ack({
          ok: true,
          info: { ...presenceOf(online), profile: online.user.profile, awayMessage: online.away, memberSince: online.user.createdAt },
        })
      }
      const user = await store.find(target.key)
      if (!user) return ack({ ok: false, error: `${target.screenName} is not a registered screen name.` })
      ack({ ok: true, info: { screenName: user.screenName, online: false, profile: user.profile, memberSince: user.createdAt } })
    })

    on("aim:chatJoin", (session, { room: name }, ack) => {
      const roomName = clean(name, 32).trim().replace(/\s+/g, " ")
      if (!/^[A-Za-z0-9][A-Za-z0-9 '!?.-]{0,31}$/.test(roomName)) return ack({ ok: false, error: "Invalid chat room name." })
      const key = roomKey(roomName)
      const room = rooms.get(key) || { name: roomName, members: new Set() }
      rooms.set(key, room)
      if (!room.members.has(session.key)) {
        room.members.add(session.key)
        socket.join(`chat:${key}`)
        io.to(`chat:${key}`).emit("aim:chat", {
          room: room.name,
          system: true,
          text: `${session.user.screenName} has entered the room.`,
          time: Date.now(),
        })
        io.to(`chat:${key}`).emit("aim:chatMembers", { room: room.name, members: roomMembers(room) })
      }
      ack({ ok: true, room: room.name, members: roomMembers(room) })
    })

    on("aim:chatLeave", (session, { room }, ack) => {
      leaveRoom(session, roomKey(clean(room, 32)))
      ack({ ok: true })
    })

    on("aim:chatSay", (session, { room, text, style }, ack) => {
      const key = roomKey(clean(room, 32))
      const message = clean(text, MAX_MESSAGE).trim()
      if (!rooms.get(key)?.members.has(session.key)) return ack({ ok: false, error: "You are not in that chat room." })
      if (!message) return ack({ ok: false })
      if (imLimited(session.key)) return ack({ ok: false, error: "You are sending messages too fast. Slow down!" })
      const live = rooms.get(key)
      const said = { id: newId(), room: live.name, from: session.user.screenName, text: message, style: cleanStyle(style), time: Date.now() }
      io.to(`chat:${key}`).emit("aim:chat", said)
      // saved for the people in the room right now (each by their own setting)
      const members = [...live.members].map((k) => sessions.get(k)).filter(Boolean)
      record({ _id: said.id, c: roomConv(key), f: said.from, fk: session.key, to: live.name, t: message, s: packStyle(said.style), at: said.time }, members)
      ack({ ok: true, id: said.id })
    })

    on("aim:chatInvite", (session, { room, to, message }, ack) => {
      const key = roomKey(clean(room, 32))
      if (!rooms.get(key)?.members.has(session.key)) return ack({ ok: false, error: "Join the room before inviting buddies." })
      const invited = []
      for (const name of (Array.isArray(to) ? to : []).slice(0, 20)) {
        const target = validate(name)
        const recipient = !target.error && sessions.get(target.key)
        if (!recipient || hidden(session, recipient)) continue
        emitTo(recipient.key, "aim:chatInvite", {
          room: rooms.get(key).name,
          from: session.user.screenName,
          message: clean(message, 256),
        })
        invited.push(recipient.user.screenName)
      }
      ack({ ok: true, invited })
    })
  })

  // HTTP APIs (mail, homepages) sign requests with the session's resume token
  const authenticate = (token) => {
    const key = tokens.get(String(token || ""))
    return (key && sessions.get(key)) || null
  }

  const aim = { store, sessions, authenticate, calls, together, push, eraser, history, media: imMedia }
  push?.useAim(aim)
  return aim
}

module.exports = { attachAim }
