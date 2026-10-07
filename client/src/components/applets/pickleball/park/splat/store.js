// Venue backdrops on drive C:: one splat file per venue in C:\My Splats, with its
// placement in the file's meta. Being drive files, they sync like other files (file sync's
// own caps and Blob budgets: files up to 8 MB here go online, bigger ones stay on this
// device), go to the Recycle Bin, and Delete My Account's drive step removes them: no
// server route of its own. At most MAX_BACKDROPS per person (the oldest goes).
import { MAX_BACKDROPS } from "./files.js"

const FOLDER = "My Splats"

// pure: the list after adding/replacing one (newest first), and what to drop
export const nextBackdrops = (list, add, max = MAX_BACKDROPS) => {
  const others = list.filter((b) => b.venue !== add.venue).sort((a, b) => (b.at || 0) - (a.at || 0))
  const replaced = list.filter((b) => b.venue === add.venue)
  const keep = [add, ...others].slice(0, max)
  const drop = [...replaced, ...others.slice(max - 1)]
  return { keep, drop }
}

const fsMod = () => import("../../../../../utils/fs.js")

const folder = async (make = false) => {
  const { fs } = await fsMod()
  const c = fs.resolve("C:")
  let dir = c?.getItem(FOLDER)
  if (!dir && make) dir = fs.createDirectoryIn(c, FOLDER)
  return dir || null
}

export const listBackdrops = async () => {
  const dir = await folder()
  if (!dir) return []
  // (a "demo" backdrop saved before 2026-10-06 was made-up hills and buildings: never shown now)
  return dir.content.filter((f) => !f.isDirectory && f.meta?.venue && f.meta.source !== "demo").map((f) => ({ ...f.meta, file: f }))
}

export const getBackdrop = async (venue) => (await listBackdrops()).find((b) => b.venue === venue) || null

const toDataUrl = (bytes) =>
  new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = () => reject(new Error("The splat couldn't be read."))
    r.readAsDataURL(new Blob([bytes], { type: "application/octet-stream" }))
  })

export const readBytes = async (file) => {
  const { readContent } = await fsMod()
  const url = await readContent(file)
  const res = await fetch(url)
  return new Uint8Array(await res.arrayBuffer())
}

// save (or replace) a venue's backdrop; returns { ok, error? }
export const saveBackdrop = async (venue, bytes, { format, transform = null, splats = 0, source = "import", title = "" } = {}) => {
  const { fs, writeAndSave, saveNow, FILE_TYPE, uniqueName } = await fsMod()
  const dir = await folder(true)
  const all = await listBackdrops()
  const meta = { venue, format, transform, splats, source, title, at: Date.now() }
  const { drop } = nextBackdrops(all, meta)
  for (const b of drop) {
    try {
      fs.deleteItem(b.file)
    } catch {}
  }
  const name = uniqueName(dir, `${venue}.${format}`)
  const file = fs.createFileIn(dir, name, FILE_TYPE.splat, "")
  file.meta = meta
  const ok = await writeAndSave(file, await toDataUrl(bytes), { created: true })
  if (!ok) return { ok: false, error: "Drive C: is full, so the backdrop wasn't saved. Delete some photos or videos and try again." }
  await saveNow({ quiet: true })
  return { ok: true, file }
}

export const setPlacement = async (venue, transform) => {
  const b = await getBackdrop(venue)
  if (!b) return false
  const { saveNow } = await fsMod()
  b.file.meta = { ...b.file.meta, transform, at: Date.now() }
  await saveNow({ quiet: true })
  return true
}

export const removeBackdrop = async (venue) => {
  const b = await getBackdrop(venue)
  if (!b) return false
  const { fs, saveNow } = await fsMod()
  fs.deleteItem(b.file)
  await saveNow({ quiet: true })
  return true
}
