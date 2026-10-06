// Come Over: the multiplayer desktop. Up to 4 people "hang out" on each other's 98ish: they
// see each other's cursors (and taps on phones), which window each one is using, can visit
// each other's desktop, follow someone's view, hand each other files, and share documents
// (./ydocs.js) that everyone edits at once. Nothing here is saved: a hangout lives in memory
// while people are in it.
//
// client -> server (acked with { ok, ... } unless noted)
//   hg:invite { to }          -> { ok, state }   starts your hangout if you have none
//   hg:join { id }            -> { ok, state }   only people who were invited
//   hg:leave {}               (the host leaving ends it)
//   hg:p { x, y, t?, f? }     (no ack) cursor at x,y (0..1 of the screen), t: a tap, f: the
//                             focused window's program and title (only when it changes)
//   hg:desk { snap }          your desktop as visitors see it (wallpaper, icons, windows)
//   hg:perm { touch }         visitors may (or may not) open things on your desktop
//   hg:act { to, act }        a visitor's action on someone's desktop (needs their "touch")
//   hg:watch { key | null }   follow someone's view (or stop)
//   hg:view { app, doc?, scroll?, title? }  (no ack) what you're looking at, for followers
//   hg:give { to, file: { name, type, data } }  hand someone a file (a data URL / text)
//   hg:doc { id }             tell the hangout about a document shared with it
// server -> client
//   hg:invite { id, from }   hg:state { ...state }   hg:p { k, x, y, t?, f? }
//   hg:desk { k, snap }   hg:act { from, act }   hg:view { k, ... }   hg:gift { from, file }
//   hg:doc { id, from, meta }   hg:end { reason }
//
// Privacy: private programs (Messenger, Mail, Notes, Passwords, Photos...) never show in a
// visit or a follow, here as well as on the device (PRIVATE_APPS, kept in step with the
// client's hangoutCore.js).

const crypto = require("crypto")
const { normalize } = require("./screenNames")

const MAX_PEOPLE = 4
const MAX_HANGOUTS = 200
const LOST_MS = 30_000 // a dropped connection (a phone asleep) keeps its place this long
const INVITES_PER_MINUTE = 8
const PRESENCE_PER_SECOND = 25 // the client sends ~15/s; a little slack
const VIEWS_PER_10S = 50
const DESKS_PER_10S = 12
const ACTS_PER_10S = 20
const GIFTS_PER_10MIN = 20
const GIFT_BYTES_PER_HOUR = 12 * 1024 * 1024
const MAX_GIFT = 1.5 * 1024 * 1024
const MAX_SNAPSHOT = 12 * 1024
const MAX_TEXT = 120

// programs that never appear in someone else's view (titles hidden, follow refused)
const PRIVATE_APPS = new Set(["aim", "aim-im", "aim-info", "aim-chat", "aim-delete", "chat", "mail", "notes", "tasks", "passwords", "photos", "camera", "addressbook", "locator", "backup", "control", "controlpanel", "lock", "users", "together", "us", "loveletters", "ourstory", "pet", "dollhouse"])
// default-deny: no program id (98 Messenger's Buddy List), any aim-* window, or the list
const isPrivate = (app) => !app || app.startsWith("aim") || PRIVATE_APPS.has(app)
// programs a follower's screen may open to mirror the leader
const FOLLOW_APPS = new Set(["notepad", "paint", "wordpad", "internetexplorer", "compass", "help", "calculator", "fileexplorer", "mediaplayer", "music", "weather", "calendar", "minesweeper", "solitaire", "freecell", "pickleball", "hangout"])

const clean = (v, max = MAX_TEXT) =>
  String(v ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .trim()
    .slice(0, max)
const unit = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(Math.min(1, Math.max(0, n)) * 1000) / 1000 : null
}

const createHangout = ({ sessions, hidden, emitTo, limiter, pushTo = null, ydocs = null, now = () => Date.now(), lostMs = LOST_MS }) => {
  const live = new Map() // id -> hangout
  const of = new Map() // key -> hangout id (each person is in at most one)
  const inviteLimited = limiter(INVITES_PER_MINUTE, 60_000)
  const presenceLimited = limiter(PRESENCE_PER_SECOND, 1000)
  const viewLimited = limiter(VIEWS_PER_10S, 10_000)
  const deskLimited = limiter(DESKS_PER_10S, 10_000)
  const actLimited = limiter(ACTS_PER_10S, 10_000)
  const giftLimited = limiter(GIFTS_PER_10MIN, 600_000)
  const giftBytes = new Map() // key -> [{ at, n }]

  const nameOf = (key) => sessions.get(key)?.user.screenName || key
  const COLORS = ["#d00000", "#0050d0", "#008000", "#b05000", "#8000a0", "#007070"]

  const view = (h) => ({
    id: h.id,
    host: nameOf(h.host),
    hostKey: h.host,
    people: [...h.joined.keys()].map((k) => ({ key: k, name: nameOf(k), color: h.colors.get(k), away: !!h.joined.get(k).lostTimer, touch: !!h.touch.get(k), watching: h.watching.get(k) || null })),
    invited: [...h.invited].filter((k) => !h.joined.has(k)).map((k) => ({ key: k, name: nameOf(k) })),
    docs: [...h.docs],
  })

  const others = (h, key) => [...h.joined.keys()].filter((k) => k !== key)
  const send = (h, key, event, payload) => {
    const a = sessions.get(key)
    for (const k of others(h, key)) {
      const b = sessions.get(k)
      if (a && b && hidden(a, b)) continue
      emitTo(k, event, payload)
    }
  }
  const changed = (h) => {
    const v = view(h)
    for (const k of h.joined.keys()) emitTo(k, "hg:state", v)
  }

  const end = (h, reason) => {
    if (live.get(h.id) !== h) return
    for (const [k, entry] of h.joined) {
      clearTimeout(entry.lostTimer)
      if (of.get(k) === h.id) of.delete(k)
      emitTo(k, "hg:end", { reason })
    }
    live.delete(h.id)
  }

  const leave = (key, reason = "left") => {
    const h = live.get(of.get(key))
    if (!h) return
    if (h.host === key) return end(h, reason === "left" ? "host-left" : reason)
    clearTimeout(h.joined.get(key)?.lostTimer)
    h.joined.delete(key)
    h.touch.delete(key)
    h.desks.delete(key)
    h.watching.delete(key)
    for (const [k, v] of h.watching) if (v === key) h.watching.set(k, null)
    of.delete(key)
    emitTo(key, "hg:end", { reason })
    if (h.joined.size <= 1 && !h.invited.size) return end(h, "alone")
    changed(h)
  }

  const enter = (h, key) => {
    const prev = live.get(of.get(key))
    if (prev && prev !== h) leave(key, "switched")
    if (!h.joined.has(key)) h.joined.set(key, { since: now(), lostTimer: null })
    h.invited.delete(key)
    if (!h.colors.has(key)) h.colors.set(key, COLORS[h.colorSeq++ % COLORS.length])
    of.set(key, h.id)
  }

  const bind = (on) => {
    on("hg:invite", (session, { to }, ack) => {
      const key = normalize(String(to || ""))
      const target = sessions.get(key)
      if (!key || key === session.key) return ack({ ok: false, error: "Pick a buddy to invite." })
      if (!target || hidden(session, target)) return ack({ ok: false, error: `${clean(to, 40) || "They"} isn't signed on right now.` })
      if (inviteLimited(session.key)) return ack({ ok: false, error: "That's a lot of invitations. Try again in a minute." })
      let h = live.get(of.get(session.key))
      if (!h) {
        if (live.size >= MAX_HANGOUTS) return ack({ ok: false, error: "Come Over is busy right now. Try again in a few minutes." })
        h = { id: crypto.randomBytes(8).toString("hex"), host: session.key, joined: new Map(), invited: new Set(), colors: new Map(), colorSeq: 0, touch: new Map(), desks: new Map(), watching: new Map(), docs: new Set(), createdAt: now() }
        live.set(h.id, h)
        enter(h, session.key)
      }
      if (h.joined.has(key)) return ack({ ok: true, state: view(h) })
      if (h.joined.size + h.invited.size >= MAX_PEOPLE) return ack({ ok: false, error: `Come Over fits ${MAX_PEOPLE} people.` })
      h.invited.add(key)
      emitTo(key, "hg:invite", { id: h.id, from: session.user.screenName })
      if (pushTo && !target.visible)
        pushTo(key, "im", { title: `${session.user.screenName} wants you to come over`, body: "Tap to open 98ish and join them on their desktop.", tag: `hg-${h.id}`, key: `hg:${h.id}:${key}`, app: "hangout", url: `/?open=program&name=${encodeURIComponent("Come Over")}&hangout=${h.id}` })
      changed(h)
      ack({ ok: true, state: view(h) })
    })

    on("hg:join", (session, { id }, ack) => {
      const h = live.get(String(id))
      if (!h) return ack({ ok: false, error: "That hangout has ended.", ended: true })
      if (!h.invited.has(session.key) && !h.joined.has(session.key)) return ack({ ok: false, error: "You weren't invited to that one." })
      const host = sessions.get(h.host)
      if (host && hidden(session, host)) return ack({ ok: false, error: "That hangout has ended.", ended: true })
      if (!h.joined.has(session.key) && h.joined.size >= MAX_PEOPLE) return ack({ ok: false, error: `Come Over fits ${MAX_PEOPLE} people.` })
      enter(h, session.key)
      changed(h)
      // what the others' desktops look like right now, and the documents shared here
      const desks = [...h.desks].filter(([k]) => k !== session.key).map(([k, snap]) => ({ k, snap }))
      ack({ ok: true, state: view(h), desks })
    })

    on("hg:decline", (session, { id }, ack) => {
      const h = live.get(String(id))
      if (h && h.invited.delete(session.key)) {
        if (h.joined.size <= 1 && !h.invited.size) end(h, "declined")
        else changed(h)
      }
      ack({ ok: true })
    })

    on("hg:leave", (session, payload, ack) => {
      leave(session.key)
      ack({ ok: true })
    })

    on("hg:p", (session, { x, y, t, f }) => {
      const h = live.get(of.get(session.key))
      if (!h || presenceLimited(session.key)) return
      const px = unit(x)
      const py = unit(y)
      if (px == null || py == null) return
      const msg = { k: session.key, x: px, y: py }
      if (t) msg.t = 1
      if (f && typeof f === "object") {
        const app = clean(f.app, 30).toLowerCase()
        msg.f = isPrivate(app) ? { app: "private", title: "" } : { app, title: clean(f.title, 60) }
      } else if (f === null) msg.f = null
      send(h, session.key, "hg:p", msg)
    })

    on("hg:desk", (session, { snap }, ack) => {
      const h = live.get(of.get(session.key))
      if (!h) return ack({ ok: false })
      if (deskLimited(session.key)) return ack({ ok: false, retry: true })
      const text = JSON.stringify(snap ?? null)
      if (!snap || text.length > MAX_SNAPSHOT) return ack({ ok: false, error: "Too big." })
      const safe = sanitizeSnapshot(snap)
      h.desks.set(session.key, safe)
      send(h, session.key, "hg:desk", { k: session.key, snap: safe })
      ack({ ok: true })
    })

    on("hg:perm", (session, { touch }, ack) => {
      const h = live.get(of.get(session.key))
      if (!h) return ack({ ok: false })
      h.touch.set(session.key, !!touch)
      changed(h)
      ack({ ok: true })
    })

    on("hg:act", (session, { to, act }, ack) => {
      const h = live.get(of.get(session.key))
      const key = normalize(String(to || ""))
      if (!h || !h.joined.has(key) || key === session.key) return ack({ ok: false })
      if (!h.touch.get(key)) return ack({ ok: false, error: `${nameOf(key)} hasn't said you can touch their desktop.` })
      if (actLimited(session.key)) return ack({ ok: false, retry: true })
      const type = clean(act?.type, 20)
      if (!["open", "focus", "minimize", "close"].includes(type)) return ack({ ok: false })
      const clean2 = { type, program: clean(act.program, 40), index: Number.isInteger(act.index) ? act.index : undefined }
      emitTo(key, "hg:act", { from: session.user.screenName, fromKey: session.key, act: clean2 })
      ack({ ok: true })
    })

    on("hg:watch", (session, { key }, ack) => {
      const h = live.get(of.get(session.key))
      if (!h) return ack({ ok: false })
      const k = key ? normalize(String(key)) : null
      if (k && (!h.joined.has(k) || k === session.key)) return ack({ ok: false })
      h.watching.set(session.key, k)
      changed(h)
      ack({ ok: true })
    })

    on("hg:view", (session, v) => {
      const h = live.get(of.get(session.key))
      if (!h || viewLimited(session.key)) return
      const app = clean(v?.app, 30).toLowerCase()
      // a private program: followers see a "private" card, never what's in it
      const msg = FOLLOW_APPS.has(app) ? { k: session.key, app, doc: v.doc ? clean(v.doc, 40) : undefined, title: clean(v.title, 80), scroll: unit(v.scroll) ?? undefined, url: app === "internetexplorer" || app === "compass" ? clean(v.url, 300) : undefined } : { k: session.key, app: "private" }
      for (const [k, leader] of h.watching) if (leader === session.key && k !== session.key) emitTo(k, "hg:view", msg)
    })

    on("hg:give", (session, { to, file }, ack) => {
      const h = live.get(of.get(session.key))
      const key = normalize(String(to || ""))
      if (!h || !h.joined.has(key) || key === session.key) return ack({ ok: false, error: "They aren't here right now." })
      const name = clean(file?.name, 80)
      const type = clean(file?.type, 30)
      const data = typeof file?.data === "string" ? file.data : null
      if (!name || !data) return ack({ ok: false, error: "That file couldn't be sent." })
      if (data.length > MAX_GIFT) return ack({ ok: false, error: "That file is too big to hand over (1.5 MB at most). Put it in the shared folder instead." })
      if (giftLimited(session.key)) return ack({ ok: false, error: "That's a lot of files. Try again in a few minutes." })
      const list = (giftBytes.get(session.key) || []).filter((g) => now() - g.at < 3600_000)
      const sum = list.reduce((n, g) => n + g.n, 0)
      if (sum + data.length > GIFT_BYTES_PER_HOUR) return ack({ ok: false, error: "You've handed over a lot this hour. Try again later." })
      list.push({ at: now(), n: data.length })
      giftBytes.set(session.key, list)
      const a = sessions.get(key)
      if (a && hidden(session, a)) return ack({ ok: false, error: "They aren't here right now." })
      emitTo(key, "hg:gift", { from: session.user.screenName, fromKey: session.key, file: { name, type, data } })
      ack({ ok: true })
    })

    on("hg:doc", async (session, { id }, ack) => {
      const h = live.get(of.get(session.key))
      if (!h || !ydocs) return ack({ ok: false })
      const docId = clean(id, 40)
      const people = [...h.joined.keys()].filter((k) => k !== session.key).map((k) => ({ key: k, name: nameOf(k) }))
      const meta = await ydocs.addMembers(docId, people)
      if (!meta || !meta.members.some((m) => m.key === session.key)) return ack({ ok: false, error: "That document isn't yours to share." })
      h.docs.add(docId)
      send(h, session.key, "hg:doc", { id: docId, from: session.user.screenName, meta })
      changed(h)
      ack({ ok: true, meta })
    })
  }

  // a dropped connection keeps its place for a while (a phone going to sleep)
  const dropped = (key) => {
    const h = live.get(of.get(key))
    const entry = h?.joined.get(key)
    if (!entry) return
    clearTimeout(entry.lostTimer)
    entry.lostTimer = setTimeout(() => leave(key, "lost"), lostMs)
    entry.lostTimer.unref?.()
    changed(h)
  }
  const resumed = (session) => {
    const h = live.get(of.get(session.key))
    const entry = h?.joined.get(session.key)
    if (!entry) return
    clearTimeout(entry.lostTimer)
    entry.lostTimer = null
    emitTo(session.key, "hg:state", view(h))
    changed(h)
  }
  const blocked = (a, b) => {
    const h = live.get(of.get(a))
    if (h && h === live.get(of.get(b))) leave(h.host === a ? b : a, "blocked")
  }
  const close = () => {
    for (const h of [...live.values()]) end(h, "server")
  }

  return { bind, leave, dropped, resumed, blocked, close, live, of }
}

// a desktop as others may see it: wallpaper, icons and windows; private programs keep no title
const sanitizeSnapshot = (snap) => {
  const wall = snap.wallpaper && typeof snap.wallpaper === "object" ? { color: clean(snap.wallpaper.color, 20), image: /^\/[\w./-]{1,120}$/.test(snap.wallpaper.image || "") ? snap.wallpaper.image : "", mode: clean(snap.wallpaper.mode, 10) } : { color: "#008080" }
  const icons = (Array.isArray(snap.icons) ? snap.icons : []).slice(0, 40).map((i) => ({ name: clean(i?.name, 40), icon: /^\/[\w./-]{1,120}$/.test(i?.icon || "") ? i.icon : "", program: clean(i?.program, 40) }))
  const windows = (Array.isArray(snap.windows) ? snap.windows : []).slice(0, 16).map((w) => {
    const app = clean(w?.app, 30).toLowerCase()
    const priv = isPrivate(app)
    const n = (v) => unit(v) ?? 0
    return { app: priv ? "private" : app, title: priv ? "Private window" : clean(w?.title, 60), icon: priv ? "" : /^\/[\w./-]{1,120}$/.test(w?.icon || "") ? w.icon : "", x: n(w?.x), y: n(w?.y), w: n(w?.w), h: n(w?.h), min: !!w?.min, active: !!w?.active }
  })
  return { wallpaper: wall, icons, windows, mobile: !!snap.mobile, at: Date.now() }
}

module.exports = { createHangout, PRIVATE_APPS, FOLLOW_APPS, sanitizeSnapshot, MAX_PEOPLE }
