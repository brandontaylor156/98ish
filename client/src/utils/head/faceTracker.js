// Be Yourself: your face -> 52 blendshapes + head pose, on this device. MediaPipe's Face
// Landmarker (Apache-2.0; the library from jsDelivr, the 3.6 MB model from Google's model
// storage, both cached by the browser; the same loader as Twin Replay's pose model). Frames
// stay on the device; only the numbers go out. With no face in view (camera off, face lost),
// the voice drives the mouth instead, and idle blinks keep the head alive.
import { CDN } from "../../components/applets/pickleball/twin/poseModel.js"
import { N, anglesFromMatrix, chooseSource, encodePacket, fromMediaPipe, idleFace, rateGate, smoothInto, voiceMouth } from "./headCore.js"

const MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
let visionP = null
const vision = () => (visionP ||= import(/* @vite-ignore */ `${CDN}/vision_bundle.mjs`).then(async (v) => ({ v, fileset: await v.FilesetResolver.forVisionTasks(`${CDN}/wasm`) })))

const createFace = async () => {
  const { v, fileset } = await vision()
  const make = (delegate) =>
    v.FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    })
  try {
    return await make("GPU")
  } catch {
    return make("CPU")
  }
}

// voice level 0-1 and brightness 0-1 from an audio stream (an analyser on its own context)
const voiceMeter = (stream) => {
  const track = stream?.getAudioTracks?.()[0]
  if (!track) return { read: () => ({ level: 0, brightness: 0.5 }), close() {} }
  const Ctx = window.AudioContext || window.webkitAudioContext
  const ctx = new Ctx()
  const src = ctx.createMediaStreamSource(new MediaStream([track]))
  const an = ctx.createAnalyser()
  an.fftSize = 512
  src.connect(an)
  const time = new Float32Array(an.fftSize)
  const freq = new Uint8Array(an.frequencyBinCount)
  return {
    read() {
      an.getFloatTimeDomainData(time)
      let sum = 0
      for (const x of time) sum += x * x
      const level = Math.min(1, Math.sqrt(sum / time.length) * 4)
      an.getByteFrequencyData(freq)
      let lo = 0
      let hi = 0
      const cut = Math.floor(freq.length * 0.12)
      for (let i = 1; i < freq.length / 2; i++) (i < cut ? (lo += freq[i]) : (hi += freq[i]))
      const brightness = hi + lo > 0 ? Math.min(1, (hi / (hi + lo)) * 1.4) : 0.5
      return { level, brightness }
    },
    close() {
      try {
        src.disconnect()
        ctx.close()
      } catch {}
    },
  }
}

// start tracking `stream` (the call's camera + mic); onPacket(Uint8Array) ~20 times a second.
// onFace(weights, pose, source) also runs locally (for a self preview). Returns { stop, ready }.
export const startFaceTracking = ({ stream, onPacket, onFace, fps = 20 } = {}) => {
  let stopped = false
  let landmarker = null
  let faceAt = -Infinity
  let seq = 0
  const gate = rateGate(fps)
  const w = new Float32Array(N)
  const face = new Float32Array(N)
  let pose = { yaw: 0, pitch: 0, roll: 0 }
  const meter = voiceMeter(stream)
  const video = document.createElement("video")
  video.muted = true
  video.playsInline = true
  video.setAttribute("playsinline", "")
  const camTrack = stream?.getVideoTracks?.()[0] || null
  if (camTrack) {
    video.srcObject = new MediaStream([camTrack])
    video.play().catch(() => {})
  }
  const ready = camTrack
    ? createFace()
        .then((lm) => (stopped ? lm.close() : (landmarker = lm)))
        .catch(() => null)
    : Promise.resolve(null)

  let lastVideoTime = -1
  const tick = () => {
    if (stopped) return
    raf = requestAnimationFrame(tick)
    const now = performance.now()
    if (!gate(now)) return
    const camOn = !!camTrack && camTrack.readyState === "live" && camTrack.enabled
    if (landmarker && camOn && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime
      try {
        const r = landmarker.detectForVideo(video, now)
        const cats = r.faceBlendshapes?.[0]?.categories
        if (cats?.length) {
          face.set(fromMediaPipe(cats))
          pose = anglesFromMatrix(r.facialTransformationMatrixes?.[0]?.data)
          faceAt = now
        }
      } catch {}
    }
    const { level, brightness } = meter.read()
    const source = chooseSource({ cameraOn: camOn && !!landmarker, faceAt, voiceLevel: level, now })
    const target = source === "face" ? face : source === "voice" ? voiceMouth(level, brightness) : idleFace(now / 1000)
    if (source !== "face") {
      // keep the eyes alive while the voice drives the mouth
      const idle = idleFace(now / 1000)
      for (const i of [8, 9, 2]) target[i] = Math.max(target[i], idle[i])
    }
    smoothInto(w, target, source === "face" ? 0.65 : 0.4)
    const p = source === "face" ? pose : { yaw: 0, pitch: 0, roll: 0 }
    onFace?.(w, p, source)
    onPacket?.(encodePacket({ weights: w, ...p, seq: seq++ & 0xffff, source }))
  }
  let raf = requestAnimationFrame(tick)
  return {
    ready,
    stop() {
      stopped = true
      cancelAnimationFrame(raf)
      meter.close()
      try {
        landmarker?.close()
      } catch {}
      video.srcObject = null
    },
  }
}
