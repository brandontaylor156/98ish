// Walking with a thumb, shared by My Park (park/walker.js, followcam.js) and the open world
// (roam/sim/walker.js, roam/world.js updateCamera). Pure; Node-tested (walkfeel.test.js).
//
// The owner (iPhone, 2026-10-09): "it is SO HARD to control my character. I move, he doesn't, he
// lags, he doesn't go the direction I'm pointing", "switching directions takes a few seconds to
// register", "the camera rotation is interesting, that needs to maybe be thought through more".
// Measured (docs/pickleball-log.md "Walking that answers"): the walker itself answered in a frame
// or two, but the body as drawn took 0.3-1.1 s to face a new way (motion matching only turned it
// at 1.2 rad/s with a foot down), and the follow camera swung while you walked, which turned the
// stick's frame under your thumb. So, as in Fortnite / Genshin on a phone:
//
// - MOVING: the part of your speed that goes the new way builds quickly (`accel`); the part going
//   across or against it is taken away much faster (`pivot`), so a turn or a reversal answers
//   at once instead of braking to a stop and building up again (steerVelocity).
// - FACING: you face where the stick points (not where your momentum still carries you), turning
//   fast but not in a snap: about 0.14 s for a half turn (turnFacing). The body as drawn follows
//   this facing within a frame or two (anim.js / mm/controller.js `walking`).
// - THE CAMERA: free by default: it moves only when you drag the picture (with a little easing and
//   a fling), a double tap brings it round behind you, and walls pull it in on a spring (fast in,
//   slow out). "Follow behind" (a setting) also brings it round behind you while you walk away
//   from it. Nothing the camera does on its own ever changes the way you're walking: the stick's
//   frame is taken from the screen when your thumb lands, and only your own look (a drag, a
//   fling, a double tap) turns it.

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a))
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)

// ---------- the stick ----------
// R: the knob's reach (px); DEAD: the dead zone (of R); a push past `RUN` of the reach is a run
export const STICK = { R: 56, DEAD: 0.12, RUN: 0.86 }

// ---------- moving ----------
// pivot: m/s^2 taking away the speed that goes across or against the way you push now
export const MOVE = { pivot: 110 }

// steer the walker's velocity (w.vx, w.vz) toward (tvx, tvz) for dt seconds.
// accel: m/s^2 building speed the new way; decel: easing off (a lighter push, letting go)
export const steerVelocity = (w, tvx, tvz, dt, { accel, decel, pivot = MOVE.pivot }) => {
  const want = Math.hypot(tvx, tvz)
  if (want < 1e-6) {
    // letting go: slow straight down
    const sp = Math.hypot(w.vx, w.vz)
    const k = sp > 1e-9 ? Math.max(0, sp - decel * dt) / sp : 0
    w.vx *= k
    w.vz *= k
    return w
  }
  const ux = tvx / want
  const uz = tvz / want
  let along = w.vx * ux + w.vz * uz
  let px = w.vx - ux * along
  let pz = w.vz - uz * along
  // (across: gone fast)
  const pl = Math.hypot(px, pz)
  const kp = pl > 1e-9 ? Math.max(0, pl - pivot * dt) / pl : 0
  px *= kp
  pz *= kp
  if (along < 0) {
    // (against: stopped fast, then building the new way with what's left of the frame)
    const tStop = -along / pivot
    if (tStop >= dt) along += pivot * dt
    else along = Math.min(want, accel * (dt - tStop))
  } else if (along < want) along = Math.min(want, along + accel * dt)
  else along = Math.max(want, along - decel * dt)
  w.vx = ux * along + px
  w.vz = uz * along + pz
  return w
}

// ---------- facing ----------
// k: 1/s easing toward the way you push; max: rad/s at most (a half turn in ~0.14 s)
export const FACE = { k: 24, max: 22 }

export const turnFacing = (yaw, want, dt, { k = FACE.k, max = FACE.max } = {}) => {
  const d = wrap(want - yaw)
  const step = clamp(d * (1 - Math.exp(-k * dt)), -max * dt, max * dt)
  return wrap(yaw + step)
}

// the way a stick push goes on the ground, the camera looking along `frameYaw`:
// up the stick = forward (sin, cos); right = (-cos, sin)
export const stickDir = (x, y, frameYaw) => {
  const dx = Math.sin(frameYaw) * y - Math.cos(frameYaw) * x
  const dz = Math.cos(frameYaw) * y + Math.sin(frameYaw) * x
  const l = Math.hypot(dx, dz)
  return l > 1e-9 ? { x: dx / l, z: dz / l, yaw: Math.atan2(dx, dz) } : null
}

// ---------- the camera: an orbit you turn by hand ----------
// perShort: radians for a drag across the screen's short side (a phone: 390 px ~ 165 degrees);
// ease: 1/s the view catches up with your finger; fling: s a flick keeps turning (time constant)
export const LOOK = { perShort: 2.9, minShort: 320, maxShort: 760, pitchK: 0.55, ease: 40, fling: 0.12, flingMin: 1.5, flingMax: 7, recenter: 9, followAfter: 0.4, holdAfterDrag: 1.6, followRate: 1.6 }

// radians per pixel for a screen w x h
export const lookRate = (w, h) => LOOK.perShort / clamp(Math.min(w || 390, h || 844), LOOK.minShort, LOOK.maxShort)

// yaw: the view's heading; pitch: the world's own measure (the open world: tilt; My Park: lift)
export const createOrbit = (yaw = 0, pitch = 0) => ({ yaw, goalYaw: yaw, pitch, goalPitch: pitch, manual: 0, seen: 0, vYaw: 0, samples: [], recenterTo: null, sinceDrag: 99, walkT: 0, auto: 0 })

const turnGoal = (o, d) => {
  o.goalYaw += d
  o.manual += d
}

// a finger dragging the picture: dx, dy in px (right, down); size { w, h }; now: ms
// pitch limits [lo, hi]; the pitch goes the way the finger goes (down: higher view)
export const orbitDrag = (o, dx, dy, size, now = 0, { lo = -Infinity, hi = Infinity, pitchRate = null } = {}) => {
  const r = lookRate(size?.w, size?.h)
  const d = -dx * r
  turnGoal(o, d)
  o.goalPitch = clamp(o.goalPitch + dy * (pitchRate ?? r * LOOK.pitchK), lo, hi)
  o.vYaw = 0
  o.recenterTo = null
  o.sinceDrag = 0
  o.samples.push({ t: now, d })
  while (o.samples.length && now - o.samples[0].t > 100) o.samples.shift()
}

// the finger lifted: a quick flick keeps turning a moment
export const orbitRelease = (o, now = 0) => {
  const s = o.samples.filter((q) => now - q.t <= 80)
  o.samples = []
  if (s.length < 2) return
  const span = Math.max(16, now - s[0].t) / 1000
  const v = s.reduce((a, q) => a + q.d, 0) / span
  if (Math.abs(v) >= LOOK.flingMin) o.vYaw = clamp(v, -LOOK.flingMax, LOOK.flingMax)
}

// a turn by a key or a button (radians)
export const orbitTurn = (o, d) => {
  turnGoal(o, d)
  o.sinceDrag = 0
}

// a double tap: round behind you (eases there in ~0.3 s)
export const orbitRecenter = (o, yaw) => {
  o.recenterTo = yaw
  o.vYaw = 0
}

// snap (a new place, out of a car): no easing
export const orbitSnap = (o, yaw, pitch = o.goalPitch) => {
  o.yaw = o.goalYaw = yaw
  o.pitch = o.goalPitch = pitch
  o.vYaw = 0
  o.recenterTo = null
}

// one frame. walker { yaw, speed } and mode "free" | "follow": "follow" brings the view round
// behind you while you walk away from it (never sideways or toward it, never right after a
// drag). Returns the yaw your own hand turned it by since the last frame (drags and keys between
// frames too; the stick's frame turns with it)
export const stepOrbit = (o, dt, { walker = null, mode = "free" } = {}) => {
  const m0 = o.seen ?? o.manual
  o.sinceDrag += dt
  if (o.vYaw) {
    turnGoal(o, o.vYaw * dt)
    o.vYaw *= Math.exp(-dt / LOOK.fling)
    if (Math.abs(o.vYaw) < 0.05) o.vYaw = 0
  }
  if (o.recenterTo !== null) {
    const d = wrap(o.recenterTo - o.goalYaw)
    turnGoal(o, d * (1 - Math.exp(-dt * LOOK.recenter)))
    if (Math.abs(d) < 0.01) o.recenterTo = null
  }
  o.auto = 0
  const moving = walker && walker.speed > 0.5
  o.walkT = moving ? o.walkT + dt : 0
  if (mode === "follow" && moving && o.walkT > LOOK.followAfter && o.sinceDrag > LOOK.holdAfterDrag && o.recenterTo === null) {
    const d = wrap(walker.yaw - o.goalYaw)
    const away = Math.cos(d)
    if (away > 0.5) {
      o.auto = d * Math.min(1, dt * LOOK.followRate * Math.min(1, walker.speed / 2.5) * ((away - 0.5) / 0.5))
      o.goalYaw += o.auto
    }
  }
  o.goalYaw = wrap(o.goalYaw)
  const k = 1 - Math.exp(-dt * LOOK.ease)
  o.yaw = wrap(o.yaw + wrap(o.goalYaw - o.yaw) * k)
  o.pitch += (o.goalPitch - o.pitch) * k
  o.seen = o.manual
  return o.manual - m0
}

// ---------- the boom: walls pull the camera in on a spring ----------
// in: 1/s coming in (fast, so the lens is never long in a wall); out: 1/s easing back out
export const BOOM = { in: 22, out: 3.2 }
export const stepBoom = (cur, want, dt) => {
  if (cur === null || cur === undefined || !Number.isFinite(cur)) return want
  const k = 1 - Math.exp(-dt * (want < cur ? BOOM.in : BOOM.out))
  return cur + (want - cur) * k
}

// ---------- the camera setting (shared by both worlds, this device) ----------
export const CAMERA_MODES = ["free", "follow"]
const CAM_KEY = "98ish.walkCamera"
export const loadCameraMode = () => {
  try {
    const v = typeof localStorage !== "undefined" ? localStorage.getItem(CAM_KEY) : null
    return v === "follow" ? "follow" : "free"
  } catch {
    return "free"
  }
}
export const saveCameraMode = (m) => {
  try {
    localStorage.setItem(CAM_KEY, m === "follow" ? "follow" : "free")
  } catch {
    // (storage blocked: the default)
  }
}

// ---------- a double tap on the picture ----------
// tap(x, y, now) -> true on the second of two quick taps near each other
export const createDoubleTap = ({ gap = 320, near = 40 } = {}) => {
  let last = null
  return (x, y, now) => {
    if (last && now - last.t <= gap && Math.hypot(x - last.x, y - last.y) <= near) {
      last = null
      return true
    }
    last = { x, y, t: now }
    return false
  }
}
