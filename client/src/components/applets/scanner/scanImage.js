// Scanner 98's picture work in the browser (canvases, JPEG files): photos in, straightened
// pages out. The math is in scanMath.js; this file only moves pixels between it and canvases.

import { DETECT_SIDE, PAGE_SIDE, PHOTO_SIDE, applyFilter, detectCorners, outputSize, scaleCorners, toGray, warpPerspective } from "./scanMath"

const canvasOf = (w, h) => {
  const c = document.createElement("canvas")
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  return c
}

const toBlob = (canvas, type = "image/jpeg", quality = 0.88) =>
  new Promise((resolve, reject) => {
    if (canvas.toBlob) canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("The picture couldn't be made."))), type, quality)
    else fetch(canvas.toDataURL(type, quality)).then((r) => r.blob()).then(resolve, reject)
  })

// a Blob/File -> something drawable { source, w, h, close() } (EXIF turns applied)
export const decodePicture = async (blob) => {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" })
      return { source: bmp, w: bmp.width, h: bmp.height, close: () => bmp.close?.() }
    } catch {
      // older Safari: through an <img>
    }
  }
  const url = URL.createObjectURL(blob)
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error("That picture couldn't be opened. Try a JPEG or PNG (on an iPhone: Settings > Camera > Formats > Most Compatible)."))
      el.src = url
    })
    return { source: img, w: img.naturalWidth, h: img.naturalHeight, close: () => {} }
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}

// Find the page in a drawable -> corners in its own pixels + whether a page was found
export const findPage = (source, w, h) => {
  const scale = Math.min(1, DETECT_SIDE / Math.max(w, h))
  const sw = Math.max(8, Math.round(w * scale))
  const sh = Math.max(8, Math.round(h * scale))
  const c = canvasOf(sw, sh)
  const ctx = c.getContext("2d", { willReadFrequently: true })
  ctx.drawImage(source, 0, 0, sw, sh)
  const gray = toGray(ctx.getImageData(0, 0, sw, sh).data, sw, sh)
  const result = detectCorners(gray, sw, sh)
  return { found: result.found, corners: scaleCorners(result.corners, w / sw, h / sh) }
}

// A photo (from the camera or a file) kept as a JPEG at most PHOTO_SIDE big
// -> { blob, w, h, corners, found }
export const keepPhoto = async (source, w, h) => {
  const scale = Math.min(1, PHOTO_SIDE / Math.max(w, h))
  const c = canvasOf(w * scale, h * scale)
  c.getContext("2d").drawImage(source, 0, 0, c.width, c.height)
  const blob = await toBlob(c, "image/jpeg", 0.9)
  const page = findPage(c, c.width, c.height)
  return { blob, w: c.width, h: c.height, corners: page.corners, found: page.found }
}

// The straightened page: photo + corners + look + quarter turns -> { jpeg (Uint8Array), blob, w, h, thumb (object URL) }
export const renderPage = async ({ photo, corners, turns = 0 }, filter = "color") => {
  const pic = await decodePicture(photo.blob)
  try {
    const src = canvasOf(photo.w, photo.h)
    const sctx = src.getContext("2d", { willReadFrequently: true })
    sctx.drawImage(pic.source, 0, 0, photo.w, photo.h)
    const pixels = sctx.getImageData(0, 0, photo.w, photo.h).data
    const size = outputSize(corners, { maxSide: PAGE_SIDE })
    const warped = warpPerspective(pixels, photo.w, photo.h, corners, size.w, size.h)
    applyFilter(warped, size.w, size.h, filter)
    let out = canvasOf(size.w, size.h)
    out.getContext("2d").putImageData(new ImageData(warped, size.w, size.h), 0, 0)
    const q = ((turns % 4) + 4) % 4
    if (q) {
      const turned = canvasOf(q % 2 ? size.h : size.w, q % 2 ? size.w : size.h)
      const t = turned.getContext("2d")
      t.translate(turned.width / 2, turned.height / 2)
      t.rotate((q * Math.PI) / 2)
      t.drawImage(out, -size.w / 2, -size.h / 2)
      out = turned
    }
    const blob = await toBlob(out, "image/jpeg", filter === "bw" ? 0.8 : 0.85)
    const jpeg = new Uint8Array(await blob.arrayBuffer())
    // a small picture for the pages list
    const tw = 180
    const thumbCanvas = canvasOf(tw, (tw * out.height) / out.width)
    thumbCanvas.getContext("2d").drawImage(out, 0, 0, thumbCanvas.width, thumbCanvas.height)
    const thumb = URL.createObjectURL(await toBlob(thumbCanvas, "image/jpeg", 0.7))
    return { jpeg, blob, w: out.width, h: out.height, thumb }
  } finally {
    pic.close()
  }
}

// a frame of a playing <video> -> a canvas at its full size
export const grabFrame = (video) => {
  const w = video.videoWidth
  const h = video.videoHeight
  if (!w || !h) return null
  const c = canvasOf(w, h)
  c.getContext("2d").drawImage(video, 0, 0, w, h)
  return c
}

// a small, cheap look at the camera for the live outline -> corners in the video's pixels
export const liveOutline = (video, scratch) => {
  const w = video.videoWidth
  const h = video.videoHeight
  if (!w || !h) return null
  const scale = 160 / Math.max(w, h)
  const sw = Math.round(w * scale)
  const sh = Math.round(h * scale)
  if (scratch.width !== sw) scratch.width = sw
  if (scratch.height !== sh) scratch.height = sh
  const ctx = scratch.getContext("2d", { willReadFrequently: true })
  ctx.drawImage(video, 0, 0, sw, sh)
  const r = detectCorners(toGray(ctx.getImageData(0, 0, sw, sh).data, sw, sh), sw, sh)
  return r.found ? scaleCorners(r.corners, w / sw, h / sh) : null
}

export const blobToDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
