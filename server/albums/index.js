// Shared Albums (98ish Photos): an album is shared by a few 98 Messenger accounts (a couple,
// friends); everyone in it adds photos and short videos, likes and comments, and sees who
// added what. Records are in MongoDB (store.js); the photos and videos themselves go to the
// same online storage bucket as synced files and IM pictures (Vercel Blob; ../drive/bucket.js)
// under a/<HMAC of the album id>/<item id>, sent and fetched by the devices with short-lived
// signed URLs, so the server never carries them. A small preview (a 256 px JPEG data URL,
// at most 24,000 characters) is kept with each record, so a whole album shows at once.
//
// PRIVACY: the bucket is private. Only a member of the album gets a signed URL for its photos
// (checked here on every request); a signed URL works for whoever holds it for 5 minutes, then
// it's useless. Paths carry no account or album names. Leaving an album, or being removed,
// ends access at once (what your devices already saved stays on them).
//
// Every route needs "Authorization: Bearer <token>" from a signed-on 98 Messenger session.
//   GET  /api/albums                       -> { albums: [summary] } (the ones I'm in)
//   POST /api/albums                       { name } -> { album }
//   GET  /api/albums/:id                   -> { album, items: [item without thumb] }
//   POST /api/albums/:id/thumbs            { ids } -> { thumbs: { id: data URL } } (60 a time)
//   POST /api/albums/:id/rename            { name }  (owner)
//   POST /api/albums/:id/invite            { to }    (any member: a buddy who hasn't blocked them)
//   POST /api/albums/:id/leave             the owner leaving passes the album on
//   POST /api/albums/:id/remove            { key }   (owner)
//   POST /api/albums/:id/delete            (owner) every photo and record goes
//   POST /api/albums/:id/upload            { kind, mime, size, w, h, d, thumb, caption, taken }
//                                          -> { item, url, method, headers } (a signed PUT)
//   POST /api/albums/:id/items/:item/commit   the upload is done: its size is checked
//   POST /api/albums/:id/items/:item/url      -> { url, mime, size } (a signed GET, 5 minutes)
//   POST /api/albums/:id/items/:item/like     { on }
//   POST /api/albums/:id/items/:item/comment  { text } -> { comment }
//   POST /api/albums/:id/items/:item/uncomment { id } (its writer or the album's owner)
//   POST /api/albums/:id/items/:item/remove   (who added it or the album's owner)
// Live: "albums:changed" { id, by, what } to the members' 98 Messenger sockets; push (category
// "albums") to the members who are away, at most every 10 minutes per album per person
// (invitations always), held by their Do Not Disturb like any push.
//
// FREE ONLY, inside the bucket's budgets (bucket.js counts every operation before it
// happens): albums may use at most ALBUM_SHARE (default 0.25) of each monthly budget, so file
// sync and IM pictures keep the rest. A photo costs an upload (advanced op) and a size check
// (simple op); each first view on a device costs a download (simple op + its bytes; devices
// keep what they fetched). Also, by env:
//   ALBUM_QUOTA_MB      40    per account, everything it added (still in an album)
//   ALBUM_TOTAL_MB      150   everyone together (and the bucket's total with synced files)
//   ALBUM_MAX_ITEMS     2000  records everyone together (MongoDB: ~12 KB each with the preview,
//                             so about 25 MB of Atlas's 512 MB at the very most)
// Per album 500 photos and videos, 20 people; 20 albums owned, 50 joined per account;
// 200 comments per photo (300 characters). Photos are JPEG <= 1.5 MB (the client sends 2048 px
// at quality 0.82, usually 300-700 KB); videos MP4/MOV/WebM <= 12 MB and 60 s.
// With no bucket, or a budget used up, nothing is uploaded and the person reads "Shared
// albums are resting" (their uploads wait on the device and try again later).

const crypto = require("node:crypto")
const express = require("express")
const { limiter } = require("../net/limiter")
const { validate: validateName } = require("../aim/screenNames")
const { createAlbumStore, memoryAlbumStore } = require("./store")

const MB = 1024 * 1024
const RESERVE_MS = 30 * 60_000
const PUSH_QUIET_MS = 10 * 60_000
const BURST_MS = 15 * 60_000
const WINDOW_MS = 10 * 60_000
const SCOPE = "albums"
const BOT_KEY = "smarterchild"
const DELETED_NAME = "(deleted account)"

const LIMITS = {
  perAlbum: 500,
  members: 20,
  owned: 20,
  joined: 50,
  comments: 200,
  commentChars: 300,
  nameChars: 60,
  captionChars: 200,
  thumbChars: 24_000,
  image: 1.5 * MB,
  video: 12 * MB,
  videoSeconds: 61,
}
const VIDEO_MIME = /^video\/(mp4|quicktime|webm)$/

const envNum = (env, name, fallback) => {
  const value = Number(env[name])
  return Number.isFinite(value) && value > 0 && env[name] !== "" && env[name] !== undefined ? value : fallback
}

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

const ID16 = /^[0-9a-f]{16}$/
const ID20 = /^[0-9a-f]{20}$/
const cleanText = (value, max) =>
  String(value ?? "")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .trim()
    .slice(0, max)

// aim: 98 Messenger's service ({ sessions, store }), a promise of it, or a function returning
// either; push: server/push's service (or null); storage: () -> promise of { bucket, adapter,
// syncedBytes() } (file sync's bucket) or null
const createAlbums = ({ aim, store, push = null, storage = async () => null, env = process.env, now = () => Date.now(), log = console, background = true, limits = {} } = {}) => {
  const quota = envNum(env, "ALBUM_QUOTA_MB", 40) * MB
  const total = envNum(env, "ALBUM_TOTAL_MB", 150) * MB
  const maxItems = envNum(env, "ALBUM_MAX_ITEMS", 2000)
  const share = Math.min(1, envNum(env, "ALBUM_SHARE", 0.25))
  const storeReady = Promise.resolve(store || createAlbumStore())
  storeReady.catch((error) => log.error?.("[albums] store failed", error.message))
  const getAim = async () => (typeof aim === "function" ? aim() : aim)
  const pushedAt = new Map() // `${album}|${key}` -> time
  let registered = null

  // ---- the bucket (shared with file sync) ----
  const bucketOf = async () => {
    let s = null
    try {
      s = await storage()
    } catch {
      s = null
    }
    if (s && registered !== s.bucket) {
      registered = s.bucket
      const db = await storeReady
      s.bucket.addStored(() => db.bytesTotal())
    }
    return s
  }
  const resting = (until) => refuse(503, "Shared albums are resting for now (98ish's free online storage needs a break). Your photos wait on this device and go up later.", { resting: true, ...(until ? { until: new Date(until).toISOString() } : {}) })

  // ---- views ----
  const nameOf = (album, key) => album.names?.[key] || key
  const summary = (album) => ({
    id: album._id,
    name: album.name,
    owner: album.owner,
    ownerName: nameOf(album, album.owner),
    members: album.members.map((k) => ({ key: k, name: nameOf(album, k) })),
    count: album.count || 0,
    bytes: album.bytes || 0,
    cover: album.cover || null,
    createdAt: album.createdAt,
    changedAt: album.changedAt,
    lastBy: album.lastBy || null,
    lastByName: album.lastBy ? nameOf(album, album.lastBy) : null,
    lastWhat: album.lastWhat || "",
  })
  const itemView = (r) => ({
    id: r._id,
    kind: r.kind,
    mime: r.mime,
    size: r.z,
    w: r.w || 0,
    h: r.h || 0,
    d: r.d || 0,
    by: r.k,
    byName: r.n,
    caption: r.cap || "",
    taken: r.taken || null,
    at: new Date(r.at).getTime(),
    likes: r.likes || [],
    comments: (r.comments || []).map((c) => ({ id: c.id, by: c.k, byName: c.n, text: c.t, at: c.at })),
  })

  // ---- live notices and push ----
  const emitTo = async (key, event, payload) => {
    const socket = (await getAim())?.sessions?.get(key)?.socket
    if (socket) socket.emit(event, payload)
  }
  const announce = async (album, byKey, byName, what, { pushText = null, always = [], keys = null } = {}) => {
    const payload = { id: album._id, by: byName, what }
    for (const key of keys || album.members) if (key !== byKey) await emitTo(key, "albums:changed", payload)
    if (!push || !pushText) return
    for (const key of keys || album.members) {
      if (key === byKey) continue
      const k = `${album._id}|${key}`
      if (!always.includes(key) && now() - (pushedAt.get(k) || 0) < PUSH_QUIET_MS) continue
      pushedAt.set(k, now())
      Promise.resolve(
        push.notify?.(
          key,
          "albums",
          { title: pushText, body: album.name, tag: `album-${album._id}`, key: `album-${album._id}`, app: "photos", url: `/?open=program&name=Photos&album=${album._id}` },
          { from: byName }
        )
      ).catch?.(() => {})
    }
  }

  // ---- album changes (optimistic, retried) ----
  const loadAlbum = async (account, id) => {
    if (!ID16.test(String(id))) refuse(404, "That album isn't there any more.")
    const album = await (await storeReady).getAlbum(id)
    if (!album || !album.members.includes(account.key)) refuse(404, "That album isn't there any more, or you're not in it.")
    return album
  }
  // fn(album) -> next album (or null: nothing to do); refusing inside is fine
  const update = async (account, id, fn) => {
    const db = await storeReady
    for (let attempt = 0; attempt < 5; attempt++) {
      const album = await loadAlbum(account, id)
      const next = await fn(album)
      if (!next) return album
      if ((await db.putAlbum(next, album.rev)).ok) return { ...next, rev: album.rev + 1 }
    }
    refuse(409, "Someone else was changing the album. Try again.")
  }
  // something new: who did it and what (bursts of uploads add up: "added 5 photos")
  const touched = (album, account, what, { added = 0, bytes = 0, cover } = {}) => {
    const t = now()
    let lastWhat = what
    let burst = null
    if (added) {
      const kind = what
      const same = album.burst && album.burst.by === account.key && album.burst.kind === kind && t - album.burst.at < BURST_MS
      const n = (same ? album.burst.n : 0) + added
      burst = { by: account.key, kind, n, at: t }
      lastWhat = `added ${n} ${kind}${n === 1 ? "" : "s"}`
    }
    return {
      ...album,
      names: { ...album.names, [account.key]: account.name },
      count: Math.max(0, (album.count || 0) + added),
      bytes: Math.max(0, (album.bytes || 0) + bytes),
      ...(cover !== undefined ? { cover } : {}),
      changedAt: t,
      lastBy: account.key,
      lastWhat,
      burst,
    }
  }

  // ---- albums ----
  const list = async (account) => ({ albums: (await (await storeReady).albumsFor(account.key)).map(summary).sort((a, b) => b.changedAt - a.changedAt) })

  const create = async (account, { name } = {}) => {
    const db = await storeReady
    const clean = cleanText(name, LIMITS.nameChars)
    if (!clean) refuse(400, "Give the album a name.")
    if ((await db.countOwned(account.key)) >= LIMITS.owned) refuse(413, `You can start at most ${LIMITS.owned} albums. Delete one you don't need.`)
    if ((await db.albumsFor(account.key)).length >= LIMITS.joined) refuse(413, `You're in ${LIMITS.joined} albums already. Leave one first.`)
    const t = now()
    const album = { _id: crypto.randomBytes(8).toString("hex"), name: clean, owner: account.key, members: [account.key], names: { [account.key]: account.name }, count: 0, bytes: 0, cover: null, createdAt: t, changedAt: t, lastBy: account.key, lastWhat: "started the album" }
    await db.createAlbum(album)
    return { album: summary(album) }
  }

  const detail = async (account, id) => {
    const album = await loadAlbum(account, id)
    const items = await (await storeReady).itemsOf(id)
    return { album: summary(album), items: items.map(itemView).sort((a, b) => a.at - b.at) }
  }

  const thumbs = async (account, id, ids) => {
    await loadAlbum(account, id)
    const wanted = (Array.isArray(ids) ? ids : []).filter((x) => ID20.test(String(x))).slice(0, 60)
    const found = await (await storeReady).thumbsOf(id, wanted)
    return { thumbs: Object.fromEntries(found.map((r) => [r._id, r.thumb || ""])) }
  }

  const rename = async (account, id, name) => {
    const clean = cleanText(name, LIMITS.nameChars)
    if (!clean) refuse(400, "Give the album a name.")
    const album = await update(account, id, (a) => {
      if (a.owner !== account.key) refuse(403, "Only the person who started the album can rename it.")
      return a.name === clean ? null : touched({ ...a, name: clean }, account, `renamed it ${clean}`)
    })
    await announce(album, account.key, account.name, "renamed")
    return { album: summary(album) }
  }

  const invite = async (account, id, to) => {
    const target = validateName(to)
    if (target.error) refuse(400, "That isn't a 98 Messenger screen name.")
    if (target.key === account.key) refuse(400, "You're already in it!")
    if (target.key === BOT_KEY) refuse(400, "SmarterChild doesn't keep photos.")
    const user = await (await getAim())?.store?.find?.(target.key)
    if (!user) refuse(404, `${target.screenName} is not a 98 Messenger screen name. Check the spelling and try again.`)
    if ((user.blocked || []).includes(account.key) || (account.blocked || []).includes(target.key)) refuse(409, `You can't share with ${user.screenName} right now.`)
    const db = await storeReady
    if ((await db.albumsFor(target.key)).length >= LIMITS.joined) refuse(413, `${user.screenName} is in too many albums to join another.`)
    const album = await update(account, id, (a) => {
      if (a.members.includes(target.key)) return null
      if (a.members.length >= LIMITS.members) refuse(413, `An album can have at most ${LIMITS.members} people.`)
      return touched({ ...a, members: [...a.members, target.key], names: { ...a.names, [target.key]: user.screenName } }, account, `invited ${user.screenName}`)
    })
    await announce(album, account.key, account.name, "invited", { pushText: `${account.name} shared the album "${album.name}" with you`, always: [target.key], keys: [target.key] })
    await announce(album, account.key, account.name, "invited", { keys: album.members.filter((k) => k !== target.key) })
    return { album: summary(album) }
  }

  const leave = async (account, id) => {
    const album = await loadAlbum(account, id)
    if (album.members.length < 2) return { deleted: (await removeAlbum(album)).id }
    const next = await update(account, id, (a) => {
      const members = a.members.filter((k) => k !== account.key)
      return touched({ ...a, members, owner: a.owner === account.key ? members[0] : a.owner }, account, "left the album")
    })
    pushedAt.delete(`${id}|${account.key}`)
    await announce(next, account.key, account.name, "left")
    return { left: id }
  }

  const removeMember = async (account, id, key) => {
    let removedName = null
    const album = await update(account, id, (a) => {
      if (a.owner !== account.key) refuse(403, "Only the person who started the album can remove people. You can leave it.")
      if (key === account.key || !a.members.includes(key)) return null
      removedName = nameOf(a, key)
      return touched({ ...a, members: a.members.filter((k) => k !== key) }, account, `removed ${removedName}`)
    })
    if (removedName) {
      await emitTo(key, "albums:changed", { id, by: account.name, what: "removed" })
      await announce(album, account.key, account.name, "removed")
    }
    return { album: summary(album) }
  }

  // every photo and record of an album (deleting objects is free)
  const removeAlbum = async (album) => {
    const db = await storeReady
    const items = await db.allItemsOf(album._id)
    await dropObjects(items)
    await db.removeAlbum(album._id)
    return { id: album._id }
  }

  const deleteAlbum = async (account, id) => {
    const album = await loadAlbum(account, id)
    if (album.owner !== account.key) refuse(403, "Only the person who started the album can delete it. You can leave it.")
    await removeAlbum(album)
    for (const key of album.members) if (key !== account.key) await emitTo(key, "albums:changed", { id, by: account.name, what: "deleted" })
    return { deleted: id }
  }

  // ---- photos and videos ----
  const sends = limiter(limits.uploads ?? 120, 60 * 60_000) // per account

  const upload = async (account, id, info = {}) => {
    const album = await loadAlbum(account, id)
    const kind = info.kind === "video" ? "video" : info.kind === "image" ? "image" : null
    const mime = String(info.mime || "").split(";")[0].trim().toLowerCase()
    const size = Number(info.size)
    if (!kind || (kind === "image" ? mime !== "image/jpeg" : !VIDEO_MIME.test(mime))) refuse(400, "Albums take photos (JPEG) and videos (MP4, MOV, WebM).")
    if (!Number.isInteger(size) || size <= 0) refuse(400, "That file is empty.")
    if (size > LIMITS[kind]) refuse(413, kind === "image" ? "That photo is too big for an album." : `That video is too big for an album (${Math.round(LIMITS.video / MB)} MB at most; try a shorter clip).`)
    const num = (v, max) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)))
    const d = kind === "video" ? num(info.d, 3600) : 0
    if (kind === "video" && d > LIMITS.videoSeconds) refuse(413, "Videos in albums can be up to a minute long.")
    const thumb = String(info.thumb || "")
    if (!/^data:image\/(jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(thumb) || thumb.length > LIMITS.thumbChars) refuse(400, "That preview couldn't be used.")
    const taken = Number(info.taken)
    if (sends(account.key)) refuse(429, "That's a lot of photos at once. The rest will go up in a little while.")
    const db = await storeReady
    if ((await db.countItems(id)) >= LIMITS.perAlbum) refuse(413, `An album holds at most ${LIMITS.perAlbum} photos and videos. Start another one.`)
    if ((await db.countAll()) >= maxItems) resting(null)
    if ((await db.bytesBy(account.key)) + size > quota) refuse(413, `You've added ${Math.round(quota / MB)} MB to shared albums. Remove some of yours (or videos) to make room.`, { full: true })
    const s = await bucketOf()
    if (!s) resting(null)
    const { bucket, adapter } = s
    const until = await bucket.restingUntil()
    if (until) resting(until)
    if ((await db.bytesTotal()) + size > total || (await s.syncedBytes()) + (await bucket.otherBytes()) + size > bucket.totalBytes) resting(null)
    const charged = await bucket.charge(adapter.costs.put, { scope: SCOPE, share })
    if (!charged.ok) resting(charged.until)
    const item = crypto.randomBytes(10).toString("hex")
    const path = `a/${bucket.prefixFor(album._id).slice(2)}${item}`
    await db.addItem({
      _id: item,
      a: id,
      k: account.key,
      n: account.name,
      kind,
      mime,
      z: size,
      w: num(info.w, 8192),
      h: num(info.h, 8192),
      d,
      path,
      thumb,
      cap: cleanText(info.caption, LIMITS.captionChars),
      taken: Number.isFinite(taken) && taken > 0 && taken < now() + 86_400_000 ? Math.round(taken) : null,
      at: new Date(now()),
      pending: true,
      x: new Date(now() + RESERVE_MS),
      likes: [],
      comments: [],
    })
    const ticket = await bucket.call(() => adapter.presignPut(path, size))
    return { item, url: ticket.url, method: ticket.method, headers: ticket.headers }
  }

  const itemOf = async (account, id, item) => {
    const album = await loadAlbum(account, id)
    if (!ID20.test(String(item))) refuse(404, "That photo isn't there any more.")
    const rec = await (await storeReady).getItem(item)
    if (!rec || rec.a !== id) refuse(404, "That photo isn't there any more.")
    return { album, rec }
  }

  // the device says the upload is done: the bucket must hold exactly that many bytes
  const commit = async (account, id, item) => {
    const { rec } = await itemOf(account, id, item)
    if (rec.k !== account.key) refuse(403, "That upload isn't yours.")
    if (!rec.pending) return { item: itemView(rec) }
    const s = await bucketOf()
    if (!s) resting(null)
    const charged = await s.bucket.charge(s.adapter.costs.head, { scope: SCOPE, share })
    if (!charged.ok) resting(charged.until)
    const found = await s.bucket.call(() => s.adapter.head(rec.path))
    const db = await storeReady
    if (!found || found.size !== rec.z) {
      if (found) await s.bucket.call(() => s.adapter.del([rec.path])).catch(() => {})
      await db.removeItems([rec._id])
      refuse(409, "The file didn't arrive. It will be sent again.")
    }
    const at = new Date(now())
    await db.updateItem(rec._id, { pending: false, at })
    const album = await update(account, id, (a) => touched(a, account, rec.kind === "video" ? "video" : "photo", { added: 1, bytes: rec.z, cover: rec.kind === "image" ? rec._id : a.cover }))
    const n = album.burst?.n || 1
    await announce(album, account.key, account.name, "added", { pushText: `${account.name} added ${n === 1 ? (rec.kind === "video" ? "a video" : "a photo") : `${n} ${rec.kind === "video" ? "videos" : "photos"}`}` })
    return { item: itemView({ ...rec, pending: false, at }) }
  }

  // a signed URL to fetch it (5 minutes), members only
  const url = async (account, id, item) => {
    const { rec } = await itemOf(account, id, item)
    if (rec.pending) refuse(409, "That one is still being sent.")
    const s = await bucketOf()
    if (!s) resting(null)
    const charged = await s.bucket.charge({ ...s.adapter.costs.get, down: rec.z }, { scope: SCOPE, share })
    if (!charged.ok) resting(charged.until)
    return { url: await s.bucket.call(() => s.adapter.presignGet(rec.path)), mime: rec.mime, size: rec.z }
  }

  const like = async (account, id, item, on) => {
    const { album, rec } = await itemOf(account, id, item)
    if (rec.pending) refuse(409, "That one is still being sent.")
    await (await storeReady).like(item, account.key, !!on)
    if (on && rec.k !== account.key) {
      const next = await update(account, id, (a) => touched(a, account, `liked ${a.names?.[rec.k] || rec.n}'s ${rec.kind === "video" ? "video" : "photo"}`))
      await announce(next, account.key, account.name, "liked", { pushText: `${account.name} liked your ${rec.kind === "video" ? "video" : "photo"}`, keys: [rec.k] })
      await announce(next, account.key, account.name, "liked", { keys: album.members.filter((k) => k !== rec.k) })
    } else await announce(album, account.key, account.name, "liked")
    return { likes: (await (await storeReady).getItem(item)).likes }
  }

  const comment = async (account, id, item, text) => {
    const { rec } = await itemOf(account, id, item)
    if (rec.pending) refuse(409, "That one is still being sent.")
    const clean = cleanText(text, LIMITS.commentChars)
    if (!clean) refuse(400, "Write something first.")
    const c = { id: crypto.randomBytes(6).toString("hex"), k: account.key, n: account.name, t: clean, at: now() }
    await (await storeReady).comment(item, c, LIMITS.comments)
    const album = await update(account, id, (a) => touched(a, account, `commented: ${clean.slice(0, 60)}`))
    await announce(album, account.key, account.name, "commented", { pushText: `${account.name} commented: ${clean.slice(0, 80)}` })
    return { comment: { id: c.id, by: c.k, byName: c.n, text: c.t, at: c.at } }
  }

  const uncomment = async (account, id, item, cid) => {
    const { album, rec } = await itemOf(account, id, item)
    const c = (rec.comments || []).find((x) => x.id === cid)
    if (!c) return { removed: false }
    if (c.k !== account.key && album.owner !== account.key) refuse(403, "You can only delete your own comments.")
    await (await storeReady).uncomment(item, cid)
    await announce(album, account.key, account.name, "uncommented")
    return { removed: true }
  }

  const removeItem = async (account, id, item) => {
    const { rec } = await itemOf(account, id, item)
    const album0 = await loadAlbum(account, id)
    if (rec.k !== account.key && album0.owner !== account.key) refuse(403, "Only the person who added it (or who started the album) can remove it.")
    await dropObjects([rec])
    const db = await storeReady
    const rest = rec.pending ? null : await db.itemsOf(id)
    const album = rec.pending
      ? album0
      : await update(account, id, (a) => ({ ...a, count: Math.max(0, (a.count || 0) - 1), bytes: Math.max(0, (a.bytes || 0) - rec.z), cover: a.cover === rec._id ? [...rest].reverse().find((r) => r.kind === "image")?._id || null : a.cover, changedAt: now() }))
    await announce(album, account.key, account.name, "removed a photo")
    return { removed: item }
  }

  // ---- upkeep ----
  const dropObjects = async (recs) => {
    if (!recs.length) return
    const s = await bucketOf()
    const paths = recs.map((r) => r.path).filter(Boolean)
    if (s && paths.length) {
      s.bucket.note({ del: paths.length })
      await s.bucket.call(() => s.adapter.del(paths))
    }
    await (await storeReady).removeItems(recs.map((r) => r._id))
  }

  // uploads never finished go (deleting is free)
  const maintain = async () => {
    const stale = await (await storeReady).stalePending(new Date(now()), 200)
    await dropObjects(stale)
    return { removed: stale.length }
  }

  // Delete My Account (../account): what they added goes (objects and records) from every
  // album, their likes and comments go, they leave every album (the owner role passes to the
  // next member; an album left empty is deleted), and the others hear about it
  const eraseAccount = async ({ key }) => {
    const db = await storeReady
    const mine = await db.itemsBy(key)
    const touchedAlbums = new Set([...mine.map((r) => r.a), ...(await db.tracesOf(key))])
    await dropObjects(mine)
    const traces = await db.forgetTraces(key)
    let left = 0
    let deleted = 0
    for (const album of await db.albumsFor(key)) {
      touchedAlbums.delete(album._id)
      const others = album.members.filter((k) => k !== key)
      if (!others.length) {
        await removeAlbum(album)
        deleted++
        continue
      }
      for (let attempt = 0; attempt < 5; attempt++) {
        const fresh = attempt ? await db.getAlbum(album._id) : album
        if (!fresh) break
        const rest = await db.itemsOf(fresh._id)
        const members = fresh.members.filter((k) => k !== key)
        const { [key]: drop, ...names } = fresh.names || {}
        const next = {
          ...fresh,
          members,
          names,
          owner: fresh.owner === key ? members[0] : fresh.owner,
          count: rest.length,
          bytes: rest.reduce((s, r) => s + r.z, 0),
          cover: [...rest].reverse().find((r) => r.kind === "image")?._id || null,
          lastBy: null,
          lastWhat: "A member deleted their account",
          burst: null,
          changedAt: now(),
        }
        if ((await db.putAlbum(next, fresh.rev)).ok) {
          left++
          await announce(next, key, DELETED_NAME, "account deleted")
          break
        }
      }
    }
    // albums they had left but still had photos or comments in: fix the counts
    for (const id of touchedAlbums) {
      const album = await db.getAlbum(id)
      if (!album) continue
      const rest = await db.itemsOf(id)
      await db.putAlbum({ ...album, count: rest.length, bytes: rest.reduce((s, r) => s + r.z, 0), cover: [...rest].reverse().find((r) => r.kind === "image")?._id || null, changedAt: now() }, album.rev)
      await announce(album, key, DELETED_NAME, "account deleted")
    }
    for (const k of pushedAt.keys()) if (k.endsWith(`|${key}`)) pushedAt.delete(k)
    return { removedItems: mine.length, traces, left, deleted }
  }

  if (background) {
    const tick = async () => {
      try {
        await maintain()
      } catch (error) {
        log.error?.("[albums] upkeep failed", error.message)
      }
      setTimeout(tick, 30 * 60_000).unref?.()
    }
    setTimeout(tick, 90_000).unref?.()
  }

  // ---- HTTP ----
  const router = () => {
    const r = express.Router()
    const calls = limiter(limits.calls ?? 900, WINDOW_MS) // per account
    const invites = limiter(limits.invites ?? 40, 60 * 60_000)
    const badTokens = limiter(limits.badTokens ?? 30, WINDOW_MS) // per IP
    const ipOf = (request) => String(request.headers["x-forwarded-for"] || request.socket.remoteAddress || "").split(",")[0].trim()

    const accountFor = async (token) => {
      if (!/^[0-9a-f]{48}$/.test(token)) return null
      const service = await getAim()
      for (const session of service?.sessions?.values() || []) {
        if (session.token === token) return { key: session.key, name: session.user?.screenName || session.key, blocked: session.user?.blocked || [] }
      }
      return null
    }

    r.use(async (request, response, next) => {
      try {
        const ip = ipOf(request)
        if (badTokens.over(ip)) return response.status(429).json({ ok: false, error: "Too many tries. Please wait a few minutes." })
        const account = await accountFor(String(request.headers.authorization || "").replace(/^Bearer\s+/i, ""))
        if (!account) {
          badTokens(ip)
          return response.status(401).json({ ok: false, error: "Sign on to 98 Messenger to use shared albums." })
        }
        if (calls(account.key)) return response.status(429).json({ ok: false, error: "Shared albums are busy for you right now. Please wait a few minutes." })
        request.account = account
        next()
      } catch (error) {
        next(error)
      }
    })
    r.use(express.json({ limit: "64kb" }))

    const handle = (fn) => async (request, response) => {
      try {
        response.json({ ok: true, ...(await fn(request)) })
      } catch (error) {
        if (error instanceof Refused) return response.status(error.status).json({ ok: false, error: error.message, ...error.extra })
        if (error?.resting) return response.status(503).json({ ok: false, resting: true, error: "Shared albums are resting for now. Your photos wait on this device and go up later." })
        log.error?.("[albums]", error?.message)
        response.status(503).json({ ok: false, error: "Shared albums aren't answering. Try again in a minute." })
      }
    }
    const p = (request) => request.params
    const b = (request) => request.body || {}

    r.get("/", handle((request) => list(request.account)))
    r.post("/", handle((request) => create(request.account, b(request))))
    r.get("/:id", handle((request) => detail(request.account, p(request).id)))
    r.post("/:id/thumbs", handle((request) => thumbs(request.account, p(request).id, b(request).ids)))
    r.post("/:id/rename", handle((request) => rename(request.account, p(request).id, b(request).name)))
    r.post(
      "/:id/invite",
      handle(async (request) => {
        if (invites(request.account.key)) refuse(429, "That's a lot of invitations. Try again later.")
        return invite(request.account, p(request).id, b(request).to)
      })
    )
    r.post("/:id/leave", handle((request) => leave(request.account, p(request).id)))
    r.post("/:id/remove", handle((request) => removeMember(request.account, p(request).id, String(b(request).key || ""))))
    r.post("/:id/delete", handle((request) => deleteAlbum(request.account, p(request).id)))
    r.post("/:id/upload", handle((request) => upload(request.account, p(request).id, b(request))))
    r.post("/:id/items/:item/commit", handle((request) => commit(request.account, p(request).id, p(request).item)))
    r.post("/:id/items/:item/url", handle((request) => url(request.account, p(request).id, p(request).item)))
    r.post("/:id/items/:item/like", handle((request) => like(request.account, p(request).id, p(request).item, b(request).on !== false)))
    r.post("/:id/items/:item/comment", handle((request) => comment(request.account, p(request).id, p(request).item, b(request).text)))
    r.post("/:id/items/:item/uncomment", handle((request) => uncomment(request.account, p(request).id, p(request).item, String(b(request).id || ""))))
    r.post("/:id/items/:item/remove", handle((request) => removeItem(request.account, p(request).id, p(request).item)))

    r.use((error, request, response, next) => {
      if (response.headersSent) return next(error)
      if (error.type === "entity.too.large") return response.status(413).json({ ok: false, error: "That's too much at once." })
      if (error.type === "entity.parse.failed") return response.status(400).json({ ok: false, error: "That request couldn't be read." })
      log.error?.("[albums] request failed", error)
      response.status(500).json({ ok: false, error: "Shared albums are unavailable right now. Please try again later." })
    })
    return r
  }

  return { router, list, create, detail, thumbs, rename, invite, leave, removeMember, deleteAlbum, upload, commit, url, like, comment, uncomment, removeItem, maintain, eraseAccount, getStore: () => storeReady, limits: { quota, total, maxItems, share, ...LIMITS } }
}

const albumsService = ({ aim, push, storage } = {}) => createAlbums({ aim, push, storage, store: process.env.MONGODB_URI ? undefined : memoryAlbumStore() })

module.exports = { createAlbums, albumsService, LIMITS }
