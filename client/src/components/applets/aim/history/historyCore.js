// 98 Messenger conversations: the pure parts (tested by historyCore.test.js). No React, no
// browser APIs.
//
// A conversation is named by `ck`: the other person's key (screen name without spaces, lower
// case), or "#<room key>" for a Buddy Chat room. A message:
//   { id, ck, conv (who / which room, as shown), from, mine, text, style, time,
//     media?: { id, k: "image" | "audio", w, h, d, z, wf }, thumb? (preview, this device only),
//     r?: { key: reaction }, held? (waiting for someone signed off), deliveredAt?, auto?,
//     system? (a grey line, never saved), error? }

export const keyOf = (screenName) => String(screenName || "").replace(/\s+/g, "").toLowerCase()
export const roomCk = (room) => `#${keyOf(room)}`
export const isRoomCk = (ck) => String(ck).startsWith("#")

// the six reactions, in picker order
export const REACTIONS = [
  { id: "heart", emoji: "❤️", label: "Love" },
  { id: "lol", emoji: "😂", label: "LOL" },
  { id: "wow", emoji: "😮", label: "Wow" },
  { id: "sad", emoji: "😢", label: "Sad" },
  { id: "up", emoji: "👍", label: "Thumbs up" },
  { id: "bang", emoji: "‼️", label: "!!" },
]
export const reactionById = (id) => REACTIONS.find((r) => r.id === id) || null

// { key: reaction } -> [{ id, emoji, label, count, mine }] in picker order
export const reactionCounts = (r, meKey) => {
  if (!r) return []
  const out = []
  for (const reaction of REACTIONS) {
    const who = Object.entries(r).filter(([, value]) => value === reaction.id).map(([k]) => k)
    if (who.length) out.push({ ...reaction, count: who.length, mine: who.includes(meKey) })
  }
  return out
}

// someone's reaction changes: one per person per message (null takes it away)
export const applyReaction = (message, key, emoji) => {
  const r = { ...(message.r || {}) }
  if (emoji) r[key] = emoji
  else delete r[key]
  return { ...message, r }
}

// a message as the server sends it (aim:history, aim:im, aim:chat) -> a message here
export const fromServer = (m, { meKey, ck, conv } = {}) => {
  const mine = m.mine ?? (meKey ? keyOf(m.from) === meKey : false)
  const out = {
    id: m.id,
    ck: m.ck ?? ck,
    conv: m.conv ?? conv,
    from: m.from,
    mine,
    text: m.text || "",
    style: m.style,
    time: m.time,
  }
  if (m.room) out.room = m.room
  if (m.media) out.media = m.media
  if (m.thumb) out.thumb = m.thumb
  // the server's word on reactions is complete: none listed means none
  out.r = m.r && Object.keys(m.r).length ? m.r : undefined
  out.held = !!m.held
  if (m.auto) out.auto = true
  return out
}

const byTime = (a, b) => a.time - b.time || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

// merge messages into a sorted list: same id -> the newer facts win, but what only this
// device knows (the preview picture, "Delivered") stays
export const mergeMessages = (list, incoming) => {
  if (!incoming?.length) return list
  const byId = new Map()
  const out = []
  for (const m of list) {
    if (m.id) byId.set(m.id, out.length)
    out.push(m)
  }
  let sorted = true
  for (const m of incoming) {
    const at = m.id ? byId.get(m.id) : undefined
    if (at !== undefined) {
      const prev = out[at]
      const merged = { ...prev, ...m }
      if (!m.thumb && prev.thumb) merged.thumb = prev.thumb
      if (prev.deliveredAt && !m.deliveredAt) Object.assign(merged, { deliveredAt: prev.deliveredAt, held: false })
      out[at] = merged
      continue
    }
    if (out.length && byTime(out[out.length - 1], m) > 0) sorted = false
    if (m.id) byId.set(m.id, out.length)
    out.push(m)
  }
  return sorted ? out : out.sort(byTime)
}

// a temporary id for a message on its way (until the server answers with its own)
export const tempId = () => `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
export const isTemp = (id) => String(id || "").startsWith("t-")

// The line under your last message: "Read 10:42 PM", "Delivered", or waiting for someone
// signed off. `read` = { at (newest message they've seen), when } or null.
export const lastStatus = (messages, read, { formatTime = (t) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }), name = "They" } = {}) => {
  let last = null
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.system || m.auto) continue
    if (!m.mine) break // they wrote after you: nothing to say
    last = m
    break
  }
  if (!last || isTemp(last.id) || last.failed) return null
  if (read && read.at >= last.time) return { kind: "read", text: `Read ${formatTime(read.when || read.at)}` }
  if (last.held && !last.deliveredAt) return { kind: "waiting", text: `${name} will get it when they sign on` }
  if (last.deliveredAt) return { kind: "delivered", text: "Delivered" }
  return null
}

// the newest message from the other person (what "Read" is about)
export const newestIncoming = (messages) => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (!m.mine && !m.system && !m.auto && m.id && !isTemp(m.id)) return m
  }
  return null
}

// ---- voice messages ----

export const MAX_VOICE_SECONDS = 60

// a recording's samples -> 40 bars as digits 0-9 (stored with the message)
export const waveform = (samples, bars = 40) => {
  const n = samples?.length || 0
  if (!n) return "0".repeat(bars)
  const peaks = []
  const step = n / bars
  for (let b = 0; b < bars; b++) {
    let peak = 0
    const from = Math.floor(b * step)
    const to = Math.max(from + 1, Math.floor((b + 1) * step))
    for (let i = from; i < to && i < n; i++) peak = Math.max(peak, Math.abs(samples[i]))
    peaks.push(peak)
  }
  const top = Math.max(...peaks) || 1
  return peaks.map((p) => Math.min(9, Math.round((p / top) * 9))).join("")
}

export const formatDuration = (seconds) => {
  const s = Math.max(0, Math.round(Number(seconds) || 0))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

// the best recording format this browser has: AAC in MP4 (iPhone, and what iPhones play),
// else Opus in WebM
export const VOICE_TYPES = ["audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"]
export const pickVoiceType = (isTypeSupported) => VOICE_TYPES.find((t) => isTypeSupported(t)) || ""

// ---- pictures ----

export const PICTURE_SIDE = 1600
export const PICTURE_BYTES = 600 * 1024
export const THUMB_SIDE = 240

// width and height to draw a w x h picture at, fitting `max` on its long side
export const fitWithin = (w, h, max) => {
  const scale = Math.min(1, max / Math.max(1, w), max / Math.max(1, h))
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) }
}

// what a notification or the Buddy List says for a message
export const previewText = (message) => (message?.media?.k === "image" ? "📷 Picture" : message?.media?.k === "audio" ? "🎤 Voice message" : String(message?.text || ""))

// what to say when a picture or voice message couldn't go
export const sendFailure = (kind, result) => {
  const what = kind === "audio" ? "Voice message" : "Picture"
  if (!result || result.resting) return `${what} couldn't be sent: online storage is resting${result?.until ? ` until ${new Date(result.until).toLocaleDateString([], { month: "short", day: "numeric" })}` : ""}. You can still send messages.`
  return `${what} couldn't be sent: ${String(result.error || "please try again.").replace(/^\w/, (c) => c.toLowerCase())}`
}
