// Splat files: which format a file is, the size caps, and the splat centers (for the
// alignment view) of the formats that are simple to read here. Pure (no three.js, no DOM).

// a backdrop is kept on drive C: as a file, so it syncs like other files: file sync takes
// files up to 12 MB of text (a data URL: ~4/3 of the bytes), so 8 MB keeps it syncable
export const MAX_SYNCED_BYTES = 8 * 1024 * 1024
// bigger files stay on this device (still capped: phones run out of memory)
export const MAX_BYTES = 40 * 1024 * 1024
// at most this many backdrops per person (one per venue; the oldest goes)
export const MAX_BACKDROPS = 3

const ascii = (u8, from, n) => String.fromCharCode(...u8.subarray(from, from + n))

// .ply (text "ply" header), .spz (gzip: 1f 8b), .sog (zip: "PK"), .ksplat, .splat (raw 32-byte records)
export const detectFormat = (bytes, name = "") => {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const ext = (name.match(/\.([a-z0-9]+)$/i)?.[1] || "").toLowerCase()
  if (u8.length >= 3 && ascii(u8, 0, 3) === "ply") return "ply"
  if (u8.length >= 2 && u8[0] === 0x1f && u8[1] === 0x8b) return "spz"
  if (u8.length >= 2 && u8[0] === 0x50 && u8[1] === 0x4b) return "sog"
  if (ext === "ksplat") return "ksplat"
  if (ext === "splat" || (u8.length && u8.length % 32 === 0)) return "splat"
  return null
}

export const checkSize = (bytes) => {
  const n = bytes.byteLength ?? bytes.length
  if (n > MAX_BYTES) return { ok: false, error: `That splat is ${(n / 1048576).toFixed(0)} MB; the limit is ${MAX_BYTES / 1048576} MB.` }
  return { ok: true, synced: n <= MAX_SYNCED_BYTES }
}

// .splat: 32 bytes per splat: position (3 float32), scale (3 float32), color RGBA (4 u8), rotation (4 u8)
export const splatCount = (bytes) => Math.floor((bytes.byteLength ?? bytes.length) / 32)
export const centersFromSplat = (bytes) => {
  const buf = bytes instanceof ArrayBuffer ? bytes : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  const n = Math.floor(buf.byteLength / 32)
  const f = new Float32Array(buf, 0, (n * 32) / 4)
  const out = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    out[i * 3] = f[i * 8]
    out[i * 3 + 1] = f[i * 8 + 1]
    out[i * 3 + 2] = f[i * 8 + 2]
  }
  return out
}

// binary little-endian .ply: reads the header, finds x/y/z among the vertex properties
const SIZES = { char: 1, uchar: 1, int8: 1, uint8: 1, short: 2, ushort: 2, int16: 2, uint16: 2, int: 4, uint: 4, int32: 4, uint32: 4, float: 4, float32: 4, double: 8, float64: 8 }
export const parsePlyHeader = (bytes) => {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const head = ascii(u8, 0, Math.min(u8.length, 16384))
  const end = head.indexOf("end_header")
  if (end < 0) throw new Error("That .ply file has no header end.")
  const lines = head.slice(0, end).split(/\r?\n/)
  if (!lines.some((l) => /^format binary_little_endian/.test(l))) throw new Error("Only binary .ply splat files are supported.")
  let count = 0
  let inVertex = false
  const props = []
  for (const l of lines) {
    const m = l.match(/^element (\w+) (\d+)/)
    if (m) {
      inVertex = m[1] === "vertex"
      if (inVertex) count = Number(m[2])
      continue
    }
    const p = l.match(/^property (\w+) (\w+)/)
    if (p && inVertex) props.push({ type: p[1], name: p[2] })
  }
  let offset = 0
  const at = {}
  for (const p of props) {
    at[p.name] = { offset, type: p.type }
    offset += SIZES[p.type] || 4
  }
  const dataStart = head.indexOf("\n", end) + 1
  return { count, stride: offset, at, dataStart }
}
export const centersFromPly = (bytes) => {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const h = parsePlyHeader(u8)
  if (!h.at.x || !h.at.y || !h.at.z) throw new Error("That .ply file has no x/y/z.")
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
  const n = Math.min(h.count, Math.floor((u8.length - h.dataStart) / h.stride))
  const out = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    const base = h.dataStart + i * h.stride
    out[i * 3] = view.getFloat32(base + h.at.x.offset, true)
    out[i * 3 + 1] = view.getFloat32(base + h.at.y.offset, true)
    out[i * 3 + 2] = view.getFloat32(base + h.at.z.offset, true)
  }
  return out
}

// colored points (a MapAnything point cloud) -> .splat bytes: each point a small round gaussian
//   positions: Float32Array xyz, colors: Uint8Array rgb(a) or Float32Array 0..1, size: meters
export const pointsToSplat = (positions, colors, { size = 0.035, channels = 3, maxPoints = 1500000 } = {}) => {
  const total = Math.floor(positions.length / 3)
  const step = Math.max(1, Math.ceil(total / maxPoints))
  const n = Math.ceil(total / step)
  const buf = new ArrayBuffer(n * 32)
  const f = new Float32Array(buf)
  const u = new Uint8Array(buf)
  const float = colors instanceof Float32Array
  for (let k = 0, i = 0; i < total; i += step, k++) {
    f[k * 8] = positions[i * 3]
    f[k * 8 + 1] = positions[i * 3 + 1]
    f[k * 8 + 2] = positions[i * 3 + 2]
    f[k * 8 + 3] = size
    f[k * 8 + 4] = size
    f[k * 8 + 5] = size
    const c = (j) => (float ? Math.round(Math.min(1, Math.max(0, colors[i * channels + j])) * 255) : colors[i * channels + j])
    u[k * 32 + 24] = c(0)
    u[k * 32 + 25] = c(1)
    u[k * 32 + 26] = c(2)
    u[k * 32 + 27] = 235
    // identity rotation, quantized (w, x, y, z) as 128 + 127·v
    u[k * 32 + 28] = 255
    u[k * 32 + 29] = 128
    u[k * 32 + 30] = 128
    u[k * 32 + 31] = 128
  }
  return new Uint8Array(buf)
}
