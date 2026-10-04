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

export const LOCK = { release: 0.3, halflife: 0.07, heelFirst: 0.015, settleAt: 0.07, settleDur: 0.26, settleLift: 0.045, maxV: 1.5 }

export const createFootLock = () => [0, 1].map(() => ({ locked: false, at: null, which: "ball", ox: 0, oz: 0, vx: 0, vz: 0, yaw: 0, dyaw: 0, settle: 0, lift: 0 }))

// feet: [{ ankle, ball, yaw }] (world, from the animation); down: [bool]; dt. Returns per foot
// { ankle, ball, yaw, locked, lift } where they should be drawn.
export const stepFootLock = (st, feet, down, dt, { release = LOCK.release, halflife = LOCK.halflife, settleAt = LOCK.settleAt, still = true } = {}) =>
  feet.map((f, i) => {
    const s = st[i]
    const other = st[1 - i]
    let lift = 0
    if (s.settle > 0) {
      // (a settling step in progress: up and over, the offset fading during it)
      s.settle = Math.max(0, s.settle - dt)
      const u = 1 - s.settle / LOCK.settleDur
      lift = Math.sin(Math.PI * u) * s.lift
    }
    if (down[i] && !s.locked && s.settle <= 0) {
      // pin the lower of the heel and the ball (the heel first when it's nearer its resting
      // height than the ball is to its own), where it is on screen now (with any offset still
      // fading out)
      s.which = f.ankle.y - ANKLE_Y < f.ball.y - BALL_Y - LOCK.heelFirst ? "ankle" : "ball"
      const p = f[s.which]
      s.at = { x: p.x + s.ox, z: p.z + s.oz }
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
      const lp = s.lastP || p
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
      if (!down[i] || off > release) s.locked = false // let go: the offset fades out from here
      else if (still && off > settleAt && other.locked && other.settle <= 0) {
        s.locked = false
        s.settle = LOCK.settleDur
        s.lift = LOCK.settleLift + off * 0.12
      } else s.dyaw = s.yaw - f.yaw
    }
    s.lastP = { x: f[s.which].x, z: f[s.which].z }
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
    return {
      ankle: { x: f.ankle.x + s.ox, y: f.ankle.y + lift, z: f.ankle.z + s.oz },
      ball: { x: f.ball.x + s.ox, y: f.ball.y + lift, z: f.ball.z + s.oz },
      yaw: f.yaw + s.dyaw,
      locked: s.locked,
      lift,
    }
  })

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
export const legIK = (hip, kneeAnim, ankle, l1, l2) => {
  const dx = ankle.x - hip.x
  const dy = ankle.y - hip.y
  const dz = ankle.z - hip.z
  const d = Math.hypot(dx, dy, dz)
  const ds = softReach(d, l1 + l2)
  const k = d > 1e-6 ? ds / d : 1
  const t = { x: hip.x + dx * k, y: hip.y + dy * k, z: hip.z + dz * k }
  const mid = { x: (hip.x + t.x) / 2, y: (hip.y + t.y) / 2, z: (hip.z + t.z) / 2 }
  const pole = { x: kneeAnim.x - mid.x, y: kneeAnim.y - mid.y, z: kneeAnim.z - mid.z }
  const r = twoBone(hip, t, l1, l2, pole)
  return { knee: r.mid, ankle: r.end, reached: ds >= d - 1e-4 }
}
