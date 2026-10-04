// The rules for sharing between 98ish and the phone, with no browser or drive in them (so
// they can be tested in Node): what a share sends, what a browser can do with it, and
// where things shared INTO 98ish go. utils/share.js and utils/receive.js do the work.

// ---------- out: Send To > My Phone / Other Apps... ----------

// A share payload: { title, text, url, files: [{ name, data, mime }], preferText }
//   files       what a file share carries (data is a string or bytes)
//   text / url  what a text share carries
//   preferText  Other Apps... shares the text, not the file (a Notepad note into
//               Messages reads better as words than as an attachment)

// What the browser offers: { share: navigator.share exists, files: it can share these files }
// -> "share" (the system share sheet), "download", "copy" or "none"
//   "phone": save to the phone (the share sheet's Save Image / Save to Files)
//   "apps":  hand it to another app (Messages, Mail, WhatsApp...)
export const planShare = (env, payload, mode = "apps") => {
  const files = payload?.files || []
  const words = !!(payload?.text || payload?.url)
  const wantsText = mode === "apps" && words && (payload.preferText || !files.length)
  if (wantsText) return env.share ? "share" : "copy"
  if (files.length) return env.share && env.files ? "share" : "download"
  if (words) return env.share ? "share" : "copy"
  return "none"
}

// The object handed to navigator.share for a plan of "share". makeFile turns
// { name, data, mime } into a File (the browser's File, or a stand-in in tests).
export const shareData = (payload, mode, makeFile) => {
  const files = payload.files || []
  const words = !!(payload.text || payload.url)
  if (mode === "apps" && words && (payload.preferText || !files.length)) {
    const out = {}
    if (payload.title) out.title = payload.title
    if (payload.text) out.text = payload.text
    if (payload.url) out.url = payload.url
    return out
  }
  if (files.length) {
    const out = { files: files.map(makeFile) }
    // iOS offers Save Image / Save to Files only for a bare file: no title or text then
    if (mode === "apps" && payload.title) out.title = payload.title
    return out
  }
  const out = {}
  if (payload.title) out.title = payload.title
  if (payload.text) out.text = payload.text
  if (payload.url) out.url = payload.url
  return out
}

// What the clipboard gets when copying is the fallback
export const copyTextFor = (payload) => [payload.text, payload.url].filter(Boolean).join(payload.text && payload.url ? "\n" : "") || payload.title || ""

// What the user is told after a fallback (null: nothing to say)
export const fallbackMessage = (how, payload, mode) => {
  const names = (payload.files || []).map((f) => f.name)
  const list = names.length === 1 ? names[0] : `${names.length} files`
  if (how === "download")
    return mode === "phone"
      ? `This browser can't send files to your phone's apps, so ${list} ${names.length === 1 ? "was" : "were"} downloaded instead. On an iPhone, open Safari's Downloads (or the Files app) to find ${names.length === 1 ? "it" : "them"}.`
      : `This browser can't share files with other apps, so ${list} ${names.length === 1 ? "was" : "were"} downloaded instead. Attach ${names.length === 1 ? "it" : "them"} from your Downloads folder.`
  if (how === "copied") return "This browser can't open the share sheet, so it was copied to the clipboard instead. Paste it wherever you like."
  if (how === "copyFailed") return "This browser can't share or copy from here. Select the text and copy it yourself."
  return null
}

// a plain text file for a share: { name, data, mime }
export const textFile = (name, text) => ({ name: safeFileName(name, ".txt"), data: String(text).replace(/\r?\n/g, "\r\n"), mime: "text/plain" })

// a name every phone accepts, with the extension it should have
export const safeFileName = (name, ext = "") => {
  let base = String(name || "")
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, "_")
    .replace(/[. ]+$/, "")
    .trim()
    .slice(0, 80) || "98ish"
  if (ext && !base.toLowerCase().endsWith(ext.toLowerCase())) base += ext
  return base
}

// ---------- in: Received Items (the share target, Upload from Phone, Paste) ----------

const IMAGE_NAME = /\.(png|jpe?g|gif|webp|bmp|heic|heif|avif)$/i
const IMAGE_TYPE = /^image\//i
const SOUND_NAME = /\.(wav|mp3|ogg|oga|m4a|aac|opus|weba)$/i
const RICH_NAME = /\.(html?|rtf)$/i
const TEXT_NAME = /\.(txt|text|md|markdown|log|csv|tsv|json|js|mjs|ts|jsx|css|ini|cfg|conf|xml|yml|yaml|bat|cmd|sh|py|c|h|cpp|java|sql|srt|nfo|diz|vcf|ics)$/i

// A file from the phone -> "image" | "sound" | "richtext" | "text" | null (can't come in)
export const incomingKind = ({ name = "", type = "" } = {}) => {
  if (RICH_NAME.test(name) || type === "text/html" || /rtf$/i.test(type)) return "richtext"
  if (IMAGE_NAME.test(name) || IMAGE_TYPE.test(type)) return "image"
  if (SOUND_NAME.test(name) || type.startsWith("audio/")) return "sound"
  if (TEXT_NAME.test(name) || type.startsWith("text/") || type === "application/json") return "text"
  return null
}

export const PICTURES = ["C:", "My Pictures"]
export const DOCUMENTS = ["C:", "Documents"]
export const DESKTOP = ["C:", "Desktop"]

// Where a received file goes: pictures to My Pictures, everything else to My Documents
export const destinationFor = (kind) => (kind === "image" ? PICTURES : DOCUMENTS)

// "C:\\My Pictures"
export const pathLabel = (parts) => (parts.length === 1 ? `${parts[0]}\\` : parts.join("\\"))

const URL_RE = /\bhttps?:\/\/[^\s<>"']+/i

// the first web address in some text, without trailing punctuation
export const findUrl = (text) => {
  const m = URL_RE.exec(String(text || ""))
  if (!m) return null
  return m[0].replace(/[).,;:!?\]}>]+$/, "")
}

const NAME_BAD = /[\\/:"<>|\u0000-\u001F]/g

// An Internet Shortcut's name: the page title, else the site's name
export const shortcutName = (title, url) => {
  const clean = String(title || "")
    .replace(NAME_BAD, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (clean && !/^\s*https?:/i.test(String(title))) return clean.slice(0, 60).trim()
  try {
    const host = new URL(url).hostname.replace(/^www\./, "")
    return host.slice(0, 60) || "Web Page"
  } catch {
    return "Web Page"
  }
}

// A Notepad document's name for shared text: its title, else its first words
export const noteName = (title, text) => {
  const pick = (s) =>
    String(s || "")
      .replace(NAME_BAD, " ")
      .replace(/\s+/g, " ")
      .trim()
  const fromTitle = pick(title)
  if (fromTitle) return fromTitle.slice(0, 40).trim()
  const words = pick(text).split(" ").slice(0, 5).join(" ")
  return words ? words.slice(0, 40).trim() : "Shared Text"
}

// What arrived ({ title, text, url, files: [File-like] }) -> what to do with each part:
//   { kind: "image" | "sound" | "richtext" | "text", file, name, dest }   a file to save
//   { kind: "unsupported", file, name }                                   can't come in
//   { kind: "link", url, name }                                           a web address
//   { kind: "note", text, name }                                          words for Notepad
export const planReceived = ({ title = "", text = "", url = "", files = [] } = {}) => {
  const out = []
  for (const file of files || []) {
    if (!file || (!file.name && !file.size)) continue
    const kind = incomingKind(file)
    out.push(kind ? { kind, file, name: file.name || "Shared file", dest: destinationFor(kind) } : { kind: "unsupported", file, name: file.name || "Shared file" })
  }
  // Android puts a shared page's address in text more often than in url
  const link = findUrl(url) || findUrl(text)
  let rest = String(text || "")
  if (link) {
    out.push({ kind: "link", url: link, name: shortcutName(title, link) })
    rest = rest.replace(link, "")
  }
  rest = rest.trim()
  // what's left, if it's more than the title again
  if (rest && rest !== String(title || "").trim()) out.push({ kind: "note", text: rest, name: noteName(link ? "" : title, rest) })
  else if (!link && !out.length && String(title || "").trim()) out.push({ kind: "note", text: String(title).trim(), name: noteName("", title) })
  return out
}

// Pasted text: a lone web address becomes a shortcut, anything else a text document
export const planPastedText = (text) => {
  const value = String(text || "").trim()
  if (!value) return null
  const link = findUrl(value)
  if (link && link === value) return { kind: "link", url: link, name: shortcutName("", link) }
  return { kind: "note", text: value, name: "Pasted Text" }
}
