// Network Neighborhood: every open 98ish desktop is a computer on the network. Signed-on
// 98 Messenger users show up under their screen name, everyone else as GUEST-XXXX.
// Computers can send each other files (documents, pictures, sounds: the receiver accepts or
// declines), WinPopup messages, and invitations to games (games.js).
//
// A computer is identified by a secret token the browser tab keeps, so a dropped
// connection that comes back within RESUME_GRACE_MS picks up where it left off (same name,
// same games). Everything here lives in memory.

const crypto = require("crypto")
const { limiter } = require("./limiter")
const { createGames } = require("./games")
const { createTetris } = require("./tetris")
const { createTetrisRanks } = require("./tetrisRanks")
const { createDoodle } = require("./doodle")
const { createQuizLive } = require("../quiz/live")
const { createCoop } = require("../town/coop")
const { createRooms } = require("../arcade/rooms")
const ROOM_GAMES = require("../arcade/games")
const { createPark } = require("../park")
const { createRoam } = require("../roam")
const { createBroadcasts } = require("../broadcast")
const { createLanParty } = require("../lanparty")

const RESUME_GRACE_MS = 30_000
const MAX_FILE_BYTES = 200 * 1024 // text documents
const MAX_DATA_BYTES = 1536 * 1024 // pictures and sounds (data URLs)
const MAX_PREVIEW_BYTES = 24 * 1024 // a picture's thumbnail, shown before accepting
const FILE_OFFER_MS = 2 * 60_000
const MAX_PENDING_BYTES = 16 * 1024 * 1024 // all waiting files together
const MAX_POPUP = 500
// What can be sent, by file type: text (cleaned of control characters) or a base64 data URL
// of an allowed kind
const FILE_TYPES = {
  text: { max: MAX_FILE_BYTES },
  note: { max: MAX_FILE_BYTES },
  richtext: { max: 512 * 1024 },
  image: { max: MAX_DATA_BYTES, data: /^data:image\/(png|jpeg|gif|webp|bmp);base64,/ },
  sound: { max: MAX_DATA_BYTES, data: /^data:audio\/(wav|x-wav|wave|webm|ogg|mpeg);base64,/ },
}
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/
const PREVIEW = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/

// A data URL of the right kind with real base64 after the comma
const validData = (content, kind) => {
  const head = kind.data.exec(content)
  return !!head && BASE64.test(content.slice(head[0].length))
}
const INVALID_NAME = /[\\/:"<>|\u0000-\u001F]/

const TOKEN = /^[a-f0-9]{32}$/

const clean = (text, max) => String(text ?? "").replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "").slice(0, max)
const newId = () => crypto.randomBytes(6).toString("hex")

const validFileName = (name) => {
  const value = String(name ?? "").trim()
  return value && value.length <= 64 && !INVALID_NAME.test(value) && value !== "." && value !== ".." ? value : null
}

const attachNet = (io, { aim: initialAim = null, graceMs = RESUME_GRACE_MS, games: gameOptions = {}, tetrisRanks = null, quiz: quizOptions = {}, coop: coopOptions = {}, rooms: roomsOptions = {}, park: parkOptions = {}, roam: roamOptions = null, broadcast: broadcastOptions = {} } = {}) => {
  let aim = initialAim
  const computers = new Map() // token -> computer
  const byPid = new Map() // pid -> computer
  const offers = new Map() // file offer id -> offer
  let pendingBytes = 0

  const fileLimit = limiter(6, 60_000)
  const popupLimit = limiter(10, 60_000)
  const inviteLimit = limiter(12, 60_000)
  const helloLimit = limiter(30, 60_000)

  // ---------- who is who ----------

  // The 98 Messenger session signed on through this computer's socket, if any
  const aimSessionOf = (computer) => {
    if (!aim || !computer.socket) return null
    const session = aim.sessions.get(computer.socket.data.key)
    return session && session.socket === computer.socket ? session : null
  }
  const nameOf = (computer) => aimSessionOf(computer)?.user.screenName || computer.guestName

  // Either side blocking the other in 98 Messenger keeps them apart here too
  const blocked = (a, b) => {
    const sa = aimSessionOf(a)
    const sb = aimSessionOf(b)
    return !!(sa && sb && (sa.user.blocked.includes(sb.key) || sb.user.blocked.includes(sa.key)))
  }

  const publicView = (computer) => {
    const session = aimSessionOf(computer)
    return {
      id: computer.pid,
      name: session?.user.screenName || computer.guestName,
      user: !!session,
      device: computer.device,
      busy: games.busy(computer.pid) || tetris.busy(computer.pid) || quiz.busy(computer.pid) || rooms.busy(computer.pid),
      since: computer.since,
    }
  }

  const listFor = (viewer) =>
    [...computers.values()]
      .filter((c) => c.socket && (c.visible || c === viewer) && (c === viewer || !blocked(c, viewer)))
      .map((c) => ({ ...publicView(c), me: c === viewer, hidden: !c.visible }))

  // Everyone's list, at most a few times a second
  let broadcastQueued = false
  const broadcast = () => {
    if (broadcastQueued) return
    broadcastQueued = true
    setTimeout(() => {
      broadcastQueued = false
      for (const c of computers.values()) if (c.socket) c.socket.emit("net:computers", listFor(c))
    }, 150)
  }

  const emitTo = (computer, event, payload) => computer?.socket?.emit(event, payload)
  const emitPid = (pid, event, payload) => emitTo(byPid.get(pid), event, payload)

  // Tetris Online (the Tetris app's multiplayer modes); invitations go through games.js
  const ranks = tetrisRanks || createTetrisRanks().catch(() => null)
  const tetris = createTetris({ emit: emitPid, ranks })
  // Doodle Together: shared drawing rooms
  const doodle = createDoodle({ emit: emitPid })
  // the Quiz Show's live games, invitations through games.js too
  const quiz = createQuizLive({ emit: emitPid, ...quizOptions })
  // Sunny Acres co-op towns (server/town/coop.js), invitations through games.js too
  const coop = createCoop({
    emit: emitPid,
    who: (pid) => {
      const c = byPid.get(pid)
      return c ? { pid, name: nameOf(c), key: aimSessionOf(c)?.key || null } : null
    },
    service: () => require("../town").townService(),
    ...coopOptions,
  })
  // Online rooms (server/arcade): Quick Match, join codes and seats for games built on the
  // shared room system; invitations into them go through games.js too
  const rooms = createRooms({
    games: ROOM_GAMES,
    emit: emitPid,
    emitVolatile: (pid, event, payload) => byPid.get(pid)?.socket?.volatile.emit(event, payload),
    blocked: (a, b) => {
      const ca = byPid.get(a)
      const cb = byPid.get(b)
      return !!(ca && cb && blocked(ca, cb))
    },
    ...roomsOptions,
  })
  const games = createGames({ emit: emitPid, tetris, doodle, quiz, coop, rooms, ...gameOptions })
  // My Park (Pickleball 98's walk-around park): who is where, the paddle racks, handing a court's
  // people into a Pickleball room (server/park)
  const park = createPark({
    emit: emitPid,
    emitVolatile: (pid, event, payload) => byPid.get(pid)?.socket?.volatile.emit(event, payload),
    rooms,
    // (doing things together in the park: never between people who block each other)
    blocked: (a, b) => {
      const ca = byPid.get(a)
      const cb = byPid.get(b)
      return !!(ca && cb && blocked(ca, cb))
    },
    ...parkOptions,
  })
  // Roam, the open world (Explore Valencia): who's where in town, cars, riding along (server/roam)
  const roam = createRoam({
    emit: emitPid,
    emitVolatile: (pid, event, payload) => byPid.get(pid)?.socket?.volatile.emit(event, payload),
    ...(roamOptions || { meterTotal: parkOptions.meterTotal, capBytes: parkOptions.capBytes }),
  })
  // Live Broadcast (Pickleball 98 > Real Games > Go Live): a real game's tracked data relayed
  // live to the host's buddies (server/broadcast)
  const liveCasts = createBroadcasts({
    emit: emitPid,
    emitVolatile: (pid, event, payload) => byPid.get(pid)?.socket?.volatile.emit(event, payload),
    aim: () => aim,
    ...broadcastOptions,
  })
  // LAN Party 98: the lobby for DOS LAN games (the game traffic itself goes phone to phone
  // over WebRTC; server/lanparty only passes the host's peer id and who's coming)
  const lanParty = createLanParty({ emit: emitPid, aim: () => aim })

  const guestName = () => {
    const taken = new Set([...computers.values()].map((c) => c.guestName))
    for (;;) {
      const name = `GUEST-${crypto.randomBytes(2).toString("hex").toUpperCase()}`
      if (!taken.has(name)) return name
    }
  }

  const removeComputer = (computer) => {
    if (computers.get(computer.token) !== computer) return
    clearTimeout(computer.dropTimer)
    computers.delete(computer.token)
    byPid.delete(computer.pid)
    for (const offer of [...offers.values()]) {
      if (offer.from === computer) endOffer(offer, "canceled")
      else if (offer.to === computer) endOffer(offer, "gone")
    }
    games.drop(computer.pid)
    tetris.drop(computer.pid)
    doodle.drop(computer.pid)
    quiz.drop(computer.pid)
    coop.drop(computer.pid)
    rooms.drop(computer.pid)
    park.drop(computer.pid)
    roam.drop(computer.pid)
    liveCasts.drop(computer.pid)
    lanParty.drop(computer.pid)
    broadcast()
  }

  // A computer someone wants to reach: { id } from the network list, or { screenName }
  // (from an Instant Message window)
  const findTarget = (from, to = {}) => {
    let target = null
    if (typeof to.id === "string") {
      target = byPid.get(to.id)
      if (target && !target.visible) target = null
    } else if (typeof to.screenName === "string") {
      const key = to.screenName.replace(/\s+/g, "").toLowerCase()
      target = [...computers.values()].find((c) => c.socket && aimSessionOf(c)?.key === key) || null
    }
    if (!target || !target.socket) return { error: "That computer isn't on the network right now." }
    if (target === from) return { error: "That's your own computer!" }
    if (blocked(from, target)) return { error: "That computer isn't on the network right now." }
    return { target }
  }

  // ---------- files ----------

  // status: accepted | declined | expired | canceled | gone
  const endOffer = (offer, status) => {
    if (!offers.has(offer.id)) return
    clearTimeout(offer.timer)
    offers.delete(offer.id)
    pendingBytes -= offer.size
    if (status !== "accepted") emitTo(offer.to, "net:fileGone", { id: offer.id })
    if (status !== "canceled") emitTo(offer.from, "net:fileResult", { id: offer.id, status, name: offer.name, to: nameOf(offer.to) })
  }

  io.on("connection", (socket) => {
    const current = () => {
      const c = computers.get(socket.data.netToken)
      return c && c.socket === socket ? c : null
    }

    // Handlers for a computer that has said hello; errors never crash the server
    const on = (event, handler) =>
      socket.on(event, (payload = {}, ack = () => {}) => {
        if (typeof ack !== "function") ack = () => {}
        const computer = current()
        if (!computer) return ack({ ok: false, error: "Not connected to the network." })
        try {
          ack(handler(computer, payload && typeof payload === "object" ? payload : {}) || { ok: true })
        } catch (error) {
          console.error(`[net] ${event} failed`, error)
          ack({ ok: false, error: "Something went wrong. Please try again." })
        }
      })

    // Join (or rejoin) the network. Also sent again after signing on or off 98 Messenger,
    // so the computer's name follows the screen name.
    socket.on("net:hello", (payload = {}, ack = () => {}) => {
      if (typeof ack !== "function") return
      if (helloLimit(socket.id)) return ack({ ok: false, error: "Too many requests." })
      let token = TOKEN.test(payload.token) ? payload.token : null
      let computer = token && computers.get(token)
      // Someone else is using this token (a duplicated browser tab): start fresh
      if (computer && computer.socket && computer.socket !== socket && computer.socket.connected) {
        computer = null
        token = null
      }
      if (!computer) {
        // A computer this socket was before (it asked to be someone new) leaves first
        const previous = current()
        if (previous) removeComputer(previous)
        token = token || crypto.randomBytes(16).toString("hex")
        computer = { token, pid: newId(), guestName: guestName(), visible: true, device: "pc", since: Date.now(), socket: null }
        computers.set(token, computer)
        byPid.set(computer.pid, computer)
      }
      const resumed = !!computer.socket || !!computer.dropTimer
      clearTimeout(computer.dropTimer)
      computer.dropTimer = null
      if (computer.socket && computer.socket !== socket) computer.socket.leave("net")
      computer.socket = socket
      computer.visible = payload.visible !== false
      computer.device = payload.device === "phone" ? "phone" : "pc"
      socket.data.netToken = token
      socket.join("net")
      ack({ ok: true, token, me: { ...publicView(computer), hidden: !computer.visible }, computers: listFor(computer) })
      if (resumed) {
        games.setAway(computer.pid, false)
        tetris.setAway(computer.pid, false)
        doodle.setAway(computer.pid, false)
        quiz.setAway(computer.pid, false)
        rooms.setAway(computer.pid, false)
      }
      games.resync(computer.pid)
      for (const offer of offers.values()) if (offer.to === computer) emitTo(computer, "net:fileOffer", offerView(offer))
      broadcast()
    })

    socket.on("disconnect", () => {
      const computer = current()
      if (!computer) return
      computer.socket = null
      games.setAway(computer.pid, true)
      tetris.setAway(computer.pid, true)
      doodle.setAway(computer.pid, true)
      quiz.setAway(computer.pid, true)
      rooms.setAway(computer.pid, true)
      computer.dropTimer = setTimeout(() => removeComputer(computer), graceMs)
      broadcast()
    })

    on("net:visible", (computer, { visible }) => {
      computer.visible = !!visible
      broadcast()
      return { ok: true, visible: computer.visible }
    })

    on("net:list", (computer) => ({ ok: true, computers: listFor(computer) }))

    // ---- files ----

    on("net:sendFile", (computer, { to, name, content, type, preview }) => {
      const found = findTarget(computer, to)
      if (found.error) return { ok: false, error: found.error }
      const fileName = validFileName(name)
      if (!fileName) return { ok: false, error: "That file name isn't allowed." }
      if (typeof content !== "string") return { ok: false, error: "Only files can be sent." }
      const kind = Object.hasOwn(FILE_TYPES, type) ? FILE_TYPES[type] : null
      if (!kind) return { ok: false, error: "That kind of file can't be sent. Try a document, a picture or a sound." }
      const size = Buffer.byteLength(content, "utf8")
      if (size > kind.max) return { ok: false, error: `That file is too big to send. ${kind.data ? "Pictures and sounds" : "Documents"} can be at most ${kind.max >= 1024 * 1024 ? `${(kind.max / 1024 / 1024).toFixed(1)} MB` : `${kind.max / 1024} KB`}.` }
      if (kind.data && !validData(content, kind)) return { ok: false, error: "That file looks damaged, so it wasn't sent." }
      if ([...offers.values()].filter((o) => o.to === found.target).length >= 5) return { ok: false, error: `${nameOf(found.target)} has too many files waiting. Try again later.` }
      if (pendingBytes + size > MAX_PENDING_BYTES) return { ok: false, error: "The network is busy. Try again in a minute." }
      if (fileLimit(computer.pid)) return { ok: false, error: "You're sending files too fast. Wait a minute and try again." }
      const body = kind.data ? content : clean(content, kind.max).replace(/\r\n?/g, "\n")
      // a picture may come with a small thumbnail for the Accept/Decline box
      const thumb = type === "image" && typeof preview === "string" && preview.length <= MAX_PREVIEW_BYTES && PREVIEW.test(preview) ? preview : null
      const offer = { id: newId(), from: computer, to: found.target, name: fileName, content: body, type, size, preview: thumb }
      offer.expiresAt = Date.now() + FILE_OFFER_MS
      offer.timer = setTimeout(() => endOffer(offer, "expired"), FILE_OFFER_MS)
      offers.set(offer.id, offer)
      pendingBytes += size
      emitTo(found.target, "net:fileOffer", offerView(offer))
      return { ok: true, id: offer.id, to: nameOf(found.target) }
    })

    on("net:fileReply", (computer, { id, accept }) => {
      const offer = offers.get(String(id))
      if (!offer || offer.to !== computer) return { ok: false, error: "That file is no longer available." }
      const file = { name: offer.name, type: offer.type, content: offer.content, from: nameOf(offer.from) }
      endOffer(offer, accept ? "accepted" : "declined")
      return accept ? { ok: true, file } : { ok: true }
    })

    on("net:fileCancel", (computer, { id }) => {
      const offer = offers.get(String(id))
      if (offer && offer.from === computer) endOffer(offer, "canceled")
      return { ok: true }
    })

    // ---- WinPopup ----

    on("net:popup", (computer, { to, text }) => {
      const found = findTarget(computer, to)
      if (found.error) return { ok: false, error: found.error }
      const message = clean(text, MAX_POPUP + 1).replace(/\r\n?/g, "\n").trim()
      if (!message) return { ok: false, error: "Type a message first." }
      if (message.length > MAX_POPUP) return { ok: false, error: `Messages can be at most ${MAX_POPUP} characters.` }
      if (popupLimit(computer.pid)) return { ok: false, error: "You're sending messages too fast. Slow down!" }
      emitTo(found.target, "net:popup", { from: nameOf(computer), fromId: computer.pid, to: nameOf(found.target), text: message, time: Date.now() })
      return { ok: true, to: nameOf(found.target) }
    })

    // ---- games ----

    on("net:invite", (computer, { to, game, options, matchId }) => {
      const found = findTarget(computer, to)
      if (found.error) return { ok: false, error: found.error }
      if (inviteLimit(computer.pid)) return { ok: false, error: "You're sending invitations too fast. Wait a minute." }
      const result = games.invite({ from: computer.pid, fromName: nameOf(computer), to: found.target.pid, toName: nameOf(found.target), game, options: options || {}, matchId })
      // their 98ish in the background: a notification too (Web Push, ../push)
      const targetSession = result.ok && aimSessionOf(found.target)
      if (targetSession && aim?.push) {
        aim.push
          .notify(targetSession.key, "games", {
            title: `${nameOf(computer)} invited you to play`,
            body: `${result.gameName || "A game"} on 98ish. Open 98ish to accept.`,
            tag: `invite-${computer.pid}`,
            key: `invite:${result.inviteId}`,
            app: "games",
            url: "/?open=invites",
          }, { ttl: 60_000 })
          .catch(() => {})
      }
      return result.ok ? { ...result, to: nameOf(found.target) } : result
    })
    on("net:inviteReply", (computer, { id, accept }) => games.replyInvite(computer.pid, String(id), !!accept))
    on("net:inviteCancel", (computer, { id }) => games.cancelInvite(computer.pid, String(id)))
    on("net:checkersMove", (computer, { matchId, path }) => games.checkersMove(computer.pid, String(matchId), path))
    on("net:gameMove", (computer, { matchId, move }) => games.gameMove(computer.pid, String(matchId), move))
    on("net:raceProgress", (computer, { matchId, ...progress }) => games.raceProgressUpdate(computer.pid, String(matchId), progress))
    on("net:resign", (computer, { matchId }) => games.resign(computer.pid, String(matchId)))
    on("net:draw", (computer, { matchId, action }) => games.draw(computer.pid, String(matchId), action))
    on("net:rematch", (computer, { matchId }) => games.rematch(computer.pid, String(matchId)))
    on("net:heartsCreate", (computer) => games.createTable(computer.pid, nameOf(computer)))
    on("net:heartsStart", (computer, { matchId }) => games.startTable(computer.pid, String(matchId)))
    on("net:heartsPass", (computer, { matchId, cards }) => games.heartsPass(computer.pid, String(matchId), cards))
    on("net:heartsPlay", (computer, { matchId, card }) => games.heartsPlay(computer.pid, String(matchId), card))
    // ---- Tetris Online ----
    tetris.wire(socket, current, (computer) => ({ pid: computer.pid, name: nameOf(computer), key: aimSessionOf(computer)?.key || null }))
    // ---- Doodle Together ----
    doodle.wire(socket, current, (computer) => ({ pid: computer.pid, name: nameOf(computer) }))
    // ---- Quiz Show ----
    quiz.wire(socket, current, (computer) => ({ pid: computer.pid, name: nameOf(computer), key: aimSessionOf(computer)?.key || null }))
    // ---- Sunny Acres co-op ----
    coop.wire(socket, current, (computer) => ({ pid: computer.pid, name: nameOf(computer), key: aimSessionOf(computer)?.key || null }))
    // ---- online rooms (server/arcade) ----
    rooms.wire(socket, current, (computer) => ({ pid: computer.pid, name: nameOf(computer), key: aimSessionOf(computer)?.key || null }))
    // ---- My Park (server/park) ----
    park.wire(socket, current, (computer) => ({ pid: computer.pid, name: nameOf(computer), key: aimSessionOf(computer)?.key || null }))
    roam.wire(socket, current, (computer) => ({ pid: computer.pid, name: nameOf(computer), key: aimSessionOf(computer)?.key || null }))
    // ---- Live Broadcast (server/broadcast) ----
    liveCasts.wire(socket, current, (computer) => ({ pid: computer.pid, name: nameOf(computer), key: aimSessionOf(computer)?.key || null }))
    // ---- LAN Party 98 (server/lanparty) ----
    lanParty.wire(socket, current, (computer) => ({ pid: computer.pid, name: nameOf(computer), key: aimSessionOf(computer)?.key || null }))

    on("net:leave", (computer, { matchId }) => {
      const result = games.leave(computer.pid, String(matchId))
      broadcast()
      return result
    })
  })

  const offerView = (offer) => ({ id: offer.id, from: nameOf(offer.from), fromId: offer.from.pid, name: offer.name, size: offer.size, type: offer.type, preview: offer.preview, expiresAt: offer.expiresAt })

  // Names change as people sign on and off 98 Messenger (even from another window), and
  // "busy" flags as games start and end: look every few seconds
  setInterval(() => {
    let changed = false
    for (const c of computers.values()) {
      const signature = `${nameOf(c)} ${games.busy(c.pid) || tetris.busy(c.pid) || quiz.busy(c.pid) || rooms.busy(c.pid)}`
      if (signature !== c.signature) changed = true
      c.signature = signature
    }
    if (changed) broadcast()
  }, 3000).unref?.()

  return {
    useAim: (value) => {
      aim = value
      broadcast()
    },
    computers,
    games,
    // who a socket is on the network ({ pid, name }), for game chat
    whoIs: (socket) => {
      const c = computers.get(socket.data.netToken)
      return c && c.socket === socket ? { pid: c.pid, name: nameOf(c) } : null
    },
    // either side blocks the other in 98 Messenger
    blockedPids: (a, b) => {
      const ca = byPid.get(a)
      const cb = byPid.get(b)
      return !!(ca && cb && blocked(ca, cb))
    },
    tetris,
    doodle,
    quiz,
    coop,
    rooms,
    park,
    liveCasts,
    // Delete My Account (../account): Tetris Online ranks, and their place in co-op towns
    eraseAccount: async (ctx) => {
      const store = await ranks
      const removed = store?.remove ? await store.remove(ctx.key) : false
      const towns = await coop.eraseAccount(ctx)
      return { ranks: !!removed, towns }
    },
  }
}

module.exports = { attachNet, MAX_FILE_BYTES, MAX_DATA_BYTES, FILE_TYPES }
