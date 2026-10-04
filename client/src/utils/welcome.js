import { useSyncExternalStore } from "react"
import { getSettings } from "./settings"
import { launch } from "./programs"

// The Welcome to 98ish screen and its guided tour (components/applets/welcome).
// Kept in this browser under 98ish.welcome: whether the screen shows each time 98ish
// starts, and how far the tour got (so it can pick up where it left off). The value
// "off" also turns the screen off.

const KEY = "98ish.welcome"
const DEFAULTS = { show: true, tourStep: 0, tourDone: false }

// the tour's stops, in order (their words and targets are in applets/welcome/tourSteps.js)
export const TOUR_STEPS = ["hello", "start", "startMenu", "programs", "icons", "window", "titleBar", "playOnline", "taskbar", "tray", "messenger", "display", "finish"]

const read = () => {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw === "off") return { ...DEFAULTS, show: false }
    return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULTS }
  }
}

let prefs = read()
let tour = null // { step, fromWelcome } while the tour is running

const listeners = new Set()
const emit = () => listeners.forEach((fn) => fn())
const subscribe = (fn) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export const getWelcome = () => prefs

export const setWelcome = (patch) => {
  prefs = { ...prefs, ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    // storage blocked: remember it for this visit only
  }
  emit()
}

export const useWelcome = () => useSyncExternalStore(subscribe, () => prefs)

// ---- the tour ----

export const startTour = (step = 0, fromWelcome = false) => {
  tour = { step: Math.max(0, Math.min(step, TOUR_STEPS.length - 1)), fromWelcome }
  setWelcome({ tourStep: tour.step })
}

export const setTourStep = (step) => {
  if (!tour) return
  tour = { ...tour, step }
  setWelcome({ tourStep: step })
}

// done: reached the end (next time it starts from the top)
export const endTour = (done = false) => {
  tour = null
  setWelcome(done ? { tourDone: true, tourStep: 0 } : {})
}

export const getTour = () => tour
export const useTour = () => useSyncExternalStore(subscribe, () => tour)

// ---- at startup ----

// Once per visit, after the startup screens: unless it's been turned off, or Floppy has
// (anyone who wants a quiet desktop, and the automated tests), or the visit is a game
// invitation link (?join=CODE), which goes straight to the game.
let checked = false
export const welcomeAtStartup = () => {
  if (checked) return false
  checked = true
  if (!getSettings().helper || prefs.show === false) return false
  try {
    if (["join", "calendar", "open"].some((k) => new URLSearchParams(window.location.search).has(k))) return false
  } catch {
    // no URL to read
  }
  return true
}

// the Welcome window, centered on a big screen
export const welcomeWindow = (mobile) => {
  if (mobile) return launch("Welcome to 98ish")
  const w = 660
  const h = 480
  const vw = document.documentElement.clientWidth || 1024
  const vh = (window.innerHeight || 768) - (document.querySelector(".taskbar")?.offsetHeight || 30)
  return launch("Welcome to 98ish", { initialX: Math.max(0, Math.round((vw - w) / 2)), positionY: Math.max(1, Math.round((vh - h) / 2.6)) })
}
