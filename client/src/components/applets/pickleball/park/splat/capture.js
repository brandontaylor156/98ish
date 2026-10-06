// "Capture this court": a walk-around video on the phone -> ~32 frames -> Meta's free
// MapAnything Space on Hugging Face (Apache-2.0 checkpoint; it runs on the visitor's own
// free GPU allowance, called straight from this browser, so Render never carries a byte)
// -> a colored point cloud (.glb) -> splats (each point a small gaussian) -> a backdrop.
// Every step reports honestly: the Space can be busy, asleep or out of free GPU time.

export const SPACE = "facebook/map-anything"
export const MAX_SECONDS = 40
export const FRAMES = 32

// record from the back camera: resolves at once with { stop(), blob: Promise<Blob> }
export const record = async ({ onTick, signal } = {}) => {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
  const type = ["video/mp4", "video/webm;codecs=vp9", "video/webm"].find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || ""
  const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined)
  const chunks = []
  rec.ondataavailable = (e) => e.data?.size && chunks.push(e.data)
  const done = new Promise((resolve) => (rec.onstop = () => resolve(new Blob(chunks, { type: rec.mimeType || "video/webm" }))))
  rec.start(1000)
  const t0 = performance.now()
  const tick = setInterval(() => {
    const s = (performance.now() - t0) / 1000
    onTick?.(s)
    if (s >= MAX_SECONDS && rec.state === "recording") rec.stop()
  }, 250)
  const stop = () => rec.state === "recording" && rec.stop()
  signal?.addEventListener("abort", stop)
  const blob = done.finally(() => {
    clearInterval(tick)
    for (const t of stream.getTracks()) t.stop()
  })
  return { blob, stop } // blob: a Promise of the video, settled once it stops
}

// evenly spaced frames as JPEG Blobs (long side ≤ 768 px)
export const sampleFrames = async (videoBlob, count = FRAMES, { onProgress } = {}) => {
  const url = URL.createObjectURL(videoBlob)
  const v = document.createElement("video")
  v.muted = true
  v.playsInline = true
  v.src = url
  await new Promise((resolve, reject) => {
    v.onloadedmetadata = resolve
    v.onerror = () => reject(new Error("The video couldn't be opened."))
  })
  // browser recordings can report an endless duration until seeked to the end
  if (!Number.isFinite(v.duration)) {
    v.currentTime = 1e6
    await new Promise((r) => (v.onseeked = r))
  }
  const dur = Number.isFinite(v.duration) ? v.duration : 0
  if (dur < 3) throw new Error("The video is too short: walk slowly around the court for 20 to 40 seconds.")
  const scale = Math.min(1, 768 / Math.max(v.videoWidth, v.videoHeight))
  const canvas = document.createElement("canvas")
  canvas.width = Math.round(v.videoWidth * scale)
  canvas.height = Math.round(v.videoHeight * scale)
  const ctx = canvas.getContext("2d")
  const out = []
  for (let i = 0; i < count; i++) {
    v.currentTime = (dur * (i + 0.5)) / count
    await new Promise((r) => (v.onseeked = r))
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height)
    out.push(await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.85)))
    onProgress?.((i + 1) / count)
  }
  URL.revokeObjectURL(url)
  return out
}

// send the frames to MapAnything and get back its .glb point cloud as bytes
export const reconstruct = async (frames, { onStatus } = {}) => {
  const { Client, handle_file } = await import("@gradio/client")
  onStatus?.("Waking up the free 3D service (it can take a minute)...")
  let app
  try {
    app = await Client.connect(SPACE)
  } catch (e) {
    throw new Error(`The free 3D service on Hugging Face didn't answer (${e?.message || "offline"}). Try again later, or import a splat file instead.`)
  }
  onStatus?.("Uploading your court's frames...")
  const files = frames.map((b, i) => handle_file(new File([b], `frame${String(i).padStart(2, "0")}.jpg`, { type: "image/jpeg" })))
  await app.predict("/update_gallery_on_unified_upload", [files, 1])
  onStatus?.("Building your court in 3D (about a minute)...")
  let result
  try {
    result = await app.predict("/gradio_demo", ["All", false, false, false, true, false])
  } catch (e) {
    const msg = String(e?.message || e)
    if (/quota|GPU|exceeded|ZeroGPU/i.test(msg)) throw new Error("Hugging Face's free GPU time for today is used up on this device. It resets daily; or import a splat file instead.")
    throw new Error(`The 3D service couldn't build it (${msg.slice(0, 120)}).`)
  }
  const model = result?.data?.[0]
  const url = model?.url || model?.path
  if (!url) throw new Error("The 3D service didn't send a model back.")
  onStatus?.("Downloading the 3D points...")
  const res = await fetch(url)
  if (!res.ok) throw new Error("The 3D model couldn't be downloaded.")
  return new Uint8Array(await res.arrayBuffer())
}

// a .glb point cloud (or mesh) -> positions + colors
export const glbPoints = async (glbBytes) => {
  const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js")
  const gltf = await new Promise((resolve, reject) => new GLTFLoader().parse(glbBytes.buffer.slice(glbBytes.byteOffset, glbBytes.byteOffset + glbBytes.byteLength), "", resolve, reject))
  const pos = []
  const col = []
  gltf.scene.updateMatrixWorld(true)
  gltf.scene.traverse((o) => {
    const g = o.geometry
    if (!g?.attributes?.position) return
    const p = g.attributes.position.clone().applyMatrix4(o.matrixWorld)
    const c = g.attributes.color
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i))
      if (c) col.push(c.getX(i), c.getY(i), c.getZ(i))
      else col.push(0.7, 0.7, 0.7)
    }
  })
  if (!pos.length) throw new Error("The 3D model had no points.")
  return { positions: new Float32Array(pos), colors: new Float32Array(col) }
}
