// The pure math behind Camera and Photos (no DOM, no drive, so Node can test it): photo
// names, fitting a JPEG into the drive, and the viewer's zoom, pan, crop and rotation.

export const MAX_SIDE = 2048 // a photo's longest side
// about 400 KB as a data URL: the drive holds hundreds of them, and file sync keeps them in
// 98 Messenger's online storage (300 MB per account in Vercel Blob's free plan, 750 MB in
// all: about 800 photos each, so a couple's photos fit side by side; see server/drive/sync.js)
export const MAX_CHARS = 560_000
// in the small fallback drive (no IndexedDB, about 5 MB in all): the old limits
export const SMALL_DRIVE_SIDE = 1280
export const SMALL_DRIVE_CHARS = 240_000

// ---- names ----

// "PHOTO007.JPG" -> 7 for prefix PHOTO (any case, extension optional)
export const photoNumber = (name, prefix) => {
  const m = new RegExp(`^${prefix}(\\d+)(\\.jpe?g|\\.png)?$`, "i").exec(String(name).trim())
  return m ? Number(m[1]) : 0
}

// The next free name like "PHOTO001.JPG" among `names` (numbers go up; gaps aren't refilled)
export const nextPhotoName = (names, prefix = "PHOTO", ext = ".JPG") => {
  let max = 0
  for (const name of names) max = Math.max(max, photoNumber(name, prefix))
  const taken = new Set([...names].map((n) => n.toLowerCase()))
  for (let n = max + 1; ; n++) {
    const candidate = `${prefix}${String(n).padStart(3, "0")}${ext}`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
}

// "IMG_1234.HEIC" -> "IMG_1234.JPG" (what an upload is called once it's a JPEG)
export const uploadName = (fileName) => {
  const base =
    String(fileName || "Photo")
      .replace(/\.(heic|heif|png|jpe?g|gif|webp|bmp|avif|tiff?)$/i, "")
      .replace(/[\\/:"<>|\u0000-\u001F]/g, "_")
      .trim()
      .slice(0, 56) || "Photo"
  return `${base}.JPG`
}

// a copy's name: "PHOTO001.JPG" -> "PHOTO001 (edited).JPG"
export const editedName = (name) => {
  const dot = name.lastIndexOf(".")
  return dot > 0 ? `${name.slice(0, dot)} (edited)${name.slice(dot)}` : `${name} (edited)`
}

export const isHeic = (file) => /\.(heic|heif)$/i.test(file?.name || "") || /^image\/hei[cf]/i.test(file?.type || "")

// The biggest scale (<= 1) that keeps both sides within maxSide
export const fitScale = (w, h, maxSide = MAX_SIDE) => Math.min(1, maxSide / Math.max(1, w), maxSide / Math.max(1, h))

// Find a JPEG that fits: encode(quality, scale) -> data URL. Lowers the quality first,
// then the size. -> { data, quality, scale } (the smallest try if nothing fits)
export const fitEncode = (encode, { maxChars = MAX_CHARS, scale = 1, minScale = 0.15 } = {}) => {
  let quality = 0.86
  let last = null
  for (let tries = 0; tries < 16; tries++) {
    const data = encode(quality, scale)
    last = { data, quality, scale }
    if (data.length <= maxChars) return last
    if (quality > 0.62) quality = Math.round((quality - 0.08) * 100) / 100
    else if (scale > minScale) scale *= 0.82
    else break
  }
  return last
}

// a data URL's size in bytes (what it would be as a file)
export const dataBytes = (url) => {
  const comma = String(url).indexOf(",")
  if (comma < 0) return 0
  const body = url.length - comma - 1
  return /;base64$/i.test(url.slice(0, comma)) ? Math.floor((body * 3) / 4) - (url.endsWith("==") ? 2 : url.endsWith("=") ? 1 : 0) : body
}

export const kindOf = (url) => (/^data:image\/jpe?g/i.test(url) ? "JPEG Image" : /^data:image\/png/i.test(url) ? "PNG Image" : /^data:image\/gif/i.test(url) ? "GIF Image" : "Picture")

// ---- the viewer: zoom and pan ----
// A view is { scale, x, y }: image pixel (ix, iy) shows at (x + ix * scale, y + iy * scale)
// in the viewing area.

// The whole picture, centered; small pictures aren't blown up past maxScale
export const fitView = (imgW, imgH, boxW, boxH, maxScale = 1) => {
  const scale = Math.max(0.01, Math.min(maxScale, boxW / imgW, boxH / imgH))
  return { scale, x: (boxW - imgW * scale) / 2, y: (boxH - imgH * scale) / 2 }
}

// Keep the picture covering the area when it's bigger, centered when it's smaller
export const clampView = (view, imgW, imgH, boxW, boxH) => {
  const w = imgW * view.scale
  const h = imgH * view.scale
  const x = w <= boxW ? (boxW - w) / 2 : Math.min(0, Math.max(boxW - w, view.x))
  const y = h <= boxH ? (boxH - h) / 2 : Math.min(0, Math.max(boxH - h, view.y))
  return { scale: view.scale, x, y }
}

// Zoom to `scale`, keeping the image point under (px, py) where it is
export const zoomAt = (view, scale, px, py) => {
  const ix = (px - view.x) / view.scale
  const iy = (py - view.y) / view.scale
  return { scale, x: px - ix * scale, y: py - iy * scale }
}

// how far you can zoom: from the fitted size to 8 times actual size
export const zoomLimits = (fitted) => ({ min: Math.min(fitted, 1), max: Math.max(8, fitted * 2) })
export const clampScale = (scale, fitted) => {
  const { min, max } = zoomLimits(fitted)
  return Math.max(min, Math.min(max, scale))
}

// What a horizontal swipe means: 1 (next picture), -1 (previous) or 0
export const swipeDirection = (dx, dy, { min = 50, ms = 0, maxMs = 900 } = {}) => {
  if (ms > maxMs) return 0
  if (Math.abs(dx) < min || Math.abs(dx) < Math.abs(dy) * 1.2) return 0
  return dx < 0 ? 1 : -1
}

// ---- crop ----
// Rectangles are { x, y, w, h } in image pixels. aspect is width / height, or null (free).

export const CROP_ASPECTS = [
  { id: "free", label: "Free", value: null },
  { id: "square", label: "Square", value: 1 },
  { id: "4:3", label: "4:3", value: 4 / 3 },
  { id: "3:4", label: "3:4", value: 3 / 4 },
  { id: "16:9", label: "16:9", value: 16 / 9 },
]

// The biggest centered rectangle of that shape (the whole picture when free)
export const initialCrop = (imgW, imgH, aspect = null) => {
  if (!aspect) return { x: 0, y: 0, w: imgW, h: imgH }
  let w = imgW
  let h = w / aspect
  if (h > imgH) {
    h = imgH
    w = h * aspect
  }
  return { x: (imgW - w) / 2, y: (imgH - h) / 2, w, h }
}

export const moveCrop = (rect, dx, dy, imgW, imgH) => ({
  ...rect,
  x: Math.max(0, Math.min(imgW - rect.w, rect.x + dx)),
  y: Math.max(0, Math.min(imgH - rect.h, rect.y + dy)),
})

// Drag a handle ("n", "s", "e", "w", "ne", "nw", "se", "sw") by (dx, dy) image pixels. The
// opposite side stays put; the rectangle stays inside the picture and at least `min` big.
export const resizeCrop = (rect, handle, dx, dy, imgW, imgH, aspect = null, min = 16) => {
  let left = rect.x
  let top = rect.y
  let right = rect.x + rect.w
  let bottom = rect.y + rect.h
  if (handle.includes("w")) left = Math.max(0, Math.min(right - min, left + dx))
  if (handle.includes("e")) right = Math.min(imgW, Math.max(left + min, right + dx))
  if (handle.includes("n")) top = Math.max(0, Math.min(bottom - min, top + dy))
  if (handle.includes("s")) bottom = Math.min(imgH, Math.max(top + min, bottom + dy))
  if (!aspect) return { x: left, y: top, w: right - left, h: bottom - top }

  // a fixed shape: the width leads (the height for the top and bottom handles), anchored
  // at the opposite corner or edge, shrunk until it fits
  const horizontal = handle.includes("e") || handle.includes("w")
  let w = right - left
  let h = bottom - top
  if (horizontal) h = w / aspect
  else w = h * aspect
  const anchorX = handle.includes("w") ? rect.x + rect.w : handle.includes("e") ? rect.x : rect.x + rect.w / 2
  const anchorY = handle.includes("n") ? rect.y + rect.h : handle.includes("s") ? rect.y : rect.y + rect.h / 2
  const roomX = handle.includes("w") ? anchorX : handle.includes("e") ? imgW - anchorX : 2 * Math.min(anchorX, imgW - anchorX)
  const roomY = handle.includes("n") ? anchorY : handle.includes("s") ? imgH - anchorY : 2 * Math.min(anchorY, imgH - anchorY)
  const fit = Math.min(1, roomX / w, roomY / h)
  w *= fit
  h *= fit
  if (w < min || h < min) {
    const grow = Math.max(min / w, min / h)
    w *= grow
    h *= grow
  }
  const x = handle.includes("w") ? anchorX - w : handle.includes("e") ? anchorX : anchorX - w / 2
  const y = handle.includes("n") ? anchorY - h : handle.includes("s") ? anchorY : anchorY - h / 2
  return { x, y, w, h }
}

// whole pixels, inside the picture
export const roundCrop = (rect, imgW, imgH) => {
  const x = Math.max(0, Math.min(imgW - 1, Math.round(rect.x)))
  const y = Math.max(0, Math.min(imgH - 1, Math.round(rect.y)))
  return { x, y, w: Math.max(1, Math.min(imgW - x, Math.round(rect.w))), h: Math.max(1, Math.min(imgH - y, Math.round(rect.h))) }
}

// ---- rotation (quarter turns clockwise) ----

export const turnsOf = (turns) => ((Math.round(turns) % 4) + 4) % 4

export const rotatedSize = (w, h, turns) => (turnsOf(turns) % 2 ? { width: h, height: w } : { width: w, height: h })

// The canvas transform [a, b, c, d, e, f] (ctx.setTransform) that draws a w x h picture
// at 0,0 turned clockwise into a canvas of rotatedSize
export const rotationMatrix = (turns, w, h) => {
  switch (turnsOf(turns)) {
    case 1:
      return [0, 1, -1, 0, h, 0]
    case 2:
      return [-1, 0, 0, -1, w, h]
    case 3:
      return [0, -1, 1, 0, 0, w]
    default:
      return [1, 0, 0, 1, 0, 0]
  }
}

export const applyMatrix = ([a, b, c, d, e, f], x, y) => [a * x + c * y + e, b * x + d * y + f]

// ---- the photo strip ----

// Where each of `count` shots goes in a strip: { width, height, slots: [{ x, y, w, h }], caption }
export const stripLayout = (shotW, shotH, count = 4) => {
  const pad = Math.round(shotW * 0.06)
  const caption = Math.round(shotW * 0.16)
  const slots = []
  for (let i = 0; i < count; i++) slots.push({ x: pad, y: pad + i * (shotH + pad), w: shotW, h: shotH })
  return { width: shotW + pad * 2, height: pad + count * (shotH + pad) + caption, slots, caption: { y: pad + count * (shotH + pad), h: caption } }
}

