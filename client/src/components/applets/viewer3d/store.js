// 3D models on drive C:, in C:\My 3D (FILE_TYPE.model3d: the .glb/.gltf bytes as a data URL in
// textContent, like photos). Drive files sync like any other (file sync's own caps), go to the
// Recycle Bin, and Delete My Account's drive step erases them: no server route of their own.
// At most MAX_MODELS (the oldest goes). meta: { title, source: "photo" | "rigged" | "import"
// | "message", at, tris }.
import { FOLDER, MAX_MODELS, modelName, nextModels } from "./core.js"

const fsMod = () => import("../../../utils/fs.js")

const folder = async (make = false) => {
  const { fs } = await fsMod()
  const c = fs.resolve("C:")
  let dir = c?.getItem(FOLDER)
  if (!dir && make) dir = fs.createDirectoryIn(c, FOLDER)
  return dir || null
}

export const listModels = async () => {
  const dir = await folder()
  if (!dir) return []
  return dir.content
    .filter((f) => !f.isDirectory && f.type === "model3d")
    .map((f) => ({ name: f.name, title: f.meta?.title || f.name.replace(/\.(glb|gltf)$/i, ""), source: f.meta?.source || "import", at: f.meta?.at || f.mtime || 0, tris: f.meta?.tris || 0, file: f }))
    .sort((a, b) => b.at - a.at)
}

export const pathOf = async (file) => {
  const { fs } = await fsMod()
  return fs.partsOf(file).join("/")
}

export const fileAt = async (path) => {
  const { fs } = await fsMod()
  try {
    const f = fs.resolve(path)
    return f && !f.isDirectory ? f : null
  } catch {
    return null
  }
}

const toDataUrl = (bytes, mime) =>
  new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = () => reject(new Error("The model couldn't be read."))
    r.readAsDataURL(new Blob([bytes], { type: mime }))
  })

export const readModel = async (file) => {
  const { readContent } = await fsMod()
  const url = await readContent(file)
  if (!url) throw new Error("That model's contents aren't on this device yet (file sync is still bringing them down).")
  const res = await fetch(url)
  return new Uint8Array(await res.arrayBuffer())
}

// save a model; returns { ok, file, path } | { ok: false, error }
export const saveModel = async (bytes, { title = "Model", format = "glb", source = "import", tris = 0 } = {}) => {
  const { fs, writeAndSave, saveNow, FILE_TYPE, uniqueName } = await fsMod()
  const dir = await folder(true)
  const all = await listModels()
  const name = uniqueName(dir, modelName(title, format))
  const meta = { title: String(title || "Model").slice(0, 40), source, at: Date.now(), tris }
  const { drop } = nextModels(all, { name, ...meta }, MAX_MODELS)
  for (const m of drop) {
    try {
      fs.deleteItem(m.file)
    } catch {}
  }
  const file = fs.createFileIn(dir, name, FILE_TYPE.model3d, "")
  file.meta = meta
  const ok = await writeAndSave(file, await toDataUrl(bytes, format === "gltf" ? "model/gltf+json" : "model/gltf-binary"), { created: true })
  if (!ok) return { ok: false, error: "Drive C: is full, so the model wasn't saved. Delete some photos or videos and try again." }
  await saveNow({ quiet: true })
  return { ok: true, file, path: fs.partsOf(file).join("/") }
}

// the model My Park shows next to you (a drive path), or null
const PET_KEY = "98ish.park.pet"
export const getPet = () => {
  try {
    return localStorage.getItem(PET_KEY) || null
  } catch {
    return null
  }
}
export const setPet = (path) => {
  try {
    if (path) localStorage.setItem(PET_KEY, path)
    else localStorage.removeItem(PET_KEY)
  } catch {}
}
