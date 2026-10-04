// 98 Messenger voice and video calls: signaling only. The media goes browser to browser
// (WebRTC); this relays the invite, the answer, the SDP offer/answer and ICE candidates
// between the two signed-on people in a call, and nobody else.
//
// client -> server (all acked with { ok, ... })
//   aim:call { to, video }            ring a buddy -> { ok, id } or { ok: false, error, busy? }
//   aim:callAnswer { id, video }      the callee picks up
//   aim:callDecline { id }            the callee says no
//   aim:callHangUp { id, reason }     either side ends it (the caller, while ringing: cancel)
//   aim:callSignal { id, kind, data } kind: offer | answer | ice (only once answered)
//   aim:callMedia { id, muted, camera, screen }  what the other side should show
//   aim:callIce {}                    -> { ok, iceServers, turn }
// server -> client
//   aim:callRing { id, from, video }   aim:callAnswered { id, video }
//   aim:callSignal { id, kind, data }  aim:callMedia { id, muted, camera, screen }
//   aim:callEnd { id, reason }         aim:callMissed { from, video, time, busy? }

const crypto = require("crypto")
const { validate } = require("./screenNames")

const RING_MS = 45_000 // unanswered calls give up
const LOST_MS = 15_000 // a call survives a dropped socket this long (phones blip)
const CALLS_PER_MINUTE = 8
const SIGNALS_PER_MINUTE = 600 // ICE trickles a few dozen candidates per call
const MAX_SDP = 20_000
const MAX_CANDIDATE = 1024
const END_REASONS = ["hungup", "failed", "unload", "closed"]

const cleanSignal = (kind, data) => {
  if (!data || typeof data !== "object") return null
  if (kind === "offer" || kind === "answer") {
    if (data.type !== kind || typeof data.sdp !== "string" || !data.sdp || data.sdp.length > MAX_SDP) return null
    return { type: kind, sdp: data.sdp }
  }
  if (kind === "ice") {
    // null candidate = end of candidates
    if (data.candidate === null || data.candidate === "") return { candidate: null }
    if (typeof data.candidate !== "string" || data.candidate.length > MAX_CANDIDATE) return null
    const index = Number.isInteger(data.sdpMLineIndex) && data.sdpMLineIndex >= 0 && data.sdpMLineIndex < 16 ? data.sdpMLineIndex : null
    const mid = typeof data.sdpMid === "string" && data.sdpMid.length <= 32 ? data.sdpMid : null
    if (index === null && mid === null) return null
    return { candidate: data.candidate, sdpMid: mid, sdpMLineIndex: index }
  }
  return null
}

const createCalls = ({ sessions, hidden, emitTo, limiter, ice, botKey, ringMs = RING_MS, lostMs = LOST_MS }) => {
  const calls = new Map() // id -> { id, from, to, video, state: "ringing" | "active", timer }
  const inCall = new Map() // key -> call id
  const callLimited = limiter(CALLS_PER_MINUTE, 60_000)
  const signalLimited = limiter(SIGNALS_PER_MINUTE, 60_000)

  const nameOf = (key) => sessions.get(key)?.user.screenName || key
  const otherIn = (call, key) => (call.from === key ? call.to : call.from)

  // A missed call reaches the callee now, or when their connection comes back
  const missed = (call, extra = {}) => {
    const notice = { from: nameOf(call.from), video: call.video, time: Date.now(), ...extra }
    const callee = sessions.get(call.to)
    if (!callee) return
    if (callee.socket) callee.socket.emit("aim:callMissed", notice)
    else (callee.missedCalls ||= []).push(notice)
  }

  const finish = (call, reasons) => {
    if (calls.get(call.id) !== call) return
    clearTimeout(call.timer)
    clearTimeout(call.lostTimer)
    calls.delete(call.id)
    if (inCall.get(call.from) === call.id) inCall.delete(call.from)
    if (inCall.get(call.to) === call.id) inCall.delete(call.to)
    // reasons: { [key]: reason } for who should hear about it
    for (const [key, reason] of Object.entries(reasons)) if (reason) emitTo(key, "aim:callEnd", { id: call.id, reason })
  }

  const callFor = (session, id) => {
    const call = calls.get(String(id || ""))
    return call && (call.from === session.key || call.to === session.key) ? call : null
  }

  // a buddy signed off, blocked the other, or their connection never came back
  const endFor = (key, reason) => {
    const call = calls.get(inCall.get(key))
    if (!call) return
    if (call.state === "ringing" && call.from === key) missed(call)
    finish(call, { [otherIn(call, key)]: reason })
  }

  const endBetween = (a, b, reason) => {
    const call = calls.get(inCall.get(a))
    if (call && otherIn(call, a) === b) finish(call, { [a]: reason, [b]: reason })
  }

  // the socket dropped: a ringing call can't be answered (or is abandoned), an active one
  // gets a moment to come back
  const dropped = (key) => {
    const call = calls.get(inCall.get(key))
    if (!call) return
    if (call.state === "ringing") {
      if (call.from === key) missed(call)
      return finish(call, { [otherIn(call, key)]: call.from === key ? "cancelled" : "unavailable" })
    }
    clearTimeout(call.lostTimer)
    call.lostTimer = setTimeout(() => finish(call, { [otherIn(call, key)]: "lost" }), lostMs)
  }

  const resumed = (session) => {
    const call = calls.get(inCall.get(session.key))
    if (call) clearTimeout(call.lostTimer)
    const pending = session.missedCalls || []
    session.missedCalls = []
    for (const notice of pending) session.socket?.emit("aim:callMissed", notice)
  }

  const bind = (on) => {
    on("aim:call", (session, { to, video }, ack) => {
      const target = validate(to)
      if (target.error) return ack({ ok: false, error: "Invalid screen name." })
      if (target.key === botKey) return ack({ ok: false, error: "SmarterChild doesn't have a phone. Try sending an IM instead! :-)" })
      if (target.key === session.key) return ack({ ok: false, error: "You can't call yourself." })
      if (inCall.has(session.key)) return ack({ ok: false, error: "You're already on a call." })
      const callee = sessions.get(target.key)
      // (someone on a call whose connection blipped is still busy, not offline)
      if (!callee || hidden(session, callee) || (!callee.socket && !inCall.has(callee.key))) {
        return ack({ ok: false, error: `${target.screenName} is not currently signed on.` })
      }
      if (callLimited(session.key)) return ack({ ok: false, error: "You're calling too often. Wait a minute and try again." })
      const call = { id: crypto.randomBytes(12).toString("hex"), from: session.key, to: callee.key, video: !!video, state: "ringing" }
      if (inCall.has(callee.key)) {
        missed(call, { busy: true })
        return ack({ ok: false, busy: true, error: `${callee.user.screenName} is on another call. Try again later.` })
      }
      calls.set(call.id, call)
      inCall.set(call.from, call.id)
      inCall.set(call.to, call.id)
      call.timer = setTimeout(() => {
        missed(call)
        finish(call, { [call.from]: "timeout", [call.to]: "timeout" })
      }, ringMs)
      emitTo(callee.key, "aim:callRing", { id: call.id, from: session.user.screenName, video: call.video })
      ack({ ok: true, id: call.id, to: callee.user.screenName })
    })

    on("aim:callAnswer", (session, { id, video }, ack) => {
      const call = callFor(session, id)
      if (!call || call.to !== session.key || call.state !== "ringing") return ack({ ok: false, error: "That call has ended." })
      clearTimeout(call.timer)
      call.state = "active"
      emitTo(call.from, "aim:callAnswered", { id: call.id, video: !!video })
      ack({ ok: true })
    })

    on("aim:callDecline", (session, { id }, ack) => {
      const call = callFor(session, id)
      if (!call || call.to !== session.key || call.state !== "ringing") return ack({ ok: false })
      finish(call, { [call.from]: "declined" })
      ack({ ok: true })
    })

    on("aim:callHangUp", (session, { id, reason }, ack) => {
      const call = callFor(session, id)
      if (!call) return ack({ ok: false })
      if (call.state === "ringing" && call.from === session.key) {
        missed(call)
        finish(call, { [call.to]: "cancelled" })
      } else {
        const why = call.state === "ringing" ? "declined" : END_REASONS.includes(reason) ? reason : "hungup"
        finish(call, { [otherIn(call, session.key)]: why })
      }
      ack({ ok: true })
    })

    on("aim:callSignal", (session, { id, kind, data }, ack) => {
      const call = callFor(session, id)
      if (!call || call.state !== "active") return ack({ ok: false, error: "That call has ended." })
      if (signalLimited(session.key)) return ack({ ok: false, error: "Too many call messages." })
      // only the caller offers and only the callee answers; ICE goes both ways
      if ((kind === "offer" && call.from !== session.key) || (kind === "answer" && call.to !== session.key)) return ack({ ok: false })
      const clean = cleanSignal(kind, data)
      if (!clean) return ack({ ok: false, error: "Invalid call message." })
      emitTo(otherIn(call, session.key), "aim:callSignal", { id: call.id, kind, data: clean })
      ack({ ok: true })
    })

    on("aim:callMedia", (session, { id, muted, camera, screen }, ack) => {
      const call = callFor(session, id)
      if (!call) return ack({ ok: false })
      if (signalLimited(session.key)) return ack({ ok: false })
      emitTo(otherIn(call, session.key), "aim:callMedia", { id: call.id, muted: !!muted, camera: !!camera, screen: !!screen })
      ack({ ok: true })
    })

    on("aim:callIce", async (session, payload, ack) => {
      ack({ ok: true, ...(await ice.config()) })
    })
  }

  return { bind, endFor, endBetween, dropped, resumed, calls, inCall }
}

module.exports = { createCalls, cleanSignal, RING_MS }
