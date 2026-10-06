// Twin Replay test kit: a scripted doubles rally "filmed" by a pinhole camera on the fence
// behind the near baseline. Gives what the pose model would see (people with 33 landmarks
// in pixels plus world landmarks, per frame), a soundtrack with paddle pops (and duller
// bounces, footsteps and noise), and the ground truth to compare against. Used by the unit
// tests and the in-browser end-to-end check.

import { HALF_L, KITCHEN } from "../physics.js"
import { addPop } from "./core/onsets.js"

// ---------- a pinhole camera ----------
export const makeCamera = ({ pos = { x: 0.4, y: 3.2, z: HALF_L + 4.2 }, look = { x: 0, y: 0, z: -1.0 }, fov = 62, width = 640, height = 360 } = {}) => {
  const f = { x: look.x - pos.x, y: look.y - pos.y, z: look.z - pos.z }
  const fl = Math.hypot(f.x, f.y, f.z)
  f.x /= fl
  f.y /= fl
  f.z /= fl
  // right = f x up (looking along -z: +x), up' = right x f
  const r = { x: -f.z, y: 0, z: f.x }
  const rl = Math.hypot(r.x, r.z)
  r.x /= rl
  r.z /= rl
  const u = { x: r.y * f.z - r.z * f.y, y: r.z * f.x - r.x * f.z, z: r.x * f.y - r.y * f.x }
  const fpx = height / 2 / Math.tan(((fov / 2) * Math.PI) / 180)
  const project = (p) => {
    const d = { x: p.x - pos.x, y: p.y - pos.y, z: p.z - pos.z }
    const cz = d.x * f.x + d.y * f.y + d.z * f.z
    if (cz < 0.1) return null
    const cx = d.x * r.x + d.y * r.y + d.z * r.z
    const cy = d.x * u.x + d.y * u.y + d.z * u.z
    return { x: width / 2 + (fpx * cx) / cz, y: height / 2 - (fpx * cy) / cz }
  }
  return { project, width, height, pos }
}

// ---------- the script ----------
// A deterministic rally: serve from the near right, return, third-shot drop, a dink exchange,
// a speed-up and volleys. Players: 0, 1 (team 0, near: +z), 2, 3 (team 1, far).
export const scriptRally = ({ t0 = 1.5 } = {}) => {
  const B = HALF_L - 0.4
  // hit list: [time offset, player, x, z, height, kind]
  const plan = [
    [0.0, 0, 1.2, B + 0.5, 0.7, "serve"],
    [1.35, 2, -1.3, -B, 0.85, "return"],
    [2.75, 1, -1.2, B - 0.6, 0.6, "drop"],
    [4.15, 3, 1.3, -(KITCHEN + 0.2), 0.35, "dink"],
    [5.45, 0, 1.4, KITCHEN + 0.3, 0.3, "dink"],
    [6.7, 2, -1.1, -(KITCHEN + 0.25), 0.32, "dink"],
    [7.9, 1, -1.3, KITCHEN + 0.25, 1.0, "volley"],
    [8.55, 3, 1.2, -(KITCHEN + 0.3), 1.05, "volley"],
    [9.15, 0, 1.3, KITCHEN + 0.3, 1.1, "volley"],
  ]
  const hits = plan.map(([dt, player, x, z, height, kind]) => ({ t: t0 + dt, player, team: player < 2 ? 0 : 1, x, z, height, kind }))
  // each player's path: where they stand at their hits, moving between, plus the partner
  // moving in parallel; before the serve everyone in their starting spots
  const start = [
    { x: 1.2, z: B + 0.5 },
    { x: -1.5, z: B - 0.3 },
    { x: -1.3, z: -B },
    { x: 1.6, z: -(KITCHEN + 0.4) },
  ]
  const keys = start.map((s) => [{ t: 0, x: s.x, z: s.z }])
  for (const h of hits) keys[h.player].push({ t: h.t, x: h.x, z: h.z })
  // (partners move up with their hitter: team 0 to the kitchen after the drop, etc.)
  keys[0].push({ t: t0 + 3.6, x: 1.4, z: KITCHEN + 0.3 })
  keys[1].push({ t: t0 + 3.9, x: -1.3, z: KITCHEN + 0.3 })
  keys[2].push({ t: t0 + 2.6, x: -1.2, z: -(KITCHEN + 0.3) })
  for (const k of keys) k.sort((a, b) => a.t - b.t)
  const end = t0 + 11
  for (const k of keys) k.push({ t: end, x: k[k.length - 1].x, z: k[k.length - 1].z })
  const posAt = (p, t) => {
    const k = keys[p]
    if (t <= k[0].t) return { x: k[0].x, z: k[0].z }
    for (let i = 1; i < k.length; i++) {
      if (t <= k[i].t) {
        const u = (t - k[i - 1].t) / Math.max(1e-6, k[i].t - k[i - 1].t)
        // (eased: players accelerate and stop)
        const e = u * u * (3 - 2 * u)
        return { x: k[i - 1].x + (k[i].x - k[i - 1].x) * e, z: k[i - 1].z + (k[i].z - k[i - 1].z) * e }
      }
    }
    return { x: k[k.length - 1].x, z: k[k.length - 1].z }
  }
  return { hits, posAt, end, players: 4 }
}

// ---------- what the model "sees" ----------
// One person's 33 world-space joints (meters, court frame, y up) at a court spot, facing the
// net, the paddle wrist swinging through `swingU` (-1 .. 1, 0 at contact) with contact height
const body = (x, z, team, swing, contactH) => {
  const face = team === 0 ? -1 : 1 // toward the net in z
  const right = team === 0 ? 1 : -1 // their right in court x
  const j = new Array(33)
  const P = (dx, y, dz) => ({ x: x + dx * right, y, z: z + dz * face })
  j[0] = P(0, 1.66, 0.05)
  for (let i = 1; i <= 10; i++) j[i] = P(0, 1.62, 0.04)
  j[11] = P(-0.2, 1.42, 0)
  j[12] = P(0.2, 1.42, 0)
  j[13] = P(-0.28, 1.16, 0.05)
  j[14] = P(0.3, 1.16, 0.08)
  j[15] = P(-0.3, 0.95, 0.15)
  // the paddle (right) wrist: resting in front, or swinging through an arc to the contact
  if (swing !== null) {
    const u = Math.max(-1, Math.min(1, swing))
    // (fast through contact, like a real stroke: the wrist peaks around 8 m/s)
    const ang = 1.3 * Math.tanh(u * 6)
    const arcAt = P(0.25 + 0.45 * Math.cos(ang), contactH + 0.1 * Math.sin(ang), 0.45 * Math.sin(ang) + 0.2)
    const rest = P(0.3, 1.0, 0.25)
    // (in from the rest pose and back out smoothly at the window's ends)
    const a = Math.min(1, Math.max(0, (Math.abs(u) - 0.55) / 0.45))
    const w = 1 - a * a * (3 - 2 * a)
    j[16] = { x: rest.x + (arcAt.x - rest.x) * w, y: rest.y + (arcAt.y - rest.y) * w, z: rest.z + (arcAt.z - rest.z) * w }
  } else j[16] = P(0.3, 1.0, 0.25)
  for (let i = 17; i <= 22; i++) j[i] = i % 2 ? j[15] : j[16]
  j[23] = P(-0.12, 0.95, 0)
  j[24] = P(0.12, 0.95, 0)
  j[25] = P(-0.15, 0.5, 0.05)
  j[26] = P(0.15, 0.5, 0.05)
  j[27] = P(-0.16, 0.08, 0)
  j[28] = P(0.16, 0.08, 0)
  j[29] = P(-0.16, 0.03, -0.06)
  j[30] = P(0.16, 0.03, -0.06)
  j[31] = P(-0.16, 0.02, 0.14)
  j[32] = P(0.16, 0.02, 0.14)
  return j
}

// people per frame: { t, people: [{ lm (pixels + v), world (hip-centred, y down), truth }] }
export const filmRally = (script, cam, { fps = 15, noisePx = 1.2, seed = 7 } = {}) => {
  let s = seed
  const rnd = () => {
    s = (s * 16807) % 2147483647
    return s / 2147483647 - 0.5
  }
  const frames = []
  for (let t = 0; t <= script.end; t += 1 / fps) {
    const people = []
    for (let p = 0; p < script.players; p++) {
      const at = script.posAt(p, t)
      const team = p < 2 ? 0 : 1
      // the swing: within 0.35 s of this player's hit
      const h = script.hits.find((q) => q.player === p && Math.abs(q.t - t) < 0.6)
      const swing = h ? (t - h.t) / 0.6 : null
      const joints = body(at.x, at.z, team, swing, h ? h.height : 1)
      const lm = joints.map((q) => {
        const px = cam.project(q)
        return px ? { x: px.x + rnd() * noisePx * 2, y: px.y + rnd() * noisePx * 2, v: 0.95 } : { x: 0, y: 0, v: 0 }
      })
      const hip = { x: (joints[23].x + joints[24].x) / 2, y: (joints[23].y + joints[24].y) / 2, z: (joints[23].z + joints[24].z) / 2 }
      const world = joints.map((q) => ({ x: q.x - hip.x, y: -(q.y - hip.y), z: q.z - hip.z }))
      people.push({ lm, world, truth: { player: p, x: at.x, z: at.z } })
    }
    // (the model returns people in no particular order)
    people.sort(() => rnd())
    frames.push({ t, people })
  }
  return frames
}

// the soundtrack: pops at the hits, duller thumps at bounces, footsteps, noise
export const soundtrack = (script, { rate = 22050, bounces = [] } = {}) => {
  const n = Math.ceil((script.end + 1) * rate)
  const x = new Float32Array(n)
  let s = 3
  const rnd = () => {
    s = (s * 16807) % 2147483647
    return s / 2147483647 - 0.5
  }
  for (let i = 0; i < n; i++) x[i] = rnd() * 0.02
  // footsteps: low thumps every ~0.3 s
  for (let t = 0.2; t < script.end; t += 0.31) {
    const st = Math.round(t * rate)
    for (let i = 0; i < 0.03 * rate && st + i < n; i++) x[st + i] += 0.08 * Math.exp(-i / (0.008 * rate)) * Math.sin((2 * Math.PI * 120 * i) / rate)
  }
  // bounces: a softer, lower knock
  for (const b of bounces) {
    const st = Math.round(b * rate)
    for (let i = 0; i < 0.02 * rate && st + i < n; i++) x[st + i] += 0.12 * Math.exp(-i / (0.004 * rate)) * Math.sin((2 * Math.PI * 700 * i) / rate)
  }
  script.hits.forEach((h, k) => addPop(x, rate, h.t, 0.55, k + 1))
  return { samples: x, rate }
}

// the court corners as the camera sees them (the user's taps)
export const cornerTaps = (cam, jitter = 0) => {
  const W = 6.096 / 2
  const pts = [
    ["nearLeft", -W, HALF_L],
    ["nearRight", W, HALF_L],
    ["farRight", W, -HALF_L],
    ["farLeft", -W, -HALF_L],
  ]
  return pts.map(([id, x, z], i) => {
    const p = cam.project({ x, y: 0, z })
    return { id, x: p.x + (i % 2 ? jitter : -jitter), y: p.y + (i < 2 ? jitter : -jitter) }
  })
}
