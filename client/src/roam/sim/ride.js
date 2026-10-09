// Roam: a car that drives itself along a route (the ride app "Ryde 98" and the yellow cabs). Pure;
// Node-tested (transport.test.js). The owner: "get an uber, taxi": you pick where to go on the
// phone, a car comes to you along the roads, you get in, it drives you there along the roads
// (nav/route.js), and you can skip ahead once you're in. It keeps to its lane (right of the
// road's middle), slows for bends and at the end, and stops for anyone in front of it.

import { pointAt } from "../nav/route.js"

export const RIDE = { cruise: 14, city: 11, lane: 1.8, accel: 2.6, decel: 4.5, latAcc: 2.8 }
export const RIDE_KINDS = {
  ryde: { name: "Ryde 98", models: ["sedan", "suv", "hatch"], colors: [0x1d1f22, 0xf2f2ef, 0x6b6f75, 0x1f3f7a] },
  taxi: { name: "Yellow Cab", models: ["taxi"], colors: [0xf2c12e] },
}
// original names for the drivers (a line on the phone)
export const DRIVERS = ["Marisol", "Dev", "Teo", "Priya", "Gus", "Lena", "Omar", "June", "Sal", "Rina", "Hank", "Ivy"]

// a trip along a route (nav/route.js) -> { pts, cum, len, s, speed, done }
export const createTrip = (r, { s = 0, speed = 0 } = {}) => ({ pts: r.pts, cum: r.cum, len: r.len, s, speed, done: false, stopT: 0 })

// the pose s metres along: in the lane, facing along the road -> { x, z, yaw }
export const tripPoseAt = (trip, s = trip.s) => {
  const a = pointAt(trip.pts, trip.cum, s)
  const b = pointAt(trip.pts, trip.cum, Math.min(trip.len, s + 4))
  let hx = b.x - a.x
  let hz = b.z - a.z
  const l = Math.hypot(hx, hz)
  if (l < 1e-3) {
    hx = a.hx
    hz = a.hz
  } else {
    hx /= l
    hz /= l
  }
  // (x east, z south: the right of a heading (hx, hz) is (-hz, hx))
  const off = Math.min(RIDE.lane, Math.max(0, (trip.len - s) * 0.2), s * 0.2 + 0.4)
  return { x: a.x - hz * off, z: a.z + hx * off, yaw: Math.atan2(hx, hz) }
}

// how sharp the road is ahead (rad over the next ~20 m)
const bendAhead = (trip) => {
  const a = pointAt(trip.pts, trip.cum, trip.s)
  const b = pointAt(trip.pts, trip.cum, Math.min(trip.len, trip.s + 10))
  const c = pointAt(trip.pts, trip.cum, Math.min(trip.len, trip.s + 22))
  const h1 = Math.atan2(b.x - a.x, b.z - a.z)
  const h2 = Math.atan2(c.x - b.x, c.z - b.z)
  return Math.abs(Math.atan2(Math.sin(h2 - h1), Math.cos(h2 - h1)))
}

// one step: blocked(x, z, yaw) -> metres to someone in front (Infinity if clear)
export const stepTrip = (trip, dt, { blocked = null, top = RIDE.cruise } = {}) => {
  if (trip.done) return trip
  const left = trip.len - trip.s
  let want = top
  // (a bend: the speed that keeps the sideways pull comfortable)
  const bend = bendAhead(trip)
  if (bend > 0.05) want = Math.min(want, Math.sqrt((RIDE.latAcc * 12) / bend))
  // (the end: easing to a stop)
  want = Math.min(want, Math.sqrt(2 * RIDE.decel * 0.8 * Math.max(0, left - 0.5)))
  if (blocked) {
    const p = tripPoseAt(trip)
    const d = blocked(p.x, p.z, p.yaw)
    if (d < Infinity) want = Math.min(want, Math.sqrt(2 * RIDE.decel * Math.max(0, d - 6)))
  }
  const dv = want - trip.speed
  trip.speed += Math.max(-RIDE.decel * 1.6 * dt, Math.min(RIDE.accel * dt, dv))
  trip.speed = Math.max(0, trip.speed)
  trip.s = Math.min(trip.len, trip.s + trip.speed * dt)
  if (trip.len - trip.s < 0.6 && trip.speed < 0.3) {
    trip.done = true
    trip.speed = 0
  }
  return trip
}

// skip ahead (fast travel, once you're in): to just short of the end
export const skipTrip = (trip, short = 25) => {
  trip.s = Math.max(trip.s, trip.len - short)
  trip.speed = Math.min(trip.speed, 8)
  return trip
}

// the minutes to go, as the phone says it
export const etaText = (seconds) => (seconds < 60 ? "under a minute" : `${Math.round(seconds / 60)} min`)
// a trip's time left (s), at a city pace
export const tripTimeLeft = (trip) => (trip.len - trip.s) / RIDE.city
