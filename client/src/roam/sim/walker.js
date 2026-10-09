// Roam: you on foot. Pure; Node-tested (roam.test.js). Moved only by your own hand (the
// owner's rule: nothing moves your player for you): the stick or keys (Shift sprints).
//
// The stick is turned by the camera's heading (up the stick = away from the camera). A push
// past the 15% dead zone walks (0.8-1.6 m/s), further jogs (to 3.8), and pushed all the way
// out it runs (6.8): there's no Run button (the owner: "The 'run' button is kinda useless").
// The ground's height comes from the town (terrain, bridge decks); walls push you along them.

export const DEAD = 0.15
export const SPEED = { walk: 1.6, jog: 3.8, sprint: 6.8 }
// (the push, past the dead zone, where jogging starts, where running starts, and where it's full)
const JOG_AT = 0.5
const RUN_AT = 0.8
const ACCEL = 9
const DECEL = 13
const TURN = 10 // rad/s toward where you're going
export const RADIUS = 0.35

export const createWalker = (x = 0, z = 0, yaw = 0) => ({ x, z, y: 0, yaw, vx: 0, vz: 0, speed: 0, gait: "stand" })

// the speed a push asks for -> m/s
export const targetSpeed = (m, sprint) => {
  if (m < DEAD) return 0
  if (sprint) return SPEED.sprint
  const k = Math.min(1, (m - DEAD) / (1 - DEAD))
  if (k < JOG_AT) return 0.8 + (SPEED.walk - 0.8) * (k / JOG_AT)
  if (k < RUN_AT) return SPEED.walk + (SPEED.jog - SPEED.walk) * ((k - JOG_AT) / (RUN_AT - JOG_AT))
  // (the last of the push: up to a run, all the way out)
  return SPEED.jog + (SPEED.sprint - SPEED.jog) * Math.min(1, (k - RUN_AT) / (0.97 - RUN_AT))
}

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a))

// input: { x, y, sprint } (x right, y up the stick, each -1..1); camYaw: the camera's heading
// world: { resolve(x, z, r) -> { x, z }, heightAt(x, z, y) -> m }
export const stepWalker = (w, input, camYaw, dt, world = null) => {
  let ix = input.x || 0
  let iy = input.y || 0
  const m = Math.min(1, Math.hypot(ix, iy))
  const want = targetSpeed(m, !!input.sprint)
  // the direction in the world: up the stick = the camera's forward (sin, cos); right = (-cos, sin)
  let dx = 0
  let dz = 0
  if (want > 0) {
    const l = Math.hypot(ix, iy) || 1
    ix /= l
    iy /= l
    dx = Math.sin(camYaw) * iy - Math.cos(camYaw) * ix
    dz = Math.cos(camYaw) * iy + Math.sin(camYaw) * ix
  }
  const tvx = dx * want
  const tvz = dz * want
  const rate = want > w.speed ? ACCEL : DECEL
  const ddx = tvx - w.vx
  const ddz = tvz - w.vz
  const dl = Math.hypot(ddx, ddz)
  const step = rate * dt
  if (dl <= step) {
    w.vx = tvx
    w.vz = tvz
  } else {
    w.vx += (ddx / dl) * step
    w.vz += (ddz / dl) * step
  }
  let nx = w.x + w.vx * dt
  let nz = w.z + w.vz * dt
  if (world?.resolve) {
    const p = world.resolve(nx, nz, RADIUS)
    if (p.hit) {
      // (slide: what pushed into the wall is gone, what ran along it stays)
      const vn = w.vx * p.nx + w.vz * p.nz
      if (vn < 0) {
        w.vx -= vn * p.nx
        w.vz -= vn * p.nz
      }
    }
    nx = p.x
    nz = p.z
  }
  w.x = nx
  w.z = nz
  w.speed = Math.hypot(w.vx, w.vz)
  if (w.speed > 0.25) {
    const face = Math.atan2(w.vx, w.vz)
    const d = wrap(face - w.yaw)
    const turn = TURN * dt
    w.yaw = wrap(w.yaw + Math.max(-turn, Math.min(turn, d)))
  }
  if (world?.heightAt) {
    const h = world.heightAt(w.x, w.z, w.y)
    if (Number.isFinite(h)) w.y = h
  }
  w.gait = w.speed < 0.1 ? "stand" : w.speed < 2 ? "walk" : w.speed < 5 ? "jog" : "sprint"
  return w
}
