// Pickleball 98: the upper body's plumbing. Pure JavaScript (no three.js), tested in Node
// (strokes.test.js). anim.js uses these every frame:
//
// - Layer weights (ramp): how much the run's arm swing, the ready position, a stroke, a mood
//   or the serve's hold are in charge, each fading in and out over its own time, so one
//   never snaps over another (and the run's arm swing is off on the paddle arm while it
//   holds the ready position or swings).
// - The pop limiter (limitStep, limitTurn): a joint target can move only so far in a frame
//   (more during a forward swing, when the paddle really is that fast).
// - Arms (armIK): two-bone IK (shoulder-elbow-wrist) with joint limits (the elbow can't fold
//   the hand into the shoulder, or straighten past straight) and an elbow direction that
//   turns smoothly: when the pole is useless (pointing along the arm) the elbow keeps where
//   it was instead of flipping round.
// - Capsules (pushOut): keeps the hands and the paddle out of the torso and thighs.
// - The head (lookToward): turns toward the ball within a neck's limits, at a top speed.

const V = (x = 0, y = 0, z = 0) => ({ x, y, z })
const add = (a, b) => V(a.x + b.x, a.y + b.y, a.z + b.z)
const sub = (a, b) => V(a.x - b.x, a.y - b.y, a.z - b.z)
const mul = (a, s) => V(a.x * s, a.y * s, a.z * s)
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z
const cross = (a, b) => V(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x)
const len = (a) => Math.hypot(a.x, a.y, a.z)
const norm = (a, fallback = V(0, 1, 0)) => {
  const l = len(a)
  return l > 1e-9 ? mul(a, 1 / l) : { ...fallback }
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
export const angleBetween = (a, b) => Math.acos(clamp(dot(norm(a), norm(b)), -1, 1))

// ---- layer weights ----
// toward target: up over tIn seconds, down over tOut (linear; use smoothW to ease)
export const ramp = (cur, target, dt, tIn = 0.15, tOut = 0.2) => (cur < target ? Math.min(target, cur + dt / tIn) : Math.max(target, cur - dt / tOut))
export const smoothW = (w) => {
  const u = clamp(w, 0, 1)
  return u * u * (3 - 2 * u)
}

// ---- the pop limiter ----
// a point: at most maxDist from where it was
export const limitStep = (prev, next, maxDist) => {
  if (!prev) return { ...next }
  const d = sub(next, prev)
  const l = len(d)
  return l <= maxDist ? { ...next } : add(prev, mul(d, maxDist / l))
}
// a direction (unit): at most maxAngle (radians) from where it was
export const limitTurn = (prev, next, maxAngle) => {
  const b = norm(next)
  if (!prev) return b
  const a = norm(prev)
  const ang = Math.acos(clamp(dot(a, b), -1, 1))
  if (ang <= maxAngle) return b
  // rotate a toward b by maxAngle (in their plane)
  let axis = cross(a, b)
  if (len(axis) < 1e-9) axis = Math.abs(a.y) < 0.9 ? cross(a, V(0, 1, 0)) : cross(a, V(1, 0, 0))
  axis = norm(axis)
  const perp = norm(cross(axis, a))
  return norm(add(mul(a, Math.cos(maxAngle)), mul(perp, Math.sin(maxAngle))))
}

// ---- capsules ----
// the point p pushed out of a capsule (segment a-b, radius r); returns the push (zero if outside)
export const pushOut = (p, a, b, r) => {
  const ab = sub(b, a)
  const l2 = dot(ab, ab) || 1
  const t = clamp(dot(sub(p, a), ab) / l2, 0, 1)
  const q = add(a, mul(ab, t))
  const d = sub(p, q)
  const l = len(d)
  if (l >= r) return V()
  // (dead on the axis: out along the capsule's own sideways direction)
  const dir = l > 1e-6 ? mul(d, 1 / l) : norm(cross(ab, V(0, 0, 1)), V(1, 0, 0))
  return mul(dir, r - l)
}

// ---- arms ----
export const ARM_LIMITS = {
  minReach: 0.17, // the hand can't come closer to the shoulder than this (the elbow's fold)
  maxStraight: 0.995, // of the arm's full length (a straight arm, never past it)
}
// Two-bone IK from the shoulder a toward target t, lengths l1 and l2, the elbow toward pole.
// st keeps the elbow's last direction (the bend), so it turns at most maxTurn a frame.
// Returns { mid (elbow), end (wrist), bend, reached }.
export const armIK = (st, a, t, l1, l2, pole, { maxTurn = Infinity, limits = ARM_LIMITS } = {}) => {
  let d = sub(t, a)
  let dist = len(d)
  const full = l1 + l2
  const dir = norm(d, norm(pole, V(0, -1, 0)))
  const reached = dist <= full * limits.maxStraight + 1e-9
  dist = clamp(dist, Math.max(limits.minReach, Math.abs(l1 - l2) + 1e-4), full * limits.maxStraight)
  // where the elbow wants to point: the pole's part across the arm
  let want = sub(pole, mul(dir, dot(pole, dir)))
  const prev = st.bend ? sub(st.bend, mul(dir, dot(st.bend, dir))) : null
  if (len(want) < 0.25 * len(pole) && prev && len(prev) > 1e-3) {
    // (the pole points along the arm: no good; keep the elbow where it was)
    want = prev
  }
  if (len(want) < 1e-6) want = Math.abs(dir.y) < 0.9 ? cross(dir, V(0, 1, 0)) : cross(dir, V(1, 0, 0))
  want = norm(want)
  let bend = prev && len(prev) > 1e-3 && maxTurn < Math.PI ? limitTurn(norm(prev), want, maxTurn) : want
  // keep it across the arm
  bend = norm(sub(bend, mul(dir, dot(bend, dir))), want)
  st.bend = bend
  const cosA = clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1)
  const sinA = Math.sqrt(1 - cosA * cosA)
  const mid = add(a, add(mul(dir, l1 * cosA), mul(bend, l1 * sinA)))
  const end = add(a, mul(dir, dist))
  return { mid, end, bend, reached }
}
// the elbow's bend (radians, 0 = straight) for a solved arm
export const elbowBend = (a, mid, end) => Math.PI - angleBetween(sub(a, mid), sub(end, mid))

// ---- the head ----
// Turns st.dir toward `want` (a unit direction), within maxYaw of the chest's forward (left and
// right), maxUp / maxDown of level, at most rate radians a second.
export const lookToward = (st, want, chestF, dt, { maxYaw = 1.3, maxUp = 0.6, maxDown = 0.8, rate = 7 } = {}) => {
  const f = norm(V(chestF.x, 0, chestF.z), V(0, 0, 1))
  const r = V(-f.z, 0, f.x) // (to the chest's left or right: the sign doesn't matter)
  const w = norm(want, f)
  let yaw = Math.atan2(dot(w, r), dot(w, f))
  let pitch = Math.asin(clamp(w.y, -1, 1))
  yaw = clamp(yaw, -maxYaw, maxYaw)
  pitch = clamp(pitch, -maxDown, maxUp)
  const lim = add(mul(add(mul(f, Math.cos(yaw)), mul(r, Math.sin(yaw))), Math.cos(pitch)), V(0, Math.sin(pitch), 0))
  st.dir = st.dir ? limitTurn(st.dir, lim, rate * dt) : norm(lim)
  return st.dir
}
