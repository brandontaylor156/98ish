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

// ---- the ball (USA Pickleball equipment standards, outdoor ball) ----
export const BALL_D = 0.074 // 2.87-2.97 in allowed: 74 mm is 2.91 in
export const BALL_R = BALL_D / 2
export const BALL_M = 0.026 // 0.78-0.935 oz (22.1-26.5 g) allowed: 26 g is a typical outdoor ball
export const BALL_AREA = Math.PI * BALL_R * BALL_R
// A hollow plastic shell, a few mm thick: between a thin shell (2/3) and a solid ball (2/5)
export const BALL_I = 0.62 * BALL_M * BALL_R * BALL_R
export const GRAVITY = 9.81
export const AIR_RHO = 1.2 // kg/m^3 at about 20 C, sea level
// The 26-40 holes make a pickleball draggy: wind-tunnel numbers for outdoor balls run
// about 0.4-0.55. 0.48 gives a terminal speed near 14.3 m/s.
export const DRAG_CD = 0.48
// Magnus lift coefficient vs. the spin parameter S = r*omega/v. The holes bleed off the
// boundary-layer effect, so lift is a fair bit weaker than a tennis ball's (~0.6 S).
export const LIFT_PER_SPIN = 0.4
export const LIFT_MAX = 0.18
export const SPIN_DECAY_S = 1.6 // air friction on a holed ball: spin halves in about a second

// Court bounce. The rulebook's bounce test: dropped from 78 in onto granite, a ball must
// rebound 30-34 in. That's a height ratio of 0.38-0.44; with drag on the way down and up,
// the matching velocity coefficient of restitution is about 0.66 (sqrt(32/78) = 0.64 in a
// vacuum). Calibrated by the "78 in drop" test.
export const COURT_COR = 0.65
export const COURT_FRICTION = 0.6 // textured acrylic hard court vs. plastic ball (grippy)

// Paddle: apparent coefficient of restitution of the ball on a swung paddle (the paddle is
// treated as moving at its measured face speed; its finite mass is folded into this
// number), and how much grip the face has (textured faces grip more; capped by the rules).
export const PADDLE_COR = 0.42
export const PADDLE_FRICTION = 0.28
export const MAX_PADDLE_SPEED = 17 // m/s face speed: a hard drive swing
export const SWEET_SPOT_R = 0.09 // m from the paddle's center before the hit goes dead

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

export const terminalVelocity = (cd = DRAG_CD) => Math.sqrt((2 * BALL_M * GRAVITY) / (AIR_RHO * BALL_AREA * cd))

export const createBall = (p = v3(0, 1, 0), v = v3(), w = v3()) => ({ p: { ...p }, v: { ...v }, w: { ...w } })

// Acceleration from gravity, drag and Magnus lift (spin w in rad/s)
const K_AIR = (0.5 * AIR_RHO * BALL_AREA) / BALL_M
export const accel = (v, w) => {
  const speed = len(v)
  let ax = 0
  let ay = -GRAVITY
  let az = 0
  if (speed > 1e-6) {
    const drag = K_AIR * DRAG_CD * speed // a = -k Cd |v| v
    ax -= drag * v.x
    ay -= drag * v.y
    az -= drag * v.z
    const spin = len(w)
    if (spin > 1e-6) {
      const s = (BALL_R * spin) / speed
      const cl = Math.min(LIFT_MAX, LIFT_PER_SPIN * s)
      // lift along (w x v), with magnitude k Cl v^2
      const c = cross(w, v)
      const cl2 = len(c)
      if (cl2 > 1e-9) {
        const f = (K_AIR * cl * speed * speed) / cl2
        ax += c.x * f
        ay += c.y * f
        az += c.z * f
      }
    }
  }
  return v3(ax, ay, az)
}

// One flight step (midpoint method). Doesn't handle the ground or the net.
export const flightStep = (ball, dt = STEP) => {
  const a1 = accel(ball.v, ball.w)
  const vm = v3(ball.v.x + a1.x * dt * 0.5, ball.v.y + a1.y * dt * 0.5, ball.v.z + a1.z * dt * 0.5)
  const a2 = accel(vm, ball.w)
  ball.p.x += vm.x * dt
  ball.p.y += vm.y * dt
  ball.p.z += vm.z * dt
  ball.v.x += a2.x * dt
  ball.v.y += a2.y * dt
  ball.v.z += a2.z * dt
  const decay = Math.exp(-dt / SPIN_DECAY_S)
  ball.w.x *= decay
  ball.w.y *= decay
  ball.w.z *= decay
}

// A collision with a surface (the court or a paddle face): normal n (unit, pointing toward
// the ball), surface velocity u at the contact, restitution e, friction mu. The normal
// impulse bounces the ball; friction at the contact point (ball surface velocity including
// spin) either brings it to rolling or, if friction can't, slides. This is what turns
// topspin into a skidding, lower bounce and backspin into a check-up.
export const impact = (ball, n, u, e, mu) => {
  const rel = sub(ball.v, u)
  const vn = dot(rel, n)
  if (vn >= 0) return false // already separating
  const jn = -BALL_M * (1 + e) * vn
  const rc = scale(n, -BALL_R) // from the ball's center to the contact point
  const relT = sub(rel, scale(n, vn))
  const slip = add(relT, cross(ball.w, rc)) // contact point velocity along the surface
  const slipSpeed = len(slip)
  let jt = 0
  if (slipSpeed > 1e-9) {
    const k = BALL_I / (BALL_M * BALL_R * BALL_R)
    const toRoll = (slipSpeed * BALL_M * k) / (1 + k) // impulse that would end the slip
    jt = Math.min(toRoll, mu * jn)
  }
  const dir = slipSpeed > 1e-9 ? scale(slip, -1 / slipSpeed) : v3()
  const J = add(scale(n, jn), scale(dir, jt))
  ball.v = add(ball.v, scale(J, 1 / BALL_M))
  ball.w = add(ball.w, scale(cross(rc, scale(dir, jt)), 1 / BALL_I))
  return true
}

export const bounceOnCourt = (ball) => {
  ball.p.y = BALL_R
  impact(ball, UP, v3(), COURT_COR, COURT_FRICTION)
}

// The net: a ball crossing z = 0 between the posts lower than the tape hits it.
// Returns null, "net" (into the mesh: it drops back) or "tape" (clips the cord and dribbles on).
export const netContact = (prevZ, ball) => {
  const { p } = ball
  if (Math.abs(p.x) > NET_POST_X) return null
  const crossed = (prevZ > 0) !== (p.z > 0) || Math.abs(p.z) < BALL_R
  if (!crossed) return null
  const top = netHeightAt(p.x)
  if (p.y - BALL_R > top) return null
  const from = prevZ > 0 ? 1 : -1
  if (p.y < top - BALL_R * 0.3) {
    // into the mesh: most of the speed soaks into the net
    p.z = from * (BALL_R + 0.005)
    ball.v = v3(ball.v.x * 0.3, Math.min(ball.v.y * 0.3, 0.5), -ball.v.z * 0.1)
    ball.w = scale(ball.w, 0.2)
    return "net"
  }
  // on the tape: it pops up a little and loses speed. Slow balls fall back.
  const vz = ball.v.z * 0.55
  ball.v = v3(ball.v.x * 0.8, Math.abs(ball.v.y) * 0.3 + Math.abs(ball.v.z) * 0.18, vz)
  ball.w = scale(ball.w, 0.3)
  if (Math.abs(vz) < 0.6) {
    ball.v.z = from * 0.3 // dribbles back
    p.z = from * (BALL_R + 0.005)
  } else {
    p.z = -from * (BALL_R + 0.005)
  }
  p.y = Math.max(p.y, top + BALL_R * 0.2)
  return "tape"
}

// Fly a ball until it touches the court (or maxT). Returns where and when it lands, how
// high it got, and how it crossed the net plane (clearance above the tape, or null if it
// never crossed). Ignores the net itself: the solver uses the clearance to avoid it.
export const flyToGround = (start, { maxT = 6, dt = STEP } = {}) => {
  const ball = createBall(start.p, start.v, start.w)
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
  const ball = createBall(start.p, start.v, start.w)
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

// Contact off the sweet spot: a dead hit (less restitution) and a slight twist of the face
export const sweetSpotCor = (offset) => {
  const f = Math.min(1, Math.abs(offset) / SWEET_SPOT_R)
  return PADDLE_COR * (1 - 0.45 * f * f)
}

// Hit the ball with a paddle face (unit normal n, toward where the ball should go) moving
// at velocity u. The face's speed and angle (open = tilted up, closed = tilted down) are
// what send the ball; brushing along the face makes spin.
export const paddleHit = (ball, n, u, { offset = 0 } = {}) => {
  const out = createBall(ball.p, ball.v, ball.w)
  impact(out, n, u, sweetSpotCor(offset), PADDLE_FRICTION)
  return out
}

// The paddle swing that sends an incoming ball off at velocity `want`: a face normal and
// face velocity (a normal push plus `brush`, a sideways swipe along the face that makes
// topspin when it's upward). Friction changes the result a little, so it's corrected a few
// times. Returns { n, u, ball } where ball is the actual result.
export const paddleFor = (incoming, want, { brush = 0, offset = 0 } = {}) => {
  const e = sweetSpotCor(offset)
  let aim = { ...want }
  let best = null
  for (let i = 0; i < 6; i++) {
    const n = norm(sub(aim, incoming.v))
    // restitution along n in the paddle's frame: (V - u).n = -e (v - u).n
    const un = (dot(aim, n) + e * dot(incoming.v, n)) / (1 + e)
    // brush: along the face, in the vertical plane of the shot (upward = topspin)
    const side = norm(cross(n, UP))
    const along = norm(cross(side, n)) // "up" along the face
    const u = add(scale(n, un), scale(along, brush))
    const out = paddleHit(incoming, n, u, { offset })
    const err = sub(want, out.v)
    best = { n, u, ball: out }
    if (len(err) < 0.02) break
    aim = add(aim, err)
  }
  return best
}

// ---- aiming: the launch velocity that lands a ball at a target ----

const rangeOf = (p, dir, speed, elev, w) => {
  const v = v3(dir.x * Math.cos(elev) * speed, Math.sin(elev) * speed, dir.z * Math.cos(elev) * speed)
  const r = flyToGround({ p, v, w }, { dt: SOLVE_DT, maxT: 5 })
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
//   { apex }: the arc that peaks at that height (dinks, drops, lobs).
// spin: rad/s of topspin (negative = backspin). minClear: meters of air over the tape.
// Returns { v, w, landing, clearance, apex, flight } (landing may miss if it can't be done).
export const solveShot = (p, target, { speed, apex, spin = 0, minClear = 0.06 } = {}) => {
  const dx = target.x - p.x
  const dz = target.z - p.z
  const D = Math.max(0.05, Math.hypot(dx, dz))
  const dir = v3(dx / D, 0, dz / D)
  const w = scale(topspinAxis(dir), spin)
  const crosses = p.z > 0 !== target.z > 0
  const DEG = Math.PI / 180

  // the speed (at this elevation) that carries exactly D, or null
  const speedFor = (elev) => {
    const f = (s) => rangeOf(p, dir, s, elev, w).range - D
    const fhi = f(45)
    if (fhi < 0) return null
    return findRoot(f, 0.3, 45, f(0.3), fhi, 0.005)
  }

  let result = null
  if (apex !== undefined) {
    let want = apex
    for (let tries = 0; tries < 8; tries++) {
      // higher elevation -> higher apex for the same range
      // (out of reach: too flat to stay up, or too steep for the drag to let it carry)
      const apexAt = (elev) => {
        const s = speedFor(elev)
        if (s === null) return elev > 0.7 ? 10 : -10
        return rangeOf(p, dir, s, elev, w).r.apex - want
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
      result = rangeOf(p, dir, s, e2, w)
      if (!crosses || result.r.clearance === null || result.r.clearance >= minClear) break
      want +=Math.max(0.08, minClear - result.r.clearance + 0.04) // clips the net: arc it higher
    }
  } else {
    let s = speed
    for (let tries = 0; tries < 30; tries++) {
      // the low branch: range grows with elevation up to ~30 degrees
      const f = (elev) => rangeOf(p, dir, s, elev, w).range - D
      const lo = -35 * DEG
      const hi = 30 * DEG
      const fhi = f(hi)
      if (fhi < 0) {
        s *= 1.08 // not enough speed to get there
        continue
      }
      const flo = f(lo)
      const elev = flo >= 0 ? lo : findRoot(f, lo, hi, flo, fhi, 0.005)
      result = rangeOf(p, dir, s, elev, w)
      if (!crosses || result.r.clearance === null || result.r.clearance >= minClear) break
      s *= 0.93 // into the net: take a little pace off (a higher, slower arc)
    }
  }
  return { v: result.v, w, landing: { x: result.r.x, z: result.r.z }, clearance: result.r.clearance, apex: result.r.apex, flight: result.r.t }
}
