import React, { useEffect, useRef, useState } from "react"
import HeadView from "../../shared/head/HeadView"
import { idleFace } from "../../../utils/head/headCore"
import { deleteMyHead, fetchSampleHead, loadMyHead, saveMyHead } from "../../../utils/head/store"
import { NOT_SET_UP, headFromSelfie, selfieAvailable } from "../../../utils/head/lam"
import { startFaceTracking } from "../../../utils/head/faceTracker"

// Passwords and Users > 3D Head (Be Yourself): your own 3D head, for calls. Only you can
// make or replace your head (it's a file on your own drive C:, C:\My Head\head.zip).
export default function HeadTab() {
  const [head, setHead] = useState(null) // { bytes, source, at } | null
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState(null)
  const [mirror, setMirror] = useState(false)
  const live = useRef({ weights: null, yaw: 0, pitch: 0, roll: 0, talking: false })
  const trackRef = useRef(null)
  const fileRef = useRef(null)
  const photoRef = useRef(null)

  const refresh = async () => setHead(await loadMyHead())
  useEffect(() => {
    refresh()
    return () => stopMirror()
  }, [])

  const save = async (bytes, source) => {
    setBusy("Saving your head...")
    const r = await saveMyHead(bytes, { source })
    setBusy(null)
    if (!r.ok) return setMsg(r.error)
    setMsg(source === "sample" ? "The sample head is set as yours for now. Turn on 3D Me in a call to try it." : "Saved. Turn on 3D Me in a call and your friend sees your head.")
    refresh()
  }
  const pickFile = async (e) => {
    const f = e.target.files?.[0]
    e.target.value = ""
    if (!f) return
    save(new Uint8Array(await f.arrayBuffer()), "import")
  }
  const pickPhoto = async (e) => {
    const f = e.target.files?.[0]
    e.target.value = ""
    if (!f) return
    setMsg(null)
    try {
      const bytes = await headFromSelfie(f, { onStatus: setBusy })
      await save(bytes, "selfie")
    } catch (err) {
      setBusy(null)
      setMsg(err.message)
    }
  }
  const selfie = () => {
    if (!selfieAvailable()) return setMsg(NOT_SET_UP)
    photoRef.current?.click()
  }

  const stopMirror = () => {
    trackRef.current?.stop()
    trackRef.current?.stream?.getTracks().forEach((t) => t.stop())
    trackRef.current = null
    setMirror(false)
  }
  const startMirror = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: 640, height: 480 }, audio: true })
      const t = startFaceTracking({
        stream,
        onFace: (w, p, source) => (live.current = { weights: w, ...p, talking: source === "voice" }),
      })
      t.stream = stream
      trackRef.current = t
      setMirror(true)
    } catch {
      setMsg("98ish can't use the camera. Allow it for this site in your browser's settings.")
    }
  }

  const frame = () => (mirror && live.current.weights ? live.current : { weights: idleFace(performance.now() / 1000), yaw: 0, pitch: 0, roll: 0 })

  return (
    <div className="pwHeadTab">
      <fieldset className="pwField">
        <legend>Your 3D head</legend>
        {head ? (
          <>
            <HeadView bytes={head.bytes} frame={frame} className="pwHeadView" label="Your 3D head" />
            <p className="pwNote">
              {head.source === "sample" ? "Using the sample head." : head.source === "selfie" ? "Made from your selfie." : "Imported from a head file."} {(head.bytes.length / 1024 / 1024).toFixed(1)} MB in C:\My Head.
            </p>
            <div className="field-row">
              {mirror ? (
                <button type="button" onClick={stopMirror}>
                  Stop camera
                </button>
              ) : (
                <button type="button" onClick={startMirror} data-head-mirror>
                  Try it with my face
                </button>
              )}
            </div>
          </>
        ) : (
          <p className="pwNote">Make a 3D head and, in a call, your friend sees it move with your face (blinks, smiles, talking) instead of video. It sends about 1 KB a second, so it works on a weak connection too.</p>
        )}
      </fieldset>
      <fieldset className="pwField">
        <legend>{head ? "Change it" : "Make one"}</legend>
        <div className="pwHeadButtons">
          <button type="button" onClick={selfie} disabled={!!busy}>
            From a selfie...
          </button>
          <button type="button" onClick={() => fileRef.current?.click()} disabled={!!busy}>
            Import a head file...
          </button>
          <button type="button" onClick={async () => save(await fetchSampleHead(), "sample")} disabled={!!busy} data-head-sample>
            Use the sample head
          </button>
          {head && (
            <button
              type="button"
              onClick={async () => {
                stopMirror()
                await deleteMyHead()
                setMsg("Your 3D head is deleted (it's in the Recycle Bin).")
                refresh()
              }}
              disabled={!!busy}
            >
              Delete my head
            </button>
          )}
        </div>
        <input ref={fileRef} type="file" accept=".zip,application/zip" hidden onChange={pickFile} />
        <input ref={photoRef} type="file" accept="image/*" capture="user" hidden onChange={pickPhoto} />
        {busy && <p className="pwNote">{busy}</p>}
        {msg && <p className="pwNote" data-selectable>{msg}</p>}
      </fieldset>
    </div>
  )
}
