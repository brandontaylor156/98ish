// Twin Replay: reading a video on this device. Steps through the video at `fps` frames a
// second (seeking a hidden <video>), draws each frame small (640 px wide), hands it to the pose
// model (in a Worker when the browser allows, else here), samples each person's shirt color,
// and feeds the analyzer; meanwhile the sound is decoded at 12 kHz mono for the paddle pops.
// Pausable, cancellable, with progress and an estimate of the time left.

import { createAnalyzer } from "./core/analyze.js"
import { footPoint, torsoColor } from "./core/tracker.js"
import { applyH } from "./core/homography.js"
import { courtRegion, fromCrop, mergePeople, playerBox, scanTiles } from "./core/regions.js"
import { createLandmarker, MODEL_MB } from "./poseModel.js"
import { cameraFromHomography } from "./ball/flight.js"
import { createBallFinder, searchRegion } from "./ball/detect.js"
import { analyzeBall } from "./ball/realball.js"

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
    // (in the page but out of sight: some browsers don't decode frames for a detached video)
    // (not opacity 0 or off screen: a browser may then skip presenting its frames)
    v.style.cssText = "position:fixed;left:0;top:0;width:4px;height:4px;opacity:0.02;pointer-events:none;z-index:-1"
    v.setAttribute("aria-hidden", "true")
    document.body.appendChild(v)
    const url = URL.createObjectURL(blob)
    const done = async () => {
      v.removeEventListener("loadeddata", done)
      // (a browser recording, e.g. MediaRecorder WebM, often has no duration in its header:
      // Infinity until the player has been to the end once)
      if (!Number.isFinite(v.duration) || v.duration <= 0) {
        await new Promise((ok) => {
          const fin = () => {
            if (!Number.isFinite(v.duration)) return
            v.removeEventListener("durationchange", fin)
            v.removeEventListener("timeupdate", fin)
            clearTimeout(timer)
            ok()
          }
          const timer = setTimeout(ok, 8000)
          v.addEventListener("durationchange", fin)
          v.addEventListener("timeupdate", fin)
          v.currentTime = 1e7
        })
        await seekTo(v, 0)
      }
      if (!Number.isFinite(v.duration) || v.duration <= 0) return reject(new Error("This video's length can't be read in this browser."))
      resolve({ video: v, url, close: () => (v.pause(), v.removeAttribute("src"), v.load(), v.remove(), URL.revokeObjectURL(url)) })
    }
    v.addEventListener("loadeddata", done)
    v.addEventListener("error", () => (v.remove(), reject(new Error("This video can't be opened in this browser."))), { once: true })
    v.src = url
  })

// Frames at `fps` from `from` to `end`, by playing the video (decoding in order is far faster
// than seeking each frame) and pausing on each wanted frame while it's read; seeking only to
// start or when the browser can't report frames (no requestVideoFrameCallback).
// next() -> the frame's media time once it's on screen (paused), or null at the end
export const frameStepper = (video, fps, from, end) => {
  const step = 1 / fps
  let target = from
  const playing = !!video.requestVideoFrameCallback
  return {
    get mode() {
      return playing ? "play" : "seek"
    },
    async next() {
      if (target > end + 1e-6) return null
      if (!playing) {
        await seekTo(video, target)
        const t = target
        target += step
        return t
      }
      // (the start, or far from the wanted frame: seek there first)
      if (video.currentTime > target + step || target - video.currentTime > 2) await seekTo(video, Math.max(0, target - step / 2))
      const t = await new Promise((resolve) => {
        let done = false
        const finish = (v) => {
          if (done) return
          done = true
          clearTimeout(timer)
          video.pause()
          resolve(v)
        }
        const onFrame = (_now, meta) => {
          if (done) return
          if (meta.mediaTime + 1e-3 >= target) finish(meta.mediaTime)
          else video.requestVideoFrameCallback(onFrame)
        }
        // (the last frames, or a stalled decoder: give up after a while)
        const timer = setTimeout(() => finish(video.ended ? null : video.currentTime), 4000)
        video.addEventListener("ended", () => finish(null), { once: true })
        video.requestVideoFrameCallback(onFrame)
        video.play().catch(() => finish(null))
      })
      if (t === null) return null
      target = Math.max(target + step, t + step * 0.5)
      return t
    },
  }
}

export const seekTo = (video, t) =>
  new Promise((resolve) => {
    if (Math.abs(video.currentTime - t) < 1e-4 && video.readyState >= 2) return resolve()
    let done = false
    const finish = () => {
      if (done) return
      done = true
      video.removeEventListener("seeked", finish)
      clearTimeout(timer)
      // (the decoded picture is ready one frame after "seeked" on some browsers; a paused video
      // may never present one, so don't wait long)
      if (video.requestVideoFrameCallback) {
        let ok = false
        const go = () => {
          if (ok) return
          ok = true
          resolve()
        }
        video.requestVideoFrameCallback(go)
        setTimeout(go, 120)
      } else resolve()
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
export let lastWorkerError = null
export const startPose = async ({ model = "lite", players = 4, gpu = true, specs = [{ key: "near", mode: "VIDEO", poses: players + 4 }], onStatus } = {}) => {
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
          lastWorkerError = d.message
          resolve(null)
        } else if (d.id && pending.has(d.id)) {
          const p = pending.get(d.id)
          pending.delete(d.id)
          if (d.type === "people") p.resolve(d.people)
          else p.resolve([])
        }
      }
      worker.onerror = (e) => {
        clearTimeout(timer)
        lastWorkerError = e?.message || "worker failed to load"
        resolve(null)
      }
      worker.postMessage({ type: "init", model, gpu, specs })
    })
    if (ready) {
      return {
        where: "worker",
        delegate: ready.delegate,
        detect: (bitmap, ms, w, h, key = specs[0].key) =>
          new Promise((resolve) => {
            const id = nextId++
            pending.set(id, { resolve })
            worker.postMessage({ type: "frame", id, key, bitmap, ms, w, h }, [bitmap])
          }),
        close: () => worker.terminate(),
      }
    }
    worker.terminate()
  } catch {
    // (no module workers here: the main thread)
  }
  const lms = new Map()
  for (const s of specs) lms.set(s.key, await createLandmarker({ model, poses: s.poses, mode: s.mode, gpu }))
  return {
    where: "page",
    delegate: lms.get(specs[0].key).delegate,
    detect: async (bitmap, ms, w, h, key = specs[0].key) => {
      const r = lms.get(key).detect(bitmap, ms, w, h)
      bitmap.close?.()
      return r
    },
    close: () => lms.forEach((m) => m.close()),
  }
}

// Reads a whole video. taps: the calibration in 0..1 video coordinates ({ id, u, v }).
// control: { paused, cancelled } (the caller flips them). Returns the analysis (finish()).
export const readGame = async (blob, { taps, players = 4, fps = READ_FPS, width = READ_WIDTH, model = "lite", gpu = true, control = {}, onProgress, onFrame, onStatus, onDebug = null, names, hands, from = 0, to = null, ball = true } = {}) => {
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
    // what the model reads (core/regions.js): players in a fence-cam video are too small for it
    // in the whole picture, so it's shown close crops cut from a sharp copy of the frame: one
    // round each tracked player, and court tiles every few frames (or when someone's missing)
    // to find players
    const Hinv = analyzer.calibration.Hinv
    const court = courtRegion(Hinv, W, H)
    const tiles = scanTiles(court, Hinv, W, H)
    const SW = Math.min(video.videoWidth, 1920)
    const scale = SW / W
    const big = Object.assign(document.createElement("canvas"), { width: SW, height: Math.round(H * scale) })
    const bg = big.getContext("2d")
    const square = (px) => {
      const c = Object.assign(document.createElement("canvas"), { width: px, height: px })
      return { c, g: c.getContext("2d") }
    }
    const roiCut = square(256)
    const scanCut = square(320)
    const specs = [
      { key: "roi", mode: "IMAGE", poses: 1 },
      { key: "scan", mode: "IMAGE", poses: 3 },
    ]
    let inferences = 0
    const read = async (box, cut, key, t) => {
      cut.g.fillStyle = "#000"
      cut.g.fillRect(0, 0, cut.c.width, cut.c.height)
      cut.g.drawImage(big, box.x * scale, box.y * scale, box.w * scale, box.h * scale, 0, 0, cut.c.width, cut.c.height)
      const bmp = await createImageBitmap(cut.c)
      inferences++
      return fromCrop(await pose.detect(bmp, t * 1000, cut.c.width, cut.c.height, key), box, cut.c.width, cut.c.height)
    }
    const footAt = (p) => {
      const f = footPoint(p.lm)
      return f ? applyH(analyzer.calibration.H, f[0], f[1]) : null
    }
    // Real Ball (ball/): the ball's spots in every frame read, fitted to flights at the end
    const ballCam = ball ? cameraFromHomography(analyzer.calibration.H, W, H) : null
    const spots = []
    const finder = ballCam
      ? createBallFinder({
          W,
          H,
          region: searchRegion(ballCam, W, H),
          // (players' bodies: a shirt or a shoe moving isn't the ball; their hands stay in)
          exclude: () =>
            analyzer
              .tracks()
              .map((tr) => playerBox(Hinv, tr.x, tr.z, W, H))
              .filter(Boolean)
              .map((b) => ({ x0: b.x + b.w * 0.15, y0: b.y + b.h * 0.35, x1: b.x + b.w * 0.85, y1: b.y + b.h })),
        })
      : null
    let ballMs = 0
    pose = await startPose({ model, players, gpu, specs, onStatus })
    onStatus?.(pose.delegate === "GPU" ? "Reading the video (graphics chip)..." : "Reading the video...")
    const end = Math.min(to ?? video.duration, video.duration, from + MAX_READ_SECONDS)
    const total = Math.max(0, end - from)
    const started = performance.now()
    let n = 0
    let seekMs = 0
    let poseMs = 0
    let switched = false
    const frames = frameStepper(video, fps, from, end)
    for (;;) {
      if (control.cancelled) throw new Error("cancelled")
      while (control.paused && !control.cancelled) await new Promise((r) => setTimeout(r, 200))
      const s0 = performance.now()
      const t = await frames.next()
      seekMs += performance.now() - s0
      if (t === null) break
      bg.drawImage(video, 0, 0, big.width, big.height)
      g.drawImage(big, 0, 0, W, H)
      const img = g.getImageData(0, 0, W, H)
      const sample = (x, y) => {
        const xi = Math.round(x)
        const yi = Math.round(y)
        if (xi < 0 || yi < 0 || xi >= W || yi >= H) return null
        const k = (yi * W + xi) * 4
        return [img.data[k], img.data[k + 1], img.data[k + 2]]
      }
      if (finder) {
        const b0 = performance.now()
        const found = finder.push(t, img.data)
        if (found) spots.push(found)
        ballMs += performance.now() - b0
      }
      const p0 = performance.now()
      // each tracked player where they're heading (seen in the last second)
      let people = []
      const live = analyzer.tracks().filter((tr) => t - tr.lastT < 1)
      const shots = []
      for (const tr of live) {
        const dt = Math.min(0.4, t - tr.lastT)
        const box = playerBox(Hinv, tr.x + tr.vx * dt, tr.z + tr.vz * dt, W, H)
        if (!box) continue
        people = mergePeople(people, await read(box, roiCut, "roi", t), footAt)
        if (onDebug && n === 30 && shots.length < 4) shots.push(roiCut.c.toDataURL("image/jpeg", 0.8))
      }
      // finding players: every 6th frame, and whenever someone's missing
      if (n % 6 === 0 || live.length < players) {
        for (const tile of tiles) {
          people = mergePeople(people, await read(tile, scanCut, "scan", t), footAt)
          if (onDebug && n === 0 && shots.length < 8) shots.push(scanCut.c.toDataURL("image/jpeg", 0.8))
        }
      }
      poseMs += performance.now() - p0
      // (tests: what the model was shown)
      if (onDebug && shots.length) onDebug({ n, t, crops: shots, people })
      for (const p of people) p.color = torsoColor(p.lm, sample)
      analyzer.push(t, people)
      n++
      // (a graphics chip that turns out slower than the CPU, e.g. a software one: switch)
      if (n === 6 && pose.delegate === "GPU" && poseMs / n > 350 && !switched) {
        switched = true
        pose.close()
        pose = await startPose({ model, players, gpu: false, specs, onStatus })
        onStatus?.("Reading the video...")
      }
      onFrame?.({ t, people, tracks: analyzer.tracks(), W, H })
      if (n % 3 === 0) {
        const done = (t - from) / Math.max(1e-6, total)
        const spent = (performance.now() - started) / 1000
        onProgress?.({ done, eta: done > 0.01 ? (spent / done) * (1 - done) : null, framesPerSecond: n / Math.max(0.001, spent), where: pose.where, delegate: pose.delegate })
      }
    }
    onStatus?.("Listening for the paddle...")
    if (onDebug) onDebug({ final: true, tracks: analyzer.tracks() })
    const audio = await sound
    const result = analyzer.finish({ audio, names, hands })
    if (finder && spots.length > 10) {
      onStatus?.("Following the ball...")
      const f0 = performance.now()
      try {
        const b = analyzeBall(spots, result, { W, H })
        if (b) result.ball = { ...b, W, H, ms: Math.round(ballMs + performance.now() - f0) }
      } catch (err) {
        console.warn("[twin] Real Ball failed", err)
      }
    }
    result.readStats = { frames: n, seconds: (performance.now() - started) / 1000, fps, width: W, where: pose.where, delegate: pose.delegate, switchedToCpu: switched, seekMsPerFrame: seekMs / Math.max(1, n), poseMsPerFrame: poseMs / Math.max(1, n), frameMode: frames.mode, ballMsPerFrame: ballMs / Math.max(1, n), inferencesPerFrame: inferences / Math.max(1, n), tiles: tiles.length, sound: !!audio, workerError: pose.where === "page" ? lastWorkerError : null }
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
