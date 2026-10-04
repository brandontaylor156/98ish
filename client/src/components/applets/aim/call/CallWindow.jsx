import React, { useEffect, useRef, useState } from "react"
import { useAim } from "../AimContext"
import * as engine from "./engine"
import { callClock } from "./CallManager"
import { FlipIcon, MicIcon, PhoneIcon, PipIcon, ScreenIcon, VideoIcon } from "./CallIcons"
import "./call.css"

// The call window: their video big in a little CRT, yours small (drag it anywhere), and
// the controls. It only shows the call; the call itself lives in engine.js, so minimizing
// or switching windows doesn't touch it. Closing the window hangs up (CallManager).

const IOS_NOTE_KEY = "98ish.call.iosNote"

const useNow = (on) => {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!on) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [on])
  return now
}

const endedText = (call) => {
  const p = call.peer
  return (
    {
      declined: `${p} declined the call.`,
      timeout: "No answer.",
      hungup: `${p} hung up.`,
      closed: `${p} hung up.`,
      cancelled: `${p} hung up.`,
      hungupByMe: "Call ended.",
      signedoff: `${p} signed off.`,
      blocked: "Call ended.",
      lost: `${p}'s connection was lost.`,
      unload: `${p} left 98ish.`,
      unavailable: `${p} is unavailable right now.`,
      gone: "That call has ended.",
    }[call.reason] || "Call ended."
  )
}


const CONNECT_STEPS = ["Connecting...", "Verifying screen name...", "Negotiating with peer...", "Opening the line..."]

// Fun 98 "Dial-Up Networking" status while the line comes up
const Connecting = ({ call }) => {
  const [step, setStep] = useState(0)
  useEffect(() => {
    setStep(0)
    const id = setInterval(() => setStep((s) => s + 1), 1100)
    return () => clearInterval(id)
  }, [call.phase])
  const steps = call.phase === "connecting" ? CONNECT_STEPS : call.phase === "incoming" ? ["Answering..."] : [`Ringing ${call.peer}...`]
  const text = call.phase === "outgoing" && !call.id ? "Dialing..." : steps[Math.min(step, steps.length - 1)]
  return (
    <div className="callDialup" aria-live="polite">
      <div className="callModem" aria-hidden="true">
        <span className="callLed is-on" title="MR" />
        <span className={`callLed${step % 2 ? " is-on" : ""}`} />
        <span className={`callLed${step % 3 === 1 ? " is-on" : ""}`} />
        <span className={`callLed${call.phase === "connecting" ? " is-blink" : ""}`} />
      </div>
      <div className="callDialText">{text}</div>
    </div>
  )
}

const Bars = ({ quality }) => {
  const level = quality?.level || 0
  const label = !quality
    ? "Measuring the connection..."
    : `${["", "Poor", "Fair", "Good", "Excellent"][level]} connection${quality.rtt != null ? `: ${quality.rtt} ms` : ""}, ${quality.loss}% loss${quality.relay ? " (relayed)" : ""}`
  return (
    <span className="callBars" title={label} aria-label={label} role="img" data-level={level}>
      {[1, 2, 3, 4].map((i) => (
        <span key={i} className={i <= level ? `is-on is-l${level}` : ""} style={{ height: 3 + i * 3 }} />
      ))}
    </span>
  )
}

const Avatar = ({ name }) => (
  <div className="callAvatar" aria-hidden="true">
    {String(name || "?").charAt(0).toUpperCase()}
  </div>
)

// Self view: drag it to any corner of the screen
const SelfView = ({ stream, mirrored, stageRef }) => {
  const ref = useRef(null)
  const [pos, setPos] = useState({ right: 8, bottom: 8 })
  const drag = useRef(null)
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream
  }, [stream])
  const down = (e) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, ...pos }
  }
  const move = (e) => {
    const d = drag.current
    const stage = stageRef.current
    const el = ref.current?.parentElement
    if (!d || !stage || !el) return
    const maxR = stage.clientWidth - el.offsetWidth - 4
    const maxB = stage.clientHeight - el.offsetHeight - 4
    setPos({
      right: Math.max(4, Math.min(maxR, d.right - (e.clientX - d.x))),
      bottom: Math.max(4, Math.min(maxB, d.bottom - (e.clientY - d.y))),
    })
  }
  const up = () => (drag.current = null)
  return (
    <div className="callSelf" style={pos} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} title="You (drag me)">
      <video ref={ref} className={mirrored ? "is-mirrored" : ""} autoPlay playsInline muted aria-label="Your camera" />
    </div>
  )
}

const CallWindow = () => {
  const aim = useAim()
  const call = engine.useCall()
  const now = useNow(call.phase === "active")
  const stageRef = useRef(null)
  const remoteRef = useRef(null)
  const ios = engine.isIOS()
  const [iosNote, setIosNote] = useState(() => {
    try {
      return ios && localStorage.getItem(IOS_NOTE_KEY) !== "seen"
    } catch {
      return ios
    }
  })
  const [pip, setPip] = useState(false)

  const remoteVideo = call.remote.camera || call.remote.screen
  const hasRemoteVideoTrack = !!call.remoteStream?.getVideoTracks().length
  const showRemote = call.phase === "active" && remoteVideo && hasRemoteVideoTrack
  const selfStream = call.localStream && call.camera ? call.localStream : null
  const live = engine.inCall(call)

  useEffect(() => {
    const el = remoteRef.current
    if (!el) return
    if (el.srcObject !== call.remoteStream) el.srcObject = call.remoteStream
    if (call.remoteStream) el.play?.()?.catch?.(() => {})
  }, [call.remoteStream, showRemote])

  useEffect(() => {
    const el = remoteRef.current
    if (!el) return
    const on = () => setPip(true)
    const off = () => setPip(false)
    el.addEventListener("enterpictureinpicture", on)
    el.addEventListener("leavepictureinpicture", off)
    return () => {
      el.removeEventListener("enterpictureinpicture", on)
      el.removeEventListener("leavepictureinpicture", off)
    }
  }, [])

  const pipSupported =
    typeof document !== "undefined" && (document.pictureInPictureEnabled || !!remoteRef.current?.webkitSupportsPresentationMode?.("picture-in-picture"))
  const togglePip = async () => {
    const el = remoteRef.current
    if (!el) return
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture()
      else if (el.requestPictureInPicture) await el.requestPictureInPicture()
      else if (el.webkitSetPresentationMode) el.webkitSetPresentationMode(el.webkitPresentationMode === "picture-in-picture" ? "inline" : "picture-in-picture")
    } catch {
      // not allowed right now
    }
  }
  // leaving the call leaves picture-in-picture
  useEffect(() => {
    if (!live && document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {})
  }, [live])

  const closeIosNote = () => {
    setIosNote(false)
    try {
      localStorage.setItem(IOS_NOTE_KEY, "seen")
    } catch {
      // fine
    }
  }

  const close = () => aim.closeWindows((w) => w.aimId === "call")
  const status =
    call.phase === "active"
      ? call.reconnecting
        ? "Reconnecting..."
        : `Connected ${callClock(now - call.startedAt)}`
      : call.phase === "ended"
        ? call.error ? "Call failed" : "Call ended"
        : call.phase === "outgoing"
          ? call.id ? `Ringing ${call.peer}...` : "Dialing..."
          : "Connecting..."

  const kind = call.video || call.camera || remoteVideo ? "is-video" : "is-voice"

  return (
    <div className={`callWin ${kind} is-${call.phase}`} data-phase={call.phase}>
      <div className="callStage" ref={stageRef}>
        <div className="callCrt">
          <video
            ref={remoteRef}
            className={`callRemote${showRemote ? "" : " is-hidden"}`}
            autoPlay
            playsInline
            muted
            aria-label={`${call.peer}'s video`}
          />
          {!showRemote && (
            <div className="callCard">
              <Avatar name={call.peer} />
              <div className="callPeer">{call.peer}</div>
              {call.phase === "active" && (
                <div className="callCardSub">
                  {call.remote.muted ? `${call.peer} is muted` : call.video ? `${call.peer}'s camera is off` : "Voice call"}
                </div>
              )}
              {(call.phase === "outgoing" || call.phase === "connecting" || call.phase === "incoming") && <Connecting call={call} />}
              {call.phase === "ended" && <div className="callCardSub">{call.error ? "Couldn't connect" : endedText(call)}</div>}
            </div>
          )}
          <div className="callScan" aria-hidden="true" />
          {call.phase === "active" && (
            <div className="callHud">
              <span className="callHudName">
                {call.peer}
                {call.remote.muted && <MicIcon size={12} off />}
              </span>
              <span className="callHudRight">
                <span className="callTimer">{callClock(now - call.startedAt)}</span>
                <Bars quality={call.quality} />
              </span>
            </div>
          )}
          {call.reconnecting && <div className="callBanner">Reconnecting...</div>}
          {selfStream && live && <SelfView stream={selfStream} mirrored={call.facing === "user" && !call.screen} stageRef={stageRef} />}
        </div>
      </div>

      {call.error && (
        <div className="callNote is-error" role="alert">
          {call.error}
        </div>
      )}
      {call.audioBlocked && live && (
        <button type="button" className="callNote callTapSound" onClick={engine.unblockAudio}>
          Tap here to hear {call.peer}
        </button>
      )}
      {call.notice && live && (
        <div className="callNote" role="status">
          <span>{call.notice}</span>
          <button type="button" onClick={engine.clearNotice}>
            OK
          </button>
        </div>
      )}
      {iosNote && live && (
        <div className="callNote" role="note">
          <span>
            iPhone tips: keep 98ish open during the call (Safari pauses calls in the background or when the screen locks). iPhone picks the speaker or
            earpiece itself; use the volume buttons, or Control Center to switch to headphones.
          </span>
          <button type="button" onClick={closeIosNote}>
            OK
          </button>
        </div>
      )}

      {live ? (
        <div className="callControls">
          <button type="button" className={`callBtn${call.muted ? " is-active" : ""}`} aria-pressed={call.muted} onClick={engine.toggleMute} disabled={!call.localStream}>
            <MicIcon size={20} off={call.muted} />
            <span>{call.muted ? "Unmute" : "Mute"}</span>
          </button>
          <button
            type="button"
            className={`callBtn${!call.camera ? " is-active" : ""}`}
            aria-pressed={!call.camera}
            onClick={() => engine.setCamera(!call.camera)}
            disabled={!call.localStream}
          >
            <VideoIcon size={20} off={!call.camera} />
            <span>{call.camera ? "Camera Off" : "Camera On"}</span>
          </button>
          {call.camera && engine.isPhone() && (
            <button type="button" className="callBtn" onClick={engine.switchCamera}>
              <FlipIcon size={20} />
              <span>Flip</span>
            </button>
          )}
          {engine.canShareScreen() && call.phase === "active" && (
            <button type="button" className={`callBtn${call.screen ? " is-active" : ""}`} aria-pressed={call.screen} onClick={engine.toggleScreen}>
              <ScreenIcon size={20} />
              <span>{call.screen ? "Stop Sharing" : "Share Screen"}</span>
            </button>
          )}
          {showRemote && pipSupported && (
            <button type="button" className={`callBtn${pip ? " is-active" : ""}`} onClick={togglePip}>
              <PipIcon size={20} />
              <span>Pop Out</span>
            </button>
          )}
          <button type="button" className="callBtn callHangUp" onClick={() => engine.hangUp()}>
            <PhoneIcon size={20} down light />
            <span>{call.phase === "outgoing" ? "Cancel" : "Hang Up"}</span>
          </button>
        </div>
      ) : (
        <div className="callControls">
          {call.phase === "ended" && call.peer && (
            <button
              type="button"
              className="callBtn"
              onClick={() => {
                const { peer, video } = call
                engine.dismiss()
                engine.startCall(peer, video)
              }}
            >
              <PhoneIcon size={20} />
              <span>Call Again</span>
            </button>
          )}
          <button type="button" className="callBtn" onClick={close}>
            <span>Close</span>
          </button>
        </div>
      )}

      <div className="status-bar callStatusBar">
        <p className="status-bar-field">{status}</p>
        {call.phase === "active" && (
          <p className="status-bar-field callStatusQuality">
            {call.quality ? `${call.quality.rtt ?? "?"} ms, ${call.quality.loss}% loss${call.quality.relay ? ", relayed" : ""}` : "Measuring..."}
          </p>
        )}
      </div>
    </div>
  )
}

export default CallWindow
