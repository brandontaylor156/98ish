// Twin Replay -> Pickleball 98: the frames the game's replay player animates. For every
// frame (30 a second) and every player, a "situation" (anim.js updateAnim's input, the same
// shape the game's own replays record): where they are and how fast they move, the ball, and
// around each of their hits the coming contact (prep: the backswing) and the swing after it.
// The skinned athletes then move like the game's own players (motion matching + strokes),
// along the real players' tracked paths.

import { ballAt } from "./ballpath.js"
import { sampleAt } from "./tracker.js"

export const FPS = 30

// the game's stroke kinds (strokes.js) for our shot kinds
export const STROKE = { serve: "serve", return: "drive", drive: "drive", drop: "drop", dink: "dink", volley: "punch", overhead: "smash", lob: "lob" }

// analysis: { players: [{ id, team, hand, samples }], rallies: [{ hits, start, end }],
//   paths: [{ segments }] (one per rally) }
// Returns { frames: [{ players: [situation], ball, dt, t }], duration, t0 }
export const buildFrames = (analysis, { from = null, to = null, fps = FPS } = {}) => {
  const { players, rallies, paths } = analysis
  const start = from ?? Math.max(0, (rallies[0]?.start ?? 0) - 1.5)
  const end = to ?? (rallies.length ? rallies[rallies.length - 1].end + 2.5 : (players[0]?.samples.at(-1)?.t ?? 0))
  const allHits = rallies.flatMap((r, ri) => r.hits.map((h, i) => ({ ...h, rally: ri, i, contact: paths[ri]?.contacts?.[i] })))
  const segs = paths.flatMap((p) => p.segments)
  const frames = []
  const dt = 1 / fps
  let lastBall = { x: 0, y: 0.04, z: 0 }
  for (let t = start; t <= end; t += dt) {
    const rally = rallies.find((r) => t >= r.start - 1.2 && t <= r.end + 1.6) || null
    const ri = rally ? rallies.indexOf(rally) : -1
    let ball = ballAt(segs, t)
    // before the serve the ball is in the server's hand; after a rally it rests where it landed
    const serve = rally?.hits[0]
    let holder = null
    if (!ball && rally && serve && t < serve.t) holder = serve.player
    if (ball) lastBall = ball
    const situations = players.map((p) => {
      const at = sampleAt(p.samples, t) || { x: 0, z: p.team === 0 ? 6 : -6, vx: 0, vz: 0 }
      const facing = p.team === 0 ? Math.PI : 0
      const mine = allHits.filter((h) => h.player === p.id)
      // the swing after this player's last hit (0.75 s), the prep before their next (0.65 s)
      let swing = null
      let prep = null
      for (const h of mine) {
        const c = h.contact || { x: h.x, y: h.height, z: h.z }
        if (t >= h.t && t - h.t < 0.75) swing = { t: t - h.t, kind: STROKE[h.kind] || "drive", hand: h.side || "fh", x: c.x, y: c.y, z: c.z, n: { x: 0, y: 0.15, z: p.team === 0 ? -1 : 1 }, id: h.rally * 100 + h.i + 1 }
        if (h.t > t && h.t - t < 0.65 && !prep) prep = { ttc: h.t - t, x: c.x, y: c.y, z: c.z, kind: STROKE[h.kind] || "drive", hand: h.side || "fh", forward: true, volley: !h.bounced, id: h.rally * 100 + h.i + 1 }
      }
      // the other side's next hit (the split step)
      let oppHit = null
      for (const h of allHits) {
        if (h.team === p.team || h.t <= t) continue
        oppHit = h.t - t < 1.5 ? h.t - t : null
        break
      }
      const mate = players.find((q) => q !== p && q.team === p.team)
      const across = players.filter((q) => q.team !== p.team).map((q) => ({ q, at: sampleAt(q.samples, t) })).sort((a, b) => Math.hypot(a.at.x - at.x, a.at.z - at.z) - Math.hypot(b.at.x - at.x, b.at.z - at.z))[0]
      const mateAt = mate ? sampleAt(mate.samples, t) : null
      return {
        x: at.x,
        z: at.z,
        vx: at.vx,
        vz: at.vz,
        facing,
        ball: ball || lastBall,
        holding: holder === p.id,
        swing,
        prep,
        charging: false,
        between: !rally,
        atNet: Math.abs(at.z) < 3.4,
        goal: null,
        hand: p.hand === -1 ? -1 : 1,
        twoHand: false,
        oppHit,
        want: { x: at.vx, z: at.vz },
        id: `p${p.id}`,
        phase: rally ? (serve && t < serve.t ? "serve" : "rally") : "dead",
        phaseT: rally ? t - rally.start : 0,
        point: Math.max(0, ri),
        mate: mateAt ? { x: mateAt.x, z: mateAt.z, id: `p${mate.id}` } : null,
        across: across ? { x: across.at.x, z: across.at.z, id: `p${across.q.id}` } : null,
        receiving: false,
      }
    })
    // (the ball in a hand: the engine draws it at the holder's free hand)
    const shown = ball || lastBall
    frames.push({ t, dt, players: situations, ball: { x: shown.x, y: shown.y, z: shown.z }, held: holder !== null })
  }
  return { frames, t0: start, duration: end - start }
}

// the hits between two times (for sounds and the timeline's markers)
export const hitsBetween = (rallies, a, b) => rallies.flatMap((r) => r.hits).filter((h) => h.t >= a && h.t < b)
