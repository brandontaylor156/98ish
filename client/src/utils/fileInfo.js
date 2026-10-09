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
  item.type === "image" && /^data:image\/jpe?g/i.test(item.head || "")
    ? "JPEG Image"
    : item.isDirectory
    ? { drive: "Local Disk", documents: "File Folder", bookmarks: "File Folder", programs: "File Folder" }[item.type] || "File Folder"
    : { text: "Text Document", note: "Text Document", internet: "Internet Shortcut", shortcut: "Shortcut", image: "Bitmap Image", music: "MIDI Sequence", song: "Song", movie: "Video Clip", pdf: "PDF Document", sheet: "Sheets 98 Workbook", richtext: "Rich Text Document", sound: "Wave Sound", vcard: "vCard File", swf: "Flash Movie", dossave: "Saved Game", dosgame: "MS-DOS Application" }[item.type] || "Application"

// drive-sized numbers: "512 KB", "12.4 MB", "1.2 GB"
export const formatBytes = (bytes) => {
  const n = Math.max(0, Number(bytes) || 0)
  if (n < 1024) return `${n} bytes`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(n < 100 * 1024 * 1024 ? 1 : 0)} MB`
  return `${(n / 1024 ** 3).toFixed(1)} GB`
}

export const formatSize = (bytes) => (bytes < 1024 ? `${bytes} bytes` : `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`)
