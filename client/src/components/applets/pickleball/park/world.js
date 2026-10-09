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

import { createSplatLayer } from "./splat/layer.js"
import { getBackdrop, readBytes } from "./splat/store.js"
import { createPetLayer } from "../../viewer3d/petLayer.js"
import * as THREE from "three"
import { createAnim, setMood, situation, updateAnim, seatedPose } from "../anim.js"
import { blocker } from "../camera.js"
import { setSurfacesOn } from "./surfaces.js"
import { advance, beginPoint, createMatch, scoreboard, seeded } from "../match.js"
import { buildPark } from "./build.js"
import { createPost } from "./post.js"
import { aoUniforms, lastAO, setBakedAOOn } from "./occlusion.js"
import { createMannequins } from "./mannequin.js"
import { spotFor } from "./presence.js"
import { cleanMemory, meetRegular, pickLine, scheduleFor } from "./living.js"
import { helloFor, seatAt, seatNextTo } from "./hangout.js"
import { ACTIVE, ALL_SEATS, COURTS, INTERACTABLES, LEVEL_NAMES, RIVERSIDE_LAYOUT, SPAWN, WAYPOINTS, dirToWorld, nearestAction, poseToWorld, resolve, seatApproach, setLayout, toLocal, toWorld, yawToWorld } from "./layout.js"
import { callNext, leaveQueue, nextLineup, ordered, positionOf } from "./queue.js"
import { LINES, createRegular, goTo, speak, think, tickRegular } from "./regulars.js"
import { createWalker, keepApart, stepWalker } from "./walker.js"
import { liftPose } from "./lift.js"
import { angleName, createFollow, spectatorShot, stepFollow, turnFollow, SPECTATE_ANGLES } from "./followcam.js"
import { dayLook, hourOf, overrideDate, realLook } from "./sky.js"
import { lookFor as timeLook } from "./timeofday.js"
import { CLEAR, OVERRIDES, cachedWeather, fetchWeather } from "./weather.js"
import { EMOTE_KINDS, EMOTE_POSE, EMOTE_SECONDS, LINK_KINDS, SELFIE_AT, SELFIE_COUNT, SELFIE_HOLD, breaksAway, emoteSpots, followTarget, givesSpace, isGolden, lapseAt, lapseStart, momentShot, nameKey, nearestPal, padToward, pickSeats, selfieShot, teamCourt, twirlAngle } from "./together.js"
import { cameraBlockers } from "../play/courtpick.js"
import { sunPosition } from "./solar.js"
import { timeDate } from "./timeofday.js"

// Real Sky: Riverside isn't a real place; it borrows a Southern California park's sky
export const DEFAULT_SKY_PLACE = { lat: 33.709, lon: -117.954 }
import { ACTS, createClock, createTrack, observeClock, packPos, pushSample, sampleTrack, serverTime, shouldSend, unpackPos, UP_BIT } from "./interp.js"
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

export const createWorld = ({ layout = RIVERSIDE_LAYOUT, makeFigure, quality = "medium", phone = false, renderer = null, me: meInfo = {}, onHud, onEvent, labelsEl = null, audio = null, seed = (Math.random() * 1e9) | 0, hour = null, sky = { real: true, mode: "real" }, memory = null, onMemory = null } = {}) => {
  // (the venue: layout.js's named exports follow the active layout)
  setLayout(layout)
  const venue = layout
  // (indoors: cameras stay under the lowest hall roof)
  const halls = layout.spec.scene?.halls || []
  const rooms = layout.spec.scene?.rooms || []
  const inPoly = (x, z, poly) => {
    let inside = false
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, zi] = poly[i]
      const [xj, zj] = poly[j]
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
    }
    return inside
  }
  // the ceiling over a spot (a room's or a hall's), for the cameras: null outdoors
  // (y: the floor you're on: a room upstairs counts only up there, the ground floor's only below)
  const onFloor = (r, y) => Math.abs((r.y || 0) - (y || 0)) < 1.2
  // (a room open to the hall above, `open`: a bar under a mezzanine, has the hall's ceiling;
  // up on a mezzanine inside a hall the hall's ceiling still caps the camera)
  const roofAt = (x, z, y = 0) => {
    for (const r of rooms) if (!r.open && onFloor(r, y) && inPoly(x, z, r.p)) return (r.y || 0) + (r.h || 3.2) - 0.35
    for (const h of halls) if (y < (h.h || 9) - 2.5 && inPoly(x, z, h.p)) return (h.h || 9) - 0.6
    return null
  }
  const roomAt = (x, z, y = 0) => rooms.find((r) => onFloor(r, y) && inPoly(x, z, r.p)) || null
  const roofY = halls.length ? Math.min(...halls.map((h) => h.h || 9)) - 0.6 : null
  const rand = seeded(seed)
  const scene = new THREE.Scene()
  // (near 0.15: depth precision for the court paint layers far away on phones)
  const camera = new THREE.PerspectiveCamera(55, 1, 0.15, 400)
  const park = buildPark(scene, { quality, layout, phone })
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
  // Real Sky (Options > Real Sky and Weather; Medium/High): the true sun and moon for the
  // venue's own coordinates and its weather right now (Open-Meteo, 20-minute cache); off, or on
  // Low, the classic hour-based looks. A mode other than "real" fixes the weather (and sunset /
  // night fix the hour) for fun.
  let skyCfg = { real: true, mode: "real", ...(sky || {}) }
  const origin = layout.spec?.origin
  const place = Array.isArray(origin) && Number.isFinite(origin[0]) ? { lat: origin[0], lon: origin[1] } : DEFAULT_SKY_PLACE
  const skyOn = () => !!skyCfg.real && quality !== "low"
  let weather = null
  let wxAt = -1e9
  let look = null
  let lapseDate = null // watching the sunset together: the sky's own moment (together.js lapseAt)
  const lookNow = () => {
    if (lapseDate) return skyOn() ? realLook({ date: lapseDate, lat: place.lat, lon: place.lon, weather: CLEAR }) : dayLook(lapseDate.getHours() + lapseDate.getMinutes() / 60)
    // the time of day you chose (timeofday.js: morning, midday, golden hour, night; "now" is
    // the real clock), unless a test set the hour
    const chosen = hourOverride == null && skyCfg.time && skyCfg.time !== "now" && !OVERRIDES[skyCfg.mode]?.hourOffset ? skyCfg.time : null
    if (chosen) return timeLook(chosen, place, { real: skyOn() })
    if (!skyOn()) return dayLook(hourOverride ?? hourOf())
    const o = OVERRIDES[skyCfg.mode]
    let date = new Date()
    if (hourOverride != null) {
      date = new Date()
      date.setHours(Math.floor(hourOverride), Math.round((hourOverride % 1) * 60), 0, 0)
    }
    if (o?.hourOffset) date = overrideDate(o.hourOffset, place.lat, place.lon, date)
    return realLook({ date, lat: place.lat, lon: place.lon, weather: o ? o.weather : weather || cachedWeather(place) || CLEAR })
  }
  const refreshWeather = () => {
    wxAt = clock
    if (!skyOn() || OVERRIDES[skyCfg.mode]) return
    fetchWeather(place).then((w) => {
      if (!w || disposed) return
      weather = w
      updateDay(true)
    })
  }
  const updateDay = (force) => {
    if (skyOn() && clock - wxAt > 20 * 60) refreshWeather()
    if (!force && clock - dayAt < 60) return
    dayAt = clock
    const d = lookNow()
    look = d
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
    c.match = createMatch({ doubles: true, scoring: "rally", target: AI_TARGET, level: c.def.level, seed: (seed + c.def.id * 7919 + c.gameNo * 104729) >>> 0, assist: "reflex", roster: rosterOf(c, entries), ball: layout.spec?.indoor ? "indoor" : "outdoor" })
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
  let voiceTalk = new Set() // park numbers whose voice is coming through right now (labels)
  let lastSent = null
  let serverCourts = COURTS.map(() => ({ q: [], g: null }))

  // ---------- together (together.js; server/park/together.js): only ever after a yes ----------
  // friends: the name keys of your partner and buddies (the Together button shows near them)
  // link: walking together { kind, other: num, lead: you lead }; links: other people's
  // ("a|b" -> { a, b, kind, lead }); moveTo: stepping into place for a hug or a picture (your
  // own stick ends it); emote / selfie / sunset / date: what's going on with whom
  const tg = { friends: null, link: null, links: new Map(), moveTo: null, emote: null, selfie: null, sunset: null, date: null, autoSat: false, pal: null }
  const tgOther = (num) => remotes.get(num) || null
  const linkKey = (a, b) => `${Math.min(a, b)}|${Math.max(a, b)}`
  // a kept mood on a body (holding hands, dancing, the selfie): set it or take it away
  const keepMood = (b, kind, variant = 0) => {
    if (!b) return
    if (!kind) {
      if (b.mood?.keep) b.mood = null
      if (b.anim?.mood?.keep) b.anim.mood = null
      return
    }
    if (b.mood?.keep && b.mood.kind === kind && b.mood.variant === variant) return
    b.mood = { kind, variant, at: clock, keep: true }
    if (b.anim) setMood(b.anim, kind, variant, true)
  }
  const tgEvent = (type, extra = {}) => onEvent?.({ type, ...extra })

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
  const setLabel = (i, x, y, z, name, sub, say, kind, talk = false) => {
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
    if (L.talk !== talk) {
      L.talk = talk
      if (talk) L.el.dataset.talk = "1"
      else delete L.el.dataset.talk
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
    // (up on a terrace: the courts' racks and benches are down below)
    if ((me.walker.y || 0) > 1.2) return null
    // (a friend online sitting near you: sit with them)
    const pal = sittingFriendNear(3.2)
    if (pal) return { kind: "sitWith", seat: pal.seat.id, label: `Sit with ${pal.name}`, detail: "Next to them on the bench" }
    // (a friend's clone left here: walk up to challenge it)
    const cl = nearestClone(2.4)
    if (cl) return { kind: "challenge", owner: cl.owner, label: `Challenge ${cl.name}'s clone`, detail: "Plays the way they really play" }
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
    const hud = { mode: me.mode, action, watching, queued, online: net ? { park: parkNo, people: remotes.size + 1, rate: netRate } : null, tg: net ? tgHud() : null }
    const key = JSON.stringify(hud)
    if (!force && key === hudKey) return
    hudKey = key
    onHud?.(hud)
  }

  // a friend online who's sitting within d of you, and a free seat by them
  const sittingFriendNear = (d) => {
    let best = null
    for (const r of remotes.values()) {
      const b = r.body
      if (!b?.seat || b.hidden) continue
      const dd = Math.hypot(b.x - me.walker.x, b.z - me.walker.z)
      if (dd > d || (best && dd >= best.d)) continue
      const theirs = seatAt(ALL_SEATS, b.seat.x, b.seat.z) || { id: `n${r.num}`, x: b.seat.x, z: b.seat.z }
      const seat = seatNextTo(ALL_SEATS, (s) => !takenSeats.has(s.id), theirs)
      if (seat) best = { d: dd, name: r.name, seat }
    }
    return best
  }

  // ---------- together: the walking, the moments, the selfie, the sunset ----------
  // the sunset's view: from behind the two of you, the sky ahead where the sun goes down
  const sunsetShot = () => {
    const sd = sunDirNow() || { x: Math.sin(me.seat.yaw), z: Math.cos(me.seat.yaw) }
    const ob = tgOther(tg.sunset.other)?.body
    const mx = ob?.seat ? (ob.seat.x + me.seat.x) / 2 : me.seat.x
    const mz = ob?.seat ? (ob.seat.z + me.seat.z) / 2 : me.seat.z
    const y0 = me.seat.y > 0.6 ? 0.5 : 0
    return { cam: { x: mx - sd.x * 3.4, y: y0 + 1.85, z: mz - sd.z * 3.4 }, look: { x: mx + sd.x * 30, y: y0 + 6, z: mz + sd.z * 30 }, fov: portrait() ? 64 : 52 }
  }
  // nothing solid between two people and a camera looking at them (real venues)
  const clearLens = (cam, m) => venue.kind === "riverside" || !venue.segmentHit || venue.segmentHit({ x: m.x, z: m.z }, cam, 1.4) === null
  const faceOther = (num) => {
    const b = tgOther(num)?.body
    return b ? Math.atan2(b.x - me.walker.x, b.z - me.walker.z) : undefined
  }
  const tgMateBody = () => {
    const n = tg.link?.other ?? tg.emote?.other ?? tg.selfie?.other ?? null
    return n === null ? null : tgOther(n)?.body || null
  }
  // your own walking while together (frame): -> a pad push to use instead of yours, or null
  const togetherWalk = (own, dt) => {
    const pushing = breaksAway(own)
    if (tg.moveTo) {
      // stepping into place for a hug or a picture: your own stick ends it
      if (pushing || clock > tg.moveTo.until) {
        tg.moveTo = null
        return null
      }
      const p = padToward(me.walker, tg.moveTo, follow.yaw, { stopWithin: 0.05 })
      if (p.arrived) {
        const face = tg.moveTo.yaw
        tg.moveTo = null
        return { x: 0, y: 0, sprint: false, face }
      }
      return { ...p, face: tg.moveTo.yaw }
    }
    const l = tg.link
    if (!l || l.lead) return null
    const other = tgOther(l.other)
    if (!other || other.body.hidden) return null
    // the owner's rule: your own stick is yours. A push lets go
    if (pushing) {
      tgUnlink()
      return null
    }
    const ob = other.body
    if (ob.seat) return null
    const target = followTarget(l.kind, { x: ob.x, z: ob.z, yaw: ob.yaw, vx: ob.vx, vz: ob.vz })
    const p = padToward(me.walker, target, follow.yaw, { speed: ob.speed || 0, stopWithin: l.kind === "hand" ? 0.12 : 0.35 })
    void dt
    return { ...p, face: (ob.speed || 0) < 0.3 ? (l.kind === "hand" ? ob.yaw : Math.atan2(ob.x - me.walker.x, ob.z - me.walker.z)) : undefined }
  }
  // which hand reaches for whom (anim.js "hold": 0 = toward the paddle hand's side)
  const holdVariant = (b, partnerOnRight) => (partnerOnRight !== (b?.look?.plays === "left") ? 0 : 1)
  const linkMoods = (l, on) => {
    const A = l.a === myNum ? meBody : tgOther(l.a)?.body
    const B = l.b === myNum ? meBody : tgOther(l.b)?.body
    if (l.kind !== "hand") return
    const leadB = l.lead === l.a ? A : B
    const folB = leadB === A ? B : A
    if (!on) {
      keepMood(A, null)
      keepMood(B, null)
      return
    }
    // (the one not leading walks on the leader's right: together.js followTarget)
    keepMood(leadB, "hold", holdVariant(leadB, true))
    keepMood(folB, "hold", holdVariant(folB, false))
  }
  const tgUnlink = () => {
    if (!tg.link) return
    const was = tg.link
    tg.link = null
    tg.autoSat = false
    linkMoods({ a: myNum, b: was.other, kind: was.kind, lead: was.lead ? myNum : was.other }, false)
    net?.emit("park:unlink", {})
    tgEvent("tgNote", { text: was.kind === "hand" ? "You let go." : "You stopped following." })
    sendHud(true)
  }
  // a seat a regular sits on here (each browser has its own regulars): they get up for you
  const freeSeatFor = (seat) => {
    const who = takenSeats.get(seat.id)
    if (!who || who === "me") return true
    if (String(who).startsWith("n")) return false
    const r = regulars.find((x) => x.id === who)
    takenSeats.delete(seat.id)
    if (r) {
      const a = seatApproach(seat)
      r.seat = null
      r.seated = false
      r.hang = false
      r.state = "wander"
      r.t = 0.1
      r.x = a.x
      r.z = a.z
      r.path = []
    }
    return true
  }
  const sitTogether = (seatIds, mine) => {
    const seat = ALL_SEATS.find((s) => s.id === seatIds[mine])
    if (!seat) return false
    if (me.mode !== "walk") standUp()
    if (!freeSeatFor(seat)) return false
    sitOn(seat)
    me.mode = "sit"
    sendHud(true)
    return true
  }
  const sunDirNow = () => {
    const s = look?.sunSky
    if (!s) return null
    const l = Math.hypot(s.x, s.z) || 1
    return { x: s.x / l, z: s.z / l }
  }
  const elevationAt = (d) => sunPosition(d, place.lat, place.lon).elevation
  const startSunset = (other) => {
    const golden = timeDate("golden", place.lat, place.lon, new Date())
    tg.sunset = { other, t: 0, start: lapseStart(new Date(), golden, elevationAt), stepAt: 0 }
    lapseDate = tg.sunset.start
    updateDay(true)
  }
  const endSunset = (tell = true) => {
    if (!tg.sunset) return
    const other = tg.sunset.other
    tg.sunset = null
    lapseDate = null
    updateDay(true)
    if (tell) net?.emit("park:tgend", { to: other, kind: "sunset" })
    sendHud(true)
  }
  const startEmote = (kind, a, b) => {
    const mine = a === myNum ? 0 : b === myNum ? 1 : -1
    const A = a === myNum ? meBody : tgOther(a)?.body
    const B = b === myNum ? meBody : tgOther(b)?.body
    if (!A || !B) return
    const pose = EMOTE_POSE[kind]
    if (mine >= 0) {
      // step into place facing each other (where they'll be: the same sums on both screens)
      const spots = emoteSpots(a === myNum ? { x: me.walker.x, z: me.walker.z, yaw: me.walker.yaw } : A, b === myNum ? { x: me.walker.x, z: me.walker.z, yaw: me.walker.yaw } : B, kind)
      if (me.mode !== "walk") standUp()
      tg.moveTo = { ...spots[mine], until: clock + 1.6 }
      tg.emote = { kind, other: mine === 0 ? b : a, role: mine, t: 0, started: false }
    } else {
      // someone else's: shown as it happens
      for (const [body, p] of [
        [A, pose[0]],
        [B, pose[1]],
      ])
        playEmote(body, kind, p)
    }
  }
  const playEmote = (body, kind, [mood, variant]) => {
    if (kind === "dance") {
      keepMood(body, mood, variant)
      body.danceUntil = clock + EMOTE_SECONDS.dance
    } else {
      body.mood = { kind: mood, variant, at: clock }
      if (body.anim) setMood(body.anim, mood, variant)
    }
    if (kind === "twirl" && mood === "twirl" && variant === 0) body.twirlAt = clock
  }
  const startSelfie = (a, b) => {
    const mine = a === myNum ? 0 : 1
    const other = mine === 0 ? b : a
    const ob = tgOther(other)?.body
    if (!ob) return
    if (me.mode !== "walk") standUp()
    const mePos = { x: me.walker.x, z: me.walker.z }
    // the background: the low sun at golden hour, else the nearest court
    const sun = sunDirNow()
    const mid = { x: (mePos.x + ob.x) / 2, z: (mePos.z + ob.z) / 2 }
    const golden = isGolden(look?.sunEl)
    let toward = null
    if (golden && sun) toward = { x: mid.x + sun.x * 20, z: mid.z + sun.z * 20 }
    else {
      let best = null
      for (const c of COURTS) {
        const d = Math.hypot(c.x - mid.x, c.z - mid.z)
        if (!best || d < best.d) best = { d, x: c.x, z: c.z }
      }
      toward = best
    }
    const isClear = clearLens
    // (the asker on one side and the one asked on the other, the same on both screens)
    const A = mine === 0 ? mePos : { x: ob.x, z: ob.z }
    const B = mine === 0 ? { x: ob.x, z: ob.z } : mePos
    const shot = selfieShot(A, B, toward, isClear, { portrait: portrait() })
    tg.moveTo = { ...shot.spots[mine], until: clock + 2.4 }
    tg.selfie = { other, role: mine, t: 0, shot, golden, taken: false }
    keepMood(meBody, "selfie", mine === 0 ? 0 : 1)
    keepMood(ob, "selfie", mine === 0 ? 1 : 0)
    sendHud(true)
  }
  const endSelfie = () => {
    if (!tg.selfie) return
    const ob = tgOther(tg.selfie.other)?.body
    keepMood(meBody, null)
    keepMood(ob, null)
    tg.selfie = null
    tg.moveTo = null
    sendHud(true)
  }
  // the picture: drawn once more with the selfie camera at a sharper pixel ratio, as the page shows a flash
  const snapSelfie = () => {
    if (!renderer) return null
    const prev = renderer.getPixelRatio()
    try {
      const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1
      renderer.setPixelRatio(Math.min(2, Math.max(prev, dpr)))
      renderer.render(scene, camera)
      return renderer.domElement.toDataURL("image/jpeg", 0.92)
    } catch (error) {
      console.warn("[park] selfie", error)
      return null
    } finally {
      renderer.setPixelRatio(prev)
    }
  }
  // every frame (after the people online moved): walking together, the moments, the lapse
  const togetherStep = (dt) => {
    // the links' hand-holding: on my screen they're exactly side by side when close
    const l = tg.link
    if (l) {
      const other = tgOther(l.other)
      if (!other) {
        tg.link = null
        tg.autoSat = false
        keepMood(meBody, null)
      } else if (l.kind === "hand") {
        const ob = other.body
        // (sitting down together: the one walking beside sits next to the one leading, and
        // stands when they do)
        if (!l.lead && ob.seat && me.mode === "walk" && Math.hypot(ob.x - me.walker.x, ob.z - me.walker.z) < 3.2) {
          const theirs = seatAt(ALL_SEATS, ob.seat.x, ob.seat.z) || { id: `n${l.other}`, x: ob.seat.x, z: ob.seat.z }
          const seat = seatNextTo(ALL_SEATS, (s) => !takenSeats.has(s.id) || !String(takenSeats.get(s.id)).startsWith("n"), theirs)
          if (seat && freeSeatFor(seat)) {
            sitOn(seat)
            tg.autoSat = true
          }
        } else if (!l.lead && tg.autoSat && me.mode === "sit" && !ob.seat) {
          standUp()
          tg.autoSat = false
        }
        if (!ob.seat && me.mode === "walk" && !ob.hidden) {
          // the glue: their drawn spot pulled to just beside you (the network's lag hidden)
          const r = { x: -Math.cos(me.walker.yaw), z: Math.sin(me.walker.yaw) }
          const sgn = l.lead ? 1 : -1
          // (never into a wall or a fence: where they could really stand)
          const at = resolve(me.walker.x + r.x * 0.62 * sgn, me.walker.z + r.z * 0.62 * sgn, 0.3, me.walker.y || 0)
          const ix = at.x
          const iz = at.z
          const d = Math.hypot(ob.x - ix, ob.z - iz)
          ob.glue = Math.min(1, Math.max(0, (ob.glue || 0) + (d < 1.4 ? dt * 3 : -dt * 3)))
          if (ob.glue > 0) {
            ob.x += (ix - ob.x) * ob.glue
            ob.z += (iz - ob.z) * ob.glue
            if (me.walker.speed > 0.3) ob.yaw += wrap(me.walker.yaw - ob.yaw) * ob.glue
          }
        }
      }
    }
    // a paired emote of yours: once you've stepped into place, the two of you do it
    const e = tg.emote
    if (e) {
      e.t += dt
      const ob = tgOther(e.other)?.body
      if (!ob) tg.emote = null
      else {
        if (!e.started && (!tg.moveTo || e.t > 1.6)) {
          e.started = true
          // (the camera side on to the two of you for the moment)
          e.shot = momentShot({ x: me.walker.x, z: me.walker.z }, ob, camera.position, clearLens, { portrait: portrait() })
          e.startT = e.t
          tg.moveTo = null
          me.walker.yaw = Math.atan2(ob.x - me.walker.x, ob.z - me.walker.z)
          const pose = EMOTE_POSE[e.kind]
          playEmote(meBody, e.kind, pose[e.role])
          playEmote(ob, e.kind, pose[1 - e.role])
        }
        if (e.started && e.t - e.startT > EMOTE_SECONDS[e.kind] + 0.2) tg.emote = null
      }
    }
    // twirls and dances (yours and everyone's)
    for (const b of [meBody, ...[...remotes.values()].map((r) => r.body)]) {
      if (b.twirlAt !== undefined && b.twirlAt !== null) {
        const t = clock - b.twirlAt
        b.spin = twirlAngle(t)
        if (t > 2.2) {
          b.spin = 0
          b.twirlAt = null
        }
      }
      if (b.danceUntil && clock > b.danceUntil) {
        b.danceUntil = 0
        keepMood(b, null)
      }
    }
    // the selfie: count down, click, hold, done
    const s = tg.selfie
    if (s) {
      s.t += dt
      if (!tgOther(s.other)) endSelfie()
      else if (s.t >= SELFIE_AT && !s.taken) {
        s.taken = true
        const url = snapSelfie()
        tgEvent("selfie", { url, golden: s.golden, with: tgOther(s.other)?.name || "", asker: s.role === 0 })
      } else if (s.t > SELFIE_AT + SELFIE_HOLD) endSelfie()
    }
    // the sunset: the sky moves on gently while you sit; standing up ends it
    const ss = tg.sunset
    if (ss) {
      if (me.mode !== "sit") endSunset(true)
      else {
        ss.t += dt
        if (ss.t - ss.stepAt > 0.5) {
          ss.stepAt = ss.t
          const next = lapseAt(ss.start, ss.t, elevationAt)
          if (next) {
            lapseDate = next
            updateDay(true)
          }
        }
      }
    }
  }
  // what the Together button and its chips show
  const tgHud = () => {
    const l = tg.link
    const s = tg.selfie
    return {
      pal: tg.pal ? { num: tg.pal.num, name: tg.pal.name } : null,
      link: l ? { kind: l.kind, lead: l.lead, name: tgOther(l.other)?.name || "", num: l.other } : null,
      date: tg.date ? { name: tgOther(tg.date.other)?.name || "", num: tg.date.other } : null,
      sunset: tg.sunset ? { name: tgOther(tg.sunset.other)?.name || "", num: tg.sunset.other } : null,
      selfie: s ? { left: Math.max(0, Math.ceil(SELFIE_COUNT - s.t)), num: s.other, flash: s.taken } : null,
      emote: tg.emote ? tg.emote.kind : null,
    }
  }
  const updatePal = () => {
    const people = []
    for (const r of remotes.values()) people.push({ num: r.num, name: r.name, x: r.body.x, z: r.body.z, hidden: r.body.hidden })
    tg.pal = me.mode === "watch" ? null : nearestPal(me.walker, people, tg.friends, 6)
  }
  // the court for playing together: free, the clearest camera, near you
  let courtBlockers = null
  const tgCourt = () => {
    courtBlockers ??= COURTS.map((c) => (venue.kind === "riverside" || !layout.BOXES ? 0 : cameraBlockers(layout, c)))
    return teamCourt(
      courts.map((c) => ({ id: c.def.id, x: c.def.x, z: c.def.z, busy: !!serverCourts[c.def.id]?.g || c.state === "human", blockers: courtBlockers[c.def.id] || 0 })),
      me.walker
    )
  }
  // an ask's data (where to sit, which court)
  const askData = (kind, other) => {
    if (kind === "sit" || kind === "sunset") {
      const ob = tgOther(other)?.body
      const from = ob ? { x: (ob.x + me.walker.x) / 2, z: (ob.z + me.walker.z) / 2 } : me.walker
      const pair = pickSeats(ALL_SEATS, (s) => !takenSeats.has(s.id) || takenSeats.get(s.id) === "me" || !String(takenSeats.get(s.id)).startsWith("n"), from, { sunDir: kind === "sunset" ? sunDirNow() : null, max: kind === "sunset" ? 60 : 30 })
      return pair ? { seats: [pair[0].id, pair[1].id] } : null
    }
    if (kind === "team" || kind === "rally") return { court: tgCourt() }
    return {}
  }
  // the server's together news (server/park/together.js)
  const togetherEvent = (type, d) => {
    if (type === "park:ask") return tgEvent("tgAsk", { id: d.id, from: d.from, name: d.name, kind: d.kind, data: d.data || {} })
    if (type === "park:answer") return tgEvent("tgAnswer", { id: d.id, yes: !!d.yes, num: d.num, name: tgOther(d.num)?.name || "", error: d.error || null })
    const mineOf = (a, b) => (a === myNum ? b : b === myNum ? a : null)
    if (type === "park:link") {
      const other = mineOf(d.a, d.b)
      if (other !== null) {
        const name = tgOther(other)?.name || ""
        if (d.kind) {
          if (tg.link) linkMoods({ a: myNum, b: tg.link.other, kind: tg.link.kind, lead: tg.link.lead ? myNum : tg.link.other }, false)
          tg.link = { kind: d.kind, other, lead: d.lead === myNum }
          tg.autoSat = false
          // (the one walking along stands up to go)
          if (!tg.link.lead && me.mode !== "walk") standUp()
          linkMoods(d, true)
          tgEvent("tgLink", { kind: d.kind, lead: tg.link.lead, name })
        } else if (tg.link && tg.link.other === other) {
          linkMoods({ a: myNum, b: other, kind: tg.link.kind, lead: tg.link.lead ? myNum : other }, false)
          const was = tg.link.kind
          tg.link = null
          tg.autoSat = false
          if (d.by !== myNum) tgEvent("tgNote", { text: d.by === other ? (was === "hand" ? `${name} let go.` : `${name} stopped.`) : "You drifted apart." })
        }
      } else {
        const key = linkKey(d.a, d.b)
        const old = tg.links.get(key)
        if (old) linkMoods(old, false)
        if (d.kind) {
          tg.links.set(key, d)
          linkMoods(d, true)
        } else tg.links.delete(key)
      }
      return sendHud(true)
    }
    if (type === "park:tg") {
      const other = mineOf(d.a, d.b)
      const kind = d.kind
      if (other === null) {
        if (EMOTE_KINDS.includes(kind)) startEmote(kind, d.a, d.b)
        return
      }
      const role = d.a === myNum ? 0 : 1
      const name = tgOther(other)?.name || ""
      if (kind === "sit" || kind === "sunset") {
        if (!sitTogether(d.data?.seats || [], role)) tgEvent("tgNote", { text: "Someone's on that bench now." })
        else if (kind === "sunset") startSunset(other)
      } else if (kind === "selfie") startSelfie(d.a, d.b)
      else if (kind === "date") tg.date = { other }
      else if (EMOTE_KINDS.includes(kind)) startEmote(kind, d.a, d.b)
      tgEvent("tgStart", { kind, name, num: other, data: d.data || {}, asker: role === 0 })
      return sendHud(true)
    }
    if (type === "park:tgend") {
      const name = tgOther(d.from)?.name || ""
      const all = d.kind === "all"
      if ((all || d.kind === "date") && tg.date?.other === d.from) {
        tg.date = null
        tgEvent("tgEnd", { kind: "date", name })
      }
      if ((all || d.kind === "sunset") && tg.sunset?.other === d.from) {
        endSunset(false)
        tgEvent("tgEnd", { kind: "sunset", name })
      }
      if ((all || d.kind === "selfie") && tg.selfie?.other === d.from) {
        endSelfie()
        tgEvent("tgEnd", { kind: "selfie", name })
      }
      if ((all || d.kind === "dance") && tg.emote?.kind === "dance" && tg.emote.other === d.from) {
        tg.emote = null
        meBody.danceUntil = clock
        const ob = tgOther(d.from)?.body
        if (ob) ob.danceUntil = clock
      }
      return sendHud(true)
    }
  }
  // someone left the park: anything with them is over
  const togetherGone = (num) => {
    if (tg.link?.other === num) {
      linkMoods({ a: myNum, b: num, kind: tg.link.kind, lead: tg.link.lead ? myNum : num }, false)
      tg.link = null
      tg.autoSat = false
    }
    if (tg.date?.other === num) {
      tg.date = null
      tgEvent("tgEnd", { kind: "date", name: tgOther(num)?.name || "" })
    }
    if (tg.sunset?.other === num) endSunset(false)
    if (tg.selfie?.other === num) endSelfie()
    if (tg.emote?.other === num) tg.emote = null
    for (const [key, l] of tg.links) if (l.a === num || l.b === num) {
      linkMoods(l, false)
      tg.links.delete(key)
    }
  }
  // you stop something (the chips' Let go / End / Stand up)
  const tgStop = (kind) => {
    if (kind === "hand" || kind === "follow") return tgUnlink()
    if (kind === "date" && tg.date) {
      net?.emit("park:tgend", { to: tg.date.other, kind: "date" })
      tg.date = null
      tgEvent("tgEnd", { kind: "date", name: "", mine: true })
    } else if (kind === "sunset" && tg.sunset) {
      endSunset(true)
      if (me.mode === "sit") standUp()
    } else if (kind === "selfie" && tg.selfie) {
      net?.emit("park:tgend", { to: tg.selfie.other, kind: "selfie" })
      endSelfie()
    } else if (kind === "dance" && tg.emote?.kind === "dance") {
      net?.emit("park:tgend", { to: tg.emote.other, kind: "dance" })
      meBody.danceUntil = clock
      const ob = tgOther(tg.emote.other)?.body
      if (ob) ob.danceUntil = clock
      tg.emote = null
    }
    sendHud(true)
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
    // (standing up yourself from beside the one you hold hands with: you let go)
    if (a.kind === "stand" && tg.autoSat) tgUnlink()
    if (a.kind === "leave" || a.kind === "stand") standUp()
    else if (a.kind === "watch") watch(a.court)
    else if (a.kind === "rack") toggleQueue(a.court)
    else if (a.kind === "sitWith") {
      const seat = a.seat && a.seat.id ? a.seat : ALL_SEATS.find((s) => s.id === (a.seat?.id || a.seat))
      if (seat && !takenSeats.has(seat.id)) sitOn(seat)
    } else if (a.kind === "sit") {
      const seat = ALL_SEATS.filter((s) => s.bench === a.bench && !takenSeats.has(s.id)).sort((x, y) => Math.hypot(x.x - me.walker.x, x.z - me.walker.z) - Math.hypot(y.x - me.walker.x, y.z - me.walker.z))[0]
      if (seat) sitOn(seat)
    } else if (a.kind === "locker") onEvent?.({ type: "locker" })
    else if (a.kind === "machine") onEvent?.({ type: "machine" })
    else if (a.kind === "challenge") onEvent?.({ type: "challenge", owner: a.owner, court: nearestCourt() })
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
  const myTurn = (c, { kind = "solo", roomId = null, together = null } = {}) => {
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
    onEvent?.({ type: "turn", court: c.def.id, kind, roomId, together, level: c.def.level, lineup: lineup.map((e, i) => ({ id: e.id, me: !!e.me, team: i < 2 ? 0 : 1, name: entryName(e), look: entryLook(e) })) })
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

  // ---------- Living Park (living.js): friends' clones left here, regulars who remember you ----------
  // A clone is shown, not driven: it stands with the others by the entrance until challenged,
  // and only ever says lines from its owner's phrasebook. list: [{ owner, name, look, phrases }]
  const cloneBodies = () => [...bodies.values()].filter((b) => b.clone)
  const setClones = (list = []) => {
    const keep = new Set()
    const shown = list.filter((c) => c?.owner).slice(0, 8)
    shown.forEach((c, k) => {
      const key = `clone:${c.owner}`
      keep.add(key)
      let b = bodies.get(key)
      if (!b) {
        b = makeBody(key, c.look || null, c.name, { clone: true, owner: c.owner })
        // a little group facing the way in, a few steps from where you arrive
        const side = (k - (shown.length - 1) / 2) * 1.5
        const fx = Math.sin(SPAWN.yaw)
        const fz = Math.cos(SPAWN.yaw)
        const p = resolve(SPAWN.x + fx * 6 + fz * side, SPAWN.z + fz * 6 - fx * side, 0.35)
        b.x = p.x
        b.z = p.z
        b.yaw = SPAWN.yaw + Math.PI
      }
      b.name = c.name
      b.phrases = c.phrases || null
      b.speed = 0
      b.vx = 0
      b.vz = 0
    })
    for (const b of cloneBodies()) if (!keep.has(b.key)) removeBody(b)
  }
  const nearestClone = (within) => {
    let best = null
    for (const b of cloneBodies()) {
      const d = Math.hypot(b.x - me.walker.x, b.z - me.walker.z)
      if (d < within && (!best || d < best.d)) best = { d, owner: b.owner, name: b.name }
    }
    return best
  }
  // the court nearest you (a challenge is played there)
  const nearestCourt = () => {
    let best = 0
    let bd = Infinity
    for (const c of courts) {
      const d = Math.hypot(c.def.x - me.walker.x, c.def.z - me.walker.z)
      if (d < bd) {
        bd = d
        best = c.def.id
      }
    }
    return best
  }
  // one of a clone's approved lines, over its head
  const cloneSay = (owner, kind) => {
    const b = bodies.get(`clone:${owner}`)
    if (!b?.phrases) return ""
    const line = pickLine(b.phrases, kind, rand, b.lastLine)
    if (line) {
      b.lastLine = line
      speak(b, line, clock)
    }
    return line
  }
  // a few named regulars per venue remember you (this device: living.js memoryKey); the
  // venue's day sets how keen everyone is to play
  let parkMemory = cleanMemory(memory)
  const NAMED = 4
  const greeted = new Set()
  let schedAt = -1e9
  // date night: the regulars give the two of you space (and keep their hellos to themselves)
  let spaceAt = 0
  const giveSpace = () => {
    if (clock - spaceAt < 1) return
    spaceAt = clock
    const away = WAYPOINTS.filter((w) => Math.hypot(w.x - me.walker.x, w.z - me.walker.z) > 14)
    if (!away.length) return
    for (const r of regulars) {
      if (r.body.mode !== "walk" || !givesSpace(r, me.walker) || (r.target && Math.hypot(r.target.x - me.walker.x, r.target.z - me.walker.z) > 10 && !r.seated)) continue
      if (r.seat) {
        takenSeats.delete(r.seat.id)
        if (r.seated) {
          const a = seatApproach(r.seat)
          r.x = a.x
          r.z = a.z
        }
        r.seat = null
        r.seated = false
        r.hang = false
      }
      r.state = "wander"
      r.partner = null
      r.face = null
      r.t = 20 + rand() * 20
      goTo(r, away[Math.floor(rand() * away.length) % away.length])
    }
  }
  const stepLiving = () => {
    // (date night, or a picture being taken: the regulars give the two of you space)
    if (tg.date || tg.selfie) {
      giveSpace()
      return
    }
    // clones say hi when you come up (then not again until you've walked away)
    for (const b of cloneBodies()) {
      const d = Math.hypot(b.x - me.walker.x, b.z - me.walker.z)
      if (d < 4 && !greeted.has(b.key)) {
        greeted.add(b.key)
        cloneSay(b.owner, "greet")
      } else if (d > 9) greeted.delete(b.key)
    }
    for (let i = 0; i < Math.min(NAMED, regulars.length); i++) {
      const r = regulars[i]
      if (r.state === "playing" || r.body.mode !== "walk") continue
      const key = `reg:${r.id}`
      const d = Math.hypot(r.x - me.walker.x, r.z - me.walker.z)
      if (d < 2.6 && !greeted.has(key)) {
        greeted.add(key)
        const met = meetRegular(parkMemory, r.name, me.name, Date.now())
        parkMemory = met.mem
        speak(r, met.line, clock)
        r.yaw = Math.atan2(me.walker.x - r.x, me.walker.z - r.z)
        r.body.mood = { kind: "wave", variant: 0, at: clock }
        onMemory?.(parkMemory)
      } else if (d > 12) greeted.delete(key)
    }
    // the others: some wave and say hi by name as you pass (once a visit each)
    for (let i = NAMED; i < regulars.length; i++) {
      const r = regulars[i]
      if (r.state === "playing" || r.body.mode !== "walk" || r.say) continue
      const key = `hi:${r.id}`
      if (greeted.has(key)) continue
      const d = Math.hypot(r.x - me.walker.x, r.z - me.walker.z)
      if (d > 2.2) continue
      greeted.add(key)
      const line = helloFor(me.name, false, rand)
      if (!line) continue
      speak(r, line, clock)
      if (!r.seated) r.yaw = Math.atan2(me.walker.x - r.x, me.walker.z - r.z)
      r.body.mood = { kind: "wave", variant: 0, at: clock }
    }
    // the day: every couple of minutes, how keen they are follows the hour
    if (clock - schedAt > 120) {
      schedAt = clock
      const day = scheduleFor(hourOverride ?? hourOf())
      for (const r of regulars) {
        r.baseKeen ??= r.keen
        r.keen = Math.min(1, r.baseKeen * day.keen)
      }
      const talker = regulars.slice(0, NAMED).find((r) => r.body.mode === "walk" && r.state !== "playing")
      if (talker && rand() < 0.5) speak(talker, day.line, clock)
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
    return { x: b.x, z: b.z, vx: b.vx, vz: b.vz, facing: b.yaw + (b.spin || 0), ball: { x: b.x + fx * 3, y: 1.1, z: b.z + fz * 3 }, holding: false, swing: null, prep: null, charging: false, between: true, atNet: false, goal: null, hand, twoHand: b.look?.backhand === "two", oppHit: null, want: { x: b.vx, z: b.vz }, id: b.key, phase: "intro", phaseT: b.phaseT % 20, point: 0, mate: null, across: null, receiving: false }
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
      sphere.center.set(b.x, 0.9 + (b.y || 0), b.z)
      b.inView = b.dist < MANN_DIST && frustum.intersectsSphere(sphere)
      list.push(b)
    }
    // the closest in view get the real athletes
    // (watching a court: its four players first, whatever the budget; walking: you always)
    const watched = me.mode === "watch" ? courts[me.watching] : null
    const ranked = list.filter((b) => (b.inView && b.dist < FULL_DIST) || (watched && b.court === watched)).sort((a, c) => (watched ? (c.court === watched) - (a.court === watched) : 0) || a.dist - c.dist)
    const fullSet = new Set(ranked.slice(0, Math.max(dev.budget ?? budget, watched && dev.budget === null ? 4 : 0)))
    if (me.mode !== "watch" || meBody.inView) fullSet.add(meBody)
    // (together: the one you're with is always a real athlete too)
    const mate = tgMateBody() || (tg.sunset ? tgOther(tg.sunset.other)?.body : null)
    if (mate?.inView) fullSet.add(mate)
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
        mann.add({ x: b.x, y: b.y || 0, z: b.z, yaw: b.yaw, speed: b.speed, phase: b.phase, seat: b.seat ? b.seat.y : null, swing, look: b.look })
      }
      if (nb < 96 && b.dist < 40) {
        bm4.makeTranslation(b.x, 0.012 + (b.y || 0), b.z)
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
    // (a kept mood: back on after the figure was made again)
    if (b.mood?.keep && (b.anim.mood?.kind !== b.mood.kind || b.anim.mood?.variant !== b.mood.variant)) setMood(b.anim, b.mood.kind, b.mood.variant, true)
    b.anim.useMM = !!b.fig.skinned
    b.anim.mmEvery = quality === "high" ? 0.1 : 0.2
    // (up a stair or on a terrace: the walk animated at ground level, then raised)
    b.fig.apply(liftPose(updateAnim(b.anim, walkSituation(b, step), step), b.y || 0), step)
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
      const talk = remote && voiceTalk.has(b.num)
      const near = b.isMe ? false : remote ? b.dist < 26 : b.real || b.clone ? b.dist < 45 : speaking ? b.dist < 18 : b.dist < 6.5 && b.mode === "walk"
      if (!near && !speaking && !talk) continue
      cand.push(b)
    }
    cand.sort((a, c) => a.dist - c.dist)
    for (const b of cand.slice(0, 12)) {
      const top = (b.seat ? b.seat.y + 1.25 : 2.12) + (b.y || 0)
      const speaking = b.say && clock < b.say.until ? b.say.text : ""
      const sub = b.isMe ? (me.rep ? repLine(me.rep) : "") : b.remote ? b.repText || "" : b.real ? b.realSub || "" : b.clone ? "Walk up to challenge" : ""
      const title = b.isMe ? me.name : b.real ? `${b.name} · here for real` : b.clone ? `${b.name}'s clone` : b.name || ""
      setLabel(i++, b.x, top, b.z, title, b.dist < 14 || b.isMe || b.real || b.clone ? sub : "", speaking, b.isMe ? "me" : b.remote ? "person" : b.real ? "real" : b.clone ? "clone" : "regular", !!(b.remote && voiceTalk.has(b.num)))
    }
    for (; i < labels.length; i++) hideLabel(i)
  }

  // ---------- the camera ----------
  const tv = new THREE.Vector3()
  const lookAt = new THREE.Vector3(0, 1, 0)
  const updateCamera = (dt) => {
    const por = portrait()
    // together: the selfie's lens, or the sky ahead of the two of you at sunset
    const special = tg.selfie ? tg.selfie.shot : tg.emote?.shot ? tg.emote.shot : tg.sunset && me.mode === "sit" && me.seat ? sunsetShot() : null
    if (special) {
      const k = 1 - Math.exp(-dt * (tg.selfie ? 5 : 1.6))
      tv.set(special.cam.x, special.cam.y, special.cam.z)
      camera.position.lerp(tv, k)
      tv.set(special.look.x, special.look.y, special.look.z)
      lookAt.lerp(tv, k)
      if (Math.abs(camera.fov - special.fov) > 0.05) {
        camera.fov += (special.fov - camera.fov) * Math.min(1, dt * 4)
        camera.updateProjectionMatrix()
      }
      camera.lookAt(lookAt)
      park.followSky?.(camera.position)
      return
    }
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
    const w = me.mode === "sit" && me.seat ? { x: me.seat.x, z: me.seat.z, yaw: me.seat.yaw, speed: 0, y: 0 } : me.walker
    // (a room: the ceiling over you, and a closer camera; up on a rooftop terrace: no roof over
    // you; up on a mezzanine in a hall: the hall's ceiling)
    const inRoom = roomAt(w.x, w.z, w.y || 0)
    const up = (w.y || 0) > 1.2
    stepFollow(follow, w, dt, { portrait: por, bodies: bodiesNear, roofY: inRoom ? roofAt(w.x, w.z, w.y || 0) : up ? roofAt(w.x, w.z, w.y) : roofY, tight: !!inRoom })
    // (in a room, the lens stays in that room: not out through its doorway)
    if (inRoom && !inPoly(follow.pos.x, follow.pos.z, inRoom.p)) {
      let lo = 0
      let hi = 1
      for (let k = 0; k < 10; k++) {
        const t = (lo + hi) / 2
        if (inPoly(w.x + (follow.pos.x - w.x) * t, w.z + (follow.pos.z - w.z) * t, inRoom.p)) lo = t
        else hi = t
      }
      const t = lo * 0.92
      follow.pos = { x: w.x + (follow.pos.x - w.x) * t, y: Math.max((w.y || 0) + 1.7, follow.pos.y), z: w.z + (follow.pos.z - w.z) * t }
    }
    camera.position.set(follow.pos.x, follow.pos.y, follow.pos.z)
    lookAt.set(follow.look.x, follow.look.y, follow.look.z)
    park.cull?.(follow.pos, w)
    park.followSky?.(follow.pos)
    const fov = por ? 62 : 55
    if (Math.abs(camera.fov - fov) > 0.05) {
      camera.fov += (fov - camera.fov) * Math.min(1, dt * 3)
      camera.updateProjectionMatrix()
    }
    camera.lookAt(lookAt)
  }

  // ---------- Live Venue Presence: friends who are at this venue for real (presence.js) ----------
  // Shown, not driven: they stand beside the court the server says they're at (court-level,
  // never their exact spot), labelled "here for real"; somewhere else at the venue: by the
  // entrance. list: [{ key, name, area, look? }]
  const realCourts = layout.rawCourts || []
  const setReal = (list = []) => {
    const keep = new Set()
    const slots = new Map()
    for (const f of list) {
      if (!f?.key) continue
      const key = `real:${f.key}`
      keep.add(key)
      const slot = slots.get(f.area) || 0
      slots.set(f.area, slot + 1)
      // beside their court: whichever side (or the slot past it) the walkable check moves least
      let p = null
      let best = Infinity
      for (const k of [slot, slot + 4, slot + 8, slot + 12]) {
        const spot = spotFor(realCourts, f.area, k)
        if (!spot) break
        const q = resolve(spot.x, spot.z, 0.35)
        const d = Math.hypot(q.x - spot.x, q.z - spot.z)
        if (d < best) {
          best = d
          p = q
        }
        if (d < 0.6) break
      }
      if (!p) p = resolve(SPAWN.x + Math.sin(SPAWN.yaw) * 2.5 + Math.cos(SPAWN.yaw) * slot * 1.3, SPAWN.z + Math.cos(SPAWN.yaw) * 2.5 - Math.sin(SPAWN.yaw) * slot * 1.3, 0.35)
      const m = /^c(\d+)$/.exec(f.area || "")
      const court = m ? realCourts[Number(m[1])] : null
      let b = bodies.get(key)
      if (!b) b = makeBody(key, f.look || null, f.name, { real: true })
      b.name = f.name
      b.realSub = court ? `Court ${court.n ?? Number(m[1]) + 1}` : `at ${layout.spec?.short || layout.name || "the venue"}`
      if (Math.hypot(b.x - p.x, b.z - p.z) > 0.5) {
        b.x = p.x
        b.z = p.z
        b.yaw = court ? Math.atan2(court.x - p.x, court.z - p.z) : SPAWN.yaw
        b.anim = null
      }
      b.speed = 0
      b.vx = 0
      b.vz = 0
    }
    for (const b of [...bodies.values()]) if (b.real && b.key.startsWith("real:") && !keep.has(b.key)) removeBody(b)
  }

  // ---------- Live Broadcast: a real game being played live on one of this venue's courts ----------
  // (twin/live/useLiveCourt.js feeds it ~20 times a second) courtId: the court; players:
  // [{ slot, name, x, z, vx, vz }] in the court's own frame (Twin Replay's: x across, z along,
  // team 0 at +z). They walk where the real players are, labelled "here for real · live".
  const setLive = (courtId, players = [], { title = "" } = {}) => {
    const court = courtId === null || courtId === undefined ? null : (layout.COURTS || []).find((c) => String(c.id) === String(courtId)) || null
    const keep = new Set()
    if (court) {
      for (const pl of players) {
        const key = `live:${pl.slot}`
        keep.add(key)
        const w = toWorld(court, pl.x, pl.z)
        const v = dirToWorld(court, pl.vx || 0, pl.vz || 0)
        let b = bodies.get(key)
        if (!b) {
          b = makeBody(key, pl.look || null, pl.name, { real: true })
          b.x = w.x
          b.z = w.z
        }
        b.name = pl.name
        b.realSub = title ? `live · ${title}` : `live · ${court.name}`
        b.x = w.x
        b.z = w.z
        b.vx = v.x
        b.vz = v.z
        b.speed = Math.hypot(v.x, v.z)
        // (facing the net, turned toward where they're running when they run)
        const net = toWorld(court, pl.x, 0)
        b.yaw = b.speed > 0.8 ? Math.atan2(v.x, v.z) : Math.atan2(net.x - w.x, net.z - w.z)
      }
    }
    for (const b of [...bodies.values()]) if (b.key.startsWith("live:") && !keep.has(b.key)) removeBody(b)
  }

  // ---------- online ----------
  const remoteBody = (r) => {
    const b = makeBody(`n${r.num}`, r.look, r.name, { remote: true })
    b.repText = r.repText
    b.num = r.num
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
      // (act's top bit: they're up off the ground, on stairs or a terrace: the height from the
      // venue's floors where they are)
      const up = (s.act & UP_BIT) !== 0
      const act = s.act & ~UP_BIT
      b.hidden = act === ACTS.play
      b.x = s.x
      b.z = s.z
      b.y = up ? venue.levelAt(s.x, s.z) : 0
      b.vx = s.vx
      b.vz = s.vz
      b.speed = s.speed
      b.yaw = s.yaw
      if (act === ACTS.sitLow || act === ACTS.sitHigh) {
        if (!b.seat || Math.hypot(b.seat.x - s.x, b.seat.z - s.z) > 0.3) {
          b.seat = { x: s.x, z: s.z, y: act === ACTS.sitHigh ? 0.85 : 0.45, yaw: s.yaw, court: courtOfSeat(s.x, s.z) }
          holdSeat(r, seatAt(ALL_SEATS, s.x, s.z))
        }
      } else if (b.seat) {
        b.seat = null
        holdSeat(r, null)
      }
    }
  }
  // the seat a person online is on, kept as taken while they sit
  const holdSeat = (r, seat) => {
    if (r.seatId && takenSeats.get(r.seatId) === `n${r.num}`) takenSeats.delete(r.seatId)
    r.seatId = null
    if (seat && !takenSeats.has(seat.id)) {
      takenSeats.set(seat.id, `n${r.num}`)
      r.seatId = seat.id
    }
  }
  const courtOfSeat = (x, z) => {
    let best = null
    for (const s of ALL_SEATS) if (Math.hypot(s.x - x, s.z - z) < 0.3) best = s.court ?? null
    return best
  }
  const myAct = () => (me.mode === "walk" ? (me.walker.speed > 0.05 ? ACTS.move : ACTS.stand) | ((me.walker.y || 0) > 0.3 ? UP_BIT : 0) : me.seat ? (me.seat.y > 0.6 ? ACTS.sitHigh : ACTS.sitLow) : ACTS.stand)
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
      let ix = input.x + (kx / kl) * 0.85
      let iy = input.y + (ky / kl) * 0.85
      let sprint = input.sprint || keys.has("ShiftLeft") || keys.has("ShiftRight")
      // together, after a yes: walking beside or behind them, or stepping into place; your
      // own stick lets go at once (together.js breaksAway)
      const auto = togetherWalk({ x: ix, y: iy, keys: kx !== 0 || ky !== 0 }, dt)
      if (auto) {
        ix = auto.x
        iy = auto.y
        sprint = auto.sprint
      }
      stepWalker(me.walker, { x: ix, y: iy, sprint }, follow.yaw, dt)
      // (posing for the picture: at the lens; a hug, a high five...: at each other)
      const faceTo = auto?.face ?? (tg.selfie ? tg.selfie.shot.yaw : tg.emote ? faceOther(tg.emote.other) : undefined)
      if (faceTo !== undefined && me.walker.speed < 0.3) me.walker.yaw += wrap(faceTo - me.walker.yaw) * Math.min(1, dt * 6)
      // you can't walk through people, but nothing moves you while you aren't moving (the
      // owner's rule): standing still, the others steer around you instead
      if (Math.hypot(ix, iy) > 0.02) {
        const near = []
        // (only people on your floor: not the ones under the terrace you're on)
        // (not the one you're hand in hand with, hugging or posing with)
        const mate = tgMateBody()
        for (const b of bodies.values()) if (!b.isMe && b !== mate && !b.hidden && b.mode === "walk" && !b.seat && Math.abs(b.x - me.walker.x) < 1 && Math.abs(b.z - me.walker.z) < 1 && Math.abs((b.y || 0) - (me.walker.y || 0)) < 1) near.push(b)
        keepApart(me.walker, near)
      }
      meBody.x = me.walker.x
      meBody.y = me.walker.y || 0
      meBody.z = me.walker.z
      meBody.vx = me.walker.vx
      meBody.vz = me.walker.vz
      meBody.speed = me.walker.speed
      meBody.yaw = me.walker.yaw
      meBody.seat = null
    } else if (me.seat) {
      meBody.x = me.seat.x
      meBody.y = 0
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
    stepLiving()
    stepRemotes()
    togetherStep(dt)
    pet.step(dt, me.mode === "sit" && me.seat ? { x: me.seat.x, z: me.seat.z, yaw: me.seat.yaw, y: 0 } : me.walker)
    makeOne()
    updateCamera(dt)
    drawBodies(dt)
    if (!dev.noLabels) updateLabels()
    sendPos()
    hudT += dt
    if (hudT > 0.12) {
      hudT = 0
      updatePal()
      sendHud(false)
    }
  }

  updateDay(true)
  updateRacks()
  park.setBoard([{ name: me.name, text: me.rep ? repLine(me.rep) : "Newcomer · 0-0", you: true }])

  // post-processing on High at a real venue (post.js: bloom on the lights, MSAA, a mild
  // vignette; colors through one tone curve). Off with localStorage 98ish.park.post = "0".
  // (Ambient occlusion is baked into the surfaces instead: occlusion.js.)
  let postFlag = true
  try {
    postFlag = typeof localStorage === "undefined" || localStorage.getItem("98ish.park.post") !== "0"
  } catch {}
  // (not on phones: the full-screen passes halved the frame rate in phone emulation; desktop High only)
  // a photoreal splat backdrop for this venue (park/splat/): loaded from drive C: if you made one
  const splat = createSplatLayer({ scene, renderer, quality, phone })
  if (renderer && quality !== "low")
    getBackdrop(layout.id || "riverside")
      .then(async (b) => {
        if (!b || disposed) return
        const bytes = await readBytes(b.file)
        if (!disposed) await splat.show(bytes, b.format, b.transform, b.splats || 0)
      })
      .catch((e) => console.warn("[park] splat backdrop", e))
  // your 3D Viewer 98 model, if you placed one in My Park: it trots after you (viewer3d/petLayer.js)
  const pet = createPetLayer(scene, { quality })
  const post = postFlag && !phone && quality === "high" && layout.id && layout.id !== "riverside" ? createPost(scene) : null
  const world = {
    scene,
    camera,
    splat,
    ...(post ? { render: (renderer) => post.render(renderer, camera), postOn: true } : {}),
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
      // (off to play: walking together, a picture or the sunset ends; the server ends the link)
      tg.moveTo = null
      endSelfie()
      endSunset(false)
      if (tg.link) {
        linkMoods({ a: myNum, b: tg.link.other, kind: tg.link.kind, lead: tg.link.lead ? myNum : tg.link.other }, false)
        tg.link = null
        tg.autoSat = false
      }
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
    // (the whole look: Real Sky's sun, sky and weather; a game on a court here uses it too)
    get look() {
      return look
    },
    get skyPlace() {
      return place
    },
    // Options > Real Sky and Weather / Sky: { real, mode }
    setSky(cfg = {}) {
      skyCfg = { ...skyCfg, ...cfg }
      wxAt = -1e9
      updateDay(true)
    },
    get mode() {
      return me.mode
    },
    // ---- Live Venue Presence: friends here for real ([{ key, name, area, look? }]) ----
    setReal,
    setClones,
    cloneSay,
    // the regulars' memory of you (living.js), e.g. after a game here
    remember(next) {
      parkMemory = cleanMemory(next)
    },
    setLive,
    // ---- online (the page's socket: usePark) ----
    setNet(n) {
      net = n
      if (!n) {
        for (const num of remotes.keys()) togetherGone(num)
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
          if (r.body.hidden && (p.act & ~UP_BIT) !== ACTS.play) r.body.hidden = false
        }
      } else if (type === "park:person" && d) addRemote(d)
      else if (type === "park:gone" && d) {
        const r = remotes.get(d.num)
        // (they left: whatever you were doing together is over)
        togetherGone(d.num)
        if (r) {
          holdSeat(r, null)
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
      else if (type === "park:go" && d && courts[d.court]) myTurn(courts[d.court], { kind: d.kind === "room" ? "room" : "solo", roomId: d.roomId || null, together: d.together === "team" || d.together === "rally" ? d.together : null })
      else if (type === "park:rate" && d?.rate) netRate = d.rate
      else if (type.startsWith("park:") && d) togetherEvent(type, d)
      sendHud(false)
    },
    // Spatial voice (utils/voice): where you listen from (your spot, facing the camera's way),
    // where each person in your park stands (by park number), and, while you're in a court
    // game with other people, who's on your court
    voicePlace() {
      const people = {}
      const names = {}
      for (const r of remotes.values()) {
        names[r.num] = r.name
        if (!r.body.hidden) people[r.num] = { x: r.body.x, z: r.body.z }
      }
      const mine = myNum !== null ? serverCourts.find((c) => c.g && c.g.k === "room" && c.g.p.includes(myNum)) : null
      return { listener: { x: me.walker.x, z: me.walker.z, yaw: follow.yaw }, people, court: mine ? mine.g.p.filter((n) => n && n !== myNum) : null, me: myNum, names }
    },
    setVoiceTalk(nums) {
      voiceTalk = new Set(nums)
    },
    // ---- together (together.js): who counts as a friend here (your partner and buddies) ----
    setFriends(names = []) {
      tg.friends = new Set(names.map(nameKey).filter(Boolean))
      updatePal()
      sendHud(true)
    },
    // ask the friend near you (or `to`, a park number) to do something together -> the ack
    async tgAsk(kind, to = tg.pal?.num ?? tg.link?.other ?? null, extra = null) {
      if (!net) return { ok: false, error: "Doing things together needs the park online." }
      if (to === null || to === undefined) return { ok: false, error: "Walk over to them first." }
      const data = askData(kind, to)
      if (!data) return { ok: false, error: "There's no free bench for two nearby." }
      return net.emit("park:ask", { to, kind, data: { ...data, ...(extra || {}) } })
    },
    tgAnswer(id, yes) {
      return net ? net.emit("park:answer", { id, yes: !!yes }) : Promise.resolve({ ok: false })
    },
    tgStop,
    get together() {
      return { ...tgHud(), friends: tg.friends ? [...tg.friends] : [], lapse: lapseDate ? lapseDate.getTime() : null, moving: !!tg.moveTo, spin: meBody.spin || 0, mood: meBody.mood?.kind || null, mateMood: tgMateBody()?.mood?.kind || null, golden: isGolden(look?.sunEl), sunEl: look?.sunEl ?? null }
    },
    // where you are in the park and what everyone's doing (tests)
    get info() {
      let full = 0
      let manns = mann.count
      for (const b of bodies.values()) if (b.fig?.group.parent) full++
      return {
        me: { x: me.walker.x, y: me.walker.y || 0, z: me.walker.z, yaw: me.walker.yaw, speed: me.walker.speed, gait: me.walker.gait, mode: me.mode, seat: me.seat?.id || null, watching: me.watching, queued: me.queued },
        camera: { x: camera.position.x, y: camera.position.y, z: camera.position.z, fov: camera.fov, yaw: follow.yaw },
        action,
        courts: courts.map((c) => ({ id: c.def.id, state: c.state, phase: c.match.phase, score: scoreboard(c.match).score, on: c.on.map((e) => e.id), queue: c.queue.map((e) => e.id), human: c.human, ball: c.match.ball.kind || "outdoor" })),
        regulars: regulars.map((r) => ({ id: r.id, state: r.state, x: r.x, z: r.z, seated: r.seated, court: r.court })),
        remotes: [...remotes.values()].map((r) => ({ num: r.num, name: r.name, x: r.body.x, y: r.body.y || 0, z: r.body.z, hidden: r.body.hidden })),
        real: [...bodies.values()].filter((b) => b.real).map((b) => ({ key: b.key, name: b.name, sub: b.realSub, x: b.x, z: b.z })),
        clones: cloneBodies().map((b) => ({ owner: b.owner, name: b.name, x: b.x, z: b.z, say: b.say?.text || null })),
        regularSay: regulars.slice(0, NAMED).map((r) => ({ name: r.name, say: r.say?.text || null, x: r.x, z: r.z })),
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
    // (y: a floor above the ground, a rooftop terrace: tests; else the floor you're on)
    teleport(x, z, yaw = me.walker.yaw, y = me.walker.y || 0) {
      const p = resolve(x, z, 0.35, y)
      me.walker.x = p.x
      me.walker.z = p.z
      me.walker.y = venue.heightAt(p.x, p.z, y) ?? 0
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
      post?.dispose()
      splat.dispose()
      pet.dispose()
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
  world.devSurfaces = (on) => (setSurfacesOn(on), park.setRealism?.(on))
  // baked ground occlusion on/off (occlusion.js), and how its bake went
  world.devAO = (on) => setBakedAOOn(on)
  world.devAOInfo = () => ({ on: aoUniforms.surfAOOn.value, size: [aoUniforms.surfAOTex.value.image?.width, aoUniforms.surfAOTex.value.image?.height], ...lastAO })
  world.devPark = park
  let r = null
  let devPost = null
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
      // (ortho.y: from under a hall's ceiling, so an indoor venue's floor shows)
      c = new THREE.OrthographicCamera(-hw, hw, hd, -hd, ortho.y ? 0.05 : 1, 2000)
      c.position.set(cx, ortho.y || 900, cz)
      c.up.set(0, 0, -1)
      c.lookAt(cx, 0, cz)
    } else {
      const k = cam || {}
      // (a drone's height: the near plane well out, or the court paint layers, centimetres
      // apart, fight at that distance and courts show their surround through them)
      c = new THREE.PerspectiveCamera(k.fov || 55, w / h, Math.max(0.1, ((k.y ?? 1.7) - 20) * 0.5), 1500)
      const hd = ((k.heading || 0) * Math.PI) / 180
      const pt = ((k.pitch || 0) * Math.PI) / 180
      c.position.set(k.x || 0, k.y ?? 1.7, k.z || 0)
      // (looking straight down: "up" on the picture is the heading)
      if (Math.abs(k.pitch || 0) > 85) c.up.set(Math.sin(hd), 0, -Math.cos(hd))
      c.lookAt(c.position.x + Math.sin(hd) * Math.cos(pt), c.position.y + Math.sin(pt), c.position.z - Math.cos(hd) * Math.cos(pt))
      if (k.roll) c.rotateZ((-k.roll * Math.PI) / 180)
    }
    c.updateMatrixWorld(true)
    const hidden = []
    if (!people) for (const o of scene.children) if (o !== park.group && !o.isLight && o.visible && !swatches.includes(o)) (o.visible = false), hidden.push(o)
    const f = scene.fog
    if (!fog) scene.fog = null
    // sun shadows like the game's (the box centred where this camera looks)
    r.shadowMap.enabled = !ortho
    r.shadowMap.type = THREE.PCFSoftShadowMap
    if (!ortho) {
      const d = new THREE.Vector3()
      c.getWorldDirection(d)
      const t = Math.max(0, -c.position.y / Math.min(-0.15, d.y))
      park.followSky?.({ x: c.position.x + d.x * Math.min(t, 35), y: 0, z: c.position.z + d.z * Math.min(t, 35) }, c.position)
    }
    if (park.sun?.castShadow) park.sun.shadow.needsUpdate = true // (its own shadow map: the game's renderer may have used the flag)
    if (world.postOn && !ortho && world.devPostShots !== false) (devPost ??= createPost(scene)).render(r, c)
    else r.render(scene, c)
    world.devRenderer = r
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
