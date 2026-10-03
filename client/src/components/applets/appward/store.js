import { useSyncExternalStore } from "react"
import { handleFor, load, serialize } from "./engine.js"

// Each person's Appward 98 workspace lives in this browser's localStorage under their
// sign-in name, as compact versioned JSON (engine.js migrates older saves). The shell
// changes the workspace through change(), which saves and redraws.

const PREFIX = "98ish.appward."
const LAST_USER = PREFIX + "lastUser"

export const keyFor = (user) => `${PREFIX}ws.${handleFor(user)}`

export const readWorkspace = (user) => {
  try {
    const raw = localStorage.getItem(keyFor(user))
    return raw ? load(raw) : null
  } catch {
    return null
  }
}

export const lastUser = () => {
  try {
    return localStorage.getItem(LAST_USER) || ""
  } catch {
    return ""
  }
}

let current = { user: "", ws: null, rev: 0, saveError: "" }
const listeners = new Set()
const emit = () => listeners.forEach((fn) => fn())

const save = () => {
  if (!current.ws) return
  try {
    localStorage.setItem(keyFor(current.user), serialize(current.ws))
    current.saveError = ""
  } catch {
    current.saveError = "Your workspace couldn't be saved: this browser's storage is full."
  }
}

export const openWorkspace = (user, ws) => {
  current = { user, ws, rev: ws.rev, saveError: "" }
  try {
    localStorage.setItem(LAST_USER, user)
  } catch {
    // remembered for this visit only
  }
  save()
  emit()
}

// swap in a whole workspace for the signed-in person (Import, Reset)
export const replaceWorkspace = (ws) => openWorkspace(current.user, ws)
export const currentUser = () => current.user

export const closeWorkspace = () => {
  current = { user: "", ws: null, rev: 0, saveError: "" }
  emit()
}

// run fn on the workspace, then save and redraw; returns what fn returned
export const change = (fn) => {
  if (!current.ws) return null
  const out = fn(current.ws)
  current = { ...current, rev: current.ws.rev + Math.random() }
  save()
  emit()
  return out
}

export const deleteWorkspace = (user) => {
  try {
    localStorage.removeItem(keyFor(user))
  } catch {
    // nothing to remove
  }
}

const subscribe = (fn) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export const useWorkspace = () => useSyncExternalStore(subscribe, () => current)
