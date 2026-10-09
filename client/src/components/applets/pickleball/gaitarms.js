// Pickleball 98: the arms while walking about and running (pure; Node-tested in gaitarms.test.js).
//
// One model for every gait, from published gait biomechanics, so the arms look the same with
// motion matching or without, near or far, in My Park, the open world and between points
// (before this, the arms came from four places: the capture's own arms, which changed with
// whichever clip the search picked (a walk's straight hanging arms, a jog's high fists, a run
// that opened the elbows), a procedural "relaxed" pose with the elbows bent 75 degrees even
// standing, and two pump layers on top; the owner saw them flip between "so high" and "too low").
//
// What real people do (Murray 1967 and Elftman 1939 for walking; Hinrichs 1987 and Mann & Hagy
// 1980 for running; Collins et al. 2009 on why arms swing):
// - standing: arms hang at the sides, the elbows a little bent (~15 degrees), hands beside the
//   thighs a few centimetres in front of the hip line;
// - walking: each arm swings with the OPPOSITE leg; at 1.4 m/s the shoulder goes ~20 degrees
//   back and ~12 forward (more back than forward), the elbow ~15 degrees behind to ~35 in front;
//   the hands stay at thigh width (they don't cross the body);
// - jogging and running: the elbow is held near 90 degrees (more closed in front, opening a
//   little behind), the hands travel between the hip (behind) and the lower chest (in front),
//   front to back and a little inward, the shoulders low; the swing grows with speed (~25-30
//   degrees each way at a jog, ~40-50 at a run).
// Never above the chest, never hanging straight while running.
//
// The swing is driven by the legs as they are drawn (the ankles' fore-aft spread, last frame),
// so the counter-swing always matches the captured or procedural legs, filtered so a foot plant
// never jerks the arms.
//
// Coordinates: the anim.js "standard" right-handed pose frame (x right, y up, z forward; the
// shoulders at (+-0.19, 1.3, 0.1)); the paddle arm is the right one (+x), mirrored for
// left-handers by anim.js.

const V = (x = 0, y = 0, z = 0) => ({ x, y, z })
const add = (a, b) => V(a.x + b.x, a.y + b.y, a.z + b.z)
const mul = (a, s) => V(a.x * s, a.y * s, a.z * s)
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z
const norm = (a) => {
  const l = Math.hypot(a.x, a.y, a.z)
  return l > 1e-9 ? mul(a, 1 / l) : V(0, -1, 0)
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const lerp = (a, b, t) => a + (b - a) * t
const smooth = (t) => {
  const k = clamp(t, 0, 1)
  return k * k * (3 - 2 * k)
}
const D = Math.PI / 180

export const ARM = { upper: 0.29, fore: 0.27, shoulderX: 0.19, shoulderY: 1.3, shoulderZ: 0.1 }

// how much of a run the gait is (0 walking, 1 a jog or faster): the elbows fold between 1.9 and
// 2.7 m/s (the walk-run transition is ~2.0-2.2 m/s)
export const runness = (speed) => smooth((speed - 1.9) / 0.8)

// the gait's arm angles at a speed (degrees): shoulder swing each way (fwd, back), the elbow
// at the back and at the front of the swing, the arm out from the side, the forearm turned in
export const armAngles = (speed) => {
  const v = Math.max(0, speed)
  const r = runness(v)
  // walking: amplitude grows with speed (Murray: ~30-35 degrees total at a normal pace)
  const walkFwd = 13 * clamp(v / 1.4, 0, 1.4)
  const walkBack = 19 * clamp(v / 1.4, 0, 1.4)
  // running: 28 each way at 3 m/s, 45 at 6
  const runAmp = clamp(28 + (v - 3) * 5.5, 22, 48)
  // (forward, less: the trunk leans into a run, and the front hand comes up, not out)
  const fwd = lerp(walkFwd, runAmp * 0.62, r)
  // (behind, the shoulder extends further: with the elbow at 90 the hand only gets back to the
  // hip that way)
  const back = lerp(walkBack, Math.min(58, runAmp * 1.55), r)
  // the elbow: walking ~15 behind to ~35 in front; running ~100 behind to ~75 in front (it
  // closes as the hand comes up; at a sprint more)
  const elbowBack = lerp(14 + 4 * clamp(v / 1.4, 0, 1), 104, r)
  const elbowFront = lerp(16 + 20 * clamp(v / 1.4, 0, 1.2), clamp(74 - (v - 3) * 4, 60, 80), r)
  // out from the side (hands beside the thighs, not on them); running, the forearm turns in a
  // little so the front hand comes toward (not across) the middle
  const abd = lerp(8, 6, r)
  const inward = lerp(4, 7, r)
  return { fwd, back, elbowBack, elbowFront, abd, inward, run: r }
}

// one arm's elbow and wrist from its angles (side +1 right, -1 left): flex (shoulder,
// + forward), abd (out), elbow (flexion), inward (the forearm turned toward the middle)
export const armFK = (side, flex, abd, elbow, inward = 0) => {
  const S = V(side * ARM.shoulderX, ARM.shoulderY, ARM.shoulderZ)
  const f = flex * D
  const a = abd * D
  // the upper arm: down, swung forward by flex, out by abd
  const u = norm(V(side * Math.sin(a), -Math.cos(f) * Math.cos(a), Math.sin(f) * Math.cos(a)))
  // the forearm bends forward (toward the front of the upper arm) and a little inward
  const fwdRef = V(-side * Math.sin(inward * D), 0, Math.cos(inward * D))
  const p = norm(add(fwdRef, mul(u, -dot(fwdRef, u))))
  const e = elbow * D
  const fa = norm(add(mul(u, Math.cos(e)), mul(p, Math.sin(e))))
  const E = add(S, mul(u, ARM.upper))
  const W = add(E, mul(fa, ARM.fore))
  // where the elbow points (the IK pole: from between the shoulder and the wrist to the elbow;
  // straight-ish arms: back and a little out)
  const mid = mul(add(S, W), 0.5)
  let pole = V(E.x - mid.x, E.y - mid.y, E.z - mid.z)
  if (Math.hypot(pole.x, pole.y, pole.z) < 0.02) pole = V(side * 0.25, -0.2, -1)
  return { shoulder: S, elbow: E, wrist: W, pole: norm(add(norm(pole), V(side * 0.06, 0, -0.3))), forearm: fa, upper: u }
}

export const createGaitArms = () => ({ s: 0, v: 0, amp: 0.3, w: 0 })

// Steps the swing from the legs and returns both arms.
// st: createGaitArms(); spread: the left ankle's lead over the right along the way the body
// faces (m, last frame's legs); speed (m/s); hand: +1 right-handed (the paddle arm is the right
// one in the standard frame); paddle: holding a paddle (it rides in the paddle hand)
// -> { P: { hand, pole }, O: { hand, pole }, axis (the paddle's way), swing, angles }
export const stepGaitArms = (st, { spread = 0, speed = 0, hand = 1, dt = 1 / 60, paddle = true } = {}) => {
  // the stride's size, followed slowly, so the swing signal is about -1..1 at heel strike
  const mag = Math.abs(spread)
  st.amp = Math.max(0.12, mag > st.amp ? lerp(st.amp, mag, 1 - Math.exp(-dt * 12)) : lerp(st.amp, mag, 1 - Math.exp(-dt * 1.2)))
  const want = clamp(spread / st.amp, -1.15, 1.15)
  // a critically damped follower (the arms are pendulums: a touch behind the legs, never a jerk)
  const w0 = 2 * Math.PI * 5.5
  // (small steps: at 30 fps one explicit step of this spring overshoots and flips sign every
  // frame, a flicker of the arms and the paddle)
  const n = Math.max(1, Math.ceil(Math.min(dt, 0.1) / (1 / 240)))
  const h = Math.min(dt, 0.1) / n
  for (let i = 0; i < n; i++) {
    const acc = w0 * w0 * (want - st.s) - 2 * w0 * st.v
    st.v += acc * h
    st.s += st.v * h
  }
  // how much of the swing shows: none standing, all once walking
  const moving = smooth((speed - 0.15) / 0.6)
  st.w = lerp(st.w, moving, 1 - Math.exp(-dt * 6))
  const A = armAngles(speed)
  // the right arm goes forward as the LEFT foot does: in the standard frame the paddle arm is
  // the right one; for a left-hander the paddle arm is the real left one
  const sReal = clamp(st.s, -1, 1) * st.w
  const sPaddle = hand > 0 ? sReal : -sReal
  const one = (side, sw) => {
    // (more back than forward walking; the elbow closes as the arm comes forward)
    const flex = sw >= 0 ? sw * A.fwd : sw * A.back
    const k = (sw + 1) / 2
    const standElbow = 15
    const elbow = lerp(standElbow, lerp(A.elbowBack, A.elbowFront, k), st.w)
    // (standing: a touch forward of straight down, the hands by the front of the thighs)
    const rest = lerp(6, -3 + 4 * A.run, st.w)
    return armFK(side, rest + flex, A.abd, elbow, A.inward * st.w)
  }
  const P = one(1, sPaddle)
  const O = one(-1, -sPaddle)
  // the paddle: walking, it hangs loosely from the hand angled down and forward, the tip out
  // from the leg; running, tipped up in front along the forearm
  const down = norm(V(0.3, -0.62, 0.55))
  const up = norm(add(mul(P.forearm, 0.55), V(0.12, 0.62, 0.45)))
  const axis = paddle ? norm(add(mul(down, 1 - A.run * st.w), mul(up, A.run * st.w))) : norm(P.forearm)
  return { P: { hand: P.wrist, pole: P.pole, elbow: P.elbow }, O: { hand: O.wrist, pole: O.pole, elbow: O.elbow }, axis, swing: sReal, angles: A }
}
