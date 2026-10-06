// Twin Replay: the numbers. Per player: where they stood (a heatmap of their half), time at
// the kitchen line, distance covered, their shot mix, third-shot choices, how often they hit
// a rally's last shot; per game: rally lengths, the longest and fastest rallies (highlights).

import { HALF_L, HALF_W, KITCHEN } from "./homography.js"
import { KINDS } from "./hits.js"

export const HEAT_W = 6 // cells across a half court
export const HEAT_L = 7 // cells net -> baseline (+ 1 behind the baseline)

// tracks: [{ id, team, samples: [{ t, x, z }] }]; rallies: buildRallies output
export const computeStats = (tracks, rallies) => {
  const inRally = (t) => rallies.some((r) => t >= r.start - 0.8 && t <= r.end + 1.2)
  const players = tracks.map((tr) => {
    const heat = new Array(HEAT_W * (HEAT_L + 1)).fill(0)
    let kitchenT = 0
    let rallyT = 0
    let dist = 0
    let prev = null
    for (const s of tr.samples) {
      if (prev) {
        const dt = s.t - prev.t
        if (dt > 0 && dt < 0.5 && inRally(s.t)) {
          rallyT += dt
          const depth = Math.abs(s.z)
          // at the kitchen line: from just inside it to a step behind it
          if (depth > KITCHEN - 0.45 && depth < KITCHEN + 0.9) kitchenT += dt
          const step = Math.hypot(s.x - prev.x, s.z - prev.z)
          if (step < 4 * dt + 0.05) dist += step // (a tracking jump isn't running)
          const cx = Math.max(0, Math.min(HEAT_W - 1, Math.floor(((s.x + HALF_W) / (2 * HALF_W)) * HEAT_W)))
          const cz = Math.max(0, Math.min(HEAT_L, Math.floor((depth / HALF_L) * HEAT_L)))
          heat[cz * HEAT_W + cx] += dt
        }
      }
      prev = s
    }
    const max = Math.max(1e-6, ...heat)
    const mix = Object.fromEntries(KINDS.map((k) => [k, 0]))
    const third = {}
    let shots = 0
    let ending = 0
    let serveDepth = []
    for (const r of rallies) {
      r.hits.forEach((h, i) => {
        if (h.player === tr.id) {
          shots++
          mix[h.kind] = (mix[h.kind] || 0) + 1
          if (i === 2) third[h.kind] = (third[h.kind] || 0) + 1
          if (i === r.hits.length - 1) ending++
        }
        // the returner's contact depth tells how deep this player's serve went
        if (i === 1 && r.hits[0].player === tr.id) serveDepth.push(Math.abs(h.z) - (HALF_L - 0.0))
      })
    }
    return {
      id: tr.id,
      team: tr.team,
      heat: heat.map((v) => v / max),
      kitchenPct: rallyT > 0 ? kitchenT / rallyT : 0,
      distance: dist,
      rallyTime: rallyT,
      shots,
      mix,
      third,
      rallyEnding: ending,
      // meters from the baseline the return was hit (negative = behind it: a deep serve)
      serveDepth: serveDepth.length ? serveDepth.reduce((a, b) => a + b, 0) / serveDepth.length : null,
    }
  })
  const lengths = rallies.map((r) => r.hits.length)
  const histogram = {}
  for (const n of lengths) {
    const k = n >= 12 ? "12+" : String(n)
    histogram[k] = (histogram[k] || 0) + 1
  }
  return { players, rallies: rallies.length, shots: lengths.reduce((a, b) => a + b, 0), histogram, longest: Math.max(0, ...lengths), highlights: pickHighlights(rallies) }
}

// the best rallies: the longest, then the fastest exchanges (shortest average time between
// hits over 5+ hits); up to n, each with a reason
export const pickHighlights = (rallies, n = 5) => {
  const scored = rallies
    .filter((r) => r.hits.length >= 3)
    .map((r) => {
      const gaps = r.hits.slice(1).map((h, i) => h.t - r.hits[i].t)
      const pace = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 9
      const fastRun = r.hits.length >= 5 ? 1 / pace : 0
      return { id: r.id, start: r.start, end: r.end, hits: r.hits.length, pace, score: r.hits.length + fastRun * 6 }
    })
    .sort((a, b) => b.score - a.score)
  return scored.slice(0, n).map((h, i) => ({ ...h, reason: i === 0 ? "Longest rally" : h.pace < 0.75 && h.hits >= 5 ? "Fast hands" : `${h.hits}-shot rally` }))
}
