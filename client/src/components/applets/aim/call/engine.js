// 98 Messenger calls: one call at a time, browser to browser (WebRTC). The 98 Messenger
// socket carries the signaling (server/aim/calls.js); CallManager connects this module to
// it while you're signed on. UI reads the state with useCall().
//
// Phases: idle -> outgoing (ringing them) | incoming (ringing you) -> connecting -> active
//         -> ended (shows why for a moment) -> idle
// iPhone: getUserMedia must start inside the tap, so startCall/answer ask for the camera
// and microphone before anything else.

import { useSyncExternalStore } from "react"
import { getSettings, subscribeSettings } from "../../../../utils/settings"

const CONNECT_TIMEOUT_MS = 30_000 // answered but no media path: give up and say why
const DISCONNECTED_RESTART_MS = 6_000 // "disconnected" this long: try an ICE restart
const FAILED_GRACE_MS = 12_000 // after a restart, how long to wait before ending
const STATS_MS = 2000

const IDLE = {
  phase: "idle",
  id: null,
  peer: null,
  direction: null, // "out" | "in"
  video: false, // the call was placed as a video call
  startedAt: null, // when media connected
  reason: null, // why it ended
  error: null, // a message worth reading (couldn't connect, camera blocked)
  muted: false,
  camera: false,
  screen: false,
  facing: "user",
  remote: { muted: false, camera: false, screen: false },
  localStream: null,
  remoteStream: null,
  quality: null, // { level 1-4, rtt (ms), loss (%), relay }
  reconnecting: false,
  turn: false,
  notice: null, // a heads-up shown in the call window
  cameraLost: false, // the camera stopped by itself (turn it back on when we can)
  audioBlocked: false, // the browser held back the call's sound until a tap
  duration: 0,
}

let state = IDLE
const listeners = new Set()
let link = null // { request(event, payload), emit(event, payload), notify(kind, info) } from CallManager

// per-call internals
let pc = null
let pendingIce = []
let pendingOffer = null
let iceConfig = null
let timers = {}
let statsPrev = null
let restarted = false

const set = (patch) => {
  state = { ...state, ...patch }
  listeners.forEach((fn) => fn())
}
export const getCall = () => state
const subscribe = (fn) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
export const useCall = () => useSyncExternalStore(subscribe, getCall)

export const inCall = (s = state) => ["outgoing", "incoming", "connecting", "active"].includes(s.phase)
export const isIOS = () =>
  typeof navigator !== "undefined" &&
  (/iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1))
export const isPhone = () => typeof navigator !== "undefined" && (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || isIOS())
export const canShareScreen = () =>
  typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia && !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) && !isIOS()
export const callsSupported = () =>
  typeof window !== "undefined" && !!window.RTCPeerConnection && !!navigator.mediaDevices?.getUserMedia

const clearTimer = (name) => {
  clearTimeout(timers[name])
  clearInterval(timers[name])
  delete timers[name]
}
const clearTimers = () => Object.keys(timers).forEach(clearTimer)

const stopStream = (stream) => stream?.getTracks().forEach((t) => t.stop())

const VIDEO = { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 } }
const AUDIO = { echoCancellation: true, noiseSuppression: true, autoGainControl: true }

const mediaError = (error, video) => {
  const name = error?.name || ""
  if (!window.isSecureContext) return "Calls need a secure (https) connection."
  if (name === "NotAllowedError" || name === "SecurityError")
    return `98ish isn't allowed to use your ${video ? "camera and microphone" : "microphone"}. Allow it in your browser's site settings${isIOS() ? " (Settings > Safari > Camera / Microphone)" : ""}, then try again.`
  if (name === "NotFoundError" || name === "OverconstrainedError") return `No ${video ? "camera or microphone" : "microphone"} was found.`
  if (name === "NotReadableError") return "Your camera or microphone is being used by another app."
  return "Couldn't start your camera or microphone."
}

// Camera and microphone (video falls back to voice-only when there's no camera)
const getMedia = async (video) => {
  if (!callsSupported()) throw Object.assign(new Error("This browser can't make calls."), { friendly: "This browser can't make calls. Try Safari or Chrome." })
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: AUDIO, video: video ? { ...VIDEO, facingMode: "user" } : false })
  } catch (error) {
    if (video && (error?.name === "NotFoundError" || error?.name === "NotReadableError" || error?.name === "OverconstrainedError")) {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO, video: false }).catch(() => null)
      if (stream) {
        console.warn("[call] camera unavailable, voice only:", error?.name)
        set({ notice: `${mediaError(error, true).replace(/\.$/, "")}, so this is a voice call for now. Tap Camera On to try again.` })
        return stream
      }
    }
    throw Object.assign(error || new Error("media"), { friendly: mediaError(error, video) })
  }
}

const loadIce = async () => {
  if (iceConfig) return iceConfig
  const result = await link.request("aim:callIce", {})
  iceConfig = result?.ok ? { iceServers: result.iceServers, turn: !!result.turn } : { iceServers: [{ urls: "stun:stun.l.google.com:19302" }], turn: false }
  return iceConfig
}

const videoSender = () => pc?.getTransceivers().find((t) => t.receiver.track?.kind === "video")?.sender || null
const audioSender = () => pc?.getTransceivers().find((t) => t.receiver.track?.kind === "audio")?.sender || null

const sendMedia = () => {
  if (!state.id || !link) return
  link.request("aim:callMedia", { id: state.id, muted: state.muted, camera: state.camera, screen: state.screen })
}

const signal = (kind, data) => state.id && link?.request("aim:callSignal", { id: state.id, kind, data })

// ---- what you hear: a hidden <audio> outside any window, so the call keeps sounding
// while its window is minimized or another app is on top. Its volume follows the taskbar
// slider; the taskbar mute doesn't silence a call you're on.

let audioEl = null
let audioOff = null
const callVolume = (s) => Math.max(0.05, Math.min(1, (s?.volume ?? 80) / 100))
const remoteAudio = () => {
  if (audioEl || typeof document === "undefined") return audioEl
  audioEl = document.createElement("audio")
  audioEl.autoplay = true
  audioEl.setAttribute("playsinline", "")
  audioEl.className = "callRemoteAudio"
  audioEl.style.display = "none"
  document.body.appendChild(audioEl)
  audioEl.volume = callVolume(getSettings())
  audioOff = subscribeSettings((s) => {
    if (audioEl) audioEl.volume = callVolume(s)
  })
  return audioEl
}

const playRemote = (stream) => {
  const el = remoteAudio()
  if (!el) return
  if (el.srcObject !== stream) el.srcObject = stream
  const played = el.play?.()
  played?.then?.(() => state.audioBlocked && set({ audioBlocked: false })).catch?.(() => set({ audioBlocked: true }))
}

// iPhone may hold back the call's sound until a tap
export const unblockAudio = () => {
  if (!audioEl) return
  audioEl.play?.()?.then?.(() => set({ audioBlocked: false })).catch?.(() => {})
}

const releaseAudio = () => {
  if (!audioEl) return
  audioEl.pause?.()
  audioEl.srcObject = null
  audioEl.remove()
  audioEl = null
  audioOff?.()
  audioOff = null
}

// ---- the peer connection ----

const createPeer = async () => {
  const { iceServers, turn } = await loadIce()
  set({ turn })
  const peer = new RTCPeerConnection({ iceServers })
  pc = peer
  const remote = new MediaStream()
  set({ remoteStream: remote })

  peer.ontrack = (e) => {
    if (pc !== peer) return
    if (!remote.getTracks().includes(e.track)) remote.addTrack(e.track)
    set({ remoteStream: remote })
    if (e.track.kind === "audio") playRemote(remote)
  }
  peer.onicecandidate = (e) => {
    if (pc !== peer) return
    const c = e.candidate
    signal("ice", c ? { candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex } : { candidate: null })
  }
  const watch = () => {
    if (pc !== peer) return
    const s = peer.connectionState || peer.iceConnectionState
    const ice = peer.iceConnectionState
    if (s === "connected" || ice === "connected" || ice === "completed") return connected()
    if (s === "disconnected" || ice === "disconnected") return disconnected()
    if (s === "failed" || ice === "failed") return failed()
  }
  peer.onconnectionstatechange = watch
  peer.oniceconnectionstatechange = watch
  return peer
}

const connected = () => {
  clearTimer("connect")
  clearTimer("restart")
  clearTimer("fail")
  restarted = false
  if (state.phase === "connecting") {
    set({ phase: "active", startedAt: Date.now(), reconnecting: false })
    link?.notify("connected")
    sendMedia()
    startStats()
  } else if (state.reconnecting) set({ reconnecting: false })
}

const disconnected = () => {
  if (state.phase !== "active") return
  set({ reconnecting: true })
  if (!timers.restart) timers.restart = setTimeout(() => restartIce(), DISCONNECTED_RESTART_MS)
}

const failed = () => {
  if (state.phase === "active") set({ reconnecting: true })
  if (!restarted && state.direction === "out") return restartIce()
  if (!timers.fail) timers.fail = setTimeout(() => connectFailed(), state.direction === "out" ? FAILED_GRACE_MS : FAILED_GRACE_MS + 4000)
}

// the caller offers again with fresh ICE (a phone moved from Wi-Fi to cellular, etc.)
const restartIce = async () => {
  clearTimer("restart")
  if (!pc || restarted || state.direction !== "out" || !inCall()) return
  restarted = true
  try {
    pc.restartIce?.()
    const offer = await pc.createOffer({ iceRestart: true })
    await pc.setLocalDescription(offer)
    signal("offer", { type: "offer", sdp: pc.localDescription.sdp })
  } catch {
    // the fail timer ends it
  }
  if (!timers.fail) timers.fail = setTimeout(() => connectFailed(), FAILED_GRACE_MS)
}

const failMessage = () =>
  state.turn
    ? `Couldn't connect the call with ${state.peer}. The network may be blocking calls. Try again, or switch to Wi-Fi.`
    : `Couldn't connect the call with ${state.peer}. One of your networks (often cellular data, or a strict work or school Wi-Fi) blocks direct connections, and 98ish has no relay server for calls. Try again with both of you on Wi-Fi.`

const connectFailed = () => {
  if (!inCall()) return
  const wasActive = state.phase === "active"
  hangUp("failed", { error: wasActive ? `The call with ${state.peer} dropped. The connection was lost.` : failMessage() })
}

const flushIce = async () => {
  const list = pendingIce
  pendingIce = []
  for (const c of list) await pc.addIceCandidate(c).catch(() => {})
}

const startStats = () => {
  clearTimer("stats")
  statsPrev = null
  timers.stats = setInterval(async () => {
    if (!pc || state.phase !== "active") return
    try {
      const report = await pc.getStats()
      let pair = null
      let lost = 0
      let received = 0
      let encoded = null
      const byId = new Map()
      report.forEach((s) => {
        byId.set(s.id, s)
        if (s.type === "transport" && s.selectedCandidatePairId) pair = s.selectedCandidatePairId
        if (s.type === "inbound-rtp" && !s.isRemote) {
          lost += s.packetsLost || 0
          received += s.packetsReceived || 0
        }
        if (s.type === "outbound-rtp" && s.kind === "video") encoded = (encoded || 0) + (s.framesEncoded || 0)
      })
      let selected = pair ? byId.get(pair) : null
      if (!selected) report.forEach((s) => s.type === "candidate-pair" && s.state === "succeeded" && (s.nominated || s.selected) && (selected ||= s))
      const rtt = selected?.currentRoundTripTime != null ? Math.round(selected.currentRoundTripTime * 1000) : null
      const relay = byId.get(selected?.localCandidateId)?.candidateType === "relay" || byId.get(selected?.remoteCandidateId)?.candidateType === "relay"
      let loss = 0
      if (statsPrev) {
        const dl = Math.max(0, lost - statsPrev.lost)
        const dr = Math.max(0, received - statsPrev.received)
        loss = dl + dr > 0 ? (dl / (dl + dr)) * 100 : 0
      }
      // our camera is on but no frames go out (seen in tests with a camera that had
      // just started): hand the sender its track again
      const sending = videoSender()?.track
      const stalled = !state.screen && sending?.readyState === "live" && encoded !== null && statsPrev && encoded === statsPrev.encoded
      const stalls = stalled ? (statsPrev.stalls || 0) + 1 : 0
      let kicked = statsPrev?.kicked || 0
      if (stalls >= 2 && Date.now() - kicked > 10_000) {
        const sender = videoSender()
        sender
          ?.replaceTrack(null)
          .then(() => (videoSender() === sender && sender.track === null && localVideoTrack() === sending ? sender.replaceTrack(sending) : null))
          .catch(() => {})
        kicked = Date.now()
      }
      statsPrev = { lost, received, encoded, stalls, kicked }
      const r = rtt ?? 999
      const level = r < 150 && loss < 2 ? 4 : r < 300 && loss < 5 ? 3 : r < 600 && loss < 10 ? 2 : 1
      set({ quality: { level, rtt, loss: Math.round(loss * 10) / 10, relay } })
    } catch {
      // stats are a nicety
    }
  }, STATS_MS)
}

// ---- local media ----

const localVideoTrack = () => state.localStream?.getVideoTracks()[0] || null

// The camera can stop by itself mid-call (iPhone backgrounding Safari, a camera unplugged,
// another app taking it): show the other side your card instead of a frozen frame, and say so
const watchVideo = (track) => {
  if (!track) return
  track.addEventListener("ended", () => {
    if (!inCall() || localVideoTrack() !== track) return
    state.localStream.removeTrack(track)
    if (!state.screen) replaceVideo(null)
    set({ camera: false, cameraLost: true, localStream: state.localStream, notice: "Your camera stopped. Tap Camera On to turn it back on." })
    sendMedia()
  })
}

const attachLocal = (stream) => {
  const audio = stream.getAudioTracks()[0] || null
  const video = stream.getVideoTracks()[0] || null
  if (audio) audio.enabled = !state.muted
  watchVideo(video)
  set({ localStream: stream, camera: !!video })
  return { audio, video }
}

// Caller: one audio and one video transceiver, always, so the camera can come on later
// (or a screen be shared) without renegotiating
const addTransceivers = (stream) => {
  const { audio, video } = attachLocal(stream)
  pc.addTransceiver(audio || "audio", { direction: "sendrecv", streams: [stream] })
  pc.addTransceiver(video || "video", { direction: "sendrecv", streams: [stream] })
}

// Callee: fill the caller's transceivers with our tracks
const fillTransceivers = async (stream) => {
  const { audio, video } = attachLocal(stream)
  for (const t of pc.getTransceivers()) {
    const kind = t.receiver.track?.kind
    t.direction = "sendrecv"
    try {
      t.sender.setStreams?.(stream)
    } catch {
      // older browsers: the remote side builds its own stream anyway
    }
    if (kind === "audio" && audio) await t.sender.replaceTrack(audio)
    if (kind === "video" && video) await t.sender.replaceTrack(video)
  }
}

// ---- actions (startCall and answer must run inside a tap) ----

const busyError = () => ({ ok: false, error: "You're already on a call." })

export const startCall = async (screenName, video = false) => {
  if (!link) return { ok: false, error: "Sign on to 98 Messenger to make calls." }
  if (inCall()) return busyError()
  clearTimers()
  set({ ...IDLE, phase: "outgoing", peer: screenName, direction: "out", video: !!video, muted: false })
  link.notify("dialing")
  let stream
  try {
    stream = await getMedia(video)
  } catch (error) {
    set({ ...IDLE, phase: "ended", peer: screenName, video: !!video, reason: "media", error: error.friendly || "Couldn't start the call." })
    link?.notify("ended", state)
    return { ok: false, error: state.error }
  }
  if (state.phase !== "outgoing") return stopStream(stream), { ok: false }
  attachLocal(stream)
  loadIce()
  const result = await link.request("aim:call", { to: screenName, video: !!video })
  if (state.phase !== "outgoing") {
    stopStream(stream)
    if (result?.ok) link?.request("aim:callHangUp", { id: result.id })
    return { ok: false }
  }
  if (!result?.ok) {
    stopStream(stream)
    set({ phase: "ended", reason: result?.busy ? "busy" : "error", error: result?.error || "The call couldn't be placed.", localStream: null, camera: false })
    link.notify("ended", state)
    return result || { ok: false }
  }
  set({ id: result.id, peer: result.to || screenName })
  return result
}

// Caller: they picked up
const onAnswered = async ({ id }) => {
  if (id !== state.id || state.phase !== "outgoing") return
  set({ phase: "connecting" })
  link.notify("connecting")
  timers.connect = setTimeout(() => connectFailed(), CONNECT_TIMEOUT_MS)
  try {
    await createPeer()
    addTransceivers(state.localStream)
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    signal("offer", { type: "offer", sdp: pc.localDescription.sdp })
  } catch {
    hangUp("failed", { error: "Couldn't set up the call in this browser." })
  }
}

const onRing = ({ id, from, video }) => {
  if (inCall()) return // the server already treats us as busy; never two at once
  clearTimers()
  set({ ...IDLE, phase: "incoming", id, peer: from, direction: "in", video: !!video })
  link.notify("ringing", state)
}

export const answer = async (withVideo) => {
  if (state.phase !== "incoming" || !link) return
  const id = state.id
  set({ phase: "connecting", video: state.video || !!withVideo })
  link.notify("answering")
  let stream
  try {
    stream = await getMedia(!!withVideo)
  } catch (error) {
    if (state.id === id) {
      link.request("aim:callDecline", { id })
      set({ phase: "ended", reason: "media", error: error.friendly })
      link.notify("ended", state)
    }
    return
  }
  if (state.id !== id || state.phase !== "connecting") return stopStream(stream)
  attachLocal(stream)
  try {
    await createPeer()
  } catch {
    stopStream(stream)
    return hangUp("failed", { error: "Couldn't set up the call in this browser." })
  }
  if (state.id !== id) return
  const result = await link.request("aim:callAnswer", { id, video: !!withVideo })
  if (!result?.ok) {
    return cleanup({ reason: "gone", error: result?.error || "That call has ended." })
  }
  link.notify("connecting")
  timers.connect = setTimeout(() => connectFailed(), CONNECT_TIMEOUT_MS)
  if (pendingOffer) {
    const offer = pendingOffer
    pendingOffer = null
    await onOffer(offer)
  }
}

export const decline = () => {
  if (state.phase !== "incoming") return
  link?.request("aim:callDecline", { id: state.id })
  cleanup({ reason: "declinedByMe" })
}

const onOffer = async (data) => {
  if (!pc || state.direction !== "in") {
    pendingOffer = data
    return
  }
  try {
    const first = !pc.remoteDescription
    await pc.setRemoteDescription(data)
    if (first) await fillTransceivers(state.localStream)
    await pc.setLocalDescription(await pc.createAnswer())
    signal("answer", { type: "answer", sdp: pc.localDescription.sdp })
    await flushIce()
  } catch {
    hangUp("failed", { error: "Couldn't set up the call in this browser." })
  }
}

const onSignal = async ({ id, kind, data }) => {
  if (id !== state.id) return
  if (kind === "offer") return onOffer(data)
  if (kind === "answer" && pc) {
    try {
      await pc.setRemoteDescription(data)
      await flushIce()
    } catch {
      // a stale answer after a restart
    }
    return
  }
  if (kind === "ice") {
    const candidate = data.candidate ? data : null
    if (!candidate) return
    if (!pc || !pc.remoteDescription) pendingIce.push(candidate)
    else pc.addIceCandidate(candidate).catch(() => {})
  }
}

const onMedia = ({ id, muted, camera, screen }) => {
  if (id !== state.id) return
  set({ remote: { muted: !!muted, camera: !!camera, screen: !!screen } })
}

const onEnd = ({ id, reason }) => {
  if (id !== state.id) return
  // their side gave up connecting: same explanation as if we had
  if (reason === "failed" && state.phase === "connecting") return cleanup({ reason, error: failMessage() })
  cleanup({ reason })
}

export const hangUp = (reason = "hungup", extra = {}) => {
  if (!inCall()) return
  if (state.id) {
    if (state.phase === "incoming") link?.request("aim:callDecline", { id: state.id })
    else link?.request("aim:callHangUp", { id: state.id, reason })
  }
  cleanup({ reason: reason === "hungup" ? "hungupByMe" : reason, ...extra })
}

// local teardown; the call's last state stays visible as "ended" until dismissed
const cleanup = ({ reason, error = null }) => {
  const was = state
  clearTimers()
  if (pc) {
    try {
      pc.ontrack = pc.onicecandidate = pc.onconnectionstatechange = pc.oniceconnectionstatechange = null
      pc.close()
    } catch {
      // closed
    }
  }
  pc = null
  pendingIce = []
  pendingOffer = null
  restarted = false
  stopStream(was.localStream)
  releaseAudio()
  screenTrack?.stop()
  screenTrack = null
  set({
    phase: "ended",
    reason,
    error,
    localStream: null,
    remoteStream: null,
    quality: null,
    reconnecting: false,
    audioBlocked: false,
    notice: null,
    duration: was.startedAt ? Date.now() - was.startedAt : 0,
    camera: false,
    screen: false,
  })
  link?.notify("ended", { ...state, was })
}

export const dismiss = () => {
  if (state.phase === "ended") set(IDLE)
}

// ---- in-call controls ----

export const toggleMute = () => {
  const muted = !state.muted
  state.localStream?.getAudioTracks().forEach((t) => (t.enabled = !muted))
  set({ muted })
  sendMedia()
}

const replaceVideo = async (track) => {
  const sender = videoSender()
  if (sender) await sender.replaceTrack(track).catch(() => {})
}

export const setCamera = async (on) => {
  if (!state.localStream || !inCall()) return
  const stream = state.localStream
  const current = localVideoTrack()
  if (!on) {
    if (current) {
      current.stop()
      stream.removeTrack(current)
    }
    if (!state.screen) await replaceVideo(null)
    set({ camera: false, localStream: stream })
    return sendMedia()
  }
  if (current) return
  try {
    const got = await navigator.mediaDevices.getUserMedia({ video: { ...VIDEO, facingMode: state.facing } })
    const track = got.getVideoTracks()[0]
    stream.addTrack(track)
    watchVideo(track)
    if (!state.screen) await replaceVideo(track)
    set({ camera: true, cameraLost: false, notice: null, localStream: stream, video: true, error: null })
  } catch (error) {
    set({ notice: mediaError(error, true) })
  }
  sendMedia()
}

// phones: front <-> back camera. iPhones can't open two cameras at once, so the old one
// stops first.
export const switchCamera = async () => {
  const stream = state.localStream
  const current = localVideoTrack()
  if (!stream || !current) return
  const facing = state.facing === "user" ? "environment" : "user"
  current.stop()
  stream.removeTrack(current)
  let track = null
  for (const facingMode of [{ exact: facing }, facing]) {
    try {
      track = (await navigator.mediaDevices.getUserMedia({ video: { ...VIDEO, facingMode } })).getVideoTracks()[0]
      break
    } catch {
      // try the looser constraint
    }
  }
  if (!track) {
    // back to the camera we had
    try {
      track = (await navigator.mediaDevices.getUserMedia({ video: { ...VIDEO, facingMode: state.facing } })).getVideoTracks()[0]
    } catch {
      set({ camera: false, localStream: stream })
      await replaceVideo(null)
      return sendMedia()
    }
    stream.addTrack(track)
    watchVideo(track)
    await replaceVideo(track)
    return set({ localStream: stream })
  }
  stream.addTrack(track)
  watchVideo(track)
  if (!state.screen) await replaceVideo(track)
  set({ facing, localStream: stream })
}

let screenTrack = null
export const toggleScreen = async () => {
  if (!inCall() || !pc) return
  if (screenTrack) {
    screenTrack.stop()
    screenTrack = null
    await replaceVideo(localVideoTrack())
    set({ screen: false })
    return sendMedia()
  }
  try {
    const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
    screenTrack = display.getVideoTracks()[0]
    screenTrack.onended = () => {
      if (screenTrack) toggleScreen()
    }
    await replaceVideo(screenTrack)
    set({ screen: true })
    sendMedia()
  } catch {
    // cancelled the picker
  }
}

export const getScreenTrack = () => screenTrack

// iPhone stops the camera (and sometimes the mic) while Safari is in the background:
// bring them back when 98ish is visible again
export const recoverTracks = async () => {
  if (!inCall() || !state.localStream) return
  const stream = state.localStream
  const audio = stream.getAudioTracks()[0]
  if (audio && audio.readyState === "ended") {
    try {
      const fresh = (await navigator.mediaDevices.getUserMedia({ audio: AUDIO })).getAudioTracks()[0]
      fresh.enabled = !state.muted
      stream.removeTrack(audio)
      stream.addTrack(fresh)
      await audioSender()?.replaceTrack(fresh)
    } catch {
      // the mic stays off; the other side hears nothing until they call back
    }
  }
  const video = localVideoTrack()
  if (video && video.readyState === "ended") {
    stream.removeTrack(video)
    set({ camera: false })
    await setCamera(true)
  } else if (!video && state.cameraLost) await setCamera(true)
  set({ localStream: stream })
}

export const clearNotice = () => set({ notice: null })
export const setNotice = (notice) => set({ notice })

// ---- wiring ----

const HANDLERS = {
  "aim:callRing": onRing,
  "aim:callAnswered": onAnswered,
  "aim:callSignal": onSignal,
  "aim:callMedia": onMedia,
  "aim:callEnd": onEnd,
}

// CallManager: connect(link) while signed on; returns the disconnect
export const connect = (next) => {
  link = next
  iceConfig = null
  return () => {
    if (link !== next) return
    if (inCall()) {
      if (state.id) next.request("aim:callHangUp", { id: state.id, reason: "hungup" })
      cleanup({ reason: "signedoff" })
    }
    link = null
    iceConfig = null
    set(IDLE)
  }
}

// a call event from the socket (CallManager forwards them)
export const handle = (event, payload) => HANDLERS[event]?.(payload || {})

// leaving the page: tell the other side right away (no waiting for an ack)
export const hangUpOnUnload = () => {
  if (!inCall() || !state.id || !link) return
  if (state.phase === "incoming") link.emit("aim:callDecline", { id: state.id })
  else link.emit("aim:callHangUp", { id: state.id, reason: "unload" })
}

// for tests
if (typeof window !== "undefined") window.__call = { get: getCall, peer: () => pc, start: startCall, answer, hangUp }
