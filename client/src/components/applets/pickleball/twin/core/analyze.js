// Twin Replay: from the pose model's people per frame (+ the sound) to the analysis: player
// tracks on the court, hits, rallies with shot kinds, the ball's rebuilt path, and stats.
// Pure (no DOM): the browser feeds it frames as the model reads them, tests feed it
// synthetic people.

import { calibrate } from "./homography.js"
import { createTracker, sampleAt } from "./tracker.js"
import { detectOnsets } from "./onsets.js"
import { buildRallies, findHits } from "./hits.js"
import { rallyPath } from "./ballpath.js"
import { annotateHits, measuredPath } from "../ball/realball.js"
import { computeStats } from "./stats.js"
import { readySeries } from "../coach/pose.js"

export const ANALYSIS_VERSION = 1

// A streaming analyzer. opts: { taps (calibration), players: 2 | 4 }
// push(t, people) per processed frame; finish({ audio: { samples, rate } | null, names, hands })
export const createAnalyzer = ({ taps, players = 4 }) => {
  const cal = calibrate(taps)
  if (!cal.ok) throw new Error(cal.reason || "calibration")
  const tracker = createTracker({ players, H: cal.H })
  let frames = 0
  let lastT = 0
  return {
    calibration: cal,
    push(t, people) {
      tracker.step(t, people)
      frames++
      lastT = t
    },
    get frames() {
      return frames
    },
    // people seen in the last frame, mapped to tracks (for the "name your players" step)
    tracks: () => tracker.tracks,
    finish({ audio = null, onsets = null, hands = {}, names = {}, minSamples = 8 } = {}) {
      const tracks = balanceTeams(tracker.finish().filter((tr) => tr.samples.length >= minSamples))
      const found = onsets || (audio ? detectOnsets(audio.samples, audio.rate) : [])
      const handOf = (id) => (hands[id] === -1 ? -1 : 1)
      const hits = findHits(tracks, found)
      const posAt = (id, t) => {
        const tr = tracks.find((x) => x.id === id)
        return tr ? sampleAt(tr.samples, t) : null
      }
      const rallies = buildRallies(hits, posAt, { handOf })
      const stats = computeStats(tracks, rallies)
      return {
        v: ANALYSIS_VERSION,
        duration: lastT,
        frames,
        calibration: { taps, rms: cal.rms },
        onsets: found.length,
        soundOffset: hits.soundOffset || 0,
        players: tracks.map((tr) => ({
          id: tr.id,
          team: tr.team,
          name: names[tr.id] || `Player ${tr.id + 1}`,
          hand: handOf(tr.id),
          color: tr.color ? dominantColor(tr.color) : null,
          samples: tr.samples.map((s) => ({ t: round(s.t, 3), x: round(s.x, 3), z: round(s.z, 3) })),
          // (Coach: the paddle-hand height each time the other side hit; the landmarks aren't kept)
          ready: readySeries(tr, rallies, handOf(tr.id)),
        })),
        rallies: rallies.map((r) => ({
          id: r.id,
          start: round(r.start, 3),
          end: round(r.end, 3),
          lastHitter: r.lastHitter,
          hits: r.hits.map((h) => ({ t: round(h.t, 3), player: h.player, team: h.team, kind: h.kind, side: h.side, x: round(h.x, 3), z: round(h.z, 3), height: round(h.height, 2), bounced: h.bounced, source: h.source })),
        })),
        stats,
      }
    },
  }
}

// the ball paths (not stored: rebuilt from the rallies whenever an analysis is opened)
// (Real Ball: where the ball was measured, its flights replace the rebuilt ones, and the hits
// carry their speed, bounce and line call)
export const withPaths = (analysis) => {
  const hand = new Map(analysis.players.map((p) => [p.id, p.hand]))
  const a = analysis.ball && !analysis.ballOff ? annotateHits(analysis) : analysis
  return {
    ...a,
    paths: a.rallies.map((r, ri) => {
      const rebuilt = rallyPath(r.hits, (id) => hand.get(id) ?? 1)
      return a.ball && !analysis.ballOff ? measuredPath(r, a.ball.flights?.[ri], rebuilt) : rebuilt
    }),
  }
}

// doubles is two a side and singles one: the players who spent most time nearest the camera's
// baseline are team 0, whatever a few odd frames said
export const balanceTeams = (tracks) => {
  if (tracks.length !== 4 && tracks.length !== 2) return tracks
  const mean = (tr) => tr.samples.reduce((a, s) => a + s.z, 0) / Math.max(1, tr.samples.length)
  const order = [...tracks].sort((a, b) => mean(b) - mean(a))
  const half = tracks.length / 2
  order.forEach((tr, i) => (tr.team = i < half ? 0 : 1))
  return tracks
}

const round = (v, d) => {
  const k = 10 ** d
  return Math.round(v * k) / k
}
// the most common shirt color bin as a CSS color (the player's chip in the UI)
const dominantColor = (hist) => {
  let best = 0
  for (let i = 1; i < 64; i++) if (hist[i] > hist[best]) best = i
  const r = (best >> 4) * 64 + 32
  const g = ((best >> 2) & 3) * 64 + 32
  const b = (best & 3) * 64 + 32
  return `rgb(${r},${g},${b})`
}
