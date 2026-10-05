// My Park: walking your own athlete (pure; Node-tested). Only your hand moves you: the move
// pad (or keys) says which way relative to the camera and how hard, and this turns that into
// a speed you build up and lose like a person (no walking for you, no paths, no
// auto-run: the owner's rule).
//
// The pad pushed a little: a walk; most of the way: a jog; all the way (or Shift) and held:
// a sprint.

import { resolve } from "./layout.js"

export const SPEEDS = { walk: 1.45, jog: 3.1, run: 4.3, sprint: 6.2 }
export const ACCEL = 7 // m/s^2 speeding up
export const DECEL = 11 // m/s^2 slowing down
export const SPRINT_AFTER = 0.9 // s at full push before a sprint
export const RADIUS = 0.35

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a))

export const createWalker = (x, z, yaw = 0) => ({ x, z, yaw, vx: 0, vz: 0, speed: 0, full: 0, gait: "stand" })

// how fast the push asks for: magnitude 0..1 -> m/s
export const speedFor = (mag, { sprint = false, full = 0 } = {}) => {
  if (mag < 0.12) return 0
  if (sprint || (mag > 0.93 && full >= SPRINT_AFTER)) return SPEEDS.sprint
  if (mag < 0.55) return SPEEDS.walk * Math.min(1, 0.45 + (mag - 0.12) / 0.43 * 0.55)
  if (mag < 0.93) return SPEEDS.jog
  return SPEEDS.run
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
  w.full = mag > 0.93 || input?.sprint ? w.full + dt : 0
  const want = speedFor(mag, { sprint: !!input?.sprint && mag > 0.12, full: w.full })
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
  // speed up / slow down toward that like a body would
  const ex = tvx - w.vx
  const ez = tvz - w.vz
  const el = Math.hypot(ex, ez)
  const rate = (want < w.speed ? DECEL : ACCEL) * dt
  if (el <= rate) {
    w.vx = tvx
    w.vz = tvz
  } else {
    w.vx += (ex / el) * rate
    w.vz += (ez / el) * rate
  }
  const nx = w.x + w.vx * dt
  const nz = w.z + w.vz * dt
  const p = resolve(nx, nz, RADIUS)
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
  if (w.speed > 0.3) w.yaw = Math.atan2(w.vx, w.vz)
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
    const p = resolve(w.x + (dx / d) * push, w.z + (dz / d) * push, RADIUS)
    w.x = p.x
    w.z = p.z
  }
  return w
}

export { wrap }
