import { fs, uniqueName, FILE_TYPE, DIRECTORY_TYPE } from "./fs"
import { hyperlinks } from "./hyperlinks"
import { copyImage, copyText } from "./systemClipboard"

// File operations shared by My Computer windows and the desktop: one clipboard for all
// of them, paste, moving by drag and drop, and shortcuts.

let clipboard = null // { mode: "cut" | "copy", items: [Item] }
export const getClipboard = () => clipboard
export const setClipboard = (value) => {
  clipboard = value
  if (value?.items?.length === 1) mirrorToSystem(value.items[0])
  return value
}

// Copying a file also puts what's in it on the phone's/computer's own clipboard, so it
// can be pasted into other apps: a text document's words, a shortcut's web address, a
// picture. (Called inside the tap, which iOS needs.) Other files leave it alone.
export const mirrorToSystem = (item) => {
  if (!item || item.isDirectory || typeof navigator === "undefined") return
  try {
    if (item.type === FILE_TYPE.text || item.type === FILE_TYPE.note) copyText(item.textContent || "").catch(() => {})
    else if (item.type === FILE_TYPE.internet) {
      const url = hyperlinks[item.name] || item.textContent
      if (url) copyText(url).catch(() => {})
    } else if (item.type === FILE_TYPE.image && /^data:image\//.test(item.textContent || "")) copyImage(item.textContent).catch(() => {})
  } catch {
    // the system clipboard is a bonus: the 98ish one still works
  }
}

// Pastes the clipboard into a folder; returns the last item pasted. Throws on trouble.
export const pasteInto = (dir) => {
  if (!clipboard) return null
  let last = null
  for (const item of clipboard.items) {
    if (clipboard.mode === "copy") {
      const dupe = item.copy
      dupe.name = uniqueName(dir, item.name)
      dir.insertItem(dupe)
      last = dupe
    } else {
      moveInto(item, dir)
      last = item
    }
  }
  if (clipboard.mode === "cut") clipboard = null
  return last
}

export const moveInto = (item, dir) => {
  if (item.parent === dir) return item
  if (!item.parent || item.type === DIRECTORY_TYPE.drive) throw new Error("This item can't be moved.")
  for (let p = dir; p; p = p.parent) if (p === item) throw new Error("The destination folder is inside the folder you're moving.")
  item.parent.removeItem(item.name)
  item.name = uniqueName(dir, item.name)
  dir.insertItem(item)
  return item
}

// The folder whose contents show on the desktop (made again if it was deleted)
export const desktopFolder = () => {
  const found = fs.resolve("C:/Desktop")
  if (found?.isDirectory) return found
  return fs.createDirectoryIn(fs.resolve("C:"), uniqueName(fs.resolve("C:"), "Desktop"), DIRECTORY_TYPE.desktop)
}

export const createShortcut = (item, dir) => {
  const label = item.name.replace(/[\/:"<>|]/g, "").trim() || "Local Disk"
  return fs.createFileIn(dir, uniqueName(dir, `Shortcut to ${label}`), FILE_TYPE.shortcut, fs.displayPath(item))
}

// what a drag from My Computer carries
export const DRAG_TYPE = "application/x-98ish-path"
