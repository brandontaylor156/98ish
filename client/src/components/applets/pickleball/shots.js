// Pickleball 98: shots. A shot is planned as a target on the other side and an arc (a
// speed for drives and serves, a peak height for dinks, drops and lobs), solved into the
// launch velocity, and then played the way a real paddle would: a face angle and a face
// speed (plus a brush for spin) that hit the incoming ball. Errors go into the face, so a
// shaky hand sprays fast shots more than soft ones, as it does on a real court.

import {
  HALF_L,
  HALF_W,
  KITCHEN,
  MAX_PADDLE_SPEED,
  NET_H_CENTER,
  NET_POST_X,
  add,
  cross,
  dot,
  flyToGround,
  len,
  norm,
  paddleFor,
  paddleHit,
  predictPath,
  scale,
  solveShot,
  topspinAxis,
  v3,
} from "./physics.js"
import { inCourt, rightSign, sideOf, other } from "./rules.js"

export const KINDS = ["dink", "drop", "drive", "slice", "lob", "block", "punch", "smash", "serve", "return", "reset", "speedup", "counter", "roll"]
export const KIND_LABEL = {
  dink: "Dink",
  drop: "Drop shot",
  drive: "Drive",
  slice: "Slice",
  lob: "Lob",
  block: "Block",
  punch: "Punch volley",
  smash: "Put-away",
  serve: "Serve",
  return: "Return",
  reset: "Reset",
  speedup: "Speed-up",
  counter: "Counter",
  roll: "Roll",
}
// the soft shots (they're played to an arc, not a speed)
export const SOFT_KINDS = new Set(["dink", "drop", "block", "reset", "lob"])

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

// Gaussian noise from a 0-1 random source
export const gauss = (rand) => {
  let u = 0
  while (u === 0) u = rand()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
}

// plan a shot: kind, the hitting team, the ball's position, aim (-1..1: toward the hitter's
// left..right), depth (-1..1: shorter..deeper), power (0..1), an explicit target x/z
// (optional), the serve's court and variant ("drive" | "slice" | "soft" | "lob"), a power
// shot (risky: faster, closer to the lines), and how precise the hitter is (sigma in meters)
export const planShot = (kind, { team, from, aim = 0, depth = 0, power = 0.5, targetX, targetZ, court, variant = "drive", risky = false, sigma = 0, rand = Math.random }) => {
  const opp = sideOf(other(team)) // sign of z on the other side
  const hand = rightSign(team) // world x of the hitter's right
  const netTop = NET_H_CENTER + 0.05
  let x = aim * hand * HALF_W * 0.62
  let z = opp * (HALF_L - 1.2)
  let mode
  let spin = 0
  let brush = 0
  let minClear = 0.08
  switch (kind) {
    case "serve": {
      // diagonal: the receiving team's court on the same named side
      const want = (court === "left" ? -1 : 1) * rightSign(other(team))
      x = want * HALF_W * 0.5 + aim * hand * 0.9
      x = want * clamp(x * want, 0.45, HALF_W - 0.4)
      z = opp * (HALF_L - 0.75 - (1 - power) * 0.9 - Math.max(0, -depth) * 1.2)
      mode = { speed: 13 + power * 5 }
      spin = 50 + power * 40
      brush = 2.5
      minClear = 0.25
      if (variant === "slice") {
        // a low, skidding serve with backspin
        mode = { speed: 12 + power * 4 }
        spin = -(50 + power * 30)
        brush = -2.5
        minClear = 0.2
      } else if (variant === "soft" || variant === "lob") {
        // a high, deep floater: easy to hit, hard to attack off a high bounce
        mode = { apex: variant === "lob" ? 3.4 + power * 0.6 : 2.2 + power * 0.5 }
        spin = 30
        brush = 1
        minClear = 0.4
      }
      break
    }
    case "return":
      z = opp * (HALF_L - 1.1)
      mode = { speed: 10.5 + power * 4 }
      spin = 50
      brush = 2
      minClear = 0.3
      break
    case "drive":
      z = opp * (HALF_L - 1.5)
      mode = { speed: 15 + power * 7 }
      spin = 120 + power * 50
      brush = 4.5
      minClear = 0.1
      break
    case "slice":
      // backspin: slower, lower, it skids and stays down after the bounce
      z = opp * (HALF_L - 1.7)
      mode = { speed: 11.5 + power * 5 }
      spin = -(70 + power * 40)
      brush = -2.5
      minClear = 0.12
      break
    case "smash":
      z = opp * 3.2
      mode = { speed: 18 + power * 6 }
      spin = 60
      brush = 2.5
      minClear = 0.08
      break
    case "punch":
      z = opp * (KITCHEN + 1.0)
      mode = { speed: 10 + power * 4 }
      spin = 40
      brush = 1.5
      minClear = 0.06
      break
    case "dink":
      x = aim * hand * HALF_W * 0.6
      z = opp * (KITCHEN - 0.85)
      mode = { apex: Math.max(from.y + 0.1, netTop + 0.12) }
      spin = -15
      brush = -0.5
      minClear = 0.05
      break
    case "block":
      z = opp * (KITCHEN - 0.5)
      mode = { apex: Math.max(from.y + 0.1, netTop + 0.2) }
      spin = -10
      brush = 0
      minClear = 0.05
      break
    case "drop": {
      z = opp * (KITCHEN - 0.55)
      const dist = Math.abs(from.z - z)
      mode = { apex: Math.max(from.y + 0.25, 1.35 + dist * 0.055) }
      spin = 40
      brush = 1.5
      minClear = 0.12
      break
    }
    case "lob":
      z = opp * (HALF_L - 0.9)
      mode = { apex: 4.6 + power * 1.4 }
      spin = 60
      brush = 2
      minClear = 1
      break
    default:
      return planShot("drive", { team, from, aim, power, targetX, targetZ, court, sigma, rand })
  }
  // depth: deeper or shorter than the shot's usual spot (kept on the court)
  if (depth && kind !== "serve") {
    const soft = kind === "dink" || kind === "block"
    const range = soft ? 0.5 : kind === "drop" ? 0.6 : 1.1
    const zz = Math.abs(z) + depth * range
    z = opp * clamp(zz, soft ? 0.5 : 1.0, HALF_L - 0.35)
  }
  // a power shot: harder, closer to the lines, more spin. It can go out.
  if (risky) {
    if (mode.speed !== undefined) mode = { speed: Math.min(mode.speed * 1.2, 27) }
    x *= 1.25
    if (kind !== "dink" && kind !== "drop" && kind !== "block") z = opp * Math.min(HALF_L - 0.3, Math.abs(z) + 0.6)
    spin *= 1.3
    minClear = Math.min(minClear, 0.05)
  }
  if (targetX !== undefined) x = targetX
  if (targetZ !== undefined) z = targetZ
  // the hitter's precision: where they actually aim
  if (sigma > 0) {
    x += gauss(rand) * sigma
    z += gauss(rand) * sigma * (kind === "dink" || kind === "drop" || kind === "block" ? 0.7 : 1)
    // soft shots go wrong by floating up (an attackable pop-up) more than by dropping short
    if (mode.apex !== undefined) mode = { apex: mode.apex + Math.abs(gauss(rand)) * sigma * 0.5 }
    if (mode.speed !== undefined) mode = { speed: mode.speed * (1 + gauss(rand) * sigma * 0.05) }
  }
  return { kind, target: { x, z }, mode, spin, brush, minClear, risky }
}

// ---- timing: how well a shot was struck ----
// delta: seconds between when the swing started and when it should have (negative = early).
// window: the half-width of the "perfect" zone. Returns the grade and what it does to the
// shot: multipliers on the hitter's aim scatter, face wobble and touch error, a pull of the
// aim (early pulls across the body, late pushes the other way), extra height on soft shots
// (a late dink floats up: attackable), and a little pace for a perfectly timed hit.
export const GRADES = ["perfect", "good", "early", "late", "very early", "very late"]
export const gradeOf = (delta, window = 0.06) => {
  const a = Math.abs(delta)
  if (a <= window) return "perfect"
  if (a <= window * 2.2) return "good"
  if (a <= window * 4.5) return delta < 0 ? "early" : "late"
  return delta < 0 ? "very early" : "very late"
}
export const shotQuality = (delta, { window = 0.06, risky = false, kind = "drive" } = {}) => {
  const grade = gradeOf(delta, window)
  const off = Math.max(0, Math.abs(delta) - window) / window // windows past perfect
  const soft = kind === "dink" || kind === "drop" || kind === "block" || kind === "lob"
  const q = { grade, delta, sigma: 1, face: 1, touch: 1, aimShift: 0, apexAdd: 0, speedMul: 1 }
  if (grade === "perfect") {
    q.sigma = risky ? 0.6 : 0.45
    q.face = 0.5
    q.touch = 0.5
    q.speedMul = soft ? 1 : 1.05
  } else if (grade === "good") {
    q.sigma = risky ? 1.25 : 0.85
    q.face = 0.85
    q.touch = 0.85
  } else {
    const k = Math.min(4, off)
    q.sigma = (risky ? 1.9 : 1.3) + k * 0.3
    q.face = 1.3 + k * 0.35
    q.touch = 1.4 + k * 0.3
    q.speedMul = 0.93
    // early: the paddle is still coming across (pulled); late: pushed and opened up
    q.aimShift = clamp(-Math.sign(delta) * (0.12 + k * 0.08), -0.55, 0.55)
    if (soft) q.apexAdd = Math.min(0.55, 0.1 + k * 0.1) * (delta > 0 ? 1 : 0.5)
  }
  return q
}

// The serve meter: hold to fill it (it takes SERVE_FILL seconds), let go near the top.
// Past the top it's over-hit (fast, wild); much too long and it lets go by itself.
export const SERVE_FILL = 0.9
export const SERVE_MAX = 1.4 // the meter lets go at this fill
export const serveMeter = (held) => {
  const v = Math.max(0, held) / SERVE_FILL
  let grade
  if (v > 1.15) grade = "very late"
  else if (v > 1) grade = "late"
  else if (v >= 0.8) grade = "perfect"
  else if (v >= 0.5) grade = "good"
  else grade = "early" // a soft, safe serve
  return { fill: v, power: Math.min(1, v), grade }
}

// Rotate a unit vector by small yaw (around y) and pitch (around the horizontal axis) angles
const tilt = (n, yaw, pitch) => {
  const cy = Math.cos(yaw)
  const sy = Math.sin(yaw)
  let out = v3(n.x * cy + n.z * sy, n.y, -n.x * sy + n.z * cy)
  const side = norm(cross(out, v3(0, 1, 0)))
  if (len(side) > 0.5) {
    const up = cross(side, out)
    out = norm(add(scale(out, Math.cos(pitch)), scale(up, Math.sin(pitch))))
  }
  return out
}

// Play a planned shot on the ball as it is now. faceError: radians of random face angle
// error (sigma); touch: relative error in how hard the face pushes (sigma; what makes a
// dink float or find the net); offset: meters off the sweet spot.
// Returns { ball, n, u, plan, solved }.
export const playShot = (ball, plan, { faceError = 0, touch = 0, offset = 0, rand = Math.random } = {}) => {
  const opts = { ...plan.mode, spin: plan.spin, minClear: plan.minClear }
  // (a touch shot keeps its pace: if that pace can't land it there, it carries long)
  const solve = (o) => (plan.strict && o.speed !== undefined ? solveDrive(ball.p, plan.target, o) : solveShot(ball.p, plan.target, o))
  let solved = solve(opts)
  let hit = paddleFor(ball, solved.v, { brush: plan.brush, offset })
  // the spin the paddle actually made bends the flight: aim once more with it
  const dx = plan.target.x - ball.p.x
  const dz = plan.target.z - ball.p.z
  const axis = topspinAxis(v3(dx, 0, dz))
  const actualSpin = dot(hit.ball.w, axis)
  if (Math.abs(actualSpin - plan.spin) > 25) {
    solved = solve({ ...opts, spin: actualSpin })
    hit = paddleFor(ball, solved.v, { brush: plan.brush, offset })
  }
  let { n, u } = hit
  // no one swings faster than this
  const speed = len(u)
  if (speed > MAX_PADDLE_SPEED) u = scale(u, MAX_PADDLE_SPEED / speed)
  if (touch > 0) u = add(u, scale(n, dot(u, n) * Math.max(-0.5, Math.min(0.5, gauss(rand) * touch))))
  if (faceError > 0) n = tilt(n, gauss(rand) * faceError, gauss(rand) * faceError)
  const out = paddleHit(ball, n, u, { offset })
  return { ball: out, n, u, plan, solved }
}

// ---- touch: how a shot is chosen ----
// One hit control. Where the ball goes is a target on the other court (the pointer, a
// stick, a finger); how hard is how long the control was held before the swing (pace 0..1).
// The shot is read from those and from where you are: a soft touch from the kitchen line is
// a dink, from farther back a drop (off a hard ball, a reset); a soft ball sent deep has to
// go high (a lob); pace makes rolls, drives, speed-ups, counters and put-aways. Physics does
// the rest: a hard ball struck from below the net has to rise to clear it, so it lands long
// or reaches the other side high, where they can hit down on it. The computer players pick
// their shots the same way (ai.js), so everyone lives with the same consequences.

export const SOFT_MAX = 0.36 // pace below this is a soft shot
export const HARD_MIN = 0.66 // from here up it's hard (between the two: firm)
export const PACE_RAMP = 0.42 // s of holding from the softest shot to the hardest
export const paceOf = (held) => clamp((held - 0.05) / PACE_RAMP, 0, 1)
export const paceBand = (pace) => (pace < SOFT_MAX ? "soft" : pace < HARD_MIN ? "firm" : "hard")
export const FAST_BALL = 10.5 // m/s (23 mph): a ball this fast at you near the net is a hand battle
export const ATTACK_H = NET_H_CENTER + 0.09 // met above this height, a ball can be hit down
export const POPUP_H = 1.25 // and above this it's a sitter
const VOLLEY_FROM = 1.15 // m from the net: a player at the kitchen line reaches this far forward
const VOLLEY_TO = 4.0 // and the ball's height counts until here

// The same pace, lifted just enough to clear the tape (so it lands long): what a hard swing
// at a low ball really does. Returns solveShot's shape plus long: true when it had to lift.
export const solveDrive = (p, target, { speed, spin = 0, minClear = 0.06 } = {}) => {
  const s = solveShot(p, target, { speed, spin, minClear: -9 })
  if (s.clearance === null || s.clearance >= minClear) return s
  const h = Math.hypot(s.v.x, s.v.z)
  const sp = Math.hypot(h, s.v.y)
  const dir = v3(s.v.x / h, 0, s.v.z / h)
  const at = (elev) => {
    const v = v3(dir.x * Math.cos(elev) * sp, Math.sin(elev) * sp, dir.z * Math.cos(elev) * sp)
    return { v, r: flyToGround({ p, v, w: s.w }, { dt: 1 / 120, maxT: 5 }) }
  }
  let lo = Math.atan2(s.v.y, h)
  let hi = Math.min(lo + 0.9, 1.25)
  let best = at(hi)
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2
    const t = at(mid)
    if ((t.r.clearance ?? 9) >= minClear) {
      hi = mid
      best = t
    } else lo = mid
  }
  return { v: best.v, w: s.w, landing: { x: best.r.x, z: best.r.z }, clearance: best.r.clearance, apex: best.r.apex, flight: best.r.t, long: true }
}

// Plan a shot from a target and a pace.
//   team: the hitter's; from: the contact point; incoming: the ball's velocity as it comes
//   (a fast one makes a soft shot a reset); target {x, z} on the other side; pace 0..1;
//   shotNo: this shot's number in the rally (2 = the return); volley: out of the air.
//   sigma: m of aim scatter; apexSigma: m of error in how high a soft shot goes (floating
//   up, the usual miss, or into the net).
export const planIntent = ({ team, from, incoming = null, target, pace = 0.3, shotNo = 4, volley = false, sigma = 0, apexSigma = 0, apexAdd = 0, rand = Math.random }) => {
  const opp = sideOf(other(team))
  const band = paceBand(pace)
  const inSpeed = incoming ? len(incoming) : 0
  const dist = Math.abs(from.z) // how far from the net the ball is met
  let x = clamp(target?.x ?? 0, -HALF_W - 0.6, HALF_W + 0.6)
  let tz = target && Math.sign(target.z) === opp ? Math.abs(target.z) : 0.6
  if (sigma > 0) {
    x += gauss(rand) * sigma
    tz += gauss(rand) * sigma * (band === "soft" ? 0.6 : 1)
  }
  tz = clamp(tz, 0.35, HALF_L + 1.2)
  const D = Math.hypot(x - from.x, opp * tz - from.z)
  const netTop = NET_H_CENTER
  let kind
  let mode
  let spin
  let brush
  let minClear
  if (band === "soft") {
    const f = pace / SOFT_MAX
    if (tz > KITCHEN + 2.6) {
      // soft and deep: it has to go up and over
      kind = "lob"
      mode = { apex: Math.max(from.y + 0.6, 3.5 + f * 1.3 + Math.max(0, 4 - dist) * 0.2) }
      spin = 50
      brush = 1.5
      minClear = 0.6
    } else {
      kind = inSpeed > FAST_BALL ? "reset" : dist < 3.8 ? "dink" : "drop"
      // just over the tape from the kitchen line; a longer arc from farther back
      const apex = dist < 3.8 ? Math.max(from.y + 0.03, netTop + 0.06 + 0.32 * f) : Math.max(from.y + 0.1, netTop + 0.1 + D * 0.075 + 0.3 * f)
      let err = apexSigma > 0 ? gauss(rand) * apexSigma : 0
      if (err < 0) err *= 0.5 // a miss floats up (and long) more often than it finds the net
      err += apexAdd
      mode = { apex: apex + Math.max(0, err) }
      if (err > 0) tz = Math.min(HALF_L, tz + err * (dist < 3.8 ? 1.6 : 2.2))
      spin = kind === "drop" ? 30 : kind === "reset" ? -10 : -15
      brush = kind === "drop" ? 1.2 : kind === "reset" ? 0 : -0.5
      minClear = 0.04 + Math.min(0, err) // a low miss: into the net
    }
  } else if (band === "firm") {
    const f = (pace - SOFT_MAX) / (HARD_MIN - SOFT_MAX)
    // (firm back at a hard ball, at the net, is a counter: there's no time for more)
    kind = shotNo === 2 ? "return" : volley && dist < 4.2 ? (inSpeed > FAST_BALL ? "counter" : "punch") : dist < 3.8 ? "roll" : "drive"
    mode = { speed: 8 + 7 * f }
    spin = kind === "punch" ? 40 : 95
    brush = kind === "punch" ? 1.5 : 3.2
    minClear = 0.06
  } else {
    const f = (pace - HARD_MIN) / (1 - HARD_MIN)
    kind = shotNo === 2 ? "return" : from.y > 1.45 && dist < 5.5 ? "smash" : dist < 4.2 ? (inSpeed > FAST_BALL ? "counter" : "speedup") : "drive"
    mode = { speed: 15 + 9 * f }
    spin = kind === "smash" ? 60 : 130
    brush = kind === "smash" ? 2.5 : 4.5
    minClear = 0.05
  }
  // around the post: no net to clear out there
  if (Math.abs(from.x) > NET_POST_X + 0.05 && dist < 4) minClear = Math.min(minClear, -0.5)
  return { kind, band, pace, target: { x, z: opp * tz }, mode, spin, brush, minClear, strict: mode.speed !== undefined }
}

const netHeightOf = (x) => {
  const t = Math.min(1, Math.abs(x) / HALF_W)
  return NET_H_CENTER + (0.9144 - NET_H_CENTER) * t * t
}

// Where a struck ball is going and what it gives the other side: how it clears the net,
// where it lands, and how high it gets where they can reach it (in the air in front of a
// player at their kitchen line, or off a bounce near the line). Above ATTACK_H they can hit
// down on it.
export const assessBall = (ball, team) => {
  const opp = sideOf(other(team))
  const path = predictPath({ p: ball.p, v: ball.v, w: ball.w || v3() }, { maxT: 4, every: 1 / 120, maxBounces: 2 })
  let clearance = null
  let crossX = 0
  let landing = null
  let bounceApex = 0
  let reachH = 0
  let prev = path[0]
  for (const s of path) {
    if (clearance === null && Math.sign(s.z) === opp && Math.sign(prev.z) !== opp) {
      const f = prev.z / (prev.z - s.z || 1e-9)
      crossX = prev.x + (s.x - prev.x) * f
      clearance = prev.y + (s.y - prev.y) * f - 0.037 - netHeightOf(crossX)
    }
    if (s.bounces === 0 && Math.sign(s.z) === opp && Math.abs(s.z) >= VOLLEY_FROM && Math.abs(s.z) <= VOLLEY_TO) reachH = Math.max(reachH, s.y)
    if (s.bounce && !landing) landing = { x: s.x, z: s.z }
    if (s.bounces === 1 && !s.bounce) bounceApex = Math.max(bounceApex, s.y)
    prev = s
  }
  const atp = clearance !== null && Math.abs(crossX) > NET_POST_X
  const mine = !!landing && Math.sign(landing.z) === opp
  const inside = mine && inCourt(landing.x, landing.z)
  // a bounce counts where someone at the line can take it
  const near = mine && Math.abs(landing.z) < KITCHEN + 2.2
  const attackH = Math.max(reachH, near ? bounceApex : 0)
  return {
    clearance,
    atp,
    landing,
    in: inside,
    kitchen: inside && Math.abs(landing.z) <= KITCHEN,
    attackH,
    attackable: attackH > ATTACK_H,
    popup: attackH > POPUP_H,
    speed: len(ball.v),
  }
}

// What to call a shot, from its kind and what it gives the other side (assessBall).
// tone: great | good | ok | warn | bad. tag: what the rally stats count it as.
export const judgeShot = (kind, a, { contactY = 0.5, oppsBack = false, erne = false } = {}) => {
  if (a.clearance !== null && a.clearance < 0 && !a.atp) return { text: "Into the net", tone: "bad", tag: "net" }
  if (!a.in) return { text: a.landing && Math.abs(a.landing.z) > HALF_L ? "Long!" : "Wide!", tone: "bad", tag: "out" }
  if (a.atp) return { text: "Around the post!", tone: "great", tag: "atp" }
  if (erne) return { text: "ERNE!", tone: "great", tag: "erne" }
  const lifted = a.attackable && !oppsBack
  switch (kind) {
    case "dink":
      if (!a.attackable) return a.kitchen ? { text: "Unattackable dink", tone: "good", tag: "dink" } : { text: "Deep dink", tone: "ok", tag: "dink" }
      return a.popup ? { text: "Popped up!", tone: "bad", tag: "popup" } : { text: "Dink floats up", tone: "warn", tag: "popup" }
    case "drop":
      if (!a.attackable) return Math.abs(a.landing.z) < KITCHEN + 1.2 ? { text: "Great drop", tone: "good", tag: "drop" } : { text: "Drop lands deep", tone: "ok", tag: "drop" }
      return a.popup ? { text: "Drop pops up!", tone: "bad", tag: "popup" } : { text: "Drop sits up", tone: "warn", tag: "popup" }
    case "reset":
    case "block":
      if (!a.attackable) return { text: "Great reset", tone: "good", tag: "reset" }
      return a.popup ? { text: "Popped up!", tone: "bad", tag: "popup" } : { text: "Reset floats", tone: "warn", tag: "popup" }
    case "speedup":
      return contactY > NET_H_CENTER + 0.05 ? { text: "Speed-up!", tone: "great", tag: "speedup" } : { text: "Speed-up from low", tone: "warn", tag: "speedup" }
    case "counter":
      return { text: "Counter!", tone: "great", tag: "counter" }
    case "smash":
      return { text: "Put-away!", tone: "great", tag: "smash" }
    case "lob":
      return { text: "Lob!", tone: "ok", tag: "lob" }
    case "roll":
      return lifted ? { text: "Roll sits up", tone: "warn", tag: "roll" } : { text: "Topspin roll", tone: "ok", tag: "roll" }
    case "punch":
      return { text: "Punch volley", tone: "ok", tag: "punch" }
    case "return":
      return Math.abs(a.landing.z) > HALF_L - 2.4 ? { text: "Deep return", tone: "good", tag: "return" } : { text: "Short return", tone: "warn", tag: "return" }
    case "serve":
      return { text: "Serve", tone: "ok", tag: "serve" }
    default:
      // (a fast drive at the chest is a hand battle, not a sitter)
      return lifted && a.speed < 14 ? { text: "Drive sits up", tone: "warn", tag: "drive" } : { text: "Drive", tone: "ok", tag: "drive" }
  }
}
