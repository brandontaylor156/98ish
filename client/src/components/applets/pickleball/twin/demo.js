// Twin Replay's demo game: the synthetic fence-cam rally (synthetic.js) read by the real
// pipeline, so "Try the demo" shows exactly what a filmed game turns into.

import { createAnalyzer } from "./core/analyze.js"
import { makeCamera, scriptRally, filmRally, soundtrack, cornerTaps } from "./synthetic.js"

export const demoGame = () => {
  const cam = makeCamera()
  const script = scriptRally()
  const an = createAnalyzer({ taps: cornerTaps(cam), players: 4 })
  for (const f of filmRally(script, cam)) an.push(f.t, f.people)
  const analysis = an.finish({ audio: soundtrack(script, { bounces: [2.3, 3.9, 6.6] }), names: { 0: "You", 1: "Partner", 2: "Opponent 1", 3: "Opponent 2" } })
  return { id: "demo", title: "Demo rally", created: Date.now(), duration: analysis.duration, venue: "loscab", court: null, analysis, demo: true }
}
