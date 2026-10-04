import { DIRECTORY_TYPE, DISK_FULL, FILE_TYPE, fs, storageInfo, uniqueName, writeAndSave } from "../../../utils/fs"
import { MAX_CHARS, MAX_SIDE, SMALL_DRIVE_CHARS, SMALL_DRIVE_SIDE, fitEncode, fitScale, isHeic } from "./photoMath.js"

export * from "./photoMath.js"

// The picture library Camera and Photos share: C:\My Pictures, photo names, squeezing
// photos into JPEGs (up to 2048 pixels and about 400 KB; smaller in the 5 MB fallback drive
// some private windows get), and bringing photos in from the real device.

export const PICTURES = ["C:", "My Pictures"]

// how big a photo may be on this drive: { maxSide, maxChars }
export const photoLimits = () => (storageInfo().mode === "idb" ? { maxSide: MAX_SIDE, maxChars: MAX_CHARS } : { maxSide: SMALL_DRIVE_SIDE, maxChars: SMALL_DRIVE_CHARS })

// C:\My Pictures, made again if it was deleted
export const picturesFolder = () => {
  let dir = fs.root
  for (const part of PICTURES) {
    let next = dir.getItem(part)
    if (!next || !next.isDirectory) next = fs.createDirectoryIn(dir, part === "C:" ? part : uniqueName(dir, part), part === "C:" ? DIRECTORY_TYPE.drive : DIRECTORY_TYPE.folder)
    dir = next
  }
  return dir
}

// ---- fitting a picture into the drive ----

// A canvas (or anything drawable: img, video, bitmap) -> { data, width, height }
export const toJpeg = (source, { maxSide = photoLimits().maxSide, maxChars = photoLimits().maxChars, keepPng = false } = {}) => {
  const w = source.naturalWidth || source.videoWidth || source.width
  const h = source.naturalHeight || source.videoHeight || source.height
  const canvas = document.createElement("canvas")
  const ctx = canvas.getContext("2d")
  let size = { width: w, height: h }
  const encode = (quality, scale) => {
    canvas.width = Math.max(1, Math.round(w * scale))
    canvas.height = Math.max(1, Math.round(h * scale))
    size = { width: canvas.width, height: canvas.height }
    ctx.fillStyle = "#fff"
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.imageSmoothingQuality = "high"
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
    return keepPng ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", quality)
  }
  if (keepPng) {
    const png = encode(1, fitScale(w, h, maxSide))
    if (png.length <= maxChars * 2) return { data: png, ...size }
  }
  const { data } = fitEncode(encode, { maxChars, scale: fitScale(w, h, maxSide) })
  return { data, ...size }
}

export const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error("That picture couldn't be opened."))
    img.src = src
  })

// ---- saving ----

// Save a picture into a folder under a name (made unique).
// Resolves { ok, file } | { ok: false, error }
export const savePicture = async (dir, name, data) => {
  let file
  try {
    file = fs.createFileIn(dir, uniqueName(dir, name), FILE_TYPE.image, "")
  } catch (error) {
    return { ok: false, error: error.message }
  }
  if (!(await writeAndSave(file, data, { created: true }))) return { ok: false, error: DRIVE_FULL }
  return { ok: true, file }
}

export const DRIVE_FULL = `The picture wasn't saved. ${DISK_FULL} You can also download pictures to your device first.`

// ---- browsing ----

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" })
export const byName = (a, b) => collator.compare(a.name, b.name)

// the pictures in a folder, sorted by name
export const imagesIn = (dir) => (dir?.isDirectory ? dir.content.filter((item) => item.isImage).sort(byName) : [])

// Every folder on C: with pictures in it, plus My Pictures and the Desktop: [{ dir, count }]
export const pictureFolders = () => {
  const out = []
  const walk = (dir) => {
    const count = dir.content.filter((item) => item.isImage).length
    if (count) out.push({ dir, count })
    for (const item of dir.content) if (item.isDirectory) walk(item)
  }
  const drive = fs.resolve("C:")
  if (drive?.isDirectory) walk(drive)
  for (const path of ["C:/My Pictures", "C:/Desktop"]) {
    const dir = fs.resolve(path)
    if (dir?.isDirectory && !out.some((f) => f.dir === dir)) out.push({ dir, count: 0 })
  }
  const pics = fs.resolve("C:/My Pictures")
  return out.sort((a, b) => (a.dir === pics ? -1 : b.dir === pics ? 1 : fs.displayPath(a.dir).localeCompare(fs.displayPath(b.dir))))
}

// ---- from the real device ----

// A picture file from the device (file input, drop) -> { data, width, height } or throws
// an Error with a message for the user. HEIC (iPhone) works where the browser can read it.
export const decodeUpload = async (file, { maxSide = photoLimits().maxSide, maxChars = photoLimits().maxChars } = {}) => {
  const heic = isHeic(file)
  if (!heic && file.type && !file.type.startsWith("image/")) throw new Error(`${file.name} isn't a picture.`)
  if (file.size > 40 * 1024 * 1024) throw new Error(`${file.name} is too big (over 40 MB).`)
  const url = URL.createObjectURL(file)
  try {
    let img
    try {
      img = await loadImage(url)
    } catch {
      throw new Error(
        heic
          ? `${file.name} is an iPhone HEIC photo, which this browser can't open. Pick it from your iPhone's photo library in Safari (it turns into a JPEG on the way), or on the iPhone set Settings > Camera > Formats to Most Compatible.`
          : `${file.name} couldn't be opened as a picture.`
      )
    }
    return toJpeg(img, { maxSide, maxChars })
  } finally {
    URL.revokeObjectURL(url)
  }
}
