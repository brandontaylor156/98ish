// Tetherball online: two browsers, one match, over the room system's relay (server/arcade/
// games/tetherball.js). Pure JavaScript (tested in tetherball.test.js); Tetherball.jsx wires
// it to the sockets.
//
// The host (seat 0) runs the match (match.js with rewind on). ~30 times a second it sends a
// snapshot (pack): its match time, the ball (position, velocity, the wrap), both players, the
// phase, the games and the last few events. A guest's copy (createMirror):
//   - flies the ball forward from each snapshot to the host's present (dead reckoning with the
//     same physics), so the ball is where it really is, and blends out the jump over ~100 ms;
//   - predicts its own hits: a swing with the ball in reach hits it at once on the guest's
//     screen, and snapshots from before the host saw that hit are ignored for a moment;
//   - sends the swing (reliable relay) with the host time it started; the host rewinds its
//     ball history to that moment (match.remoteSwing).

import { STEP, copyBall, hitBall, stepBall } from "./physics.js"
import { DIRS, inReach } from "./match.js"

export const SNAP_MS = 33
const r3 = (v) => Math.round(v * 1000) / 1000 || 0
const PHASES = ["serve", "play", "point", "over"]

export const pack = (m, eventsSince = []) => {
  const b = m.ball
  return {
    t: r3(m.t),
    b: [r3(b.x), r3(b.y), r3(b.z), r3(b.vx), r3(b.vy), r3(b.vz), r3(b.theta), r3(b.lastAz)],
    p: m.players.map((p) => [r3(p.x), r3(p.z), r3(p.az), r3(p.r), p.swing ? r3(p.swing.t) : -1, r3(p.lastHit), r3(p.vx || 0), r3(p.vz || 0)]),
    ph: PHASES.indexOf(m.phase),
    g: m.games,
    s: m.server,
    h: m.hitCount,
    w: m.winner,
    e: eventsSince.slice(-8),
  }
}

export const unpackBall = (a) => ({ x: a[0], y: a[1], z: a[2], vx: a[3], vy: a[4], vz: a[5], theta: a[6], lastAz: a[7], taut: true, hitPole: 0, hitGround: 0 })

// the guest's picture of the match
export const createMirror = ({ seat = 1, target = 2 } = {}) => {
  const view = {
    t: 0,
    ball: null,
    players: [0, 1].map((i) => ({ seat: i, x: 0, z: i ? -1.1 : 1.1, az: 0, r: 1.1, swing: null, lastHit: -9, vx: 0, vz: 0 })),
    phase: "serve",
    games: [0, 0],
    server: 0,
    winner: null,
    target,
    events: [],
  }
  let last = null // { snap, at (local ms when it came) }
  let predicted = null // { hits, until (local ms) }
  let offset = { x: 0, y: 0, z: 0 }
  let carry = 0
  let seenEvents = 0

  const hostNow = (localMs) => (last ? last.snap.t + (localMs - last.at) / 1000 : 0)

  return {
    view,
    hostNow,
    // a snapshot arrived (localMs = performance.now())
    snap: (s, localMs) => {
      if (!s || !Array.isArray(s.b)) return
      if (last && s.t < last.snap.t) return // out of order
      last = { snap: s, at: localMs }
      view.t = s.t
      view.phase = PHASES[s.ph] || "play"
      view.games = s.g
      view.server = s.s
      view.winner = s.w
      s.p.forEach((a, i) => {
        const p = view.players[i]
        Object.assign(p, { x: a[0], z: a[1], az: a[2], r: a[3], swing: a[4] >= 0 ? { t: a[4] } : null, lastHit: a[5], vx: a[6], vz: a[7] })
      })
      for (const e of s.e || []) {
        if (e.id > seenEvents) {
          seenEvents = e.id
          view.events.push(e)
        }
      }
      // our own hit is on its way to the host: keep our ball until the host has it too
      if (predicted && s.h < predicted.hits && localMs < predicted.until) return
      predicted = null
      const before = view.ball ? { x: view.ball.x + offset.x, y: view.ball.y + offset.y, z: view.ball.z + offset.z } : null
      const ball = unpackBall(s.b)
      // fly it forward to now (it's been on its way for however long the frame took)
      if (view.phase === "play") {
        let t = (localMs - last.at) / 1000
        while (t >= STEP) {
          stepBall(ball, STEP)
          t -= STEP
        }
      }
      view.ball = ball
      offset = before && view.phase === "play" ? { x: before.x - ball.x, y: before.y - ball.y, z: before.z - ball.z } : { x: 0, y: 0, z: 0 }
      if (Math.hypot(offset.x, offset.y, offset.z) > 1.2) offset = { x: 0, y: 0, z: 0 }
    },
    // every frame: keep the ball flying between snapshots, ease the correction away
    step: (dt) => {
      if (!view.ball) return
      view.t += dt
      if (view.phase === "play") {
        let t = carry + dt
        while (t >= STEP) {
          stepBall(view.ball, STEP)
          t -= STEP
        }
        carry = t
      }
      const k = Math.exp(-dt * 12)
      offset = { x: offset.x * k, y: offset.y * k, z: offset.z * k }
    },
    // where to draw the ball
    shown: () => (view.ball ? { ...view.ball, x: view.ball.x + offset.x, y: view.ball.y + offset.y, z: view.ball.z + offset.z } : null),
    // our swing: returns the relay message to send; hits the ball on our screen if it's in reach
    swing: (power, loft, localMs) => {
      const at = hostNow(localMs)
      const me = view.players[seat]
      if (view.ball && view.phase === "play" && inReach(view, me) && view.t - me.lastHit > 0.3) {
        const ball = copyBall(view.ball)
        hitBall(ball, DIRS[seat], power * 0.9, loft)
        view.ball = ball
        me.lastHit = view.t
        predicted = { hits: (last?.snap.h || 0) + 1, until: localMs + 600 }
      }
      me.swing = { t: 0 }
      return { type: "swing", at, power, loft }
    },
    takeEvents: () => {
      const e = view.events
      view.events = []
      return e
    },
  }
}
