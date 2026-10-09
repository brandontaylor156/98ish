// My Park: other people's positions over the network (pure; Node-tested).
//
// Each browser sends its own walker a few times a second as five small integers (packPos:
// x and z in 5 cm steps, the heading in 1/256 turns, speed in 0.1 m/s, what they're doing);
// the server batches everyone's into one message per receiver (server/park). Here: the
// clock between the server's timestamps and ours, and a short buffer per person drawn
// about a third of a second behind, so the steps in between are smooth; past the last
// update a person carries on a moment (extrapolated) and then stands.

export const TAU = Math.PI * 2
// what someone is doing (the last number of a position)
export const ACTS = { stand: 0, move: 1, sitLow: 2, sitHigh: 3, play: 4, swim: 5, tub: 6 }
export const ACT_NAMES = Object.fromEntries(Object.entries(ACTS).map(([k, v]) => [v, k]))
// added to an act: up off the ground (a stair, a rooftop terrace); the others work out the
// height from the venue's floors where you are (the server only clamps acts to 0..15)
export const UP_BIT = 8

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a))

export const packPos = ({ x = 0, z = 0, yaw = 0, speed = 0, act = 0 }) => [Math.round(x * 20), Math.round(z * 20), (((Math.round((yaw / TAU) * 256) % 256) + 256) % 256), Math.max(0, Math.min(90, Math.round(speed * 10))), Math.max(0, Math.min(15, act | 0))]
export const unpackPos = (a) => {
  if (!Array.isArray(a) || a.length !== 5 || !a.every((n) => Number.isInteger(n))) return null
  return { x: a[0] / 20, z: a[1] / 20, yaw: wrap((a[2] / 256) * TAU), speed: a[3] / 10, act: a[4] }
}

// The server's clock as seen from here: the smallest (arrival - stamp) seen lately is the
// quickest trip, the best guess of the offset (a slow message only looks later)
export const createClock = () => ({ offset: null, seen: [] })
export const observeClock = (c, serverT, localT) => {
  const d = localT - serverT
  c.seen.push(d)
  if (c.seen.length > 20) c.seen.shift()
  const min = Math.min(...c.seen)
  c.offset = c.offset === null ? min : c.offset + (min - c.offset) * 0.2
  return c.offset
}
export const serverTime = (c, localT) => (c.offset === null ? localT : localT - c.offset)

export const DELAY = 320 // ms behind the newest news
export const EXTRAPOLATE = 350 // ms past the last update a person keeps moving
export const TELEPORT = 6 // m: a bigger jump between updates is a jump, not a walk

export const createTrack = () => ({ s: [] })
// a position stamped with the server's time (ms)
export const pushSample = (tr, t, p) => {
  const last = tr.s[tr.s.length - 1]
  if (last && t <= last.t) return false // late or repeated: dropped
  if (last && Math.hypot(p.x - last.x, p.z - last.z) > TELEPORT) tr.s.length = 0 // (a jump: no sliding across)
  tr.s.push({ t, ...p })
  if (tr.s.length > 10) tr.s.shift()
  return true
}

// where to draw them at server time `now`: { x, z, yaw, vx, vz, speed, act, stale }
export const sampleTrack = (tr, now, delay = DELAY) => {
  const s = tr.s
  if (!s.length) return null
  const t = now - delay
  if (t <= s[0].t || s.length === 1) {
    const a = s[0]
    return { x: a.x, z: a.z, yaw: a.yaw, vx: 0, vz: 0, speed: 0, act: a.act, stale: s.length === 1 && t - a.t > EXTRAPOLATE }
  }
  for (let i = s.length - 1; i > 0; i--) {
    const a = s[i - 1]
    const b = s[i]
    if (t >= a.t && t <= b.t) {
      const u = (t - a.t) / Math.max(1, b.t - a.t)
      const dt = Math.max(0.001, (b.t - a.t) / 1000)
      const vx = (b.x - a.x) / dt
      const vz = (b.z - a.z) / dt
      return { x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u, yaw: a.yaw + wrap(b.yaw - a.yaw) * u, vx, vz, speed: Math.hypot(vx, vz), act: u < 0.5 ? a.act : b.act, stale: false }
    }
  }
  // past the newest: carry on along the last step for a moment, then stand
  const b = s[s.length - 1]
  const a = s[s.length - 2]
  const dt = Math.max(0.001, (b.t - a.t) / 1000)
  let vx = (b.x - a.x) / dt
  let vz = (b.z - a.z) / dt
  const over = Math.min(t - b.t, EXTRAPOLATE) / 1000
  const moving = b.speed > 0.05 && t - b.t < EXTRAPOLATE
  if (!moving) {
    vx = 0
    vz = 0
  }
  return { x: b.x + vx * (moving ? over : 0), z: b.z + vz * (moving ? over : 0), yaw: b.yaw, vx, vz, speed: Math.hypot(vx, vz), act: b.act, stale: t - b.t > EXTRAPOLATE }
}

// How often to send your own position: faster while moving, rarely while still; slower
// when the server says the month's traffic is running high (rate: "normal" | "low" | "min")
export const SEND_HZ = { normal: { moving: 6, still: 0.5 }, low: { moving: 3, still: 0.25 }, min: { moving: 1, still: 0.1 } }
export const sendInterval = (moving, rate = "normal") => 1000 / (SEND_HZ[rate] || SEND_HZ.normal)[moving ? "moving" : "still"]
// worth sending now? (moved or turned enough, or the still heartbeat is due)
export const shouldSend = (last, now, p, rate = "normal") => {
  if (!last) return true
  const moving = p.speed > 0.05 || Math.hypot(p.x - last.p.x, p.z - last.p.z) > 0.05
  // moving, just stopped, sat down / stood up, or turned: at the moving rate
  const changed = moving || last.p.speed > 0.05 || p.act !== last.p.act || Math.abs(wrap(p.yaw - last.p.yaw)) > 0.3
  // still: only the heartbeat
  return now - last.t >= sendInterval(changed, rate)
}
