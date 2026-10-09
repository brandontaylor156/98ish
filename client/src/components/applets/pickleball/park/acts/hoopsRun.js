// My Park > Shoot hoops, in the park (three.js): the game (hoops.js) on a venue's basketball
// court (OSM's, or Los Cab's indoor gym), the ball, the nets, the spots to shoot from, you
// (walking with the move pad, shooting with a swipe) and the computer or your friend.
//
//   createHoopsRun({ spot, mode: "free" | "world" | "horse", link, opp, level })
//
// With a friend (H-O-R-S-E, link: acts/useActivities.jsx): whoever's shooting sends where
// they're standing (a few times a second while they walk), the shot's launch (both screens
// fly the same ball: hoops.js is deterministic) and how it came out. Nothing else.

import * as THREE from "three"
import { BALL, DT, HOOP_KINDS, RELEASE_Y, SWEET, cpuSpot, cpuSpread, createHoopsGame, hoopAt, rng, stepBall, swipeShot } from "./hoops.js"
import { NAMES, parkLook } from "../regulars.js"
import { sfx } from "./sound.js"

const WALK = 4.2
const SHOOT_S = 0.78 // the shot's motion; the ball leaves the hands at 55% of it
const RELEASE_AT = 0.55
const SPOT_MS = 400 // (the relay takes up to 4 messages a second: server/arcade/rooms.js)

let ballTex = null
const ballTexture = () => {
  if (ballTex || typeof document === "undefined") return ballTex
  const c = document.createElement("canvas")
  c.width = 128
  c.height = 64
  const g = c.getContext("2d")
  g.fillStyle = "#d9692a"
  g.fillRect(0, 0, 128, 64)
  g.strokeStyle = "#2a1408"
  g.lineWidth = 2.5
  for (const x of [32, 64, 96]) {
    g.beginPath()
    g.moveTo(x, 0)
    g.bezierCurveTo(x + (x === 64 ? 0 : x < 64 ? -14 : 14), 22, x + (x === 64 ? 0 : x < 64 ? -14 : 14), 42, x, 64)
    g.stroke()
  }
  g.beginPath()
  g.moveTo(0, 32)
  g.lineTo(128, 32)
  g.stroke()
  ballTex = new THREE.CanvasTexture(c)
  ballTex.colorSpace = THREE.SRGBColorSpace
  return ballTex
}

export const createHoopsRun = ({ spot, mode = "free", link = null, opp = null, level = "normal", seed = (Math.random() * 1e9) | 0 } = {}) => {
  const frame = spot.frame
  const s = Math.sin(frame.rot)
  const c = Math.cos(frame.rot)
  const W = (x, z) => ({ x: frame.x + x * c + z * s, z: frame.z - x * s + z * c })
  const L = (x, z) => {
    const dx = x - frame.x
    const dz = z - frame.z
    return { x: dx * c - dz * s, z: dx * s + dz * c }
  }
  const kind = spot.indoor ? HOOP_KINDS.gym : HOOP_KINDS.court
  const hoops = { 1: hoopAt(1, kind), "-1": hoopAt(-1, kind) }
  const rand = rng(seed)
  const myIdx = link ? link.team : 0
  const online = !!link
  // who plays: you, and the computer or your friend (H-O-R-S-E)
  const vsName = opp?.name || null
  const names = mode === "horse" ? (myIdx === 0 ? ["You", vsName || "Them"] : [vsName || "Them", "You"]) : ["You"]
  // your end: the one nearer where you walked up
  const start = L(spot.x, spot.z)
  const end = start.z >= 0 ? 1 : -1
  let hoop = hoops[end]
  const game = createHoopsGame({ mode, players: names.map((n, i) => ({ name: n, cpu: mode === "horse" && !online && i !== myIdx })), hoop, seed })
  const st = game.state
  // you and the other shooter, in the court's frame
  const clampIn = (p) => {
    p.x = Math.max(-8.5, Math.min(8.5, p.x))
    p.z = Math.max(-14.8, Math.min(14.8, p.z))
  }
  // (on the court where you walked up, else its free-throw line)
  const onCourt = Math.abs(start.x) < 7.5 && Math.abs(start.z) < 14
  const me = { x: onCourt ? start.x : 0, z: onCourt ? start.z : end * (12.4 - 4.6), vx: 0, vz: 0 }
  clampIn(me)
  const other = { x: me.x + 2.2, z: me.z - end * 1.2, vx: 0, vz: 0, goal: null, wait: 0 }
  let api = null
  let group = null
  let ballMesh = null
  let shadow = null
  let nets = []
  let rings = []
  let otherBody = null
  let stick = { x: 0, y: 0 }
  let listeners = new Set()
  let lastHud = ""
  let hudT = 0
  let note = null
  let power = null
  let tips = true
  let unsub = null
  // the ball: "held" (by who), "shot" (flying: its own state), "back" (passed back to you)
  const ball = { state: "held", by: myIdx, p: { x: 0, y: 1, z: 0 }, v: { x: 0, y: 0, z: 0 }, shot: null, t: 0, from: null, back: null }
  // the shooting motion: { who, t, v, at, released }
  let shooting = null
  let dribble = 0
  let spotAt = 0
  let over = null
  const say = (text, sec = 1.6) => {
    note = { text, until: performance.now() + sec * 1000 }
    emitHud(true)
  }
  const shooterIdx = () => (mode === "horse" ? st.turn : myIdx)
  const posOf = (i) => (i === myIdx ? me : other)

  // ---- what's drawn ----
  const build = () => {
    group = new THREE.Group()
    group.name = "hoops"
    ballMesh = new THREE.Mesh(new THREE.SphereGeometry(BALL.r, 20, 14), new THREE.MeshLambertMaterial({ map: ballTexture(), color: 0xffffff }))
    shadow = new THREE.Mesh(new THREE.CircleGeometry(0.16, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }))
    shadow.renderOrder = 2
    group.add(ballMesh, shadow)
    // the nets: twelve cords from the rim down to a smaller ring, white
    for (const e of [1, -1]) {
      const h = hoops[e]
      const pts = []
      const N = 12
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2
        const a2 = ((i + 0.5) / N) * Math.PI * 2
        pts.push(Math.cos(a) * h.r, 0, Math.sin(a) * h.r, Math.cos(a2) * 0.15, -0.42, Math.sin(a2) * 0.15)
        pts.push(Math.cos(a) * h.r, 0, Math.sin(a) * h.r, Math.cos(a - Math.PI / N) * 0.15, -0.42, Math.sin(a - Math.PI / N) * 0.15)
      }
      const g = new THREE.BufferGeometry()
      g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3))
      const net = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xf2f2f2, transparent: true, opacity: 0.85 }))
      const w = W(0, h.z)
      net.position.set(w.x, h.y + (spot.y || 0), w.z)
      net.userData = { swish: 0 }
      group.add(net)
      nets.push({ net, end: e })
    }
    // Around the World's spots, H-O-R-S-E's spot to match: rings on the floor
    for (let i = 0; i < 8; i++) {
      const r = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.58, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0, depthWrite: false }))
      r.renderOrder = 2
      group.add(r)
      rings.push(r)
    }
    api.scene.add(group)
  }
  const placeW = (m, x, y, z) => {
    const w = W(x, z)
    m.position.set(w.x, y + (spot.y || 0), w.z)
  }

  // ---- bodies ----
  const facingHoop = (p) => Math.atan2(-p.x, hoop.z - p.z)
  const driveFor = (i, look) => () => {
    const p = posOf(i)
    const sp = Math.hypot(p.vx, p.vz)
    const yawL = sp > 0.4 && !(shooting && shooting.who === i) ? Math.atan2(p.vx, p.vz) : facingHoop(p)
    let mood = null
    if (shooting && shooting.who === i) mood = { kind: "shoot", p: Math.min(1, shooting.t / SHOOT_S) }
    else if (ball.state === "held" && ball.by === i) mood = sp > 0.3 ? { kind: "dribble", p: (dribble / Math.PI) % 1 } : { kind: "shoot", p: 0 }
    const sit = { x: p.x, z: p.z, vx: p.vx, vz: p.vz, facing: yawL, ball: { x: hoop.z ? 0 : 0, y: 2, z: hoop.z }, holding: false, swing: null, prep: null, high: null, charging: false, between: true, atNet: false, depth: 6, goal: null, hand: look?.plays === "left" ? -1 : 1, twoHand: false, person: true, oppHit: null, want: { x: p.vx, z: p.vz }, id: `hp${i}`, phase: "intro", phaseT: 0, point: 0, mate: null, across: null, receiving: false }
    return { sit, frame, gear: "none", mood, key: `hoops${i}`, y: spot.y || 0 }
  }
  const bodyOf = (i) => (i === myIdx ? api.meBody : otherBody)
  const syncBodies = () => {
    for (const i of mode === "horse" ? [0, 1] : [myIdx]) {
      const b = bodyOf(i)
      if (!b) continue
      const p = posOf(i)
      const w = W(p.x, p.z)
      b.x = w.x
      b.z = w.z
      b.y = spot.y || 0
      b.vx = p.vx * c + p.vz * s
      b.vz = -p.vx * s + p.vz * c
      b.speed = Math.hypot(p.vx, p.vz)
      b.yaw = facingHoop(p) + frame.rot
    }
  }

  // ---- shooting ----
  const handsOf = (i, k = 0) => {
    // (the ball between the hands: at the forehead set, up over the head at the release)
    const p = posOf(i)
    const f = facingHoop(p)
    const fx = Math.sin(f)
    const fz = Math.cos(f)
    const y = 1.5 + Math.max(0, Math.min(1, (k - 0.3) / 0.25)) * (RELEASE_Y - 1.5)
    return { x: p.x + fx * 0.3, y, z: p.z + fz * 0.3 }
  }
  const startShot = (i, v) => {
    shooting = { who: i, t: 0, v, at: { x: posOf(i).x, z: posOf(i).z }, released: false }
  }
  const release = () => {
    const sh = shooting
    sh.released = true
    const at = sh.at
    ball.state = "shot"
    ball.p = { x: at.x, y: RELEASE_Y, z: at.z }
    ball.v = { ...sh.v }
    ball.shot = { who: sh.who, at, t: 0, rims: 0, bank: false, made: false, swish: false, settled: 0, reported: false }
    ball.t = 0
  }
  // a swipe: your shot (if it's yours to take and you're where you have to be)
  const tryShoot = (sw) => {
    if (over || shooting || ball.state !== "held" || ball.by !== myIdx) return false
    const why = game.canShoot(myIdx, me)
    if (why === "turn") return say(`${names[st.turn]}'s shot`), false
    if (why === "spot") return say("Walk to the yellow ring"), false
    if (why === "match") return say("Match it: from the yellow ring"), false
    const sh = swipeShot(me, hoop, sw, { rand })
    startShot(myIdx, sh.v)
    me.vx = me.vz = 0
    tips = false
    if (sh.grade === "perfect") say("Perfect release", 0.9)
    if (online) link.send("shot", { at: [r3(me.x), r3(me.z)], v: [r3(sh.v.x), r3(sh.v.y), r3(sh.v.z)] })
    return true
  }
  // the ball flies (fixed steps); what it touches, made or not; it settles, the result counts
  let acc = 0
  const flyBall = (dt) => {
    acc += dt
    while (acc >= DT) {
      acc -= DT
      const h = stepBall(ball, hoop)
      const sh = ball.shot
      sh.t += DT
      if (h?.startsWith("rim")) {
        sh.rims++
        sfx.rim(Math.min(1, Math.hypot(ball.v.x, ball.v.y, ball.v.z) / 6))
      }
      if (h?.startsWith("board")) {
        sh.bank = true
        sfx.board(0.6)
      }
      if (h?.endsWith("in") && !sh.made) {
        sh.made = true
        sh.swish = sh.rims === 0 && !sh.bank
        if (sh.swish) sfx.swish()
        const n = nets.find((x) => x.end === hoop.end)
        if (n) n.net.userData.swish = 0.7
        // (the net slows it a moment)
        ball.v.x *= 0.5
        ball.v.z *= 0.5
        ball.v.y *= 0.7
      }
      if (h === "floor") {
        sfx.dribble(Math.min(1, Math.abs(ball.v.y) / 5))
        sh.settled++
      }
      if (!sh.reported && (sh.settled >= 2 || sh.t > 3.2)) {
        sh.reported = true
        finishShot(sh)
      }
    }
  }
  const finishShot = (sh) => {
    // (with a friend: the shooter's screen says how it came out)
    if (online && sh.who !== myIdx) {
      if (!pendingResult) {
        sh.waiting = true
        return
      }
      Object.assign(sh, pendingResult)
      pendingResult = null
    }
    if (online && sh.who === myIdx) link.send("result", { made: sh.made, swish: sh.swish, bank: sh.bank, rims: sh.rims })
    const r = game.shot(sh.who, sh.at, sh)
    say(r.say, 1.8)
    if (sh.made && sh.who === myIdx) sfx.chime(true)
    if (st.over) {
      over = { won: mode === "horse" ? st.over.winner === myIdx : null, title: mode === "world" ? "Around the World!" : st.over.winner === myIdx ? "You win!" : "Good game!", line: st.over.line }
      sfx.chime(over.won !== false)
    }
    // the ball comes back: to whoever shoots next
    const next = shooterIdx()
    ball.back = { from: { ...ball.p }, to: next, t: 0 }
    ball.state = "back"
    emitHud(true)
  }
  let pendingResult = null
  let charge = null

  // ---- the computer's turn (H-O-R-S-E) ----
  const cpuStep = (dt) => {
    if (mode !== "horse" || online || over) return
    const i = 1 - myIdx
    if (st.turn !== i) {
      // (your shot: the computer gives you room, a few steps to the side)
      const dx = other.x - me.x
      const dz = other.z - me.z
      const d = Math.hypot(dx, dz)
      if (d < 2.2 && !shooting) {
        const away = d > 0.1 ? { x: dx / d, z: dz / d } : { x: 1, z: 0 }
        other.vx = away.x * 1.6
        other.vz = away.z * 1.6
      } else {
        other.vx *= 0.8
        other.vz *= 0.8
      }
      other.goal = null
      return
    }
    if (shooting || ball.state !== "held" || ball.by !== i) return
    if (!other.goal) {
      other.goal = st.toMatch ? { ...st.toMatch } : cpuSpot(hoop, rand)
      other.wait = 0.7 + rand() * 0.6
    }
    const dx = other.goal.x - other.x
    const dz = other.goal.z - other.z
    const d = Math.hypot(dx, dz)
    if (d > 0.15) {
      const sp = Math.min(3.2, d * 3)
      other.vx = (dx / d) * sp
      other.vz = (dz / d) * sp
      return
    }
    other.vx = other.vz = 0
    other.wait -= dt
    if (other.wait > 0) return
    const sh = swipeShot(other, hoop, { depth: SWEET, u: 0 }, { rand, spread: cpuSpread(level) })
    startShot(i, sh.v)
    other.goal = null
  }

  // ---- the HUD ----
  const hud = () => {
    const turnName = mode === "horse" ? names[st.turn] : "You"
    const yours = mode !== "horse" || st.turn === myIdx
    let big
    let small
    if (mode === "free") {
      big = `${st.made} / ${st.shots}`
      small = `streak ${st.streak} · best ${st.best}${st.swishes ? ` · ${st.swishes} swish${st.swishes > 1 ? "es" : ""}` : ""}`
    } else if (mode === "world") {
      big = `Spot ${Math.min(st.world + 1, game.spots.length)} of ${game.spots.length}`
      small = `${st.worldShots} shot${st.worldShots === 1 ? "" : "s"}`
    } else {
      big = yours ? (st.toMatch ? "Match it!" : "Your shot") : `${turnName}'s shot`
      small = st.toMatch ? "From the yellow ring" : yours ? "Anywhere you like" : st.toMatch ? "Matching yours" : "Watch"
    }
    const want = game.canShoot(myIdx, me)
    return {
      kind: "hoops",
      mode,
      online,
      host: !online || link.host,
      opp: mode === "horse" ? names[1 - myIdx] : null,
      court: spot.name,
      big,
      small,
      letters: mode === "horse" ? { me: st.letters[myIdx], them: st.letters[1 - myIdx] } : null,
      power,
      tip: over ? null : tips && yours && ball.state === "held" ? (want === "spot" ? "Walk to the yellow ring, then swipe up" : "Swipe up to shoot: half way up is just right") : null,
      note: note && performance.now() < note.until ? note.text : null,
      over,
    }
  }
  const emitHud = (force = false) => {
    const h = hud()
    const k = JSON.stringify(h)
    if (!force && k === lastHud) return
    lastHud = k
    for (const fn of listeners) fn(h)
  }

  // ---- online ----
  const onLink = (type, d) => {
    if (type === "spot" && Array.isArray(d.p)) {
      const [x, z] = d.p.map(Number)
      if (Number.isFinite(x) && Number.isFinite(z)) {
        other.vx = (x - other.x) / 0.4
        other.vz = (z - other.z) / 0.4
        other.target = { x, z }
      }
    } else if (type === "shot" && Array.isArray(d.at) && Array.isArray(d.v)) {
      const i = 1 - myIdx
      const ax = Number(d.at[0])
      const az = Number(d.at[1])
      if (Number.isFinite(ax) && Number.isFinite(az)) {
        other.x = ax
        other.z = az
      }
      other.target = null
      ball.state = "held"
      ball.by = i
      startShot(i, { x: Number(d.v[0]) || 0, y: Number(d.v[1]) || 0, z: Number(d.v[2]) || 0 })
    } else if (type === "result") {
      const res = { made: !!d.made, swish: !!d.swish, bank: !!d.bank, rims: Number(d.rims) || 0 }
      if (ball.shot?.waiting && !ball.shot.reported2) {
        ball.shot.reported2 = true
        pendingResult = res
        ball.shot.waiting = false
        finishShot(ball.shot)
      } else pendingResult = res
    } else if (type === "again") {
      game.restart()
      over = null
      ball.state = "held"
      ball.by = shooterIdx()
      emitHud(true)
    }
  }

  const run = {
    kind: "hoops",
    spot,
    start(a) {
      api = a
      build()
      const meInfo = api.me()
      api.meBody.drive = driveFor(myIdx, meInfo.look)
      if (mode === "horse") {
        if (!opp) {
          const [name, body] = NAMES[(Math.random() * NAMES.length) | 0]
          opp = { name, look: parkLook(Math.random, body) }
          names[1 - myIdx] = name
          game.players[1 - myIdx].name = name
        }
        otherBody = api.body("hoopsOther", opp.look, opp.name)
        otherBody.drive = driveFor(1 - myIdx, opp.look)
      }
      if (link?.num !== undefined && link?.num !== null) api.hideRemote(link.num, true)
      if (link) unsub = link.on(onLink)
      ball.by = shooterIdx()
      syncBodies()
      emitHud(true)
    },
    step(dt) {
      if (charge !== null) power = Math.min(1.2, ((performance.now() - charge) / 1000) * 0.9) / SWEET
      // you: the move pad (camera-relative: up the screen is toward the hoop)
      const mag = Math.min(1, Math.hypot(stick.x, stick.y))
      if (!shooting || shooting.who !== myIdx) {
        const f = facingHoop(me)
        const fx = Math.sin(f)
        const fz = Math.cos(f)
        // (right on screen: the hoop's direction turned a quarter)
        const rx = -fz
        const rz = fx
        const want = mag < 0.12 ? { x: 0, z: 0 } : { x: (fx * stick.y + rx * stick.x) * WALK, z: (fz * stick.y + rz * stick.x) * WALK }
        const k = Math.min(1, dt * 10)
        me.vx += (want.x - me.vx) * k
        me.vz += (want.z - me.vz) * k
        me.x += me.vx * dt
        me.z += me.vz * dt
        clampIn(me)
      }
      // the half you're on is the hoop you shoot at (H-O-R-S-E: the setter's half)
      if (mode !== "horse" && ball.state === "held") hoop = hoops[me.z >= 0 ? 1 : -1]
      // the other one: the computer walks; a friend's screen says where they are
      if (mode === "horse") {
        cpuStep(dt)
        if (online && other.target) {
          const dx = other.target.x - other.x
          const dz = other.target.z - other.z
          other.x += dx * Math.min(1, dt * 8)
          other.z += dz * Math.min(1, dt * 8)
          other.vx = dx * 4
          other.vz = dz * 4
        } else if (!online) {
          other.x += other.vx * dt
          other.z += other.vz * dt
        }
        clampIn(other)
      }
      // (with a friend: where you stand, while it's your shot to take)
      if (online && shooterIdx() === myIdx && mag > 0.05) {
        const now = performance.now()
        if (now - spotAt > SPOT_MS) {
          spotAt = now
          link.send("spot", { p: [r3(me.x), r3(me.z)] })
        }
      }
      // the shot's motion, the release
      if (shooting) {
        shooting.t += dt
        if (!shooting.released && shooting.t >= SHOOT_S * RELEASE_AT) release()
        if (shooting.t > SHOOT_S + 0.25) shooting = null
      }
      // the ball
      if (ball.state === "held") {
        const holder = posOf(ball.by)
        const moving = Math.hypot(holder.vx, holder.vz) > 0.3
        if (shooting && shooting.who === ball.by && !shooting.released) ball.p = handsOf(ball.by, shooting.t / SHOOT_S)
        else if (moving) {
          // dribbling at the side: down and up twice a second
          const was = Math.sin(dribble)
          dribble += dt * Math.PI * 2.2
          const now = Math.sin(dribble)
          const f = facingHoop(holder)
          ball.p = { x: holder.x + Math.cos(f) * 0.38 + Math.sin(f) * 0.3, y: BALL.r + Math.abs(now) * 0.75, z: holder.z - Math.sin(f) * 0.38 + Math.cos(f) * 0.3 }
          if (Math.sign(was) !== Math.sign(now) && ball.by === myIdx) sfx.dribble(0.35)
        } else ball.p = handsOf(ball.by, 0)
      } else if (ball.state === "shot") flyBall(dt)
      else if (ball.state === "back") {
        // a pass back to the next shooter's hands, in an arc
        const bk = ball.back
        bk.t += dt / 0.7
        const to = handsOf(bk.to, 0)
        const k = Math.min(1, bk.t)
        ball.p = { x: bk.from.x + (to.x - bk.from.x) * k, y: bk.from.y + (to.y - bk.from.y) * k + Math.sin(k * Math.PI) * 1.2, z: bk.from.z + (to.z - bk.from.z) * k }
        if (k >= 1) {
          ball.state = "held"
          ball.by = bk.to
        }
      }
      placeW(ballMesh, ball.p.x, ball.p.y, ball.p.z)
      ballMesh.rotation.x += dt * (ball.state === "shot" ? -9 : 0)
      placeW(shadow, ball.p.x, 0.012, ball.p.z)
      shadow.material.opacity = 0.3 * Math.max(0.2, 1 - ball.p.y / 4)
      // the nets sway after a swish
      for (const n of nets) {
        const u = n.net.userData
        if (u.swish > 0) {
          u.swish -= dt
          const k = Math.max(0, u.swish)
          n.net.scale.set(1 - k * 0.15, 1 + Math.sin(k * 30) * k * 0.35, 1 - k * 0.15)
        } else n.net.scale.set(1, 1, 1)
      }
      // the rings: Around the World's spots (the next one bright), the spot to match
      const marks = mode === "world" ? game.spots.map((p, i) => ({ ...p, on: i === st.world, done: i < st.world })) : mode === "horse" && st.toMatch ? [{ ...st.toMatch, on: true }] : []
      rings.forEach((r, i) => {
        const m = marks[i]
        r.material.opacity = m ? (m.on ? 0.9 : m.done ? 0.15 : 0.35) : 0
        if (m) placeW(r, m.x, 0.02, m.z)
      })
      syncBodies()
      hudT += dt
      if (hudT > 0.2) {
        hudT = 0
        emitHud()
      }
    },
    me() {
      const w = W(me.x, me.z)
      return { x: w.x, z: w.z, y: spot.y || 0, yaw: facingHoop(me) + frame.rot, vx: me.vx * c + me.vz * s, vz: -me.vx * s + me.vz * c }
    },
    // behind the shooter, looking at the rim (the computer's or your friend's shot: theirs)
    shot(dt, { portrait = true } = {}) {
      const who = mode === "horse" ? st.turn : myIdx
      const p = posOf(who)
      const dx = p.x
      const dz = p.z - hoop.z
      const d = Math.hypot(dx, dz) || 1
      const back = portrait ? 4.2 : 3.6
      let cam = W(p.x + (dx / d) * back, p.z + (dz / d) * back)
      const head = W(p.x, p.z)
      const at = (k) => ({ x: head.x + (cam.x - head.x) * k, z: head.z + (cam.z - head.z) * k })
      if (api?.blocked?.(head.x, head.z, 0.05)) {
        let k = 1
        while (k > 0.3 && !api.blocked(at(k).x, at(k).z, 0.05)) k -= 0.05
        cam = at(Math.max(0.3, k - 0.06))
      } else {
        const t = api?.segHit?.(head, cam, 1.6)
        if (t !== null && t !== undefined) cam = at(Math.max(0.3, t - 0.08))
      }
      const rim = W(0, hoop.z)
      const y0 = spot.y || 0
      const camY = y0 + (portrait ? 2.9 : 2.5)
      const look = { x: rim.x + (head.x - rim.x) * 0.3, y: y0 + 2.2, z: rim.z + (head.z - rim.z) * 0.3 }
      return { cam: { x: cam.x, y: spot.roofY ? Math.min(camY, spot.roofY - 0.5) : camY, z: cam.z }, look, fov: portrait ? 64 : 52, ease: 4 }
    },
    focus() {
      const w = W(me.x, me.z)
      return { x: w.x, y: spot.y || 0, z: w.z }
    },
    setStick(x, y) {
      stick = { x, y }
    },
    key(code, down, keys) {
      const kx = (keys.has("ArrowRight") || keys.has("KeyD") ? 1 : 0) - (keys.has("ArrowLeft") || keys.has("KeyA") ? 1 : 0)
      const ky = (keys.has("ArrowUp") || keys.has("KeyW") ? 1 : 0) - (keys.has("ArrowDown") || keys.has("KeyS") ? 1 : 0)
      stick = { x: kx * 0.8, y: ky * 0.8 }
      // (a keyboard: hold Space to build the shot's power, let go to shoot)
      if (code === "Space" || code === "Enter" || code === "KeyJ") {
        if (down && charge === null) charge = performance.now()
        else if (!down && charge !== null) {
          const depth = Math.min(1.2, ((performance.now() - charge) / 1000) * 0.9)
          charge = null
          power = null
          tryShoot({ depth, u: kx * 0.4 })
        }
        return true
      }
      return ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyW", "KeyA", "KeyS", "KeyD"].includes(code)
    },
    swipeStart() {
      power = 0
    },
    swipeMove(r) {
      power = r && !r.tap ? r.depth / SWEET : null
      emitHud()
    },
    swipe(sw) {
      power = null
      return tryShoot(sw)
    },
    again() {
      if (online && !link.host) return
      game.restart()
      over = null
      ball.state = "held"
      ball.by = shooterIdx()
      link?.send("again", {})
      emitHud(true)
    },
    subscribe(fn) {
      listeners.add(fn)
      fn(hud())
      return () => listeners.delete(fn)
    },
    get state() {
      return { game: st, ball, me, other, hoop: hoop.end, shooting: !!shooting }
    },
    stop() {
      unsub?.()
      if (link?.num !== undefined && link?.num !== null) api?.hideRemote(link.num, false)
      if (group) {
        api.scene.remove(group)
        group.traverse((o) => {
          o.geometry?.dispose()
          if (o.material && o.material.map !== ballTex) o.material.dispose?.()
        })
      }
      if (otherBody) api.drop(otherBody)
      listeners.clear()
    },
    exit() {
      const w = W(me.x, me.z)
      return { x: w.x, z: w.z, y: spot.y || 0, yaw: facingHoop(me) + frame.rot }
    },
    result() {
      if (!st.shots) return null
      return { kind: "hoops", mode, made: st.made, shots: st.shots, swishes: st.swishes, streak: st.best, world: mode === "world" && st.over ? st.worldShots : null, won: mode === "horse" && st.over ? st.over.winner === myIdx : null }
    },
  }
  return run
}

const r3 = (v) => Math.round(v * 1000) / 1000
