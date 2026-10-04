// A small 2D physics engine for pinball: balls rolling down a tilted table, bouncing off
// line segments, arcs and circles, batted by flippers that swing, spinning spinners, and
// riding ramps (a second layer over the playfield).
//
// Continuous collision: the world runs fixed 1/240 s steps, and each step is split into
// enough substeps that no ball (plus the fastest moving surface) travels more than a third
// of a ball radius per substep. A wall is found while the ball still overlaps it from its
// own side, so even a zero-thickness wall can't be jumped at top speed (tested).
//
// Units: table units (the table is 560 x 1000), seconds; y grows down the table.
// Layers: 0 is the playfield, 1 the ramp. A ball only touches things on its own layer and
// changes layer when it crosses a transition line in the right direction.
// A uniform grid (built once) keeps each ball's collision checks to the walls near it.

export const BALL_R = 11
export const GRAVITY = 1900 // the table's slope: units / s^2 toward the player
export const MAX_SPEED = 4200
export const STEP = 1 / 240
const MAX_MOVE = BALL_R * 0.3 // most a ball (or a surface) moves in one substep
const MAX_SUBSTEPS = 48
const BOUNCE_FLOOR = 45 // slower impacts don't bounce at all, so balls roll instead of buzzing
const ROLL_DRAG = 0.06 // fraction of speed lost per second rolling
export const FLIP_UP_SPEED = 32 // rad/s, top speed of a flipper stroke
export const FLIP_ACCEL = 2600 // rad/s^2: full speed after ~12 ms (a coil, not a teleport)
export const FLIP_DOWN_SPEED = 18
export const SPIN_GAIN = 0.022 // spinner rad/s per unit/s of ball speed through it
const SPIN_FRICTION = 6 // rad/s^2
const SPIN_DRAG = 0.9 // per second
const CELL = 40
const GRID_X0 = -80
const GRID_Y0 = -80
const GRID_COLS = 18
const GRID_ROWS = 30

const TAU = Math.PI * 2

const base = (o) => ({ e: 0.5, mu: 0.06, kick: 0, rad: 0, tag: null, id: 0, active: true, oneSided: false, layer: 0, only: null, vx: 0, vy: 0, ...o })

// A straight wall from a to b (rad gives it thickness, like a rubber-wrapped post). A
// one-sided segment only stops balls on its left-hand side (seen walking from a to b)
// that are moving into it: a gate balls pass through one way.
export const segment = (ax, ay, bx, by, o = {}) => base({ kind: "seg", ax, ay, bx, by, ...o })

// A gate that stops balls on the side of (sx, sy) moving into it, and lets them through
// from the other side
export const gate = (ax, ay, bx, by, sx, sy, o = {}) => {
  const side = (sx - ax) * -(by - ay) + (sy - ay) * (bx - ax)
  return side > 0 ? segment(ax, ay, bx, by, { ...o, oneSided: true }) : segment(bx, by, ax, ay, { ...o, oneSided: true })
}

// A curved wall: the part of a circle from angle a0 to a1 (radians, increasing, which on
// screen is clockwise since y grows down)
export const arc = (cx, cy, r, a0, a1, o = {}) => base({ kind: "arc", cx, cy, r, a0, a1, span: (((a1 - a0) % TAU) + TAU) % TAU || TAU, ...o })

// A round post or bumper
export const circle = (cx, cy, r, o = {}) => base({ kind: "circle", cx, cy, r, ...o })

// A flipper: a tapered bat turning about (x, y) between its rest and up angles
export const flipper = ({ x, y, length, r0, r1, rest, up, side, id = side === "left" ? 0 : 1, e = 0.32, mu = 0.14 }) => ({
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
  e,
  mu,
  active: true,
  layer: 0,
  tag: "flipper",
  id,
})

export const flipperTip = (f) => ({ x: f.x + Math.cos(f.angle) * f.length, y: f.y + Math.sin(f.angle) * f.length })

// A spinner: a flat plate on a wire across a lane. Balls go through it and set it spinning;
// every half turn is a "spin" event.
export const spinner = (ax, ay, bx, by, o = {}) => ({ kind: "spinner", ax, ay, bx, by, angle: 0, omega: 0, turns: 0, layer: 0, tag: "spin", id: 0, ...o })

// A line a ball changes layer at, when it crosses in the direction (nx, ny)
export const transition = (ax, ay, bx, by, from, to, nx, ny, o = {}) => {
  const d = Math.hypot(nx, ny) || 1
  return { ax, ay, bx, by, from, to, nx: nx / d, ny: ny / d, tag: null, id: 0, ...o }
}

// A stretch of ramp that slopes: balls inside the capsule (a..b, radius r) on that layer
// are pushed by (gx, gy) as well as the table's own slope
export const slope = (ax, ay, bx, by, r, gx, gy, layer = 1) => ({ ax, ay, bx, by, r, gx, gy, layer })

let nextBallId = 1
export const createBall = (x, y, vx = 0, vy = 0, o = {}) => ({ x, y, vx, vy, px: x, py: y, layer: 0, kind: "play", held: false, inside: new Set(), id: nextBallId++, ...o })

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

// the box a collider can touch a ball center in
const reachBox = (c) => {
  const m = BALL_R + (c.rad || 0) + 2
  if (c.kind === "seg") return [Math.min(c.ax, c.bx) - m, Math.min(c.ay, c.by) - m, Math.max(c.ax, c.bx) + m, Math.max(c.ay, c.by) + m]
  return [c.cx - c.r - m, c.cy - c.r - m, c.cx + c.r + m, c.cy + c.r + m]
}

const buildGrid = (colliders) => {
  const layers = [[], []].map(() => Array.from({ length: GRID_COLS * GRID_ROWS }, () => []))
  const loose = [] // moving colliders (the plunger), checked every time
  for (const c of colliders) {
    if (c.dynamic) {
      loose.push(c)
      continue
    }
    const [x0, y0, x1, y1] = reachBox(c)
    const cells = layers[c.layer] || layers[0]
    const cx0 = clamp(Math.floor((x0 - GRID_X0) / CELL), 0, GRID_COLS - 1)
    const cx1 = clamp(Math.floor((x1 - GRID_X0) / CELL), 0, GRID_COLS - 1)
    const cy0 = clamp(Math.floor((y0 - GRID_Y0) / CELL), 0, GRID_ROWS - 1)
    const cy1 = clamp(Math.floor((y1 - GRID_Y0) / CELL), 0, GRID_ROWS - 1)
    for (let gy = cy0; gy <= cy1; gy++) for (let gx = cx0; gx <= cx1; gx++) cells[gy * GRID_COLS + gx].push(c)
  }
  return { layers, loose, all: colliders }
}

// The world: walls and posts, flippers, spinners, the plunger, sensors (rollovers and
// holes, which report balls entering them but don't touch them), layer transitions,
// slopes, and the balls
export const createWorld = ({ colliders, flippers = [], plunger = null, sensors = [], spinners = [], transitions = [], slopes = [], zones = {} }) => ({
  colliders,
  flippers,
  plunger,
  sensors,
  spinners,
  transitions,
  slopes,
  zones, // layer -> (x, y) => is that point on the layer's area
  grid: buildGrid(colliders),
  balls: [],
  gravity: GRAVITY,
  time: 0,
  events: [],
  kickers: true, // bumpers and slingshots fire (off for physics tests)
  substeps: 0, // counted, for the perf panel
})

// colliders near a ball (the grid cell its center is in)
const nearby = (w, b) => {
  const gx = Math.floor((b.x - GRID_X0) / CELL)
  const gy = Math.floor((b.y - GRID_Y0) / CELL)
  if (gx < 0 || gy < 0 || gx >= GRID_COLS || gy >= GRID_ROWS) return w.grid.all.filter((c) => (c.layer || 0) === b.layer)
  return (w.grid.layers[b.layer] || w.grid.layers[0])[gy * GRID_COLS + gx]
}

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

// The flipper's coil: it accelerates toward its stop (up while pressed, rest when let go)
// and stops dead there. omega is its real angular speed this substep, which is what the
// ball feels (so a flipper caught mid-stroke hits softer than one at full speed).
const moveFlipper = (f, h) => {
  const target = f.pressed ? f.up : f.rest
  const dir = Math.sign(target - f.angle)
  if (!dir) {
    f.omega = 0
    return
  }
  const max = f.pressed ? FLIP_UP_SPEED : FLIP_DOWN_SPEED
  const w = Math.min(max, Math.max(0, f.omega * dir) + FLIP_ACCEL * h)
  let next = f.angle + dir * w * h
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

const hits = (c, b) => c.active && (!c.only || c.only === b.kind)

const collideBall = (w, b) => {
  const near = nearby(w, b)
  const loose = w.grid.loose
  for (let pass = 0; pass < 2; pass++) {
    let touched = false
    for (let k = 0, n = near.length + loose.length; k < n; k++) {
      const c = k < near.length ? near[k] : loose[k - near.length]
      if (!hits(c, b) || (c.layer || 0) !== b.layer) continue
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
    if (b.layer === 0) {
      for (const f of w.flippers) {
        const hit = contact(b, f)
        if (!hit) continue
        touched = true
        const speed = resolve(b, hit, f.e, f.mu)
        if (!pass && speed > 60) w.events.push({ type: "flipperHit", id: f.id, speed, ball: b })
      }
    }
    if (!touched) break
  }
}

const collideBalls = (a, b) => {
  if (a.layer !== b.layer) return
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
    if ((s.layer || 0) !== b.layer || (s.only ? s.only !== b.kind : b.kind !== "play")) continue
    const inside = (b.x - s.x) ** 2 + (b.y - s.y) ** 2 < s.r * s.r
    if (inside && !b.inside.has(s)) {
      b.inside.add(s)
      w.events.push({ type: s.tag, id: s.id, ball: b, speed: Math.hypot(b.vx, b.vy) })
    } else if (!inside && b.inside.has(s)) b.inside.delete(s)
  }
}

// Did the ball's center cross the line a-b this substep (at least `margin` in from its
// ends)? -> +1 / -1 (which way along the line's normal), or 0
const crossed = (b, ax, ay, bx, by, margin = 0) => {
  const dx = bx - ax
  const dy = by - ay
  const s0 = (b.px - ax) * -dy + (b.py - ay) * dx
  const s1 = (b.x - ax) * -dy + (b.y - ay) * dx
  if ((s0 < 0) === (s1 < 0)) return 0
  const len2 = dx * dx + dy * dy
  const t = ((b.x - ax) * dx + (b.y - ay) * dy) / len2
  const m = margin / Math.sqrt(len2)
  if (margin ? t < m || t > 1 - m : t < -0.05 || t > 1.05) return 0
  return s1 > s0 ? 1 : -1
}

const changeLayers = (w, b) => {
  for (const t of w.transitions) {
    if (t.from !== b.layer) continue
    if (!crossed(b, t.ax, t.ay, t.bx, t.by, t.margin || 0)) continue
    if (b.vx * t.nx + b.vy * t.ny <= 0) continue
    b.layer = t.to
    b.inside.clear()
    if (t.tag) w.events.push({ type: t.tag, id: t.id, ball: b, speed: Math.hypot(b.vx, b.vy) })
    return
  }
  // a ball can only be on an upper layer inside that layer's area (if a knock ever put it
  // outside, it drops back to the playfield)
  const zone = w.zones[b.layer]
  if (zone && !zone(b.x, b.y)) b.layer = 0
}

const spinSpinners = (w, b) => {
  for (const s of w.spinners) {
    if (s.layer !== b.layer) continue
    if (!crossed(b, s.ax, s.ay, s.bx, s.by)) continue
    // the ball's speed across the wire sets the plate spinning (the faster, the longer)
    const dx = s.bx - s.ax
    const dy = s.by - s.ay
    const len = Math.hypot(dx, dy)
    const vn = (b.vx * -dy + b.vy * dx) / len
    const kick = Math.abs(vn) * SPIN_GAIN * Math.sign(vn || 1)
    if (Math.sign(kick) === Math.sign(s.omega) || !s.omega) s.omega += kick
    else s.omega = kick
    b.vx *= 0.97
    b.vy *= 0.97
    w.events.push({ type: "spinnerHit", id: s.id, ball: b, speed: Math.abs(vn) })
  }
}

const turnSpinner = (w, s, h) => {
  if (!s.omega) return
  s.angle += s.omega * h
  const half = Math.floor(s.angle / Math.PI)
  if (half !== s.turns) {
    s.turns = half
    w.events.push({ type: s.tag, id: s.id, speed: Math.abs(s.omega) })
  }
  const slow = (SPIN_FRICTION + SPIN_DRAG * Math.abs(s.omega)) * h
  if (Math.abs(s.omega) <= slow) {
    s.omega = 0
    // settle hanging down
    s.angle = Math.round(s.angle / Math.PI) * Math.PI
    s.turns = Math.floor(s.angle / Math.PI + 1e-9)
  } else s.omega -= Math.sign(s.omega) * slow
}

const applySlopes = (w, b, h) => {
  for (const s of w.slopes) {
    if (s.layer !== b.layer) continue
    const dx = s.bx - s.ax
    const dy = s.by - s.ay
    const t = clamp(((b.x - s.ax) * dx + (b.y - s.ay) * dy) / (dx * dx + dy * dy), 0, 1)
    const qx = s.ax + dx * t - b.x
    const qy = s.ay + dy * t - b.y
    if (qx * qx + qy * qy > s.r * s.r) continue
    b.vx += s.gx * h
    b.vy += s.gy * h
  }
}

// How many substeps this step needs so nothing moves more than MAX_MOVE per substep
export const substepsFor = (w, dt) => {
  let fast = 0
  for (const b of w.balls) if (!b.held) fast = Math.max(fast, Math.hypot(b.vx, b.vy) + w.gravity * dt * 2)
  let surface = 0
  for (const f of w.flippers) {
    const target = f.pressed ? f.up : f.rest
    if (f.angle !== target || f.omega) surface = Math.max(surface, FLIP_UP_SPEED * (f.length + f.r1))
  }
  if (w.plunger) surface = Math.max(surface, -w.plunger.vy)
  return clamp(Math.ceil(((fast + surface) * dt) / MAX_MOVE), 1, MAX_SUBSTEPS)
}

// One fixed step of the world. Collisions, kicks, sensors, spins and layer changes are
// appended to w.events.
export const stepWorld = (w, dt = STEP) => {
  const n = substepsFor(w, dt)
  const h = dt / n
  const drag = 1 - ROLL_DRAG * h
  for (let i = 0; i < n; i++) {
    for (const f of w.flippers) moveFlipper(f, h)
    if (w.plunger) movePlunger(w.plunger, h)
    for (const s of w.spinners) turnSpinner(w, s, h)
    for (const b of w.balls) {
      if (b.held) continue
      b.px = b.x
      b.py = b.y
      b.vy += w.gravity * h
      if (w.slopes.length) applySlopes(w, b, h)
      b.vx *= drag
      b.vy *= drag
      b.x += b.vx * h
      b.y += b.vy * h
      if (b.kind === "play") {
        if (w.transitions.length) changeLayers(w, b)
        if (w.spinners.length) spinSpinners(w, b)
      }
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
  w.substeps += n
  return n
}

// Mechanical energy per unit mass (for tests): kinetic + potential (y grows downhill)
export const energy = (b, g = GRAVITY) => 0.5 * (b.vx * b.vx + b.vy * b.vy) - g * b.y
