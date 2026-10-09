// Pickleball 98: ball, court and paddle physics in SI units (meters, kilograms, seconds).
// Pure JavaScript (no three.js), so Node tests can check it against the real numbers.
//
// Axes: x runs across the court (sideline to sideline), y is up, z runs the length of the
// court. The net is the plane z = 0; your team plays the z > 0 half.

export const FT = 0.3048
export const IN = 0.0254

// ---- the court (USA Pickleball Official Rulebook, section 2) ----
export const COURT_W = 20 * FT // 6.096 m, sideline to sideline (outer edges of the lines)
export const COURT_L = 44 * FT // 13.411 m, baseline to baseline
export const HALF_W = COURT_W / 2
export const HALF_L = COURT_L / 2
export const KITCHEN = 7 * FT // 2.134 m: the non-volley zone, net to the far edge of its line
export const LINE_W = 2 * IN // lines are 2 in wide and count as part of the area they bound
export const NET_SPAN = 22 * FT // 6.706 m between the posts
export const NET_POST_X = NET_SPAN / 2
export const NET_H_SIDE = 36 * IN // 0.914 m at the sidelines
export const NET_H_CENTER = 34 * IN // 0.864 m at the center

// The net sags between the posts. A shallow catenary is all but a parabola: 34 in at the
// center rising to 36 in over the sidelines (and no higher out to the posts).
export const netHeightAt = (x) => {
  const t = Math.min(1, Math.abs(x) / HALF_W)
  return NET_H_CENTER + (NET_H_SIDE - NET_H_CENTER) * t * t
}

// ---- the ball (USA Pickleball / UPA-A equipment standards) ----
// Every approved ball: 2.874-2.972 in across, 0.78-0.935 oz (22.1-26.5 g), 26-40 round holes,
// and a bounce of 30-34 in (to the top of the ball) when dropped from 78 in onto granite.
// Two kinds are played: the outdoor ball (40 small holes, harder and heavier, ~26 g) and the
// indoor ball (26 bigger holes, softer and lighter, ~23 g). Numbers and sources:
// docs/pickleball-physics.md.
export const BALL_D = 0.074 // 2.91 in (both kinds sit near the middle of the range)
export const BALL_R = BALL_D / 2
export const BALL_M = 0.026 // the outdoor ball (0.92 oz)
export const BALL_AREA = Math.PI * BALL_R * BALL_R
// A hollow plastic shell, a few mm thick: between a thin shell (2/3) and a solid ball (2/5)
const SHELL_K = 0.62
export const BALL_I = SHELL_K * BALL_M * BALL_R * BALL_R
export const GRAVITY = 9.81
export const AIR_RHO = 1.2 // kg/m^3 at about 20 C, sea level

// Per ball kind:
//   m: mass; cd0 + cdSlope: the drag coefficient, measured 0.30-0.33 for 40-hole outdoor balls
//   and ~0.45 for 26-hole indoor balls in free flight (Steyn et al. 2025; Lindsey 2025), level
//   or rising slightly with speed; lift: Magnus lift coefficient per unit spin parameter
//   S = r w / v (Steyn et al.: Cl = 0.195 S for an outdoor ball; Lindsey: topspin's lift is
//   stronger than backspin's), split into top (pushing down), back (holding up) and side;
//   liftMax caps it; spinDamp: how fast the air slows the spin (per second, plus per m/s of
//   speed: the holes let air drag on the shell); court: restitution at zero speed and its loss
//   per m/s of impact (the 78 in drop test lands at 6 m/s: e = 0.64 there), and the grip of
//   the court on the plastic (a hard ball on acrylic grips far less than a felt tennis ball).
export const BALLS = {
  outdoor: { kind: "outdoor", label: "Outdoor ball (40 holes)", m: 0.026, cd0: 0.31, cdSlope: 0.002, top: 0.2, back: 0.12, side: 0.16, liftMax: 0.2, spinBase: 0.1, spinPerV: 0.02, e0: 0.7, eSlope: 0.01, mu: 0.45 },
  indoor: { kind: "indoor", label: "Indoor ball (26 holes)", m: 0.0232, cd0: 0.44, cdSlope: 0.002, top: 0.22, back: 0.14, side: 0.18, liftMax: 0.22, spinBase: 0.12, spinPerV: 0.022, e0: 0.705, eSlope: 0.011, mu: 0.4 },
}
export const BALL_KINDS = Object.keys(BALLS)
// (a ball object without a kind is outdoor; a kind's name works too. Not BALLS[ball]: that
// turned the whole ball into the string "[object Object]" on every flight step)
export const ballSpec = (b) => (!b ? BALLS.outdoor : typeof b === "string" ? BALLS[b] : b.kind ? BALLS[b.kind] : BALLS.outdoor) || BALLS.outdoor
export const DRAG_CD = BALLS.outdoor.cd0 // (the outdoor ball's, at low speed)
export const LIFT_PER_SPIN = BALLS.outdoor.top
export const LIFT_MAX = BALLS.outdoor.liftMax
export const SPIN_DECAY_S = 1 / (BALLS.outdoor.spinBase + BALLS.outdoor.spinPerV * 12) // ~3 s at 12 m/s
export const dragCd = (speed, spec = BALLS.outdoor) => Math.min(spec.cd0 + 0.05, spec.cd0 + spec.cdSlope * Math.max(0, speed - 5))

// Court bounce. Restitution falls a little as the impact gets harder (plastic loses more
// energy when it squashes more): e = e0 - eSlope * vn. Calibrated by the 78 in drop test.
export const courtCor = (vn, spec = BALLS.outdoor) => Math.max(0.45, Math.min(spec.e0, spec.e0 - spec.eSlope * Math.abs(vn)))
export const COURT_COR = courtCor(6) // 0.64: the rulebook drop test's impact speed
export const COURT_FRICTION = BALLS.outdoor.mu

// Paddle. USA Pickleball's PBCoR test fires a ball at ~60 mph at the paddle; the limit is 0.43
// (0.44 before Nov 2025). That's the collision's own COR; a hand-held paddle recoils (an
// effective mass of ~0.17 kg at the sweet spot against the 26 g ball), so what the ball
// "sees" is the apparent COR e_A = (e - m/M) / (1 + m/M) = 0.24 at 60 mph, a little higher
// on slow (dink) contacts. The outgoing speed along the face normal is then
// e_A * (incoming) + (1 + e_A) * (face speed): a ball comes off at most ~1.25x the face speed.
// Grip: textured faces make spin by friction during the 3-5 ms dwell; USA Pickleball caps
// spin at 2,100 rpm on its new paddle test (UPA-A has since 2024), pro serves off a tee
// reach ~2,270 rpm.
export const PBCOR_LIMIT = 0.43
export const PADDLE_EFFECTIVE_M = 0.17
export const PADDLE_COR = (PBCOR_LIMIT - BALL_M / PADDLE_EFFECTIVE_M) / (1 + BALL_M / PADDLE_EFFECTIVE_M) // 0.24 at 60 mph
export const paddleCorAt = (vrel) => Math.max(0.2, Math.min(0.32, PADDLE_COR + 0.003 * (26.8 - Math.abs(vrel))))
export const PADDLE_FRICTION = 0.32
export const MAX_SPIN = (2300 * 2 * Math.PI) / 60 // rad/s: about the most a paddle puts on (pro serve off a tee)
export const MAX_PADDLE_SPEED = 21 // m/s face speed: a full pro drive swing (~47 mph at the sweet spot)
export const SWEET_SPOT_R = 0.09 // m from the paddle's center before the hit goes dead
export const rpm = (w) => (len(w) * 60) / (2 * Math.PI)

export const STEP = 1 / 240 // the fixed physics step
const SOLVE_DT = 1 / 90 // coarser steps while aiming (checked against STEP in the tests)

// ---- small vector helpers (plain {x, y, z} objects) ----
export const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z })
export const add = (a, b) => v3(a.x + b.x, a.y + b.y, a.z + b.z)
export const sub = (a, b) => v3(a.x - b.x, a.y - b.y, a.z - b.z)
export const scale = (a, s) => v3(a.x * s, a.y * s, a.z * s)
export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z
export const cross = (a, b) => v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x)
export const len = (a) => Math.hypot(a.x, a.y, a.z)
export const norm = (a) => {
  const l = len(a)
  return l > 1e-12 ? scale(a, 1 / l) : v3()
}
const UP = v3(0, 1, 0)

export const terminalVelocity = (cd = DRAG_CD, m = BALL_M) => Math.sqrt((2 * m * GRAVITY) / (AIR_RHO * BALL_AREA * cd))

// A ball: position, velocity, spin (rad/s, a vector along the spin axis) and its kind
// ("outdoor" | "indoor"; missing = outdoor)
export const createBall = (p = v3(0, 1, 0), v = v3(), w = v3(), kind) => {
  const b = { p: { ...p }, v: { ...v }, w: { ...(w || v3()) } }
  if (kind && kind !== "outdoor") b.kind = kind
  return b
}

// Acceleration from gravity, drag and Magnus lift (spin w in rad/s). The lift's strength
// depends on which way it pushes: topspin's (down) is stronger than backspin's (up) on a
// holed ball (Lindsey 2025), sidespin's in between.
export const accel = (v, w, spec = BALLS.outdoor) => {
  const speed = len(v)
  let ax = 0
  let ay = -GRAVITY
  let az = 0
  if (speed > 1e-6) {
    const k = (0.5 * AIR_RHO * BALL_AREA) / spec.m
    const drag = k * dragCd(speed, spec) * speed // a = -k Cd |v| v
    ax -= drag * v.x
    ay -= drag * v.y
    az -= drag * v.z
    const spin = len(w)
    if (spin > 1e-6) {
      const s = (BALL_R * spin) / speed
      // lift along (w x v), with magnitude k Cl v^2
      const c = cross(w, v)
      const cl2 = len(c)
      if (cl2 > 1e-9) {
        const up = c.y / cl2 // +1: straight up (backspin), -1: straight down (topspin)
        const slope = spec.top * Math.max(0, -up) + spec.back * Math.max(0, up) + spec.side * (1 - Math.abs(up))
        const cl = Math.min(spec.liftMax, slope * s)
        const f = (k * cl * speed * speed) / cl2
        ax += c.x * f
        ay += c.y * f
        az += c.z * f
      }
    }
  }
  return v3(ax, ay, az)
}

// One flight step (midpoint method). Doesn't handle the ground or the net. The spin slows
// with the air's friction on the shell and holes, faster at speed.
// (accel's sums, written out without making objects: the shot solver flies thousands of these
// steps a hit, the park's ambient courts most of all; lengths by Math.sqrt, not Math.hypot)
const A1 = v3()
const A2 = v3()
const accelTo = (out, vx, vy, vz, w, spec) => {
  const speed = Math.sqrt(vx * vx + vy * vy + vz * vz)
  let ax = 0
  let ay = -GRAVITY
  let az = 0
  if (speed > 1e-6) {
    const k = (0.5 * AIR_RHO * BALL_AREA) / spec.m
    const drag = k * dragCd(speed, spec) * speed
    ax -= drag * vx
    ay -= drag * vy
    az -= drag * vz
    const spin = Math.sqrt(w.x * w.x + w.y * w.y + w.z * w.z)
    if (spin > 1e-6) {
      const s = (BALL_R * spin) / speed
      const cx = w.y * vz - w.z * vy
      const cy = w.z * vx - w.x * vz
      const cz = w.x * vy - w.y * vx
      const cl2 = Math.sqrt(cx * cx + cy * cy + cz * cz)
      if (cl2 > 1e-9) {
        const up = cy / cl2
        const slope = spec.top * Math.max(0, -up) + spec.back * Math.max(0, up) + spec.side * (1 - Math.abs(up))
        const cl = Math.min(spec.liftMax, slope * s)
        const f = (k * cl * speed * speed) / cl2
        ax += cx * f
        ay += cy * f
        az += cz * f
      }
    }
  }
  out.x = ax
  out.y = ay
  out.z = az
}
export const flightStep = (ball, dt = STEP) => {
  const spec = ballSpec(ball)
  const v = ball.v
  accelTo(A1, v.x, v.y, v.z, ball.w, spec)
  const mx = v.x + A1.x * dt * 0.5
  const my = v.y + A1.y * dt * 0.5
  const mz = v.z + A1.z * dt * 0.5
  accelTo(A2, mx, my, mz, ball.w, spec)
  ball.p.x += mx * dt
  ball.p.y += my * dt
  ball.p.z += mz * dt
  v.x += A2.x * dt
  v.y += A2.y * dt
  v.z += A2.z * dt
  const decay = Math.exp(-dt * (spec.spinBase + spec.spinPerV * Math.sqrt(mx * mx + my * my + mz * mz)))
  ball.w.x *= decay
  ball.w.y *= decay
  ball.w.z *= decay
}

// A collision with a surface (the court, a paddle face, the net cord): normal n (unit,
// pointing toward the ball), surface velocity u at the contact, restitution e (a number, or
// a function of the normal impact speed), friction mu. The normal impulse bounces the ball;
// friction at the contact point (the ball's surface velocity including spin) either brings
// it to rolling or, if friction can't, it slides. That turns topspin into a forward kick,
// lets slice skid through low (a hard plastic ball barely grips), and turns a tilted spin
// axis (sidespin) into a sideways bounce. Mass-independent (impulses per unit mass).
export const impact = (ball, n, u, e, mu) => {
  const rel = sub(ball.v, u)
  const vn = dot(rel, n)
  if (vn >= 0) return false // already separating
  const ee = typeof e === "function" ? e(-vn) : e
  const dvn = -(1 + ee) * vn // the normal change of velocity
  const rc = scale(n, -BALL_R) // from the ball's center to the contact point
  const relT = sub(rel, scale(n, vn))
  const slip = add(relT, cross(ball.w, rc)) // contact point velocity along the surface
  const slipSpeed = len(slip)
  let dvt = 0
  if (slipSpeed > 1e-9) {
    const toRoll = (slipSpeed * SHELL_K) / (1 + SHELL_K) // the change that would end the slip
    dvt = Math.min(toRoll, mu * dvn)
  }
  const dir = slipSpeed > 1e-9 ? scale(slip, -1 / slipSpeed) : v3()
  ball.v = add(ball.v, add(scale(n, dvn), scale(dir, dvt)))
  // the friction impulse's torque: dw = (rc x J) / I, per unit mass (rc x dir dvt) / (k r^2)
  ball.w = add(ball.w, scale(cross(rc, scale(dir, dvt)), 1 / (SHELL_K * BALL_R * BALL_R)))
  return true
}

export const bounceOnCourt = (ball) => {
  const spec = ballSpec(ball)
  ball.p.y = BALL_R
  impact(ball, UP, v3(), (vn) => courtCor(vn, spec), spec.mu)
}

// ---- the net ----
// The top of the net is a cable inside a 2 in tape (a cord of radius CORD_R at the tape's
// top); below it hangs the mesh. A ball touching the cord bounces off it like any surface (a
// soft, sagging cord: little restitution, some grip), so where it touches decides what
// happens: barely clipped on top it trickles over (a "net cord"), struck square it pops up
// and falls back. A ball into the mesh loses almost all its speed and drops on the hitter's
// side. (No let on a serve that clips the net: since 2021 it plays on, rules.js.)
export const CORD_R = 0.012
export const NET_COR = 0.25
export const NET_FRICTION = 0.3
const meshHit = (ball, from) => {
  ball.p.z = from * (BALL_R + 0.012)
  ball.v = v3(ball.v.x * 0.25, Math.min(ball.v.y * 0.3, 0.4), -ball.v.z * 0.08)
  ball.w = scale(ball.w, 0.2)
  return "net"
}

// The net: call after each flight step with the ball's z before it. Returns null, "net"
// (into the mesh: it drops back) or "tape" (touched the cord: over or back, as it goes).
export const netContact = (prevZ, ball) => {
  const { p } = ball
  if (Math.abs(p.x) > NET_POST_X) return null
  const reach = BALL_R + CORD_R
  const crossed = (prevZ > 0) !== (p.z > 0)
  if (!crossed && Math.abs(p.z) > reach) return null
  const top = netHeightAt(p.x) - CORD_R // the cord's center
  const from = prevZ > 0 ? 1 : prevZ < 0 ? -1 : -Math.sign(ball.v.z) || 1
  // where it was when it reached the net plane (the step may have carried it through)
  let y = p.y
  let z = p.z
  if (crossed && Math.abs(ball.v.z) > 1e-6) {
    y = p.y - ball.v.y * (p.z / ball.v.z)
    z = 0
  }
  if (y > top + reach) return null // clear over
  const dy = y - top
  if (dy < -reach * 0.35) return meshHit(ball, from)
  // on the cord: the contact normal runs from the cord's center (it lies along x) to the
  // ball's center, in the y-z plane
  const dz = crossed ? from * Math.sqrt(Math.max(0, reach * reach - dy * dy)) : z
  const d = Math.hypot(dy, dz) || 1
  const n = v3(0, dy / d, dz / d)
  ball.p.y = top + n.y * (reach + 0.001)
  ball.p.z = n.z * (reach + 0.001)
  if (!impact(ball, n, v3(), NET_COR, NET_FRICTION)) return null
  return "tape"
}

// Fly a ball for dt with the net checked (substeps near the net plane, so a fast ball can't
// skip through the cord). Returns "net", "tape" or null.
export const flyWithNet = (ball, dt = STEP) => {
  const near = Math.abs(ball.p.z) < 0.2 + Math.abs(ball.v.z) * dt
  const n = near ? 4 : 1
  let hit = null
  for (let i = 0; i < n; i++) {
    const prevZ = ball.p.z
    flightStep(ball, dt / n)
    const r = netContact(prevZ, ball)
    if (r === "net" || (r && !hit)) hit = r
  }
  return hit
}

// Fly a ball until it touches the court (or maxT). Returns where and when it lands, how
// high it got, and how it crossed the net plane (clearance above the tape, or null if it
// never crossed). Ignores the net itself: the solver uses the clearance to avoid it.
export const flyToGround = (start, { maxT = 6, dt = STEP } = {}) => {
  const ball = createBall(start.p, start.v, start.w, start.kind)
  let t = 0
  let apex = ball.p.y
  let clearance = null
  let crossX = 0
  while (t < maxT) {
    const prevZ = ball.p.z
    flightStep(ball, dt)
    t += dt
    if (ball.p.y > apex) apex = ball.p.y
    if (clearance === null && (prevZ > 0) !== (ball.p.z > 0)) {
      const f = prevZ / (prevZ - ball.p.z)
      const x = ball.p.x // close enough at 240 Hz
      crossX = x
      const y = ball.p.y - ball.v.y * dt * (1 - f)
      clearance = y - BALL_R - netHeightAt(x)
    }
    if (ball.p.y <= BALL_R && ball.v.y < 0) {
      return { x: ball.p.x, z: ball.p.z, t, apex, clearance, crossX, v: ball.v, w: ball.w, landed: true }
    }
  }
  return { x: ball.p.x, z: ball.p.z, t, apex, clearance, crossX, v: ball.v, w: ball.w, landed: false }
}

// The whole path (with bounces on the court, no net) sampled every `every` seconds, for
// the AI and the trajectory aid: [{ t, x, y, z, bounces }]
export const predictPath = (start, { maxT = 3, every = 1 / 60, dt = STEP, maxBounces = 2 } = {}) => {
  const ball = createBall(start.p, start.v, start.w, start.kind)
  const out = [{ t: 0, x: ball.p.x, y: ball.p.y, z: ball.p.z, bounces: 0 }]
  let t = 0
  let next = every
  let bounces = 0
  while (t < maxT) {
    flightStep(ball, dt)
    t += dt
    if (ball.p.y <= BALL_R && ball.v.y < 0) {
      bounceOnCourt(ball)
      bounces++
      out.push({ t, x: ball.p.x, y: ball.p.y, z: ball.p.z, bounces, bounce: true })
      if (bounces >= maxBounces) break
    }
    if (t >= next) {
      out.push({ t, x: ball.p.x, y: ball.p.y, z: ball.p.z, bounces })
      next += every
    }
  }
  return out
}

// ---- the paddle ----

// The apparent restitution for a contact: lower on hard hits (the PBCoR figure is at 60 mph),
// and dead off the sweet spot (less of the paddle's mass behind the ball, more twist)
export const sweetSpotCor = (offset, vrel = 26.8) => {
  const f = Math.min(1, Math.abs(offset) / SWEET_SPOT_R)
  return paddleCorAt(vrel) * (1 - 0.45 * f * f)
}

// Hit the ball with a paddle face (unit normal n, toward where the ball should go) moving
// at velocity u. The face's speed and angle (open = tilted up, closed = tilted down) are
// what send the ball; brushing along the face makes spin (no more than a real paddle can).
export const paddleHit = (ball, n, u, { offset = 0 } = {}) => {
  const out = createBall(ball.p, ball.v, ball.w, ball.kind)
  impact(out, n, u, (vn) => sweetSpotCor(offset, vn), PADDLE_FRICTION)
  const spin = len(out.w)
  if (spin > MAX_SPIN) out.w = scale(out.w, MAX_SPIN / spin)
  return out
}

// The paddle swing that sends an incoming ball off at velocity `want`: a face normal and
// face velocity (a normal push plus `brush`, a swipe along the face that makes topspin when
// it's upward, slice when downward, and `side`, a sideways swipe across the face that tilts
// the spin axis: sidespin). Friction changes the result a little, so it's corrected a few
// times. Returns { n, u, ball } where ball is the actual result.
export const paddleFor = (incoming, want, { brush = 0, side: sideBrush = 0, offset = 0 } = {}) => {
  let aim = { ...want }
  let best = null
  for (let i = 0; i < 6; i++) {
    const n = norm(sub(aim, incoming.v))
    // restitution along n in the paddle's frame: (V - u).n = -e (v - u).n, with e for the
    // contact speed this swing makes (|V.n - v.n| / (1 + e), close enough from the aim)
    const e = sweetSpotCor(offset, Math.abs(dot(sub(aim, incoming.v), n)) / 1.25)
    const un = (dot(aim, n) + e * dot(incoming.v, n)) / (1 + e)
    // brush: along the face, in the vertical plane of the shot (upward = topspin)
    const across = norm(cross(n, UP))
    const along = norm(cross(across, n)) // "up" along the face
    const u = add(add(scale(n, un), scale(along, brush)), scale(across, sideBrush))
    const out = paddleHit(incoming, n, u, { offset })
    const err = sub(want, out.v)
    best = { n, u, ball: out }
    if (len(err) < 0.02) break
    aim = add(aim, err)
  }
  return best
}

// ---- aiming: the launch velocity that lands a ball at a target ----

const rangeOf = (p, dir, speed, elev, w, kind) => {
  const v = v3(dir.x * Math.cos(elev) * speed, Math.sin(elev) * speed, dir.z * Math.cos(elev) * speed)
  const r = flyToGround({ p, v, w, kind }, { dt: SOLVE_DT, maxT: 5 })
  const dx = r.x - p.x
  const dz = r.z - p.z
  return { range: dx * dir.x + dz * dir.z, r, v }
}

// Topspin axis for a ball traveling along horizontal direction dir (top of the ball turns
// toward dir): w = up x dir
export const topspinAxis = (dir) => norm(cross(UP, v3(dir.x, 0, dir.z)))

// Root of a monotonic f on [lo, hi] (f(lo) and f(hi) of opposite signs): regula falsi
// with the Illinois fix, a handful of evaluations instead of dozens.
const findRoot = (f, lo, hi, flo, fhi, tol = 1e-3, maxIter = 30) => {
  let side = 0
  let x = lo
  for (let i = 0; i < maxIter; i++) {
    x = (lo * fhi - hi * flo) / (fhi - flo)
    const fx = f(x)
    if (Math.abs(fx) < tol || hi - lo < 1e-7) return x
    if (fx > 0 === fhi > 0) {
      hi = x
      fhi = fx
      if (side === 1) flo /= 2
      side = 1
    } else {
      lo = x
      flo = fx
      if (side === -1) fhi /= 2
      side = -1
    }
  }
  return x
}

// Solve for the launch velocity from p that lands at target {x, z}.
//   { speed }: the low, flat solution at that speed (drives, serves);
//   { apex }: the arc that peaks at that height (lobs);
//   { clear }: the arc that crosses the net that high over the tape (dinks, drops, resets).
// spin: rad/s of topspin (negative = backspin). minClear: meters of air over the tape.
// kind: the ball ("outdoor" | "indoor").
// Returns { v, w, landing, clearance, apex, flight } (landing may miss if it can't be done).
export const solveShot = (p, target, { speed, apex, clear, spin = 0, minClear = 0.06, kind } = {}) => {
  const dx = target.x - p.x
  const dz = target.z - p.z
  const D = Math.max(0.05, Math.hypot(dx, dz))
  const dir = v3(dx / D, 0, dz / D)
  const w = scale(topspinAxis(dir), spin)
  const crosses = p.z > 0 !== target.z > 0
  const DEG = Math.PI / 180

  // the speed (at this elevation) that carries exactly D, or null
  const speedFor = (elev) => {
    const f = (s) => rangeOf(p, dir, s, elev, w, kind).range - D
    const fhi = f(45)
    if (fhi < 0) return null
    return findRoot(f, 0.3, 45, f(0.3), fhi, 0.005)
  }

  let result = null
  if (clear !== undefined && crosses) {
    // the arc that crosses the net `clear` m over the tape and lands on the target: how a
    // player thinks about a dink, a drop or a reset (higher elevation, matched speed -> higher
    // over the net)
    const clearAt = (elev) => {
      const s = speedFor(elev)
      if (s === null) return elev > 0.7 ? 10 : -10
      const c = rangeOf(p, dir, s, elev, w, kind).r.clearance
      return (c ?? -10) - clear
    }
    const lo = -15 * DEG
    const hi = 75 * DEG
    const flo = clearAt(lo)
    const fhi = clearAt(hi)
    let e2 = flo >= 0 ? lo : fhi <= 0 ? hi : findRoot(clearAt, lo, hi, flo, fhi, 0.003)
    let s = speedFor(e2)
    for (let k = 0; s === null && k < 20; k++) {
      e2 += e2 > 0.7 ? -0.03 : 0.03
      s = speedFor(e2)
    }
    result = rangeOf(p, dir, s ?? 8, e2, w, kind)
  } else if (apex !== undefined || clear !== undefined) {
    if (apex === undefined) apex = Math.max(p.y + 0.1, NET_H_CENTER + clear)
    let want = apex
    for (let tries = 0; tries < 8; tries++) {
      // higher elevation -> higher apex for the same range
      // (out of reach: too flat to stay up, or too steep for the drag to let it carry)
      const apexAt = (elev) => {
        const s = speedFor(elev)
        if (s === null) return elev > 0.7 ? 10 : -10
        return rangeOf(p, dir, s, elev, w, kind).r.apex - want
      }
      const lo = -20 * DEG
      const hi = 80 * DEG
      const flo = apexAt(lo)
      const fhi = apexAt(hi)
      const elev = flo >= 0 ? lo : fhi <= 0 ? hi : findRoot(apexAt, lo, hi, flo, fhi, 0.004)
      // a root sitting right at the reachable edge: step back to where it's reachable
      let e2 = elev
      let s = speedFor(e2)
      for (let k = 0; s === null && k < 20; k++) {
        e2 += e2 > 0.7 ? -0.03 : 0.03
        s = speedFor(e2)
      }
      s ??= 12
      result = rangeOf(p, dir, s, e2, w, kind)
      if (!crosses || result.r.clearance === null || result.r.clearance >= minClear) break
      want +=Math.max(0.08, minClear - result.r.clearance + 0.04) // clips the net: arc it higher
    }
  } else {
    let s = speed
    for (let tries = 0; tries < 30; tries++) {
      // the low branch: range grows with elevation up to ~30 degrees
      const f = (elev) => rangeOf(p, dir, s, elev, w, kind).range - D
      const lo = -35 * DEG
      const hi = 30 * DEG
      const fhi = f(hi)
      if (fhi < 0) {
        s *= 1.08 // not enough speed to get there
        continue
      }
      const flo = f(lo)
      const elev = flo >= 0 ? lo : findRoot(f, lo, hi, flo, fhi, 0.005)
      result = rangeOf(p, dir, s, elev, w, kind)
      if (!crosses || result.r.clearance === null || result.r.clearance >= minClear) break
      s *= 0.93 // into the net: take a little pace off (a higher, slower arc)
    }
  }
  return { v: result.v, w, landing: { x: result.r.x, z: result.r.z }, clearance: result.r.clearance, apex: result.r.apex, flight: result.r.t }
}
