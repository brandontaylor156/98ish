// My Park > Play tennis, in the park (three.js): the game (tennis.js) on the venue's real
// tennis court, drawn into My Park's scene, you and your opponent as the park's athletes with
// rackets, the ball, its shadow, and a camera behind you. The park carries on round the court.
//
//   const run = createTennisRun({ spot, mode, level, link, opp })
//   world.setActivity(run)    ...    world.setActivity(null)
//   run.swipe({ u, depth, pace, tap })   (the page's swipe zone; touchplay.js readSwipe)
//   run.subscribe(fn)   the HUD's state, a few times a second and at every event
//
// link (a game with a friend, acts/useActivities.jsx): { host, team, send(type, data),
// on(fn) } over the room's relay (server/arcade/games/parkact.js). The host runs the game; the
// guest sends its own position and swings and draws the host's snapshots (8 a second).

import * as THREE from "three"
import { BALL, COURT, DT, createTennis, landing, scoreLine, stepBall, bounceBall } from "./tennis.js"
import { NAMES, parkLook } from "../regulars.js"
import { sfx } from "./sound.js"

const SNAP_MS = 125
const INPUT_MS = 90

const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a))

export const createTennisRun = ({ spot, mode = "match", level = "normal", link = null, opp = null, seed = (Math.random() * 1e9) | 0 } = {}) => {
  // the court's frame: turned so your end is the end you walked up to (team 0 plays from +z)
  const flip = spot.side === -1
  const frame = { x: spot.frame.x, z: spot.frame.z, rot: spot.frame.rot + (flip ? Math.PI : 0) }
  const s = Math.sin(frame.rot)
  const c = Math.cos(frame.rot)
  const W = (x, z) => ({ x: frame.x + x * c + z * s, z: frame.z - x * s + z * c })
  const myTeam = link ? link.team : 0
  const guest = !!link && !link.host
  const game = createTennis({ mode, level, seed, cpu: link ? [false, false] : [false, true] })
  const st = game.state
  let api = null
  let oppBody = null
  let ball = null
  let shadow = null
  let ring = null
  let aimRing = null
  let group = null
  let listeners = new Set()
  let hudT = 0
  let lastHud = ""
  let note = null // { text, until }
  let stick = { x: 0, y: 0 }
  let keyAim = 0
  let sentAt = 0
  let inputAt = 0
  let snap = null // (guest) the last snapshot and when it came
  let snapAt = 0
  let pending = [] // (host) events for the guest's sounds
  let over = null // { won, line }
  let tips = true
  let unsub = null
  const names = () => {
    const me = api?.me()?.name || "You"
    return myTeam === 0 ? ["You", opp?.name || "Them"] : [opp?.name || "Them", "You"]
  }
  const say = (text, sec = 1.4) => {
    note = { text, until: performance.now() + sec * 1000 }
    emitHud(true)
  }

  // ---- what's on screen ----
  const build = () => {
    group = new THREE.Group()
    group.name = "tennis"
    ball = new THREE.Mesh(new THREE.SphereGeometry(BALL.r * 1.5, 12, 8), new THREE.MeshLambertMaterial({ color: 0xdff23a, emissive: 0x3a4a00 }))
    shadow = new THREE.Mesh(new THREE.CircleGeometry(0.07, 14).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false }))
    ring = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.3, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xfff27a, transparent: true, opacity: 0.0, depthWrite: false }))
    aimRing = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.38, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x7af0ff, transparent: true, opacity: 0.0, depthWrite: false }))
    for (const m of [shadow, ring, aimRing]) m.renderOrder = 2
    group.add(ball, shadow, ring, aimRing)
    api.scene.add(group)
  }
  const place = (m, x, y, z) => {
    const w = W(x, z)
    m.position.set(w.x, y, w.z)
  }

  // ---- bodies: you and them, posed by anim.js from the game's situation ----
  const sitFor = (p) => {
    const b = st.ball
    const other = st.players[1 - p.team]
    const facing = p.team === 0 ? Math.PI : 0
    let prep = null
    // (a ball coming: the backswing, and the forward swing if a swing is armed or it's the computer)
    if (st.phase === "play" && b.live && st.rally.last !== p.team && Math.sign(b.v.z) === (p.team === 0 ? 1 : -1) && !p.swing) {
      const ttc = Math.abs(b.v.z) > 0.5 ? (p.z - b.p.z) / b.v.z : 9
      if (ttc > -0.1 && ttc < 0.7) {
        const y = Math.max(0.3, b.p.y + b.v.y * ttc - 4.9 * ttc * ttc)
        const x = b.p.x + b.v.x * ttc
        const local = (x - p.x) * (p.team === 0 ? -1 : 1)
        prep = { ttc, x, y: Math.min(1.9, y), z: p.z, kind: "drive", hand: local >= 0 ? "fh" : "bh", forward: !!p.armed || p.cpu, id: st.rally.hits }
      }
    }
    const sw = p.swing && !p.swing.whiff ? { t: p.swing.t, kind: p.swing.kind === "serve" ? "smash" : p.swing.y > 1.7 ? "smash" : "drive", hand: p.swing.hand, x: p.swing.x, y: p.swing.y, z: p.swing.z, id: `${p.team}:${p.swing.id ?? 0}`, speed: p.swing.speed } : p.swing?.whiff ? { t: p.swing.t, kind: "drive", hand: "fh", whiff: true, y: 0.9 } : null
    return { x: p.x, z: p.z, vx: p.vx, vz: p.vz, facing, ball: { x: b.p.x, y: b.p.y, z: b.p.z }, holding: st.phase === "serve" && st.score.server === p.team && st.mode !== "rally", swing: sw, prep, high: null, charging: false, between: st.phase !== "play", atNet: false, depth: Math.abs(p.z), goal: null, hand: 1, twoHand: false, person: !p.cpu, oppHit: null, want: { x: p.vx, z: p.vz }, id: `tn${p.team}`, phase: st.phase === "play" ? "rally" : "dead", phaseT: st.phaseT, point: 0, mate: null, across: { x: other.x, z: other.z, id: `tn${other.team}` }, receiving: false }
  }
  const driveFor = (team, look) => () => {
    const p = st.players[team]
    const s0 = sitFor(p)
    s0.hand = look?.plays === "left" ? -1 : 1
    s0.twoHand = look?.backhand === "two"
    return { sit: s0, frame, gear: "racket", gearColor: look?.paddleEdge || look?.paddle || "#1d3557", key: `tennis${team}` }
  }
  const bodyOf = (team) => (team === myTeam ? api.meBody : oppBody)
  const syncBodies = () => {
    for (const p of st.players) {
      const b = bodyOf(p.team)
      if (!b) continue
      const w = W(p.x, p.z)
      b.x = w.x
      b.z = w.z
      b.y = 0
      const v = { x: p.vx * c + p.vz * s, z: -p.vx * s + p.vz * c }
      b.vx = v.x
      b.vz = v.z
      b.speed = Math.hypot(p.vx, p.vz)
      b.yaw = frame.rot + (p.team === 0 ? Math.PI : 0)
    }
  }

  // ---- sounds and words from the game's events ----
  const onEvent = (e) => {
    if (e.type === "hit") {
      sfx.racket(Math.min(1, (e.speed || 15) / 32))
      if (e.team === myTeam && !e.serve && !e.feed) tips = false
      // (where your shot lands: a marker; theirs: where to be)
      const l = landing(st.ball)
      if (l) {
        const m = e.team === myTeam ? aimRing : ring
        place(m, l.x, 0.02, l.z)
        m.material.opacity = 0.85
        m.userData.fade = 1.6
      }
    } else if (e.type === "bounce") sfx.bounce(Math.min(1, (e.speed || 8) / 20))
    else if (e.type === "net") sfx.net()
    else if (e.type === "whiff" && e.team === myTeam) say("Too early! Swipe as it comes", 1.4)
    else if (e.type === "fault") say(e.double ? "Double fault" : "Fault", 1.2)
    else if (e.type === "let") say("Let: serve again", 1.2)
    else if (e.type === "point") {
      if (st.mode === "rally") {
        say(e.streak > 1 ? `${e.streak} in a row!${e.streak >= e.best && e.streak > 2 ? " Best yet" : ""}` : "Again!", 1.6)
        if (e.streak > 0) sfx.chime(true)
      } else {
        const mine = e.to === myTeam
        sfx.chime(mine)
        const why = e.why === "out" ? "Out" : e.why === "net" ? "Net" : e.why === "two bounces" ? "Too late" : e.why === "double fault" ? "Double fault" : ""
        say(e.game !== null && e.game !== undefined ? `Game ${names()[e.game]}` : `${why ? `${why} · ` : ""}${e.words || ""}`, 1.6)
      }
    } else if (e.type === "over") {
      const won = e.winner === myTeam
      over = { won, games: e.games, line: `${e.games[myTeam]} - ${e.games[1 - myTeam]}` }
      sfx.chime(won)
      emitHud(true)
    }
  }

  // ---- the HUD's state ----
  const hud = () => {
    const nm = names()
    const sl = scoreLine(st, nm)
    const serving = st.phase === "serve" && st.score.server === myTeam && st.mode !== "rally"
    return {
      kind: "tennis",
      mode: st.mode,
      level,
      online: !!link,
      opp: opp?.name || null,
      games: st.score.games.slice(),
      mine: myTeam,
      big: sl.big,
      small: sl.small,
      server: st.score.server,
      phase: st.phase,
      serving,
      tip: over ? null : serving ? "Swipe up to serve" : tips && st.phase === "play" ? "Swipe up to hit · aim with the angle · faster = harder" : null,
      note: note && performance.now() < note.until ? note.text : null,
      streak: st.streak,
      best: st.best,
      over,
      court: spot.name,
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
    if (type === "snap" && guest) {
      snap = d
      snapAt = performance.now()
      // (your own player stays where your screen has it)
      const mine = st.players[myTeam]
      const keep = { x: mine.x, z: mine.z, vx: mine.vx, vz: mine.vz, swing: mine.swing }
      const was = st.phase
      game.apply(d)
      // (a new point puts everyone on their marks: the host's places then)
      if (!(st.phase === "serve" && was !== "serve")) Object.assign(mine, { x: keep.x, z: keep.z, vx: keep.vx, vz: keep.vz })
      if (!mine.swing && keep.swing && keep.swing.t < 0.5) mine.swing = keep.swing
      for (const e of d.ev || []) onEvent(e)
      if (d.over && !over) onEvent({ type: "over", winner: d.over[0], games: d.over[1] })
    } else if (type === "input" && !guest) {
      // the guest's own player: where they say they are (kept on their side, a running pace)
      const p = st.players[1]
      if (Array.isArray(d.p)) {
        const [x, z, vx, vz] = d.p.map(Number)
        if ([x, z, vx, vz].every(Number.isFinite)) {
          const step = Math.hypot(x - p.x, z - p.z)
          const k = step > 3 ? 3 / step : 1
          p.x += (x - p.x) * k
          p.z += (z - p.z) * k
          p.vx = Math.max(-7, Math.min(7, vx))
          p.vz = Math.max(-7, Math.min(7, vz))
          p.remote = true
        }
      }
    } else if (type === "swing" && !guest) {
      if (d.sw) game.swing(1, d.sw)
    } else if (type === "again" && guest) {
      over = null
    }
  }

  const run = {
    kind: "tennis",
    spot,
    start(a) {
      api = a
      build()
      const me = api.me()
      if (!opp) {
        // the computer: one of the park's regulars, in their own kit
        const rand = Math.random
        const [name, body] = NAMES[(Math.random() * NAMES.length) | 0]
        opp = { name, look: parkLook(rand, body), cpu: true }
      }
      oppBody = api.body("tennisOpp", opp.look, opp.name)
      oppBody.drive = driveFor(1 - myTeam, opp.look)
      api.meBody.drive = driveFor(myTeam, me.look)
      if (link?.num !== undefined && link?.num !== null) api.hideRemote(link.num, true)
      if (link) unsub = link.on(onLink)
      syncBodies()
      emitHud(true)
    },
    step(dt) {
      const me = st.players[myTeam]
      if (guest) {
        // (between the host's snapshots: the ball flies on, the other player runs on)
        const age = (performance.now() - snapAt) / 1000
        if (snap && age < 0.6 && st.ball.live) {
          stepBall(st.ball, dt)
          if (st.ball.p.y <= BALL.r && st.ball.v.y < 0) bounceBall(st.ball)
        }
        const o = st.players[1 - myTeam]
        o.x += o.vx * dt
        o.z += o.vz * dt
        // your own player moves on your screen at once (the host takes your word for it)
        game.input(myTeam, stick)
        localMove(me, dt)
        const now = performance.now()
        if (now - inputAt > INPUT_MS && link) {
          inputAt = now
          link.send("input", { p: [me.x, me.z, me.vx, me.vz].map((v) => Math.round(v * 100) / 100) })
        }
        for (const p of st.players) if (p.swing) p.swing.t += dt
      } else {
        game.input(myTeam, stick)
        game.step(dt)
        const evs = game.drain()
        for (const e of evs) onEvent(e)
        if (link) {
          for (const e of evs) if (["hit", "bounce", "net", "point", "fault", "let", "whiff"].includes(e.type)) pending.push(compactEvent(e))
          const now = performance.now()
          if (now - sentAt > SNAP_MS) {
            sentAt = now
            const sn = game.snapshot()
            sn.ev = pending.splice(0)
            if (over) sn.over = [st.score.winner, st.score.games]
            link.send("snap", sn)
          }
        }
      }
      // the ball, its shadow, the markers
      const b = st.ball.p
      place(ball, b.x, Math.max(BALL.r, b.y), b.z)
      place(shadow, b.x, 0.012, b.z)
      shadow.material.opacity = 0.32 * Math.max(0.2, 1 - b.y / 4)
      for (const m of [ring, aimRing]) {
        if (!m.userData.fade) continue
        m.userData.fade -= dt
        m.material.opacity = Math.max(0, Math.min(0.85, m.userData.fade))
        if (m.userData.fade <= 0) m.userData.fade = 0
      }
      syncBodies()
      hudT += dt
      if (hudT > 0.2) {
        hudT = 0
        emitHud()
      }
    },
    me() {
      const p = st.players[myTeam]
      const w = W(p.x, p.z)
      const v = { x: p.vx * c + p.vz * s, z: -p.vx * s + p.vz * c }
      return { x: w.x, z: w.z, y: 0, yaw: frame.rot + (myTeam === 0 ? Math.PI : 0), vx: v.x, vz: v.z }
    },
    // behind you, a little up, looking down the court
    shot(dt, { portrait = true } = {}) {
      const p = st.players[myTeam]
      const sd = myTeam === 0 ? 1 : -1
      const back = portrait ? 6.4 : 5.6
      let cam = W(p.x * 0.55, p.z + sd * back)
      // (inside the pen: never behind its fence, looking through the windscreen. A court
      // nobody plays at is a fenced bank the walkers go round, solid inside: the lens stays
      // where it's still "inside"; an open court: short of the first fence or wall)
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
      // (pulled in close by a fence: a little higher, so you and the far court both show)
      const d = Math.hypot(cam.x - head.x, cam.z - head.z)
      const y = (portrait ? 3.9 : 3.2) + Math.max(0, back - 1.5 - d) * 0.45
      // looking down the court, tipped so you stand in the lower part of the picture
      const fov = portrait ? 62 : 50
      const half = (fov / 2) * (Math.PI / 180)
      const pitch = Math.max(0.16, Math.atan2(y - 1.0, Math.max(0.5, d)) - half * 0.45)
      const fw = { x: -sd * s, z: -sd * c }
      const look = { x: cam.x + fw.x * Math.cos(pitch) * 10, y: y - Math.sin(pitch) * 10, z: cam.z + fw.z * Math.cos(pitch) * 10 }
      return { cam: { x: cam.x, y, z: cam.z }, look, fov, ease: 6 }
    },
    focus() {
      const p = st.players[myTeam]
      const w = W(p.x, p.z)
      return { x: w.x, y: 0, z: w.z }
    },
    setStick(x, y) {
      stick = { x, y }
    },
    key(code, down, keys) {
      const kx = (keys.has("ArrowRight") || keys.has("KeyD") ? 1 : 0) - (keys.has("ArrowLeft") || keys.has("KeyA") ? 1 : 0)
      const ky = (keys.has("ArrowUp") || keys.has("KeyW") ? 1 : 0) - (keys.has("ArrowDown") || keys.has("KeyS") ? 1 : 0)
      stick = { x: kx * 0.9, y: ky * 0.9 }
      if (down && (code === "Space" || code === "KeyJ" || code === "Enter")) {
        run.swipe({ tap: false, u: kx * 0.6, depth: 0.75, pace: 0.5 })
        return true
      }
      if (down && code === "KeyK") {
        run.swipe({ tap: false, u: kx * 0.6, depth: 0.9, pace: 0.9 })
        return true
      }
      if (down && code === "KeyL") {
        run.swipe({ tap: false, u: kx * 0.5, depth: 0.95, pace: 0.05 })
        return true
      }
      return ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyW", "KeyA", "KeyS", "KeyD"].includes(code)
    },
    // a swipe on the screen: arms your swing (or serves)
    swipe(sw) {
      if (over) return false
      if (guest) {
        const ok = st.phase === "play" || (st.phase === "serve" && st.score.server === myTeam)
        if (!ok) return false
        link.send("swing", { sw: { u: sw.u ?? 0, depth: sw.depth ?? 0.7, pace: sw.pace ?? 0.45, tap: !!sw.tap } })
        st.players[myTeam].swing = { t: 0, kind: "drive", hand: "fh", whiff: false, y: 1, x: st.players[myTeam].x, z: st.players[myTeam].z }
        return true
      }
      return game.swing(myTeam, sw)
    },
    again() {
      over = null
      if (guest) return
      game.restart()
      link?.send("again", {})
      emitHud(true)
    },
    subscribe(fn) {
      listeners.add(fn)
      fn(hud())
      return () => listeners.delete(fn)
    },
    get state() {
      return st
    },
    stop() {
      unsub?.()
      if (link?.num !== undefined && link?.num !== null) api?.hideRemote(link.num, false)
      if (group) {
        api.scene.remove(group)
        group.traverse((o) => {
          o.geometry?.dispose()
          o.material?.dispose?.()
        })
      }
      if (oppBody) api.drop(oppBody)
      listeners.clear()
    },
    // back where you walked up
    exit() {
      return { x: spot.x, z: spot.z, y: 0, yaw: Math.atan2(spot.frame.x - spot.x, spot.frame.z - spot.z) + Math.PI }
    },
    result() {
      return st.mode === "rally" ? { kind: "tennis", mode: "rally", best: st.best } : over ? { kind: "tennis", mode: "match", won: over.won, games: over.games } : null
    },
  }

  // (the guest moves their own player as the game would)
  const localMove = (p, dt) => {
    const ix = stick.x
    const iy = stick.y
    const mag = Math.min(1, Math.hypot(ix, iy))
    const sd = p.team === 0 ? 1 : -1
    const sp = mag < 0.12 ? 0 : 5.0 * (0.35 + 0.65 * mag)
    const tx = mag < 0.12 ? 0 : (ix * (p.team === 0 ? 1 : -1) / mag) * sp
    const tz = mag < 0.12 ? 0 : ((-iy * sd) / mag) * sp
    const a = (mag < 0.12 ? 22 : 16) * dt
    p.vx += Math.max(-a, Math.min(a, tx - p.vx))
    p.vz += Math.max(-a, Math.min(a, tz - p.vz))
    p.x = Math.max(-8.7, Math.min(8.7, p.x + p.vx * dt))
    p.z = sd * Math.max(0.5, Math.min(COURT.HL + 5.5, sd * (p.z + p.vz * dt)))
  }
  return run
}

const r2 = (v) => Math.round(v * 100) / 100
const compactEvent = (e) => {
  const o = { type: e.type }
  for (const k of ["team", "speed", "serve", "feed", "double", "why", "to", "words", "game", "streak", "best", "tape"]) if (e[k] !== undefined && e[k] !== null) o[k] = typeof e[k] === "number" ? r2(e[k]) : e[k]
  return o
}
