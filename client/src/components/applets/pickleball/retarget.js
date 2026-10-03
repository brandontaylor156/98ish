// Pickleball 98: the math that puts the skinned athletes (athlete.js) into the poses anim.js
// works out. Pure JavaScript (no three.js), tested in Node:
//
// - Quaternions ({x, y, z, w}) and frames: a bone is turned so its own axis (toward its
//   child joint) points where the pose wants, with a second direction fixing its roll.
// - Limbs: two-bone IK with the model's own bone lengths, stretching a little (never more
//   than a set amount) when the pose asks for more reach than the model has.
// - The paddle hand: which side of the paddle the palm is on (with hysteresis, so the hand
//   never flips back and forth), and how much of the hand's roll the forearm takes.
// - Clip layers: the motion-captured clips (moves.json, Quaternius' CC0 animation library)
//   play on top of the procedural pose as small additive moves (breathing, the run's bounce,
//   a dance). Each layer fades in and out (a crossfade), and the run clips are locked to the
//   gait's step phase so the bounce lands with the feet.

import { twoBone } from "./anim.js"

// ---- vectors ----
const V = (x = 0, y = 0, z = 0) => ({ x, y, z })
const sub = (a, b) => V(a.x - b.x, a.y - b.y, a.z - b.z)
const add = (a, b) => V(a.x + b.x, a.y + b.y, a.z + b.z)
const mul = (a, s) => V(a.x * s, a.y * s, a.z * s)
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z
const cross = (a, b) => V(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x)
const len = (a) => Math.hypot(a.x, a.y, a.z)
export const norm = (a, fallback = V(0, 1, 0)) => {
  const l = len(a)
  return l > 1e-9 ? mul(a, 1 / l) : { ...fallback }
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

// ---- quaternions ----
export const Q = (x = 0, y = 0, z = 0, w = 1) => ({ x, y, z, w })
export const qmul = (a, b) => Q(a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y, a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x, a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w, a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z)
export const qinv = (q) => Q(-q.x, -q.y, -q.z, q.w) // (unit quaternions)
export const qnorm = (q) => {
  const l = Math.hypot(q.x, q.y, q.z, q.w) || 1
  return Q(q.x / l, q.y / l, q.z / l, q.w / l)
}
export const qrot = (q, v) => {
  // v + 2w(u x v) + 2u x (u x v)
  const u = V(q.x, q.y, q.z)
  const t = mul(cross(u, v), 2)
  return add(add(v, mul(t, q.w)), cross(u, t))
}
export const qaxis = (axis, angle) => {
  const a = norm(axis)
  const s = Math.sin(angle / 2)
  return Q(a.x * s, a.y * s, a.z * s, Math.cos(angle / 2))
}
export const qslerp = (a, b, t) => {
  let d = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w
  const s = d < 0 ? -1 : 1
  d *= s
  if (d > 0.9995) return qnorm(Q(a.x + (s * b.x - a.x) * t, a.y + (s * b.y - a.y) * t, a.z + (s * b.z - a.z) * t, a.w + (s * b.w - a.w) * t))
  const th = Math.acos(d)
  const k0 = Math.sin((1 - t) * th) / Math.sin(th)
  const k1 = (s * Math.sin(t * th)) / Math.sin(th)
  return Q(a.x * k0 + b.x * k1, a.y * k0 + b.y * k1, a.z * k0 + b.z * k1, a.w * k0 + b.w * k1)
}
export const qangle = (a, b) => 2 * Math.acos(clamp(Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w), 0, 1))

// the rotation whose columns are the (orthonormal) x, y, z axes
export const qbasis = (x, y, z) => {
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = [x.x, y.x, z.x, x.y, y.y, z.y, x.z, y.z, z.z]
  const tr = m00 + m11 + m22
  let q
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1)
    q = Q((m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s)
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22)
    q = Q(0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s)
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22)
    q = Q((m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s)
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11)
    q = Q((m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s)
  }
  return qnorm(q)
}

// a frame from a main axis (exact) and a hint for a second one (made perpendicular):
// y = primary, z = the hint's part perpendicular to it, x = y cross z
export const frameOf = (primary, hint) => {
  const y = norm(primary)
  let z = sub(hint, mul(y, dot(hint, y)))
  if (len(z) < 1e-6) z = Math.abs(y.y) < 0.9 ? cross(V(0, 1, 0), y) : cross(V(1, 0, 0), y)
  z = norm(z)
  return qbasis(cross(y, z), y, z)
}

// The world rotation that takes a bone's rest directions (p0 along the bone, s0 fixing its
// roll) onto p and s. A bone's new world rotation is aimDelta(...) * its rest rotation.
export const aimDelta = (p0, s0, p, s) => qmul(frameOf(p, s), qinv(frameOf(p0, s0)))

// split q into a swing (moving axis) then a twist (about axis): q = swing * twist
export const swingTwist = (q, axis) => {
  const a = norm(axis)
  const d = q.x * a.x + q.y * a.y + q.z * a.z
  let twist = Q(a.x * d, a.y * d, a.z * d, q.w)
  const l = Math.hypot(twist.x, twist.y, twist.z, twist.w)
  twist = l < 1e-9 ? Q() : Q(twist.x / l, twist.y / l, twist.z / l, twist.w / l)
  return { swing: qmul(q, qinv(twist)), twist }
}
export const twistAngle = (twist, axis) => {
  const s = twist.x * axis.x + twist.y * axis.y + twist.z * axis.z
  let a = 2 * Math.atan2(s, twist.w)
  if (a > Math.PI) a -= 2 * Math.PI
  if (a < -Math.PI) a += 2 * Math.PI
  return a
}

// ---- limbs ----
// Two bones (lengths l1, l2) from root toward target, bending toward pole. If the target is
// out of reach, the bones stretch up to maxStretch (1.1 = 10%) to get there.
export const solveLimb = (root, target, l1, l2, pole, maxStretch = 1) => {
  const dist = len(sub(target, root))
  const stretch = clamp(dist / ((l1 + l2) * 0.999), 1, maxStretch)
  const ik = twoBone(root, target, l1 * stretch, l2 * stretch, pole)
  return { mid: ik.mid, end: ik.end, stretch }
}

// The bend axis of a limb (upper and lower directions), falling back on the pole when the
// limb is straight
export const bendAxis = (upper, lower, pole) => {
  const n = cross(upper, lower)
  if (len(n) > 1e-3) return norm(n)
  return norm(cross(upper, pole), V(1, 0, 0))
}

// Which side of the paddle the palm is on: +1 (palm behind the face the pose calls the
// front) or -1. d: how much the hand's natural palm direction agrees with the face (-1..1).
// It only changes when the other side is clearly better, so the grip never flickers.
export const gripSide = (prev, d, margin = 0.35) => {
  if (!prev) return d >= 0 ? 1 : -1
  if (prev > 0 && d < -margin) return -1
  if (prev < 0 && d > margin) return 1
  return prev
}

// ---- clip layers ----
// Additive layers on the procedural pose, by situation. Weights are how much of each clip's
// motion (relative to its own first frame) is added; bones: which bones it moves, and how much.
export const LAYERS = {
  breathe: { clip: "Idle_Loop", gain: 1, bones: { spine_01: 0.6, spine_02: 0.8, spine_03: 1, neck_01: 0.6, clavicle_l: 1, clavicle_r: 1 } },
  jog: { clip: "Jog_Fwd_Loop", gain: 0.8, bones: { pelvis: 0.5, spine_01: 0.6, spine_02: 0.7, spine_03: 0.7, neck_01: 0.4, clavicle_l: 0.8, clavicle_r: 0.8 } },
  sprint: { clip: "Sprint_Loop", gain: 0.7, bones: { pelvis: 0.5, spine_01: 0.5, spine_02: 0.6, spine_03: 0.6, neck_01: 0.3, clavicle_l: 0.7, clavicle_r: 0.7 } },
  dance: { clip: "Dance_Loop", gain: 1, bones: { pelvis: 1, spine_01: 1, spine_02: 1, spine_03: 1, neck_01: 1, Head: 0.6, clavicle_l: 0.6, clavicle_r: 0.6 } },
}
export const FADE = 0.25 // seconds for a crossfade

// what each layer should be at for a moment: speed (m/s), swinging, the mood
export const layerTargets = ({ speed = 0, swinging = false, mood = null, between = false }) => {
  const run = clamp((speed - 0.8) / 1.2, 0, 1)
  const sprint = clamp((speed - 3.2) / 1.2, 0, 1)
  const dance = mood && mood.kind === "cheer" && mood.variant === 2 && between ? 1 : 0
  return {
    breathe: swinging ? 0.3 : 1 - run * 0.7,
    jog: swinging ? 0 : run * (1 - sprint),
    sprint: swinging ? 0 : run * sprint,
    dance,
  }
}

// move layer weights toward their targets: a crossfade of FADE seconds
export const stepLayers = (weights, targets, dt, fade = FADE) => {
  const k = dt / fade
  for (const name of Object.keys(targets)) {
    const w = weights[name] ?? 0
    const t = targets[name]
    weights[name] = w < t ? Math.min(t, w + k) : Math.max(t, w - k)
  }
  return weights
}

// where in a looping clip to be: run clips follow the gait (a full cycle per two steps, so
// each footfall in the clip lands with a footfall on the court); others play in real time
export const clipTime = (clip, { phase = 0, time = 0, locked = false }) => {
  const d = clip.duration || 1
  const u = locked ? phase / (Math.PI * 2) : time / d
  return (((u % 1) + 1) % 1) * d
}

// ---- moves.json ----
const base64 = (s) => {
  if (typeof atob === "function") {
    const bin = atob(s)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  }
  return new Uint8Array(Buffer.from(s, "base64"))
}
export const decodeMoves = (json) => {
  const clips = {}
  for (const [name, c] of Object.entries(json.clips)) {
    const bytes = base64(c.data)
    const ints = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2)
    const data = new Float32Array(ints.length)
    for (let i = 0; i < ints.length; i++) data[i] = ints[i] / 32767
    clips[name] = { name, duration: c.duration, frames: c.frames, fps: json.fps, data }
  }
  return { bones: json.bones, index: Object.fromEntries(json.bones.map((b, i) => [b, i])), rest: json.rest, clips }
}
const frameQ = (moves, clip, f, b) => {
  const o = (f * moves.bones.length + b) * 4
  return qnorm(Q(clip.data[o], clip.data[o + 1], clip.data[o + 2], clip.data[o + 3]))
}
// a bone's rotation in a clip at time t (looping)
export const sampleClip = (moves, clip, bone, t) => {
  const b = moves.index[bone]
  if (b === undefined) return Q()
  const x = (((t * clip.fps) % clip.frames) + clip.frames) % clip.frames
  const f0 = Math.floor(x)
  const f1 = (f0 + 1) % clip.frames
  return qslerp(frameQ(moves, clip, f0, b), frameQ(moves, clip, f1, b), x - f0)
}
// a bone's move in a clip at time t, relative to the clip's first frame, scaled by w
// (0 = no move): what gets added on top of the procedural pose
export const additiveMove = (moves, clip, bone, t, w) => {
  if (w <= 1e-4) return Q()
  const ref = sampleClip(moves, clip, bone, 0)
  const q = sampleClip(moves, clip, bone, t)
  return qslerp(Q(), qmul(qinv(ref), q), clamp(w, 0, 1))
}
