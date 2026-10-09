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
import { createOrbit, orbitDrag, orbitRecenter, orbitRelease, orbitTurn, stepBoom, stepOrbit } from "./walkfeel.js"

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a))

export const FOLLOW = { dist: 4.6, height: 2.35, lookUp: 1.25, ahead: 1.6, minDist: 1.3, swing: 1.6 }

// (an orbit you turn by hand, walkfeel.js: yaw / goalYaw / pitch (here: lift, m) / manual...;
// pos: the lens; rel: where it sits from you { d, off, y }; view: the heading the picture shows)
export const LIFT = { lo: -0.9, hi: 2.4 }
export const createFollow = (yaw = 0) => ({ ...createOrbit(yaw, 0), pos: null, look: null, piv: null, rel: null, off: 0, view: yaw, turned: 0 })

// The lens never sits behind anything solid as seen from your head (a hall's walls, a
// building, a pen's fence below its top) and never above a hall's roof: segmentHit3 tests the
// 3D line from your head to the lens against every box. A wall right behind you (closer than
// minDist) swings the lens round to the side that's open; with no room anywhere it looks down
// from above your head.
const HEAD_Y = 1.55
const GAP = 0.35 // kept between the lens and whatever it would have gone through
const OFFSETS = [0.35, 0.7, 1.05, 1.4, 1.75, 2.1] // radians to either side, nearest first
// (the near plane: a lens 0.1 m from a wall still clips it. With the lens pulled in close, the
// world brings the near plane in to 0.08 m so its corners stay inside this pad: owner,
// 2026-10-09, "able to see through buildings if you get up close to the side")
const PAD = 0.12

// one try at a camera yaw: as far back as `dist` allows, pulled in to the first solid thing,
// or over a low one (a fence) when the roof allows -> { cam, d } or null
const placeAt = (w, yaw, dist, height, maxY, occ, minDist = FOLLOW.minDist, shoulder = 0) => {
  const fx = Math.sin(yaw)
  const fz = Math.cos(yaw)
  // (over the shoulder: the lens a little to the right of straight behind, so you don't hide
  // the room in front of you)
  const sx = -Math.cos(yaw) * shoulder
  const sz = Math.sin(yaw) * shoulder
  const head = { x: w.x, y: (w.y || 0) + HEAD_Y, z: w.z }
  let cam = { x: w.x - fx * dist + sx, y: height, z: w.z - fz * dist + sz }
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
    if (d < minDist) return null
    const k = d / dist
    cam = { x: w.x - fx * d + sx * k, y: Math.min(maxY, height + Math.min(1.6, (dist - d) * 0.45)), z: w.z - fz * d + sz * k }
    hit = occ(head, cam)
  }
  return hit ? null : { cam, d }
}

// where the camera wants to be for a walker at (x, z) facing `yaw`, camera yaw `camYaw`
// (portrait phones: further back and higher, a taller view). roofY: indoors, the highest the
// lens may go. prefer: the side (-1, 0, 1) it swung to last time, tried first so it doesn't
// flip-flop. occ: the occlusion test (the active layout's segmentHit3 by default).
// tight: in a room (a lobby, a locker room): closer and lower, so the camera stays inside
// lift: m higher (+) or lower (-) than the usual height (a drag up or down the picture)
export const followTarget = (w, camYaw, { portrait = false, bodies = [], roofY = null, prefer = 0, occ = null, tight = false, lift = 0 } = {}) => {
  const hit3 = occ || ((a, b) => segmentHit3(a, b, PAD))
  // (a room: closer, lower, over the shoulder, looking further ahead into the room)
  const dist = tight ? 2.3 + (portrait ? 0.6 : 0) : FOLLOW.dist + (portrait ? 1.6 : 0)
  const minDist = tight ? 0.95 : FOLLOW.minDist
  const shoulder = tight ? 0.42 : 0
  const maxY = roofY ?? Infinity
  // (heights from the floor you're on: the ground, a stair, a rooftop terrace)
  const floor = w.y || 0
  const height = Math.min(maxY, floor + Math.max(1.0, (tight ? 1.85 + (portrait ? 0.25 : 0) : FOLLOW.height + (portrait ? 0.9 : 0)) + (tight ? lift * 0.4 : lift)))
  let best = null
  const tryOff = (off) => {
    const p = placeAt(w, camYaw + off, dist, height, maxY, hit3, minDist, shoulder)
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
    if (hit3({ x: w.x, y: floor + HEAD_Y, z: w.z }, cam)) cam = { x: w.x, y: Math.min(maxY, height + 2.2), z: w.z }
  }
  const yaw = camYaw + off
  const ahead = tight ? 3.2 : FOLLOW.ahead
  const look = { x: w.x + Math.sin(yaw) * ahead, y: floor + (tight ? 1.35 : FOLLOW.lookUp), z: w.z + Math.cos(yaw) * ahead }
  const pulled = best ? dist - best.d : dist
  // nobody else in front of the lens (unless stepping round them would put it in a wall)
  const c = clearShot(cam, look, bodies, { near: 1.1, ahead: 2.4, max: 10 })
  const cleared = { x: c.x, y: Math.min(maxY, c.y), z: c.z }
  const ok = c.moved < 1e-6 || !hit3({ x: w.x, y: floor + HEAD_Y, z: w.z }, cleared)
  return { cam: ok ? cleared : cam, look, pulled, cleared: ok ? c.moved : 0, off, open: !!best, ahead, lookY: look.y - floor }
}

// is the lens at `pos` hidden from the walker's head by something solid?
export const lensBlocked = (w, pos, occ = null) => {
  const head = { x: w.x, y: (w.y || 0) + HEAD_Y, z: w.z }
  return occ ? !!occ(head, pos) : !!segmentHit3(head, pos, PAD)
}

// one frame of the follow camera (2026-10-09, the owner: "the camera rotation is interesting,
// that needs to maybe be thought through more"; walkfeel.js has the why):
// - opts.mode "free" (the default): it turns only by your hand (a drag, a fling, a double tap
//   round behind you); "follow": it also comes round behind you while you walk away from it
//   (never sideways or toward it, never right after a drag).
// - it rides with you (no lag of its own behind the body), a little smoothing on the pivot;
// - walls pull it in on a spring, fast in and slow out (no jumps), and it swings to the open
//   side of a wall right behind you gently; if the eased spot would be behind something solid
//   it goes straight to the clear one (the picture never shows through a wall).
// st.turned: the yaw your own hand turned it by this frame (the stick's frame turns with it);
// st.view: the heading the picture shows (the stick's frame when a thumb lands).
export const stepFollow = (st, w, dt, opts = {}) => {
  const floor = w.y || 0
  // (a snap: a new place, back from a court; teleport sets yaw and clears pos)
  if (!st.pos) {
    st.goalYaw = st.yaw
    st.piv = null
    st.rel = null
  }
  st.turned = stepOrbit(st, dt, { walker: w, mode: opts.mode || "free" })
  const t = followTarget(w, st.yaw, { ...opts, lift: st.pitch, prefer: Math.sign(st.off || 0) })
  st.off = t.off
  // the pivot: you, smoothed a touch (steps, stairs)
  if (!st.piv) st.piv = { x: w.x, y: floor, z: w.z }
  else {
    const kp = 1 - Math.exp(-dt * 20)
    const ky = 1 - Math.exp(-dt * 10)
    st.piv.x += (w.x - st.piv.x) * kp
    st.piv.z += (w.z - st.piv.z) * kp
    st.piv.y += (floor - st.piv.y) * ky
    // (never more than a step behind)
    const gx = w.x - st.piv.x
    const gz = w.z - st.piv.z
    const g = Math.hypot(gx, gz)
    if (g > 0.25) {
      st.piv.x = w.x - (gx / g) * 0.25
      st.piv.z = w.z - (gz / g) * 0.25
    }
  }
  // where the target lens sits from you: how far, turned how far from straight behind, how high
  const rx = t.cam.x - w.x
  const rz = t.cam.z - w.z
  const td = Math.hypot(rx, rz)
  const tOff = td > 0.05 ? wrap(Math.atan2(-rx, -rz) - st.yaw) : 0
  const ty = t.cam.y - floor
  if (!st.rel) st.rel = { d: td, off: tOff, y: ty }
  else {
    st.rel.d = stepBoom(st.rel.d, td, dt)
    st.rel.off = wrap(st.rel.off + wrap(tOff - st.rel.off) * (1 - Math.exp(-dt * 8)))
    st.rel.y += (ty - st.rel.y) * (1 - Math.exp(-dt * 12))
  }
  const a = st.yaw + st.rel.off
  st.view = wrap(a)
  const px = st.piv.x - Math.sin(a) * st.rel.d
  const pz = st.piv.z - Math.cos(a) * st.rel.d
  let py = st.piv.y + st.rel.y
  if (opts.roofY != null && py > opts.roofY) py = opts.roofY
  if (!st.pos) st.pos = { x: px, y: py, z: pz }
  else {
    st.pos.x = px
    st.pos.y = py
    st.pos.z = pz
  }
  if (!st.look) st.look = { x: 0, y: 0, z: 0 }
  st.look.x = st.piv.x + Math.sin(a) * t.ahead
  st.look.y = st.piv.y + t.lookY
  st.look.z = st.piv.z + Math.cos(a) * t.ahead
  // (the eased spot is checked again: never behind a wall, a fence or a roof; if it would be, it
  // goes straight to the clear spot)
  if (lensBlocked(w, st.pos, opts.occ)) {
    st.pos.x = t.cam.x
    st.pos.y = t.cam.y
    st.pos.z = t.cam.z
    st.rel.d = td
    st.rel.off = tOff
    st.rel.y = ty
  }
  const c = clearShot(st.pos, st.look, opts.bodies || [], { near: 1.1, ahead: 2.4, max: 10 })
  if (c.moved > 1e-6) {
    const cp = { x: c.x, y: opts.roofY != null ? Math.min(opts.roofY, c.y) : c.y, z: c.z }
    if (!lensBlocked(w, cp, opts.occ)) st.pos = cp
  }
  return st
}
// a turn by hand (radians: a key, a button)
export const turnFollow = (st, delta) => orbitTurn(st, delta)
// a finger or the mouse dragging the picture (px); size { w, h }; now ms
export const dragFollow = (st, dx, dy, size, now) => orbitDrag(st, dx, dy, size, now, { lo: LIFT.lo, hi: LIFT.hi, pitchRate: 0.012 })
export const releaseFollow = (st, now) => orbitRelease(st, now)
// a double tap: round behind you (the way you face)
export const recenterFollow = (st, w) => orbitRecenter(st, w.yaw)

// ---------- watching a court ----------
export const SPECTATE_ANGLES = ["Sideline", "Baseline", "High"]

// court: a COURTS entry; angle: 0..2; bodies: players and people sitting nearby (world
// positions, { x, z, h? }). -> { cam, look, fov, name }
// (a phone held upright looks down the court first: the sideline view is too wide for it)
const ORDER = { wide: [0, 1, 2], tall: [1, 0, 2] }
export const angleName = (angle = 0, portrait = false) => SPECTATE_ANGLES[(portrait ? ORDER.tall : ORDER.wide)[((angle % 3) + 3) % 3]]
export const spectatorShot = (court, angle = 0, bodies = [], { portrait = false, maxY = null, isClear = null, score = null } = {}) => {
  // (in the court's own axes: u along it, v toward the spectators' side; Riverside: u east,
  // v toward the path)
  const u = court.u || { x: 1, z: 0 }
  const v0 = court.view || { x: 0, z: -(court.side ?? 1) }
  const hz = court.hz ?? PEN.hz
  // (a real venue: if a building or a wall is between the court and the lens, try the other
  // side, then come in closer)
  const tries = isClear ? [[1, 1, 1], [-1, 1, 1], [1, -1, 1], [-1, -1, 1], [1, 1, 0.75], [-1, -1, 0.75], [-1, 1, 0.75], [1, -1, 0.75], [1, 1, 0.5], [-1, -1, 0.5], [-1, 1, 0.5], [1, -1, 0.5], [1, 1, 0.3], [-1, -1, 0.3], [-1, 1, 0.3], [1, -1, 0.3], [1, 1, 0.1], [-1, -1, 0.1], [-1, 1, 0.1], [1, -1, 0.1]] : [[1, 1, 1]]
  let best = null
  // (none clear: the one that sees the most of the court, score(cam) 0..1, if we can tell)
  let most = null
  for (const [sv, se, k] of tries) {
    const shot = framing(court, angle, { u, v: { x: v0.x * sv, z: v0.z * sv }, hz, se, k, portrait, maxY })
    if (!isClear || isClear(shot.cam)) {
      best = shot
      break
    }
    if (score) {
      const s = score(shot.cam)
      if (!most || s > most.s) most = { s, shot }
    }
  }
  if (!best && most && most.s > 0) best = most.shot
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
