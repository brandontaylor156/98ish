import { imageMapper } from "./imageMapper"
import { fs } from "./fs"

// How files look and are described in My Computer, the Start menu and search results

export const iconFor = (item) => {
  // a shortcut looks like what it points to (the arrow is drawn on top, see .isShortcut)
  if (item.type === "shortcut") {
    const target = fs.resolve(item.textContent)
    return target && target.type !== "shortcut" ? iconFor(target) : "/assets/" + imageMapper.executable
  }
  return "/assets/" + (imageMapper[item.type] || (item.isDirectory ? imageMapper.folder : imageMapper.text))
}

export const typeName = (item) =>
  item.isDirectory
    ? { drive: "Local Disk", documents: "File Folder", bookmarks: "File Folder", programs: "File Folder" }[item.type] || "File Folder"
    : { text: "Text Document", note: "Text Document", internet: "Internet Shortcut", shortcut: "Shortcut", image: "Bitmap Image", music: "MIDI Sequence" }[item.type] || "Application"

export const formatSize = (bytes) => (bytes < 1024 ? `${bytes} bytes` : `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`)
