// Twin Replay: the pose model in a Worker, so reading a long video never freezes the page.
// Messages in: { type: "init", model, players } | { type: "frame", id, bitmap, ms, w, h }
// Messages out: { type: "ready", delegate } | { type: "people", id, people } | { type: "error", message }

import { createLandmarker } from "./poseModel.js"

let model = null
self.onmessage = async (e) => {
  const d = e.data || {}
  try {
    if (d.type === "init") {
      model = await createLandmarker({ model: d.model, players: d.players, gpu: d.gpu !== false, canvas: typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(1, 1) : undefined })
      self.postMessage({ type: "ready", delegate: model.delegate })
    } else if (d.type === "frame") {
      const people = model ? model.detect(d.bitmap, d.ms, d.w, d.h) : []
      d.bitmap?.close?.()
      self.postMessage({ type: "people", id: d.id, people })
    } else if (d.type === "close") {
      model?.close()
      model = null
    }
  } catch (err) {
    d.bitmap?.close?.()
    self.postMessage({ type: "error", id: d.id, message: String(err?.message || err) })
  }
}
