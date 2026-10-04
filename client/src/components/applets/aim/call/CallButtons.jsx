import React from "react"
import * as engine from "./engine"
import { PhoneIcon, VideoIcon } from "./CallIcons"
import "./call.css"

// Start a call from anywhere (the tap itself must start it: iPhone only opens the camera
// and microphone inside a tap). Problems placing the call show in the call window; this
// only reports the ones that never get that far (already on a call, no WebRTC).
export const placeCall = async (screenName, video, onError) => {
  if (!engine.callsSupported()) {
    onError?.(window.isSecureContext === false ? "Calls need a secure (https) connection." : "This browser can't make calls. Try Safari or Chrome.")
    return
  }
  const result = await engine.startCall(screenName, video)
  if (!result?.ok && result?.error && engine.getCall().phase !== "ended") onError?.(result.error)
}

export const CallButtons = ({ screenName, disabled, onError, className = "aimImHeaderCalls" }) => (
  <span className={className}>
    <button type="button" className="callStart" disabled={disabled} onClick={() => placeCall(screenName, false, onError)} title={`Call ${screenName}`}>
      <PhoneIcon size={14} />
      <span>Call</span>
    </button>
    <button type="button" className="callStart" disabled={disabled} onClick={() => placeCall(screenName, true, onError)} title={`Video call ${screenName}`}>
      <VideoIcon size={14} />
      <span>Video Call</span>
    </button>
  </span>
)
