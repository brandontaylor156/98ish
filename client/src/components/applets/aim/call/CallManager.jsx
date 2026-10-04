import React, { useEffect, useRef, useState } from "react"
import { BUDDY_LIST, keyOf, useAim } from "../AimContext"
import { playSound } from "../sounds"
import { claimCallSession } from "../../../../utils/audio"
import * as engine from "./engine"
import { playConnected, playHangUp, playModem, startRingback, startRingtone, stopVibrate, vibrateRing } from "./callSounds"
import { PhoneIcon, VideoIcon } from "./CallIcons"
import { notify as notifyCenter } from "../../../../utils/notifications"
import "./call.css"

// Mounted while you're signed on to 98 Messenger: connects the call engine to the
// Messenger socket, rings, opens the call windows, and shows call toasts (an incoming call
// while the Buddy List is minimized, missed calls).

export const CALL_WINDOW = "call"
const ENDED_CLOSE_MS = 2500

const clock = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const pad = (n) => String(n).padStart(2, "0")
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`
}
export const callClock = clock
const time = (t = Date.now()) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })

export const callTitle = (call) => `${call.video ? "Video Call" : "Call"} - ${call.peer}`

// what the IM conversation says about a call that just ended
const endLine = (info) => {
  const was = info.was || {}
  const peer = was.peer || info.peer
  const kind = was.video ? "Video call" : "Call"
  if (was.startedAt) return `${kind} with ${peer} ended (${clock(info.duration || 0)}).`
  if (was.direction === "out") {
    if (info.reason === "declined") return `${peer} declined your ${kind.toLowerCase()}.`
    if (info.reason === "timeout") return `${peer} didn't answer your ${kind.toLowerCase()}.`
    if (info.reason === "busy") return `${peer} was on another call.`
    if (info.reason === "failed") return `${kind} with ${peer} couldn't connect.`
  }
  if (was.direction === "in" && info.reason === "failed") return `${kind} with ${peer} couldn't connect.`
  return null
}

const Toast = ({ toast, onClose, children }) => (
  <div className={`window callToast${toast.ringing ? " is-ringing" : ""}`} role={toast.ringing ? "alertdialog" : "status"} aria-label={toast.title}>
    <div className="title-bar">
      <div className="title-bar-text">{toast.title}</div>
      <div className="title-bar-controls">
        <button type="button" aria-label="Close" onClick={onClose} />
      </div>
    </div>
    <div className="window-body callToastBody">{children}</div>
  </div>
)

const CallManager = () => {
  const aim = useAim()
  const aimRef = useRef(aim)
  aimRef.current = aim
  const call = engine.useCall()
  const [missed, setMissed] = useState([]) // [{ id, from, video, time, busy }]
  const [ringToast, setRingToast] = useState(false)
  const shown = useRef({ call: false, ring: false })

  // ---- connect the engine to the socket ----
  useEffect(() => {
    const a = () => aimRef.current
    const notify = (kind, info) => {
      if (kind === "ended") {
        const line = endLine(info || {})
        const peer = info?.was?.peer || info?.peer
        if (line && peer) a().addNotice(peer, line)
      }
    }
    const disconnect = engine.connect({
      request: (event, payload) => a().request(event, payload),
      emit: (event, payload) => a().emit(event, payload),
      notify,
    })
    const off = a().onCall((event, payload) => {
      if (event !== "aim:callMissed") return engine.handle(event, payload)
      const from = String(payload?.from || "")
      if (!from) return
      const text = payload.busy
        ? `${from} tried to ${payload.video ? "video " : ""}call you at ${time(payload.time)} while you were on another call.`
        : `Missed ${payload.video ? "video " : ""}call from ${from} at ${time(payload.time)}.`
      a().addNotice(from, text)
      notifyCenter({ app: "calls", key: `missed:${keyOf(from)}:${payload.time}`, title: payload.busy ? `${from} tried to call` : `Missed ${payload.video ? "video " : ""}call`, text, time: payload.time || Date.now(), target: { kind: "im", with: from } })
      if (a().prefs.sound) playSound("imReceive")
      setMissed((list) => [...list.filter((m) => keyOf(m.from) !== keyOf(from)), { id: `${from}:${payload.time}`, from, video: !!payload.video, time: payload.time, text }].slice(-3))
    })
    return () => {
      off()
      disconnect()
    }
  }, [])

  // ---- sounds follow the phase ----
  const phase = call.phase
  const ringingOut = phase === "outgoing" && !!call.id
  useEffect(() => {
    if (phase !== "incoming") return
    const stop = startRingtone()
    vibrateRing()
    const buzz = setInterval(vibrateRing, 3000)
    return () => {
      stop()
      clearInterval(buzz)
      stopVibrate()
    }
  }, [phase])
  useEffect(() => {
    if (!ringingOut) return
    return startRingback()
  }, [ringingOut])
  useEffect(() => {
    if (phase !== "connecting") return
    // the modem flourish is part of Messenger's sounds (My AIM > Sounds)
    const stop = aimRef.current.prefs.sound ? playModem() : () => {}
    return stop
  }, [phase])
  const prevPhase = useRef(phase)
  useEffect(() => {
    const before = prevPhase.current
    prevPhase.current = phase
    if (phase === "active" && before !== "active") playConnected()
    if (phase === "ended" && ["outgoing", "connecting", "active"].includes(before)) playHangUp()
  }, [phase])

  // iPhone: the call holds the microphone audio session ("play-and-record")
  const live = ["outgoing", "connecting", "active"].includes(phase)
  useEffect(() => {
    if (!live) return
    return claimCallSession()
  }, [live])

  // ---- windows ----
  const windows = aim.getWindows()
  const callOpen = windows.some((w) => !w.closed && w.aimId === CALL_WINDOW)
  const ringOpen = windows.some((w) => !w.closed && w.app === "aim-ring")

  // the call window opens for calls you place or answer
  useEffect(() => {
    if (!live) return
    aimRef.current.openWindow(CALL_WINDOW, {
      name: callTitle(call),
      app: "aim-call",
      width: call.video ? 520 : 360,
      height: call.video ? 520 : 400,
      initialX: 260,
      positionY: 30,
    })
  }, [live])

  // incoming: a ringing window when the Buddy List is up, otherwise a toast
  useEffect(() => {
    if (phase !== "incoming") {
      setRingToast(false)
      shown.current.ring = false
      aimRef.current.closeWindows((w) => w.app === "aim-ring")
      return
    }
    const visible = aimRef.current.getWindows().some((w) => !w.closed && !w.minimized && w.name === BUDDY_LIST)
    if (visible) {
      aimRef.current.openWindow(`ring:${call.id}`, {
        name: `Incoming ${call.video ? "Video Call" : "Call"}`,
        app: "aim-ring",
        width: 320,
        height: 210,
        initialX: 300,
        positionY: 80,
      })
    } else setRingToast(true)
  }, [phase, call.id])

  // closing a call window hangs up; closing the ringing window declines
  useEffect(() => {
    if (callOpen) shown.current.call = true
    else if (shown.current.call) {
      shown.current.call = false
      if (engine.inCall() && engine.getCall().phase !== "incoming") engine.hangUp("closed")
      else engine.dismiss()
    }
  }, [callOpen])
  useEffect(() => {
    if (ringOpen) shown.current.ring = true
    else if (shown.current.ring) {
      shown.current.ring = false
      if (engine.getCall().phase === "incoming") engine.decline()
    }
  }, [ringOpen])

  // ended: the call window says why for a moment, then closes (errors stay to be read)
  useEffect(() => {
    // (the live state: closing the window may have just dismissed it in this same commit)
    if (phase !== "ended" || engine.getCall().phase !== "ended") return
    if (!callOpen) {
      if (!call.error) engine.dismiss()
      else if (!ringOpen) {
        // e.g. the camera was blocked while answering from a toast: show it in a window
        aimRef.current.openWindow(CALL_WINDOW, { name: callTitle(call), app: "aim-call", width: 360, height: 400, initialX: 260, positionY: 30 })
      }
      return
    }
    if (call.error) return
    const timer = setTimeout(() => {
      aimRef.current.closeWindows((w) => w.aimId === CALL_WINDOW)
      engine.dismiss()
    }, ENDED_CLOSE_MS)
    return () => clearTimeout(timer)
  }, [phase, callOpen, !!call.error])

  // ---- leaving the page hangs up (and asks first) ----
  useEffect(() => {
    if (!engine.inCall(call)) return
    const warn = (e) => {
      if (!engine.inCall()) return
      e.preventDefault()
      e.returnValue = "Leaving 98ish will hang up your call."
      return e.returnValue
    }
    const leave = () => engine.hangUpOnUnload()
    window.addEventListener("beforeunload", warn)
    window.addEventListener("pagehide", leave)
    return () => {
      window.removeEventListener("beforeunload", warn)
      window.removeEventListener("pagehide", leave)
    }
  }, [engine.inCall(call)])

  // iPhone: Safari pauses the camera (and may drop the call) in the background
  useEffect(() => {
    if (phase !== "active") return
    let hiddenAt = null
    const onVisibility = () => {
      if (document.visibilityState === "hidden") hiddenAt = Date.now()
      else if (hiddenAt) {
        hiddenAt = null
        engine.recoverTracks()
        if (engine.isIOS()) engine.setNotice("Welcome back! iPhone pauses your camera while 98ish is in the background, and may drop the call if the screen locks.")
      }
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => document.removeEventListener("visibilitychange", onVisibility)
  }, [phase])

  const answerFromToast = (video) => {
    setRingToast(false)
    engine.answer(video)
  }

  if (!(ringToast && phase === "incoming") && !missed.length) return null
  return (
    <div className="callToasts">
      {ringToast && phase === "incoming" && (
        <Toast toast={{ title: `Incoming ${call.video ? "Video Call" : "Call"}`, ringing: true }} onClose={() => engine.decline()}>
          <div className="callToastRow">
            <span className="callToastIcon">{call.video ? <VideoIcon size={28} /> : <PhoneIcon size={28} />}</span>
            <div className="callToastText">
              <b>{call.peer}</b> is calling you{call.video ? " (video)" : ""}...
            </div>
          </div>
          <div className="callToastButtons">
            <button type="button" className="callAnswer" onClick={() => answerFromToast(call.video)}>
              {call.video ? "Answer Video" : "Answer"}
            </button>
            {call.video && (
              <button type="button" onClick={() => answerFromToast(false)}>
                Voice Only
              </button>
            )}
            <button type="button" className="callDecline" onClick={() => engine.decline()}>
              Decline
            </button>
          </div>
        </Toast>
      )}
      {!ringToast &&
        missed.map((m) => (
          <Toast key={m.id} toast={{ title: "Missed Call" }} onClose={() => setMissed((list) => list.filter((x) => x.id !== m.id))}>
            <div className="callToastRow">
              <span className="callToastIcon">{m.video ? <VideoIcon size={28} missed /> : <PhoneIcon size={28} missed />}</span>
              <div className="callToastText">{m.text}</div>
            </div>
            <div className="callToastButtons">
              <button
                type="button"
                className="callAnswer"
                disabled={engine.inCall(call)}
                onClick={() => {
                  setMissed((list) => list.filter((x) => x.id !== m.id))
                  engine.startCall(m.from, m.video)
                }}
              >
                Call Back
              </button>
              <button
                type="button"
                onClick={() => {
                  setMissed((list) => list.filter((x) => x.id !== m.id))
                  aim.openIm(m.from)
                }}
              >
                Send IM
              </button>
            </div>
          </Toast>
        ))}
    </div>
  )
}

export default CallManager
