// Tetherball physics, with no DOM (tested in tetherball.test.js). Meters, seconds, y up; the
// pole stands on the origin.
//
// The ball is a point mass on a rope tied to the top of the pole. As the ball goes round, the
// rope wraps on the pole: the wrap is the ball's unwrapped azimuth (theta, radians) since the
// rope last hung straight, so going round the other way unwraps it. Every turn uses up the
// pole's circumference of rope, and the wraps stack down the pole as a helix (PITCH per turn),
// so the free rope gets shorter and its tie point lower: the ball flies faster (angular
// momentum) and lower as it winds. The rope is inextensible but can go slack (a ball hit
// toward the pole flies free until the rope pulls tight again). The ball bounces off the pole
// and the ground.
//
//   const b = newBall(); stepBall(b, dt) (call with dt <= 1/120; physicsStep does sub-steps)
//   wraps(b) -> turns (+ = counter-clockwise seen from above, player 1's way)

export const POLE_H = 3.0
export const POLE_R = 0.05
export const ROPE_L = 2.3
export const BALL_R = 0.11
export const PITCH = 0.085 // how far the rope's tie point moves down the pole per turn
export const MIN_FREE = 0.32 // the rope is "all the way round" when this much is left
export const G = 9.81
export const DRAG = 0.06 // per second
export const STEP = 1 / 240

const TURN_LEN = Math.hypot(2 * Math.PI * POLE_R, PITCH) // rope used per turn
export const MAX_WRAPS = (ROPE_L - MIN_FREE) / TURN_LEN

const wrapAngle = (a) => {
  while (a > Math.PI) a -= 2 * Math.PI
  while (a < -Math.PI) a += 2 * Math.PI
  return a
}

// the rope hanging straight down beside the pole, on the side at azimuth `az`
export const newBall = (az = Math.PI / 2, { out = 0 } = {}) => {
  const r = Math.max(POLE_R + BALL_R + 0.01, out)
  const y = POLE_H - Math.sqrt(Math.max(0, ROPE_L * ROPE_L - r * r))
  return { x: Math.cos(az) * r, y, z: Math.sin(az) * r, vx: 0, vy: 0, vz: 0, theta: 0, lastAz: az, taut: true, hitPole: 0, hitGround: 0 }
}

export const azimuth = (b) => Math.atan2(b.z, b.x)
export const wraps = (b) => b.theta / (2 * Math.PI)
export const freeLength = (b) => Math.max(MIN_FREE * 0.6, ROPE_L - Math.abs(b.theta / (2 * Math.PI)) * TURN_LEN)
export const tieHeight = (b) => POLE_H - (Math.abs(b.theta) / (2 * Math.PI)) * PITCH
export const horizontal = (b) => Math.hypot(b.x, b.z)
export const speed = (b) => Math.hypot(b.vx, b.vy, b.vz)
// fully wound: +1 (counter-clockwise, player 1 wins), -1 (clockwise, player 2), else 0
export const woundBy = (b) => (wraps(b) >= MAX_WRAPS ? 1 : wraps(b) <= -MAX_WRAPS ? -1 : 0)
// the unit direction of travel round the pole at the ball (+1 counter-clockwise)
export const tangent = (b, dir = 1) => {
  const az = azimuth(b)
  return { x: -Math.sin(az) * dir, z: Math.cos(az) * dir }
}
// how fast the ball is going round (rad/s, + counter-clockwise)
export const angularSpeed = (b) => {
  const r2 = b.x * b.x + b.z * b.z
  return r2 > 1e-9 ? (b.x * b.vz - b.z * b.vx) / r2 : 0
}

// keep the ball outside the pole (bouncing off it when `bounce`)
const pole = (b, bounce) => {
  const rr = horizontal(b)
  const min = POLE_R + BALL_R
  if (rr >= min || b.y >= POLE_H + BALL_R) return
  const nx = rr > 1e-9 ? b.x / rr : 1
  const nz = rr > 1e-9 ? b.z / rr : 0
  b.x = nx * min
  b.z = nz * min
  const vin = b.vx * nx + b.vz * nz
  if (vin >= 0) return
  const k = bounce ? 1.4 : 1
  b.vx -= k * vin * nx
  b.vz -= k * vin * nz
  if (bounce && vin < -1) b.hitPole++
}

export const stepBall = (b, dt) => {
  // gravity and air
  b.vy -= G * dt
  const k = Math.max(0, 1 - DRAG * dt)
  b.vx *= k
  b.vy *= k
  b.vz *= k
  b.x += b.vx * dt
  b.y += b.vy * dt
  b.z += b.vz * dt

  // round the pole: keep count of the wrap (the azimuth, unwrapped)
  const az = azimuth(b)
  b.theta += wrapAngle(az - b.lastAz)
  b.lastAz = az

  // the pole, then the rope (no further than its free length from where it leaves the pole)
  pole(b, true)
  const L = freeLength(b)
  const ty = tieHeight(b)
  const r = horizontal(b) || 1e-9
  // the rope leaves the pole on its surface, toward the ball
  const ax = (b.x / r) * POLE_R
  const az2 = (b.z / r) * POLE_R
  let dx = b.x - ax
  let dy = b.y - ty
  let dz = b.z - az2
  const d = Math.hypot(dx, dy, dz)
  b.taut = d >= L - 1e-4
  if (d > L) {
    dx /= d
    dy /= d
    dz /= d
    b.x = ax + dx * L
    b.y = ty + dy * L
    b.z = az2 + dz * L
    const out = b.vx * dx + b.vy * dy + b.vz * dz
    if (out > 0) {
      b.vx -= out * dx
      b.vy -= out * dy
      b.vz -= out * dz
    }
  }

  // the rope pulled it into the pole: slide it round the pole's surface, rope still tight
  if (horizontal(b) < POLE_R + BALL_R - 1e-9 && b.y < POLE_H + BALL_R) {
    pole(b, false)
    const up = Math.sqrt(Math.max(0, L * L - BALL_R * BALL_R))
    if (Math.abs(b.y - ty) > up) b.y = ty + Math.sign(b.y - ty) * up
  }

  // the ground
  if (b.y < BALL_R) {
    b.y = BALL_R
    if (b.vy < 0) {
      if (b.vy < -1) b.hitGround++
      b.vy = -b.vy * 0.35
      b.vx *= 0.8
      b.vz *= 0.8
    }
  }
  return b
}

// advance by dt seconds in fixed steps; returns the leftover time to carry to the next frame
export const physicsStep = (b, dt, carry = 0) => {
  let t = carry + dt
  while (t >= STEP) {
    stepBall(b, STEP)
    t -= STEP
  }
  return t
}

// a hit: the ball leaves in direction `dir` round the pole (+1 counter-clockwise) at `power`
// (0..1) with `loft` (radians up from horizontal; negative drives it down)
export const HIT_MIN = 4.2
export const HIT_MAX = 9.5
export const hitBall = (b, dir, power, loft = 0.15) => {
  const s = HIT_MIN + Math.max(0, Math.min(1, power)) * (HIT_MAX - HIT_MIN)
  const t = tangent(b, dir)
  const c = Math.cos(loft)
  const r = horizontal(b) || 1
  // a little outward push too, so the rope pulls tight at once
  b.vx = t.x * s * c + (b.x / r) * 0.6
  b.vz = t.z * s * c + (b.z / r) * 0.6
  b.vy = s * Math.sin(loft)
  return b
}

export const copyBall = (b) => ({ ...b })
