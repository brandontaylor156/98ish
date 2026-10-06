// Real Ball: from the ball spots the reader found (detect.js) and the rallies Twin Replay
// built (hits, players) to measured flights, bounces, line calls and shot speeds. Pure.
//
// Each flight runs from one hit to the next. What we already know anchors it: the hit's time
// (the paddle pop), where the hitter and the next hitter were (their tracks), and ballpath.js's
// rebuilt arc as a first guess. The fit (flight.js) then lets the camera's view decide.

import { HALF_L } from "../../physics.js"
import { calibrate } from "../core/homography.js"
import { arc, contactPoint, rallyPath } from "../core/ballpath.js"
import { bounceSigma, callBounce, cameraFromHomography, fitFlight } from "./flight.js"
export { flightAt } from "./flight.js"

export const BALL_VERSION = 1
// a flight this sure replaces the rebuilt one in the replay and counts in the stats
export const TRUST = 0.45

// spots: [{ t, cands: [{ u, v, score }] }] (one entry per frame read). analysis: Twin
// Replay's analysis (players, rallies, calibration.taps). W, H: the size the taps and spots
// are in. Returns { v, flights: [[flight per hit]], frames, found } (compact, storable).
export const analyzeBall = (spots, analysis, { W, H, tail = 1.6 } = {}) => {
  const cal = calibrate((analysis.calibration?.taps || []).map((t) => ({ id: t.id, x: t.x, y: t.y })))
  if (!cal.ok) return null
  const cam = cameraFromHomography(cal.H, W, H)
  if (!cam) return null
  const obs = []
  for (const s of spots) for (const c of s.cands || []) obs.push({ t: s.t, u: c.u, v: c.v, score: c.score })
  const hand = new Map((analysis.players || []).map((p) => [p.id, p.hand]))
  const handOf = (id) => hand.get(id) ?? 1
  const flights = (analysis.rallies || []).map((r) => {
    const path = rallyPath(r.hits, handOf)
    return r.hits.map((h, i) => {
      const next = r.hits[i + 1]
      const t0 = h.t
      const t1 = next ? next.t : h.t + tail
      const P0 = path.contacts[i]
      const P1 = next ? path.contacts[i + 1] : null
      // the rebuilt arc's first part gives the starting velocity
      const seg = path.segments.find((s) => Math.abs(s.t0 - t0) < 1e-6)
      const V0 = seg ? arc(seg.P0, seg.P1, Math.max(0.05, seg.t1 - seg.t0)).v : { x: 0, y: 2, z: h.team === 0 ? -10 : 10 }
      const fit = fitFlight(obs, { t0, t1, cam, prior: { P0, V0, P1 }, seed: Math.round(t0 * 1000) })
      if (!fit) return null
      const b = fit.bounces.find((x) => x.t < t1 - 0.02) || null
      let call = null
      if (b) {
        const toTeam = b.z > 0 ? 0 : 1
        // (a bounce on the hitter's own side is the ball not clearing: no line call)
        if (toTeam !== h.team) call = callBounce({ x: b.x, z: b.z, sigma: bounceSigma(fit, cam) }, { kind: i === 0 ? "serve" : "rally", toTeam, serverX: h.x })
      }
      return {
        t0: round(t0, 3),
        t1: round(t1, 3),
        P0: rnd3(fit.P0),
        V0: rnd3(fit.V0),
        conf: round(fit.conf, 2),
        rms: round(fit.rms, 1),
        n: fit.inliers,
        speed: round(fit.speed, 1),
        bounce: b ? { t: round(b.t, 3), x: round(b.x, 3), z: round(b.z, 3) } : null,
        call: call ? { verdict: call.verdict, margin: round(call.margin, 3), line: call.line, close: call.close, sigma: round(call.sigma, 3) } : null,
        last: !next,
      }
    })
  })
  return { v: BALL_VERSION, flights, frames: spots.length, found: spots.filter((s) => s.cands?.length).length, f: round(cam.f, 1) }
}

// the hits get what the ball says about them (Coach and the stats read these):
// h.ball = { conf, speed (m/s), bounce: { x, z } | null, call | null }
export const annotateHits = (analysis) => {
  const fl = analysis.ball?.flights
  if (!fl) return analysis
  return {
    ...analysis,
    rallies: analysis.rallies.map((r, ri) => ({
      ...r,
      hits: r.hits.map((h, i) => {
        const f = fl[ri]?.[i]
        if (!f || f.conf < TRUST) return h
        return { ...h, ball: { conf: f.conf, speed: f.speed, bounce: f.bounce, call: f.call } }
      }),
      verdict: rallyVerdict(r, fl[ri]),
    })),
  }
}

// who won the rally, by the last shot: in and not returned -> the hitter's team; out (or into
// the net) -> the other team. null when the ball didn't say clearly.
export const rallyVerdict = (rally, flights) => {
  const last = rally.hits.length - 1
  const f = flights?.[last]
  if (!f || f.conf < TRUST) return null
  const hitter = rally.hits[last].team
  if (!f.bounce) return null
  const side = f.bounce.z > 0 ? 0 : 1
  if (side === hitter) return { winner: 1 - hitter, why: "net" }
  if (!f.call || f.call.close) return { winner: f.call ? null : hitter, why: f.call?.close ? "close" : "in" }
  return f.call.verdict === "in" ? { winner: hitter, why: "in", margin: f.call.margin } : { winner: 1 - hitter, why: "out", margin: f.call.margin, line: f.call.line }
}

// The replay's segments: the measured flight where it's trusted (a flight segment the replay
// samples from the physics), the rebuilt arcs elsewhere.
export const measuredPath = (rally, flights, rebuilt) => {
  if (!flights) return rebuilt
  const segments = []
  const bounces = []
  rally.hits.forEach((h, i) => {
    const f = flights[i]
    const t0 = h.t
    const t1 = rally.hits[i + 1]?.t ?? (rebuilt.segments.find((s) => s.last)?.t1 ?? h.t + 1.2)
    if (f && f.conf >= TRUST) {
      segments.push({ t0, t1, flight: { P0: f.P0, V0: f.V0 }, measured: true })
      if (f.bounce) bounces.push({ t: f.bounce.t, x: f.bounce.x, z: f.bounce.z, call: f.call, measured: true })
    } else {
      for (const s of rebuilt.segments) if (s.t0 >= t0 - 1e-6 && s.t0 < t1 - 1e-6) segments.push(s)
      for (const b of rebuilt.bounces) if (b.t >= t0 && b.t < t1) bounces.push(b)
    }
  })
  return { ...rebuilt, segments, bounces, measured: true }
}

// summary numbers for the stats panel: per player fastest / typical shot speed, every bounce
// (the bounce map), and calls
export const ballStats = (analysis) => {
  const fl = analysis.ball?.flights
  if (!fl) return null
  const per = new Map()
  const bounces = []
  let outs = 0
  let ins = 0
  analysis.rallies.forEach((r, ri) =>
    r.hits.forEach((h, i) => {
      const f = fl[ri]?.[i]
      if (!f || f.conf < TRUST) return
      const p = per.get(h.player) || { speeds: [] }
      p.speeds.push(f.speed)
      per.set(h.player, p)
      if (f.bounce) bounces.push({ x: f.bounce.x, z: f.bounce.z, team: h.team, kind: h.kind, call: f.call?.verdict || null })
      if (f.call && !f.call.close) f.call.verdict === "in" ? ins++ : outs++
    })
  )
  const players = [...per.entries()].map(([id, p]) => {
    const s = [...p.speeds].sort((a, b) => a - b)
    return { id, fastest: s.at(-1), typical: s[Math.floor(s.length / 2)], shots: s.length }
  })
  const flightsTotal = fl.reduce((n, r) => n + r.filter(Boolean).length, 0)
  const trusted = fl.reduce((n, r) => n + r.filter((f) => f && f.conf >= TRUST).length, 0)
  return { players, bounces, ins, outs, trusted, flights: flightsTotal, halfL: HALF_L }
}

const round = (v, d) => {
  const k = 10 ** d
  return Math.round(v * k) / k
}
const rnd3 = (p) => ({ x: round(p.x, 3), y: round(p.y, 3), z: round(p.z, 3) })

export { contactPoint }
