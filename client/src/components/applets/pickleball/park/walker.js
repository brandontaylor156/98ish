// My Park: walking your own athlete (pure; Node-tested). Only your hand moves you: the move
// pad (or keys) says which way relative to the camera and how hard, and this turns that into
// a speed you build up and lose like a person (no walking for you, no paths, no
// auto-run: the owner's rule).
//
// The stick (2026-10-09, "so hard to control walking around"): past a small dead zone a light
// push walks, slow to brisk as you push; further jogs; all the way and held a moment, a run.
// A sprint only with Shift (a keyboard): a phone's thumb never bolts off by accident. The stick
// moves you the way the camera looks; the camera only swings round behind you when you walk
// away from it (followcam.js), so holding the stick sideways walks a straight line across the
// screen instead of a circle.

import { heightAt, resolve } from "./layout.js"
import { STICK, steerVelocity, turnFacing } from "./walkfeel.js"

// (snappier 2026-10-09, the owner: "I move, he doesn't, he lags": a light push already walks
// briskly, you're up to speed in about a third of a second, and a full push runs almost at once)
export const SPEEDS = { walk: 1.7, jog: 3.4, run: 4.6, sprint: 6.2 }
export const ACCEL = 18 // m/s^2 speeding up
export const DECEL = 26 // m/s^2 slowing down (a run stops in ~0.2 s)
export const SPRINT_AFTER = 0.25 // s at a full push before a run
export const DEAD = STICK.DEAD // the stick's dead zone (of its reach)
export const RADIUS = 0.35

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a))

// (y: the height of what you stand on: the ground, a stair, a rooftop terrace)
// (want: the velocity the push asks for, so the body's animation can look ahead)
export const createWalker = (x, z, yaw = 0, y = 0) => ({ x, z, y, yaw, vx: 0, vz: 0, speed: 0, full: 0, gait: "stand", want: { x: 0, z: 0 } })

// how fast the push asks for: magnitude 0..1 -> m/s
export const speedFor = (mag, { sprint = false, full = 0 } = {}) => {
  if (mag < DEAD) return 0
  if (sprint) return SPEEDS.sprint
  // (past the dead zone, 0..1)
  const m = Math.min(1, (mag - DEAD) / (1 - DEAD))
  if (m < 0.35) return 1.1 + (SPEEDS.walk - 1.1) * (m / 0.35)
  if (m < 0.75) return SPEEDS.walk + (SPEEDS.jog - SPEEDS.walk) * ((m - 0.35) / 0.4)
  return full >= SPRINT_AFTER ? SPEEDS.run : SPEEDS.jog
}

export const gaitOf = (speed) => (speed < 0.15 ? "stand" : speed < 2 ? "walk" : speed < 4.6 ? "jog" : "sprint")

// one step. input: { x (right), y (up the pad / forward), sprint }, camYaw: which way the
// camera looks (forward = up the pad). Returns the walker (changed in place).
export const stepWalker = (w, input, camYaw, dt) => {
  let px = input?.x || 0
  let py = input?.y || 0
  let mag = Math.hypot(px, py)
  if (mag > 1) {
    px /= mag
    py /= mag
    mag = 1
  }
  w.full = mag >= STICK.RUN ? w.full + dt : 0
  const want = speedFor(mag, { sprint: !!input?.sprint && mag > DEAD, full: w.full })
  // the camera's frame: forward (sin, cos) and right (-cos, sin) (anim.js frame())
  const fx = Math.sin(camYaw)
  const fz = Math.cos(camYaw)
  const rx = -Math.cos(camYaw)
  const rz = Math.sin(camYaw)
  let dx = fx * py + rx * px
  let dz = fz * py + rz * px
  const dl = Math.hypot(dx, dz)
  if (dl > 1e-6) {
    dx /= dl
    dz /= dl
  }
  const tvx = dx * want
  const tvz = dz * want
  // the speed the new way builds quickly; what still goes across or against it goes much faster
  // (walkfeel.js: a turn or a reversal answers at once. Owner: "switching directions takes a few
  // seconds to register")
  steerVelocity(w, tvx, tvz, dt, { accel: ACCEL, decel: DECEL })
  if (!w.want) w.want = { x: 0, z: 0 }
  w.want.x = tvx
  w.want.z = tvz
  // you face where you push (quick, not a snap), not where your momentum still carries you
  if (want > 0 && dl > 1e-6) w.yaw = turnFacing(w.yaw, Math.atan2(dx, dz), dt)
  const nx = w.x + w.vx * dt
  const nz = w.z + w.vz * dt
  const y = w.y || 0
  let p = resolve(nx, nz, RADIUS, y)
  // (up the stairs, along a deck; off a deck's edge where there's no railing: nothing to
  // stand on, so you slide along the edge, or stay put)
  let h = heightAt(p.x, p.z, y)
  if (h === null) {
    for (const q of [resolve(nx, w.z, RADIUS, y), resolve(w.x, nz, RADIUS, y)]) {
      const hq = heightAt(q.x, q.z, y)
      if (hq !== null) {
        p = q
        h = hq
        break
      }
    }
  }
  if (h === null) p = { x: w.x, z: w.z }
  else w.y = h
  // (sliding along a fence: what the fence took away is gone from the speed too)
  if (dt > 0) {
    const ax = (p.x - w.x) / dt
    const az = (p.z - w.z) / dt
    if (Math.hypot(p.x - nx, p.z - nz) > 1e-4) {
      w.vx = ax
      w.vz = az
    }
  }
  w.x = p.x
  w.z = p.z
  w.speed = Math.hypot(w.vx, w.vz)
  // (moving without a push of your own, sliding to a stop: face the way you go)
  if (want <= 0 && w.speed > 0.3) w.yaw = turnFacing(w.yaw, Math.atan2(w.vx, w.vz), dt)
  w.gait = gaitOf(w.speed)
  return w
}

// separation from other people nearby (so you can't walk through anyone): pushes w out
export const keepApart = (w, others, r = 0.55) => {
  for (const o of others) {
    const dx = w.x - o.x
    const dz = w.z - o.z
    const d = Math.hypot(dx, dz)
    if (d >= r || d < 1e-6) continue
    const push = r - d
    const p = resolve(w.x + (dx / d) * push, w.z + (dz / d) * push, RADIUS, w.y || 0)
    const h = heightAt(p.x, p.z, w.y || 0)
    if (h === null) continue
    w.x = p.x
    w.z = p.z
    w.y = h
  }
  return w
}

export { wrap }
