// Pictures and voice messages for 98 Messenger IMs, in the browser: making a picture small
// enough to send (JPEG, 1600 px, about 600 KB, plus a 240 px preview), recording a voice
// message (AAC in MP4 where the browser can, else Opus in WebM; 60 seconds at most), sending
// the bytes straight to online storage with the signed URL the server hands out, and fetching
// them once per device (kept in historyDb's media store).

import { decodeUpload, loadImage, toJpeg } from "../../photos/library"
import { getAudioContext, masterOutput } from "../../../../utils/audio"
import { getMedia, putMedia } from "./historyDb"
import { MAX_VOICE_SECONDS, PICTURE_BYTES, PICTURE_SIDE, THUMB_SIDE, pickVoiceType, waveform } from "./historyCore"

const MAX_CHARS = Math.floor((PICTURE_BYTES * 4) / 3)

export const dataUrlToBlob = (url) => {
  const [head, body] = String(url).split(",")
  const mime = /data:([^;]+)/.exec(head)?.[1] || "application/octet-stream"
  const bin = atob(body || "")
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

const thumbOf = async (dataUrl) => toJpeg(await loadImage(dataUrl), { maxSide: THUMB_SIDE, maxChars: 16_000 }).data

// A File (device upload, camera) or a data URL (from My Pictures) -> { blob, width, height, thumb }
export const preparePicture = async (source) => {
  const fitted = typeof source === "string" ? toJpeg(await loadImage(source), { maxSide: PICTURE_SIDE, maxChars: MAX_CHARS }) : await decodeUpload(source, { maxSide: PICTURE_SIDE, maxChars: MAX_CHARS })
  return { blob: dataUrlToBlob(fitted.data), width: fitted.width, height: fitted.height, thumb: await thumbOf(fitted.data), dataUrl: fitted.data }
}

// ---- sending and fetching ----

// request: AimContext's socket request(event, payload). -> { ok, id } | the server's refusal
export const uploadMedia = async (request, blob, info) => {
  const ticket = await request("aim:mediaUpload", { ...info, mime: blob.type, size: blob.size })
  if (!ticket?.ok) return ticket || { ok: false }
  let sent = null
  try {
    const type = ticket.headers?.["x-content-type"] || ticket.headers?.["Content-Type"] || "application/octet-stream"
    sent = await fetch(ticket.url, { method: ticket.method || "PUT", headers: ticket.headers || {}, body: new Blob([blob], { type }) })
  } catch {
    sent = null
  }
  if (!sent?.ok) return { ok: false, error: "Online storage couldn't be reached. Please try again." }
  const commit = await request("aim:mediaCommit", { id: ticket.id })
  return commit?.ok ? { ok: true, id: ticket.id } : commit || { ok: false }
}

// the bytes of a picture or voice message: from this device, else fetched once
// -> { blob } | { expired } | { resting } | { error }
const inflight = new Map()
export const loadMedia = (request, acct, media) => {
  const key = `${acct}|${media.id}`
  if (inflight.has(key)) return inflight.get(key)
  const run = (async () => {
    const cached = await getMedia(acct, media.id)
    if (cached) return { blob: cached }
    const ticket = await request("aim:mediaUrl", { id: media.id })
    if (!ticket?.ok) return ticket?.expired ? { expired: true } : ticket?.resting ? { resting: true, until: ticket.until } : { error: ticket?.error || "It couldn't be fetched." }
    try {
      const response = await fetch(ticket.url)
      if (!response.ok) return { error: "It couldn't be fetched." }
      const blob = new Blob([await response.arrayBuffer()], { type: ticket.mime })
      await putMedia(acct, media.id, blob)
      return { blob }
    } catch {
      return { error: "Online storage couldn't be reached." }
    }
  })()
  inflight.set(key, run)
  run.finally(() => setTimeout(() => inflight.delete(key), 1000))
  return run
}

// ---- voice messages ----

export const canRecord = () => typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof window.MediaRecorder !== "undefined"

// the microphone, asked for when the voice bar opens (so holding the button records at once)
export const openMicrophone = () => navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
export const closeMicrophone = (stream) => stream?.getTracks().forEach((t) => t.stop())

// Start recording on an open microphone. -> { stop(): Promise<{ blob, d, wf } | null>, cancel() }
// `onLimit` runs at 60 seconds (the caller sends what it has).
export const startRecording = (stream, { onLimit } = {}) => {
  const type = pickVoiceType((t) => window.MediaRecorder.isTypeSupported?.(t))
  const recorder = new window.MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 48_000 } : { audioBitsPerSecond: 48_000 })
  const chunks = []
  const started = performance.now()
  recorder.ondataavailable = (e) => e.data?.size && chunks.push(e.data)
  recorder.start(250)
  const limit = setTimeout(() => onLimit?.(), MAX_VOICE_SECONDS * 1000)
  let cancelled = false
  const finished = new Promise((resolve) => (recorder.onstop = resolve))
  return {
    started,
    stop: async () => {
      clearTimeout(limit)
      if (recorder.state !== "inactive") recorder.stop()
      await finished
      if (cancelled || !chunks.length) return null
      const mime = String(recorder.mimeType || chunks[0].type || type || "audio/webm").split(";")[0]
      const blob = new Blob(chunks, { type: mime })
      let d = (performance.now() - started) / 1000
      let wf = "0".repeat(40)
      try {
        const ctx = getAudioContext()
        const decoded = await ctx.decodeAudioData(await blob.arrayBuffer())
        d = decoded.duration || d
        wf = waveform(decoded.getChannelData(0))
      } catch {
        // can't decode here: a flat waveform
      }
      return { blob, d: Math.min(MAX_VOICE_SECONDS, Math.max(0.3, d)), wf }
    },
    cancel: () => {
      cancelled = true
      clearTimeout(limit)
      if (recorder.state !== "inactive") recorder.stop()
    },
  }
}

// Play a voice message through 98ish's audio (taskbar volume and mute). -> { stop, done }
let playing = null
export const playVoice = (blob, { onEnd } = {}) => {
  playing?.stop()
  let stopped = false
  let halt = () => {}
  let resolveDone
  const done = new Promise((resolve) => (resolveDone = resolve))
  const finish = () => {
    if (stopped) return
    stopped = true
    halt()
    resolveDone()
    onEnd?.()
  }
  ;(async () => {
    try {
      const ctx = getAudioContext()
      if (ctx.state === "suspended") await ctx.resume().catch(() => {})
      const buffer = await ctx.decodeAudioData(await blob.arrayBuffer())
      if (stopped) return
      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.connect(masterOutput(ctx))
      source.onended = finish
      halt = () => {
        try {
          source.stop()
        } catch {
          // ended
        }
      }
      source.start()
    } catch {
      if (stopped) return
      // a format Web Audio can't decode here: the browser's own player
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audio.onended = finish
      halt = () => {
        audio.pause()
        URL.revokeObjectURL(url)
      }
      audio.play().catch(finish)
    }
  })()
  const handle = { stop: finish, done }
  playing = handle
  return handle
}
