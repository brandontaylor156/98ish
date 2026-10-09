// My Park > Swim, in a venue's real pool (the activity kit's run shape: park/acts/; world.js
// setActivity). You get in at the edge where you stand (or cannonball in off it), swim with the
// move pad (freestyle when you push, treading water when you let go, Float on your back), and
// swim laps against the clock where the pool is a lap pool: a length (a 50 m pool) or two, your
// best kept. With your partner: both in the pool together, or a race (the same start, each
// times their own swim, the times swapped as park:fx { lap }).
//
//   createSwimRun({ spot, side, from, mode: "swim" | "cannonball" | "laps" | "race", pal, best, lane, onLap, onSplash })

import { ACTS } from "../interp.js"
import { edgeOf, inPoly, poolEntry } from "./spots.js"
import { swimPose, tuckPose } from "./poses.js"

export const SWIM = { speed: 1.15, sprint: 1.6, accel: 1.5, turn: 2.4, margin: 0.45 }
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a))
export const lapLengths = (spot) => (spot.len >= 40 ? 1 : 2)
export const fmtTime = (ms) => `${(ms / 1000).toFixed(1)} s`

// a lane's start: the near wall's end of the pool along its long axis, in the lane nearest
// (x, z); lanes: the pool's own lane count, else one every 2.5 m
export const laneStart = (spot, x, z, laneOverride = null) => {
  const ux = spot.along.x
  const uz = spot.along.z
  const across = -(x - spot.cx) * uz + (z - spot.cz) * ux
  const along = (x - spot.cx) * ux + (z - spot.cz) * uz
  const n = Math.max(1, spot.lanes || Math.floor(spot.wid / 2.5))
  const w = spot.wid / n
  const lane = laneOverride ?? Math.max(0, Math.min(n - 1, Math.floor((across + spot.wid / 2) / w)))
  const b = -spot.wid / 2 + w * (lane + 0.5)
  // (from whichever end is nearer)
  const dir = along > 0 ? -1 : 1
  const a = -dir * (spot.len / 2 - 0.8)
  return { lane, lanes: n, dir, x: spot.cx + ux * a - uz * b, z: spot.cz + uz * a + ux * b, yaw: Math.atan2(ux * dir, uz * dir) }
}
// how far along the pool's axis a point is (-len/2 .. len/2)
export const alongOf = (spot, x, z) => (x - spot.cx) * spot.along.x + (z - spot.cz) * spot.along.z

// the swimmer's step: stick (sx, sy) on the camera's frame -> new position, heading and speed,
// kept inside the pool by its edge
export const stepSwimmer = (s, spot, { sx = 0, sy = 0, camYaw = 0, sprint = false }, dt) => {
  const mag = Math.min(1, Math.hypot(sx, sy))
  let want = 0
  if (mag > 0.15) {
    const fx = Math.sin(camYaw)
    const fz = Math.cos(camYaw)
    const rx = -Math.cos(camYaw)
    const rz = Math.sin(camYaw)
    const dx = fx * sy + rx * sx
    const dz = fz * sy + rz * sx
    const target = Math.atan2(dx, dz)
    const d = wrap(target - s.yaw)
    s.yaw = wrap(s.yaw + Math.max(-SWIM.turn * dt, Math.min(SWIM.turn * dt, d)))
    // (going only once you're facing about that way)
    want = (sprint || mag > 0.97 ? SWIM.sprint : SWIM.speed) * mag * Math.max(0, Math.cos(d))
  }
  const dv = want - s.speed
  s.speed += Math.max(-SWIM.accel * 1.5 * dt, Math.min(SWIM.accel * dt, dv))
  const vx = Math.sin(s.yaw) * s.speed
  const vz = Math.cos(s.yaw) * s.speed
  const ok = (x, z) => inPoly(x, z, spot.poly) && edgeOf(x, z, spot.poly).d >= SWIM.margin
  const nx = s.x + vx * dt
  const nz = s.z + vz * dt
  if (ok(nx, nz)) {
    s.x = nx
    s.z = nz
  } else if (ok(nx, s.z)) s.x = nx
  else if (ok(s.x, nz)) s.z = nz
  else s.speed *= 0.5
  s.vx = vx
  s.vz = vz
  return s
}

export const createSwimRun = ({ spot, side, from = null, mode = "swim", pal = null, best = null, lane = null, onLap = null, onSplash = null } = {}) => {
  let api = null
  const listeners = new Set()
  let lastHud = ""
  let hudT = 0
  let t = 0
  const at0 = from
  const entry = poolEntry(spot, at0?.x ?? spot.cx, at0?.z ?? spot.cz)
  // you: in the water at the edge's inside (or in the air, a cannonball)
  const s = { x: entry.inX, z: entry.inZ, yaw: entry.yaw, speed: 0, vx: 0, vz: 0 }
  let phase = mode === "cannonball" ? "jump" : "in"
  let phaseT = 0
  let style = "tread"
  let floating = false
  let camYaw = entry.yaw
  let stick = { x: 0, y: 0 }
  let sprint = false
  let note = null
  let laps = null // { lengths, done, start, ms, dir, best, race, countdown }
  let rippleT = 0
  let splashes = 0
  const say = (text, sec = 2.2) => {
    note = { text, until: t + sec }
    emit(true)
  }
  const water = () => side?.water || null

  const startLaps = (race = false, laneN = null) => {
    const st = laneStart(spot, s.x, s.z, laneN)
    s.x = st.x
    s.z = st.z
    s.yaw = st.yaw
    s.speed = 0
    camYaw = st.yaw
    floating = false
    laps = { lengths: lapLengths(spot), done: 0, dir: st.dir, start: null, ms: null, best, race, countdown: 3, lane: st.lane }
    phase = "laps"
    phaseT = 0
    emit(true)
  }
  const hud = () => ({
    kind: "swim",
    title: spot.name,
    phase,
    floating,
    canLaps: !!spot.laps,
    lengths: lapLengths(spot),
    laps: laps ? { done: laps.done, lengths: laps.lengths, ms: laps.ms ?? (laps.start !== null ? Math.round((t - laps.start) * 1000) : 0), countdown: laps.countdown > 0 ? Math.ceil(laps.countdown) : 0, best: laps.best, race: laps.race, finished: laps.ms !== null, other: laps.other || null } : null,
    pal: pal ? pal.name : null,
    note: note && t < note.until ? note.text : null,
    best,
  })
  const emit = (force = false) => {
    const h = hud()
    const k = JSON.stringify(h)
    if (!force && k === lastHud) return
    lastHud = k
    for (const fn of listeners) fn(h)
  }
  if (mode === "laps") startLaps(false)
  if (mode === "race") startLaps(true, lane)

  const run = {
    kind: "swim",
    spot,
    start(a) {
      api = a
      api.meBody.drive = () => {
        if (phase === "jump") {
          const u = Math.min(1, phaseT / 0.8)
          const x = entry.x + (s.x - entry.x) * u
          const z = entry.z + (s.z - entry.z) * u
          return { pose: tuckPose({ x, y: 0.75 + 1.25 * 4 * u * (1 - u) - 0.55 * u, z, yaw: entry.yaw }), gear: "none", key: "tuck" }
        }
        // (under after a cannonball: coming back up)
        const sink = phase === "under" ? Math.max(0, 1.2 * (1 - phaseT / 0.7)) : 0
        const st = floating ? "float" : style
        return { pose: swimPose({ x: s.x, z: s.z, yaw: s.yaw, t, style: st, surface: 0.03 - sink, speed: s.speed / SWIM.speed }), gear: "none", key: "swim" }
      }
      if (phase === "in") {
        water()?.splash(s.x, s.z, 0.35)
        phase = "swim"
      }
      say(mode === "cannonball" ? "Cannonball!" : laps ? (laps.race ? `Race ${pal?.name || ""}: on your marks...` : "Laps: on your marks...") : "In you go. Push the pad to swim.", 2.4)
      emit(true)
    },
    step(dt) {
      t += dt
      phaseT += dt
      if (phase === "jump") {
        if (phaseT >= 0.8) {
          phase = "under"
          phaseT = 0
          water()?.splash(s.x, s.z, 1.6)
          splashes++
          onSplash?.()
        }
      } else if (phase === "under") {
        if (phaseT >= 0.7) {
          phase = "swim"
          phaseT = 0
        }
      } else if (phase === "laps" && laps) {
        if (laps.countdown > 0) {
          laps.countdown -= dt
          if (laps.countdown <= 0) {
            laps.start = t
            say("Go!", 1.2)
          }
        } else if (laps.ms === null) {
          stepSwimmer(s, spot, { sx: stick.x, sy: stick.y, camYaw, sprint }, dt)
          // a length: touch the far wall (the axis end you swim toward)
          const a = alongOf(spot, s.x, s.z)
          const goal = (laps.done % 2 === 0 ? laps.dir : -laps.dir) * (spot.len / 2 - SWIM.margin - 0.35)
          if ((goal > 0 && a >= goal) || (goal < 0 && a <= goal)) {
            laps.done++
            if (laps.done >= laps.lengths) {
              laps.ms = Math.round((t - laps.start) * 1000)
              const better = !laps.best || laps.ms < laps.best
              say(better ? `${fmtTime(laps.ms)}: a new best!` : `${fmtTime(laps.ms)} (your best: ${fmtTime(laps.best)})`, 6)
              if (better) laps.best = laps.ms
              onLap?.(laps.ms, laps.race)
            } else {
              // (the turn: the camera swings round to look back up the lane, so "up the pad" is
              // the way home; you still swim yourself)
              camYaw = wrap(camYaw + Math.PI)
              say("Turn!", 1.2)
            }
          }
        }
      } else if (phase === "swim") {
        stepSwimmer(s, spot, { sx: floating ? 0 : stick.x, sy: floating ? 0 : stick.y, camYaw, sprint }, dt)
        if (floating && Math.hypot(stick.x, stick.y) > 0.3) floating = false
      }
      style = s.speed > 0.25 ? "free" : "tread"
      // (the camera comes round behind you as you swim, slowly)
      if (s.speed > 0.3) camYaw += wrap(s.yaw - camYaw) * Math.min(1, dt * 0.9)
      // rings on the water as you stroke
      rippleT -= dt
      if (rippleT <= 0 && phase !== "jump") {
        rippleT = s.speed > 0.25 ? 0.8 : 1.6
        water()?.ripple(s.x + Math.sin(s.yaw) * 0.5, s.z + Math.cos(s.yaw) * 0.5, s.speed > 0.25 ? 0.35 : 0.15)
      }
      hudT += dt
      if (hudT > 0.1) {
        hudT = 0
        emit()
      }
    },
    me() {
      if (phase === "jump") return { x: entry.x, z: entry.z, y: 0, yaw: entry.yaw, vx: 0, vz: 0 }
      return { x: s.x, z: s.z, y: 0, yaw: s.yaw, vx: s.vx, vz: s.vz }
    },
    // what people online see: swimming (in the water) or standing at the edge (about to jump)
    netAct: () => (phase === "jump" ? ACTS.stand : ACTS.swim),
    shot(dt, { portrait = true } = {}) {
      const back = portrait ? 5.6 : 4.6
      const up = portrait ? 3.1 : 2.4
      const p = phase === "jump" ? { x: entry.x, z: entry.z } : s
      const cam = { x: p.x - Math.sin(camYaw) * back, y: up, z: p.z - Math.cos(camYaw) * back }
      return { cam, look: { x: p.x + Math.sin(camYaw) * 2, y: portrait ? -0.4 : 0.1, z: p.z + Math.cos(camYaw) * 2 }, fov: portrait ? 60 : 52, ease: phase === "jump" ? 3 : 4 }
    },
    focus() {
      return { x: s.x, y: 0, z: s.z }
    },
    setStick(x, y) {
      stick = { x, y }
    },
    key(code, down, keys) {
      const kx = (keys.has("ArrowRight") || keys.has("KeyD") ? 1 : 0) - (keys.has("ArrowLeft") || keys.has("KeyA") ? 1 : 0)
      const ky = (keys.has("ArrowUp") || keys.has("KeyW") ? 1 : 0) - (keys.has("ArrowDown") || keys.has("KeyS") ? 1 : 0)
      stick = { x: kx, y: ky }
      sprint = keys.has("ShiftLeft") || keys.has("ShiftRight")
      if (down && code === "KeyF") run.toggleFloat()
      return true
    },
    drag(dx) {
      camYaw -= dx * 0.008
    },
    toggleFloat() {
      if (phase !== "swim") return
      floating = !floating
      if (floating) s.speed = 0
      emit(true)
    },
    laps(race = false) {
      if (!spot.laps) return
      startLaps(race)
    },
    // a race: the other one's time (park:fx { lap })
    otherLap(name, ms) {
      if (!laps?.race) return
      laps.other = { name, ms }
      emit(true)
    },
    // back to swimming about after laps
    freeSwim() {
      laps = null
      phase = "swim"
      emit(true)
    },
    again() {
      if (laps) startLaps(laps.race, laps.lane)
    },
    subscribe(fn) {
      listeners.add(fn)
      fn(hud())
      return () => listeners.delete(fn)
    },
    get state() {
      return { phase, x: s.x, z: s.z, yaw: s.yaw, speed: s.speed, style: floating ? "float" : style, laps: laps ? { ...laps } : null, splashes, inPool: inPoly(s.x, s.z, spot.poly) }
    },
    stop() {
      if (api?.meBody) api.meBody.drive = null
      listeners.clear()
    },
    // out at the edge nearest you, on the deck
    exit() {
      const e = poolEntry(spot, s.x, s.z)
      return { x: e.x, z: e.z, y: 0, yaw: e.yaw + Math.PI }
    },
    result() {
      return laps?.ms ? { kind: "swim", pool: spot.id, ms: laps.ms, lengths: laps.lengths } : splashes ? { kind: "swim", cannonball: true } : null
    },
  }
  return run
}
