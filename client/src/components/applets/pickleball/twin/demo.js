// Twin Replay's demo game: the synthetic fence-cam rally (synthetic.js) read by the real
// pipeline, so "Try the demo" shows exactly what a filmed game turns into.

import { createAnalyzer } from "./core/analyze.js"
import { makeCamera, scriptRally, filmRally, soundtrack, cornerTaps } from "./synthetic.js"

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
  return { id: "demo", title: "Demo rally", created: Date.now(), duration: analysis.duration, venue: "loscab", court: null, analysis, demo: true }
}
