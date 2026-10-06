// Twin Replay: the pose model in a Worker, so reading a long video never freezes the page.
// One model per job ("roi": a crop round one player; "scan": court tiles to find players).
// Messages in: { type: "init", model, gpu, specs: [{ key, mode, poses }] } | { type: "frame", id, key, bitmap, ms, w, h }
// Messages out: { type: "ready", delegate } | { type: "people", id, people } | { type: "error", message }

import { createLandmarker } from "./poseModel.js"

// MediaPipe's WebAssembly loader calls importScripts(), which a module worker doesn't allow:
// a synchronous stand-in that fetches the script and runs it in the worker's global scope
self.importScripts = (...urls) => {
  for (const url of urls) {
    const x = new XMLHttpRequest()
    x.open("GET", String(url), false)
    x.send()
    if (x.status && x.status >= 400) throw new Error(`couldn't load ${url}`)
    ;(0, eval)(x.responseText)
  }
}

const models = new Map()
self.onmessage = async (e) => {
  const d = e.data || {}
  try {
    if (d.type === "init") {
      let delegate = null
      for (const spec of d.specs || [{ key: "near" }]) {
        const m = await createLandmarker({ model: d.model, poses: spec.poses, mode: spec.mode, gpu: d.gpu !== false, canvas: typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(1, 1) : undefined })
        models.set(spec.key, m)
        delegate = m.delegate
      }
      self.postMessage({ type: "ready", delegate })
    } else if (d.type === "frame") {
      const m = models.get(d.key || "near")
      const people = m ? m.detect(d.bitmap, d.ms, d.w, d.h) : []
      d.bitmap?.close?.()
      self.postMessage({ type: "people", id: d.id, people })
    } else if (d.type === "close") {
      for (const m of models.values()) m.close()
      models.clear()
    }
  } catch (err) {
    d.bitmap?.close?.()
    self.postMessage({ type: "error", id: d.id, message: String(err?.message || err) })
  }
}
