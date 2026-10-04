import { useSyncExternalStore } from "react"
import { currentUser, currentUserId, getUser, rawGet, rawSet, updateUser } from "./users"
import { getSettings } from "./settings"
import { delayAfter, hashSecret, verifySecret } from "./lockCrypto"
import { afterWrongTry, createIdleLock, shouldLockOnLoad, waitLeft } from "./lockTimers"

// The lock screen's state ("Lock Computer", the screen saver password, idle locking).
// Device state lives in localStorage "98ish.lock" (not per person):
//   { locked, lastActive, fails: { [userId]: { count, until } } }
// so a reload (iPhone Safari does that a lot) opens locked if it was locked, or if 98ish
// sat unused longer than the person's "lock after" wait. Each person's password or PIN is
// a salted hash in their profile (utils/users.js, utils/lockCrypto.js).
// Per-person settings (utils/settings.js): lockAfter (minutes idle, 0 = never) and
// lockOnSaver (Display Properties' "Password protected").

const STATE_KEY = "98ish.lock"
const TOUCH_EVERY_MS = 10_000

const readState = () => {
  try {
    const saved = JSON.parse(rawGet(STATE_KEY))
    return { locked: !!saved?.locked, lastActive: Number(saved?.lastActive) || 0, fails: saved?.fails && typeof saved.fails === "object" ? saved.fails : {} }
  } catch {
    return { locked: false, lastActive: 0, fails: {} }
  }
}
let state = readState()
const persist = () => rawSet(STATE_KEY, JSON.stringify(state))

export const hasSecret = (user = currentUser()) => !!user?.lock?.hash

// ---- the store React reads ----

const listeners = new Set()
let snapshot = { locked: false, notices: 0, call: null, pendingAnswer: null }
const emit = (patch) => {
  snapshot = { ...snapshot, ...patch }
  listeners.forEach((fn) => fn())
}
const subscribe = (fn) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
export const subscribeLock = subscribe
export const getLock = () => snapshot
export const useLock = () => useSyncExternalStore(subscribe, getLock)
export const isLocked = () => snapshot.locked

// decided once per page load
snapshot.locked = shouldLockOnLoad({
  hasSecret: hasSecret(),
  locked: state.locked,
  lastActive: state.lastActive,
  now: Date.now(),
  lockAfter: getSettings().lockAfter,
})
if (state.locked !== snapshot.locked) {
  state.locked = snapshot.locked
  persist()
}

// While locked, keys go only to the lock screen: apps listening on the whole page (games,
// the taskbar's shortcuts) never see them. Registered when this module loads, so it runs
// before every other window listener. Typing in the lock screen's own fields still works
// (nothing is cancelled there; its form submits on Enter by itself).
if (typeof window !== "undefined") {
  const block = (e) => {
    if (!snapshot.locked) return
    const inside = e.target instanceof Element && e.target.closest(".lockScreen")
    e.stopImmediatePropagation()
    if (!inside && e.type !== "keyup") e.preventDefault()
  }
  for (const type of ["keydown", "keypress", "keyup", "contextmenu"]) window.addEventListener(type, block, true)
}

// ---- lock and unlock ----

// Locks if the person logged on has a password or PIN. True if it locked.
export const lockNow = () => {
  if (!hasSecret()) return false
  if (!snapshot.locked) {
    state.locked = true
    state.lastActive = Date.now()
    persist()
    emit({ locked: true, notices: 0, pendingAnswer: null })
  }
  return true
}

const unlocked = () => {
  state.locked = false
  state.lastActive = Date.now()
  persist()
  const answer = snapshot.pendingAnswer
  const call = snapshot.call
  emit({ locked: false, notices: 0, pendingAnswer: null })
  // "Unlock to answer": the call is answered once you're in, if it's still ringing
  if (answer && call?.answer) call.answer(answer.video)
}

// seconds left before person `id` may try again (0 = now)
export const waitFor = (id = currentUserId()) => waitLeft(state.fails[id], Date.now())
export const failCount = (id = currentUserId()) => state.fails[id]?.count || 0

// Checks a password or PIN for person `id`, counting wrong tries (shared by the lock
// screen and Log On). -> { ok } | { ok: false, wait (seconds), error }
export const checkSecretFor = async (id, secret) => {
  const user = getUser(id)
  if (!hasSecret(user)) return { ok: true }
  const wait = waitFor(id)
  if (wait) return { ok: false, wait, error: `Too many wrong tries. Try again in ${wait} seconds.` }
  if (await verifySecret(secret, user.lock)) {
    delete state.fails[id]
    persist()
    return { ok: true }
  }
  state.fails[id] = afterWrongTry(state.fails[id], Date.now(), delayAfter)
  persist()
  const next = waitFor(id)
  const word = user.lock.kind === "pin" ? "PIN" : "password"
  return { ok: false, wait: next, error: next ? `That ${word} is incorrect. Too many wrong tries: try again in ${next} seconds.` : `That ${word} is incorrect. Try again.` }
}

export const tryUnlock = async (secret) => {
  const result = await checkSecretFor(currentUserId(), secret)
  if (result.ok) unlocked()
  return result
}

// Forgot PIN: the lock settings were reset (Messenger sign-in or the local wipe)
export const forceUnlock = () => {
  delete state.fails[currentUserId()]
  unlocked()
}

// ---- setting a password or PIN ----

export const setSecret = async (id, kind, secret) => {
  const record = await hashSecret(kind, secret)
  updateUser(id, { lock: record })
  delete state.fails[id]
  persist()
}
export const clearSecret = (id) => {
  updateUser(id, { lock: null })
  delete state.fails[id]
  if (id === currentUserId() && state.locked) unlocked()
  else persist()
}

// ---- activity: idle locking and coming back to the page ----

export const touch = (force = false) => {
  const now = Date.now()
  if (!force && now - state.lastActive < TOUCH_EVERY_MS) return
  state.lastActive = now
  persist()
}

const INPUT = ["pointerdown", "keydown", "wheel", "touchstart"]

// Runs while the desktop shows: locks after `lockAfter` idle minutes, and when the page
// comes back after being away that long. Returns the stop function.
export const watchActivity = () => {
  const minutes = () => (hasSecret() ? Number(getSettings().lockAfter) || 0 : 0)
  let idle = createIdleLock({ minutes: minutes(), onIdle: () => lockNow() })
  let mx = null
  let my = null
  const poke = () => {
    if (snapshot.locked) return
    idle.poke()
    touch()
  }
  const onMove = (e) => {
    if (e.clientX === mx && e.clientY === my) return
    mx = e.clientX
    my = e.clientY
    poke()
  }
  let currentMinutes = minutes()
  const tick = () => {
    if (snapshot.locked) return
    // not in the middle of a call or a full-screen video
    if (callLive || document.fullscreenElement || document.webkitFullscreenElement) return idle.poke()
    const m = minutes()
    if (m !== currentMinutes) {
      currentMinutes = m
      idle = createIdleLock({ minutes: m, onIdle: () => lockNow() })
    }
    idle.tick()
  }
  const onHide = () => {
    if (document.visibilityState === "hidden") touch(true)
    else tick() // back: the timers were paused, so check at once
  }
  const onPageHide = () => touch(true)
  const timer = setInterval(tick, 1000)
  INPUT.forEach((t) => window.addEventListener(t, poke, { capture: true, passive: true }))
  window.addEventListener("mousemove", onMove, { capture: true, passive: true })
  document.addEventListener("visibilitychange", onHide)
  window.addEventListener("pagehide", onPageHide)
  touch(true)
  return () => {
    clearInterval(timer)
    INPUT.forEach((t) => window.removeEventListener(t, poke, { capture: true, passive: true }))
    window.removeEventListener("mousemove", onMove, { capture: true, passive: true })
    document.removeEventListener("visibilitychange", onHide)
    window.removeEventListener("pagehide", onPageHide)
  }
}

// a 98 Messenger call is going on (CallManager): no idle locking meanwhile
let callLive = false
export const setCallLive = (live) => {
  callLive = !!live
}

// ---- what shows on the lock screen ----

// Something arrived while locked (an IM, mail, a letter): the lock screen says only
// "New message", never who or what. Ignored while unlocked.
export const notifyLocked = () => {
  if (snapshot.locked) emit({ notices: snapshot.notices + 1 })
}

// An incoming 98 Messenger call (CallManager): { peer, video, answer(video), decline() } or null
export const setLockCall = (call) => {
  if (!call && !snapshot.call) return
  emit({ call, pendingAnswer: call ? snapshot.pendingAnswer : null })
}
// "Answer" on the lock screen: answered as soon as you unlock
export const answerAfterUnlock = (video) => emit({ pendingAnswer: { video } })
