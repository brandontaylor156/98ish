// Twin Replay: who's who across frames. Each frame the pose model gives up to N people (2D
// landmarks in image pixels, maybe 3D world landmarks); this keeps four (or two) player
// identities through the video:
// - each person's court position = their feet through the homography
// - assignment by the Hungarian method on a cost of court distance (against each track's
//   predicted position) plus a color difference (a small torso color histogram, so partners
//   crossing paths keep their names)
// - one-euro filtering of the court path (smooth when slow, responsive when fast)
// - people off the court (spectators, players on the next court) are ignored: feet more than
//   MARGIN outside the court's lines

import { applyH, HALF_L, HALF_W } from "./homography.js"

// MediaPipe Pose's 33 landmarks (the ones used here)
export const LM = { nose: 0, lShoulder: 11, rShoulder: 12, lElbow: 13, rElbow: 14, lWrist: 15, rWrist: 16, lHip: 23, rHip: 24, lKnee: 25, rKnee: 26, lAnkle: 27, rAnkle: 28, lHeel: 29, rHeel: 30, lToe: 31, rToe: 32 }
export const MARGIN = 2.6 // m outside the lines a player can still be (deep returns, wide balls)

// ---------- the Hungarian method (rectangular cost matrices, minimizing) ----------
// cost[i][j]: rows = tracks, cols = detections. Returns assign[i] = j or -1.
export const hungarian = (cost) => {
  const nr = cost.length
  const nc = nr ? cost[0].length : 0
  if (!nr || !nc) return new Array(nr).fill(-1)
  const n = Math.max(nr, nc)
  const BIG = 1e9
  const a = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i < nr && j < nc ? cost[i][j] : 0)))
  // (1-indexed potentials, Kuhn-Munkres O(n^3))
  const u = new Array(n + 1).fill(0)
  const v = new Array(n + 1).fill(0)
  const p = new Array(n + 1).fill(0)
  const way = new Array(n + 1).fill(0)
  for (let i = 1; i <= n; i++) {
    p[0] = i
    let j0 = 0
    const minv = new Array(n + 1).fill(BIG)
    const used = new Array(n + 1).fill(false)
    do {
      used[j0] = true
      const i0 = p[j0]
      let delta = BIG
      let j1 = 0
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue
        const cur = a[i0 - 1][j - 1] - u[i0] - v[j]
        if (cur < minv[j]) {
          minv[j] = cur
          way[j] = j0
        }
        if (minv[j] < delta) {
          delta = minv[j]
          j1 = j
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]] += delta
          v[j] -= delta
        } else minv[j] -= delta
      }
      j0 = j1
    } while (p[j0] !== 0)
    do {
      const j1 = way[j0]
      p[j0] = p[j1]
      j0 = j1
    } while (j0)
  }
  const assign = new Array(nr).fill(-1)
  for (let j = 1; j <= n; j++) if (p[j] && p[j] - 1 < nr && j - 1 < nc) assign[p[j] - 1] = j - 1
  return assign
}

// ---------- one-euro filter ----------
export const oneEuro = ({ minCutoff = 1.2, beta = 0.6, dCutoff = 1.0 } = {}) => {
  let x = null
  let dx = 0
  let lastT = null
  const alpha = (cutoff, dt) => {
    const r = 2 * Math.PI * cutoff * dt
    return r / (r + 1)
  }
  return (value, t) => {
    if (x === null) {
      x = value
      lastT = t
      return x
    }
    const dt = Math.max(1e-3, t - lastT)
    lastT = t
    const d = (value - x) / dt
    dx += alpha(dCutoff, dt) * (d - dx)
    const cutoff = minCutoff + beta * Math.abs(dx)
    x += alpha(cutoff, dt) * (value - x)
    return x
  }
}

// ---------- a person's measurements ----------
const vis = (lm, i) => (lm[i] && (lm[i].v ?? lm[i].visibility ?? 1)) || 0
// the ground point under a person in image pixels: the lower visible foot points
export const footPoint = (lm) => {
  const ids = [LM.lHeel, LM.rHeel, LM.lAnkle, LM.rAnkle, LM.lToe, LM.rToe]
  let x = 0
  let y = 0
  let w = 0
  for (const i of ids) {
    const v = vis(lm, i)
    if (!lm[i] || v < 0.3) continue
    x += lm[i].x * v
    y += lm[i].y * v
    w += v
  }
  if (w > 0) return [x / w, y / w]
  // (feet hidden: the hips, dropped by about a leg's length in the image: the shoulder-hip span)
  const hip = mid(lm[LM.lHip], lm[LM.rHip])
  const sh = mid(lm[LM.lShoulder], lm[LM.rShoulder])
  if (!hip || !sh) return null
  return [hip[0], hip[1] + 1.6 * Math.abs(hip[1] - sh[1])]
}
const mid = (a, b) => (a && b ? [(a.x + b.x) / 2, (a.y + b.y) / 2] : null)

// height of the paddle hand above the ground (m) from 3D world landmarks (MediaPipe's world
// frame: meters, origin at the hips, y pointing down), or from 2D (scaled by the body's own
// image height) when there are none. hand: "l" | "r" | best (the higher)
export const handHeight = (person, hand = null) => {
  const w = person.world
  const pick = (l, r) => (hand === "l" ? l : hand === "r" ? r : Math.max(l, r))
  if (w && w.length >= 33) {
    const ground = Math.max(w[LM.lAnkle].y, w[LM.rAnkle].y, w[LM.lHeel]?.y ?? -9, w[LM.rHeel]?.y ?? -9) + 0.07
    return Math.max(0, pick(ground - w[LM.lWrist].y, ground - w[LM.rWrist].y))
  }
  const lm = person.lm
  const foot = footPoint(lm)
  const head = lm[LM.nose]
  if (!foot || !head) return 1
  const px = Math.max(1, foot[1] - head.y) // pixels for ~1.62 m (feet to nose)
  const h = (y) => ((foot[1] - y) / px) * 1.62
  return Math.max(0, pick(h(lm[LM.lWrist].y), h(lm[LM.rWrist].y)))
}

// a coarse color signature of the torso (shirt): 4x4x4 RGB bins, normalized; computed by the
// caller from the frame's pixels (colorAt) inside the shoulder-hip box
export const torsoColor = (lm, sample) => {
  const ids = [LM.lShoulder, LM.rShoulder, LM.lHip, LM.rHip]
  if (!sample || ids.some((i) => !lm[i])) return null
  const hist = new Float32Array(64)
  let n = 0
  for (let a = 0.2; a <= 0.8; a += 0.15) {
    for (let b = 0.15; b <= 0.85; b += 0.175) {
      // bilinear in the torso quad
      const top = { x: lm[LM.lShoulder].x + (lm[LM.rShoulder].x - lm[LM.lShoulder].x) * a, y: lm[LM.lShoulder].y + (lm[LM.rShoulder].y - lm[LM.lShoulder].y) * a }
      const bot = { x: lm[LM.lHip].x + (lm[LM.rHip].x - lm[LM.lHip].x) * a, y: lm[LM.lHip].y + (lm[LM.rHip].y - lm[LM.lHip].y) * a }
      const c = sample(top.x + (bot.x - top.x) * b, top.y + (bot.y - top.y) * b)
      if (!c) continue
      hist[(c[0] >> 6) * 16 + (c[1] >> 6) * 4 + (c[2] >> 6)] += 1
      n++
    }
  }
  if (!n) return null
  for (let i = 0; i < 64; i++) hist[i] /= n
  return hist
}
export const colorDistance = (a, b) => {
  if (!a || !b) return 0.5
  let s = 0
  for (let i = 0; i < 64; i++) s += Math.min(a[i], b[i])
  return 1 - s // 0 same .. 1 nothing shared
}

// ---------- the tracker ----------
// opts: { players: 4 | 2, H (image->court) }
// step(t, people): people [{ lm: [{x, y, v}] (pixels), world?: [{x, y, z}], color?: hist }]
// Returns the tracks: [{ id, team, samples: [{ t, x, z, rawX, rawZ, hand, world, lm }] }]
export const createTracker = ({ players = 4, H }) => {
  const tracks = []
  const MAX_JUMP = 2.2 // m between samples (a lunge at 15 fps is ~0.5 m)
  const step = (t, people) => {
    const dets = []
    for (const person of people || []) {
      const f = footPoint(person.lm)
      if (!f) continue
      const c = applyH(H, f[0], f[1])
      if (!c) continue
      const [x, z] = c
      if (Math.abs(x) > HALF_W + MARGIN || Math.abs(z) > HALF_L + MARGIN + 1.5) continue
      dets.push({ x, z, person })
    }
    // start the tracks from the first frames that see enough people: nearest first
    if (tracks.length < players) {
      for (const d of dets) {
        if (tracks.length >= players) break
        if (tracks.some((tr) => Math.hypot(tr.x - d.x, tr.z - d.z) < 0.8)) continue
        tracks.push(newTrack(tracks.length, d, t))
      }
      return tracks
    }
    const cost = tracks.map((tr) => {
      const age = Math.max(0, t - tr.lastT)
      const px = tr.x + tr.vx * Math.min(age, 0.5)
      const pz = tr.z + tr.vz * Math.min(age, 0.5)
      return dets.map((d) => {
        const dist = Math.hypot(d.x - px, d.z - pz)
        // (players never cross the net mid-rally: a big cost for switching sides)
        const side = Math.sign(d.z) !== Math.sign(tr.z) && Math.abs(d.z) > 0.6 && Math.abs(tr.z) > 0.6 ? 3 : 0
        return dist + side + 1.5 * colorDistance(tr.color, d.person.color)
      })
    })
    const assign = hungarian(cost)
    tracks.forEach((tr, i) => {
      const j = assign[i]
      if (j < 0 || cost[i][j] > MAX_JUMP + 1.5 + Math.max(0, t - tr.lastT) * 6) {
        tr.missed++
        return
      }
      addSample(tr, dets[j], t)
    })
    return tracks
  }
  const newTrack = (id, d, t) => {
    const tr = { id, team: d.z >= 0 ? 0 : 1, x: d.x, z: d.z, vx: 0, vz: 0, lastT: t, missed: 0, color: d.person.color || null, fx: oneEuro(), fz: oneEuro(), samples: [] }
    addSample(tr, d, t)
    return tr
  }
  const addSample = (tr, d, t) => {
    const x = tr.fx(d.x, t)
    const z = tr.fz(d.z, t)
    const dt = Math.max(1e-3, t - tr.lastT)
    if (tr.samples.length) {
      tr.vx += ((x - tr.x) / dt - tr.vx) * 0.5
      tr.vz += ((z - tr.z) / dt - tr.vz) * 0.5
    }
    tr.x = x
    tr.z = z
    tr.lastT = t
    tr.missed = 0
    // (the shirt color adapts slowly: lighting changes)
    if (d.person.color) {
      if (!tr.color) tr.color = d.person.color
      else for (let i = 0; i < 64; i++) tr.color[i] = tr.color[i] * 0.9 + d.person.color[i] * 0.1
    }
    tr.samples.push({ t, x, z, rawX: d.x, rawZ: d.z, lm: d.person.lm, world: d.person.world || null })
  }
  return {
    step,
    tracks,
    // teams from where the players spent their time (the near side = team 0)
    finish() {
      for (const tr of tracks) {
        let s = 0
        for (const q of tr.samples) s += Math.sign(q.z)
        tr.team = s >= 0 ? 0 : 1
      }
      return tracks
    },
  }
}

// A track's position at time t (linear between samples, held at the ends): { x, z, vx, vz }
export const sampleAt = (samples, t) => {
  if (!samples.length) return null
  if (t <= samples[0].t) return { x: samples[0].x, z: samples[0].z, vx: 0, vz: 0 }
  const last = samples[samples.length - 1]
  if (t >= last.t) return { x: last.x, z: last.z, vx: 0, vz: 0 }
  let lo = 0
  let hi = samples.length - 1
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1
    if (samples[m].t <= t) lo = m
    else hi = m
  }
  const a = samples[lo]
  const b = samples[hi]
  const u = (t - a.t) / Math.max(1e-6, b.t - a.t)
  const dt = Math.max(1e-3, b.t - a.t)
  // (a gap longer than a second: no velocity across it)
  const gap = dt > 1
  return { x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u, vx: gap ? 0 : (b.x - a.x) / dt, vz: gap ? 0 : (b.z - a.z) / dt }
}
