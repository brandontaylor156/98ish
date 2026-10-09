// Spatial voice: the connections. One RTCPeerConnection per friend you can hear, audio only,
// browser to browser; the server only carries the connection messages (server/voice/relay.js).
//
//   const mesh = createMesh({ me, transport, iceServers, onRemote, onState })
//   mesh.setMic(track)            your microphone track (null = nothing sent)
//   mesh.want(ids)                the people you want to hear right now (session.js picks them)
//   mesh.signal(from, kind, data) a message from the relay
//   mesh.close()
// transport.send(to, kind, data) -> Promise<{ ok }>. Glare (both sides calling at once) is
// settled the "perfect negotiation" way: the side with the larger id is polite and gives way.
// A connection you didn't start stays until the other side says bye; one you started closes a
// few seconds after you stop wanting it (so walking along the edge doesn't flap).
// A connection that can't get through (no route between the two networks: cellular, strict
// NATs, no TURN relay) gets one ICE restart, then is given up: onFail(id) tells the session
// (which says so on screen), both sides are told (bye) and that friend isn't tried again for
// RETRY_MS. A connection that never even starts checking (no candidates at all) counts too.

const BITRATE = 32000
const DROP_AFTER_MS = 4000
export const RESTART_AFTER_MS = 12000 // not connected yet: one ICE restart
export const FAIL_AFTER_MS = 25000 // still not: give up for now
export const RETRY_MS = 30000

// ask for mono Opus at ~32 kbps with forward error correction (good speech on bad cellular)
export const tuneOpus = (sdp, bitrate = BITRATE) => {
  const m = /a=rtpmap:(\d+) opus\/48000/i.exec(sdp)
  if (!m) return sdp
  const pt = m[1]
  const fmtp = new RegExp(`a=fmtp:${pt} ([^\\r\\n]*)`)
  const extra = { maxaveragebitrate: String(bitrate), stereo: "0", useinbandfec: "1", usedtx: "1" }
  if (fmtp.test(sdp)) {
    return sdp.replace(fmtp, (line, params) => {
      const kv = new Map(params.split(";").filter(Boolean).map((p) => p.split("=")))
      for (const [k, v] of Object.entries(extra)) kv.set(k, v)
      return `a=fmtp:${pt} ${[...kv].map(([k, v]) => `${k}=${v}`).join(";")}`
    })
  }
  return sdp.replace(m[0], `${m[0]}\r\na=fmtp:${pt} ${Object.entries(extra).map(([k, v]) => `${k}=${v}`).join(";")}`)
}

export const createMesh = ({ me, transport, iceServers = [], onRemote = () => {}, onState = () => {}, onFail = () => {}, Peer = globalThis.RTCPeerConnection, timers = globalThis, now = () => Date.now() } = {}) => {
  const peers = new Map() // id -> { pc, mine, polite, making, ignore, dropTimer, restarted, watch }
  const blocked = new Map() // id -> time it may be tried again (it failed)
  let wanted = new Set()
  let mic = null
  let closed = false

  const politeWith = (id) => String(me) > String(id)
  const send = (id, kind, data) => Promise.resolve(transport.send(id, kind, data)).catch(() => null)

  const describe = async (p, id) => {
    const desc = p.pc.localDescription
    if (desc) await send(id, desc.type, { type: desc.type, sdp: desc.sdp })
  }

  const capBitrate = (sender) => {
    try {
      const params = sender.getParameters()
      if (!params.encodings?.length) return
      params.encodings[0].maxBitrate = BITRATE
      sender.setParameters(params).catch(() => {})
    } catch {
      // older Safari: the SDP hint (tuneOpus) is enough
    }
  }
  // your mic on the connection's one audio channel (made by your offer or by theirs)
  const attachMic = (p) => {
    const tr = p.pc.getTransceivers().find((t) => t.receiver.track?.kind === "audio")
    if (tr) {
      tr.sender.replaceTrack(mic).catch(() => {})
      if (mic && (tr.direction === "recvonly" || tr.direction === "inactive")) tr.direction = "sendrecv"
      if (mic) capBitrate(tr.sender)
    } else if (mic) {
      capBitrate(p.pc.addTrack(mic, new MediaStream([mic])))
    }
  }

  const restart = (p) => {
    if (p.restarted) return false
    p.restarted = true
    try {
      p.pc.restartIce()
      return true
    } catch {
      return false // not supported
    }
  }
  const fail = (id) => {
    const p = peers.get(id)
    if (!p) return
    blocked.set(id, now() + RETRY_MS)
    onFail(id, { turn: iceServers.some((s) => [].concat(s.urls).some((u) => /^turns?:/.test(String(u)))) })
    drop(id, true)
  }

  const create = (id, mine) => {
    const pc = new Peer({ iceServers, bundlePolicy: "max-bundle" })
    const p = { pc, mine, polite: politeWith(id), making: false, ignore: false, dropTimer: null, restarted: false, watch: null, born: now(), connected: false }
    peers.set(id, p)
    // the connection has this long to get through (one restart on the way)
    const watch = (ms, then) => {
      timers.clearTimeout(p.watch)
      p.watch = timers.setTimeout(() => {
        if (peers.get(id) !== p || pc.connectionState === "connected") return
        then()
      }, ms)
    }
    watch(RESTART_AFTER_MS, () => (restart(p), watch(FAIL_AFTER_MS - RESTART_AFTER_MS, () => fail(id))))
    // a call you start carries your mic (or asks to listen); one they start gets its audio
    // channel from their offer (signal())
    if (mine) {
      if (mic) attachMic(p)
      else pc.addTransceiver("audio", { direction: "recvonly" })
    }
    pc.onicecandidate = (e) => send(id, "ice", e.candidate ? e.candidate.toJSON() : { candidate: "" })
    pc.ontrack = (e) => onRemote(id, e.streams[0] || new MediaStream([e.track]))
    pc.onnegotiationneeded = async () => {
      try {
        p.making = true
        const offer = await pc.createOffer()
        if (pc.signalingState !== "stable") return
        await pc.setLocalDescription({ type: "offer", sdp: tuneOpus(offer.sdp) })
        await describe(p, id)
      } catch (error) {
        console.warn("[voice] offer failed", error?.name || error)
      } finally {
        p.making = false
      }
    }
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState
      if (peers.get(id) !== p) return
      onState(id, state)
      if (state === "connected") {
        p.connected = true
        timers.clearTimeout(p.watch)
        p.watch = null
        p.restarted = false
        blocked.delete(id)
      } else if (state === "failed") {
        // one ICE restart (a network change, a TURN relay that came up late), then give up
        if (restart(p)) watch(FAIL_AFTER_MS - RESTART_AFTER_MS, () => fail(id))
        else fail(id)
      } else if (state === "closed") {
        drop(id, false)
      }
    }
    onState(id, "new")
    return p
  }

  const drop = (id, sayBye = true) => {
    const p = peers.get(id)
    if (!p) return
    timers.clearTimeout(p.dropTimer)
    timers.clearTimeout(p.watch)
    peers.delete(id)
    try {
      p.pc.close()
    } catch {
      // already closed
    }
    if (sayBye) send(id, "bye", null)
    onState(id, "closed")
  }

  const want = (ids) => {
    if (closed) return
    wanted = new Set(ids)
    for (const id of wanted) {
      const p = peers.get(id)
      if (p) {
        timers.clearTimeout(p.dropTimer)
        p.dropTimer = null
      } else if (!(blocked.get(id) > now())) create(id, true)
    }
    for (const [id, p] of peers) {
      if (wanted.has(id) || !p.mine || p.dropTimer) continue
      p.dropTimer = timers.setTimeout(() => !wanted.has(id) && drop(id), DROP_AFTER_MS)
    }
  }

  const signal = async (from, kind, data) => {
    if (closed) return
    if (kind === "bye") {
      // they gave up on a connection that never got through: so do we (and say so)
      const p = peers.get(from)
      if (p && !p.connected && now() - p.born >= RESTART_AFTER_MS) {
        blocked.set(from, now() + RETRY_MS)
        onFail(from, { turn: iceServers.some((s) => [].concat(s.urls).some((u) => /^turns?:/.test(String(u)))) })
      }
      return drop(from, false)
    }
    let p = peers.get(from)
    if (!p) {
      if (kind !== "offer") return // a candidate for a connection that's gone
      blocked.delete(from) // they're trying again: so do we
      p = create(from, false)
    }
    const pc = p.pc
    try {
      if (kind === "offer" || kind === "answer") {
        const collision = kind === "offer" && (p.making || pc.signalingState !== "stable")
        p.ignore = !p.polite && collision
        if (p.ignore) return
        await pc.setRemoteDescription({ type: kind, sdp: data.sdp })
        if (kind === "offer") {
          attachMic(p)
          const answer = await pc.createAnswer()
          await pc.setLocalDescription({ type: "answer", sdp: tuneOpus(answer.sdp) })
          await describe(p, from)
        }
      } else if (kind === "ice") {
        try {
          await pc.addIceCandidate(data && data.candidate ? data : null)
        } catch (error) {
          if (!p.ignore) throw error
        }
      }
    } catch (error) {
      console.warn("[voice] signal failed", kind, error?.name || error)
    }
  }

  const setMic = (track) => {
    mic = track || null
    for (const p of peers.values()) attachMic(p)
  }

  const close = () => {
    closed = true
    for (const id of [...peers.keys()]) drop(id)
  }

  return {
    want,
    signal,
    setMic,
    close,
    drop,
    // ids given up on for now -> when they may be tried again
    get blocked() {
      return new Map(blocked)
    },
    get peers() {
      return [...peers.entries()].map(([id, p]) => ({ id, state: p.pc.connectionState, mine: p.mine }))
    },
  }
}
