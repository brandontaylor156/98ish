// Remembers which kind of drawing context each <canvas> got ("2d", "webgl", "webgl2",
// "bitmaprenderer"), so Snipping Tool can tell 3D canvases apart without calling
// getContext itself (which would give a canvas with no context yet the wrong kind).
// Installed once from main.jsx; costs one property check per getContext call.

let installed = false
export const installCanvasKinds = () => {
  if (installed || typeof HTMLCanvasElement === "undefined") return
  installed = true
  const proto = HTMLCanvasElement.prototype
  const original = proto.getContext
  proto.getContext = function (type, ...rest) {
    const ctx = original.call(this, type, ...rest)
    if (ctx && !this.__98ctx) {
      try {
        Object.defineProperty(this, "__98ctx", { value: String(type), configurable: true })
      } catch {
        // a frozen canvas: fine
      }
    }
    return ctx
  }
}

// the context kind a canvas has ("" when none yet)
export const canvasKind = (canvas) => canvas?.__98ctx || ""
export const isWebGLCanvas = (canvas) => /^(webgl|webgl2|experimental-webgl)$/.test(canvasKind(canvas))
