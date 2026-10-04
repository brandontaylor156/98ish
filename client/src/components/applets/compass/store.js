// Compass's saved things, per person (localStorage goes through the user-profile seam in
// utils/userStorage.js, so each 98ish user has their own): bookmarks, history, downloads,
// settings, and the tabs to bring back next time. Every Compass window shares them and
// re-renders when they change (useCompass).

import { useSyncExternalStore } from "react"
import { DEFAULT_ENGINE, NEW_TAB, hostOf, isWeb } from "./urls"

const KEYS = {
  bookmarks: "98ish.compass.bookmarks",
  history: "98ish.compass.history",
  downloads: "98ish.compass.downloads",
  prefs: "98ish.compass.prefs",
  tabs: "98ish.compass.tabs",
}
const MAX_HISTORY = 2000
const MAX_DOWNLOADS = 100
const MAX_BOOKMARKS = 500

export const DEFAULT_BOOKMARKS = [
  { title: "Wikipedia", url: "https://en.wikipedia.org/", bar: true },
  { title: "DuckDuckGo", url: "https://html.duckduckgo.com/html/", bar: true },
  { title: "Hacker News", url: "https://news.ycombinator.com/", bar: true },
  { title: "BBC News", url: "https://www.bbc.com/news", bar: true },
  { title: "Weather", url: "https://wttr.in/?format=v2", bar: true },
  { title: "Old Reddit", url: "https://old.reddit.com/", bar: false },
  { title: "Craigslist", url: "https://www.craigslist.org/", bar: false },
]
export const DEFAULT_PREFS = {
  engine: DEFAULT_ENGINE,
  home: NEW_TAB,
  dataSaver: false, // load sites directly when they allow framing (fewer features, no relay data)
  relayAll: false, // pictures and scripts through the relay too (for sites whose pictures don't show)
  alwaysReal: [], // sites to open in the real browser
  passwordOk: [], // sites where the password notice was dismissed
  zoom: {}, // host -> zoom
  noticeSeen: false,
  restoreTabs: true,
}

const read = (key, fallback) => {
  try {
    const v = localStorage.getItem(key)
    return v === null ? fallback : JSON.parse(v)
  } catch {
    return fallback
  }
}
const write = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

const newId = () => Math.random().toString(36).slice(2, 10)

let state = null
const listeners = new Set()
const load = () => {
  const saved = read(KEYS.bookmarks, null)
  state = {
    bookmarks: Array.isArray(saved) ? saved : DEFAULT_BOOKMARKS.map((b, i) => ({ ...b, id: newId(), at: i })),
    history: read(KEYS.history, []),
    downloads: read(KEYS.downloads, []),
    prefs: { ...DEFAULT_PREFS, ...read(KEYS.prefs, {}) },
  }
  if (!Array.isArray(state.history)) state.history = []
  if (!Array.isArray(state.downloads)) state.downloads = []
  return state
}
const get = () => state || load()
const set = (patch, key) => {
  state = { ...get(), ...patch }
  for (const name of Object.keys(patch)) write(KEYS[name], state[name])
  listeners.forEach((fn) => fn())
}

// other windows/tabs of 98ish changing them
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key && Object.values(KEYS).some((k) => e.key.endsWith(k))) {
      load()
      listeners.forEach((fn) => fn())
    }
  })
}

export const subscribe = (fn) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
export const getState = get
export const useCompass = () => useSyncExternalStore(subscribe, get, get)

// ---- bookmarks ----
export const isBookmarked = (url) => get().bookmarks.some((b) => b.url === url)
export const addBookmark = ({ title, url, bar = true }) => {
  if (!isWeb(url) || isBookmarked(url)) return false
  set({ bookmarks: [...get().bookmarks, { id: newId(), title: String(title || hostOf(url) || url).slice(0, 120), url, bar, at: Date.now() }].slice(-MAX_BOOKMARKS) })
  return true
}
export const removeBookmark = (id) => set({ bookmarks: get().bookmarks.filter((b) => b.id !== id && b.url !== id) })
export const updateBookmark = (id, patch) => set({ bookmarks: get().bookmarks.map((b) => (b.id === id ? { ...b, ...patch } : b)) })
export const moveBookmark = (id, toIndex) => {
  const list = [...get().bookmarks]
  const from = list.findIndex((b) => b.id === id)
  if (from < 0) return
  const [item] = list.splice(from, 1)
  list.splice(Math.max(0, Math.min(list.length, toIndex)), 0, item)
  set({ bookmarks: list })
}
// Internet Explorer's Favorites and the Internet Shortcuts in a folder -> how many were added
export const importBookmarks = (items) => {
  let added = 0
  const list = [...get().bookmarks]
  for (const item of items) {
    if (!isWeb(item.url) || list.some((b) => b.url === item.url)) continue
    list.push({ id: newId(), title: String(item.title || hostOf(item.url)).slice(0, 120), url: item.url, bar: false, at: Date.now() })
    added++
  }
  if (added) set({ bookmarks: list.slice(-MAX_BOOKMARKS) })
  return added
}

// ---- history ----
export const addHistory = ({ url, title }) => {
  if (!isWeb(url)) return
  const list = get().history
  const now = Date.now()
  // the same page again within a few minutes is one visit (titles arrive late)
  if (list[0] && list[0].url === url && now - list[0].at < 5 * 60 * 1000) {
    if (title && title !== list[0].title) set({ history: [{ ...list[0], title }, ...list.slice(1)] })
    return
  }
  set({ history: [{ url, title: String(title || "").slice(0, 200), at: now }, ...list].slice(0, MAX_HISTORY) })
}
export const removeHistory = (at) => set({ history: get().history.filter((h) => h.at !== at) })
export const clearHistory = () => set({ history: [] })

// ---- downloads ----
export const addDownload = (entry) => set({ downloads: [{ ...entry, at: Date.now() }, ...get().downloads].slice(0, MAX_DOWNLOADS) })
export const clearDownloads = () => set({ downloads: [] })

// ---- settings ----
export const setPrefs = (patch) => set({ prefs: { ...get().prefs, ...patch } })
export const alwaysReal = (host, on = true) => {
  const list = get().prefs.alwaysReal.filter((h) => h !== host)
  setPrefs({ alwaysReal: on ? [...list, host] : list })
}
export const zoomFor = (url) => get().prefs.zoom[hostOf(url)] || 1
export const setZoomFor = (url, zoom) => {
  const host = hostOf(url)
  if (!host) return
  const zooms = { ...get().prefs.zoom }
  if (zoom === 1) delete zooms[host]
  else zooms[host] = zoom
  setPrefs({ zoom: zooms })
}

// ---- tabs to bring back ----
export const saveTabs = (tabs) => write(KEYS.tabs, { at: Date.now(), tabs })
export const savedTabs = () => {
  const saved = read(KEYS.tabs, null)
  return saved && Array.isArray(saved.tabs) ? saved.tabs.filter((t) => t && typeof t.url === "string") : []
}
