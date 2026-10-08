// Snipping Tool's camera: a picture of the 98ish screen, made from the page itself (a
// browser can't photograph the real screen without asking, and an iPhone can't at all).
// - The page: modern-screenshot (MIT) copies the visible 98ish DOM into an SVG
//   foreignObject and draws it on a canvas, at up to 2x for sharp text.
// - 3D games (WebGL canvases): their picture is gone right after each frame is shown
//   (preserveDrawingBuffer is off for speed), so for a few frames every
//   requestAnimationFrame callback is followed by a check of those canvases, and the first
//   frame with something drawn is copied out right there, before the browser clears it.
//   A 3D canvas that draws nothing in that time (paused, drawn only on demand) shows as a
//   gray "3D picture" box instead of a blank black one.
// - Web pages from other sites inside a window (YouTube, Compass pages) can't be copied
//   (the browser keeps them private): they show as a hatched box.
// - Another window or screen (computers only, More options): getDisplayMedia, one frame.

import { isWebGLCanvas } from "../../../utils/canvasKinds"
import { SHOT_URL } from "./snipMath"

let shotLib = null
export const loadShot = () => {
  shotLib ||= import(/* @vite-ignore */ SHOT_URL).catch((error) => {
    shotLib = null
    throw error
  })
  return shotLib
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()))
export const settle = async (ms = 0) => {
  await nextFrame()
  await nextFrame()
  if (ms) await new Promise((r) => setTimeout(r, ms))
}

// is anything drawn in this WebGL canvas right now? (a few pixels across it)
const hasPixels = (canvas) => {
  const gl = canvas.getContext(canvas.__98ctx)
  if (!gl || gl.isContextLost?.()) return false
  const w = gl.drawingBufferWidth
  const h = gl.drawingBufferHeight
  if (!w || !h) return false
  const px = new Uint8Array(4)
  for (let i = 1; i <= 4; i++) {
    for (let j = 1; j <= 4; j++) {
      gl.readPixels(Math.floor((w * i) / 5), Math.floor((h * j) / 5), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
      if (px[0] || px[1] || px[2] || px[3]) return true
    }
  }
  return false
}

// One frame of each 3D canvas, copied right after the program drew it -> Map(canvas -> data URL)
export const grabWebGL = (canvases, { frames = 12 } = {}) =>
  new Promise((resolve) => {
    const grabs = new Map()
    const left = new Set(canvases)
    if (!left.size) return resolve(grabs)
    // a canvas that keeps its picture can be copied any time
    for (const c of [...left]) {
      try {
        const gl = c.getContext(c.__98ctx)
        if (gl?.getContextAttributes?.()?.preserveDrawingBuffer) {
          grabs.set(c, c.toDataURL("image/png"))
          left.delete(c)
        }
      } catch {
        left.delete(c)
      }
    }
    if (!left.size) return resolve(grabs)
    const original = window.requestAnimationFrame
    const tryGrab = () => {
      for (const c of [...left]) {
        try {
          if (hasPixels(c)) {
            grabs.set(c, c.toDataURL("image/png"))
            left.delete(c)
          }
        } catch {
          left.delete(c)
        }
      }
    }
    let done = false
    const finish = () => {
      if (done) return
      done = true
      if (window.requestAnimationFrame === wrapped) window.requestAnimationFrame = original
      resolve(grabs)
    }
    function wrapped(cb) {
      return original.call(window, (t) => {
        try {
          cb(t)
        } finally {
          if (!done && left.size) tryGrab()
          if (!left.size) finish()
        }
      })
    }
    window.requestAnimationFrame = wrapped
    let n = 0
    const tick = () => {
      if (done) return
      if (++n >= frames) return finish()
      original.call(window, tick)
    }
    original.call(window, tick)
    setTimeout(finish, 1500) // a page in the background gets no frames
  })

// the gray box for a 3D canvas that couldn't be grabbed
const placeholder = (w, h, label = "3D picture") => {
  const c = document.createElement("canvas")
  c.width = Math.max(1, Math.min(w, 2048))
  c.height = Math.max(1, Math.min(h, 2048))
  const g = c.getContext("2d")
  g.fillStyle = "#808080"
  g.fillRect(0, 0, c.width, c.height)
  g.strokeStyle = "#a0a0a0"
  g.lineWidth = 2
  for (let x = -c.height; x < c.width; x += 16) {
    g.beginPath()
    g.moveTo(x, c.height)
    g.lineTo(x + c.height, 0)
    g.stroke()
  }
  g.fillStyle = "#fff"
  g.font = `bold ${Math.max(10, Math.min(28, c.width / 12))}px sans-serif`
  g.textAlign = "center"
  g.textBaseline = "middle"
  g.fillText(label, c.width / 2, c.height / 2)
  return c.toDataURL("image/png")
}

const IFRAME_LOOK = "repeating-linear-gradient(45deg, #c0c0c0 0 8px, #d8d8d8 8px 16px)"

// A picture of the whole 98ish screen -> { canvas, scale, width, height, offset }
//   exclude: elements to leave out (Snipping Tool's own window and badges)
export const captureScreen = async ({ exclude = [], maxScale = 2 } = {}) => {
  const root = document.querySelector(".os-root") || document.body
  const box = root.getBoundingClientRect()
  const width = Math.round(Math.min(box.width, window.innerWidth))
  const height = Math.round(Math.min(box.height, window.innerHeight))
  const scale = Math.max(1, Math.min(maxScale, window.devicePixelRatio || 1))
  const lib = await loadShot()
  const skip = (el) => el.nodeType === 1 && (el.hasAttribute?.("data-snip-hide") || exclude.some((x) => x && x === el))

  // 3D canvases on screen: one frame of each, copied as it's drawn
  const gl = [...root.querySelectorAll("canvas")].filter((c) => isWebGLCanvas(c) && c.offsetWidth > 0 && !exclude.some((x) => x?.contains?.(c)))
  const grabs = await grabWebGL(gl)
  const restore = []
  for (const c of gl) {
    const url = grabs.get(c) || placeholder(c.width || c.offsetWidth, c.height || c.offsetHeight)
    // modern-screenshot copies a canvas with its toDataURL(): hand it the grabbed frame
    Object.defineProperty(c, "toDataURL", { value: () => url, configurable: true })
    restore.push(c)
  }
  try {
    const canvas = await lib.domToCanvas(root, {
      width,
      height,
      scale,
      backgroundColor: getComputedStyle(root).backgroundColor || "#008080",
      filter: (node) => !skip(node),
      timeout: 8000,
      fetch: { requestInit: { cache: "force-cache" } },
      onCloneEachNode: (cloned) => {
        if (cloned?.tagName === "IFRAME") {
          // another site's page: can't be copied, so a hatched box rather than nothing
          cloned.style.background = IFRAME_LOOK
          cloned.removeAttribute("src")
          cloned.removeAttribute("srcdoc")
        }
      },
    })
    return { canvas, scale, width, height, offset: { x: box.left, y: box.top }, grabbed: grabs.size, placeholders: gl.length - grabs.size }
  } finally {
    for (const c of restore) delete c.toDataURL
  }
}

// The windows on screen, front first: [{ index, title, rect }] (CSS px, screen coordinates)
export const windowsOnScreen = (exclude = []) => {
  const out = []
  for (const el of document.querySelectorAll(".window[data-window-index]")) {
    if (exclude.some((x) => x?.contains?.(el))) continue
    const r = el.getBoundingClientRect()
    if (r.width < 8 || r.height < 8) continue
    const index = Number(el.dataset.windowIndex)
    out.push({ index, title: document.getElementById(`win-title-${index}`)?.textContent || "Window", rect: { x: r.left, y: r.top, w: r.width, h: r.height } })
  }
  return out
}

// which window is at a point (the frontmost one there), with an overlay temporarily see-through
export const windowAt = (x, y, overlay) => {
  const was = overlay?.style.pointerEvents
  if (overlay) overlay.style.pointerEvents = "none"
  try {
    const el = document.elementFromPoint(x, y)?.closest?.(".window[data-window-index]")
    if (!el) return null
    const r = el.getBoundingClientRect()
    const index = Number(el.dataset.windowIndex)
    return { index, title: document.getElementById(`win-title-${index}`)?.textContent || "Window", rect: { x: r.left, y: r.top, w: r.width, h: r.height } }
  } finally {
    if (overlay) overlay.style.pointerEvents = was || ""
  }
}

// Computers: a picture of another window or screen, with the browser's own picker
export const canCaptureDisplay = () => typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia && !/iPhone|iPad|iPod|Android/i.test(navigator.userAgent || "")
export const captureDisplay = async () => {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
  try {
    const video = document.createElement("video")
    video.muted = true
    video.playsInline = true
    video.srcObject = stream
    await video.play()
    await new Promise((r) => (video.requestVideoFrameCallback ? video.requestVideoFrameCallback(() => r()) : setTimeout(r, 300)))
    const canvas = document.createElement("canvas")
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext("2d").drawImage(video, 0, 0)
    video.srcObject = null
    return { canvas, scale: 1, width: canvas.width, height: canvas.height, offset: { x: 0, y: 0 }, display: true }
  } finally {
    stream.getTracks().forEach((t) => t.stop())
  }
}
