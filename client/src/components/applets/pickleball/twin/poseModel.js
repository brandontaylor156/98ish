// Twin Replay: the pose model. Google's MediaPipe Pose Landmarker (free, Apache 2.0), run in
// this browser: the code and the model file come from public CDNs the first time (jsDelivr
// for the library, Google's model storage for the 5.8 MB model) and are cached by the
// browser after that. Nothing about the video leaves the device: frames go in, landmarks
// come out. WebGPU/WebGL when the browser has it ("GPU"), else the CPU (WebAssembly).
//
// The model finds people at roughly a quarter of its input's height or bigger, so the reader
// shows it close crops: one around each tracked player ("roi": one pose, still images) and a
// few court tiles to find players ("scan"). Shared by the worker (poseWorker.js) and the main
// thread (the fallback when a worker can't run it).

export const TASKS_VERSION = "1.0.1"
export const CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}`
export const MODELS = {
  lite: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
  full: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task",
}
export const MODEL_MB = { lite: 5.8, full: 9.4 }

let visionP = null
const vision = () => (visionP ||= import(/* @vite-ignore */ `${CDN}/vision_bundle.mjs`).then(async (v) => ({ v, fileset: await v.FilesetResolver.forVisionTasks(`${CDN}/wasm`) })))

// mode: "IMAGE" (each picture on its own) | "VIDEO" (tracks between frames); poses: how many
export const createLandmarker = async ({ model = "lite", poses = 1, mode = "IMAGE", gpu = true, canvas = undefined } = {}) => {
  const { v, fileset } = await vision()
  const make = (delegate) =>
    v.PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODELS[model] || MODELS.lite, delegate },
      runningMode: mode,
      numPoses: Math.max(1, Math.min(8, poses)),
      minPoseDetectionConfidence: 0.3,
      minPosePresenceConfidence: 0.3,
      minTrackingConfidence: 0.3,
      ...(canvas ? { canvas } : {}),
    })
  let lm
  let delegate = gpu ? "GPU" : "CPU"
  try {
    lm = await make(delegate)
  } catch (e) {
    if (delegate === "CPU") throw e
    delegate = "CPU"
    lm = await make(delegate)
  }
  let lastMs = -1
  return {
    delegate,
    // image: ImageBitmap/canvas (w x h px); ms: the frame's time (VIDEO mode: must increase)
    detect(image, ms, w, h) {
      let r
      if (mode === "VIDEO") {
        const t = ms <= lastMs ? lastMs + 1 : ms
        lastMs = t
        r = lm.detectForVideo(image, t)
      } else r = lm.detect(image)
      return (r.landmarks || []).map((pts, i) => ({
        lm: pts.map((p) => ({ x: p.x * w, y: p.y * h, v: p.visibility ?? 1 })),
        world: r.worldLandmarks?.[i]?.map((p) => ({ x: p.x, y: p.y, z: p.z })) || null,
      }))
    },
    close() {
      try {
        lm.close()
      } catch {
        // gone
      }
    },
  }
}
