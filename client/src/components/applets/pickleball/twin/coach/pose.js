// Coach: the one pose fact Twin Replay keeps after reading a game (the full landmarks are too
// big to store): where the paddle hand was each time the other side hit the ball. "Paddle up"
// (ready position) means the hand is well above the waist, between hip and shoulder or higher.
// Pure (no DOM).

// MediaPipe Pose landmark indices
const L_SH = 11
const R_SH = 12
const L_WR = 15
const R_WR = 16
const L_HIP = 23
const R_HIP = 24

const vis = (p) => (p ? p.v ?? p.visibility ?? 1 : 0)

// Paddle-hand height from a tracked sample's landmarks, as a share of hip -> shoulder:
// 0 = at the hips, 1 = at the shoulders (more is above). Image y and MediaPipe world y both
// point down, so the same arithmetic works for either. hand: 1 right, -1 left, 0 = the higher.
// Returns null when the body isn't clear enough.
export const handHeight = (sample, hand = 0) => {
  const lm = sample?.world || sample?.lm
  if (!lm || !lm[L_HIP] || !lm[R_HIP] || !lm[L_SH] || !lm[R_SH]) return null
  if (Math.min(vis(lm[L_HIP]), vis(lm[R_HIP]), vis(lm[L_SH]), vis(lm[R_SH])) < 0.3) return null
  const hipY = (lm[L_HIP].y + lm[R_HIP].y) / 2
  const shY = (lm[L_SH].y + lm[R_SH].y) / 2
  const span = hipY - shY
  if (!(Math.abs(span) > 1e-4)) return null
  const rel = (w) => (w && vis(w) >= 0.3 ? (hipY - w.y) / span : null)
  const r = rel(lm[R_WR])
  const l = rel(lm[L_WR])
  const pick = hand === 1 ? r ?? l : hand === -1 ? l ?? r : r === null ? l : l === null ? r : Math.max(r, l)
  return pick === null ? null : Math.round(pick * 100) / 100
}

// the sample nearest t (within 0.25 s) that has landmarks
const nearestWithPose = (samples, t) => {
  let best = null
  let bestD = 0.25
  for (const s of samples) {
    const d = Math.abs(s.t - t)
    if (d <= bestD && (s.lm || s.world)) {
      best = s
      bestD = d
    }
    if (s.t > t + 0.3) break
  }
  return best
}

// For one track: the paddle-hand height at every hit by the other team.
// rallies: buildRallies output (hits with t, team). Returns [{ t, h }] (h as handHeight).
export const readySeries = (track, rallies, hand = 0) => {
  const out = []
  for (const r of rallies) {
    for (const hit of r.hits) {
      if (hit.team === track.team) continue
      const s = nearestWithPose(track.samples, hit.t)
      const h = s ? handHeight(s, hand) : null
      if (h !== null) out.push({ t: Math.round(hit.t * 1000) / 1000, h })
    }
  }
  return out
}

export const PADDLE_UP = 0.35 // "paddle up": the hand at least a third of the way from hips to shoulders
