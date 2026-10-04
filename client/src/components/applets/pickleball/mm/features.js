// Pickleball 98 motion matching: the feature vectors the search compares. Pure JavaScript
// (Node-tested). Every database frame gets one (computed when the database loads, so the
// download is only the poses), and the controller builds a query of the same shape from the
// current pose and the trajectory the game wants:
//
//   trajectory: where the root will be 0.2, 0.4, 0.7 s from now (x, z in the root's frame)
//               and which way it will face then (sin, cos)              12
//   feet:       both ankles' positions in the root's frame (x, y, z)      6
//               and velocities (m/s, root frame)                          6
//   hips:       the pelvis' velocity (root frame)                         3
//
// Groups are normalized by their spread over the whole database and weighted (WEIGHTS), so
// a centimeter of foot position and a centimeter of trajectory count as the game wants.
// Frames are "virtual": index f < N is a database frame, N + f its mirror image (left and
// right swapped: twice the data for free, and both sides of every shuffle).

import { qaxis, qrot, qmul } from "./quat.js"
import { frameQ } from "./db.js"
import { B, fk, NB } from "./skeleton.js"

export const TRAJ = [6, 12, 21] // frames ahead at 30 fps
export const DIM = 27
export const GROUPS = [
  { name: "trajPos", from: 0, to: 6, step: 2, w: 2.0 },
  { name: "trajDir", from: 6, to: 12, step: 2, w: 2.0 },
  { name: "footPos", from: 12, to: 18, step: 3, w: 0.75 },
  { name: "footVel", from: 18, to: 24, step: 3, w: 0.7 },
  { name: "hipVel", from: 24, to: 27, step: 3, w: 1.0 },
]
const LAST = TRAJ[TRAJ.length - 1]

const UPV = { x: 0, y: 1, z: 0 }
// a frame's pose (character space): D (quaternions) and the pelvis
export const poseOf = (db, f, D = new Array(NB)) => {
  for (let b = 0; b < NB; b++) D[b] = frameQ(db, f, b, D[b] || { x: 0, y: 0, z: 0, w: 1 })
  return { D, hip: { x: db.hip[f * 3], y: db.hip[f * 3 + 1], z: db.hip[f * 3 + 2] } }
}

// which frames can be searched: not the first, and not within the trajectory's horizon of
// the end of their clip
export const searchable = (db) => {
  const ok = new Uint8Array(db.N)
  for (const c of db.clips) for (let i = 1; i < c.n - LAST - 1; i++) ok[c.start + i] = 1
  return ok
}

// world <- root: rotate by yaw, add the root's position
const toWorld = (root, p) => {
  const s = Math.sin(root.yaw)
  const c = Math.cos(root.yaw)
  return { x: root.x + c * p.x + s * p.z, y: p.y, z: root.z - s * p.x + c * p.z }
}
// a world vector -> the root's frame
export const toRoot = (yaw, v) => {
  const s = Math.sin(yaw)
  const c = Math.cos(yaw)
  return { x: c * v.x - s * v.z, y: v.y, z: s * v.x + c * v.z }
}
const rootAt = (db, f) => ({ x: db.root[f * 3], z: db.root[f * 3 + 1], yaw: db.root[f * 3 + 2] })

// The raw (unnormalized) features of every database frame, plus their mirror images.
// Returns Float32Array(2N * DIM).
export const buildFeatures = (db) => {
  const N = db.N
  const F = new Float32Array(2 * N * DIM)
  // the ankles and pelvis in world space, frame by frame
  const ankles = new Float32Array(N * 6)
  const pel = new Float32Array(N * 3)
  const D = new Array(NB)
  for (let f = 0; f < N; f++) {
    const p = poseOf(db, f, D)
    const P = fk(p.D, p.hip)
    const r = rootAt(db, f)
    const L = toWorld(r, P[B.foot_l])
    const R = toWorld(r, P[B.foot_r])
    const H = toWorld(r, P[B.pelvis])
    ankles.set([L.x, L.y, L.z, R.x, R.y, R.z], f * 6)
    pel.set([H.x, H.y, H.z], f * 3)
  }
  const fps = db.fps
  for (const c of db.clips) {
    const end = c.start + c.n - 1
    for (let i = 0; i < c.n; i++) {
      const f = c.start + i
      const r = rootAt(db, f)
      const o = f * DIM
      // trajectory
      TRAJ.forEach((k, j) => {
        const g = Math.min(end, f + k)
        const rg = rootAt(db, g)
        const d = toRoot(r.yaw, { x: rg.x - r.x, y: 0, z: rg.z - r.z })
        F[o + j * 2] = d.x
        F[o + j * 2 + 1] = d.z
        const dy = rg.yaw - r.yaw
        F[o + 6 + j * 2] = Math.sin(dy)
        F[o + 6 + j * 2 + 1] = Math.cos(dy)
      })
      // feet: position in the root's frame, velocity (central difference)
      const a = Math.max(c.start, f - 1)
      const b = Math.min(end, f + 1)
      const span = (b - a) / fps || 1 / fps
      for (let s = 0; s < 2; s++) {
        const w = { x: ankles[f * 6 + s * 3], y: ankles[f * 6 + s * 3 + 1], z: ankles[f * 6 + s * 3 + 2] }
        const l = toRoot(r.yaw, { x: w.x - r.x, y: w.y, z: w.z - r.z })
        F[o + 12 + s * 3] = l.x
        F[o + 12 + s * 3 + 1] = l.y
        F[o + 12 + s * 3 + 2] = l.z
        const v = toRoot(r.yaw, { x: (ankles[b * 6 + s * 3] - ankles[a * 6 + s * 3]) / span, y: (ankles[b * 6 + s * 3 + 1] - ankles[a * 6 + s * 3 + 1]) / span, z: (ankles[b * 6 + s * 3 + 2] - ankles[a * 6 + s * 3 + 2]) / span })
        F[o + 18 + s * 3] = v.x
        F[o + 18 + s * 3 + 1] = v.y
        F[o + 18 + s * 3 + 2] = v.z
      }
      const hv = toRoot(r.yaw, { x: (pel[b * 3] - pel[a * 3]) / span, y: (pel[b * 3 + 1] - pel[a * 3 + 1]) / span, z: (pel[b * 3 + 2] - pel[a * 3 + 2]) / span })
      F[o + 24] = hv.x
      F[o + 25] = hv.y
      F[o + 26] = hv.z
    }
  }
  // mirror images: x flips, the feet swap
  for (let f = 0; f < N; f++) mirrorFeature(F, f * DIM, F, (N + f) * DIM)
  return F
}
// a feature vector's mirror image (src offset -> dst offset)
export const mirrorFeature = (src, so, dst, d) => {
  for (let j = 0; j < 3; j++) {
    dst[d + j * 2] = -src[so + j * 2]
    dst[d + j * 2 + 1] = src[so + j * 2 + 1]
    dst[d + 6 + j * 2] = -src[so + 6 + j * 2]
    dst[d + 6 + j * 2 + 1] = src[so + 6 + j * 2 + 1]
  }
  for (let s = 0; s < 2; s++) {
    const t = 1 - s
    dst[d + 12 + t * 3] = -src[so + 12 + s * 3]
    dst[d + 12 + t * 3 + 1] = src[so + 12 + s * 3 + 1]
    dst[d + 12 + t * 3 + 2] = src[so + 12 + s * 3 + 2]
    dst[d + 18 + t * 3] = -src[so + 18 + s * 3]
    dst[d + 18 + t * 3 + 1] = src[so + 18 + s * 3 + 1]
    dst[d + 18 + t * 3 + 2] = src[so + 18 + s * 3 + 2]
  }
  dst[d + 24] = -src[so + 24]
  dst[d + 25] = src[so + 25]
  dst[d + 26] = src[so + 26]
}

// Normalization: per group, subtract the mean and divide by the group's spread (the mean of
// its dimensions' standard deviations), times the group's weight. Returns { mean, scale }
// (per dimension) and normalizes F in place.
export const normalize = (F, groups = GROUPS) => {
  const n = F.length / DIM
  const mean = new Float32Array(DIM)
  const sd = new Float32Array(DIM)
  for (let i = 0; i < n; i++) for (let d = 0; d < DIM; d++) mean[d] += F[i * DIM + d]
  for (let d = 0; d < DIM; d++) mean[d] /= n
  for (let i = 0; i < n; i++)
    for (let d = 0; d < DIM; d++) {
      const v = F[i * DIM + d] - mean[d]
      sd[d] += v * v
    }
  for (let d = 0; d < DIM; d++) sd[d] = Math.sqrt(sd[d] / n)
  const scale = new Float32Array(DIM)
  for (const g of groups) {
    let s = 0
    for (let d = g.from; d < g.to; d++) s += sd[d]
    s = s / (g.to - g.from) || 1
    for (let d = g.from; d < g.to; d++) scale[d] = g.w / s
  }
  for (let i = 0; i < n; i++) for (let d = 0; d < DIM; d++) F[i * DIM + d] = (F[i * DIM + d] - mean[d]) * scale[d]
  return { mean, scale }
}
export const normalizeQuery = (q, norm, out = new Float32Array(DIM)) => {
  for (let d = 0; d < DIM; d++) out[d] = (q[d] - norm.mean[d]) * norm.scale[d]
  return out
}

// a frame's pose for virtual index v (mirror: v >= N), with D in character space
export const virtualPose = (db, v, D = new Array(NB)) => {
  const N = db.N
  const f = v >= N ? v - N : v
  const p = poseOf(db, f, D)
  if (v < N) return p
  // mirror: swap sides, reflect x
  const M = new Array(NB)
  for (let b = 0; b < NB; b++) M[b] = p.D[b]
  return { D: mirrorD(M, D), hip: { x: -p.hip.x, y: p.hip.y, z: p.hip.z } }
}
import { MIRROR } from "./skeleton.js"
const mirrorD = (src, out) => {
  const tmp = src.map((q) => ({ x: q.x, y: q.y, z: q.z, w: q.w }))
  for (let b = 0; b < NB; b++) {
    const q = tmp[MIRROR[b]]
    out[b] = { x: q.x, y: -q.y, z: -q.z, w: q.w }
  }
  return out
}
// the root's motion from virtual frame v to v + 1 (in v's root frame): dx, dz, dyaw
export const rootDelta = (db, v) => {
  const N = db.N
  const m = v >= N
  const f = m ? v - N : v
  const g = Math.min(f + 1, db.clips[db.clipOf[f]].start + db.clips[db.clipOf[f]].n - 1)
  const a = rootAt(db, f)
  const b = rootAt(db, g)
  const d = toRoot(a.yaw, { x: b.x - a.x, y: 0, z: b.z - a.z })
  const dyaw = b.yaw - a.yaw
  return m ? { x: -d.x, z: d.z, yaw: -dyaw } : { x: d.x, z: d.z, yaw: dyaw }
}
export const contactsOf = (db, v) => {
  const N = db.N
  if (v < N) return db.contacts[v]
  const c = db.contacts[v - N]
  return ((c & 1) << 1) | ((c & 2) >> 1)
}
void qaxis
void qmul
void qrot
void UPV
