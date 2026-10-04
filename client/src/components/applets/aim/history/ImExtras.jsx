import React, { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import Dialog from "../../../shared/Dialog"
import { fs, readContent } from "../../../../utils/fs"
import { REACTIONS, formatDuration, reactionCounts } from "./historyCore"
import { copyText } from "../../../../utils/systemClipboard"
import "./history.css"

// The extras of an IM window: pictures and voice messages in the transcript, the full-screen
// picture viewer, reactions (picker and counts), the "+" sheet's picture chooser and the voice
// bar. Heavy parts (resizing, recording, playing) are in mediaClient.js, loaded on first use.

const portal = (node) => createPortal(node, document.querySelector(".os-root") || document.body)
const mediaClient = () => import("./mediaClient")

// ---- reactions ----

// A small 98-style box of the six reactions next to where you pressed. `current`: yours.
// `text`: the message's words. Its Copy button is how you copy a message on a phone, where
// holding a message opens this box instead of the phone's text selection.
export const ReactionPicker = ({ x, y, current, onPick, onClose, text }) => {
  const ref = useRef(null)
  const [pos, setPos] = useState({ left: x, top: y })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({ left: Math.max(4, Math.min(x - r.width / 2, window.innerWidth - r.width - 4)), top: Math.max(4, Math.min(y - r.height - 12, window.innerHeight - r.height - 4)) })
    el.querySelector("button")?.focus({ preventScroll: true })
    const away = (e) => !el.contains(e.target) && onClose()
    const key = (e) => e.key === "Escape" && onClose()
    window.addEventListener("pointerdown", away, true)
    window.addEventListener("keydown", key, true)
    return () => {
      window.removeEventListener("pointerdown", away, true)
      window.removeEventListener("keydown", key, true)
    }
  }, [])
  return portal(
    <div ref={ref} className="imReactPicker" role="menu" aria-label="React" style={pos} onContextMenu={(e) => e.preventDefault()}>
      {REACTIONS.map((r) => (
        <button
          key={r.id}
          type="button"
          role="menuitemradio"
          aria-checked={current === r.id}
          className={current === r.id ? "is-mine" : ""}
          title={r.label}
          aria-label={r.label}
          onClick={() => {
            onPick(r.id)
            onClose()
          }}
        >
          <span aria-hidden="true">{r.emoji}</span>
        </button>
      ))}
      {text && (
        <button
          type="button"
          role="menuitem"
          className="imReactCopy"
          title="Copy the message"
          onClick={() => {
            copyText(text)
            onClose()
          }}
        >
          Copy
        </button>
      )}
    </div>
  )
}

// under a message: each reaction with how many; yours is pressed in (tap it to take it back)
export const ReactionChips = ({ r, meKey, onToggle }) => {
  const counts = reactionCounts(r, meKey)
  if (!counts.length) return null
  return (
    <div className="imReactions">
      {counts.map((c) => (
        <button key={c.id} type="button" className={`imReactChip${c.mine ? " is-mine" : ""}`} aria-label={`${c.label} ${c.count}${c.mine ? ", yours" : ""}`} title={c.label} onClick={() => onToggle?.(c.id)}>
          <span aria-hidden="true">{c.emoji}</span>
          {c.count > 1 && <span className="imReactCount">{c.count}</span>}
        </button>
      ))}
    </div>
  )
}

// ---- media in the transcript ----

// the bytes of a message's media: { url, blob } | { expired } | { resting } | { error } | null (loading)
const useMediaBlob = (message, getBlob, auto) => {
  const [state, setState] = useState(message.localBlob ? { blob: message.localBlob } : null)
  const [asked, setAsked] = useState(auto)
  useEffect(() => {
    if (state?.blob || !asked || !message.media?.id) return
    let alive = true
    getBlob(message.media).then((result) => alive && setState(result || { error: "It couldn't be fetched." }))
    return () => {
      alive = false
    }
  }, [asked, message.media?.id])
  const url = useMemo(() => (state?.blob ? URL.createObjectURL(state.blob) : null), [state?.blob])
  useEffect(() => () => url && URL.revokeObjectURL(url), [url])
  return { state, url, ask: () => setAsked(true) }
}

const Missing = ({ kind, state }) => (
  <span className="imMediaMissing">
    {kind === "audio" ? "🎤" : "📷"} {state?.expired ? `${kind === "audio" ? "Voice message" : "Picture"} expired` : state?.resting ? "Online storage is resting. Try again later." : state?.error || "Unavailable"}
  </span>
)

// A picture: its preview at once (this device has it), the full picture on tap
export const PictureBubble = ({ message, getBlob, onOpen }) => {
  const { w = 4, h = 3 } = message.media || {}
  const { state, url, ask } = useMediaBlob(message, getBlob, !message.thumb)
  const src = url || message.thumb
  const failed = state && !state.blob
  const box = { aspectRatio: `${Math.max(1, w)} / ${Math.max(1, h)}` }
  if (failed && !message.thumb) return <Missing kind="image" state={state} />
  return (
    <button
      type="button"
      className={`imPicture${message.pending ? " is-pending" : ""}`}
      style={box}
      aria-label={message.pending ? "Picture, sending" : "Picture. Open it full screen"}
      onClick={() => {
        ask()
        onOpen(message)
      }}
    >
      {src ? <img src={src} alt="" draggable="false" /> : <span className="imPictureWait">📷 Loading picture...</span>}
      {message.pending && <span className="imMediaBadge">Sending...</span>}
      {failed && <span className="imMediaBadge">{state.expired ? "Expired" : "Unavailable"}</span>}
    </button>
  )
}

// A voice message: play/stop, its waveform (filling as it plays) and how long it is
export const VoiceBubble = ({ message, getBlob }) => {
  const { d = 0, wf = "" } = message.media || {}
  const { state, ask } = useMediaBlob(message, getBlob, false)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const handle = useRef(null)
  const timer = useRef(null)
  const wantPlay = useRef(false)

  const stop = () => {
    handle.current?.stop()
    handle.current = null
    clearInterval(timer.current)
    setPlaying(false)
    setProgress(0)
  }
  useEffect(() => () => stop(), [])

  const start = async (blob) => {
    const { playVoice } = await mediaClient()
    const startedAt = performance.now()
    setPlaying(true)
    handle.current = playVoice(blob, { onEnd: () => stop() })
    clearInterval(timer.current)
    timer.current = setInterval(() => setProgress(Math.min(1, (performance.now() - startedAt) / 1000 / Math.max(0.3, d))), 100)
  }
  useEffect(() => {
    if (wantPlay.current && state?.blob) {
      wantPlay.current = false
      start(state.blob)
    }
  }, [state?.blob])

  const toggle = () => {
    if (playing) return stop()
    if (state?.blob) return start(state.blob)
    wantPlay.current = true
    ask()
  }
  if (state && !state.blob && !message.pending) return <Missing kind="audio" state={state} />
  const bars = (wf || "0".repeat(40)).padEnd(40, "0").slice(0, 40)
  return (
    <span className={`imVoice${message.pending ? " is-pending" : ""}`}>
      <button type="button" className="imVoicePlay" onClick={toggle} disabled={message.pending} aria-label={playing ? "Stop voice message" : `Play voice message, ${formatDuration(d)}`}>
        <span aria-hidden="true">{playing ? "■" : wantPlay.current && !state ? "…" : "▶"}</span>
      </button>
      <span className="imWave" aria-hidden="true">
        {[...bars].map((c, i) => (
          <i key={i} style={{ height: `${20 + Number(c) * 8}%` }} className={i / 40 < progress ? "is-played" : ""} />
        ))}
      </span>
      <span className="imVoiceTime">{message.pending ? "Sending..." : formatDuration(d)}</span>
    </span>
  )
}

// ---- the picture viewer ----

export const PictureViewer = ({ message, getBlob, onClose }) => {
  const { state, url } = useMediaBlob(message, getBlob, true)
  const [saved, setSaved] = useState(null)
  useEffect(() => {
    const key = (e) => e.key === "Escape" && onClose()
    window.addEventListener("keydown", key)
    return () => window.removeEventListener("keydown", key)
  }, [])
  const save = async () => {
    if (!state?.blob) return
    setSaved("Saving...")
    const lib = await import("../../photos/library")
    const data = await new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.readAsDataURL(state.blob)
    })
    const stamp = new Date(message.time).toISOString().slice(0, 10)
    const result = await lib.savePicture(lib.picturesFolder(), `IM ${message.from} ${stamp}.jpg`.replace(/[\\/:*?"<>|]/g, ""), String(data).replace(/^data:application\/octet-stream/, "data:image/jpeg"))
    setSaved(result.ok ? `Saved to My Pictures as ${result.file.name}` : result.error)
  }
  return portal(
    <div className="imViewer" role="dialog" aria-modal="true" aria-label={`Picture from ${message.from}`} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="imViewerBar">
        <span className="imViewerTitle">
          {message.from} · {new Date(message.time).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
        </span>
        <button type="button" onClick={save} disabled={!state?.blob}>
          Save to My Pictures
        </button>
        <button type="button" onClick={onClose} aria-label="Close">
          Close
        </button>
      </div>
      <div className="imViewerStage" onClick={(e) => e.target === e.currentTarget && onClose()}>
        {url ? <img src={url} alt={`Picture from ${message.from}`} /> : message.thumb ? <img src={message.thumb} alt="" className="is-preview" /> : null}
        {state && !state.blob && <p className="imViewerNote">{state.expired ? "This picture expired (pictures are kept 90 days)." : state.resting ? "Online storage is resting. Try again later." : state.error}</p>}
        {!state && <p className="imViewerNote">Loading the full picture...</p>}
      </div>
      {saved && <p className="imViewerSaved" role="status">{saved}</p>}
    </div>
  )
}

// ---- choosing a picture ----

// From C:\My Pictures (what Camera and Photos keep), or from this device / its camera
export const PicturePicker = ({ touch, onPick, onCancel }) => {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const upload = useRef(null)
  const camera = useRef(null)
  const pictures = useMemo(() => {
    const dir = fs.resolve("C:/My Pictures")
    return dir?.isDirectory ? dir.content.filter((i) => !i.isDirectory && i.isImage).slice(-60).reverse() : []
  }, [])

  const use = async (source) => {
    setBusy(true)
    setError(null)
    try {
      const { preparePicture } = await mediaClient()
      onPick(await preparePicture(source))
    } catch (e) {
      setBusy(false)
      setError(e?.message || "That picture couldn't be opened.")
    }
  }
  const fromFile = (e) => {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (file) use(file)
  }

  return (
    <Dialog title="Send a Picture" onCancel={onCancel} okLabel="Close" onOk={onCancel}>
      <div className="imPick">
        <div className="imPickButtons">
          {touch && (
            <button type="button" onClick={() => camera.current?.click()} disabled={busy}>
              Take a Photo...
            </button>
          )}
          <button type="button" onClick={() => upload.current?.click()} disabled={busy}>
            {touch ? "From Photos on this phone..." : "From this computer..."}
          </button>
        </div>
        <p className="imPickLabel">{pictures.length ? "From My Pictures:" : "No pictures in My Pictures yet (Camera and Photos keep theirs there)."}</p>
        <div className="imPickGrid">
          {pictures.map((p) => (
            <button
              key={p.name}
              type="button"
              className="imPickItem"
              title={p.name}
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                use(await readContent(p))
              }}
            >
              <img src={p.thumb || (p.loaded ? p.textContent : "") || undefined} alt={p.name} draggable="false" loading="lazy" />
            </button>
          ))}
        </div>
        {busy && <p role="status">Getting it ready...</p>}
        {error && <p className="imPickError">{error}</p>}
        <input ref={upload} type="file" accept="image/*" hidden onChange={fromFile} />
        <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={fromFile} />
      </div>
    </Dialog>
  )
}

// ---- recording a voice message ----

// Replaces the message box while open: hold the button to record, let go to send (or tap once
// to start and tap Send to finish). 60 seconds at most.
export const VoiceBar = ({ onSend, onClose }) => {
  const [mic, setMic] = useState(null)
  const [problem, setProblem] = useState(null)
  const [rec, setRec] = useState(null) // { started, mode: "hold" | "tap" }
  const [elapsed, setElapsed] = useState(0)
  const recorder = useRef(null)
  const downAt = useRef(0)
  const streamRef = useRef(null)

  useEffect(() => {
    let alive = true
    mediaClient().then(async ({ canRecord, openMicrophone, closeMicrophone }) => {
      if (!canRecord()) return alive && setProblem("This browser can't record sound.")
      try {
        const stream = await openMicrophone()
        if (!alive) return closeMicrophone(stream)
        streamRef.current = stream
        setMic(stream)
      } catch (e) {
        if (alive) setProblem(e?.name === "NotAllowedError" ? "98ish isn't allowed to use the microphone. Allow it in the browser's settings, then try again." : "No microphone was found.")
      }
    })
    return () => {
      alive = false
      recorder.current?.cancel()
      mediaClient().then(({ closeMicrophone }) => closeMicrophone(streamRef.current))
    }
  }, [])

  useEffect(() => {
    if (!rec) return
    const t = setInterval(() => setElapsed((performance.now() - rec.started) / 1000), 200)
    return () => clearInterval(t)
  }, [rec])

  const begin = async (mode) => {
    if (!mic || recorder.current) return
    const { startRecording } = await mediaClient()
    recorder.current = startRecording(mic, { onLimit: () => finish(true) })
    setElapsed(0)
    setRec({ started: performance.now(), mode })
  }
  const finish = async (send) => {
    const r = recorder.current
    recorder.current = null
    setRec(null)
    if (!r) return
    if (!send) return r.cancel()
    const result = await r.stop()
    if (result && result.d >= 0.5) onSend(result)
  }

  const holding = rec?.mode === "hold"
  return (
    <div className="imVoiceBar" role="group" aria-label="Voice message">
      <button type="button" className="imVoiceCancel" onClick={() => (rec ? finish(false) : onClose())} aria-label={rec ? "Cancel recording" : "Close voice message"}>
        ✕
      </button>
      <div className="imVoiceStatus" aria-live="polite">
        {problem ||
          (!mic ? "Getting the microphone ready..." : rec ? (
            <>
              <span className="imRecDot" aria-hidden="true" /> {formatDuration(elapsed)} {holding ? "· let go to send" : "· tap Send when you're done"}
            </>
          ) : (
            "Hold the button and talk (up to 1 minute)"
          ))}
      </div>
      {rec?.mode === "tap" ? (
        <button type="button" className="imVoiceSend" onClick={() => finish(true)}>
          Send
        </button>
      ) : (
        <button
          type="button"
          className={`imVoiceHold${holding ? " is-recording" : ""}`}
          disabled={!mic}
          onPointerDown={(e) => {
            if (e.button && e.button !== 0) return
            e.currentTarget.setPointerCapture?.(e.pointerId)
            downAt.current = performance.now()
            begin("hold")
          }}
          onPointerUp={() => {
            // a quick tap: keep recording until Send
            if (performance.now() - downAt.current < 350) return setRec((r) => (r ? { ...r, mode: "tap" } : r))
            finish(true)
          }}
          onPointerCancel={() => finish(false)}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === " ") && !rec) {
              e.preventDefault()
              begin("tap")
            }
          }}
          onContextMenu={(e) => e.preventDefault()}
          aria-label="Hold to record"
        >
          🎤 {holding ? "Recording" : "Hold to talk"}
        </button>
      )}
    </div>
  )
}
