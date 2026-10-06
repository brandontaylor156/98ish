// Be Yourself in calls: two extra P2P data channels on the call's own RTCPeerConnection
// (aim/call/engine.js calls attachHeadChannels(pc) when it makes the peer, before the offer,
// so they ride the call's SDP; "negotiated" with fixed ids, so both sides just create them):
//   head-live   unordered, no retransmits: one face packet per frame (~1.2 KB/s)
//   head-file   reliable: your head file (once per call, 16 KB chunks), then "on"/"off"
// Nothing touches 98ish's server: it only relays the call's signaling, as before. A friend's
// head is kept in memory for this call only.
import { useSyncExternalStore } from "react"
import { chunkHead, decodePacket, headAssembler, headId, isNewer } from "./headCore.js"

let live = null
let file = null
let asm = null
let lastSeq = null
const liveFns = new Set()
let state = { remoteOn: false, remoteHead: null, remoteHeadId: null, receiving: 0, sentHeadId: null, linkOpen: false }
const subs = new Set()
const set = (patch) => {
  state = { ...state, ...patch }
  subs.forEach((f) => f())
}
export const getHeadLink = () => state
export const useHeadLink = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), getHeadLink)
export const onRemoteFace = (fn) => (liveFns.add(fn), () => liveFns.delete(fn))

const CONTROL = 3 // [3][json]: { t: "on", id } | { t: "off" }
const enc = new TextEncoder()
const dec = new TextDecoder()

export const attachHeadChannels = (pc) => {
  detachHeadChannels()
  try {
    live = pc.createDataChannel("head-live", { negotiated: true, id: 7, ordered: false, maxRetransmits: 0 })
    file = pc.createDataChannel("head-file", { negotiated: true, id: 8, ordered: true })
  } catch {
    live = file = null
    return
  }
  live.binaryType = file.binaryType = "arraybuffer"
  asm = headAssembler()
  lastSeq = null
  const opened = () => set({ linkOpen: live?.readyState === "open" && file?.readyState === "open" })
  live.onopen = file.onopen = opened
  live.onclose = file.onclose = () => set({ linkOpen: false })
  live.onmessage = (e) => {
    const p = decodePacket(new Uint8Array(e.data))
    if (!p || !isNewer(p.seq, lastSeq)) return
    lastSeq = p.seq
    liveFns.forEach((fn) => fn(p))
  }
  file.onmessage = (e) => {
    const b = new Uint8Array(e.data)
    if (b[0] === CONTROL) {
      let msg = null
      try {
        msg = JSON.parse(dec.decode(b.subarray(1)))
      } catch {}
      if (msg?.t === "on") set({ remoteOn: true, remoteHeadId: msg.id || null })
      if (msg?.t === "off") set({ remoteOn: false })
      return
    }
    const whole = asm.push(b)
    if (whole) set({ remoteHead: whole, remoteHeadId: headId(whole), receiving: 0 })
    else set({ receiving: asm.progress() })
  }
}

export const detachHeadChannels = () => {
  for (const c of [live, file]) {
    try {
      c?.close()
    } catch {}
  }
  live = file = asm = null
  lastSeq = null
  set({ remoteOn: false, remoteHead: null, remoteHeadId: null, receiving: 0, sentHeadId: null, linkOpen: false })
}

const control = (msg) => {
  if (file?.readyState !== "open") return false
  file.send(Uint8Array.of(CONTROL, ...enc.encode(JSON.stringify(msg))))
  return true
}

// turn 3D Me on: send your head file once (if the other side doesn't have this one), then "on"
export const startSending = async (bytes) => {
  if (file?.readyState !== "open") return { ok: false, error: "The call isn't connected yet." }
  const id = headId(bytes)
  if (state.sentHeadId !== id) {
    for (const chunk of chunkHead(bytes)) {
      // don't flood the channel's buffer (a 4 MB head is ~250 chunks)
      while (file && file.bufferedAmount > 1024 * 1024) await new Promise((r) => setTimeout(r, 30))
      if (file?.readyState !== "open") return { ok: false, error: "The call ended." }
      file.send(chunk)
    }
    set({ sentHeadId: id })
  }
  control({ t: "on", id })
  return { ok: true }
}
export const stopSending = () => control({ t: "off" })

// one face packet (dropped when the channel is busy: a newer one is coming)
export const sendFace = (packet) => {
  if (live?.readyState !== "open" || live.bufferedAmount > 16 * 1024) return false
  live.send(packet)
  return true
}
