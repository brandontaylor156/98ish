// My Park: the walk-around park (three.js + the game's own modules). The engine (engine.js
// setWorld) hands it the renderer, the figure maker and the frame loop, and draws its scene
// with its camera; everything else is here:
//
// - the park (build.js), the time of day (sky.js);
// - four courts, each a real match.js game between the park's regulars at the court's level
//   (rally scoring to 11), continuously: at a game's end the next paddles in the rack go on
//   (queue.js), the off-going players walk out of the gate and the new ones in;
// - the regulars (regulars.js): walking, sitting, watching, chatting, queueing, clapping;
// - you (walker.js): your Locker Room look, moved only by your own hand, the follow camera
//   (followcam.js), one context action at a time (layout.js INTERACTABLES), watching a court
//   from its bleachers (spectatorShot), sitting on a bench, your paddle in a rack;
// - other people in the same park, online (interp.js), with nameplates and canned lines;
// - who gets a real athlete: the closest few in view (a budget that follows the frame time),
//   everyone else a cheap instanced figure (mannequin.js); animation slower further away.
//
// Talks to the page through onHud (what the HUD shows, a few times a second, only when it
// changes) and onEvent ({ type: "turn" | "locker" | "machine" | "say" ... }).

import * as THREE from "three"
import { createAnim, setMood, situation, updateAnim, seatedPose } from "../anim.js"
import { blocker } from "../camera.js"
import { advance, beginPoint, createMatch, scoreboard, seeded } from "../match.js"
import { buildPark } from "./build.js"
import { createMannequins } from "./mannequin.js"
import { ACTIVE, ALL_SEATS, COURTS, INTERACTABLES, LEVEL_NAMES, RIVERSIDE_LAYOUT, SPAWN, WAYPOINTS, dirToWorld, nearestAction, poseToWorld, resolve, seatApproach, setLayout, toLocal, toWorld, yawToWorld } from "./layout.js"
import { callNext, leaveQueue, nextLineup, ordered, positionOf } from "./queue.js"
import { LINES, createRegular, goTo, speak, think, tickRegular } from "./regulars.js"
import { createWalker, keepApart, stepWalker } from "./walker.js"
import { angleName, createFollow, spectatorShot, stepFollow, turnFollow, SPECTATE_ANGLES } from "./followcam.js"
import { dayLook, hourOf } from "./sky.js"
import { ACTS, createClock, createTrack, observeClock, packPos, pushSample, sampleTrack, serverTime, shouldSend, unpackPos } from "./interp.js"
import { repLevel, repLine } from "./rep.js"
import { CHAT_LINES, EMOTE_MOOD } from "./lines.js"

const REGULARS_OFF = 10 // regulars off court at the start (plus four on each court)
const AI_TARGET = 11
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a))


const blobTexture = () => {
  const c = document.createElement("canvas")
  c.width = c.height = 64
  const ctx = c.getContext("2d")
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, "rgba(0,0,0,0.75)")
  g.addColorStop(0.45, "rgba(0,0,0,0.4)")
  g.addColorStop(1, "rgba(0,0,0,0)")
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(c)
}

export const createWorld = ({ layout = RIVERSIDE_LAYOUT, makeFigure, quality = "medium", phone = false, me: meInfo = {}, onHud, onEvent, labelsEl = null, audio = null, seed = (Math.random() * 1e9) | 0, hour = null } = {}) => {
  // (the venue: layout.js's named exports follow the active layout)
  setLayout(layout)
  const venue = layout
  // (indoors: cameras stay under the lowest hall roof)
  const halls = layout.spec.scene?.halls || []
  const roofY = halls.length ? Math.min(...halls.map((h) => h.h || 9)) - 0.6 : null
  const rand = seeded(seed)
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400)
  const park = buildPark(scene, { quality, layout })
  const mann = createMannequins(scene)
  let size = { width: 1, height: 1 }
  const portrait = () => size.height > size.width * 1.05
  let disposed = false
  let suspended = false
  let clock = 0 // seconds of park time
  let frameNo = 0

  // contact shadows under everyone (one instanced quad)
  const blobTex = blobTexture()
  const blobs = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.9, 0.9).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity: 0.6 }), 96)
  blobs.count = 0
  blobs.frustumCulled = false
  blobs.renderOrder = 1
  scene.add(blobs)
  const bm4 = new THREE.Matrix4()

  // ---------- time of day ----------
  let hourOverride = hour
  let dayAt = -999
  const updateDay = (force) => {
    if (!force && clock - dayAt < 60) return
    dayAt = clock
    const d = dayLook(hourOverride ?? hourOf())
    park.setDayLook(d)
    exposure = d.exposure
    nightLights = d.lights
  }
  let exposure = 1
  let nightLights = false

  // ---------- bodies: everyone drawn, with a real athlete or a mannequin ----------
  // body: { key, look, name, mode: "walk" | "court", court, p (match player), x, z, yaw,
  //   speed, vx, vz, seat, anim, fig, figAt, full, hidden, phase, acc, mood, clapT, say }
  const bodies = new Map()
  const makeBody = (key, look, name, extra = {}) => {
    const b = { key, look, name, mode: "walk", court: null, p: null, x: 0, z: 0, yaw: 0, speed: 0, vx: 0, vz: 0, seat: null, anim: null, fig: null, figLook: null, full: false, hidden: false, phase: 0, acc: 0, mood: null, clapT: null, say: null, lastSeen: 0, ...extra }
    bodies.set(key, b)
    return b
  }
  const dropFig = (b) => {
    if (!b.fig) return
    b.fig.group.parent?.remove(b.fig.group)
    b.fig.dispose()
    b.fig = null
    b.anim = null
  }
  const removeBody = (b) => {
    dropFig(b)
    bodies.delete(b.key)
  }
  // where a body's figure lives: the scene (walking) or its court's group (playing)
  // (every figure is in the scene itself: a figure places its bones in world space, so a
  // court player's pose is turned from the court's frame into the world's: poseToWorld)
  const parentOf = () => scene
  const setMode = (b, mode, court = null, p = null) => {
    b.mode = mode
    b.court = court
    b.p = p
    b.seat = null
    if (b.fig) {
      // (a figure is in the scene only while it's drawn: hidden ones cost nothing)
      const shown = !!b.fig.group.parent
      b.fig.group.parent?.remove(b.fig.group)
      if (shown) parentOf(b).add(b.fig.group)
      b.anim = null // (a new frame of reference: the animation starts afresh)
    }
  }

  // ---------- you ----------
  let me = {
    name: meInfo.name || "You",
    look: meInfo.look || null,
    rep: meInfo.rep || null,
    walker: createWalker(SPAWN.x, SPAWN.z, SPAWN.yaw),
    mode: "walk", // walk | watch | sit
    seat: null,
    watching: null, // court id
    angle: 0,
    queued: null, // court id (offline: in the local rack; online: the server's)
  }
  const meBody = makeBody("me", me.look, me.name, { isMe: true })
  meBody.x = SPAWN.x
  meBody.z = SPAWN.z
  meBody.yaw = SPAWN.yaw
  const follow = createFollow(SPAWN.yaw)
  const input = { x: 0, y: 0, sprint: false }
  const keys = new Set()

  // ---------- the regulars ----------
  const regulars = []
  const takenSeats = new Map() // seat id -> who
  const ctxFor = () => ({
    rand,
    now: clock,
    courts: courts.map((c) => ({ id: c.def.id, level: c.def.level, queue: c.queue.length + (serverCourts[c.def.id]?.q.length || 0), open: c.state !== "human" })),
    seatFree: (s) => !takenSeats.has(s.id),
    takeSeat: (s, r) => takenSeats.set(s.id, r.id),
    freeSeat: (s) => takenSeats.delete(s.id),
    partnerFor: (r) => regulars.find((o) => o !== r && (o.state === "wander" || o.state === "watch") && !o.seated && Math.hypot(o.x - r.x, o.z - r.z) < 9 && rand() < 0.6) || null,
    queueSpot: (courtId, r) => {
      const c = COURTS[courtId]
      const i = courts[courtId].queue.findIndex((e) => e.id === r.id)
      const k = i < 0 ? courts[courtId].queue.length : i
      const along = ((k % 4) - 1.5) * 0.75
      const back = 1.0 + Math.floor(k / 4) * 0.7
      return resolve(c.rack.x + c.rackAlong.x * along + c.out.x * back, c.rack.z + c.rackAlong.z * along + c.out.z * back, 0.3)
    },
  })

  // ---------- the courts ----------
  const courts = COURTS.map((def) => ({ def, match: null, on: [], queue: [], state: "playing", t: 0, gameNo: 0, ball: null, incoming: [], outgoing: [], human: null, lastScore: "", greatAt: -9 }))
  // ball meshes, one per court (in the court's frame)
  const ballGeo = new THREE.SphereGeometry(0.055, 10, 8)
  const ballMat = new THREE.MeshLambertMaterial({ color: 0xe6f046, emissive: 0x3a4000 })
  for (const c of courts) {
    c.ball = new THREE.Mesh(ballGeo, ballMat)
    park.courtGroups[c.def.id].add(c.ball)
  }
  const rosterOf = (c, entries) =>
    entries.map((e, i) => {
      const team = i < 2 ? 0 : 1
      return { id: e.id, team, ctrl: "cpu", level: c.def.level, name: entryName(e), look: entryLook(e) }
    })
  const entryName = (e) => (e.kind === "human" ? (e.me ? me.name : remotes.get(e.num)?.name || "Guest") : e.reg?.name || "Player")
  const entryLook = (e) => (e.kind === "human" ? (e.me ? me.look : remotes.get(e.num)?.look || null) : e.reg?.look || null)
  const bodyOfEntry = (e) => (e.kind === "human" ? (e.me ? meBody : remotes.get(e.num)?.body) : e.reg?.body) || null

  // a new game on court c with these four (team 0 first); starts: where each comes from
  // (court frame; null: their spot)
  const startGame = (c, entries, starts = [], { score = null } = {}) => {
    c.gameNo++
    c.on = entries
    c.match = createMatch({ doubles: true, scoring: "rally", target: AI_TARGET, level: c.def.level, seed: (seed + c.def.id * 7919 + c.gameNo * 104729) >>> 0, assist: "reflex", roster: rosterOf(c, entries) })
    if (score) c.match.game.score = [...score]
    c.match.players.forEach((p, i) => {
      const s = starts[i]
      if (s) {
        p.x = s.x
        p.z = s.z
        p.target = p.spot
      }
      const b = bodyOfEntry(entries[i])
      if (b) setMode(b, "court", c, p)
    })
    // (walking on from the gate takes a while: a longer intro)
    if (starts.some(Boolean)) c.match.phaseT = -6
    c.state = "playing"
    c.lastScore = ""
  }

  // ---------- the people online ----------
  const remotes = new Map() // num -> { num, name, look, rep, track, body, playing }
  const netClock = createClock()
  let net = null // { emit(event, payload) -> Promise<ack>, volatile(event, payload) }
  let netRate = "normal"
  let parkNo = null
  let myNum = null
  let lastSent = null
  let serverCourts = COURTS.map(() => ({ q: [], g: null }))

  // ---------- setting up ----------
  {
    let ri = 0
    for (const c of courts) {
      const four = []
      for (let k = 0; k < 4; k++) {
        const r = createRegular(ri++, rand, { x: c.def.inside.x, z: c.def.inside.z })
        r.state = "playing"
        r.idle = 0
        regulars.push(r)
        r.body = makeBody(r.id, r.look, r.name)
        four.push({ id: r.id, kind: "ai", reg: r, sat: 0 })
      }
      // already part way through a game
      startGame(c, four, [], { score: [Math.floor(rand() * 7), Math.floor(rand() * 7)] })
      advance(c.match, 3 + rand() * 6)
      c.match.events.length = 0
    }
    // and the rest about the park
    for (let k = 0; k < REGULARS_OFF; k++) {
      const wp = WAYPOINTS.length ? WAYPOINTS[Math.floor(rand() * WAYPOINTS.length)] : SPAWN
      const spot = k < 3 && COURTS[k] ? resolve(COURTS[k].rack.x + COURTS[k].out.x * 1.2, COURTS[k].rack.z + COURTS[k].out.z * 1.2, 0.3) : venue.kind === "riverside" ? resolve(-20 + rand() * 42, (rand() - 0.5) * 2.2, 0.3) : resolve(wp.x + (rand() - 0.5) * 3, wp.z + (rand() - 0.5) * 3, 0.3)
      const r = createRegular(ri++, rand, spot)
      r.idle = 40 + rand() * 80
      regulars.push(r)
      r.body = makeBody(r.id, r.look, r.name)
      r.body.x = r.x
      r.body.z = r.z
      r.t = rand() * 3
    }
  }

  // ---------- a real venue's other courts: a doubles game on about half of them ----------
  // Cheap figures only (the mannequin crowd): four in ready stances, shuffling a little and
  // swinging now and then; drawn when near and in view. They don't play a real match.
  const LOOKS = ["#2f6fd6", "#e63946", "#ffd23f", "#2a9d8f", "#f4a261", "#6a4c93", "#ffffff", "#1d3557"]
  const SKINS = ["#f1c7a5", "#d39a6a", "#a0663d", "#6b4226", "#e8b98f"]
  const ambient = (layout.spec.scene?.courts || [])
    .filter((c) => c.s === "p" && (c.live === null || c.live === undefined) && !c.machine)
    .filter((c, i) => ((i * 2654435761) >>> 0) % 100 < 55)
    .map((c, i) => {
      const s = Math.sin(c.rot)
      const co = Math.cos(c.rot)
      const at = (lx, lz) => ({ x: c.x + lx * co + lz * s, z: c.z - lx * s + lz * co })
      const spots = [
        [-1.5, -5.6, 0],
        [1.5, -3.2, 0],
        [-1.4, 4.8, Math.PI],
        [1.6, 5.8, Math.PI],
      ]
      return {
        x: c.x,
        z: c.z,
        people: spots.map(([lx, lz, yaw], k) => ({ ...at(lx, lz), yaw: yaw + c.rot, phase: (i * 4 + k) * 1.7, look: { shirt: LOOKS[(i * 3 + k) % LOOKS.length], skin: SKINS[(i + k * 2) % SKINS.length], bottomColor: k % 2 ? "#1d3557" : "#2b2b2b", hairColor: k % 3 ? "#2b1b0e" : "#8a5a2b", paddle: LOOKS[(i + k) % LOOKS.length] } })),
      }
    })
  const ambSphere = new THREE.Sphere(new THREE.Vector3(), 9)
  const drawAmbient = () => {
    if (!ambient.length) return
    const cx = camera.position.x
    const cz = camera.position.z
    let courtsDrawn = 0
    for (const a of ambient) {
      if (courtsDrawn >= 10) break
      if (Math.hypot(a.x - cx, a.z - cz) > 60) continue
      ambSphere.center.set(a.x, 1, a.z)
      if (!frustum.intersectsSphere(ambSphere)) continue
      courtsDrawn++
      for (const p of a.people) {
        const t = clock + p.phase
        // (a shuffle and a swing every few seconds)
        const sway = Math.sin(t * 1.3)
        const swing = Math.max(0, Math.sin(t * 0.9) - 0.85) * 6
        mann.add({ x: p.x + Math.cos(p.yaw) * sway * 0.25, z: p.z - Math.sin(p.yaw) * sway * 0.25, yaw: p.yaw, speed: Math.abs(sway) * 0.8, phase: t * 3, seat: null, swing: Math.min(1, swing), look: p.look })
      }
    }
  }

  // ---------- figures: who gets a real athlete ----------
  const BUDGET_MAX = phone ? 5 : quality === "high" ? 14 : 10
  let budget = phone ? 3 : 8
  const FULL_DIST = phone ? 22 : 34
  const MANN_DIST = 95
  const frustum = new THREE.Frustum()
  const projM = new THREE.Matrix4()
  const sphere = new THREE.Sphere(new THREE.Vector3(), 1.3)
  const courtSphere = new THREE.Sphere(new THREE.Vector3(), 11)
  // (tests: every court played out, a fixed athlete budget, no labels)
  const dev = { allLive: false, budget: null, noLabels: false }
  let perfWin = { t: 0, n: 0 }
  // the frame budget: a step down when frames run long, back up when there's time
  const adaptBudget = (dt) => {
    perfWin.t += dt
    perfWin.n++
    if (perfWin.t < 2) return
    const avg = perfWin.t / perfWin.n
    perfWin = { t: 0, n: 0 }
    // (a computer aims for about 50 frames a second or more, a phone for 30)
    const slow = phone ? 1 / 31 : 1 / 45
    const fast = phone ? 1 / 42 : 1 / 57
    if (avg > slow && budget > 2) budget--
    else if (avg < fast && budget < BUDGET_MAX) budget++
  }
  const pending = [] // bodies waiting for a figure (one made per frame)
  const ensureFig = (b) => {
    if (b.fig && b.figLook === b.look) return true
    if (!pending.includes(b)) pending.push(b)
    return false
  }
  const makeOne = () => {
    // (one figure a frame: making an athlete takes 15-25 ms)
    while (pending.length) {
      const b = pending.shift()
      if (!bodies.has(b.key) || !b.wantFull) continue
      dropFig(b)
      try {
        b.fig = makeFigure(b.look || {}, { shadows: false })
      } catch {
        b.fig = null
        return
      }
      b.figLook = b.look
      b.anim = null
      return
    }
  }

  // ---------- labels (names, rep, speech) over people: plain page elements ----------
  const labels = []
  const labelFor = (i) => {
    if (labels[i]) return labels[i]
    if (!labelsEl) return null
    const el = document.createElement("div")
    el.className = "pkParkLabel"
    el.style.display = "none"
    const inner = document.createElement("div")
    inner.className = "pkParkLabelIn"
    const name = document.createElement("b")
    const sub = document.createElement("small")
    const say = document.createElement("span")
    say.className = "pkParkSay"
    say.style.display = "none"
    sub.style.display = "none"
    inner.append(say, name, sub)
    el.append(inner)
    labelsEl.appendChild(el)
    labels[i] = { el, name, sub, say, text: "", subText: "", sayText: "", x: -1, y: -1, shown: false }
    return labels[i]
  }
  const proj = new THREE.Vector3()
  const setLabel = (i, x, y, z, name, sub, say, kind) => {
    const L = labelFor(i)
    if (!L) return
    proj.set(x, y, z).project(camera)
    const on = proj.z < 1 && Math.abs(proj.x) < 1.1 && Math.abs(proj.y) < 1.1
    if (!on) return hideLabel(i)
    const px = Math.round((proj.x * 0.5 + 0.5) * size.width)
    const py = Math.round((-proj.y * 0.5 + 0.5) * size.height)
    if (!L.shown) {
      L.el.style.display = "block"
      L.shown = true
    }
    if (px !== L.x || py !== L.y) {
      L.el.style.transform = `translate(${px}px, ${py}px)`
      L.x = px
      L.y = py
    }
    if (L.text !== name) L.name.textContent = L.text = name
    if (L.subText !== sub) {
      L.sub.textContent = L.subText = sub
      L.sub.style.display = sub ? "" : "none"
    }
    if (L.sayText !== say) {
      L.say.textContent = L.sayText = say
      L.say.style.display = say ? "" : "none"
    }
    if (L.kind !== kind) {
      L.el.dataset.kind = L.kind = kind
    }
  }
  const hideLabel = (i) => {
    const L = labels[i]
    if (L?.shown) {
      L.el.style.display = "none"
      L.shown = false
    }
  }

  // ---------- the HUD ----------
  let hudKey = ""
  let hudT = 0
  let action = null
  const actionFor = () => {
    if (me.mode === "watch") return { kind: "leave", label: "Leave" }
    if (me.mode === "sit") return { kind: "stand", label: "Stand up" }
    const it = nearestAction(me.walker.x, me.walker.z)
    if (!it) return null
    if (it.kind === "rack") {
      const c = courts[it.court]
      const mine = me.queued === it.court
      const ahead = mine ? myPosition(it.court) : waitingCount(it.court)
      return { kind: "rack", court: it.court, label: mine ? "Take paddle back" : "Call next", detail: `${c.def.name} · ${LEVEL_NAMES[c.def.level]}${mine ? (ahead > 0 ? ` · ${ahead} ahead of you` : " · you're next") : ahead ? ` · ${ahead} waiting` : ""}` }
    }
    if (it.kind === "watch") return { kind: "watch", court: it.court, label: "Watch", detail: `${courts[it.court].def.name} · ${LEVEL_NAMES[courts[it.court].def.level]}` }
    if (it.kind === "sit") return { kind: "sit", bench: it.bench, label: "Sit" }
    return { kind: it.kind, label: it.label }
  }
  const waitingCount = (id) => courts[id].queue.length + (net ? serverCourts[id].q.filter((n) => n !== myNum).length : 0)
  const myPosition = (id) => {
    if (net && myNum !== null) {
      const q = serverCourts[id].q
      const i = q.indexOf(myNum)
      return i < 0 ? 0 : i
    }
    return Math.max(0, positionOf(courts[id].queue, "me"))
  }
  const courtView = (c) => {
    const sb = c.match ? scoreboard(c.match) : { score: [0, 0] }
    const names = [0, 1].map((t) => c.on.slice(t * 2, t * 2 + 2).map(entryName).join(" / "))
    const human = c.human
    return { id: c.def.id, name: c.def.name, level: LEVEL_NAMES[c.def.level], names, score: human?.score || sb.score, people: human ? human.names : null, state: c.state }
  }
  const sendHud = (force) => {
    action = actionFor()
    const watching = me.mode === "watch" ? { ...courtView(courts[me.watching]), angle: angleName(me.angle, portrait()) } : null
    const queued = me.queued !== null ? { court: me.queued, name: COURTS[me.queued].name, ahead: myPosition(me.queued), busy: courts[me.queued].state !== "playing" ? courts[me.queued].state : null } : null
    const hud = { mode: me.mode, action, watching, queued, online: net ? { park: parkNo, people: remotes.size + 1, rate: netRate } : null }
    const key = JSON.stringify(hud)
    if (!force && key === hudKey) return
    hudKey = key
    onHud?.(hud)
  }

  // ---------- your actions ----------
  const sitOn = (seat) => {
    me.mode = "sit"
    me.seat = seat
    takenSeats.set(seat.id, "me")
    meBody.anim = null
  }
  const standUp = () => {
    if (me.seat) {
      takenSeats.delete(me.seat.id)
      const a = seatApproach(me.seat)
      me.walker.x = a.x
      me.walker.z = a.z
      me.walker.vx = me.walker.vz = 0
      me.walker.yaw = wrap(me.seat.yaw + Math.PI)
    }
    me.seat = null
    me.mode = "walk"
    me.watching = null
    meBody.anim = null
    follow.yaw = me.walker.yaw
    follow.pos = null
  }
  const watch = (id) => {
    const c = courts[id]
    if (!c) return
    if (me.mode !== "walk") standUp()
    // the nearest free seat on that court's bleachers (or stand behind them)
    const seats = ALL_SEATS.filter((s) => s.court === id && !takenSeats.has(s.id)).sort((a, b) => Math.hypot(a.x - me.walker.x, a.z - me.walker.z) - Math.hypot(b.x - me.walker.x, b.z - me.walker.z))
    if (seats[0]) sitOn(seats[0])
    me.mode = "watch"
    me.watching = id
    me.angle = 0
    sendHud(true)
  }
  const toggleQueue = (id) => {
    if (me.queued === id) {
      me.queued = null
      courts[id].queue = leaveQueue(courts[id].queue, "me")
      net?.emit("park:uncall", {})
    } else {
      if (me.queued !== null) courts[me.queued].queue = leaveQueue(courts[me.queued].queue, "me")
      me.queued = id
      if (!net) courts[id].queue = callNext(courts[id].queue, { id: "me", kind: "human", me: true }).queue
      else net.emit("park:call", { court: id })
      speak(meBody, "Got next!", clock)
      sendLine(3)
    }
    updateRacks()
    sendHud(true)
  }
  const doAction = () => {
    const a = action || actionFor()
    if (!a) return false
    if (a.kind === "leave" || a.kind === "stand") standUp()
    else if (a.kind === "watch") watch(a.court)
    else if (a.kind === "rack") toggleQueue(a.court)
    else if (a.kind === "sit") {
      const seat = ALL_SEATS.filter((s) => s.bench === a.bench && !takenSeats.has(s.id)).sort((x, y) => Math.hypot(x.x - me.walker.x, x.z - me.walker.z) - Math.hypot(y.x - me.walker.x, y.z - me.walker.z))[0]
      if (seat) sitOn(seat)
    } else if (a.kind === "locker") onEvent?.({ type: "locker" })
    else if (a.kind === "machine") onEvent?.({ type: "machine" })
    sendHud(true)
    return true
  }
  // canned lines and emotes (yours: shown over you and sent to the park)
  const sendLine = (i) => {
    if (net && i >= 0 && i < CHAT_LINES.length) net.emit("park:fx", { line: i })
  }
  const say = (i) => {
    if (!(i >= 0 && i < CHAT_LINES.length)) return
    speak(meBody, CHAT_LINES[i], clock)
    sendLine(i)
  }
  const emote = (id) => {
    const m = EMOTE_MOOD[id]
    if (!m) return
    if (me.mode !== "walk") meBody.clapT = id === "clap" ? 0 : null
    if (meBody.anim) setMood(meBody.anim, m[0], m[1])
    meBody.mood = { kind: m[0], variant: m[1], at: clock }
    net?.emit("park:fx", { emote: id })
  }

  // ---------- the racks (the paddles you see) ----------
  const updateRacks = () => {
    park.setRacks(
      courts.map((c) => {
        const list = ordered(c.queue).map((e) => ({ color: entryLook(e)?.paddle || "#ffd23f" }))
        const online = serverCourts[c.def.id].q.map((n) => ({ color: (n === myNum ? me.look : remotes.get(n)?.look)?.paddle || "#ffd23f" }))
        return [...online, ...list]
      })
    )
  }

  // ---------- a court's frame ----------
  const greatPoint = (c, e) => {
    // the bleachers and the people watching react
    if (clock - c.greatAt < 4) return
    c.greatAt = clock
    for (const r of regulars) {
      if (r.court !== c.def.id || !(r.state === "watch" || (r.state === "sit" && r.seat?.court === c.def.id))) continue
      if (r.seated) r.body.clapT = 0
      else r.body.mood = { kind: "cheer", variant: rand() < 0.5 ? 1 : 2, at: clock }
      if (rand() < 0.35) speak(r, LINES.cheer[Math.floor(rand() * LINES.cheer.length)], clock)
    }
    for (const r of regulars) if (r.seated && r.seat?.court === c.def.id) r.body.clapT = 0
    if (me.mode === "watch" && me.watching === c.def.id && audio) audio.cheer?.(Math.min(1, 0.3 + e.shots / 16))
  }
  const courtEvents = (c) => {
    const m = c.match
    for (const e of m.events) {
      if (e.type === "hit" && audio && me.mode !== "away") {
        const w = toWorld(c.def, e.x, e.z)
        const d = Math.hypot(w.x - camera.position.x, w.z - camera.position.z)
        if (d < 26) audio.pock?.(Math.min(1, e.paddle / 14) * Math.max(0, 1 - d / 26) * 0.8, false)
      } else if (e.type === "rally" && (e.shots >= 8 || (e.kind === "winner" && e.last?.kind === "smash"))) greatPoint(c, e)
      else if (e.type === "point") {
        for (const b of bodies.values()) if (b.court === c && b.anim && b.p) setMood(b.anim, b.p.team === e.winner ? "cheer" : "sulk", Math.floor(rand() * 2))
      } else if (e.type === "gameover") {
        c.state = "over"
        c.t = 3.5
      }
    }
    m.events.length = 0
  }
  // a court nobody can see: the score moves on by itself (a point every 8-16 s, rally scoring)
  const virtualPoint = (c, dt) => {
    // (they stand still while nobody's looking)
    if (!c.virtual) for (const p of c.match.players) p.vx = p.vz = 0
    c.virtual = true
    c.vt = (c.vt ?? 8 + rand() * 8) - dt
    if (c.vt > 0) return
    c.vt = 8 + rand() * 8
    const g = c.match.game
    if (g.winner !== null && g.winner !== undefined) return
    const w = rand() < 0.5 ? 0 : 1
    g.score[w]++
    const [a, b] = g.score
    if (Math.max(a, b) >= g.target && Math.abs(a - b) >= 2) {
      g.winner = a > b ? 0 : 1
      c.match.phase = "over"
      c.match.phaseT = 0
      for (const p of c.match.players) p.target = { x: p.x * 0.5, z: Math.sign(p.z || 1) * 0.7 }
      c.match.events.push({ type: "gameover", winner: g.winner })
    }
  }
  // the next four go on; the off-going walk out of the gate, the new ones come in
  const rotate = (c) => {
    const winner = c.match.game.winner ?? 0
    // people online in this rack: their browsers start their turn (the one at the front says
    // park:up); wait for the server a moment, then carry on with the regulars
    const sq = net ? serverCourts[c.def.id].q : []
    if (sq.length && !c.waitedServer) {
      c.waitedServer = true
      c.state = "wait"
      c.t = 6
      if (sq.includes(myNum)) net.emit("park:up", { court: c.def.id })
      return
    }
    c.waitedServer = false
    for (const e of c.on) if (e.reg) e.sat = clock
    const next = nextLineup(c.on, c.queue, winner)
    c.queue = next.queue
    for (const e of c.queue) if (e.reg) e.reg.court = c.def.id
    // you're on (offline: the park's own rack says so; online: the server, park:go)
    if (next.on.some((e) => e.me)) {
      c.queue = [...next.on.filter((e) => !c.on.includes(e)), ...c.queue]
      return myTurn(c, { kind: "solo" })
    }
    beginChangeover(c, next.on, next.off)
  }
  // Your turn on court c: you and three of the park's players (the next in the rack, or the
  // ones who just played). The page plays the game (the engine, or an online room); the
  // court waits for you, then afterMyGame puts the regulars back on.
  const myTurn = (c, { kind = "solo", roomId = null } = {}) => {
    if (c.human?.mine) return
    const winner = c.match?.game.winner ?? 0
    const rest = nextLineup(c.on, c.queue.filter((e) => !e.me), winner)
    const ai = rest.on.filter((e) => !e.me).slice(0, 3)
    c.queue = [...rest.on.filter((e) => !e.me && !ai.includes(e) && !c.on.includes(e)), ...rest.queue]
    const mine = { id: "me", kind: "human", me: true }
    const lineup = [mine, ...ai]
    me.queued = null
    for (const k of courts) k.queue = leaveQueue(k.queue, "me")
    if (me.mode !== "walk") standUp()
    c.state = "human"
    c.pendingOn = lineup
    c.human = { mine: true, names: [lineup.slice(0, 2).map(entryName).join(" / "), lineup.slice(2).map(entryName).join(" / ")], score: [0, 0] }
    updateRacks()
    onEvent?.({ type: "turn", court: c.def.id, kind, roomId, level: c.def.level, lineup: lineup.map((e, i) => ({ id: e.id, me: !!e.me, team: i < 2 ? 0 : 1, name: entryName(e), look: entryLook(e) })) })
    sendHud(true)
  }
  // back from your game: the three who played with you stay on with whoever's next; everyone
  // else who was on that court has gone off for a walk
  const afterMyGame = (c) => {
    const lineup = c.pendingOn || []
    const stay = lineup.filter((e) => !e.me)
    const q = ordered(c.queue)
    while (stay.length < 4 && q.length) stay.push(q.shift())
    c.queue = q
    while (stay.length < 4) {
      const r = regulars.find((x) => x.body.mode === "walk" && x.state !== "toCourt" && !stay.some((e) => e.reg === x))
      if (!r) break
      stay.push({ id: r.id, kind: "ai", reg: r, sat: clock })
    }
    for (const e of c.on) {
      if (stay.some((x) => x.id === e.id) || !e.reg) continue
      const b = bodyOfEntry(e)
      if (b) setMode(b, "walk")
      const r = e.reg
      const along = (rand() - 0.5) * 2
      const back = rand()
      r.x = c.def.outside.x + c.def.rackAlong.x * along + c.def.out.x * back
      r.z = c.def.outside.z + c.def.rackAlong.z * along + c.def.out.z * back
      r.state = "wander"
      r.court = null
      r.idle = 0
      r.t = 1 + rand() * 3
      r.path = []
    }
    for (const e of stay) {
      const r = e.reg
      if (!r) continue
      if (r.seat) {
        takenSeats.delete(r.seat.id)
        r.seat = null
      }
      r.seated = false
      r.state = "playing"
      r.path = []
      r.idle = 0
    }
    c.human = null
    c.pendingOn = null
    if (stay.length === 4) startGame(c, stay, [])
    else c.state = "playing"
    updateRacks()
  }
  const beginChangeover = (c, on, off) => {
    const gate = toLocal(c.def, c.def.inside.x, c.def.inside.z)
    c.outgoing = off.map((e) => ({ e, done: false }))
    // off-going players walk to the gate (match.js walkToNet keeps moving them while "over")
    for (const o of c.outgoing) {
      const p = c.match.players.find((q) => q.id === o.e.id)
      if (p) p.target = { x: gate.x + (rand() - 0.5) * 0.4, z: gate.z + (rand() - 0.5) * 0.4 }
    }
    c.incoming = on.filter((e) => !c.on.includes(e)).map((e) => ({ e, arrived: false }))
    for (const inc of c.incoming) {
      const r = inc.e.reg
      if (!r) {
        inc.arrived = true
        continue
      }
      if (r.seat) {
        takenSeats.delete(r.seat.id)
        r.seat = null
      }
      r.seated = false
      r.state = "toCourt"
      r.court = c.def.id
      goTo(r, c.def.outside)
      if (rand() < 0.5) speak(r, LINES.enter[Math.floor(rand() * LINES.enter.length)], clock)
    }
    c.nextOn = on
    c.state = "changeover"
    c.t = 0
    updateRacks()
  }
  const stepChangeover = (c, dt) => {
    c.t += dt
    advance(c.match, dt)
    c.match.events.length = 0
    const gate = toLocal(c.def, c.def.inside.x, c.def.inside.z)
    for (const o of c.outgoing) {
      if (o.done) continue
      const p = c.match.players.find((q) => q.id === o.e.id)
      if (!p || Math.hypot(p.x - gate.x, p.z - gate.z) < 0.5 || c.t > 14) {
        o.done = true
        const r = o.e.reg
        const b = bodyOfEntry(o.e)
        if (r && b) {
          setMode(b, "walk")
          r.x = c.def.outside.x
          r.z = c.def.outside.z
          r.yaw = c.def.outYaw
          r.state = "wander"
          r.court = null
          r.idle = 0
          r.t = 1 + rand() * 2
          r.path = []
          if (rand() < 0.4) speak(r, "Good game!", clock)
        }
      }
    }
    for (const inc of c.incoming) {
      if (inc.arrived) continue
      const r = inc.e.reg
      if (r && (r.atGate || c.t > 22)) inc.arrived = true
    }
    if (c.outgoing.every((o) => o.done) && c.incoming.every((i) => i.arrived)) {
      // the new game: the ones who stayed start where they are, the new ones at the gate
      const starts = c.nextOn.map((e) => {
        const p = c.match.players.find((q) => q.id === e.id)
        return p ? { x: p.x, z: p.z } : { x: gate.x, z: gate.z }
      })
      for (const inc of c.incoming) {
        const r = inc.e.reg
        if (r) {
          r.state = "playing"
          r.atGate = false
          r.path = []
          r.idle = 0
        }
      }
      startGame(c, c.nextOn, starts)
      c.outgoing = []
      c.incoming = []
      c.human = null
    }
  }

  // ---------- the regulars' day ----------
  const thinkFor = (r) => {
    const ev = think(r, ctxFor())
    if (ev?.type === "queue") {
      const c = courts[ev.court]
      c.queue = callNext(c.queue, { id: r.id, kind: "ai", reg: r, sat: r.idle }).queue
      if (rand() < 0.3) speak(r, LINES.queue[Math.floor(rand() * LINES.queue.length)], clock)
      updateRacks()
    }
  }
  const stepRegulars = (dt) => {
    const walkers = regulars.filter((r) => r.body.mode === "walk")
    const others = [...walkers, { x: me.walker.x, z: me.walker.z }]
    for (const r of walkers) {
      // (queueing: they give up after a while, or when the rack is full of people from online)
      const res = tickRegular(r, dt, others, clock, rand)
      if (res.atGate) r.atGate = true
      if (r.state === "queue" && r.t <= 0) {
        const c = courts[r.court]
        c.queue = leaveQueue(c.queue, r.id)
        r.idle = 20
        r.court = null
        updateRacks()
      }
      if (res.think && r.state !== "toCourt") thinkFor(r)
      if (r.state === "queue" && !r.path.length) r.yaw = Math.atan2(COURTS[r.court].x - r.x, COURTS[r.court].z - r.z)
      const b = r.body
      b.x = r.x
      b.z = r.z
      b.vx = r.vx
      b.vz = r.vz
      b.speed = r.speed
      b.yaw = r.yaw
      b.seat = r.seated ? r.seat : null
      b.say = r.say
      if (!r.seated) b.clapT = null
    }
  }

  // ---------- drawing everyone ----------
  const tmpLook = { x: 0, y: 1.2, z: 0 }
  const walkSituation = (b, dt) => {
    const fx = Math.sin(b.yaw)
    const fz = Math.cos(b.yaw)
    const hand = b.look?.plays === "left" ? -1 : 1
    b.phaseT = (b.phaseT || 0) + dt
    return { x: b.x, z: b.z, vx: b.vx, vz: b.vz, facing: b.yaw, ball: { x: b.x + fx * 3, y: 1.1, z: b.z + fz * 3 }, holding: false, swing: null, prep: null, charging: false, between: true, atNet: false, goal: null, hand, twoHand: b.look?.backhand === "two", oppHit: null, want: { x: b.vx, z: b.vz }, id: b.key, phase: "intro", phaseT: b.phaseT % 20, point: 0, mate: null, across: null, receiving: false }
  }
  const courtWorld = (b) => {
    const w = toWorld(b.court.def, b.p.x, b.p.z)
    b.x = w.x
    b.z = w.z
    const v = { x: b.p.vx, z: b.p.vz }
    const wv = dirToWorld(b.court.def, v.x, v.z)
    b.vx = wv.x
    b.vz = wv.z
    b.speed = Math.hypot(v.x, v.z)
    const localYaw = b.anim ? b.anim.yaw : b.speed > 0.6 ? Math.atan2(v.x, v.z) : b.p.team === 0 ? Math.PI : 0
    b.yaw = yawToWorld(localYaw, b.court.def)
  }
  const drawBodies = (dt) => {
    camera.updateMatrixWorld()
    projM.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    frustum.setFromProjectionMatrix(projM)
    const cx = camera.position.x
    const cz = camera.position.z
    const list = []
    for (const b of bodies.values()) {
      if (b.hidden) continue
      if (b.mode === "court") {
        if (!b.p) continue
        courtWorld(b)
      }
      b.dist = Math.hypot(b.x - cx, b.z - cz)
      sphere.center.set(b.x, 0.9, b.z)
      b.inView = b.dist < MANN_DIST && frustum.intersectsSphere(sphere)
      list.push(b)
    }
    // the closest in view get the real athletes
    // (watching a court: its four players first, whatever the budget; walking: you always)
    const watched = me.mode === "watch" ? courts[me.watching] : null
    const ranked = list.filter((b) => (b.inView && b.dist < FULL_DIST) || (watched && b.court === watched)).sort((a, c) => (watched ? (c.court === watched) - (a.court === watched) : 0) || a.dist - c.dist)
    const fullSet = new Set(ranked.slice(0, Math.max(dev.budget ?? budget, watched && dev.budget === null ? 4 : 0)))
    if (me.mode !== "watch" || meBody.inView) fullSet.add(meBody)
    let fullIndex = 0
    mann.begin()
    let nb = 0
    for (const b of list) {
      b.wantFull = fullSet.has(b)
      const ready = b.wantFull && ensureFig(b)
      if (b.fig && !b.wantFull) {
        // (kept a few seconds in case they come back into the budget; out of the scene)
        b.fig.group.parent?.remove(b.fig.group)
        b.anim = null
        if (!b.lostAt) b.lostAt = clock
        if (clock - b.lostAt > 6) dropFig(b)
      }
      if (b.wantFull) b.lostAt = 0
      if (!b.inView) continue
      if (ready) {
        if (!b.fig.group.parent) parentOf(b).add(b.fig.group)
        // animation: every frame close up, every 2nd or 3rd further away
        const every = fullIndex < 4 || b.dist < 9 ? 1 : b.dist < 20 ? 2 : 3
        fullIndex++
        b.acc += dt
        if ((frameNo + b.key.length) % every === 0 || !b.anim) {
          animate(b, b.acc)
          b.acc = 0
        }
      } else {
        b.phase += dt * (b.speed > 0.1 ? 2.2 + b.speed * 1.1 : 0)
        const swing = b.p?.swing && !b.p.swing.whiff && b.p.swing.t < 0.4 ? 1 - b.p.swing.t / 0.4 : 0
        mann.add({ x: b.x, z: b.z, yaw: b.yaw, speed: b.speed, phase: b.phase, seat: b.seat ? b.seat.y : null, swing, look: b.look })
      }
      if (nb < 96 && b.dist < 40) {
        bm4.makeTranslation(b.x, 0.012, b.z)
        blobs.setMatrixAt(nb++, bm4)
      }
    }
    drawAmbient()
    mann.end()
    blobs.count = nb
    blobs.instanceMatrix.needsUpdate = true
  }
  const animate = (b, dt) => {
    const step = Math.min(0.1, dt)
    if (b.seat) {
      // sitting: a bench pose looking at the court (clapping after a great point)
      if (b.clapT !== null && b.clapT !== undefined) {
        b.clapT += step
        if (b.clapT > 2.2) b.clapT = null
      }
      const c = b.seat.court !== undefined && b.seat.court !== null ? courts[b.seat.court] : null
      if (c?.match) {
        const w = toWorld(c.def, c.match.ball.p.x, c.match.ball.p.z)
        tmpLook.x = w.x
        tmpLook.y = Math.max(0.6, c.match.ball.p.y)
        tmpLook.z = w.z
      } else {
        tmpLook.x = b.seat.x + Math.sin(b.seat.yaw) * 5
        tmpLook.y = 1.2
        tmpLook.z = b.seat.z + Math.cos(b.seat.yaw) * 5
      }
      b.fig.apply(seatedPose({ x: b.seat.x, y: b.seat.y, z: b.seat.z, yaw: b.seat.yaw }, tmpLook, null, { drop: b.seat.y + 0.02, ahead: 0.42, clap: b.clapT ?? null }), step)
      return
    }
    if (b.mode === "court") {
      const m = b.court.match
      if (!b.anim) b.anim = createAnim(b.p.x, b.p.z, b.p.team === 0 ? Math.PI : 0)
      let s = situation(m, b.p)
      if (s.holding && m.phase !== "serve") s = { ...s, holding: false }
      b.anim.useMM = !!b.fig.skinned
      b.anim.mmEvery = quality === "high" ? 0.1 : 0.2
      b.fig.apply(poseToWorld(updateAnim(b.anim, s, step), b.court.def), step)
      return
    }
    if (!b.anim) b.anim = createAnim(b.x, b.z, b.yaw)
    if (b.mood && clock - b.mood.at < 0.2 && !b.anim.mood) setMood(b.anim, b.mood.kind, b.mood.variant)
    b.anim.useMM = !!b.fig.skinned
    b.anim.mmEvery = quality === "high" ? 0.1 : 0.2
    b.fig.apply(updateAnim(b.anim, walkSituation(b, step), step), step)
  }

  // ---------- labels ----------
  const updateLabels = () => {
    let i = 0
    const cand = []
    for (const b of bodies.values()) {
      if (b.hidden || !b.inView) continue
      const remote = b.remote
      const speaking = !!(b.say && clock < b.say.until)
      // (your own name only shows while you say something: the rep is in the menu)
      const near = b.isMe ? false : remote ? b.dist < 26 : speaking ? b.dist < 18 : b.dist < 6.5 && b.mode === "walk"
      if (!near && !speaking) continue
      cand.push(b)
    }
    cand.sort((a, c) => a.dist - c.dist)
    for (const b of cand.slice(0, 12)) {
      const top = b.seat ? b.seat.y + 1.25 : 2.12
      const speaking = b.say && clock < b.say.until ? b.say.text : ""
      const sub = b.isMe ? (me.rep ? repLine(me.rep) : "") : b.remote ? b.repText || "" : ""
      setLabel(i++, b.x, top, b.z, b.isMe ? me.name : b.name || "", b.dist < 14 || b.isMe ? sub : "", speaking, b.isMe ? "me" : b.remote ? "person" : "regular")
    }
    for (; i < labels.length; i++) hideLabel(i)
  }

  // ---------- the camera ----------
  const tv = new THREE.Vector3()
  const lookAt = new THREE.Vector3(0, 1, 0)
  const updateCamera = (dt) => {
    const por = portrait()
    if (me.mode === "watch") {
      const c = courts[me.watching]
      const bodiesNear = []
      for (const b of bodies.values()) if (b.court === c || (b.seat && b.seat.court === c.def.id)) bodiesNear.push({ x: b.x, z: b.z, h: b.seat ? b.seat.y + 1.0 : 1.95 })
      // (a real venue: nothing solid between the court and the lens)
      const isClear = venue.kind === "riverside" ? null : (cam) => venue.segmentHit({ x: c.def.x, z: c.def.z }, cam, Math.min(cam.y - 0.3, 3.2)) === null
      const shot = spectatorShot(c.def, me.angle, bodiesNear, { portrait: por, maxY: roofY, isClear })
      const k = 1 - Math.exp(-dt * 3)
      tv.set(shot.cam.x, shot.cam.y, shot.cam.z)
      camera.position.lerp(tv, k)
      tv.set(shot.look.x, shot.look.y, shot.look.z)
      lookAt.lerp(tv, k)
      if (Math.abs(camera.fov - shot.fov) > 0.05) {
        camera.fov += (shot.fov - camera.fov) * Math.min(1, dt * 3)
        camera.updateProjectionMatrix()
      }
      camera.lookAt(lookAt)
      return
    }
    const bodiesNear = []
    for (const b of bodies.values()) if (!b.isMe && !b.hidden && b.mode === "walk" && Math.abs(b.x - me.walker.x) < 8 && Math.abs(b.z - me.walker.z) < 8) bodiesNear.push({ x: b.x, z: b.z, h: b.seat ? b.seat.y + 1.0 : 1.95, r: 0.36 })
    const w = me.mode === "sit" && me.seat ? { x: me.seat.x, z: me.seat.z, yaw: me.seat.yaw, speed: 0 } : me.walker
    stepFollow(follow, w, dt, { portrait: por, bodies: bodiesNear, roofY })
    camera.position.set(follow.pos.x, follow.pos.y, follow.pos.z)
    lookAt.set(follow.look.x, follow.look.y, follow.look.z)
    const fov = por ? 62 : 55
    if (Math.abs(camera.fov - fov) > 0.05) {
      camera.fov += (fov - camera.fov) * Math.min(1, dt * 3)
      camera.updateProjectionMatrix()
    }
    camera.lookAt(lookAt)
  }

  // ---------- online ----------
  const remoteBody = (r) => {
    const b = makeBody(`n${r.num}`, r.look, r.name, { remote: true })
    b.repText = r.repText
    return b
  }
  const addRemote = (v) => {
    const old = remotes.get(v.num)
    const repText = v.rep ? `${repLevel([0, 30, 90, 200, 400][v.rep.level] || 0).name} · ${v.rep.wins}-${v.rep.losses}` : ""
    if (old) {
      old.name = v.name
      old.rep = v.rep
      old.repText = repText
      if (v.look && JSON.stringify(v.look) !== JSON.stringify(old.look)) {
        old.look = v.look
        old.body.look = v.look
      }
      old.body.name = v.name
      old.body.repText = repText
      return old
    }
    const r = { num: v.num, name: v.name, look: v.look, rep: v.rep, repText, track: createTrack(), body: null }
    r.body = remoteBody(r)
    const p = v.pos && unpackPos(v.pos)
    if (p) {
      pushSample(r.track, serverTime(netClock, performance.now()) - 400, p)
      r.body.x = p.x
      r.body.z = p.z
      r.body.yaw = p.yaw
    } else r.body.hidden = true
    remotes.set(v.num, r)
    return r
  }
  const stepRemotes = () => {
    const now = serverTime(netClock, performance.now())
    for (const r of remotes.values()) {
      const s = sampleTrack(r.track, now)
      const b = r.body
      if (!s) continue
      if (b.mode === "court") continue
      b.hidden = s.act === ACTS.play
      b.x = s.x
      b.z = s.z
      b.vx = s.vx
      b.vz = s.vz
      b.speed = s.speed
      b.yaw = s.yaw
      if (s.act === ACTS.sitLow || s.act === ACTS.sitHigh) {
        if (!b.seat || Math.hypot(b.seat.x - s.x, b.seat.z - s.z) > 0.3) b.seat = { x: s.x, z: s.z, y: s.act === ACTS.sitHigh ? 0.85 : 0.45, yaw: s.yaw, court: courtOfSeat(s.x, s.z) }
      } else b.seat = null
    }
  }
  const courtOfSeat = (x, z) => {
    let best = null
    for (const s of ALL_SEATS) if (Math.hypot(s.x - x, s.z - z) < 0.3) best = s.court ?? null
    return best
  }
  const myAct = () => (me.mode === "walk" ? (me.walker.speed > 0.05 ? ACTS.move : ACTS.stand) : me.seat ? (me.seat.y > 0.6 ? ACTS.sitHigh : ACTS.sitLow) : ACTS.stand)
  const sendPos = () => {
    if (!net) return
    const now = performance.now()
    const at = me.seat || me.walker
    const p = { x: at.x, z: at.z, yaw: me.seat ? me.seat.yaw : me.walker.yaw, speed: me.mode === "walk" ? me.walker.speed : 0, act: myAct() }
    if (!shouldSend(lastSent, now, p, netRate)) return
    lastSent = { t: now, p }
    net.volatile("park:pos", packPos(p))
  }
  // a court where people online are playing: show them on it (with the park's computer
  // players filling in), and the real score from the server
  const applyServerCourts = (list) => {
    serverCourts = COURTS.map((_, i) => ({ q: Array.isArray(list?.[i]?.q) ? list[i].q : [], g: list?.[i]?.g || null }))
    if (myNum !== null) {
      const mine = serverCourts.findIndex((c) => c.q.includes(myNum))
      me.queued = mine >= 0 ? mine : me.queued !== null && !serverCourts.some((c) => c.g?.p.includes(myNum)) ? null : me.queued
    }
    for (const c of courts) {
      const g = serverCourts[c.def.id].g
      if (g && !(c.human?.mine && c.state === "human")) {
        const names = g.p.map((n) => (n === myNum ? me.name : remotes.get(n)?.name || "Guest"))
        c.human = { names: [names.filter((_, i) => i % 2 === 0).join(" / ") + (g.k === "solo" ? " / CPU" : ""), (names.filter((_, i) => i % 2 === 1).join(" / ") || "CPU") + " / CPU"], score: g.s || [0, 0], people: g.p }
        if (c.state === "wait" || c.state === "over" || c.state === "playing") {
          // the game on court is theirs now (their bodies hide while they play: act "play")
          c.state = "human"
        }
      } else if (!g && c.human && !c.human.mine) {
        c.human = null
        if (c.state === "human") {
          // their game is over: the regulars rotate back on
          c.state = "over"
          c.t = 0.5
          c.waitedServer = true
        }
      }
    }
    updateRacks()
  }

  // ---------- the frame ----------
  const frame = (dtIn) => {
    if (disposed || suspended) return
    const dt = Math.min(0.1, dtIn)
    clock += dt
    frameNo++
    updateDay(false)
    adaptBudget(dtIn)
    // you
    if (me.mode === "walk") {
      const kx = (keys.has("ArrowRight") || keys.has("KeyD") ? 1 : 0) - (keys.has("ArrowLeft") || keys.has("KeyA") ? 1 : 0)
      const ky = (keys.has("ArrowUp") || keys.has("KeyW") ? 1 : 0) - (keys.has("ArrowDown") || keys.has("KeyS") ? 1 : 0)
      // (the keys jog; Shift sprints)
      const kl = Math.hypot(kx, ky) || 1
      const ix = input.x + (kx / kl) * 0.85
      const iy = input.y + (ky / kl) * 0.85
      stepWalker(me.walker, { x: ix, y: iy, sprint: input.sprint || keys.has("ShiftLeft") || keys.has("ShiftRight") }, follow.yaw, dt)
      // you can't walk through people, but nothing moves you while you aren't moving (the
      // owner's rule): standing still, the others steer around you instead
      if (Math.hypot(ix, iy) > 0.02) {
        const near = []
        for (const b of bodies.values()) if (!b.isMe && !b.hidden && b.mode === "walk" && !b.seat && Math.abs(b.x - me.walker.x) < 1 && Math.abs(b.z - me.walker.z) < 1) near.push(b)
        keepApart(me.walker, near)
      }
      meBody.x = me.walker.x
      meBody.z = me.walker.z
      meBody.vx = me.walker.vx
      meBody.vz = me.walker.vz
      meBody.speed = me.walker.speed
      meBody.yaw = me.walker.yaw
      meBody.seat = null
    } else if (me.seat) {
      meBody.x = me.seat.x
      meBody.z = me.seat.z
      meBody.yaw = me.seat.yaw
      meBody.speed = 0
      meBody.vx = meBody.vz = 0
      meBody.seat = me.seat
    }
    if (meBody.say && clock > meBody.say.until) meBody.say = null
    // the courts: played out in full where you can see them; elsewhere (out of view, or far
    // away) just the score moves on, a point every 8 to 16 seconds
    camera.updateMatrixWorld()
    projM.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    frustum.setFromProjectionMatrix(projM)
    for (const c of courts) {
      const d = Math.hypot(c.def.x - camera.position.x, c.def.z - camera.position.z)
      courtSphere.center.set(c.def.x, 1, c.def.z)
      // (watching on a phone: the court you watch and the near ones are played out; the rest keep score)
      const watching = me.mode === "watch"
      const live = (watching && me.watching === c.def.id) || d < 16 || (d < (watching && phone ? 28 : phone ? 42 : 70) && frustum.intersectsSphere(courtSphere)) || dev.allLive
      if (live && !c.live && c.state === "playing" && c.match.phase !== "over" && c.virtual) {
        // back in view: the next point starts from where the score has got to
        beginPoint(c.match, { snap: true })
        c.match.events.length = 0
        c.virtual = false
      }
      c.live = live
      if (c.state === "playing" || c.state === "over" || c.state === "human" || c.state === "wait") {
        if (c.state === "human" && c.human?.mine) {
          // (your own game: played on the other screen)
        } else if (live) advance(c.match, dt)
        else if (c.state === "playing" || c.state === "human") virtualPoint(c, dt)
        else advance(c.match, dt)
        courtEvents(c)
        if (c.state === "human" && c.match.phase === "over") {
          // (people online are playing here; the regulars stand in for their rallies)
          startGame(c, c.on, [], { score: [0, 0] })
          c.state = "human"
        }
        if (c.state === "over" || c.state === "wait") {
          c.t -= dt
          if (c.t <= 0) rotate(c)
        }
      } else if (c.state === "changeover") stepChangeover(c, dt)
      // the ball and the board
      const b = c.match.ball.p
      c.ball.position.set(b.x, Math.max(0.055, b.y), b.z)
      c.ball.visible = c.state !== "changeover" && !(c.state === "human" && c.human?.mine)
      const sb = scoreboard(c.match)
      const view = courtView(c)
      park.setScore(c.def.id, { names: view.people ? c.human.names : view.names, score: view.score || sb.score, note: c.state === "human" ? "PLAYERS ONLINE" : c.state === "changeover" ? "NEXT GAME" : c.queue.length + serverCourts[c.def.id].q.length ? `${c.queue.length + serverCourts[c.def.id].q.length} UP NEXT` : "" })
    }
    stepRegulars(dt)
    stepRemotes()
    makeOne()
    updateCamera(dt)
    drawBodies(dt)
    if (!dev.noLabels) updateLabels()
    sendPos()
    hudT += dt
    if (hudT > 0.12) {
      hudT = 0
      sendHud(false)
    }
  }

  updateDay(true)
  updateRacks()
  park.setBoard([{ name: me.name, text: me.rep ? repLine(me.rep) : "Newcomer · 0-0", you: true }])

  const world = {
    scene,
    camera,
    // which venue this is (layout.js / venuegen.js): online, friends at the same venue meet
    venue: layout.id || "riverside",
    layout,
    get exposure() {
      return exposure
    },
    // the tone curve the engine draws the park with (build.js: Neutral at real venues)
    toneMapping: park.toneMapping,
    frame,
    resize(width, height) {
      size = { width: Math.max(1, width), height: Math.max(1, height) }
      camera.aspect = size.width / size.height
      camera.updateProjectionMatrix()
    },
    // the move pad: x right, y up the pad (forward), each -1..1
    setStick(x, y) {
      input.x = x
      input.y = y
    },
    setSprint(on) {
      input.sprint = !!on
    },
    key(code, down) {
      if (down) {
        if (code === "Enter" || code === "Space" || code === "KeyF") return doAction()
        if (code === "KeyC" && me.mode === "watch") return world.cycleCam()
        if (code === "Escape" && me.mode !== "walk") return standUp()
        if (code === "KeyQ") return turnFollow(follow, 0.35)
        if (code === "KeyE") return turnFollow(follow, -0.35)
        keys.add(code)
      } else keys.delete(code)
      return ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyW", "KeyA", "KeyS", "KeyD", "ShiftLeft", "ShiftRight"].includes(code)
    },
    clearKeys() {
      keys.clear()
      input.x = input.y = 0
    },
    // a drag on the picture turns the camera round you (px)
    drag(dx) {
      if (me.mode === "walk" || me.mode === "sit") turnFollow(follow, -dx * 0.008)
    },
    action: doAction,
    watch,
    leave: standUp,
    cycleCam() {
      me.angle = (me.angle + 1) % SPECTATE_ANGLES.length
      sendHud(true)
      return angleName(me.angle, portrait())
    },
    say,
    emote,
    get courts() {
      return courts.map(courtView)
    },
    // the page: your name, look and rep
    setMe({ name, look, rep } = {}) {
      if (name) me.name = name
      if (rep) me.rep = rep
      if (look && look !== me.look) {
        me.look = look
        meBody.look = look
        net?.emit("park:look", { look })
      }
      park.setBoard([{ name: me.name, text: me.rep ? repLine(me.rep) : "Newcomer · 0-0", you: true }, ...[...remotes.values()].slice(0, 5).map((r) => ({ name: r.name, text: r.repText || "Newcomer" }))])
      if (rep) net?.emit("park:rep", { rep: { level: repLevel(rep.points).index, wins: rep.wins, losses: rep.losses, streak: rep.streak } })
      sendHud(true)
    },
    // away while you play a game / visit the Locker Room; back with where to stand
    suspend() {
      suspended = true
      world.clearKeys()
      // (people online see you leave the path: off playing, or in the pro shop)
      if (net) net.volatile("park:pos", packPos({ x: me.walker.x, z: me.walker.z, yaw: me.walker.yaw, speed: 0, act: ACTS.play }))
      lastSent = null
      for (const L of labels) if (L?.shown) {
        L.el.style.display = "none"
        L.shown = false
      }
    },
    resume({ court = null } = {}) {
      suspended = false
      if (court !== null && courts[court]) {
        const c = courts[court]
        me.walker.x = c.def.outside.x
        me.walker.z = c.def.outside.z
        me.walker.vx = me.walker.vz = 0
        me.walker.yaw = c.def.outYaw
        me.mode = "walk"
        me.seat = null
        follow.yaw = me.walker.yaw
        follow.pos = null
        // your game is over: the court moves on
        if (c.human?.mine) afterMyGame(c)
        net?.emit("park:done", { court })
      }
      meBody.anim = null
      sendHud(true)
    },
    get suspended() {
      return suspended
    },
    // (the hour the park shows: a game on one of its courts uses the same light)
    get hour() {
      return hourOverride ?? hourOf()
    },
    get mode() {
      return me.mode
    },
    // ---- online (the page's socket: usePark) ----
    setNet(n) {
      net = n
      if (!n) {
        for (const r of remotes.values()) removeBody(r.body)
        remotes.clear()
        myNum = null
        parkNo = null
        serverCourts = COURTS.map(() => ({ q: [], g: null }))
        updateRacks()
      }
      sendHud(true)
    },
    netJoined({ park: n, you, people = [], courts: list, rate }) {
      parkNo = n
      myNum = you
      netRate = rate || "normal"
      for (const v of people) addRemote(v)
      applyServerCourts(list)
      lastSent = null
      // (your paddle, if it was in a rack before you joined: the server keeps the rack now)
      if (me.queued !== null) {
        const id = me.queued
        courts[id].queue = leaveQueue(courts[id].queue, "me")
        net?.emit("park:call", { court: id })
      }
      sendHud(true)
    },
    netEvent(type, d) {
      if (type === "park:m" && d && Array.isArray(d.m)) {
        observeClock(netClock, d.t, performance.now())
        for (const row of d.m) {
          if (!Array.isArray(row)) continue
          const r = remotes.get(row[0])
          const p = unpackPos(row.slice(1))
          if (!r || !p) continue
          pushSample(r.track, d.t, p)
          if (r.body.hidden && p.act !== ACTS.play) r.body.hidden = false
        }
      } else if (type === "park:person" && d) addRemote(d)
      else if (type === "park:gone" && d) {
        const r = remotes.get(d.num)
        if (r) {
          removeBody(r.body)
          remotes.delete(d.num)
        }
      } else if (type === "park:fx" && d) {
        const r = remotes.get(d.num)
        if (!r) return
        if (Number.isInteger(d.line) && CHAT_LINES[d.line]) speak(r.body, CHAT_LINES[d.line], clock)
        if (d.emote && EMOTE_MOOD[d.emote]) {
          const m = EMOTE_MOOD[d.emote]
          r.body.mood = { kind: m[0], variant: m[1], at: clock }
          if (r.body.anim) setMood(r.body.anim, m[0], m[1])
          if (r.body.seat) r.body.clapT = 0
        }
      } else if (type === "park:courts") applyServerCourts(d)
      else if (type === "park:go" && d && courts[d.court]) myTurn(courts[d.court], { kind: d.kind === "room" ? "room" : "solo", roomId: d.roomId || null })
      else if (type === "park:rate" && d?.rate) netRate = d.rate
      sendHud(false)
    },
    // where you are in the park and what everyone's doing (tests)
    get info() {
      let full = 0
      let manns = mann.count
      for (const b of bodies.values()) if (b.fig?.group.parent) full++
      return {
        me: { x: me.walker.x, z: me.walker.z, yaw: me.walker.yaw, speed: me.walker.speed, gait: me.walker.gait, mode: me.mode, seat: me.seat?.id || null, watching: me.watching, queued: me.queued },
        camera: { x: camera.position.x, y: camera.position.y, z: camera.position.z, fov: camera.fov, yaw: follow.yaw },
        action,
        courts: courts.map((c) => ({ id: c.def.id, state: c.state, phase: c.match.phase, score: scoreboard(c.match).score, on: c.on.map((e) => e.id), queue: c.queue.map((e) => e.id), human: c.human })),
        regulars: regulars.map((r) => ({ id: r.id, state: r.state, x: r.x, z: r.z, seated: r.seated, court: r.court })),
        remotes: [...remotes.values()].map((r) => ({ num: r.num, name: r.name, x: r.body.x, z: r.body.z, hidden: r.body.hidden })),
        full,
        mannequins: manns,
        budget,
        bodies: bodies.size,
        net: net ? { park: parkNo, you: myNum, rate: netRate, courts: serverCourts } : null,
      }
    },
    // (tests) put yourself somewhere, set the hour, run a court to its end
    dev,
    // (tests) is anyone right in front of the lens? -> the body's key or null
    get blocker() {
      const look = new THREE.Vector3()
      camera.getWorldDirection(look)
      const cam = { x: camera.position.x, y: camera.position.y, z: camera.position.z }
      const at = { x: cam.x + look.x * 10, y: cam.y + look.y * 10, z: cam.z + look.z * 10 }
      const list = []
      for (const b of bodies.values()) if (!b.hidden && !(b.isMe && me.mode !== "watch")) list.push({ x: b.x, z: b.z, h: b.seat ? b.seat.y + 1.0 : 1.95, id: b.key })
      return blocker(cam, at, list, { near: 1.0, ahead: 2.2 })?.id || null
    },
    teleport(x, z, yaw = me.walker.yaw) {
      const p = resolve(x, z, 0.35)
      me.walker.x = p.x
      me.walker.z = p.z
      me.walker.yaw = yaw
      follow.yaw = yaw
      follow.pos = null
      if (me.mode !== "walk") standUp()
    },
    setHour(h) {
      hourOverride = h
      updateDay(true)
    },
    finishGame(id) {
      const c = courts[id]
      if (!c || c.state !== "playing") return false
      const w = rand() < 0.5 ? 0 : 1
      c.match.game.score = w ? [6, 11] : [11, 6]
      c.match.game.winner = w
      c.match.phase = "over"
      c.match.phaseT = 0
      c.state = "over"
      c.t = 0.2
      return true
    },
    // athletes arrived or the quality changed: make everyone's figure again
    refigure() {
      for (const b of bodies.values()) dropFig(b)
    },
    dispose() {
      if (disposed) return
      disposed = true
      for (const b of bodies.values()) dropFig(b)
      bodies.clear()
      for (const L of labels) L?.el.remove()
      labels.length = 0
      mann.dispose()
      park.dispose()
      blobs.geometry.dispose()
      blobs.material.dispose()
      blobTex.dispose()
      ballGeo.dispose()
      ballMat.dispose()
    },
  }
  // (tests: the park, also while it waits behind a game)
  if (import.meta.env?.DEV) {
    window.__park = world
    devHooks(world, { scene, park, exposure: () => exposure })
  }
  return world
}

// DEV only (tools/venues/compare.mjs): pictures of the venue for comparing with references.
// devShot({ w, h, ortho: { x0, x1, z0, z1 } }) is a top-down picture of that box (north up);
// devShot({ w, h, cam: { x, y, z, heading, pitch, fov } }) a photo from there (heading: compass
// degrees, pitch: degrees up). It draws with its own renderer set like the game's (color space,
// tone curve, exposure), people hidden unless people: true. devSwatches(list) lays flat color
// cards on the ground ({ x, z, hex, size, kind: "std" | "lambert", up }) to test the colors.
const devHooks = (world, { scene, park, exposure }) => {
  let r = null
  const swatches = []
  world.devShot = ({ w = 800, h = 600, ortho = null, cam = null, people = false, fog = !ortho } = {}) => {
    if (!r) {
      r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
      r.outputColorSpace = THREE.SRGBColorSpace
    }
    r.toneMapping = world.toneMapping ?? THREE.ACESFilmicToneMapping
    r.toneMappingExposure = exposure()
    r.setPixelRatio(1)
    r.setSize(w, h, false)
    let c
    if (ortho && ortho.y0 !== undefined) {
      // a front view looking north at the box x0..x1, y0..y1 (from south of z)
      const hw = (ortho.x1 - ortho.x0) / 2
      const hh = (ortho.y1 - ortho.y0) / 2
      c = new THREE.OrthographicCamera(-hw, hw, hh, -hh, 1, 2000)
      c.position.set((ortho.x0 + ortho.x1) / 2, (ortho.y0 + ortho.y1) / 2, (ortho.z ?? 0) + 600)
      c.lookAt(c.position.x, c.position.y, -1e6)
    } else if (ortho) {
      const cx = (ortho.x0 + ortho.x1) / 2
      const cz = (ortho.z0 + ortho.z1) / 2
      const hw = (ortho.x1 - ortho.x0) / 2
      const hd = (ortho.z1 - ortho.z0) / 2
      c = new THREE.OrthographicCamera(-hw, hw, hd, -hd, 1, 2000)
      c.position.set(cx, 900, cz)
      c.up.set(0, 0, -1)
      c.lookAt(cx, 0, cz)
    } else {
      const k = cam || {}
      c = new THREE.PerspectiveCamera(k.fov || 55, w / h, 0.1, 1500)
      const hd = ((k.heading || 0) * Math.PI) / 180
      const pt = ((k.pitch || 0) * Math.PI) / 180
      c.position.set(k.x || 0, k.y ?? 1.7, k.z || 0)
      c.lookAt(c.position.x + Math.sin(hd) * Math.cos(pt), c.position.y + Math.sin(pt), c.position.z - Math.cos(hd) * Math.cos(pt))
    }
    c.updateMatrixWorld(true)
    const hidden = []
    if (!people) for (const o of scene.children) if (o !== park.group && !o.isLight && o.visible && !swatches.includes(o)) (o.visible = false), hidden.push(o)
    const f = scene.fog
    if (!fog) scene.fog = null
    r.render(scene, c)
    scene.fog = f
    for (const o of hidden) o.visible = true
    return r.domElement.toDataURL("image/png")
  }
  world.devSwatches = (list = []) => {
    for (const s of swatches.splice(0)) {
      scene.remove(s)
      s.geometry.dispose()
      s.material.dispose()
    }
    for (const s of list) {
      const M = s.kind === "lambert" ? THREE.MeshLambertMaterial : THREE.MeshStandardMaterial
      const m = new THREE.Mesh(new THREE.PlaneGeometry(s.size || 2, s.size || 2), new M({ color: new THREE.Color(s.hex), ...(s.kind === "lambert" ? {} : { roughness: s.roughness ?? 0.85 }) }))
      if (s.up) m.position.set(s.x, s.y ?? (s.size || 2) / 2 + 0.05, s.z)
      else {
        m.rotation.x = -Math.PI / 2
        m.position.set(s.x, s.y ?? 0.05, s.z)
      }
      if (s.facing !== undefined) m.rotation.y = s.facing
      scene.add(m)
      swatches.push(m)
    }
    return swatches.length
  }
}

export { INTERACTABLES }
