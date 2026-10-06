// Twin Replay's demo game: the synthetic fence-cam rally (synthetic.js) read by the real
// pipeline, so "Try the demo" shows exactly what a filmed game turns into.

import { createAnalyzer } from "./core/analyze.js"
import { arc, rallyPath } from "./core/ballpath.js"
import { makeCamera, scriptRally, filmRally, soundtrack, cornerTaps } from "./synthetic.js"
import { analyzeBall } from "./ball/realball.js"
import { aimFlight, flightAt, mulberry32 } from "./ball/flight.js"

export const demoGame = () => {
  const cam = makeCamera()
  const script = scriptRally()
  const an = createAnalyzer({ taps: cornerTaps(cam), players: 4 })
  for (const f of filmRally(script, cam)) an.push(f.t, f.people)
  const analysis = an.finish({ audio: soundtrack(script, { bounces: [2.3, 3.9, 6.6] }) })
  // (names by side: the near team is "you")
  const near = ["You", "Partner"]
  const far = ["Opponent 1", "Opponent 2"]
  for (const p of analysis.players) p.name = (p.team === 0 ? near : far).shift() || p.name
  // Real Ball: what the camera would have seen of the ball (the scripted flights, a little
  // pixel noise, a stray spot per picture), through the same fit a filmed game gets
  try {
    // the ball on real physics (drag, the court's bounce) from each contact to the next
    const hand = new Map(analysis.players.map((p) => [p.id, p.hand]))
    const flights = []
    for (const r of analysis.rallies) {
      const path = rallyPath(r.hits, (id) => hand.get(id) ?? 1)
      r.hits.forEach((h, i) => {
        const seg = path.segments.find((s) => Math.abs(s.t0 - h.t) < 1e-6)
        if (!seg) return
        const next = r.hits[i + 1]
        const P0 = path.contacts[i]
        const T = next ? next.t - h.t : seg.t1 - seg.t0
        // a shot that bounces is aimed at its bounce (physics carries it on to the paddle);
        // a volleyed one straight at the next contact
        const bounced = next ? path.segments.some((s) => s !== seg && Math.abs(s.t0 - seg.t1) < 1e-6 && s.t1 <= next.t + 1e-6) : true
        const aimAt = bounced ? seg.P1 : path.contacts[i + 1]
        const aimT = bounced ? seg.t1 - seg.t0 : T
        const { V0 } = aimFlight(P0, aimAt, Math.max(0.05, aimT), arc(seg.P0, seg.P1, Math.max(0.05, seg.t1 - seg.t0)).v)
        flights.push({ t0: h.t, t1: h.t + T, flight: { P0, V0 } })
      })
    }
    const ballOn = (t) => {
      const s = flights.find((f) => t >= f.t0 && t <= f.t1)
      return s ? flightAt(s, t) : null
    }
    const rnd = mulberry32(3)
    const spots = []
    const r0 = analysis.rallies[0]
    const rN = analysis.rallies.at(-1)
    if (r0) {
      for (let t = r0.start; t <= rN.end + 1.2; t += 1 / 15) {
        const b = ballOn(t)
        const p = b ? cam.project(b) : null
        const cands = []
        if (p && rnd() > 0.12) cands.push({ u: p.x + (rnd() - 0.5) * 2, v: p.y + (rnd() - 0.5) * 2, score: 60 })
        cands.push({ u: rnd() * cam.width, v: cam.height * (0.4 + rnd() * 0.55), score: 30 })
        spots.push({ t, cands })
      }
      const ball = analyzeBall(spots, analysis, { W: cam.width, H: cam.height })
      if (ball) analysis.ball = { ...ball, W: cam.width, H: cam.height, demo: true }
    }
  } catch {
    // (the demo works without it)
  }
  return { id: "demo", title: "Demo rally", created: Date.now(), duration: analysis.duration, venue: "loscab", court: null, analysis, demo: true }
}
