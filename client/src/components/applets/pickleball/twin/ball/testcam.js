// Real Ball tests' helpers: a known pinhole camera at a fence (the truth), the homography a
// user's four corner taps would give for it, and noisy image tracks with false candidates.

import { HALF_L, HALF_W } from "../../physics.js"
import { solveHomography } from "../core/homography.js"
import { mulberry32 } from "./flight.js"

// A camera at (x, height, z) looking at `look` (court meters), focal f px, image W x H
export const makeCamera = ({ pos = { x: 0.4, y: 3.2, z: HALF_L + 4.5 }, look = { x: 0, y: 0, z: -1 }, f = 1000, W = 1280, H = 720 } = {}) => {
  // forward, right, down (camera axes: x right, y down, z forward) in court coordinates (x, z, y)
  const fw = norm([look.x - pos.x, look.z - pos.z, look.y - pos.y])
  const worldUp = [0, 0, 1]
  const right = norm(cross(fw, worldUp))
  const down = cross(fw, right)
  // world (x, z, y) -> camera: rows right, down, fw
  const project = (P) => {
    const d = [P.x - pos.x, P.z - pos.z, P.y - pos.y]
    const X = dot(right, d)
    const Y = dot(down, d)
    const Z = dot(fw, d)
    if (Z <= 1e-6) return null
    return [W / 2 + (f * X) / Z, H / 2 + (f * Y) / Z]
  }
  const corners = [
    { id: "nearLeft", x: -HALF_W, z: HALF_L },
    { id: "nearRight", x: HALF_W, z: HALF_L },
    { id: "farRight", x: HALF_W, z: -HALF_L },
    { id: "farLeft", x: -HALF_W, z: -HALF_L },
  ]
  const taps = corners.map((c) => {
    const p = project({ x: c.x, y: 0, z: c.z })
    return { id: c.id, x: p[0], y: p[1] }
  })
  const Himg = solveHomography(corners.map((c, i) => ({ src: [taps[i].x, taps[i].y], dst: [c.x, c.z] })))
  return { project, taps, H: Himg, W, H_px: H, f, pos }
}

// observations of a flight `sim` (from simulate) between t0 and t0 + T at `fps`, with pixel
// noise, a share of missed frames, and false candidates (players' shoes, a shirt...)
export const observe = (sim, cam, { t0 = 0, T, fps = 15, noise = 1.2, miss = 0.15, falsePerFrame = 1, seed = 7 } = {}) => {
  const rnd = mulberry32(seed)
  const gauss = () => {
    const u = Math.max(1e-9, rnd())
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd())
  }
  const obs = []
  for (let t = 1 / fps / 2; t < T; t += 1 / fps) {
    const truth = cam.project(sim.at(t))
    if (truth && rnd() > miss) obs.push({ t: t0 + t, u: truth[0] + gauss() * noise, v: truth[1] + gauss() * noise, score: 1, truth: true })
    for (let k = 0; k < falsePerFrame; k++) obs.push({ t: t0 + t, u: rnd() * cam.W, v: cam.H_px * (0.35 + rnd() * 0.6), score: 0.6 + rnd() * 0.5 })
  }
  return obs
}

const norm = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
