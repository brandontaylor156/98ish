import { DIRECTORY_TYPE, FILE_TYPE, fs, uniqueName, writeAndSave } from "./fs"
import { convertUpload } from "./fileTransfer"
import { mediaKindOf } from "./mediaRules"
import { decodeUpload, savePicture, uploadName } from "../components/applets/photos/library"
import { planPastedText } from "./shareRules"
import { readClipboard } from "./systemClipboard"

// Things from the phone landing in the 98ish drive: shared to 98ish (the share target),
// picked with Upload from Phone, or pasted. Pictures become JPEGs (like Camera's, so
// two dozen fit); text and web pages go through the upload converter; songs, videos and PDFs
// are kept exactly as they came (utils/mediaFiles.js: full length, no conversion).

// A folder by path, made (with any missing parents) if it isn't there
export const folderAt = (parts) => {
  let dir = fs.root
  for (const part of parts) {
    let next = dir.getItem(part)
    if (!next || !next.isDirectory) next = fs.createDirectoryIn(dir, uniqueName(dir, part), part === "C:" ? DIRECTORY_TYPE.drive : DIRECTORY_TYPE.folder)
    dir = next
  }
  return dir
}

const isPicture = (file) => /^image\//i.test(file.type || "") || /\.(png|jpe?g|gif|webp|bmp|heic|heif|avif)$/i.test(file.name || "")

// One real file into a folder -> { ok: true, file, note } | { ok: false, error }
export const saveIncoming = async (dir, file) => {
  if (isPicture(file)) {
    try {
      const picture = await decodeUpload(file)
      const result = await savePicture(dir, uploadName(file.name || "Photo"), picture.data, { taken: picture.taken })
      return result.ok ? { ok: true, file: result.file } : { ok: false, error: result.error }
    } catch (error) {
      return { ok: false, error: error.message || `${file.name} couldn't be opened as a picture.` }
    }
  }
  const media = mediaKindOf(file)
  // songs and other audio: kept whole (not cut to a 30-second WAV), playable in Music 98
  if (media === "song") {
    const { importSongs } = await import("../components/applets/music/musicStore")
    const result = await importSongs([file], null, dir)
    return result.added.length ? { ok: true, file: result.added[0].file, note: result.notes?.[0] || null } : { ok: false, error: result.problems[0] || `${file.name} couldn't be added.` }
  }
  // videos (Media Player's Videos) and PDFs (PDF Viewer): the original file
  if (media === "movie" || media === "pdf") {
    const { keepMediaFile } = await import("./mediaFiles")
    const result = await keepMediaFile(dir, file, { kind: media })
    if (!result.ok) return result
    if (media === "movie") import("../components/applets/mediaPlayer/videoStore").then((m) => m.describeVideo(result.file)).catch(() => {})
    return { ok: true, file: result.file, note: result.note }
  }
  let converted
  try {
    converted = await convertUpload(file)
  } catch (error) {
    return { ok: false, error: `${file.name || "That file"} ${error.message || "couldn't be read"}.` }
  }
  const made = fs.createFileIn(dir, uniqueName(dir, converted.name), converted.type, "")
  if (!(await writeAndSave(made, converted.content, { created: true }))) {
    return { ok: false, error: `${file.name} didn't fit: drive C: is full. Delete some pictures or sounds (and empty the Recycle Bin), then try again.` }
  }
  return { ok: true, file: made, note: converted.note }
}

// Many files into one folder -> { added: [File], problems: [text], notes: [text] }
export const receiveFiles = async (dir, files, onProgress) => {
  const added = []
  const problems = []
  const notes = []
  const list = [...files]
  for (let i = 0; i < list.length; i++) {
    onProgress?.(i, list.length)
    const result = await saveIncoming(dir, list[i])
    if (result.ok) {
      added.push(result.file)
      if (result.note) notes.push(result.note)
    } else problems.push(result.error)
  }
  return { added, problems, notes }
}

// An Internet Shortcut to a web address
export const saveLink = async (dir, name, url) => {
  const made = fs.createFileIn(dir, uniqueName(dir, name), FILE_TYPE.internet, "")
  if (!(await writeAndSave(made, url, { created: true }))) throw new Error("Drive C: is full, so the shortcut wasn't saved.")
  return made
}

// Words into a text document
export const saveNote = async (dir, name, text) => {
  const made = fs.createFileIn(dir, uniqueName(dir, name), FILE_TYPE.text, "")
  if (!(await writeAndSave(made, String(text).replace(/\r?\n/g, "\r\n"), { created: true }))) throw new Error("Drive C: is full, so the text wasn't saved.")
  return made
}

// Pictures and/or text from a clipboard into a folder -> { added, problems, notes }
export const savePasted = async (dir, { images = [], text = "" }) => {
  const named = images.map((blob, i) => (blob instanceof File && blob.name && blob.name !== "image.png" ? blob : new File([blob], `Pasted Picture${i ? ` ${i + 1}` : ""}.png`, { type: blob.type || "image/png" })))
  const result = named.length ? await receiveFiles(dir, named) : { added: [], problems: [], notes: [] }
  if (!named.length) {
    const plan = planPastedText(text)
    try {
      if (plan?.kind === "link") result.added.push(await saveLink(dir, plan.name, plan.url))
      else if (plan) result.added.push(await saveNote(dir, plan.name, plan.text))
    } catch (error) {
      result.problems.push(error.message)
    }
  }
  return result
}

// Edit > Paste from Device Clipboard: read the system clipboard (the browser may ask, or
// say no) -> { added, problems, notes } | { error }
export const pasteFromDevice = async (dir) => {
  const clip = await readClipboard()
  if (!clip.ok) return { error: clip.message }
  if (!clip.images.length && !String(clip.text || "").trim()) return { error: "The clipboard is empty (or holds something 98ish can't paste: pictures and text can come in)." }
  return savePasted(dir, clip)
}

// A short "what happened" for upload/paste results, or null when it all just worked
export const summarize = ({ added, problems, notes }, verb = "added") => {
  if (!problems.length && !notes.length) return null
  const lead = added.length ? `${added.length} item${added.length === 1 ? " was" : "s were"} ${verb}. ` : problems.length ? `Nothing was ${verb}. ` : ""
  return lead + [...problems, ...notes].join(" ")
}
