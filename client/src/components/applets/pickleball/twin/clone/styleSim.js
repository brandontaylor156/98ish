// Twin Clones test data: a scripted player with KNOWN habits, written out as a Twin Replay
// analysis (tracks + hits with kinds), so the tests can check that fitProfile finds those
// habits again. Doubles; the scripted player is id 0 on team 0 and hits all of their team's
// balls; team 0 serves every rally. Deterministic for a seed.

import { HALF_L, HALF_W, KITCHEN } from "../core/homography.js"

const rng = (seed) => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// style: { netRush (0..1: rallies they come to the line), stanceNet (m), backDepth (m),
// thirdDrop, hardShare (speed-ups at the line), reset, lob, crossDink, deepZ, speed (m/s),
// reaction (s) }
export const STYLE_DEFAULTS = { netRush: 0.5, stanceNet: 2.55, backDepth: 6.6, thirdDrop: 0.5, hardShare: 0.2, reset: 0.5, lob: 0.05, crossDink: 0.65, deepZ: 5.3, speed: 3.6, reaction: 0.22 }

export const simulateAnalysis = (style = {}, { rallies = 30, seed = 1, hits = 9 } = {}) => {
  const S = { ...STYLE_DEFAULTS, ...style }
  const r = rng(seed)
  const players = [0, 1, 2, 3].map((id) => ({ id, team: id < 2 ? 0 : 1, name: `P${id + 1}`, hand: 1, color: null, samples: [] }))
  const out = []
  let t = 1
  for (let ri = 0; ri < rallies; ri++) {
    const start = t
    const atNet = r() < S.netRush
    const H = []
    // hit times: ~1.1 s apart
    const times = Array.from({ length: hits }, (_, i) => start + 0.4 + i * (1.0 + r() * 0.25))
    // the scripted player's position over the rally: baseline, then after their third shot
    // they move to their depth for this rally, and shuffle sideways after each opponent hit
    let x = 0.8 * (r() < 0.5 ? -1 : 1)
    let z = HALF_L + 0.1
    let tx = x
    let tz = z
    let moveAt = Infinity
    const end = times[hits - 1] + 0.5
    const oppHits = times.filter((_, i) => i % 2 === 1)
    for (let s = start; s <= end + 1e-6; s += 1 / 15) {
      // a new target after each opponent hit, taken up after the reaction time
      for (const oh of oppHits) {
        if (s >= oh && s - 1 / 15 < oh) {
          moveAt = oh + S.reaction
          const i = times.indexOf(oh)
          tx = (r() - 0.5) * 2 * Math.min(HALF_W - 0.4, 2.2)
          tz = i >= 2 ? (atNet ? S.stanceNet : S.backDepth) + (r() - 0.5) * 0.3 : HALF_L + 0.1
        }
      }
      if (s >= moveAt) {
        const dx = tx - x
        const dz = tz - z
        const d = Math.hypot(dx, dz)
        const step = S.speed / 15
        if (d > step) {
          x += (dx / d) * step
          z += (dz / d) * step
        } else {
          x = tx
          z = tz
        }
      }
      players[0].samples.push({ t: +s.toFixed(3), x: +x.toFixed(3), z: +z.toFixed(3) })
    }
    // the other three: the partner beside them, the opponents at their kitchen line
    for (let s = start; s <= end + 1e-6; s += 1 / 15) {
      const near = players[0].samples.at(-1)
      players[1].samples.push({ t: +s.toFixed(3), x: -1.4, z: near ? near.z : 6 })
      players[2].samples.push({ t: +s.toFixed(3), x: -1.3, z: -(KITCHEN + 0.4) })
      players[3].samples.push({ t: +s.toFixed(3), x: 1.3, z: -(KITCHEN + 0.4) })
    }
    const posAt = (tt) => {
      const sm = players[0].samples
      let best = sm[0]
      for (const q of sm) if (Math.abs(q.t - tt) < Math.abs(best.t - tt)) best = q
      return best
    }
    let crossNext = null
    for (let i = 0; i < hits; i++) {
      const ht = times[i]
      if (i % 2 === 0) {
        const p = posAt(ht)
        const d = Math.abs(p.z)
        let kind
        if (i === 0) kind = "serve"
        else if (i === 2) kind = r() < S.thirdDrop ? "drop" : "drive"
        else if (d < 3.8) kind = r() < S.hardShare ? "drive" : "dink"
        else {
          const u = r()
          kind = u < S.lob ? "lob" : u < S.lob + S.reset ? "drop" : "drive"
        }
        const hx = p.x
        H.push({ t: +ht.toFixed(3), player: 0, team: 0, kind, side: 1, x: hx, z: p.z, height: 0.8, bounced: kind !== "drive" || d > 3.8, source: "sound" })
        crossNext = kind === "dink" ? (r() < S.crossDink ? -Math.sign(hx || 1) * 1.2 : Math.sign(hx || 1) * 1.0) : null
        if (kind === "drive" || kind === "serve") crossNext = null
      } else {
        const prev = H[i - 1]
        const deepShot = prev.kind === "drive" || prev.kind === "serve"
        const nz = i === 1 ? -(HALF_L - 0.3) : deepShot ? -(S.deepZ + (r() - 0.5) * 0.6) : -(KITCHEN + 0.4)
        const nx = crossNext ?? (r() - 0.5) * 2
        H.push({ t: +ht.toFixed(3), player: nx < 0 ? 2 : 3, team: 1, kind: i === 1 ? "return" : "dink", side: 1, x: nx, z: nz, height: 0.7, bounced: true, source: "sound" })
      }
    }
    out.push({ id: ri, start: +start.toFixed(3), end: +end.toFixed(3), lastHitter: H.at(-1).player, hits: H })
    t = end + 3
  }
  return { v: 1, duration: t, frames: 0, calibration: null, onsets: 0, soundOffset: 0, players, rallies: out, stats: null }
}
