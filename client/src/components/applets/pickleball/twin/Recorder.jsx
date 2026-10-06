// Twin Replay: filming a game in 98ish. The back camera at 720p (enough for the pose model,
// and a 10-minute game stays around 200 MB on the phone), sound on (the paddle pops time
// the hits), the screen kept awake. The video stays on this device.

import React, { useEffect, useRef, useState } from "react"
import { MAX_READ_SECONDS } from "./reader.js"

const pickType = () => {
  const types = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
  if (typeof MediaRecorder === "undefined") return null
  return types.find((t) => MediaRecorder.isTypeSupported?.(t)) || ""
}
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`

export const Recorder = ({ onDone, onCancel }) => {
  const videoRef = useRef(null)
  const stream = useRef(null)
  const rec = useRef(null)
  const chunks = useRef([])
  const lock = useRef(null)
  const [state, setState] = useState("starting") // starting | ready | recording | error
  const [error, setError] = useState(null)
  const [secs, setSecs] = useState(0)

  useEffect(() => {
    let live = true
    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser can't use the camera here.")
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
        if (!live) return s.getTracks().forEach((t) => t.stop())
        stream.current = s
        videoRef.current.srcObject = s
        await videoRef.current.play().catch(() => {})
        setState("ready")
      } catch (e) {
        setError(e?.name === "NotAllowedError" ? "Camera access was turned down. Allow the camera for 98ish in Settings, or open a video you filmed instead." : e.message || "The camera didn't start.")
        setState("error")
      }
    }
    start()
    return () => {
      live = false
      rec.current?.state === "recording" && rec.current.stop()
      stream.current?.getTracks().forEach((t) => t.stop())
      lock.current?.release?.().catch?.(() => {})
    }
  }, [])

  useEffect(() => {
    if (state !== "recording") return
    const id = setInterval(() => {
      setSecs((s) => {
        if (s + 1 >= MAX_READ_SECONDS) stop()
        return s + 1
      })
    }, 1000)
    return () => clearInterval(id)
  })

  const begin = async () => {
    const type = pickType()
    if (type === null) {
      setError("This browser can't record video. Film with the Camera app and open the video here.")
      setState("error")
      return
    }
    chunks.current = []
    const r = new MediaRecorder(stream.current, { ...(type ? { mimeType: type } : {}), videoBitsPerSecond: 2_500_000 })
    r.ondataavailable = (e) => e.data?.size && chunks.current.push(e.data)
    r.onstop = () => {
      const blob = new Blob(chunks.current, { type: r.mimeType || type || "video/mp4" })
      stream.current?.getTracks().forEach((t) => t.stop())
      lock.current?.release?.().catch?.(() => {})
      onDone(blob)
    }
    r.start(1000)
    rec.current = r
    setSecs(0)
    setState("recording")
    try {
      lock.current = await navigator.wakeLock?.request("screen")
    } catch {
      // (no wake lock: the phone may dim; recording carries on)
    }
  }
  function stop() {
    if (rec.current?.state === "recording") rec.current.stop()
  }

  return (
    <div className="pkTwinRec">
      <video ref={videoRef} className="pkTwinRecView" muted playsInline autoPlay aria-label="Camera" />
      {state === "error" ? (
        <div className="pkPanel window pkTwinRecMsg">
          <p>{error}</p>
          <button type="button" onClick={onCancel}>
            Back
          </button>
        </div>
      ) : (
        <div className="pkTwinRecBar">
          {state === "recording" ? <span className="pkTwinRecDot">● {clock(secs)}</span> : <span className="pkMuted">Phone on the back fence, behind a baseline, sideways. The whole court in the picture.</span>}
          <div className="pkTwinButtons">
            {state !== "recording" && (
              <button type="button" onClick={onCancel}>
                Back
              </button>
            )}
            {state === "ready" && (
              <button type="button" className="pkPrimary" onClick={begin}>
                Start filming
              </button>
            )}
            {state === "recording" && (
              <button type="button" className="pkPrimary" onClick={stop}>
                Stop
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
