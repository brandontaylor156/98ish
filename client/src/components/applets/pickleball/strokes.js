// Pickleball 98: the strokes (what the arms and shoulders do for a shot). Pure JavaScript
// (no three.js), tested in Node (strokes.test.js). anim.js asks it for the paddle hand, the
// paddle's direction, the shoulders' turn and the other hand every frame; the match (physics,
// rules, AI) alone decides when and where the ball is hit, so this is presentation only.
//
// - Which stroke (chooseStroke, chooseSide): from the shot's kind AND where the ball will be
//   met: forehand or backhand by the side of the body (a ball at the chest at the net is a
//   backhand, like a real player's), and a dink, block, punch volley, drive, lob, slice,
//   overhead or the underhand serve by height and kind.
// - When (predictContact): the ball's own flight (physics.js, bounces included) and the
//   match's reach rules say when and where the paddle will meet it, refreshed every frame, so
//   the forward swing arrives with the ball instead of at a planned moment the AI never keeps.
// - How (stepStroke): a small state machine: wind up (a unit turn: shoulders coil, paddle
//   back) at a capped speed, then the forward swing along a curve (cubic Hermite) that passes
//   through the contact point exactly when the ball gets there, with its fastest speed there,
//   then the follow-through, a short hold, and the recovery to the ready position. Each phase
//   starts from where the last one left the arm, so nothing jumps. The shoulders lead the arm
//   (they unwind a little ahead of the paddle).
//
// Everything is in the body's frame (x: to the right, y: up, z: forward) for a RIGHT-handed
// player; anim.js mirrors x for left-handers. side: +1 forehand, -1 backhand.

import { BALL_R, bounceOnCourt, flightStep } from "./physics.js"
import { REACH } from "./ai.js"

const V = (x = 0, y = 0, z = 0) => ({ x, y, z })
const add = (a, b) => V(a.x + b.x, a.y + b.y, a.z + b.z)
const sub = (a, b) => V(a.x - b.x, a.y - b.y, a.z - b.z)
const mul = (a, s) => V(a.x * s, a.y * s, a.z * s)
const len = (a) => Math.hypot(a.x, a.y, a.z)
const norm = (a, fallback = V(0, 1, 0)) => {
  const l = len(a)
  return l > 1e-9 ? mul(a, 1 / l) : { ...fallback }
}
const lerp = (a, b, t) => a + (b - a) * t
const lerpV = (a, b, t) => V(lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t))
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const smooth = (t) => {
  const u = clamp(t, 0, 1)
  return u * u * (3 - 2 * u)
}
const N = (x, y, z) => norm(V(x, y, z))

export const PADDLE_REACH = 0.25 // the hand (wrist) to the paddle face's center (anim.js BODY)
const ARM_REACH = 0.53 // a little short of a straight arm (anim.js BODY: 0.29 + 0.27)
const MAX_HIT_Y = 2.3 // (match.js: nothing higher is hittable)

// ---- the strokes: timings (seconds) ----
// prep: the wind-up starts this long before contact; fwd: the forward swing; fin: the
// follow-through; hold: held at the finish; rec: back to ready
export const STYLES = {
  drive: { prep: 0.55, fwd: 0.17, fin: 0.24, hold: 0.06, rec: 0.36, wind: 0.24 },
  slice: { prep: 0.55, fwd: 0.18, fin: 0.24, hold: 0.06, rec: 0.36, wind: 0.24 },
  lob: { prep: 0.55, fwd: 0.2, fin: 0.28, hold: 0.08, rec: 0.38, wind: 0.24 },
  dink: { prep: 0.5, fwd: 0.24, fin: 0.24, hold: 0.06, rec: 0.38, wind: 0.22 },
  block: { prep: 0.35, fwd: 0.08, fin: 0.13, hold: 0.06, rec: 0.3, wind: 0.14 },
  punch: { prep: 0.4, fwd: 0.09, fin: 0.14, hold: 0.04, rec: 0.32, wind: 0.16 },
  overhead: { prep: 0.7, fwd: 0.2, fin: 0.26, hold: 0.05, rec: 0.42, wind: 0.3 },
  serve: { prep: 0.6, fwd: 0.26, fin: 0.3, hold: 0.08, rec: 0.42, wind: 0.24 },
}
export const strokeLength = (style) => {
  const S = STYLES[style] || STYLES.drive
  return S.fin + S.hold + S.rec
}

// ---- which stroke ----
const SOFT = new Set(["dink", "drop", "reset", "block", "roll"])
// kind: the shot (match.js / shots.js), c: the contact in the body frame (right-handed)
export const chooseStroke = (kind, c, { volley = false } = {}) => {
  if (kind === "serve") return "serve"
  const soft = SOFT.has(kind)
  if (c.y > 1.62 && !soft) return "overhead"
  if (soft) return c.y < 0.62 ? "dink" : "block"
  if (kind === "lob") return c.y > 1.3 ? "punch" : "lob"
  if (kind === "smash") return c.y > 1.45 ? "overhead" : "punch"
  if (kind === "punch" || kind === "speedup" || kind === "counter" || (volley && c.y > 0.75)) return c.y > 0.55 ? "punch" : "drive"
  if (kind === "slice") return c.y > 0.65 ? "slice" : "drive"
  return "drive"
}
// forehand (+1) or backhand (-1): by the side of the body; a ball at the chest, in front of
// the body at the net, is met on the backhand; prev: this ball's earlier choice (it sticks
// unless the ball has clearly gone to the other side)
export const chooseSide = (c, style, prev = 0) => {
  if (style === "serve" || style === "overhead") return 1
  let side = c.x >= 0.04 ? 1 : -1
  if ((style === "punch" || style === "block") && c.y > 0.85 && c.x > -0.04 && c.x < 0.16) side = -1
  if (prev && prev !== side && Math.abs(c.x - 0.04) < 0.2) return prev
  return side
}

// ---- the paddle at contact ----
// the paddle's direction from the hand when it meets a ball at c: out to the side at the
// waist (head level with the wrist), head down for low balls, up for high ones
export const contactAxis = (c, side, style) => {
  if (style === "overhead") return N(0.12, 0.92, 0.38)
  if (style === "serve") return N(0.25, -0.62, 0.7)
  if (style === "dink") return N(0.32 * side, -0.72, 0.5)
  const y = c.y
  const low = N(0.42 * side, -0.78 + clamp(y, 0, 0.6) * 0.5, 0.38)
  const mid = N(0.92 * side, (y - 1.0) * 0.7, 0.36)
  const high = N(0.45 * side, 0.8, 0.3)
  if (y < 0.75) return norm(lerpV(low, mid, smooth((y - 0.35) / 0.4)))
  return norm(lerpV(mid, high, smooth((y - 1.15) / 0.35)))
}
export const contactHand = (c, axis) => sub(c, mul(axis, PADDLE_REACH))

// ---- the keyframes of a stroke: back (end of the wind-up), contact, follow (the finish) ----
// Each: hand (wrist), axis (paddle direction), coil (shoulder turn: + the paddle shoulder
// back, - it through), off (the other hand), pole (where the paddle elbow points), lean
// (extra forward bend), crouch (extra knee bend)
const P = (hand, axis, coil, off, pole, lean = 0, crouch = 0) => ({ hand, axis, coil, off, pole, lean, crouch })
const yAt = (c, add0, lo, hi) => clamp(c.y + add0, lo, hi)

export const strokeKeys = (style, side, c) => {
  const ax = contactAxis(c, side, style)
  const ch = contactHand(c, ax)
  const s = side
  const wide = Math.abs(c.x) > 0.75 // a reach: the other arm goes out for balance
  const balance = (k) => (wide ? { ...k, off: V(-0.5 * s, 1.12, -0.02) } : k)
  let back
  let contact
  let follow
  switch (style) {
    case "dink": {
      // a pendulum from the shoulder out in front: a short take-back, the face open, lifting
      // through toward the target; the knees do the bending
      back = P(add(ch, V(0.02 * s, 0.04, -0.12)), N(0.3 * s, -0.84, 0.3), 0.2 * s, V(-0.34 * s, 1.0, 0.36), V(0.45 * s, -1, -0.2), 0.04, 0.04)
      contact = P(ch, ax, 0.04 * s, V(-0.36 * s, 1.0, 0.38), V(0.4 * s, -1, 0.1), 0.06, 0.05)
      follow = P(add(ch, V(-0.04 * s, 0.12, 0.22)), N(0.22 * s, -0.3, 0.92), -0.08 * s, V(-0.36 * s, 1.0, 0.36), V(0.35 * s, -1, 0.3), 0.05, 0.04)
      break
    }
    case "block": {
      back = P(add(ch, V(0.06 * s, 0.03, -0.1)), ax, 0.22 * s, V(-0.12, 1.14, 0.36), V(0.45 * s, -1, -0.1))
      contact = P(ch, ax, 0.02 * s, V(-0.2, 1.12, 0.32), V(0.45 * s, -1, 0.15), 0.04)
      follow = P(add(ch, V(-0.02 * s, 0.03, 0.1)), ax, -0.06 * s, V(-0.2, 1.12, 0.32), V(0.45 * s, -1, 0.2), 0.04)
      break
    }
    case "punch": {
      const bAx = norm(add(ax, V(0.15 * s, 0.35, -0.25)))
      back = P(add(ch, V(0.1 * s, 0.07, -0.16)), bAx, 0.35 * s, V(-0.14, 1.14, 0.36), V(0.5 * s, -1, -0.25))
      contact = P(ch, ax, -0.04 * s, V(-0.24, 1.1, 0.3), V(0.45 * s, -1, 0.2), 0.08)
      follow = P(add(ch, V(-0.07 * s, -0.05, 0.25)), norm(add(ax, V(-0.1 * s, -0.1, 0.25))), -0.3 * s, V(-0.28, 1.06, 0.2), V(0.3 * s, -1, 0.5), 0.1)
      break
    }
    case "overhead": {
      const top = Math.min(c.y, 2.1)
      back = P(V(0.3, clamp(c.y - 0.42, 1.5, 1.72), -0.14), N(0.12, -0.45, -0.88), 0.9, V(-0.04, top - 0.08, 0.32), V(1, 0.05, -0.25), -0.08)
      contact = P(ch, ax, -0.05, V(-0.22, 1.3, 0.22), V(0.75, -0.25, 0.3), 0.14)
      follow = P(V(-0.24, 0.98, 0.38), N(-0.3, -0.75, 0.55), -0.72, V(-0.3, 1.0, 0.02), V(0.3, -0.45, 0.85), 0.3, 0.03)
      break
    }
    case "serve": {
      // (the other hand stays where it let the ball go: match.js handPos)
      back = P(V(0.3, 0.74, -0.38), N(0.12, -0.85, -0.5), 0.45, V(0.12, 0.96, 0.4), V(0.45, -1, -0.3), 0.12)
      contact = P(ch, ax, 0.02, V(-0.28, 1.04, 0.2), V(0.4, -1, 0.15), 0.12)
      follow = P(V(0.2, 1.14, 0.56), N(0.22, 0.72, 0.62), -0.35, V(-0.32, 1.02, 0.06), V(0.35, -0.8, 0.5), 0.06)
      break
    }
    case "lob": {
      if (s > 0) {
        back = P(V(0.4, yAt(c, 0.05, 0.7, 1.0), -0.3), N(0.3, -0.55, -0.78), 0.65, V(0.02, 1.16, 0.4), V(0.45, -1, -0.35), 0.06, 0.03)
        follow = P(V(0.02, 1.58, 0.42), N(0.05, 0.95, 0.3), -0.45, V(-0.32, 1.05, 0.05), V(0.2, -0.4, 1), 0.02)
      } else {
        back = P(V(-0.24, yAt(c, 0.05, 0.72, 1.0), -0.06), N(-0.32, -0.5, -0.8), -0.75, V(-0.2, 1.0, 0.0), V(-0.2, -0.75, 0.6), 0.06, 0.03)
        follow = P(V(0.3, 1.52, 0.4), N(0.25, 0.92, 0.3), 0.1, V(-0.48, 1.05, -0.22), V(0.25, -1, 0.25), 0.02)
      }
      contact = P(ch, ax, s > 0 ? -0.05 : -0.25, s > 0 ? V(-0.2, 1.1, 0.28) : V(-0.42, 1.0, -0.12), V(0.4 * s, -1, 0.1), 0.08)
      break
    }
    case "slice": {
      if (s > 0) {
        back = P(V(0.42, yAt(c, 0.35, 1.0, 1.45), -0.26), N(0.35, 0.68, -0.64), 0.75, V(0.04, 1.2, 0.4), V(0.5, -1, -0.35))
        follow = P(V(-0.04, 0.98, 0.55), N(-0.3, 0.15, 0.94), -0.35, V(-0.3, 1.05, 0.1), V(0.3, -1, 0.5), 0.1)
      } else {
        back = P(V(-0.24, yAt(c, 0.32, 1.0, 1.4), -0.04), N(-0.35, 0.65, -0.67), -0.8, V(-0.2, 1.14, 0.08), V(-0.2, -0.75, 0.6))
        follow = P(V(0.26, 0.98, 0.5), N(0.35, 0.15, 0.92), -0.1, V(-0.48, 1.04, -0.2), V(0.3, -1, 0.3), 0.1)
      }
      contact = P(ch, ax, s > 0 ? -0.05 : -0.3, s > 0 ? V(-0.2, 1.1, 0.28) : V(-0.42, 1.0, -0.12), V(0.4 * s, -1, 0.1), 0.08)
      break
    }
    default: {
      // the drive: a unit turn, the paddle back at about the ball's height, low to high
      // through the contact in front of the front hip, finishing over the other shoulder
      // (forehand) or up and out on the paddle side (backhand), shoulders through
      if (s > 0) {
        back = P(V(0.42, yAt(c, 0.12, 0.8, 1.25), -0.32), N(0.25, 0.75, -0.6), 0.85, V(0.04, 1.18, 0.4), V(0.45, -1, -0.35), 0.05)
        contact = P(ch, ax, -0.1, V(-0.2, 1.12, 0.3), V(0.5, -1, 0.1), 0.12)
        follow = P(V(-0.2, 1.38, 0.4), N(-0.22, 0.75, -0.6), -0.85, V(-0.32, 1.05, 0.05), V(0.15, -0.35, 1), 0.08)
      } else {
        back = P(V(-0.25, yAt(c, 0.1, 0.8, 1.2), -0.05), N(-0.35, 0.6, -0.7), -0.85, null, V(-0.2, -0.7, 0.7), 0.05)
        contact = P(ch, ax, -0.25, V(-0.45, 1.0, -0.15), V(-0.1, -0.9, 0.4), 0.1)
        follow = P(V(0.42, 1.38, 0.5), N(0.3, 0.88, 0.25), 0.12, V(-0.5, 1.05, -0.25), V(0.2, -1, 0.2), 0.06)
      }
    }
  }
  // a two-handed take-back on the backhand: the other hand on the paddle's throat
  if (!back.off) back.off = add(back.hand, add(mul(back.axis, 0.07), V(-0.02, 0, 0.03)))
  if (style !== "serve" && style !== "overhead") {
    contact = balance(contact)
    follow = balance(follow)
  }
  return { back, contact, follow }
}

// ---- curves ----
// a cubic Hermite from p0 (velocity v0) to p1 (velocity v1) over a segment of length T, at u in 0..1
export const hermite = (p0, v0, p1, v1, T, u) => {
  const u2 = u * u
  const u3 = u2 * u
  const h00 = 2 * u3 - 3 * u2 + 1
  const h10 = u3 - 2 * u2 + u
  const h01 = -2 * u3 + 3 * u2
  const h11 = u3 - u2
  return V(h00 * p0.x + h10 * T * v0.x + h01 * p1.x + h11 * T * v1.x, h00 * p0.y + h10 * T * v0.y + h01 * p1.y + h11 * T * v1.y, h00 * p0.z + h10 * T * v0.z + h01 * p1.z + h11 * T * v1.z)
}
// the hand's speed through contact: along the swing (back to finish), fastest there
const contactVelocity = (from, contact, follow, S) => mul(sub(follow, from), 1.25 / (S.fwd + S.fin))

// From a to b round the point o (a shoulder): the direction turns and the distance changes
// evenly, so a hand going from low in front to up behind the head swings round the shoulder
// like an arm does, instead of cutting through it (where the elbow would flip)
export const arcLerp = (a, b, t, o) => {
  const da = sub(a, o)
  const db = sub(b, o)
  const la = len(da)
  const lb = len(db)
  if (la < 1e-6 || lb < 1e-6) return lerpV(a, b, t)
  const ua = mul(da, 1 / la)
  const ub = mul(db, 1 / lb)
  const d = clamp(ua.x * ub.x + ua.y * ub.y + ua.z * ub.z, -1, 1)
  if (d < -0.97) return lerpV(a, b, t) // (straight through: no plane to turn in)
  const th = Math.acos(d)
  let u
  if (th < 1e-4) u = ua
  else {
    const k0 = Math.sin((1 - t) * th) / Math.sin(th)
    const k1 = Math.sin(t * th) / Math.sin(th)
    u = add(mul(ua, k0), mul(ub, k1))
  }
  return add(o, mul(u, lerp(la, lb, t)))
}
// the shoulders (right-handed body frame), for a pose whose shoulders are at height sh
export const shoulders = (sh = 1.3) => ({ p: V(0.18, sh, 0.1), o: V(-0.18, sh, 0.1) })

// blend two poses: the hands swing round their shoulders
export const mixPose = (a, b, t) => {
  if (t <= 0) return { ...a, sh: b.sh ?? a.sh }
  if (t >= 1) return { ...b, sh: b.sh ?? a.sh }
  const sh = shoulders(b.sh ?? a.sh)
  return {
    hand: arcLerp(a.hand, b.hand, t, sh.p),
    axis: norm(lerpV(a.axis, b.axis, t), b.axis),
    coil: lerp(a.coil, b.coil, t),
    off: arcLerp(a.off, b.off, t, sh.o),
    pole: norm(lerpV(a.pole, b.pole, t), b.pole),
    lean: lerp(a.lean || 0, b.lean || 0, t),
    crouch: lerp(a.crouch || 0, b.crouch || 0, t),
    sh: b.sh ?? a.sh,
  }
}
const copyPose = (p) => ({ hand: { ...p.hand }, axis: { ...p.axis }, coil: p.coil, off: { ...p.off }, pole: { ...p.pole }, lean: p.lean || 0, crouch: p.crouch || 0, sh: p.sh })

// ---- the state machine ----
export const createStroke = () => ({ key: null, style: null, side: 1, phase: "none", t: 0, wind: 0, room: 1, from: null, fwdFrom: null, fwdLen: 0, u: 0, c: null, cpose: null, out: null, age: 0 })

// a short take-back for a ball that leaves no time for the full one (the paddle just behind
// the contact, a small turn)
const compactBack = (K, side) => ({ ...K.contact, hand: add(K.contact.hand, V(0.06 * side, 0.05, -0.16)), coil: 0.3 * side, off: K.back.off })

// One frame. inp (null when no ball is coming and no swing is on):
//   key: which ball / swing ("p<ball>" before contact, "s<swing id>" after)
//   kind, contact c (body frame, right-handed), volley
//   tRel: seconds from contact (negative before; the swing's own clock after)
//   after: true once the ball has been hit (the swing)
//   forward: false holds the wind-up (a person still holding the hit control)
// ready: the pose to come from and go back to (hand, axis, coil 0, off, pole)
// Returns { pose (as ready's, plus lean/crouch), w (how much the stroke is in charge, 0..1),
// phase, fast (the forward swing or the follow-through: quick moves allowed), style, side }
export const stepStroke = (st, inp, ready, dt) => {
  st.age += dt
  if (inp) {
    const prepared = st.key && st.key[0] === "p" && (st.phase === "wind" || st.phase === "forward" || st.phase === "contact")
    const sameBall = inp.after && prepared && st.c && len(sub(st.c, inp.c)) < 0.6
    const was = st.out ? copyPose(st.out) : null
    if (inp.key !== st.key) {
      if (sameBall) {
        // the prepared stroke goes on through the real contact point; the follow-through is
        // the one for the shot actually played
        const K0 = strokeKeys(st.style, st.side, inp.c)
        st.cpose = st.phase === "forward" || st.phase === "contact" ? K0.contact : was || K0.contact
        st.key = inp.key
        st.phase = "after"
        st.c = { ...inp.c }
        const style = chooseStroke(inp.kind, inp.c, { volley: inp.volley })
        if (style !== st.style && style !== "serve" && st.style !== "serve") {
          st.style = style
          st.side = chooseSide(inp.c, style, st.side)
        }
      } else {
        const style = chooseStroke(inp.kind, inp.c, { volley: inp.volley })
        st.key = inp.key
        st.style = style
        st.side = chooseSide(inp.c, style, 0)
        st.c = { ...inp.c }
        st.wind = 0
        st.age = 0
        st.room = 1
        st.from = st.phase === "none" ? null : was // (mid-recovery: wind up from where the arm is)
        st.cpose = inp.after ? was : null // (a swing out of nowhere: from where the arm is)
        st.phase = inp.after ? "after" : "wind"
        if (!inp.after) {
          // not much time: a shorter take-back
          const S = STYLES[style] || STYLES.drive
          st.room = clamp((-inp.tRel - S.fwd * 0.6) / Math.max(0.05, S.prep - S.fwd * 0.6), 0, 1)
        }
      }
      if (st.phase === "after") st.t = inp.tRel
    } else if (!inp.after && (st.phase === "none" || st.phase === "unwind")) {
      // the same ball, back again (it was out of sight for a moment): wind up again from here
      st.from = was
      st.age = 0
      st.wind = 0
      st.phase = "wind"
    }
    if (!inp.after) {
      // the contact point settles as the prediction firms up (a quick follow, no jumps)
      const k = 1 - Math.exp(-dt * 30)
      st.c = lerpV(st.c, inp.c, inp.tRel > -0.06 ? 1 : k)
      // the side can still change early in the wind-up, if the ball clearly goes to the other side
      if (st.phase === "wind" && st.wind < 0.35) st.side = chooseSide(st.c, st.style, st.side)
    } else st.t = Math.max(st.t, inp.tRel)
  } else if (st.phase !== "none") {
    // nothing coming: a swing finishes on its own clock; a wind-up for a ball that never
    // came unwinds
    if (st.phase === "after") st.t += dt
    else if (st.phase !== "unwind") {
      st.phase = "unwind"
      st.t = 0
      st.from = st.out ? copyPose(st.out) : null
    } else st.t += dt
  }
  if (st.phase === "none") {
    st.out = copyPose(ready)
    return { pose: st.out, w: 0, phase: "none", fast: false, style: null, side: st.side }
  }
  const S = STYLES[st.style] || STYLES.drive
  const K = strokeKeys(st.style, st.side, st.c)
  K.back.sh = K.contact.sh = K.follow.sh = ready.sh
  if (st.room < 1) K.back = mixPose(compactBack(K, st.side), K.back, smooth(st.room))
  const base = st.from ? mixPose(st.from, ready, smooth(st.age / 0.2)) : ready
  let pose
  let fast = false
  let w = 1
  if (st.phase === "unwind") {
    const e = smooth(st.t / 0.3)
    pose = mixPose(st.from || ready, ready, e)
    w = 1 - e
    if (e >= 1) st.phase = "none"
  } else if (st.phase === "after") {
    const t = st.t
    const C = st.cpose || K.contact
    const vC = contactVelocity(st.fwdFrom?.hand || K.back.hand, C.hand, K.follow.hand, S)
    if (t < S.fin) {
      const u = t / S.fin
      const e = 1 - (1 - u) * (1 - u) // (fast out of contact, slowing to the finish)
      pose = mixPose(C, K.follow, e)
      pose.hand = hermite(C.hand, vC, K.follow.hand, V(), S.fin, u)
      // the shoulders lead: they get to the finish a little ahead of the paddle
      pose.coil = lerp(C.coil, K.follow.coil, smooth(u * 1.25))
      fast = true
    } else if (t < S.fin + S.hold) pose = copyPose(K.follow)
    else {
      const e = smooth((t - S.fin - S.hold) / S.rec)
      pose = mixPose(K.follow, ready, e)
      w = 1 - e
      if (e >= 1) st.phase = "none"
    }
  } else {
    // before contact
    const tRel = inp.tRel
    const goForward = inp.forward && tRel >= -S.fwd
    if (!goForward) {
      // the wind-up: as far as the time to contact says, but never faster than it can be done
      const want = inp.forward ? smooth((tRel + S.prep) / Math.max(0.05, S.prep - S.fwd)) : 1
      st.wind = want >= st.wind ? Math.min(want, st.wind + dt / S.wind) : Math.max(want, st.wind - dt / 0.4)
      pose = mixPose(base, K.back, smooth(st.wind))
      // (a take-back never asks for more than the arm has: the knees bend for a low ball only
      // as it arrives)
      // (raised rather than pulled in, so the paddle stays out in front, clear of the legs)
      const o = shoulders(ready.sh).p
      const d = sub(pose.hand, o)
      if (len(d) > ARM_REACH) {
        const h = Math.hypot(d.x, d.z)
        pose.hand = h < ARM_REACH * 0.98 && d.y < 0 ? V(pose.hand.x, o.y - Math.sqrt(ARM_REACH * ARM_REACH - h * h), pose.hand.z) : add(o, mul(d, ARM_REACH / len(d)))
      }
      st.phase = "wind"
    } else {
      if (st.phase === "wind") {
        // the forward swing starts here, from wherever the wind-up got to
        st.phase = "forward"
        st.fwdFrom = copyPose(st.out || mixPose(base, K.back, smooth(st.wind)))
        st.fwdLen = Math.max(0.04, -tRel)
        st.u = 0
      }
      // the paddle reaches the contact point exactly at contact (u = 1 when tRel = 0)
      const u = clamp(Math.max(st.u, 1 - -tRel / st.fwdLen), 0, 1)
      st.u = u
      const from = st.fwdFrom
      const vC = contactVelocity(from.hand, K.contact.hand, K.follow.hand, S)
      pose = mixPose(from, K.contact, u * u)
      pose.hand = hermite(from.hand, V(), K.contact.hand, vC, st.fwdLen, u)
      // the shoulders unwind ahead of the arm
      pose.coil = lerp(from.coil, K.contact.coil, smooth(Math.min(1, u * 1.35)))
      fast = true
      if (u >= 1) st.phase = "contact" // (holds at contact if the ball is a little late)
    }
  }
  st.out = copyPose(pose)
  return { pose, w, phase: st.phase, fast, style: st.style, side: st.side }
}

// ---- when and where the paddle will meet the ball ----
// The ball flies on (physics.js, with bounces); the player heads for their spot (goal) or
// carries on a moment at their speed. The first moment the match's reach rules (match.js
// canHit) let them hit it is the contact. Returns { t, x, y, z, volley } or null.
//   ball: { p, v, w }; side: the player's court (+1: z > 0); bounces: so far
//   needBounce: they let it bounce first; lunge: they reach for it rather than wait
// Steps of dt (finer near the court, so bounces land on time), and the step where the ball
// comes into reach is gone over again in quarters: about 3 ms of accuracy for the cost of
// stepping at 60 Hz.
export const predictContact = ({ ball, x, z, vx = 0, vz = 0, goal = null, side, bounces = 0, needBounce = false, lunge = false, speed = 0, maxT = 0.9, dt = 1 / 60 }) => {
  const b = { p: { ...ball.p }, v: { ...ball.v }, w: { ...ball.w } }
  let n = bounces
  const sp = Math.max(speed, Math.hypot(vx, vz), 1.5)
  const gd = goal ? Math.hypot(goal.x - x, goal.z - z) : 0
  const at = (t) => {
    if (goal) {
      const k = gd > 1e-6 ? Math.min(1, (sp * t) / gd) : 0
      return { x: x + (goal.x - x) * k, z: z + (goal.z - z) * k }
    }
    const tt = Math.min(t, 0.2)
    return { x: x + vx * tt, z: z + vz * tt }
  }
  // the match's reach rules at time t
  const reachable = (t) => {
    if (b.p.z * side < 0.02) return false
    if (b.p.y > MAX_HIT_Y || b.p.y < BALL_R + 0.02) return false
    if (needBounce && n === 0) return false
    const me = at(t)
    const d = Math.hypot(b.p.x - me.x, b.p.z - me.z)
    if (d > REACH) return false
    const ahead = (me.z - b.p.z) * side
    const coming = b.v.z * side > 1
    return lunge || !(ahead > 0.4 && coming && d > 0.55)
  }
  // one step; false once the ball has bounced twice (the point's over)
  const advance = (h) => {
    flightStep(b, h)
    if (b.p.y <= BALL_R && b.v.y < 0) {
      bounceOnCourt(b)
      n++
    }
    return n <= 1
  }
  const hit = (t) => ({ t, x: b.p.x, y: b.p.y, z: b.p.z, volley: n === 0 })
  if (reachable(0)) return hit(0)
  let t = 0
  while (t < maxT) {
    const h = b.p.y < 0.5 && b.v.y < 0 ? dt / 4 : dt
    const was = { p: { ...b.p }, v: { ...b.v }, w: { ...b.w }, n }
    if (!advance(h)) return null
    if (reachable(t + h)) {
      if (h > dt / 4 + 1e-9) {
        // go over this step again in quarters for the moment it came into reach
        b.p = was.p
        b.v = was.v
        b.w = was.w
        n = was.n
        for (let k = 1; k <= 4; k++) {
          if (!advance(h / 4)) return null
          if (reachable(t + (h * k) / 4)) return hit(t + (h * k) / 4)
        }
      }
      return hit(t + h)
    }
    t += h
  }
  return null
}
