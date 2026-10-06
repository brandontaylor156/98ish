// Coach test data: a scripted doubles player with KNOWN habits, written out as a Twin Replay
// analysis (15 Hz tracks, hits with kinds, paddle heights), plus the TRUE values of the habits
// computed from the script itself (a continuous path, not the 15 Hz samples), so the tests
// check the coach's measurements against ground truth. Deterministic for a seed.
//
// The player (id 0, team 0) hits all of their team's balls; even rallies they serve (their
// third shot starts the run in), odd rallies they return (the return starts it). Each move
// ("leg") starts just after their own hit and ends `split` seconds after the other side's next
// contact (negative = before it: on time), swinging out wide and back to their spot (+ a
// recovery error). `legs` legs take them from the baseline to the kitchen line.

import { KITCHEN } from "../core/homography.js"

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

export const HABIT_DEFAULTS = { legs: 2, split: -0.05, readyUp: 0.8, thirdGood: 0.6, recoveryErr: 0.4, stacked: 0.1, serveDepth: 6.0, returnDepth: 6.0, dinkErr: 0.08, highSpeedups: 0.6 }

const LINE = 2.5 // their depth at the line (m)
const HOME = 1.5 // their spot (doubles: the right half)
const AMP = 1.0 // how wide each move swings out
const AT_LINE = KITCHEN + 0.6

export const simulateCoach = (habits = {}, { rallies = 24, seed = 3, hits = 11 } = {}) => {
  const H = { ...HABIT_DEFAULTS, ...habits }
  const r = rng(seed)
  const players = [0, 1, 2, 3].map((id) => ({ id, team: id < 2 ? 0 : 1, name: `P${id + 1}`, hand: 1, color: null, samples: [], ready: [] }))
  const out = []
  const truth = { arrivals: [], recoveries: [], readyUp: [], third: [], stackedAt: [], serveDepths: [], returnDepths: [] }
  let T = 1
  for (let ri = 0; ri < rallies; ri++) {
    const serving = ri % 2 === 0
    const start = T
    const times = Array.from({ length: hits }, (_, i) => start + 0.5 + i * 1.1)
    const mine = (i) => (serving ? i % 2 === 0 : i % 2 === 1)
    const trigger = serving ? 2 : 1
    // the legs: [{ t0, t1, from: {x, d}, to: {x, d} }] (d = depth from the net)
    const legs = []
    let pos = { x: HOME, d: serving ? 6.6 : 6.4 }
    let legN = 0
    for (let i = trigger; i < hits - 1; i++) {
      if (!mine(i)) continue
      const tp = times[i]
      const th = times[i + 1] // the other side's next contact
      const err = (r() < 0.5 ? -1 : 1) * H.recoveryErr * (0.5 + r())
      legN++
      const d = legN >= H.legs ? LINE : pos.d - (pos.d - LINE) / Math.max(1, H.legs - legN + 1)
      const to = { x: HOME + err, d }
      legs.push({ t0: tp + 0.1, t1: th + H.split, from: { ...pos }, to, th })
      pos = to
    }
    const path = (t) => {
      let p = { x: HOME, d: serving ? 6.6 : 6.4 }
      for (const L of legs) {
        if (t < L.t0) break
        const u = Math.min(1, (t - L.t0) / Math.max(0.05, L.t1 - L.t0))
        // out wide, then back to the spot: x swings by AMP mid-leg
        const sw = Math.sin(Math.PI * u) * AMP * (L.to.x >= HOME ? 1 : -1)
        p = { x: L.from.x + (L.to.x - L.from.x) * u + sw, d: L.from.d + (L.to.d - L.from.d) * u }
      }
      return p
    }
    const end = times[hits - 1] + 0.6
    const stacked = r() < H.stacked
    for (let t = start; t <= end + 1e-6; t += 1 / 15) {
      const p = path(t)
      players[0].samples.push({ t: +t.toFixed(3), x: +p.x.toFixed(3), z: +p.d.toFixed(3) })
      players[1].samples.push({ t: +t.toFixed(3), x: -HOME, z: +(stacked && t > times[trigger] + 1.5 ? Math.min(6.6, p.d + 2.6) : p.d).toFixed(3) })
      players[2].samples.push({ t: +t.toFixed(3), x: -1.3, z: -(KITCHEN + 0.4) })
      players[3].samples.push({ t: +t.toFixed(3), x: 1.3, z: -(KITCHEN + 0.4) })
    }
    // truth: arrival at the line after the trigger (continuous path)
    const t0 = times[trigger]
    for (let t = t0; t <= end; t += 0.005) {
      if (path(t).d <= AT_LINE) {
        truth.arrivals.push(t - t0)
        break
      }
    }
    // hits
    const Hs = []
    for (let i = 0; i < hits; i++) {
      const t = times[i]
      if (mine(i)) {
        const p = path(t)
        let kind = i === 0 ? "serve" : i === 1 ? "return" : i === 2 ? "drop" : p.d < 3.8 ? "dink" : "drive"
        let height = 0.7
        if (kind === "dink" && i >= 3 && r() < 0.25) {
          kind = "drive"
          height = r() < H.highSpeedups ? 1.15 : 0.6
        }
        Hs.push({ t: +t.toFixed(3), player: 0, team: 0, kind, side: 1, x: +p.x.toFixed(2), z: +p.d.toFixed(2), height, bounced: true, source: "sound" })
      } else {
        const prev = Hs[i - 1]
        let z = -(KITCHEN + 0.4)
        let bounced = true
        let kind = "dink"
        if (i === 0) (kind = "serve"), (z = -6.6)
        else if (i === 1) (kind = "return"), (z = -H.serveDepth)
        else if (i === 3 && prev?.kind === "drop") {
          const good = r() < H.thirdGood
          truth.third.push(good)
          z = good ? -(KITCHEN + 0.3) : -(KITCHEN + 0.2)
          bounced = good
          kind = good ? "dink" : "volley"
        } else if (i === 2) (kind = "drop"), (z = -H.returnDepth)
        Hs.push({ t: +t.toFixed(3), player: r() < 0.5 ? 2 : 3, team: 1, kind, side: 1, x: (r() - 0.5) * 2, z: +z.toFixed(2), height: 0.7, bounced, source: "sound" })
        // the returner's contact depth on their serve; the server's on their return
        if (i === 1 && serving) truth.serveDepths.push(H.serveDepth)
        if (i === 2 && !serving) truth.returnDepths.push(H.returnDepth)
        // paddle height as they hit (only counted at the net)
        const p = path(t)
        const up = r() < H.readyUp
        players[0].ready.push({ t: +t.toFixed(3), h: up ? 0.7 : 0.1 })
        if (p.d <= 3.6) truth.readyUp.push(up)
        if (i >= 3) truth.stackedAt.push(stacked && t > times[trigger] + 1.5)
      }
    }
    // recovery truth: |x - spot| at the other side's next contact after each of their hits
    for (const L of legs) truth.recoveries.push(Math.abs(path(L.th).x - HOME))
    if (serving) truth.recoveries.push(0) // (after the serve they're still on their spot as it's returned)
    // a dink error ends some rallies on their dink
    let last = Hs.length - 1
    if (r() < H.dinkErr * 3) {
      const k = Hs.findLastIndex((h) => h.player === 0 && h.kind === "dink")
      if (k > 3) last = k
    }
    const kept = Hs.slice(0, last + 1)
    // (the ready entries after the end don't count)
    out.push({ id: ri, start: +start.toFixed(3), end: +(kept.at(-1).t + 0.6).toFixed(3), lastHitter: kept.at(-1).player, hits: kept })
    T = end + 3
  }
  const median = (a) => {
    const s = [...a].sort((x, y) => x - y)
    return s.length ? (s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null
  }
  const share = (a) => (a.length ? a.filter(Boolean).length / a.length : null)
  return {
    analysis: { v: 1, duration: T, frames: 0, calibration: null, onsets: 0, soundOffset: 0, players, rallies: out, stats: null },
    truth: { kitchen: median(truth.arrivals), recovery: median(truth.recoveries), ready: share(truth.readyUp), third: share(truth.third), spacing: 1 - share(truth.stackedAt), serve: H.serveDepth, return: H.returnDepth, splitOnTime: H.split >= -0.25 && H.split <= 0.12 },
  }
}
