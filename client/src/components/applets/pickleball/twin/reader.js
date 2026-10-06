// Twin Replay: reading a video on this device. Steps through the video at `fps` frames a
// second (seeking a hidden <video>), draws each frame small (640 px wide), hands it to the pose
// model (in a Worker when the browser allows, else here), samples each person's shirt color,
// and feeds the analyzer; meanwhile the sound is decoded at 12 kHz mono for the paddle pops.
// Pausable, cancellable, with progress and an estimate of the time left.

import { createAnalyzer } from "./core/analyze.js"
import { torsoColor } from "./core/tracker.js"
import { createLandmarker, MODEL_MB } from "./poseModel.js"

export const READ_FPS = 15
export const READ_WIDTH = 640
export const AUDIO_RATE = 12000
export const MAX_READ_SECONDS = 45 * 60

// a <video> for a blob, loaded far enough to seek
export const openVideo = (blob) =>
  new Promise((resolve, reject) => {
    const v = document.createElement("video")
    v.muted = true
    v.playsInline = true
    v.setAttribute("playsinline", "")
    v.preload = "auto"
    v.crossOrigin = "anonymous"
    const url = URL.createObjectURL(blob)
    const done = () => {
      v.removeEventListener("loadeddata", done)
      resolve({ video: v, url, close: () => (v.removeAttribute("src"), v.load(), URL.revokeObjectURL(url)) })
    }
    v.addEventListener("loadeddata", done)
    v.addEventListener("error", () => reject(new Error("This video can't be opened in this browser.")), { once: true })
    v.src = url
  })

export const seekTo = (video, t) =>
  new Promise((resolve) => {
    if (Math.abs(video.currentTime - t) < 1e-4 && video.readyState >= 2) return resolve()
    let done = false
    const finish = () => {
      if (done) return
      done = true
      video.removeEventListener("seeked", finish)
      clearTimeout(timer)
      // (the decoded picture is ready one frame after "seeked" on some browsers)
      if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(() => resolve())
      else resolve()
    }
    const timer = setTimeout(finish, 2500)
    video.addEventListener("seeked", finish)
    video.currentTime = t
  })

// the sound as 12 kHz mono (decodeAudioData resamples to the context's rate). null if the
// video has no sound or the browser can't decode it.
export const decodeSound = async (blob, rate = AUDIO_RATE) => {
  try {
    const buf = await blob.arrayBuffer()
    const Offline = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext
    if (!Offline) return null
    const ctx = new Offline(1, rate, rate)
    const audio = await new Promise((resolve, reject) => {
      const p = ctx.decodeAudioData(buf, resolve, reject)
      if (p && p.then) p.then(resolve, reject)
    })
    const n = audio.length
    const mono = new Float32Array(n)
    for (let c = 0; c < audio.numberOfChannels; c++) {
      const d = audio.getChannelData(c)
      for (let i = 0; i < n; i++) mono[i] += d[i] / audio.numberOfChannels
    }
    return { samples: mono, rate: audio.sampleRate }
  } catch {
    return null
  }
}

// The pose model: a Worker when it starts within a while, else on this thread
export const startPose = async ({ model = "lite", players = 4, onStatus } = {}) => {
  onStatus?.(`Getting the pose model ready (${MODEL_MB[model] || 6} MB the first time)...`)
  try {
    const worker = new Worker(new URL("./poseWorker.js", import.meta.url), { type: "module" })
    const pending = new Map()
    let nextId = 1
    const ready = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 45000)
      worker.onmessage = (e) => {
        const d = e.data
        if (d.type === "ready") {
          clearTimeout(timer)
          resolve(d)
        } else if (d.type === "error" && !d.id) {
          clearTimeout(timer)
          resolve(null)
        } else if (d.id && pending.has(d.id)) {
          const p = pending.get(d.id)
          pending.delete(d.id)
          if (d.type === "people") p.resolve(d.people)
          else p.resolve([])
        }
      }
      worker.onerror = () => {
        clearTimeout(timer)
        resolve(null)
      }
      worker.postMessage({ type: "init", model, players })
    })
    if (ready) {
      return {
        where: "worker",
        delegate: ready.delegate,
        detect: (bitmap, ms, w, h) =>
          new Promise((resolve) => {
            const id = nextId++
            pending.set(id, { resolve })
            worker.postMessage({ type: "frame", id, bitmap, ms, w, h }, [bitmap])
          }),
        close: () => worker.terminate(),
      }
    }
    worker.terminate()
  } catch {
    // (no module workers here: the main thread)
  }
  const lm = await createLandmarker({ model, players })
  return { where: "page", delegate: lm.delegate, detect: async (bitmap, ms, w, h) => {
    const r = lm.detect(bitmap, ms, w, h)
    bitmap.close?.()
    return r
  }, close: () => lm.close() }
}

// Reads a whole video. taps: the calibration in 0..1 video coordinates ({ id, u, v }).
// control: { paused, cancelled } (the caller flips them). Returns the analysis (finish()).
export const readGame = async (blob, { taps, players = 4, fps = READ_FPS, width = READ_WIDTH, model = "lite", control = {}, onProgress, onFrame, onStatus, names, hands, from = 0, to = null } = {}) => {
  const { video, close } = await openVideo(blob)
  const sound = decodeSound(blob)
  let pose = null
  try {
    const W = width
    const H = Math.round((width * video.videoHeight) / Math.max(1, video.videoWidth))
    const canvas = document.createElement("canvas")
    canvas.width = W
    canvas.height = H
    const g = canvas.getContext("2d", { willReadFrequently: true })
    const analyzer = createAnalyzer({ taps: taps.map((t) => ({ id: t.id, x: t.u * W, y: t.v * H })), players })
    pose = await startPose({ model, players, onStatus })
    onStatus?.(pose.delegate === "GPU" ? "Reading the video (graphics chip)..." : "Reading the video...")
    const end = Math.min(to ?? video.duration, video.duration, from + MAX_READ_SECONDS)
    const total = Math.max(0, end - from)
    const started = performance.now()
    let n = 0
    for (let t = from; t <= end; t += 1 / fps) {
      if (control.cancelled) throw new Error("cancelled")
      while (control.paused && !control.cancelled) await new Promise((r) => setTimeout(r, 200))
      await seekTo(video, t)
      g.drawImage(video, 0, 0, W, H)
      const img = g.getImageData(0, 0, W, H)
      const sample = (x, y) => {
        const xi = Math.round(x)
        const yi = Math.round(y)
        if (xi < 0 || yi < 0 || xi >= W || yi >= H) return null
        const k = (yi * W + xi) * 4
        return [img.data[k], img.data[k + 1], img.data[k + 2]]
      }
      const bitmap = await createImageBitmap(canvas)
      const people = await pose.detect(bitmap, t * 1000, W, H)
      for (const p of people) p.color = torsoColor(p.lm, sample)
      analyzer.push(t, people)
      n++
      onFrame?.({ t, people, tracks: analyzer.tracks(), W, H })
      if (n % 3 === 0) {
        const done = (t - from) / Math.max(1e-6, total)
        const spent = (performance.now() - started) / 1000
        onProgress?.({ done, eta: done > 0.01 ? (spent / done) * (1 - done) : null, framesPerSecond: n / Math.max(0.001, spent), where: pose.where, delegate: pose.delegate })
      }
    }
    onStatus?.("Listening for the paddle...")
    const audio = await sound
    const result = analyzer.finish({ audio, names, hands })
    result.readStats = { frames: n, seconds: (performance.now() - started) / 1000, fps, width: W, where: pose.where, delegate: pose.delegate, sound: !!audio }
    return result
  } finally {
    pose?.close()
    close()
  }
}

// a small picture of a video moment (the list's thumbnail, the calibration's frame)
export const grabFrame = async (blob, t = 1, width = 640) => {
  const { video, close } = await openVideo(blob)
  try {
    await seekTo(video, Math.min(t, Math.max(0, video.duration - 0.1)))
    const c = document.createElement("canvas")
    c.width = width
    c.height = Math.round((width * video.videoHeight) / Math.max(1, video.videoWidth))
    c.getContext("2d").drawImage(video, 0, 0, c.width, c.height)
    return { canvas: c, duration: video.duration, vw: video.videoWidth, vh: video.videoHeight }
  } finally {
    close()
  }
}
