// Live Broadcast, the watching side: the stream's ticks and events kept in order, and the
// game frames (Twin Replay's buildFrames) for any stretch of it. Pure (Node-tested).
//
// The jitter buffer: viewers play DELAY seconds behind the newest tick they have, so a late
// or bunched packet is already there when its moment comes; positions between ticks are
// interpolated (tracker.sampleAt). The rallies and the ball are rebuilt from the hits the
// same way Twin Replay does it; a hit DELAY seconds ahead is known in time for the
// player's backswing.

import { buildRallies } from "../core/hits.js"
import { withPaths } from "../core/analyze.js"
import { buildFrames, FPS } from "../core/replay.js"
import { sampleAt } from "../core/tracker.js"
import { computeStats } from "../core/stats.js"
import { cleanEvent, decodeTick } from "./packet.js"

export const DELAY = 1.0 // s behind the newest tick
export const KEEP = 75 // s of ticks kept (the server's ring is 60 s; rewind is 10 s)

export const createStream = ({ players: roster = [], keep = KEEP } = {}) => {
  let players = roster.map((p, i) => ({ id: i, team: p.team ?? (i < roster.length / 2 ? 0 : 1), name: p.name || `Player ${i + 1}`, hand: p.hand === -1 ? -1 : 1, samples: [] }))
  const hits = []
  let score = null
  let newest = -Infinity
  let ticks = 0
  let bytes = 0
  const ensure = (n) => {
    while (players.length < n) {
      const i = players.length
      players.push({ id: i, team: i < Math.max(1, n / 2) ? 0 : 1, name: `Player ${i + 1}`, hand: 1, samples: [] })
    }
  }
  // samples kept in time order (a late packet goes where it belongs)
  const insert = (arr, s) => {
    let i = arr.length
    while (i > 0 && arr[i - 1].t > s.t) i--
    if (i > 0 && Math.abs(arr[i - 1].t - s.t) < 1e-6) return
    arr.splice(i, 0, s)
  }
  const trim = () => {
    const cut = newest - keep
    for (const p of players) {
      let k = 0
      while (k < p.samples.length - 2 && p.samples[k].t < cut) k++
      if (k) p.samples.splice(0, k)
    }
    while (hits.length && hits[0].t < cut - 10) hits.shift()
  }
  return {
    // a tick as bytes from the socket; returns its time or null
    addTick(bytes_) {
      const tick = decodeTick(bytes_)
      if (!tick) return null
      ticks++
      bytes += bytes_.byteLength ?? bytes_.length ?? 0
      ensure(tick.players.length)
      tick.players.forEach((q, i) => {
        if (!q.seen && players[i].samples.length) return // (lost for now: hold the last place)
        insert(players[i].samples, { t: tick.t, x: q.x, z: q.z })
      })
      if (tick.t > newest) newest = tick.t
      if (ticks % 50 === 0) trim()
      return tick.t
    },
    addEvent(raw) {
      const e = cleanEvent(raw)
      if (!e) return null
      if (e.k === "roster") {
        ensure(e.players.length)
        for (const r of e.players) Object.assign(players[r.slot], { name: r.name, team: r.team, hand: r.hand })
      } else if (e.k === "hit") {
        const t = e.t / 1000
        if (!hits.some((h) => Math.abs(h.t - t) < 0.05 && h.player === e.p)) {
          hits.push({ t, player: e.p, team: players[e.p]?.team ?? 0, height0: e.h / 100, side0: e.s, source: e.src })
          hits.sort((a, b) => a.t - b.t)
        }
      } else if (e.k === "score") score = { a: e.a, b: e.b, call: e.call, over: e.over, t: e.t / 1000 }
      return e
    },
    get newest() {
      return newest
    },
    get score() {
      return score
    },
    get players() {
      return players
    },
    get hits() {
      return hits
    },
    stats: () => ({ ticks, bytes }),
    // where playback should be now (DELAY behind the newest tick)
    edge: (delay = DELAY) => (Number.isFinite(newest) ? newest - delay : null),
    // the analysis Twin Replay understands (players with samples, rallies with kinds, paths)
    analysis() {
      const posAt = (id, t) => {
        const p = players[id]
        return p ? sampleAt(p.samples, t) : null
      }
      // (the team at the time of the hit: rosters can arrive late)
      const hs = hits.map((h) => ({ ...h, team: players[h.player]?.team ?? h.team }))
      const rallies = buildRallies(hs, posAt, { handOf: (id) => players[id]?.hand ?? 1 })
      // (everyone on the roster is drawn from the start: one not seen yet waits at their baseline)
      const shown = players.map((p, i) => (p.samples.length ? p : { ...p, samples: [{ t: 0, x: (i % 2 ? 1.5 : -1.5), z: p.team === 1 ? -6.4 : 6.4 }] }))
      return withPaths({ players: shown, rallies, duration: Number.isFinite(newest) ? newest : 0 })
    },
    // game frames for [from, to] (seconds on the stream's clock)
    frames(from, to) {
      if (!(to > from)) return []
      const a = this.analysis()
      if (!a.players.length) return []
      return buildFrames(a, { from, to, fps: FPS }).frames
    },
    // a Twin Replay game's analysis (the broadcast kept: "after the game")
    toAnalysis() {
      const a = this.analysis()
      const real = a.players.filter((p) => players[p.id]?.samples.length)
      const stats = computeStats(real, a.rallies)
      return {
        v: 1,
        duration: a.duration,
        frames: ticks,
        calibration: null,
        onsets: hits.length,
        soundOffset: 0,
        live: true,
        players: real.map((p) => ({ id: p.id, team: p.team, name: p.name, hand: p.hand, color: null, samples: p.samples.map((s) => ({ t: +s.t.toFixed(3), x: +s.x.toFixed(3), z: +s.z.toFixed(3) })) })),
        rallies: a.rallies.map((r) => ({ id: r.id, start: r.start, end: r.end, lastHitter: r.lastHitter, hits: r.hits.map((h) => ({ t: +h.t.toFixed(3), player: h.player, team: h.team, kind: h.kind, side: h.side, x: +h.x.toFixed(3), z: +h.z.toFixed(3), height: +h.height.toFixed(2), bounced: h.bounced, source: h.source })) })),
        stats,
      }
    },
  }
}

// The playback cursor: appends frames up to the buffer's edge as ticks come in. A pure helper
// so the timing is testable: step(stream) -> new frames to hand the engine (in order, no gaps).
export const createCursor = ({ delay = DELAY, fps = FPS } = {}) => {
  let built = null // the last frame time handed out
  const dt = 1 / fps
  return {
    get built() {
      return built
    },
    step(stream) {
      const edge = stream.edge(delay)
      if (edge === null) return []
      if (built === null) built = edge - dt * 2 // (start a couple of frames back: never empty)
      // fell far behind (the tab slept): jump to the edge instead of building a minute at once
      if (edge - built > 8) built = edge - dt * 2
      if (edge - built < dt) return []
      const from = built + dt
      const frames = stream.frames(from, edge)
      if (frames.length) built = frames[frames.length - 1].t
      return frames
    },
    reset() {
      built = null
    },
  }
}
