// Roam: the driving camera. Pure; Node-tested (roam.test.js). A chase camera like a driving
// game's: behind and above the car, looking down the road ahead of it (not at the car's roof),
// swinging round after the car with a little lag, backing off and widening its view with speed,
// tilting with the hills (it looks at the ground ahead, not along a flat line), never in the
// ground and never through a wall.

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a))

export const createChase = () => ({ yaw: null, pos: null, look: null, fov: null })

// c: the car ({ x, y, z, yaw, speed }); env: { portrait, groundAt(x, z) -> m | null,
// segment(x0, z0, x1, z1, y) -> 0..1 (how far the lens can go before a wall) }
// -> { pos: { x, y, z }, look: { x, y, z }, fov } (the state is kept in `ch`)
export const stepChase = (ch, c, dt, env = {}) => {
  const portrait = !!env.portrait
  const speed = Math.abs(c.speed || 0)
  const y0 = c.y || 0
  if (ch.yaw === null) ch.yaw = c.yaw
  // (swings round faster the faster you go, so a quick turn doesn't leave it looking sideways)
  const rate = 2.4 + Math.min(3, speed * 0.12)
  ch.yaw += wrap(c.yaw - ch.yaw) * Math.min(1, dt * rate)
  const fx = Math.sin(ch.yaw)
  const fz = Math.cos(ch.yaw)
  // (scale: closer behind a bike, farther behind a bus)
  const sc = env.scale || 1
  const dist = ((portrait ? 6.9 : 6.0) + Math.min(2.6, speed * 0.08)) * sc
  const height = ((portrait ? 2.25 : 1.95) + Math.min(0.7, speed * 0.022)) * (sc < 1 ? 1.05 : 1 + (sc - 1) * 2.2)
  let bx = c.x - fx * dist
  let bz = c.z - fz * dist
  // walls between the car and the lens pull it in (and up a little)
  const f = env.segment ? env.segment(c.x, c.z, bx, bz, y0 + 1.2) : 1
  const k = f < 1 ? Math.max(0.25, f - 0.05) : 1
  bx = c.x + (bx - c.x) * k
  bz = c.z + (bz - c.z) * k
  const gB = env.groundAt ? env.groundAt(bx, bz) : null
  let by = y0 + height + (1 - k) * 1.2
  // (down a hill the ground behind is higher: stay clear of it)
  if (gB !== null && Number.isFinite(gB)) by = Math.max(by, gB + 1.5)
  // the look: a point on the road ahead, a little above it
  const ahead = Math.min(26, 9 + speed * 0.5)
  const lx = c.x + fx * ahead
  const lz = c.z + fz * ahead
  const gA = env.groundAt ? env.groundAt(lx, lz) : null
  const dy = gA !== null && Number.isFinite(gA) ? Math.max(-ahead * 0.3, Math.min(ahead * 0.3, gA - y0)) : 0
  const ly = y0 + 0.75 + dy * 0.8
  const fovWant = (portrait ? 66 : 56) + Math.min(11, speed * 0.36)
  if (!ch.pos) {
    ch.pos = { x: bx, y: by, z: bz }
    ch.look = { x: lx, y: ly, z: lz }
    ch.fov = fovWant
  } else {
    const kp = Math.min(1, dt * 10)
    const kl = Math.min(1, dt * 7)
    ch.pos.x += (bx - ch.pos.x) * kp
    ch.pos.y += (by - ch.pos.y) * Math.min(1, dt * 6)
    ch.pos.z += (bz - ch.pos.z) * kp
    ch.look.x += (lx - ch.look.x) * kl
    ch.look.y += (ly - ch.look.y) * kl
    ch.look.z += (lz - ch.look.z) * kl
    ch.fov += (fovWant - ch.fov) * Math.min(1, dt * 2)
  }
  // (the lens never below the ground where it is)
  const gP = env.groundAt ? env.groundAt(ch.pos.x, ch.pos.z) : null
  if (gP !== null && Number.isFinite(gP) && ch.pos.y < gP + 1.1) ch.pos.y = gP + 1.1
  return { pos: ch.pos, look: ch.look, fov: ch.fov }
}
