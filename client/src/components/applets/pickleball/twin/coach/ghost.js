// Coach: the "ghost": a see-through athlete doing it the pro way beside you in a Twin Replay
// moment. It follows your own path, except near the moment, where it moves the way a Pro
// level player would (the game's Pro speed, ai.js): straight to the kitchen line, a split
// step that lands right as they hit, back to the middle of its half, side by side with your
// partner. Pure (no DOM): Replay frames in, ghost situations out.

import { KITCHEN, HALF_W } from "../core/homography.js"

export const GHOST_KINDS = ["kitchen", "split", "recover", "spacing"]
const PRO_SPEED = 4.2 // m/s (ai.js LEVELS.pro.speed)
const LINE = KITCHEN + 0.35 // where a pro stands at the line (m from the net)
const BLEND = 0.5 // s to drift back onto your path after the moment

// frames: Replay frames ({ t, dt, players: [situation] }); idx: the player's index in them;
// analysis: the game (rallies, players); moment: { t, ghost }. Returns [situation] (one per frame).
export const ghostSituations = (frames, idx, analysis, moment) => {
  const P = analysis.players[idx]
  const team = P.team
  const mate = analysis.players.find((p) => p.team === team && p !== P)
  const mateIdx = mate ? analysis.players.indexOf(mate) : -1
  const rally = analysis.rallies.find((r) => moment.t >= r.start - 0.5 && moment.t <= r.end + 0.5) || null
  const oppHits = (rally?.hits || []).filter((h) => h.team !== team).map((h) => h.t)
  const sign = Math.sign(frames[0]?.players[idx]?.z || (team === 0 ? 1 : -1)) || 1
  const t0 = moment.t
  const t1 = Math.min((rally?.end ?? t0 + 3) + 0.3, t0 + 4.5)

  // the target the ghost heads for at time t (null: just follow you)
  const targetAt = (t, me, mateS) => {
    if (t < t0 - 0.05 || t > t1) return null
    if (moment.ghost === "kitchen") return { x: me.x, z: sign * LINE }
    if (moment.ghost === "recover") {
      const home = mateS ? (mateS.x > me.x ? -HALF_W / 2 : HALF_W / 2) : 0
      return { x: home, z: me.z }
    }
    if (moment.ghost === "spacing" && mateS) {
      const side = me.x >= mateS.x ? 1 : -1
      return { x: Math.max(-HALF_W + 0.4, Math.min(HALF_W - 0.4, mateS.x + side * 2.9)), z: mateS.z }
    }
    return null
  }
  // a split step: still for a moment right at each of their contacts
  const splitting = (t) => moment.ghost !== "recover" && oppHits.some((h) => t >= h - 0.08 && t <= h + 0.06)

  const out = []
  let g = null
  let blendFrom = null
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]
    const me = f.players[idx]
    if (!me) {
      out.push(null)
      continue
    }
    const t = f.t
    const dt = f.dt || 1 / 30
    if (!g) g = { x: me.x, z: me.z }
    const prev = { ...g }
    let tgt = moment.ghost === "split" ? null : targetAt(t, me, mateIdx >= 0 ? f.players[mateIdx] : null)
    if (moment.ghost === "split" && t >= t0 - 0.6 && t <= t1) {
      // your path, but standing still through their contact and catching up after
      tgt = splitting(t) ? { x: g.x, z: g.z } : { x: me.x, z: me.z }
    }
    if (tgt) {
      blendFrom = null
      if (splitting(t) && moment.ghost !== "split") {
        // (a pro splits on the way in too)
      } else {
        const dx = tgt.x - g.x
        const dz = tgt.z - g.z
        const d = Math.hypot(dx, dz)
        const step = PRO_SPEED * dt * (moment.ghost === "split" ? 1.25 : 1)
        if (d > step) (g.x += (dx / d) * step), (g.z += (dz / d) * step)
        else (g.x = tgt.x), (g.z = tgt.z)
      }
    } else if (t > t1) {
      // back onto your path, smoothly
      blendFrom ||= { t, x: g.x, z: g.z }
      const u = Math.min(1, (t - blendFrom.t) / BLEND)
      g.x = blendFrom.x + (me.x - blendFrom.x) * u
      g.z = blendFrom.z + (me.z - blendFrom.z) * u
    } else {
      g.x = me.x
      g.z = me.z
    }
    out.push({ ...me, x: g.x, z: g.z, vx: (g.x - prev.x) / dt, vz: (g.z - prev.z) / dt, holding: false, swing: null, prep: null })
  }
  return out
}
