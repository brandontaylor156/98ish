// Pictures for puzzles: loading one (a data URL, a drive file, a photo from this device)
// and shrinking it to at most 1280 px a side and about 300 KB, the size puzzles travel at.

export const MAX_SIDE = 1280
export const MAX_CHARS = 400_000 // about 300 KB as base64

export const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error("That picture couldn't be opened."))
    img.src = src
  })

// Any picture (an <img>, or a File from this device) -> { data (JPEG data URL), width, height }
export const shrinkPicture = async (source, { maxSide = MAX_SIDE, maxChars = MAX_CHARS } = {}) => {
  let img = source
  let url = null
  if (typeof Blob !== "undefined" && source instanceof Blob) {
    url = URL.createObjectURL(source)
    img = await loadImage(url).finally(() => {})
  } else if (typeof source === "string") img = await loadImage(source)
  try {
    const w = img.naturalWidth || img.width
    const h = img.naturalHeight || img.height
    if (!w || !h) throw new Error("That picture couldn't be opened.")
    let scale = Math.min(1, maxSide / w, maxSide / h)
    let quality = 0.86
    for (let tries = 0; tries < 12; tries++) {
      const canvas = document.createElement("canvas")
      canvas.width = Math.max(1, Math.round(w * scale))
      canvas.height = Math.max(1, Math.round(h * scale))
      const ctx = canvas.getContext("2d")
      ctx.fillStyle = "#fff"
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.imageSmoothingQuality = "high"
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      const data = canvas.toDataURL("image/jpeg", quality)
      if (data.length <= maxChars || canvas.width <= 200) return { data, width: canvas.width, height: canvas.height }
      if (quality > 0.62) quality -= 0.08
      else scale *= 0.82
    }
    throw new Error("That picture is too big to use.")
  } finally {
    if (url) URL.revokeObjectURL(url)
  }
}

export const formatTime = (ms) => {
  const t = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = String(t % 60).padStart(2, "0")
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`
}
