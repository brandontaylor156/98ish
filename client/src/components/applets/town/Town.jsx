import React, { useEffect, useRef, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import Dialog from "../../shared/Dialog"
import * as G from "./game"
import { COMMUNITY, CROPS, HOUSES, PENS, itemName, kindOf, sizeOf, typeName, unlocksAt } from "./data"
import { isoX, isoY, setSpriteScale, getSpriteScale } from "./art"
import { clampView, drawScene, emitSmoke, expansionAt, groundObjectAt, objectAt, toScreen, toTile, toWorld, topOf, wildItems } from "./render"
import { createSounds } from "./audio"
import { BarnPanel, Chip, ExpandPanel, FactoryPanel, HelpPanel, Icon, LevelPanel, OrdersPanel, ShopPanel, TrainPanel, fmtTime } from "./panels"
import { unlock } from "../../../utils/achievements"
import "./Town.css"

// Sunny Acres: grow crops, raise animals, run factories, fill helicopter orders and the
// train, and build a little town. Rules live in game.js, drawing in art.js / render.js.
// Everything saves to this browser, and timers keep running while the game is closed.

const SAVE_KEY = "98ish.town"
let devSkew = 0 // dev builds only: tests fast-forward time with window.__town.skip()
const clockNow = () => Date.now() + devSkew

const loadGame = (now) => {
  try {
    const text = localStorage.getItem(SAVE_KEY)
    if (text) {
      const s = G.deserialize(text, now)
      if (s) return s
    }
  } catch {
    // storage blocked: a fresh town for this visit
  }
  return G.newGame(now)
}

const TUTORIAL = [
  "Welcome to Sunny Acres! Tap an empty field and plant some wheat. Drag across the other fields to plant them too.",
  "Wheat grows fast here. When it turns golden, swipe across the fields to harvest it!",
  "Your wheat went to the Barn. Now tap the Feed Mill and make some Cow Feed.",
  "The mill is grinding. When the Cow Feed is ready, tap the Feed Mill to collect it.",
  "A farmer needs supplies! Tap Orders and deliver the first order.",
]

const Town = ({ onClose, onTitle, mobile }) => {
  const rootRef = useRef(null)
  const stageRef = useRef(null)
  const canvasRef = useRef(null)
  const game = useRef(null)
  if (!game.current) game.current = loadGame(clockNow())
  const s = game.current
  const view = useRef({ cx: isoX(12, 12), cy: isoY(12, 12), z: 1, W: 1, H: 1 })
  const fx = useRef({ t: 0, now: 0, floaters: [], puffs: [], heli: null, train: null, ghost: null, arrow: null, wild: [], wildKey: "" })
  const sounds = useRef(null)
  if (!sounds.current) sounds.current = createSounds()
  const armed = useRef("wheat") // the seed a planting swipe uses
  const dirty = useRef(false)

  const [, setVer] = useState(0)
  const bump = () => setVer((v) => v + 1)
  const [panel, setPanelState] = useState(null) // { k: "shop" | "barn" | "orders" | "train" | "factory" | "expand" | "help", ... }
  const [levels, setLevels] = useState([]) // level-up cards waiting to be shown
  const [tray, setTray] = useState(null) // the seed tray: { id } of the field that opened it
  const [info, setInfo] = useState(null) // the card about a tapped building: { id }
  const [place, setPlace] = useState(null) // placing or moving: { type, x, y, flip, id? }
  const [edit, setEdit] = useState(false) // Move mode
  const [toast, setToast] = useState(null)
  const [confirmNew, setConfirmNew] = useState(false)
  const [soundOn, setSoundOn] = useState(true)
  const [shopTab, setShopTab] = useState("farm")
  // opening a window puts away the seed tray and the info card
  const setPanel = (p) => {
    setPanelState(p)
    if (p) {
      setTray(null)
      setInfo(null)
    }
  }
  const [compact, setCompact] = useState(false)
  const toastTimer = useRef(0)

  const play = (name) => sounds.current.play(name)
  const say = (text, sound = "error") => {
    setToast(text)
    if (sound) play(sound)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2600)
  }
  const changed = () => {
    dirty.current = true
    bump()
  }
  const save = () => {
    try {
      localStorage.setItem(SAVE_KEY, G.serialize(game.current))
      dirty.current = false
    } catch {
      // storage full or blocked
    }
  }

  // ---- floating rewards on the map ----
  const floatAt = (o, icon, text, color, delay = 0) => {
    const [x, y] = topOf(o)
    fx.current.floaters.push({ x, y: o.t === "field" ? y + 6 : y, icon, text, color, t0: fx.current.t + delay })
  }

  // ---- events from the rules (level ups, finished buildings, the train) ----
  const handleEvents = () => {
    const ev = G.drainEvents(game.current)
    if (!ev.length) return
    for (const e of ev) {
      if (e.type === "level") {
        // several levels at once share one card (the first card may already be showing)
        setLevels((l) => {
          const card = { level: e.level, gifts: e.gifts, unlocks: unlocksAt(e.level) }
          if (l.length < 2) return [...l, card]
          const last = l[l.length - 1]
          const gifts = { ...last.gifts }
          for (const [k, n] of Object.entries(e.gifts)) gifts[k] = (gifts[k] || 0) + n
          return [...l.slice(0, -1), { level: e.level, gifts, unlocks: [...last.unlocks, ...card.unlocks] }]
        })
        play("levelUp")
        if (e.level >= 10) unlock("town-mayor")
      } else if (e.type === "built") {
        const o = G.objById(game.current, e.id)
        if (o) floatAt(o, "check", typeName(o.t))
        play("built")
      } else if (e.type === "train") {
        fx.current.train = { in: fx.current.t }
        play("whistle")
      } else if (e.type === "delivered") {
        fx.current.heli = fx.current.t
        play("heli")
      }
    }
    changed()
  }

  // ---- actions ----
  const act = (result, onOk) => {
    if (!result.ok) {
      say(result.reason)
      return false
    }
    onOk?.(result)
    handleEvents()
    changed()
    return true
  }

  const harvestField = (o) =>
    act(G.harvest(s, o.i, clockNow()), (r) => {
      floatAt(o, r.good, `+${r.n}`)
      play("harvest")
    })
  const plantField = (o, crop) =>
    act(G.plant(s, o.i, crop, clockNow()), () => {
      const c = CROPS.find((x) => x.id === crop)
      if (c.seed) floatAt(o, "coin", `-${c.seed}`, "#ffd0c0")
      play("plant")
    })
  const feed = (o) =>
    act(G.feedPen(s, o.i, clockNow()), () => {
      play("feed")
      play(PENS[o.t].animal === "cow" ? "moo" : PENS[o.t].animal === "chicken" ? "cluck" : "baa")
    })
  const collectPen = (o) =>
    act(G.collectPen(s, o.i, clockNow()), (r) => {
      floatAt(o, r.good, `+${r.n}`)
      play("collect")
    })
  const collectFactory = (o, quiet) => {
    const r = G.collectFactory(s, o.i, clockNow())
    if (!r.ok) {
      if (!quiet) say(r.reason)
      return false
    }
    floatAt(o, r.goods[0], `+${r.goods.length}`)
    play("collect")
    handleEvents()
    changed()
    return true
  }

  // ---- placing buildings ----
  const centerTile = () => {
    const v = view.current
    const [u, w] = toTile(v.cx, v.cy)
    return [Math.floor(u), Math.floor(w)]
  }
  const freeSpot = (type, ignore) => {
    const [cx, cy] = centerTile()
    const n = sizeOf(type)
    for (let r = 0; r < 30; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
          const x = cx + dx - Math.floor(n / 2)
          const y = cy + dy - Math.floor(n / 2)
          if (G.canPlace(s, type, x, y, ignore)) return [x, y]
        }
    return null
  }
  const startBuild = (type) => {
    setPanel(null)
    const spot = freeSpot(type)
    if (!spot) {
      say("There's no room. Clear more land in the Shop!")
      return
    }
    setPlace({ type, x: spot[0], y: spot[1], flip: false })
    setInfo(null)
    setTray(null)
    play("tap")
  }
  const startMove = (o) => {
    setPlace({ type: o.t, x: o.x, y: o.y, flip: !!o.f, id: o.i })
    setInfo(null)
    play("tap")
  }
  const confirmPlace = () => {
    const p = place
    if (!p) return
    if (p.id) {
      if (!act(G.move(s, p.id, p.x, p.y, p.flip))) return
      play("build")
    } else {
      const r = G.build(s, p.type, p.x, p.y, clockNow())
      if (!r.ok) return say(r.reason)
      if (p.flip) r.obj.f = 1
      play("build")
      handleEvents()
      changed()
      // fields: keep placing more while you can afford them
      if (p.type === "field" && !G.offer(s, "field").why) {
        const spot = freeSpot("field")
        if (spot) return setPlace({ ...p, x: spot[0], y: spot[1] })
      }
    }
    setPlace(null)
  }
  const sellPlaced = () => {
    const p = place
    if (!p?.id) return
    act(G.sellObj(s, p.id), (r) => {
      play("coins")
      say(`Sold for ${r.coins} coins.`, null)
      setPlace(null)
    })
  }

  // ---- tapping things on the map ----
  const tapObject = (o) => {
    const now = clockNow()
    if (o.b) return setInfo({ id: o.i })
    const kind = kindOf(o.t)
    if (kind === "field") {
      const stage = G.fieldStage(o, now)
      if (stage === 0) {
        if (tray) plantField(o, armed.current)
        else setTray({ id: o.i })
        setInfo(null)
      } else if (stage < 4) {
        setInfo({ id: o.i })
        setTray(null)
      }
      return
    }
    setTray(null)
    if (kind === "pen") return setInfo({ id: o.i })
    if (kind === "factory") {
      collectFactory(o, true)
      setInfo(null)
      return setPanel({ k: "factory", id: o.i })
    }
    if (o.t === "barn") return setPanel({ k: "barn" })
    if (o.t === "helipad") return setPanel({ k: "orders" })
    if (o.t === "station") {
      if (s.level < 5) return say("The train starts coming at level 5.", "tap")
      return setPanel({ k: "train" })
    }
    setInfo({ id: o.i })
    play("tap")
  }

  const tapAt = (sx, sy) => {
    const v = view.current
    const [wx, wy] = toWorld(v, sx, sy)
    if (place) {
      // tapping the map moves what you're placing there
      const n = sizeOf(place.type)
      const [u, w] = toTile(wx, wy)
      setPlace({ ...place, x: Math.floor(u - n / 2 + 0.5), y: Math.floor(w - n / 2 + 0.5) })
      return
    }
    const o = objectAt(s, wx, wy)
    if (edit) {
      if (o && G.MOVABLE(o)) startMove(o)
      return
    }
    if (o) return tapObject(o)
    const [u, w] = toTile(wx, wy)
    const k = expansionAt(s, Math.floor(u), Math.floor(w))
    if (k >= 0) return setPanel({ k: "expand", i: k })
    setTray(null)
    setInfo(null)
  }

  // ---- pointers: pan, pinch, tap and swipes ----
  const gesture = useRef(null)
  const pointers = useRef(new Map())
  const localPoint = (e) => {
    const r = canvasRef.current.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }

  // a swipe touches everything under the finger, once each
  const swipeAt = (g, sx, sy) => {
    const [wx, wy] = toWorld(view.current, sx, sy)
    const o = groundObjectAt(s, wx, wy)
    if (!o || g.done.has(o.i) || o.b) return
    const now = clockNow()
    if (g.kind === "harvest" && o.t === "field" && G.fieldStage(o, now) === 4) {
      g.done.add(o.i)
      if (!harvestField(o)) g.stop = true
    } else if (g.kind === "plant" && o.t === "field" && !o.c) {
      g.done.add(o.i)
      if (!plantField(o, g.crop)) g.stop = true
    } else if (g.kind === "collect" && o.t === g.type && G.penState(o, now).ready) {
      g.done.add(o.i)
      collectPen(o)
    } else if (g.kind === "feed" && o.t === g.type && G.penState(o, now).hungry) {
      g.done.add(o.i)
      if (!feed(o)) g.stop = true
    }
  }
  const swipeTo = (g, sx, sy) => {
    // fill in the path so fast swipes don't skip fields
    const [lx, ly] = g.last
    const steps = Math.max(1, Math.ceil(Math.hypot(sx - lx, sy - ly) / 6))
    for (let k = 1; k <= steps && !g.stop; k++) swipeAt(g, lx + ((sx - lx) * k) / steps, ly + ((sy - ly) * k) / steps)
    g.last = [sx, sy]
  }

  const onPointerDown = (e) => {
    if (e.button !== undefined && e.button > 0 && e.pointerType === "mouse") return
    rootRef.current?.focus({ preventScroll: true })
    canvasRef.current.setPointerCapture?.(e.pointerId)
    const [sx, sy] = localPoint(e)
    pointers.current.set(e.pointerId, [sx, sy])
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      const v = view.current
      gesture.current = { kind: "pinch", d0: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, z0: v.z, mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], world: toWorld(v, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2) }
      return
    }
    if (pointers.current.size > 2) return
    const v = view.current
    const [wx, wy] = toWorld(v, sx, sy)
    const now = clockNow()
    if (place) {
      const n = sizeOf(place.type)
      const [u, w] = toTile(wx, wy)
      if (u >= place.x - 0.5 && u < place.x + n + 0.5 && w >= place.y - 0.5 && w < place.y + n + 0.5) {
        gesture.current = { kind: "ghost", off: [u - place.x, w - place.y], moved: false }
        return
      }
    } else if (!edit) {
      const o = groundObjectAt(s, wx, wy)
      if (o && !o.b) {
        const start = (g) => {
          gesture.current = { ...g, done: new Set(), last: [sx, sy] }
          swipeAt(gesture.current, sx, sy)
        }
        if (o.t === "field") {
          const stage = G.fieldStage(o, now)
          if (stage === 4) return start({ kind: "harvest" })
          if (stage === 0 && tray) return start({ kind: "plant", crop: armed.current })
        }
        if (PENS[o.t]) {
          const st = G.penState(o, now)
          if (st.ready) return start({ kind: "collect", type: o.t })
          if (st.hungry && G.have(s, PENS[o.t].feed)) return start({ kind: "feed", type: o.t })
        }
      }
    }
    gesture.current = { kind: "press", start: [sx, sy], cam: [v.cx, v.cy] }
  }

  const onPointerMove = (e) => {
    if (!pointers.current.has(e.pointerId)) return
    const [sx, sy] = localPoint(e)
    pointers.current.set(e.pointerId, [sx, sy])
    const g = gesture.current
    if (!g) return
    const v = view.current
    if (g.kind === "pinch") {
      if (pointers.current.size < 2) return
      const [a, b] = [...pointers.current.values()]
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
      v.z = Math.max(0.45, Math.min(2.6, (g.z0 * d) / g.d0))
      // keep the world point under the fingers' midpoint
      v.cx = g.world[0] - (mid[0] - v.W / 2) / v.z
      v.cy = g.world[1] - (mid[1] - v.H / 2) / v.z
      clampView(v)
      return
    }
    if (g.kind === "press" || g.kind === "pan") {
      const dx = sx - g.start[0]
      const dy = sy - g.start[1]
      if (g.kind === "press" && Math.hypot(dx, dy) > 8) g.kind = "pan"
      if (g.kind === "pan") {
        v.cx = g.cam[0] - dx / v.z
        v.cy = g.cam[1] - dy / v.z
        clampView(v)
      }
      return
    }
    if (g.kind === "ghost") {
      const [wx, wy] = toWorld(v, sx, sy)
      const [u, w] = toTile(wx, wy)
      const x = Math.floor(u - g.off[0] + 0.5)
      const y = Math.floor(w - g.off[1] + 0.5)
      if (x !== place.x || y !== place.y) setPlace((p) => p && { ...p, x, y })
      return
    }
    if (!g.stop) swipeTo(g, sx, sy)
  }

  const onPointerUp = (e) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.delete(e.pointerId)
    const g = gesture.current
    if (g?.kind === "pinch") {
      // the finger still down starts a fresh pan, so the map doesn't jump
      const rest = [...pointers.current.values()][0]
      const v = view.current
      gesture.current = rest ? { kind: "pan", start: rest, cam: [v.cx, v.cy] } : null
      return
    }
    if (pointers.current.size) return
    gesture.current = null
    if (g?.kind === "press" && e.type === "pointerup") {
      const [sx, sy] = localPoint(e)
      tapAt(sx, sy)
    }
  }

  const onWheel = (e) => {
    e.preventDefault()
    const v = view.current
    const [sx, sy] = localPoint(e)
    const [wx, wy] = toWorld(v, sx, sy)
    v.z = Math.max(0.45, Math.min(2.6, v.z * Math.pow(1.0015, -e.deltaY)))
    v.cx = wx - (sx - v.W / 2) / v.z
    v.cy = wy - (sy - v.H / 2) / v.z
    clampView(v)
  }

  // dragging a seed from the tray onto the fields
  const seedDrag = (e, crop) => {
    e.preventDefault()
    armed.current = crop
    bump()
    const g = { kind: "plant", crop, done: new Set(), last: null, seed: true }
    const move = (ev) => {
      const [sx, sy] = localPoint(ev)
      if (!g.last) {
        g.last = [sx, sy]
        swipeAt(g, sx, sy)
      } else if (!g.stop) swipeTo(g, sx, sy)
    }
    const up = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      window.removeEventListener("pointercancel", up)
      // a plain tap on a seed plants the field that opened the tray
      if (!g.done.size && tray) {
        const o = G.objById(s, tray.id)
        if (o && !o.c) plantField(o, crop)
      }
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
    window.addEventListener("pointercancel", up)
  }

  // ---- keyboard ----
  const onKeyDown = (e) => {
    const v = view.current
    const step = 60 / v.z
    if (e.key === "Escape") {
      if (place) setPlace(null)
      else if (panel) setPanel(null)
      else if (edit) setEdit(false)
      else {
        setTray(null)
        setInfo(null)
      }
    } else if (e.key === "ArrowLeft") v.cx -= step
    else if (e.key === "ArrowRight") v.cx += step
    else if (e.key === "ArrowUp") v.cy -= step
    else if (e.key === "ArrowDown") v.cy += step
    else if (e.key === "+" || e.key === "=") v.z *= 1.2
    else if (e.key === "-") v.z /= 1.2
    else if (e.key === "Enter" && place) confirmPlace()
    else return
    clampView(v)
    e.preventDefault()
  }

  // ---- the frame loop ----
  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext("2d")
    let raf = 0
    let lastTick = 0
    let lastSmoke = 0
    let scaleAt = 0
    let frames = 0
    let fpsAt = performance.now()
    const v = view.current
    let first = true
    const perf = { fps: 0 }
    const frame = (ms) => {
      raf = requestAnimationFrame(frame)
      const stage = canvas.parentElement
      const W = stage.clientWidth
      const H = stage.clientHeight
      if (!W || !H) return
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
        canvas.width = Math.round(W * dpr)
        canvas.height = Math.round(H * dpr)
      }
      v.W = W
      v.H = H
      if (first) {
        // start over the farm, zoomed so it fills the window nicely
        first = false
        v.z = Math.max(0.7, Math.min(1.3, W / 820))
        v.cx = isoX(12, 12)
        v.cy = isoY(12, 12) - 20
      }
      clampView(v)
      const now = clockNow()
      const f = fx.current
      f.t = ms / 1000
      f.now = now
      const g = game.current
      if (ms - lastTick > 250) {
        lastTick = ms
        G.tick(g, now)
        handleEvents()
      }
      if (ms - lastSmoke > 420) {
        lastSmoke = ms
        emitSmoke(g, f, now)
      }
      // crisp sprites: redraw them when the zoom settles at a new level
      const want = Math.min(2.5, Math.max(1, Math.ceil(v.z * dpr * 2) / 2))
      if (want !== getSpriteScale() && ms - scaleAt > 300 && gesture.current?.kind !== "pinch") {
        scaleAt = ms
        setSpriteScale(want)
      }
      const key = g.exp.join("")
      if (key !== f.wildKey) {
        f.wildKey = key
        f.wild = wildItems(g)
      }
      f.arrow = arrowFor(g, now)
      ctx.setTransform(dpr * v.z, 0, 0, dpr * v.z, dpr * (W / 2 - v.cx * v.z), dpr * (H / 2 - v.cy * v.z))
      drawScene(ctx, g, v, f)
      frames++
      if (ms - fpsAt > 1000) {
        perf.fps = (frames * 1000) / (ms - fpsAt)
        frames = 0
        fpsAt = ms
      }
    }
    raf = requestAnimationFrame(frame)
    if (import.meta.env.DEV) {
      window.__town = {
        state: () => game.current,
        view: () => view.current,
        fps: () => perf.fps,
        now: clockNow,
        skip: (sec) => {
          devSkew += sec * 1000
        },
        // where a tile's middle is on the page
        tileToPage: (u, w) => {
          const r = canvas.getBoundingClientRect()
          const [x, y] = toScreen(view.current, isoX(u, w), isoY(u, w))
          return [r.left + x, r.top + y]
        },
        xp: (n) => {
          G.addXp(game.current, n, clockNow())
          handleEvents()
        },
        give: (id, n) => {
          G.give(game.current, id, n)
          changed()
        },
        save,
      }
    }
    return () => {
      cancelAnimationFrame(raf)
      if (import.meta.env.DEV) delete window.__town
    }
  }, [])

  // where the tutorial's arrow points
  const arrowFor = (g, now) => {
    if (g.tut >= 5 || placeRef.current) return null
    const field = g.objs.filter((o) => o.t === "field")
    if (g.tut === 0) {
      const o = field.find((x) => !x.c)
      return o ? topOf(o) : null
    }
    if (g.tut === 1) {
      const o = field.find((x) => x.c)
      return o ? topOf(o) : null
    }
    if (g.tut === 2 || g.tut === 3) {
      const o = g.objs.find((x) => x.t === "feedmill")
      return o && !panelRef.current ? topOf(o) : null
    }
    return null
  }
  const placeRef = useRef(null)
  placeRef.current = place
  const panelRef = useRef(null)
  panelRef.current = panel
  useEffect(() => {
    fx.current.ghost = place ? { ...place } : null
  }, [place])

  // ---- once a second: timers in panels; every few seconds: save ----
  useEffect(() => {
    const id = setInterval(() => {
      bump()
      if (dirty.current) save()
    }, 1000)
    const away = () => save()
    window.addEventListener("pagehide", away)
    document.addEventListener("visibilitychange", away)
    return () => {
      clearInterval(id)
      window.removeEventListener("pagehide", away)
      document.removeEventListener("visibilitychange", away)
      save()
      sounds.current?.close()
    }
  }, [])

  // a narrow window gets a tighter layout
  useEffect(() => {
    const el = stageRef.current
    const ro = new ResizeObserver(() => setCompact(el.clientWidth < 560))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const onWheelRef = useRef(onWheel)
  onWheelRef.current = onWheel
  useEffect(() => {
    onTitle?.("Sunny Acres")
    rootRef.current?.focus({ preventScroll: true })
    // wheel zoom needs a non-passive listener to keep the page from scrolling
    const canvas = canvasRef.current
    const wheel = (e) => onWheelRef.current(e)
    canvas.addEventListener("wheel", wheel, { passive: false })
    return () => canvas.removeEventListener("wheel", wheel)
  }, [])

  // ---- the first delivery is an achievement ----
  const deliver = (i) =>
    act(G.deliverOrder(s, i, clockNow()), (r) => {
      play("delivered")
      unlock("town-order")
      const pad = s.objs.find((o) => o.t === "helipad")
      if (pad) {
        floatAt(pad, "coin", `+${r.order.coins}`)
        floatAt(pad, "xp", `+${r.order.xp}`, "#cfe6ff", 0.35)
      }
    })

  const now = clockNow()
  const prog = G.xpProgress(s)
  const pop = G.population(s)
  const cap = G.popCap(s)
  const infoObj = info && G.objById(s, info.id)
  const trayObj = tray && G.objById(s, tray.id)
  const panelObj = panel?.k === "factory" ? G.objById(s, panel.id) : null
  const level = levels[0]
  const closePanel = () => setPanel(null)

  const menus = [
    {
      label: "Game",
      items: [
        { label: "New Town...", onClick: () => setConfirmNew(true) },
        "-",
        {
          label: "Sounds",
          checked: soundOn,
          onClick: () => {
            sounds.current.setEnabled(!soundOn)
            setSoundOn(!soundOn)
          },
        },
        "-",
        { label: "Exit", onClick: () => onClose?.() },
      ],
    },
    {
      label: "Help",
      items: [{ label: "How to Play", onClick: () => setPanel({ k: "help" }) }],
    },
  ]

  return (
    <div className={`twRoot${compact ? " twCompact" : ""}${mobile ? " twMobile" : ""}`} ref={rootRef} tabIndex={0} onKeyDown={onKeyDown}>
      <MenuBar menus={menus} />
      <div className="twBody">
        <div className="twStage" ref={stageRef}>
          <canvas
            ref={canvasRef}
            className="twCanvas"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onContextMenu={(e) => e.preventDefault()}
          />

          {/* the top bar: level, coins, clovers, people */}
          <div className="twTop">
            <div className="twStat twLevelStat" title={`${prog.into} / ${prog.span} XP to level ${s.level + 1}`}>
              <span className="twStar">
                <Icon id="xp" size={36} />
                <b>{s.level}</b>
              </span>
              <span className="twXp">
                <span style={{ width: `${prog.frac * 100}%` }} />
              </span>
            </div>
            <div className="twStat" title="Coins">
              <Icon id="coin" size={20} />
              <b className="twCoins">{s.coins}</b>
            </div>
            <div className="twStat" title="Clovers: finish things right away">
              <Icon id="clover" size={20} />
              <b className="twClovers">{s.clovers}</b>
            </div>
            <div className="twStat" title="People in town / room for people">
              <Icon id="people" size={20} />
              <b className="twPop">
                {pop}/{cap}
              </b>
            </div>
          </div>

          {s.tut < 5 && !place && (
            <div className="twTutor">
              <span className="twTutorFace" aria-hidden="true">
                <Icon id="wheat" size={30} />
              </span>
              <span className="twTutorText">{TUTORIAL[s.tut]}</span>
            </div>
          )}
          {s.tut === 5 && (
            <div className="twTutor">
              <span className="twTutorFace" aria-hidden="true">
                <Icon id="check" size={30} />
              </span>
              <span className="twTutorText">Wonderful! Keep filling orders to earn coins and XP. Build houses from the Shop to grow your town.</span>
              <button
                type="button"
                className="twBtn"
                onClick={() => {
                  s.tut = 6
                  changed()
                }}
              >
                Got it
              </button>
            </div>
          )}

          {toast && (
            <div className="twToast" role="status">
              {toast}
            </div>
          )}

          {/* the seed tray */}
          {trayObj && !place && (
            <div className="twTray">
              <div className="twTrayHint">Tap a seed, or drag it across your fields</div>
              <div className="twSeeds">
                {CROPS.map((c) => {
                  const locked = c.lvl > s.level
                  return (
                    <button
                      key={c.id}
                      type="button"
                      className={`twSeed${armed.current === c.id ? " is-on" : ""}${locked ? " is-locked" : ""}`}
                      disabled={locked}
                      data-crop={c.id}
                      onPointerDown={(e) => !locked && seedDrag(e, c.id)}
                      title={locked ? `${c.name}: level ${c.lvl}` : `${c.name}: ${fmtTime((s.tut < 2 ? 5 : c.time) * 1000)}`}
                    >
                      <Icon id={locked ? "lock" : c.id} size={30} />
                      <small>{locked ? `Lv ${c.lvl}` : c.seed ? `${c.seed}` : "Free"}</small>
                    </button>
                  )
                })}
              </div>
              <button type="button" className="twBtn twTrayClose" aria-label="Close seeds" onClick={() => setTray(null)}>
                ✕
              </button>
            </div>
          )}

          {/* what you tapped */}
          {infoObj && !place && <InfoCard s={s} o={infoObj} now={now} onClose={() => setInfo(null)} onMove={() => startMove(infoObj)} onHurry={() => act(G.speedUp(s, { obj: infoObj.i }, clockNow()), () => play("coins"))} />}

          {/* placing or moving a building */}
          {place && (
            <div className="twPlaceBar">
              <span className="twPlaceName">
                {place.id ? "Move" : "Build"} {typeName(place.type)}
              </span>
              <button type="button" className="twBtn twGo" onClick={confirmPlace} disabled={!G.canPlace(s, place.type, place.x, place.y, place.id)}>
                <Icon id="check" size={18} /> {place.id ? "Put here" : "Build here"}
              </button>
              <button type="button" className="twBtn" onClick={() => setPlace({ ...place, flip: !place.flip })}>
                Flip
              </button>
              {place.id && G.sellValue(s, G.objById(s, place.id)) != null && (
                <button type="button" className="twBtn" onClick={sellPlaced}>
                  Sell <Chip id="coin" n={G.sellValue(s, G.objById(s, place.id))} />
                </button>
              )}
              <button type="button" className="twBtn" onClick={() => setPlace(null)}>
                Cancel
              </button>
            </div>
          )}

          {/* the bottom buttons */}
          {!place && (
            <div className="twBottom">
              <BigButton icon="shop" label="Shop" onClick={() => setPanel({ k: "shop" })} />
              <BigButton icon="barn" label="Barn" onClick={() => setPanel({ k: "barn" })} badge={G.barnFree(s) <= 0 ? "!" : null} />
              <BigButton icon="heli" label="Orders" className={s.tut === 4 ? "twPulse" : ""} onClick={() => setPanel({ k: "orders" })} badge={s.orders.filter((o, i) => G.canDeliver(s, i)).length || null} />
              {s.level >= 5 && <BigButton icon="train" label="Train" onClick={() => setPanel({ k: "train" })} badge={s.train.st === "here" ? "!" : null} />}
              <BigButton icon="move" label={edit ? "Done" : "Move"} className={edit ? "is-on" : ""} onClick={() => setEdit(!edit)} />
            </div>
          )}
          {edit && !place && <div className="twEditHint">Move mode: tap something to move it</div>}

          {panel?.k === "shop" && <ShopPanel s={s} tab={shopTab} setTab={setShopTab} onBuy={startBuild} onExpand={(k) => act(G.expand(s, k, clockNow()), () => (play("build"), closePanel()))} onClose={closePanel} />}
          {panel?.k === "barn" && (
            <BarnPanel
              s={s}
              onSell={(g, n) => act(G.sellGood(s, g, n), () => play("coins"))}
              onUpgrade={() => act(G.upgradeBarn(s), () => (play("build"), say("Your Barn got bigger!", null)))}
              onClose={closePanel}
            />
          )}
          {panel?.k === "orders" && (
            <OrdersPanel
              s={s}
              now={now}
              tut={s.tut === 4}
              onDeliver={deliver}
              onSkip={(i) => act(G.skipOrder(s, i, clockNow()), () => play("tap"))}
              onHurry={(i) => act(G.speedUp(s, { order: i }, clockNow()), () => play("coins"))}
              onClose={closePanel}
            />
          )}
          {panel?.k === "train" && (
            <TrainPanel
              s={s}
              now={now}
              onLoad={(k) => act(G.loadCar(s, k, clockNow()), () => play("collect"))}
              onSend={() => {
                const cars = s.train.cars.length
                act(G.sendTrain(s, clockNow()), (r) => {
                  fx.current.train = { out: fx.current.t, cars }
                  play("whistle")
                  if (r.bonus) say(`Train bonus: ${r.bonus.coins} coins, ${r.bonus.xp} XP and a clover!`, null)
                  closePanel()
                })
              }}
              onHurry={() => act(G.speedUp(s, { train: true }, clockNow()), () => play("coins"))}
              onClose={closePanel}
            />
          )}
          {panelObj && (
            <FactoryPanel
              s={s}
              o={panelObj}
              now={now}
              onMake={(g) => act(G.queueProduct(s, panelObj.i, g, clockNow()), () => play("queue"))}
              onCollect={() => collectFactory(panelObj)}
              onAddSlot={() => act(G.addSlot(s, panelObj.i), () => play("build"))}
              onHurry={() => act(G.speedUp(s, { obj: panelObj.i }, clockNow()), () => play("coins"))}
              onClose={closePanel}
            />
          )}
          {panel?.k === "expand" && <ExpandPanel s={s} k={panel.i} onExpand={() => act(G.expand(s, panel.i, clockNow()), () => (play("build"), closePanel()))} onClose={closePanel} />}
          {panel?.k === "help" && <HelpPanel onClose={closePanel} />}
          {level && <LevelPanel {...level} onClose={() => setLevels((l) => l.slice(1))} />}
          {confirmNew && (
            <Dialog
              title="New Town"
              okLabel="Start over"
              sound="chord"
              onOk={() => {
                game.current = G.newGame(clockNow())
                fx.current.wildKey = ""
                setConfirmNew(false)
                setPanel(null)
                setPlace(null)
                setLevels([])
                save()
                bump()
              }}
              onCancel={() => setConfirmNew(false)}
            >
              <p>Start a brand new town? Your fields, buildings and goods will be gone for good.</p>
            </Dialog>
          )}
        </div>
        {/* room for a side panel (a chat, say) to sit next to the map */}
      </div>
    </div>
  )
}

const BigButton = ({ icon, label, onClick, badge, className = "" }) => (
  <button type="button" className={`twBtn twBig ${className}`} onClick={onClick} data-btn={label}>
    <Icon id={icon} size={28} />
    <span>{label}</span>
    {badge ? <i className="twBadge">{badge}</i> : null}
  </button>
)

// the card about a building you tapped
const InfoCard = ({ s, o, now, onClose, onMove, onHurry }) => {
  const kind = kindOf(o.t)
  let status = null
  let hurry = G.speedUpCost(s, { obj: o.i }, now)
  if (o.b) status = `Being built: ${fmtTime(o.b - now)} left.`
  else if (kind === "field") {
    const c = CROPS.find((x) => x.id === o.c)
    status = c ? `${c.name}: ready in ${fmtTime(o.e - now)}.` : "An empty field."
  } else if (kind === "pen") {
    const p = PENS[o.t]
    const st = G.penState(o, now)
    const next = Math.min(...o.a.filter((t) => t !== null && t > now))
    status = [
      st.ready && `${st.ready} ${itemName(p.good)} ready to collect.`,
      st.busy && `${st.busy} eating (next in ${fmtTime(next - now)}).`,
      st.hungry && `${st.hungry} hungry: swipe with ${itemName(p.feed)} (you have ${G.have(s, p.feed)}).`,
    ]
      .filter(Boolean)
      .join(" ")
  } else if (HOUSES[o.t]) status = `Home to ${HOUSES[o.t].pop} people.`
  else if (COMMUNITY[o.t]) status = `Makes room for ${COMMUNITY[o.t].cap} people.`
  else status = "Looking lovely."
  return (
    <div className="twInfo" role="status">
      <b>{typeName(o.t)}</b>
      <span>{status}</span>
      <div className="twInfoBtns">
        {hurry > 0 && (
          <button type="button" className="twBtn twHurry" disabled={s.clovers < hurry} onClick={onHurry}>
            Hurry <Icon id="clover" size={16} />
            {hurry}
          </button>
        )}
        {G.MOVABLE(o) && (
          <button type="button" className="twBtn" onClick={onMove}>
            Move
          </button>
        )}
        <button type="button" className="twBtn" aria-label="Close" onClick={onClose}>
          ✕
        </button>
      </div>
    </div>
  )
}

export default Town
