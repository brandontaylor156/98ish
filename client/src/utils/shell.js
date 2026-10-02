import { useEffect, useState } from "react"
import { fs } from "./fs"
import { unlock } from "./achievements"

// Small shared pieces of the shell (taskbar, Start menu, desktop):
//   shellAction("run")             asks the taskbar to do something (Run, Taskbar Properties...)
//   watchSocket(socket)            the tray's network icon follows the chat server connection
//   useQuickLaunch() and friends   the Quick Launch toolbar's icons, kept in this browser

// ---- shell actions: "run" | "taskbar-properties" | "shortcuts" | "show-desktop" ----

export const SHELL_EVENT = "98ish:shell"
export const shellAction = (action) => window.dispatchEvent(new CustomEvent(SHELL_EVENT, { detail: { action } }))

// closing a window from the taskbar goes through the desktop (it asks Notepad about unsaved changes)
export const CLOSE_EVENT = "98ish:close-window"
export const requestClose = (index) => window.dispatchEvent(new CustomEvent(CLOSE_EVENT, { detail: { index } }))

// ---- the chat server connection ----

let connected = false
const netListeners = new Set()
const setConnected = (value) => {
  connected = value
  netListeners.forEach((fn) => fn(value))
}

// returns a cleanup function, for useEffect
export const watchSocket = (socket) => {
  const on = () => setConnected(true)
  const off = () => setConnected(false)
  setConnected(!!socket.connected)
  socket.on("connect", on)
  socket.on("disconnect", off)
  socket.on("connect_error", off)
  return () => {
    socket.off("connect", on)
    socket.off("disconnect", off)
    socket.off("connect_error", off)
    setConnected(false)
  }
}

export const useNetStatus = () => {
  const [value, setValue] = useState(connected)
  useEffect(() => {
    netListeners.add(setValue)
    setValue(connected)
    return () => netListeners.delete(setValue)
  }, [])
  return value
}

// ---- Quick Launch ----
// entries: { kind: "desktop" } | { kind: "program", name } | { kind: "file", path }

const QL_KEY = "98ish.quickLaunch"
export const DEFAULT_QUICK_LAUNCH = [
  { kind: "desktop" },
  { kind: "program", name: "Internet Explorer" },
  { kind: "program", name: "My Computer" },
  { kind: "program", name: "MS-DOS Prompt" },
]

const readQuickLaunch = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(QL_KEY))
    return Array.isArray(saved) ? saved : DEFAULT_QUICK_LAUNCH
  } catch {
    return DEFAULT_QUICK_LAUNCH
  }
}

let quick = null
const qlListeners = new Set()
const all = () => (quick ||= readQuickLaunch())

const save = (next) => {
  quick = next
  try {
    localStorage.setItem(QL_KEY, JSON.stringify(next))
  } catch {
    // fine: just for this visit
  }
  qlListeners.forEach((fn) => fn(next))
}

export const entryKey = (e) => (e.kind === "desktop" ? "desktop" : e.kind === "file" ? `file:${e.path}` : `program:${e.name}`)

export const addQuickLaunch = (entry) => {
  if (all().some((e) => entryKey(e) === entryKey(entry))) return false
  save([...all(), entry])
  unlock("quick-launch")
  return true
}

export const removeQuickLaunch = (key) => save(all().filter((e) => entryKey(e) !== key))
export const resetQuickLaunch = () => save(DEFAULT_QUICK_LAUNCH)

export const useQuickLaunch = () => {
  const [value, setValue] = useState(all)
  useEffect(() => {
    qlListeners.add(setValue)
    setValue(all())
    return () => qlListeners.delete(setValue)
  }, [])
  return value
}

// A desktop icon dropped on the Quick Launch toolbar: add it there (the icon itself stays
// put). Returns true if it landed on the toolbar.
export const quickLaunchDrop = (icon, event, node) => {
  const point = event?.changedTouches?.[0] || event
  if (!point || point.clientX === undefined) return false
  const onBar = document.elementsFromPoint(point.clientX, point.clientY).some((el) => !node?.contains(el) && el.closest?.(".quickLaunch"))
  if (!onBar) return false
  if (icon.item) addQuickLaunch({ kind: "file", path: fs.partsOf(icon.item).join("/") })
  else addQuickLaunch({ kind: "program", name: icon.name })
  return true
}
