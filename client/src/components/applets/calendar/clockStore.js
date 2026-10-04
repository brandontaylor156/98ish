import { useSyncExternalStore } from "react"

// The Clock app's alarms, timer and world clocks, kept in localStorage so they still ring
// with the Clock window closed (CalendarBridge watches them while 98ish is open).
//   alarm: { id, time: "07:30", days: [0..6] (none: just once), label, on, lastRang }
//   timer: { duration (ms), endsAt (running) | remaining (paused), label }
//   cities: IANA zones for World Clock

const KEY = "98ish.clock.app"

const read = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {}
  } catch {
    return {}
  }
}

let state = { alarms: [], timer: null, cities: ["America/New_York", "Europe/London", "Asia/Tokyo"], stopwatch: null, ...read() }
const listeners = new Set()

export const getClockApp = () => state
const set = (patch) => {
  state = { ...state, ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    // storage blocked: this visit only
  }
  listeners.forEach((fn) => fn())
}
export const useClockApp = () =>
  useSyncExternalStore((fn) => {
    listeners.add(fn)
    return () => listeners.delete(fn)
  }, getClockApp)

const id = () => Math.random().toString(36).slice(2, 10)

// ---- alarms ----

export const addAlarm = (alarm) => set({ alarms: [...state.alarms, { id: id(), time: "07:00", days: [], label: "", on: true, lastRang: null, ...alarm }].slice(0, 30) })
export const updateAlarm = (alarmId, patch) => set({ alarms: state.alarms.map((a) => (a.id === alarmId ? { ...a, ...patch } : a)) })
export const removeAlarm = (alarmId) => set({ alarms: state.alarms.filter((a) => a.id !== alarmId) })

// Alarms due at wall time `wall` ({ date: "YYYY-MM-DD", wd, h, mi }): on, the right day, the
// minute has come, and not already rung for this date and time
export const dueAlarms = (alarms, wall) =>
  alarms.filter((a) => {
    if (!a.on) return false
    const [h, m] = a.time.split(":").map(Number)
    if (wall.h !== h || wall.mi !== m) return false
    if (a.days?.length && !a.days.includes(wall.wd)) return false
    return a.lastRang !== `${wall.date} ${a.time}`
  })

export const markRang = (alarm, wall) => {
  const patch = { lastRang: `${wall.date} ${alarm.time}` }
  if (!alarm.days?.length) patch.on = false // a one-time alarm switches itself off
  updateAlarm(alarm.id, patch)
}

// ---- the timer ----

export const startTimer = (duration, label = "") => set({ timer: { duration, endsAt: Date.now() + duration, remaining: null, label } })
export const pauseTimer = () => state.timer?.endsAt && set({ timer: { ...state.timer, endsAt: null, remaining: Math.max(0, state.timer.endsAt - Date.now()) } })
export const resumeTimer = () => state.timer?.remaining && set({ timer: { ...state.timer, endsAt: Date.now() + state.timer.remaining, remaining: null } })
export const cancelTimer = () => set({ timer: null })
export const timerLeft = (timer, now = Date.now()) => (!timer ? 0 : timer.endsAt ? Math.max(0, timer.endsAt - now) : timer.remaining || 0)

// ---- the stopwatch (kept, so it keeps counting with the window closed) ----

export const stopwatchStart = () => set({ stopwatch: { startedAt: Date.now() - (state.stopwatch?.elapsed || 0), elapsed: 0, laps: state.stopwatch?.laps || [] } })
export const stopwatchStop = () => state.stopwatch?.startedAt && set({ stopwatch: { ...state.stopwatch, startedAt: null, elapsed: Date.now() - state.stopwatch.startedAt } })
export const stopwatchReset = () => set({ stopwatch: null })
export const stopwatchLap = () => state.stopwatch?.startedAt && set({ stopwatch: { ...state.stopwatch, laps: [Date.now() - state.stopwatch.startedAt, ...state.stopwatch.laps].slice(0, 99) } })
export const stopwatchElapsed = (sw, now = Date.now()) => (!sw ? 0 : sw.startedAt ? now - sw.startedAt : sw.elapsed || 0)

// ---- world clocks ----

export const addCity = (zone) => !state.cities.includes(zone) && set({ cities: [...state.cities, zone].slice(0, 12) })
export const removeCity = (zone) => set({ cities: state.cities.filter((c) => c !== zone) })
