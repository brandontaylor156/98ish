// Coach: what your filmed games say about your game. Pure (no DOM): the app and the tests use
// the same code.
//
// From Twin Replay analyses (player tracks on the court + hits with kinds + the paddle-hand
// height at the other side's hits) this measures a player's habits and compares each with
// reference bands for the four levels the game's computer players play at (Rookie, Club,
// Pro, Legend). Bands come from ai.js where the game has a matching number (speed, reaction,
// third-shot drop, reset) and from common coaching norms elsewhere (kitchen arrival, split
// step, paddle up, spacing); each is a threshold "at this level you do at least/at most".
//
// diagnose(games, me, opts) -> { metrics: [metric], level: { pos, low, high, label } }
//   games: [{ key, analysis }], me: { [gameKey]: playerId }
//   metric: { id, label, unit, value, n, conf, band (for the target level), pos (0..3 on the
//     level scale), verdict ("good" | "close" | "work" | "unknown"), gap, explain, detail,
//     moments: [{ game, t, note, ghost }] (worst first) }

import { HALF_L, HALF_W, KITCHEN } from "../core/homography.js"
import { PADDLE_UP } from "./pose.js"

export const LEVEL_IDS = ["beginner", "intermediate", "pro", "legend"]
export const LEVEL_LABEL = { beginner: "Rookie", intermediate: "Club", pro: "Pro", legend: "Legend" }

const AT_LINE = KITCHEN + 0.6 // "at the kitchen line" (m from the net)
const NEAR_NET = 3.6 // close enough that the paddle should be up
const HALF_LANE = HALF_W / 2

const depth = (z) => Math.abs(z)
const median = (a) => {
  if (!a.length) return null
  const s = [...a].sort((x, y) => x - y)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null)
const round = (v, d = 2) => (v === null || v === undefined ? null : Math.round(v * 10 ** d) / 10 ** d)

export const sampleAt = (samples, t) => {
  if (!samples?.length) return null
  if (t <= samples[0].t) return samples[0]
  const last = samples[samples.length - 1]
  if (t >= last.t) return last
  let lo = 0
  let hi = samples.length - 1
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1
    if (samples[m].t <= t) lo = m
    else hi = m
  }
  const a = samples[lo]
  const b = samples[hi]
  const u = (t - a.t) / Math.max(1e-6, b.t - a.t)
  return { t, x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u }
}
export const speedAt = (samples, t, h = 0.1) => {
  const a = sampleAt(samples, t - h)
  const b = sampleAt(samples, t + h)
  return a && b ? Math.hypot(b.x - a.x, b.z - a.z) / (2 * h) : 0
}

// ---------- the metrics ----------
// Each: id, label, unit, better ("high" | "low"), bands {level: threshold}, K (observations
// for ~63% confidence), minN, explain (what it is), and observe(ctx) -> [{ v, t, note, ghost? }]
// (v: a number, or true/false for shares). value() turns the observations into one number.

const share = (obs) => (obs.length ? obs.filter((o) => o.v).length / obs.length : null)

export const METRICS = [
  {
    id: "kitchen",
    label: "Getting to the kitchen line",
    unit: "s",
    better: "low",
    bands: { beginner: 4.5, intermediate: 3.3, pro: 2.5, legend: 2.0 },
    K: 5,
    minN: 3,
    value: (obs) => median(obs.map((o) => o.v)),
    explain: "Seconds from your return (or your team's third shot) until you're at the kitchen line. Most points are won from the line, so the sooner you're there, the better.",
    observe({ P, rallies, team }) {
      const out = []
      for (const r of rallies) {
        const h = r.hits
        let t0 = null
        let why = ""
        if (h[1] && h[1].player === P.id) (t0 = h[1].t), (why = "after your return")
        else if (h[0]?.team === team && h[2]?.team === team) (t0 = h[2].t), (why = "after your team's third shot")
        if (t0 === null) continue
        if (r.end - t0 < 1.4) continue // (the point ended too soon to tell)
        if (depth(sampleAt(P.samples, t0)?.z ?? 99) <= AT_LINE) continue // already there
        let arrive = null
        for (const s of P.samples) {
          if (s.t < t0) continue
          if (s.t > r.end + 0.5) break
          if (depth(s.z) <= AT_LINE) {
            arrive = s.t - t0
            break
          }
        }
        const v = arrive ?? r.end - t0 + 1
        out.push({ v: round(v), t: t0, note: arrive === null ? `Never got to the line ${why}` : `${round(arrive, 1)} s to the line ${why}`, ghost: "kitchen" })
      }
      return out.sort((a, b) => b.v - a.v)
    },
  },
  {
    id: "split",
    label: "Split step on time",
    unit: "share",
    better: "high",
    bands: { beginner: 0.3, intermediate: 0.5, pro: 0.68, legend: 0.8 },
    K: 10,
    minN: 5,
    value: share,
    explain: "How often you're balanced and still (a split step) right as the other side hits, so you can move either way. Moving through their contact is the most common reason a ball gets past you.",
    observe({ P, rallies, team }) {
      const out = []
      for (const r of rallies) {
        r.hits.forEach((hit, i) => {
          if (i < 2 || hit.team === team) return
          const th = hit.t
          // were they moving beforehand? (already set = on time)
          let vmax = 0
          for (let t = th - 0.6; t <= th - 0.15; t += 0.05) vmax = Math.max(vmax, speedAt(P.samples, t))
          // the still moment: where the speed is near its lowest around their contact; when it
          // starts is when they stopped (less the speed window's half-width, 0.1 s)
          // (a stop lasts; a change of direction mid-move only dips for an instant: the longest
          // stretch near the lowest speed is the stop)
          const ts = []
          for (let t = th - 0.35; t <= th + 0.6 + 1e-9; t += 0.025) ts.push([t, speedAt(P.samples, t)])
          const vmin = Math.min(...ts.map((x) => x[1]))
          const runs = []
          for (const [t, v] of ts) {
            const low = v <= vmin + 0.15
            if (low && runs.length && runs.at(-1).open) runs.at(-1).end = t
            else if (low) runs.push({ start: t, end: t, open: true })
            else if (runs.length) runs.at(-1).open = false
          }
          runs.sort((a, b) => b.end - b.start - (a.end - a.start) || Math.abs(a.start - th) - Math.abs(b.start - th))
          const tStill = runs[0].start
          const offset = round(Math.max(-0.35, tStill - 0.1) - th, 2)
          if (vmax < 0.9) return out.push({ v: true, t: th, offset: 0, note: "Already set as they hit" })
          const ok = vmin < 0.9 && offset >= -0.25 && offset <= 0.12
          const vAt = speedAt(P.samples, th)
          out.push({ v: ok, t: th, offset, note: ok ? "Split step on time" : offset > 0.12 || vAt > 1.2 ? `Still moving as they hit (stopped ${offset > 0 ? `${offset} s late` : "too late"})` : "Stopped too early, then drifted", ghost: "split" })
        })
      }
      return out.sort((a, b) => Number(a.v) - Number(b.v) || Math.abs(b.offset) - Math.abs(a.offset))
    },
    detail: (obs) => {
      const late = obs.filter((o) => !o.v && o.offset > 0.12).length
      const early = obs.filter((o) => !o.v && o.offset < -0.25).length
      return late > early ? `Mostly late: ${late} of ${obs.length} times still moving at their contact.` : early ? `${early} times you stopped too early.` : ""
    },
  },
  {
    id: "ready",
    label: "Paddle up at the line",
    unit: "share",
    better: "high",
    bands: { beginner: 0.3, intermediate: 0.5, pro: 0.7, legend: 0.85 },
    K: 10,
    minN: 5,
    value: share,
    explain: "Near the net, how often your paddle hand is up in front (chest height) as they hit. A low paddle is late on fast balls at the kitchen.",
    observe({ P, team }) {
      const out = []
      for (const r of P.ready || []) {
        const at = sampleAt(P.samples, r.t)
        if (!at || depth(at.z) > NEAR_NET) continue
        out.push({ v: r.h >= PADDLE_UP, t: r.t, note: r.h >= PADDLE_UP ? "Paddle up" : "Paddle down by your waist" })
      }
      return out.sort((a, b) => Number(a.v) - Number(b.v))
    },
    missing: "Film a new game to measure this (older readings didn't keep the paddle height).",
  },
  {
    id: "recovery",
    label: "Recovering to your spot",
    unit: "m",
    better: "low",
    bands: { beginner: 1.5, intermediate: 1.0, pro: 0.7, legend: 0.5 },
    K: 8,
    minN: 4,
    value: (obs) => median(obs.map((o) => o.v)),
    explain: "How far you are from the middle of your side (doubles: your half) when they hit the next ball after yours. Getting back to your spot covers the most court.",
    observe({ P, rallies, team, mate }) {
      const out = []
      for (const r of rallies) {
        r.hits.forEach((hit, i) => {
          if (hit.player !== P.id || i === r.hits.length - 1) return
          const next = r.hits.slice(i + 1).find((h) => h.team !== team)
          if (!next) return
          const me = sampleAt(P.samples, next.t)
          if (!me) return
          let home = 0
          if (mate) {
            const m = sampleAt(mate.samples, next.t)
            home = m && m.x > me.x ? -HALF_LANE : HALF_LANE
          }
          const off = round(Math.abs(me.x - home))
          out.push({ v: off, t: next.t, home, note: off > 1 ? `${off} m off your spot as they hit` : "Back in position", ghost: "recover" })
        })
      }
      return out.sort((a, b) => b.v - a.v)
    },
  },
  {
    id: "coverage",
    label: "Speed around the court",
    unit: "m/s",
    better: "high",
    bands: { beginner: 2.6, intermediate: 3.2, pro: 3.8, legend: 4.1 },
    K: 6,
    minN: 3,
    value: (obs) => mean(obs.map((o) => o.v)),
    explain: "Your fastest moments in each rally (the 90th percentile of your speed). Quick first steps make the hard balls reachable.",
    observe({ P, rallies }) {
      const out = []
      for (const r of rallies) {
        const v = []
        for (let t = r.start; t <= r.end; t += 0.1) v.push(speedAt(P.samples, t, 0.15))
        if (v.length < 8) continue
        v.sort((a, b) => a - b)
        out.push({ v: round(v[Math.floor(v.length * 0.9)]), t: r.start + 0.5, note: "" })
      }
      return out
    },
  },
  {
    id: "third",
    label: "Third shots that work",
    unit: "share",
    better: "high",
    bands: { beginner: 0.3, intermediate: 0.45, pro: 0.6, legend: 0.7 },
    K: 6,
    minN: 3,
    value: share,
    explain: "Your third shots that let your team come in: a drop that lands in their kitchen (they let it bounce), or a deep drive they can't volley at the net.",
    observe({ P, rallies }) {
      const out = []
      for (const r of rallies) {
        const h = r.hits
        if (h[2]?.player !== P.id) continue
        const next = h[3]
        let ok
        let note
        // Real Ball: the third shot's measured bounce, when the ball was followed
        const b = h[2].ball
        if (b?.call && !b.call.close && b.call.verdict === "out") (ok = false), (note = `Third shot out by ${Math.max(1, Math.round(Math.abs(b.call.margin) * 100))} cm (measured)`)
        else if (b?.bounce && (h[2].kind === "drop" || h[2].kind === "dink")) {
          const into = KITCHEN - depth(b.bounce.z)
          ok = into >= 0
          note = ok ? `Drop landed ${into.toFixed(1)} m inside their kitchen (measured)` : `Drop landed ${(-into).toFixed(1)} m short of their kitchen (measured)`
        } else if (b?.bounce) {
          const deep = depth(b.bounce.z)
          ok = deep > 4.2 || !!next?.bounced
          note = `Drive landed ${deep.toFixed(1)} m from the net (measured)`
        } else if (!next) (ok = false), (note = "Third shot ended the point (into the net or out?)")
        else if (h[2].kind === "drop" || h[2].kind === "dink") {
          ok = next.bounced && depth(next.z) < KITCHEN + 0.9
          note = ok ? "Drop landed in their kitchen" : next.bounced ? "Drop landed short of the kitchen: they could attack it" : "Drop was high: they volleyed it at the net"
        } else {
          ok = next.bounced || depth(next.z) > 4.2
          note = ok ? "Deep drive: they had to let it bounce" : "Drive volleyed back at the net"
        }
        out.push({ v: ok, t: h[2].t, kind: h[2].kind, note, ghost: "kitchen" })
      }
      return out.sort((a, b) => Number(a.v) - Number(b.v))
    },
    detail: (obs) => {
      const drops = obs.filter((o) => o.kind === "drop" || o.kind === "dink").length
      return obs.length ? `${drops} of ${obs.length} were drops.` : ""
    },
  },
  {
    id: "dink",
    label: "Dinks kept in play",
    unit: "share",
    better: "high",
    bands: { beginner: 0.7, intermediate: 0.82, pro: 0.9, legend: 0.95 },
    K: 12,
    minN: 6,
    value: share,
    explain: "Your dinks that didn't end the point. Patience at the kitchen wins more points than winners do.",
    observe({ P, rallies }) {
      const out = []
      for (const r of rallies) {
        r.hits.forEach((hit, i) => {
          if (hit.player !== P.id || hit.kind !== "dink") return
          const last = i === r.hits.length - 1
          const next = r.hits[i + 1]
          const cross = next ? Math.sign(next.x || 0) === -Math.sign(hit.x || 0) && Math.abs(next.x - hit.x) > 1 : null
          out.push({ v: !last, t: hit.t, cross, note: last ? "Dink ended the point (net or out?)" : "" })
        })
      }
      return out.sort((a, b) => Number(a.v) - Number(b.v))
    },
    detail: (obs) => {
      const known = obs.filter((o) => o.cross !== null)
      const c = known.filter((o) => o.cross).length
      return known.length ? `${Math.round((c / known.length) * 100)}% of your dinks went cross-court.` : ""
    },
  },
  {
    id: "speedup",
    label: "Speeding up the right balls",
    unit: "share",
    better: "high",
    bands: { beginner: 0.35, intermediate: 0.5, pro: 0.65, legend: 0.8 },
    K: 6,
    minN: 3,
    value: share,
    explain: "At the line, your speed-ups (fast shots) on balls that were high enough to attack (above net height) instead of low ones that should have been dinked.",
    observe({ P, rallies }) {
      const out = []
      for (const r of rallies) {
        r.hits.forEach((hit, i) => {
          if (hit.player !== P.id || i < 3) return
          if (!(hit.kind === "drive" || hit.kind === "overhead") || depth(hit.z) > 3.8) return
          const ok = (hit.height ?? 0) >= 0.95
          out.push({ v: ok, t: hit.t, note: ok ? "Sped up a high ball" : `Sped up a low ball (at ${round(hit.height ?? 0, 1)} m): a dink was safer` })
        })
      }
      return out.sort((a, b) => Number(a.v) - Number(b.v))
    },
  },
  {
    id: "reset",
    label: "Resets from mid-court",
    unit: "share",
    better: "high",
    bands: { beginner: 0.25, intermediate: 0.4, pro: 0.55, legend: 0.7 },
    K: 6,
    minN: 3,
    value: share,
    explain: "Caught between the baseline and the kitchen while they're at the net: softening the ball into their kitchen (a reset) so they have to let it bounce.",
    observe({ P, rallies, opps }) {
      const out = []
      for (const r of rallies) {
        r.hits.forEach((hit, i) => {
          if (hit.player !== P.id || i < 3) return
          const d = depth(hit.z)
          if (d < 3.3 || d > 5.8) return
          const oppsAtNet = opps.length && opps.every((o) => depth(sampleAt(o.samples, hit.t)?.z ?? 9) < 3.2)
          if (!oppsAtNet) return
          const next = r.hits[i + 1]
          const soft = hit.kind === "drop" || hit.kind === "dink"
          const ok = soft && !!next && next.bounced
          out.push({ v: ok, t: hit.t, note: ok ? "Reset into the kitchen" : soft ? (next ? "Reset was high: they volleyed it" : "Reset ended the point") : "Drove it at two net players" })
        })
      }
      return out.sort((a, b) => Number(a.v) - Number(b.v))
    },
  },
  {
    id: "serve",
    label: "Serve depth",
    unit: "m",
    better: "high",
    bands: { beginner: 5.2, intermediate: 5.8, pro: 6.3, legend: 6.6 },
    K: 6,
    minN: 3,
    value: (obs) => mean(obs.map((o) => o.v)),
    explain: "How deep the returner stood to hit your serve (meters from the net). Deep serves keep the returning team back.",
    observe({ P, rallies }) {
      const out = []
      for (const r of rallies) if (r.hits[0]?.player === P.id && r.hits[1]) out.push({ v: round(depth(r.hits[1].z)), t: r.hits[0].t, note: "" })
      return out.sort((a, b) => a.v - b.v)
    },
  },
  {
    id: "return",
    label: "Return depth",
    unit: "m",
    better: "high",
    bands: { beginner: 5.2, intermediate: 5.8, pro: 6.3, legend: 6.6 },
    K: 6,
    minN: 3,
    value: (obs) => mean(obs.map((o) => o.v)),
    explain: "How deep the serving team was when they hit your return. A deep return buys time to get to the line.",
    observe({ P, rallies }) {
      const out = []
      for (const r of rallies) if (r.hits[1]?.player === P.id && r.hits[2]) out.push({ v: round(depth(r.hits[2].z)), t: r.hits[1].t, note: "", ghost: "kitchen" })
      return out.sort((a, b) => a.v - b.v)
    },
  },
  {
    id: "errors",
    label: "Points ended by your shot",
    unit: "share",
    better: "low",
    bands: { beginner: 0.18, intermediate: 0.13, pro: 0.09, legend: 0.06 },
    K: 25,
    minN: 10,
    value: (obs) => share(obs),
    explain: "How often your shot was the last of the point. The video can't tell a winner from an error, so treat this as an error rate with winners mixed in.",
    observe({ P, rallies }) {
      const out = []
      for (const r of rallies) r.hits.forEach((hit, i) => hit.player === P.id && out.push({ v: i === r.hits.length - 1, t: hit.t, kind: hit.kind, note: i === r.hits.length - 1 ? `Your ${hit.kind} ended the point` : "" }))
      return out.sort((a, b) => Number(b.v) - Number(a.v))
    },
    detail: (obs) => {
      const by = {}
      for (const o of obs) {
        by[o.kind] ||= { k: 0, n: 0 }
        by[o.kind].n++
        if (o.v) by[o.kind].k++
      }
      const worst = Object.entries(by)
        .filter(([, c]) => c.n >= 3 && c.k > 0)
        .sort((a, b) => b[1].k / b[1].n - a[1].k / a[1].n)[0]
      return worst ? `Most often on ${worst[0]}s: ${worst[1].k} of ${worst[1].n}.` : ""
    },
    worstKind: (obs) => {
      const by = {}
      for (const o of obs) {
        by[o.kind] ||= { k: 0, n: 0 }
        by[o.kind].n++
        if (o.v) by[o.kind].k++
      }
      return Object.entries(by).filter(([, c]) => c.n >= 3).sort((a, b) => b[1].k / b[1].n - a[1].k / a[1].n)[0]?.[0] || null
    },
  },
  {
    id: "spacing",
    label: "Spacing with your partner",
    unit: "share",
    better: "high",
    bands: { beginner: 0.35, intermediate: 0.5, pro: 0.65, legend: 0.8 },
    K: 10,
    minN: 5,
    doubles: true,
    value: share,
    explain: "As they hit, you and your partner side by side (2-4 m apart, level with each other), not both on one side and not one up, one back.",
    observe({ P, rallies, team, mate }) {
      if (!mate) return []
      const out = []
      for (const r of rallies) {
        r.hits.forEach((hit, i) => {
          if (i < 3 || hit.team === team) return
          const a = sampleAt(P.samples, hit.t)
          const b = sampleAt(mate.samples, hit.t)
          if (!a || !b) return
          const lat = Math.abs(a.x - b.x)
          const dd = Math.abs(depth(a.z) - depth(b.z))
          const ok = lat >= 1.8 && lat <= 4.2 && dd < 1.8
          out.push({ v: ok, t: hit.t, note: ok ? "Side by side" : dd >= 1.8 ? "One up, one back: a gap in the middle" : lat < 1.8 ? "Too close together: one side of the court open" : "Too far apart: a hole down the middle", ghost: "spacing" })
        })
      }
      return out.sort((a, b) => Number(a.v) - Number(b.v))
    },
  },
]

export const metricById = (id) => METRICS.find((m) => m.id === id) || null

// ---------- where a value sits on the level scale ----------
// 0 = Rookie's norm, 1 = Club, 2 = Pro, 3 = Legend; between: linear; below Rookie it goes
// down to -1 (one Rookie-to-Club step worse), above Legend it stays 3.
export const levelPos = (m, v) => {
  if (v === null || v === undefined) return null
  const t = LEVEL_IDS.map((id) => m.bands[id])
  const better = (a, b) => (m.better === "high" ? a >= b : a <= b)
  if (better(v, t[3])) return 3
  for (let i = 2; i >= 0; i--) {
    if (better(v, t[i])) return i + (v - t[i]) / (t[i + 1] - t[i])
  }
  const step = t[1] - t[0]
  return Math.max(-1, (v - t[0]) / step)
}

const confOf = (m, n) => 1 - Math.exp(-n / m.K)

// one metric from observations
export const summarize = (m, obs, target = "pro") => {
  const n = obs.length
  if (n < m.minN) return { id: m.id, label: m.label, unit: m.unit, better: m.better, value: n ? round(m.value(obs)) : null, n, conf: round(confOf(m, n)), band: m.bands[target], pos: null, verdict: "unknown", gap: 0, explain: m.explain, detail: n ? `Only ${n} so far: film more to measure it.` : m.missing || "Not seen in these games yet.", moments: [] }
  const value = round(m.value(obs), m.unit === "share" ? 3 : 2)
  const pos = round(levelPos(m, value), 2)
  const ti = LEVEL_IDS.indexOf(target)
  const gap = round(Math.max(0, ti - pos), 2)
  const verdict = gap <= 0 ? "good" : gap <= 0.5 ? "close" : "work"
  const bad = obs.filter((o) => (typeof o.v === "boolean" ? (m.better === "high" ? !o.v : o.v) : levelPos(m, o.v) < ti))
  return {
    id: m.id,
    label: m.label,
    unit: m.unit,
    better: m.better,
    value,
    n,
    conf: round(confOf(m, n)),
    band: m.bands[target],
    bands: m.bands,
    pos,
    verdict,
    gap,
    explain: m.explain,
    detail: m.detail ? m.detail(obs) : "",
    // (moments from different points: at least 4 s apart)
    moments: bad.filter((o, i) => !bad.slice(0, i).some((p) => p.game === o.game && Math.abs(p.t - o.t) < 4)).slice(0, 5).map((o) => ({ game: o.game, t: o.t, note: o.note, ghost: o.ghost || null, player: o.player })),
    worstKind: m.worstKind ? m.worstKind(obs) : undefined,
  }
}

// observations of every metric for one player in one analysis
export const observeGame = (analysis, playerId, gameKey = null) => {
  const P = analysis.players.find((p) => p.id === playerId)
  if (!P) return {}
  const team = P.team
  const mate = analysis.players.find((p) => p.team === team && p.id !== P.id) || null
  const opps = analysis.players.filter((p) => p.team !== team)
  const ctx = { P, team, mate, opps, rallies: analysis.rallies || [], doubles: analysis.players.length > 2 }
  const out = {}
  for (const m of METRICS) {
    if (m.doubles && !ctx.doubles) continue
    out[m.id] = m.observe(ctx).map((o) => ({ ...o, game: gameKey, player: playerId }))
  }
  return out
}

// the whole diagnosis over several games
export const diagnose = (games, me, { target = "pro" } = {}) => {
  const all = {}
  for (const g of games) {
    const pid = me[g.key]
    if (pid === undefined || pid === null || !g.analysis) continue
    const o = observeGame(g.analysis, pid, g.key)
    for (const [id, list] of Object.entries(o)) (all[id] ||= []).push(...list)
  }
  const metrics = METRICS.filter((m) => all[m.id]).map((m) => summarize(m, all[m.id], target))
  return { metrics, level: estimateLevel(metrics), target }
}

// "about what level is this?": the confidence-weighted mean of the metrics' level positions,
// with an honest range (spread between metrics + how little was seen)
export const estimateLevel = (metrics) => {
  const known = metrics.filter((m) => m.pos !== null)
  if (known.length < 3) return { pos: null, low: null, high: null, label: "Not enough film yet", sure: 0 }
  const w = known.map((m) => m.conf)
  const W = w.reduce((a, b) => a + b, 0)
  const pos = known.reduce((a, m, i) => a + m.pos * w[i], 0) / W
  const v = known.reduce((a, m, i) => a + w[i] * (m.pos - pos) ** 2, 0) / W
  const se = Math.sqrt(v / Math.max(1, known.length - 1)) + 0.9 / Math.sqrt(1 + W)
  const clampL = (x) => Math.max(0, Math.min(3, x))
  const low = clampL(pos - 1.3 * se)
  const high = clampL(pos + 1.3 * se)
  const name = (x) => LEVEL_LABEL[LEVEL_IDS[Math.max(0, Math.min(3, Math.round(x)))]]
  const label = name(low) === name(high) ? `Around ${name(pos)} level` : `Around ${name(pos)} (somewhere ${name(low)} to ${name(high)})`
  return { pos: round(pos), low: round(low), high: round(high), label, sure: round(Math.max(0, 1 - se / 1.5)) }
}

// a value for people: "2.4 s", "65%", "5.9 m"
export const formatValue = (m, v = m.value) => {
  if (v === null || v === undefined) return "-"
  if (m.unit === "share") return `${Math.round(v * 100)}%`
  return `${v.toFixed(m.unit === "m/s" || m.unit === "s" ? 1 : 1)} ${m.unit}`
}

export const HALF = { L: HALF_L, W: HALF_W }
