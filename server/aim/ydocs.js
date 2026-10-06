// The relay for shared documents (Come Over: a Notepad text, a Paint canvas, the Shared with
// Friends folder). Each is a Yjs document. Clients exchange Yjs updates through here; the
// server merges them into its own copy (so it can catch up anyone who opens it later, or
// comes back from being offline) and saves that a moment after the last change.
//
// Sync, per document (all binary as base64):
//   yd:open { id, sv }   -> { ok, meta, update, sv }   update = what the client is missing
//                         (from its state vector sv); sv = the server's state vector, so the
//                         client sends back what the server is missing with yd:up
//   yd:up { id, u }      -> { ok }   an update; relayed as yd:up { id, u, k } to the others
//   yd:aw { id, a }      (no ack) where someone's cursor/selection is: relayed as yd:aw { id, k, a }
//   yd:close { id }
//   yd:create { kind, title, with: [screen names] } -> { ok, id, meta }
//   yd:share { id, with: [screen names] } -> { ok, meta }   any member adds people
//   yd:list {}           -> { ok, docs: [meta] }
//   yd:delete { id }     owner only; others: leave it
// server -> client: yd:up, yd:aw, yd:meta { id, meta } (members changed), yd:gone { id }
//
// Who: only a document's members (and never anyone blocked either way at the moment). Caps
// keep MongoDB's free 512 MB safe: per document (by kind), per owner, and server-wide.

const crypto = require("crypto")
const Y = require("yjs")
const { normalize } = require("./screenNames")

const KIND_CAP = { text: 512 * 1024, paint: 3 * 1024 * 1024, folder: 6 * 1024 * 1024 }
const KINDS = Object.keys(KIND_CAP)
const MAX_UPDATE = 1536 * 1024 // one update (a Paint stroke patch, a file in the folder)
const MAX_AWARE = 2048
const MAX_MEMBERS = 8
const MAX_TITLE = 80
const DOCS_PER_OWNER = Number(process.env.YDOC_PER_OWNER) || 40
const BYTES_PER_OWNER = (Number(process.env.YDOC_OWNER_MB) || 12) * 1024 * 1024
const TOTAL_BYTES = (Number(process.env.YDOC_TOTAL_MB) || 80) * 1024 * 1024
const SAVE_MS = 2000
const UNLOAD_MS = 120_000
const UPDATES_PER_10S = 80
const AWARE_PER_10S = 120
const CREATES_PER_MINUTE = 10

const b64 = (u8) => Buffer.from(u8).toString("base64")
const unb64 = (s) => {
  if (typeof s !== "string" || s.length > MAX_UPDATE * 1.4) return null
  try {
    return new Uint8Array(Buffer.from(s, "base64"))
  } catch {
    return null
  }
}
const cleanTitle = (t) =>
  String(t ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .trim()
    .slice(0, MAX_TITLE)

const createYdocs = ({ store, sessions, hidden, emitTo, limiter, findUser = null, now = () => Date.now(), saveMs = SAVE_MS, unloadMs = UNLOAD_MS, caps = {} }) => {
  const kindCap = { ...KIND_CAP, ...(caps.kind || {}) }
  const perOwnerBytes = caps.ownerBytes ?? BYTES_PER_OWNER
  const perOwnerDocs = caps.ownerDocs ?? DOCS_PER_OWNER
  const totalCap = caps.totalBytes ?? TOTAL_BYTES
  const upLimited = limiter(UPDATES_PER_10S, 10_000)
  const awLimited = limiter(AWARE_PER_10S, 10_000)
  const createLimited = limiter(CREATES_PER_MINUTE, 60_000)
  const live = new Map() // id -> { doc, ydoc, open: Set<key>, size, saveTimer, unloadTimer, dirty }
  let totalBytes = null // cached; refreshed after saves

  const ready = Promise.resolve(store)
  const s = () => ready

  const meta = (d) => ({ id: d.id, kind: d.kind, title: d.title, owner: d.names?.[d.owner] || d.owner, ownerKey: d.owner, members: d.members.map((k) => ({ key: k, name: d.names?.[k] || k })), size: d.size, changedAt: d.changedAt })

  const total = async () => {
    if (totalBytes == null) totalBytes = await (await s()).totalBytes()
    return totalBytes
  }

  // the people a name list means: signed on or registered, and not blocked either way
  const resolveNames = async (session, names) => {
    const out = []
    for (const name of Array.isArray(names) ? names.slice(0, MAX_MEMBERS) : []) {
      const key = normalize(String(name || ""))
      if (!key || key === session.key) continue
      const other = sessions.get(key)
      if (other) {
        if (hidden(session, other)) continue
        out.push({ key, name: other.user.screenName })
      } else if (findUser) {
        const user = await findUser(key)
        if (user && !(user.blocked || []).includes(session.key) && !session.user.blocked.includes(key)) out.push({ key, name: user.screenName })
      }
    }
    return out
  }

  const mayUse = (session, d) => {
    if (!d || !d.members.includes(session.key)) return false
    // someone they've blocked (or who blocked them) owning it doesn't lock them out: only
    // relays between hidden people are skipped (see relay)
    return true
  }

  const relay = (entry, fromKey, event, payload) => {
    const from = sessions.get(fromKey)
    for (const key of entry.open) {
      if (key === fromKey) continue
      const other = sessions.get(key)
      if (from && other && hidden(from, other)) continue
      emitTo(key, event, payload)
    }
  }

  const load = async (id) => {
    let entry = live.get(id)
    if (entry) return entry
    const d = await (await s()).get(id)
    if (!d) return null
    entry = live.get(id) // loaded meanwhile
    if (entry) return entry
    const ydoc = new Y.Doc()
    if (d.state) {
      const u = unb64(d.state)
      if (u) Y.applyUpdate(ydoc, u)
    }
    entry = { doc: { ...d, state: undefined }, ydoc, open: new Set(), size: d.size || 0, saveTimer: null, unloadTimer: null, dirty: false }
    live.set(id, entry)
    return entry
  }

  const save = async (entry) => {
    clearTimeout(entry.saveTimer)
    entry.saveTimer = null
    if (!entry.dirty) return
    entry.dirty = false
    const state = Y.encodeStateAsUpdate(entry.ydoc)
    const before = entry.size
    entry.size = state.length
    entry.doc.size = state.length
    entry.doc.changedAt = now()
    try {
      await (await s()).update(entry.doc.id, { state: b64(state), size: state.length, changedAt: entry.doc.changedAt })
      if (totalBytes != null) totalBytes += state.length - before
    } catch (error) {
      console.error("[come over] saving a shared document failed", error?.message)
      entry.dirty = true
    }
  }
  const saveSoon = (entry) => {
    entry.dirty = true
    if (!entry.saveTimer) {
      entry.saveTimer = setTimeout(() => save(entry), saveMs)
      entry.saveTimer.unref?.()
    }
  }
  const unloadSoon = (entry) => {
    clearTimeout(entry.unloadTimer)
    if (entry.open.size) return
    entry.unloadTimer = setTimeout(async () => {
      if (entry.open.size) return
      await save(entry)
      if (!entry.open.size && live.get(entry.doc.id) === entry) {
        live.delete(entry.doc.id)
        entry.ydoc.destroy()
      }
    }, unloadMs)
    entry.unloadTimer.unref?.()
  }

  const closeFor = (key, id) => {
    const entry = live.get(id)
    if (!entry || !entry.open.delete(key)) return
    relay(entry, key, "yd:aw", { id, k: key, a: null })
    unloadSoon(entry)
  }

  // ---- for other modules (Come Over shares a document with the people in a hangout) ----
  const addMembers = async (id, people) => {
    const entry = live.get(id)
    const d = entry ? entry.doc : await (await s()).get(id)
    if (!d) return null
    const members = [...d.members]
    const names = { ...d.names }
    for (const p of people) {
      if (members.length >= MAX_MEMBERS) break
      if (!members.includes(p.key)) members.push(p.key)
      names[p.key] = p.name
    }
    if (members.length === d.members.length) return meta(d)
    await (await s()).update(id, { members, names })
    const next = { ...d, members, names }
    if (entry) entry.doc = { ...entry.doc, members, names }
    for (const k of members) emitTo(k, "yd:meta", { id, meta: meta(next) })
    return meta(next)
  }

  const createFor = async (session, { kind, title, people = [] }) => {
    if (!KINDS.includes(kind)) return { ok: false, error: "That can't be shared." }
    if (createLimited(session.key)) return { ok: false, error: "Slow down a little and try again in a minute." }
    const st = await s()
    if ((await st.countOwned(session.key)) >= perOwnerDocs) return { ok: false, error: `You have ${perOwnerDocs} shared documents already. Delete one in Come Over first.` }
    if ((await total()) >= totalCap) return { ok: false, error: "Shared documents are full on the 98ish server right now. Try again later." }
    const members = [session.key, ...people.map((p) => p.key).filter((k) => k !== session.key)].slice(0, MAX_MEMBERS)
    const names = { [session.key]: session.user.screenName }
    for (const p of people) names[p.key] = p.name
    const doc = { id: crypto.randomBytes(9).toString("hex"), owner: session.key, members, names, kind, title: cleanTitle(title) || (kind === "paint" ? "Shared picture" : kind === "folder" ? "Shared with Friends" : "Shared note"), state: "", size: 0, changedAt: now(), createdAt: now() }
    await st.create(doc)
    for (const k of members) if (k !== session.key) emitTo(k, "yd:meta", { id: doc.id, meta: meta(doc) })
    return { ok: true, id: doc.id, meta: meta(doc) }
  }

  const bind = (on) => {
    on("yd:create", async (session, { kind, title, with: names }, ack) => {
      const people = await resolveNames(session, names)
      ack(await createFor(session, { kind, title, people }))
    })

    on("yd:share", async (session, { id, with: names }, ack) => {
      const d = (live.get(String(id))?.doc) || (await (await s()).get(String(id)))
      if (!mayUse(session, d)) return ack({ ok: false, error: "That shared document isn't yours to share." })
      const m = await addMembers(d.id, await resolveNames(session, names))
      ack(m ? { ok: true, meta: m } : { ok: false })
    })

    on("yd:list", async (session, payload, ack) => {
      const docs = await (await s()).listFor(session.key)
      ack({ ok: true, docs: docs.map(meta).sort((a, b) => b.changedAt - a.changedAt) })
    })

    on("yd:open", async (session, { id, sv }, ack) => {
      const entry = await load(String(id))
      if (!entry || !mayUse(session, entry.doc)) return ack({ ok: false, error: "That shared document is gone or isn't shared with you.", gone: true })
      clearTimeout(entry.unloadTimer)
      entry.open.add(session.key)
      const vector = sv ? unb64(sv) : null
      let update
      try {
        update = vector ? Y.encodeStateAsUpdate(entry.ydoc, vector) : Y.encodeStateAsUpdate(entry.ydoc)
      } catch {
        update = Y.encodeStateAsUpdate(entry.ydoc)
      }
      ack({ ok: true, meta: meta(entry.doc), update: b64(update), sv: b64(Y.encodeStateVector(entry.ydoc)) })
    })

    on("yd:up", async (session, { id, u }, ack) => {
      const entry = live.get(String(id))
      if (!entry || !entry.open.has(session.key)) return ack({ ok: false, error: "Open the document again.", reopen: true })
      if (!mayUse(session, entry.doc)) return ack({ ok: false, error: "That shared document isn't shared with you any more.", gone: true })
      if (upLimited(session.key)) return ack({ ok: false, error: "Too many changes at once.", retry: true })
      const update = unb64(u)
      if (!update || !update.length || update.length > MAX_UPDATE) return ack({ ok: false, error: "That change is too big to share." })
      const cap = kindCap[entry.doc.kind] || KIND_CAP.text
      if (entry.size + update.length > cap) {
        // measure for real before refusing (deleted content takes almost no room)
        entry.size = Y.encodeStateAsUpdate(entry.ydoc).length
        if (entry.size + update.length > cap) return ack({ ok: false, error: "This shared document is full.", full: true })
      }
      const owner = entry.doc.owner
      if (update.length > 64 * 1024 && (await (await s()).bytesOwned(owner)) + update.length > perOwnerBytes) return ack({ ok: false, error: "The owner's shared documents are full.", full: true })
      if (update.length > 64 * 1024 && (await total()) + update.length > totalCap) return ack({ ok: false, error: "Shared documents are full on the 98ish server right now.", full: true })
      try {
        Y.applyUpdate(entry.ydoc, update, session.key)
      } catch {
        return ack({ ok: false, error: "That change couldn't be read." })
      }
      entry.size += update.length
      saveSoon(entry)
      relay(entry, session.key, "yd:up", { id: entry.doc.id, u, k: session.key })
      ack({ ok: true })
    })

    on("yd:aw", (session, { id, a }, ack) => {
      const entry = live.get(String(id))
      if (!entry || !entry.open.has(session.key)) return ack({ ok: false })
      if (awLimited(session.key)) return ack({ ok: false })
      const text = a == null ? null : JSON.stringify(a)
      if (text && text.length > MAX_AWARE) return ack({ ok: false })
      relay(entry, session.key, "yd:aw", { id: entry.doc.id, k: session.key, n: session.user.screenName, a: text ? JSON.parse(text) : null })
      ack({ ok: true })
    })

    on("yd:close", (session, { id }, ack) => {
      closeFor(session.key, String(id))
      ack({ ok: true })
    })

    on("yd:delete", async (session, { id }, ack) => {
      const st = await s()
      const d = (live.get(String(id))?.doc) || (await st.get(String(id)))
      if (!d || !d.members.includes(session.key)) return ack({ ok: false })
      if (d.owner === session.key) {
        await removeDoc(d)
        return ack({ ok: true, deleted: true })
      }
      await leaveDoc(d, session.key)
      ack({ ok: true, left: true })
    })
  }

  const removeDoc = async (d) => {
    const entry = live.get(d.id)
    if (entry) {
      clearTimeout(entry.saveTimer)
      clearTimeout(entry.unloadTimer)
      live.delete(d.id)
      entry.ydoc.destroy()
    }
    await (await s()).remove(d.id)
    if (totalBytes != null) totalBytes = Math.max(0, totalBytes - (d.size || 0))
    for (const k of d.members) emitTo(k, "yd:gone", { id: d.id })
  }
  const leaveDoc = async (d, key) => {
    const members = d.members.filter((k) => k !== key)
    const { [key]: drop, ...names } = d.names || {}
    const owner = d.owner === key ? members[0] : d.owner
    await (await s()).update(d.id, { members, names, owner })
    const entry = live.get(d.id)
    if (entry) {
      entry.doc = { ...entry.doc, members, names, owner }
      entry.open.delete(key)
    }
    emitTo(key, "yd:gone", { id: d.id })
    for (const k of members) emitTo(k, "yd:meta", { id: d.id, meta: meta({ ...d, members, names, owner }) })
  }

  // Delete My Account: documents only they're in go; shared ones lose them (the next member
  // becomes the owner). Their edits stay part of the shared text/picture, as in any shared
  // document (Help says so).
  const eraseAccount = async ({ key }) => {
    const st = await s()
    let removed = 0
    let left = 0
    for (const d of await st.forKey(key)) {
      const others = d.members.filter((k) => k !== key)
      if (!others.length) {
        await removeDoc(d)
        removed++
      } else {
        await leaveDoc(d, key)
        left++
      }
    }
    return { removed, left }
  }

  // a connection dropped / signed off: they're no longer looking at anything
  const dropped = (key) => {
    for (const [id, entry] of live) if (entry.open.has(key)) closeFor(key, id)
  }

  const close = async () => {
    for (const entry of live.values()) {
      clearTimeout(entry.unloadTimer)
      await save(entry)
    }
  }

  return { bind, createFor, addMembers, eraseAccount, dropped, close, live, meta, getStore: s }
}

module.exports = { createYdocs, KIND_CAP, MAX_UPDATE }
