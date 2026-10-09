// My Park > Hot tub (the activity kit's run shape: park/acts/; world.js setActivity). You sit in
// the venue's real hot tub (leisure/spots.js: Los Cab's, by the 50 m pool): on the bench inside,
// shoulders at the water, arms out along the rim; the water bubbles and steams (water.js), the
// camera drifts slowly round, the hangout's lo-fi plays (park/chillmusic.js, through
// useLeisure.jsx). With your partner: two seats side by side (together.js "tub").
//
//   createTubRun({ spot, side, seat, pal, taken })

import { ACTS } from "../interp.js"
import { tubPose } from "./poses.js"

// the seat for you: one asked for, else the free one nearest where you stepped in
export const pickTubSeat = (spot, from, taken = () => false, want = null) => {
  if (want) {
    const s = spot.seats.find((q) => q.id === want)
    if (s) return s
  }
  const free = spot.seats.filter((q) => !taken(q))
  const list = free.length ? free : spot.seats
  return [...list].sort((a, b) => Math.hypot(a.x - from.x, a.z - from.z) - Math.hypot(b.x - from.x, b.z - from.z))[0]
}
// two seats side by side for the two of you (round the tub: neighbours)
export const tubPair = (spot, from, taken = () => false) => {
  const n = spot.seats.length
  let best = null
  for (let i = 0; i < n; i++) {
    const a = spot.seats[i]
    const b = spot.seats[(i + 1) % n]
    if (taken(a) || taken(b)) continue
    const d = Math.hypot(a.x - from.x, a.z - from.z)
    if (!best || d < best.d) best = { d, ids: [a.id, b.id] }
  }
  return best ? best.ids : null
}

export const SEAT_Y = 0.02

export const createTubRun = ({ spot, side, seat = null, pal = null, from = null } = {}) => {
  let api = null
  const listeners = new Set()
  let t = 0
  let lastHud = ""
  let hudT = 0
  let note = null
  const s = seat || spot.seats[0]
  // (the camera drifts round the tub, starting behind you)
  let orbit = Math.atan2(s.x - spot.x, s.z - spot.z) + 0.5
  const say = (text, sec = 2.4) => {
    note = { text, until: t + sec }
    emit(true)
  }
  const hud = () => ({ kind: "tub", title: spot.name, pal: pal ? pal.name : null, note: note && t < note.until ? note.text : null, seat: s.id })
  const emit = (force = false) => {
    const h = hud()
    const k = JSON.stringify(h)
    if (!force && k === lastHud) return
    lastHud = k
    for (const fn of listeners) fn(h)
  }
  const look = { x: spot.x, y: 0.75, z: spot.z }
  const run = {
    kind: "tub",
    spot,
    start(a) {
      api = a
      api.meBody.drive = () => ({ pose: tubPose({ x: s.x, y: SEAT_Y, z: s.z, yaw: s.yaw }, look, { rim: spot.rim, t }), gear: "none", key: "tub" })
      say(pal ? `In the hot tub with ${pal.name}.` : "Ahh. Sit back and relax.", 3)
    },
    step(dt) {
      t += dt
      orbit += dt * 0.045
      hudT += dt
      if (hudT > 0.3) {
        hudT = 0
        emit()
      }
    },
    me() {
      return { x: s.x, z: s.z, y: 0, yaw: s.yaw, vx: 0, vz: 0 }
    },
    netAct: () => ACTS.tub,
    // a relaxed camera: low, a few metres out, slowly drifting round, the steam and you in it
    shot(dt, { portrait = true } = {}) {
      const r = spot.R + (portrait ? 3.6 : 2.8)
      const cam = { x: spot.x + Math.sin(orbit) * r, y: portrait ? 2.3 : 1.7, z: spot.z + Math.cos(orbit) * r }
      return { cam, look: { x: (s.x + spot.x) / 2, y: portrait ? 0.35 : 0.7, z: (s.z + spot.z) / 2 }, fov: portrait ? 58 : 48, ease: 1.5 }
    },
    focus() {
      return { x: spot.x, y: 0, z: spot.z }
    },
    setStick() {},
    key() {
      return false
    },
    drag(dx) {
      orbit -= dx * 0.008
    },
    subscribe(fn) {
      listeners.add(fn)
      fn(hud())
      return () => listeners.delete(fn)
    },
    get state() {
      return { seat: s.id, x: s.x, z: s.z }
    },
    stop() {
      if (api?.meBody) api.meBody.drive = null
      listeners.clear()
    },
    // out over the rim, onto the deck where you got in
    exit() {
      const at = spot.at || from || { x: spot.x, z: spot.z + spot.R + 0.8, yaw: 0 }
      return { x: at.x, z: at.z, y: 0, yaw: (at.yaw ?? 0) + Math.PI }
    },
    result() {
      return { kind: "tub", soaked: Math.round(t) }
    },
  }
  return run
}
