import { useSyncExternalStore } from "react"
import { launch } from "../../../utils/programs"
import { getSettings } from "../../../utils/settings"

// What the rest of the desktop knows about 98ish Mail: how many unread messages are in
// the Inbox (the tray envelope) and a counter that goes up whenever new mail arrives (so
// an open Mail window refreshes). Kept tiny: the Mail program itself loads on demand.

export const MAIL_PROGRAM = "98ish Mail"
export const SERVER_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:8000"

let state = { unread: 0, arrived: 0 }
const listeners = new Set()

export const getMailStatus = () => state
export const setMailStatus = (patch) => {
  state = { ...state, ...patch }
  for (const fn of listeners) fn()
}
const subscribe = (fn) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
export const useMailStatus = () => useSyncExternalStore(subscribe, getMailStatus)

// Bring the Mail window forward, or open one
export const openMail = (windows, dispatch) => {
  const index = windows.findIndex((w) => !w.closed && w.app === "mail")
  if (index >= 0) dispatch({ type: "focus_window", payload: { index } })
  else dispatch({ type: "open_window", payload: launch(MAIL_PROGRAM) })
}

// A little three-note chime for new mail (synthesized, no sound file)
let ctx = null
export const playMailChime = () => {
  if (!getSettings().systemSounds) return
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)()
    if (ctx.state === "suspended") ctx.resume().catch(() => {})
    const out = ctx.createGain()
    out.gain.value = 0.5
    out.connect(ctx.destination)
    ;[
      [783.99, 0],
      [1046.5, 0.13],
      [1318.5, 0.26],
    ].forEach(([freq, delay]) => {
      const t = ctx.currentTime + delay
      for (const [mult, level] of [
        [1, 0.32],
        [2.01, 0.08],
      ]) {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = "sine"
        osc.frequency.setValueAtTime(freq * mult, t)
        gain.gain.setValueAtTime(0, t)
        gain.gain.linearRampToValueAtTime(level, t + 0.01)
        gain.gain.exponentialRampToValueAtTime(0.0008, t + 0.9)
        osc.connect(gain).connect(out)
        osc.start(t)
        osc.stop(t + 1)
      }
    })
  } catch {
    // no sound card: the toast is enough
  }
}
