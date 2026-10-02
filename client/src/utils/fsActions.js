import { fs, uniqueName, FILE_TYPE, DIRECTORY_TYPE } from "./fs"

// File operations shared by My Computer windows and the desktop: one clipboard for all
// of them, paste, moving by drag and drop, and shortcuts.

let clipboard = null // { mode: "cut" | "copy", items: [Item] }
export const getClipboard = () => clipboard
export const setClipboard = (value) => (clipboard = value)

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
