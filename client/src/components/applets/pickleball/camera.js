// Pickleball 98's camera rules (pure, tested in pb7.test.js): no body in front of the lens,
// and the TV shot of the server between points.
//
// The owner's phone showed the between-points cut as a half-body close-up of the server's
// partner (the old cut sat 2.6 m beside the server, on the partner's side) and, while the
// camera eased back to play, a server's back filling the screen (the camera flew through
// the court and through the server). Now:
// - every game camera goes through clearShot: a player standing close to the camera, or in
//   the first few meters of its view, lifts it and moves it back until the view is clear;
// - the cut is a well framed 3/4 shot from outside the court on the server's own side
//   (their partner is behind them, never in front), and the cut in and out is a cut (snap),
//   never a fly-through.

import { HALF_W } from "./physics.js"
import { sideOf } from "./rules.js"

export const BODY = { r: 0.42, h: 1.95 } // a player as a standing capsule (a little generous)
export const CLEAR = { near: 1.9, ahead: 3.2, step: 0.3, max: 16 }

const hdist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z)

// the first body that blocks the lens: one standing within `near` of the camera (at its
// height), or one in the first `ahead` meters of the line from the camera to what it looks at
export const blocker = (cam, look, bodies, { near = CLEAR.near, ahead = CLEAR.ahead } = {}) => {
  const dx = look.x - cam.x
  const dy = look.y - cam.y
  const dz = look.z - cam.z
  const len = Math.hypot(dx, dy, dz) || 1
  for (const b of bodies) {
    const h = b.h ?? BODY.h
    const r = b.r ?? BODY.r
    if (hdist(cam, b) < near && cam.y < h + 0.6) return b
    // sample the view line out to `ahead`
    for (let s = 0.25; s <= Math.min(ahead, len); s += 0.25) {
      const k = s / len
      const p = { x: cam.x + dx * k, y: cam.y + dy * k, z: cam.z + dz * k }
      if (p.y < h && p.y > 0 && hdist(p, b) < r) return b
    }
  }
  return null
}

// Move a camera position until no body blocks it: up, and away from the blocking body.
// Returns a new { x, y, z } (the same values when nothing was in the way) and how far it moved.
export const clearShot = (cam, look, bodies, opts = {}) => {
  let c = { x: cam.x, y: cam.y, z: cam.z }
  for (let i = 0; i < (opts.max ?? CLEAR.max); i++) {
    const b = blocker(c, look, bodies, opts)
    if (!b) break
    const d = hdist(c, b) || 1
    const away = { x: (c.x - b.x) / d, z: (c.z - b.z) / d }
    c = { x: c.x + away.x * CLEAR.step, y: c.y + CLEAR.step * 1.2, z: c.z + away.z * CLEAR.step }
  }
  return { ...c, moved: Math.hypot(c.x - cam.x, c.y - cam.y, c.z - cam.z) }
}

// The camera eases toward its target, so a clear target isn't enough: on the way there it
// can pass through a player (the owner saw a back fill the screen for a few frames: 3 of
// 2,227 in a test). easeClear moves the camera k of the way to its target and then clears
// where it actually is. Returns { x, y, z, moved } (moved: how far clearing pushed it).
export const easeClear = (cur, target, k, look, bodies, opts = {}) => {
  const p = { x: cur.x + (target.x - cur.x) * k, y: cur.y + (target.y - cur.y) * k, z: cur.z + (target.z - cur.z) * k }
  return clearShot(p, look, bodies, opts)
}

// The TV shot of the server before a serve: from beside the court on the server's own side,
// a little toward the net, at about head height, looking at their chest. `server` { x, z, team }.
export const serverShot = (server, { portrait = false } = {}) => {
  const side = sideOf(server.team)
  const sx = server.x >= 0 ? 1 : -1
  return {
    // (inside the venues' fences, which stand 3.6 m outside the sidelines)
    cam: { x: sx * (HALF_W + 2.6), y: portrait ? 3.0 : 2.3, z: server.z - side * (portrait ? 3.8 : 3.0) },
    look: { x: server.x * 0.7, y: portrait ? 0.9 : 1.05, z: server.z - side * 0.4 },
    fov: portrait ? 56 : 36,
  }
}
