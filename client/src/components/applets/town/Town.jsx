import React, { useEffect, useRef, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import Dialog from "../../shared/Dialog"
import * as G from "./game"
import { COMMUNITY, CROPS, HOUSES, PENS, itemName, kindOf, sizeOf, typeName, unlocksAt } from "./data"
import { isoX, isoY, setSpriteScale, getSpriteScale } from "./art"
import { clampView, drawScene, emitSmoke, expansionAt, groundObjectAt, noteAt, objectAt, toScreen, toTile, toWorld, topOf, wildItems } from "./render"
import { createSounds } from "./audio"
import { BarnPanel, Chip, ExpandPanel, FactoryPanel, HelpPanel, Icon, LevelPanel, OrdersPanel, ShopPanel, TrainPanel, fmtTime } from "./panels"
import { ConflictPanel, FriendsPanel, GiftOpening, GiftPanel, HelpRequestsPanel, NotePanel } from "./Friends"
import { CoopBanner, CoopPanel, CoopPicker, CoopTicker, FarmersPanel } from "./Coop"
import { createCoopSession } from "./coopClient"
import { GlobeIcon } from "../../shared/online/PlayOnlineButton"
import { useSocial } from "./cloud"
import { progress, unlock } from "../../../utils/achievements"
import { useCouple } from "../../../utils/couple"
import { keyOf, useAim } from "../aim/AimContext"
import { useNet } from "../network/NetContext"
import GameChat, { useGameChatMenuItem } from "../../shared/GameChat"
import "./Town.css"

// Sunny Acres: grow crops, raise animals, run factories, fill helicopter orders and the
// train, and build a little town. Rules live in game.js, drawing in art.js / render.js.
// Everything saves to this browser, and timers keep running while the game is closed.
// Signed in to 98 Messenger, the town is also kept in the cloud and friends can visit,
// help with orders and send gifts (cloud.js, Friends.jsx, server/town).
// A co-op town (Coop.jsx, coopClient.js, server/town/coop.js) is farmed by up to four people
// at once: the server keeps it, and its clock is the one that counts while you're there.

const SAVE_KEY = "98ish.town"
const COOP_KEY = "98ish.town.coop" // { [account]: the co-op town to go back to after a reload }
let devSkew = 0 // dev builds only: tests fast-forward time with window.__town.skip()
let coopClock = null // in a co-op town: the server's clock
const clockNow = () => (coopClock ? coopClock() : Date.now() + devSkew)
const readCoop = (account) => {
  try {
    return JSON.parse(localStorage.getItem(COOP_KEY))?.[account] || null
  } catch {
    return null
  }
}
const writeCoop = (account, id) => {
  try {
    const all = JSON.parse(localStorage.getItem(COOP_KEY)) || {}
    if (id) all[account] = id
    else delete all[account]
    localStorage.setItem(COOP_KEY, JSON.stringify(all))
  } catch {
    // remembered for this visit only
  }
}

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

const Town = ({ onClose, onTitle, mobile, coopId = null }) => {
  const rootRef = useRef(null)
  const stageRef = useRef(null)
  const canvasRef = useRef(null)
  const game = useRef(null)
  if (!game.current) game.current = loadGame(clockNow())
  // a co-op town, while I'm in one: its session (coopClient.js); its view is the town on screen
  const coopRef = useRef(null)
  const [coopOn, setCoopOn] = useState(null) // the co-op town's id, once it's on screen
  const coopLive = coopRef.current?.st.view ? coopRef.current : null
  const active = () => coopRef.current?.st.view || game.current
  const s = coopLive ? coopLive.st.view : game.current
  // what changes the town: the game's rules, or (in a co-op town) the same rules, sent along
  const A = coopLive ? coopLive.actions : G
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
  // playing together
  const [visit, setVisit] = useState(null) // a friend's town: { owner, relation, s, hearts, myHearts, notes, requests }
  const visitRef = useRef(null)
  visitRef.current = visit
  const [friendsTab, setFriendsTab] = useState("visit")
  const [opening, setOpening] = useState(null) // a gift being unwrapped
  const visitors = useRef(new Map()) // friends walking around my town: name -> { u, v, tu, tv }

  const play = (name) => sounds.current.play(name)
  const say = (text, sound = "error") => {
    setToast(text)
    if (sound) play(sound)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2600)
  }
  // home: it's my own town that changed (even while I'm in a co-op town)
  const changed = (home = false) => {
    // a co-op town lives on the server: nothing to save here
    if (coopRef.current && home !== true) return bump()
    dirty.current = true
    // the cloud copy needs this change (social.js compares revisions)
    game.current.rev = (game.current.rev || 0) + 1
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
    const ev = G.drainEvents(active())
    if (!ev.length) return
    for (const e of ev) {
      if (e.type === "coop-ach") {
        say(`Co-op achievement: ${e.name}! ♥`, "levelUp")
        unlock("town-coop")
        continue
      }
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
        const o = G.objById(active(), e.id)
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
    act(A.harvest(s, o.i, clockNow()), (r) => {
      floatAt(o, r.good, `+${r.n}`)
      play("harvest")
    })
  const plantField = (o, crop) =>
    act(A.plant(s, o.i, crop, clockNow()), () => {
      const c = CROPS.find((x) => x.id === crop)
      if (c.seed) floatAt(o, "coin", `-${c.seed}`, "#ffd0c0")
      play("plant")
    })
  const feed = (o) =>
    act(A.feedPen(s, o.i, clockNow()), () => {
      play("feed")
      play(PENS[o.t].animal === "cow" ? "moo" : PENS[o.t].animal === "chicken" ? "cluck" : "baa")
    })
  const collectPen = (o) =>
    act(A.collectPen(s, o.i, clockNow()), (r) => {
      floatAt(o, r.good, `+${r.n}`)
      play("collect")
    })
  const collectFactory = (o, quiet) => {
    const r = A.collectFactory(s, o.i, clockNow())
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

  // ---- playing together (signed in to 98 Messenger) ----
  const aim = useAim()
  const net = useNet()
  const netRef = useRef(net)
  netRef.current = net
  const couple = useCouple()
  const me = aim?.status === "online" ? aim.me?.screenName || null : null
  const paired = couple.status === "paired" && !!couple.partner

  // changes from friends (help, gifts, the couple's goal), each used once
  const applyEffects = (list) => {
    const s = game.current
    for (const e of list) {
      const r = G.applyEffect(s, e, clockNow())
      if (!r.ok) continue
      const pad = s.objs.find((o) => o.t === "helipad")
      if (e.kind === "help") {
        if (r.filled && r.order && pad) {
          floatAt(pad, "coin", `+${r.order.coins}`)
          floatAt(pad, "xp", `+${r.order.xp}`, "#cfe6ff", 0.35)
        }
        say(r.filled ? `${e.by} filled your ${e.req.kind === "car" ? "train car" : "order"}! ♥` : `${e.by} sent goods for something you'd already done. They're in your Barn.`, "delivered")
      } else if (e.kind === "helped") {
        say(`You helped ${e.owner}! +${e.coins} coins, +${e.xp} XP`, "coins")
        progress("town-neighbor", e.id, 5)
      } else if (e.kind === "gave") unlock("town-gift")
      else if (e.kind === "goal") {
        say(`You and ${couple.partner || "your partner"} did it together! +${e.coins} coins ♥`, "levelUp")
        unlock("town-together")
      }
    }
    handleEvents()
    changed(true)
    save()
  }

  const onVisitor = (p) => {
    if (!p.name) return
    const map = visitors.current
    if (p.leave) {
      if (map.delete(p.name)) say(`${p.name} went home. Bye!`, null)
    } else {
      const cur = map.get(p.name)
      if (!cur) {
        const hall = game.current.objs.find((o) => o.t === "townhall")
        const [u, v] = hall ? [hall.x + 1.5, hall.y + 3.4] : [12, 12]
        map.set(p.name, { name: p.name, u, v, tu: p.u ?? u, tv: p.v ?? v })
        say(`${p.name} is visiting your town! ♥`, "tap")
      } else if (p.u !== undefined) Object.assign(cur, { tu: p.u, tv: p.v })
    }
    bump()
  }
  const onNews = (p) => {
    if (p.type === "note") say(`${p.by} left you a note! ♥`, "tap")
    else if (p.type === "gift") say(`${p.by} sent you a gift! Check your mailbox.`, "levelUp")
    else if (p.type === "heart") say(`${p.by} liked something in your town ♥`, null)
  }

  const social = useSocial({
    token: me ? aim.token : null,
    account: me ? keyOf(me) : null,
    socket: net?.socket,
    getGame: () => game.current,
    setGame: (s) => {
      game.current = s
      fx.current.wildKey = ""
      setPanel(null)
      setPlace(null)
      setLevels([])
      save()
      bump()
    },
    applyEffects,
    onVisitor,
    onNews,
    now: clockNow,
  })
  const socialRef = useRef(social)
  socialRef.current = social

  // the mailbox, and for couples the welcome sign with both names
  const placeSpecials = () => {
    const s = game.current
    let moved = G.ensureMailbox(s)
    if (paired && s.paired !== couple.partner) moved = G.setPartner(s, couple.partner) || true
    else if (couple.status === "single" && s.paired) {
      G.setPartner(s, null)
      moved = true
    }
    if (moved) changed(true)
  }
  useEffect(() => {
    if (social.status === "synced") placeSpecials()
  }, [social.status, couple.status, couple.partner])

  // ---- co-op towns: farming one town together, live ----
  const account = me ? keyOf(me) : null
  const coopAvatars = useRef(new Map()) // pid -> the other farmers walking about: { name, color, u, v, tu, tv }
  const [nudge, setNudge] = useState(null) // { id, by, name }: someone's farming in my co-op town
  const coopEv = useRef({})
  const coopCalls = useRef(null)
  if (!coopCalls.current) coopCalls.current = new Proxy({}, { get: (_, k) => (...args) => coopEv.current[k]?.(...args) })
  coopEv.current = {
    update: () => bump(),
    // turned down by the server (someone else got there first): gently
    reject: (reason) => say(reason, "tap"),
    // level ups, deliveries, the train... from the others, or from time passing
    events: (ev) => {
      const v = coopRef.current?.st.view
      if (!v) return
      ;(v.ev ||= []).push(...ev)
      handleEvents()
    },
    // floaters over what the others just did
    activity: (p, before) => {
      const v = coopRef.current?.st.view
      if (!v || !p.done?.length) return
      if (p.a === "harvest") {
        for (const i of p.done.slice(0, 12)) {
          const o = G.objById(v, i)
          if (o) floatAt(o, before?.[i]?.c || "wheat", `+${G.HARVEST_YIELD}`, p.color)
        }
        return
      }
      const o = G.objById(v, p.done[0])
      if (o) floatAt(o, null, p.by, p.color)
      if (p.a === "build") play("build")
    },
    players: (quiet = false) => {
      const st = coopRef.current?.st
      if (!st) return
      const now = new Set(st.players.map((p) => p.pid))
      for (const p of st.players) {
        if (p.pid === st.you?.pid || coopAvatars.current.has(p.pid)) continue
        const hall = st.view?.objs.find((o) => o.t === "townhall")
        const [u, v] = hall ? [hall.x + 1.5, hall.y + 3.4] : [12, 12]
        coopAvatars.current.set(p.pid, { name: p.name, color: p.color, u, v, tu: p.cursor?.u ?? u, tv: p.cursor?.v ?? v })
        if (!quiet) say(`${p.name} came to farm! ♥`, "tap")
      }
      for (const [pid, a] of coopAvatars.current) {
        if (now.has(pid)) continue
        coopAvatars.current.delete(pid)
        if (!quiet) say(`${a.name} went home. Bye!`, null)
      }
    },
    // back on the network, but the town won't have me (no longer a member)
    failed: (r) => {
      if (!coopRef.current) return
      say(r?.error || "You're not in that co-op town any more.")
      leaveCoop()
    },
  }

  const enterCoop = async (id, { quiet = false } = {}) => {
    if (!id) return
    if (!net?.socket || net.status !== "online") return quiet ? null : say("Connect to the network first (98 Messenger).")
    if (coopRef.current?.st.id === id) return setPanel(null)
    if (visitRef.current) goHome()
    leaveCoop({ quiet: true })
    const session = createCoopSession({ id, request: net.request, socket: net.socket, on: coopCalls.current })
    coopRef.current = session
    const r = await session.join()
    if (coopRef.current !== session) return
    if (!r?.ok) {
      session.close()
      coopRef.current = null
      if (r?.private || /gone/.test(r?.error || "")) writeCoop(account, null)
      if (!quiet) say(r?.error || "Couldn't get into that town.")
      return bump()
    }
    coopClock = session.now
    writeCoop(account, id)
    setNudge(null)
    setCoopOn(id)
    setPanel(null)
    setEdit(false)
    setPlace(null)
    setInfo(null)
    setTray(null)
    setLevels([])
    fx.current.wildKey = ""
    coopAvatars.current.clear()
    coopEv.current.players(true)
    centerOn(12, 12)
    play("whistle")
    const others = session.st.players.filter((p) => p.pid !== session.st.you?.pid)
    say(others.length ? `${others.map((p) => p.name).join(" and ")} ${others.length > 1 ? "are" : "is"} here! Farm away ♥` : `Welcome to ${session.st.town?.name || "your co-op town"}!`, null)
  }
  const leaveCoop = ({ quiet = false } = {}) => {
    const session = coopRef.current
    if (!session) return
    session.close()
    coopRef.current = null
    coopClock = null
    coopAvatars.current.clear()
    setCoopOn(null)
    if (quiet) return
    writeCoop(account, null)
    setPanel(null)
    setPlace(null)
    setInfo(null)
    setTray(null)
    setEdit(false)
    setLevels([])
    fx.current.wildKey = ""
    centerOn(12, 12)
    say("Home sweet home!", null)
  }
  const quitCoop = async () => {
    const id = coopRef.current?.st.id
    if (!id) return
    const r = await net.request("coop:quit", { id })
    if (!r?.ok) return say(r?.error || "That didn't work.")
    leaveCoop()
  }
  // back after a reload (or opened from an invitation): straight into the co-op town
  const resumed = useRef(null)
  useEffect(() => {
    if (!account || net?.status !== "online" || coopRef.current) return
    const want = (resumed.current !== account && (coopId || readCoop(account))) || null
    resumed.current = account
    if (want) enterCoop(want, { quiet: !coopId })
  }, [account, net?.status])
  // the network came back: join again (the town catches me up)
  const wasOnline = useRef(false)
  useEffect(() => {
    const online = net?.status === "online"
    if (online && !wasOnline.current && coopRef.current) coopRef.current.join()
    wasOnline.current = online
  }, [net?.status])
  // an invitation accepted while the window is open; someone farming in my co-op town
  const enterRef = useRef(enterCoop)
  enterRef.current = enterCoop
  useEffect(() => {
    const open = (e) => enterRef.current(e.detail)
    window.addEventListener("98ish:town-coop", open)
    const sock = net?.socket
    const nudged = (p) => {
      if (!p?.id || coopRef.current?.st.id === p.id) return
      setNudge(p)
      play("tap")
    }
    sock?.on("coop:nudge", nudged)
    return () => {
      window.removeEventListener("98ish:town-coop", open)
      sock?.off("coop:nudge", nudged)
    }
  }, [net?.socket])
  useEffect(() => {
    if (!nudge) return
    const id = setTimeout(() => setNudge(null), 20_000)
    return () => clearTimeout(id)
  }, [nudge])
  // where I'm pointing (the others see my little farmer walk there); on a phone, where I'm looking
  const lastPoint = useRef({ at: 0, sent: 0 })
  const pointAt = (sx, sy) => {
    const session = coopRef.current
    if (!session || session.st.status !== "live") return
    const t = performance.now()
    lastPoint.current.at = t
    if (t - lastPoint.current.sent < 90) return
    lastPoint.current.sent = t
    const [wx, wy] = toWorld(view.current, sx, sy)
    const [u, w] = toTile(wx, wy)
    session.cursor(Math.max(0, Math.min(29.5, u)), Math.max(0, Math.min(29.5, w)))
  }
  useEffect(() => {
    if (!coopOn) return
    const id = setInterval(() => {
      const session = coopRef.current
      if (!session || performance.now() - lastPoint.current.at < 2500) return
      const v = view.current
      const [u, w] = toTile(v.cx, v.cy)
      session.cursor(Math.max(0, Math.min(29.5, u)), Math.max(0, Math.min(29.5, w)))
    }, 1000)
    return () => clearInterval(id)
  }, [coopOn])
  // closing the window leaves the co-op town
  useEffect(() => () => coopRef.current?.close(), [])

  const enc = encodeURIComponent
  const centerOn = (u, w) => {
    const v = view.current
    v.cx = isoX(u, w)
    v.cy = isoY(u, w)
    clampView(v)
  }
  const startVisit = async (name) => {
    if (coopRef.current) return say("Go home from the co-op town first.")
    const r = await social.call("GET", `/visit/${enc(name)}`)
    if (!r.ok) return say(r.error)
    const vs = G.migrate(r.snap)
    if (!vs) return say("That town couldn't be read.")
    G.tick(vs, clockNow())
    G.drainEvents(vs)
    setVisit({ owner: r.owner, relation: r.relation, s: vs, hearts: r.hearts || {}, myHearts: r.myHearts || [], notes: r.notes || [], requests: r.requests || [] })
    setPanel(null)
    setEdit(false)
    setPlace(null)
    setInfo(null)
    setTray(null)
    fx.current.wildKey = ""
    centerOn(12, 12)
    play("whistle")
    say(r.ownerOnline ? `${r.owner} is online! Say hi in the chat.` : `Welcome to ${r.owner}'s Sunny Acres!`, null)
  }
  const goHome = () => {
    if (visit) net?.socket?.emit("town:walk", { owner: visit.owner, leave: true })
    setVisit(null)
    setInfo(null)
    setPanel(null)
    fx.current.wildKey = ""
    centerOn(12, 12)
    social.refresh()
  }
  // tell the owner where I'm looking (my little avatar walks there)
  useEffect(() => {
    if (!visit || !net?.socket) return
    let last = null
    const tell = () => {
      const v = view.current
      const [u, w] = toTile(v.cx, v.cy)
      if (last && Math.hypot(u - last[0], w - last[1]) < 0.3) return
      last = [u, w]
      net.socket.emit("town:walk", { owner: visit.owner, u: Math.max(0, Math.min(29.5, u)), v: Math.max(0, Math.min(29.5, w)) })
    }
    tell()
    const id = setInterval(tell, 800)
    return () => clearInterval(id)
  }, [visit?.owner, net?.socket])
  // closing the window mid-visit says goodbye
  useEffect(() => () => visitRef.current && net?.socket?.emit("town:walk", { owner: visitRef.current.owner, leave: true }), [])

  const like = async (o) => {
    const r = await social.call("POST", `/visit/${enc(visit.owner)}/heart`, { obj: o.i })
    if (!r.ok) return say(r.error)
    setVisit((v) => v && { ...v, hearts: { ...v.hearts, [o.i]: r.count }, myHearts: r.mine ? [...v.myHearts, o.i] : v.myHearts.filter((x) => x !== o.i) })
    if (r.mine) {
      floatAt(o, "heart", "")
      play("collect")
    }
  }
  const leaveNote = async (text) => {
    const o = panel?.target ? G.objById(visit.s, panel.target) : null
    let x
    let y
    if (o) {
      const n = sizeOf(o.t)
      x = o.x + n / 2 + 0.25
      y = o.y + n + 0.35
    } else {
      const v = view.current
      ;[x, y] = toTile(v.cx, v.cy)
    }
    const r = await social.call("POST", `/visit/${enc(visit.owner)}/notes`, { text, x: Math.max(0.5, Math.min(29.5, x)), y: Math.max(0.5, Math.min(29.5, y)) })
    if (!r.ok) return r
    // three signs each: the server took down my oldest
    setVisit((v) => {
      if (!v) return v
      const mine = v.notes.filter((n) => n.mine)
      const drop = mine.length >= 3 ? mine[0].id : null
      return { ...v, notes: [...v.notes.filter((n) => n.id !== drop), r.note] }
    })
    setPanel(null)
    play("build")
    say(`Your sign is up in ${visit.owner}'s town! ♥`, null)
    return r
  }
  const removeNote = async (note) => {
    const r = visit ? await social.call("DELETE", `/visit/${enc(visit.owner)}/notes/${note.id}`) : await social.call("DELETE", `/notes/${note.id}`)
    if (!r.ok) return say(r.error)
    if (visit) setVisit((v) => v && { ...v, notes: v.notes.filter((n) => n.id !== note.id) })
    else social.setData((d) => ({ ...d, notes: (d?.notes || []).filter((n) => n.id !== note.id) }))
    setInfo(null)
    play("tap")
  }
  const helpFriend = async (req) => {
    await social.upload() // the server checks my Barn as last saved
    const r = await social.call("POST", `/visit/${enc(visit.owner)}/help/${req.id}`)
    if (!r.ok) {
      if (r.status === 409 && !r.short) setVisit((v) => v && { ...v, requests: v.requests.filter((x) => x.id !== req.id) })
      return r
    }
    applyEffects([r.effect])
    setVisit((v) => v && { ...v, requests: v.requests.filter((x) => x.id !== req.id) })
    const pad = visit.s.objs.find((o) => o.t === "helipad")
    if (req.kind === "order" && pad) fx.current.heli = fx.current.t
    setPanel(null)
    return r
  }
  const askHelp = async (kind, slot) => {
    await social.upload() // the server reads the order from the saved town
    const r = await social.call("POST", "/requests", { kind, slot })
    if (!r.ok) return say(r.error)
    social.setData((d) => ({ ...d, requests: [...(d?.requests || []).filter((x) => x.id !== r.request.id), r.request] }))
    say(paired ? `Asked ${couple.partner} and your friends for help!` : "Asked your friends for help!", "tap")
  }
  const cancelHelp = async (req) => {
    const r = await social.call("DELETE", `/requests/${req.id}`)
    if (!r.ok) return say(r.error)
    social.setData((d) => ({ ...d, requests: (d?.requests || []).map((x) => (x.id === req.id ? r.request : x)) }))
  }
  const sendGift = async (body) => {
    await social.upload()
    const r = await social.call("POST", "/gifts", body)
    if (!r.ok) return r
    applyEffects([r.effect])
    social.setData((d) => ({ ...d, giftsLeft: r.giftsLeft }))
    setPanel(null)
    say(`Your gift is on its way to ${couple.partner}! ♥`, "delivered")
    return r
  }
  const openGift = async (g) => {
    const n = Object.values(g.goods || {}).reduce((a, b) => a + b, 0)
    if (n > G.barnFree(game.current)) return say("Make room in your Barn first!")
    const r = await social.call("POST", `/mailbox/${g.id}/open`)
    if (!r.ok) return say(r.error)
    setPanel(null)
    setOpening(r.gift)
    play("levelUp")
    if (r.effect) applyEffects([r.effect])
    social.setData((d) => ({ ...d, mailbox: (d?.mailbox || []).map((x) => (x.id === g.id ? r.gift : x)) }))
  }
  const openFriends = (tab = "visit") => {
    setFriendsTab(tab)
    setPanel({ k: "friends" })
  }
  const showNote = (n) => {
    setPanel(null)
    centerOn(n.x, n.y)
    setInfo({ note: n })
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
      if (!act(A.move(s, p.id, p.x, p.y, p.flip))) return
      play("build")
    } else {
      const r = A.build(s, p.type, p.x, p.y, clockNow(), p.flip)
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
    act(A.sellObj(s, p.id), (r) => {
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
    if (o.t === "mailbox" && social.on && !coopLive) return openFriends("mail")
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
    const vis = visitRef.current
    if (vis) {
      // a friend's town: look, like, read their signs
      setTray(null)
      const n = noteAt(vis.notes, wx, wy)
      if (n) return setInfo({ note: n })
      const o = objectAt(vis.s, wx, wy)
      if (o && o.t !== "field") {
        play("tap")
        return setInfo({ id: o.i, visit: true })
      }
      return setInfo(null)
    }
    if (!place && !edit && !coopLive && social.data?.notes?.length) {
      const n = noteAt(social.data.notes, wx, wy)
      if (n) return setInfo({ note: n })
    }
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
    } else if (!edit && !visitRef.current) {
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
    if (coopRef.current) pointAt(...localPoint(e))
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
    let lastMs = performance.now()
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
      // my town, or the friend's town I'm visiting (mine keeps growing meanwhile)
      const vis = visitRef.current
      const co = coopRef.current?.st.view ? coopRef.current : null
      const g = vis ? vis.s : co ? co.st.view : game.current
      if (ms - lastTick > 250) {
        lastTick = ms
        // a co-op town's time is kept by the server
        if (!co) G.tick(game.current, now)
        if (vis) {
          G.tick(vis.s, now)
          G.drainEvents(vis.s)
        }
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
      const key = (vis ? vis.owner : co ? `coop:${co.st.id}` : "") + g.exp.join("")
      if (key !== f.wildKey) {
        f.wildKey = key
        f.wild = wildItems(g)
      }
      f.arrow = vis || co ? null : arrowFor(g, now)
      // friends: their notes and hearts, the welcome sign, the mailbox flag, visitors
      const sd = co ? null : socialRef.current.data
      f.notes = vis ? vis.notes : sd?.notes || null
      f.hearts = vis ? vis.hearts : sd?.hearts || null
      f.myHearts = vis ? vis.myHearts : null
      f.noteSel = infoRef.current?.note?.id
      const names = co?.st.members.map((m) => m.name) || []
      f.signNames = co ? { a: names[0] || "Our", b: names[1] || null } : { a: vis ? vis.owner : meRef.current, b: g.paired || null }
      f.mailFlag = !vis && (sd?.mailbox || []).some((m) => !m.openedAt)
      const dt = Math.min(0.1, (ms - lastMs) / 1000)
      lastMs = ms
      f.visitors = vis
        ? null
        : co
          ? co.st.players
              .filter((p) => p.pid !== co.st.you?.pid)
              .map((p) => {
                const a = coopAvatars.current.get(p.pid)
                if (!a) return null
                if (p.cursor) Object.assign(a, { tu: p.cursor.u, tv: p.cursor.v })
                const d = Math.hypot(a.tu - a.u, a.tv - a.v)
                const step = Math.min(d, dt * Math.max(4, d * 5))
                if (d > 0.001) {
                  a.u += ((a.tu - a.u) / d) * step
                  a.v += ((a.tv - a.v) / d) * step
                }
                a.moving = d > 0.05
                a.color = p.color
                a.doing = p.doing && Date.now() - (p.doingAt || 0) < 4000 ? p.doing : null
                return a
              })
              .filter(Boolean)
        : [...visitors.current.values()].map((p) => {
            const d = Math.hypot(p.tu - p.u, p.tv - p.v)
            const step = Math.min(d, dt * 2.2)
            if (d > 0.001) {
              p.u += ((p.tu - p.u) / d) * step
              p.v += ((p.tv - p.v) / d) * step
            }
            p.moving = d > 0.05
            return p
          })
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
        state: () => active(),
        home: () => game.current,
        coop: () => coopRef.current,
        enterCoop: (id) => enterRef.current(id),
        request: (event, payload) => netRef.current?.request(event, payload),
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
        changed,
        // playing together
        social: () => socialRef.current,
        visit: () => visitRef.current,
        sync: () => socialRef.current.upload(),
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
  const infoRef = useRef(null)
  infoRef.current = info
  const meRef = useRef(null)
  meRef.current = me
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

  const dropRequest = (kind, slot) => {
    const req = social.data?.requests?.find((r) => r.status === "open" && r.kind === kind && r.slot === slot)
    if (req) cancelHelp(req)
  }

  // ---- the first delivery is an achievement ----
  const deliver = (i) =>
    act(A.deliverOrder(s, i, clockNow()), (r) => {
      dropRequest("order", i)
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
  const shown = visit ? visit.s : s // the town on screen
  const infoObj = info?.id !== undefined ? G.objById(info.visit ? shown : s, info.id) : null
  const sd = social.data || {}
  const unopened = (sd.mailbox || []).filter((m) => !m.openedAt).length
  const helpProps = social.on && !visit && !coopLive ? { requests: sd.requests || [], onAsk: askHelp, onCancel: cancelHelp } : null
  const trayObj = tray && G.objById(s, tray.id)
  const panelObj = panel?.k === "factory" ? G.objById(s, panel.id) : null
  const level = levels[0]
  const closePanel = () => setPanel(null)
  const chatItem = useGameChatMenuItem("town")

  const menus = [
    {
      label: "Game",
      items: [
        { label: "New Town...", onClick: () => (visit ? say("Go home first!") : coopLive ? say("This is a co-op town: go home first to start over.") : setConfirmNew(true)) },
        "-",
        {
          label: "Sounds",
          checked: soundOn,
          onClick: () => {
            sounds.current.setEnabled(!soundOn)
            setSoundOn(!soundOn)
          },
        },
        chatItem,
        ...(social.on && !coopLive ? ["-", { label: "Friends...", onClick: () => (visit ? goHome() : openFriends("visit")) }] : []),
        ...(coopLive
          ? ["-", { label: "Farmers...", onClick: () => setPanel({ k: "farmers" }) }, { label: "Go Home", onClick: () => leaveCoop() }]
          : [
              { label: "Co-op Town...", onClick: () => (social.on && !visit ? openFriends("coop") : setPanel({ k: "coop" })) },
              { label: "Play Online...", onClick: () => (social.on && !visit ? openFriends("coop") : setPanel({ k: "coop" })) },
            ]),
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
      <GameChat game="town" title="Sunny Acres" room={coopLive ? `match:${coopLive.st.id}` : undefined} />
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
          {visit ? (
            <div className="twTop twVisitTop">
              <div className="twStat twLevelStat" title={`${visit.owner}'s level`}>
                <span className="twStar">
                  <Icon id="xp" size={36} />
                  <b>{visit.s.level}</b>
                </span>
              </div>
              <div className="twVisitBanner" role="status">
                <Icon id={visit.relation === "partner" ? "heart" : "friends"} size={20} />
                <span>
                  Visiting <b>{visit.owner}</b>'s Sunny Acres
                </span>
              </div>
            </div>
          ) : (
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
            {coopLive && (
              <div className={`twStat twCoopLive${net?.status === "online" ? "" : " is-off"}`} title={net?.status === "online" ? "Farming together, live" : "Reconnecting..."}>
                <i aria-hidden="true" />
                <small>{net?.status === "online" ? "Live" : "Reconnecting"}</small>
              </div>
            )}
            {social.on && !coopLive && (
              <div className={`twStat twCloud is-${social.status}`} title={social.status === "synced" ? "Saved in the cloud" : social.status === "syncing" ? "Saving to the cloud..." : "The cloud can't be reached; saved on this device"}>
                <span aria-hidden="true">☁</span>
                <small>{social.status === "synced" ? "Saved" : social.status === "syncing" ? "Saving" : "Offline"}</small>
              </div>
            )}
          </div>
          )}
          {coopLive && <CoopBanner session={coopLive} me={me} onOpen={() => setPanel({ k: "farmers" })} />}
          {coopLive && !panel && <CoopTicker session={coopLive} now={now} />}
          {nudge && !coopLive && !visit && (
            <button type="button" className="twNudge" onClick={() => enterCoop(nudge.id)} data-nudge={nudge.id}>
              <Icon id="heart" size={18} /> {nudge.by} is farming in {nudge.name}. <b>Join</b>
            </button>
          )}
          {!visit && !coopLive && visitors.current.size > 0 && (
            <div className="twVisitors" role="status">
              <Icon id="friends" size={18} /> {[...visitors.current.keys()].join(", ")} {visitors.current.size > 1 ? "are" : "is"} visiting!
            </div>
          )}

          {s.tut < 5 && !place && !visit && (
            <div className="twTutor">
              <span className="twTutorFace" aria-hidden="true">
                <Icon id="wheat" size={30} />
              </span>
              <span className="twTutorText">{TUTORIAL[s.tut]}</span>
            </div>
          )}
          {s.tut === 5 && !visit && (
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
          {info?.note && (
            <div className="twInfo twNoteCard" role="status">
              <Icon id="note" size={26} />
              <span>
                <b>{info.note.by}:</b> <q>{info.note.text}</q>
              </span>
              <div className="twInfoBtns">
                {(!visit || info.note.mine) && (
                  <button type="button" className="twBtn" onClick={() => removeNote(info.note)}>
                    {visit ? "Take back" : "Take down"}
                  </button>
                )}
                <button type="button" className="twBtn" aria-label="Close" onClick={() => setInfo(null)}>
                  ✕
                </button>
              </div>
            </div>
          )}
          {infoObj && info.visit && (
            <div className="twInfo" role="status">
              <b>{infoObj.t === "welcome" ? `${visit.owner}'s welcome sign` : typeName(infoObj.t)}</b>
              <span>{visit.hearts[infoObj.i] ? `♥ ${visit.hearts[infoObj.i]}` : "Nobody has liked this yet."}</span>
              <div className="twInfoBtns">
                <button type="button" className={`twBtn twLike${visit.myHearts.includes(infoObj.i) ? " is-on" : ""}`} onClick={() => like(infoObj)}>
                  <Icon id={visit.myHearts.includes(infoObj.i) ? "heart" : "heartOutline"} size={16} /> {visit.myHearts.includes(infoObj.i) ? "Liked" : "Like"}
                </button>
                <button type="button" className="twBtn" onClick={() => setPanel({ k: "note", target: infoObj.i })}>
                  <Icon id="note" size={16} /> Note
                </button>
                <button type="button" className="twBtn" aria-label="Close" onClick={() => setInfo(null)}>
                  ✕
                </button>
              </div>
            </div>
          )}
          {infoObj && !info.visit && !place && <InfoCard s={s} o={infoObj} now={now} onClose={() => setInfo(null)} onMove={() => startMove(infoObj)} onHurry={() => act(A.speedUp(s, { obj: infoObj.i }, clockNow()), () => play("coins"))} />}

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
          {visit && (
            <div className="twBottom">
              <BigButton icon="help" label="Help" onClick={() => setPanel({ k: "helpreq" })} badge={visit.requests.length || null} />
              <BigButton icon="note" label="Note" onClick={() => setPanel({ k: "note", target: null })} />
              {visit.relation === "partner" && <BigButton icon="gift" label="Gift" onClick={() => setPanel({ k: "gift" })} />}
              <BigButton icon="home" label="Home" onClick={goHome} />
            </div>
          )}
          {!place && !visit && (
            <div className="twBottom">
              <BigButton icon="shop" label="Shop" onClick={() => setPanel({ k: "shop" })} />
              <BigButton icon="barn" label="Barn" onClick={() => setPanel({ k: "barn" })} badge={G.barnFree(s) <= 0 ? "!" : null} />
              <BigButton icon="heli" label="Orders" className={s.tut === 4 ? "twPulse" : ""} onClick={() => setPanel({ k: "orders" })} badge={s.orders.filter((o, i) => G.canDeliver(s, i)).length || null} />
              {s.level >= 5 && <BigButton icon="train" label="Train" onClick={() => setPanel({ k: "train" })} badge={s.train.st === "here" ? "!" : null} />}
              <BigButton icon="move" label={edit ? "Done" : "Move"} className={edit ? "is-on" : ""} onClick={() => setEdit(!edit)} />
              {coopLive ? (
                <BigButton icon="friends" label="Farmers" onClick={() => setPanel({ k: "farmers" })} badge={coopLive.st.players.length > 1 ? coopLive.st.players.length : null} />
              ) : (
                social.on && <BigButton icon="friends" label="Friends" onClick={() => openFriends(unopened ? "mail" : "visit")} badge={unopened || null} />
              )}
              {!coopLive && (
                <button type="button" className="twBtn twBig" data-btn="Co-op" title="Play online: farm a town together, live" onClick={() => (social.on ? openFriends("coop") : setPanel({ k: "coop" }))}>
                  <GlobeIcon size={28} />
                  <span>Co-op</span>
                </button>
              )}
            </div>
          )}
          {edit && !place && <div className="twEditHint">Move mode: tap something to move it</div>}

          {panel?.k === "shop" && <ShopPanel s={s} tab={shopTab} setTab={setShopTab} onBuy={startBuild} onExpand={(k) => act(A.expand(s, k, clockNow()), () => (play("build"), closePanel()))} onClose={closePanel} />}
          {panel?.k === "barn" && (
            <BarnPanel
              s={s}
              onSell={(g, n) => act(A.sellGood(s, g, n), () => play("coins"))}
              onUpgrade={() => act(A.upgradeBarn(s), () => (play("build"), say("Your Barn got bigger!", null)))}
              onClose={closePanel}
            />
          )}
          {panel?.k === "orders" && (
            <OrdersPanel
              s={s}
              now={now}
              tut={s.tut === 4}
              onDeliver={deliver}
              onSkip={(i) => act(A.skipOrder(s, i, clockNow()), () => (dropRequest("order", i), play("tap")))}
              help={helpProps}
              onHurry={(i) => act(A.speedUp(s, { order: i }, clockNow()), () => play("coins"))}
              onClose={closePanel}
            />
          )}
          {panel?.k === "train" && (
            <TrainPanel
              s={s}
              now={now}
              onLoad={(k) => act(A.loadCar(s, k, clockNow()), () => (dropRequest("car", k), play("collect")))}
              help={helpProps}
              onSend={() => {
                const cars = s.train.cars.length
                act(A.sendTrain(s, clockNow()), (r) => {
                  fx.current.train = { out: fx.current.t, cars }
                  play("whistle")
                  if (r.bonus) say(`Train bonus: ${r.bonus.coins} coins, ${r.bonus.xp} XP and a clover!`, null)
                  closePanel()
                })
              }}
              onHurry={() => act(A.speedUp(s, { train: true }, clockNow()), () => play("coins"))}
              onClose={closePanel}
            />
          )}
          {panelObj && (
            <FactoryPanel
              s={s}
              o={panelObj}
              now={now}
              onMake={(g) => act(A.queueProduct(s, panelObj.i, g, clockNow()), () => play("queue"))}
              onCollect={() => collectFactory(panelObj)}
              onAddSlot={() => act(A.addSlot(s, panelObj.i), () => play("build"))}
              onHurry={() => act(A.speedUp(s, { obj: panelObj.i }, clockNow()), () => play("coins"))}
              onClose={closePanel}
            />
          )}
          {panel?.k === "expand" && <ExpandPanel s={s} k={panel.i} onExpand={() => act(A.expand(s, panel.i, clockNow()), () => (play("build"), closePanel()))} onClose={closePanel} />}
          {panel?.k === "help" && <HelpPanel onClose={closePanel} />}
          {panel?.k === "coop" && <CoopPanel request={net?.request || (async () => ({ ok: false, error: "Connect to the network first." }))} signedIn={!!me && net?.status === "online"} couple={couple} onEnter={enterCoop} beforeConvert={() => social.upload()} onClose={closePanel} />}
          {panel?.k === "farmers" && coopLive && <FarmersPanel session={coopLive} net={net} me={me} onHome={() => leaveCoop()} onQuit={quitCoop} onClose={closePanel} />}
          {panel?.k === "friends" && (
            <FriendsPanel
              coop={net?.request ? <CoopPicker request={net.request} signedIn={!!me && net.status === "online"} couple={couple} onEnter={enterCoop} beforeConvert={() => social.upload()} /> : null}
              social={social}
              s={s}
              couple={couple}
              tab={friendsTab}
              setTab={(t) => (t ? setFriendsTab(t) : closePanel())}
              now={now}
              onVisit={startVisit}
              onOpenGift={openGift}
              onGift={() => setPanel({ k: "gift" })}
              onShowNote={showNote}
              onDeleteNote={removeNote}
              onSettings={async (body) => {
                const r = await social.call("PUT", "/settings", body)
                if (r.ok) social.setData((d) => ({ ...d, allowBuddies: r.allowBuddies }))
                else say(r.error)
              }}
            />
          )}
          {panel?.k === "gift" && paired && <GiftPanel s={s} partner={couple.partner} giftsLeft={sd.giftsLeft ?? 3} onSend={sendGift} onClose={closePanel} />}
          {panel?.k === "note" && visit && (
            <NotePanel owner={visit.owner} where={panel.target ? typeName(G.objById(visit.s, panel.target)?.t || "") : null} onSend={leaveNote} onClose={closePanel} />
          )}
          {panel?.k === "helpreq" && visit && <HelpRequestsPanel owner={visit.owner} requests={visit.requests} s={s} onHelp={helpFriend} onClose={closePanel} />}
          {opening && <GiftOpening gift={opening} onDone={() => setOpening(null)} />}
          {social.conflict && <ConflictPanel local={s} cloud={social.conflict.cloud} onPick={social.resolveConflict} />}
          {level && <LevelPanel {...level} onClose={() => setLevels((l) => l.slice(1))} />}
          {confirmNew && (
            <Dialog
              title="New Town"
              okLabel="Start over"
              sound="chord"
              onOk={() => {
                const rev = (game.current.rev || 0) + 1
                game.current = G.newGame(clockNow())
                game.current.rev = rev
                if (social.on) placeSpecials()
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
