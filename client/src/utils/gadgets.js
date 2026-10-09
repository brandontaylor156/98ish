import { useSyncExternalStore } from "react"
import { addGadget, cleanGadgets, moveGadget, removeGadget, setConfig } from "./gadgetsCore.js"

// Desktop gadgets' store (rules in gadgetsCore.js): which gadgets are out, where, and their
// settings, in localStorage "98ish.gadgets". The storage seam (utils/userStorage.js) makes
// that key per 98ish user, so each person's desktop has its own gadgets; a removed user's
// keys go with them (users.js removeUser) and Delete My Account's "erase this device" clears
// it with every other key. Device-only, never synced. A factory so tests can hand in a
// storage; the app's instance is `gadgets`.

export const GADGETS_KEY = "98ish.gadgets"
export const OPEN_GALLERY = "98ish:gadgets-gallery" // the desktop's "Gadgets..." asks for the gallery

export const createGadgetStore = (storage = () => globalThis.localStorage) => {
  const read = () => {
    try {
      return cleanGadgets(JSON.parse(storage()?.getItem(GADGETS_KEY) || "null"))
    } catch {
      return cleanGadgets(null)
    }
  }
  let state = read()
  const listeners = new Set()
  const set = (next) => {
    if (next === state) return state
    state = next
    try {
      storage()?.setItem(GADGETS_KEY, JSON.stringify(state))
    } catch {
      // storage full or blocked: this visit only
    }
    listeners.forEach((fn) => fn())
    return state
  }
  return {
    get: () => state,
    reload: () => set(read()),
    subscribe: (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    add: (kind) => set(addGadget(state, kind)),
    remove: (kind) => set(removeGadget(state, kind)),
    move: (kind, pos, desk) => set(moveGadget(state, kind, pos, desk)),
    configure: (kind, patch) => set(setConfig(state, kind, patch)),
  }
}

export const gadgets = createGadgetStore()
export const useGadgets = () => useSyncExternalStore(gadgets.subscribe, gadgets.get)
export const openGadgetGallery = () => window.dispatchEvent(new CustomEvent(OPEN_GALLERY))
