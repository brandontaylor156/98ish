// Coach: from the diagnosis to a week of practice. Pure (no DOM).
//
// weaknesses(diagnosis) ranks what to fix: how far below the target level (in level steps)
// x how sure we are (confidence) x how fixable it is in practice (FIX). weekPlan() turns the
// top three into three sessions of Pickleball 98 drills (practice/drillbook.js ids, a ball
// machine setup, or a cue for real games), sized by how big the gap is.

import { metricById } from "./metrics.js"

// how much practice moves each habit (fitness-like ones less)
const FIX = { kitchen: 1.2, split: 1.15, third: 1.1, ready: 1.05, recovery: 1.0, reset: 0.95, dink: 0.95, spacing: 0.9, speedup: 0.85, serve: 0.85, return: 0.85, errors: 0.75, coverage: 0.6 }

// the drills for each habit (first = main), and the cue to take onto the court
export const FOR = {
  kitchen: { drills: [{ kind: "drill", id: "kitchen" }, { kind: "drill", id: "return" }], cue: "After your return, run all the way to the kitchen line and split step there." },
  split: { drills: [{ kind: "drill", id: "split" }], cue: "Small hop and land balanced right as they hit, every ball." },
  ready: { drills: [{ kind: "drill", id: "hands" }], cue: "At the line, paddle up in front of your chest between every shot." },
  recovery: { drills: [{ kind: "machine", settings: { shot: "drive", speed: "medium", place: "alternate", rate: 10, balls: 20 }, title: "Ball machine: side to side" }, { kind: "drill", id: "split" }], cue: "After every shot, shuffle back to the middle of your half." },
  coverage: { drills: [{ kind: "machine", settings: { shot: "drive", speed: "fast", place: "random", rate: 10, balls: 20 }, title: "Ball machine: fast and random" }], cue: "First step fast: push off on the outside foot." },
  third: { drills: [{ kind: "drill", id: "drop" }, { kind: "drill", id: "kitchen" }], cue: "Third shot: soft drop into their kitchen, then come in behind it." },
  dink: { drills: [{ kind: "drill", id: "dink" }], cue: "Dink cross-court and low; wait for a high ball before speeding up." },
  speedup: { drills: [{ kind: "drill", id: "hands" }, { kind: "drill", id: "dink" }], cue: "Only speed up balls above the net; dink the low ones." },
  reset: { drills: [{ kind: "drill", id: "reset" }], cue: "Caught mid-court: soft hands, reset into the kitchen, then move in." },
  serve: { drills: [{ kind: "drill", id: "serve" }], cue: "Serve deep to the back third of the box." },
  return: { drills: [{ kind: "drill", id: "return" }], cue: "Return deep and down the middle, then run in." },
  errors: { drills: [{ kind: "drill", id: "dink" }], cue: "Aim a meter inside the lines; make them hit one more ball." },
  spacing: { drills: [], cue: "Move with your partner like you're tied by a 3 m rope: side by side, never one up, one back." },
}
// a drill for the shot kind that ends most points (the errors metric)
const DRILL_FOR_KIND = { dink: "dink", drop: "drop", drive: "hands", volley: "hands", serve: "serve", return: "return", overhead: "smash", lob: "smash" }

export const weaknesses = (diag, n = 3) =>
  diag.metrics
    .filter((m) => m.verdict === "work" || m.verdict === "close")
    .map((m) => ({ id: m.id, label: m.label, gap: m.gap, conf: m.conf, score: Math.round(m.gap * m.conf * (FIX[m.id] ?? 0.8) * 1000) / 1000, worstKind: m.worstKind }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n)

const ballsFor = (gap) => (gap >= 1.5 ? 20 : gap >= 0.8 ? 15 : 10)

const itemFor = (w, which, day) => {
  const f = FOR[w.id]
  let d = f.drills[which] || f.drills[0]
  if (w.id === "errors" && w.worstKind && DRILL_FOR_KIND[w.worstKind]) d = { kind: "drill", id: DRILL_FOR_KIND[w.worstKind] }
  if (!d) return { key: `${day}-${w.id}-cue`, day, kind: "cue", metric: w.id, title: metricById(w.id)?.label || w.id, cue: f.cue, why: `In your real games: ${f.cue}` }
  return {
    key: `${day}-${w.id}-${d.id || d.kind}-${which}`,
    day,
    kind: d.kind,
    drill: d.id || null,
    settings: d.settings || null,
    title: d.title || null,
    balls: d.kind === "drill" ? ballsFor(w.gap) : null,
    metric: w.id,
    cue: f.cue,
    why: `For ${metricById(w.id)?.label.toLowerCase() || w.id}`,
  }
}

// three sessions: the top weakness every day, the second on days 1 and 3, the third on day
// 2, plus each day the second drill for the top weakness on day 3 (variety)
export const weekPlan = (diag, { now = Date.now() } = {}) => {
  const ws = weaknesses(diag)
  if (!ws.length) return { created: now, weaknesses: [], items: [], cues: [] }
  const items = []
  for (const day of [1, 2, 3]) {
    items.push(itemFor(ws[0], day === 3 ? 1 : 0, day))
    if (ws[1] && day !== 2) items.push(itemFor(ws[1], 0, day))
    if (ws[2] && day === 2) items.push(itemFor(ws[2], 0, day))
  }
  // (one item per drill per day)
  const seen = new Set()
  const unique = items.filter((it) => {
    const k = `${it.day}:${it.kind}:${it.drill || it.title || it.metric}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  return { created: now, weaknesses: ws, items: unique, cues: ws.map((w) => FOR[w.id].cue) }
}
