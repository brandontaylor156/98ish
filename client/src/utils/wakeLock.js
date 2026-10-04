import { useEffect, useState } from "react"
import { getSettings, subscribeSettings } from "./settings"

// Power Management's "Keep the screen on while 98ish is open": a screen Wake Lock, taken
// again whenever 98ish comes back to the front (the browser lets go of it when hidden).
// Browsers without the Wake Lock API just don't offer the option.

let sentinel = null
let pending = false
const listeners = new Set()
const notify = () => listeners.forEach((fn) => fn(!!sentinel))

export const wakeLockSupported = () => typeof navigator !== "undefined" && "wakeLock" in navigator

const sync = async () => {
  if (!wakeLockSupported() || pending) return
  const want = getSettings().keepAwake && document.visibilityState === "visible"
  if (want && !sentinel) {
    pending = true
    try {
      const lock = await navigator.wakeLock.request("screen")
      sentinel = lock
      lock.addEventListener("release", () => {
        if (sentinel === lock) sentinel = null
        notify()
      })
    } catch {
      // not allowed right now (battery saver, no tap yet): tried again next time
    } finally {
      pending = false
    }
  } else if (!want && sentinel) {
    const lock = sentinel
    sentinel = null
    lock.release().catch(() => {})
  }
  notify()
}

// returns the cleanup, for useEffect (OS-specific/A11yHost.jsx)
export const watchWakeLock = () => {
  const unsubscribe = subscribeSettings(() => sync())
  document.addEventListener("visibilitychange", sync)
  sync()
  return () => {
    unsubscribe()
    document.removeEventListener("visibilitychange", sync)
  }
}

export const useWakeLockActive = () => {
  const [on, setOn] = useState(!!sentinel)
  useEffect(() => {
    listeners.add(setOn)
    setOn(!!sentinel)
    return () => listeners.delete(setOn)
  }, [])
  return on
}
