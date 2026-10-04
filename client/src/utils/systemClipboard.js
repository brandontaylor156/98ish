// The phone's (or computer's) own clipboard, so copy and paste work between 98ish and
// other apps. Writes start inside the tap or click (iOS needs that); reads ask the
// browser, which may say no (then Ctrl+V or the phone's own Paste still works).

export const PASTE_BLOCKED =
  "98ish isn't allowed to read your clipboard from this menu. Press Ctrl+V instead (on a phone, tap and hold, then choose Paste)."

// old way, inside the same tap: a hidden text box and the copy command
const execCopy = (text) => {
  const area = document.createElement("textarea")
  area.value = text
  area.setAttribute("readonly", "")
  area.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;"
  const active = document.activeElement
  document.body.appendChild(area)
  area.select()
  area.setSelectionRange(0, text.length)
  let ok = false
  try {
    ok = document.execCommand("copy")
  } catch {
    ok = false
  }
  area.remove()
  active?.focus?.({ preventScroll: true })
  return ok
}

// Put text on the system clipboard -> Promise<boolean>
export const copyText = (text) => {
  const value = String(text ?? "")
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(value).then(
      () => true,
      () => execCopy(value)
    )
  }
  return Promise.resolve(execCopy(value))
}

const pngBlob = (dataUrl) =>
  new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement("canvas")
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      canvas.getContext("2d").drawImage(img, 0, 0)
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("no picture"))), "image/png")
    }
    img.onerror = () => reject(new Error("no picture"))
    img.src = dataUrl
  })

// Put a picture (a data URL) on the system clipboard as a PNG -> Promise<boolean>.
// Safari wants the ClipboardItem made inside the tap with the picture still on its way.
export const copyImage = (dataUrl) => {
  if (!window.ClipboardItem || !navigator.clipboard?.write) return Promise.resolve(false)
  try {
    const blob = /^data:image\/png/i.test(dataUrl) ? fetch(dataUrl).then((r) => r.blob()) : pngBlob(dataUrl)
    return navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]).then(
      () => true,
      () => false
    )
  } catch {
    return Promise.resolve(false)
  }
}

// What's on the system clipboard -> { ok: true, images: [Blob], text } | { ok: false, message }
export const readClipboard = async () => {
  if (navigator.clipboard?.read) {
    try {
      const images = []
      let text = ""
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((t) => t.startsWith("image/"))
        if (type) images.push(await item.getType(type))
        else if (!text && item.types.includes("text/plain")) text = await (await item.getType("text/plain")).text()
      }
      return { ok: true, images, text }
    } catch {
      // Firefox and some others: read() is there but refused; try plain text
    }
  }
  if (navigator.clipboard?.readText) {
    try {
      return { ok: true, images: [], text: await navigator.clipboard.readText() }
    } catch {
      // refused
    }
  }
  return { ok: false, message: PASTE_BLOCKED }
}

// What a paste event carries (Ctrl+V or the phone's Paste): { images: [File], text }
export const fromPasteEvent = (e) => {
  const data = e.clipboardData
  if (!data) return { images: [], text: "" }
  const images = [...(data.files || [])].filter((f) => f.type.startsWith("image/"))
  if (!images.length) for (const item of data.items || []) if (item.kind === "file" && item.type.startsWith("image/")) images.push(item.getAsFile())
  return { images: images.filter(Boolean), text: data.getData("text/plain") || "" }
}
