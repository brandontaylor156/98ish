// Clipboard history (like Windows' Win+V): the last 25 things copied inside 98ish, text and
// small pictures, to paste again later. docs/sharing.md has the whole picture.
// - What's kept: copies through utils/systemClipboard.js (copyText/copyImage: Notepad,
//   WordPad, My Computer, Snipping Tool, Send To's fallback...), Paint's and Character Map's
//   Copy, and every copy/cut event in the page (Ctrl+C, the phone's own Copy in a field or a
//   reading area). Never from password fields or one-time codes, or inside data-clip="off".
// - Per 98ish user on this device (IndexedDB "98ish-clipboard", clipStore.js), never synced
//   or uploaded; deleted with the user (onUserRemoved) and by Delete My Account
//   (utils/account.js). Settings: clipboardHistory (on by default); turning it off erases it.
// - Opening the list: Ctrl+Shift+V (also Cmd+Shift+V on a Mac), the 98ish keyboard's
//   clipboard button, or openClipHistory(). The panel is shared/clipboard/ClipHistory.jsx.

import { CLIP_CAPS, dataUrlBytes, privateField, shrinkToFit } from "./clipCore.js"
import { createClipStore } from "./clipStore.js"
import { getSettings, subscribeSettings } from "./settings.js"
import { currentUserId, onUserRemoved } from "./users.js"

export const CLIP_EVENT = "98ish:clip-history"

export const clipStore = createClipStore({
  idb: () => (typeof indexedDB !== "undefined" ? indexedDB : null),
  userId: () => currentUserId(),
})

export const clipHistoryOn = () => getSettings().clipboardHistory !== false

// what privateField() needs to know about an element
export const describeField = (el) => {
  if (!el || el.nodeType !== 1) return null
  return {
    tag: el.tagName,
    type: el.getAttribute?.("type") || el.type || "",
    autocomplete: el.getAttribute?.("autocomplete") || "",
    clipOff: !!el.closest?.('[data-clip="off"]'),
  }
}

// Text copied somewhere in 98ish. `el`: where it was copied from (password fields are skipped)
export const recordText = (text, { el = null } = {}) => {
  if (!clipHistoryOn()) return Promise.resolve(null)
  if (privateField(describeField(el)) || privateField(describeField(typeof document !== "undefined" ? document.activeElement : null))) return Promise.resolve(null)
  return clipStore.add({ kind: "text", text }).catch(() => null)
}

const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error("no picture"))
    img.src = src
  })

const blobToDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })

// A picture copied in 98ish (a data URL or a Blob). Bigger than 256 KB: made smaller first.
export const recordImage = async (source) => {
  if (!clipHistoryOn() || !source || typeof document === "undefined") return null
  try {
    let dataUrl = typeof source === "string" ? source : await blobToDataUrl(source)
    const img = await loadImage(dataUrl)
    let w = img.naturalWidth
    let h = img.naturalHeight
    for (let tries = 0; dataUrlBytes(dataUrl) > CLIP_CAPS.itemBytes && tries < 4; tries++) {
      ;({ w, h } = shrinkToFit(w, h, dataUrlBytes(dataUrl)))
      const canvas = document.createElement("canvas")
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext("2d")
      ctx.fillStyle = "#fff" // JPEG has no see-through parts
      ctx.fillRect(0, 0, w, h)
      ctx.drawImage(img, 0, 0, w, h)
      dataUrl = canvas.toDataURL("image/jpeg", 0.85)
    }
    return await clipStore.add({ kind: "image", dataUrl, w, h })
  } catch {
    return null
  }
}

export const eraseClipHistory = () => clipStore.erase()

// the history panel, from anywhere: { target } is the field to paste into (default: what has focus)
export const openClipHistory = (detail = {}) => {
  const target = detail.target || (typeof document !== "undefined" ? document.activeElement : null)
  window.dispatchEvent(new CustomEvent(CLIP_EVENT, { detail: { ...detail, target } }))
}

// the words a copy/cut event carries: what a handler put on it, else the selection
const copiedText = (e) => {
  try {
    const set = e.clipboardData?.getData("text/plain")
    if (set) return set
  } catch {
    // not readable here
  }
  const el = e.target?.nodeType === 1 ? e.target : document.activeElement
  if (el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT")) {
    try {
      if (typeof el.selectionStart === "number" && el.selectionEnd > el.selectionStart) return el.value.slice(el.selectionStart, el.selectionEnd)
    } catch {
      // no selection on this kind of field
    }
  }
  return String(window.getSelection?.() || "")
}

let installed = false
export const installClipHistory = () => {
  if (installed || typeof window === "undefined") return
  installed = true
  const onCopy = (e) => {
    if (!clipHistoryOn()) return
    const el = e.target?.nodeType === 1 ? e.target : e.target?.parentElement
    const text = copiedText(e)
    if (text) recordText(text, { el })
  }
  // bubble phase on window: after the app's own handlers put what they copy on the event
  window.addEventListener("copy", onCopy)
  window.addEventListener("cut", onCopy)
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.code !== "KeyV" || !e.shiftKey || e.altKey || !(e.ctrlKey || e.metaKey) || (e.ctrlKey && e.metaKey)) return
      if (document.documentElement.classList.contains("os-locked")) return
      e.preventDefault()
      e.stopPropagation()
      openClipHistory({ target: document.activeElement })
    },
    true
  )
  // turned off: everything kept goes, as on Windows
  let was = clipHistoryOn()
  subscribeSettings((s) => {
    const on = s.clipboardHistory !== false
    if (was && !on) clipStore.erase()
    was = on
  })
}

// a removed user profile's history goes with them
onUserRemoved((id) => clipStore.dropUser(id))
