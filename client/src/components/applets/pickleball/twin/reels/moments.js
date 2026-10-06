// Instant Replay Reels: which rallies of a filmed game make the highlights (pure).
// Scores each rally on what makes a point worth seeing again: its length, its fastest shot
// (Real Ball speeds), a close line call, a kitchen battle (dinks), and the hardest run.
//   pickMoments(analysis, { max }) -> [{ ri, rally, score, tags, label, best, call, ... }]

export const MPH = 2.23694

const distanceRun = (players, start, end) => {
  let best = { id: null, m: 0 }
  for (const p of players || []) {
    let m = 0
    let prev = null
    for (const s of p.samples || []) {
      if (s.t < start) continue
      if (s.t > end) break
      if (prev) m += Math.hypot(s.x - prev.x, s.z - prev.z)
      prev = s
    }
    if (m > best.m) best = { id: p.id, m }
  }
  return best
}

// one rally's case for the reel
export const scoreRally = (rally, analysis, ri = 0) => {
  const hits = rally.hits || []
  const fl = analysis.ball?.flights?.[ri] || []
  let fastest = null
  let call = null
  hits.forEach((h, i) => {
    const sp = h.ball?.speed ?? (fl[i]?.conf >= 0.45 ? fl[i].speed : null)
    if (sp != null && (!fastest || sp > fastest.speed)) fastest = { speed: sp, player: h.player, t: h.t }
    const c = h.ball?.call || (fl[i]?.conf >= 0.45 ? fl[i].call : null)
    const b = h.ball?.bounce || (fl[i]?.conf >= 0.45 ? fl[i].bounce : null)
    if (c && b && (c.close || Math.abs(c.margin) < 0.15)) {
      if (!call || Math.abs(c.margin) < Math.abs(call.margin)) call = { verdict: c.verdict, margin: c.margin, close: !!c.close, line: c.line, x: b.x, z: b.z, t: b.t ?? h.t }
    }
  })
  const dinks = hits.filter((h) => h.kind === "dink").length
  const run = distanceRun(analysis.players, rally.start, rally.end)
  const tags = []
  if (hits.length >= 8) tags.push({ k: "long", text: `${hits.length}-shot rally` })
  if (fastest && fastest.speed * MPH >= 30) tags.push({ k: "fast", text: `${Math.round(fastest.speed * MPH)} mph` })
  if (call) tags.push({ k: "call", text: callText(call) })
  if (dinks >= 5) tags.push({ k: "kitchen", text: `${dinks}-dink kitchen battle` })
  if (run.m >= 12) tags.push({ k: "run", text: `ran ${Math.round(run.m)} m` })
  const score = hits.length + (fastest ? fastest.speed * 0.45 : 0) + (call ? 6 : 0) + dinks * 0.6 + run.m * 0.25
  return { ri, rally, score: Math.round(score * 10) / 10, tags, fastest, call, dinks, run, label: tags[0]?.text || `${hits.length}-shot point` }
}

export const callText = (call) => (call.close ? "Too close: call stands" : `${call.verdict === "in" ? "IN" : "OUT"} by ${Math.max(1, Math.round(Math.abs(call.margin) * 100))} cm`)

// the top `max` rallies, shown in the order they happened with the very best saved for last
export const pickMoments = (analysis, { max = 5 } = {}) => {
  const all = (analysis?.rallies || []).map((r, ri) => scoreRally(r, analysis, ri)).filter((m) => (m.rally.hits || []).length >= 2)
  if (!all.length) return []
  const top = [...all].sort((a, b) => b.score - a.score || a.ri - b.ri).slice(0, max)
  const best = top[0]
  const rest = top.slice(1).sort((a, b) => a.ri - b.ri)
  return [...rest, { ...best, best: true }]
}

// a person's name for a track id
export const nameOf = (analysis, id) => analysis?.players?.find((p) => p.id === id)?.name || (id != null ? `Player ${id + 1}` : "")
