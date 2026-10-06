// My Park: the cameras (pure; Node-tested).
// - followShot: third person, behind and above you. It swings round behind you as you walk
//   (slowly, and not when you walk toward it), never ends up on the far side of a fence or
//   the pro shop (it comes in closer, or up over a fence's top), and never has anyone else
//   right in front of the lens (camera.js clearShot).
// - spectatorShot: watching a court from its bleachers (a few angles, Cam cycles), clear of
//   the players and the people sitting near the lens.

import { clearShot } from "../camera.js"
import { HALF_L, HALF_W } from "../physics.js"
import { PEN, segmentHit } from "./layout.js"

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a))

export const FOLLOW = { dist: 4.6, height: 2.35, lookUp: 1.25, ahead: 1.6, minDist: 1.3, swing: 1.6 }

export const createFollow = (yaw = 0) => ({ yaw, pos: null, look: null, dist: FOLLOW.dist, drag: 0 })

// where the camera wants to be for a walker at (x, z) facing `yaw`, camera yaw `camYaw`
// (portrait phones: further back and higher, a taller view)
export const followTarget = (w, camYaw, { portrait = false, bodies = [] } = {}) => {
  const dist = FOLLOW.dist + (portrait ? 1.6 : 0)
  const height = FOLLOW.height + (portrait ? 0.9 : 0)
  const fx = Math.sin(camYaw)
  const fz = Math.cos(camYaw)
  const look = { x: w.x + fx * FOLLOW.ahead, y: FOLLOW.lookUp, z: w.z + fz * FOLLOW.ahead }
  let cam = { x: w.x - fx * dist, y: height, z: w.z - fz * dist }
  // a fence or wall between you and the lens: come in closer (or, near a fence's top, go up
  // over it)
  const head = { x: w.x, z: w.z }
  const t = segmentHit(head, cam, 1.5, 0.45)
  let pulled = 0
  if (t !== null) {
    const d = Math.max(FOLLOW.minDist, dist * t - 0.35)
    pulled = dist - d
    cam = { x: w.x - fx * d, y: height + Math.min(1.4, pulled * 0.35), z: w.z - fz * d }
    // still behind something that tall: go up over it
    if (segmentHit(head, cam, cam.y, 0.45) !== null) cam.y = Math.max(cam.y, PEN.h + 0.6)
  }
  // nobody else in front of the lens
  const c = clearShot(cam, look, bodies, { near: 1.1, ahead: 2.4, max: 10 })
  return { cam: { x: c.x, y: c.y, z: c.z }, look, pulled, cleared: c.moved }
}

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
  const t = followTarget(w, st.yaw, opts)
  const k = st.pos ? 1 - Math.exp(-dt * 7) : 1
  st.pos = st.pos ? { x: st.pos.x + (t.cam.x - st.pos.x) * k, y: st.pos.y + (t.cam.y - st.pos.y) * k, z: st.pos.z + (t.cam.z - st.pos.z) * k } : { ...t.cam }
  const kl = st.look ? 1 - Math.exp(-dt * 9) : 1
  st.look = st.look ? { x: st.look.x + (t.look.x - st.look.x) * kl, y: st.look.y + (t.look.y - st.look.y) * kl, z: st.look.z + (t.look.z - st.look.z) * kl } : { ...t.look }
  // (the eased position is checked again: never through a fence or a body while it eases)
  if (segmentHit({ x: w.x, z: w.z }, st.pos, st.pos.y) !== null) st.pos = { ...t.cam }
  const c = clearShot(st.pos, st.look, opts.bodies || [], { near: 1.1, ahead: 2.4, max: 10 })
  st.pos = { x: c.x, y: c.y, z: c.z }
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
export const spectatorShot = (court, angle = 0, bodies = [], { portrait = false } = {}) => {
  // (in the court's own axes: u along it, v toward the spectators' side; Riverside: u east,
  // v toward the path)
  const u = court.u || { x: 1, z: 0 }
  const v = court.view || { x: 0, z: -(court.side ?? 1) }
  const hz = court.hz ?? PEN.hz
  const at = (a, b, y) => ({ x: court.x + u.x * a + v.x * b, y, z: court.z + u.z * a + v.z * b })
  const a = (portrait ? ORDER.tall : ORDER.wide)[((angle % 3) + 3) % 3]
  let cam
  let look
  let fov
  if (a === 0) {
    // from behind the bleachers, up over the fence: the whole court side on, a little to one
    // side of the net
    cam = at(1.5, hz + 4.2 + (portrait ? 4.5 : 0), portrait ? 8.5 : 4.7)
    look = at(0, -0.3, 0.2)
    fov = portrait ? 64 : 52
  } else if (a === 1) {
    // behind a baseline, high enough to see over the near players
    const e = court.baseE ?? (court.x >= 0 ? 1 : -1)
    cam = at(e * (HALF_L + 4.4 + (portrait ? 3 : 0)), 0.6, portrait ? 5.6 : 4.4)
    look = at(-e * 1.0, 0, 0.2)
    fov = portrait ? 64 : 48
  } else {
    // high over the bleachers: the whole court
    cam = at(-1.5, hz + 4.5 + (portrait ? 2 : 0), portrait ? 11 : 8.5)
    look = at(0, -0.4, 0)
    fov = portrait ? 62 : 46
  }
  const c = clearShot(cam, look, bodies, { near: 1.6, ahead: 3.2 })
  return { cam: { x: c.x, y: c.y, z: c.z }, look, fov, name: SPECTATE_ANGLES[a], moved: c.moved, width: HALF_W }
}
