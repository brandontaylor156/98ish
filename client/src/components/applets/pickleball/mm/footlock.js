// Pickleball 98 motion matching: foot locking. Pure JavaScript (Node-tested).
//
// The animation's feet are where the motion capture put them, carried by a root that the game
// pulls around (and offsets that inertialization adds): left alone, a planted foot would
// skate a few centimeters. So while the database says a foot is down, that foot is pinned to
// the court where it landed: the point that touched first (the heel on a heel strike, the
// ball of the foot otherwise) stays put, the rest of the foot keeps its animated shape (the
// heel still peels up round the ball). When the foot lifts (or the body has moved too far
// from it) it lets go, and the leftover offset fades out with a critically damped spring
// while the foot is in the air. The legs then reach the pinned feet with two-bone IK.
//
// A settling step: a pinned foot that has ended up too far from where the animation has it
// (the body drifted over it: the game pulled the character, or a turn on the spot) takes a
// small step to catch up, lifting and landing where the animation's foot is, while the other
// foot holds the body. Real players do this all the time standing in the ready position.

import { decaySpring } from "./inertialize.js"
import { twoBone } from "./quat.js"
import { ANKLE_Y, BALL_Y } from "./skeleton.js"

export const LOCK = { release: 0.3, halflife: 0.07, heelFirst: 0.015, settleAt: 0.07, settleDur: 0.26, settleLift: 0.045, maxV: 1.5, reachDur: 0.2, reachLift: 0.06, reachCarry: 0.4, restep: 0.15, upHold: 0.05 }

export const createFootLock = () => [0, 1].map(() => ({ locked: false, at: null, which: "ball", ox: 0, oz: 0, vx: 0, vz: 0, yaw: 0, dyaw: 0, settle: 0, lift: 0 }))

// feet: [{ ankle, ball, yaw }] (world, from the animation); down: [bool]; dt. Returns per foot
// { ankle, ball, yaw, locked, lift } where they should be drawn.
//
// A reach (anim.js: a lunge or a step into a drive): one foot steps out to a spot of the
// game's choosing whatever the capture's feet are doing, in an arc, lands and stays pinned
// there; once the reach is over it's an ordinary pinned foot again.
export const stepFootLock = (st, feet, down, dt, { release = LOCK.release, halflife = LOCK.halflife, settleAt = LOCK.settleAt, still = true, reach = null } = {}) =>
  feet.map((f, i) => {
    const s = st[i]
    const other = st[1 - i]
    let lift = 0
    // (reach: one spot, or a list: a step out and a foot held where it is, e.g. the server's back foot)
    const R = !reach ? null : Array.isArray(reach) ? reach.find((r) => r && r.foot === i) || null : reach.foot === i ? reach : null
    if (R) {
      // (a landed reach whose leg can't get to it any more (the body moved on: pose.js says so
      // with drag, and the spot asked has moved on from where it landed) steps out again, from
      // where the foot is, to the spot asked now. (Not while the hips are still coming down
      // into a lunge toward a foot that hasn't moved: that kept restarting the step)
      if (s.reach && s.reach.t >= 1 && s.drag && Math.hypot(R.x - s.reach.tx, R.z - s.reach.tz) > LOCK.restep) s.reach = null
      if (!s.reach) {
        // (from where the foot is on screen: a pinned foot's offset from last frame is stale by
        // this frame's animation, and starting there made the foot jump 3-7 cm as a lunge began)
        // (and on the way it was already going: a foot still travelling (a settling step, a
        // release) carries on into the step instead of stopping dead for it. The tangent is
        // capped so a fast foot can't fling the arc out)
        const from = s.shown ? s.shown.ankle : { x: f.ankle.x + s.ox, z: f.ankle.z + s.oz }
        const v = s.shownV || { x: 0, z: 0 }
        const m = Math.hypot(v.x, v.z) * LOCK.reachDur
        const k = m > LOCK.reachCarry ? LOCK.reachCarry / m : 1
        s.reach = { t: 0, fx: from.x, fz: from.z, tx: R.x, tz: R.z, mx: v.x * LOCK.reachDur * k, mz: v.z * LOCK.reachDur * k }
        s.locked = false
        s.settle = 0
      }
      s.drag = false
      const r = s.reach
      if (r.t < 1) {
        r.tx = R.x
        r.tz = R.z
        r.t = Math.min(1, r.t + dt / LOCK.reachDur)
      }
      // (a cubic from where the foot is, leaving with its velocity, to the spot, landing at rest)
      const t = r.t
      const u = t * t * (3 - 2 * t)
      const h = t * t * t - 2 * t * t + t
      const ax = r.fx + (r.tx - r.fx) * u + (r.mx || 0) * h
      const az = r.fz + (r.tz - r.fz) * u + (r.mz || 0) * h
      lift = r.t < 1 ? Math.sin(Math.PI * r.t) * LOCK.reachLift : 0
      s.ox = ax - f.ankle.x
      s.oz = az - f.ankle.z
      s.vx = 0
      s.vz = 0
      if (r.t >= 1 && !s.locked) {
        s.locked = true
        s.which = "ankle"
        s.at = { x: ax, z: az }
        s.yaw = f.yaw + s.dyaw
      }
      s.lastP = lastOf(f)
      return show(s, dt, { ankle: { x: ax, y: f.ankle.y + lift, z: az }, ball: { x: f.ball.x + s.ox, y: f.ball.y + lift, z: f.ball.z + s.oz }, yaw: f.yaw + s.dyaw, locked: s.locked, lift, which: s.which })
    }
    s.reach = null
    if (s.settle > 0) {
      // (a settling step in progress: up and over, the offset fading during it)
      s.settle = Math.max(0, s.settle - dt)
      const u = 1 - s.settle / LOCK.settleDur
      lift = Math.sin(Math.PI * u) * s.lift
    }
    // (a foot coming down far from where the animation has it (still travelling back after a
    // release or a reach) lands once it's back within the release distance: pinned out there
    // it was let go again at once, every frame, and never got back)
    // (or, if it's further than that, steps over to it: sliding back along the court skated)
    if (down[i] && !s.locked && s.settle <= 0 && Math.hypot(s.ox, s.oz) > release) startSettle(s, Math.hypot(s.ox, s.oz))
    if (down[i] && !s.locked && s.settle <= 0) {
      // pin the lower of the heel and the ball (the heel first when it's nearer its resting
      // height than the ball is to its own), where it is on screen now (with any offset still
      // fading out)
      s.which = f.ankle.y - ANKLE_Y < f.ball.y - BALL_Y - LOCK.heelFirst ? "ankle" : "ball"
      const p = f[s.which]
      // (where it was on screen last frame: the foot lands and stops there. Pinning it where
      // this frame's animation has it (plus last frame's offset) carried the whole frame's
      // motion into the landing: on a motion-matching jump or a sudden turn, 3-12 cm in one
      // frame, then nothing: a pop)
      s.at = s.shown ? { x: s.shown[s.which].x, z: s.shown[s.which].z } : { x: p.x + s.ox, z: p.z + s.oz }
      s.locked = true
      s.yaw = f.yaw + s.dyaw
    }
    if (s.locked) {
      const p = f[s.which]
      const ox = s.at.x - p.x
      const oz = s.at.z - p.z
      const off = Math.hypot(ox, oz)
      // (the offset's velocity: minus the animated point's, so a released foot starts from
      // rest on screen and speeds up smoothly, never at once)
      // (last frame's animated point: the same point (heel or ball) as now)
      const lp = s.lastP ? s.lastP[s.which] : p
      s.vx = dt > 0 ? -(p.x - lp.x) / dt : 0
      s.vz = dt > 0 ? -(p.z - lp.z) / dt : 0
      // (capped: a foot snapping into a fast swing would otherwise fling the offset out)
      const vs = Math.hypot(s.vx, s.vz)
      if (vs > LOCK.maxV) {
        s.vx *= LOCK.maxV / vs
        s.vz *= LOCK.maxV / vs
      }
      s.ox = ox
      s.oz = oz
      // (the capture's contact flag flickers off for a frame or two now and then: a foot let go
      // for one frame and pinned again the next jumped 3-4 cm. Lifted for LOCK.upHold first)
      s.up = down[i] ? 0 : (s.up || 0) + dt
      // (unless the leg can't reach it any more: then at once)
      if (s.up >= LOCK.upHold - 1e-9 || (s.up > 0 && s.drag)) s.locked = false // let go: the offset fades out from here
      else if (off > release * 1.6 || ((off > release || s.drag || (still && off > settleAt)) && other.locked && other.settle <= 0)) {
        // (too far from where the capture has it: a quick step over, never a slide)
        s.locked = false
        startSettle(s, off)
      } else s.dyaw = s.yaw - f.yaw
    }
    s.drag = false
    s.lastP = lastOf(f)
    if (!s.locked) {
      const hl = s.settle > 0 ? LOCK.settleDur / 4 : halflife
      const a = decaySpring(s.ox, s.vx, hl, dt)
      const b = decaySpring(s.oz, s.vz, hl, dt)
      s.ox = a.x
      s.vx = a.v
      s.oz = b.x
      s.vz = b.v
      s.dyaw *= Math.exp((-dt * Math.LN2) / hl)
    }
    return show(s, dt, {
      ankle: { x: f.ankle.x + s.ox, y: f.ankle.y + lift, z: f.ankle.z + s.oz },
      ball: { x: f.ball.x + s.ox, y: f.ball.y + lift, z: f.ball.z + s.oz },
      yaw: f.yaw + s.dyaw,
      locked: s.locked,
      which: s.which,
      lift,
    })
  })

const startSettle = (s, off) => {
  s.locked = false
  s.settle = LOCK.settleDur
  s.lift = LOCK.settleLift + off * 0.12
}
const lastOf = (f) => ({ ankle: { x: f.ankle.x, z: f.ankle.z }, ball: { x: f.ball.x, z: f.ball.z } })
// (where each foot was put on screen this frame: a landing pins there, a reach starts there)
const show = (s, dt, out) => {
  s.shownV = s.shown && dt > 0 ? { x: (out.ankle.x - s.shown.ankle.x) / dt, z: (out.ankle.z - s.shown.ankle.z) / dt } : { x: 0, z: 0 }
  s.shown = { ankle: { x: out.ankle.x, z: out.ankle.z }, ball: { x: out.ball.x, z: out.ball.z } }
  return out
}

// a leg reaching an ankle target: hip, the animation's knee (for the bend's direction),
// lengths. Returns { knee, ankle }. Soft IK: the last few percent of the leg's reach are
// eased in (a leg snapping straight makes the knee jump); a target further than that is
// reached a little short.
export const SOFT = 0.975
export const softReach = (d, L, soft = SOFT) => {
  const s0 = L * soft
  if (d <= s0) return d
  return s0 + (L - s0) * (1 - Math.exp(-(d - s0) / (L - s0)))
}
//
// The knee bends the way the captured knee bends: its direction off the captured hip-ankle
// line (ankleAnim), not off the new one (a pinned foot far from the captured foot would
// otherwise swing the knee round). fwd: the body's forward, mixed in so a straight captured
// leg still bends forward.
export const legIK = (hip, kneeAnim, ankle, l1, l2, ankleAnim = null, fwd = null) => {
  const dx = ankle.x - hip.x
  const dy = ankle.y - hip.y
  const dz = ankle.z - hip.z
  const d = Math.hypot(dx, dy, dz)
  const ds = softReach(d, l1 + l2)
  const k = d > 1e-6 ? ds / d : 1
  const t = { x: hip.x + dx * k, y: hip.y + dy * k, z: hip.z + dz * k }
  const a0 = ankleAnim || t
  const mid = { x: (hip.x + a0.x) / 2, y: (hip.y + a0.y) / 2, z: (hip.z + a0.z) / 2 }
  let pole = { x: kneeAnim.x - mid.x, y: kneeAnim.y - mid.y, z: kneeAnim.z - mid.z }
  if (fwd) {
    const pl = Math.hypot(pole.x, pole.y, pole.z) || 1
    pole = { x: pole.x / pl + fwd.x * 0.35, y: pole.y / pl + fwd.y * 0.35, z: pole.z / pl + fwd.z * 0.35 }
  }
  const r = twoBone(hip, t, l1, l2, pole)
  return { knee: r.mid, ankle: r.end, reached: ds >= d - 1e-4 }
}
