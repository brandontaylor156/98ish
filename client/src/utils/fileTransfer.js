import { FILE_TYPE, fs, peekContent, uniqueName, writeAndSave } from "./fs"
import { hyperlinks } from "./hyperlinks"
import { makeZip } from "./zip"

// Getting files out of 98ish (Download to your computer) and in (Upload from your
// computer, or dropping real files on a My Computer window).

// ---------- out ----------

// a name your real computer accepts (98ish allows ? and *)
export const realName = (name) => String(name).replace(/[\\/:*?"<>|\u0000-\u001F]/g, "_").replace(/[. ]+$/, "") || "file"

const withExt = (name, ext) => (name.toLowerCase().endsWith(ext) ? name : name + ext)

export const dataUrlBytes = (url) => {
  const comma = url.indexOf(",")
  const head = url.slice(0, comma)
  const body = url.slice(comma + 1)
  if (!/;base64$/i.test(head)) return new TextEncoder().encode(decodeURIComponent(body))
  const bin = atob(body)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

const escapeHtml = (text) => String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c])

// A WordPad document as a page that opens in any browser
export const richTextPage = (title, html) => `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>body { max-width: 46em; margin: 2em auto; padding: 0 1em; font: 16px/1.4 "Times New Roman", serif; }</style>
</head>
<body>
${html}
</body>
</html>
`

const IMAGE_EXT = { "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp", "image/bmp": ".bmp" }

// Why a file can't go to your computer (null if it can). `text` may be just the start of
// its contents (item.head), so nothing big has to be read to ask.
const exportProblem = (item, text) => {
  switch (item.type) {
    case FILE_TYPE.text:
    case FILE_TYPE.note:
    case "richtext":
      return null
    case FILE_TYPE.image:
      return text.startsWith("data:image/") ? null : "This picture is empty."
    case "sound":
      return text.startsWith("data:audio/") ? null : "This sound is empty."
    case "song":
      return text.startsWith("data:") ? null : "This song is empty."
    case FILE_TYPE.internet:
      return hyperlinks[item.name] || text ? null : "This shortcut doesn't point anywhere."
    case FILE_TYPE.music:
      return "Songs in 98ish are played by the Media Player's synthesizer, so there's no sound file to download."
    default:
      return "Programs and shortcuts only work inside 98ish."
  }
}

// What a file becomes on your computer: { name, data, mime } or { error } if it can't go
// (`text` is its contents: pass them for a big file that may not be loaded)
export const exportFile = (item, text = item.textContent || "") => {
  const name = realName(item.name)
  const problem = exportProblem(item, text)
  if (problem) return { error: problem }
  switch (item.type) {
    case FILE_TYPE.text:
    case FILE_TYPE.note:
      return { name: withExt(name, ".txt"), data: text.replace(/\r?\n/g, "\r\n"), mime: "text/plain" }
    case "richtext":
      return { name: withExt(name.replace(/\.(rtf|doc)$/i, ""), ".html"), data: richTextPage(item.name, text), mime: "text/html" }
    case FILE_TYPE.image: {
      if (!text.startsWith("data:image/")) return { error: "This picture is empty." }
      const mime = text.slice(5, text.indexOf(";"))
      return { name: withExt(name, IMAGE_EXT[mime] || ".png"), data: dataUrlBytes(text), mime }
    }
    case "sound":
      if (!text.startsWith("data:audio/")) return { error: "This sound is empty." }
      return { name: withExt(name, ".wav"), data: dataUrlBytes(text), mime: "audio/wav" }
    // a Music 98 song: the original file, as it came in (its name keeps its extension)
    case "song": {
      if (!text.startsWith("data:")) return { error: "This song is empty." }
      const mime = text.slice(5, text.indexOf(";")) || "audio/mpeg"
      return { name: /\.[a-z0-9]{2,5}$/i.test(name) ? name : withExt(name, SONG_EXT[mime] || ".mp3"), data: dataUrlBytes(text), mime }
    }
    case FILE_TYPE.internet: {
      const url = hyperlinks[item.name] || text
      if (!url) return { error: "This shortcut doesn't point anywhere." }
      return { name: withExt(name, ".url"), data: `[InternetShortcut]\r\nURL=${url}\r\n`, mime: "application/octet-stream" }
    }
    case FILE_TYPE.music:
      return { error: "Songs in 98ish are played by the Media Player's synthesizer, so there's no sound file to download." }
    default:
      return { error: "Programs and shortcuts only work inside 98ish." }
  }
}

export const canDownload = (item) => !!item && (item.isDirectory || !exportProblem(item, item.head || ""))

// A folder as a .zip: { name, data, files, skipped: [names] }
export const exportFolder = async (dir) => {
  const entries = []
  const skipped = []
  let files = 0
  const walk = async (folder, prefix) => {
    const taken = new Set()
    const unique = (name) => {
      let candidate = name
      const dot = name.lastIndexOf(".")
      for (let i = 2; taken.has(candidate.toLowerCase()); i++) candidate = dot > 0 ? `${name.slice(0, dot)} (${i})${name.slice(dot)}` : `${name} (${i})`
      taken.add(candidate.toLowerCase())
      return candidate
    }
    const children = folder.content
    if (!children.length) entries.push({ path: prefix })
    for (const item of children) {
      if (item.isDirectory) {
        await walk(item, `${prefix}${unique(realName(item.name))}/`)
        continue
      }
      const out = exportFile(item, await peekContent(item))
      if (out.error) {
        skipped.push(item.name)
        continue
      }
      entries.push({ path: prefix + unique(out.name), data: out.data })
      files++
    }
  }
  const root = realName(dir.name === "C:" ? "C" : dir.name)
  await walk(dir, `${root}/`)
  return { name: `${root}.zip`, data: makeZip(entries), mime: "application/zip", files, skipped }
}

// Save something to your real computer's Downloads (iOS shows a share sheet)
export const downloadBlob = (data, name, mime = "application/octet-stream") => {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.rel = "noopener"
  a.style.display = "none"
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

// Download a file or folder: -> { ok, name, skipped } | { ok: false, error }
export const downloadItem = async (item) => {
  if (item.isDirectory) {
    const zip = await exportFolder(item)
    if (!zip.files && zip.skipped.length) return { ok: false, error: `There's nothing in '${item.name}' that can be downloaded: programs, shortcuts and songs only work inside 98ish.` }
    downloadBlob(zip.data, zip.name, zip.mime)
    return { ok: true, name: zip.name, skipped: zip.skipped }
  }
  const out = exportFile(item, await peekContent(item))
  if (out.error) return { ok: false, error: out.error }
  downloadBlob(out.data, out.name, out.mime)
  return { ok: true, name: out.name, skipped: [] }
}

// ---------- in ----------

export const MAX_TEXT_BYTES = 200 * 1024
export const MAX_MEDIA_BYTES = 25 * 1024 * 1024 // the file you pick; it's shrunk to fit
const MAX_SIDE = 1600
const MAX_IMAGE_CHARS = 4_000_000 // ~3 MB of PNG
const SOUND_RATE = 22050
const MAX_SOUND_SECONDS = 30

const TEXT_EXT = /\.(txt|text|md|markdown|log|csv|tsv|json|js|mjs|ts|jsx|css|ini|cfg|conf|xml|yml|yaml|bat|cmd|sh|py|c|h|cpp|java|sql|srt|nfo|diz)$/i
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp)$/i
const SOUND_EXT = /\.(wav|mp3|ogg|oga|m4a|aac|opus|weba|flac)$/i
const SONG_EXT = { "audio/mpeg": ".mp3", "audio/mp4": ".m4a", "audio/aac": ".aac", "audio/wav": ".wav", "audio/ogg": ".ogg", "audio/flac": ".flac", "audio/webm": ".weba" }
const RICH_EXT = /\.(html?|rtf)$/i

// File picker filter: everything that can come in
export const UPLOAD_ACCEPT = "text/*,image/png,image/jpeg,image/gif,image/webp,image/bmp,audio/*,.txt,.md,.log,.csv,.json,.ini,.xml,.html,.htm,.rtf,.wav,.mp3,.ogg,.m4a,.aac,.flac,.opus"

// -> "text" | "image" | "sound" | "richtext" | null
export const uploadKind = (file) => {
  const name = file.name || ""
  const type = file.type || ""
  if (RICH_EXT.test(name) || type === "text/html" || type === "application/rtf" || type === "text/rtf") return "richtext"
  if (IMAGE_EXT_RE.test(name) || /^image\/(png|jpeg|gif|webp|bmp|x-ms-bmp)$/.test(type)) return "image"
  if (SOUND_EXT.test(name) || type.startsWith("audio/")) return "sound"
  if (TEXT_EXT.test(name) || type.startsWith("text/") || type === "application/json") return "text"
  return null
}

// "photo.jpg" -> "photo", "notes.md" stays (it says what's inside)
const baseName = (fileName) =>
  String(fileName || "Uploaded")
    .replace(/\.(txt|png|jpe?g|gif|webp|bmp|wav|mp3|ogg|oga|m4a|aac|opus|weba|html?|rtf)$/i, "")
    .replace(/[\\/:"<>|\u0000-\u001F]/g, "_")
    .trim()
    .slice(0, 64) || "Uploaded"

const readDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })

const loadImage = (file) =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => resolve({ img, done: () => URL.revokeObjectURL(url) })
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error("couldn't be opened as a picture"))
    }
    img.src = url
  })

// Any picture -> a PNG data URL no bigger than 1600 px a side (smaller if it still doesn't fit)
export const imageToPng = async (file) => {
  const { img, done } = await loadImage(file)
  try {
    const w = img.naturalWidth || img.width
    const h = img.naturalHeight || img.height
    if (!w || !h) throw new Error("couldn't be opened as a picture")
    let scale = Math.min(1, MAX_SIDE / w, MAX_SIDE / h)
    for (;;) {
      const canvas = document.createElement("canvas")
      canvas.width = Math.max(1, Math.round(w * scale))
      canvas.height = Math.max(1, Math.round(h * scale))
      const ctx = canvas.getContext("2d")
      ctx.fillStyle = "#fff" // Paint pictures have no see-through parts
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      const data = canvas.toDataURL("image/png")
      if (data.length <= MAX_IMAGE_CHARS || canvas.width <= 160 || canvas.height <= 160) {
        return { data, width: canvas.width, height: canvas.height, shrunk: canvas.width !== w }
      }
      scale *= 0.75
    }
  } finally {
    done()
  }
}

// 16-bit mono PCM WAV bytes
export const encodeWav = (samples, rate) => {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2))
  const text = (at, s) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)))
  text(0, "RIFF")
  view.setUint32(4, 36 + samples.length * 2, true)
  text(8, "WAVE")
  text(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  text(36, "data")
  view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return new Uint8Array(view.buffer)
}

// Any sound the browser can play -> a mono 22 kHz WAV data URL (the first 30 seconds)
export const audioToWav = async (file) => {
  const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext
  if (!OfflineCtx) throw new Error("can't be read by this browser")
  // decoding needs no sound card: an offline context doesn't open one
  const ctx = new OfflineCtx(1, 1, 44100)
  const buffer = await file.arrayBuffer()
  const decoded = await new Promise((resolve, reject) => {
    const fail = () => reject(new Error("isn't a sound this browser can play"))
    ctx.decodeAudioData(buffer, resolve, fail)?.catch?.(fail) // Safari only has the callbacks
  })
  const seconds = Math.min(decoded.duration, MAX_SOUND_SECONDS)
  const frames = Math.max(1, Math.ceil(seconds * SOUND_RATE))
  const offline = new OfflineCtx(1, frames, SOUND_RATE)
  const source = offline.createBufferSource()
  source.buffer = decoded
  source.connect(offline.destination) // mixes down to mono
  source.start()
  const rendered = await offline.startRendering()
  const wav = encodeWav(rendered.getChannelData(0), SOUND_RATE)
  return { data: await readDataUrl(new Blob([wav], { type: "audio/wav" })), seconds, trimmed: decoded.duration > MAX_SOUND_SECONDS + 0.05 }
}

// ---- rich text: only plain formatting comes in (no scripts, frames, or outside pictures) ----

const KEEP_TAGS = new Set(["P", "BR", "B", "STRONG", "I", "EM", "U", "S", "STRIKE", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI", "DIV", "SPAN", "FONT", "BLOCKQUOTE", "PRE", "A", "HR", "SUB", "SUP", "CENTER"])
const DROP_TAGS = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "NOSCRIPT", "TEMPLATE", "HEAD", "TITLE", "META", "LINK", "SVG", "MATH", "FORM", "INPUT", "BUTTON", "SELECT", "TEXTAREA", "CANVAS", "VIDEO", "AUDIO"])
const STYLE_PROPS = ["color", "background-color", "font-weight", "font-style", "text-decoration", "text-align", "font-size", "font-family"]

const cleanStyle = (style) =>
  STYLE_PROPS.map((prop) => {
    const value = style.getPropertyValue(prop)
    return value && !/url\(|expression|javascript:/i.test(value) ? `${prop}: ${value}` : null
  })
    .filter(Boolean)
    .join("; ")

export const sanitizeHtml = (html) => {
  const doc = new DOMParser().parseFromString(String(html), "text/html")
  const out = document.createElement("div")
  const copy = (from, to) => {
    for (const node of from.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) to.appendChild(document.createTextNode(node.textContent))
      if (node.nodeType !== Node.ELEMENT_NODE || DROP_TAGS.has(node.tagName)) continue
      if (!KEEP_TAGS.has(node.tagName)) {
        copy(node, to) // unknown wrapper (table, section...): keep what's inside
        if (/^(TR|TABLE|SECTION|ARTICLE|HEADER|FOOTER)$/.test(node.tagName)) to.appendChild(document.createElement("br"))
        continue
      }
      const el = document.createElement(node.tagName)
      const style = cleanStyle(node.style)
      if (style) el.setAttribute("style", style)
      for (const attr of ["align", "color", "face", "size"]) {
        const value = node.getAttribute(attr)
        if (value && /^[\w #,.-]{1,40}$/.test(value)) el.setAttribute(attr, value)
      }
      if (node.tagName === "A") {
        const href = node.getAttribute("href") || ""
        if (/^(https?:|mailto:)/i.test(href)) el.setAttribute("href", href)
      }
      copy(node, el)
      to.appendChild(el)
    }
  }
  copy(doc.body, out)
  return out.innerHTML.trim()
}

// A small RTF reader: paragraphs, bold, italic, underline and accented letters
export const rtfToHtml = (rtf) => {
  const SKIP = /^(fonttbl|colortbl|stylesheet|info|pict|object|header|footer|listtable|listoverridetable|rsidtbl|generator|themedata|colorschememapping|latentstyles|datastore|xmlnstbl)$/
  const stack = [{ b: false, i: false, u: false, skip: false, uc: 1 }]
  let state = stack[0]
  let html = ""
  let open = { b: false, i: false, u: false }
  let pendingSkip = 0
  const sync = () => {
    for (const tag of ["u", "i", "b"]) if (open[tag] && !state[tag]) (html += `</${tag}>`), (open[tag] = false)
    for (const tag of ["b", "i", "u"]) if (!open[tag] && state[tag]) (html += `<${tag}>`), (open[tag] = true)
  }
  const put = (text) => {
    if (state.skip) return
    if (pendingSkip > 0) {
      pendingSkip -= text.length
      return
    }
    sync()
    html += escapeHtml(text)
  }
  const s = String(rtf)
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === "{") {
      state = { ...state }
      stack.push(state)
      if (s.startsWith("{\\*", i)) state.skip = true
    } else if (c === "}") {
      stack.pop()
      state = stack.at(-1) || stack[0]
      if (!stack.length) break
    } else if (c === "\\") {
      const next = s[i + 1]
      if (next === "'") {
        put(String.fromCharCode(parseInt(s.slice(i + 2, i + 4), 16)))
        i += 3
      } else if (/[\\{}]/.test(next)) {
        put(next)
        i++
      } else if (next === "~") (put(" "), i++)
      else if (/[a-z]/i.test(next)) {
        const m = /^([a-z]+)(-?\d+)? ?/i.exec(s.slice(i + 1))
        const [all, word, num] = m
        i += all.length
        const value = num === undefined ? null : Number(num)
        if (SKIP.test(word)) state.skip = true
        else if (word === "par" || word === "line") !state.skip && (sync(), (html += "<br>"))
        else if (word === "tab") put("\t")
        else if (word === "b") state.b = value !== 0
        else if (word === "i") state.i = value !== 0
        else if (word === "ul") state.u = value !== 0
        else if (word === "ulnone") state.u = false
        else if (word === "plain") Object.assign(state, { b: false, i: false, u: false })
        else if (word === "uc") state.uc = value ?? 1
        else if (word === "u" && value !== null) {
          put(String.fromCharCode(value < 0 ? value + 65536 : value))
          pendingSkip = state.uc
        }
      } else i++
    } else if (c !== "\r" && c !== "\n") put(c)
  }
  state = { b: false, i: false, u: false }
  sync()
  return html
    .replace(/^(<br>)+|(<br>)+$/g, "")
    .split(/<br>/)
    .map((line) => `<p>${line || "<br>"}</p>`)
    .join("")
}

const htmlText = (html) => new DOMParser().parseFromString(html, "text/html").body.innerText || ""

const tooBig = (bytes) => `${Math.round(bytes / 1024 / 1024)} MB`

// A real file -> what to save in 98ish: { name, type, content, note } (throws Error(reason))
export const convertUpload = async (file) => {
  const kind = uploadKind(file)
  const name = baseName(file.name)
  if (!kind) throw new Error("isn't a kind of file 98ish can open (text, pictures, sounds and web pages can come in)")
  if (kind === "text" || kind === "richtext") {
    if (file.size > MAX_TEXT_BYTES) throw new Error("is bigger than 200 KB")
    const text = await file.text()
    if (kind === "text") return { name: name.replace(/\.txt$/i, ""), type: FILE_TYPE.text, content: text }
    const html = /\.rtf$/i.test(file.name) || /rtf/.test(file.type) || text.startsWith("{\\rtf") ? rtfToHtml(text) : sanitizeHtml(text)
    if (FILE_TYPE.richtext) return { name, type: FILE_TYPE.richtext, content: html }
    return { name, type: FILE_TYPE.text, content: htmlText(html) }
  }
  if (file.size > MAX_MEDIA_BYTES) throw new Error(`is ${tooBig(file.size)}; pictures and sounds can be up to 25 MB`)
  if (kind === "image") {
    const png = await imageToPng(file)
    return { name, type: FILE_TYPE.image, content: png.data, note: png.shrunk ? `${name} was shrunk to ${png.width} x ${png.height} to fit.` : null }
  }
  if (!FILE_TYPE.sound) throw new Error("is a sound, and this version of 98ish has nowhere to play it")
  const wav = await audioToWav(file)
  return { name, type: FILE_TYPE.sound, content: wav.data, note: wav.trimmed ? `${name} was cut to its first ${MAX_SOUND_SECONDS} seconds to fit.` : null }
}

// Bring real files into a folder: -> { added: [File], problems: [text], notes: [text] }
export const uploadInto = async (dir, files) => {
  const added = []
  const problems = []
  const notes = []
  for (const file of files) {
    let converted
    try {
      converted = await convertUpload(file)
    } catch (error) {
      problems.push(`${file.name} ${error.message || "couldn't be read"}.`)
      continue
    }
    const made = fs.createFileIn(dir, uniqueName(dir, converted.name), converted.type, "")
    if (!(await writeAndSave(made, converted.content, { created: true }))) {
      problems.push(`${file.name} didn't fit: drive C: is full. Delete some pictures or sounds (and empty the Recycle Bin), then try again.`)
      continue
    }
    added.push(made)
    if (converted.note) notes.push(converted.note)
  }
  return { added, problems, notes }
}
