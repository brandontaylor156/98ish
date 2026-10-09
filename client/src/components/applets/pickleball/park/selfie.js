// My Park > Together > Selfie: the picture the world took (world.js snapSelfie, a JPEG of the
// game's own canvas) made into a keepsake: cropped to a photo's shape, warmed a little at golden
// hour, with a printed strip under it (who, where, when). Runs in the browser (a 2D canvas).
// -> { full (data URL JPEG, up to 1440 px tall), thumb (data URL JPEG, 480 px, for Our Story),
//      blob (the full one) }

const load = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error("The picture didn't come out."))
    img.src = src
  })

const toBlob = (canvas, quality) => new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", quality))

export const composeSelfie = async (url, { title = "", line = "", golden = false } = {}) => {
  const img = await load(url)
  const portrait = img.height >= img.width
  const ar = portrait ? 3 / 4 : 4 / 3
  let w = img.width
  let h = img.height
  if (w / h > ar) w = h * ar
  else h = w / ar
  const sx = (img.width - w) / 2
  const sy = (img.height - h) / 2
  const scale = Math.min(1, 1440 / Math.max(w, h))
  const W = Math.round(w * scale)
  const H = Math.round(h * scale)
  const strip = Math.round(H * 0.12)
  const pad = Math.round(W * 0.035)
  const c = document.createElement("canvas")
  c.width = W + pad * 2
  c.height = H + pad + strip
  const g = c.getContext("2d")
  g.fillStyle = "#fbf7ef"
  g.fillRect(0, 0, c.width, c.height)
  g.drawImage(img, sx, sy, w, h, pad, pad, W, H)
  if (golden) {
    // golden hour: a warm glow from the top, a little
    const grad = g.createLinearGradient(0, pad, 0, pad + H)
    grad.addColorStop(0, "rgba(255, 176, 92, 0.22)")
    grad.addColorStop(1, "rgba(255, 140, 70, 0.06)")
    g.globalCompositeOperation = "soft-light"
    g.fillStyle = grad
    g.fillRect(pad, pad, W, H)
    g.globalCompositeOperation = "source-over"
  }
  g.fillStyle = "#3b2f2a"
  g.textAlign = "center"
  g.textBaseline = "middle"
  g.font = `bold ${Math.round(strip * 0.3)}px "Trebuchet MS", "Segoe UI", sans-serif`
  g.fillText(title, c.width / 2, pad + H + strip * 0.4, W)
  g.fillStyle = "#7a6a60"
  g.font = `${Math.round(strip * 0.2)}px "Trebuchet MS", "Segoe UI", sans-serif`
  g.fillText(line, c.width / 2, pad + H + strip * 0.74, W)
  const full = c.toDataURL("image/jpeg", 0.88)
  const blob = await toBlob(c, 0.88)
  // the small one for Our Story (server/couples: at most 320 KB, 1280 px)
  const t = document.createElement("canvas")
  t.width = 480
  t.height = Math.round((480 * c.height) / c.width)
  t.getContext("2d").drawImage(c, 0, 0, t.width, t.height)
  let thumb = t.toDataURL("image/jpeg", 0.8)
  for (let q = 0.7; thumb.length > 300 * 1024 * 1.37 && q > 0.3; q -= 0.15) thumb = t.toDataURL("image/jpeg", q)
  return { full, thumb, blob }
}
