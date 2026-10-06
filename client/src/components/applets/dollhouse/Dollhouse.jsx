import React, { useEffect, useMemo, useRef, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import Dialog from "../../shared/Dialog"
import { useAim } from "../aim/AimContext"
import { useNet } from "../network/NetContext"
import { fs, uniqueName, writeAndSave } from "../../../utils/fs"
import { paintWindow } from "../../../utils/programs"
import { saveWallpaperImage, setSettings } from "../../../utils/settings"
import { progress, unlock } from "../../../utils/achievements"
import * as M from "./model"
import { ACCESSORIES, CATEGORIES, CLOTHES, HAIR_COLORS, HAIR_STYLES, ITEMS, OUTFITS, SKINS, itemDef } from "./catalogData"
import { drawItem, drawPerson, drawSwatch } from "./art"
import { drawScene, itemAt, renderPhoto } from "./render"
import { createSounds } from "./sounds"
import { houseApi, pairedWith, useCoupleInfo } from "./share"
import "./Dollhouse.css"
import { helpItem } from "../../../utils/help"

// Dream House: a dollhouse to decorate. Pick things from the catalog (drag them in, or tap
// to place and then drag), move, flip, stack, delete; wallpaper and floors per room; two
// (or more) little people to dress up; day and night. Saves in this browser. With 98ish's
// couples module, a paired couple can share one house and decorate it together.
// Phones: the catalog is a bottom sheet; pinch to zoom, double-tap a room to zoom in.

const HOUSE_KEY = "98ish.dollhouse"
const PREFS_KEY = "98ish.dollhouse.prefs"
const SHARED_KEY = "98ish.dollhouse.shared"
const PHOTO_FOLDER = ["C:", "Documents", "Dream House"]
const CAT_ICON = { furniture: "sofa", kitchen: "cake", bath: "bathtub", decor: "poster_heart", lights: "floor_lamp", plants: "monstera", fun: "record_player", pets: "cat", garden: "tree", people: "avatar" }
const LOOK_NAMES = {
  hairStyle: { short: "Short", long: "Long", bun: "Bun", curly: "Curly", ponytail: "Ponytail", bob: "Bob", buzz: "Buzz", pigtails: "Pigtails" },
  outfit: { tee: "T-shirt", sweater: "Sweater", dress: "Dress", hoodie: "Hoodie", overalls: "Overalls" },
  acc: { none: "None", glasses: "Glasses", bow: "Bow", flower: "Flower", beanie: "Beanie", headphones: "Headphones", freckles: "Freckles", hijab: "Hijab" },
}

const readJson = (key) => {
  try {
    return JSON.parse(localStorage.getItem(key))
  } catch {
    return null
  }
}
const writeJson = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

// ---- pictures for the catalog (drawn once, kept as data URLs) ----

const thumbs = new Map()
const thumbFor = (kind, size = 72) => {
  const key = `${kind}:${size}`
  if (thumbs.has(key)) return thumbs.get(key)
  const def = itemDef(kind)
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = size * 2
  const c = canvas.getContext("2d")
  const pad = 8
  const s = Math.min((size * 2 - pad * 2) / def.w, (size * 2 - pad * 2) / (def.h + 10))
  c.translate(size - (def.w * s) / 2, size - (def.h * s) / 2 + 6)
  c.scale(s, s)
  drawItem(c, kind, { t: 0, look: M.cleanLook(null), seed: 1 })
  const url = canvas.toDataURL()
  thumbs.set(key, url)
  return url
}
const swatchFor = (kind, id) => {
  const key = `${kind}/${id}`
  if (thumbs.has(key)) return thumbs.get(key)
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = 88
  const c = canvas.getContext("2d")
  c.scale(2, 2)
  drawSwatch(c, kind, id, 44)
  const url = canvas.toDataURL()
  thumbs.set(key, url)
  return url
}

// ---- little toolbar icons ----

const Icon = ({ name }) => {
  const p = { width: 18, height: 18, viewBox: "0 0 18 18", "aria-hidden": true }
  const s = { fill: "none", stroke: "#5b4256", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" }
  switch (name) {
    case "sun":
      return (
        <svg {...p}>
          <circle cx="9" cy="9" r="3.6" fill="#ffd23f" stroke="#c98a1b" strokeWidth="1.2" />
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <line key={i} x1={9 + Math.cos((i * Math.PI) / 4) * 5.6} y1={9 + Math.sin((i * Math.PI) / 4) * 5.6} x2={9 + Math.cos((i * Math.PI) / 4) * 7.6} y2={9 + Math.sin((i * Math.PI) / 4) * 7.6} stroke="#e8a92b" strokeWidth="1.5" strokeLinecap="round" />
          ))}
        </svg>
      )
    case "moon":
      return (
        <svg {...p}>
          <path d="M12.5 13.5A6 6 0 0 1 7.2 2.6a6.2 6.2 0 1 0 8.2 8.2 6 6 0 0 1-2.9 2.7z" fill="#fff2a8" stroke="#8f7cc8" strokeWidth="1.2" />
          <circle cx="13" cy="4" r="0.9" fill="#8f7cc8" />
        </svg>
      )
    case "camera":
      return (
        <svg {...p}>
          <rect x="1.5" y="5" width="15" height="10" rx="2.5" fill="#ffd6e5" {...s} />
          <path d="M6 5l1.2-2h3.6L12 5" {...s} />
          <circle cx="9" cy="10" r="3" fill="#bfe7ff" {...s} />
        </svg>
      )
    case "heart":
      return (
        <svg {...p}>
          <path d="M9 15.5S2 11 2 6.5A3.5 3.5 0 0 1 9 5a3.5 3.5 0 0 1 7 1.5C16 11 9 15.5 9 15.5z" fill="#ff8fb8" stroke="#c94a7a" strokeWidth="1.2" />
        </svg>
      )
    case "plus":
      return (
        <svg {...p}>
          <circle cx="8" cy="8" r="5.5" fill="#fff" {...s} />
          <path d="M8 5.5v5M5.5 8h5M12 12l4 4" {...s} />
        </svg>
      )
    case "minus":
      return (
        <svg {...p}>
          <circle cx="8" cy="8" r="5.5" fill="#fff" {...s} />
          <path d="M5.5 8h5M12 12l4 4" {...s} />
        </svg>
      )
    case "fit":
      return (
        <svg {...p}>
          <path d="M2 6V2h4M12 2h4v4M16 12v4h-4M6 16H2v-4" {...s} />
          <path d="M5 11l4-5 4 5z" fill="#ffd6e5" {...s} />
        </svg>
      )
    case "undo":
      return (
        <svg {...p}>
          <path d="M6 4L2.5 7.5 6 11" {...s} />
          <path d="M3 7.5h7a4.5 4.5 0 0 1 0 9H7" {...s} />
        </svg>
      )
    case "flip":
      return (
        <svg {...p}>
          <path d="M9 1.5v15" {...s} strokeDasharray="2 2" />
          <path d="M7 4L2 13h5z" fill="#c9b3ff" {...s} />
          <path d="M11 4l5 9h-5z" fill="#fff" {...s} />
        </svg>
      )
    case "front":
      return (
        <svg {...p}>
          <rect x="2" y="2" width="9" height="9" rx="1.5" fill="#fff" {...s} />
          <rect x="7" y="7" width="9" height="9" rx="1.5" fill="#ffb3cf" {...s} />
        </svg>
      )
    case "back":
      return (
        <svg {...p}>
          <rect x="7" y="7" width="9" height="9" rx="1.5" fill="#fff" {...s} />
          <rect x="2" y="2" width="9" height="9" rx="1.5" fill="#ffb3cf" {...s} />
        </svg>
      )
    case "copy":
      return (
        <svg {...p}>
          <rect x="2" y="5" width="9" height="11" rx="1.5" fill="#fff" {...s} />
          <rect x="7" y="2" width="9" height="11" rx="1.5" fill="#bfe7ff" {...s} />
        </svg>
      )
    case "trash":
      return (
        <svg {...p}>
          <path d="M3 5h12M7 5V3h4v2M4.5 5l1 11h7l1-11" fill="#ffe3ee" {...s} />
          <path d="M7.5 8v5M10.5 8v5" {...s} />
        </svg>
      )
    case "dress":
      return (
        <svg {...p}>
          <path d="M6.5 2l2.5 2 2.5-2 1.5 4-1.5 1 3 9h-11l3-9-1.5-1z" fill="#ffb3cf" {...s} />
        </svg>
      )
    case "paint":
      return (
        <svg {...p}>
          <rect x="2" y="2" width="11" height="6" rx="1.5" fill="#c9b3ff" {...s} />
          <path d="M13 5h2.5v4.5H8.5V12" {...s} />
          <rect x="7" y="12" width="3" height="4.5" rx="1" fill="#fff" {...s} />
        </svg>
      )
    default:
      return null
  }
}

const Dollhouse = ({ mobile, onClose, onTitle, dispatch }) => {
  const aim = useAim()
  const net = useNet()
  const token = aim?.token || null
  const couple = useCoupleInfo()
  const paired = pairedWith(couple)
  const api = useMemo(() => houseApi(token), [token])

  const soundsRef = useRef(null)
  if (!soundsRef.current) soundsRef.current = createSounds()
  const sounds = soundsRef.current

  // everything the drawing loop and the pointer handlers need, without re-rendering
  const st = useRef(null)
  if (!st.current) {
    const prefs = { tag: M.newTag(), night: false, mode: "local", hint: true, ...(readJson(PREFS_KEY) || {}) }
    if (!/^[a-z0-9]{1,12}$/.test(prefs.tag)) prefs.tag = M.newTag()
    const savedShared = readJson(SHARED_KEY)
    const savedHouse = M.deserialize(readJson(HOUSE_KEY))
    st.current = {
      prefs,
      // the very first visit shows the furnished starter house behind a "Starter or empty?" choice
      firstVisit: !savedHouse,
      local: savedHouse || M.starterHouse(prefs.tag),
      shared: (savedShared && M.deserialize(savedShared.data)) || null,
      pending: Array.isArray(savedShared?.pending) ? savedShared.pending.slice(0, 500) : [],
      sharedId: savedShared?.coupleId || null,
      view: null,
      pointers: new Map(),
      press: null,
      pinch: null,
      pan: null,
      drag: null,
      lastTap: null,
      undo: [],
      size: { w: 0, h: 0 },
      selected: null,
      room: "living",
      sharing: false,
    }
  }
  const s = st.current

  const [, setVersion] = useState(0)
  const bump = () => setVersion((v) => v + 1)
  const [selected, setSelectedState] = useState(null)
  const [room, setRoomState] = useState("living")
  const [night, setNightState] = useState(!!s.prefs.night)
  const [cat, setCat] = useState("furniture")
  const [sheet, setSheet] = useState(false) // phones: the catalog sheet is open
  const [dialog, setDialog] = useState(() => (st.current?.firstVisit ? { kind: "first" } : null))
  const [toast, setToast] = useState(null)
  const [ghost, setGhost] = useState(null) // { kind, x, y } dragging from the catalog
  const [flash, setFlash] = useState(false)
  const [sync, setSync] = useState({ state: "idle", error: null })
  const [mode, setModeState] = useState(s.prefs.mode === "shared" ? "shared" : "local")

  const stageRef = useRef(null)
  const canvasRef = useRef(null)
  const rootRef = useRef(null)

  const sharing = mode === "shared" && !!paired
  s.sharing = sharing
  const house = () => (s.sharing && s.shared ? s.shared : s.local)

  // dev builds only: tests read the house and find things on screen
  useEffect(() => {
    if (!import.meta.env.DEV) return
    window.__dollhouse = {
      house: () => house(),
      view: () => s.view,
      toScreen: (x, y) => {
        const rect = stageRef.current.getBoundingClientRect()
        const v = s.view
        return { x: rect.left + v.tx + x * v.z, y: rect.top + v.ty + y * v.z }
      },
      centerOf: (id) => {
        const item = house().items[id]
        const rect = stageRef.current.getBoundingClientRect()
        const v = s.view
        return { x: rect.left + v.tx + item.x * v.z, y: rect.top + v.ty + (item.y - itemDef(item.k).h / 2) * v.z }
      },
      roomOf: (id) => M.roomOf(house().items[id]).id,
    }
  })
  useEffect(() => () => void delete window.__dollhouse, [])

  const savePrefs = (patch) => {
    Object.assign(s.prefs, patch)
    writeJson(PREFS_KEY, s.prefs)
  }
  const setSelected = (id) => {
    s.selected = id
    setSelectedState(id)
  }
  const setRoom = (id) => {
    s.room = id
    setRoomState(id)
  }
  const setNight = (on) => {
    setNightState(on)
    savePrefs({ night: on })
  }
  const setMode = (m) => {
    setModeState(m)
    savePrefs({ mode: m })
    s.undo = []
    setSelected(null)
  }
  const say = (text) => setToast({ text, at: Date.now() })

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 3200)
    return () => clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    onTitle?.(sharing ? `Dream House - with ${paired.partner}` : "Dream House")
  }, [sharing, paired?.partner])

  // ---- saving ----

  const saveTimer = useRef(0)
  const saveSoon = () => {
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(saveNow, 300)
  }
  const saveNow = () => {
    clearTimeout(saveTimer.current)
    if (!writeJson(HOUSE_KEY, M.serialize(s.local))) say("This browser's storage is full: your house couldn't be saved.")
    if (s.shared) writeJson(SHARED_KEY, { coupleId: s.sharedId, data: M.serialize(s.shared), pending: s.pending })
  }
  useEffect(() => () => saveNow(), [])

  // ---- sharing: send edits, take in the partner's ----

  const flushTimer = useRef(0)
  const inflight = useRef(false)
  const flushSoon = (ms = 250) => {
    clearTimeout(flushTimer.current)
    flushTimer.current = setTimeout(flush, ms)
  }
  const flush = async () => {
    if (!s.sharing || inflight.current || !s.pending.length) return
    const batch = s.pending.slice(0, 50)
    inflight.current = true
    setSync({ state: "saving", error: null })
    const result = await api.send(batch)
    inflight.current = false
    if (result.ok) {
      s.pending.splice(0, batch.length)
      // edits the server had newer versions of: take theirs
      for (const op of result.current || []) M.applyOp(s.shared, op)
      saveSoon()
      setSync({ state: s.pending.length ? "saving" : "synced", error: null })
      if (s.pending.length) flushSoon(50)
      bump()
    } else if (result.offline || result.status >= 500 || result.status === 429) {
      setSync({ state: "offline", error: result.error })
      flushSoon(6000)
    } else {
      setSync({ state: "error", error: result.error })
    }
  }

  const loadShared = async () => {
    setSync({ state: "loading", error: null })
    const result = await api.get()
    if (!result.ok) {
      setSync({ state: result.offline ? "offline" : "error", error: result.error })
      if (result.offline) setTimeout(() => s.sharing && loadShared(), 8000)
      return
    }
    if (!result.house) {
      // the partner deleted it (or it was never made from this side)
      setMode("local")
      s.shared = null
      s.pending = []
      saveNow()
      setSync({ state: "idle", error: null })
      say("Your shared house isn't there anymore. Back to your own house.")
      return
    }
    const fresh = M.deserialize(result.house) || M.emptyHouse()
    for (const op of s.pending) M.applyOp(fresh, op)
    s.shared = fresh
    s.sharedId = paired?.coupleId || s.sharedId
    saveSoon()
    setSync({ state: "synced", error: null })
    bump()
    if (s.pending.length) flushSoon(50)
  }

  useEffect(() => {
    if (!sharing || !token) return
    loadShared()
  }, [sharing, token])

  useEffect(() => {
    const socket = net?.socket
    if (!socket || !sharing) return
    const onOps = (payload) => {
      if (!s.shared || !Array.isArray(payload?.ops)) return
      let changed = false
      for (const op of payload.ops) changed = M.applyOp(s.shared, op) || changed
      if (changed) {
        if (s.selected && s.shared.items[s.selected]?.del) setSelected(null)
        saveSoon()
        bump()
      }
    }
    const onReset = () => loadShared()
    socket.on("dollhouse:ops", onOps)
    socket.on("dollhouse:reset", onReset)
    socket.on("dollhouse:deleted", onReset)
    return () => {
      socket.off("dollhouse:ops", onOps)
      socket.off("dollhouse:reset", onReset)
      socket.off("dollhouse:deleted", onReset)
    }
  }, [net?.socket, sharing])

  // ---- every change goes through here ----

  const after = (ops) => {
    saveSoon()
    if (s.sharing && s.shared) {
      s.pending.push(...ops)
      if (s.pending.length > 500) s.pending.splice(0, s.pending.length - 500)
      flushSoon()
    }
    // achievements: every room furnished
    const h = house()
    const counts = {}
    for (const item of M.live(h)) {
      const r = M.roomOf(item).id
      counts[r] = (counts[r] || 0) + 1
    }
    if (M.ROOMS.every((r) => (counts[r.id] || 0) >= 3)) unlock("dollhouse-home")
    bump()
  }

  // runs one edit on the current house, remembering how things were for Undo
  const edit = (fn) => {
    const h = house()
    const items = { ...h.items }
    const rooms = { ...h.rooms }
    const result = fn(h)
    if (!result?.ops?.length) return null
    const entry = result.ops.map((op) => (op.t === "r" ? { room: op.id, prior: rooms[op.id] } : { id: op.e[0], prior: items[op.e[0]] || null }))
    s.undo.push(entry)
    if (s.undo.length > 60) s.undo.shift()
    after(result.ops)
    return result
  }

  const undo = () => {
    const entry = s.undo.pop()
    if (!entry) return
    const h = house()
    const ops = []
    for (const step of entry) {
      const r = step.room ? M.restoreRoom(h, step.room, step.prior, s.prefs.tag) : M.restoreItem(h, step.id, step.prior, s.prefs.tag)
      if (r) ops.push(...r.ops)
    }
    if (s.selected && h.items[s.selected]?.del) setSelected(null)
    sounds.flip()
    if (ops.length) after(ops)
  }

  // ---- the view (zoom and pan) ----

  // the whole scene, garden and all
  const wholeView = () => {
    const { w, h } = s.size
    if (!w || !h) return null
    const z = Math.min(w / (M.WORLD.w + 30), h / (M.WORLD.h + 30))
    return { z, tx: (w - M.WORLD.w * z) / 2, ty: (h - M.WORLD.h * z) / 2 }
  }
  // what "Whole House" shows: on tall phone screens the house fills the width and the
  // garden is a swipe away
  const fitView = () => {
    const { w, h } = s.size
    if (!w || !h) return null
    if (h > w * 1.05) {
      const z = Math.min(w / 870, h / 860)
      return { z, tx: w / 2 - 450 * z, ty: h * 0.5 - 390 * z }
    }
    return wholeView()
  }
  const clampView = (v) => {
    const fit = wholeView()
    if (!fit) return v
    const z = Math.min(4, Math.max(fit.z * 0.85, v.z))
    const { w, h } = s.size
    const ww = M.WORLD.w * z
    const wh = M.WORLD.h * z
    const m = 60
    const tx = ww + 2 * m < w ? (w - ww) / 2 : Math.min(m, Math.max(w - ww - m, v.tx))
    const ty = wh + 2 * m < h ? (h - wh) / 2 : Math.min(m, Math.max(h - wh - m, v.ty))
    return { z, tx, ty }
  }
  const setView = (v) => {
    s.view = clampView(v)
  }
  const zoomAt = (px, py, z) => {
    const v = s.view
    if (!v) return
    const wx = (px - v.tx) / v.z
    const wy = (py - v.ty) / v.z
    const next = clampView({ ...v, z })
    setView({ z: next.z, tx: px - wx * next.z, ty: py - wy * next.z })
  }
  const zoomBy = (f) => zoomAt(s.size.w / 2, s.size.h / 2, (s.view?.z || 1) * f)
  const fit = () => {
    s.view = fitView()
  }
  const zoomToRoom = (id) => {
    const r = M.ROOM[id]
    const { w, h } = s.size
    if (!r || !w) return
    const z = Math.min(4, Math.min((w - 24) / r.w, (h - 24) / r.h))
    setView({ z, tx: w / 2 - (r.x + r.w / 2) * z, ty: h / 2 - (r.y + r.h / 2) * z })
  }

  const toWorld = (clientX, clientY) => {
    const rect = stageRef.current.getBoundingClientRect()
    const v = s.view || { z: 1, tx: 0, ty: 0 }
    return { x: (clientX - rect.left - v.tx) / v.z, y: (clientY - rect.top - v.ty) / v.z }
  }

  // ---- drawing ----

  useEffect(() => {
    const canvas = canvasRef.current
    const stage = stageRef.current
    let raf = 0
    const start = performance.now()
    const size = () => {
      const w = stage.clientWidth
      const h = stage.clientHeight
      const first = !s.size.w && w && h
      s.size = { w, h }
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      canvas.width = Math.max(1, Math.round(w * dpr))
      canvas.height = Math.max(1, Math.round(h * dpr))
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      if (first || !s.view) fit()
      else s.view = clampView(s.view)
    }
    const frame = () => {
      raf = requestAnimationFrame(frame)
      if (!s.view || !s.size.w) return
      const c = canvas.getContext("2d")
      const dpr = canvas.width / s.size.w
      c.setTransform(1, 0, 0, 1, 0, 0)
      c.fillStyle = "#cfeaff"
      c.fillRect(0, 0, canvas.width, canvas.height)
      const v = s.view
      c.setTransform(dpr * v.z, 0, 0, dpr * v.z, dpr * v.tx, dpr * v.ty)
      const t = (performance.now() - start) / 1000
      s.t = t
      drawScene(c, house(), { t, night: s.night, selected: s.selected, room: s.room, drag: s.drag })
    }
    size()
    const observer = new ResizeObserver(size)
    observer.observe(stage)
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
    }
  }, [])
  s.night = night

  // ---- placing things ----

  const place = (kind, x, y) => {
    const h = house()
    if (M.liveCount(h) >= M.MAX_ITEMS) {
      say(`Your house is full! (${M.MAX_ITEMS} things.) Delete something first.`)
      return null
    }
    const result = edit((hh) => M.addItem(hh, kind, x, y, s.prefs.tag))
    if (!result) return null
    sounds.place()
    setSelected(result.item.id)
    setRoom(M.roomOf(result.item).id)
    progress("dollhouse-30", result.item.id, 30)
    return result.item
  }

  // tapping a catalog thing: it goes in the middle of what you're looking at
  const placeHere = (kind) => {
    const def = itemDef(kind)
    const { w, h } = s.size
    const v = s.view
    let target = M.ROOM[s.room] || M.ROOM.living
    if (v) {
      const center = { x: (w / 2 - v.tx) / v.z, y: (h / 2 - v.ty) / v.z }
      const zoomed = v.z > (fitView()?.z || 1) * 1.4
      if (zoomed) target = M.roomAt(center.x, center.y) || M.nearestRoom(center.x, center.y)
    }
    const jitter = (Math.random() - 0.5) * Math.min(80, target.w / 3)
    const x = target.x + target.w / 2 + jitter
    const y = def.mount === "floor" ? target.y + target.h : def.mount === "free" ? target.y + target.h * 0.35 : target.y + target.h * 0.55
    place(kind, x, y)
    if (mobile) setSheet(false)
  }

  // dragging a thing in from the catalog (mouse and pen; touch taps instead)
  const onCatalogDown = (e, kind) => {
    if (e.pointerType === "touch" || e.button !== 0) return
    e.preventDefault()
    const startX = e.clientX
    const startY = e.clientY
    let moved = false
    const move = (ev) => {
      if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return
      moved = true
      setGhost({ kind, x: ev.clientX, y: ev.clientY })
    }
    const up = (ev) => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      window.removeEventListener("pointercancel", up)
      setGhost(null)
      if (!moved) return placeHere(kind)
      if (ev.type === "pointercancel") return
      const rect = stageRef.current?.getBoundingClientRect()
      if (!rect || ev.clientX < rect.left || ev.clientX > rect.right || ev.clientY < rect.top || ev.clientY > rect.bottom) return
      const p = toWorld(ev.clientX, ev.clientY)
      const def = itemDef(kind)
      place(kind, p.x, p.y + def.h / 2)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
    window.addEventListener("pointercancel", up)
  }

  // ---- pointers on the house ----

  const onPointerDown = (e) => {
    if (!s.view) return
    rootRef.current?.focus({ preventScroll: true })
    stageRef.current.setPointerCapture?.(e.pointerId)
    s.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType })
    if (e.pointerType === "touch" && s.pointers.size === 2) {
      // two fingers: pinch and pan (a drag in progress is dropped)
      s.press = null
      s.drag = null
      s.pan = null
      const [a, b] = [...s.pointers.values()]
      const rect = stageRef.current.getBoundingClientRect()
      s.pinch = { view: s.view, dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top } }
      return
    }
    if (s.pointers.size > 1) return
    if (e.pointerType === "mouse" && e.button !== 0) {
      s.pan = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: true }
      return
    }
    const p = toWorld(e.clientX, e.clientY)
    const item = itemAt(house(), p.x, p.y, s.t || 0)
    if (item) {
      s.press = { id: item.id, pointerId: e.pointerId, sx: e.clientX, sy: e.clientY, ox: p.x - item.x, oy: p.y - item.y, moved: false, touch: e.pointerType === "touch" }
    } else {
      s.pan = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false, world: p }
    }
  }

  const onPointerMove = (e) => {
    if (!s.pointers.has(e.pointerId)) return
    s.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType })
    if (s.pinch && s.pointers.size >= 2) {
      const [a, b] = [...s.pointers.values()]
      const rect = stageRef.current.getBoundingClientRect()
      const mid = { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top }
      const pv = s.pinch.view
      const z = clampView({ ...pv, z: (pv.z * Math.hypot(a.x - b.x, a.y - b.y)) / Math.max(10, s.pinch.dist) }).z
      const wx = (s.pinch.mid.x - pv.tx) / pv.z
      const wy = (s.pinch.mid.y - pv.ty) / pv.z
      setView({ z, tx: mid.x - wx * z, ty: mid.y - wy * z })
      return
    }
    if (s.pan?.id === e.pointerId) {
      if (!s.pan.moved && Math.hypot(e.clientX - s.pan.sx, e.clientY - s.pan.sy) < 6) return
      s.pan.moved = true
      const v = s.view
      setView({ ...v, tx: v.tx + e.clientX - s.pan.x, ty: v.ty + e.clientY - s.pan.y })
      s.pan.x = e.clientX
      s.pan.y = e.clientY
      return
    }
    const press = s.press
    if (press?.pointerId === e.pointerId) {
      if (!press.moved) {
        if (Math.hypot(e.clientX - press.sx, e.clientY - press.sy) < (press.touch ? 8 : 3)) return
        press.moved = true
        setSelected(press.id)
        sounds.pick()
      }
      const item = house().items[press.id]
      if (!item || item.del) {
        s.press = null
        s.drag = null
        return
      }
      const p = toWorld(e.clientX, e.clientY)
      const x = p.x - press.ox
      const y = p.y - press.oy
      s.drag = { id: press.id, x, y, snapY: M.snap(house(), item.k, x, y, press.id).y }
    }
  }

  const onPointerUp = (e) => {
    const had = s.pointers.delete(e.pointerId)
    if (s.pinch) {
      if (s.pointers.size < 2) s.pinch = null
      return
    }
    if (!had) return
    const cancel = e.type === "pointercancel"
    if (s.pan?.id === e.pointerId) {
      const pan = s.pan
      s.pan = null
      if (pan.moved || cancel) return
      // a tap on an empty spot: pick that room (a double tap zooms into it)
      const r = M.roomAt(pan.world.x, pan.world.y)
      setSelected(null)
      if (r) setRoom(r.id)
      const now = performance.now()
      const last = s.lastTap
      if (last && now - last.at < 380 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 30) {
        s.lastTap = null
        const fz = fitView()?.z || 1
        if (r && s.view.z < fz * 1.6) zoomToRoom(r.id)
        else fit()
      } else s.lastTap = { at: now, x: e.clientX, y: e.clientY }
      return
    }
    const press = s.press
    if (press?.pointerId === e.pointerId) {
      s.press = null
      const drag = s.drag
      s.drag = null
      if (press.moved && drag && !cancel) {
        const moved = edit((h) => M.moveItem(h, press.id, drag.x, drag.y, s.prefs.tag))
        if (moved) {
          sounds.place()
          setRoom(M.roomOf(moved.item).id)
        }
      } else if (!press.moved) {
        setSelected(press.id)
        const item = house().items[press.id]
        if (item) setRoom(M.roomOf(item).id)
        sounds.toggle()
      }
    }
  }

  useEffect(() => {
    const el = stageRef.current
    const wheel = (e) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, (s.view?.z || 1) * Math.exp(-e.deltaY * 0.0015))
    }
    el.addEventListener("wheel", wheel, { passive: false })
    return () => el.removeEventListener("wheel", wheel)
  }, [])

  // ---- what you can do to the selected thing ----

  const selItem = selected ? house().items[selected] : null
  const selDef = selItem && !selItem.del ? itemDef(selItem.k) : null
  useEffect(() => {
    if (selected && !selDef) setSelected(null)
  })

  const act = {
    flip: () => selected && edit((h) => M.flipItem(h, selected, s.prefs.tag)) && sounds.flip(),
    front: () => selected && edit((h) => M.restack(h, selected, "front", s.prefs.tag)),
    back: () => selected && edit((h) => M.restack(h, selected, "back", s.prefs.tag)),
    forward: () => selected && edit((h) => M.restack(h, selected, "forward", s.prefs.tag)),
    backward: () => selected && edit((h) => M.restack(h, selected, "backward", s.prefs.tag)),
    copy: () => {
      if (!selected) return
      if (M.liveCount(house()) >= M.MAX_ITEMS) return say("Your house is full! Delete something first.")
      const r = edit((h) => M.duplicateItem(h, selected, s.prefs.tag))
      if (r) {
        sounds.place()
        setSelected(r.item.id)
        progress("dollhouse-30", r.item.id, 30)
      }
    },
    remove: () => {
      if (!selected) return
      if (edit((h) => M.removeItem(h, selected, s.prefs.tag))) sounds.remove()
      setSelected(null)
    },
    nudge: (dx, dy) => selected && edit((h) => M.moveItem(h, selected, h.items[selected].x + dx, h.items[selected].y + dy, s.prefs.tag)),
  }

  const onKeyDown = (e) => {
    if (dialog || e.target.closest?.("input, textarea, select")) return
    const ctrl = e.ctrlKey || e.metaKey
    if (ctrl && e.key.toLowerCase() === "z") {
      e.preventDefault()
      undo()
    } else if (ctrl && e.key.toLowerCase() === "d") {
      e.preventDefault()
      act.copy()
    } else if (e.key === "Delete" || e.key === "Backspace") {
      if (selected) {
        e.preventDefault()
        act.remove()
      }
    } else if (e.key === "Escape") setSelected(null)
    else if (e.key === "f" || e.key === "F") act.flip()
    else if (e.key.startsWith("Arrow") && selected) {
      e.preventDefault()
      const step = e.shiftKey ? 20 : 5
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
      act.nudge(...d)
    }
  }

  // ---- photo ----

  const takePhoto = async () => {
    const canvas = renderPhoto(house(), { night, t: s.t || 0 })
    let url = canvas.toDataURL("image/png")
    if (url.length > 1_400_000) url = renderPhoto(house(), { night, t: s.t || 0, scale: 0.6 }).toDataURL("image/png")
    sounds.shutter()
    setFlash(true)
    setTimeout(() => setFlash(false), 450)
    let dir = fs.root
    for (const part of PHOTO_FOLDER) {
      let next = dir.getItem(part)
      if (!next || !next.isDirectory) next = fs.createDirectoryIn(dir, part)
      dir = next
    }
    const file = fs.createFileIn(dir, uniqueName(dir, sharing ? "Our Dream House" : "Dream House"), "image", "")
    if (!(await writeAndSave(file, url, { created: true }))) {
      setDialog({ kind: "alert", text: "There isn't enough room on the drive to save this photo. Delete something and try again." })
      return
    }
    setDialog({ kind: "photo", file, url })
  }

  const setPhotoAsWallpaper = (url) => {
    if (!saveWallpaperImage(url)) return say("That photo is too big to use as the wallpaper.")
    setSettings({ wallpaper: "custom", display: "stretch" })
    unlock("wallpaper")
    say("Your Dream House is on the desktop now!")
  }

  // ---- sharing dialog ----

  const openShare = async () => {
    if (!paired) return setDialog({ kind: "share-single" })
    if (sharing) return setDialog({ kind: "share-on" })
    setDialog({ kind: "share-ask", loading: true })
    const result = await api.get()
    setDialog((d) => (d?.kind === "share-ask" ? { kind: "share-ask", exists: !!result.house, error: result.ok ? null : result.error } : d))
  }

  const startSharing = async (useMine) => {
    if (useMine) {
      setDialog({ kind: "share-ask", busy: true })
      const result = await api.put(M.serialize(s.local))
      if (!result.ok) return setDialog({ kind: "alert", text: result.error || "Couldn't share your house right now." })
      s.shared = M.deserialize(result.house) || M.deserialize(M.serialize(s.local))
      s.pending = []
    } else {
      s.shared = s.shared && s.sharedId === paired.coupleId ? s.shared : null
    }
    s.sharedId = paired.coupleId
    setDialog(null)
    setMode("shared")
    sounds.sparkle()
    say(`You and ${paired.partner} are decorating together now.`)
    if (!useMine) loadShared()
  }

  const stopSharing = () => {
    setDialog(null)
    setMode("local")
    say("Back to your own house. Your shared house is still there for later.")
  }

  const deleteShared = async () => {
    const result = await api.remove()
    if (!result.ok) return setDialog({ kind: "alert", text: result.error || "Couldn't delete the shared house right now." })
    s.shared = null
    s.pending = []
    saveNow()
    setDialog(null)
    setMode("local")
    say("The shared house is gone. Back to your own house.")
  }

  const newHouse = (starter) => {
    if (sharing) {
      // in a shared house, "New" clears what's in it (as edits, so it syncs)
      const h = house()
      const ops = []
      for (const item of M.live(h)) ops.push(...M.removeItem(h, item.id, s.prefs.tag).ops)
      if (starter) {
        const fresh = M.starterHouse(s.prefs.tag)
        for (const item of M.live(fresh)) {
          const r = M.addItem(h, item.k, item.x, item.y, s.prefs.tag, { f: item.f, look: item.look })
          if (r) ops.push(...r.ops)
        }
      }
      for (const r of M.ROOMS) ops.push(...M.setRoom(h, r.id, M.DEFAULT_ROOMS[r.id], s.prefs.tag).ops)
      s.undo = []
      after(ops)
    } else {
      s.local = starter ? M.starterHouse(s.prefs.tag) : M.emptyHouse()
      s.undo = []
      saveNow()
      bump()
    }
    setSelected(null)
    setDialog(null)
    fit()
  }

  // ---- people ----

  const dressUp = (id) => {
    const item = house().items[id]
    if (!item || item.k !== "avatar") return
    setDialog({ kind: "person", id, name: item.name || "", look: { ...item.look } })
  }

  // ---- menus ----

  const menus = [
    {
      label: "House",
      items: [
        { label: "New House...", onClick: () => setDialog({ kind: "new" }) },
        { label: "Take a Photo", onClick: takePhoto },
        "-",
        { label: sharing ? "Sharing with Partner..." : "Share with Partner...", onClick: openShare },
        "-",
        { label: "Close", onClick: () => onClose?.() },
      ],
    },
    {
      label: "Edit",
      items: [
        { label: "Undo", onClick: undo, disabled: !s.undo.length },
        "-",
        { label: "Flip", onClick: act.flip, disabled: !selDef },
        { label: "Bring to Front", onClick: act.front, disabled: !selDef },
        { label: "Bring Forward", onClick: act.forward, disabled: !selDef },
        { label: "Send Backward", onClick: act.backward, disabled: !selDef },
        { label: "Send to Back", onClick: act.back, disabled: !selDef },
        { label: "Duplicate", onClick: act.copy, disabled: !selDef },
        { label: "Delete", onClick: act.remove, disabled: !selDef },
        ...(selItem?.k === "avatar" ? ["-", { label: "Dress Up...", onClick: () => dressUp(selected) }] : []),
      ],
    },
    {
      label: "View",
      items: [
        { label: "Daytime", checked: !night, onClick: () => setNight(false) },
        { label: "Nighttime", checked: night, onClick: () => setNight(true) },
        "-",
        { label: "Zoom In", onClick: () => zoomBy(1.25) },
        { label: "Zoom Out", onClick: () => zoomBy(0.8) },
        { label: "Whole House", onClick: fit },
        ...M.ROOMS.map((r) => ({ label: `Go to ${r.name}`, onClick: () => (setRoom(r.id), zoomToRoom(r.id)) })),
      ],
    },
    { label: "Help", items: [helpItem({ program: "Dream House" }), "-", { label: "How to Decorate", onClick: () => setDialog({ kind: "help" }) }] },
  ]

  // ---- the catalog ----

  const catalogItems = cat === "rooms" ? [] : ITEMS.filter((d) => d.cat === cat)
  const roomStyle = house().rooms[room] || {}
  const catalog = (
    <div className="dhCatalog">
      <div className="dhTabs" role="tablist" aria-label="Catalog">
        {CATEGORIES.map((c) => (
          <button key={c.id} type="button" role="tab" aria-selected={cat === c.id} className={cat === c.id ? "dhTab is-on" : "dhTab"} title={c.label} aria-label={c.label} onClick={() => setCat(c.id)}>
            <img src={thumbFor(CAT_ICON[c.id], 36)} alt="" draggable="false" />
            {mobile && <span>{c.label}</span>}
          </button>
        ))}
        <button type="button" role="tab" aria-selected={cat === "rooms"} className={cat === "rooms" ? "dhTab is-on" : "dhTab"} title="Walls & Floors" aria-label="Walls & Floors" onClick={() => setCat("rooms")}>
          <img src={swatchFor("wall", "hearts")} alt="" draggable="false" className="dhTabSwatch" />
          {mobile && <span>Walls</span>}
        </button>
      </div>
      {cat === "rooms" ? (
        <div className="dhRooms">
          <div className="dhRoomPick">
            {M.ROOMS.map((r) => (
              <button key={r.id} type="button" className={room === r.id ? "is-on" : ""} onClick={() => setRoom(r.id)}>
                {r.name}
              </button>
            ))}
          </div>
          <div className="dhLabel">{M.ROOM[room]?.outdoor ? "Backdrop" : "Wallpaper"}</div>
          <div className="dhSwatches">
            {M.WALLS.map(([id, label]) => (
              <button key={id} type="button" title={label} aria-label={`Wallpaper ${label}`} className={roomStyle.wall === id ? "dhSwatch is-on" : "dhSwatch"} onClick={() => edit((h) => M.setRoom(h, room, { wall: id }, s.prefs.tag)) && sounds.toggle()}>
                <img src={swatchFor("wall", id)} alt="" draggable="false" />
              </button>
            ))}
          </div>
          <div className="dhLabel">{M.ROOM[room]?.outdoor ? "Ground" : "Floor"}</div>
          <div className="dhSwatches">
            {M.FLOORS.map(([id, label]) => (
              <button key={id} type="button" title={label} aria-label={`Floor ${label}`} className={roomStyle.floor === id ? "dhSwatch is-on" : "dhSwatch"} onClick={() => edit((h) => M.setRoom(h, room, { floor: id }, s.prefs.tag)) && sounds.toggle()}>
                <img src={swatchFor("floor", id)} alt="" draggable="false" />
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="dhGrid">
          {catalogItems.map((d) => (
            <button key={d.id} type="button" className="dhThing" data-kind={d.id} title={d.name} onPointerDown={(e) => onCatalogDown(e, d.id)} onClick={(e) => e.detail === 0 && placeHere(d.id)} onKeyDown={(e) => e.key === "Enter" && placeHere(d.id)} onPointerUp={(e) => e.pointerType === "touch" && placeHere(d.id)}>
              <img src={thumbFor(d.id)} alt="" draggable="false" />
              <span>{d.name}</span>
            </button>
          ))}
          {cat === "people" && <p className="dhNote">Tap a person in your house, then Dress Up to change their hair, clothes and name.</p>}
        </div>
      )}
    </div>
  )

  const count = M.liveCount(house())
  const syncLabel = !sharing ? null : sync.state === "synced" ? "synced" : sync.state === "saving" ? "saving..." : sync.state === "loading" ? "opening..." : sync.state === "offline" ? "offline: will sync" : sync.state === "error" ? "not synced" : ""

  return (
    <div ref={rootRef} className={`dhRoot${mobile ? " dhMobile" : ""}${night ? " dhNight" : ""}`} tabIndex={-1} onKeyDown={onKeyDown}>
      <MenuBar menus={menus} />
      <div className="dhToolbar">
        <button type="button" className="dhTool" aria-label={night ? "Daytime" : "Nighttime"} title={night ? "Daytime" : "Nighttime"} aria-pressed={night} onClick={() => (setNight(!night), sounds.toggle())}>
          <Icon name={night ? "sun" : "moon"} />
          {!mobile && <span>{night ? "Day" : "Night"}</span>}
        </button>
        <button type="button" className="dhTool" aria-label="Take a Photo" title="Take a Photo" onClick={takePhoto}>
          <Icon name="camera" />
          {!mobile && <span>Photo</span>}
        </button>
        <button type="button" className={sharing ? "dhTool is-shared" : "dhTool"} aria-label="Share with Partner" title="Share with Partner" onClick={openShare}>
          <Icon name="heart" />
          {!mobile && <span>{sharing ? "Shared" : "Share"}</span>}
        </button>
        <span className="dhSep" />
        <button type="button" className="dhTool" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!s.undo.length} onClick={undo}>
          <Icon name="undo" />
        </button>
        {/* zooming: pinch or the mouse wheel, and View > Zoom In / Zoom Out (docs/simplicity.md) */}
        <button type="button" className="dhTool" aria-label="Whole House" title="Whole House" onClick={fit}>
          <Icon name="fit" />
        </button>
        {sharing && (
          <span className={`dhSync is-${sync.state}`} title={sync.error || ""}>
            {"♥"} {mobile ? syncLabel : `${paired.partner}: ${syncLabel}`}
          </span>
        )}
      </div>

      <div className="dhMain">
        <div className="dhStageWrap">
          <div
            ref={stageRef}
            className="dhStage"
            data-testid="dh-stage"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onContextMenu={(e) => e.preventDefault()}
          >
            <canvas ref={canvasRef} className="dhCanvas" />
          </div>
          {flash && <div className="dhFlash" />}

          {selDef ? (
            <div className="dhSelBar" role="toolbar" aria-label="Selected">
              <span className="dhSelName">{selItem.k === "avatar" && selItem.name ? selItem.name : selDef.name}</span>
              {selItem.k === "avatar" && (
                <button type="button" className="dhAct" onClick={() => dressUp(selected)} aria-label="Dress Up" title="Dress Up">
                  <Icon name="dress" />
                  <span>Dress Up</span>
                </button>
              )}
              <button type="button" className="dhAct" onClick={act.flip} aria-label="Flip" title="Flip (F)">
                <Icon name="flip" />
                <span>Flip</span>
              </button>
              <button type="button" className="dhAct" onClick={act.front} aria-label="Bring to Front" title="Bring to Front">
                <Icon name="front" />
                <span>Front</span>
              </button>
              <button type="button" className="dhAct" onClick={act.back} aria-label="Send to Back" title="Send to Back">
                <Icon name="back" />
                <span>Back</span>
              </button>
              <button type="button" className="dhAct" onClick={act.copy} aria-label="Duplicate" title="Duplicate (Ctrl+D)">
                <Icon name="copy" />
                <span>Copy</span>
              </button>
              <button type="button" className="dhAct dhDanger" onClick={act.remove} aria-label="Delete" title="Delete (Del)">
                <Icon name="trash" />
                <span>Delete</span>
              </button>
            </div>
          ) : (
            <div className="dhSelBar dhRoomBar">
              <span className="dhSelName">{M.ROOM[room]?.name}</span>
              <button
                type="button"
                className="dhAct"
                aria-label="Walls & Floors"
                onClick={() => {
                  setCat("rooms")
                  if (mobile) setSheet(true)
                }}
              >
                <Icon name="paint" />
                <span>Walls &amp; Floors</span>
              </button>
              {mobile && (
                <button type="button" className="dhAct dhAdd" aria-label="Add things" onClick={() => setSheet(true)}>
                  <span className="dhPlus">+</span>
                  <span>Add</span>
                </button>
              )}
            </div>
          )}

          {toast && (
            <div className="dhToast" role="status" key={toast.at}>
              {toast.text}
            </div>
          )}
        </div>

        {!mobile && <aside className="dhSide">{catalog}</aside>}
      </div>

      {mobile && (
        <div className={sheet ? "dhSheet is-open" : "dhSheet"}>
          <button type="button" className="dhSheetHandle" aria-label={sheet ? "Close the catalog" : "Open the catalog"} onClick={() => setSheet(!sheet)}>
            <span className="dhGrip" />
            <span>{sheet ? "Done" : "Catalog"}</span>
          </button>
          {sheet && catalog}
        </div>
      )}

      {!mobile && (
        <div className="dhStatus">
          <span>{count} {count === 1 ? "thing" : "things"}</span>
          <span>{selDef ? `${selDef.name} in the ${M.roomOf(selItem).name}` : M.ROOM[room]?.name}</span>
          <span>{sharing ? `Shared with ${paired.partner}` : "Your house"}</span>
        </div>
      )}

      {ghost && (
        <img className="dhGhost" src={thumbFor(ghost.kind)} alt="" style={{ left: ghost.x, top: ghost.y }} draggable="false" />
      )}

      {dialog?.kind === "person" && (
        <PersonDialog
          value={dialog}
          onCancel={() => setDialog(null)}
          onOk={(v) => {
            edit((h) => M.setPerson(h, dialog.id, { name: v.name, look: v.look }, s.prefs.tag))
            sounds.sparkle()
            setDialog(null)
          }}
        />
      )}
      {dialog?.kind === "photo" && (
        <Dialog
          title="Dream House"
          okLabel="Set as Wallpaper"
          noLabel="Open in Paint"
          cancelLabel="Close"
          onOk={() => {
            setPhotoAsWallpaper(dialog.url)
            setDialog(null)
          }}
          onNo={() => {
            dispatch?.({ type: "open_window", payload: paintWindow(dialog.file) })
            setDialog(null)
          }}
          onCancel={() => setDialog(null)}
        >
          <div className="dhPhoto">
            <img src={dialog.url} alt="Your Dream House" />
          </div>
          <p className="dialogText">
            Saved as C:\Documents\Dream House\{dialog.file.name}
          </p>
        </Dialog>
      )}
      {dialog?.kind === "first" && (
        <Dialog title="Welcome to Dream House" okLabel="Starter House" noLabel="Empty House" onOk={() => ((s.firstVisit = false), setDialog(null), saveNow())} onNo={() => ((s.firstVisit = false), newHouse(false))} onCancel={() => ((s.firstVisit = false), setDialog(null), saveNow())}>
          <p className="dialogText">Start with a furnished house to play with, or an empty one to decorate from scratch? (House &gt; New House... switches later.)</p>
        </Dialog>
      )}
      {dialog?.kind === "new" && (
        <Dialog title="New House" okLabel="Starter House" noLabel="Empty House" onOk={() => newHouse(true)} onNo={() => newHouse(false)} onCancel={() => setDialog(null)}>
          <p className="dialogText">Start over? {sharing ? "This clears the house you share, for both of you." : "Everything in your house now will be cleared."}</p>
          <p className="dialogText">A starter house comes with a few things in every room; an empty one is all yours to fill.</p>
        </Dialog>
      )}
      {dialog?.kind === "help" && (
        <Dialog title="How to Decorate" onOk={() => setDialog(null)} onCancel={() => setDialog(null)}>
          <ul className="dhHelp">
            {mobile ? (
              <>
                <li>Tap Catalog and tap something to put it in the room you're looking at, then drag it where you like.</li>
                <li>Pinch to zoom; double-tap a room to zoom right in.</li>
              </>
            ) : (
              <>
                <li>Drag things from the catalog into any room, or click one to drop it in the selected room.</li>
                <li>Scroll to zoom, drag an empty spot to look around; double-click a room to zoom in.</li>
              </>
            )}
            <li>Small things (lamps, cakes, plants) land on the tabletop or shelf below them. Wall things stay on the wall; lights hang from the ceiling.</li>
            <li>Tap a room's empty wall, then Walls &amp; Floors to change its wallpaper and floor.</li>
            <li>Night makes the lamps glow. Take a Photo saves a picture to C:\Documents\Dream House.</li>
            <li>Keys: Del deletes, F flips, arrows nudge, Ctrl+Z undoes, Ctrl+D duplicates.</li>
          </ul>
        </Dialog>
      )}
      {dialog?.kind === "alert" && (
        <Dialog title="Dream House" onOk={() => setDialog(null)} sound="chord">
          <p className="dialogText">{dialog.text}</p>
        </Dialog>
      )}
      {dialog?.kind === "share-single" && (
        <Dialog title="Share with Partner" onOk={() => setDialog(null)}>
          <div className="dhShareArt" aria-hidden="true">
            <img src={thumbFor("avatar", 48)} alt="" />
            <Icon name="heart" />
            <img src={thumbFor("avatar", 48)} alt="" className="dhFlipX" />
          </div>
          <p className="dialogText">Decorate one house together! Pair up with your partner in 98 Messenger first, and then you'll both be able to open and decorate the same Dream House, live.</p>
          <p className="dialogText">Until then, this house is all yours (and saved on this computer).</p>
        </Dialog>
      )}
      {dialog?.kind === "share-ask" && (
        <Dialog title="Share with Partner" onCancel={() => setDialog(null)}>
          <p className="dialogText">Decorate one house together with {paired?.partner}. Only the two of you can see it.</p>
          {dialog.loading || dialog.busy ? (
            <p className="dialogText">Checking...</p>
          ) : (
            <div className="dhShareChoices">
              {dialog.exists && (
                <button type="button" onClick={() => startSharing(false)}>
                  Open our house
                </button>
              )}
              <button type="button" onClick={() => (dialog.exists ? setDialog({ kind: "share-replace" }) : startSharing(true))}>
                {dialog.exists ? "Replace it with this house" : "Share this house"}
              </button>
              {dialog.error && <p className="dialogText dhError">{dialog.error}</p>}
            </div>
          )}
        </Dialog>
      )}
      {dialog?.kind === "share-replace" && (
        <Dialog title="Share with Partner" okLabel="Replace" onOk={() => startSharing(true)} onCancel={() => setDialog(null)} sound="chord">
          <p className="dialogText">Replace the house you share with {paired?.partner} with this one? Everything in the shared house now will be gone, for both of you.</p>
        </Dialog>
      )}
      {dialog?.kind === "share-on" && (
        <Dialog title="Share with Partner" onCancel={() => setDialog(null)}>
          <p className="dialogText">You and {paired?.partner} are decorating this house together. Changes show up for both of you right away.</p>
          <div className="dhShareChoices">
            <button type="button" onClick={stopSharing}>
              Go back to my own house
            </button>
            <button type="button" onClick={() => setDialog({ kind: "share-delete" })}>
              Delete our shared house...
            </button>
          </div>
        </Dialog>
      )}
      {dialog?.kind === "share-delete" && (
        <Dialog title="Delete Shared House" okLabel="Delete" onOk={deleteShared} onCancel={() => setDialog(null)} sound="chord">
          <p className="dialogText">Delete the house you share with {paired?.partner}? It's gone for both of you. (Your own house stays.)</p>
        </Dialog>
      )}
    </div>
  )
}

// Dress Up: a person's name, skin, hair, outfit and accessory, with a live preview
const PersonDialog = ({ value, onOk, onCancel }) => {
  const [name, setName] = useState(value.name || "")
  const [look, setLook] = useState(() => M.cleanLook(value.look))
  const canvasRef = useRef(null)
  const set = (k, v) => setLook((l) => ({ ...l, [k]: v }))

  useEffect(() => {
    const canvas = canvasRef.current
    let raf = 0
    const start = performance.now()
    const frame = () => {
      raf = requestAnimationFrame(frame)
      const c = canvas.getContext("2d")
      c.setTransform(1, 0, 0, 1, 0, 0)
      c.clearRect(0, 0, canvas.width, canvas.height)
      const g = c.createRadialGradient(canvas.width / 2, canvas.height * 0.55, 10, canvas.width / 2, canvas.height * 0.55, canvas.width * 0.7)
      g.addColorStop(0, "#fff6fb")
      g.addColorStop(1, "#ffd6e5")
      c.fillStyle = g
      c.fillRect(0, 0, canvas.width, canvas.height)
      c.setTransform(2.4, 0, 0, 2.4, canvas.width / 2 - 22 * 2.4, 14)
      drawPerson(c, 44, 98, look, { t: (performance.now() - start) / 1000 })
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [look])

  const swatches = (key, list) => (
    <div className="dhLookRow" role="radiogroup">
      {list.map((color, i) => (
        <button key={i} type="button" role="radio" aria-checked={look[key] === i} aria-label={`${key} ${i + 1}`} className={look[key] === i ? "dhDot is-on" : "dhDot"} style={{ background: color }} onClick={() => set(key, i)} />
      ))}
    </div>
  )
  const words = (key, list) => (
    <div className="dhLookRow" role="radiogroup">
      {list.map((id) => (
        <button key={id} type="button" role="radio" aria-checked={look[key] === id} className={look[key] === id ? "dhWord is-on" : "dhWord"} onClick={() => set(key, id)}>
          {LOOK_NAMES[key][id]}
        </button>
      ))}
    </div>
  )

  return (
    <Dialog title="Dress Up" onOk={() => onOk({ name, look })} onCancel={onCancel}>
      <div className="dhDress">
        <canvas ref={canvasRef} width="130" height="260" className="dhDressPreview" aria-label="Preview" />
        <div className="dhDressFields">
          <label className="dhField">
            Name:
            <input id="dh-person-name" type="text" maxLength={M.MAX_NAME} value={name} placeholder="(no name tag)" onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="dhLabel">Skin</div>
          {swatches("skin", SKINS)}
          <div className="dhLabel">Hair</div>
          {words("hairStyle", HAIR_STYLES)}
          {swatches("hair", HAIR_COLORS)}
          <div className="dhLabel">Outfit</div>
          {words("outfit", OUTFITS)}
          <div className="dhLabel">Top</div>
          {swatches("top", CLOTHES)}
          <div className="dhLabel">Bottom</div>
          {swatches("bottom", CLOTHES)}
          <div className="dhLabel">Extra</div>
          {words("acc", ACCESSORIES)}
        </div>
      </div>
    </Dialog>
  )
}

export default Dollhouse
