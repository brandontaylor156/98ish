// A small 2D physics engine for pinball: balls rolling down a tilted table, bouncing off
// line segments, arcs and circles, and batted by flippers that turn. Everything runs in
// fixed 1/240 s steps, each split into enough substeps that nothing moves more than a
// third of a ball radius at a time, so a fast ball can't jump through a wall or a flipper.
// Units are table units (the table is 560 x 1000), seconds, and y grows down the table.

export const BALL_R = 11
export const GRAVITY = 1900 // the table's slope: units / s^2 toward the player
export const MAX_SPEED = 4200
export const STEP = 1 / 240
const MAX_MOVE = BALL_R * 0.3 // most a ball (or a surface) moves in one substep
const MAX_SUBSTEPS = 48
const BOUNCE_FLOOR = 45 // slower impacts don't bounce at all, so balls roll instead of buzzing
export const FLIP_UP_SPEED = 30 // rad/s
export const FLIP_DOWN_SPEED = 17

const TAU = Math.PI * 2

const base = (o) => ({ e: 0.5, mu: 0.06, kick: 0, rad: 0, tag: null, id: 0, active: true, oneSided: false, vx: 0, vy: 0, ...o })

// A straight wall from a to b (rad gives it thickness, like a rubber-wrapped post). A
// one-sided segment only stops balls on its left-hand side (seen walking from a to b)
// that are moving into it: a gate balls pass through one way.
export const segment = (ax, ay, bx, by, o = {}) => base({ kind: "seg", ax, ay, bx, by, ...o })

// A curved wall: the part of a circle from angle a0 to a1 (radians, increasing, which on
// screen is clockwise since y grows down)
export const arc = (cx, cy, r, a0, a1, o = {}) => base({ kind: "arc", cx, cy, r, a0, a1, span: (((a1 - a0) % TAU) + TAU) % TAU || TAU, ...o })

// A round post or bumper
export const circle = (cx, cy, r, o = {}) => base({ kind: "circle", cx, cy, r, ...o })

// A flipper: a tapered bat turning about (x, y) between its rest and up angles
export const flipper = ({ x, y, length, r0, r1, rest, up, side }) => ({
  kind: "flipper",
  x,
  y,
  length,
  r0,
  r1,
  rest,
  up,
  side,
  angle: rest,
  omega: 0,
  pressed: false,
  e: 0.3,
  mu: 0.12,
  active: true,
  tag: "flipper",
  id: side === "left" ? 0 : 1,
})

export const flipperTip = (f) => ({ x: f.x + Math.cos(f.angle) * f.length, y: f.y + Math.sin(f.angle) * f.length })

export const createBall = (x, y, vx = 0, vy = 0) => ({ x, y, vx, vy, held: false, inside: new Set(), id: Math.random() })

// The world: walls and posts, flippers, the plunger, sensors (rollovers and holes, which
// report balls entering them but don't touch them), and the balls
export const createWorld = ({ colliders, flippers = [], plunger = null, sensors = [] }) => ({
  colliders,
  flippers,
  plunger,
  sensors,
  balls: [],
  gravity: GRAVITY,
  time: 0,
  events: [],
  kickers: true, // bumpers and slingshots fire (off for physics tests)
})

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

// Where a ball touches a collider: { nx, ny, pen, svx, svy } (the push-out normal, the
// overlap, and the surface's own velocity at the contact), or null
export const contact = (b, c) => {
  let qx
  let qy
  let reach = BALL_R
  let svx = c.vx || 0
  let svy = c.vy || 0
  if (c.kind === "seg") {
    const dx = c.bx - c.ax
    const dy = c.by - c.ay
    const len2 = dx * dx + dy * dy
    const t = clamp(((b.x - c.ax) * dx + (b.y - c.ay) * dy) / len2, 0, 1)
    qx = c.ax + t * dx
    qy = c.ay + t * dy
    reach += c.rad
    if (c.oneSided) {
      const side = (b.x - c.ax) * -dy + (b.y - c.ay) * dx
      const into = b.vx * -dy + b.vy * dx
      if (side < 0 || into >= 0) return null
    }
  } else if (c.kind === "circle") {
    qx = c.cx
    qy = c.cy
    reach += c.r
  } else if (c.kind === "arc") {
    const dx = b.x - c.cx
    const dy = b.y - c.cy
    const rel = (((Math.atan2(dy, dx) - c.a0) % TAU) + TAU) % TAU
    if (rel <= c.span) {
      const d = Math.hypot(dx, dy) || 1
      qx = c.cx + (dx / d) * c.r
      qy = c.cy + (dy / d) * c.r
    } else {
      // past an end: the nearer end point
      const x0 = c.cx + Math.cos(c.a0) * c.r
      const y0 = c.cy + Math.sin(c.a0) * c.r
      const x1 = c.cx + Math.cos(c.a1) * c.r
      const y1 = c.cy + Math.sin(c.a1) * c.r
      if ((b.x - x0) ** 2 + (b.y - y0) ** 2 < (b.x - x1) ** 2 + (b.y - y1) ** 2) {
        qx = x0
        qy = y0
      } else {
        qx = x1
        qy = y1
      }
    }
    reach += c.rad
  } else if (c.kind === "flipper") {
    const cos = Math.cos(c.angle)
    const sin = Math.sin(c.angle)
    const t = clamp(((b.x - c.x) * cos + (b.y - c.y) * sin) / c.length, 0, 1)
    qx = c.x + cos * c.length * t
    qy = c.y + sin * c.length * t
    const rr = c.r0 + (c.r1 - c.r0) * t
    reach += rr
    let nx = b.x - qx
    let ny = b.y - qy
    const d = Math.hypot(nx, ny)
    if (d >= reach) return null
    if (d < 1e-6) {
      nx = -sin
      ny = cos
    } else {
      nx /= d
      ny /= d
    }
    // the surface point's velocity: omega x (point - pivot)
    const px = qx + nx * rr
    const py = qy + ny * rr
    return { nx, ny, pen: reach - d, svx: -c.omega * (py - c.y), svy: c.omega * (px - c.x) }
  }
  let nx = b.x - qx
  let ny = b.y - qy
  const d2 = nx * nx + ny * ny
  if (d2 >= reach * reach) return null
  const d = Math.sqrt(d2)
  if (d < 1e-6) {
    // dead center: push straight up the table
    nx = 0
    ny = -1
  } else {
    nx /= d
    ny /= d
  }
  return { nx, ny, pen: reach - d, svx, svy }
}

// Push the ball out and bounce it: restitution e along the normal, Coulomb friction mu
// along the surface, all relative to the surface's own motion. Returns the impact speed.
export const resolve = (b, hit, e, mu) => {
  const { nx, ny, pen, svx, svy } = hit
  b.x += nx * pen
  b.y += ny * pen
  const rvx = b.vx - svx
  const rvy = b.vy - svy
  const vn = rvx * nx + rvy * ny
  if (vn >= 0) return 0
  const tx = -ny
  const ty = nx
  const vt = rvx * tx + rvy * ty
  const bounce = -vn < BOUNCE_FLOOR ? 0 : e
  const jn = -(1 + bounce) * vn // normal speed change (> 0)
  const friction = Math.min(Math.abs(vt), mu * jn) * Math.sign(vt)
  const newVn = vn + jn
  const newVt = vt - friction
  b.vx = svx + nx * newVn + tx * newVt
  b.vy = svy + ny * newVn + ty * newVt
  return -vn
}

const capSpeed = (b) => {
  const s = Math.hypot(b.vx, b.vy)
  if (s > MAX_SPEED) {
    b.vx *= MAX_SPEED / s
    b.vy *= MAX_SPEED / s
  }
}

const moveFlipper = (f, h) => {
  const target = f.pressed ? f.up : f.rest
  const speed = f.pressed ? FLIP_UP_SPEED : FLIP_DOWN_SPEED
  const dir = Math.sign(target - f.angle)
  let next = f.angle + dir * speed * h
  if ((dir > 0 && next > target) || (dir < 0 && next < target)) next = target
  f.omega = (next - f.angle) / h
  f.angle = next
}

// The plunger rod: a short floor across the shooter lane. The game sets p.y while it is
// pulled back; fire() sends it up at a speed and it stops at its rest position.
const movePlunger = (p, h) => {
  const c = p.collider
  if (p.vy < 0) {
    p.y += p.vy * h
    if (p.y <= p.restY) {
      p.y = p.restY
      p.vy = 0
    }
  }
  c.ay = c.by = p.y
  c.vy = p.vy
}

export const firePlunger = (p, speed) => {
  p.vy = -speed
}

const collideBall = (w, b) => {
  for (let pass = 0; pass < 2; pass++) {
    let touched = false
    for (const c of w.colliders) {
      if (!c.active) continue
      const hit = contact(b, c)
      if (!hit) continue
      touched = true
      const speed = resolve(b, hit, c.e, c.mu)
      if (pass) continue
      if (c.kick && w.kickers && (c.kind === "circle" || speed > 30) && w.time - (c.lastKick ?? -1) > 0.06) {
        // pop bumpers and slingshots fire: at least `kick` outward
        const vn = b.vx * hit.nx + b.vy * hit.ny
        if (vn < c.kick) {
          b.vx += (c.kick - vn) * hit.nx
          b.vy += (c.kick - vn) * hit.ny
        }
        c.lastKick = w.time
        w.events.push({ type: c.tag, id: c.id, speed, ball: b, nx: hit.nx, ny: hit.ny })
      } else if (c.tag && speed > 25 && !c.kick) {
        w.events.push({ type: c.tag, id: c.id, speed, ball: b, nx: hit.nx, ny: hit.ny })
      }
    }
    for (const f of w.flippers) {
      const hit = contact(b, f)
      if (!hit) continue
      touched = true
      const speed = resolve(b, hit, f.e, f.mu)
      if (!pass && speed > 60) w.events.push({ type: "flipperHit", id: f.id, speed, ball: b })
    }
    if (!touched) break
  }
}

const collideBalls = (a, b) => {
  let nx = b.x - a.x
  let ny = b.y - a.y
  const d = Math.hypot(nx, ny)
  if (d >= BALL_R * 2 || d < 1e-6) return
  nx /= d
  ny /= d
  const pen = (BALL_R * 2 - d) / 2
  a.x -= nx * pen
  a.y -= ny * pen
  b.x += nx * pen
  b.y += ny * pen
  const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny
  if (vn >= 0) return
  const j = (-(1 + 0.9) * vn) / 2
  a.vx -= j * nx
  a.vy -= j * ny
  b.vx += j * nx
  b.vy += j * ny
}

const senseBall = (w, b) => {
  for (const s of w.sensors) {
    const inside = (b.x - s.x) ** 2 + (b.y - s.y) ** 2 < s.r * s.r
    if (inside && !b.inside.has(s)) {
      b.inside.add(s)
      w.events.push({ type: s.tag, id: s.id, ball: b, speed: Math.hypot(b.vx, b.vy) })
    } else if (!inside && b.inside.has(s)) b.inside.delete(s)
  }
}

// How many substeps this step needs so nothing moves more than MAX_MOVE per substep
const substepsFor = (w, dt) => {
  let fast = 0
  for (const b of w.balls) if (!b.held) fast = Math.max(fast, Math.hypot(b.vx, b.vy) + w.gravity * dt)
  let surface = 0
  for (const f of w.flippers) {
    const target = f.pressed ? f.up : f.rest
    if (f.angle !== target || f.omega) surface = Math.max(surface, FLIP_UP_SPEED * (f.length + f.r1))
  }
  if (w.plunger) surface = Math.max(surface, -w.plunger.vy)
  return clamp(Math.ceil(((fast + surface) * dt) / MAX_MOVE), 1, MAX_SUBSTEPS)
}

// One fixed step of the world. Collisions, kicks and sensors are appended to w.events.
export const stepWorld = (w, dt = STEP) => {
  const n = substepsFor(w, dt)
  const h = dt / n
  for (let i = 0; i < n; i++) {
    for (const f of w.flippers) moveFlipper(f, h)
    if (w.plunger) movePlunger(w.plunger, h)
    for (const b of w.balls) {
      if (b.held) continue
      b.vy += w.gravity * h
      b.x += b.vx * h
      b.y += b.vy * h
      collideBall(w, b)
      capSpeed(b)
      senseBall(w, b)
    }
    for (let j = 0; j < w.balls.length; j++) {
      for (let k = j + 1; k < w.balls.length; k++) {
        if (!w.balls[j].held && !w.balls[k].held) collideBalls(w.balls[j], w.balls[k])
      }
    }
    w.time += h
  }
  return n
}

// Mechanical energy per unit mass (for tests): kinetic + potential (y grows downhill)
export const energy = (b, g = GRAVITY) => 0.5 * (b.vx * b.vx + b.vy * b.vy) - g * b.y
