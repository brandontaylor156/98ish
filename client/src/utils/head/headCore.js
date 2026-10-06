// Be Yourself: the pure parts (no DOM, no network), shared by the face tracker, the call
// link and the renderer, and tested in headCore.test.js.
//
// A live head travels as 52 ARKit blendshape weights plus head yaw/pitch/roll: one small
// binary packet per frame (~20 fps, 60 bytes, about 1.2 KB/s) over the call's own P2P data
// channel. MediaPipe's Face Landmarker produces exactly these 52 names; the LAM renderer
// consumes them (it calls cheekPuff "mouthCheekPuff").

export const ARKIT = [
  "browDownLeft", "browDownRight", "browInnerUp", "browOuterUpLeft", "browOuterUpRight",
  "cheekPuff", "cheekSquintLeft", "cheekSquintRight",
  "eyeBlinkLeft", "eyeBlinkRight", "eyeLookDownLeft", "eyeLookDownRight", "eyeLookInLeft", "eyeLookInRight",
  "eyeLookOutLeft", "eyeLookOutRight", "eyeLookUpLeft", "eyeLookUpRight", "eyeSquintLeft", "eyeSquintRight",
  "eyeWideLeft", "eyeWideRight",
  "jawForward", "jawLeft", "jawOpen", "jawRight",
  "mouthClose", "mouthDimpleLeft", "mouthDimpleRight", "mouthFrownLeft", "mouthFrownRight", "mouthFunnel",
  "mouthLeft", "mouthLowerDownLeft", "mouthLowerDownRight", "mouthPressLeft", "mouthPressRight", "mouthPucker",
  "mouthRight", "mouthRollLower", "mouthRollUpper", "mouthShrugLower", "mouthShrugUpper", "mouthSmileLeft",
  "mouthSmileRight", "mouthStretchLeft", "mouthStretchRight", "mouthUpperUpLeft", "mouthUpperUpRight",
  "noseSneerLeft", "noseSneerRight", "tongueOut",
]
export const N = ARKIT.length // 52
const INDEX = Object.fromEntries(ARKIT.map((n, i) => [n, i]))

// the renderer's names (the same, except one)
const RENDER_NAME = { cheekPuff: "mouthCheekPuff" }

// ---- the packet ----
// [0] kind (1 = face), [1-2] seq (uint16 LE), [3] source (0 idle, 1 face, 2 voice),
// [4-55] 52 weights (0-255), [56-58] yaw/pitch/roll (int8, degrees / 90 * 127)
export const PACKET_BYTES = 59
const SOURCES = ["idle", "face", "voice"]
const clamp01 = (v) => (v > 1 ? 1 : v < 0 || !Number.isFinite(v) ? 0 : v)
const toI8 = (deg) => Math.max(-127, Math.min(127, Math.round(((Number.isFinite(deg) ? deg : 0) / 90) * 127)))

export const encodePacket = ({ weights, yaw = 0, pitch = 0, roll = 0, seq = 0, source = "face" }) => {
  const b = new Uint8Array(PACKET_BYTES)
  b[0] = 1
  b[1] = seq & 0xff
  b[2] = (seq >> 8) & 0xff
  b[3] = Math.max(0, SOURCES.indexOf(source))
  for (let i = 0; i < N; i++) b[4 + i] = Math.round(clamp01(weights?.[i] ?? 0) * 255)
  const dv = new DataView(b.buffer)
  dv.setInt8(56, toI8(yaw))
  dv.setInt8(57, toI8(pitch))
  dv.setInt8(58, toI8(roll))
  return b
}

// -> { weights: Float32Array(52), yaw, pitch, roll, seq, source } | null (not a face packet)
export const decodePacket = (data) => {
  const b = data instanceof Uint8Array ? data : data instanceof ArrayBuffer ? new Uint8Array(data) : null
  if (!b || b.length !== PACKET_BYTES || b[0] !== 1) return null
  const weights = new Float32Array(N)
  for (let i = 0; i < N; i++) weights[i] = b[4 + i] / 255
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  return {
    weights,
    seq: b[1] | (b[2] << 8),
    source: SOURCES[b[3]] || "idle",
    yaw: (dv.getInt8(56) / 127) * 90,
    pitch: (dv.getInt8(57) / 127) * 90,
    roll: (dv.getInt8(58) / 127) * 90,
  }
}

// a newer packet? (seq wraps at 65536; a late, reordered one is dropped)
export const isNewer = (seq, last) => last == null || ((seq - last + 65536) % 65536) - 1 < 32768

// ---- pacing ----
// true when a frame may go out now (at most `fps` a second)
export const rateGate = (fps = 20) => {
  const gap = 1000 / fps
  let next = -Infinity
  return (now) => {
    if (now < next) return false
    next = now + gap // no burst after a stall
    return true
  }
}

// exponential smoothing toward the newest weights (a < 1: smoother, laggier)
export const smoothInto = (out, next, a = 0.5) => {
  for (let i = 0; i < N; i++) out[i] += (next[i] - out[i]) * a
  return out
}

// ---- MediaPipe -> our order ----
// categories: [{ categoryName, score }] (it adds "_neutral"); returns Float32Array(52)
export const fromMediaPipe = (categories) => {
  const w = new Float32Array(N)
  for (const c of categories || []) {
    const i = INDEX[c.categoryName]
    if (i !== undefined) w[i] = clamp01(c.score)
  }
  return w
}

// a 4x4 column-major facial transformation matrix -> yaw/pitch/roll in degrees
export const anglesFromMatrix = (m) => {
  if (!m || m.length < 16) return { yaw: 0, pitch: 0, roll: 0 }
  // rotation part (column-major): r00=m[0] r10=m[1] r20=m[2] r01=m[4] r11=m[5] r21=m[6] r02=m[8] r12=m[9] r22=m[10]
  const r20 = m[2]
  const yaw = Math.asin(Math.max(-1, Math.min(1, -r20)))
  const pitch = Math.atan2(m[6], m[10])
  const roll = Math.atan2(m[1], m[0])
  const d = 180 / Math.PI
  return { yaw: yaw * d, pitch: pitch * d, roll: roll * d }
}

// ---- which source drives the head ----
// face when the camera sees a face (recently), else voice when someone's talking, else idle
export const chooseSource = ({ cameraOn = false, faceAt = -Infinity, voiceLevel = 0, now = 0 } = {}) => {
  if (cameraOn && now - faceAt < 600) return "face"
  if (voiceLevel > 0.04) return "voice"
  return "idle"
}

// the mouth from the voice alone (no camera): loudness opens the jaw; brightness (more high
// frequencies) widens it, darkness rounds it. level and brightness are 0-1.
export const voiceMouth = (level, brightness = 0.5, out = new Float32Array(N)) => {
  out.fill(0)
  const open = clamp01((level - 0.03) * 3.2)
  out[INDEX.jawOpen] = open * 0.75
  out[INDEX.mouthLowerDownLeft] = out[INDEX.mouthLowerDownRight] = open * 0.35
  out[INDEX.mouthStretchLeft] = out[INDEX.mouthStretchRight] = open * clamp01(brightness - 0.45) * 0.8
  out[INDEX.mouthFunnel] = open * clamp01(0.55 - brightness) * 0.9
  out[INDEX.mouthClose] = open < 0.05 ? 0.15 : 0
  return out
}

// alive at rest: a blink every few seconds, a little brow and eye drift. t in seconds.
export const idleFace = (t, out = new Float32Array(N)) => {
  out.fill(0)
  const cycle = t % 4.3
  const blink = cycle < 0.12 ? Math.sin((cycle / 0.12) * Math.PI) : 0
  out[INDEX.eyeBlinkLeft] = out[INDEX.eyeBlinkRight] = blink
  out[INDEX.browInnerUp] = 0.06 + 0.04 * Math.sin(t * 0.7)
  out[INDEX.mouthSmileLeft] = out[INDEX.mouthSmileRight] = 0.08
  return out
}

// weights -> the renderer's { name: weight } map
export const toRenderMap = (w) => {
  const m = {}
  for (let i = 0; i < N; i++) m[RENDER_NAME[ARKIT[i]] || ARKIT[i]] = w[i] || 0
  return m
}

// ---- the head file ----
// a LAM avatar is a zip (one folder with offset.ply, skin.glb, animation.glb, vertex_order.json)
export const HEAD_MAX_BYTES = 8 * 1024 * 1024 // syncs with file sync (its 8 MB online limit)
export const checkHeadFile = (bytes, names = null) => {
  if (!bytes || !bytes.length) return { ok: false, error: "That file is empty." }
  if (bytes.length > HEAD_MAX_BYTES) return { ok: false, error: `A 3D head can be at most ${HEAD_MAX_BYTES / 1024 / 1024} MB (that one is ${(bytes.length / 1024 / 1024).toFixed(1)} MB).` }
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) return { ok: false, error: "That isn't a 3D head file (a LAM avatar .zip)." }
  if (names && !names.some((n) => /(^|\/)offset\.ply$/.test(n))) return { ok: false, error: "That zip has no offset.ply, so it isn't a LAM avatar." }
  return { ok: true }
}

// the head file's id (to cache a friend's head for the call): a short FNV-1a of the bytes
export const headId = (bytes) => {
  let h = 0x811c9dc5
  const step = Math.max(1, Math.floor(bytes.length / 65536))
  for (let i = 0; i < bytes.length; i += step) {
    h ^= bytes[i]
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return `${bytes.length.toString(36)}-${h.toString(36)}`
}

// sending a head over the call: 16 KB chunks, each [kind 2][index u32][total u32][bytes]
export const CHUNK = 16 * 1024
export const chunkHead = (bytes) => {
  const total = Math.ceil(bytes.length / CHUNK)
  const out = []
  for (let i = 0; i < total; i++) {
    const part = bytes.subarray(i * CHUNK, Math.min(bytes.length, (i + 1) * CHUNK))
    const b = new Uint8Array(9 + part.length)
    const dv = new DataView(b.buffer)
    b[0] = 2
    dv.setUint32(1, i, true)
    dv.setUint32(5, total, true)
    b.set(part, 9)
    out.push(b)
  }
  return out
}

// reassembles chunks; push() returns the whole file (Uint8Array) once complete, else null
export const headAssembler = (maxBytes = HEAD_MAX_BYTES) => {
  let parts = null
  let got = 0
  let size = 0
  return {
    push(data) {
      const b = data instanceof Uint8Array ? data : new Uint8Array(data)
      if (b[0] !== 2 || b.length < 9) return null
      const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
      const i = dv.getUint32(1, true)
      const total = dv.getUint32(5, true)
      if (!total || total * CHUNK > maxBytes + CHUNK || i >= total) return null
      if (!parts || parts.length !== total) (parts = new Array(total)), (got = 0), (size = 0)
      if (!parts[i]) {
        parts[i] = b.slice(9)
        got++
        size += parts[i].length
      }
      if (got < total) return null
      const all = new Uint8Array(size)
      let o = 0
      for (const p of parts) all.set(p, o), (o += p.length)
      parts = null
      return all
    },
    progress: () => (parts ? got / parts.length : 0),
  }
}
