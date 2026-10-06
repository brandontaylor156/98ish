// Spatial voice: the signaling relay shared by My Park (server/park), Come Over
// (server/aim/hangout.js) and Watch Together (server/aim/together.js).
//
// Voice itself never touches the server: browsers connect to each other directly over
// WebRTC (audio only, Opus ~32 kbps) and the server only passes their connection messages
// along (an offer, its answer, network candidates, a goodbye: a few KB per pair). Nothing is
// recorded or stored; a room's voice list lives in memory while people are in it.
//
// A "room" is whatever the caller says it is (a park instance, a hangout, a Watch Together
// session); the caller has already checked that the person is in it. Here:
//   set(room, member, on)            voice on/off; -> the room's voice list (members)
//   signal(room, from, to, msg)      relays msg to `to` if both have voice on in that room;
//                                    -> { ok } | { ok: false, error }
//   leave(member)                    off everywhere (left, signed off, dropped)
//   members(room)                    who has voice on
// emit(member, event, payload) delivers to one member; `prefix` names the events
// (`${prefix}:vc` with the list, `${prefix}:sig` with { from, kind, data }).

const KINDS = new Set(["offer", "answer", "ice", "bye"])
const MAX_SDP = 16 * 1024
const MAX_CANDIDATE = 1024
const SIGNALS_PER_10S = 80 // ICE trickles a burst at the start of each connection
const MAX_VOICE_PER_ROOM = 16

// only what RTCPeerConnection needs, size-capped; anything else -> null
const cleanSignal = (kind, data) => {
  if (!KINDS.has(kind)) return null
  if (kind === "bye") return { kind, data: null }
  if (!data || typeof data !== "object") return null
  if (kind === "offer" || kind === "answer") {
    if (typeof data.sdp !== "string" || data.sdp.length > MAX_SDP || !data.sdp.startsWith("v=0")) return null
    return { kind, data: { type: kind, sdp: data.sdp } }
  }
  // ice: a candidate (an empty candidate string is the end-of-candidates marker)
  if (typeof data.candidate !== "string" || data.candidate.length > MAX_CANDIDATE) return null
  const out = { candidate: data.candidate }
  if (typeof data.sdpMid === "string" && data.sdpMid.length <= 64) out.sdpMid = data.sdpMid
  if (Number.isInteger(data.sdpMLineIndex) && data.sdpMLineIndex >= 0 && data.sdpMLineIndex < 16) out.sdpMLineIndex = data.sdpMLineIndex
  return { kind, data: out }
}

const createVoiceRelay = ({ emit, prefix, now = () => Date.now(), maxPerRoom = MAX_VOICE_PER_ROOM } = {}) => {
  const rooms = new Map() // room -> Set(member)
  const where = new Map() // member -> Set(room)
  const counts = new Map() // member -> { t, n } (signals in the current 10 s window)

  const members = (room) => [...(rooms.get(room) || [])]
  const announce = (room) => {
    const list = members(room)
    for (const m of list) emit(m, `${prefix}:vc`, { room, on: list })
  }

  const set = (room, member, on) => {
    let set = rooms.get(room)
    if (on) {
      if (!set) rooms.set(room, (set = new Set()))
      if (!set.has(member) && set.size >= maxPerRoom) return { ok: false, error: "Voice is full here right now." }
      set.add(member)
      if (!where.has(member)) where.set(member, new Set())
      where.get(member).add(room)
    } else if (set) {
      if (set.delete(member)) emit(member, `${prefix}:vc`, { room, on: [] })
      where.get(member)?.delete(room)
      if (!set.size) rooms.delete(room)
    }
    announce(room)
    return { ok: true, on: members(room) }
  }

  const allowed = (member) => {
    const t = now()
    const c = counts.get(member)
    if (!c || t - c.t > 10_000) {
      counts.set(member, { t, n: 1 })
      return true
    }
    c.n++
    return c.n <= SIGNALS_PER_10S
  }

  const signal = (room, from, to, msg = {}) => {
    const set = rooms.get(room)
    if (!set || !set.has(from)) return { ok: false, error: "Turn voice on first." }
    if (from === to || !set.has(to)) return { ok: false, error: "They don't have voice on." }
    if (!allowed(from)) return { ok: false, error: "Slow down." }
    const clean = cleanSignal(msg.kind, msg.data)
    if (!clean) return { ok: false, error: "That isn't a voice message." }
    emit(to, `${prefix}:sig`, { room, from, ...clean })
    return { ok: true }
  }

  const leave = (member) => {
    for (const room of [...(where.get(member) || [])]) set(room, member, false)
    where.delete(member)
    counts.delete(member)
  }

  // a whole room went away (the hangout ended, the park closed)
  const drop = (room) => {
    for (const m of members(room)) {
      where.get(m)?.delete(room)
      emit(m, `${prefix}:vc`, { room, on: [] })
    }
    rooms.delete(room)
  }

  return { set, signal, leave, drop, members, rooms }
}

module.exports = { createVoiceRelay, cleanSignal, MAX_SDP, SIGNALS_PER_10S }
