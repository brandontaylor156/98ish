import { DIRECTORY_TYPE, FILE_TYPE, fs, storageInfo, storeMedia, uniqueName, writeAndSave } from "./fs"
import { mediaKindOf, mediaMime, planMediaStore } from "./mediaRules"

// Keeping songs, videos and PDFs exactly as they came (rules and caps: mediaRules.js).
// Small ones become a data URL like a photo (they can sync); big ones are a Blob in the
// drive's IndexedDB and stay on this device (fs.js storeMedia / mediaBlob).

// bytes this browser says are still free for 98ish (null when it won't say)
export const freeBytes = async () => {
  try {
    const estimate = await navigator.storage?.estimate?.()
    return estimate?.quota ? Math.max(0, estimate.quota - (estimate.usage || 0)) : null
  } catch {
    return null
  }
}

const readDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error || new Error("couldn't be read"))
    reader.readAsDataURL(blob)
  })

const cleanName = (name) => String(name || "Untitled").replace(/[\\/:"<>|\u0000-\u001F]/g, "_").trim().slice(0, 120) || "Untitled"

// The folder a kind of media lands in when nobody picked one
export const MEDIA_FOLDERS = { song: ["C:", "My Music"], movie: ["C:", "My Videos"], pdf: ["C:", "Documents"] }
export const mediaFolder = (kind) => {
  let dir = fs.root
  for (const part of MEDIA_FOLDERS[kind] || MEDIA_FOLDERS.pdf) {
    let next = dir.getItem(part)
    if (!next || !next.isDirectory) next = fs.createDirectoryIn(dir, uniqueName(dir, part), part === "C:" ? DIRECTORY_TYPE.drive : DIRECTORY_TYPE.folder)
    dir = next
  }
  return dir
}

// A real file into a folder, untouched -> { ok: true, file, note, deviceOnly } | { ok: false, error }
// kind: "song" | "movie" | "pdf" (worked out from the file when left out)
export const keepMediaFile = async (dir, file, { kind = mediaKindOf(file), name, mime } = {}) => {
  const plan = planMediaStore({ kind, size: file.size, name: file.name || "That file", free: await freeBytes(), canDevice: storageInfo().mode === "idb" })
  if (!plan.ok) return plan
  const type = mime || mediaMime(file, kind)
  let text
  try {
    if (plan.store === "inline") text = (await readDataUrl(file)).replace(/^data:[^;,]*/, `data:${type}`)
    else {
      const stored = await storeMedia(file, { mime: type })
      if (!stored.ok) return { ok: false, error: `${file.name}: ${stored.error}` }
      text = stored.ref
    }
  } catch (error) {
    return { ok: false, error: `${file.name} couldn't be read (${error?.message || "error"}).` }
  }
  const target = dir || mediaFolder(kind)
  const made = fs.createFileIn(target, uniqueName(target, cleanName(name || file.name)), FILE_TYPE[kind], "")
  if (!(await writeAndSave(made, text, { created: true }))) {
    return { ok: false, error: `${file.name} didn't fit: drive C: is full. Delete some files you no longer need (and empty the Recycle Bin), then try again.` }
  }
  return { ok: true, file: made, note: plan.note, deviceOnly: plan.deviceOnly }
}
