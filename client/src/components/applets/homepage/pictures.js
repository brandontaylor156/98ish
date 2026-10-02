// Pictures from the 98ish drive, made small enough for a homepage: scaled down to fit
// `max` pixels and re-encoded (PNG, or JPEG when that's much smaller) under `budget`
// bytes. The server checks the result again.

const decodedBytes = (dataUrl) => Math.floor(((dataUrl.length - dataUrl.indexOf(",") - 1) * 3) / 4)

export const shrinkPicture = (dataUrl, { max = 480, budget = 140 * 1024 } = {}) =>
  new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      let scale = Math.min(1, max / Math.max(img.naturalWidth || 1, img.naturalHeight || 1))
      const canvas = document.createElement("canvas")
      const ctx = canvas.getContext("2d")
      for (let attempt = 0; attempt < 8; attempt++) {
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.imageSmoothingQuality = "high"
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        const png = canvas.toDataURL("image/png")
        if (decodedBytes(png) <= budget) return resolve({ src: png, width: canvas.width, height: canvas.height })
        // JPEG has no transparency: paint white behind it
        ctx.globalCompositeOperation = "destination-over"
        ctx.fillStyle = "#fff"
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.globalCompositeOperation = "source-over"
        const jpeg = canvas.toDataURL("image/jpeg", 0.82)
        if (decodedBytes(jpeg) <= budget) return resolve({ src: jpeg, width: canvas.width, height: canvas.height })
        scale *= 0.7
      }
      reject(new Error("That picture is too detailed to fit on a homepage."))
    }
    img.onerror = () => reject(new Error("That picture couldn't be opened."))
    img.src = dataUrl
  })

export { decodedBytes }
