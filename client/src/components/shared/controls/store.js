import { useSyncExternalStore } from "react"
import { useIsTouch } from "../../../hooks/useMediaQuery"
import { STORAGE_KEY, readStore, withLayout, withPrefs, writeStore } from "./layout"

// The saved controls (localStorage "98ish.controls"), shared by every game window and kept
// in sync between them (and other tabs)

let store = null
const listeners = new Set()
const current = () => (store ||= readStore())
const emit = () => listeners.forEach((fn) => fn())

const subscribe = (fn) => {
  listeners.add(fn)
  const onStorage = (e) => {
    if (e.key !== STORAGE_KEY) return
    store = readStore()
    fn()
  }
  window.addEventListener("storage", onStorage)
  return () => {
    listeners.delete(fn)
    window.removeEventListener("storage", onStorage)
  }
}

const update = (next) => {
  store = next
  writeStore(store)
  emit()
}

export const useControlsStore = () => useSyncExternalStore(subscribe, current, current)

export const saveLayout = (game, orientation, layout) => update(withLayout(current(), game, orientation, layout))
export const resetLayout = (game, orientation) => update(withLayout(current(), game, orientation, null))
export const setControlPrefs = (prefs) => update(withPrefs(current(), prefs))

// Touch controls show on touch screens; the player can force them on (e.g. a desktop with a
// touch screen that reports a fine pointer) or off
export const useTouchControlsVisible = () => {
  const touch = useIsTouch()
  const { show } = useControlsStore().prefs
  return show === "on" || (show !== "off" && touch)
}

// A menu item for any game: { label, checked, onClick } toggles them
export const useTouchControlsMenuItem = () => {
  const visible = useTouchControlsVisible()
  return { label: "Show Touch Controls", checked: visible, onClick: () => setControlPrefs({ show: visible ? "off" : "on" }) }
}
