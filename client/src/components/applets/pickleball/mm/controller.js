// Pickleball 98 motion matching: the runtime controller, one per player. Pure JavaScript
// (Node-tested; no three.js). Every frame:
//
// 1. Trajectory: where the game will take the player in 0.2, 0.4 and 0.7 s (predictTrajectory:
//    the match's own movement rule, accelerating at most 12 m/s^2 toward the velocity the
//    player wants, easing into a goal) and which way they'll face (a spring toward the facing
//    anim.js picks: the net while shuffling, the way they're going on a long run).
// 2. Search (every few frames, or at once when the wanted motion changes a lot): the current
//    frame's foot/hip features plus that trajectory, against the database; if a frame matches
//    clearly better than carrying on, jump to it.
// 3. Inertialization (inertialize.js): the jump's pose difference decays over ~0.1 s.
// 4. Playback: frames advance at 30 fps (a little faster or slower when the game moves faster
//    or slower than the clip: time warping within 0.8-1.3x).
// 5. Root: the character's root moves with the animation's own root motion, then is pulled
//    back toward the game's position and facing (the game's position is the truth: the
//    character never drifts more than a few cm from it, and never moves the player).
//
// Output: the pose in character space (D per canonical bone, the pelvis), the root (x, z,
// yaw) where it's drawn, and which feet the frame has on the court (for foot locking).

import { qmul, qslerp, qaxis } from "./quat.js"
import { DIM, contactsOf, normalizeQuery, rootDelta, virtualPose, toRoot } from "./features.js"
import { search } from "./search.js"
import { angVel, applyInert, createInert, decay, decaySpring, transition } from "./inertialize.js"
import { NB } from "./skeleton.js"
import { TAG } from "./library.js"
const TAG_IDLE = TAG.idle

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a))
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

export const MM = {
  every: 0.1, // seconds between searches (High); Medium uses 0.2
  better: 0.7, // a jump only for a match this much better than carrying on (hysteresis)
  near: 10, // frames: a "jump" closer than this in the same clip is just carrying on
  halflife: 0.12, // inertialization (s)
  accel: 12, // the match's acceleration (m/s^2)
  posPull: 0.06, // root position correction half-life (s): no foot down
  posPullPlanted: 0.3, // ...a foot down
  maxGap: 0.12, // never further than this from the game's position (m)
  // (facing is the animation's: the game never needs it. The search asks for the facing
  // anim.js wants; a gentle pull only stops slow drift, never turns a body on planted feet)
  yawPull: 0.3,
  yawPullPlanted: 0.8,
  turnRate: 3.5, // rad/s: the fastest turn the trajectory asks for
  turnPlanted: 1.2, // rad/s the pull may turn the body with a foot down
  turnFree: 5, // ...and with both feet off the court
  warp: [0.8, 1.3],
}

// Where the match will put the player: its movement rule run forward (60 Hz) from position
// p, velocity v toward the wanted velocity w (or easing into goal), reporting the positions at
// times (s). maxSpeed: the speed toward a goal.
export const predictTrajectory = ({ x, z, vx, vz, wx, wz, goal = null, maxSpeed = 4 }, times, accel = MM.accel) => {
  const out = []
  const dt = 1 / 60
  let t = 0
  let k = 0
  let px = x
  let pz = z
  let ux = vx
  let uz = vz
  const end = times[times.length - 1]
  while (k < times.length && t <= end + 1e-6) {
    while (k < times.length && t >= times[k] - 1e-6) {
      out.push({ x: px, z: pz, vx: ux, vz: uz })
      k++
    }
    let ax = wx
    let az = wz
    if (goal) {
      const dx = goal.x - px
      const dz = goal.z - pz
      const d = Math.hypot(dx, dz)
      if (d > 0.03) {
        const s = Math.min(maxSpeed, Math.sqrt(2 * 9 * d))
        ax = (dx / d) * s
        az = (dz / d) * s
      } else {
        ax = 0
        az = 0
      }
    }
    const ex = ax - ux
    const ez = az - uz
    const e = Math.hypot(ex, ez)
    const m = accel * dt
    if (e > m) {
      ux += (ex / e) * m
      uz += (ez / e) * m
    } else {
      ux = ax
      uz = az
    }
    px += ux * dt
    pz += uz * dt
    t += dt
  }
  while (out.length < times.length) out.push({ x: px, z: pz, vx: ux, vz: uz })
  return out
}

// a critically damped spring on an angle toward target: yaw at time t (from yaw0, rate w0)
export const predictYaw = (yaw0, w0, target, t, halflife = 0.2) => {
  const y = (4 * Math.LN2) / (halflife + 1e-5) / 2
  const j0 = wrap(yaw0 - target)
  const j1 = w0 + j0 * y
  return target + Math.exp(-y * t) * (j0 + j1 * t)
}

export const createMM = (lib, { x = 0, z = 0, yaw = 0 } = {}) => ({
  lib,
  v: lib.start ?? 0, // virtual frame playing
  u: 0, // fraction toward the next frame
  timer: 0,
  inert: createInert(NB),
  root: { x, z, yaw },
  yawRate: 0,
  prev: null, // last output (D, W, H, HV) for transitions
  out: { D: new Array(NB), H: { x: 0, y: 0, z: 0 } },
  lastWant: null,
  stats: { searches: 0, jumps: 0, visited: 0, cost: 0 },
  contacts: 0,
  q: new Float32Array(DIM),
  qn: new Float32Array(DIM),
})

// the source pose at the current playback position, and its velocities
const sampleSource = (st) => {
  const { db } = st.lib
  const a = virtualPose(db, st.v)
  const nextV = nextFrame(st, st.v)
  const b = virtualPose(db, nextV)
  const D = new Array(NB)
  for (let i = 0; i < NB; i++) D[i] = qslerp(a.D[i], b.D[i], st.u)
  const H = { x: a.hip.x + (b.hip.x - a.hip.x) * st.u, y: a.hip.y + (b.hip.y - a.hip.y) * st.u, z: a.hip.z + (b.hip.z - a.hip.z) * st.u }
  const fdt = 1 / db.fps
  const W = a.D.map((q, i) => angVel(q, b.D[i], fdt))
  const HV = { x: (b.hip.x - a.hip.x) / fdt, y: (b.hip.y - a.hip.y) / fdt, z: (b.hip.z - a.hip.z) / fdt }
  return { D, H, W, HV }
}
// the next virtual frame (stays at the clip's end)
const nextFrame = (st, v) => {
  const { db } = st.lib
  const N = db.N
  const f = v >= N ? v - N : v
  const c = db.clips[db.clipOf[f]]
  return f + 1 < c.start + c.n ? v + 1 : v
}
const atEnd = (st) => nextFrame(st, st.v) === st.v
// standing still in an idle clip the search allows, facing about the way wanted, with some of
// the clip left
export const isIdling = (st, input, want) => {
  const { lib } = st
  const tag = lib.tags[st.v] ?? 0
  if (!(tag & TAG_IDLE) || !(tag & (input.mask ?? 0xffffffff))) return false
  if (Math.hypot(want.x, want.z) > 0.15 || Math.hypot(input.vx, input.vz) > 0.25 || input.goal) return false
  if (Math.abs(wrap(input.yaw - st.root.yaw)) > 0.35) return false
  // (a second of the clip left, at least)
  const { db } = lib
  const f = st.v >= db.N ? st.v - db.N : st.v
  const c = db.clips[db.clipOf[f]]
  return c.start + c.n - f > db.fps
}

// input: x, z (the game's position), vx, vz, want: { x, z } (the velocity the player wants),
//   goal (or null), yaw (the facing anim.js picked), mask (tags to search), every (s between
//   searches), maxSpeed
export const updateMM = (st, input, dt) => {
  const { lib } = st
  const { db } = lib
  const fps = db.fps
  // ---- the trajectory the game wants, in the drawn root's frame ----
  const want = input.want || { x: input.vx, z: input.vz }
  const times = [6 / fps, 12 / fps, 21 / fps]
  const traj = predictTrajectory({ x: input.x, z: input.z, vx: input.vx, vz: input.vz, wx: want.x, wz: want.z, goal: input.goal, maxSpeed: input.maxSpeed || 4 }, times)
  // ---- search ----
  st.timer -= dt
  let jumped = false
  const changed = st.lastWant && (Math.hypot(want.x - st.lastWant.x, want.z - st.lastWant.z) > 1.2 || Math.abs(wrap(input.yaw - st.lastWant.yaw)) > 0.6)
  // standing still in a captured idle: let it play (its sway, its weight shifts) instead of
  // searching again and again for the one best standing frame, which jumped back every half
  // second and looked frozen; a search again once the idle runs out, or the player moves or
  // turns
  const idling = !!st.prev && isIdling(st, input, want)
  if ((st.timer <= 0 && !idling) || changed || atEnd(st) || !st.prev) {
    st.timer = input.every ?? MM.every
    st.lastWant = { x: want.x, z: want.z, yaw: input.yaw }
    // the query: this frame's pose features, the wanted trajectory
    const cur = Math.min(lib.F.length / DIM - 1, st.v)
    const q = st.q
    for (let d = 12; d < DIM; d++) q[d] = lib.raw[cur * DIM + d]
    const r = st.root
    times.forEach((t, j) => {
      // (the game's position now vs the drawn root: the trajectory starts from the drawn root)
      const p = traj[j]
      const d = toRoot(r.yaw, { x: p.x - input.x + (input.x - r.x), y: 0, z: p.z - input.z + (input.z - r.z) })
      q[j * 2] = d.x
      q[j * 2 + 1] = d.z
      // (no faster than a person turns: about 200 degrees a second at most, so the query asks
      // for a turn the capture can show)
      const yawS = predictYaw(r.yaw, st.yawRate, input.yaw, t)
      const yawT = r.yaw + clamp(wrap(yawS - r.yaw), -MM.turnRate * t, MM.turnRate * t)
      const dy = yawT - r.yaw
      q[6 + j * 2] = Math.sin(dy)
      q[6 + j * 2 + 1] = Math.cos(dy)
    })
    const qn = normalizeQuery(q, lib.norm, st.qn)
    // the cost of carrying on
    let curCost = Infinity
    if (st.prev && lib.ok[cur] && lib.tags[cur] & (input.mask ?? 0xffffffff)) {
      curCost = 0
      for (let d = 0; d < DIM; d++) {
        const e = qn[d] - lib.F[cur * DIM + d]
        curCost += e * e
      }
    }
    const best = search(lib.idx, qn, { mask: input.mask ?? 0xffffffff, best: curCost * MM.better })
    st.stats.searches++
    st.stats.visited += best.visited
    if (best.i >= 0) {
      const sameClip = lib.clipOfV(best.i) === lib.clipOfV(st.v)
      if (!(sameClip && Math.abs(best.i - st.v) < MM.near)) {
        if (st.prev) {
          const src0 = { v: st.v, u: st.u }
          st.v = best.i
          st.u = 0
          const src = sampleSource(st)
          transition(st.inert, st.prev, src)
          void src0
        } else {
          st.v = best.i
          st.u = 0
        }
        st.stats.jumps++
        jumped = true
      }
      st.stats.cost = best.cost
    }
  }
  // ---- playback (time warp: match the game's speed) ----
  const rd0 = rootDelta(db, st.v)
  const animSpeed = Math.hypot(rd0.x, rd0.z) * fps
  const gameSpeed = Math.hypot(input.vx, input.vz)
  let warp = 1
  if (animSpeed > 0.4 && gameSpeed > 0.4) warp = clamp(gameSpeed / animSpeed, MM.warp[0], MM.warp[1])
  let adv = dt * fps * warp
  // the root moves with the animation as it plays
  const r = st.root
  let mvx = 0
  let mvz = 0
  let myaw = 0
  while (adv > 0) {
    const step = Math.min(adv, 1 - st.u)
    const rd = rootDelta(db, st.v)
    // (in the root's frame -> world)
    const s = Math.sin(r.yaw + myaw)
    const c = Math.cos(r.yaw + myaw)
    mvx += (c * rd.x + s * rd.z) * step
    mvz += (-s * rd.x + c * rd.z) * step
    myaw += rd.yaw * step
    st.u += step
    adv -= step
    if (st.u >= 1 - 1e-9) {
      const n = nextFrame(st, st.v)
      if (n === st.v) {
        st.u = 0.999
        break
      }
      st.v = n
      st.u = 0
    }
  }
  r.x += mvx
  r.z += mvz
  r.yaw += myaw
  // (the root's turn is inertialized too: a jump to a clip turning at another rate swung the
  // whole body (and a foot in the air half a meter out) round by up to 4-8 degrees in one frame.
  // The difference in turning speed decays like the pose's offsets)
  const rate = dt > 0 ? myaw / dt : 0
  const yo = st.yawOff || (st.yawOff = { x: 0, v: 0 })
  if (jumped && st.screenRate !== undefined) yo.v = st.screenRate - rate
  const yn = decaySpring(yo.x, yo.v, MM.halflife, dt)
  r.yaw += yn.x - yo.x
  yo.x = yn.x
  yo.v = yn.v
  st.screenRate = rate + yn.v
  // ---- the root follows the game: pulled toward its position and facing ----
  // (gently while a foot is planted: the pinned foot would have to absorb the pull; firmly
  // while both feet are off the court, where a slide can't show)
  const planted = st.contacts & 3
  // (tight: a stroke is coming, the paddle must meet the ball where the game says, so the
  // body goes right to the game's position; the pinned feet take up the difference)
  st.tight = (st.tight || 0) + clamp(clamp(input.tight || 0, 0, 1) - (st.tight || 0), -dt * 4, dt * 4)
  const tight = st.tight
  const hl = (planted ? MM.posPullPlanted : MM.posPull) * (1 - tight) + 0.03 * tight
  const kp = 1 - Math.exp((-Math.LN2 * dt) / hl)
  r.x += (input.x - r.x) * kp
  r.z += (input.z - r.z) * kp
  const gx = r.x - input.x
  const gz = r.z - input.z
  const gap = Math.hypot(gx, gz)
  // (a little more room at a sprint: the match accelerates harder than any person)
  const maxGap = (MM.maxGap + clamp((gameSpeed - 2.5) * 0.04, 0, 0.08)) * (1 - tight) + 0.03 * tight
  if (gap > maxGap) {
    r.x = input.x + (gx / gap) * maxGap
    r.z = input.z + (gz / gap) * maxGap
  }
  const ky = 1 - Math.exp((-Math.LN2 * dt) / (planted ? MM.yawPullPlanted : MM.yawPull))
  const yawErr = wrap(input.yaw - r.yaw)
  const oldYaw = r.yaw
  // (at most so fast: a planted body only turns on its own legs, through the capture)
  const maxTurn = (planted ? MM.turnPlanted : MM.turnFree) * dt
  r.yaw += Math.max(-maxTurn, Math.min(maxTurn, yawErr * ky))
  r.yaw = wrap(r.yaw)
  st.yawRate = dt > 0 ? wrap(r.yaw - oldYaw + myaw * 0) / dt : 0
  // ---- the pose: the source frame plus the inertialization's decaying offsets ----
  const src = sampleSource(st)
  decay(st.inert, MM.halflife, dt)
  const out = applyInert(st.inert, src.D, src.H, st.out.D, st.out.H)
  // velocities of what's on screen (for the next transition)
  const W = new Array(NB)
  if (st.prev && dt > 0) for (let i = 0; i < NB; i++) W[i] = angVel(st.prev.D[i], out.D[i], dt)
  else for (let i = 0; i < NB; i++) W[i] = src.W[i]
  const HV = st.prev && dt > 0 ? { x: (out.H.x - st.prev.H.x) / dt, y: (out.H.y - st.prev.H.y) / dt, z: (out.H.z - st.prev.H.z) / dt } : src.HV
  st.prev = { D: out.D.map((q) => ({ ...q })), W, H: { ...out.H }, HV }
  st.contacts = contactsOf(db, st.v)
  return { D: out.D, hip: out.H, root: { x: r.x, z: r.z, yaw: r.yaw }, contacts: st.contacts, v: st.v }
}

// the pose in world space: the root's yaw applied to every bone and the pelvis
export const worldOf = (o) => {
  const yq = qaxis({ x: 0, y: 1, z: 0 }, o.root.yaw)
  const D = o.D.map((q) => qmul(yq, q))
  const s = Math.sin(o.root.yaw)
  const c = Math.cos(o.root.yaw)
  const h = o.hip
  return { D, pelvis: { x: o.root.x + c * h.x + s * h.z, y: h.y, z: o.root.z - s * h.x + c * h.z } }
}
