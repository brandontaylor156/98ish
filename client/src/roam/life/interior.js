// Roam life: an interior you walk round (your office, your home, the warehouse club, the mall).
// It speaks the same engine-world interface as the town (world.js: scene, camera, frame, resize,
// key, setStick, drag, clearKeys, refigure, dispose, action) and the same few calls the life
// plug-ins use (meNow, peopleNow, net, myNum, camYaw, use), so emotes, hugs, holding hands, eating
// and drinking work inside exactly as outside.
//
// Where it is: the room's SLOT far out in the town's frame (server/roam/inside.js), so your
// position goes up through the town's ordinary roam:pos and friends in the same room see you
// walking about; nobody in the town sees you (that far out, and roam:in says you're inside).
// The town's world hands over its connection (town.net) and its people (town.remotesAll), and
// passes the network on to this world while you're in here (town.use({ netEvent })).
//
//   createInterior({ town, host, room: { kind, origin, seed, label, room }, layout, phone,
//     labelsEl, onHud, onEvent })
// Events out: exit, desk, tv, clock, coffee, fridge, shop { store, aisle }, checkout, claw,
// sample { item }, chat { name, line }, cart { on }, toast.

import * as THREE from "three"
import { buildInterior } from "./build.js"
import { createColliders } from "../sim/collide.js"
import { createWalker, stepWalker } from "../sim/walker.js"
import { ACT, DELAY, createTrack, packPos, pushSample, sampleTrack, shouldSend, unpackPos } from "../sim/sync.js"

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a))

export const createInterior = ({ town, host = {}, room, layout: L, phone = false, labelsEl = null, onHud = () => {}, onEvent = () => {} }) => {
  const O = room.origin // the room's (0, 0) in the town's frame
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(L.ceiling || "#f4f4f2")
  const camera = new THREE.PerspectiveCamera(phone ? 66 : 60, 1, 0.1, 160)
  const hemi = new THREE.HemisphereLight(0xfff8ee, 0x8a8478, L.bright ? 2.6 : 2.3)
  const key = new THREE.DirectionalLight(0xfff2e0, 0.9)
  key.position.set(O.x - 0.3 * L.W, L.H * 3, O.z - 0.2 * L.D)
  key.target.position.set(O.x, 0, O.z)
  scene.add(hemi, key, key.target)
  const built = buildInterior(L, { origin: O })
  scene.add(built.group)
  const colliders = createColliders()
  colliders.addEdges("room", built.segs, 10)
  const resolve = (x, z, r) => colliders.resolve(x, z, r)
  const at = (p) => ({ x: p.x + O.x, z: p.z + O.z })

  // the TV's picture (a plane in front of the screen box, shown when it's on)
  const tvSpot = L.spots.find((s) => s.kind === "tv")
  const tvBox = tvSpot ? L.boxes.filter((b) => b.glow && b.h >= 1).sort((a, b) => Math.hypot(a.x - tvSpot.x, a.z - tvSpot.z) - Math.hypot(b.x - tvSpot.x, b.z - tvSpot.z))[0] : null
  let tv = null
  if (tvBox && typeof document !== "undefined") {
    const cv = document.createElement("canvas")
    cv.width = 512
    cv.height = 288
    const tex = new THREE.CanvasTexture(cv)
    tex.colorSpace = THREE.SRGBColorSpace
    const w = Math.max(tvBox.w, tvBox.d) * 0.94
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, tvBox.h * 0.9), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }))
    const toward = { x: tvSpot.x - tvBox.x, z: tvSpot.z - tvBox.z }
    const n = Math.hypot(toward.x, toward.z) || 1
    plane.position.set(O.x + tvBox.x + (toward.x / n) * (Math.min(tvBox.w, tvBox.d) / 2 + 0.01), (tvBox.y || 0) + tvBox.h / 2, O.z + tvBox.z + (toward.z / n) * (Math.min(tvBox.w, tvBox.d) / 2 + 0.01))
    plane.rotation.y = Math.atan2(toward.x, toward.z)
    plane.visible = false
    scene.add(plane)
    const draw = (title, sub, bg) => {
      const g = cv.getContext("2d")
      const grd = g.createLinearGradient(0, 0, 512, 288)
      grd.addColorStop(0, bg[0])
      grd.addColorStop(1, bg[1])
      g.fillStyle = grd
      g.fillRect(0, 0, 512, 288)
      g.fillStyle = "#ffffff"
      g.font = "700 40px system-ui, sans-serif"
      g.textAlign = "center"
      g.fillText(title, 256, 130)
      g.font = "24px system-ui, sans-serif"
      g.fillText(sub, 256, 180)
      tex.needsUpdate = true
    }
    tv = { plane, draw, on: false, slide: 0 }
  }
  const SLIDES = [["Q3 Roadmap", "Ship it, then celebrate", ["#23395d", "#2f6fd6"]], ["Wins this week", "Inbox zero x4 · build is green", ["#2a9d8f", "#23395d"]], ["Lunch & learn", "Thursday · tacos provided", ["#ef476f", "#9d4edd"]]]
  const setTv = (on, { title = null, sub = "" } = {}) => {
    if (!tv) return
    tv.on = !!on
    tv.plane.visible = tv.on
    if (!on) return
    if (title) tv.draw(title, sub, ["#111827", "#2f6fd6"])
    else {
      const s = SLIDES[tv.slide++ % SLIDES.length]
      tv.draw(s[0], s[1], s[2])
    }
  }

  // ---- you ----
  const sp = at(L.spawn)
  const me = { name: host.me?.name || "You", look: host.me?.look || null, walker: createWalker(sp.x, sp.z, L.spawn.yaw) }
  const input = { x: 0, y: 0, sprint: false }
  const keys = new Set()
  const cam = { yaw: L.spawn.yaw, pitch: 0.28, dist: phone ? 3.3 : 3.0 }
  let size = { width: 1, height: 1 }
  let seat = null // the seat you're on
  let disposed = false
  let clock = 0
  const plugins = new Set()

  // ---- figures ----
  const figs = new Map()
  const figFor = (k, look, opts) => {
    const f = figs.get(k)
    if (f) return f.fig
    const fig = host.figure?.(look || {}, opts)
    if (!fig) return null
    scene.add(fig.group)
    figs.set(k, { fig })
    return fig
  }
  const dropFig = (k) => {
    const f = figs.get(k)
    if (!f) return
    f.fig.dispose()
    figs.delete(k)
  }
  // the people who work or shop here (original names; standing or at their desks)
  const npcs = L.npcs.map((n) => ({ ...n, wx: n.x + O.x, wz: n.z + O.z, look: host.npcLook?.(`${L.kind}:${n.name}`) || null, line: 0 }))
  const NPC_R = phone ? 14 : 24
  const NPC_MAX = phone ? 4 : 8

  // ---- the cart (Big Crate 98): rolls in front of you and turns with you ----
  let cart = null
  const cartMesh = () => {
    const g = new THREE.Group()
    const m = new THREE.MeshLambertMaterial({ color: 0xb8bcc2 })
    const red = new THREE.MeshLambertMaterial({ color: 0xc8102e })
    const basket = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.42, 0.95), m)
    basket.position.y = 0.72
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.05, 0.05), red)
    handle.position.set(0, 1.0, -0.5)
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.85), m)
    base.position.y = 0.18
    g.add(basket, handle, base)
    for (const [x, z] of [[-0.22, -0.36], [0.22, -0.36], [-0.22, 0.36], [0.22, 0.36]]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 10), red)
      w.rotation.z = Math.PI / 2
      w.position.set(x, 0.06, z)
      g.add(w)
    }
    // what's in it (a few boxes that show as you fill it)
    const goods = new THREE.Group()
    goods.position.y = 0.6
    g.add(goods)
    g.userData.goods = goods
    g.userData.dispose = () => g.traverse((o) => (o.geometry?.dispose(), o.material?.dispose?.()))
    return g
  }
  const remoteCarts = new Map()
  const setCartGoods = (g, n) => {
    const goods = g.userData.goods
    while (goods.children.length > Math.min(n, 9)) {
      const c = goods.children.pop()
      c.geometry.dispose()
      c.material.dispose()
    }
    const colors = [0xc49a6c, 0x2f6fd6, 0xef476f, 0xffd166, 0x7fe0bf, 0xd4b48c, 0x9d4edd, 0xff8a1f, 0xe8e2d4]
    while (goods.children.length < Math.min(n, 9)) {
      const i = goods.children.length
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.18 + (i % 3) * 0.05, 0.26), new THREE.MeshLambertMaterial({ color: colors[i % colors.length] }))
      b.position.set(((i % 2) - 0.5) * 0.26, Math.floor(i / 4) * 0.2 + 0.1, ((Math.floor(i / 2) % 3) - 1) * 0.28)
      goods.add(b)
    }
  }
  const grabCart = (on) => {
    if (on && !cart) {
      cart = { mesh: cartMesh(), x: me.walker.x, z: me.walker.z, yaw: me.walker.yaw }
      scene.add(cart.mesh)
    } else if (!on && cart) {
      cart.mesh.removeFromParent()
      cart.mesh.userData.dispose()
      cart = null
    }
    world.net?.request?.("roam:say", { kind: "cart", data: { grab: !!cart } }).catch?.(() => {})
    onEvent({ type: "cart", on: !!cart })
  }

  // ---- other people in here (online) ----
  const remotes = new Map() // num -> { num, name, look, track, x, z, yaw, speed }
  const netClock = { offset: null }
  const inRoom = (x, z) => Math.abs(x - O.x) < L.W / 2 + 4 && Math.abs(z - O.z) < L.D / 2 + 4
  const syncPeople = () => {
    for (const p of town?.remotesAll?.() || []) {
      if (p.inside !== room.room) continue
      if (!remotes.has(p.num)) remotes.set(p.num, { num: p.num, name: p.name, look: p.look, track: createTrack(), x: O.x, z: O.z, yaw: 0, speed: 0, seen: false })
    }
    for (const num of [...remotes.keys()]) {
      const p = (town?.remotesAll?.() || []).find((q) => q.num === num)
      if (!p || p.inside !== room.room) {
        remotes.delete(num)
        dropFig(`r${num}`)
        const rc = remoteCarts.get(num)
        if (rc) {
          rc.removeFromParent()
          rc.userData.dispose()
          remoteCarts.delete(num)
        }
      }
    }
  }
  let lastSent = null
  const sendPos = () => {
    const net = town?.net
    if (!net?.volatile) return
    const w = me.walker
    const p = { x: w.x, z: w.z, y: 0, yaw: w.yaw, speed: w.speed, act: w.speed > 0.1 ? ACT.move : 0 }
    const now = performance.now() / 1000
    if (!shouldSend(lastSent, p, now, false)) return
    lastSent = { t: now, p }
    net.volatile("roam:pos", packPos(p))
  }
  const netPlugin = {
    netEvent(type, d) {
      if (disposed) return
      if (type === "roam:m" && d && Array.isArray(d.m)) {
        const now = performance.now() / 1000
        const off = d.t / 1000 - now
        netClock.offset = netClock.offset === null ? off : Math.max(off, netClock.offset - 0.002)
        for (const row of d.m) {
          const r = remotes.get(row?.[0])
          const p = unpackPos(row?.slice?.(1))
          if (r && p && inRoom(p.x, p.z)) pushSample(r.track, d.t / 1000, p)
        }
      } else if (type === "roam:in" || type === "roam:person" || type === "roam:gone") syncPeople()
      else if (type === "roam:say" && d) {
        if (d.kind === "cart" && typeof d.data?.grab === "boolean") {
          let rc = remoteCarts.get(d.from)
          if (d.data.grab && !rc) {
            rc = cartMesh()
            scene.add(rc)
            remoteCarts.set(d.from, rc)
          } else if (!d.data.grab && rc) {
            rc.removeFromParent()
            rc.userData.dispose()
            remoteCarts.delete(d.from)
          }
        }
        if (d.kind === "tv") setTv(!!d.data?.on, d.data?.title ? { title: String(d.data.title).slice(0, 40), sub: String(d.data.sub || "").slice(0, 60) } : {})
      }
      for (const p of plugins) p.netEvent?.(type, d)
    },
  }
  const offTown = town?.use?.(netPlugin) || (() => {})
  syncPeople()

  // ---- what you can do here: the nearest thing within reach ----
  const near = () => {
    const w = me.walker
    const lx = w.x - O.x
    const lz = w.z - O.z
    const out = []
    if (seat) {
      out.push({ kind: "stand", label: "Stand up", d: 0 })
      return out
    }
    for (const p of plugins) {
      const a = p.action?.(w)
      if (a) out.push({ kind: "plug", label: a.label, run: a.run, d: -1 })
    }
    if (Math.hypot(lx - L.exit.x, lz - L.exit.z) < L.exit.r + 0.6) out.push({ kind: "exit", label: L.kind === "home" || L.kind === "office" ? "Go outside" : "Leave the store", d: 0 })
    for (const s of L.spots) {
      const d = Math.hypot(lx - s.x, lz - s.z)
      if (d > s.r) continue
      let label = s.label
      if (s.kind === "clock") label = clockIn ? "Clock out" : "Clock in"
      if (s.kind === "tv") label = tv?.on ? (L.kind === "home" ? "Turn off the TV" : "Turn off the TV") : s.label
      if (s.kind === "cart") label = cart ? "Put the cart back" : "Grab a cart"
      out.push({ kind: "spot", spot: s, label, d })
    }
    for (const s of L.seats) {
      const d = Math.hypot(lx - s.x, lz - s.z)
      if (d < 1.0 && !npcs.some((n) => n.takes === s.id)) out.push({ kind: "seat", seat: s, label: s.label, d: d + 0.5 })
    }
    for (const n of npcs) {
      const d = Math.hypot(w.x - n.wx, w.z - n.wz)
      if (d < 2.2) out.push({ kind: "npc", npc: n, label: `Chat with ${n.name}`, d: d + 0.8 })
    }
    return out.sort((a, b) => a.d - b.d).slice(0, 2)
  }
  let clockIn = null // when you clocked in (seconds of this visit)
  let worked = 0
  const sitOn = (s) => {
    const p = at(s)
    me.walker.x = p.x
    me.walker.z = p.z
    me.walker.yaw = s.yaw
    me.walker.vx = me.walker.vz = 0
    seat = s
    social?.sitAt({ x: p.x, z: p.z, y: 0, yaw: s.yaw, h: s.h || 0.45 })
  }
  let social = null
  const doAction = (which = 0) => {
    const a = near()[which]
    if (!a) return
    if (a.kind === "plug") return a.run?.()
    if (a.kind === "stand") {
      seat = null
      social?.standUp()
      return
    }
    if (a.kind === "exit") return onEvent({ type: "exit" })
    if (a.kind === "seat") return sitOn(a.seat)
    if (a.kind === "npc") {
      const n = a.npc
      const line = n.lines[n.line++ % n.lines.length]
      return onEvent({ type: "chat", name: n.name, line })
    }
    const s = a.spot
    if (s.kind === "desk") {
      const st = L.seats.find((q) => q.id === s.seat)
      if (st) sitOn(st)
      return onEvent({ type: "desk" })
    }
    if (s.kind === "clock") {
      if (clockIn === null) {
        clockIn = clock
        onEvent({ type: "clock", on: true })
      } else {
        const secs = Math.round(clock - clockIn)
        worked += secs
        clockIn = null
        onEvent({ type: "clock", on: false, secs })
      }
      return
    }
    if (s.kind === "tv") {
      const on = !tv?.on
      if (L.kind === "home") {
        setTv(on, { title: "Watch Together", sub: "Pick a video in 98 Messenger" })
        world.net?.request?.("roam:say", { kind: "tv", data: { on, title: "Watch Together", sub: "Pick a video in 98 Messenger" } }).catch?.(() => {})
      } else {
        setTv(on)
        world.net?.request?.("roam:say", { kind: "tv", data: { on } }).catch?.(() => {})
      }
      return onEvent({ type: "tv", on })
    }
    if (s.kind === "cart") return grabCart(!cart)
    if (s.kind === "coffee") return onEvent({ type: "hold", item: L.kind === "home" ? "coffee" : "coffee", free: true })
    if (s.kind === "fridge") return onEvent({ type: "hold", item: "sparkling", free: true })
    if (s.kind === "sample") return onEvent({ type: "hold", item: s.item, free: true, sample: true })
    if (s.kind === "aisle") return onEvent({ type: "shop", store: "club", aisle: s.aisle })
    if (s.kind === "foodcourt") return onEvent({ type: "shop", store: "food" })
    if (s.kind === "shop") return onEvent({ type: "shop", store: s.shop })
    if (s.kind === "checkout") return onEvent({ type: "checkout" })
    if (s.kind === "claw") return onEvent({ type: "claw" })
  }

  // ---- the camera: behind you, pulled in by walls, under the ceiling ----
  const camPos = new THREE.Vector3()
  const look = new THREE.Vector3()
  let camInit = false
  const updateCamera = (dt) => {
    const w = me.walker
    const portrait = size.height > size.width * 1.05
    const dist = cam.dist + (portrait ? 0.4 : 0)
    const head = seat ? 1.15 : 1.5
    const lx = w.x
    const lz = w.z
    let bx = lx - Math.sin(cam.yaw) * dist * Math.cos(cam.pitch)
    let bz = lz - Math.cos(cam.yaw) * dist * Math.cos(cam.pitch)
    const k = colliders.segment(lx, lz, bx, bz, -1)
    if (k < 1) {
      const kk = Math.max(0.15, k - 0.12)
      bx = lx + (bx - lx) * kk
      bz = lz + (bz - lz) * kk
    }
    const by = Math.min(L.H - 0.2, head + 0.35 + dist * Math.sin(cam.pitch))
    if (!camInit) {
      camPos.set(bx, by, bz)
      camInit = true
    } else camPos.lerp(new THREE.Vector3(bx, by, bz), Math.min(1, dt * 8))
    camera.position.copy(camPos)
    look.set(lx + Math.sin(cam.yaw) * 0.8, head, lz + Math.cos(cam.yaw) * 0.8)
    camera.lookAt(look)
  }

  // ---- labels (names over people online) ----
  const labelPool = []
  const proj = new THREE.Vector3()
  const updateLabels = () => {
    if (!labelsEl) return
    let i = 0
    for (const r of remotes.values()) {
      proj.set(r.x, 2.1, r.z).project(camera)
      if (proj.z > 1 || Math.abs(proj.x) > 1.1 || Math.abs(proj.y) > 1.1) continue
      let el = labelPool[i]
      if (!el) {
        el = document.createElement("div")
        el.className = "roamLabel"
        labelsEl.appendChild(el)
        labelPool[i] = el
      }
      if (el.textContent !== r.name) el.textContent = r.name
      el.style.display = ""
      el.style.transform = `translate(${((proj.x + 1) / 2) * size.width}px, ${((1 - proj.y) / 2) * size.height}px) translate(-50%, -100%)`
      i++
    }
    for (; i < labelPool.length; i++) labelPool[i].style.display = "none"
  }

  // ---- the HUD ----
  let hudT = 0
  let lastHud = ""
  const sendHud = (force = false) => {
    const acts = near()
    const hud = {
      mode: "walk",
      inside: { kind: L.kind, name: room.label || L.name },
      street: room.label || L.name,
      action: acts[0] ? { kind: acts[0].kind, label: acts[0].label } : null,
      action2: acts[1] ? { kind: acts[1].kind, label: acts[1].label } : null,
      clock: clockIn !== null ? Math.floor(clock - clockIn) : null,
      worked,
      cart: !!cart,
      seated: !!seat,
      people: remotes.size + 1,
    }
    const s = JSON.stringify(hud)
    if (!force && s === lastHud) return
    lastHud = s
    onHud(hud)
  }

  let npcT = 0
  const step = (dtIn) => {
    if (disposed) return
    const dt = Math.min(0.1, dtIn)
    clock += dt
    const kx = (keys.has("ArrowRight") || keys.has("KeyD") ? 1 : 0) - (keys.has("ArrowLeft") || keys.has("KeyA") ? 1 : 0)
    const ky = (keys.has("ArrowUp") || keys.has("KeyW") ? 1 : 0) - (keys.has("ArrowDown") || keys.has("KeyS") ? 1 : 0)
    let mv = { x: input.x + kx * 0.85, y: input.y + ky * 0.85, sprint: false }
    if (seat && Math.hypot(mv.x, mv.y) > 0.3) {
      seat = null
      social?.standUp()
    }
    for (const p of plugins) {
      const o = p.input?.(mv, dt, cam.yaw)
      if (o) mv = o
    }
    if (!seat) {
      // (indoors: no running, a brisk walk at most)
      const m = Math.hypot(mv.x, mv.y)
      if (m > 0.72) mv = { ...mv, x: (mv.x / m) * 0.72, y: (mv.y / m) * 0.72 }
      stepWalker(me.walker, mv, cam.yaw, dt, { resolve })
      if (Number.isFinite(mv.face)) me.walker.yaw = mv.face
    }
    me.walker.y = 0
    // others online
    const t = netClock.offset === null ? null : performance.now() / 1000 + netClock.offset - DELAY
    for (const r of remotes.values()) {
      const p = t !== null ? sampleTrack(r.track, t) : null
      if (p && inRoom(p.x, p.z)) Object.assign(r, { x: p.x, z: p.z, yaw: p.yaw, speed: p.speed, seen: true })
    }
    for (const p of plugins) p.step?.(dt)
    // the cart rolls along in front of you (it turns with you, never through a wall)
    if (cart) {
      const w = me.walker
      const tx = w.x + Math.sin(w.yaw) * 1.05
      const tz = w.z + Math.cos(w.yaw) * 1.05
      const k = Math.min(1, dt * 10)
      cart.x += (tx - cart.x) * k
      cart.z += (tz - cart.z) * k
      cart.yaw += wrap(w.yaw - cart.yaw) * k
      const c = resolve(cart.x, cart.z, 0.4)
      cart.x = c.x
      cart.z = c.z
      cart.mesh.position.set(cart.x, 0, cart.z)
      cart.mesh.rotation.y = cart.yaw
    }
    for (const [num, rc] of remoteCarts) {
      const r = remotes.get(num)
      if (!r) continue
      rc.position.set(r.x + Math.sin(r.yaw) * 1.05, 0, r.z + Math.cos(r.yaw) * 1.05)
      rc.rotation.y = r.yaw
    }
    // figures: you, the people online, the people who work here (the nearest few)
    const fig = figFor("me", me.look)
    if (fig) {
      for (const p of plugins) p.figure?.("me", fig, dt)
      fig.update({ x: me.walker.x, y: 0, z: me.walker.z, yaw: me.walker.yaw, vx: me.walker.vx, vz: me.walker.vz, speed: me.walker.speed }, dt)
    }
    for (const r of remotes.values()) {
      if (!r.seen) continue
      const f = figFor(`r${r.num}`, r.look)
      if (!f) continue
      for (const p of plugins) p.figure?.(r.num, f, dt)
      f.update({ x: r.x, y: 0, z: r.z, yaw: r.yaw, vx: Math.sin(r.yaw) * r.speed, vz: Math.cos(r.yaw) * r.speed, speed: r.speed }, dt)
    }
    npcT += dt
    if (!phone || npcT > 1 / 30) {
      const w = me.walker
      const shown = npcs
        .map((n) => ({ n, d: Math.hypot(n.wx - w.x, n.wz - w.z) }))
        .filter((q) => q.d < NPC_R)
        .sort((a, b) => a.d - b.d)
        .slice(0, NPC_MAX)
      const keep = new Set(shown.map((q) => q.n.id))
      for (const n of npcs) if (!keep.has(n.id)) dropFig(`n${n.id}`)
      for (const { n } of shown) {
        const f = figFor(`n${n.id}`, n.look, { lite: true })
        if (!f) continue
        if (n.seat) f.setSeat?.({ x: n.wx, y: 0, z: n.wz, yaw: n.yaw, h: n.seat.h })
        // (they turn to you when you're close)
        const d = Math.hypot(w.x - n.wx, w.z - n.wz)
        const yaw = !n.seat && d < 3 ? Math.atan2(w.x - n.wx, w.z - n.wz) : n.yaw
        f.update({ x: n.wx, y: 0, z: n.wz, yaw, vx: 0, vz: 0, speed: 0 }, npcT)
      }
      npcT = 0
    }
    updateCamera(dt)
    updateLabels()
    sendPos()
    hudT += dt
    if (hudT > 0.15) {
      hudT = 0
      sendHud(false)
    }
  }

  const world = {
    scene,
    camera,
    town: town?.town,
    phone,
    room,
    layout: L,
    frame: step,
    exposure: 1,
    toneMapping: THREE.ACESFilmicToneMapping,
    mode: "walk",
    resize(width, height) {
      size = { width: Math.max(1, width), height: Math.max(1, height) }
      camera.aspect = size.width / size.height
      camera.updateProjectionMatrix()
    },
    setStick(x, y) {
      input.x = x
      input.y = y
    },
    setSprint() {},
    setDrive() {},
    key(code, down) {
      if (down) {
        if (code === "Enter" || code === "KeyF" || code === "KeyE") return doAction(0)
        keys.add(code)
      } else keys.delete(code)
      return ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyW", "KeyA", "KeyS", "KeyD"].includes(code)
    },
    clearKeys() {
      keys.clear()
      input.x = input.y = 0
    },
    drag(dx, dy = 0) {
      cam.yaw -= dx * 0.008
      cam.pitch = Math.max(0.05, Math.min(0.7, cam.pitch + dy * 0.004))
    },
    action: (which = 0) => {
      doAction(which)
      sendHud(true)
    },
    refigure() {
      for (const k of [...figs.keys()]) dropFig(k)
    },
    // ---- what the life plug-ins see (the same calls as the town) ----
    use(p) {
      plugins.add(p)
      return () => plugins.delete(p)
    },
    setSocial(s) {
      social = s
    },
    get net() {
      return town?.net || null
    },
    get myNum() {
      return town?.myNum ?? null
    },
    get camYaw() {
      return cam.yaw
    },
    meNow() {
      const w = me.walker
      return { num: town?.myNum ?? null, name: me.name, x: w.x, y: 0, z: w.z, yaw: w.yaw, speed: w.speed }
    },
    peopleNow() {
      return [...remotes.values()].filter((r) => r.seen).map((r) => ({ num: r.num, name: r.name, x: r.x, y: 0, z: r.z, yaw: r.yaw, speed: r.speed }))
    },
    teleport(x, z, yaw = me.walker.yaw) {
      me.walker.x = x
      me.walker.z = z
      me.walker.yaw = yaw
      me.walker.vx = me.walker.vz = 0
    },
    // (tests and the page)
    get info() {
      const w = me.walker
      return { me: { x: w.x, z: w.z, yaw: w.yaw, lx: w.x - O.x, lz: w.z - O.z, speed: w.speed }, seat: seat?.id || null, cart: !!cart, clockIn: clockIn !== null, worked, tv: !!tv?.on, people: [...remotes.values()].map((r) => ({ num: r.num, name: r.name, x: r.x - O.x, z: r.z - O.z, seen: r.seen })), near: near().map((a) => a.label), npcs: npcs.length, draws: built.draws, figs: figs.size }
    },
    // walk straight to a spot inside (tests: the scripted thumb)
    local: (x, z) => ({ x: x + O.x, z: z + O.z }),
    cartGoods: (n) => cart && setCartGoods(cart.mesh, n),
    setCart: (on) => grabCart(on),
    clockOut() {
      if (clockIn === null) return 0
      const secs = Math.round(clock - clockIn)
      worked += secs
      clockIn = null
      return secs
    },
    get clockedIn() {
      return clockIn !== null
    },
    whenReady: async () => {},
    dispose() {
      disposed = true
      offTown()
      if (cart) grabCart(false)
      for (const rc of remoteCarts.values()) rc.userData.dispose()
      for (const k of [...figs.keys()]) dropFig(k)
      built.dispose()
      tv?.plane.geometry.dispose()
      tv?.plane.material.map?.dispose()
      tv?.plane.material.dispose()
      for (const el of labelPool) el.remove()
    },
  }
  sendHud(true)
  return world
}
