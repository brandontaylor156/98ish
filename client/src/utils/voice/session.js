import { createBus, claimCallSession, getAudioContext, unlockAudio } from "../audio.js"
import { createMesh } from "./mesh.js"
import { distanceGain, listenerRelative, pickPeers, courtGain, cursorPan, talking as isTalking } from "./spatial.js"

// Spatial voice: one voice session for a space (a My Park park, a Come Over hangout, a Watch
// Together session). It owns your microphone, the connections (mesh.js) and where each
// friend's voice sits (spatial.js), and keeps a small store the UI reads.
//
//   const v = createVoiceSession({ space })
//   await v.start()   (from a tap: the mic prompt and iOS audio need one)
//   v.stop(); v.setMuted(b); v.setPushToTalk(b); v.press(down); v.muteFriend(id, b)
//   v.subscribe(fn) / v.state
// `space` is the glue for one feature:
//   me                          your id in that space
//   mode                        "world" (3D, My Park) | "pan" (left/right, Come Over) | "flat"
//   join(on) -> Promise<{ ok, on: [id], ice: { iceServers } }>   voice on/off on the server
//   send(to, kind, data) -> Promise<{ ok }>                       a connection message
//   listen(onList, onSignal) -> unsubscribe                        the server's vc / sig events
//   place() -> { listener: { x, z, yaw }, people: { id: { x, z } }, court: [id] | null }   (world)
//            | { mine: { x, y }, people: { id: { x, y } } }                                 (pan)
// Voice is never recorded or kept: audio goes straight from the mic into the connections and
// from the connections to the speakers.

const MIC = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }
const TICK_MS = 100

const voiceBus = createBus({ gain: 1 })

const rms = (analyser, buf) => {
  analyser.getFloatTimeDomainData(buf)
  let sum = 0
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
  return Math.sqrt(sum / buf.length)
}

export const voiceSupported = () => typeof window !== "undefined" && !!window.RTCPeerConnection && !!navigator.mediaDevices?.getUserMedia

export const createVoiceSession = ({ space }) => {
  let state = { status: "off", error: null, muted: false, ptt: false, pressed: false, talking: false, on: [], peers: {} }
  const subs = new Set()
  const set = (patch) => {
    state = { ...state, ...patch }
    for (const fn of subs) fn(state)
  }

  let mesh = null
  let stream = null
  let releaseSession = null
  let unlisten = null
  let timer = null
  let micNode = null
  const graphs = new Map() // id -> { el, source, analyser, gain, panner, buf, level, talking, muted }
  const muted = new Set()
  let on = new Set()

  const applyMicEnabled = () => {
    const live = !state.muted && (!state.ptt || state.pressed)
    for (const t of stream?.getAudioTracks() || []) t.enabled = live
  }

  const graphFor = (id, remote) => {
    const ctx = getAudioContext()
    if (!ctx) return null
    // Chrome only feeds a remote WebRTC stream into Web Audio while a media element plays it
    // too (silenced: the sound comes out through the graph below)
    const el = new Audio()
    el.muted = true
    el.srcObject = remote
    el.play().catch(() => {})
    const source = ctx.createMediaStreamSource(remote)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    const gain = ctx.createGain()
    gain.gain.value = 0
    let panner = null
    if (space.mode === "world") {
      panner = ctx.createPanner()
      panner.panningModel = "HRTF"
      // distance is our own gain (distanceGain); the panner only places the direction
      panner.distanceModel = "linear"
      panner.refDistance = 1
      panner.maxDistance = 10000
      panner.rolloffFactor = 0
    } else if (space.mode === "pan" && ctx.createStereoPanner) {
      panner = ctx.createStereoPanner()
    }
    source.connect(analyser)
    analyser.connect(gain)
    const bus = voiceBus()
    if (panner) {
      gain.connect(panner)
      panner.connect(bus.out)
    } else gain.connect(bus.out)
    return { el, source, analyser, gain, panner, buf: new Float32Array(analyser.fftSize), level: 0, talking: false }
  }
  const dropGraph = (id) => {
    const g = graphs.get(id)
    if (!g) return
    graphs.delete(id)
    try {
      g.source.disconnect()
      g.gain.disconnect()
      g.panner?.disconnect()
    } catch {
      // already gone
    }
    g.el.srcObject = null
  }

  const place = (ctx, g, id, where) => {
    const t = ctx.currentTime
    let level = muted.has(id) ? 0 : 1
    if (space.mode === "world" && where) {
      const p = where.people?.[id]
      if (p && where.listener) {
        const rel = listenerRelative(where.listener, p)
        const d = Math.hypot(rel.x, rel.z)
        // (inside a court game, positions stand still: court-mates come through, others ducked)
        level *= where.court ? courtGain(id, where.court) : distanceGain(d)
        const n = d > 0.01 ? 1 / d : 0
        const px = rel.x * n
        const pz = d > 0.01 ? rel.z * n : -1
        if (g.panner.positionX) {
          g.panner.positionX.setTargetAtTime(where.court ? 0 : px, t, 0.08)
          g.panner.positionY.setTargetAtTime(0, t, 0.08)
          g.panner.positionZ.setTargetAtTime(where.court ? -1 : pz, t, 0.08)
        } else g.panner.setPosition(where.court ? 0 : px, 0, where.court ? -1 : pz)
      } else level *= where.court ? courtGain(id, where.court) : 0
    } else if (space.mode === "pan" && where) {
      const { pan, gain } = cursorPan(where.mine, where.people?.[id])
      level *= gain
      if (g.panner?.pan) g.panner.pan.setTargetAtTime(pan, t, 0.08)
    }
    g.gain.gain.setTargetAtTime(level, t, 0.06)
  }

  const tick = () => {
    const ctx = getAudioContext()
    if (!ctx || !mesh) return
    let where = null
    try {
      where = space.place ? space.place() : null
    } catch {
      where = null
    }
    // whom to connect to
    const others = [...on].filter((id) => id !== space.me)
    if (space.mode === "world" && where?.listener) {
      const cand = others.map((id) => ({ id, ...(where.people?.[id] || {}) }))
      const current = new Set(mesh.peers.map((p) => p.id))
      const court = where.court || []
      const chosen = pickPeers(where.listener, cand, current)
      for (const id of court) if (id !== space.me && on.has(id)) chosen.add(id)
      mesh.want([...chosen].sort((a, b) => String(a).localeCompare(String(b))))
    } else mesh.want(others)
    // levels and placement
    const peers = {}
    for (const [id, g] of graphs) {
      place(ctx, g, id, where)
      g.level = rms(g.analyser, g.buf)
      g.talking = isTalking(g.level, g.talking)
      peers[id] = { level: g.level, talking: g.talking, state: state.peers[id]?.state || "connected", muted: muted.has(id) }
    }
    for (const p of mesh.peers) if (!peers[p.id]) peers[p.id] = { level: 0, talking: false, state: p.state, muted: muted.has(p.id) }
    let me = false
    if (micNode) {
      micNode.level = rms(micNode.analyser, micNode.buf)
      me = isTalking(micNode.level, state.talking) && !state.muted && (!state.ptt || state.pressed)
    }
    set({ peers, talking: me })
  }

  const getMic = async () => {
    const s = await navigator.mediaDevices.getUserMedia({ audio: MIC, video: false })
    const ctx = getAudioContext()
    if (ctx) {
      micNode?.source.disconnect()
      const source = ctx.createMediaStreamSource(s)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      source.connect(analyser) // (not to the speakers: you don't hear yourself)
      micNode = { source, analyser, buf: new Float32Array(analyser.fftSize), level: 0 }
    }
    return s
  }

  // iOS stops the mic when 98ish goes to the background; when it's back, get it again
  const onVisible = async () => {
    if (state.status === "off" || state.status === "error") return
    if (document.visibilityState === "hidden") return set({ status: "paused" })
    const ended = !stream || stream.getAudioTracks().every((t) => t.readyState === "ended")
    if (ended) {
      try {
        stream = await getMic()
        applyMicEnabled()
        mesh?.setMic(stream.getAudioTracks()[0])
      } catch {
        return set({ status: "paused", error: "Tap Voice to turn your microphone back on." })
      }
    }
    set({ status: "on", error: null })
  }

  const start = async () => {
    if (state.status === "on" || state.status === "starting") return
    if (!voiceSupported()) return set({ status: "error", error: "This browser can't do voice. Try Safari or Chrome." })
    set({ status: "starting", error: null })
    unlockAudio()
    try {
      stream = await getMic()
    } catch (error) {
      const denied = error?.name === "NotAllowedError" || error?.name === "SecurityError"
      return set({ status: "error", error: denied ? "Microphone blocked. Allow it in your browser's settings, then tap Voice again." : "No microphone was found." })
    }
    releaseSession = claimCallSession()
    applyMicEnabled()
    const r = await space.join(true).catch(() => null)
    if (!r?.ok) {
      stopLocal()
      return set({ status: "error", error: r?.error || "Voice isn't available right now." })
    }
    on = new Set(r.on || [])
    mesh = createMesh({
      me: space.me,
      transport: { send: space.send },
      iceServers: r.ice?.iceServers || [],
      onRemote: (id, remote) => {
        dropGraph(id)
        const g = graphFor(id, remote)
        if (g) graphs.set(id, g)
      },
      onState: (id, s) => {
        if (s === "closed") {
          dropGraph(id)
          const { [id]: _, ...rest } = state.peers
          set({ peers: rest })
        } else set({ peers: { ...state.peers, [id]: { ...(state.peers[id] || { level: 0, talking: false }), state: s } } })
      },
    })
    mesh.setMic(stream.getAudioTracks()[0])
    unlisten = space.listen(
      (list) => {
        on = new Set(list || [])
        set({ on: [...on] })
        for (const p of mesh?.peers || []) if (!on.has(p.id)) mesh.drop(p.id, false)
      },
      (from, kind, data) => mesh?.signal(from, kind, data)
    )
    document.addEventListener("visibilitychange", onVisible)
    timer = setInterval(tick, TICK_MS)
    set({ status: "on", on: [...on] })
  }

  const stopLocal = () => {
    clearInterval(timer)
    timer = null
    document.removeEventListener("visibilitychange", onVisible)
    unlisten?.()
    unlisten = null
    mesh?.close()
    mesh = null
    for (const id of [...graphs.keys()]) dropGraph(id)
    for (const t of stream?.getTracks() || []) t.stop()
    stream = null
    micNode?.source.disconnect()
    micNode = null
    releaseSession?.()
    releaseSession = null
  }

  const stop = async () => {
    if (state.status === "off") return
    const was = state.status
    stopLocal()
    set({ status: "off", error: null, talking: false, peers: {}, on: [] })
    if (was !== "error") await space.join(false).catch(() => null)
  }

  return {
    start,
    stop,
    setMuted: (b) => (set({ muted: !!b }), applyMicEnabled()),
    setPushToTalk: (b) => (set({ ptt: !!b, pressed: false }), applyMicEnabled()),
    press: (down) => (set({ pressed: !!down }), applyMicEnabled()),
    muteFriend: (id, b) => {
      if (b) muted.add(id)
      else muted.delete(id)
      tick()
    },
    subscribe: (fn) => (subs.add(fn), () => subs.delete(fn)),
    get state() {
      return state
    },
    // (tests) the live graph: per-friend analysers and panner positions
    get debug() {
      return { graphs, mesh, stream }
    },
  }
}
