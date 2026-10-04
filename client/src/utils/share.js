import { contentReady, readContent } from "./fs"
import { downloadBlob, exportFile } from "./fileTransfer"
import { hyperlinks } from "./hyperlinks"
import { copyText } from "./systemClipboard"
import { copyTextFor, fallbackMessage, planShare, shareData, textFile } from "./shareRules"

export { textFile }

// Send To > My Phone / Other Apps...: the phone's share sheet (Web Share API), or a
// download / the clipboard where the browser has no share sheet or can't share files
// (desktop Firefox, older browsers). Always call shareOut straight from the tap or click:
// iOS only opens the share sheet while the tap is still "fresh", so everything it sends
// is made synchronously here (no awaits before navigator.share).

// A message for the user (shown by ShareCenter as a 98 dialog)
export const notify = (title, text) => window.dispatchEvent(new CustomEvent("98ish:notice", { detail: { title, text } }))

const makeFile = ({ name, data, mime }) => new File([data], name, { type: mime || "application/octet-stream" })

const env = (data) => {
  const share = typeof navigator.share === "function"
  let files = false
  if (share && data?.files?.length) {
    try {
      files = typeof navigator.canShare === "function" ? navigator.canShare({ files: data.files }) : false
    } catch {
      files = false
    }
  }
  return { share, files }
}

// payload: see shareRules.js. mode: "phone" | "apps". -> Promise<"shared" | "cancelled" |
// "downloaded" | "copied" | "failed">; fallbacks tell the user what happened.
export const shareOut = (payload, mode = "apps", { title = "Send To" } = {}) => {
  if (!payload || payload.error) {
    notify(title, payload?.error || "There's nothing to send.")
    return Promise.resolve("failed")
  }
  // the File objects are made first, so canShare can look at the real thing
  const files = (payload.files || []).map(makeFile)
  const probe = env({ files })
  const plan = planShare(probe, payload, mode)
  const fallback = (how) => {
    if (how === "download") {
      for (const f of payload.files) downloadBlob(f.data, f.name, f.mime)
      notify(title, fallbackMessage("download", payload, mode))
      return Promise.resolve("downloaded")
    }
    if (how === "copy") {
      return copyText(copyTextFor(payload)).then((ok) => {
        notify(title, fallbackMessage(ok ? "copied" : "copyFailed", payload, mode))
        return ok ? "copied" : "failed"
      })
    }
    notify(title, "There's nothing to send.")
    return Promise.resolve("failed")
  }
  if (plan !== "share") return fallback(plan)
  const data = shareData(payload, mode, (f) => files[payload.files.indexOf(f)] || makeFile(f))
  let pending
  try {
    pending = navigator.share(data)
  } catch (error) {
    pending = Promise.reject(error)
  }
  return pending.then(
    () => "shared",
    (error) => {
      if (error?.name === "AbortError") return "cancelled" // closed the share sheet
      // NotAllowedError (the tap went stale) or a type the phone won't take: fall back
      return fallback(data.files ? "download" : "copy")
    }
  )
}

// ---- payloads ----

// Start loading a file's contents (big files load lazily) so they're there when the tap comes:
// sharing must start inside the tap, with nothing awaited first
export const warmItem = (item) => {
  if (item && !item.isDirectory && !contentReady(item)) readContent(item).catch(() => {})
}

// A file or folder in the 98ish drive
export const itemPayload = (item) => {
  if (!item) return { error: "Select a file first." }
  if (!item.isDirectory && !contentReady(item)) {
    warmItem(item)
    return { error: "Getting the file ready... Try Send To again in a moment." }
  }
  if (item.isDirectory) return { error: "Folders can't be sent to the phone. Send the files inside it, or use Download to get the whole folder as a .zip." }
  if (item.type === "internet") {
    const url = hyperlinks[item.name] || item.textContent
    if (!url) return { error: "This shortcut doesn't point anywhere." }
    return { title: item.name, url, files: [], preferText: true }
  }
  const out = exportFile(item)
  if (out.error) return { error: out.error }
  const text = item.type === "text" || item.type === "note" ? item.textContent || "" : ""
  return { title: item.name, files: [out], text, preferText: !!text }
}

// Words (results, a note): shared as text; My Phone saves them as a .txt file
export const textPayload = (title, text, { url, fileName } = {}) => ({
  title,
  text,
  url,
  files: [textFile(fileName || title, url ? `${text}\n${url}` : text)],
  preferText: true,
})

// A ready-made file (a picture from Paint, a sound, an .ics)
export const filePayload = (title, file, extra = {}) => ({ title, files: [file], ...extra })

// Send To submenu entries for a payload made on demand (inside the tap)
export const sendToItems = (getPayload, { title = "Send To", disabled = false } = {}) => [
  { label: "My Phone", disabled, onClick: () => shareOut(getPayload(), "phone", { title }) },
  { label: "Other Apps...", disabled, onClick: () => shareOut(getPayload(), "apps", { title }) },
]
