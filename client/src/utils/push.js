// Web Push on the client: can this browser get notifications with 98ish closed, is it an
// iPhone that first needs 98ish on its Home Screen, and turning it on and off (the
// subscription goes to the server under the signed-on 98 Messenger account).
// The server side and the settings are in server/push.

import { useSyncExternalStore } from "react"

export const SERVER_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:8000"
const DEVICE_KEY = "98ish.push.device" // { endpoint, account } of this browser's subscription

// the signed-on 98 Messenger session, for the taskbar's settings (outside the Messenger
// provider): { token, account, screenName } or null. NotifyBridge keeps it current.
let session = null
const sessionListeners = new Set()
export const setPushSession = (value) => {
  if (session?.token === value?.token && session?.account === value?.account) return
  session = value
  sessionListeners.forEach((fn) => fn())
}
export const usePushSession = () =>
  useSyncExternalStore(
    (fn) => (sessionListeners.add(fn), () => sessionListeners.delete(fn)),
    () => session
  )

const ua = () => (typeof navigator === "undefined" ? "" : navigator.userAgent || "")
// iPads say they're Macs; a touch screen gives them away
export const isIos = () => /iPhone|iPad|iPod/.test(ua()) || (/Macintosh/.test(ua()) && (navigator.maxTouchPoints || 0) > 1)
export const isAndroid = () => /Android/.test(ua())
export const isStandalone = () => {
  try {
    return window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true
  } catch {
    return false
  }
}
// 16.4 is when iPhones got Web Push (for apps on the Home Screen)
export const iosVersion = () => {
  const m = /OS (\d+)[._](\d+)/.exec(ua())
  return m ? Number(m[1]) + Number(m[2]) / 100 : null
}

export const pushApis = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window

// where this browser stands:
//   "unsupported"  no Web Push here
//   "ios-old"      an iPhone older than iOS 16.4
//   "ios-install"  an iPhone in Safari: add 98ish to the Home Screen first
//   "denied"       notifications blocked in the browser's settings
//   "ready"        can turn on (needs a tap)
//   "granted"      allowed already (may or may not be subscribed)
export const pushState = () => {
  if (isIos() && !isStandalone()) {
    const v = iosVersion()
    return v && v < 16.4 ? "ios-old" : "ios-install"
  }
  if (!pushApis()) return isIos() && (iosVersion() || 0) < 16.4 ? "ios-old" : "unsupported"
  if (Notification.permission === "denied") return "denied"
  if (Notification.permission === "granted") return "granted"
  return "ready"
}

const api = async (method, path, token, body) => {
  try {
    const response = await fetch(`${SERVER_URL}/api/push${path}`, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const data = await response.json().catch(() => ({}))
    return { ...data, ok: response.ok && data.ok !== false, status: response.status }
  } catch {
    return { ok: false, status: 0, error: "The 98ish server isn't answering. It may be waking up; give it a minute." }
  }
}

let configPromise = null
export const getPushConfig = (fresh = false) => {
  if (fresh || !configPromise) configPromise = api("GET", "/config").then((r) => (r.ok ? r : (configPromise = null, { enabled: false })))
  return configPromise
}

const urlKey = (base64) => {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/")
  const raw = atob(padded)
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

const readDevice = () => {
  try {
    return JSON.parse(localStorage.getItem(DEVICE_KEY)) || null
  } catch {
    return null
  }
}
const writeDevice = (value) => {
  try {
    if (value) localStorage.setItem(DEVICE_KEY, JSON.stringify(value))
    else localStorage.removeItem(DEVICE_KEY)
  } catch {
    // storage blocked
  }
}

export const deviceName = () => {
  const u = ua()
  const kind = /iPad/.test(u) ? "iPad" : /iPhone/.test(u) ? "iPhone" : isIos() ? "iPad" : /Android/.test(u) ? "Android phone" : /Mac/.test(u) ? "Mac" : /Windows/.test(u) ? "Windows PC" : /CrOS/.test(u) ? "Chromebook" : /Linux/.test(u) ? "Linux PC" : "Computer"
  const browser = isStandalone() ? "98ish app" : /Edg\//.test(u) ? "Edge" : /Firefox\//.test(u) ? "Firefox" : /Chrome\//.test(u) ? "Chrome" : /Safari\//.test(u) ? "Safari" : "browser"
  return `${kind} (${browser})`
}

// the service worker (it's only registered on the real site; turning push on registers it)
const registration = async () => {
  const existing = await navigator.serviceWorker.getRegistration()
  if (existing) return existing
  await navigator.serviceWorker.register("/sw.js")
  return navigator.serviceWorker.ready
}

// this browser's current subscription, if any
export const currentSubscription = async () => {
  if (!pushApis()) return null
  try {
    const reg = await navigator.serviceWorker.getRegistration()
    return (await reg?.pushManager.getSubscription()) || null
  } catch {
    return null
  }
}

// is push on for this account on this browser?
export const pushOnHere = async (account) => {
  const sub = await currentSubscription()
  const saved = readDevice()
  return !!sub && Notification.permission === "granted" && saved?.endpoint === sub.endpoint && (!account || saved.account === account)
}

// Call from a tap (iPhones only ask from one). Returns { ok, error? }.
export const enablePush = async (token, account) => {
  if (!token) return { ok: false, error: "Sign on to 98 Messenger first: notifications go to your screen name." }
  if (!pushApis()) return { ok: false, error: "This browser can't show notifications while 98ish is closed." }
  // ask first, straight from the tap (Safari forgets the tap after anything slow)
  const asking = Notification.permission === "granted" ? Promise.resolve("granted") : Notification.requestPermission()
  const [permission, config] = await Promise.all([asking, getPushConfig()])
  if (permission !== "granted") return { ok: false, error: permission === "denied" ? "Notifications are blocked for 98ish. Allow them in your browser's settings, then try again." : "Notifications weren't allowed." }
  if (!config.enabled || !config.publicKey) return { ok: false, error: "Notifications aren't set up on this 98ish server yet." }
  try {
    const reg = await registration()
    let sub = await reg.pushManager.getSubscription()
    // a subscription made with an old server key can't be used
    const key = sub?.options?.applicationServerKey
    if (sub && key && btoa(String.fromCharCode(...new Uint8Array(key))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") !== config.publicKey.replace(/=+$/, "")) {
      await sub.unsubscribe().catch(() => {})
      sub = null
    }
    sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlKey(config.publicKey) })
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    const result = await api("POST", "/subscribe", token, { subscription: sub.toJSON(), device: deviceName(), tz })
    if (!result.ok) return { ok: false, error: result.error || "The 98ish server didn't take it. Try again." }
    writeDevice({ endpoint: sub.endpoint, account })
    return { ok: true, settings: result.settings }
  } catch (error) {
    return { ok: false, error: `Couldn't turn on notifications here (${error?.message || "unknown error"}).` }
  }
}

export const disablePush = async (token) => {
  const sub = await currentSubscription()
  if (sub) {
    if (token) await api("POST", "/unsubscribe", token, { endpoint: sub.endpoint })
    await sub.unsubscribe().catch(() => {})
  }
  writeDevice(null)
  return { ok: true }
}

// signed on as someone else on this browser: the subscription moves to them
export const resubscribeIfNeeded = async (token, account) => {
  const saved = readDevice()
  if (!saved || !token || saved.account === account || Notification.permission !== "granted") return
  const sub = await currentSubscription()
  if (!sub) return writeDevice(null)
  const result = await api("POST", "/subscribe", token, { subscription: sub.toJSON(), device: deviceName(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone })
  if (result.ok) writeDevice({ endpoint: sub.endpoint, account })
}

export const getPushSettings = (token) => api("GET", "/settings", token)
export const savePushSettings = (token, patch) => api("PUT", "/settings", token, patch)
export const sendTestPush = (token) => api("POST", "/test", token)
export const getSeen = (token) => api("GET", "/seen", token)
export const putSeen = (token, seenAt) => api("PUT", "/seen", token, { seenAt })

// pushes that arrived while 98ish was closed (the service worker keeps them for us)
export const INBOX_CACHE = "push-inbox-98ish"
export const takePushInbox = async () => {
  try {
    if (!("caches" in window)) return []
    const cache = await caches.open(INBOX_CACHE)
    const res = await cache.match("/__push-inbox")
    if (!res) return []
    const list = await res.json()
    await cache.delete("/__push-inbox")
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

// notifications still showing on this device: closed once 98ish is in front (the
// Notification Center has them)
export const closeShownNotifications = async () => {
  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    for (const n of (await reg?.getNotifications()) || []) n.close()
  } catch {
    // not supported
  }
}
