import React, { useEffect, useRef, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import KeepSafe from "../../shared/KeepSafe"
import Dialog from "../../shared/Dialog"
import MoreOptions from "../../shared/MoreOptions"
import { summarize } from "../../../utils/disclosure"
import { useFsVersion } from "../../../hooks/useFs"
import { launch, photosWindow } from "../../../utils/programs"
import { downloadBlob } from "../../../utils/fileTransfer"
import { isKeyForWindow } from "../../../utils/windowKeys"
import { unlock } from "../../../utils/achievements"
import { EFFECTS, applyEffect, effectLabel } from "./effects"
import { FRAMES, drawFrame, frameLabel } from "./frames"
import * as sounds from "./sounds"
import { BURST_COUNT, MAX_CLIP_SECONDS, MODES, STRIP_COUNT, TIMERS, cameraProblem, clipExtension, clockText, isAppleMobile, nextTimer, pickClipType } from "./support"
import { fitScale, loadImage, nextPhotoName, photoLimits, picturesFolder, savePicture, stripLayout, toJpeg } from "../photos/library"
import { useDriveUsage } from "../../../hooks/useFs"
import { fs, previewOf } from "../../../utils/fs"
import { formatBytes } from "../../../utils/fileInfo"
import { itemPayload, shareOut } from "../../../utils/share"
import "./Camera.css"
import { helpItem } from "../../../utils/help"

// Camera: a live picture from the webcam or the phone's front or back camera, with retro
// effects and frames drawn on a canvas. Takes photos (with a 3 or 10 second timer), bursts
// of five, four-shot photo strips like a photo booth, and short video clips (where the
// browser can record them). Photos are JPEGs in C:\My Pictures; clips are too big for the
// drive, so they go straight to the real device.

const PREFS_KEY = "98ish.camera"
const DEFAULTS = { effect: "none", frame: "none", timer: 0, mode: "photo", facing: "user", mirror: true, sound: true, clipSound: true }
const loadPrefs = () => {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(PREFS_KEY)) }
  } catch {
    return { ...DEFAULTS }
  }
}
const savePrefs = (prefs) => {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // remembered for this visit only
  }
}

const PREVIEW_PLAIN = 960 // the live picture's longest side with no effect
const PREVIEW_EFFECT = 480 // ...and with one (every pixel is worked on, 30 times a second)
const STRIP_SHOT = { w: 480, h: 360 }

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const iphone = typeof navigator !== "undefined" && isAppleMobile(navigator.userAgent, navigator.maxTouchPoints)

// Draw a picture (video, img) into a w x h area, cropped to fill it, flipped if `mirror`
const drawCover = (ctx, source, w, h, mirror) => {
  const sw = source.videoWidth || source.naturalWidth || source.width
  const sh = source.videoHeight || source.naturalHeight || source.height
  const scale = Math.max(w / sw, h / sh)
  const cw = w / scale
  const ch = h / scale
  ctx.save()
  if (mirror) {
    ctx.translate(w, 0)
    ctx.scale(-1, 1)
  }
  ctx.drawImage(source, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, w, h)
  ctx.restore()
}

const ShutterIcon = () => (
  <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true">
    <path d="M4 10h6l2-3h8l2 3h6v15H4z" fill="#d8d8d8" stroke="#000" strokeWidth="1.5" strokeLinejoin="round" />
    <circle cx="16" cy="17" r="5.5" fill="#2a3d6e" stroke="#000" strokeWidth="1.5" />
    <circle cx="14.5" cy="15.5" r="1.6" fill="#9fc3ff" />
    <rect x="23" y="12" width="3" height="2" fill="#ffcc00" />
  </svg>
)

const SwitchIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
    <path d="M3 8h4l1.5-2h7L17 8h4v11H3z" fill="#e0e0e0" stroke="#000" strokeWidth="1.3" strokeLinejoin="round" />
    <path d="M8.5 13a3.5 3.5 0 0 1 6-2.4M15.5 13a3.5 3.5 0 0 1-6 2.4" fill="none" stroke="#000080" strokeWidth="1.5" />
    <path d="M14.8 8.8v2.2h-2.2M9.2 17.2V15h2.2" fill="none" stroke="#000080" strokeWidth="1.5" />
  </svg>
)

const TimerIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
    <circle cx="12" cy="13" r="8" fill="#fff" stroke="#000" strokeWidth="1.4" />
    <path d="M12 13V8.5M12 13l3 2" stroke="#000" strokeWidth="1.5" />
    <path d="M9.5 3h5M12 3v2" stroke="#000" strokeWidth="1.5" />
  </svg>
)

const EffectsIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
    <path d="M4 20L15 9" stroke="#000" strokeWidth="2.2" strokeLinecap="round" />
    <path d="M15 9l2-2" stroke="#ffcc00" strokeWidth="2.2" strokeLinecap="round" />
    <path d="M17 2l.8 2.2L20 5l-2.2.8L17 8l-.8-2.2L14 5l2.2-.8zM20.5 10l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5z" fill="#ff4fb0" />
  </svg>
)

const Camera = ({ mobile, dispatch, onTitle, paused = false }) => {
  useFsVersion()
  const [prefs, setPrefsState] = useState(loadPrefs)
  const setPrefs = (patch) =>
    setPrefsState((p) => {
      const next = { ...p, ...patch }
      savePrefs(next)
      return next
    })
  const [camera, setCamera] = useState({ state: "starting", problem: null }) // starting | live | error
  const [attempt, setAttempt] = useState(0)
  const [showing, setShowing] = useState(false) // a real frame has been drawn (cameras start with tiny blank ones)
  const [cameras, setCameras] = useState(0)
  const [busy, setBusy] = useState(null) // null | "countdown" | "shooting" | "recording" | "saving"
  const [count, setCount] = useState(null) // the countdown number showing
  const [flash, setFlash] = useState(0)
  const [badge, setBadge] = useState(null) // "Shot 2 of 4", "REC 0:04"
  const [last, setLast] = useState(null) // the last photo saved (a drive file)
  const usage = useDriveUsage() // free space on drive C:, shown in the status bar
  const [status, setStatus] = useState("Starting the camera...")
  const [clip, setClip] = useState(null) // { url, blob, mime, seconds } after recording
  const [panel, setPanel] = useState(!mobile) // the effects and frames list
  const [dialog, setDialog] = useState(null)

  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const recRef = useRef(null)
  const cancelRef = useRef({ cancelled: false })
  const fileRef = useRef(null)
  const live = useRef({})
  live.current = { prefs, busy, paused }
  const mirrored = () => live.current.prefs.facing === "user" && live.current.prefs.mirror
  const frameNo = useRef(0)
  const restarts = useRef(0)

  useEffect(() => {
    sounds.setCameraSounds(prefs.sound)
  }, [prefs.sound])
  useEffect(() => {
    onTitle?.(`Camera - ${MODES.find((m) => m.id === prefs.mode)?.label || "Photo"}`)
  }, [prefs.mode])

  // ---- the camera stream ----

  const stopStream = () => {
    for (const track of streamRef.current?.getTracks() || []) track.stop()
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }

  useEffect(() => {
    let gone = false
    const env = { secure: typeof window === "undefined" || window.isSecureContext !== false, hasMedia: !!navigator.mediaDevices?.getUserMedia, iphone }
    if (!env.secure || !env.hasMedia) {
      setCamera({ state: "error", problem: cameraProblem(env) })
      setStatus("No camera")
      return
    }
    setCamera({ state: "starting", problem: null })
    setStatus("Starting the camera...")
    const start = async () => {
      const video = { facingMode: { ideal: prefs.facing }, width: { ideal: 1920 }, height: { ideal: 1440 } }
      let stream
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video, audio: false })
      } catch (error) {
        // a camera that can't do what was asked: take whatever it can do. One that's still
        // being let go of (another app, the last window) often works a moment later.
        const retry = (e) => ["OverconstrainedError", "NotFoundError", "NotReadableError", "AbortError", "TrackStartError"].includes(e?.name)
        if (!retry(error)) throw error
        // a few tries, a little longer apart each time
        for (let tries = 0; ; tries++) {
          if (error.name !== "OverconstrainedError") await sleep(800 * (tries + 1))
          if (gone) return
          try {
            stream = await navigator.mediaDevices.getUserMedia({ video: tries ? true : { facingMode: { ideal: prefs.facing } }, audio: false })
            break
          } catch (again) {
            if (!retry(again) || tries >= 2) throw again
            error = again
          }
        }
      }
      if (gone) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      stopStream()
      streamRef.current = stream
      const el = videoRef.current
      el.srcObject = stream
      el.muted = true
      el.setAttribute("playsinline", "")
      await el.play().catch(() => {})
      if (gone) return
      setCamera({ state: "live", problem: null })
      const settings = stream.getVideoTracks()[0]?.getSettings?.() || {}
      setStatus(`Ready${settings.width ? ` (${settings.width} x ${settings.height})` : ""}`)
      navigator.mediaDevices
        .enumerateDevices?.()
        .then((list) => !gone && setCameras(list.filter((d) => d.kind === "videoinput").length))
        .catch(() => {})
      // the camera ending by itself (unplugged, the phone took it back for a moment, the
      // microphone starting on some phones): start it again, a few times, then ask
      const ended = () => {
        if (gone || streamRef.current !== stream || recRef.current) return
        if (restarts.current < 3) {
          restarts.current++
          setAttempt((n) => n + 1)
        } else setCamera({ state: "error", problem: { title: "The camera stopped", text: "The camera was turned off or taken by another app. Click Try Again.", retry: true } })
      }
      const track = stream.getVideoTracks()[0]
      track?.addEventListener("ended", ended)
      if (track?.readyState === "ended") return ended() // it ended before we were listening
      // a camera that has run a while has earned its restarts back
      setTimeout(() => !gone && streamRef.current === stream && (restarts.current = 0), 10000)
    }
    start().catch((error) => {
      if (gone) return
      setCamera({ state: "error", problem: cameraProblem(env, error) })
      setStatus("No camera")
    })
    return () => {
      gone = true
      stopStream()
    }
  }, [prefs.facing, attempt])

  // back from the background with the camera gone (iPhones stop it): start it again
  useEffect(() => {
    const back = () => {
      if (document.visibilityState !== "visible") return
      const track = streamRef.current?.getVideoTracks()[0]
      if (track && track.readyState === "ended") setAttempt((n) => n + 1)
    }
    document.addEventListener("visibilitychange", back)
    return () => document.removeEventListener("visibilitychange", back)
  }, [])

  // everything stops when the window closes
  useEffect(
    () => () => {
      cancelRef.current.cancelled = true
      try {
        recRef.current?.recorder?.state === "recording" && recRef.current.recorder.stop()
      } catch {
        // already stopped
      }
      recRef.current?.mic?.getTracks().forEach((t) => t.stop())
    },
    []
  )
  useEffect(() => () => clip && URL.revokeObjectURL(clip.url), [clip])

  // ---- the live picture ----

  useEffect(() => {
    if (camera.state !== "live") return
    let raf = 0
    let seen = false
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const video = videoRef.current
      const canvas = canvasRef.current
      if (!video || !canvas || video.readyState < 2 || video.videoWidth < 16 || video.videoHeight < 16) return
      // hidden behind another window (a phone shows one at a time) or minimized: no work
      if (live.current.paused && seen) return
      if (!seen) {
        seen = true
        setShowing(true)
      }
      const { effect, frame } = live.current.prefs
      const max = effect === "none" ? PREVIEW_PLAIN : PREVIEW_EFFECT
      const s = fitScale(video.videoWidth, video.videoHeight, max)
      const w = Math.round(video.videoWidth * s)
      const h = Math.round(video.videoHeight * s)
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      const ctx = canvas.getContext("2d", { willReadFrequently: true })
      drawCover(ctx, video, w, h, mirrored())
      frameNo.current++
      if (effect !== "none") {
        const img = ctx.getImageData(0, 0, w, h)
        applyEffect(effect, img, { scale: w / 480, t: frameNo.current })
        ctx.putImageData(img, 0, 0)
      }
      drawFrame(ctx, frame, w, h)
    }
    draw()
    return () => {
      cancelAnimationFrame(raf)
      setShowing(false)
    }
  }, [camera.state])

  // ---- taking pictures ----

  // A finished picture from a source (the video, or a picture from the device) at full
  // size, with the effect and (optionally) the frame
  const render = (source, { w, h, frame = true, mirror = false } = {}) => {
    const sw = source.videoWidth || source.naturalWidth || source.width
    const sh = source.videoHeight || source.naturalHeight || source.height
    if (!w) {
      const s = fitScale(sw, sh, photoLimits().maxSide)
      w = Math.max(1, Math.round(sw * s))
      h = Math.max(1, Math.round(sh * s))
    }
    const canvas = document.createElement("canvas")
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext("2d", { willReadFrequently: true })
    drawCover(ctx, source, w, h, mirror)
    const { effect, frame: frameId } = live.current.prefs
    if (effect !== "none") {
      const img = ctx.getImageData(0, 0, w, h)
      applyEffect(effect, img, { scale: w / 480, t: frameNo.current })
      ctx.putImageData(img, 0, 0)
    }
    if (frame) drawFrame(ctx, frameId, w, h)
    return canvas
  }

  const snap = () => {
    sounds.shutter()
    setFlash((n) => n + 1)
    return render(videoRef.current, { mirror: mirrored() })
  }

  const save = async (canvas, prefix = "PHOTO") => {
    const dir = picturesFolder()
    const { data } = toJpeg(canvas)
    const result = await savePicture(
      dir,
      nextPhotoName(
        dir.content.map((i) => i.name),
        prefix
      ),
      data
    )
    if (!result.ok) {
      setDialog({ title: "Camera", text: result.error })
      return null
    }
    setLast(result.file)
    setFresh(result.file)
    return result.file
  }

  // after a shot, a Share button sits on the picture for a few seconds
  const [fresh, setFresh] = useState(null)
  useEffect(() => {
    if (!fresh) return
    const id = setTimeout(() => setFresh(null), 12000)
    return () => clearTimeout(id)
  }, [fresh])
  const shareLast = (mode) => last?.parent && shareOut(itemPayload(last), mode, { title: "Camera" })
  // Photos picks the shared album and sends it (a clip goes as it is: it never touches drive C:)
  const albumLast = () => last?.parent && dispatch?.({ type: "open_window", payload: launch("Photos", { handoff: { id: Date.now(), addToAlbum: [{ file: last }] } }) })
  // Snap to 3D: the last photo -> 3D Viewer 98 (it asks before the photo goes to Hugging Face)
  const make3dLast = () => last?.parent && dispatch?.({ type: "open_window", payload: launch("3D Viewer 98", { handoff: { id: Date.now(), photo: fs.partsOf(last).join("/") } }) })
  const albumClip = () => clip && dispatch?.({ type: "open_window", payload: launch("Photos", { handoff: { id: Date.now(), addToAlbum: [{ blob: clip.blob, name: `Clip${clipExtension(clip.mime)}` }] } }) })

  const countdown = async (seconds) => {
    for (let n = seconds; n > 0; n--) {
      if (cancelRef.current.cancelled) return false
      setCount(n)
      sounds.beep(n === 1)
      await sleep(1000)
    }
    setCount(null)
    return !cancelRef.current.cancelled
  }

  const takePhoto = async () => {
    setBusy("countdown")
    try {
      if (prefs.timer && !(await countdown(prefs.timer))) return
      setBusy("saving")
      const file = await save(snap())
      if (file) setStatus(`Saved ${file.name} in C:\\My Pictures`)
    } finally {
      setCount(null)
      setBusy(null)
    }
  }

  const takeBurst = async () => {
    setBusy("countdown")
    try {
      if (prefs.timer && !(await countdown(prefs.timer))) return
      setBusy("shooting")
      const shots = []
      for (let i = 0; i < BURST_COUNT; i++) {
        if (cancelRef.current.cancelled) return
        setBadge(`Burst ${i + 1} of ${BURST_COUNT}`)
        shots.push(snap())
        await sleep(220)
      }
      setBusy("saving")
      setBadge("Saving...")
      await sleep(20)
      let saved = 0
      for (const shot of shots) if (await save(shot, "BURST")) saved++
      setStatus(`Saved ${saved} burst photo${saved === 1 ? "" : "s"} in C:\\My Pictures`)
    } finally {
      setBadge(null)
      setCount(null)
      setBusy(null)
    }
  }

  const takeStrip = async () => {
    setBusy("countdown")
    try {
      const shots = []
      for (let i = 0; i < STRIP_COUNT; i++) {
        setBadge(`Shot ${i + 1} of ${STRIP_COUNT}`)
        if (!(await countdown(3))) return
        sounds.shutter()
        setFlash((n) => n + 1)
        shots.push(render(videoRef.current, { w: STRIP_SHOT.w, h: STRIP_SHOT.h, frame: false, mirror: mirrored() }))
        await sleep(500)
      }
      setBusy("saving")
      setBadge("Developing...")
      const layout = stripLayout(STRIP_SHOT.w, STRIP_SHOT.h, STRIP_COUNT)
      const strip = document.createElement("canvas")
      strip.width = layout.width
      strip.height = layout.height
      const ctx = strip.getContext("2d")
      ctx.fillStyle = "#fffdf6"
      ctx.fillRect(0, 0, strip.width, strip.height)
      layout.slots.forEach((slot, i) => {
        ctx.drawImage(shots[i], slot.x, slot.y, slot.w, slot.h)
        ctx.strokeStyle = "rgba(0,0,0,0.25)"
        ctx.strokeRect(slot.x + 0.5, slot.y + 0.5, slot.w - 1, slot.h - 1)
      })
      const date = new Date()
      ctx.fillStyle = "#000080"
      ctx.textAlign = "center"
      ctx.textBaseline = "middle"
      ctx.font = `bold ${Math.round(layout.caption.h * 0.3)}px "Comic Sans MS", "Arial Black", sans-serif`
      ctx.fillText("98ish PHOTO BOOTH", layout.width / 2, layout.caption.y + layout.caption.h * 0.36)
      ctx.fillStyle = "#e0457b"
      ctx.font = `${Math.round(layout.caption.h * 0.2)}px "Courier New", monospace`
      ctx.fillText(`♥ ${date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} ♥`, layout.width / 2, layout.caption.y + layout.caption.h * 0.72)
      const file = await save(strip, "STRIP")
      if (file) unlock("photo-strip")
      if (file) setStatus(`Saved the photo strip ${file.name} in C:\\My Pictures`)
    } finally {
      setBadge(null)
      setCount(null)
      setBusy(null)
    }
  }

  // ---- video clips ----

  const canRecord = typeof window !== "undefined" && typeof window.MediaRecorder !== "undefined"

  const startClip = async () => {
    if (!canRecord) return setDialog({ title: "Video", text: "This browser can't record video. You can still take photos." })
    setBusy("recording")
    try {
      if (prefs.timer && !(await countdown(prefs.timer))) return setBusy(null)
      // the picture with its effects (where the canvas can be recorded), else the camera itself
      const canvasStream = !iphone && canvasRef.current?.captureStream ? canvasRef.current.captureStream(30) : null
      const videoTracks = canvasStream ? canvasStream.getVideoTracks() : streamRef.current?.getVideoTracks() || []
      let mic = null
      if (prefs.clipSound) mic = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null)
      const stream = new MediaStream([...videoTracks, ...(mic ? mic.getAudioTracks() : [])])
      const mime = pickClipType(window.MediaRecorder.isTypeSupported?.bind(window.MediaRecorder))
      let recorder
      try {
        recorder = new window.MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 2_000_000 } : undefined)
      } catch {
        recorder = new window.MediaRecorder(stream)
      }
      const chunks = []
      const started = Date.now()
      recorder.ondataavailable = (e) => e.data?.size && chunks.push(e.data)
      recorder.onstop = () => {
        mic?.getTracks().forEach((t) => t.stop())
        canvasStream?.getTracks().forEach((t) => t.stop())
        clearInterval(recRef.current?.tick)
        recRef.current = null
        setBadge(null)
        setBusy(null)
        if (cancelRef.current.cancelled) return
        const type = recorder.mimeType || mime || "video/webm"
        const blob = new Blob(chunks, { type })
        if (!blob.size) return setDialog({ title: "Video", text: "Nothing was recorded. This browser may not be able to record the camera." })
        setClip({ url: URL.createObjectURL(blob), blob, mime: type, seconds: (Date.now() - started) / 1000 })
        setStatus("Clip recorded. Save it to your device, or discard it.")
      }
      recorder.start(250)
      sounds.recordStart()
      const tick = setInterval(() => {
        const seconds = (Date.now() - started) / 1000
        setBadge(`● REC ${clockText(seconds)} / ${clockText(MAX_CLIP_SECONDS)}`)
        if (seconds >= MAX_CLIP_SECONDS) stopClip()
      }, 250)
      recRef.current = { recorder, mic, tick }
      setBadge(`● REC 0:00 / ${clockText(MAX_CLIP_SECONDS)}`)
    } catch (error) {
      setBusy(null)
      setBadge(null)
      setDialog({ title: "Video", text: `The clip couldn't be recorded${error?.message ? ` (${error.message})` : ""}.` })
    }
  }

  const stopClip = () => {
    const rec = recRef.current
    if (!rec || rec.recorder.state !== "recording") return
    clearInterval(rec.tick)
    sounds.recordStop()
    rec.recorder.stop()
  }

  const saveClip = () => {
    if (!clip) return
    // clips are numbered on this device (they never touch the drive)
    let n = 1
    try {
      n = (Number(localStorage.getItem("98ish.camera.clips")) || 0) + 1
      localStorage.setItem("98ish.camera.clips", String(n))
    } catch {
      // storage blocked: CLIP001 again is fine
    }
    const name = `CLIP${String(n).padStart(3, "0")}${clipExtension(clip.mime)}`
    downloadBlob(clip.blob, name, clip.mime)
    setStatus(`${name} was sent to your device's downloads.`)
    setClip(null)
  }

  // ---- the shutter button ----

  const ready = camera.state === "live" && showing && !busy && !clip
  const shoot = () => {
    if (busy === "recording") return stopClip()
    if (busy === "countdown" && prefs.mode !== "strip") {
      // a second press cancels the timer
      cancelRef.current.cancelled = true
      setTimeout(() => (cancelRef.current = { cancelled: false }), 0)
      return
    }
    if (!ready) return
    cancelRef.current = { cancelled: false }
    if (prefs.mode === "burst") takeBurst()
    else if (prefs.mode === "strip") takeStrip()
    else if (prefs.mode === "video") startClip()
    else takePhoto()
  }

  // a picture from the device's own camera app or library (when there's no live camera)
  const fromDevice = async (file) => {
    if (!file) return
    setBusy("saving")
    const url = URL.createObjectURL(file)
    try {
      const img = await loadImage(url)
      const saved = await save(render(img))
      if (saved) setStatus(`Saved ${saved.name} in C:\\My Pictures`)
    } catch {
      setDialog({ title: "Camera", text: `${file.name} couldn't be opened as a picture.${/\.hei[cf]$/i.test(file.name) ? " It's a HEIC photo, which this browser can't read." : ""}` })
    } finally {
      URL.revokeObjectURL(url)
      setBusy(null)
    }
  }

  const switchCamera = () => setPrefs({ facing: prefs.facing === "user" ? "environment" : "user" })
  const openPhotos = (file = last) => dispatch?.({ type: "open_window", payload: photosWindow(file && file.parent ? file : null, file ? null : ["C:", "My Pictures"]) })

  // Space or Enter takes the picture whenever this window is the one in use (the shutter
  // turns disabled while it works, which drops the focus to the page)
  const rootRef = useRef(null)
  const keyRef = useRef(null)
  keyRef.current = (e) => {
    if (e.defaultPrevented || e.repeat || !isKeyForWindow(rootRef.current, e)) return
    if (e.target.closest?.("input, select, textarea, .menuBar, .dialog")) return
    if (e.target.closest?.("button")) return // a focused button presses itself
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault()
      shoot()
    }
  }
  useEffect(() => {
    const onKey = (e) => keyRef.current(e)
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [])

  const menus = [
    {
      label: "File",
      items: [
        { label: "Open My Pictures", onClick: () => openPhotos(null) },
        { label: "Open Last Photo", disabled: !last?.parent, onClick: () => openPhotos(last) },
        {
          label: "Send Last Photo To",
          disabled: !last?.parent,
          items: [
            { label: "My Phone", onClick: () => shareLast("phone") },
            { label: "Other Apps...", onClick: () => shareLast("apps") },
            { label: "Shared Album...", onClick: albumLast },
          ],
        },
        { label: "Make 3D from Last Photo...", disabled: !last?.parent, onClick: make3dLast },
        "-",
        { label: "Picture from Your Device...", onClick: () => fileRef.current?.click() },
      ],
    },
    {
      label: "Mode",
      items: MODES.map((m) => ({ label: m.label, checked: prefs.mode === m.id, disabled: !!busy || (m.id === "video" && !canRecord), onClick: () => setPrefs({ mode: m.id }) })),
    },
    { label: "Effects", items: EFFECTS.map((e) => ({ label: e.label, checked: prefs.effect === e.id, onClick: () => setPrefs({ effect: e.id }) })) },
    { label: "Frames", items: FRAMES.map((f) => ({ label: f.label, checked: prefs.frame === f.id, onClick: () => setPrefs({ frame: f.id }) })) },
    {
      label: "Options",
      items: [
        ...TIMERS.map((t) => ({ label: t ? `Timer: ${t} Seconds` : "Timer: Off", checked: prefs.timer === t, onClick: () => setPrefs({ timer: t }) })),
        "-",
        { label: "Switch Camera", disabled: !!busy, onClick: switchCamera },
        { label: "Mirror Front Camera", checked: prefs.mirror, onClick: () => setPrefs({ mirror: !prefs.mirror }) },
        { label: "Shutter Sound", checked: prefs.sound, onClick: () => setPrefs({ sound: !prefs.sound }) },
        { label: "Record Sound in Clips", checked: prefs.clipSound, onClick: () => setPrefs({ clipSound: !prefs.clipSound }) },
        "-",
        { label: "Show Effects Panel", checked: panel, onClick: () => setPanel(!panel) },
      ],
    },
    { label: "Help", items: [helpItem({ program: "Camera" }), "-", { label: "About Camera", onClick: () => setDialog({ title: "About Camera", text: "98ish Camera. Photos are saved as JPEGs in C:\\My Pictures, where Photos can show, edit and share them. Video clips go straight to your device: they're too big for drive C:." }) }] },
  ]

  const shutterLabel = busy === "recording" ? "Stop" : busy === "countdown" && prefs.mode !== "strip" ? "Cancel" : prefs.mode === "video" ? "Record" : prefs.mode === "strip" ? "Start Strip" : prefs.mode === "burst" ? "Burst" : "Take Photo"

  return (
    <div ref={rootRef} className={`camRoot${mobile ? " camRoot--mobile" : ""}`} tabIndex={-1}>
      <MenuBar menus={menus} />
      <div className="camMain">
        <div className="camViewer" data-state={camera.state}>
          <video ref={videoRef} className="camVideo" playsInline muted autoPlay aria-hidden="true" />
          <canvas ref={canvasRef} className="camCanvas" aria-label="Camera preview" />
          {camera.state === "starting" && <div className="camNote">Starting the camera...</div>}
          {camera.state === "error" && camera.problem && (
            <div className="camProblem window" role="alert">
              <div className="title-bar">
                <div className="title-bar-text">Camera</div>
              </div>
              <div className="window-body">
                <p className="camProblemTitle">{camera.problem.title}</p>
                <p>{camera.problem.text}</p>
                <div className="camProblemButtons">
                  {camera.problem.retry && (
                    <button type="button" onClick={() => ((restarts.current = 0), setAttempt((n) => n + 1))}>
                      Try Again
                    </button>
                  )}
                  <button type="button" onClick={() => fileRef.current?.click()}>
                    {mobile ? "Use Phone Camera..." : "Picture from Device..."}
                  </button>
                </div>
              </div>
            </div>
          )}
          {count !== null && (
            <div className="camCount" key={count} aria-live="assertive">
              {count}
            </div>
          )}
          {badge && <div className={`camBadge${busy === "recording" ? " is-rec" : ""}`}>{badge}</div>}
          {flash > 0 && <div className="camFlash" key={flash} />}
          {fresh && fresh === last && fresh.parent && !busy && (
            <button type="button" className="camShareLast" onClick={() => (shareLast("phone"), setFresh(null))} title={`Send ${fresh.name} to your phone or another app`}>
              Share {fresh.name}...
            </button>
          )}
          {clip && (
            <div className="camClip window">
              <div className="title-bar">
                <div className="title-bar-text">Video Clip ({clockText(clip.seconds)})</div>
              </div>
              <div className="window-body">
                <video src={clip.url} controls playsInline className="camClipVideo" />
                <p className="camClipNote">Clips are too big for drive C:, so they're saved to your device instead.</p>
                <div className="camProblemButtons">
                  <button type="button" onClick={saveClip}>
                    Save to Your Device
                  </button>
                  <button type="button" onClick={albumClip} title="Up to a minute and 12 MB">
                    Add to Shared Album...
                  </button>
                  <button type="button" onClick={() => setClip(null)}>
                    Discard
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
        {panel && (
          <div className="camPanel" aria-label="Effects and frames">
            <fieldset className="camGroup">
              <legend>Effects</legend>
              <div className="camChoices">
                {EFFECTS.map((e) => (
                  <button key={e.id} type="button" className={prefs.effect === e.id ? "is-on" : ""} aria-pressed={prefs.effect === e.id} onClick={() => setPrefs({ effect: e.id })}>
                    {e.label}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset className="camGroup">
              <legend>Frames</legend>
              <div className="camChoices">
                {FRAMES.map((f) => (
                  <button key={f.id} type="button" className={prefs.frame === f.id ? "is-on" : ""} aria-pressed={prefs.frame === f.id} onClick={() => setPrefs({ frame: f.id })}>
                    {f.label}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>
        )}
      </div>
      {/* the baseline is the shutter and the flip; modes, the timer and effects wait under
          More options (docs/simplicity.md), with what's chosen in its summary */}
      <MoreOptions
        id="camera.more"
        className="camMore"
        inline
        summary={summarize(MODES.find((m) => m.id === prefs.mode)?.label, `Timer ${prefs.timer ? `${prefs.timer}s` : "off"}`, effectLabel(prefs.effect), prefs.frame !== "none" && frameLabel(prefs.frame))}
      >
        <div className="camModes" role="tablist" aria-label="Mode">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={prefs.mode === m.id}
              className={prefs.mode === m.id ? "is-on" : ""}
              disabled={!!busy || (m.id === "video" && !canRecord)}
              title={m.id === "video" && !canRecord ? "This browser can't record video" : m.label}
              onClick={() => setPrefs({ mode: m.id })}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="camMoreRow">
          <button type="button" className="camSide" onClick={() => setPrefs({ timer: nextTimer(prefs.timer) })} disabled={!!busy || prefs.mode === "strip"} title="Self-timer" aria-label={`Timer: ${prefs.timer ? `${prefs.timer} seconds` : "off"}`}>
            <TimerIcon />
            <span>{prefs.timer ? `${prefs.timer}s` : "Off"}</span>
          </button>
          <button type="button" className={`camSide${panel ? " is-on" : ""}`} onClick={() => setPanel(!panel)} title="Effects and frames" aria-label="Effects and frames" aria-pressed={panel}>
            <EffectsIcon />
            <span>Effects</span>
          </button>
        </div>
      </MoreOptions>
      <div className="camControls">
        <button type="button" className="camThumb" onClick={() => openPhotos(last)} title={last ? `Open ${last.name} in Photos` : "Open My Pictures"} aria-label={last ? `Open ${last.name} in Photos` : "Open My Pictures"}>
          {previewOf(last) ? <img src={previewOf(last)} alt="" /> : <span className="camThumbEmpty" />}
        </button>
        <button
          type="button"
          className={`camShutter${busy === "recording" ? " is-rec" : ""}${prefs.mode === "video" ? " is-video" : ""}`}
          onClick={shoot}
          disabled={!ready && busy !== "recording" && !(busy === "countdown" && prefs.mode !== "strip")}
          aria-label={shutterLabel}
          title={`${shutterLabel} (Space)`}
        >
          <ShutterIcon />
          <span>{shutterLabel}</span>
        </button>
        <button type="button" className="camSide" onClick={switchCamera} disabled={!!busy || (cameras > 0 && cameras < 2 && !mobile)} title="Switch camera" aria-label="Switch camera">
          <SwitchIcon />
          <span>{prefs.facing === "user" ? "Front" : "Back"}</span>
        </button>
      </div>
      {last && <KeepSafe place="camera" className="camKeepSafe" />}
      <div className="status-bar camStatus">
        <p className="status-bar-field">{status}</p>
        <p className="status-bar-field camStatusFx">
          {effectLabel(prefs.effect)}
          {prefs.frame !== "none" ? `, ${frameLabel(prefs.frame)}` : ""}
        </p>
        {usage?.free != null && (
          <p className="status-bar-field camStatusFree" title={`Drive C: ${formatBytes(usage.used)} used, ${formatBytes(usage.free)} free`}>
            {formatBytes(usage.free)} free
          </p>
        )}
      </div>
      <input ref={fileRef} type="file" accept="image/*" capture={mobile ? (prefs.facing === "user" ? "user" : "environment") : undefined} hidden onChange={(e) => (fromDevice(e.target.files?.[0]), (e.target.value = ""))} />
      {dialog && (
        <Dialog title={dialog.title} onOk={() => setDialog(null)} sound="ding">
          <p className="dialogText">{dialog.text}</p>
        </Dialog>
      )}
    </div>
  )
}

export default Camera
