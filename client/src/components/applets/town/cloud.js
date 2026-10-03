import { useEffect, useRef, useState } from "react"
import * as G from "./game"

// Sunny Acres together, the browser's side: the town API (server/town), keeping the town
// in step with the cloud while signed in to 98 Messenger, and live news from friends.
// Signed out, none of this runs and the game is the same single-player game as ever.
//
// Cloud sync: the browser's copy is the real one. Each save is uploaded with the cloud
// version it was based on ("base"); if the cloud moved on in the meantime (another device)
// and this device changed too, the player picks which town to keep, and the other is kept
// in localStorage "98ish.town.backup" (never lost silently).

export const SERVER_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:8000"
const META_KEY = "98ish.town.cloud" // { [account]: { savedAt, rev } }: what this device last synced
const BACKUP_KEY = "98ish.town.backup"
const UPLOAD_EVERY = 12_000 // ms between uploads while playing

export const townApi = (token) => async (method, path, body) => {
  if (!token) return { ok: false, status: 401, error: "Sign on to 98 Messenger to play with friends." }
  try {
    const response = await fetch(`${SERVER_URL}/api/town${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      keepalive: method !== "GET" && body !== undefined && JSON.stringify(body).length < 60_000,
    })
    const result = await response.json().catch(() => ({ ok: false, error: `The server had a problem (${response.status}).` }))
    return { ...result, status: response.status }
  } catch {
    return { ok: false, status: 0, error: "Couldn't reach the 98ish server. It may be waking up; try again in a minute." }
  }
}

const readJson = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) || fallback
  } catch {
    return fallback
  }
}
const writeJson = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // storage full or blocked
  }
}
export const readMeta = (account) => readJson(META_KEY, {})[account] || null
export const writeMeta = (account, meta) => writeJson(META_KEY, { ...readJson(META_KEY, {}), [account]: meta })
export const keepBackup = (s, why) => writeJson(BACKUP_KEY, { at: Date.now(), why, town: JSON.parse(G.serialize(s)) })

// a town nobody has really played yet (safe to replace with the cloud's)
export const isFresh = (s) => s.level <= 1 && (s.stats?.harvests || 0) < 2 && (s.stats?.orders || 0) === 0

// What to do when signing in: "upload" this device's town, "download" the cloud's, "ask"
// the player (both changed), or "none" (in step already).
export const decideSync = ({ local, meta, cloud }) => {
  if (!cloud) return "upload"
  if (!meta) return isFresh(local) ? "download" : "ask"
  const localChanged = (local.rev || 0) !== meta.rev
  if (cloud.savedAt === meta.savedAt) return localChanged ? "upload" : "none"
  return localChanged ? "ask" : "download"
}

// getGame(): the town; setGame(s): replace it (a download); applyEffects(list): use changes
// from friends; onVisitor({ name, ... }) and onNews({ type, by }): live notices.
export const useSocial = ({ token, account, socket, getGame, setGame, applyEffects, onVisitor, onNews, now }) => {
  const [data, setData] = useState(null) // the /me answer, minus the town
  const [status, setStatus] = useState("off") // off | syncing | synced | offline
  const [conflict, setConflict] = useState(null) // { cloud: { snap, savedAt } }
  const api = useRef(townApi(token))
  api.current = townApi(token)
  const busy = useRef(false)
  const lastUpload = useRef(0)
  const live = useRef({ applyEffects, onVisitor, onNews, getGame, setGame })
  live.current = { applyEffects, onVisitor, onNews, getGame, setGame }

  const takeData = (r) => {
    if (!r?.ok) return
    const { town, ok, status: _s, now: _n, effects, ...rest } = r
    setData((d) => ({ ...d, ...rest }))
  }

  // send this device's town; resolves to the response
  const upload = async ({ force = false } = {}) => {
    if (!token) return { ok: false }
    // one at a time (a help request waits for the save before it)
    for (let k = 0; busy.current && k < 100; k++) await new Promise((resolve) => setTimeout(resolve, 100))
    busy.current = true
    try {
      const s = live.current.getGame()
      const meta = readMeta(account) || { savedAt: 0, rev: -1 }
      const rev = s.rev || 0
      const r = await api.current("PUT", "/me", { snap: JSON.parse(G.serialize(s)), base: meta.savedAt, force })
      lastUpload.current = Date.now()
      if (r.ok) {
        writeMeta(account, { savedAt: r.savedAt, rev })
        setStatus("synced")
        if (r.goal !== undefined) setData((d) => ({ ...d, goal: r.goal }))
        if (r.effects?.length) live.current.applyEffects(r.effects)
      } else if (r.conflict) {
        // saved somewhere else meanwhile: unchanged here means just take it
        if ((s.rev || 0) === meta.rev) download({ snap: r.snap, savedAt: r.savedAt })
        else setConflict({ cloud: { snap: r.snap, savedAt: r.savedAt } })
      } else setStatus(r.status === 0 ? "offline" : "synced")
      return r
    } finally {
      busy.current = false
    }
  }

  const download = (cloud) => {
    const s = G.migrate(cloud.snap)
    if (!s) return
    G.tick(s, now())
    live.current.setGame(s)
    writeMeta(account, { savedAt: cloud.savedAt, rev: s.rev || 0 })
    setStatus("synced")
  }

  const refresh = async () => {
    const r = await api.current("GET", "/me")
    if (!r.ok) return r
    takeData(r)
    if (r.effects?.length) live.current.applyEffects(r.effects)
    return r
  }

  // signing in: line the two towns up (and try again now and then while the server sleeps)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!token || !account) {
      setStatus("off")
      setData(null)
      setConflict(null)
      return
    }
    let gone = false
    let retry = 0
    setStatus("syncing")
    ;(async () => {
      const r = await api.current("GET", "/me")
      if (gone) return
      if (!r.ok) {
        setStatus("offline")
        retry = setTimeout(() => setAttempt((a) => a + 1), 30_000)
        return
      }
      takeData(r)
      const local = live.current.getGame()
      const choice = decideSync({ local, meta: readMeta(account), cloud: r.town })
      if (choice === "download") {
        if (!isFresh(local)) keepBackup(local, "replaced by the cloud town")
        download(r.town)
      } else if (choice === "ask") setConflict({ cloud: r.town })
      else if (choice === "upload") await upload()
      else setStatus("synced")
      if (!gone && choice !== "ask" && r.effects?.length) live.current.applyEffects(r.effects)
    })()
    return () => {
      gone = true
      clearTimeout(retry)
    }
  }, [token, account, attempt])

  // while playing: upload changes every few seconds, and when the window goes away
  useEffect(() => {
    if (!token) return
    const dirty = () => {
      const meta = readMeta(account)
      return !conflictRef.current && meta && (live.current.getGame().rev || 0) !== meta.rev
    }
    const id = setInterval(() => {
      if (dirty() && Date.now() - lastUpload.current > UPLOAD_EVERY) upload()
    }, 3000)
    const away = () => {
      if (document.visibilityState === "hidden" && dirty()) upload()
    }
    document.addEventListener("visibilitychange", away)
    window.addEventListener("pagehide", away)
    return () => {
      clearInterval(id)
      document.removeEventListener("visibilitychange", away)
      window.removeEventListener("pagehide", away)
      if (dirty()) upload()
    }
  }, [token, account])
  const conflictRef = useRef(null)
  conflictRef.current = conflict

  // live notices from friends
  useEffect(() => {
    if (!socket || !token) return
    let timer = 0
    const news = (payload) => {
      live.current.onNews?.(payload || {})
      clearTimeout(timer)
      timer = setTimeout(refresh, 400)
    }
    const visitor = (payload) => live.current.onVisitor?.(payload || {})
    socket.on("town:news", news)
    socket.on("town:visitor", visitor)
    return () => {
      clearTimeout(timer)
      socket.off("town:news", news)
      socket.off("town:visitor", visitor)
    }
  }, [socket, token])

  const resolveConflict = async (keep) => {
    const cloud = conflict?.cloud
    setConflict(null)
    if (!cloud) return
    const local = live.current.getGame()
    if (keep === "cloud") {
      keepBackup(local, "replaced by the cloud town")
      download(cloud)
      refresh()
    } else {
      keepBackup(G.migrate(cloud.snap) || local, "replaced by this device's town")
      await upload({ force: true })
    }
  }

  return {
    on: !!token,
    status,
    data,
    conflict,
    resolveConflict,
    refresh,
    upload,
    call: (...args) => api.current(...args),
    setData,
  }
}
