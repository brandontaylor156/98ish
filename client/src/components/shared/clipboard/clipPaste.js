// Pasting an item from the clipboard history into what had focus.
// - Words into a text field or rich text: typed in at the caret as the 98ish keyboard types
//   (execCommand insertText, with a value-setter fallback), so undo and React state work.
// - Anything else (a picture into Paint or My Computer, words into a program's own paste
//   handler): a paste event carrying it, with `fromClipHistory` set on the event.
// - Nobody took it: it goes on the device's clipboard and the caller says "press Ctrl+V".

import { insert } from "../keyboard/typing"
import { copyImage, copyText } from "../../../utils/systemClipboard"

const TEXT_TYPES = /^(text|search|url|tel|email|number|)$/i

export const typableField = (el) => {
  if (!el || el.nodeType !== 1 || !el.isConnected) return false
  if (el.disabled || el.readOnly) return false
  if (el.tagName === "TEXTAREA") return true
  if (el.tagName === "INPUT") return TEXT_TYPES.test(el.getAttribute("type") || "") && el.type !== "password"
  return !!el.isContentEditable
}

const dataUrlToFile = (dataUrl, name) => {
  const [head, body] = dataUrl.split(",")
  const mime = /data:([^;]+)/.exec(head)?.[1] || "image/png"
  const bin = atob(body)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new File([bytes], `${name}.${mime.split("/")[1] === "jpeg" ? "jpg" : mime.split("/")[1]}`, { type: mime })
}

const pasteEvent = (target, item) => {
  if (typeof DataTransfer === "undefined") return false
  let dt
  try {
    dt = new DataTransfer()
    if (item.kind === "text") dt.setData("text/plain", item.text)
    else dt.items.add(dataUrlToFile(item.dataUrl, "Picture"))
  } catch {
    return false
  }
  const ev = new Event("paste", { bubbles: true, cancelable: true, composed: true })
  Object.defineProperty(ev, "clipboardData", { value: dt })
  Object.defineProperty(ev, "fromClipHistory", { value: true })
  return !target.dispatchEvent(ev) // a handler took it (preventDefault)
}

// -> "pasted" | "copied" (on the device's clipboard instead) | "failed"
export const pasteClip = async (item, target) => {
  if (!item) return "failed"
  const el = target && target.isConnected && target !== document.body ? target : null
  if (el && item.kind === "text" && typableField(el)) {
    try {
      el.focus({ preventScroll: true })
    } catch {
      // can't focus: still try
    }
    if (insert(el, item.text)) return "pasted"
  }
  if (el) {
    try {
      el.focus?.({ preventScroll: true })
    } catch {
      // fine
    }
    if (pasteEvent(el, item)) return "pasted"
  }
  const ok = await (item.kind === "text" ? copyText(item.text, { history: false }) : copyImage(item.dataUrl, { history: false }))
  return ok ? "copied" : "failed"
}
