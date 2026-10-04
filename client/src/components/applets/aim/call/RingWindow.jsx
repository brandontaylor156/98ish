import React from "react"
import * as engine from "./engine"
import { PhoneIcon, VideoIcon } from "./CallIcons"
import "./call.css"

// "Incoming Call": who's calling, and Answer (video or voice) / Decline. CallManager rings
// and closes this window when the call is answered elsewhere, cancelled or missed.
const RingWindow = () => {
  const call = engine.useCall()
  if (call.phase !== "incoming") return <div className="callRing" />
  return (
    <div className="callRing" role="alertdialog" aria-label={`${call.peer} is calling`}>
      <div className="callRingTop">
        <span className="callRingIcon">{call.video ? <VideoIcon size={40} /> : <PhoneIcon size={40} />}</span>
        <div>
          <div className="callRingName">{call.peer}</div>
          <div className="callRingKind">is {call.video ? "video " : ""}calling you...</div>
        </div>
      </div>
      <div className="callRingButtons">
        <button type="button" className="callAnswer" onClick={() => engine.answer(call.video)}>
          {call.video ? <VideoIcon size={18} /> : <PhoneIcon size={18} />}
          <span>{call.video ? "Answer Video" : "Answer"}</span>
        </button>
        <button type="button" onClick={() => engine.answer(!call.video)}>
          {call.video ? <PhoneIcon size={18} /> : <VideoIcon size={18} />}
          <span>{call.video ? "Voice Only" : "With Video"}</span>
        </button>
        <button type="button" className="callDecline" onClick={engine.decline}>
          <PhoneIcon size={18} down light />
          <span>Decline</span>
        </button>
      </div>
    </div>
  )
}

export default RingWindow
