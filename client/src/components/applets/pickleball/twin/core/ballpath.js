// Twin Replay: the ball's flight, rebuilt. Following a pickleball in phone video is hard (a
// small, fast, often blurred ball), so v1 builds a believable path from what we do know: who
// hit it, when, from where, and how high. Between two hits the ball flies on a ballistic arc
// (gravity, no drag) that clears the net; if the next player let it bounce, it lands on their
// side first (a second arc from the bounce to their paddle), with the bounce placed where the
// arc's timing and the net allow, close to where that kind of shot usually lands.

import { HALF_L, HALF_W, KITCHEN } from "./homography.js"
import { flightAt } from "../ball/flight.js"

const G = 9.81
const NET_Y = 0.89 // m (0.914 at the posts, 0.864 in the middle)
const CLEAR = 0.04

// where the paddle met the ball: in front of the hitter (toward the net) and out to the side
export const contactPoint = (h, hand = 1) => {
  const toNet = h.team === 0 ? -1 : 1 // team 0 plays the +z half and faces -z
  const right = h.team === 0 ? 1 : -1 // the player's right in court x
  const side = (h.side === "bh" ? -1 : 1) * (hand >= 0 ? 1 : -1)
  const y = h.kind === "serve" ? 0.62 : Math.max(0.12, Math.min(2.7, h.height + 0.08))
  return { x: h.x + right * side * 0.38, y, z: h.z + toNet * 0.45 }
}

// a ballistic arc from P0 (at time 0) to P1 (at time T): p(tau), v0
export const arc = (P0, P1, T) => {
  const v = { x: (P1.x - P0.x) / T, y: (P1.y - P0.y) / T + 0.5 * G * T, z: (P1.z - P0.z) / T }
  return {
    v,
    at: (tau) => ({ x: P0.x + v.x * tau, y: P0.y + v.y * tau - 0.5 * G * tau * tau, z: P0.z + v.z * tau }),
    apex: P0.y + Math.max(0, (v.y * v.y) / (2 * G)),
  }
}
// height where an arc crosses z = 0 (null if it doesn't)
const netCrossing = (P0, P1, T) => {
  if (Math.sign(P0.z) === Math.sign(P1.z) || P0.z === P1.z) return null
  const tau = (-P0.z / (P1.z - P0.z)) * T
  return arc(P0, P1, T).at(tau).y
}

const PREFER = { serve: 0.82, return: 0.8, drive: 0.78, drop: 0.7, dink: 0.62, volley: 0.75, overhead: 0.8, lob: 0.8 }

// segments for one rally. hits: the rally's hits (buildRallies, with x, z, height, kind, side,
// bounced, team, t). handOf(player) -> 1 | -1. Returns { segments: [{ t0, t1, P0, P1, bounceAfter }], bounces: [{ t, x, z }] }
export const rallyPath = (hits, handOf = () => 1) => {
  const segments = []
  const bounces = []
  const C = hits.map((h) => contactPoint(h, handOf(h.player)))
  for (let i = 0; i < hits.length; i++) {
    const A = hits[i]
    const PA = C[i]
    const B = hits[i + 1]
    if (!B) {
      // the rally's last shot: it lands deep on the other side a moment later and the point ends
      const dir = A.team === 0 ? -1 : 1
      const land = { x: Math.max(-HALF_W, Math.min(HALF_W, PA.x * 0.6)), y: 0.04, z: dir * HALF_L * 0.62 }
      const T = Math.max(0.6, Math.min(1.4, Math.abs(land.z - PA.z) / 13))
      segments.push({ t0: A.t, t1: A.t + T, P0: PA, P1: land, last: true })
      bounces.push({ t: A.t + T, x: land.x, z: land.z })
      continue
    }
    const PB = C[i + 1]
    const T = Math.max(0.12, B.t - A.t)
    if (!B.bounced) {
      segments.push({ t0: A.t, t1: B.t, P0: PA, P1: PB })
      continue
    }
    // find the bounce: fraction f of the flight time (and of the ground path) on B's side,
    // past the kitchen for a serve, clearing the net, as close to the usual f as possible
    const want = PREFER[A.kind] ?? 0.75
    let best = null
    for (let f = 0.42; f <= 0.95; f += 0.01) {
      const bx = PA.x + (PB.x - PA.x) * f
      const bz = PA.z + (PB.z - PA.z) * f
      const onSide = B.team === 0 ? bz > 0.3 : bz < -0.3
      if (!onSide) continue
      if (A.kind === "serve" && Math.abs(bz) < KITCHEN + 0.2) continue
      const P1 = { x: bx, y: 0.037, z: bz }
      const t1 = T * f
      const h = netCrossing(PA, P1, t1)
      const clears = h === null || h >= NET_Y + CLEAR
      // the second arc (bounce -> paddle) must go up out of the bounce
      const up = arc(P1, PB, T - t1).v.y > 0
      const score = Math.abs(f - want) + (clears ? 0 : 5 + (NET_Y + CLEAR - h)) + (up ? 0 : 2)
      if (!best || score < best.score) best = { score, f, P1, t1 }
    }
    if (!best) {
      segments.push({ t0: A.t, t1: B.t, P0: PA, P1: PB })
      continue
    }
    segments.push({ t0: A.t, t1: A.t + best.t1, P0: PA, P1: best.P1 })
    segments.push({ t0: A.t + best.t1, t1: B.t, P0: best.P1, P1: PB })
    bounces.push({ t: A.t + best.t1, x: best.P1.x, z: best.P1.z })
  }
  return { segments, bounces, contacts: C }
}

// the ball at time t from a rally's segments (null outside them)
export const ballAt = (segments, t) => {
  for (const s of segments) {
    if (t < s.t0 || t > s.t1) continue
    // (Real Ball: a measured flight, sampled from the game's ball physics)
    if (s.flight) return flightAt(s, t)
    return arc(s.P0, s.P1, Math.max(1e-3, s.t1 - s.t0)).at(t - s.t0)
  }
  return null
}

// net clearance check for tests: every segment that crosses the net clears it
export const clearsNet = (segments) => segments.filter((s) => !s.flight).every((s) => {
  const h = netCrossing(s.P0, s.P1, Math.max(1e-3, s.t1 - s.t0))
  return h === null || h >= NET_Y
})
