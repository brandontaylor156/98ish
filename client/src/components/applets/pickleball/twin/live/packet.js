// Live Broadcast: what goes over the wire. Only tracked data, never video: ~10 ticks a
// second of player positions (a few dozen bytes each) plus a hit or a score now and then.
// The server (server/broadcast) checks and relays these bytes without looking inside them
// beyond the size, so the same file is the format's only definition (Node tests load it).
//
// Tick (binary, little-endian), 6 + 7 x players bytes:
//   u8 version (1) | u8 n players | u32 t (ms since the broadcast started)
//   per player: i16 x (cm) | i16 z (cm) | i8 vx (0.1 m/s) | i8 vz (0.1 m/s) | u8 flags
//   flags: bit 0 seen in the last second, bits 1-2 player slot (0..3) is implied by order
// Raw pose keypoints aren't sent: the athletes' bodies are driven by motion matching from
// position, velocity and the hits (as in Twin Replay), so 33 keypoints a player would cost
// ~30x the bytes for nothing a viewer would see.
//
// Events (JSON, small): { k: "hit", t (ms), p (slot), h (contact height cm), s ("fh"|"bh"), src }
//   { k: "score", t, a, b, call, over }  { k: "roster", players: [{ slot, name, team, hand }] }

export const TICK_VERSION = 1
export const MAX_PLAYERS = 4
export const TICK_HZ = 10
export const tickBytes = (n) => 6 + 7 * n
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

// players: [{ x, z, vx, vz, seen }] in court meters (index = slot)
export const encodeTick = (tMs, players) => {
  const n = Math.min(MAX_PLAYERS, players.length)
  const buf = new ArrayBuffer(tickBytes(n))
  const v = new DataView(buf)
  v.setUint8(0, TICK_VERSION)
  v.setUint8(1, n)
  v.setUint32(2, clamp(Math.round(tMs), 0, 0xffffffff), true)
  for (let i = 0; i < n; i++) {
    const p = players[i] || {}
    const o = 6 + i * 7
    v.setInt16(o, clamp(Math.round((p.x || 0) * 100), -3200, 3200), true)
    v.setInt16(o + 2, clamp(Math.round((p.z || 0) * 100), -3200, 3200), true)
    v.setInt8(o + 4, clamp(Math.round((p.vx || 0) * 10), -127, 127))
    v.setInt8(o + 5, clamp(Math.round((p.vz || 0) * 10), -127, 127))
    v.setUint8(o + 6, p.seen === false ? 0 : 1)
  }
  return new Uint8Array(buf)
}

// -> { t (s), players: [{ x, z, vx, vz, seen }] } or null for anything malformed
export const decodeTick = (bytes) => {
  const u8 = bytes instanceof Uint8Array ? bytes : bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : ArrayBuffer.isView(bytes) ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : null
  if (!u8 || u8.length < 6) return null
  const v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
  if (v.getUint8(0) !== TICK_VERSION) return null
  const n = v.getUint8(1)
  if (n > MAX_PLAYERS || u8.length !== tickBytes(n)) return null
  const players = []
  for (let i = 0; i < n; i++) {
    const o = 6 + i * 7
    players.push({ x: v.getInt16(o, true) / 100, z: v.getInt16(o + 2, true) / 100, vx: v.getInt8(o + 4) / 10, vz: v.getInt8(o + 5) / 10, seen: (v.getUint8(o + 6) & 1) === 1 })
  }
  return { t: v.getUint32(2, true) / 1000, players }
}

// the server's late-join answer: ticks back to back in one buffer -> each tick's bytes
export const splitTicks = (bytes) => {
  const u8 = bytes instanceof Uint8Array ? bytes : bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : ArrayBuffer.isView(bytes) ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : null
  const out = []
  if (!u8) return out
  for (let off = 0; off + 6 <= u8.length; ) {
    const len = tickBytes(u8[off + 1])
    if (u8[off] !== TICK_VERSION || u8[off + 1] > MAX_PLAYERS || off + len > u8.length) break
    out.push(u8.subarray(off, off + len))
    off += len
  }
  return out
}

const KINDS = new Set(["hit", "score", "roster"])
const str = (v, n) => String(v ?? "").slice(0, n)
// an event as it may be relayed and kept (shared by the server and the viewers): null if bad
export const cleanEvent = (e) => {
  if (!e || typeof e !== "object" || !KINDS.has(e.k)) return null
  const t = Number.isFinite(Number(e.t)) ? clamp(Math.round(Number(e.t)), 0, 0xffffffff) : 0
  if (e.k === "hit") {
    const p = Number(e.p)
    if (!Number.isInteger(p) || p < 0 || p >= MAX_PLAYERS) return null
    return { k: "hit", t, p, h: clamp(Math.round(Number(e.h) || 100), 10, 300), s: e.s === "bh" ? "bh" : "fh", src: e.src === "swing" ? "swing" : "sound" }
  }
  if (e.k === "score") {
    const a = clamp(Math.round(Number(e.a) || 0), 0, 99)
    const b = clamp(Math.round(Number(e.b) || 0), 0, 99)
    return { k: "score", t, a, b, call: str(e.call, 16), over: !!e.over }
  }
  if (!Array.isArray(e.players)) return null
  const players = e.players.slice(0, MAX_PLAYERS).map((p, i) => ({ slot: i, name: str(p?.name, 32) || `Player ${i + 1}`, team: p?.team === 1 ? 1 : 0, hand: p?.hand === -1 ? -1 : 1 }))
  return { k: "roster", t, players }
}
