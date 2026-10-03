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
  add,
  cross,
  dot,
  len,
  norm,
  paddleFor,
  paddleHit,
  scale,
  solveShot,
  topspinAxis,
  v3,
} from "./physics.js"
import { rightSign, sideOf, other } from "./rules.js"

export const KINDS = ["dink", "drop", "drive", "lob", "block", "punch", "smash", "serve", "return"]
export const KIND_LABEL = {
  dink: "Dink",
  drop: "Drop shot",
  drive: "Drive",
  lob: "Lob",
  block: "Block",
  punch: "Punch volley",
  smash: "Put-away",
  serve: "Serve",
  return: "Return",
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

// Gaussian noise from a 0-1 random source
export const gauss = (rand) => {
  let u = 0
  while (u === 0) u = rand()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
}

// plan a shot: kind, the hitting team, the ball's position, aim (-1..1: toward the hitter's
// left..right), power (0..1), an explicit target x/z (optional), the serve's court, and
// how precise the hitter is (sigma in meters for the target)
export const planShot = (kind, { team, from, aim = 0, power = 0.5, targetX, targetZ, court, sigma = 0, rand = Math.random }) => {
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
      z = opp * (HALF_L - 0.75 - (1 - power) * 0.9)
      mode = { speed: 13 + power * 5 }
      spin = 50 + power * 40
      brush = 2.5
      minClear = 0.25
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
  return { kind, target: { x, z }, mode, spin, brush, minClear }
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
  let solved = solveShot(ball.p, plan.target, opts)
  let hit = paddleFor(ball, solved.v, { brush: plan.brush, offset })
  // the spin the paddle actually made bends the flight: aim once more with it
  const dx = plan.target.x - ball.p.x
  const dz = plan.target.z - ball.p.z
  const axis = topspinAxis(v3(dx, 0, dz))
  const actualSpin = dot(hit.ball.w, axis)
  if (Math.abs(actualSpin - plan.spin) > 25) {
    solved = solveShot(ball.p, plan.target, { ...opts, spin: actualSpin })
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
