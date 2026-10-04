// Pickleball 98 motion matching: the database file format. Pure JavaScript (Node-tested).
//
// motion.json: { v, fps, bones, frames, clips: [{ name, start, n, tags }], q, p }
// motion.bin: gzip of the contacts (a byte a frame: bit 0 left foot, bit 1 right foot), then
//   integer channels (zigzag varints), clip by clip, channel by channel, each
//   coded along the clip's frames as the difference from a straight-line prediction from the
//   two frames before (smooth motion: mostly tiny numbers, which gzip packs well). Channels
//   per frame: the root's x, z (meters * p, from the clip's first frame) and yaw (radians * p), the pelvis in root space (x, y,
//   z, meters * p), then each bone's rotation x, y, z (* q; w >= 0, recovered).
// Quantization keeps the reconstruction error from piling up: each residual is taken from
// the values the decoder will have, not the originals.
//
// Decoded (decodeDB) the database keeps rotations as int16 (x, y, z) to save memory and
// rebuilds a quaternion when a frame is sampled.

import { BONES, NB } from "./skeleton.js"

const Q_SCALE = 8192 // (a quaternion component to ~1e-4: well under a tenth of a degree)
const P_SCALE = 2000 // half a millimeter (yaw: 1/2000 rad)
const CH = 6 + NB * 3

const clampI = (v) => Math.max(-32768, Math.min(32767, Math.round(v)))

export const encodeDB = (clips, fps) => {
  let total = 0
  const meta = []
  for (const c of clips) {
    meta.push({ name: c.name, start: total, n: c.frames.length, tags: c.tags || [] })
    total += c.frames.length
  }
  const out = new Int16Array(total * CH)
  const contacts = new Uint8Array(total)
  let o = 0
  for (const c of clips) {
    const n = c.frames.length
    const chan = (get) => {
      // linear prediction from the two values before (as the decoder will have them)
      let a = 0
      let b = 0
      for (let i = 0; i < n; i++) {
        const want = Math.round(get(c.frames[i], i))
        const pred = i >= 2 ? 2 * b - a : b
        const q = clampI(want - pred)
        out[o++] = q
        a = b
        b = pred + q
      }
    }
    // root: positions relative to the clip's first frame
    const r0 = c.frames[0].root
    chan((f) => (f.root.x - r0.x) * P_SCALE)
    chan((f) => (f.root.z - r0.z) * P_SCALE)
    chan((f) => f.root.yaw * P_SCALE)
    chan((f) => f.hip.x * P_SCALE)
    chan((f) => f.hip.y * P_SCALE)
    chan((f) => f.hip.z * P_SCALE)
    for (let b = 0; b < NB; b++)
      for (const k of ["x", "y", "z"]) {
        chan((f) => {
          const q = f.D[b]
          const s = q.w < 0 ? -1 : 1
          return q[k] * s * Q_SCALE
        })
      }
    c.contacts.forEach((ct, i) => (contacts[meta.find((m) => m.name === c.name).start + i] = (ct[0] ? 1 : 0) | (ct[1] ? 2 : 0)))
  }
  // contacts first, then the residuals as zigzag varints (small numbers: one byte)
  const bytes = [...contacts]
  for (let i = 0; i < out.length; i++) {
    let z = out[i] >= 0 ? out[i] * 2 : -out[i] * 2 - 1
    while (z >= 128) {
      bytes.push((z & 127) | 128)
      z >>= 7
    }
    bytes.push(z)
  }
  const raw = Uint8Array.from(bytes)
  return { json: { v: 2, fps, bones: BONES, frames: total, clips: meta, q: Q_SCALE, p: P_SCALE, ch: CH }, raw, bin: gzip(raw) }
}
// (Node only: the tool gzips; the game ungzips with DecompressionStream)
let zlib = null
const gzip = (raw) => {
  if (!zlib) return raw
  return new Uint8Array(zlib.gzipSync(raw, { level: 9 }))
}
export const useZlib = (z) => {
  zlib = z
}

// raw: the ungzipped bytes. Returns the database: per frame the root (x, z, yaw), the pelvis
// (root space), int16 rotations, contacts, and which clip each frame belongs to.
export const decodeDB = (json, raw) => {
  const N = json.frames
  const CHn = json.ch
  const contacts = raw.slice(0, N)
  const ints = new Int32Array(N * CHn)
  let p = N
  for (let i = 0; i < ints.length; i++) {
    let z = 0
    let sh = 0
    let b
    do {
      b = raw[p++]
      z |= (b & 127) << sh
      sh += 7
    } while (b & 128)
    ints[i] = z & 1 ? -((z + 1) >> 1) : z >> 1
  }
  const root = new Float32Array(N * 3)
  const hip = new Float32Array(N * 3)
  const rot = new Int16Array(N * NB * 3)
  const clipOf = new Uint16Array(N)
  let o = 0
  json.clips.forEach((c, ci) => {
    const n = c.n
    const chan = (put) => {
      let a = 0
      let b = 0
      for (let i = 0; i < n; i++) {
        const v = (i >= 2 ? 2 * b - a : b) + ints[o++]
        a = b
        b = v
        put(c.start + i, v)
      }
    }
    chan((f, v) => (root[f * 3] = v / json.p))
    chan((f, v) => (root[f * 3 + 1] = v / json.p))
    chan((f, v) => (root[f * 3 + 2] = v / json.p))
    chan((f, v) => (hip[f * 3] = v / json.p))
    chan((f, v) => (hip[f * 3 + 1] = v / json.p))
    chan((f, v) => (hip[f * 3 + 2] = v / json.p))
    for (let b = 0; b < NB; b++)
      for (let k = 0; k < 3; k++) {
        const bk = b * 3 + k
        chan((f, v) => (rot[f * NB * 3 + bk] = v))
      }
    for (let i = 0; i < n; i++) clipOf[c.start + i] = ci
  })
  return { N, fps: json.fps, clips: json.clips, root, hip, rot, contacts, clipOf, qs: json.q }
}

// one bone's rotation in frame f (mirror: the frame's mirror image, see skeleton.js MIRROR)
export const frameQ = (db, f, b, out = { x: 0, y: 0, z: 0, w: 1 }) => {
  const o = (f * NB + b) * 3
  const x = db.rot[o] / db.qs
  const y = db.rot[o + 1] / db.qs
  const z = db.rot[o + 2] / db.qs
  const w2 = 1 - x * x - y * y - z * z
  out.x = x
  out.y = y
  out.z = z
  out.w = w2 > 0 ? Math.sqrt(w2) : 0
  return out
}
