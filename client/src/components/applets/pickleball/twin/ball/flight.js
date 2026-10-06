// Real Ball: the ball's real flight, from where the camera saw it.
//
// Twin Replay used to rebuild the ball from the hits alone (core/ballpath.js). Here the ball
// is found in the picture (detect.js) and every flight between two hits is fitted with the
// game's own ball physics (physics.js: gravity, a holed ball's drag, Magnus lift, the court
// bounce), so the 3D path, the bounce and the speeds come from the video. The design follows
// OpenHawk's stage 6 (Apache-2.0: a physics fit with drag and bounce between known hit
// times) with pickleball's numbers.
//
// The camera: Twin Replay calibrates with a homography (image <-> court plane). A ball in the
// air isn't on that plane, so we recover a full pinhole camera from it (square pixels, the
// principal point at the image center: the focal length falls out of the two court axes being
// at right angles, Zhang-style), then any 3D point projects to a pixel.
//
// Court frame: x across, z along (+z the camera's half), y up, meters.

import { BALL_R, COURT_COR, COURT_FRICTION, HALF_L, HALF_W, KITCHEN, flightStep, impact, netHeightAt, v3 } from "../../physics.js"
import { applyH, inv3 } from "../core/homography.js"

const UP = v3(0, 1, 0)

// ---- the camera ----

// H: image px -> court (x, z) (calibrate().H). W, Hh: the image size the taps were made in.
// Returns { f, cx, cy, R: [r1, r2, r3] (court x, z, up axes in camera coordinates), t,
// center (camera position in court meters), project(P) -> [u, v] | null (behind) } or null.
export const cameraFromHomography = (H, W, Hh) => {
  const Hinv = inv3(H)
  if (!Hinv) return null
  const cx = W / 2
  const cy = Hh / 2
  // shift the principal point to the origin: G = T * Hinv, T = [1 0 -cx; 0 1 -cy; 0 0 1]
  const h = (r, c) => Hinv[r * 3 + c]
  const G = [
    [h(0, 0) - cx * h(2, 0), h(0, 1) - cx * h(2, 1), h(0, 2) - cx * h(2, 2)],
    [h(1, 0) - cy * h(2, 0), h(1, 1) - cy * h(2, 1), h(1, 2) - cy * h(2, 2)],
    [h(2, 0), h(2, 1), h(2, 2)],
  ]
  const [a, b] = [0, 1] // columns: court x, court z
  // r1 . r2 = 0  ->  (g0a g0b + g1a g1b) / f^2 + g2a g2b = 0
  const num = -(G[0][a] * G[0][b] + G[1][a] * G[1][b])
  const den = G[2][a] * G[2][b]
  // |r1| = |r2|  ->  (g0a^2 + g1a^2 - g0b^2 - g1b^2) / f^2 = g2b^2 - g2a^2
  const num2 = G[0][a] ** 2 + G[1][a] ** 2 - G[0][b] ** 2 - G[1][b] ** 2
  const den2 = G[2][b] ** 2 - G[2][a] ** 2
  const cands = []
  if (Math.abs(den) > 1e-12 && num / den > 0) cands.push(Math.sqrt(num / den))
  if (Math.abs(den2) > 1e-12 && num2 / den2 > 0) cands.push(Math.sqrt(num2 / den2))
  // a sane focal range for a phone (a 20 mm .. 120 mm equivalent on this image width)
  const ok = cands.filter((f) => f > W * 0.45 && f < W * 4)
  const f = ok.length ? ok.reduce((s, x) => s + x, 0) / ok.length : W * 0.9
  const col = (j) => [G[0][j] / f, G[1][j] / f, G[2][j]]
  let r1 = col(a)
  let r2 = col(b)
  let t = col(2)
  const s = 2 / (norm(r1) + norm(r2))
  r1 = mulv(r1, s)
  r2 = mulv(r2, s)
  t = mulv(t, s)
  // the court must be in front of the camera
  if (t[2] < 0) {
    r1 = mulv(r1, -1)
    r2 = mulv(r2, -1)
    t = mulv(t, -1)
  }
  // orthonormalize r1, r2 (Gram-Schmidt split evenly) and r3 = up
  const r2o = norml(sub3(r2, mulv(r1, dot3(r1, r2) / dot3(r1, r1))))
  r1 = norml(r1)
  r2 = r2o
  let r3 = cross3(r1, r2)
  // up must point toward the camera's side of the court plane: the camera sits above it
  // (camera center C = -R^T t; its up coordinate -r3 . t must be positive)
  if (-dot3(r3, t) < 0) r3 = mulv(r3, -1)
  const R = [r1, r2, r3]
  const center = { x: -dot3(r1, t), z: -dot3(r2, t), y: -dot3(r3, t) }
  const project = (P) => {
    const X = [
      r1[0] * P.x + r2[0] * P.z + r3[0] * P.y + t[0],
      r1[1] * P.x + r2[1] * P.z + r3[1] * P.y + t[1],
      r1[2] * P.x + r2[2] * P.z + r3[2] * P.y + t[2],
    ]
    if (X[2] <= 1e-6) return null
    return [cx + (f * X[0]) / X[2], cy + (f * X[1]) / X[2]]
  }
  // meters per pixel near a court point (for the call's uncertainty)
  const metersPerPixel = (x, z) => {
    const p = project({ x, y: 0, z })
    if (!p) return 0.05
    const q = applyH(H, p[0] + 1, p[1])
    const r = applyH(H, p[0], p[1] + 1)
    return Math.max(Math.hypot(q[0] - x, q[1] - z), Math.hypot(r[0] - x, r[1] - z))
  }
  return { f, cx, cy, R, t, center, project, metersPerPixel, W, H: Hh }
}

const norm = (v) => Math.hypot(v[0], v[1], v[2])
const mulv = (v, s) => [v[0] * s, v[1] * s, v[2] * s]
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norml = (v) => mulv(v, 1 / (norm(v) || 1))

// ---- the flight model ----

export const SIM_DT = 1 / 240

// The ball from P0 with velocity V0 (and spin about the court's x axis, rad/s: + = topspin
// for a ball heading to -z) for T seconds, bouncing on the court. Samples every `dt`.
// Returns { pts: [{ t, x, y, z }], bounces: [{ t, x, z, vin: {x,y,z}, vout }], at(t) }
export const simulate = (P0, V0, T, { spin = 0, dt = SIM_DT, maxBounces = 2 } = {}) => {
  const ball = { p: v3(P0.x, P0.y, P0.z), v: v3(V0.x, V0.y, V0.z), w: v3(spin, 0, 0) }
  const pts = [{ t: 0, x: ball.p.x, y: ball.p.y, z: ball.p.z }]
  const bounces = []
  const n = Math.ceil(T / dt)
  for (let i = 1; i <= n; i++) {
    flightStep(ball, dt)
    if (ball.p.y < BALL_R && ball.v.y < 0) {
      if (bounces.length < maxBounces) {
        const vin = { ...ball.v }
        ball.p.y = BALL_R
        impact(ball, UP, v3(), COURT_COR, COURT_FRICTION)
        bounces.push({ t: i * dt, x: ball.p.x, z: ball.p.z, vin, vout: { ...ball.v } })
      } else {
        ball.p.y = BALL_R
        ball.v.y = 0
      }
    }
    pts.push({ t: i * dt, x: ball.p.x, y: ball.p.y, z: ball.p.z })
  }
  const at = (t) => {
    if (t <= 0) return pts[0]
    const k = t / dt
    const i = Math.min(pts.length - 2, Math.floor(k))
    if (i < 0) return pts[0]
    const f = Math.min(1, k - i)
    const a = pts[i]
    const b = pts[i + 1]
    return { t, x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f }
  }
  return { pts, bounces, at }
}

// The launch velocity that carries the ball from P0 to P1 in T seconds with the game's physics
// (Newton on the 3 velocity components; V0 a starting guess, e.g. ballpath's arc). For the
// demo's camera and for tests. Returns { V0, miss (m) }.
export const aimFlight = (P0, P1, T, V0, { iters = 14 } = {}) => {
  let v = [V0.x, V0.y, V0.z]
  const end = (vv) => {
    const e = simulate(P0, { x: vv[0], y: vv[1], z: vv[2] }, T, { dt: 1 / 240 }).at(T)
    return [e.x - P1.x, e.y - P1.y, e.z - P1.z]
  }
  let r = end(v)
  for (let it = 0; it < iters && Math.hypot(...r) > 0.005; it++) {
    const J = [0, 1, 2].map((j) => {
      const q = v.slice()
      q[j] += 0.01
      const rq = end(q)
      return rq.map((x, i) => (x - r[i]) / 0.01)
    })
    // J[j][i] = d r_i / d v_j  ->  solve (J^T) d = -r
    const A = [0, 1, 2].map((i) => [J[0][i], J[1][i], J[2][i]])
    const d = solveSym(A, r.map((x) => -x))
    if (!d) break
    let step = 1
    for (let k = 0; k < 6; k++) {
      const q = v.map((x, i) => x + d[i] * step)
      const rq = end(q)
      if (Math.hypot(...rq) < Math.hypot(...r)) {
        v = q
        r = rq
        break
      }
      step *= 0.5
    }
  }
  return { V0: { x: v[0], y: v[1], z: v[2] }, miss: Math.hypot(...r) }
}

// the ball at time t on a measured flight segment { t0, t1, flight: { P0, V0, spin } }
// (the simulation is cached on the segment)
const flightCache = new WeakMap()
export const flightAt = (seg, t) => {
  let sim = flightCache.get(seg)
  if (!sim) {
    sim = simulate(seg.flight.P0, seg.flight.V0, Math.max(0.05, seg.t1 - seg.t0), { spin: seg.flight.spin || 0 })
    flightCache.set(seg, sim)
  }
  return sim.at(t - seg.t0)
}

// ---- the fit ----

// Fits one flight (one hit to the next) to what the camera saw.
// obs: [{ t, u, v, w? }] image observations (several per frame allowed: candidates); the fit
//   picks the ones that agree with physics (RANSAC, then Huber-weighted Gauss-Newton).
// t0, t1: the two hits' times. cam: cameraFromHomography(). prior: { P0, V0 } a starting
//   guess (from ballpath.js) and P0's trust (sigma, meters).
// Returns { P0, V0, spin, rms (px), inliers, n, coverage (share of the flight seen),
//   bounces, at(t), conf (0..1) } or null.
export const fitFlight = (obs, { t0, t1, cam, prior, sigmaP0 = 0.6, sigmaP1 = 0.8, inlierPx = null, iters = 12, seed = 1, fitSpin = false } = {}) => {
  const T = Math.max(0.1, t1 - t0)
  const pts = obs.filter((o) => o.t > t0 + 0.015 && o.t < t1 - 0.015)
  if (pts.length < 3 || !cam) return null
  const gate = inlierPx ?? Math.max(4, cam.W / 120)
  const p0 = [prior.P0.x, prior.P0.y, prior.P0.z, prior.V0.x, prior.V0.y, prior.V0.z, 0]
  const nP = fitSpin ? 7 : 6
  const residuals = (p, use, out) => {
    const sim = simulate({ x: p[0], y: p[1], z: p[2] }, { x: p[3], y: p[4], z: p[5] }, T, { spin: fitSpin ? p[6] : 0, dt: 1 / 120 })
    let k = 0
    for (const o of use) {
      const q = sim.at(o.t - t0)
      const pr = cam.project(q)
      const w = o.w ?? 1
      if (!pr) {
        out[k++] = 50 * w
        out[k++] = 50 * w
        continue
      }
      out[k++] = (pr[0] - o.u) * w
      out[k++] = (pr[1] - o.v) * w
    }
    // the hit happens at the hitter: a soft prior on where it starts (px-scaled)
    const sc = cam.f / 12
    out[k++] = ((p[0] - prior.P0.x) / sigmaP0) * sc * 0.15
    out[k++] = ((p[1] - prior.P0.y) / sigmaP0) * sc * 0.15
    out[k++] = ((p[2] - prior.P0.z) / sigmaP0) * sc * 0.15
    if (fitSpin) out[k++] = (p[6] / 60) * sc * 0.05
    // ...and it ends at the next hitter (their tracked spot at the next hit's time)
    if (prior.P1) {
      const e = sim.at(T)
      out[k++] = ((e.x - prior.P1.x) / sigmaP1) * sc * 0.15
      out[k++] = ((e.y - prior.P1.y) / sigmaP1) * sc * 0.15
      out[k++] = ((e.z - prior.P1.z) / sigmaP1) * sc * 0.15
    }
    // a shot that crosses the net clears it (a soft wall)
    out[k++] = netPenalty(sim) * sc
    return { k, sim }
  }
  const solve = (start, use, rounds = iters) => {
    let p = start.slice()
    const m = use.length * 2 + 3 + (fitSpin ? 1 : 0) + (prior.P1 ? 3 : 0) + 1
    const r = new Float64Array(m)
    const r2 = new Float64Array(m)
    let lambda = 1e-2
    let { sim } = residuals(p, use, r)
    let cost = sumsq(r)
    for (let it = 0; it < rounds; it++) {
      // numeric Jacobian
      const J = []
      for (let j = 0; j < nP; j++) {
        const hstep = j < 3 ? 0.01 : j < 6 ? 0.02 : 2
        const q = p.slice()
        q[j] += hstep
        residuals(q, use, r2)
        const col = new Float64Array(m)
        for (let i = 0; i < m; i++) col[i] = (r2[i] - r[i]) / hstep
        J.push(col)
      }
      // Huber weights on the observation residuals
      const wts = new Float64Array(m).fill(1)
      for (let i = 0; i < use.length; i++) {
        const e = Math.hypot(r[2 * i], r[2 * i + 1])
        const w = e > gate ? gate / e : 1
        wts[2 * i] = w
        wts[2 * i + 1] = w
      }
      const A = Array.from({ length: nP }, () => new Float64Array(nP))
      const g = new Float64Array(nP)
      for (let a = 0; a < nP; a++) {
        for (let b = a; b < nP; b++) {
          let s = 0
          for (let i = 0; i < m; i++) s += J[a][i] * J[b][i] * wts[i]
          A[a][b] = s
          A[b][a] = s
        }
        let s = 0
        for (let i = 0; i < m; i++) s += J[a][i] * r[i] * wts[i]
        g[a] = s
      }
      let improved = false
      for (let tries = 0; tries < 6 && !improved; tries++) {
        const Al = A.map((row, i) => Array.from(row, (v, j) => (i === j ? v * (1 + lambda) + 1e-9 : v)))
        const d = solveSym(Al, Array.from(g, (v) => -v))
        if (!d) break
        const q = p.map((v, i) => (i < nP ? v + d[i] : v))
        q[1] = Math.max(0.05, Math.min(3.5, q[1]))
        const res = residuals(q, use, r2)
        const c = sumsq(r2)
        if (c < cost) {
          p = q
          r.set(r2)
          cost = c
          sim = res.sim
          lambda = Math.max(1e-6, lambda * 0.3)
          improved = true
        } else lambda *= 8
      }
      if (!improved) break
    }
    return { p, sim, cost }
  }
  const errs = (sim, list) =>
    list.map((o) => {
      const pr = cam.project(sim.at(o.t - t0))
      return pr ? Math.hypot(pr[0] - o.u, pr[1] - o.v) : 1e9
    })
  // RANSAC over the candidates: 3 at different times seed a fit; the most inliers wins
  const rnd = mulberry32(seed)
  const byFrame = groupBy(pts, (o) => Math.round(o.t * 1000))
  const frames = [...byFrame.values()]
  let best = null
  // a first fit on every frame's strongest candidate
  const seedUse = frames.map((fr) => fr.reduce((a, b) => ((b.score ?? 1) > (a.score ?? 1) ? b : a)))
  {
    const fit = solve(p0, seedUse, 8)
    const e = errs(fit.sim, pts)
    const inl = pts.filter((_, i) => e[i] <= gate * 1.5)
    best = { score: new Set(inl.map((o) => Math.round(o.t * 1000))).size, p: fit.p, inl }
  }
  const tries = frames.length >= 3 ? Math.min(40, frames.length * 4) : 0
  for (let k = 0; k < tries && frames.some((f) => f.length > 1); k++) {
    const pick = sample3(frames, rnd).map((fr) => fr[Math.floor(rnd() * fr.length)])
    const fit = solve(p0, pick, 6)
    const e = errs(fit.sim, pts)
    const inl = pts.filter((_, i) => e[i] <= gate * 1.5)
    const score = new Set(inl.map((o) => Math.round(o.t * 1000))).size
    if (score > best.score) best = { score, p: fit.p, inl }
  }
  // refine on the inliers (one per frame: the closest)
  const keep = [...groupBy(best.inl, (o) => Math.round(o.t * 1000)).values()].map((fr) => fr[0])
  if (keep.length < 3) return null
  let fit = solve(best.p, keep, iters)
  let e = errs(fit.sim, keep)
  const final = keep.filter((_, i) => e[i] <= gate * 1.5)
  if (final.length >= 3 && final.length < keep.length) {
    fit = solve(fit.p, final, iters)
    e = errs(fit.sim, final)
  }
  const used = final.length >= 3 ? final : keep
  const rms = Math.sqrt(e.slice(0, used.length).reduce((s, x) => s + x * x, 0) / used.length)
  const tsSeen = used.map((o) => o.t).sort((x, y) => x - y)
  const coverage = tsSeen.length > 1 ? (tsSeen.at(-1) - tsSeen[0]) / T : 0
  const sim = simulate({ x: fit.p[0], y: fit.p[1], z: fit.p[2] }, { x: fit.p[3], y: fit.p[4], z: fit.p[5] }, T, { spin: fitSpin ? fit.p[6] : 0 })
  const frameCount = new Set(pts.map((o) => Math.round(o.t * 1000))).size
  const seenShare = used.length / Math.max(1, frameCount)
  // does it agree with where the players were? (start at the hitter, end at the next one)
  const s0 = sim.at(0)
  const startErr = Math.hypot(s0.x - prior.P0.x, s0.z - prior.P0.z)
  const end = sim.at(T)
  const endErr = prior.P1 ? Math.hypot(end.x - prior.P1.x, end.y - prior.P1.y, end.z - prior.P1.z) : 0
  const plausible = clamp01(1.4 - startErr / 1.5) * clamp01(1.4 - endErr / 1.6) * (Math.hypot(fit.p[3], fit.p[4], fit.p[5]) < 33 ? 1 : 0.2) * (netPenalty(sim) > 0.02 ? 0.3 : 1)
  const conf = clamp01(Math.min(1, used.length / 8) * clamp01(coverage * 1.2) * clamp01(1.4 - rms / (gate * 2)) * clamp01(0.4 + seenShare) * plausible)
  return {
    t0,
    t1,
    P0: { x: fit.p[0], y: fit.p[1], z: fit.p[2] },
    V0: { x: fit.p[3], y: fit.p[4], z: fit.p[5] },
    spin: fitSpin ? fit.p[6] : 0,
    rms,
    inliers: used.length,
    n: pts.length,
    coverage,
    conf,
    startErr,
    endErr,
    bounces: sim.bounces.map((b) => ({ t: t0 + b.t, x: b.x, z: b.z, vin: b.vin })),
    at: (t) => sim.at(t - t0),
    speed: Math.hypot(fit.p[3], fit.p[4], fit.p[5]),
  }
}

// how far under the tape a flight crosses the net (0 if it clears or doesn't cross), meters
const netPenalty = (sim) => {
  const pts = sim.pts
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    if ((a.z > 0) === (b.z > 0)) continue
    const f = a.z / (a.z - b.z)
    const x = a.x + (b.x - a.x) * f
    if (Math.abs(x) > 3.35) return 0
    const y = a.y + (b.y - a.y) * f
    const top = netHeightAt(x) + BALL_R
    return y < top ? top - y : 0
  }
  return 0
}

const sumsq = (r) => {
  let s = 0
  for (let i = 0; i < r.length; i++) s += r[i] * r[i]
  return s
}
const clamp01 = (x) => Math.max(0, Math.min(1, x))
const groupBy = (list, key) => {
  const m = new Map()
  for (const o of list) {
    const k = key(o)
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(o)
  }
  return m
}
const sample3 = (frames, rnd) => {
  const n = frames.length
  const a = Math.floor(rnd() * n)
  let b = Math.floor(rnd() * n)
  let c = Math.floor(rnd() * n)
  if (b === a) b = (a + Math.max(1, Math.floor(n / 3))) % n
  if (c === a || c === b) c = (b + Math.max(1, Math.floor(n / 3))) % n
  return [frames[a], frames[b], frames[c]]
}
// a small seeded random (the fit is repeatable)
export const mulberry32 = (a) => () => {
  a |= 0
  a = (a + 0x6d2b79f5) | 0
  let t = Math.imul(a ^ (a >>> 15), 1 | a)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
// symmetric positive (semi)definite solve (Gaussian elimination with pivoting)
const solveSym = (A, b) => {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    if (Math.abs(M[p][c]) < 1e-14) return null
    ;[M[c], M[p]] = [M[p], M[c]]
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = M[r][c] / M[c][c]
      if (!f) continue
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]
    }
  }
  return M.map((row, i) => row[n] / row[i])
}

// ---- the call ----

// The contact patch: a ball touching the line is in (rule 6.A.2), and at the bounce the
// squashed ball's footprint reaches about 1 cm out from under its center.
export const CONTACT_R = 0.01

// In or out. bounce: { x, z, sigma } (meters). ctx: { kind: "serve" | "rally", toTeam (the
// team whose half it lands in: 0 = +z), serverX (a serve: the server's x) }.
// Returns { inside: bool, margin (m: + inside, - outside, to the nearest boundary that
// matters), line: "baseline" | "sideline" | "kitchen" | "centerline", verdict: "in" | "out",
// close: |margin| < 2 sigma ("too close to call": the call stands) }
export const callBounce = (bounce, { kind = "rally", toTeam, serverX = 0 } = {}) => {
  const sgn = toTeam === 0 ? 1 : -1
  const along = bounce.z * sgn // 0 at the net .. HALF_L at that team's baseline
  const lim = CONTACT_R
  const checks = []
  // past the baseline / wide of a sideline (the lines are in)
  checks.push({ line: "baseline", m: HALF_L + lim - along })
  checks.push({ line: "sideline", m: HALF_W + lim - Math.abs(bounce.x) })
  if (kind === "serve") {
    // past the kitchen line (it belongs to the kitchen: touching it is a fault) and in the
    // diagonal service court (the centerline belongs to both)
    checks.push({ line: "kitchen", m: along - (KITCHEN + lim) })
    const side = serverX >= 0 ? -1 : 1 // diagonal: the other x sign
    checks.push({ line: "centerline", m: side * bounce.x + lim })
  } else {
    checks.push({ line: "net", m: along + 1 }) // (on its own side of the net: never the reason)
  }
  const worst = checks.reduce((a, b) => (b.m < a.m ? b : a))
  const inside = worst.m >= 0
  const sigma = Math.max(0.01, bounce.sigma ?? 0.03)
  return { inside, verdict: inside ? "in" : "out", margin: worst.m, line: worst.line, close: Math.abs(worst.m) < 2 * sigma, sigma }
}

// what to say: "OUT by 4 cm", "IN by 2 cm", "Too close: call stands"
// (a ball nowhere near a line is just "IN"; stored calls carry `verdict`, fresh ones `inside`)
export const callText = (call) => {
  if (!call) return ""
  if (call.close) return "Too close: call stands"
  const inside = call.inside ?? call.verdict === "in"
  const cm = Math.max(1, Math.round(Math.abs(call.margin) * 100))
  if (inside && cm > 30) return "IN"
  return `${inside ? "IN" : "OUT"} by ${cm} cm`
}

// the bounce's uncertainty: the fit's pixel error at that spot, in meters, shrinking with the
// number of good observations near it
export const bounceSigma = (fit, cam) => {
  const b = fit.bounces[0]
  if (!b) return null
  const mpp = cam.metersPerPixel(b.x, b.z)
  return Math.max(0.01, (Math.max(1, fit.rms) * mpp * 1.5) / Math.sqrt(Math.max(1, fit.inliers / 3)))
}

// shot speed out of the paddle (km/h and mph)
export const speedOf = (fit) => ({ ms: fit.speed, kmh: fit.speed * 3.6, mph: fit.speed * 2.23694 })

export { netHeightAt }
