// Roam online: what goes over the wire, and drawing other people smoothly. Pure; Node-tested
// (roam.test.js). The server side (server/roam) checks and caps the same shapes.
//
// A position is six small integers: x, z, y in decimetres from the town's origin, the heading
// in 1/256 turns, speed in 0.1 m/s, and what you're doing (ACT bits: walking, sprinting,
// driving, riding along). Sent up to 6 times a second on foot and 8 in a car while moving,
// once every 2 s standing still; the server batches everyone's to each person (roam:m).
// Cars are named once when you get in (roam:car), not in every position.

export const ACT = { stand: 0, move: 1, sprint: 2, drive: 4, ride: 8 }
export const LIMIT = { x: 300000, y: 30000, speed: 900, act: 15 } // (|x|, |z| up to 30 km; y 3 km; 90 m/s)
export const RATE = { walk: 1 / 6, drive: 1 / 8, still: 2 } // seconds between sends

const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)))
export const packPos = ({ x, z, y = 0, yaw = 0, speed = 0, act = 0 }) => [
  clampInt(x * 10, -LIMIT.x, LIMIT.x),
  clampInt(z * 10, -LIMIT.x, LIMIT.x),
  clampInt(y * 10, -LIMIT.y, LIMIT.y),
  ((Math.round((yaw / (2 * Math.PI)) * 256) % 256) + 256) % 256,
  clampInt(Math.abs(speed) * 10, 0, LIMIT.speed),
  clampInt(act, 0, LIMIT.act),
]
export const unpackPos = (a) => {
  if (!Array.isArray(a) || a.length !== 6 || !a.every(Number.isInteger)) return null
  return { x: a[0] / 10, z: a[1] / 10, y: a[2] / 10, yaw: (a[3] / 256) * 2 * Math.PI, speed: a[4] / 10, act: a[5] }
}
// the same checks the server makes -> [6 ints] | null
export const cleanPos = (a) => {
  if (!Array.isArray(a) || a.length !== 6 || !a.every(Number.isInteger)) return null
  if (Math.abs(a[0]) > LIMIT.x || Math.abs(a[1]) > LIMIT.x || Math.abs(a[2]) > LIMIT.y) return null
  if (a[3] < 0 || a[3] > 255 || a[4] < 0 || a[4] > LIMIT.speed || a[5] < 0 || a[5] > LIMIT.act) return null
  return a.slice()
}

// should we send now? last: { t, p } | null
export const shouldSend = (last, p, now, driving) => {
  if (!last) return true
  const dt = now - last.t
  const moved = Math.hypot(p.x - last.p.x, p.z - last.p.z) > 0.05 || Math.abs(p.yaw - last.p.yaw) > 0.05 || p.act !== last.p.act
  if (!moved) return dt >= RATE.still
  return dt >= (driving ? RATE.drive : RATE.walk)
}

// ---- drawing someone ~250 ms in the past, between the samples that came in ----
export const DELAY = 0.25
export const createTrack = () => ({ s: [] })
// t: the sender's batch time on the server clock (s); p: unpacked position
export const pushSample = (tr, t, p) => {
  const s = tr.s
  if (s.length && t <= s[s.length - 1].t) return
  s.push({ t, ...p })
  if (s.length > 12) s.shift()
}
const lerpAngle = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k
// -> position at time t (with a short glide past the last sample at its own speed)
export const sampleTrack = (tr, t) => {
  const s = tr.s
  if (!s.length) return null
  if (t <= s[0].t) return { ...s[0] }
  for (let i = 0; i + 1 < s.length; i++) {
    const a = s[i]
    const b = s[i + 1]
    if (t >= a.t && t <= b.t) {
      const k = (t - a.t) / (b.t - a.t || 1)
      return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, y: a.y + (b.y - a.y) * k, yaw: lerpAngle(a.yaw, b.yaw, k), speed: a.speed + (b.speed - a.speed) * k, act: k < 0.5 ? a.act : b.act }
    }
  }
  const last = s[s.length - 1]
  const over = Math.min(0.4, t - last.t)
  return { ...last, x: last.x + Math.sin(last.yaw) * last.speed * over * ((last.act & ACT.drive) ? 1 : 0.6), z: last.z + Math.cos(last.yaw) * last.speed * over * ((last.act & ACT.drive) ? 1 : 0.6) }
}

// a car someone's in, as sent once with roam:car: { id, model, color, seat: 0 driver | 1
// passenger, driver: num (for a passenger) }
export const MODEL_LIST = ["sedan", "hatch", "suv", "pickup", "turbo", "sundowner", "taxi", "bike", "scooter", "bus", "train"]
export const cleanCar = (c) => {
  if (!c || typeof c !== "object") return null
  const id = typeof c.id === "string" && c.id.length <= 40 && /^[\w:/.-]+$/.test(c.id) ? c.id : null
  const model = MODEL_LIST.includes(c.model) ? c.model : null
  const color = Number.isInteger(c.color) && c.color >= 0 && c.color <= 0xffffff ? c.color : null
  if (!id || !model || color === null) return null
  return { id, model, color }
}
