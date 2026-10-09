// Roam: you on foot. Pure; Node-tested (roam.test.js). Moved only by your own hand (the
// owner's rule: nothing moves your player for you): the stick or keys (Shift sprints).
//
// The stick is turned by the camera's heading (up the stick = away from the camera). A push
// past the 12% dead zone walks (1.2-1.8 m/s), further jogs (to 4.2), and pushed (nearly) all the
// way out it runs (6.8): there's no Run button (the owner: "The 'run' button is kinda useless").
// The ground's height comes from the town (terrain, bridge decks); walls push you along them.
// Turning, reversing and facing come from the shared walking feel (pickleball/park/walkfeel.js):
// the new way builds fast, the old way goes faster, and you face where you push in ~0.14 s.

import { STICK, steerVelocity, turnFacing } from "../../components/applets/pickleball/park/walkfeel.js"

export const DEAD = STICK.DEAD
export const SPEED = { walk: 1.8, jog: 4.2, sprint: 6.8 }
// (the push, past the dead zone, where jogging starts and where running starts; a run all the way
// up by STICK.RUN of the reach). Snappy (owner, 2026-10-09: "I move, he doesn't, he lags"): a small
// push already walks briskly, half way jogs, and you're up to speed in about a third of a second.
const JOG_AT = 0.35
const RUN_AT = 0.65
const FULL_AT = (STICK.RUN - DEAD) / (1 - DEAD)
const ACCEL = 20
const DECEL = 30
export const RADIUS = 0.35

export const createWalker = (x = 0, z = 0, yaw = 0) => ({ x, z, y: 0, yaw, vx: 0, vz: 0, speed: 0, gait: "stand", want: { x: 0, z: 0 } })

// the speed a push asks for -> m/s
export const targetSpeed = (m, sprint) => {
  if (m < DEAD) return 0
  if (sprint) return SPEED.sprint
  const k = Math.min(1, (m - DEAD) / (1 - DEAD))
  if (k < JOG_AT) return 1.2 + (SPEED.walk - 1.2) * (k / JOG_AT)
  if (k < RUN_AT) return SPEED.walk + (SPEED.jog - SPEED.walk) * ((k - JOG_AT) / (RUN_AT - JOG_AT))
  // (the last of the push: up to a run, all the way out)
  return SPEED.jog + (SPEED.sprint - SPEED.jog) * Math.min(1, (k - RUN_AT) / (FULL_AT - RUN_AT))
}

// input: { x, y, sprint } (x right, y up the stick, each -1..1); camYaw: the stick's frame (the
// camera's heading when the thumb landed)
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
  // (a new direction answers at once: the old way's speed goes fast and the new way's builds,
  // instead of braking to a stop and building again. Owner: "switching directions takes a few seconds")
  steerVelocity(w, tvx, tvz, dt, { accel: ACCEL, decel: DECEL })
  if (!w.want) w.want = { x: 0, z: 0 }
  w.want.x = tvx
  w.want.z = tvz
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
  // you face where you push (quick, not a snap); sliding to a stop, the way you go
  if (want > 0) w.yaw = turnFacing(w.yaw, Math.atan2(dx, dz), dt)
  else if (w.speed > 0.25) w.yaw = turnFacing(w.yaw, Math.atan2(w.vx, w.vz), dt)
  if (world?.heightAt) {
    const h = world.heightAt(w.x, w.z, w.y)
    if (Number.isFinite(h)) w.y = h
  }
  w.gait = w.speed < 0.1 ? "stand" : w.speed < 2 ? "walk" : w.speed < 5 ? "jog" : "sprint"
  return w
}
