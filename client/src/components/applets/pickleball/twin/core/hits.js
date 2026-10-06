// Twin Replay: who hit the ball when, and what kind of shot it was.
// - candidates: paddle pops in the sound (onsets.js) and swing peaks (the wrist's speed
//   relative to the hips, from each tracked player's landmarks)
// - fusion: each pop goes to the player on the OTHER team from the last hitter whose wrist was
//   moving fastest around it (a team never hits twice in a row); a pop nobody swung at is a
//   bounce or noise and is dropped. Without sound, the swing peaks alone, alternating teams.
// - rallies: hits more than RALLY_GAP apart start a new rally; the first hit is the serve
// - shot kinds from where the hitter and the next hitter stand, the contact height and the
//   ball's flight time

import { HALF_L } from "./homography.js"
import { handHeight, LM } from "./tracker.js"

export const RALLY_GAP = 4.0 // s
export const KINDS = ["serve", "return", "drive", "drop", "dink", "volley", "overhead", "lob"]
export const KIND_LABEL = { serve: "Serve", return: "Return", drive: "Drive", drop: "Drop", dink: "Dink", volley: "Volley", overhead: "Overhead", lob: "Lob" }

// ---------- swing speed per player ----------
// Returns [{ t, speed, hand: "l" | "r" }] per sample: the faster wrist's speed relative to
// the hips, in m/s (world landmarks) or body-heights/s * 1.7 (2D only), smoothed lightly
export const swingSeries = (samples) => {
  const out = []
  let prev = null
  for (const s of samples) {
    const rel = wristsRel(s)
    if (!rel) continue
    if (prev && s.t > prev.t) {
      const dt = s.t - prev.t
      if (dt > 0.4) {
        prev = { t: s.t, rel }
        continue
      }
      const vl = Math.hypot(rel.l[0] - prev.rel.l[0], rel.l[1] - prev.rel.l[1], rel.l[2] - prev.rel.l[2]) / dt
      const vr = Math.hypot(rel.r[0] - prev.rel.r[0], rel.r[1] - prev.rel.r[1], rel.r[2] - prev.rel.r[2]) / dt
      out.push({ t: (s.t + prev.t) / 2, speed: Math.max(vl, vr), hand: vr >= vl ? "r" : "l", sample: s })
    }
    prev = { t: s.t, rel }
  }
  // (3-tap smoothing)
  for (let i = 1; i < out.length - 1; i++) out[i].smooth = (out[i - 1].speed + 2 * out[i].speed + out[i + 1].speed) / 4
  if (out.length) {
    out[0].smooth = out[0].speed
    out[out.length - 1].smooth = out[out.length - 1].speed
  }
  return out
}
const wristsRel = (s) => {
  const w = s.world
  if (w && w.length >= 33) {
    const hip = [(w[LM.lHip].x + w[LM.rHip].x) / 2, (w[LM.lHip].y + w[LM.rHip].y) / 2, (w[LM.lHip].z + w[LM.rHip].z) / 2]
    const r = (i) => [w[i].x - hip[0], w[i].y - hip[1], w[i].z - hip[2]]
    return { l: r(LM.lWrist), r: r(LM.rWrist) }
  }
  const lm = s.lm
  if (!lm || !lm[LM.lWrist] || !lm[LM.rWrist] || !lm[LM.lHip] || !lm[LM.rHip] || !lm[LM.nose]) return null
  const hip = [(lm[LM.lHip].x + lm[LM.rHip].x) / 2, (lm[LM.lHip].y + lm[LM.rHip].y) / 2]
  const ankle = lm[LM.lAnkle] && lm[LM.rAnkle] ? Math.max(lm[LM.lAnkle].y, lm[LM.rAnkle].y) : hip[1] + (hip[1] - lm[LM.nose].y)
  const body = Math.max(8, ankle - lm[LM.nose].y) // pixels for ~1.62 m
  const k = 1.62 / body
  const r = (i) => [(lm[i].x - hip[0]) * k, (lm[i].y - hip[1]) * k, 0]
  return { l: r(LM.lWrist), r: r(LM.rWrist) }
}

// local maxima of the smoothed swing speed above `min`, at least `gap` apart
export const swingPeaks = (series, { min = 3.2, gap = 0.45 } = {}) => {
  const peaks = []
  for (let i = 1; i < series.length - 1; i++) {
    const v = series[i].smooth
    if (v < min || v < series[i - 1].smooth || v < series[i + 1].smooth) continue
    const last = peaks[peaks.length - 1]
    if (last && series[i].t - last.t < gap) {
      if (v > last.speed) peaks[peaks.length - 1] = { t: series[i].t, speed: v, hand: series[i].hand, sample: series[i].sample }
      continue
    }
    peaks.push({ t: series[i].t, speed: v, hand: series[i].hand, sample: series[i].sample })
  }
  return peaks
}
const peakNear = (series, t, before = 0.28, after = 0.18) => {
  let best = null
  for (const s of series) {
    if (s.t < t - before) continue
    if (s.t > t + after) break
    if (!best || s.smooth > best.smooth) best = s
  }
  return best
}

// ---------- fusion ----------
// tracks: [{ id, team, samples }]; onsets: [{ t, strength, bright }] (may be empty).
// Returns hits: [{ t, player (track id), team, speed, hand, source: "sound" | "swing" }]
export const findHits = (tracks, onsets = [], { minSwing = 2.4 } = {}) => {
  const series = new Map(tracks.map((tr) => [tr.id, swingSeries(tr.samples)]))
  const hits = []
  let lastTeam = null
  let lastT = -99
  if (onsets.length >= 2) {
    for (const o of onsets) {
      if (o.t - lastT > RALLY_GAP) lastTeam = null
      let best = null
      for (const tr of tracks) {
        if (lastTeam !== null && tr.team === lastTeam) continue
        const pk = peakNear(series.get(tr.id), o.t)
        if (!pk) continue
        const score = pk.smooth
        if (!best || score > best.score) best = { tr, pk, score }
      }
      if (!best || best.score < minSwing) continue // a bounce, a shout, the next court
      if (o.t - lastT < 0.3) continue
      hits.push({ t: o.t, player: best.tr.id, team: best.tr.team, speed: best.score, hand: best.pk.hand, source: "sound", sample: best.pk.sample })
      lastTeam = best.tr.team
      lastT = o.t
    }
    return hits
  }
  // (no usable sound: the swing peaks of everyone, alternating teams)
  const all = []
  for (const tr of tracks) for (const pk of swingPeaks(series.get(tr.id))) all.push({ ...pk, tr })
  all.sort((a, b) => a.t - b.t)
  for (const pk of all) {
    if (pk.t - lastT > RALLY_GAP) lastTeam = null
    if (lastTeam !== null && pk.tr.team === lastTeam) {
      // (the same team again: keep whichever swing of the two was stronger)
      const prev = hits[hits.length - 1]
      if (prev && pk.t - prev.t < 0.6 && pk.speed > prev.speed) {
        hits[hits.length - 1] = { t: pk.t, player: pk.tr.id, team: pk.tr.team, speed: pk.speed, hand: pk.hand, source: "swing", sample: pk.sample }
        lastT = pk.t
      }
      continue
    }
    if (pk.t - lastT < 0.4) continue
    hits.push({ t: pk.t, player: pk.tr.id, team: pk.tr.team, speed: pk.speed, hand: pk.hand, source: "swing", sample: pk.sample })
    lastTeam = pk.tr.team
    lastT = pk.t
  }
  return hits
}

// ---------- rallies and shot kinds ----------
// posAt(player, t) -> { x, z } (the tracked court position)
export const buildRallies = (hits, posAt, { handOf = () => 1 } = {}) => {
  const rallies = []
  let cur = null
  for (const h of hits) {
    if (!cur || h.t - cur.hits[cur.hits.length - 1].t > RALLY_GAP) {
      cur = { id: rallies.length, start: h.t, end: h.t, hits: [] }
      rallies.push(cur)
    }
    const p = posAt(h.player, h.t) || { x: 0, z: 0 }
    const height = h.sample ? handHeight(h.sample, h.hand) : 1
    cur.hits.push({ ...h, x: p.x, z: p.z, height: Math.max(0.15, Math.min(2.8, height)), idx: cur.hits.length })
    cur.end = h.t
  }
  for (const r of rallies) {
    const hs = r.hits
    hs.forEach((h, i) => {
      h.bounced = i <= 2 || Math.abs(h.z) > 4.2 || h.height < 0.42 // the incoming ball bounced first
    })
    hs.forEach((h, i) => {
      const next = hs[i + 1] || null
      h.kind = classify(h, next, i)
      h.flight = next ? next.t - h.t : null
      // forehand / backhand: the swinging wrist on the player's paddle side
      h.side = forehandOf(h, handOf(h.player))
    })
    // the rally's last hitter (an error or a winner: we can't tell which from the video)
    r.lastHitter = hs[hs.length - 1].player
    r.length = hs.length
  }
  return rallies
}

export const classify = (h, next, i) => {
  if (i === 0) return "serve"
  if (i === 1) return "return"
  if (h.height > 1.85) return "overhead"
  const atNet = Math.abs(h.z) < 3.4
  if (next && Math.abs(next.z) > 4.6 && Math.abs(h.z) < 4.6 && next.t - h.t > 1.35) return "lob"
  if (!h.bounced && atNet) return "volley"
  if (atNet) return "dink"
  if (next && Math.abs(next.z) < 3.6 && next.t - h.t > 0.95 && next.height < 0.7) return "drop"
  return "drive"
}

// h.sample.lm: was the faster wrist on the paddle side of the body? (team 0 faces away from a
// camera at their baseline: image right = their right; team 1 faces it: image right = their left)
const forehandOf = (h, hand) => {
  const lm = h.sample?.lm
  if (!lm || !lm[LM.lHip] || !lm[LM.rHip]) return "fh"
  const wrist = lm[h.hand === "l" ? LM.lWrist : LM.rWrist]
  if (!wrist) return "fh"
  const hipX = (lm[LM.lHip].x + lm[LM.rHip].x) / 2
  const imageRight = wrist.x > hipX
  const theirRight = h.team === 0 ? imageRight : !imageRight
  return theirRight === (hand >= 0) ? "fh" : "bh"
}

// the serve was hit from behind the baseline: true when it looks like one (a sanity check
// used by the analysis summary)
export const looksLikeServe = (h) => Math.abs(h.z) > HALF_L - 1.5
