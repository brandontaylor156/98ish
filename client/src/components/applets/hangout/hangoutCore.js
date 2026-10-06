// Come Over (the multiplayer desktop): the pure parts, shared by the window, the desktop
// layer and the tests. No React, no DOM.

// programs that never show in someone else's view: kept in step with server/aim/hangout.js
export const PRIVATE_APPS = new Set(["aim", "aim-im", "aim-info", "aim-chat", "aim-delete", "chat", "mail", "notes", "tasks", "passwords", "photos", "camera", "addressbook", "locator", "backup", "control", "controlpanel", "lock", "users", "together", "us", "loveletters", "ourstory", "pet", "dollhouse"])
// programs a follower's screen may open to mirror the leader
export const FOLLOW_APPS = new Set(["notepad", "paint", "wordpad", "internetexplorer", "compass", "help", "calculator", "fileexplorer", "mediaplayer", "music", "weather", "calendar", "minesweeper", "solitaire", "freecell", "pickleball", "hangout"])

// default-deny: a window without a program id (98 Messenger's Buddy List), any 98 Messenger
// window (aim-*), or anything on the list is private
export const isPrivate = (app) => {
  const a = String(app || "").toLowerCase()
  return !a || a.startsWith("aim") || PRIVATE_APPS.has(a)
}
export const mayFollow = (app) => FOLLOW_APPS.has(String(app || "").toLowerCase())

export const MAX_PEOPLE = 4
export const PRESENCE_HZ = 15

// A sender that sends at most `hz` times a second: the first call goes at once, later ones
// within the interval are merged into one trailing send of the latest value. (Cursors move
// 60+ times a second; 15 is smooth once interpolated, and a fraction of the traffic.)
export const throttle = (send, hz = PRESENCE_HZ, { now = () => Date.now(), later = (fn, ms) => setTimeout(fn, ms), cancel = (t) => clearTimeout(t) } = {}) => {
  const gap = 1000 / hz
  let last = -Infinity
  let pending = null
  let timer = null
  const flush = () => {
    timer = null
    if (!pending) return
    last = now()
    const v = pending
    pending = null
    send(v)
  }
  const push = (value) => {
    pending = value
    const wait = last + gap - now()
    if (wait <= 0) {
      if (timer) cancel(timer)
      flush()
    } else if (!timer) timer = later(flush, wait)
  }
  push.flush = flush
  push.cancel = () => {
    if (timer) cancel(timer)
    timer = null
    pending = null
  }
  return push
}

// A remote cursor glides toward its latest reported spot instead of jumping 15 times a
// second: each frame moves a share of the way (frame-rate independent).
export const glide = (from, to, dtMs, halfLifeMs = 45) => {
  if (!from) return { ...to }
  const k = 1 - Math.pow(0.5, Math.max(0, dtMs) / halfLifeMs)
  return { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k }
}

// the screen as fractions (what's sent), and back to pixels on someone else's screen
export const toUnit = (px, py, w, h) => ({ x: w > 0 ? Math.min(1, Math.max(0, px / w)) : 0, y: h > 0 ? Math.min(1, Math.max(0, py / h)) : 0 })
export const fromUnit = (u, w, h) => ({ x: u.x * w, y: u.y * h })

const r3 = (n) => Math.round(Math.min(1, Math.max(0, Number(n) || 0)) * 1000) / 1000

// What visitors see of your desktop: wallpaper, icons, windows (as fractions of the screen).
// Private programs keep no title (the server checks again).
export const desktopSnapshot = ({ windows = [], icons = [], wallpaper = {}, screen = { w: 1024, h: 768 }, mobile = false }) => ({
  wallpaper: { color: String(wallpaper.color || "#008080").slice(0, 20), image: /^\/[\w./-]{1,120}$/.test(wallpaper.image || "") ? wallpaper.image : "", mode: String(wallpaper.mode || "").slice(0, 10) },
  icons: icons.slice(0, 40).map((i) => ({ name: String(i.name || "").slice(0, 40), icon: /^\/[\w./-]{1,120}$/.test(i.icon || "") ? i.icon : "", program: String(i.program || "").slice(0, 40) })),
  windows: windows
    .filter((w) => !w.closed)
    .slice(-16)
    .map((w) => {
      const app = String(w.app || "").toLowerCase()
      const priv = isPrivate(app)
      return {
        app: priv ? "private" : app,
        title: priv ? "Private window" : String(w.name || "").slice(0, 60),
        icon: priv ? "" : /^\/[\w./-]{1,120}$/.test(w.icon_url || "") ? w.icon_url : "",
        x: r3((Number(w.x) || 0) / screen.w),
        y: r3((Number(w.y) || 0) / screen.h),
        w: r3((Number(w.width) || screen.w * 0.5) / screen.w),
        h: r3((Number(w.height) || screen.h * 0.5) / screen.h),
        min: !!w.minimized,
        active: !!w.active,
      }
    }),
  mobile,
})

// the snapshot only goes out again when it changed (a moved window, a new title)
export const sameSnapshot = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// ---- shared text (Notepad) ----

// The smallest edit that turns `a` into `b`: { at, remove, insert } (common prefix and suffix
// kept). One textarea input event is almost always one such edit; applying it to a Y.Text
// keeps everyone else's concurrent typing.
export const textEdit = (a, b) => {
  if (a === b) return null
  let start = 0
  const max = Math.min(a.length, b.length)
  while (start < max && a.charCodeAt(start) === b.charCodeAt(start)) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a.charCodeAt(endA - 1) === b.charCodeAt(endB - 1)) {
    endA--
    endB--
  }
  // don't split a surrogate pair (an emoji) down the middle
  if (start > 0 && start < a.length && isLow(a.charCodeAt(start)) && isHigh(a.charCodeAt(start - 1))) {
    start--
  }
  return { at: start, remove: endA - start, insert: b.slice(start, endB) }
}
const isHigh = (c) => c >= 0xd800 && c <= 0xdbff
const isLow = (c) => c >= 0xdc00 && c <= 0xdfff

// where a caret at `pos` ends up after an edit someone else made
export const moveCaret = (pos, edit) => {
  if (!edit) return pos
  const { at, remove, insert } = edit
  if (pos <= at) return pos
  if (pos <= at + remove) return at + insert.length
  return pos - remove + insert.length
}

// ---- shared pictures (Paint) ----
//
// Each finished change to a picture is one op: the pixels that changed, as runs. Runs are
// [start, length, color, color, ...] over the picture's pixels (row by row); colors are
// 0xRRGGBB. Unchanged pixels aren't sent, so a pencil line costs a few hundred bytes.

export const diffPixels = (before, after) => {
  const n = Math.min(before.length, after.length) >> 2
  const runs = []
  let i = 0
  while (i < n) {
    const o = i << 2
    if (before[o] === after[o] && before[o + 1] === after[o + 1] && before[o + 2] === after[o + 2]) {
      i++
      continue
    }
    const start = i
    const colors = []
    while (i < n) {
      const p = i << 2
      if (before[p] === after[p] && before[p + 1] === after[p + 1] && before[p + 2] === after[p + 2]) break
      colors.push((after[p] << 16) | (after[p + 1] << 8) | after[p + 2])
      i++
    }
    runs.push(start, colors.length, ...colors)
  }
  return runs
}

// paint runs onto RGBA pixels (alpha stays opaque)
export const applyRuns = (data, runs) => {
  let k = 0
  const n = data.length >> 2
  while (k < runs.length) {
    const start = runs[k]
    const len = runs[k + 1]
    k += 2
    for (let j = 0; j < len; j++) {
      const i = start + j
      const c = runs[k + j]
      if (i < n) {
        const p = i << 2
        data[p] = (c >> 16) & 255
        data[p + 1] = (c >> 8) & 255
        data[p + 2] = c & 255
        data[p + 3] = 255
      }
    }
    k += len
  }
}

// compact transport for runs: little-endian 32-bit words, base64 (a Y.Array holds strings)
export const packRuns = (runs) => {
  const words = new Uint32Array(runs.length)
  for (let i = 0; i < runs.length; i++) words[i] = runs[i] >>> 0
  const bytes = new Uint8Array(words.buffer)
  let s = ""
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
export const unpackRuns = (text) => {
  const bin = atob(text)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return Array.from(new Uint32Array(bytes.buffer, 0, bytes.length >> 2))
}

// ---- small helpers ----

export const initials = (name) =>
  String(name || "?")
    .split(/[\s_]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("") || "?"

// "Ann", "Ann and Ben", "Ann, Ben and Cat"
export const listNames = (names) => (names.length <= 1 ? names[0] || "" : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`)
