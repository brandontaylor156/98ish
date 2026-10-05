// Pickleball 98's engine: the three.js picture (venue, players, ball, effects), the TV-style
// camera, replays, input (keyboard, gamepads, the touch pad), sound, and the frame loop for
// local play and both ends of an online match. The game itself is match.js (+ physics,
// rules, shots, ai); the players' movement is anim.js, drawn by rig.js; online is netplay.js.
// three.js is loaded with this file, on first open.

import * as THREE from "three"
import { BALL_R, HALF_L, HALF_W, predictPath, STEP } from "./physics.js"
import { createMatch, advance, handBattle, humanBySlot, meterFor, playerById, press as mPress, previewShot, release as mRelease, scenario, scoreboard, serve as mServe, setAim, setMove, step, autopilot } from "./match.js"
import { clearShot, blocker, serverShot } from "./camera.js"
import { readSwipe, swipeServe, swipeTarget } from "./touchplay.js"
import { ATTACK_H, KIND_LABEL, paceOf, planShot } from "./shots.js"
import { LEVELS } from "./ai.js"
import { inCourt, rightSign, sideOf } from "./rules.js"
import { createAudio } from "./audio.js"
import { createAnim, seatedPose, setMood, situation, splitStep, updateAnim } from "./anim.js"
import { createFigure } from "./rig.js"
import { athletesReady, createAthlete, loadAthletes } from "./athlete.js"
import { buildVenue, VENUES } from "./venue.js"
import { CHARACTERS, lookFor } from "./looks.js"
import { characterLook, validateLook } from "./locker.js"
import { actionFor, bindingsFor, padEdges, readPad, stickAim } from "./input.js"
import { createGuest, createHost, onlineRoster } from "./netplay.js"
import { reducedMotion } from "../../../utils/settings"
import { createFrameClock } from "../../../utils/frameClock.js"
import { createResolution } from "../../../utils/dynamicResolution.js"
import { releaseGpu } from "../../../utils/webglLoss.js"

const BALL_SCALE = 1.5 // drawn a little bigger than life so it reads on a phone
const TRAIL_N = 18
const REPLAY_S = 9 // seconds of play kept for replays
const QUALITY = { low: { ratio: 1, shadows: false }, medium: { ratio: 1.5, shadows: true }, high: { ratio: 2, shadows: true } }
const UMPIRE_LOOK = { body: "m", skin: 1, hair: "short", hairColor: "#3a2a1e", hat: "cap", hatColor: "#ffffff", shirt: "#1d2b53", shirtStyle: "polo", trim: "#ffffff", bottom: "shorts", bottomColor: "#c9b991", shoes: "#ffffff", shoeAccent: "#1d2b53", socks: "#ffffff", build: 1.02, glasses: true }
const DEFAULT_LOOKS = ["maya", "dex", "lena", "kenji"]

const canvasTexture = (w, h, draw) => {
  const c = document.createElement("canvas")
  c.width = w
  c.height = h
  draw(c.getContext("2d"), w, h)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}
const blobTexture = () =>
  canvasTexture(64, 64, (ctx, w) => {
    const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2)
    g.addColorStop(0, "rgba(0,0,0,0.8)")
    g.addColorStop(0.5, "rgba(0,0,0,0.4)")
    g.addColorStop(1, "rgba(0,0,0,0)")
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, w)
  })

// darker and tighter than the blob: the shadow right where the feet meet the court
const contactTexture = () =>
  canvasTexture(128, 128, (ctx, w) => {
    const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2)
    g.addColorStop(0, "rgba(0,0,0,0.8)")
    g.addColorStop(0.35, "rgba(0,0,0,0.5)")
    g.addColorStop(1, "rgba(0,0,0,0)")
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, w)
  })

export const createEngine = ({ canvas, container, onHud, onEvent, onStatus, settings: initial = {} }) => {
  const dpr = window.devicePixelRatio || 1
  // (anti-aliased on every screen: phones too, at the quality's pixel ratio, 1.5 on Medium)
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance", stencil: false })
  renderer.outputColorSpace = THREE.SRGBColorSpace
  // (reading every program's info log makes each compile wait for the GPU driver: dev only)
  renderer.debug.checkShaderErrors = !!import.meta.env.DEV
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.shadowMap.type = THREE.PCFShadowMap
  let settings = { sound: true, voice: true, camera: "broadcast", aid: true, trail: true, assist: "reflex", quality: "medium", cuts: true, keys: {}, window: 0.06, focus: "auto", ...initial }
  let bindings = bindingsFor(settings.keys)
  let maxRatio = Math.min(dpr, QUALITY[settings.quality]?.ratio || 1.5)
  let pixelRatio = maxRatio
  renderer.setPixelRatio(pixelRatio)
  // dynamic resolution: from the quality's ratio down to 1.0 while frames run slow
  const resolution = createResolution({ max: maxRatio, min: Math.min(1, maxRatio) })
  renderer.shadowMap.enabled = !!QUALITY[settings.quality]?.shadows

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 420)
  camera.position.set(0, 6, HALF_L + 8)
  const camLook = new THREE.Vector3(0, 0.6, -2)
  const tex = { blob: blobTexture(), contact: contactTexture() }
  // contact shadows: one shared quad shape and material for every player
  const contactGeo = new THREE.PlaneGeometry(0.75, 0.75)
  contactGeo.rotateX(-Math.PI / 2)
  const contactMat = new THREE.MeshBasicMaterial({ map: tex.contact, transparent: true, depthWrite: false, opacity: 0.7 })

  // ---------- the venue ----------
  let venueId = "park"
  let venue = buildVenue(scene, { venue: venueId, quality: settings.quality })
  renderer.toneMappingExposure = venue.def.exposure
  const setVenue = (id) => {
    const next = VENUES[id] ? id : "park"
    if (next === venueId && venue) return
    venue.dispose()
    venueId = next
    venue = buildVenue(scene, { venue: venueId, quality: settings.quality })
    venue.setScreenCompact?.(portraitScreen())
    renderer.toneMappingExposure = venue.def.exposure
    audio.setCrowd(settings.sound ? venue.def.crowd : 0)
    placeUmpire()
    warm()
  }
  // a phone held upright: the score panel covers the big screen (venue.js shows a logo then)
  const portraitScreen = () => size.height > size.width * 1.05

  // ---------- the ball, its shadow, its trail, the markers ----------
  const ballTex = canvasTexture(128, 64, (ctx, w, h) => {
    ctx.fillStyle = "#e6f046"
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = "#a9b324"
    for (let i = 0; i < 26; i++) {
      ctx.beginPath()
      ctx.arc((i * 23 + (i % 3) * 7) % w, ((i * 37) % 5) * (h / 5) + 6, 3.2, 0, Math.PI * 2)
      ctx.fill()
    }
  })
  tex.ball = ballTex
  const ballMesh = new THREE.Mesh(new THREE.SphereGeometry(BALL_R * BALL_SCALE, 18, 12), new THREE.MeshStandardMaterial({ map: ballTex, roughness: 0.45, emissive: 0x3a4000, emissiveIntensity: 0.6 }))
  ballMesh.castShadow = true
  scene.add(ballMesh)
  const ballShadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex.blob, transparent: true, depthWrite: false }))
  ballShadow.rotation.x = -Math.PI / 2
  ballShadow.renderOrder = 3
  scene.add(ballShadow)
  // the trail: a ribbon that faces the camera
  const trailPos = new Float32Array(TRAIL_N * 2 * 3)
  const trailCol = new Float32Array(TRAIL_N * 2 * 4)
  const trailIdx = []
  for (let i = 0; i < TRAIL_N - 1; i++) {
    const a = i * 2
    trailIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
  }
  const trailGeo = new THREE.BufferGeometry()
  trailGeo.setAttribute("position", new THREE.BufferAttribute(trailPos, 3))
  trailGeo.setAttribute("color", new THREE.BufferAttribute(trailCol, 4))
  trailGeo.setIndex(trailIdx)
  const trail = new THREE.Mesh(trailGeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }))
  trail.frustumCulled = false
  trail.renderOrder = 4
  scene.add(trail)
  const trailHistory = []
  let trailColor = [1, 0.95, 0.6]

  const ringGeo = new THREE.RingGeometry(0.17, 0.24, 28)
  ringGeo.rotateX(-Math.PI / 2)
  const landRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xfff6a8, transparent: true, opacity: 0.9, depthWrite: false }))
  landRing.visible = false
  landRing.renderOrder = 3
  scene.add(landRing)
  const aimRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0x7cf0ff, transparent: true, opacity: 0.6, depthWrite: false }))
  aimRing.visible = false
  aimRing.renderOrder = 3
  scene.add(aimRing)
  // where your shot would really land at this pace (shown when it isn't the aim: long, say)
  const dotGeo = new THREE.CircleGeometry(0.09, 18)
  dotGeo.rotateX(-Math.PI / 2)
  const aimDot = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color: 0xff5a4a, transparent: true, opacity: 0.75, depthWrite: false }))
  aimDot.visible = false
  aimDot.renderOrder = 3
  scene.add(aimDot)
  // where you'll meet the ball: orange above the net (attack it), pale blue below (keep it soft)
  const contactRing = new THREE.Mesh(new THREE.RingGeometry(0.075, 0.1, 24), new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.85, depthWrite: false, depthTest: false, side: THREE.DoubleSide }))
  contactRing.visible = false
  contactRing.renderOrder = 6
  scene.add(contactRing)
  // the aim made clear: a dashed arc from where you'll meet the ball to where your shot goes,
  // over the net (its height says soft / firm / hard), plus a dot in the middle of the ring
  const ARC_N = 24
  const arcPos = new Float32Array(ARC_N * 3)
  const arcGeo = new THREE.BufferGeometry()
  arcGeo.setAttribute("position", new THREE.BufferAttribute(arcPos, 3))
  const aimArc = new THREE.Line(arcGeo, new THREE.LineDashedMaterial({ color: 0x7cf0ff, dashSize: 0.22, gapSize: 0.14, transparent: true, opacity: 0.85, depthWrite: false }))
  aimArc.frustumCulled = false
  aimArc.visible = false
  aimArc.renderOrder = 6
  scene.add(aimArc)
  const aimPip = new THREE.Mesh(new THREE.CircleGeometry(0.06, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x7cf0ff, transparent: true, opacity: 0.9, depthWrite: false }))
  aimPip.visible = false
  aimPip.renderOrder = 3
  scene.add(aimPip)
  const drawArc = (from, to, apex) => {
    for (let i = 0; i < ARC_N; i++) {
      const u = i / (ARC_N - 1)
      // a parabola through from (u 0) and to (u 1) peaking at `apex` (over the net)
      const base = from.y + (to.y - from.y) * u
      const lift = Math.max(0, apex - Math.max(from.y, to.y) * 0.5) * 4 * u * (1 - u)
      arcPos[i * 3] = from.x + (to.x - from.x) * u
      arcPos[i * 3 + 1] = base + lift
      arcPos[i * 3 + 2] = from.z + (to.z - from.z) * u
    }
    arcGeo.attributes.position.needsUpdate = true
    aimArc.computeLineDistances()
  }

  // the swing trail: the paddle head's path through a swing of this screen's own players,
  // a ribbon that fades in about 0.3 s (Settings: Swing trail)
  const SWING_N = 28
  const SWING_LIFE = 0.3
  const swingTrails = [0, 1].map(() => {
    const pos = new Float32Array(SWING_N * 2 * 3)
    const col = new Float32Array(SWING_N * 2 * 4)
    const idx = []
    for (let i = 0; i < SWING_N - 1; i++) {
      const a = i * 2
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3))
    geo.setAttribute("color", new THREE.BufferAttribute(col, 4))
    geo.setIndex(idx)
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }))
    mesh.frustumCulled = false
    mesh.renderOrder = 5
    mesh.visible = false
    scene.add(mesh)
    return { mesh, pos, col, geo, pts: [], shown: 0 }
  })
  const updateSwingTrail = (tr, pose, swinging, now) => {
    if (swinging && pose?.paddle) {
      const g = pose.paddle.grip
      const f = pose.paddle.face
      // the paddle's head: from a little above the handle to the face's far edge
      const ax = f.x - g.x
      const ay = f.y - g.y
      const az = f.z - g.z
      tr.pts.unshift({ t: now, a: { x: g.x + ax * 0.45, y: g.y + ay * 0.45, z: g.z + az * 0.45 }, b: { x: f.x + ax * 0.35, y: f.y + ay * 0.35, z: f.z + az * 0.35 } })
      if (tr.pts.length > SWING_N) tr.pts.length = SWING_N
    }
    while (tr.pts.length && now - tr.pts[tr.pts.length - 1].t > SWING_LIFE) tr.pts.pop()
    tr.shown = tr.pts.length
    tr.mesh.visible = tr.pts.length > 2
    if (!tr.mesh.visible) return
    for (let i = 0; i < SWING_N; i++) {
      const q = tr.pts[Math.min(i, tr.pts.length - 1)]
      const o = i * 6
      tr.pos[o] = q.a.x
      tr.pos[o + 1] = q.a.y
      tr.pos[o + 2] = q.a.z
      tr.pos[o + 3] = q.b.x
      tr.pos[o + 4] = q.b.y
      tr.pos[o + 5] = q.b.z
      const k = i < tr.pts.length ? Math.max(0, 1 - (now - q.t) / SWING_LIFE) : 0
      const al = 0.55 * k * k
      for (let c = i * 8; c < i * 8 + 8; c += 4) {
        tr.col[c] = 0.75 * al
        tr.col[c + 1] = 0.95 * al
        tr.col[c + 2] = 1 * al
        tr.col[c + 3] = al
      }
    }
    tr.geo.attributes.position.needsUpdate = true
    tr.geo.attributes.color.needsUpdate = true
  }
  const markMat = { in: new THREE.MeshBasicMaterial({ color: 0x46e07a, transparent: true, depthWrite: false }), out: new THREE.MeshBasicMaterial({ color: 0xff4d4d, transparent: true, depthWrite: false }) }
  const mark = new THREE.Mesh(ringGeo, markMat.in)
  mark.visible = false
  mark.renderOrder = 3
  scene.add(mark)
  let markTimer = 0
  // a ring under the person you play (so you can find yourself in doubles)
  const youGeo = new THREE.RingGeometry(0.42, 0.5, 32)
  youGeo.rotateX(-Math.PI / 2)
  const youRings = [0x37d0e6, 0xff7a5c].map((c) => {
    const r = new THREE.Mesh(youGeo, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.55, depthWrite: false }))
    r.renderOrder = 2
    r.visible = false
    scene.add(r)
    return r
  })

  // ---------- particles: hit sparks and bounce dust ----------
  const PN = 160
  const pPos = new Float32Array(PN * 3)
  const pCol = new Float32Array(PN * 3)
  const parts = Array.from({ length: PN }, () => ({ life: 0, x: 0, y: -10, z: 0, vx: 0, vy: 0, vz: 0, g: 0, c: [1, 1, 1], max: 1 }))
  const pGeo = new THREE.BufferGeometry()
  pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3))
  pGeo.setAttribute("color", new THREE.BufferAttribute(pCol, 3))
  const sparkTex = canvasTexture(32, 32, (ctx, w) => {
    const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2)
    g.addColorStop(0, "rgba(255,255,255,1)")
    g.addColorStop(0.4, "rgba(255,255,255,0.5)")
    g.addColorStop(1, "rgba(255,255,255,0)")
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, w)
  })
  tex.spark = sparkTex
  const pts = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.09, map: sparkTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }))
  pts.frustumCulled = false
  pts.renderOrder = 5
  scene.add(pts)
  let pNext = 0
  const burst = (x, y, z, n, { speed = 3, up = 1, color = [1, 0.95, 0.55], life = 0.45, gravity = 6, dir = null } = {}) => {
    for (let i = 0; i < n; i++) {
      const q = parts[pNext]
      pNext = (pNext + 1) % PN
      const a = Math.random() * Math.PI * 2
      const e = Math.random() * 0.9
      const s = speed * (0.4 + Math.random() * 0.8)
      q.x = x
      q.y = y
      q.z = z
      q.vx = Math.cos(a) * Math.cos(e) * s + (dir ? dir.x * speed * 0.6 : 0)
      q.vy = Math.sin(e) * s * up + (dir ? dir.y * speed * 0.6 : 0)
      q.vz = Math.sin(a) * Math.cos(e) * s + (dir ? dir.z * speed * 0.6 : 0)
      q.g = gravity
      q.c = color
      q.life = q.max = life * (0.6 + Math.random() * 0.6)
    }
  }
  const updateParticles = (dt) => {
    for (let i = 0; i < PN; i++) {
      const q = parts[i]
      if (q.life > 0) {
        q.life -= dt
        q.vy -= q.g * dt
        q.x += q.vx * dt
        q.y = Math.max(0.01, q.y + q.vy * dt)
        q.z += q.vz * dt
      }
      const k = q.life > 0 ? q.life / q.max : 0
      pPos[i * 3] = q.x
      pPos[i * 3 + 1] = k > 0 ? q.y : -50
      pPos[i * 3 + 2] = q.z
      pCol[i * 3] = q.c[0] * k
      pCol[i * 3 + 1] = q.c[1] * k
      pCol[i * 3 + 2] = q.c[2] * k
    }
    pGeo.attributes.position.needsUpdate = true
    pGeo.attributes.color.needsUpdate = true
  }

  // ---------- state ----------
  const audio = createAudio()
  audio.setEnabled(settings.sound)
  audio.setVoice(settings.voice)
  audio.setCrowd(settings.sound ? venue.def.crowd : 0)
  let match = null
  let mode = "demo" // demo | local | host | guest | showcase
  let host = null
  let guest = null
  let netWait = null // online: who we're waiting for (paused), or null
  let figures = [] // { fig, anim, player }
  let umpire = null
  let showcaseFig = null
  // HOOK (practice): extra things on court for a practice session, from practice/layer.js
  // ({ group, update(match, dt, figures), dispose() }); set with api.setLayer
  let layer = null
  let status = "title" // title | playing | paused | over | showcase
  let size = { width: 0, height: 0 }
  let raf = 0
  const clock = createFrameClock() // real time between frames (see utils/frameClock.js)
  let inFrame = false
  let disposed = false
  let studioHold = false // (dev: a studio still is on screen)
  let hudKey = ""
  let hudTimer = 0
  let aidVersion = -1
  let hitStop = 0
  let shake = 0
  let umpireSignal = null
  let umpireSignalT = 0
  let cut = null // { kind, t } a TV cut between points
  let cutShot = null // the cut's framing, worked out once when it starts
  let snapCam = false // the next camera move is a cut, not a pan
  let tossFix = null // the drawn ball's offset from the match's ball just after a toss
  let ballView = null // (tests) where the ball is drawn and whether it's out of sight
  let lastDt = 0
  let camBlocked = 0 // (tests) frames the camera had to be moved off a body
  let replay = null // { frames, i, t, speed }
  let record = [] // replay frames
  let meterEls = [null, null]
  let lastPads = []
  let humans = 1 // people on this computer (1, or 2 sharing it)
  const keys = new Set()
  const chargeKey = [null, null] // what started the current swing (a key, "mouse", "pad", "touch"), per slot
  let preview = null // { at, pace, shot } the aiming aid's last look at your shot
  let touchAimState = null // a finger aiming: { mode: "abs" | "rel", x0, y0 }
  let swipeLive = null // Swipe controls: a finger down on the hit side { pace, slot, serve }
  let stick = [{ x: 0, y: 0 }, { x: 0, y: 0 }]
  const perf = { frames: 0, cpuMs: 0, renderMs: 0, steps: 0 }
  const devLog = import.meta.env.DEV ? [] : null

  const setStatus = (s) => {
    status = s
    onStatus?.(s)
  }

  // ---------- figures ----------
  // the skinned athletes (athlete.js) once their files are in, on Medium and High; rig.js's
  // simple figures before that, on Low, or if anything about them fails
  let simpleOnly = false // (dev: compare with the simple figures)
  const skinned = () => settings.quality !== "low" && athletesReady() && !simpleOnly
  const makeFigure = (look, opts) => {
    if (skinned()) {
      try {
        return createAthlete(look, opts)
      } catch (e) {
        devLog?.push({ t: "athlete", error: String(e?.stack || e) })
      }
    }
    return createFigure(look, opts)
  }
  // swap every figure for the current kind (after the athletes load, or a quality change)
  const refigure = () => {
    const shadows = !!QUALITY[settings.quality]?.shadows
    figures.forEach((f, i) => {
      scene.remove(f.fig.group)
      f.fig.dispose()
      f.fig = makeFigure(lookOf(f.player, i), { shadows })
      f.handBones = null
      scene.add(f.fig.group)
    })
    if (umpire) {
      scene.remove(umpire.group)
      umpire.dispose()
      umpire = null
      placeUmpire()
    }
    if (showcaseFig) {
      const visible = showcaseFig.fig.group.visible
      scene.remove(showcaseFig.fig.group)
      showcaseFig.fig.dispose()
      showcaseFig.fig = makeFigure(showcaseFig.look, { shadows })
      showcaseFig.fig.group.visible = visible
      scene.add(showcaseFig.fig.group)
    }
    warm()
  }
  const wantAthletes = () => {
    if (settings.quality === "low" || athletesReady()) return
    loadAthletes()
      .then(() => {
        if (!disposed && skinned()) refigure()
      })
      .catch((e) => devLog?.push({ t: "athlete-load", error: String(e) }))
  }
  const lookOf = (p, i) => {
    if (p.look && typeof p.look === "object") return p.look
    if (p.character) return lookFor(p.character, p.outfit)
    return lookFor(DEFAULT_LOOKS[i % DEFAULT_LOOKS.length])
  }
  const clearFigures = () => {
    for (const f of figures) {
      scene.remove(f.fig.group, f.blob, f.contact)
      f.fig.dispose()
      f.blob.geometry.dispose()
      f.blob.material.dispose()
    }
    figures = []
  }
  const buildFigures = () => {
    clearFigures()
    const shadows = !!QUALITY[settings.quality]?.shadows
    figures = match.players.map((p, i) => {
      const look = lookOf(p, i)
      // (a player without a look of their own plays with their figure's hand and style; every
      // browser in an online match works this out the same way)
      if (!(p.look && typeof p.look === "object")) {
        p.hand = look.plays === "left" ? -1 : 1
        p.twoHand = look.backhand === "two"
      }
      const fig = makeFigure(look, { shadows })
      scene.add(fig.group)
      const anim = createAnim(p.x, p.z, p.team === 0 ? Math.PI : 0)
      const blob = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.8), new THREE.MeshBasicMaterial({ map: tex.blob, transparent: true, depthWrite: false, opacity: 0.55 }))
      blob.rotation.x = -Math.PI / 2
      blob.renderOrder = 1
      scene.add(blob)
      // and a small dark one right under the feet, so they meet the court
      const contact = new THREE.Mesh(contactGeo, contactMat)
      contact.renderOrder = 2
      scene.add(contact)
      return { fig, anim, player: p, blob, contact, lastSpeed: 0 }
    })
    warm()
  }
  const placeUmpire = () => {
    if (!umpire) {
      umpire = makeFigure(UMPIRE_LOOK, { shadows: !!QUALITY[settings.quality]?.shadows, withPaddle: false })
      scene.add(umpire.group)
    }
  }
  placeUmpire()
  wantAthletes()

  const resetAnims = () => {
    for (const f of figures) f.anim = createAnim(f.player.x, f.player.z, f.player.team === 0 ? Math.PI : 0)
  }

  // the person this screen follows (slot 0) and which end the camera is at
  const mainHuman = () => match?.players.find((p) => p.ctrl === "human" && p.slot === 0) || null
  const viewTeam = () => (mode === "demo" ? 0 : mainHuman()?.team ?? 0)

  // ---------- starting things ----------
  const startLocal = (opts, demo = false) => {
    host = null
    guest = null
    netWait = null
    replay = null
    record = []
    cut = null
    humans = opts.humans || 1
    setVenue(opts.venue || (demo ? "stadium" : venueId))
    match = createMatch({ assist: settings.assist, window: settings.window, ...opts })
    match.autoplay = demo
    mode = demo ? "demo" : "local"
    trailHistory.length = 0
    buildFigures()
    hudKey = ""
    aidVersion = -1
    if (!demo) {
      audio.unlock()
      setStatus("playing")
      container.focus({ preventScroll: true })
    } else setStatus("title")
    if (showcaseFig) showcaseFig.fig.group.visible = false
    start()
  }

  // ---------- input ----------
  const playing = () => status === "playing" && match && mode !== "demo" && !replay
  const keySets = () => (humans >= 2 ? [["p1", 0], ["p2", 1]] : [["solo", 0]])
  const flip = () => viewTeam() === 1 && mode !== "demo"

  const updateMove = () => {
    if (!match || mode === "demo") return
    const sets = keySets()
    for (const [set, slot] of sets) {
      const map = bindings[set]
      const held = (a) => map[a].some((c) => keys.has(c))
      let x = (held("right") ? 1 : 0) - (held("left") ? 1 : 0)
      let z = (held("down") ? 1 : 0) - (held("up") ? 1 : 0)
      const pad = lastPads[slot]
      if (pad && (pad.x || pad.z)) {
        x += pad.x
        z += pad.z
      }
      x += stick[slot]?.x || 0
      z -= stick[slot]?.y || 0
      const l = Math.hypot(x, z)
      if (l > 1) {
        x /= l
        z /= l
      }
      if (flip()) {
        x = -x
        z = -z
      }
      setMove(match, x, z, slot)
    }
  }

  // the hit control: down starts the swing (hold for pace), up lets it go. source: the key
  // code, "mouse", "pad" or "touch" that pressed it (only the same one lets go)
  const shotDown = (slot, source) => {
    if (!playing()) {
      // between points, the hit control skips a replay
      if (replay) endReplay()
      return false
    }
    audio.unlock()
    if (chargeKey[slot]) return false
    const ok = mPress(match, slot)
    if (ok) chargeKey[slot] = source
    return ok
  }
  const shotUp = (slot, source) => {
    if (chargeKey[slot] !== source) return false
    chargeKey[slot] = null
    if (!match) return false
    return mRelease(match, slot)
  }

  // ---- aiming ----
  // a point on the court under a screen position (the ground plane), or null
  const ray = new THREE.Raycaster()
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  const hitPoint = new THREE.Vector3()
  const courtPoint = (clientX, clientY) => {
    const r = canvas.getBoundingClientRect()
    if (!r.width || !r.height) return null
    ray.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), camera)
    return ray.ray.intersectPlane(ground, hitPoint) ? { x: hitPoint.x, z: hitPoint.z } : null
  }
  // on the other side of the net (with a little room past the lines: aiming at a line is
  // your risk), or null
  const farCourt = (pt, p) => {
    if (!pt || !p) return null
    const opp = -sideOf(p.team)
    if (Math.sign(pt.z) !== opp || Math.abs(pt.x) > HALF_W + 1.2 || Math.abs(pt.z) > HALF_L + 1.5) return null
    return { x: Math.max(-HALF_W - 0.4, Math.min(HALF_W + 0.4, pt.x)), z: opp * Math.max(0.4, Math.min(HALF_L + 0.4, Math.abs(pt.z))) }
  }
  const screenSign = () => (flip() ? -1 : 1)
  // a nudge in screen terms (right, up the screen) for the hitter's own view
  const screenNudge = (p, u, v) => ({ u: u * screenSign() * rightSign(p.team), v })

  const onPointerMove = (e) => {
    if (e.pointerType === "touch" || !playing() || humans >= 2) return
    const p = humanBySlot(match, 0)
    if (!p) return
    setAim(match, farCourt(courtPoint(e.clientX, e.clientY), p), 0)
  }

  const onKeyDown = (e) => {
    if (e.target !== container && e.target.closest?.("input, textarea, select, button, .dialog")) return
    const code = e.code
    if (code === "KeyP" || (code === "Escape" && status === "playing")) {
      e.preventDefault()
      if (status === "playing") api.pause()
      else if (status === "paused") api.resume()
      return
    }
    if (status === "paused" && code === "Escape") {
      e.preventDefault()
      api.resume()
      return
    }
    if (code === "KeyC" && humans < 2 && status === "playing" && !e.repeat && !actionFor(bindings, keySets(), code)) {
      cycleCamera()
      return
    }
    const hit = actionFor(bindings, keySets(), code)
    if (!hit) return
    e.preventDefault()
    const { action, slot } = hit
    if (["up", "down", "left", "right"].includes(action)) {
      keys.add(code)
      updateMove()
      return
    }
    if (!e.repeat) shotDown(slot, code)
  }
  const onKeyUp = (e) => {
    const hit = actionFor(bindings, keySets(), e.code)
    if (!hit) return
    const { action, slot } = hit
    if (["up", "down", "left", "right"].includes(action)) {
      keys.delete(e.code)
      updateMove()
      return
    }
    shotUp(slot, e.code)
  }
  const onPointerDown = (e) => {
    if (e.target !== canvas) return
    container.focus({ preventScroll: true })
    audio.unlock()
    if (replay) return endReplay()
    // the mouse: point at their court, click (hold for pace) to hit
    if (e.pointerType !== "touch" && e.button === 0 && playing()) {
      onPointerMove(e)
      if (shotDown(0, "mouse")) {
        try {
          canvas.setPointerCapture(e.pointerId) // (so letting go off the canvas still swings)
        } catch {
          // the pointer is already gone
        }
      }
    }
  }
  const onPointerUp = (e) => {
    if (e.pointerType === "touch") return
    if (e.button === 0 || e.type === "pointercancel") shotUp(0, "mouse")
  }
  const onContextMenu = (e) => e.preventDefault()
  const onBlur = (e) => {
    if (container.contains(e.relatedTarget)) return
    // a focused overlay button that went away drops focus to the page: that's not leaving
    setTimeout(() => {
      if (disposed) return
      const a = document.activeElement
      if (!a || a === document.body) {
        container.focus({ preventScroll: true })
        return
      }
      if (container.contains(a)) return
      keys.clear()
      updateMove()
      if (status === "playing" && mode === "local") api.pause()
    }, 0)
  }
  const onVisibility = () => {
    if (document.hidden && status === "playing" && mode === "local") api.pause()
    // (back: the time away isn't a frame)
    if (!document.hidden) restartClock()
  }
  container.addEventListener("keydown", onKeyDown)
  container.addEventListener("keyup", onKeyUp)
  container.addEventListener("pointerdown", onPointerDown)
  canvas.addEventListener("pointermove", onPointerMove)
  canvas.addEventListener("pointerup", onPointerUp)
  canvas.addEventListener("pointercancel", onPointerUp)
  container.addEventListener("contextmenu", onContextMenu)
  container.addEventListener("focusout", onBlur)
  document.addEventListener("visibilitychange", onVisibility)

  // gamepads: polled each frame, once one has said hello (a "gamepadconnected" event: the
  // browser sends it at the first button press). Until then nothing is polled.
  // (a pad this page already knows about doesn't say hello again)
  let padSeen = false
  try {
    padSeen = !!navigator.getGamepads && [...navigator.getGamepads()].some(Boolean)
  } catch {
    // (gamepads not allowed here)
  }
  const onPadConnected = () => {
    padSeen = true
  }
  window.addEventListener("gamepadconnected", onPadConnected)
  const pollPads = () => {
    if (!padSeen) return
    const list = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : []
    if (!list.length && !lastPads.length) return
    const now = list.map(readPad)
    const slots = humans >= 2 ? [0, 1] : [0]
    slots.forEach((slot) => {
      const pad = humans >= 2 ? now[slot] : now.find((p) => p) || null
      const prev = lastPads[slot]
      const { down, up } = padEdges(prev, pad)
      lastPads[slot] = pad
      if (!pad) return
      for (const b of down) {
        if (b === "pause") {
          if (status === "playing") api.pause()
          else if (status === "paused") api.resume()
        } else shotDown(slot, "pad")
      }
      for (const b of up) if (b !== "pause") shotUp(slot, "pad")
      // the right stick aims: across their court and deeper, in screen terms
      const p = playing() ? humanBySlot(match, slot) : null
      const s = stickAim(pad)
      if (p && (s || prev?.ax || prev?.az)) {
        if (!s) setAim(match, null, slot)
        else {
          const opp = -sideOf(p.team)
          setAim(match, { x: s.u * screenSign() * (HALF_W - 0.35), z: opp * (0.7 + ((s.v + 1) / 2) * (HALF_L - 1.1)) }, slot)
        }
      }
    })
    if (list.length) updateMove()
  }

  // ---------- sizing ----------
  const resize = () => {
    const width = container.clientWidth
    const height = container.clientHeight
    size = { width, height }
    if (!width || !height) {
      if (status === "playing" && mode === "local") api.pause()
      return
    }
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    venue.setScreenCompact?.(portraitScreen())
    restartClock()
    start()
  }
  const resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(container)

  // dynamic resolution (utils/dynamicResolution.js): a step down while frames run slow, back
  // up when there's time to spare
  const adaptQuality = (dtMs, workMs) => {
    if (!resolution.frame(dtMs, workMs)) return
    pixelRatio = resolution.ratio
    renderer.setPixelRatio(pixelRatio)
    renderer.setSize(size.width, size.height, false)
  }

  // ---------- the camera ----------
  const CAMERAS = ["broadcast", "tv", "side", "player"]
  const cycleCamera = () => {
    const next = CAMERAS[(CAMERAS.indexOf(settings.camera) + 1) % CAMERAS.length]
    settings = { ...settings, camera: next }
    onEvent?.({ type: "camera", camera: next })
  }
  const tmpV = new THREE.Vector3()
  const tmpL = new THREE.Vector3()
  let orbit = 0.6
  const updateCamera = (dt, snap) => {
    const portrait = size.height > size.width * 1.05
    const ball = replay ? replay.ball : match?.ball.p
    let fov = portrait ? 64 : 46
    let k = snap ? 1 : 1 - Math.exp(-dt * 3.4)
    if (status === "showcase" && showcaseFig) {
      orbit += dt * 0.35
      const c = showcaseFig.at
      const back = showcaseFig.pose === "run" ? 1.8 : 0
      tmpV.set(c.x + Math.sin(orbit) * 0.6, (portrait ? 1.0 : 1.35) + back * 0.3, c.z + (portrait ? 6.2 : 3.1) + back)
      tmpL.set(c.x, portrait ? -1.0 : 0.95, c.z - back * 0.6)
      fov = portrait ? 54 : 40
      k = snap ? 1 : 1 - Math.exp(-dt * 4)
    } else if (replay) {
      // low and tight by the net post, following the ball
      const s = replay.side
      tmpV.set(s * (HALF_W + 1.4), 1.25, ball.z * 0.55 + s * 0.6)
      tmpL.set(ball.x * 0.6, Math.max(0.5, ball.y * 0.7), ball.z)
      fov = portrait ? 60 : 40
      k = snap ? 1 : 1 - Math.exp(-dt * 6)
    } else if (status === "title" || mode === "demo") {
      orbit += dt * 0.06
      tmpV.set(Math.sin(orbit) * 7, portrait ? 12 : 6.5, Math.cos(orbit) * 12.5)
      tmpL.set(0, portrait ? -1.5 : 0, 0)
    } else if (cut && settings.cuts && playerById(match, match.game.server)) {
      // between points (optional: Settings > TV camera cuts): the server, a 3/4 shot from
      // outside the court on their own side (camera.js serverShot), framed on the spot they
      // walk to; the cut in and the cut back are cuts, never a fly-through
      const p = playerById(match, match.game.server)
      const at = p.spot || p
      if (!cutShot) {
        cutShot = serverShot({ x: at.x, z: at.z, team: p.team }, { portrait })
        snapCam = true
      }
      tmpV.set(cutShot.cam.x, cutShot.cam.y, cutShot.cam.z)
      tmpL.set(p.x * 0.7, 1.05, p.z - sideOf(p.team) * 0.4)
      fov = cutShot.fov
      k = 1 - Math.exp(-dt * 3)
    } else {
      if (cutShot) {
        cutShot = null
        snapCam = true
      }
      const p = mainHuman()
      const s = sideOf(viewTeam())
      const cam = humans >= 2 ? "tv" : settings.camera
      if (cam === "tv" || !p) {
        tmpV.set(0, portrait ? 13.5 : 9.8, s * (HALF_L + (portrait ? 10.5 : 8.8)))
        tmpL.set(0, 0, -s * (portrait ? 1.8 : 1.4))
        fov = portrait ? 62 : 44
      } else if (cam === "side") {
        tmpV.set(-(HALF_W + 9.5), portrait ? 7 : 5.2, ball.z * 0.3)
        tmpL.set(0, 0.5, ball.z * 0.45)
        fov = portrait ? 66 : 42
      } else if (cam === "player") {
        // behind you, over your head (your back never fills the screen: clearShot below
        // lifts it if you're in the way)
        const hz = Math.max(2.4, Math.abs(p.z))
        tmpV.set(p.x * 0.8, 3.1 + (portrait ? 1.3 : 0), s * (hz + 4.4 + (portrait ? 1.8 : 0)))
        tmpL.set(p.x * 0.3 + ball.x * 0.2, 0.6, -s * 4.5)
        fov = portrait ? 66 : 52
      } else {
        // broadcast: high behind your end, following you across
        const hz = Math.max(3, Math.min(HALF_L + 1, Math.abs(p.z)))
        tmpV.set(p.x * (portrait ? 0.25 : 0.45), (portrait ? 8.2 : 4.9) + (hz - 3) * 0.06, s * (hz + (portrait ? 6.8 : 6.6)))
        tmpL.set(p.x * 0.15 + ball.x * 0.15, 0, -s * (portrait ? 3.4 : 2.2))
        // a short, wide screen (a phone on its side) zooms in a little
        fov = portrait ? 64 : size.height < 480 ? 40 : 47
      }
    }
    // no body in front of the lens (camera.js): every in-match view, replays and cuts too
    if (match && status !== "showcase" && status !== "title" && mode !== "demo") {
      const bodies = figures.map((f, i) => {
        const q = replay ? replay.frame.players[i] : f.player
        return { x: q?.x ?? f.player.x, z: q?.z ?? f.player.z }
      })
      if (umpire && venue.umpireSeat) bodies.push({ x: venue.umpireSeat.x, z: venue.umpireSeat.z, h: 2.6 })
      const c = clearShot(tmpV, tmpL, bodies)
      if (c.moved > 0.01) {
        camBlocked++
        tmpV.set(c.x, c.y, c.z)
      }
    }
    if (snapCam) {
      snap = true
      snapCam = false
      k = 1
    }
    if (camera.fov !== fov) {
      camera.fov += (fov - camera.fov) * (snap ? 1 : Math.min(1, dt * 4))
      camera.updateProjectionMatrix()
    }
    camera.position.lerp(tmpV, k)
    camLook.lerp(tmpL, k)
    camera.lookAt(camLook)
    if (shake > 0) {
      camera.position.x += (Math.random() - 0.5) * shake * 0.12
      camera.position.y += (Math.random() - 0.5) * shake * 0.08
      shake = Math.max(0, shake - dt * 3)
    }
  }

  // ---------- drawing the players ----------
  // the hand that holds the ball for a serve: the one without the paddle. A skinned athlete's
  // own hand bone (found by name: athlete.js keeps the 65 bone names; a left-hander holds
  // the paddle in hand_l), its palm a few cm past the bone along the forearm; the simple
  // figures: the pose's free wrist.
  const handV = new THREE.Vector3()
  const foreV = new THREE.Vector3()
  const freeHand = (f, pose) => {
    const lefty = f.player.hand === -1
    if (f.fig.skinned) {
      const bones = f.handBones || (f.handBones = { l: f.fig.group.getObjectByName("hand_l"), r: f.fig.group.getObjectByName("hand_r"), fl: f.fig.group.getObjectByName("lowerarm_l"), fr: f.fig.group.getObjectByName("lowerarm_r") })
      const h = lefty ? bones.r : bones.l
      const fa = lefty ? bones.fr : bones.fl
      if (h) {
        h.getWorldPosition(handV)
        if (fa) {
          fa.getWorldPosition(foreV)
          const d = handV.distanceTo(foreV) || 1
          handV.addScaledVector(foreV.sub(handV).negate(), 0.07 / d)
        }
        return { x: handV.x, y: handV.y, z: handV.z }
      }
    }
    const w = pose.wristO
    return w ? { x: w.x, y: w.y, z: w.z } : null
  }
  let clockNow = 0 // seconds, for the swing trails' fading
  const updateFigures = (dt) => {
    if (!match) return
    clockNow += dt
    // (copies for the replay only while a rally is being kept: local play)
    const recording = !replay && mode === "local" && (match.phase === "rally" || match.phase === "dead")
    const frameRec = recording ? [] : null
    for (const f of figures) {
      const p = f.player
      let s
      if (replay) s = replay.frame.players[figures.indexOf(f)]
      else {
        s = situation(match, p)
        if (recording) frameRec.push({ ...s, ball: { ...s.ball }, swing: s.swing && { ...s.swing }, prep: s.prep && { ...s.prep } })
      }
      if (!s) continue
      // the ball is in the server's hand only while they stand ready to serve; walking back
      // between points it's in their pocket (the arms swing free, nothing held at the hip)
      if (s.holding && !replay && match.phase !== "serve") s = { ...s, holding: false }
      // (motion matching for the skinned athletes: searched more often on High)
      f.anim.useMM = !!f.fig.skinned
      f.anim.mmEvery = settings.quality === "high" ? 0.1 : 0.2
      const pose = updateAnim(f.anim, s, dt)
      f.fig.apply(pose, dt)
      f.pose = pose
      // the server's free hand (where the ball sits): the skinned body's own hand bone, or
      // the simple figure's wrist
      f.hand = s.holding ? freeHand(f, pose) : null
      // this screen's own players: the swing trail
      if (p.ctrl === "human" && (p.slot === 0 || p.slot === 1)) {
        const swinging = settings.trail !== false && !!(s.swing && !s.swing.whiff && s.swing.t < 0.32) && status === "playing"
        updateSwingTrail(swingTrails[p.slot], pose, swinging, clockNow)
      }
      f.blob.position.set(pose.pelvis.x, 0.004, pose.pelvis.z)
      const feet = pose.ankleL && pose.ankleR
      f.contact.visible = f.fig.group.visible
      f.contact.position.set(feet ? (pose.ankleL.x + pose.ankleR.x) / 2 : pose.pelvis.x, 0.006, feet ? (pose.ankleL.z + pose.ankleR.z) / 2 : pose.pelvis.z)
      // sneakers squeak when someone stops hard
      const speed = Math.hypot(s.vx, s.vz)
      if (!replay && f.lastSpeed - speed > 1.6 * dt * 60 * 0.05 && f.lastSpeed > 2.6 && Math.random() < 0.35) audio.squeak(Math.min(1, f.lastSpeed / 4))
      f.lastSpeed = speed
    }
    // the rings under the people playing on this computer
    youRings.forEach((r, slot) => {
      const p = mode === "demo" || replay ? null : humanBySlot(match, slot)
      r.visible = !!p && status !== "showcase"
      if (p) {
        const f = figures.find((x) => x.player === p)
        const at = f ? f.anim.gait.feet : null
        const cx = at ? (at[0].x + at[1].x) / 2 : p.x
        const cz = at ? (at[0].z + at[1].z) / 2 : p.z
        r.position.set(cx, 0.006, cz)
        r.material.opacity = humans >= 2 || match.game.doubles ? 0.55 : 0.3
      }
    })
    // the umpire watches the ball, and signals calls
    if (umpire) {
      const b = replay ? replay.ball : match.ball.p
      umpireSignalT = Math.max(0, umpireSignalT - dt)
      umpire.apply(seatedPose(venue.umpireSeat, b, umpireSignalT > 0 ? umpireSignal : null), dt)
    }
    // keep frames for replays (local play only)
    if (recording) {
      record.push({ players: frameRec, ball: { ...match.ball.p }, dt })
      let total = 0
      for (let i = record.length - 1; i >= 0; i--) {
        total += record[i].dt
        if (total > REPLAY_S) {
          record.splice(0, i)
          break
        }
      }
    }
  }

  // ---------- the ball ----------
  const updateBall = () => {
    const fix = guest?.fix
    const b = replay ? { p: replay.ball, v: { x: 0, y: 0, z: 0 }, held: null } : match.ball
    let bx = b.p.x + (fix?.x || 0)
    let by = b.p.y + (fix?.y || 0)
    let bz = b.p.z + (fix?.z || 0)
    // a held ball: in the server's free hand while they're ready to serve, out of sight
    // (pocketed) while they walk back; just after the toss it eases from the hand onto its
    // real path (the match drops it from a set point near the hand)
    let hidden = false
    if (b.held && !replay) {
      const f = figures.find((x) => x.player.id === b.held)
      if (match.phase === "serve" && f?.hand) {
        bx = f.hand.x
        by = f.hand.y
        bz = f.hand.z
        tossFix = { x: bx - b.p.x, y: by - b.p.y, z: bz - b.p.z, t: 0, ball: b.held }
      } else hidden = true
    } else if (tossFix && !replay && match.rally?.hits === 0) {
      tossFix.t += lastDt
      const k = Math.max(0, 1 - tossFix.t / 0.15)
      bx += tossFix.x * k
      by += tossFix.y * k
      bz += tossFix.z * k
      if (k <= 0) tossFix = null
    } else tossFix = null
    ballMesh.visible = !hidden
    ballShadow.visible = !hidden
    ballView = { hidden, x: bx, y: by, z: bz, held: b.held || null, phase: match.phase }
    ballMesh.position.set(bx, Math.max(BALL_R * BALL_SCALE, by), bz)
    ballMesh.rotation.x += (b.w?.x || 0) * 0.004
    ballMesh.rotation.z += (b.w?.z || 0) * 0.004
    // the shadow shrinks and darkens as the ball comes down
    const h = Math.max(0, by - BALL_R)
    const s = BALL_R * BALL_SCALE * 2.8 * (1 + h * 0.3)
    ballShadow.position.set(bx + h * 0.1, 0.007, bz - h * 0.05)
    ballShadow.scale.set(s, s, s)
    ballShadow.material.opacity = Math.max(0.15, 0.9 - h * 0.2)
    // the trail
    trailHistory.unshift(bx, by, bz)
    if (trailHistory.length > TRAIL_N * 3) trailHistory.length = TRAIL_N * 3
    const speed = replay ? 8 : Math.hypot(b.v.x, b.v.y, b.v.z)
    const show = speed > 5 && !b.held ? Math.min(1, (speed - 5) / 8) : 0
    const cam = camera.position
    for (let i = 0; i < TRAIL_N; i++) {
      const j = Math.min(i, trailHistory.length / 3 - 1)
      const j2 = Math.min(i + 1, trailHistory.length / 3 - 1)
      const x = trailHistory[j * 3]
      const y = trailHistory[j * 3 + 1]
      const z = trailHistory[j * 3 + 2]
      // ribbon width across the view
      const dx = trailHistory[j2 * 3] - x
      const dy = trailHistory[j2 * 3 + 1] - y
      const dz = trailHistory[j2 * 3 + 2] - z
      const vx = cam.x - x
      const vy = cam.y - y
      const vz = cam.z - z
      let nx = dy * vz - dz * vy
      let ny = dz * vx - dx * vz
      let nz = dx * vy - dy * vx
      const nl = Math.hypot(nx, ny, nz) || 1
      const w = BALL_R * BALL_SCALE * 0.9 * (1 - i / TRAIL_N)
      nx = (nx / nl) * w
      ny = (ny / nl) * w
      nz = (nz / nl) * w
      // (written straight in: no little arrays every frame)
      const o = i * 6
      trailPos[o] = x + nx
      trailPos[o + 1] = y + ny
      trailPos[o + 2] = z + nz
      trailPos[o + 3] = x - nx
      trailPos[o + 4] = y - ny
      trailPos[o + 5] = z - nz
      const a = show * 0.75 * (1 - i / TRAIL_N)
      for (let k = i * 8; k < i * 8 + 8; k += 4) {
        trailCol[k] = trailColor[0] * a
        trailCol[k + 1] = trailColor[1] * a
        trailCol[k + 2] = trailColor[2] * a
        trailCol[k + 3] = a
      }
    }
    trailGeo.attributes.position.needsUpdate = true
    trailGeo.attributes.color.needsUpdate = true
  }

  // where the incoming ball lands (yellow: in, red: going out) and where you're aiming
  const updateAid = () => {
    const r = match.rally
    const you = mainHuman()
    const show = settings.aid && status === "playing" && mode !== "demo" && !replay && you && r && r.lastTeam !== null && r.lastTeam !== you.team && r.bounces === 0 && !r.pending && !r.over && !match.ball.held
    if (!show) landRing.visible = false
    else if (aidVersion !== match.version) {
      aidVersion = match.version
      const path = predictPath({ p: match.ball.p, v: match.ball.v, w: match.ball.w }, { maxT: 2.5, every: 1 / 30, maxBounces: 1 })
      const land = path.find((s) => s.bounce)
      landRing.visible = !!land && Math.sign(land.z) === sideOf(you.team)
      if (land) {
        landRing.position.set(land.x, 0.009, land.z)
        landRing.material.color.setHex(inCourt(land.x, land.z) ? 0xfff6a8 : 0xff5a4a)
      }
    }
    if (landRing.visible) landRing.scale.setScalar(1 + Math.sin(performance.now() / 120) * 0.08)
    // aiming: when the ball is coming to you, a ring where your shot goes (at the pace you're
    // holding: soft until you hold longer), and a dot where it would really land if that's
    // somewhere else (a hard ball from down low sails long). The serve: its box target.
    const c = you?.charge
    const live = settings.aid && status === "playing" && !replay && mode !== "demo" && you
    const coming = live && you.expect && r && r.lastTeam !== you.team && !r.over
    aimDot.visible = false
    aimArc.visible = false
    const swipeServing = live && swipeLive && match.ball.held === you.id && match.phase === "serve"
    if (live && (c?.kind === "serve" || swipeServing)) {
      const plan = planShot("serve", { team: you.team, from: match.ball.p, aim: 0, power: 0.6, court: match.rally.court })
      const aim = match.inputs[you.slot]?.aim
      const want = (match.rally.court === "left" ? -1 : 1) * rightSign(1 - you.team)
      const opp = -sideOf(you.team)
      const t = aim ? { x: want * Math.max(0.3, Math.min(HALF_W - 0.3, aim.x * want)), z: opp * Math.max(2.6, Math.min(HALF_L - 0.3, Math.abs(aim.z))) } : plan.target
      aimRing.visible = true
      aimRing.position.set(t.x, 0.011, t.z)
      aimRing.material.color.setHex(0x7cf0ff)
      aimArc.visible = true
      aimArc.material.color.setHex(0x7cf0ff)
      drawArc(ballView || match.ball.p, { x: t.x, y: 0.02, z: t.z }, 1.6)
    } else if (coming) {
      // (Swipe: the pace your finger is swiping at right now)
      const pace = swipeLive?.pace ?? (c ? paceOf(match.t - c.start) : you.armed?.pace ?? 0.12)
      const now = performance.now()
      // (a solve per frame is wasteful: ten looks a second)
      if (!preview || now - preview.at > 100 || Math.abs(preview.pace - pace) > 0.05 || preview.v !== match.version) preview = { at: now, pace, v: match.version, shot: previewShot(match, you, pace) }
      const s = preview.shot
      if (s) {
        aimRing.visible = true
        aimRing.position.set(s.target.x, 0.011, s.target.z)
        aimRing.material.color.setHex(s.band === "soft" ? 0x7cf0ff : s.band === "firm" ? 0xffe066 : 0xff9a3c)
        aimRing.material.opacity = c || you.armed || swipeLive ? 0.85 : 0.45
        // the arc: from where you'll meet it, over the net, to the target; high and loopy
        // when soft, flat when hard
        const e = you.expect
        const col = s.band === "soft" ? 0x7cf0ff : s.band === "firm" ? 0xffe066 : 0xff9a3c
        aimArc.visible = !!(c || you.armed || swipeLive || touchAimState)
        if (aimArc.visible) {
          aimArc.material.color.setHex(col)
          drawArc(e, { x: s.target.x, y: 0.02, z: s.target.z }, s.band === "soft" ? (s.kind === "lob" ? 4.2 : 1.45) : s.band === "firm" ? 1.25 : 1.05)
        }
        const off = Math.hypot(s.landing.x - s.target.x, s.landing.z - s.target.z)
        if (off > 0.6) {
          aimDot.visible = true
          aimDot.position.set(s.landing.x, 0.012, s.landing.z)
          aimDot.material.color.setHex(inCourt(s.landing.x, s.landing.z) ? 0xffe066 : 0xff5a4a)
        }
      } else aimRing.visible = false
    } else aimRing.visible = false
    aimPip.visible = aimRing.visible
    if (aimPip.visible) {
      aimPip.position.set(aimRing.position.x, 0.012, aimRing.position.z)
      aimPip.material.color.copy(aimRing.material.color)
      // (it breathes while you're about to hit)
      aimRing.scale.setScalar(c || swipeLive ? 1.35 + Math.sin(performance.now() / 110) * 0.08 : 1.15)
    }
    // the contact marker
    if (coming && you.expect.at - match.t < 1.2) {
      const e = you.expect
      contactRing.visible = true
      contactRing.position.set(e.x, e.y, e.z)
      contactRing.lookAt(camera.position)
      contactRing.material.color.setHex(e.y > ATTACK_H ? 0xff9a3c : 0x9fe8ff)
      contactRing.scale.setScalar(handBattle(match, you) ? 1.5 : 1)
    } else contactRing.visible = false
  }

  // ---------- the timing meter (drawn by the page; we move its parts) ----------
  // (the page is only touched when a value changes: most frames nothing does)
  const meterLast = new WeakMap()
  const lastOf = (el) => {
    let o = meterLast.get(el)
    if (!o) meterLast.set(el, (o = {}))
    return o
  }
  const setVar = (el, name, v) => {
    const o = lastOf(el)
    if (o[name] === v) return
    o[name] = v
    el.style.setProperty(name, String(v))
  }
  const setData = (el, key, v) => {
    const s = v === undefined || v === null ? "" : String(v)
    if (el.dataset[key] !== s) el.dataset[key] = s
  }
  const updateMeters = () => {
    for (const slot of [0, 1]) {
      const el = meterEls[slot]
      if (!el) continue
      const p = match && (mode === "local" || mode === "host" || mode === "guest") && !replay && status === "playing" ? humanBySlot(match, slot) : null
      const info = p ? meterFor(match, p) : null
      if (!info) {
        if (el.dataset.mode) el.dataset.mode = ""
        continue
      }
      setData(el, "mode", info.mode)
      if (info.mode === "serve") {
        setVar(el, "--fill", Math.min(1.4, info.fill) / 1.4)
        setData(el, "grade", info.grade)
      } else {
        // the marker reaches the middle when it's time to let go
        const RANGE = 0.55
        const pos = Math.max(0, Math.min(1, 0.5 - (info.ttc - info.lead) / RANGE / 2 + (info.released !== null ? 0 : 0)))
        if (info.released !== null && el.dataset.rel !== "1") {
          el.dataset.rel = "1"
          setVar(el, "--rel", pos)
        } else if (info.released === null && el.dataset.rel === "1") el.dataset.rel = ""
        setVar(el, "--pos", pos)
        setVar(el, "--zone", info.window / RANGE)
        setVar(el, "--power", swipeLive && swipeLive.slot === slot ? swipeLive.pace ?? 0 : info.pace ?? 0)
        setData(el, "charging", info.charging ? "1" : "")
        setData(el, "band", info.band || "")
        setData(el, "height", info.height)
        setData(el, "fast", info.fast ? "1" : "")
      }
    }
  }

  // ---------- the scoreboard ----------
  const teamNames = () => {
    const names = [0, 1].map((team) => match.players.filter((p) => p.team === team).map((p) => p.name))
    return names.map((n) => n.join(" / "))
  }
  const sendHud = (force) => {
    const sb = scoreboard(match)
    const you = mainHuman()
    const server = playerById(match, sb.server)
    const yourServe = !!you && match.ball.held === you.id && match.phase === "serve"
    const serveSlot = humans >= 2 && server?.ctrl === "human" && match.ball.held === server.id && match.phase === "serve" ? server.slot : null
    const key = `${sb.call}|${sb.score}|${sb.serving}|${sb.server}|${yourServe}|${serveSlot}|${status}|${match.phase}|${netWait}|${mode}`
    if (!force && key === hudKey) return
    hudKey = key
    const names = teamNames()
    if (venue.drawScreen) venue.drawScreen({ names, score: sb.score, call: sb.call })
    onHud?.({
      call: sb.call,
      score: sb.score,
      serving: sb.serving,
      server: server?.name,
      serverNumber: sb.serverNumber,
      names,
      yourTeam: you?.team ?? 0,
      doubles: match.game.doubles,
      scoring: match.game.scoring,
      target: match.game.target,
      yourServe,
      serveSlot,
      phase: match.phase,
      demo: mode === "demo",
      mode,
      humans,
      netWait,
      venue: venue.def.name,
    })
  }

  // ---------- replays ----------
  const startReplay = (side) => {
    if (record.length < 30 || mode !== "local") return
    // from a moment before the rally's last few shots to the end
    const frames = record.slice(-Math.min(record.length, 60 * 6))
    replay = { frames, i: 0, t: 0, side: side || (Math.random() < 0.5 ? 1 : -1), frame: frames[0], ball: { ...frames[0].ball } }
    match.hold = true
    for (const f of figures) f.anim = createAnim(frames[0].players[figures.indexOf(f)]?.x ?? f.player.x, frames[0].players[figures.indexOf(f)]?.z ?? f.player.z, f.player.team === 0 ? Math.PI : 0)
    trailHistory.length = 0
    trailColor = [1, 0.95, 0.6]
    onEvent?.({ type: "replay", on: true })
    if (venue.drawScreen) venue.drawScreen({ message: "REPLAY" })
  }
  function endReplay() {
    if (!replay) return
    replay = null
    record = []
    if (match) match.hold = false
    resetAnims()
    trailHistory.length = 0
    hudKey = ""
    onEvent?.({ type: "replay", on: false })
  }
  const stepReplay = (dt) => {
    replay.t += dt * 0.4 // slow motion
    let acc = 0
    let i = replay.i
    while (i < replay.frames.length - 1 && acc + replay.frames[i].dt <= replay.t) {
      acc += replay.frames[i].dt
      i++
    }
    if (i >= replay.frames.length - 1) {
      endReplay()
      return 0
    }
    if (i !== replay.i) {
      replay.t -= acc
      replay.i = i
    }
    replay.frame = replay.frames[i]
    const next = replay.frames[i + 1]
    const u = Math.min(1, replay.t / Math.max(1e-3, replay.frame.dt))
    const a = replay.frame.ball
    replay.ball = { x: a.x + (next.ball.x - a.x) * u, y: a.y + (next.ball.y - a.y) * u, z: a.z + (next.ball.z - a.z) * u }
    return dt * 0.4
  }

  // ---------- events ----------
  const handleEvents = () => {
    const you = mainHuman()
    const demo = mode === "demo"
    for (const e of match.events) {
      if (devLog && !demo) {
        devLog.push(e)
        if (devLog.length > 3000) devLog.splice(0, 800)
      }
      switch (e.type) {
        case "hit": {
          const perfect = e.grade === "perfect"
          audio.pock(Math.min(1, e.paddle / 14), perfect)
          const hot = e.speed > 15
          const big = e.kind === "smash" || (e.tone === "great" && hot)
          trailColor = hot ? [1, 0.55, 0.2] : perfect ? [0.75, 1, 1] : [1, 0.95, 0.6]
          burst(e.x, e.y, e.z, big ? 26 : perfect ? 12 : 6, { speed: big ? 5 : 2.5, color: hot ? [1, 0.6, 0.2] : [1, 0.95, 0.55], life: big ? 0.5 : 0.3 })
          if (big && (mode === "local" || mode === "demo")) hitStop = 0.08
          if (big && !reducedMotion()) shake = 1
          // everyone on the other side gets on their toes
          for (const f of figures) if (f.player.team !== e.team) splitStep(f.anim, { fallback: true })
          if (demo) break
          const hitter = playerById(match, e.player)
          const mine = hitter?.ctrl === "human"
          onEvent?.({ type: "hit", kind: e.kind, label: e.label || KIND_LABEL[e.kind], tone: e.tone, tag: e.tag, mine, theirs: !!you && e.team !== you.team, slot: hitter?.slot, grade: e.grade, risky: e.risky, speed: e.speed, volley: e.volley, team: e.team })
          if (e.tone === "great") venue.crowd?.cheer(0.25)
          break
        }
        case "bounce":
          audio.bounce(Math.min(1, e.speed / 12))
          if (e.speed > 9) burst(e.x, 0.02, e.z, 5, { speed: 1, up: 0.6, color: [0.6, 0.6, 0.6], life: 0.35, gravity: 2 })
          break
        case "line":
          if (demo) break
          mark.material = e.call === "In" ? markMat.in : markMat.out
          mark.position.set(e.x, 0.01, e.z)
          mark.visible = true
          markTimer = 1.6
          onEvent?.({ type: "line", call: e.call })
          if (e.call === "In") audio.ooh()
          break
        case "net":
        case "tape":
          audio.net()
          break
        case "whiff":
          if (!demo && playerById(match, e.player)?.ctrl === "human") onEvent?.({ type: "whiff", slot: playerById(match, e.player).slot })
          break
        case "fault":
          if (demo) break
          umpireSignal = /out/i.test(e.call || "") ? "out" : "fault"
          umpireSignalT = 1.3
          audio.call(/kitchen/i.test(e.call) ? "Fault, kitchen" : e.call)
          onEvent?.({ type: "fault", call: e.call, reason: e.reason, winner: e.winner, yours: e.winner === you?.team })
          break
        case "rally": {
          if (demo) break
          const level = Math.min(1, 0.3 + e.shots / 14 + (e.last?.risky ? 0.2 : 0) + (e.kind === "winner" ? 0.15 : 0))
          venue.crowd?.cheer(level)
          audio.cheer(level)
          onEvent?.({ type: "rally", ...e, yours: e.winner === you?.team })
          // a great point gets the replay
          const worthy = e.shots >= 9 || (e.kind === "winner" && (e.last?.kind === "smash" || e.last?.risky || e.last?.grade === "perfect") && e.shots >= 3)
          // (only for this match: a replay due as the next match starts would freeze it)
          if (worthy && settings.replays !== false && mode === "local") {
            const forMatch = match
            setTimeout(() => !disposed && match === forMatch && mode === "local" && !replay && forMatch.phase !== "rally" && startReplay(), 900)
          }
          break
        }
        case "point":
          if (demo) break
          audio.chime(e.winner === you?.team)
          for (const f of figures) setMood(f.anim, f.player.team === e.winner ? "cheer" : "sulk", Math.floor(Math.random() * 3))
          onEvent?.({ type: "point", ...e, yours: e.winner === you?.team })
          break
        case "call":
          if (demo) break
          cut = { t: 0 }
          audio.call(e.call)
          onEvent?.({ type: "call", call: e.call, server: playerById(match, e.server)?.name })
          break
        case "ready":
          cut = null
          break
        case "drill":
          onEvent?.(e)
          break
        case "gameover":
          if (demo) {
            startLocal(demoOptions(), true)
            return
          }
          venue.crowd?.cheer(1)
          audio.cheer(1)
          onEvent?.({ type: "gameover", winner: e.winner, score: e.score, youWon: e.winner === you?.team, stats: JSON.parse(JSON.stringify(match.stats)), names: teamNames() })
          setStatus("over")
          break
        default:
      }
    }
    match.events.length = 0
  }

  // Focus: on an easy setting (or when asked), time slows while a hard ball is coming at you
  // at the net, so a hand battle can be learned
  let focus = 1
  const focusScale = () => {
    let want = 1
    if (mode === "local" && match && match.phase === "rally" && !devAuto.size) {
      const on = settings.focus === "on" || (settings.focus === "auto" && (match.o.level === "beginner" || !!match.practice))
      if (on) {
        for (const slot of [0, 1]) {
          const p = humanBySlot(match, slot)
          if (p?.expect && match.rally.lastTeam !== p.team && handBattle(match, p) && p.expect.at - match.t < 0.6) want = 0.45
        }
      }
    }
    focus += (want - focus) * (want < focus ? 0.5 : 0.15)
    return focus
  }

  // ---------- the frame ----------
  const frame = (now) => {
    raf = 0
    if (disposed || studioHold) return
    if (!size.width || !size.height) return
    const cpuStart = performance.now()
    inFrame = true
    const dtMs = clock.tick(now)
    const snap = clock.first
    let dt = dtMs / 1000
    pollPads()
    if (match && status !== "paused" && status !== "showcase") {
      if (replay) dt = stepReplay(dt) || dt
      else if (mode === "guest" && guest) {
        if (devAuto.size) autopilot(match, 0, devJitter)
        guest.tick(dtMs, now)
        handleEvents()
      } else if (hitStop > 0) {
        hitStop -= dt
      } else {
        if (mode === "demo") match.autoplay = true
        if (devAuto.size && mode !== "demo") for (const slot of devAuto) autopilot(match, slot, devJitter)
        perf.steps += advance(match, dt * focusScale())
        if (host) host.capture(match.events)
        handleEvents()
      }
      if (host) host.tick(dtMs)
      if (cut) cut.t += dt
    }
    lastDt = status === "paused" ? 0 : dt
    if (match) {
      updateFigures(status === "paused" ? 0 : dt)
      layer?.update(mode === "demo" ? null : match, status === "paused" ? 0 : dt, figures)
      updateBall()
      updateAid()
      updateMeters()
      if (markTimer > 0) {
        markTimer -= dt
        mark.material.opacity = Math.min(1, markTimer)
        if (markTimer <= 0) mark.visible = false
      }
      hudTimer += dtMs
      if (hudTimer > 100) {
        hudTimer = 0
        sendHud(false)
      }
    }
    if (status === "showcase" && showcaseFig) {
      const S = showcaseFig
      // facing S.yaw (the Locker Room turns it); "ready" swings now and then, "run" jogs a
      // small circle round the spot, "still" just stands
      const yaw = S.yaw || 0
      const fx = Math.sin(yaw)
      const fz = Math.cos(yaw)
      const local = (dx, y, dz) => ({ x: S.at.x - fz * dx + fx * dz, y, z: S.at.z + fx * dx + fz * dz })
      let x = S.at.x
      let z = S.at.z
      let vx = 0
      let vz = 0
      if (S.pose === "run") {
        S.lap = (S.lap || 0) + dt * 2.6 / 1.3
        x = S.at.x + Math.sin(S.lap) * 1.3
        z = S.at.z + (Math.cos(S.lap) - 1) * 1.3
        vx = Math.cos(S.lap) * 2.6
        vz = -Math.sin(S.lap) * 2.6
      } else if (S.lap) {
        // (back to the spot)
        S.lap = 0
      }
      const s = { x, z, vx, vz, facing: yaw, ball: local(0, 1, 3), holding: false, swing: S.pose === "ready" ? S.swing : null, prep: null, charging: false, between: S.pose === "run", atNet: false, hand: S.look?.plays === "left" ? -1 : 1, twoHand: S.look?.backhand === "two", goal: S.pose === "run" ? local(0, 0, 9) : null }
      if (S.swing) S.swing.t += dt
      S.t += dt
      if (S.t > 3.2) {
        S.t = 0
        const kinds = ["drive", "dink", "slice", "smash"]
        const k = kinds[Math.floor(Math.random() * kinds.length)]
        const y = k === "smash" ? 1.9 : k === "dink" ? 0.35 : 0.9
        S.swing = { t: 0, kind: k, hand: Math.random() < 0.6 ? "fh" : "bh", ...local(Math.random() < 0.5 ? 0.55 : -0.55, y, 0.35) }
      }
      S.anim.useMM = !!S.fig.skinned
      S.fig.apply(updateAnim(S.anim, s, dt), dt)
    }
    venue.crowd?.update(now / 1000, dt)
    venue.update?.(now / 1000, dt)
    updateParticles(dt)
    updateCamera(dt, snap)
    const renderStart = performance.now()
    if (holdPicture()) {
      // (shaders compiling: keep the last picture, and come back next frame)
      if (status !== "paused" || host || guest) start()
      inFrame = false
      return
    }
    renderer.render(scene, camera)
    perf.frames++
    perf.renderMs += performance.now() - renderStart
    perf.cpuMs += renderStart - cpuStart
    if (!snap) adaptQuality(dtMs, performance.now() - cpuStart)
    if (status !== "paused" || host || guest) start()
    inFrame = false
  }

  // The loop runs while anything moves. Starting it again after a stop starts the clock
  // afresh (the stop wasn't a frame); the call at the end of each frame keeps it.
  function start() {
    if (!raf && !disposed && size.width && size.height) {
      if (!inFrame) restartClock()
      raf = requestAnimationFrame(frame)
    }
  }
  function restartClock() {
    clock.reset()
    resolution.reset()
  }

  // ---------- shaders, compiled ahead ----------
  // Whenever the scene gets new kinds of material (a venue, its lights, the athletes, a
  // quality change), compileAsync compiles every program in the background
  // (KHR_parallel_shader_compile) instead of the next frame stalling on them. Meanwhile the
  // last picture stays up, except during a match (a frozen court would hide the ball: that
  // frame waits for its shaders, as before). The first warm-up is behind "Loading the court...".
  let warming = 0
  function warm() {
    if (disposed || !renderer.compileAsync) return
    warming++
    let done = false
    const finish = () => {
      if (done) return
      done = true
      warming--
      if (!warming) restartClock()
      start()
    }
    setTimeout(finish, 6000) // (never hold the picture longer than this)
    try {
      renderer.compileAsync(scene, camera).then(finish, finish)
    } catch {
      finish()
    }
  }
  const holdPicture = () => warming > 0 && !(match && status === "playing" && mode !== "demo")
  const whenWarm = () =>
    new Promise((resolve) => {
      const check = () => (warming === 0 || disposed ? resolve() : setTimeout(check, 30))
      check()
    })

  const onContextLost = (e) => {
    e.preventDefault()
    if (status === "playing" && mode === "local") api.pause()
    releaseGpu(scene)
  }
  const onContextRestored = () => {
    restartClock()
    start()
  }
  canvas.addEventListener("webglcontextlost", onContextLost)
  canvas.addEventListener("webglcontextrestored", onContextRestored)

  const demoOptions = () => {
    const ids = CHARACTERS.filter((c) => !c.boss).map((c) => c.id)
    const pick = () => ids.splice(Math.floor(Math.random() * ids.length), 1)[0]
    const who = [pick(), pick(), pick(), pick()]
    const nick = (id) => CHARACTERS.find((c) => c.id === id).nick
    return {
      doubles: true,
      level: "pro",
      seed: (Math.random() * 1e9) | 0,
      venue: "stadium",
      roster: [
        { id: "you", team: 0, ctrl: "human", slot: 0, name: nick(who[0]), character: who[0] },
        { id: "partner", team: 0, ctrl: "cpu", level: "pro", name: nick(who[1]), character: who[1] },
        { id: "opp1", team: 1, ctrl: "cpu", level: "pro", name: nick(who[2]), character: who[2] },
        { id: "opp2", team: 1, ctrl: "cpu", level: "pro", name: nick(who[3]), character: who[3] },
      ],
    }
  }
  const devAuto = new Set()
  let devJitter = {}

  // ---------- public API ----------
  const api = {
    // a match on this computer. opts: createMatch options plus venue and humans (1 or 2)
    newMatch(opts) {
      startLocal(opts, false)
    },
    // the title screen's demo match
    demo() {
      startLocal(demoOptions(), true)
    },
    // online: role "host" | "guest"; people [{ seat, name, character, outfit }]; settings
    // { doubles, scoring, target, venue, level }; send { snap, input, relay }
    startOnline({ role, seat, people, settings: s, seed, send }) {
      replay = null
      record = []
      cut = null
      humans = 1
      netWait = null
      setVenue(s.venue || "stadium")
      // (each person's own Locker Room look, checked; or their player's kit)
      const withLooks = people.map((p) => ({ ...p, look: p.look && typeof p.look === "object" ? validateLook(p.look, characterLook(p.character || DEFAULT_LOOKS[p.seat % 4], p.outfit)) : lookFor(p.character || DEFAULT_LOOKS[p.seat % 4], p.outfit) }))
      const { roster, doubles } = onlineRoster(withLooks, { doubles: s.doubles, level: s.level || "intermediate" })
      const named = roster.map((r, i) => (r.ctrl === "cpu" ? { ...r, character: CHARACTERS[(i * 3 + 2) % 9].id, look: lookFor(CHARACTERS[(i * 3 + 2) % 9].id), name: `${CHARACTERS[(i * 3 + 2) % 9].nick} (CPU)` } : r))
      const options = { doubles, scoring: s.scoring || "sideout", target: s.target || 11, assist: settings.assist, window: settings.window }
      if (role === "host") {
        guest = null
        match = createMatch({ ...options, roster: named.map((r) => (r.seat === seat ? { ...r, ctrl: "human", slot: 0 } : r)), seed })
        host = createHost(match, send)
        mode = "host"
      } else {
        host = null
        guest = createGuest({ ...options, roster: named, me: `p${seat}`, send })
        match = guest.m
        mode = "guest"
      }
      buildFigures()
      trailHistory.length = 0
      hudKey = ""
      audio.unlock()
      setStatus("playing")
      container.focus({ preventScroll: true })
      start()
    },
    netSnap(data) {
      guest?.onSnap(data, performance.now())
    },
    netInput(data, seat) {
      host?.onInput(data, seat)
    },
    netRelay(data, seat) {
      return host ? host.onRelay(data, seat) : false
    },
    // online, a guest: the host's final word (sent reliably, before the room stops relaying)
    netFinal(d) {
      if (mode !== "guest" || !match || status === "over" || !Array.isArray(d?.score)) return
      match.game.score = [Number(d.score[0]) || 0, Number(d.score[1]) || 0]
      match.game.winner = d.winner === 1 ? 1 : 0
      match.phase = "over"
      const you = mainHuman()
      const stats = d.stats && typeof d.stats === "object" ? d.stats : JSON.parse(JSON.stringify(match.stats))
      hudKey = ""
      onEvent?.({ type: "gameover", winner: match.game.winner, score: match.game.score, youWon: match.game.winner === you?.team, stats, names: teamNames() })
      setStatus("over")
    },
    // online: someone's connection dropped (text says who), or null when everyone's back
    setNetWait(text) {
      netWait = text || null
      if (host) {
        match.paused = !!netWait
        host.setExtra(netWait ? { paused: 1 } : {})
      } else if (guest && match) match.paused = !!netWait || match.paused
      hudKey = ""
    },
    get online() {
      return mode === "host" || mode === "guest"
    },
    // online: the room seats on a team (for the result)
    seatsOf(team) {
      return match ? match.players.filter((p) => p.team === team && p.seat !== null && p.seat !== undefined).map((p) => p.seat) : []
    },
    pause() {
      if (status !== "playing" || mode === "host" || mode === "guest") return
      keys.clear()
      updateMove()
      if (match) match.paused = true
      setStatus("paused")
    },
    resume() {
      if (status !== "paused") return
      if (match) match.paused = false
      setStatus("playing")
      container.focus({ preventScroll: true })
      start()
    },
    // leave a match (back to the title's demo)
    quit() {
      host = null
      guest = null
      endReplay()
      startLocal(demoOptions(), true)
    },
    // the on-screen joystick: x right, y up the screen, each -1..1
    setStick(x, y, slot = 0) {
      stick[slot] = { x, y }
      updateMove()
    },
    // the on-screen hit control: down and up (hold for pace, let go to swing)
    shotDown(action = "hit", slot = 0) {
      return shotDown(slot, "touch")
    },
    shotUp(action = "hit", slot = 0) {
      return shotUp(slot, "touch")
    },
    // a finger aiming (phase "start" | "move"): pressed on their court, the ball goes where
    // the finger is; pressed anywhere else, dragging nudges the aim (right/left across, up
    // the screen deeper, down shorter)
    touchAim(phase, clientX, clientY, slot = 0) {
      const p = playing() ? humanBySlot(match, slot) : null
      if (!p) return
      if (phase === "start") {
        const at = farCourt(courtPoint(clientX, clientY), p)
        touchAimState = { mode: at ? "abs" : "rel", x0: clientX, y0: clientY }
        setAim(match, at, slot)
        return
      }
      const t = touchAimState
      if (phase === "end") {
        touchAimState = null
        return
      }
      if (!t) return
      if (t.mode === "abs") {
        const at = farCourt(courtPoint(clientX, clientY), p)
        if (at) setAim(match, at, slot)
      } else {
        const R = 70
        const dx = (clientX - t.x0) / R
        const dy = -(clientY - t.y0) / R
        setAim(match, null, slot, Math.hypot(dx, dy) > 0.12 ? screenNudge(p, dx, dy) : null)
      }
    },
    // Swipe controls (touchplay.js): a finger goes down on the hit side (the paddle comes
    // up), moves (the aim follows the swipe so far), and lifts: that's the swing, with the
    // swipe's direction, length and speed. `points` [{ x, y, t }] in screen px and ms.
    swipe(phase, points, slot = 0) {
      const p = match ? humanBySlot(match, slot) : null
      if (phase === "start") {
        swipeLive = null
        if (!playing()) return shotDown(slot, "swipe") // (between points: skip; a replay: end it)
        audio.unlock()
        if (!p) return false
        const serve = match.ball.held === p.id && match.phase === "serve"
        swipeLive = { pace: null, slot, serve }
        // (the rally: the paddle comes up now; a swing still finishing waits)
        if (!serve && !chargeKey[slot] && mPress(match, slot)) chargeKey[slot] = "swipe"
        return true
      }
      if (!swipeLive || swipeLive.slot !== slot || !p || !match) return false
      const sw = readSwipe(points, size)
      const target = sw.tap ? null : swipeTarget(sw, { team: p.team, flip: flip() })
      if (phase === "move") {
        swipeLive.pace = sw.tap ? null : sw.pace
        if (target) setAim(match, target, slot)
        return true
      }
      // the end: swing
      const live = swipeLive
      swipeLive = null
      if (phase === "cancel" || !playing()) {
        if (chargeKey[slot] === "swipe") chargeKey[slot] = null
        if (p.charge) p.charge = null
        return false
      }
      setAim(match, target, slot)
      if (live.serve) {
        if (match.ball.held !== p.id || match.phase !== "serve") return false
        const sv = swipeServe(sw)
        return mServe(match, { kind: "serve", variant: sv.grade === "early" ? "soft" : "drive", power: sv.power, grade: sv.grade, risky: !!sv.risky })
      }
      if (chargeKey[slot] !== "swipe") {
        // (the finger went down before the rally was on, or mid-swing: the paddle comes up now)
        if (chargeKey[slot] || !mPress(match, slot)) return false
      }
      chargeKey[slot] = null
      const ok = mRelease(match, slot, { pace: sw.pace, target })
      // (the shot has its target now; the live aim goes back to the default)
      setAim(match, null, slot)
      return ok
    },
    // HOOK (practice): put a practice layer on court (practice/layer.js), or null to take it
    // off; the engine calls layer.update(match, dt, figures) every frame (match is null
    // during the title's demo) and disposes the old one
    setLayer(next) {
      if (layer === next) return
      if (layer) {
        scene.remove(layer.group)
        layer.dispose()
      }
      layer = next || null
      if (layer) {
        scene.add(layer.group)
        warm()
      }
    },
    skipReplay() {
      endReplay()
    },
    cycleCamera,
    setMeterEl(el, slot = 0) {
      meterEls[slot] = el
    },
    // the character viewer: a look (or null to go back)
    showcase(look) {
      if (!look) {
        if (showcaseFig) {
          scene.remove(showcaseFig.fig.group)
          showcaseFig.fig.dispose()
          showcaseFig = null
        }
        for (const f of figures) f.fig.group.visible = true
        if (status === "showcase") setStatus("title")
        return
      }
      const at = { x: 0, z: HALF_L - 1 }
      const fig = makeFigure(look, { shadows: !!QUALITY[settings.quality]?.shadows })
      scene.add(fig.group)
      // (a new look on the same viewer keeps its pose and turn: no jump)
      const was = showcaseFig
      if (was) {
        scene.remove(was.fig.group)
        was.fig.dispose()
        showcaseFig = { ...was, fig, look }
      } else showcaseFig = { fig, look, anim: createAnim(at.x, at.z, 0), at, t: 2.2, swing: null, yaw: 0, pose: "ready" }
      for (const f of figures) if (Math.hypot(f.player.x - at.x, f.player.z - at.z) < 3) f.fig.group.visible = false
      warm()
      setStatus("showcase")
      start()
    },
    // the Locker Room's viewer: turn the figure (radians, added) and pick what it does
    showcaseTurn(delta) {
      if (showcaseFig) showcaseFig.yaw = Math.atan2(Math.sin((showcaseFig.yaw || 0) + delta), Math.cos((showcaseFig.yaw || 0) + delta))
    },
    showcasePose(pose) {
      if (showcaseFig && ["ready", "run", "still"].includes(pose)) showcaseFig.pose = pose
    },
    setVenue(id) {
      setVenue(id)
      hudKey = ""
    },
    setSettings(patch) {
      const quality = patch.quality && patch.quality !== settings.quality
      settings = { ...settings, ...patch }
      bindings = bindingsFor(settings.keys)
      audio.setEnabled(settings.sound)
      audio.setVoice(settings.voice)
      audio.setCrowd(settings.sound ? venue.def.crowd : 0)
      if (match) {
        match.assist = settings.assist
        match.window = settings.window
      }
      if (quality) {
        maxRatio = Math.min(dpr, QUALITY[settings.quality].ratio)
        resolution.setMax(maxRatio)
        pixelRatio = resolution.ratio
        renderer.setPixelRatio(pixelRatio)
        renderer.setSize(size.width, size.height, false)
        renderer.shadowMap.enabled = QUALITY[settings.quality].shadows
        const id = venueId
        venueId = null
        setVenue(id)
        if (match) buildFigures()
        refigure()
        wantAthletes()
        scene.traverse((o) => {
          if (o.material) [].concat(o.material).forEach((mm) => (mm.needsUpdate = true))
        })
      }
    },
    get status() {
      return status
    },
    get mode() {
      return mode
    },
    // resolves once the shaders being compiled are ready (the loading screen waits for it)
    get ready() {
      return whenWarm()
    },
    dispose() {
      disposed = true
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      resizeObserver.disconnect()
      container.removeEventListener("keydown", onKeyDown)
      container.removeEventListener("keyup", onKeyUp)
      container.removeEventListener("pointerdown", onPointerDown)
      canvas.removeEventListener("pointermove", onPointerMove)
      canvas.removeEventListener("pointerup", onPointerUp)
      canvas.removeEventListener("pointercancel", onPointerUp)
      container.removeEventListener("contextmenu", onContextMenu)
      container.removeEventListener("focusout", onBlur)
      document.removeEventListener("visibilitychange", onVisibility)
      window.removeEventListener("gamepadconnected", onPadConnected)
      canvas.removeEventListener("webglcontextlost", onContextLost)
      canvas.removeEventListener("webglcontextrestored", onContextRestored)
      audio.dispose()
      clearFigures()
      umpire?.dispose()
      showcaseFig?.fig.dispose()
      layer?.dispose()
      venue.dispose()
      scene.traverse((o) => {
        o.geometry?.dispose()
        if (o.material) [].concat(o.material).forEach((m) => m.dispose())
      })
      Object.values(markMat).forEach((m) => m.dispose())
      contactGeo.dispose()
      contactMat.dispose()
      Object.values(tex).forEach((t) => t.dispose())
      renderer.dispose()
      renderer.forceContextLoss() // give the GPU context back now, not whenever GC runs
      if (window.__pickleball?.api === api) delete window.__pickleball
    },
  }

  // the demo match behind the title screen
  startLocal(demoOptions(), true)

  // test hook (dev server only): the match, autoplay with real timing for your player, rally
  // setups, a fast-forward, stats
  if (import.meta.env.DEV) {
    window.__pickleball = {
      api,
      renderer,
      perf,
      log: devLog,
      get match() {
        return match
      },
      get mode() {
        return mode
      },
      get figures() {
        return figures
      },
      get replay() {
        return !!replay
      },
      get pixelRatio() {
        return pixelRatio
      },
      get info() {
        const r = renderer.info.render
        return { verts: figures.map((f) => f.fig.vertices), calls: r.calls, triangles: r.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, programs: renderer.info.programs?.length }
      },
      get camera() {
        return { x: camera.position.x, y: camera.position.y, z: camera.position.z, fov: camera.fov }
      },
      // (pb7 tests) what's drawn: the ball (hidden? in whose hand, and where that hand is),
      // the swing trails, the aim arc, the camera's view (a body in front of the lens?)
      get view() {
        const holder = ballView?.held ? figures.find((f) => f.player.id === ballView.held) : null
        const look = new THREE.Vector3()
        camera.getWorldDirection(look)
        const cam = { x: camera.position.x, y: camera.position.y, z: camera.position.z }
        const at = { x: cam.x + look.x * 10, y: cam.y + look.y * 10, z: cam.z + look.z * 10 }
        const bodies = figures.map((f) => ({ x: f.player.x, z: f.player.z, id: f.player.id }))
        return {
          ball: ballView && { ...ballView, visible: ballMesh.visible },
          hand: holder?.hand || null,
          phase: ballView?.phase ?? match?.phase,
          trails: swingTrails.map((t) => ({ shown: t.shown, visible: t.mesh.visible })),
          arc: aimArc.visible,
          aim: aimRing.visible ? { x: aimRing.position.x, z: aimRing.position.z } : null,
          cut: !!cutShot,
          camBlocked,
          blocker: blocker(cam, at, bodies)?.id || null,
        }
      },
      // a stand-in plays for this computer's people with real button timing, aim and holds
      // (deciding its shots like a computer player of `level`)
      autoplay(on, slot = 0, jitter, level = "pro") {
        if (on) devAuto.add(slot)
        else devAuto.delete(slot)
        if (jitter !== undefined) devJitter = { jitter, level: LEVELS[level] || LEVELS.pro }
      },
      scenario(kind) {
        if (!match) return
        scenario(match, kind)
        match.events.length = 0
        // (a set-up rally: no TV cut or replay from the last point stays on screen)
        cut = null
        if (replay) endReplay()
      },
      fast(seconds) {
        // run the simulation ahead without drawing (tests)
        const n = Math.round(seconds / STEP)
        for (let i = 0; i < n && status === "playing"; i++) {
          if (devAuto.size) for (const slot of devAuto) autopilot(match, slot, devJitter)
          step(match, STEP)
          if (host) host.capture(match.events)
          if (match.events.length) handleEvents()
          if (replay) endReplay()
        }
      },
      replayNow() {
        startReplay()
      },
      // a still lineup of figures in one animation state, for look tests (studio.js)
      async studio(opts) {
        const { studioShot } = await import("./studio.js")
        studioHold = true
        for (const f of figures) f.fig.group.visible = false
        if (showcaseFig) showcaseFig.fig.group.visible = false
        return studioShot({ scene, camera, renderer, size, makeFigure, shadows: !!QUALITY[settings.quality]?.shadows }, opts)
      },
      get athletes() {
        return {
          ready: athletesReady(),
          skinned: skinned(),
          load: () => loadAthletes().then(() => refigure()),
          simple(on) {
            simpleOnly = !!on
            refigure()
          },
        }
      },
    }
  }

  return api
}
