import React, { useEffect, useRef, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import Dialog from "../../shared/Dialog"
import FileDialog from "../notepad/FileDialog"
import { fs, readContent, writeAndSave } from "../../../utils/fs"
import { useFsVersion } from "../../../hooks/useFs"
import { trackUnsaved } from "../../../utils/unsaved"
import { closeAudioContext, createAudioContext, masterOutput } from "../../../utils/audio"
import * as W from "./wave"
import { filePayload, sendToItems } from "../../../utils/share"
import { safeFileName } from "../../../utils/shareRules"
import "./SoundRecorder.css"

// Sound Recorder, as in Windows 98: record from the microphone (up to 60 seconds), play it
// back, add effects (louder, faster, echo, reverse), cut it before or after the playhead,
// insert or mix in another sound, and save it to the drive as a Wave Sound.

const isSound = (item) => item.type === "sound"

// still on the drive (not deleted, not in the Recycle Bin)?
const onDrive = (file) => !!file && fs.partsOf(file)[0] === "C:" && fs.resolve(fs.partsOf(file)) === file

const WINDOW = 1024 // samples shown in the wave display (about 1/20 s)

// its own context (the microphone and playback), woken by taps like every other and closed
// with the window; playback goes through the taskbar volume
const newContext = () => createAudioContext()

// a sound file's contents -> samples at 22,050 Hz (the browser decodes anything that
// isn't a plain PCM .wav)
const decodeFile = async (file, ctx) => {
  const text = await readContent(file)
  if (!text) return new Float32Array(0)
  const bytes = W.dataUrlToBytes(text)
  if (!bytes) throw new Error(`'${file.name}' is not a valid sound file.`)
  const wav = W.decodeWav(bytes)
  if (wav) return W.limit(W.resample(wav.samples, wav.rate))
  if (!ctx) throw new Error("This browser can't play sounds.")
  const decoded = await ctx.decodeAudioData(bytes.buffer.slice(0))
  return W.limit(W.resample(decoded.getChannelData(0), decoded.sampleRate))
}

const Icon = ({ kind }) => {
  const paths = {
    start: "M2 3h2v10H2zM9 3v10L4 8zM15 3v10l-5-5z",
    end: "M1 3v10l5-5zM7 3v10l5-5zM12 3h2v10h-2z",
    play: "M4 2v12l8-6z",
    stop: "M4 4h8v8H4z",
  }
  if (kind === "record") return <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="4.5" fill="#e00000" stroke="#600000" /></svg>
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" shapeRendering="crispEdges">
      <path d={paths[kind]} fill="#000" />
    </svg>
  )
}

const SoundRecorder = ({ file: initialFile = null, onTitle, onClose, registerCloseGuard, fitWindow }) => {
  useFsVersion()
  const [file, setFile] = useState(initialFile)
  const samples = useRef(new Float32Array(0))
  const [version, setVersion] = useState(0) // bumps whenever samples change
  const [savedVersion, setSavedVersion] = useState(0)
  const [pos, setPosState] = useState(0)
  const posRef = useRef(0)
  const [mode, setMode] = useState("stopped") // stopped | playing | recording | loading
  const [dialog, setDialog] = useState(null)
  const ctxRef = useRef(null)
  const playRef = useRef(null) // { src, t0, start }
  const recRef = useRef(null) // { recorder, stream, analyser, start, t0, stopping }
  const frame = useRef(0)
  const canvasRef = useRef(null)
  const rootRef = useRef(null)
  const afterSave = useRef(null)
  const versionRef = useRef(0)
  const live = useRef({})

  const length = samples.current.length
  const dirty = version !== savedVersion
  const name = file ? file.name : "Sound"
  live.current = { dirty, mode }

  const setPos = (p) => {
    posRef.current = p
    setPosState(p)
  }

  const replace = (next, { at = posRef.current, saved = false } = {}) => {
    samples.current = next
    versionRef.current += 1
    setVersion(versionRef.current)
    if (saved) setSavedVersion(versionRef.current)
    setPos(Math.max(0, Math.min(at, next.length)))
  }

  useEffect(() => onTitle?.(`${name} - Sound Recorder`), [name])

  // The window is small, as in the original: it grows while a dialog needs the room (Open,
  // Save As...) and shrinks back afterwards
  const grown = useRef(null)
  useEffect(() => {
    const win = rootRef.current?.closest(".window")
    if (!fitWindow || !win) return
    if (dialog) {
      const { width, height } = win.getBoundingClientRect()
      const files = ["open", "saveAs", "insert", "mix"].includes(dialog.kind)
      const need = files ? { width: 400, height: 420 } : { width: 360, height: 280 }
      if (width < need.width || height < need.height) {
        grown.current ||= { width, height }
        fitWindow(Math.max(width, need.width), Math.max(height, need.height))
      }
    } else if (!dialog && grown.current) {
      fitWindow(grown.current.width, grown.current.height)
      grown.current = null
    }
  }, [dialog])

  // keep keyboard shortcuts working after a menu or dialog closes (focus would be lost)
  useEffect(() => {
    if (!dialog && (document.activeElement === document.body || !document.activeElement)) rootRef.current?.focus({ preventScroll: true })
  }, [dialog, version, mode])
  useEffect(() => (dirty ? trackUnsaved("Sound Recorder") : undefined), [dirty])

  const audio = () => {
    if (!ctxRef.current) ctxRef.current = newContext()
    const ctx = ctxRef.current
    if (ctx && ctx.state !== "running") ctx.resume?.().catch?.(() => {})
    return ctx
  }

  // ---- loading ----

  const load = async (target, { then } = {}) => {
    setMode("loading")
    try {
      const next = await decodeFile(target, ctxRef.current || (ctxRef.current = newContext()))
      setFile(target)
      replace(next, { at: 0, saved: true })
      then?.()
    } catch (error) {
      setDialog({ kind: "alert", text: error?.message?.includes("valid") ? error.message : `'${target.name}' is not a valid sound file, or this browser can't read it.` })
    }
    setMode("stopped")
  }

  useEffect(() => {
    if (initialFile) load(initialFile)
    return () => {
      cancelAnimationFrame(frame.current)
      stopPlayback()
      const rec = recRef.current
      if (rec) {
        rec.cancelled = true
        try {
          rec.recorder.stop()
        } catch {}
        rec.stream.getTracks().forEach((t) => t.stop())
      }
      closeAudioContext(ctxRef.current)
      ctxRef.current = null
    }
  }, [])

  // closing the window with unsaved changes asks first
  useEffect(() => {
    if (!registerCloseGuard) return
    return registerCloseGuard(() => {
      if (live.current.mode === "recording") stopRecording()
      if (!live.current.dirty) return true
      afterSave.current = () => onClose?.()
      setDialog({ kind: "changed" })
      return false
    })
  }, [registerCloseGuard])

  // ---- the wave display ----

  const draw = (data, offset = 0) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const g = canvas.getContext("2d")
    const { width, height } = canvas
    g.fillStyle = "#000"
    g.fillRect(0, 0, width, height)
    g.fillStyle = "#00ff00"
    const mid = height / 2
    const per = WINDOW / width
    for (let x = 0; x < width; x++) {
      let lo = 0
      let hi = 0
      for (let i = Math.floor(x * per); i < Math.floor((x + 1) * per); i++) {
        const v = data[offset + i] || 0
        if (v < lo) lo = v
        if (v > hi) hi = v
      }
      const top = Math.round(mid - hi * (mid - 1))
      const bottom = Math.round(mid - lo * (mid - 1))
      g.fillRect(x, top, 1, Math.max(1, bottom - top + 1))
    }
  }

  useEffect(() => {
    if (mode !== "playing" && mode !== "recording") draw(samples.current, pos)
  }, [pos, version, mode])

  // ---- playing ----

  const stopPlayback = () => {
    const play = playRef.current
    if (!play) return
    playRef.current = null
    play.src.onended = null
    try {
      play.src.stop()
    } catch {}
    cancelAnimationFrame(frame.current)
    const at = Math.min(samples.current.length, Math.round(play.start + (play.ctx.currentTime - play.t0) * W.RATE))
    setPos(at)
  }

  const play = () => {
    if (mode !== "stopped" || !samples.current.length) return
    const ctx = audio()
    if (!ctx) return setDialog({ kind: "alert", text: "This browser can't play sounds." })
    const data = samples.current
    const start = posRef.current >= data.length ? 0 : posRef.current
    const buffer = ctx.createBuffer(1, data.length, W.RATE)
    buffer.getChannelData(0).set(data)
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.connect(masterOutput(ctx))
    src.start(0, start / W.RATE)
    const entry = { src, ctx, t0: ctx.currentTime, start }
    playRef.current = entry
    src.onended = () => {
      if (playRef.current !== entry) return
      playRef.current = null
      cancelAnimationFrame(frame.current)
      setPos(data.length)
      setMode("stopped")
    }
    setMode("playing")
    const tick = () => {
      if (playRef.current !== entry) return
      const at = Math.min(data.length, Math.round(start + (ctx.currentTime - entry.t0) * W.RATE))
      setPos(at)
      draw(data, at)
      frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)
  }

  // ---- recording ----

  const record = async () => {
    if (mode !== "stopped") return
    if (posRef.current >= W.MAX_SAMPLES) return setDialog({ kind: "alert", text: "This sound is already 60 seconds long, the most Sound Recorder can record. Move the slider back, or delete some of it first." })
    if (!navigator.mediaDevices?.getUserMedia || typeof window.MediaRecorder === "undefined") {
      return setDialog({ kind: "alert", text: "Sound Recorder can't find a recording device. This browser doesn't support recording from a microphone." })
    }
    // the sound card and the microphone both start inside this tap (iPhones insist)
    const ctx = audio()
    setMode("loading")
    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
    } catch (error) {
      setMode("stopped")
      const blocked = error?.name === "NotAllowedError" || error?.name === "SecurityError"
      return setDialog({
        kind: "alert",
        text: blocked
          ? "Sound Recorder isn't allowed to use your microphone. Allow microphone access for this site in your browser's settings, then try again."
          : "Sound Recorder can't find a microphone. Plug one in (or check that no other program is using it) and try again.",
      })
    }
    let recorder
    try {
      recorder = new MediaRecorder(stream)
    } catch {
      stream.getTracks().forEach((t) => t.stop())
      setMode("stopped")
      return setDialog({ kind: "alert", text: "This browser can't record sound." })
    }
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 2048
    const source = ctx.createMediaStreamSource(stream)
    source.connect(analyser)
    const chunks = []
    const start = posRef.current
    const entry = { recorder, stream, analyser, source, start, t0: performance.now(), stopping: false, cancelled: false }
    recRef.current = entry
    recorder.ondataavailable = (e) => e.data?.size && chunks.push(e.data)
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop())
      source.disconnect()
      if (entry.cancelled) return
      const elapsed = Math.round(((performance.now() - entry.t0) / 1000) * W.RATE)
      try {
        const blob = new Blob(chunks, { type: recorder.mimeType || chunks[0]?.type || "audio/webm" })
        const decoded = await ctx.decodeAudioData(await blob.arrayBuffer())
        let take = W.resample(decoded.getChannelData(0), decoded.sampleRate)
        // keep to the time actually recorded (and the 60 second limit)
        take = take.slice(0, Math.min(take.length, elapsed + W.RATE / 10, W.MAX_SAMPLES - start))
        replace(W.limit(W.overwriteAt(samples.current, start, take)), { at: start + take.length })
      } catch {
        setDialog({ kind: "alert", text: "Sound Recorder couldn't read what was recorded. This browser may record in a format it can't play back." })
      }
      recRef.current = null
      setMode("stopped")
    }
    recorder.start(250)
    setMode("recording")
    const data = new Float32Array(analyser.fftSize)
    const tick = () => {
      if (recRef.current !== entry || entry.stopping) return
      const elapsed = Math.round(((performance.now() - entry.t0) / 1000) * W.RATE)
      setPos(Math.min(W.MAX_SAMPLES, start + elapsed))
      analyser.getFloatTimeDomainData(data)
      draw(data, 0)
      if (start + elapsed >= W.MAX_SAMPLES) return stopRecording()
      frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)
  }

  const stopRecording = () => {
    const rec = recRef.current
    if (!rec || rec.stopping) return
    rec.stopping = true
    cancelAnimationFrame(frame.current)
    setMode("loading")
    try {
      rec.recorder.stop()
    } catch {
      recRef.current = null
      setMode("stopped")
    }
  }

  const stop = () => {
    if (mode === "playing") {
      stopPlayback()
      setMode("stopped")
    } else if (mode === "recording") stopRecording()
  }

  const seek = (to) => {
    if (mode === "recording" || mode === "loading") return
    const wasPlaying = mode === "playing"
    if (wasPlaying) {
      stopPlayback()
      setMode("stopped")
    }
    setPos(Math.max(0, Math.min(to, samples.current.length)))
  }

  // ---- files ----

  const tooBig = () =>
    setDialog({ kind: "alert", text: "There isn't enough room on the 98ish drive to save this sound. Try making it shorter (Edit > Delete After Current Position), or delete some files and try again." })

  const markSaved = () => {
    setSavedVersion(versionRef.current)
    setDialog(null)
    const next = afterSave.current
    afterSave.current = null
    next?.()
  }

  const writeTo = async (dir, fileName) => {
    const url = W.samplesToDataUrl(samples.current)
    try {
      let target = dir.getItem(fileName)
      let ok
      if (target && isSound(target)) ok = await writeAndSave(target, url)
      else {
        target = fs.createFileIn(dir, fileName, "sound", "")
        ok = await writeAndSave(target, url, { created: true })
      }
      if (!ok) {
        afterSave.current = null
        return tooBig()
      }
      setFile(target)
      markSaved()
    } catch (error) {
      afterSave.current = null
      setDialog({ kind: "alert", text: error.message })
    }
  }

  const save = async () => {
    halt()
    if (onDrive(file) && isSound(file)) {
      if (!(await writeAndSave(file, W.samplesToDataUrl(samples.current)))) {
        afterSave.current = null
        return tooBig()
      }
      return markSaved()
    }
    setDialog({ kind: "saveAs" })
  }

  // stop playing (or recording) before anything changes the sound
  const halt = () => {
    if (mode === "playing") {
      stopPlayback()
      setMode("stopped")
    }
    if (mode === "recording") stopRecording()
  }

  const guard = (then) => {
    halt()
    if (!dirty) return then()
    afterSave.current = then
    setDialog({ kind: "changed" })
  }

  const newSound = () =>
    guard(() => {
      setFile(null)
      replace(new Float32Array(0), { at: 0, saved: true })
      setDialog(null)
    })

  const busy = mode === "recording" || mode === "loading"
  const empty = length === 0

  const edit = (fn, at) => {
    halt()
    replace(W.limit(fn(samples.current)), at === undefined ? {} : { at })
  }

  // Insert File / Mix with File
  const withFile = async (target, how) => {
    setDialog(null)
    setMode("loading")
    try {
      const other = await decodeFile(target, ctxRef.current || (ctxRef.current = newContext()))
      const at = posRef.current
      replace(W.limit(how === "insert" ? W.insertAt(samples.current, at, other) : W.mixAt(samples.current, at, other)), { at })
    } catch {
      setDialog({ kind: "alert", text: `'${target.name}' is not a valid sound file, or this browser can't read it.` })
    }
    setMode("stopped")
  }

  const effect = (fn) => !busy && !empty && edit(fn, 0)

  // Send To: the sound as it is now, as a .wav
  const sharePayload = () => {
    halt()
    const title = (file?.name || "Sound").replace(/\.wav$/i, "")
    return filePayload(title, { name: safeFileName(title, ".wav"), data: W.encodeWav(samples.current), mime: "audio/wav" })
  }

  const menus = [
    {
      label: "File",
      items: [
        { label: "New", onClick: newSound },
        { label: "Open...", onClick: () => guard(() => setDialog({ kind: "open" })) },
        { label: "Save", onClick: save, disabled: busy },
        { label: "Save As...", onClick: () => (halt(), setDialog({ kind: "saveAs" })), disabled: busy },
        { label: "Revert...", disabled: !dirty || !onDrive(file) || busy, onClick: () => (halt(), setDialog({ kind: "revert" })) },
        "-",
        { label: "Send To", disabled: busy || empty, items: sendToItems(sharePayload, { title: "Sound Recorder" }) },
        { label: "Properties", onClick: () => setDialog({ kind: "properties" }) },
        "-",
        { label: "Exit", onClick: () => guard(() => onClose?.()) },
      ],
    },
    {
      label: "Edit",
      items: [
        { label: "Insert File...", disabled: busy, onClick: () => (halt(), setDialog({ kind: "insert" })) },
        { label: "Mix with File...", disabled: busy, onClick: () => (halt(), setDialog({ kind: "mix" })) },
        { label: "Insert Chime", disabled: busy, onClick: () => edit((s) => W.insertAt(s, posRef.current, W.chime()), posRef.current) },
        "-",
        { label: "Delete Before Current Position", disabled: busy || empty || pos === 0, onClick: () => (halt(), setDialog({ kind: "deleteBefore" })) },
        { label: "Delete After Current Position", disabled: busy || empty || pos >= length, onClick: () => (halt(), setDialog({ kind: "deleteAfter" })) },
      ],
    },
    {
      label: "Effects",
      items: [
        { label: "Increase Volume (by 25%)", disabled: busy || empty, onClick: () => effect(W.increaseVolume) },
        { label: "Decrease Volume", disabled: busy || empty, onClick: () => effect(W.decreaseVolume) },
        "-",
        { label: "Increase Speed (by 100%)", disabled: busy || empty, onClick: () => effect(W.increaseSpeed) },
        { label: "Decrease Speed", disabled: busy || empty, onClick: () => effect(W.decreaseSpeed) },
        "-",
        { label: "Add Echo", disabled: busy || empty, onClick: () => effect((s) => W.addEcho(s)) },
        { label: "Reverse", disabled: busy || empty, onClick: () => effect(W.reverse) },
      ],
    },
    {
      label: "Help",
      items: [
        {
          label: "About Sound Recorder",
          onClick: () =>
            setDialog({ kind: "alert", title: "About Sound Recorder", text: "Sound Recorder for 98ish. Records up to 60 seconds from your microphone. Your recordings stay on this computer, saved on the 98ish drive." }),
        },
      ],
    },
  ]

  const status = mode === "playing" ? "Playing." : mode === "recording" ? "Recording." : mode === "loading" ? "Please wait..." : "Stopped."

  const onKeyDown = (e) => {
    if (e.target.closest?.(".dialog, input:not([type=range]), select, textarea")) return
    const ctrl = e.ctrlKey || e.metaKey
    const key = e.key.toLowerCase()
    if (ctrl && key === "s") return e.preventDefault(), save()
    if (ctrl && key === "o") return e.preventDefault(), guard(() => setDialog({ kind: "open" }))
    if (ctrl && key === "n") return e.preventDefault(), newSound()
    if (e.key === " " && e.target.tagName !== "BUTTON") return e.preventDefault(), mode === "playing" ? stop() : play()
  }

  return (
    <div className="srRoot" ref={rootRef} tabIndex={-1} onKeyDown={onKeyDown}>
      <MenuBar menus={menus} />
      <div className="srBody">
        <div className="srTop">
          <div className="srReadout">
            <span>Position:</span>
            <span className="srTime" data-testid="sr-position">{W.seconds(pos)}</span>
          </div>
          <div className="srWave">
            <canvas ref={canvasRef} width={128} height={44} aria-label="Sound wave" />
          </div>
          <div className="srReadout srReadout--right">
            <span>Length:</span>
            <span className="srTime" data-testid="sr-length">{W.seconds(mode === "recording" ? Math.max(length, pos) : length)}</span>
          </div>
        </div>
        <input
          className="srSlider"
          type="range"
          min={0}
          max={Math.max(1, mode === "recording" ? Math.max(length, pos) : length)}
          step={1}
          value={pos}
          disabled={busy || empty}
          aria-label="Position"
          onChange={(e) => seek(Number(e.target.value))}
        />
        <div className="srButtons">
          <button type="button" aria-label="Seek to Start" title="Seek to Start" disabled={busy || empty} onClick={() => seek(0)}>
            <Icon kind="start" />
          </button>
          <button type="button" aria-label="Seek to End" title="Seek to End" disabled={busy || empty} onClick={() => seek(length)}>
            <Icon kind="end" />
          </button>
          <button type="button" aria-label="Play" title="Play" disabled={mode !== "stopped" || empty} onClick={play}>
            <Icon kind="play" />
          </button>
          <button type="button" aria-label="Stop" title="Stop" disabled={mode !== "playing" && mode !== "recording"} onClick={stop}>
            <Icon kind="stop" />
          </button>
          <button type="button" aria-label="Record" title="Record" disabled={mode !== "stopped"} onClick={record}>
            <Icon kind="record" />
          </button>
        </div>
      </div>
      <div className="srStatus" role="status">
        <span>{status}</span>
        {mode === "recording" && <span>Max: 60.00 sec.</span>}
      </div>

      {dialog?.kind === "changed" && (
        <Dialog
          title="Sound Recorder"
          sound="chord"
          okLabel="Yes"
          onOk={() => {
            setDialog(null)
            save()
          }}
          onNo={() => {
            setDialog(null)
            setSavedVersion(versionRef.current)
            const next = afterSave.current
            afterSave.current = null
            next?.()
          }}
          onCancel={() => {
            afterSave.current = null
            setDialog(null)
          }}
        >
          <p className="dialogText">The sound in {name} has changed.</p>
          <p className="dialogText">Do you want to save the changes?</p>
        </Dialog>
      )}

      {dialog?.kind === "saveAs" && (
        <FileDialog
          mode="save"
          startDir={file && onDrive(file) ? file.parent : null}
          initialName={file ? file.name : "Sound"}
          accept={isSound}
          typeLabel="Sounds (*.wav)"
          fileType="sound"
          onPick={writeTo}
          onCancel={() => {
            afterSave.current = null
            setDialog(null)
          }}
        />
      )}

      {(dialog?.kind === "open" || dialog?.kind === "insert" || dialog?.kind === "mix") && (
        <FileDialog
          mode="open"
          startDir={file && onDrive(file) ? file.parent : fs.resolve("C:/My Music")}
          accept={isSound}
          typeLabel="Sounds (*.wav)"
          fileType="sound"
          onPick={(target) => (dialog.kind === "open" ? (setDialog(null), load(target)) : withFile(target, dialog.kind))}
          onCancel={() => setDialog(null)}
        />
      )}

      {(dialog?.kind === "deleteBefore" || dialog?.kind === "deleteAfter") && (
        <Dialog
          title="Sound Recorder"
          okLabel="OK"
          onOk={() => {
            const at = posRef.current
            setDialog(null)
            if (dialog.kind === "deleteBefore") edit((s) => W.deleteBefore(s, at), 0)
            else edit((s) => W.deleteAfter(s, at), at)
          }}
          onCancel={() => setDialog(null)}
        >
          <p className="dialogText">
            Do you want to delete the sound {dialog.kind === "deleteBefore" ? "before" : "after"} the current position ({W.seconds(pos)})?
          </p>
        </Dialog>
      )}

      {dialog?.kind === "revert" && (
        <Dialog
          title="Sound Recorder"
          okLabel="Yes"
          cancelLabel="No"
          onOk={() => {
            setDialog(null)
            load(file)
          }}
          onCancel={() => setDialog(null)}
        >
          <p className="dialogText">Do you want to undo all of the changes since {name} was last saved?</p>
        </Dialog>
      )}

      {dialog?.kind === "properties" && (
        <Dialog title={`Properties for ${name}`} onOk={() => setDialog(null)}>
          <div className="srProps">
            <span>Length:</span>
            <span>{W.seconds(length)}</span>
            <span>Data size:</span>
            <span>{(length * 2).toLocaleString("en-US")} bytes</span>
            <span>Audio format:</span>
            <span>PCM 22,050 Hz, 16 Bit, Mono</span>
          </div>
        </Dialog>
      )}

      {dialog?.kind === "alert" && (
        <Dialog title={dialog.title || "Sound Recorder"} sound="ding" onOk={() => setDialog(null)}>
          <p className="dialogText">{dialog.text}</p>
        </Dialog>
      )}
    </div>
  )
}

export default SoundRecorder
