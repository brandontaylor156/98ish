import React, { useEffect, useRef, useState } from "react"
import HeadView from "../../../shared/head/HeadView"
import { onRemoteFace, sendFace, startSending, stopSending, useHeadLink } from "../../../../utils/head/callLink"
import { loadMyHead } from "../../../../utils/head/store"
import { startFaceTracking } from "../../../../utils/head/faceTracker"

// Be Yourself in a call. "3D Me" sends your head file once (over the call's own P2P link),
// then ~1 KB/s of face numbers from your camera (or your voice when the camera's off); the
// other side draws your head moving with your face. See utils/head/.

// your side: on/off, with an honest reason when it can't start
export const useThreeDMe = (call) => {
  const [on, setOn] = useState(false)
  const [note, setNote] = useState(null)
  const tracker = useRef(null)
  const link = useHeadLink()
  const stop = () => {
    tracker.current?.stop()
    tracker.current = null
    setOn(false)
  }
  const start = async () => {
    setNote(null)
    const head = await loadMyHead()
    if (!head) return setNote("Make your 3D head first: Start > Settings > Passwords and Users > 3D Head.")
    if (!link.linkOpen) return setNote("Wait a moment: the call is still connecting.")
    setNote("Sending your 3D head...")
    const r = await startSending(head.bytes)
    if (!r.ok) return setNote(r.error)
    setNote(null)
    tracker.current = startFaceTracking({ stream: call.localStream, onPacket: sendFace })
    setOn(true)
  }
  const toggle = () => (on ? (stopSending(), stop()) : start())
  // the call ended or the link dropped: stop
  useEffect(() => {
    if (on && (!link.linkOpen || call.phase !== "active")) stop()
  }, [link.linkOpen, call.phase])
  useEffect(() => () => tracker.current?.stop(), [])
  return { on, toggle, note, clearNote: () => setNote(null), available: link.linkOpen }
}

// their side: the friend's head, live
export const RemoteHead = ({ peer }) => {
  const link = useHeadLink()
  const last = useRef({ weights: null, yaw: 0, pitch: 0, roll: 0, talking: false })
  const [frames, setFrames] = useState(0)
  useEffect(
    () =>
      onRemoteFace((p) => {
        last.current = { weights: p.weights, yaw: p.yaw, pitch: p.pitch, roll: p.roll, talking: p.source === "voice" }
        setFrames((n) => (n + 1) % 1000000)
      }),
    []
  )
  if (!link.remoteOn) return null
  if (!link.remoteHead) {
    return <div className="callHeadNote">Getting {peer}'s 3D head... {Math.round(link.receiving * 100)}%</div>
  }
  return (
    <div className="callRemoteHead" data-head-frames={frames}>
      <HeadView bytes={link.remoteHead} frame={() => last.current} label={`${peer}'s 3D head`} />
    </div>
  )
}
