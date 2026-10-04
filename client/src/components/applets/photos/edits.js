import { applyEffect, adjustPixels } from "../camera/effects"
import { drawFrame } from "../camera/frames"
import { fitScale, rotatedSize, rotationMatrix, roundCrop } from "./photoMath.js"

// Photos' edits on canvases (rotate, crop, brightness/contrast, effects and frames). Each
// takes something drawable (an <img> or a canvas) and returns a new canvas, so edits stack
// up without losing quality until the photo is saved once as a JPEG.

const sizeOf = (source) => ({ w: source.naturalWidth || source.width, h: source.naturalHeight || source.height })

export const makeCanvas = (w, h) => {
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(w))
  canvas.height = Math.max(1, Math.round(h))
  return canvas
}

export const copyOf = (source) => {
  const { w, h } = sizeOf(source)
  const canvas = makeCanvas(w, h)
  canvas.getContext("2d").drawImage(source, 0, 0)
  return canvas
}

export const rotate = (source, turns) => {
  const { w, h } = sizeOf(source)
  const size = rotatedSize(w, h, turns)
  const canvas = makeCanvas(size.width, size.height)
  const ctx = canvas.getContext("2d")
  ctx.setTransform(...rotationMatrix(turns, w, h))
  ctx.drawImage(source, 0, 0)
  return canvas
}

export const crop = (source, rect) => {
  const { w, h } = sizeOf(source)
  const r = roundCrop(rect, w, h)
  const canvas = makeCanvas(r.w, r.h)
  canvas.getContext("2d").drawImage(source, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h)
  return canvas
}

// pixels worked on by fn(imageData); `maxSide` makes a smaller copy (for previews)
const pixels = (source, fn, maxSide = 0) => {
  const { w, h } = sizeOf(source)
  const s = maxSide ? fitScale(w, h, maxSide) : 1
  const canvas = makeCanvas(w * s, h * s)
  const ctx = canvas.getContext("2d", { willReadFrequently: true })
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  fn(img, canvas)
  ctx.putImageData(img, 0, 0)
  return canvas
}

export const adjust = (source, values, maxSide = 0) => pixels(source, (img) => adjustPixels(img, values), maxSide)

export const effect = (source, effectId, frameId = "none", maxSide = 0) => {
  const canvas = pixels(source, (img, c) => applyEffect(effectId, img, { scale: c.width / 480, t: 1 }), maxSide)
  if (frameId && frameId !== "none") drawFrame(canvas.getContext("2d"), frameId, canvas.width, canvas.height)
  return canvas
}

// A canvas -> an object URL to show it (revoke it when done)
export const canvasUrl = (canvas, type = "image/jpeg", quality = 0.92) =>
  new Promise((resolve) => {
    if (canvas.toBlob) canvas.toBlob((blob) => resolve(blob ? URL.createObjectURL(blob) : canvas.toDataURL(type, quality)), type, quality)
    else resolve(canvas.toDataURL(type, quality))
  })
