import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import Dialog from "../../shared/Dialog"
import { BUDDY_LIST, useAim } from "../aim/AimContext"
import { ieWindow, launch } from "../../../utils/programs"
import { fs } from "../../../utils/fs"
import { folderAt, receiveFiles, summarize } from "../../../utils/receive"
import { shareOut } from "../../../utils/share"
import { SERVER, allowedFor, checkFrame, clearCookies, ensureSession, onSession, currentSession, dropSession, refreshUsage } from "./relay"
import { NEW_TAB, SEARCH_ENGINES, displayUrl, fileNameOf, hostOf, isInternal, isWeb, parseInput, rawUrl, realBrowserReason, relayUrl, suggest } from "./urls"
import * as store from "./store"
import { AboutPage, BookmarksPage, CompassLogo, DownloadsPage, Favicon, HistoryPage, NewTabPage, StubPage } from "./pages"
import "./Compass.css"

// Compass: a real web browser for 98ish, with tabs, bookmarks, history, downloads, find and
// zoom. Pages come through the 98ish server's relay (server/web) because most sites refuse
// to be framed; sites that allow it can load directly (Data Saver), and sites that can't
// work relayed (sign-ins, banks, video) are offered to the real browser.

const MAX_TABS = 12
const ZOOMS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]
// Relayed pages run in an opaque origin (no allow-same-origin; the server's CSP says the same),
// so they can't touch 98ish's storage, tokens or window. Neither kind may navigate the 98ish
// window, and their popups stay sandboxed (no allow-popups-to-escape-sandbox: an unsandboxed
// popup could navigate this window through window.opener.top). Direct frames are the site's own
// origin (never ours: the server refuses to check 98ish's own addresses).
const RELAY_SANDBOX = "allow-scripts allow-forms allow-popups allow-modals"
const DIRECT_SANDBOX = "allow-scripts allow-same-origin allow-forms allow-popups allow-modals"

// Guests browse a few sites (Wikipedia and friends); anything else asks them to sign on
const signOnStub = (url) => ({ view: "stub", stub: { kind: "signon", title: "Sign on to browse other sites", text: "Sign on with your 98 Messenger screen name to browse other sites. Without one, Compass opens Wikipedia and a few other sites.", url }, loading: false })

// The server has sent its monthly allowance (Render's free plan covers 5 GB a month for all of
// 98ish): Compass rests until the 1st, everything else in 98ish keeps working
const monthlyStub = (reopens, url) => ({
  kind: "monthly",
  title: "Compass is resting until next month",
  text: `Compass has used this month's data allowance; it's back on ${reopens.toLocaleDateString(undefined, { month: "long", day: "numeric", timeZone: "UTC" })}. Messenger and the rest of 98ish keep working. Until then, open pages in your real browser.`,
  url,
})

let nextId = 1
const makeTab = (url = NEW_TAB, title = "") => ({
  id: nextId++,
  entries: [{ url, title, favicon: null }],
  index: 0,
  frameKey: 0,
  view: "pending", // internal | relay | direct | stub | pending
  src: null,
  stub: null,
  loading: false,
  password: false,
  zoom: 1,
  tok: null,
  retried: false,
})
const entryOf = (tab) => tab.entries[tab.index]
const tabTitle = (tab) => {
  const e = entryOf(tab)
  if (e.url === NEW_TAB) return "New Tab"
  if (isInternal(e.url)) return { "compass://history": "History", "compass://bookmarks": "Bookmarks", "compass://downloads": "Downloads", "compass://about": "About Compass" }[e.url] || "Compass"
  return e.title || displayUrl(e.url) || "Untitled"
}

const Glyph = ({ d, size = 16 }) => (
  <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" shapeRendering="crispEdges">
    <path d={d} />
  </svg>
)
const G = {
  back: "M2 8l6-6v4h6v4H8v4z",
  forward: "M14 8l-6-6v4H2v4h6v4z",
  reload: "M8 2a6 6 0 1 0 6 6h-2a4 4 0 1 1-4-4v2l4-3-4-3z",
  stop: "M3 5l2-2 3 3 3-3 2 2-3 3 3 3-2 2-3-3-3 3-2-2 3-3z",
  home: "M8 1l7 7h-2v7H9v-4H7v4H3V8H1z",
  star: "M8 1l2 5h5l-4 3 2 6-5-4-5 4 2-6-4-3h5z",
  real: "M2 2h6v2H4v8h8V8h2v6H2zM9 1h6v6l-2-2-4 4-2-2 4-4z",
  menu: "M2 3h12v2H2zM2 7h12v2H2zM2 11h12v2H2z",
  lock: "M5 7V5a3 3 0 0 1 6 0v2h1v7H4V7zm2 0h2V5a1 1 0 0 0-2 0z",
  find: "M6 1a5 5 0 1 0 2.9 9.1l4 4 1.4-1.4-4-4A5 5 0 0 0 6 1zm0 2a3 3 0 1 1 0 6 3 3 0 0 1 0-6z",
  plus: "M7 2h2v5h5v2H9v5H7V9H2V7h5z",
  share: "M7 1h2v8H7zM4 4l4-3 4 3zM2 7h3v2H4v4h8V9h-1V7h3v8H2z",
}

const ToolButton = ({ icon, label, onClick, disabled, active, className = "", children }) => (
  <button type="button" className={`cmpTool ${active ? "is-active" : ""} ${className}`} onClick={onClick} disabled={disabled} title={label} aria-label={label}>
    <Glyph d={G[icon]} />
    {children}
  </button>
)

const Compass = ({ initialUrl, onTitle, onClose, onNewWindow, dispatch, mobile }) => {
  const aim = useAim()
  const token = aim?.token || null
  const data = store.useCompass()
  const prefs = data.prefs

  const [tabs, setTabs] = useState(() => {
    if (initialUrl) return [makeTab(initialUrl)]
    const saved = prefs.restoreTabs ? store.savedTabs() : []
    return saved.length ? saved.slice(0, MAX_TABS).map((t) => makeTab(t.url, t.title)) : [makeTab(prefs.home || NEW_TAB)]
  })
  const [activeId, setActiveId] = useState(() => tabs[0].id)
  const [address, setAddress] = useState("")
  const [editing, setEditing] = useState(false) // typing in the omnibox
  const [picked, setPicked] = useState(-1) // a suggestion chosen with the arrow keys
  const [find, setFind] = useState(null) // { query, count, index }
  const [dialog, setDialog] = useState(null)
  const [sheet, setSheet] = useState(null) // phone: "menu" | "tabs"
  const [session, setSession] = useState(currentSession)
  const [waking, setWaking] = useState(false)
  const [narrow, setNarrow] = useState(false)
  const [dragId, setDragId] = useState(null)
  const [toast, setToast] = useState(null)

  const rootRef = useRef(null)
  const omniRef = useRef(null)
  const findRef = useRef(null)
  const frames = useRef(new Map()) // tab id -> iframe
  const loadIds = useRef(new Map()) // tab id -> the latest load (older async answers are dropped)
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs
  const tokenRef = useRef(token)
  tokenRef.current = token

  const phone = mobile || narrow
  // guests search Wikipedia (their omnibox can't open other search engines)
  const engine = !token || (session?.allow && !allowedFor(session, hostOf(SEARCH_ENGINES[prefs.engine]?.url))) ? "wikipedia" : prefs.engine
  const active = tabs.find((t) => t.id === activeId) || tabs[0]
  const entry = entryOf(active)
  const pageUrl = entry.url

  useEffect(() => onSession(setSession), [])

  // narrow windows get the phone layout too
  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el || typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(() => setNarrow(el.clientWidth < 540))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const showToast = useCallback((text) => {
    setToast(text)
    clearTimeout(showToast.timer)
    showToast.timer = setTimeout(() => setToast(null), 3500)
  }, [])

  const updateTab = useCallback((id, fn) => setTabs((list) => list.map((t) => (t.id === id ? { ...t, ...fn(t) } : t))), [])

  // ---- loading a page into a tab ----

  // what a tab shows for an address -> a patch for the tab
  const resolveView = useCallback(async (url, { force = false } = {}) => {
    if (isInternal(url)) return { view: "internal", src: null, stub: null, loading: false }
    if (!isWeb(url)) return { view: "stub", stub: { kind: "error", title: "Compass can't open that", text: "Only web addresses (http and https) open in Compass.", url }, loading: false }
    const p = prefsRef.current
    const reason = !force && realBrowserReason(url, p.alwaysReal)
    if (reason) return { view: "stub", stub: { kind: "real", title: "This site works best in your real browser", text: reason, url, canAlways: !p.alwaysReal.includes(hostOf(url)) }, loading: false }
    let s
    try {
      s = await ensureSession(tokenRef.current, { onSlow: () => setWaking(true) })
    } catch (error) {
      setWaking(false)
      if (error.signOn) return signOnStub(url)
      // the owner turned the relay off: only sites that allow frames can show, straight from the site
      if (error.off) {
        if (url.startsWith("http:") && window.location.protocol === "https:") return { view: "stub", stub: { kind: "off", title: "Open this page in your real browser", text: "The 98ish server isn't relaying pages right now, and this page isn't secure (http), so Compass can't show it.", url }, loading: false }
        return { view: "direct", src: url, stub: null, loading: true, relayOff: true }
      }
      return { view: "stub", stub: { kind: "offline", title: "Compass can't reach the 98ish server", text: error.message, url }, loading: false }
    }
    setWaking(false)
    // off the allowlist: in "on" mode a guest can sign on for it; in "allowlist" mode nobody can
    if (!allowedFor(s, hostOf(url)))
      return s.guest && s.mode === "on" ? signOnStub(url) : { view: "stub", stub: { kind: "notallowed", title: "Open this page in your real browser", text: "Compass opens only a few sites through the 98ish server: Wikipedia and its sister sites, OpenStreetMap and example.com. Other sites open in your real browser.", url }, loading: false }
    const overBudget = s.limit && s.used >= s.limit
    // the month's data allowance is used up: only sites that allow frames, straight from the site
    const closed = s.closed ? new Date(s.closed) : null
    if (p.dataSaver || overBudget || closed) {
      const c = await checkFrame(s.sid, url)
      if (c.ok && c.frameable && (c.https || window.location.protocol === "http:")) return { view: "direct", src: c.url, stub: null, loading: true }
      if (closed) return { view: "stub", stub: monthlyStub(closed, url), loading: false }
      if (overBudget) return { view: "stub", stub: { kind: "budget", title: "Today's Compass allowance is used up", text: "The 98ish server relays a limited amount each day. This site can't load directly, so open it in your real browser (the allowance starts again tomorrow).", url }, loading: false }
    }
    return { view: "relay", src: relayUrl(SERVER, s.sid, url, p.relayAll ? "f" : "d"), stub: null, loading: true }
  }, [])

  // open url in a tab: how = "push" (a new history entry), "replace", or "entry" (back/forward/reload)
  const load = useCallback(
    async (id, url, how = "push", options = {}) => {
      const loadId = (loadIds.current.get(id) || 0) + 1
      loadIds.current.set(id, loadId)
      setFind(null)
      setTabs((list) =>
        list.map((t) => {
          if (t.id !== id) return t
          let entries = t.entries
          let index = t.index
          if (how === "push") {
            entries = [...t.entries.slice(0, t.index + 1), { url, title: "", favicon: null }]
            index = entries.length - 1
          } else if (how === "replace") entries = t.entries.map((e, i) => (i === t.index ? { url, title: "", favicon: null } : e))
          return { ...t, entries: entries.slice(-50), index: Math.min(index, 49), loading: isWeb(url), view: isInternal(url) ? "internal" : "pending", stub: null, relayOff: false, password: false, retried: options.retried || false, zoom: store.zoomFor(url) }
        })
      )
      if (id === activeIdRef.current) setEditing(false)
      const patch = await resolveView(url, options)
      if (loadIds.current.get(id) !== loadId) return
      updateTab(id, (t) => ({ ...patch, frameKey: t.frameKey + 1 }))
      if (patch.view === "relay" && !prefsRef.current.noticeSeen) setDialog({ kind: "firstRun" })
    },
    [resolveView, updateTab]
  )
  const activeIdRef = useRef(activeId)
  activeIdRef.current = activeId

  // a tab loads when it's first shown (reopened tabs don't all load at once)
  useEffect(() => {
    const t = tabsRef.current.find((x) => x.id === activeId)
    if (t && t.view === "pending" && !t.src && !loadIds.current.has(t.id)) load(t.id, entryOf(t).url, "entry")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])

  // signing on or off changes the session: reload pages that were waiting for it
  useEffect(() => {
    for (const t of tabsRef.current) if (t.view === "stub" && (t.stub?.kind === "signon" || t.stub?.kind === "offline") && token) load(t.id, entryOf(t).url, "entry")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const go = (step) => {
    const t = active
    const index = t.index + step
    if (index < 0 || index >= t.entries.length) return
    setTabs((list) => list.map((x) => (x.id === t.id ? { ...x, index } : x)))
    load(t.id, t.entries[index].url, "entry")
  }
  const reload = (id = active.id) => {
    const t = tabsRef.current.find((x) => x.id === id)
    if (!t) return
    load(id, entryOf(t).url, "entry", { force: t.stub?.kind === "real" ? false : undefined })
  }
  const stop = () => {
    frames.current.get(active.id)?.contentWindow?.postMessage({ __compass: 1, type: "stop" }, "*")
    updateTab(active.id, () => ({ loading: false }))
  }
  const open = (input, { tab = "current" } = {}) => {
    const parsed = parseInput(input, engine)
    if (!parsed) return
    if (tab === "new") return newTab(parsed.url)
    load(active.id, parsed.url, "push")
  }

  // ---- tabs ----
  const newTab = (url = NEW_TAB, { background = false } = {}) => {
    if (tabsRef.current.length >= MAX_TABS) {
      showToast(`Compass keeps up to ${MAX_TABS} tabs. Close one first.`)
      return
    }
    const t = makeTab(url)
    setTabs((list) => {
      const at = list.findIndex((x) => x.id === activeIdRef.current)
      const next = [...list]
      next.splice(at + 1, 0, t)
      return next
    })
    if (!background) setActiveId(t.id)
    load(t.id, url, "entry")
    if (url === NEW_TAB && !phone) setTimeout(() => omniRef.current?.focus(), 50)
  }
  const closeTab = (id) => {
    const list = tabsRef.current
    if (list.length === 1) {
      onClose?.()
      return
    }
    const i = list.findIndex((t) => t.id === id)
    const next = list.filter((t) => t.id !== id)
    frames.current.delete(id)
    loadIds.current.delete(id)
    setTabs(next)
    if (id === activeId) setActiveId(next[Math.min(i, next.length - 1)].id)
  }
  const moveTab = (id, toId) => {
    if (id === toId) return
    setTabs((list) => {
      const from = list.findIndex((t) => t.id === id)
      const to = list.findIndex((t) => t.id === toId)
      if (from < 0 || to < 0) return list
      const next = [...list]
      const [t] = next.splice(from, 1)
      next.splice(to, 0, t)
      return next
    })
  }

  // ---- messages from pages (inject.js on the server) ----
  useEffect(() => {
    const onMessage = (event) => {
      const d = event.data
      if (!d || d.__compass !== 1 || typeof d.type !== "string") return
      let id = null
      for (const [tid, el] of frames.current) if (el && el.contentWindow === event.source) id = tid
      if (id === null) return
      const tab = tabsRef.current.find((t) => t.id === id)
      if (!tab) return
      // a relayed page is always an opaque origin; a direct frame is never 98ish itself
      if (tab.view === "relay" && event.origin !== "null") return
      if (event.origin === window.location.origin) return
      const str = (v, max = 2000) => (typeof v === "string" ? v.slice(0, max) : "")
      if (d.type === "page") {
        const url = isWeb(d.url) ? str(d.url) : entryOf(tab).url
        const title = str(d.title, 300)
        const favicon = isWeb(d.favicon) ? str(d.favicon) : null
        setTabs((list) =>
          list.map((t) =>
            t.id !== id
              ? t
              : {
                  ...t,
                  entries: t.entries.map((e, i) => (i === t.index ? { url, title: title || (e.url === url ? e.title : ""), favicon: favicon || e.favicon } : e)),
                  password: !!d.password,
                  tok: /^[a-f0-9]{16}$/.test(d.tok || "") ? d.tok : t.tok,
                  loading: d.phase === "start" ? t.loading : d.phase === "load" || d.phase === "ready" || d.phase === "poll" ? false : t.loading,
                }
          )
        )
        if (d.phase === "start") {
          const z = store.zoomFor(url)
          if (z !== 1) event.source.postMessage({ __compass: 1, type: "zoom", zoom: z }, "*")
        }
        if (["ready", "load", "title", "history"].includes(d.phase)) store.addHistory({ url, title })
      } else if (d.type === "navigate" && isWeb(d.url)) {
        load(id, str(d.url), "push")
      } else if (d.type === "open" && isWeb(d.url)) {
        newTab(str(d.url))
      } else if (d.type === "download" && isWeb(d.url)) {
        setDialog({ kind: "download", url: str(d.url), name: str(d.name, 120) || fileNameOf(d.url), tok: tab.tok })
      } else if (d.type === "loading") {
        updateTab(id, () => ({ loading: true }))
      } else if (d.type === "unload") {
        updateTab(id, () => ({ loading: true }))
      } else if (d.type === "found") {
        if (id === activeIdRef.current) setFind((f) => (f && f.query === d.query ? { ...f, count: d.count, index: d.index } : f))
      } else if (d.type === "stub") {
        const info = { kind: str(d.kind, 20), title: str(d.title, 200), text: str(d.text, 600), url: isWeb(d.url) ? str(d.url) : entryOf(tab).url, name: str(d.name, 120), size: Number(d.size) || null, tooBig: !!d.tooBig, tok: str(d.tok, 40) || null }
        if (info.kind === "expired" && !tab.retried) {
          // the server restarted or the connection changed: a new session, then again
          dropSession()
          load(id, entryOf(tab).url, "entry", { retried: true })
          return
        }
        updateTab(id, () => ({ view: "stub", stub: info, loading: false }))
      }
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load])

  // ---- the window title, saved tabs ----
  useEffect(() => {
    onTitle?.(`${tabTitle(active)} - Compass`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active.id, entry.url, entry.title])

  useEffect(() => {
    const timer = setTimeout(() => store.saveTabs(tabs.map((t) => ({ url: entryOf(t).url, title: entryOf(t).title }))), 500)
    return () => clearTimeout(timer)
  }, [tabs])

  // the omnibox follows the page unless you're typing in it
  useEffect(() => {
    if (!editing) setAddress(pageUrl === NEW_TAB ? "" : pageUrl)
  }, [pageUrl, editing, active.id])

  // ---- find and zoom ----
  const post = (msg) => frames.current.get(active.id)?.contentWindow?.postMessage({ __compass: 1, ...msg }, "*")
  const openFind = () => {
    if (active.view === "direct") return showToast("Find needs the page to come through the 98ish relay (turn off Data Saver).")
    setFind((f) => f || { query: "", count: 0, index: -1 })
    setSheet(null)
    setTimeout(() => findRef.current?.focus(), 30)
  }
  const runFind = (query, step = 0) => {
    setFind({ query, count: find?.count || 0, index: find?.index ?? -1 })
    post({ type: "find", query, step })
  }
  const closeFind = () => {
    post({ type: "findClear" })
    setFind(null)
  }
  const setZoom = (z) => {
    const zoom = Math.round(Math.max(0.5, Math.min(2, z)) * 100) / 100
    store.setZoomFor(pageUrl, zoom)
    updateTab(active.id, () => ({ zoom }))
    if (active.view === "relay") post({ type: "zoom", zoom })
  }
  const zoomStep = (dir) => {
    const z = active.zoom || 1
    const next = dir > 0 ? ZOOMS.find((v) => v > z + 0.001) : [...ZOOMS].reverse().find((v) => v < z - 0.001)
    setZoom(next || z)
  }

  // ---- bookmarks, sharing, the real browser, downloads ----
  const bookmarked = data.bookmarks.find((b) => b.url === pageUrl)
  const toggleBookmark = () => {
    if (!isWeb(pageUrl)) return
    if (bookmarked) {
      store.removeBookmark(bookmarked.id)
      showToast("Bookmark removed.")
    } else {
      store.addBookmark({ title: entry.title || displayUrl(pageUrl), url: pageUrl })
      showToast("Bookmarked. It's on the bookmarks bar.")
    }
  }
  const openReal = (url = pageUrl) => {
    if (isWeb(url)) window.open(url, "_blank", "noopener,noreferrer")
  }
  const timeMachine = (url = pageUrl) => isWeb(url) && dispatch?.({ type: "open_window", payload: ieWindow(url) })
  const sharePage = () => isWeb(pageUrl) && shareOut({ title: entry.title || displayUrl(pageUrl), url: pageUrl }, "apps", { title: "Share" })
  const importFavorites = () => {
    const items = []
    try {
      for (const f of JSON.parse(localStorage.getItem("98ish.ie.favorites") || "[]")) items.push({ title: f.name, url: f.url })
    } catch {
      // none
    }
    const folder = fs.resolve(["C:", "Bookmarks"])
    for (const item of folder?.content || []) if (item.type === "internet" && /^https?:/.test(item.textContent || "")) items.push({ title: item.name, url: item.textContent })
    // the starting shortcuts keep their addresses in utils/hyperlinks.js
    import("../../../utils/hyperlinks").then(({ hyperlinks }) => {
      for (const item of folder?.content || []) if (item.type === "internet" && hyperlinks[item.name]) items.push({ title: item.name, url: hyperlinks[item.name] })
      const added = store.importBookmarks(items)
      showToast(added ? `Imported ${added} bookmark${added === 1 ? "" : "s"} from Internet Explorer and C:\\Bookmarks.` : "Nothing new to import.")
    })
  }
  const saveToDrive = async ({ url, name, tok }) => {
    setDialog({ kind: "busy", text: `Saving ${name}...` })
    try {
      const s = await ensureSession(tokenRef.current)
      const r = await fetch(rawUrl(SERVER, s.sid, url, tok || "_"))
      if (!r.ok) throw new Error(r.status === 413 ? "It's too big for the 98ish drive." : `The site answered ${r.status}.`)
      const blob = await r.blob()
      const file = new File([blob], name || fileNameOf(url), { type: blob.type || "application/octet-stream" })
      const result = await receiveFiles(folderAt(["C:", "Downloads"]), [file])
      if (!result.added.length) throw new Error(result.problems[0] || "It couldn't be saved.")
      store.addDownload({ name: result.added[0].name, url, where: "drive", path: `C:\\Downloads\\${result.added[0].name}`, size: blob.size })
      setDialog({ kind: "alert", title: "Download complete", text: `Saved to C:\\Downloads\\${result.added[0].name}.${summarize(result) ? " " + summarize(result) : ""}` })
    } catch (error) {
      setDialog({ kind: "saveFailed", url, name, text: error.message })
    }
  }
  const saveToDevice = (url, name) => {
    store.addDownload({ name: name || fileNameOf(url), url, where: "device" })
    openReal(url)
  }
  const savePage = () => isWeb(pageUrl) && saveToDrive({ url: pageUrl, name: `${(entry.title || hostOf(pageUrl)).replace(/[\\/:"<>|*?]/g, " ").slice(0, 50)}.html`, tok: active.tok })

  // ---- the omnibox ----
  const suggestions = useMemo(() => (editing && address && address !== pageUrl ? suggest(address, { history: data.history, bookmarks: data.bookmarks }) : []), [editing, address, pageUrl, data.history, data.bookmarks])
  const submitOmni = (e) => {
    e?.preventDefault()
    const pick = picked >= 0 ? suggestions[picked] : null
    setEditing(false)
    setPicked(-1)
    omniRef.current?.blur()
    if (pick) load(active.id, pick.url, "push")
    else open(address)
  }

  // ---- keys ----
  const onKeyDown = (e) => {
    const k = e.key.toLowerCase()
    const mod = e.ctrlKey || e.metaKey
    let handled = true
    if (mod && k === "t") newTab()
    else if (mod && k === "w") closeTab(active.id)
    else if (mod && (k === "l" || k === "e")) {
      omniRef.current?.focus()
      omniRef.current?.select()
    } else if (mod && k === "f") openFind()
    else if ((mod && k === "r") || e.key === "F5") reload()
    else if (mod && k === "d") toggleBookmark()
    else if (mod && (k === "=" || k === "+")) zoomStep(1)
    else if (mod && k === "-") zoomStep(-1)
    else if (mod && k === "0") setZoom(1)
    else if (e.altKey && e.key === "ArrowLeft") go(-1)
    else if (e.altKey && e.key === "ArrowRight") go(1)
    else if (mod && e.key === "Tab") {
      const i = tabs.findIndex((t) => t.id === active.id)
      setActiveId(tabs[(i + (e.shiftKey ? -1 : 1) + tabs.length) % tabs.length].id)
    } else handled = false
    if (handled) {
      e.preventDefault()
      e.stopPropagation()
    }
  }

  // ---- menus ----
  const isPage = isWeb(pageUrl)
  const host = hostOf(pageUrl)
  const menus = [
    {
      label: "File",
      items: [
        { label: "New Tab Ctrl+T", onClick: () => newTab() },
        { label: "New Window", onClick: () => onNewWindow?.() },
        { label: "Open Location... Ctrl+L", onClick: () => omniRef.current?.focus() },
        "-",
        { label: "Save Page to 98ish Drive", disabled: !isPage, onClick: savePage },
        { label: "Share Page...", disabled: !isPage, onClick: sharePage },
        "-",
        { label: "Close Tab Ctrl+W", onClick: () => closeTab(active.id) },
        { label: "Close Window", onClick: () => onClose?.() },
      ],
    },
    {
      label: "Edit",
      items: [
        { label: "Find in Page... Ctrl+F", disabled: !isPage, onClick: openFind },
        { label: "Copy Page Address", disabled: !isPage, onClick: () => navigator.clipboard?.writeText(pageUrl).then(() => showToast("Address copied."), () => showToast(pageUrl)) },
      ],
    },
    {
      label: "View",
      items: [
        { label: "Reload Ctrl+R", onClick: () => reload() },
        { label: "Stop", disabled: !active.loading, onClick: stop },
        "-",
        { label: "Zoom In Ctrl+=", onClick: () => zoomStep(1) },
        { label: "Zoom Out Ctrl+-", onClick: () => zoomStep(-1) },
        { label: `Actual Size (${Math.round((active.zoom || 1) * 100)}%) Ctrl+0`, onClick: () => setZoom(1) },
        "-",
        { label: "Data Saver (load directly when sites allow it)", checked: prefs.dataSaver, onClick: () => store.setPrefs({ dataSaver: !prefs.dataSaver }) },
        { label: "Relay Pictures Too (more private, uses more data)", checked: prefs.relayAll, onClick: () => store.setPrefs({ relayAll: !prefs.relayAll }) },
      ],
    },
    {
      label: "Go",
      items: [
        { label: "Back Alt+Left", disabled: active.index === 0, onClick: () => go(-1) },
        { label: "Forward Alt+Right", disabled: active.index >= active.entries.length - 1, onClick: () => go(1) },
        { label: "Home", onClick: () => load(active.id, prefs.home || NEW_TAB, "push") },
        "-",
        { label: "History", onClick: () => load(active.id, "compass://history", "push") },
        { label: "Downloads", onClick: () => load(active.id, "compass://downloads", "push") },
        "-",
        { label: "Open in Real Browser", disabled: !isPage, onClick: () => openReal() },
        { label: "Open in Time Machine (Internet Explorer)", disabled: !isPage, onClick: () => timeMachine() },
      ],
    },
    {
      label: "Bookmarks",
      items: [
        { label: bookmarked ? "Remove Bookmark Ctrl+D" : "Bookmark This Page Ctrl+D", disabled: !isPage, onClick: toggleBookmark },
        { label: "Show All Bookmarks", onClick: () => load(active.id, "compass://bookmarks", "push") },
        { label: "Import from Internet Explorer", onClick: importFavorites },
        ...(data.bookmarks.length ? ["-"] : []),
        ...data.bookmarks.slice(0, 20).map((b) => ({ label: b.title, onClick: () => load(active.id, b.url, "push") })),
      ],
    },
    {
      label: "Tools",
      items: [
        { label: `Always Open ${host || "This Site"} in Real Browser`, disabled: !isPage, onClick: () => (store.alwaysReal(host), reload()) },
        { label: "Clear Cookies (sign out of sites)", onClick: () => clearCookies().then((ok) => showToast(ok ? "Compass forgot every site's cookies." : "There's no browsing session yet.")) },
        { label: "Compass Options...", onClick: () => setDialog({ kind: "options" }) },
      ],
    },
    {
      label: "Help",
      items: [{ label: "About Compass", onClick: () => (refreshUsage(), load(active.id, "compass://about", "push")) }],
    },
  ]

  // ---- the page area ----
  const renderInternal = (t) => {
    const url = entryOf(t).url
    const openHere = (u) => load(t.id, u, "push")
    if (url === "compass://history") return <HistoryPage store={data} onOpen={openHere} />
    if (url === "compass://bookmarks") return <BookmarksPage store={data} onOpen={openHere} onImport={importFavorites} />
    if (url === "compass://downloads") return <DownloadsPage store={data} onOpen={openHere} />
    if (url === "compass://about") return <AboutPage session={session} />
    return <NewTabPage store={data} engine={engine} phone={phone} onOpen={openHere} onSearch={(q) => open(q)} />
  }
  const renderTab = (t) => {
    const hidden = t.id !== active.id
    let body = null
    if (t.view === "internal") body = renderInternal(t)
    else if (t.view === "stub" && t.stub)
      body = (
        <StubPage
          info={t.stub}
          onReal={() => (t.stub.kind === "download" ? saveToDevice(t.stub.url, t.stub.name) : openReal(t.stub.url))}
          onRetry={() => load(t.id, entryOf(t).url, "entry", { force: t.stub.kind === "real" })}
          onAlways={() => store.alwaysReal(hostOf(t.stub.url))}
          onTimeMachine={() => timeMachine(t.stub.url)}
          onSignOn={(register) => setDialog({ kind: "signon", register })}
          onSave={() => saveToDrive({ url: t.stub.url, name: t.stub.name || fileNameOf(t.stub.url), tok: t.stub.tok })}
          onDataSaver={() => (store.setPrefs({ dataSaver: true }), load(t.id, entryOf(t).url, "entry"))}
        />
      )
    else if ((t.view === "relay" || t.view === "direct") && t.src) {
      const z = t.zoom || 1
      const scaled = t.view === "direct" && z !== 1
      const frame = (
        <iframe
          key={t.frameKey}
          ref={(el) => (el ? frames.current.set(t.id, el) : frames.current.get(t.id) === el && frames.current.delete(t.id))}
          className="cmpFrame"
          src={t.src}
          title={entryOf(t).title || "Web page"}
          sandbox={t.view === "relay" ? RELAY_SANDBOX : DIRECT_SANDBOX}
          referrerPolicy="no-referrer"
          allow="fullscreen; clipboard-write"
          style={scaled ? { width: `${100 / z}%`, height: `${100 / z}%`, transform: `scale(${z})`, transformOrigin: "0 0" } : undefined}
          onLoad={() => updateTab(t.id, () => ({ loading: false }))}
        />
      )
      // relay off (WEB_RELAY=0): the page comes straight from the site, if it allows frames
      body = t.relayOff ? (
        <div className="cmpOffWrap">
          <div className="cmpOffBar" role="note">
            <span>The 98ish server isn&apos;t relaying pages, so sites that refuse frames show an error here.</span>
            <button type="button" onClick={() => openReal(entryOf(t).url)}>
              Open in Real Browser
            </button>
          </div>
          {frame}
        </div>
      ) : (
        frame
      )
    } else body = <div className="cmpPage cmpPending">{waking ? "Waking up the 98ish server (it naps when nobody's around)..." : "Opening page..."}</div>
    return (
      <div key={t.id} className="cmpTabView" hidden={hidden} aria-hidden={hidden || undefined}>
        {body}
      </div>
    )
  }

  const zone = active.view === "relay" ? "Relayed by the 98ish server" : active.view === "direct" ? "Direct from the site" : isInternal(pageUrl) || pageUrl === NEW_TAB ? "Compass" : ""
  const status = waking ? "Waking up the 98ish server..." : active.loading ? `Opening ${displayUrl(pageUrl)}...` : "Done"
  const passwordNotice = active.password && isPage && !prefs.passwordOk.includes(host)
  const omniShown = editing ? address : displayUrl(address)

  const omnibox = (
    <form className="cmpOmni" onSubmit={submitOmni} role="search">
      <span className={`cmpBadge ${active.view === "relay" ? "is-relay" : ""}`} title={zone || "Compass"}>
        {pageUrl.startsWith("https:") ? <Glyph d={G.lock} size={12} /> : isWeb(pageUrl) ? <span className="cmpNotSecure">i</span> : <CompassLogo size={14} />}
        {active.view === "relay" && !phone && <span className="cmpRelayTag">98</span>}
      </span>
      <input
        ref={omniRef}
        value={omniShown}
        onChange={(e) => {
          setAddress(e.target.value)
          setEditing(true)
          setPicked(-1)
        }}
        onFocus={(e) => {
          if (editing) return
          // the full address replaces the short one at once, all selected, so typing replaces it
          const el = e.target
          const full = pageUrl === NEW_TAB ? "" : pageUrl
          el.value = full
          el.select()
          setEditing(true)
          setAddress(full)
        }}
        onBlur={() => setTimeout(() => setEditing(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && suggestions.length) {
            e.preventDefault()
            setPicked((p) => Math.min(suggestions.length - 1, p + 1))
          } else if (e.key === "ArrowUp" && suggestions.length) {
            e.preventDefault()
            setPicked((p) => Math.max(-1, p - 1))
          } else if (e.key === "Escape") {
            setEditing(false)
            e.currentTarget.blur()
          }
        }}
        placeholder={`Search ${SEARCH_ENGINES[engine]?.name || "the Web"} or type an address`}
        aria-label="Address and search bar"
        spellCheck="false"
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        inputMode="url"
        enterKeyHint="go"
      />
      {isPage && !editing && (
        <button type="button" className={`cmpStar ${bookmarked ? "is-on" : ""}`} onClick={toggleBookmark} title={bookmarked ? "Remove bookmark" : "Bookmark this page"} aria-label={bookmarked ? "Remove bookmark" : "Bookmark this page"}>
          <Glyph d={G.star} size={14} />
        </button>
      )}
      {suggestions.length > 0 && (
        <ul className="cmpSuggest" role="listbox">
          {suggestions.map((s, i) => (
            <li key={s.url} role="option" aria-selected={i === picked}>
              <button
                type="button"
                className={i === picked ? "is-picked" : ""}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setEditing(false)
                  omniRef.current?.blur()
                  load(active.id, s.url, "push")
                }}
              >
                <span className="cmpSuggestKind">{s.kind === "bookmark" ? "\u2605" : "\u25F7"}</span>
                <b>{s.title || displayUrl(s.url)}</b>
                <small>{displayUrl(s.url)}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </form>
  )

  const bar = data.bookmarks.filter((b) => b.bar)

  return (
    <div ref={rootRef} className={`cmpRoot ${phone ? "is-phone" : ""}`} onKeyDown={onKeyDown}>
      {!phone && <MenuBar menus={menus} />}

      {!phone && (
        <div className="cmpTabs" role="tablist">
          {tabs.map((t) => (
            <div
              key={t.id}
              role="tab"
              aria-selected={t.id === active.id}
              className={`cmpTab ${t.id === active.id ? "is-active" : ""} ${dragId === t.id ? "is-dragging" : ""}`}
              draggable
              onDragStart={(e) => {
                setDragId(t.id)
                e.dataTransfer.effectAllowed = "move"
                e.dataTransfer.setData("text/plain", String(t.id))
              }}
              onDragOver={(e) => {
                e.preventDefault()
                if (dragId !== null) moveTab(dragId, t.id)
              }}
              onDragEnd={() => setDragId(null)}
              onClick={() => setActiveId(t.id)}
              onAuxClick={(e) => e.button === 1 && closeTab(t.id)}
              title={tabTitle(t)}
            >
              {t.loading ? <span className="cmpSpinner" aria-label="Loading" /> : <Favicon src={entryOf(t).favicon || (isWeb(entryOf(t).url) ? `${new URL(entryOf(t).url).origin}/favicon.ico` : null)} />}
              <span className="cmpTabTitle">{tabTitle(t)}</span>
              <button
                type="button"
                className="cmpTabClose"
                aria-label={`Close ${tabTitle(t)}`}
                onClick={(e) => {
                  e.stopPropagation()
                  closeTab(t.id)
                }}
              >
                &times;
              </button>
            </div>
          ))}
          <button type="button" className="cmpNewTab" onClick={() => newTab()} title="New tab (Ctrl+T)" aria-label="New tab">
            <Glyph d={G.plus} size={12} />
          </button>
        </div>
      )}

      <div className="cmpToolbar">
        {!phone && (
          <>
            <ToolButton icon="back" label="Back" disabled={active.index === 0} onClick={() => go(-1)} />
            <ToolButton icon="forward" label="Forward" disabled={active.index >= active.entries.length - 1} onClick={() => go(1)} />
            {active.loading ? <ToolButton icon="stop" label="Stop" onClick={stop} /> : <ToolButton icon="reload" label="Reload" onClick={() => reload()} />}
            <ToolButton icon="home" label="Home" onClick={() => load(active.id, prefs.home || NEW_TAB, "push")} />
          </>
        )}
        {omnibox}
        {phone ? (
          active.loading ? <ToolButton icon="stop" label="Stop" onClick={stop} /> : <ToolButton icon="reload" label="Reload" onClick={() => reload()} />
        ) : (
          <>
            <ToolButton icon="real" label="Open in Real Browser" disabled={!isPage} onClick={() => openReal()} className="cmpRealBtn" />
            <div className={active.loading ? "cmpThrobber is-busy" : "cmpThrobber"} aria-hidden="true">
              <CompassLogo size={22} />
            </div>
          </>
        )}
      </div>

      {!phone && bar.length > 0 && (
        <div className="cmpBookmarksBar">
          {bar.map((b) => (
            <button key={b.id} type="button" onClick={() => load(active.id, b.url, "push")} title={b.url}>
              <Favicon src={(() => {
                try {
                  return new URL("/favicon.ico", b.url).href
                } catch {
                  return null
                }
              })()} />
              <span>{b.title}</span>
            </button>
          ))}
        </div>
      )}

      {passwordNotice && (
        <div className="cmpNotice is-warn" role="alert">
          <span className="cmpNoticeIcon">!</span>
          <span className="cmpNoticeText">This page asks for a password. What you type here passes through the 98ish server. For banking, email and other important accounts, use your real browser.</span>
          <button type="button" className="cmpPrimary" onClick={() => openReal()}>
            Open in Real Browser
          </button>
          <button type="button" onClick={() => store.setPrefs({ passwordOk: [...prefs.passwordOk, host] })}>
            Continue Here
          </button>
        </div>
      )}
      {active.view === "direct" && (
        <div className="cmpNotice">
          <span className="cmpNoticeIcon">i</span>
          {session?.closed ? (
            <span className="cmpNoticeText">{monthlyStub(new Date(session.closed)).text.split(". ")[0]}, so this site loads directly (Compass can&apos;t follow its links, find or zoom text).</span>
          ) : (
            <>
              <span className="cmpNoticeText">Data Saver: this site loads directly, so Compass can&apos;t follow its links, find or zoom text.</span>
              <button type="button" onClick={() => (store.setPrefs({ dataSaver: false }), reload())}>
                Load Through 98ish
              </button>
            </>
          )}
        </div>
      )}

      {find && (
        <form
          className="cmpFind"
          onSubmit={(e) => {
            e.preventDefault()
            runFind(find.query, 1)
          }}
        >
          <label htmlFor={`cmp-find-${active.id}`}>Find:</label>
          <input
            id={`cmp-find-${active.id}`}
            ref={findRef}
            value={find.query}
            onChange={(e) => runFind(e.target.value, 0)}
            onKeyDown={(e) => {
              if (e.key === "Escape") closeFind()
              if (e.key === "Enter" && e.shiftKey) {
                e.preventDefault()
                runFind(find.query, -1)
              }
            }}
            enterKeyHint="search"
            autoCapitalize="off"
            autoCorrect="off"
          />
          <span className="cmpFindCount" aria-live="polite">
            {find.query ? (find.count ? `${find.index + 1} of ${find.count}` : "No matches") : ""}
          </span>
          <button type="button" onClick={() => runFind(find.query, -1)} disabled={!find.count} aria-label="Previous match">
            &#9650;&#xFE0E;
          </button>
          <button type="submit" disabled={!find.count} aria-label="Next match">
            &#9660;&#xFE0E;
          </button>
          <button type="button" onClick={closeFind} aria-label="Close find">
            &times;
          </button>
        </form>
      )}

      <div className="cmpView">{tabs.map(renderTab)}</div>

      {!phone && (
        <div className="status-bar cmpStatus">
          <p className="status-bar-field cmpStatusText">{status}</p>
          {active.zoom && active.zoom !== 1 && <p className="status-bar-field">{Math.round(active.zoom * 100)}%</p>}
          <p className="status-bar-field cmpZone">{zone}</p>
        </div>
      )}

      {phone && (
        <div className="cmpPhoneBar">
          <ToolButton icon="back" label="Back" disabled={active.index === 0} onClick={() => go(-1)} />
          <ToolButton icon="forward" label="Forward" disabled={active.index >= active.entries.length - 1} onClick={() => go(1)} />
          <ToolButton icon="real" label="Open in Real Browser" disabled={!isPage} onClick={() => openReal()} />
          <button type="button" className="cmpTool cmpTabCount" onClick={() => setSheet(sheet === "tabs" ? null : "tabs")} aria-label={`Tabs (${tabs.length})`} title="Tabs">
            <span>{tabs.length}</span>
          </button>
          <ToolButton icon="menu" label="Menu" active={sheet === "menu"} onClick={() => setSheet(sheet === "menu" ? null : "menu")} />
        </div>
      )}

      {phone && sheet === "tabs" && (
        <div className="cmpSheet" role="dialog" aria-label="Tabs">
          <div className="cmpSheetHead">
            <b>Tabs</b>
            <button type="button" onClick={() => (newTab(), setSheet(null))}>
              + New Tab
            </button>
            <button type="button" onClick={() => setSheet(null)}>
              Done
            </button>
          </div>
          <div className="cmpTabGrid">
            {tabs.map((t) => (
              <div key={t.id} className={`cmpTabCard ${t.id === active.id ? "is-active" : ""}`}>
                <button
                  type="button"
                  className="cmpTabCardMain"
                  onClick={() => {
                    setActiveId(t.id)
                    setSheet(null)
                  }}
                >
                  <Favicon src={entryOf(t).favicon} size={24} />
                  <b>{tabTitle(t)}</b>
                  <small>{displayUrl(entryOf(t).url)}</small>
                </button>
                <button type="button" className="cmpTabCardClose" aria-label={`Close ${tabTitle(t)}`} onClick={() => closeTab(t.id)}>
                  &times;
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {phone && sheet === "menu" && (
        <div className="cmpSheet cmpMenuSheet" role="dialog" aria-label="Compass menu">
          <div className="cmpMenuRow">
            <button type="button" onClick={() => (newTab(), setSheet(null))}>New Tab</button>
            <button type="button" disabled={!isPage} onClick={() => (toggleBookmark(), setSheet(null))}>
              {bookmarked ? "Remove Bookmark" : "Bookmark"}
            </button>
            <button type="button" disabled={!isPage} onClick={() => (sharePage(), setSheet(null))}>Share</button>
          </div>
          <div className="cmpMenuRow">
            <button type="button" onClick={() => (load(active.id, "compass://bookmarks", "push"), setSheet(null))}>Bookmarks</button>
            <button type="button" onClick={() => (load(active.id, "compass://history", "push"), setSheet(null))}>History</button>
            <button type="button" onClick={() => (load(active.id, "compass://downloads", "push"), setSheet(null))}>Downloads</button>
          </div>
          <div className="cmpMenuRow">
            <button type="button" disabled={!isPage} onClick={openFind}>Find in Page</button>
            <button type="button" disabled={!isPage} onClick={() => zoomStep(-1)} aria-label="Zoom out">A&minus;</button>
            <span className="cmpZoomLabel">{Math.round((active.zoom || 1) * 100)}%</span>
            <button type="button" disabled={!isPage} onClick={() => zoomStep(1)} aria-label="Zoom in">A+</button>
          </div>
          <ul className="cmpMenuList">
            <li><button type="button" onClick={() => (load(active.id, prefs.home || NEW_TAB, "push"), setSheet(null))}>Home</button></li>
            <li><button type="button" disabled={!isPage} onClick={() => (savePage(), setSheet(null))}>Save Page to 98ish Drive</button></li>
            <li><button type="button" disabled={!isPage} onClick={() => (timeMachine(), setSheet(null))}>Open in Time Machine (Internet Explorer)</button></li>
            <li><button type="button" disabled={!isPage} onClick={() => (store.alwaysReal(host), reload(), setSheet(null))}>Always Open {host || "This Site"} in Real Browser</button></li>
            <li><button type="button" onClick={() => store.setPrefs({ dataSaver: !prefs.dataSaver })}>{prefs.dataSaver ? "\u2713 " : ""}Data Saver</button></li>
            <li><button type="button" onClick={() => (setDialog({ kind: "options" }), setSheet(null))}>Compass Options...</button></li>
            <li><button type="button" onClick={() => (refreshUsage(), load(active.id, "compass://about", "push"), setSheet(null))}>About Compass</button></li>
            <li><button type="button" onClick={() => (closeTab(active.id), setSheet(null))}>Close Tab</button></li>
          </ul>
        </div>
      )}

      {toast && (
        <div className="cmpToast" role="status">
          {toast}
        </div>
      )}

      {dialog?.kind === "firstRun" && (
        <Dialog
          title="Compass"
          onOk={() => {
            store.setPrefs({ noticeSeen: true })
            setDialog(null)
          }}
        >
          <p className="dialogText">
            Compass shows sites through the 98ish server, so they work inside 98ish.
            <br />
            <br />
            &bull; Pages come from the 98ish server's address. Pictures and scripts usually load straight from the site, so sites can still see yours (View &gt; Relay Pictures Too hides it, using more data).
            <br />
            &bull; What you type into pages, passwords included, passes through the 98ish server.
            <br />
            <br />
            For banking, email and other important accounts, use <b>Open in Real Browser</b> (the arrow button).
          </p>
        </Dialog>
      )}

      {dialog?.kind === "download" && (
        <Dialog
          title="Download"
          okLabel="Save to Drive"
          noLabel="My Device"
          onOk={() => saveToDrive(dialog)}
          onNo={() => {
            saveToDevice(dialog.url, dialog.name)
            setDialog(null)
          }}
          onCancel={() => setDialog(null)}
        >
          <p className="dialogText">
            Save <b>{dialog.name}</b> to the 98ish drive (C:\Downloads; pictures, text, web pages and sounds), or to your device through your real browser?
          </p>
        </Dialog>
      )}

      {dialog?.kind === "saveFailed" && (
        <Dialog
          title="Download"
          okLabel="Save to My Device"
          onOk={() => {
            saveToDevice(dialog.url, dialog.name)
            setDialog(null)
          }}
          onCancel={() => setDialog(null)}
        >
          <p className="dialogText">
            {dialog.name} couldn&apos;t be saved to the 98ish drive: {dialog.text}
            <br />
            <br />
            Save it to your device instead?
          </p>
        </Dialog>
      )}

      {dialog?.kind === "busy" && (
        <Dialog title="Download" onCancel={() => setDialog(null)} okDisabled onOk={() => {}}>
          <p className="dialogText">{dialog.text}</p>
        </Dialog>
      )}

      {dialog?.kind === "alert" && (
        <Dialog title={dialog.title || "Compass"} onOk={() => setDialog(null)}>
          <p className="dialogText">{dialog.text}</p>
        </Dialog>
      )}

      {dialog?.kind === "options" && <OptionsDialog prefs={prefs} pageUrl={pageUrl} onClose={() => setDialog(null)} />}

      {dialog?.kind === "signon" && (
        <SignOnDialog
          register={dialog.register}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null)
            // like signing on in 98 Messenger: the Buddy List opens (minimized), so you can sign off there
            if (!aim?.getWindows?.().some((w) => !w.closed && w.name === BUDDY_LIST)) dispatch?.({ type: "open_window", payload: launch(BUDDY_LIST, { minimized: true, active: false }) })
            showToast(`Signed on. Compass can open any site now.`)
          }}
        />
      )}
    </div>
  )
}

// "Sign on with your 98 Messenger screen name": the same account as 98 Messenger (AimContext),
// no second sign-up. The pages waiting for it load by themselves once signed on.
const SignOnDialog = ({ register: startRegister, onClose, onDone }) => {
  const aim = useAim()
  const [register, setRegister] = useState(!!startRegister)
  const [screenName, setScreenName] = useState(aim?.prefs?.lastScreenName || "")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [problem, setProblem] = useState(null)
  const [tried, setTried] = useState(false)
  const busy = aim?.status === "signingOn"
  const submit = async () => {
    if (busy || !aim) return
    if (!screenName.trim() || !password) return setProblem("Type your screen name and password.")
    if (register && password !== confirm) return setProblem("The passwords you entered do not match.")
    setProblem(null)
    setTried(true)
    const ok = await aim.signOn(screenName.trim(), password, register)
    if (ok) onDone()
  }
  const shown = problem || (tried && !busy && aim?.error) || null
  return (
    <Dialog title={register ? "Get a Screen Name" : "Sign On"} okLabel={busy ? "Signing on..." : register ? "Register" : "Sign On"} okDisabled={busy} onOk={submit} onCancel={onClose}>
      <div className="cmpSignOn">
        <p className="dialogText">{register ? "Pick a screen name and password for 98 Messenger. It's free, and the same screen name works everywhere in 98ish." : "Sign on with your 98 Messenger screen name to browse other sites."}</p>
        <label className="cmpField">
          <span>Screen Name</span>
          <input value={screenName} onChange={(e) => setScreenName(e.target.value)} maxLength={16} autoComplete="username" autoCapitalize="off" autoCorrect="off" spellCheck="false" />
        </label>
        <label className="cmpField">
          <span>Password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={64} autoComplete={register ? "new-password" : "current-password"} />
        </label>
        {register && (
          <label className="cmpField">
            <span>Confirm Password</span>
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} maxLength={64} autoComplete="new-password" />
          </label>
        )}
        <button type="button" className="cmpLink" onClick={() => (setRegister(!register), setProblem(null))}>
          {register ? "I already have a screen name" : "Get a Screen Name"}
        </button>
        {shown && (
          <p className="cmpSignOnError" role="alert">
            {shown}
          </p>
        )}
      </div>
    </Dialog>
  )
}

const OptionsDialog = ({ prefs, pageUrl, onClose }) => {
  const [draft, setDraft] = useState(prefs)
  return (
    <Dialog
      title="Compass Options"
      onOk={() => {
        store.setPrefs(draft)
        onClose()
      }}
      onCancel={onClose}
    >
      <div className="cmpOptions">
        <label>
          Search with:
          <select value={draft.engine} onChange={(e) => setDraft({ ...draft, engine: e.target.value })}>
            {Object.entries(SEARCH_ENGINES).map(([id, e]) => (
              <option key={id} value={id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Home page:
          <select value={draft.home === NEW_TAB ? "newtab" : "page"} onChange={(e) => setDraft({ ...draft, home: e.target.value === "newtab" ? NEW_TAB : isWeb(pageUrl) ? pageUrl : prefs.home })}>
            <option value="newtab">The New Tab page</option>
            <option value="page">{isWeb(draft.home) ? displayUrl(draft.home) : isWeb(pageUrl) ? `This page (${displayUrl(pageUrl)})` : "This page"}</option>
          </select>
        </label>
        <label className="cmpCheck">
          <input type="checkbox" checked={draft.restoreTabs} onChange={(e) => setDraft({ ...draft, restoreTabs: e.target.checked })} /> Reopen my tabs when Compass starts
        </label>
        <label className="cmpCheck">
          <input type="checkbox" checked={draft.dataSaver} onChange={(e) => setDraft({ ...draft, dataSaver: e.target.checked })} /> Data Saver: load sites directly when they allow it
        </label>
        <label className="cmpCheck">
          <input type="checkbox" checked={draft.relayAll} onChange={(e) => setDraft({ ...draft, relayAll: e.target.checked })} /> Relay pictures and scripts too (more private: sites see only the 98ish server; uses more of the daily allowance)
        </label>
        {draft.alwaysReal.length > 0 && (
          <fieldset>
            <legend>Always open in my real browser</legend>
            {draft.alwaysReal.map((h) => (
              <div key={h} className="cmpOptRow">
                <span>{h}</span>
                <button type="button" onClick={() => setDraft({ ...draft, alwaysReal: draft.alwaysReal.filter((x) => x !== h) })}>
                  Remove
                </button>
              </div>
            ))}
          </fieldset>
        )}
      </div>
    </Dialog>
  )
}

export default Compass
