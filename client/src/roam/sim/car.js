// Roam: driving. Pure; Node-tested (roam.test.js). Arcade-simple on purpose: a bicycle model
// with speed-sensitive steering, gas and brake (hold brake when stopped to reverse), the
// ground's slope helping or holding you back, and walls you slide along instead of crashing
// into. No damage. Nobody gets hit: the car stops for people in front of it.

export const MODELS = {
  sedan: { top: 30, accel: 6.5, wheelbase: 2.75, len: 4.7, wid: 1.85, circles: [-1.45, 0, 1.45], r: 0.92 },
  hatch: { top: 28, accel: 6.8, wheelbase: 2.55, len: 4.1, wid: 1.78, circles: [-1.2, 0, 1.2], r: 0.88 },
  suv: { top: 28, accel: 6, wheelbase: 2.85, len: 4.85, wid: 1.95, circles: [-1.5, 0, 1.5], r: 0.97 },
  pickup: { top: 27, accel: 5.8, wheelbase: 3.3, len: 5.6, wid: 2.0, circles: [-1.9, -0.3, 1.5], r: 1.0 },
  // the hidden one (eggs): quicker
  turbo: { top: 42, accel: 10, wheelbase: 2.5, len: 4.3, wid: 1.85, circles: [-1.25, 0, 1.25], r: 0.9 },
  // Vince's car, unlocked by his keys (My Park's drinks-machine easter egg): quick, planted
  sundowner: { top: 40, accel: 9.4, wheelbase: 2.74, len: 4.62, wid: 1.94, circles: [-1.35, 0, 1.35], r: 0.95 },
  // a yellow cab (the ride app's cars are the everyday ones): a sedan underneath
  taxi: { top: 30, accel: 6.5, wheelbase: 2.75, len: 4.7, wid: 1.85, circles: [-1.45, 0, 1.45], r: 0.92 },
  // the dockless ones near the shops and parks (sim/fleet.js): nimble, quick off the mark, a
  // tight turn at any speed (steer: full lock at walking pace and at top speed, rad)
  bike: { top: 9.5, accel: 3.4, wheelbase: 1.05, len: 1.75, wid: 0.6, circles: [0], r: 0.42, two: true, steer: [0.6, 0.12], brake: 7 },
  scooter: { top: 8, accel: 3.8, wheelbase: 0.85, len: 1.15, wid: 0.5, circles: [0], r: 0.38, two: true, steer: [0.65, 0.13], brake: 6.5 },
  // a city bus (sim/transit.js drives it; you ride)
  bus: { top: 18, accel: 1.5, wheelbase: 6.2, len: 12.2, wid: 2.55, circles: [-4.5, -1.5, 1.5, 4.5], r: 1.3, big: true },
}
// what a car is: two wheels (you stand on it) or four
export const isTwo = (model) => !!MODELS[model]?.two

// a bike or scooter on one thumb: the stick (x right, y up, each -1..1, the camera behind you)
// says where to go: up rides on (the further, the faster), a sideways lean steers that way,
// pulled back brakes. -> { steer -1..1 (right +), gas 0..1, brake 0..1 }
export const stickToRide = (x, y) => {
  const m = Math.min(1, Math.hypot(x, y))
  if (m < 0.15) return { steer: 0, gas: 0, brake: 0 }
  const a = Math.atan2(x, y) // 0 straight up, +pi/2 right
  if (Math.abs(a) > 2.3) return { steer: 0, gas: 0, brake: m }
  const steer = Math.max(-1, Math.min(1, a / 1.1))
  return { steer, gas: m * Math.max(0.35, Math.cos(a * 0.6)), brake: 0 }
}
export const MODEL_IDS = ["sedan", "hatch", "suv", "pickup"]
const BRAKE = 13
const REVERSE_TOP = 7
const MAX_STEER = 0.6 // rad, at walking pace
const MIN_STEER = 0.075 // rad, at top speed
const STEER_RATE = 3.2 // full lock per second
const G = 9.8

export const createCar = ({ id = "car", model = "sedan", color = 0xffffff, x = 0, z = 0, yaw = 0, y = 0 } = {}) => ({ id, model, color, x, z, y, yaw, speed: 0, steer: 0, pitch: 0, roll: 0, vy: 0, hitT: 0 })

// the steering angle a full lock gives at a speed (less the faster you go)
export const steerLimit = (speed, model = null) => {
  const m = model ? MODELS[model] : null
  if (m?.steer) {
    const k = Math.min(1, Math.abs(speed) / m.top)
    return m.steer[0] + (m.steer[1] - m.steer[0]) * k
  }
  const k = Math.min(1, Math.abs(speed) / 26)
  return MAX_STEER + (MIN_STEER - MAX_STEER) * Math.sqrt(k)
}

// input: { gas 0..1, brake 0..1, steer -1..1 (right +) }
// world: { resolve(x, z, r) -> { x, z, hit, nx, nz }, heightAt(x, z, y) -> m, blocked(x, z, yaw) -> bool }
export const stepCar = (c, input, dt, world = null) => {
  const m = MODELS[c.model] || MODELS.sedan
  const gas = Math.max(0, Math.min(1, input.gas || 0))
  const brake = Math.max(0, Math.min(1, input.brake || 0))
  // steering eases toward the stick (a thumb's jitter doesn't twitch the car)
  const want = Math.max(-1, Math.min(1, input.steer || 0))
  const ds = want - c.steer
  const sstep = STEER_RATE * dt
  c.steer += Math.max(-sstep, Math.min(sstep, ds))
  // the pedals
  let a = 0
  if (gas > 0) {
    if (c.speed < -0.3) a += BRAKE * gas
    else a += m.accel * gas * Math.max(0.15, 1 - (c.speed / m.top) ** 2)
  }
  if (brake > 0) {
    if (c.speed > 0.3) a -= (m.brake || BRAKE) * brake
    else if (gas === 0) a -= (c.speed > -(m.two ? 1.5 : REVERSE_TOP) ? (m.two ? 1.5 : 4.5) : 0) * brake // (held at a stop: backs up)
  }
  // rolling and air drag, and the slope (pitch: nose up +)
  const drag = 0.35 + 0.0016 * c.speed * c.speed
  a -= Math.sign(c.speed) * Math.min(Math.abs(c.speed) / dt, drag)
  a -= G * Math.sin(c.pitch) * 0.55
  const before = c.speed
  c.speed += a * dt
  // (the brake stops the car; it doesn't flip it into reverse by itself in one step)
  if (brake > 0 && gas === 0 && before > 0.3 && c.speed < 0) c.speed = 0
  if (gas === 0 && brake === 0 && Math.abs(c.speed) < 0.15 && Math.abs(Math.sin(c.pitch)) < 0.04) c.speed = 0
  c.speed = Math.max(m.two ? -1.5 : -REVERSE_TOP, Math.min(m.top, c.speed))
  // nobody gets hit: someone in front (or behind, backing up) -> the car stops
  if (world?.blocked && Math.abs(c.speed) > 0.05 && world.blocked(c.x, c.z, c.yaw, Math.sign(c.speed), m)) c.speed = 0
  // turning (bicycle model)
  const angle = c.steer * steerLimit(c.speed, c.model)
  const yawRate = (c.speed * Math.tan(angle)) / m.wheelbase
  // (steer right = clockwise seen from above: yaw goes down in our frame, x east / z south)
  c.yaw -= yawRate * dt
  c.yaw = Math.atan2(Math.sin(c.yaw), Math.cos(c.yaw))
  // moving, in small steps so a wall is never jumped
  const dist = Math.abs(c.speed * dt)
  const n = Math.max(1, Math.ceil(dist / 0.5))
  c.hitT = Math.max(0, c.hitT - dt)
  for (let s = 0; s < n; s++) {
    const fx = Math.sin(c.yaw)
    const fz = Math.cos(c.yaw)
    c.x += (fx * c.speed * dt) / n
    c.z += (fz * c.speed * dt) / n
    if (!world?.resolve) continue
    // the car's three circles along its length, each pushed out of walls; the car moves by the
    // pushes and loses the speed that went into the wall (it slides along it)
    let px = 0
    let pz = 0
    let nx = 0
    let nz = 0
    let hits = 0
    for (const off of m.circles) {
      const cx = c.x + fx * off
      const cz = c.z + fz * off
      const p = world.resolve(cx, cz, m.r)
      if (p.hit) {
        px += p.x - cx
        pz += p.z - cz
        nx += p.nx
        nz += p.nz
        hits++
      }
    }
    if (hits) {
      c.x += px / hits
      c.z += pz / hits
      const nl = Math.hypot(nx, nz) || 1
      nx /= nl
      nz /= nl
      const vx = fx * c.speed
      const vz = fz * c.speed
      const vn = vx * nx + vz * nz
      if (vn < 0 && Math.abs(c.speed) > 0.5) {
        // (the car turns to run along the wall and keeps going, a little scraped: the more
        // head-on, the more speed it loses)
        let tx = -nz
        let tz = nx
        const dir = Math.sign(c.speed)
        if ((tx * fx + tz * fz) * dir < 0) {
          tx = -tx
          tz = -tz
        }
        const along = Math.abs(tx * fx + tz * fz)
        const want = Math.atan2(tx * dir, tz * dir)
        const turn = Math.atan2(Math.sin(want - c.yaw), Math.cos(want - c.yaw))
        c.yaw += turn * Math.min(1, (6 * dt) / n)
        c.speed *= (0.6 + 0.4 * along) ** (1 / n)
        c.hitT = 0.3
      }
    }
  }
  // the ground under the wheels: height, pitch and roll from four samples
  if (world?.heightAt) {
    const fx = Math.sin(c.yaw)
    const fz = Math.cos(c.yaw)
    const half = m.wheelbase / 2
    const w2 = m.wid / 2
    const hf = world.heightAt(c.x + fx * half, c.z + fz * half, c.y)
    const hb = world.heightAt(c.x - fx * half, c.z - fz * half, c.y)
    const hl = world.heightAt(c.x + fz * w2, c.z - fx * w2, c.y)
    const hr = world.heightAt(c.x - fz * w2, c.z + fx * w2, c.y)
    if ([hf, hb, hl, hr].every(Number.isFinite)) {
      const ground = (hf + hb + hl + hr) / 4
      const pitch = Math.atan2(hf - hb, m.wheelbase)
      const roll = Math.atan2(hl - hr, m.wid)
      const k = Math.min(1, dt * 12)
      c.pitch += (pitch - c.pitch) * k
      c.roll += (roll - c.roll) * k
      // (a crest at speed: a little air, then down)
      if (c.y > ground + 0.05) {
        c.vy -= G * dt
        c.y += c.vy * dt
        if (c.y <= ground) {
          c.y = ground
          c.vy = 0
        }
      } else {
        const climb = (ground - c.y) / Math.max(dt, 1e-3)
        c.vy = Math.min(climb, 8)
        c.y = ground
      }
    }
  }
  return c
}

// is someone standing in the car's path? people: [{ x, z }] -> bool
export const personAhead = (people, x, z, yaw, dir = 1, m = MODELS.sedan) => {
  const fx = Math.sin(yaw) * dir
  const fz = Math.cos(yaw) * dir
  for (const p of people) {
    const dx = p.x - x
    const dz = p.z - z
    const along = dx * fx + dz * fz
    const side = Math.abs(dx * fz - dz * fx)
    if (along > 0 && along < m.len / 2 + 2.2 && side < m.wid / 2 + 0.5) return true
  }
  return false
}

// where the doors are: the driver's (left) and the passenger's (right) side -> { x, z }
export const doorSpot = (c, side = "driver") => {
  const m = MODELS[c.model] || MODELS.sedan
  // (the car's right is (-cos yaw, sin yaw); the driver sits on the left, US style)
  const s = side === "driver" ? 1 : -1
  const rx = -Math.cos(c.yaw)
  const rz = Math.sin(c.yaw)
  const off = (m.wid / 2 + 0.7) * -s
  return { x: c.x + rx * off, z: c.z + rz * off }
}
