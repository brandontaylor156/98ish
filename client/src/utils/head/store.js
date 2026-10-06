// Be Yourself: your 3D head is one drive file, C:\My Head\head.zip (a LAM avatar). Being a
// drive file it syncs with file sync (its 8 MB online limit; HEAD_MAX_BYTES matches), goes
// to the Recycle Bin, and Delete My Account's drive step erases it: no server route of its
// own. One head per user profile (the drive is per user). A friend's head reaches you only
// during a call where they turned on 3D Me, kept in memory for that call (callLink.js).
import { HEAD_MAX_BYTES, checkHeadFile, headId } from "./headCore.js"

const FOLDER = "My Head"
const NAME = "head.zip"
const fsMod = () => import("../fs.js")

const folder = async (make = false) => {
  const { fs } = await fsMod()
  const c = fs.resolve("C:")
  let dir = c?.getItem(FOLDER)
  if (!dir && make) dir = fs.createDirectoryIn(c, FOLDER)
  return dir || null
}

const headFile = async () => (await folder())?.getItem(NAME) || null

const toDataUrl = (bytes) =>
  new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = () => reject(new Error("The head file couldn't be read."))
    r.readAsDataURL(new Blob([bytes], { type: "application/zip" }))
  })

// { id, source, at, bytes } | null
let cache = null
export const loadMyHead = async () => {
  const f = await headFile()
  if (!f) return (cache = null)
  if (cache && cache.at === f.meta?.at) return cache
  const { readContent } = await fsMod()
  const url = await readContent(f)
  if (!url) return null
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer())
  cache = { id: headId(bytes), source: f.meta?.source || "import", at: f.meta?.at || 0, bytes }
  return cache
}

export const hasMyHead = async () => !!(await headFile())

// names of the files in a zip (central directory), to check it's a LAM avatar
export const zipNames = async (bytes) => {
  try {
    const { default: JSZip } = await import(/* @vite-ignore */ "https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm")
    const z = await JSZip.loadAsync(bytes)
    return Object.keys(z.files)
  } catch {
    return null // couldn't look inside: the renderer will tell
  }
}

// save (or replace) your head; returns { ok, error? }
export const saveMyHead = async (bytes, { source = "import" } = {}) => {
  const check = checkHeadFile(bytes, await zipNames(bytes))
  if (!check.ok) return check
  const { fs, writeAndSave, saveNow, FILE_TYPE } = await fsMod()
  const dir = await folder(true)
  const old = dir.getItem(NAME)
  if (old) {
    try {
      fs.deleteItem(old)
    } catch {}
  }
  const file = fs.createFileIn(dir, NAME, FILE_TYPE.head3d, "")
  file.meta = { source, at: Date.now(), size: bytes.length }
  const ok = await writeAndSave(file, await toDataUrl(bytes), { created: true })
  if (!ok) return { ok: false, error: "Drive C: is full, so your head wasn't saved. Delete some photos or videos and try again." }
  await saveNow({ quiet: true })
  cache = null
  return { ok: true }
}

export const deleteMyHead = async () => {
  const f = await headFile()
  if (!f) return false
  const { fs, saveNow } = await fsMod()
  fs.deleteItem(f)
  await saveNow({ quiet: true })
  cache = null
  return true
}

export const SAMPLE_HEAD_URL = "/vendor/lam/sample-head.zip"
export const fetchSampleHead = async () => new Uint8Array(await (await fetch(SAMPLE_HEAD_URL)).arrayBuffer())
export { HEAD_MAX_BYTES }
