// Twin Replay: the pose model. Google's MediaPipe Pose Landmarker (free, Apache 2.0), run in
// this browser: the code and the model file come from public CDNs the first time (jsDelivr
// for the library, Google's model storage for the 5.8 MB model) and are cached by the
// browser after that. Nothing about the video leaves the device: frames go in, landmarks
// come out. WebGPU/WebGL when the browser has it ("GPU"), else the CPU (WebAssembly).
//
// Shared by the worker (poseWorker.js) and the main thread (the fallback when a worker can't
// run it): createLandmarker(), detect(bitmap, ms).

export const TASKS_VERSION = "1.0.1"
export const CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}`
export const MODELS = {
  lite: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
  full: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task",
}
export const MODEL_MB = { lite: 5.8, full: 9.4 }

export const createLandmarker = async ({ model = "lite", players = 4, gpu = true, canvas = undefined } = {}) => {
  const vision = await import(/* @vite-ignore */ `${CDN}/vision_bundle.mjs`)
  const fileset = await vision.FilesetResolver.forVisionTasks(`${CDN}/wasm`)
  const make = (delegate) =>
    vision.PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODELS[model] || MODELS.lite, delegate },
      runningMode: "VIDEO",
      numPoses: Math.max(2, Math.min(6, players + 2)), // (a couple of spares: people walking past)
      minPoseDetectionConfidence: 0.35,
      minPosePresenceConfidence: 0.35,
      minTrackingConfidence: 0.35,
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
    // bitmap: ImageBitmap/canvas (w x h px); ms: the frame's time (must increase)
    detect(image, ms, w, h) {
      const t = ms <= lastMs ? lastMs + 1 : ms
      lastMs = t
      const r = lm.detectForVideo(image, t)
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
