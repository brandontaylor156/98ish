// Pickleball 98: footwork. Pure JavaScript (no three.js), tested in Node (locomotion.test.js).
// anim.js asks this module where the feet are every frame; the match's movement (physics,
// AI, input) stays the only thing that says where a player IS. This is presentation only, so
// online play stays in sync: every browser works the feet out from the same positions.
//
// The old feet stepped whenever a foot got "too far" from where it wanted to be, which made
// a frantic patter at speed (about 12 steps a second at a sprint) and fidgety steps in the
// ready position. This works like a sports game's locomotion system instead:
//
// - A blend space (blendSpace): the velocity in the body's own frame picks how much of each
//   gait is in play (idle, walk, run, sprint, side shuffle left/right, backpedal), and the
//   gaits' cadences (steps a second) are calibrated so stride x cadence = ground speed. The
//   same weights scale the motion-capture clips' playback (timeScale) for the upper body.
// - A step clock (the cycle, 0..1 per two steps): the left foot touches down at 0, the right
//   at 0.5; each foot lifts at the end of its stance (duty). Feet in stance are locked to the
//   court (they never slide); a stepping foot swings along a path measured from motion
//   capture (Quaternius' Universal Animation Library, CC0: Walk_Loop, Jog_Fwd_Loop,
//   tools/gait-curves notes) to where the body will be at its mid-stance, so it lands under
//   the body instead of behind it (no moonwalking).
// - The heel peels off late in stance, pivoting on the ball of the foot (no sliding there
//   either), then the toe pushes off; the heel strikes first when running forward, the ball
//   of the foot first in shuffles and backpedals.
// - Side shuffles never cross the feet (the trailing foot closes up to the lead one);
//   standing, the feet only move to settle (a turn in place takes small pivot steps).
// - Facing (facingFor): face the net and the ball while shuffling and backpedaling; turn and
//   run for long, fast moves; walk facing where you're going between points; square up again
//   when a ball is coming.
// - Pro footwork (pro.js, docs/pickleball-movement.md): near the kitchen line slow moves are
//   small quick steps (a higher cadence, so shorter strides); a fast sideways move is a
//   crossover (hips open toward the ball, feet free to cross, shoulders kept toward the net:
//   anim.js turns them back) instead of giant shuffles; the split step is a small hop that
//   lands a little wider.

import { CROSS, footworkFor } from "./pro.js"

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const lerp = (a, b, t) => a + (b - a) * t
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a))
const frame = (yaw) => ({ f: { x: Math.sin(yaw), z: Math.cos(yaw) }, r: { x: -Math.cos(yaw), z: Math.sin(yaw) } })

// ---- swing paths: progress along the step (p) and height (h, 0..1 of the step's clearance)
// at nine points of the swing, from the motion-capture clips (world frame, ground moving) ----
export const PATHS = {
  // Jog_Fwd_Loop: the heel kicks up behind first, then the knee drives the foot forward
  run: { p: [0, 0.06, 0.15, 0.26, 0.46, 0.65, 0.8, 0.91, 1], h: [0.12, 0.7, 0.85, 1, 0.62, 0.64, 0.68, 0.45, 0], pitch: [0.7, 0.85, 0.8, 0.6, 0.35, 0.15, 0, -0.12, -0.18] },
  // Walk_Loop: an even swing, the toe clearing early, the heel reaching at the end
  walk: { p: [0, 0.06, 0.19, 0.35, 0.51, 0.68, 0.82, 0.93, 1], h: [0.37, 0.62, 0.83, 0.96, 0.96, 0.79, 0.58, 0.33, 0], pitch: [0.55, 0.5, 0.35, 0.2, 0.05, -0.05, -0.15, -0.22, -0.25] },
  // a shuffle or a backpedal (made here: low, quick, landing on the ball of the foot)
  shuffle: { p: [0, 0.08, 0.22, 0.4, 0.6, 0.78, 0.9, 0.97, 1], h: [0, 0.55, 0.9, 1, 0.92, 0.72, 0.45, 0.2, 0], pitch: [0.2, 0.15, 0.1, 0.06, 0.05, 0.06, 0.08, 0.1, 0.08] },
  back: { p: [0, 0.1, 0.25, 0.42, 0.6, 0.76, 0.88, 0.96, 1], h: [0.1, 0.6, 0.92, 1, 0.9, 0.7, 0.45, 0.2, 0], pitch: [0.15, 0.3, 0.35, 0.3, 0.25, 0.2, 0.18, 0.15, 0.12] },
}
const sample = (arr, s) => {
  const x = clamp(s, 0, 1) * (arr.length - 1)
  const i = Math.min(arr.length - 2, Math.floor(x))
  return lerp(arr[i], arr[i + 1], x - i)
}

// ---- the gaits: cadence (steps a second) by speed, duty (the part of a cycle a foot is
// down), how wide the feet are, how high a stepping foot goes ----
export const GAITS = {
  walk: { sps: (v) => 1.75 + 0.3 * v, duty: (v) => 0.62 - 0.04 * clamp(v - 1, 0, 1), width: 0.1, clear: () => 0.09, path: "walk", heel: 0.5 },
  run: { sps: (v) => clamp(2.55 + 0.27 * v, 2.6, 3.8), duty: (v) => clamp(0.47 - 0.035 * v, 0.33, 0.42), width: 0.085, clear: (v) => clamp(0.05 + 0.05 * v, 0.1, 0.26), path: "run", heel: 0.55 },
  sprint: { sps: (v) => clamp(2.9 + 0.22 * v, 3.5, 4.2), duty: () => 0.32, width: 0.075, clear: (v) => clamp(0.08 + 0.045 * v, 0.2, 0.3), path: "run", heel: 0.6 },
  shuffle: { sps: (v) => clamp(2.4 + 0.5 * v, 2.4, 4.0), duty: () => 0.55, width: 0.12, clear: (v) => clamp(0.035 + 0.02 * v, 0.04, 0.09), path: "shuffle", heel: 0.15 },
  back: { sps: (v) => clamp(2.6 + 0.45 * v, 2.6, 4.0), duty: () => 0.52, width: 0.13, clear: (v) => clamp(0.04 + 0.025 * v, 0.05, 0.1), path: "back", heel: 0.1 },
}
// the motion-capture clips the blend weights drive, and their own cycle lengths (s)
export const CLIPS = { walk: { clip: "Walk_Loop", duration: 1.3333, contact: 0.953 }, run: { clip: "Jog_Fwd_Loop", duration: 0.9333, contact: 0.016 }, sprint: { clip: "Sprint_Loop", duration: 0.6667, contact: 0.984 } }

export const IDLE_SPEED = 0.15 // below this (m/s) the feet stand still
export const MOVE_SPEED = 0.32 // above this they start stepping

// The blend space. vx, vz: the body's velocity (world, m/s); yaw: which way the body faces.
// crossover: the player has turned to run (travel, or a retreat side-on), so any direction
// is a running stride with the legs free to cross. Returns the gait weights (they sum to 1),
// the blended cadence and stride, and the clips' playback rates.
export const blendSpace = ({ vx = 0, vz = 0, yaw = 0, crossover = false, quick = 1 }) => {
  const fr = frame(yaw)
  const speed = Math.hypot(vx, vz)
  const fwd = vx * fr.f.x + vz * fr.f.z
  const lat = vx * fr.r.x + vz * fr.r.z // + to the body's right
  const c = speed > 1e-6 ? fwd / speed : 1
  const s = speed > 1e-6 ? lat / speed : 0
  // directions: squared cosines, so they sum to 1 and blend smoothly round the circle
  const x = crossover ? 1 : 0
  const dirF = Math.max(0, c) ** 2 + x * (1 - Math.max(0, c) ** 2)
  const dirB = Math.max(0, -c) ** 2 * (1 - x)
  const dirR = Math.max(0, s) ** 2 * (1 - x)
  const dirL = Math.max(0, -s) ** 2 * (1 - x)
  // forward speeds: walk, then run, then sprint
  const walkK = 1 - smoothstep(1.35, 2.05, speed)
  const sprintK = smoothstep(3.7, 4.6, speed)
  const runK = Math.max(0, 1 - walkK - sprintK)
  const idle = 1 - smoothstep(0.08, 0.45, speed)
  const m = 1 - idle
  const weights = {
    idle,
    walk: m * dirF * walkK,
    run: m * dirF * runK,
    sprint: m * dirF * sprintK,
    shuffleL: m * dirL,
    shuffleR: m * dirR,
    back: m * dirB,
  }
  // cadence and the rest: a weighted mix of the moving gaits (idle doesn't count)
  const gw = { walk: weights.walk, run: weights.run, sprint: weights.sprint, shuffle: weights.shuffleL + weights.shuffleR, back: weights.back }
  let total = 0
  for (const k in gw) total += gw[k]
  const v = Math.max(speed, 0.2)
  let sps = 0
  let duty = 0
  let width = 0
  let clear = 0
  let heel = 0
  if (total < 1e-6) {
    sps = 2
    duty = 0.6
    width = GAITS.walk.width
    clear = 0.05
  } else
    for (const k in gw) {
      const w = gw[k] / total
      if (w <= 0) continue
      const G = GAITS[k]
      sps += w * G.sps(v)
      duty += w * G.duty(v)
      width += w * G.width
      clear += w * G.clear(v)
      heel += w * G.heel
    }
  // slow, small steps: a little lower and quicker than the gait tables say
  const small = 1 - smoothstep(0.3, 1.0, speed)
  clear *= 1 - 0.45 * small
  // quick feet (near the kitchen): the same speed in shorter, quicker, lower steps
  if (quick > 1 && total >= 1e-6) {
    sps *= quick
    clear /= Math.sqrt(quick)
  }
  const cycles = sps / 2 // cycles a second (a cycle is two steps)
  const stride = speed / Math.max(sps, 1e-6) // one step's length
  const timeScale = {}
  for (const [k, C] of Object.entries(CLIPS)) timeScale[C.clip] = cycles * C.duration
  return { speed, fwd, lat, weights, gaits: gw, sps, cycles, stride, duty, width, clear, heel, timeScale }
}

// The swing path for a step, a blend of the gaits' paths by their weights
const pathAt = (gaits, s) => {
  let p = 0
  let h = 0
  let pitch = 0
  let total = 0
  for (const k in gaits) {
    const w = gaits[k]
    if (w <= 0) continue
    const P = PATHS[GAITS[k].path]
    p += w * sample(P.p, s)
    h += w * sample(P.h, s)
    pitch += w * sample(P.pitch, s)
    total += w
  }
  if (total < 1e-6) {
    // a settling step: up, over and down
    const u = clamp(s, 0, 1)
    return { p: u * u * (3 - 2 * u), h: Math.sin(Math.PI * u), pitch: 0.08 * Math.sin(Math.PI * u) }
  }
  return { p: p / total, h: h / total, pitch: pitch / total }
}

// ---- facing ----
// Which way the body should face, and whether the player has turned to run. st: a small
// state object kept between frames (hysteresis); s: { vx, vz, facing (the net), ball, between,
// incoming (a ball is coming to this player), goal ({x, z} where they're heading, if known), x, z }
export const facingFor = (st, s, dt) => {
  const speed = Math.hypot(s.vx, s.vz)
  const runYaw = Math.atan2(s.vx, s.vz)
  const rel = wrap(runYaw - s.facing) // 0: toward the net, +-pi: away from it
  const absRel = Math.abs(rel)
  const goalD = s.goal ? Math.hypot(s.goal.x - s.x, s.goal.z - s.z) : null
  st.fast = speed > 2.6 ? (st.fast || 0) + dt : 0
  let mode = st.mode || "face"
  // sideways and forward speed in the net's frame, and how far there is still to go sideways
  const nf = frame(s.facing)
  const lat = s.vx * nf.r.x + s.vz * nf.r.z
  const fwd = s.vx * nf.f.x + s.vz * nf.f.z
  const latGo = s.goal ? Math.abs((s.goal.x - s.x) * nf.r.x + (s.goal.z - s.z) * nf.r.z) : null
  st.foot = footworkFor({ lat, fwd, dist: latGo, prev: st.foot || "shuffle", between: s.between })
  if (st.foot === "cross") st.crossSide = st.crossSide || (lat >= 0 ? 1 : -1)
  else st.crossSide = 0
  if (s.between) {
    // between points: walk where you're going, then turn to face the net
    const going = speed > 0.7 && (goalD === null || goalD > 0.9)
    mode = going ? "travel" : mode === "travel" && speed > 0.35 && (goalD === null || goalD > 0.4) ? "travel" : "face"
  } else if (s.incoming) mode = st.foot === "cross" ? "cross" : "face"
  else {
    // (a long, fast move still turns and runs; a crossover is for the moves in between)
    if (mode === "cross") mode = "face"
    // in a rally: turn and run only for a long, fast move sideways (or a deep retreat); a few
    // steps are shuffles and backpedals facing the net
    const far = goalD === null ? st.fast > 0.22 : goalD > 2.2
    const sideways = absRel > 0.75 && absRel < 2.3
    const retreat = absRel >= 2.3
    if (mode === "face" && speed > 2.9 && far && (sideways || retreat)) mode = retreat ? "retreat" : "travel"
    else if (mode !== "face" && (speed < 1.9 || (goalD !== null && goalD < 1.0))) mode = "face"
    if (mode === "face" && st.foot === "cross") mode = "cross"
  }
  st.mode = mode
  let yaw
  if (mode === "travel") yaw = runYaw
  else if (mode === "cross") yaw = s.facing - st.crossSide * CROSS.hip // hips open toward the ball (a smaller yaw turns right)
  else if (mode === "retreat") {
    // a deep ball over the head: turn side-on (paddle side back) and run back over the shoulder
    const side = st.retreatSide || (rel >= 0 ? 1 : -1)
    st.retreatSide = side
    yaw = runYaw - side * 1.15
  } else {
    // square to the net, turned partly toward the ball
    const toBall = Math.atan2(s.ball.x - s.x, s.ball.z - s.z)
    yaw = s.facing + clamp(wrap(toBall - s.facing), -0.9, 0.9) * (s.between ? 0.2 : 0.45)
  }
  if (mode !== "retreat") st.retreatSide = 0
  return { yaw, mode, side: mode === "cross" ? st.crossSide : 0 }
}

// Turn toward a yaw: a smooth start and stop (a critically damped spring on the angle) with
// a top turning speed, so a player never snaps round. st: { yaw, w } (angle, rad/s)
export const turnToward = (st, target, dt, { maxRate = 9, k = 14 } = {}) => {
  if (st.w === undefined) st.w = 0
  const err = wrap(target - st.yaw)
  let h = Math.min(dt, 0.6 / k)
  let left = dt
  while (left > 1e-6) {
    const step = Math.min(h, left)
    const e = wrap(target - st.yaw)
    st.w += (k * k * e - 2 * k * st.w) * step
    st.w = clamp(st.w, -maxRate, maxRate)
    st.yaw = wrap(st.yaw + st.w * step)
    left -= step
  }
  void err
  return st.yaw
}

// ---- the feet ----
export const FOOT = {
  ball: 0.138, // ankle to the ball of the foot (along the ground): the heel peels off around it
  heel: 0.06, // ankle to the back of the heel
  drop: 0.06, // the ankle joint above the ball of the foot / heel contact
  toeOut: 0.14, // feet turned out a little (rad)
  minGap: 0.15, // the feet never closer than this side to side (they never cross)
  reach: 0.62, // a planted foot further than this (horizontally) from its hip must step
}

const newFoot = (x, z, yaw) => ({ x, z, y: 0, yaw, pitch: 0, bx: x, bz: z, step: null, down: 0, heel: 0 })

export const createGait = (x, z, yaw) => {
  const fr = frame(yaw)
  return {
    feet: [-1, 1].map((s) => newFoot(x + fr.r.x * s * 0.21, z + fr.r.z * s * 0.21, yaw + s * FOOT.toeOut)),
    steps: 0,
    count: {}, // steps taken by kind (move, settle, hop): for tests
    cycle: 0, // 0..1: the left foot lands at 0, the right at 0.5
    phase: 0, // the same in radians (arms and clips follow it)
    moving: false,
    lastFoot: 1,
    bob: 0, // the pelvis's rise and fall (m)
    sway: 0, // and side to side (m, to the right)
    blend: blendSpace({}),
    plant: 0, // a hard stop: 0..1
  }
}

// where foot i (0 left, 1 right) wants to be: under the hip line at the body's position p,
// half a stance to its side, turned out a little
const spotFor = (i, p, yaw, width) => {
  const fr = frame(yaw)
  const s = i ? 1 : -1
  return { x: p.x + fr.r.x * s * width, z: p.z + fr.r.z * s * width }
}
// keep foot i on its own side of the other foot (in the body frame)
const uncross = (g, i, spot, body, yaw) => {
  const fr = frame(yaw)
  const o = g.feet[1 - i]
  const lat = (spot.x - body.x) * fr.r.x + (spot.z - body.z) * fr.r.z
  const latO = (o.bx - body.x) * fr.r.x + (o.bz - body.z) * fr.r.z
  const lim = i === 0 ? Math.min(lat, latO - FOOT.minGap) : Math.max(lat, latO + FOOT.minGap)
  if (lim === lat) return spot
  return { x: spot.x + fr.r.x * (lim - lat), z: spot.z + fr.r.z * (lim - lat) }
}

const liftPhase = (i, duty) => (duty + (i ? 0.5 : 0)) % 1
const crossed = (from, to, at) => (from <= to ? at > from && at <= to : at > from || at <= to)

// How far the ankle moves (forward, up) when the foot pitches by p (toe down +) while a
// point of the foot stays on the court: the ball of the foot for a heel raise, the heel for
// a toe-up landing. (pf, pu): that point from the ankle, in (forward, up).
export const pivotOffset = (p) => {
  const pf = p >= 0 ? FOOT.ball : -FOOT.heel
  const pu = -FOOT.drop
  return { f: pf * (1 - Math.cos(p)) - pu * Math.sin(p), u: pu * (1 - Math.cos(p)) + pf * Math.sin(p) }
}
// where on the court the foot touches (the ball of the foot or the heel), for tests
export const contactPoint = (f) => {
  const ff = { x: Math.sin(f.yaw), z: Math.cos(f.yaw) }
  const o = pivotOffset(f.pitch || 0)
  const pf = (f.pitch || 0) >= 0 ? FOOT.ball : -FOOT.heel
  // ankle back to the flat spot, then out to the pivot
  return { x: f.x - ff.x * o.f + ff.x * pf, z: f.z - ff.z * o.f + ff.z * pf }
}

const startStep = (g, i, dur, kind) => {
  const f = g.feet[i]
  f.step = { fx: f.x, fz: f.z, fyaw: f.yaw, t: 0, dur: Math.max(0.08, dur), kind, pitch0: f.pitch, y0: f.y }
  f.heel = 0
  g.count[kind] = (g.count[kind] || 0) + 1
}

// One frame of footwork. body: { x, z, vx, vz, yaw, stance (half width standing), reach:
// { foot, x, z } | null, minHip (the pelvis height, for how far a leg reaches) }
export const updateGait = (g, body, dt) => {
  const bs = blendSpace({ vx: body.vx, vz: body.vz, yaw: body.yaw, crossover: !!body.crossover, quick: body.quick || 1 })
  g.blend = bs
  const speed = bs.speed
  const fr = frame(body.yaw)
  const wasMoving = g.moving
  g.moving = speed > MOVE_SPEED || (g.moving && speed > IDLE_SPEED)
  const reachH = Math.sqrt(Math.max(0.04, 0.86 ** 2 - Math.max(0.3, (body.minHip ?? 0.8) - 0.075) ** 2)) + 0.08
  const maxReach = Math.min(FOOT.reach, reachH)
  const width = g.moving ? lerp(body.stance, bs.width, smoothstep(IDLE_SPEED, 0.9, speed)) : body.stance
  const hipOf = (i) => ({ x: body.x + fr.r.x * (i ? 1 : -1) * 0.095, z: body.z + fr.r.z * (i ? 1 : -1) * 0.095 })
  // the feet point where the body faces, turned out a little (and a little more when wide)
  const footYaw = (i) => body.yaw + (i ? -1 : 1) * (FOOT.toeOut + (g.moving ? -0.06 : 0.08))

  // ---- start moving: the first step goes with the foot on the side you're going (a lateral
  // move) or the foot that's furthest from where it needs to be ----
  if (g.moving && !wasMoving) {
    let first
    if (Math.abs(bs.lat) > Math.abs(bs.fwd) * 0.8) first = bs.lat > 0 ? 1 : 0
    else {
      const ahead = { x: body.x + body.vx * 0.3, z: body.z + body.vz * 0.3 }
      const err = [0, 1].map((i) => {
        const sp = spotFor(i, ahead, body.yaw, width)
        return Math.hypot(g.feet[i].bx - sp.x, g.feet[i].bz - sp.z)
      })
      first = err[1] > err[0] ? 1 : 0
    }
    const busy = g.feet.findIndex((f) => f.step)
    if (busy >= 0) first = 1 - busy
    g.cycle = (liftPhase(first, bs.duty) - 1e-4 + 1) % 1
    g.first = true
  }

  // ---- the step clock ----
  const prevCycle = g.cycle
  if (g.moving) g.cycle = (g.cycle + bs.cycles * dt) % 1
  g.phase = g.cycle * Math.PI * 2

  // ---- feet in the air: follow their path to where the body will be at mid-stance ----
  for (let i = 0; i < 2; i++) {
    const f = g.feet[i]
    const st = f.step
    if (!st) continue
    st.t = Math.min(1, st.t + dt / st.dur)
    let want
    if (body.reach && body.reach.foot === i) want = { x: body.reach.x, z: body.reach.z }
    else if (st.kind === "hop") want = spotFor(i, body, body.yaw, width + (st.wider || 0))
    else if (!g.moving) want = spotFor(i, body, body.yaw, width)
    else {
      // land where the body will be halfway through this foot's stance
      const ahead = clamp((1 - st.t) * st.dur + (bs.duty / Math.max(bs.cycles, 0.5)) * 0.5, 0, 0.45)
      want = spotFor(i, { x: body.x + body.vx * ahead, z: body.z + body.vz * ahead }, body.yaw, width)
    }
    if (!body.crossover) want = uncross(g, i, want, body, body.yaw)
    // (a target that jumps, say a new ball calling for a step out the other way, is followed at a
    // foot's top speed, so the foot in the air never teleports)
    if (!st.ws) st.ws = { x: want.x, z: want.z }
    else {
      const dx = want.x - st.ws.x
      const dz = want.z - st.ws.z
      const d = Math.hypot(dx, dz)
      const mx = 8 * dt
      if (d > mx) {
        st.ws.x += (dx / d) * mx
        st.ws.z += (dz / d) * mx
      } else st.ws = { x: want.x, z: want.z }
    }
    want = st.ws
    // (a step out to a reach spot: where it lands, so anim.js lowers the hips in time)
    st.want = body.reach && body.reach.foot === i ? want : null
    const path = st.kind === "settle" || st.kind === "hop" ? pathAt({}, st.t) : pathAt(st.gaits || bs.gaits, st.t)
    f.yaw = st.fyaw + wrap(footYaw(i) - st.fyaw) * smoothstep(0, 0.85, st.t)
    f.pitch = lerp(st.pitch0, path.pitch, smoothstep(0, 0.25, st.t))
    // the path runs between the flat spots; the ankle sits where the foot's pitch puts it
    const ff = { x: Math.sin(f.yaw), z: Math.cos(f.yaw) }
    const o = pivotOffset(f.pitch)
    const end = smoothstep(0.6, 1, st.t) // (near the court, the pitch's pivot matters)
    f.bx = lerp(st.fx, want.x, path.p)
    f.bz = lerp(st.fz, want.z, path.p)
    f.x = f.bx + ff.x * o.f * end
    f.z = f.bz + ff.z * o.f * end
    f.y = Math.max(path.h * st.h, o.u * end, st.y0 * (1 - smoothstep(0, 0.3, st.t)))
    if (st.t >= 1) {
      f.bx = want.x
      f.bz = want.z
      f.x = f.bx + ff.x * o.f
      f.z = f.bz + ff.z * o.f
      f.y = o.u
      f.step = null
      f.down = 0
      f.landPitch = f.pitch
      g.steps++
      g.lastFoot = i
    }
  }

  // ---- feet on the court: locked; late in stance the heel peels up round the ball of the foot ----
  for (let i = 0; i < 2; i++) {
    const f = g.feet[i]
    if (f.step) continue
    f.down += dt
    let heelT = 0
    if (g.moving) {
      const stanceT = bs.duty / Math.max(bs.cycles, 0.5)
      heelT = smoothstep(0.5, 1, f.down / stanceT) * bs.heel
    }
    f.heel += (heelT - f.heel) * Math.min(1, dt * 18)
    // the landing pitch (heel strike / ball first) settles flat
    f.landPitch = (f.landPitch || 0) * Math.exp(-dt * 16)
    const p = f.heel * 0.55 + f.landPitch
    const ff = { x: Math.sin(f.yaw), z: Math.cos(f.yaw) }
    // pivot round the ball of the foot (heel up) or the heel (toe up): that point stays put
    const o = pivotOffset(p)
    f.pitch = p
    f.x = f.bx + ff.x * o.f
    f.z = f.bz + ff.z * o.f
    f.y = o.u
  }

  // ---- when a foot lifts ----
  if (g.moving) {
    for (const i of [0, 1]) {
      const f = g.feet[i]
      if (f.step) continue
      const hip = hipOf(i)
      const far = Math.hypot(f.bx - hip.x, f.bz - hip.z) > maxReach
      // a foot belongs in the air from its lift (the end of its stance) to its next landing:
      // if the clock is in that window and the foot has had a moment on the court, it goes
      // (a window, not a moment, so a change of gait mid-step can't skip a step)
      const contact = i ? 0.5 : 0
      const lift = liftPhase(i, bs.duty)
      const left = (((contact - g.cycle) % 1) + 1) % 1 // cycles until this foot's next landing
      const inWindow = left > 1e-6 && left <= 1 - bs.duty + 1e-6
      if (!inWindow) f.early = false
      const due = (inWindow && !f.early && f.down > 0.05 && left / Math.max(bs.cycles, 0.5) > 0.07) || crossed(prevCycle, g.cycle, lift)
      if (due || far) {
        let dur = inWindow ? left / Math.max(bs.cycles, 0.5) : (1 - bs.duty) / Math.max(bs.cycles, 0.5)
        if (g.first) dur *= 0.85
        startStep(g, i, clamp(dur, 0.1, 0.6), "move")
        // (landing before the window ends: stay down till the next one)
        f.early = inWindow
        const st = g.feet[i].step
        st.h = bs.clear * (g.first ? 0.7 : 1)
        st.gaits = { ...bs.gaits }
        g.first = false
        // (out of reach before its time: bring the clock to this foot's lift)
        if (!inWindow) g.cycle = lift
      }
    }
  } else {
    // standing: a settling step when a foot is clearly out of place or turned wrong, one foot
    // at a time (a turn in place is a couple of small pivot steps)
    const stepping = g.feet.some((f) => f.step)
    if (!stepping) {
      let best = -1
      let worst = 0
      for (const i of [1 - g.lastFoot, g.lastFoot]) {
        const f = g.feet[i]
        const want = body.reach && body.reach.foot === i ? { x: body.reach.x, z: body.reach.z } : spotFor(i, body, body.yaw, width)
        const err = Math.hypot(f.bx - want.x, f.bz - want.z)
        const turn = Math.abs(wrap(f.yaw - footYaw(i)))
        // (feet narrower than the stance: a small step out to a wide, athletic base)
        const lat = (f.bx - body.x) * fr.r.x + (f.bz - body.z) * fr.r.z
        const narrow = Math.max(0, width - 0.01 - lat * (i ? 1 : -1))
        const score = Math.max(err / 0.11, turn / 0.5, narrow / 0.025)
        if (score > 1 && score > worst) {
          worst = score
          best = i
        }
      }
      if (best >= 0) {
        startStep(g, best, 0.22, "settle")
        g.feet[best].step.h = 0.045
      }
    }
  }

  // ---- the pelvis: up and down with the steps (walking: high over the planted leg; running:
  // low as it takes the weight), and side to side over the stance foot when walking ----
  const w = bs.weights
  const runish = w.run + w.sprint + w.back * 0.3 + (w.shuffleL + w.shuffleR) * 0.35
  const ampWalk = 0.016 * w.walk
  // (pros run low and level: the head stays steady to track the ball)
  const ampRun = Math.min(0.018, 0.006 + bs.speed * 0.0035) * runish
  const mid = g.cycle - bs.duty / 2
  const targetBob = g.moving ? (ampWalk - ampRun) * Math.cos(4 * Math.PI * mid) : 0
  g.bob += (targetBob - g.bob) * Math.min(1, dt * 20)
  const targetSway = g.moving ? 0.022 * w.walk * Math.sin(2 * Math.PI * mid + Math.PI) : 0
  g.sway += (targetSway - g.sway) * Math.min(1, dt * 12)
  return g
}

// A split step: if the feet are still, both hop a few centimeters and land a little wider
// (dur: time in the air, h: the feet's lift, wider: each foot lands this much further out)
export const hopGait = (g, { dur = 0.26, h = 0.035, wider = 0 } = {}) => {
  if (g.moving || g.feet.some((f) => f.step)) return false
  for (const i of [0, 1]) {
    startStep(g, i, dur, "hop")
    g.feet[i].step.h = h
    g.feet[i].step.wider = wider
  }
  return true
}
