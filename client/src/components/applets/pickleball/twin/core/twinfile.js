// Twin Replay files: a whole analyzed game as a few kilobytes to send a friend (no video):
// the players, their court paths on a fixed 10 Hz grid (centimeters, delta-coded), the
// rallies' hits, the venue and court, and the stats. JSON text; the sender may gzip it
// (CompressionStream) before it travels.

import { sampleAt } from "./tracker.js"
import { computeStats } from "./stats.js"
import { KINDS } from "./hits.js"

export const TWIN_FORMAT = "98ish-twin"
export const TWIN_VERSION = 1
export const GRID_HZ = 10
export const MAX_TWIN_BYTES = 400 * 1024
export const MAX_SECONDS = 2 * 60 * 60

const deltas = (arr) => arr.map((v, i) => (i ? v - arr[i - 1] : v))
const undeltas = (arr) => {
  const out = new Array(arr.length)
  let acc = 0
  for (let i = 0; i < arr.length; i++) out[i] = acc = i ? acc + arr[i] : arr[i]
  return out
}

// analysis (createAnalyzer().finish(), with names) + { venue, court, title, when } -> object
export const toTwin = (analysis, meta = {}) => {
  const end = Math.min(MAX_SECONDS, analysis.duration || 0)
  const n = Math.max(1, Math.floor(end * GRID_HZ) + 1)
  return {
    format: TWIN_FORMAT,
    v: TWIN_VERSION,
    title: String(meta.title || "Pickleball game").slice(0, 80),
    when: meta.when || Date.now(),
    venue: meta.venue || null,
    court: meta.court ?? null,
    duration: Math.round(end * 10) / 10,
    hz: GRID_HZ,
    players: analysis.players.map((p) => {
      const xs = []
      const zs = []
      for (let i = 0; i < n; i++) {
        const s = sampleAt(p.samples, i / GRID_HZ) || { x: 0, z: 0 }
        xs.push(Math.round(s.x * 100))
        zs.push(Math.round(s.z * 100))
      }
      return { id: p.id, team: p.team, name: String(p.name || "").slice(0, 32), hand: p.hand === -1 ? -1 : 1, color: p.color || null, from: p.samples[0]?.t ?? 0, to: p.samples.at(-1)?.t ?? 0, x: deltas(xs), z: deltas(zs) }
    }),
    // hits: [t (ms), player, kind index, side (0 fh / 1 bh), x cm, z cm, height cm, bounced 0/1]
    rallies: analysis.rallies.map((r) => r.hits.map((h) => [Math.round(h.t * 1000), h.player, Math.max(0, KINDS.indexOf(h.kind)), h.side === "bh" ? 1 : 0, Math.round(h.x * 100), Math.round(h.z * 100), Math.round(h.height * 100), h.bounced ? 1 : 0])),
  }
}

// object (from a file or a message) -> analysis, validated; throws on anything malformed
export const fromTwin = (o) => {
  if (!o || o.format !== TWIN_FORMAT || typeof o.v !== "number") throw new Error("Not a Twin Replay file.")
  if (o.v > TWIN_VERSION) throw new Error("This replay needs a newer 98ish.")
  const hz = Number(o.hz) || GRID_HZ
  const duration = Math.min(MAX_SECONDS, Math.max(0, Number(o.duration) || 0))
  const players = (Array.isArray(o.players) ? o.players : []).slice(0, 4).map((p, k) => {
    const xs = undeltas((p.x || []).map(Number))
    const zs = undeltas((p.z || []).map(Number))
    const from = Number(p.from) || 0
    const to = Number(p.to) || duration
    const samples = []
    for (let i = 0; i < Math.min(xs.length, zs.length); i++) {
      const t = i / hz
      if (t < from - 0.05 || t > to + 0.05) continue
      if (!Number.isFinite(xs[i]) || !Number.isFinite(zs[i])) continue
      samples.push({ t, x: clamp(xs[i] / 100, -12, 12), z: clamp(zs[i] / 100, -16, 16) })
    }
    return { id: Number.isInteger(p.id) ? p.id : k, team: p.team === 1 ? 1 : 0, name: String(p.name || `Player ${k + 1}`).slice(0, 32), hand: p.hand === -1 ? -1 : 1, color: typeof p.color === "string" && /^rgb\(\d+,\d+,\d+\)$/.test(p.color) ? p.color : null, samples }
  })
  const ids = new Set(players.map((p) => p.id))
  const rallies = (Array.isArray(o.rallies) ? o.rallies : []).slice(0, 2000).map((hits, id) => {
    const hs = (Array.isArray(hits) ? hits : [])
      .slice(0, 400)
      .filter((h) => Array.isArray(h) && ids.has(h[1]))
      .map((h) => ({ t: (Number(h[0]) || 0) / 1000, player: h[1], team: players.find((p) => p.id === h[1]).team, kind: KINDS[h[2]] || "drive", side: h[3] ? "bh" : "fh", x: (Number(h[4]) || 0) / 100, z: (Number(h[5]) || 0) / 100, height: (Number(h[6]) || 100) / 100, bounced: !!h[7] }))
      .sort((a, b) => a.t - b.t)
    return { id, start: hs[0]?.t ?? 0, end: hs.at(-1)?.t ?? 0, lastHitter: hs.at(-1)?.player ?? null, hits: hs }
  }).filter((r) => r.hits.length)
  const analysis = { v: 1, duration, players, rallies, calibration: null }
  analysis.stats = computeStats(players, rallies)
  return { analysis, meta: { title: String(o.title || "Pickleball game").slice(0, 80), when: Number(o.when) || Date.now(), venue: typeof o.venue === "string" ? o.venue.slice(0, 40) : null, court: o.court ?? null } }
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
