// Twin Clones: a real person's play style, learned from Twin Replay games, as data the
// computer players (ai.js) play with. Pure (no DOM): the app and the tests use the same code.
//
// A profile keeps COUNTS, not conclusions (sufficient statistics: k of n, sums of values), so
// more games just add up (mergeProfiles) and a short film still gives a sensible clone: every
// trait is smoothed toward the level it starts from (Bayesian pseudo-counts), and only enough
// evidence pulls it away. traitsOf() turns counts into traits, cloneLevel() into a level
// object for match.js (the usual level fields, plus a few clone-only ones ai.js reads:
// stanceNet, stanceBack, crossDink, deepZ, serveDepth).
//
// What's measured (from the analysis: player tracks on the court + hits with kinds):
//   where they stand once a rally is going (at the kitchen line or back; how deep), how fast
//   they move and how soon after the other side's hit; their third shot (drop or drive);
//   at the kitchen: dink or speed up; from farther back against net players: reset, drive or
//   lob; where dinks go (cross-court or not) and how deep drives land; how often their shot
//   ends a rally (an error proxy: the video can't tell a winner from an error); how deep their
//   serve is returned from.

import { HALF_L, HALF_W, KITCHEN } from "../core/homography.js"
import { LEVELS, levelFor } from "../../ai.js"

export const CLONE_FORMAT = "98ish-clone"
export const CLONE_VERSION = 1
export const MAX_CLONE_BYTES = 16 * 1024

const NET_D = KITCHEN + 1.0 // "at the kitchen line": nearer the net than this (m)
const BACK_D = 5.0 // "back": farther than this
const KITCHEN_HIT = 3.8 // a hit this near the net is a kitchen-line ball
const NET_LINE = KITCHEN + 0.42 // ai.js NET_LINE
const BASE_DEPTH = HALF_L + 0.25 - 0.1 // ai.js BASE_LINE - 0.1

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const kn = () => ({ k: 0, n: 0 })
const sn = () => ({ sum: 0, n: 0 })

// an empty profile (all counts zero)
export const emptyCounts = () => ({
  net: kn(), // positions sampled while the other side hits (rally going): at the line
  netDepth: sn(), // how deep when at the line
  backDepth: sn(), // how deep when back
  lateral: sn(), // |x| while the rally goes (coverage)
  speed: sn(), // fast-moment speeds (the 90th percentile of each rally), m/s
  reaction: sn(), // s from the other side's hit to moving
  third: kn(), // third shots: k = drops
  kitchenHard: kn(), // their shots at the kitchen line: k = speed-ups (drive/overhead)
  transSoft: kn(), // from the transition/back against net players: k = soft (drop/dink)
  transLob: kn(), // ...: k = lobs
  volley: kn(), // shots at the line: k = out of the air
  crossDink: kn(), // dinks: k = cross-court
  deep: sn(), // where their drives/returns were met (depth of the next contact)
  endSoft: kn(), // soft shots: k = ended the rally
  endHard: kn(), // hard shots: k = ended the rally
  serve: sn(), // returner's contact depth on their serves
})

const sampleAt = (samples, t) => {
  if (!samples.length) return null
  let lo = 0
  let hi = samples.length - 1
  if (t <= samples[0].t) return samples[0]
  if (t >= samples[hi].t) return samples[hi]
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (samples[mid].t <= t) lo = mid
    else hi = mid
  }
  const a = samples[lo]
  const b = samples[hi]
  const u = (t - a.t) / Math.max(1e-6, b.t - a.t)
  return { t, x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u }
}
const speedAt = (samples, t, h = 0.12) => {
  const a = sampleAt(samples, t - h)
  const b = sampleAt(samples, t + h)
  return a && b ? Math.hypot(b.x - a.x, b.z - a.z) / (2 * h) : 0
}
const SOFT = new Set(["dink", "drop"])
const HARD = new Set(["drive", "overhead"])

// Counts for one player in one analysis (Twin Replay's analyzer output)
export const countsFrom = (analysis, playerId) => {
  const c = emptyCounts()
  const me = analysis.players.find((p) => p.id === playerId)
  if (!me) return c
  const S = me.samples
  for (const r of analysis.rallies) {
    const H = r.hits
    // where they stand while the other side hits, once the rally has settled (6th shot on:
    // a net-rusher is still running in at the 4th)
    H.forEach((h, i) => {
      if (h.team === me.team) return
      if (i >= 5) {
        const s = sampleAt(S, h.t)
        if (s) {
          const d = Math.abs(s.z)
          c.net.n++
          if (d < NET_D) {
            c.net.k++
            c.netDepth.sum += d
            c.netDepth.n++
          } else if (d > BACK_D) {
            c.backDepth.sum += d
            c.backDepth.n++
          }
          c.lateral.sum += Math.min(HALF_W, Math.abs(s.x))
          c.lateral.n++
        }
      }
      // reaction: the first moment after the other side's hit that they're moving
      if (i >= 1 && i < H.length - 1) {
        for (let dt = 0.04; dt < 0.8; dt += 0.04) {
          if (speedAt(S, h.t + dt, 0.06) > 1.1) {
            c.reaction.sum += dt
            c.reaction.n++
            break
          }
        }
      }
    })
    // how fast they get: the 95th percentile of this rally's speeds
    const speeds = []
    for (let t = r.start; t <= r.end; t += 0.1) speeds.push(speedAt(S, t))
    if (speeds.length >= 8) {
      speeds.sort((a, b) => a - b)
      const v = speeds[Math.min(speeds.length - 1, Math.floor(speeds.length * 0.95))]
      if (v > 0.5) {
        c.speed.sum += v
        c.speed.n++
      }
    }
    // their shots
    H.forEach((h, i) => {
      if (h.player !== playerId) return
      const next = H[i + 1]
      const d = Math.abs(h.z)
      const last = i === H.length - 1
      if (i === 0 && next) {
        c.serve.sum += Math.abs(next.z)
        c.serve.n++
      }
      if (i === 2) {
        c.third.n++
        if (h.kind === "drop" || h.kind === "dink") c.third.k++
      }
      if (i >= 3 && d < KITCHEN_HIT) {
        c.kitchenHard.n++
        if (HARD.has(h.kind)) c.kitchenHard.k++
        c.volley.n++
        if (!h.bounced) c.volley.k++
      }
      if (i >= 3 && d >= KITCHEN_HIT) {
        // against net players: is the other side at the line when they hit?
        const opp = analysis.players.filter((p) => p.team !== me.team)
        const atNet = opp.length && opp.every((p) => {
          const s = sampleAt(p.samples, h.t)
          return s && Math.abs(s.z) < NET_D + 0.4
        })
        if (atNet) {
          c.transSoft.n++
          c.transLob.n++
          if (SOFT.has(h.kind)) c.transSoft.k++
          if (h.kind === "lob") c.transLob.k++
        }
      }
      if (h.kind === "dink" && next && Math.abs(h.x) > 0.3) {
        c.crossDink.n++
        if (Math.sign(next.x) === -Math.sign(h.x) && Math.abs(next.x) > 0.3) c.crossDink.k++
      }
      if ((h.kind === "drive" || h.kind === "return") && next && next.bounced) {
        c.deep.sum += Math.abs(next.z)
        c.deep.n++
      }
      if (SOFT.has(h.kind)) {
        c.endSoft.n++
        if (last) c.endSoft.k++
      } else if (HARD.has(h.kind) || h.kind === "volley") {
        c.endHard.n++
        if (last) c.endHard.k++
      }
    })
  }
  return c
}

export const mergeCounts = (a, b) => {
  const out = emptyCounts()
  for (const key of Object.keys(out)) {
    const x = a?.[key] || {}
    const y = b?.[key] || {}
    out[key] = "k" in out[key] ? { k: (x.k || 0) + (y.k || 0), n: (x.n || 0) + (y.n || 0) } : { sum: (x.sum || 0) + (y.sum || 0), n: (x.n || 0) + (y.n || 0) }
  }
  return out
}

// Build (or extend) a profile. sessions: [{ analysis, playerId, gameId? }]
export const fitProfile = (sessions, { name = "Clone", base = "intermediate", hand = null, origin = "video", character = null, prev = null } = {}) => {
  let counts = prev?.counts || emptyCounts()
  const games = new Set(prev?.games || [])
  let shots = prev?.evidence?.shots || 0
  let rallies = prev?.evidence?.rallies || 0
  let seconds = prev?.evidence?.seconds || 0
  for (const { analysis, playerId, gameId = null } of sessions) {
    if (gameId && games.has(gameId)) continue // the same game twice counts once
    if (gameId) games.add(gameId)
    counts = mergeCounts(counts, countsFrom(analysis, playerId))
    shots += analysis.rallies.reduce((s, r) => s + r.hits.filter((h) => h.player === playerId).length, 0)
    rallies += analysis.rallies.length
    seconds += analysis.rallies.reduce((s, r) => s + Math.max(0, r.end - r.start), 0)
    if (hand === null) hand = analysis.players.find((p) => p.id === playerId)?.hand ?? null
  }
  return {
    format: CLONE_FORMAT,
    v: CLONE_VERSION,
    id: prev?.id || `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: String(name).slice(0, 24) || "Clone",
    base: LEVELS[base] ? base : "intermediate",
    hand: hand === -1 ? -1 : 1,
    character,
    origin, // "self" (it's you: shareable) | "video" (built from your video of someone: stays here) | "shared" (a friend sent their own)
    from: prev?.from || null,
    games: [...games].slice(-50),
    evidence: { shots, rallies, seconds: Math.round(seconds) },
    counts,
    updated: Date.now(),
  }
}

// How much we know (0..1): a meter, mostly from their shots (each shot is one decision seen)
export const knowOf = (profile) => {
  const e = profile?.evidence || {}
  return clamp(1 - Math.exp(-((e.shots || 0) + (e.rallies || 0) * 0.5) / 60), 0, 1)
}

// ---- traits: counts smoothed toward the base level ----
const P = (c, prior, a) => (c.k + a * prior) / (c.n + a)
const M = (c, prior, a) => (c.sum + a * prior) / (c.n + a)

export const traitsOf = (profile) => {
  const base = levelFor(profile.base || "intermediate")
  const c = profile.counts || emptyCounts()
  // what a player at this level does, in the units we measure
  const priorNet = 0.15 + 0.7 * base.advance
  const netRate = P(c.net, priorNet, 10)
  const hardShare = P(c.kitchenHard, clamp(base.impatience * 0.35 + base.bang * 0.5, 0.03, 0.9), 8)
  const softErr = P(c.endSoft, 0.12, 10)
  const hardErr = P(c.endHard, 0.25, 10)
  return {
    netRate,
    advance: clamp((netRate - 0.15) / 0.7, 0.03, 1),
    stanceNet: clamp(M(c.netDepth, NET_LINE, 6), 2.15, 3.2),
    stanceBack: clamp(M(c.backDepth, BASE_DEPTH, 6), 5.4, 8.3),
    lateral: M(c.lateral, 1.4, 6),
    speed: clamp(M(c.speed, base.speed, 4), 2.4, 5.0),
    reaction: clamp(M(c.reaction, base.reaction, 6), 0.08, 0.48),
    drop: P(c.third, base.drop, 6),
    hardShare,
    impatience: clamp(hardShare / 0.35, 0, 1),
    bang: clamp((hardShare - 0.25) * 1.6, 0, 1),
    reset: P(c.transSoft, base.reset, 6),
    lob: clamp(P(c.transLob, base.lob, 8), 0, 0.6),
    volleyRate: P(c.volley, 0.5, 6),
    crossDink: P(c.crossDink, 0.65, 6),
    deepZ: clamp(M(c.deep, HALF_L - 1.5, 5), 3.8, HALF_L - 0.3),
    softErr,
    hardErr,
    serveDepth: clamp(M(c.serve, HALF_L - 0.2, 4), 3.5, HALF_L + 1.5),
  }
}

// The level object match.js plays a clone with: the base level, the measured habits folded in
export const cloneLevel = (profile) => {
  const base = levelFor(profile.base || "intermediate")
  const t = traitsOf(profile)
  // errors: more rally-ending soft shots -> a wobblier touch; hard ones -> wider aim
  const softK = clamp(1 + (t.softErr - 0.12) * 2.2, 0.75, 1.6)
  const hardK = clamp(1 + (t.hardErr - 0.25) * 1.4, 0.8, 1.5)
  return {
    ...base,
    label: profile.name,
    style: "clone",
    clone: profile.id,
    speed: t.speed,
    reaction: t.reaction,
    advance: t.advance,
    drop: t.drop,
    impatience: t.impatience,
    bang: t.bang,
    reset: t.reset,
    lob: t.lob,
    // a volleyer takes balls out of the air at the line: they attack lower balls
    attack: base.attack - (t.volleyRate - 0.5) * 0.06,
    softTouch: base.softTouch * softK,
    dropTouch: base.dropTouch * softK,
    sigma: base.sigma * hardK,
    // clone-only (ai.js reads them when they're there)
    stanceNet: t.stanceNet,
    stanceBack: t.stanceBack,
    crossDink: t.crossDink,
    deepZ: t.deepZ,
    serveDepth: t.serveDepth,
  }
}

// A few plain words about a clone (the list and the share card)
export const describe = (profile) => {
  const t = traitsOf(profile)
  const out = []
  out.push(t.netRate > 0.6 ? "rushes the net" : t.netRate < 0.3 ? "stays back" : "comes in in stages")
  out.push(t.drop > 0.6 ? "third-shot drops" : t.drop < 0.35 ? "drives the third" : "mixes drop and drive")
  out.push(t.hardShare > 0.35 ? "speeds up a lot" : t.hardShare < 0.12 ? "patient at the kitchen" : "picks spots to speed up")
  if (t.lob > 0.12) out.push("likes a lob")
  out.push(t.crossDink > 0.7 ? "dinks cross-court" : t.crossDink < 0.45 ? "dinks straight" : null)
  return out.filter(Boolean)
}

// ---- the share file ----
export const toCloneFile = (profile) => ({ ...profile, from: profile.from || null })

const num = (v, lo, hi, d = 0) => (Number.isFinite(Number(v)) ? clamp(Number(v), lo, hi) : d)
// validate a received clone: bounded counts, known fields only (it plays in the game)
export const fromCloneFile = (o, { from = null } = {}) => {
  if (!o || o.format !== CLONE_FORMAT || o.v !== CLONE_VERSION) throw new Error("That isn't a Pickleball 98 clone.")
  if (JSON.stringify(o).length > MAX_CLONE_BYTES) throw new Error("That clone file is too big.")
  if (o.origin !== "self" && o.origin !== "shared") throw new Error("Only someone's own clone can be shared.")
  const counts = emptyCounts()
  for (const key of Object.keys(counts)) {
    const x = o.counts?.[key] || {}
    if ("k" in counts[key]) {
      const n = Math.round(num(x.n, 0, 1e5))
      counts[key] = { k: Math.round(num(x.k, 0, n)), n }
    } else {
      const n = Math.round(num(x.n, 0, 1e5))
      counts[key] = { sum: num(x.sum, 0, n * 20), n }
    }
  }
  return {
    format: CLONE_FORMAT,
    v: CLONE_VERSION,
    id: String(o.id || "").replace(/[^a-z0-9]/gi, "").slice(0, 24) || `c${Date.now().toString(36)}`,
    name: String(o.name || "Clone").slice(0, 24),
    base: LEVELS[o.base] ? o.base : "intermediate",
    hand: o.hand === -1 ? -1 : 1,
    character: typeof o.character === "string" ? o.character.slice(0, 24) : null,
    origin: "shared",
    from: from || (typeof o.from === "string" ? o.from.slice(0, 32) : null) || String(o.name || "").slice(0, 24),
    games: [],
    evidence: { shots: Math.round(num(o.evidence?.shots, 0, 1e5)), rallies: Math.round(num(o.evidence?.rallies, 0, 1e5)), seconds: Math.round(num(o.evidence?.seconds, 0, 1e7)) },
    counts,
    updated: Date.now(),
  }
}
