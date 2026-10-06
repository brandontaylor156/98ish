import { useSyncExternalStore } from "react"
import { dndAllowsNow } from "./dnd.js"

// The Notification Center: everything that popped up (IMs, missed calls, invitations,
// reminders, couple notices, mail, achievements, system messages), kept in this browser so
// the taskbar's bell can list it later. Apps keep their own toasts and also call
// notify(); the list is per 98 Messenger account (system items show for everyone).
//
//   notify({ app, title, text, key?, target?, time?, icon? })
//     key: items with the same key merge (the newest text wins, a count goes up), so an IM
//          from a buddy and its push notification are one item
//     target: where clicking it goes (plain data, saved with it), handled by NotifyBridge:
//          { kind: "im", with } | { kind: "call", with } | { kind: "mail" }
//          | { kind: "calendar", calendarId?, eventId? } | { kind: "program", name, extra? }
//          | { kind: "invites" } | { kind: "notifications" }
//
// Do Not Disturb (utils/dnd.js): notify() still collects everything, silently. Whatever pops
// up or makes a sound first asks interrupts(app, from): false while it's on (calls from
// people let through and, if chosen, calendar reminders still interrupt).

const KEY = "98ish.notifications"
const MAX = 100
export const OPEN_TARGET_EVENT = "98ish:open-target"

// how each kind of item is labeled and grouped in the panel
export const APPS = {
  im: { name: "98 Messenger", icon: "/assets/program_icons/aim2.png" },
  calls: { name: "Calls", icon: "/assets/program_icons/aim2.png" },
  calendar: { name: "Calendar", icon: "/assets/program_icons/calendar.svg" },
  couples: { name: "Us", icon: "/assets/program_icons/us.svg" },
  mail: { name: "98ish Mail", icon: "/assets/program_icons/mail.svg" },
  games: { name: "Games", icon: "/assets/games.png" },
  achievements: { name: "Achievements", icon: "/assets/program_icons/welcome.svg" },
  notes: { name: "Notes", icon: "/assets/program_icons/notes.svg" },
  locator: { name: "Buddy Locator", icon: "/assets/program_icons/locator.svg" },
  hangout: { name: "Come Over", icon: "/assets/program_icons/hangout.svg" },
  pbclub: { name: "Pickleball 98", icon: "/assets/program_icons/pickleball.svg" },
  tasks: { name: "Tasks", icon: "/assets/program_icons/tasks.svg" },
  photos: { name: "Photos", icon: "/assets/program_icons/photos.svg" },
  system: { name: "98ish", icon: "/assets/start98.png" },
}
export const appInfo = (app) => APPS[app] || APPS.system

// may a toast, a sound or a ring of this kind interrupt right now? (Do Not Disturb)
export const interrupts = (app = "system", from) => dndAllowsNow(app, from)

const load = () => {
  try {
    const list = JSON.parse(localStorage.getItem(KEY))
    return Array.isArray(list) ? list.filter((n) => n && n.id && n.title) : []
  } catch {
    return []
  }
}

let all = load()
let account = null // the signed-on 98 Messenger account (key), or null
let view = []
const listeners = new Set()
let seenSync = null // (time) => void: tells the server everything up to then was read

const visible = (n) => !n.account || n.account === account
const refresh = () => {
  view = all.filter(visible)
  try {
    localStorage.setItem(KEY, JSON.stringify(all.slice(0, MAX)))
  } catch {
    // storage full or blocked: this visit only
  }
  // the app icon's badge on phones and installed apps
  try {
    const unread = view.filter((n) => !n.read).length
    if (unread) navigator.setAppBadge?.(unread)?.catch?.(() => {})
    else navigator.clearAppBadge?.()?.catch?.(() => {})
  } catch {
    // not supported
  }
  listeners.forEach((fn) => fn())
}
view = all.filter(visible)

const subscribe = (fn) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
export const getNotifications = () => view
export const useNotifications = () => useSyncExternalStore(subscribe, getNotifications)
export const unreadCount = (list = view) => list.filter((n) => !n.read).length

export const setNotifyAccount = (key) => {
  if (account === (key || null)) return
  account = key || null
  refresh()
}
export const getNotifyAccount = () => account
export const onSeen = (fn) => (seenSync = fn)

let counter = 0
const newId = () => `${Date.now().toString(36)}-${(counter++).toString(36)}-${Math.random().toString(36).slice(2, 6)}`

export const notify = ({ app = "system", title, text = "", key = null, target = null, time = Date.now(), icon = null, read = false, global = false } = {}) => {
  if (!title) return null
  const owner = global ? null : account
  const clean = (s, max) => String(s ?? "").slice(0, max)
  const existing = key ? all.find((n) => n.key === key && n.account === owner) : null
  if (existing) {
    // the same thing again (another IM from that buddy) or a copy of it (its push)
    const newer = time >= existing.time
    const updated = {
      ...existing,
      title: newer ? clean(title, 120) : existing.title,
      text: newer ? clean(text, 300) : existing.text,
      time: Math.max(existing.time, time),
      read: read && existing.read,
      count: newer && !existing.read && existing.text !== clean(text, 300) ? (existing.count || 1) + 1 : existing.count || 1,
    }
    all = [updated, ...all.filter((n) => n !== existing)]
    refresh()
    return existing.id
  }
  const item = { id: newId(), key, app, title: clean(title, 120), text: clean(text, 300), time, read, target, icon, account: owner, count: 1 }
  all = [item, ...all].sort((a, b) => b.time - a.time).slice(0, MAX)
  refresh()
  return item.id
}

export const markRead = (id) => {
  if (!all.some((n) => n.id === id && !n.read)) return
  all = all.map((n) => (n.id === id ? { ...n, read: true } : n))
  refresh()
}
// e.g. every IM from a buddy once their IM window is in front
export const markReadWhere = (test) => {
  if (!view.some((n) => !n.read && test(n))) return
  all = all.map((n) => (visible(n) && !n.read && test(n) ? { ...n, read: true } : n))
  refresh()
}
export const markAllRead = () => {
  all = all.map((n) => (visible(n) ? { ...n, read: true } : n))
  refresh()
  seenSync?.(Date.now())
}
// read on another device (the server's seenAt for this account)
export const applySeen = (seenAt) => {
  if (!seenAt) return
  markReadWhere((n) => n.time <= seenAt)
}
export const dismiss = (id) => {
  all = all.filter((n) => n.id !== id)
  refresh()
}
// Delete My Account: that account's notifications leave this device
export const forgetNotifications = (key) => {
  all = all.filter((n) => n.account !== key)
  if (account === key) account = null
  refresh()
}
export const clearAll = () => {
  all = all.filter((n) => !visible(n))
  refresh()
  seenSync?.(Date.now())
}

export const openTarget = (target) => {
  if (target) window.dispatchEvent(new CustomEvent(OPEN_TARGET_EVENT, { detail: target }))
}
export const openNotification = (item) => {
  markRead(item.id)
  openTarget(item.target)
}

// "Just now", "5 min ago", "2:14 PM", "Yesterday", "Oct 1"
export const timeAgo = (time, now = Date.now()) => {
  const s = Math.round((now - time) / 1000)
  if (s < 60) return "Just now"
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  const d = new Date(time)
  const today = new Date(now)
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
  const yesterday = new Date(now - 86_400_000)
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday"
  return d.toLocaleDateString([], { month: "short", day: "numeric" })
}

// a push notification's data (from the service worker) as a Notification Center item
export const fromPush = (data = {}) => {
  const url = (() => {
    try {
      return new URL(data.url || "/", window.location.origin)
    } catch {
      return null
    }
  })()
  return {
    app: data.app || data.category || "system",
    title: data.title || "98ish",
    text: data.body || "",
    key: data.key || data.tag || null,
    time: Number(data.time) || Date.now(),
    target: url ? targetFromParams(url.searchParams) : null,
  }
}

// ?open=im&with=NAME and friends (deep links from push notifications) as a target
export const targetFromParams = (params) => {
  const open = params.get("open")
  if (!open) return null
  const name = (k) => (params.get(k) || "").slice(0, 64)
  if (open === "im" || open === "call") return name("with") ? { kind: open, with: name("with") } : null
  if (open === "mail" || open === "invites" || open === "notifications") return { kind: open }
  if (open === "calendar") return { kind: "calendar", calendarId: name("cal") || undefined, eventId: name("event") || undefined }
  if (open === "program" && name("name")) {
    const extra = params.get("challenge") ? { challengeId: name("challenge") } : {}
    // a note (Notes) or a task (Tasks: a Calendar to-do event) to show
    if (params.get("note")) extra.handoff = { id: Date.now(), note: name("note") }
    // a shared album (Photos)
    else if (params.get("album")) extra.handoff = { id: Date.now(), album: name("album") }
    else if (params.get("event")) extra.handoff = { id: Date.now(), calendarId: name("cal"), eventId: name("event") }
    // Pickleball 98's Real Games: a play session or a match to confirm
    else if (/^[0-9a-f]{16}$/.test(params.get("pbsession") || "")) extra.handoff = { id: Date.now(), session: name("pbsession") }
    else if (/^[0-9a-f]{16}$/.test(params.get("pbmatch") || "")) extra.handoff = { id: Date.now(), match: name("pbmatch") }
    // a Come Over invitation (a hangout to join)
    else if (/^[0-9a-f]{16}$/.test(params.get("hangout") || "")) extra.handoff = { id: Date.now(), hangout: name("hangout") }
    // Live Broadcast: a friend's game to watch live (Pickleball 98); code = the share link's
    else if (/^[0-9a-f]{12}$/.test(params.get("live") || "")) extra.handoff = { id: Date.now(), live: name("live"), code: /^[0-9a-f]{10}$/.test(params.get("code") || "") ? name("code") : null }
    // a Watch Together invitation to join
    else if (/^[0-9a-f]{20}$/.test(params.get("together") || "")) extra.handoff = { id: Date.now(), together: name("together") }
    return { kind: "program", name: name("name"), extra }
  }
  return null
}
