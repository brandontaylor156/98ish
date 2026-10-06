// My Park: the cameras (pure; Node-tested).
// - followShot: third person, behind and above you. It swings round behind you as you walk
//   (slowly, and not when you walk toward it), never ends up behind a fence, a wall or a
//   building or above a hall's roof (it comes in closer, up over a fence's top, or round to
//   the open side), and never has anyone else right in front of the lens (camera.js clearShot).
// - spectatorShot: watching a court from its bleachers (a few angles, Cam cycles), clear of
//   the players and the people sitting near the lens.

import { clearShot } from "../camera.js"
import { HALF_L, HALF_W } from "../physics.js"
import { PEN, segmentHit3 } from "./layout.js"

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a))

export const FOLLOW = { dist: 4.6, height: 2.35, lookUp: 1.25, ahead: 1.6, minDist: 1.3, swing: 1.6 }

export const createFollow = (yaw = 0) => ({ yaw, pos: null, look: null, dist: FOLLOW.dist, drag: 0, off: 0 })

// The lens never sits behind anything solid as seen from your head (a hall's walls, a
// building, a pen's fence below its top) and never above a hall's roof: segmentHit3 tests the
// 3D line from your head to the lens against every box. A wall right behind you (closer than
// minDist) swings the lens round to the side that's open; with no room anywhere it looks down
// from above your head.
const HEAD_Y = 1.55
const GAP = 0.35 // kept between the lens and whatever it would have gone through
const OFFSETS = [0.35, 0.7, 1.05, 1.4, 1.75, 2.1] // radians to either side, nearest first
const PAD = 0.12 // (the near plane: a lens 0.1 m from a wall still clips it)

// one try at a camera yaw: as far back as `dist` allows, pulled in to the first solid thing,
// or over a low one (a fence) when the roof allows -> { cam, d } or null
const placeAt = (w, yaw, dist, height, maxY, occ) => {
  const fx = Math.sin(yaw)
  const fz = Math.cos(yaw)
  const head = { x: w.x, y: HEAD_Y, z: w.z }
  let cam = { x: w.x - fx * dist, y: height, z: w.z - fz * dist }
  let hit = occ(head, cam)
  if (!hit) return { cam, d: dist }
  // a fence (not a wall): up over its top, if there's room under the roof
  if (hit.h < 4.5 && hit.h + 0.6 <= maxY) {
    const over = { ...cam, y: Math.max(height, hit.h + 0.6) }
    if (!occ(head, over)) return { cam: over, d: dist }
  }
  // come in closer (and a little higher, so you don't fill the screen), until it's clear
  let d = dist
  for (let i = 0; i < 4 && hit; i++) {
    d = d * hit.t - GAP
    if (d < FOLLOW.minDist) return null
    cam = { x: w.x - fx * d, y: Math.min(maxY, height + Math.min(1.6, (dist - d) * 0.45)), z: w.z - fz * d }
    hit = occ(head, cam)
  }
  return hit ? null : { cam, d }
}

// where the camera wants to be for a walker at (x, z) facing `yaw`, camera yaw `camYaw`
// (portrait phones: further back and higher, a taller view). roofY: indoors, the highest the
// lens may go. prefer: the side (-1, 0, 1) it swung to last time, tried first so it doesn't
// flip-flop. occ: the occlusion test (the active layout's segmentHit3 by default).
// tight: in a room (a lobby, a locker room): closer and lower, so the camera stays inside
export const followTarget = (w, camYaw, { portrait = false, bodies = [], roofY = null, prefer = 0, occ = null, tight = false } = {}) => {
  const hit3 = occ || ((a, b) => segmentHit3(a, b, PAD))
  const dist = tight ? 2.7 + (portrait ? 0.8 : 0) : FOLLOW.dist + (portrait ? 1.6 : 0)
  const maxY = roofY ?? Infinity
  const height = Math.min(maxY, tight ? 2.0 + (portrait ? 0.3 : 0) : FOLLOW.height + (portrait ? 0.9 : 0))
  let best = null
  const tryOff = (off) => {
    const p = placeAt(w, camYaw + off, dist, height, maxY, hit3)
    if (!p) return
    // (score: as far back as it can, the least turned)
    const score = p.d - Math.abs(off) * 2.2
    if (!best || score > best.score) best = { ...p, off, score }
  }
  tryOff(0)
  if (!best || best.d < dist * 0.6) {
    const first = prefer < 0 ? -1 : 1
    for (const o of OFFSETS) {
      tryOff(o * first)
      tryOff(-o * first)
      if (best && best.d >= dist * 0.85) break
    }
  }
  let cam
  let off = 0
  if (best) {
    cam = best.cam
    off = best.off
  } else {
    // nowhere: look down from just above your head
    cam = { x: w.x - Math.sin(camYaw) * 0.2, y: Math.min(maxY, height + 2.2), z: w.z - Math.cos(camYaw) * 0.2 }
    if (hit3({ x: w.x, y: HEAD_Y, z: w.z }, cam)) cam = { x: w.x, y: Math.min(maxY, height + 2.2), z: w.z }
  }
  const yaw = camYaw + off
  const look = { x: w.x + Math.sin(yaw) * FOLLOW.ahead, y: FOLLOW.lookUp, z: w.z + Math.cos(yaw) * FOLLOW.ahead }
  const pulled = best ? dist - best.d : dist
  // nobody else in front of the lens (unless stepping round them would put it in a wall)
  const c = clearShot(cam, look, bodies, { near: 1.1, ahead: 2.4, max: 10 })
  const cleared = { x: c.x, y: Math.min(maxY, c.y), z: c.z }
  const ok = c.moved < 1e-6 || !hit3({ x: w.x, y: HEAD_Y, z: w.z }, cleared)
  return { cam: ok ? cleared : cam, look, pulled, cleared: ok ? c.moved : 0, off, open: !!best }
}

// is the lens at `pos` hidden from the walker's head by something solid?
export const lensBlocked = (w, pos) => !!segmentHit3({ x: w.x, y: HEAD_Y, z: w.z }, pos, PAD)

// one frame of the follow camera: swing round behind a walker who's walking away from the
// camera, ease toward the target. drag: the camera turned by hand (a finger or mouse drag)
// holds off the swing for a moment.
export const stepFollow = (st, w, dt, opts = {}) => {
  st.drag = Math.max(0, st.drag - dt)
  if (w.speed > 0.5 && st.drag <= 0) {
    const d = wrap(w.yaw - st.yaw)
    // (walking toward the camera: leave it; sideways: swing slowly; away: follow)
    const away = Math.cos(d)
    if (away > -0.35) st.yaw += d * Math.min(1, dt * FOLLOW.swing * Math.min(1, w.speed / 2.5) * (0.35 + 0.65 * Math.max(0, away)))
  }
  st.yaw = wrap(st.yaw)
  const t = followTarget(w, st.yaw, { ...opts, prefer: Math.sign(st.off || 0) })
  st.off = t.off
  const k = st.pos ? 1 - Math.exp(-dt * 7) : 1
  st.pos = st.pos ? { x: st.pos.x + (t.cam.x - st.pos.x) * k, y: st.pos.y + (t.cam.y - st.pos.y) * k, z: st.pos.z + (t.cam.z - st.pos.z) * k } : { ...t.cam }
  const kl = st.look ? 1 - Math.exp(-dt * 9) : 1
  st.look = st.look ? { x: st.look.x + (t.look.x - st.look.x) * kl, y: st.look.y + (t.look.y - st.look.y) * kl, z: st.look.z + (t.look.z - st.look.z) * kl } : { ...t.look }
  // (the eased position is checked again: never behind a wall, a fence or a roof while it
  // eases; if it would be, it goes straight to the clear spot)
  if (opts.roofY != null && st.pos.y > opts.roofY) st.pos.y = opts.roofY
  if (lensBlocked(w, st.pos)) st.pos = { ...t.cam }
  const c = clearShot(st.pos, st.look, opts.bodies || [], { near: 1.1, ahead: 2.4, max: 10 })
  const cp = { x: c.x, y: opts.roofY != null ? Math.min(opts.roofY, c.y) : c.y, z: c.z }
  if (c.moved < 1e-6 || !lensBlocked(w, cp)) st.pos = cp
  return st
}
// a drag turns the camera round you (radians), and holds the auto-swing off a moment
export const turnFollow = (st, delta) => {
  st.yaw = wrap(st.yaw + delta)
  st.drag = 1.6
}

// ---------- watching a court ----------
export const SPECTATE_ANGLES = ["Sideline", "Baseline", "High"]

// court: a COURTS entry; angle: 0..2; bodies: players and people sitting nearby (world
// positions, { x, z, h? }). -> { cam, look, fov, name }
// (a phone held upright looks down the court first: the sideline view is too wide for it)
const ORDER = { wide: [0, 1, 2], tall: [1, 0, 2] }
export const angleName = (angle = 0, portrait = false) => SPECTATE_ANGLES[(portrait ? ORDER.tall : ORDER.wide)[((angle % 3) + 3) % 3]]
export const spectatorShot = (court, angle = 0, bodies = [], { portrait = false, maxY = null, isClear = null } = {}) => {
  // (in the court's own axes: u along it, v toward the spectators' side; Riverside: u east,
  // v toward the path)
  const u = court.u || { x: 1, z: 0 }
  const v0 = court.view || { x: 0, z: -(court.side ?? 1) }
  const hz = court.hz ?? PEN.hz
  // (a real venue: if a building or a wall is between the court and the lens, try the other
  // side, then come in closer)
  const tries = isClear ? [[1, 1, 1], [-1, 1, 1], [1, -1, 1], [-1, -1, 1], [1, 1, 0.75], [-1, -1, 0.75], [1, 1, 0.5], [1, 1, 0.3]] : [[1, 1, 1]]
  let best = null
  for (const [sv, se, k] of tries) {
    const shot = framing(court, angle, { u, v: { x: v0.x * sv, z: v0.z * sv }, hz, se, k, portrait, maxY })
    if (!isClear || isClear(shot.cam)) {
      best = shot
      break
    }
  }
  if (!best) best = framing(court, angle, { u, v: v0, hz, se: 1, k: 0.3, portrait, maxY })
  const c = clearShot(best.cam, best.look, bodies, { near: 1.6, ahead: 3.2 })
  return { cam: { x: c.x, y: c.y, z: c.z }, look: best.look, fov: best.fov, name: SPECTATE_ANGLES[best.a], moved: c.moved, width: HALF_W }
}
// one framing of the three angles: se flips the baseline end, k scales the distance out
const framing = (court, angle, { u, v, hz, se = 1, k = 1, portrait, maxY }) => {
  const at = (a, b, y) => ({ x: court.x + u.x * a + v.x * b, y, z: court.z + u.z * a + v.z * b })
  const a = (portrait ? ORDER.tall : ORDER.wide)[((angle % 3) + 3) % 3]
  let cam
  let look
  let fov
  if (a === 0) {
    // from behind the bleachers, up over the fence: the whole court side on, a little to one
    // side of the net
    cam = at(1.5, (hz + 4.2 + (portrait ? 4.5 : 0)) * k, portrait ? 8.5 : 4.7)
    look = at(0, -0.3, 0.2)
    fov = portrait ? 64 : 52
  } else if (a === 1) {
    // behind a baseline, high enough to see over the near players
    const e = (court.baseE ?? (court.x >= 0 ? 1 : -1)) * se
    cam = at(e * (HALF_L + (4.4 + (portrait ? 3 : 0)) * k), 0.6, portrait ? 5.6 : 4.4)
    look = at(-e * 1.0, 0, 0.2)
    fov = portrait ? 64 : 48
  } else {
    // high over the bleachers: the whole court
    cam = at(-1.5, (hz + 4.5 + (portrait ? 2 : 0)) * k, portrait ? 11 : 8.5)
    look = at(0, -0.4, 0)
    fov = portrait ? 62 : 46
  }
  if (maxY !== null && cam.y > maxY) cam = { ...cam, y: maxY }
  return { cam, look, fov, a }
}
