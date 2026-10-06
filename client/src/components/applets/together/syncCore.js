// Watch & Listen Together: the pure parts (no React, no YouTube), shared by the window and
// the tests. The server keeps { playing, pos, rate, at }: the position `pos` (seconds) at
// server time `at` (ms); each player steers toward pos + (serverNow - at) / 1000 * rate.

// "https://youtu.be/ID?t=42", "youtube.com/watch?v=ID&t=1m5s", "/shorts/ID", "/embed/ID",
// "/live/ID", "music.youtube.com/watch?v=ID" or just the 11-character ID -> { id, start } | null
export const parseYouTube = (text) => {
  const s = String(text || "").trim()
  if (!s) return null
  let id = null
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) id = s
  else {
    const m = s.match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/|v\/))([A-Za-z0-9_-]{11})/i)
    if (m) id = m[1]
  }
  if (!id) return null
  const t = s.match(/[?&#](?:t|start)=([0-9hms]+)/i)
  return { id, start: t ? parseStart(t[1]) : 0 }
}

// "90" | "1m30s" | "1h2m3s" -> seconds
export const parseStart = (value) => {
  const v = String(value || "")
  if (/^\d+$/.test(v)) return Number(v)
  const m = v.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i)
  if (!m) return 0
  return (Number(m[1]) || 0) * 3600 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0)
}

// Clock offset (server minus this device, ms) from round trips: t0 sent, t1 answered, the
// server's clock in between. The fastest round trip is the most trustworthy.
export const offsetFrom = (samples) => {
  const good = samples.filter((x) => Number.isFinite(x.t0) && Number.isFinite(x.t1) && Number.isFinite(x.server) && x.t1 >= x.t0)
  if (!good.length) return 0
  const best = good.reduce((a, b) => (b.t1 - b.t0 < a.t1 - a.t0 ? b : a))
  return best.server - (best.t0 + best.t1) / 2
}

// where the video should be right now (seconds), given the server's time
export const expectedPos = (state, serverNow) => {
  if (!state) return 0
  const pos = Number(state.pos) || 0
  if (!state.playing) return pos
  return Math.max(0, pos + ((serverNow - state.at) / 1000) * (Number(state.rate) || 1))
}

export const DRIFT_SEEK = 0.6 // seconds off before a player jumps to catch up
export const SEEK_LEAD = 0.25 // a seek lands a little ahead: buffering eats a moment
export const SEEK_COOLDOWN_MS = 1500
export const USER_JUMP = 2.5 // a jump this big between two checks was someone scrubbing

// What one player should do to match the shared state.
// { expected, actual, shouldPlay, isPlaying, buffering, sinceSeekMs } -> { play?, pause?, seek? }
export const decide = ({ expected, actual, shouldPlay, isPlaying, buffering = false, sinceSeekMs = Infinity }) => {
  const out = {}
  if (shouldPlay && !isPlaying && !buffering) out.play = true
  if (!shouldPlay && isPlaying) out.pause = true
  const drift = actual - expected
  if (Math.abs(drift) > DRIFT_SEEK && sinceSeekMs > SEEK_COOLDOWN_MS && !(buffering && shouldPlay && Math.abs(drift) < 3)) {
    out.seek = Math.max(0, expected + (shouldPlay ? SEEK_LEAD : 0))
  }
  return out
}

// Did the person scrub this player themselves (YouTube's own controls)? Compares how far it
// moved since the last check with how far it should have.
export const userJumped = ({ last, actual, elapsedMs, rate = 1, wasPlaying, sinceSeekMs }) => {
  if (last == null || sinceSeekMs < SEEK_COOLDOWN_MS + 500) return false
  const should = wasPlaying ? (elapsedMs / 1000) * rate : 0
  return Math.abs(actual - last - should) > USER_JUMP
}

export const canControl = (state, meKey) => !!state && (state.anyone || state.hostKey === meKey)
export const current = (state) => (state?.queue?.length ? state.queue[state.index] || null : null)

export const clock = (seconds) => {
  const s = Math.max(0, Math.floor(Number(seconds) || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const pad = (n) => String(n).padStart(2, "0")
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`
}

// who's watching, for the title strip: "Rosie, Theo and 2 more"
export const peopleLine = (people = [], max = 3) => {
  const names = people.map((p) => p.name)
  if (names.length <= max) return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0] || ""
  return `${names.slice(0, max).join(", ")} and ${names.length - max} more`
}

export const REACTIONS = ["❤️", "😂", "😮", "👏", "🔥", "😢", "👍", "🎉"]
export const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]
