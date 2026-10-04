import React, { useEffect, useLayoutEffect, useRef, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import Dialog from "../../shared/Dialog"
import StartPage from "./StartPage"
import CapturesPanel from "./CapturesPanel"
import LocalSite from "./local/LocalSite"
import { isLocalUrl, pageFor } from "./local/site"
import { LINKS_BAR } from "./sites"
import {
  ARCHIVE_ORIGIN,
  MIN_DATE,
  archivePageUrl,
  archiveUrl,
  dateToStamp,
  describeGap,
  formatIso,
  formatStamp,
  formatYearMonth,
  getCaptures,
  getSparkline,
  normalizeInput,
  parseArchiveUrl,
  samePage,
  siteKey,
  stampToDate,
  todayIso,
} from "./wayback"
import { getSettings } from "../../../utils/settings"
import "./InternetExplorer.css"

// Internet Explorer, with a time machine: every page is shown as the Internet Archive's
// Wayback Machine captured it closest to the date you pick.

const DATE_KEY = "98ish.ie.date"
const FAVORITES_KEY = "98ish.ie.favorites"
const HISTORY_KEY = "98ish.ie.history"
// Control Panel > Internet Options clears the History with this event
export const HISTORY_CLEARED = "98ish:ie-history-cleared"
const DEFAULT_DATE = "1998-12-25"
const VIRTUAL_WIDTH = 800 // pages from the era were built for 800x600; narrow windows scale down
const START = { kind: "start" }

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
  } catch {
    // storage unavailable: lasts for this visit
  }
}

const clampDate = (iso) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return null
  if (iso < MIN_DATE) return MIN_DATE
  const today = todayIso()
  return iso > today ? today : iso
}

const Glyph = ({ d }) => (
  <svg viewBox="0 0 16 16" width="20" height="20" aria-hidden="true" shapeRendering="crispEdges">
    <path d={d} />
  </svg>
)
const GLYPHS = {
  back: "M2 8l6-6v4h6v4H8v4z",
  forward: "M14 8l-6-6v4H2v4h6v4z",
  stop: "M4 2h8l2 2v8l-2 2H4l-2-2V4zM5 5v6h6V5z",
  refresh: "M8 2a6 6 0 1 0 6 6h-2a4 4 0 1 1-4-4v2l4-3-4-3z",
  home: "M8 1l7 7h-2v7H9v-4H7v4H3V8H1z",
  favorites: "M8 1l2 5h5l-4 3 2 6-5-4-5 4 2-6-4-3h5z",
  history: "M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 2a5 5 0 1 1 0 10A5 5 0 0 1 8 3zM7 4v5l4 2 1-2-3-1V4z",
  captures: "M2 3h12v12H2zM4 1h2v3H4zM10 1h2v3h-2zM3 6v8h10V6zM5 8h2v2H5zM9 8h2v2H9zM5 11h2v2H5z",
}

const ToolButton = ({ icon, label, disabled, active, onClick }) => (
  <button type="button" className={active ? "ieTool is-active" : "ieTool"} disabled={disabled} onClick={onClick} title={label} aria-pressed={active || undefined}>
    <Glyph d={GLYPHS[icon]} />
    <span>{label}</span>
  </button>
)

const InternetExplorer = ({ initialUrl, onTitle, onNewWindow, onClose }) => {
  const [date, setDateState] = useState(() => clampDate(read(DATE_KEY, DEFAULT_DATE)) || DEFAULT_DATE)
  const [nav, setNav] = useState({ entries: [START], index: 0 })
  const [frame, setFrame] = useState({ src: null, key: 0 }) // what the frame should load
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState("Done")
  const [shown, setShown] = useState(null) // { url, ts, title } as the Archive reports it
  const [canceled, setCanceled] = useState(false)
  const [address, setAddress] = useState("about:home")
  const [panel, setPanel] = useState(null) // favorites | history | captures
  const [favorites, setFavorites] = useState(() => read(FAVORITES_KEY, []))
  const [historyLog, setHistoryLog] = useState(() => read(HISTORY_KEY, []))
  const [spark, setSpark] = useState({ site: null, data: null, error: null })
  const [dialog, setDialog] = useState(null)
  const [stepping, setStepping] = useState(false)
  const [view, setView] = useState({ width: 0, height: 0 })
  const [query, setQuery] = useState("") // a Start Page directory search

  const frameRef = useRef(null)
  const viewRef = useRef(null)
  const pendingNav = useRef(false) // we told the frame to load something; its first report may be a redirect
  const navRef = useRef(nav)
  navRef.current = nav
  const onTitleRef = useRef(onTitle)
  onTitleRef.current = onTitle

  const entry = nav.entries[nav.index]
  const onStart = entry.kind === "start"
  const onLocal = entry.kind === "local" // a page on http://www.98ish.com/, not the Archive

  // ---- navigation ----

  const load = (target) => {
    setCanceled(false)
    setShown(null)
    if (target.kind === "start") {
      setFrame((f) => ({ src: null, key: f.key + 1 }))
      setLoading(false)
      setStatus("Done")
      setAddress("about:home")
      onTitleRef.current?.("Internet Explorer")
      return
    }
    if (target.kind === "local") {
      pendingNav.current = false
      setFrame((f) => ({ src: null, key: f.key + 1 }))
      setLoading(false)
      setStatus("Done")
      setAddress(target.url)
      onTitleRef.current?.(`${pageFor(target.url)?.title || "98ish"} - Internet Explorer`)
      return
    }
    pendingNav.current = true
    setFrame((f) => ({ src: archiveUrl(target.url, target.ts), key: f.key + 1 }))
    setLoading(true)
    setStatus(`Opening page ${target.url}...`)
    setAddress(target.url)
  }

  const navigate = (target, { replace = false } = {}) => {
    setNav(({ entries, index }) => {
      const kept = entries.slice(0, replace ? index : index + 1)
      return { entries: [...kept, target], index: kept.length }
    })
    load(target)
  }

  const go = (delta) => {
    const { entries, index } = navRef.current
    const next = Math.min(entries.length - 1, Math.max(0, index + delta))
    if (next === index) return
    setNav({ entries, index: next })
    load(entries[next])
  }

  const openUrl = (url, ts = dateToStamp(date)) => navigate(isLocalUrl(url) ? { kind: "local", url } : { kind: "web", url, ts })

  const refresh = () => load(entry)

  const stop = () => {
    if (!loading) return
    pendingNav.current = false
    setLoading(false)
    setCanceled(true)
    setStatus("Action canceled")
  }

  const setDate = (iso, { reload = true } = {}) => {
    const value = clampDate(iso)
    if (!value) return
    setDateState(value)
    write(DATE_KEY, value)
    // the current page, as of the new date
    if (reload && entry.kind === "web") navigate({ kind: "web", url: shown?.url || entry.url, ts: dateToStamp(value) })
  }

  const submitAddress = (text) => {
    const value = text.trim()
    if (!value || value === "about:home") return navigate(START)
    const url = normalizeInput(value)
    if (url) return openUrl(url)
    // One word: guess www.<word>.com, as Internet Explorer 5 did. Anything else searches
    // the Start Page directory (archived search engines can't run new searches).
    if (/^[a-z0-9-]+$/i.test(value)) return openUrl(`http://www.${value.toLowerCase()}.com/`)
    setQuery(value)
    navigate(START)
  }

  // the home page (Control Panel > Internet Options), or the Start Page
  const goHome = () => {
    const home = getSettings().ieHome && normalizeInput(getSettings().ieHome)
    if (home) openUrl(home)
    else navigate(START)
  }

  // open a bookmark this window was started with, else the home page
  useEffect(() => {
    const url = initialUrl && normalizeInput(initialUrl)
    if (url) openUrl(url)
    else if (getSettings().ieHome) goHome()
  }, [])

  useEffect(() => {
    const onCleared = () => setHistoryLog([])
    window.addEventListener(HISTORY_CLEARED, onCleared)
    return () => window.removeEventListener(HISTORY_CLEARED, onCleared)
  }, [])

  // ---- messages from the Archive's frame ----

  useEffect(() => {
    const onMessage = (event) => {
      if (event.origin !== ARCHIVE_ORIGIN || !frameRef.current || event.source !== frameRef.current.contentWindow) return
      let data = event.data
      if (typeof data === "string") {
        try {
          data = JSON.parse(data)
        } catch {
          return
        }
      }
      if (!data || typeof data !== "object") return
      if (data.event === "pagehide") {
        setLoading(true)
        setStatus("Opening page...")
        return
      }
      if (data.event !== "playbackReady" && data.event !== "domContentLoaded") return
      const page = parseArchiveUrl(data.pageUrl)
      if (!page) return
      const title = String(data.pageTitle || "").trim()
      setShown({ url: page.original, ts: page.ts, title })
      setAddress(page.original)

      const { entries, index } = navRef.current
      const current = entries[index]
      if (current.kind === "web" && !samePage(current.url, page.original)) {
        if (pendingNav.current) {
          // the Archive redirected what we asked for (www.yahoo.com -> www9.yahoo.com)
          const fixed = [...entries]
          fixed[index] = { ...current, url: page.original }
          setNav({ entries: fixed, index })
        } else {
          // a link clicked inside the page: a new history entry, the frame is already there
          setNav({ entries: [...entries.slice(0, index + 1), { kind: "web", url: page.original, ts: page.ts }], index: index + 1 })
        }
      }
      pendingNav.current = false

      if (data.event === "domContentLoaded") {
        setLoading(false)
        setStatus("Done")
        onTitleRef.current?.(`${title || page.original} - Internet Explorer`)
        setHistoryLog((log) => {
          const next = [{ url: page.original, ts: page.ts, title: title || page.original, at: Date.now() }, ...log.filter((h) => !(samePage(h.url, page.original) && h.ts === page.ts))].slice(0, 100)
          write(HISTORY_KEY, next)
          return next
        })
      }
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [])

  // ---- what the Archive has for this site (did it exist yet?) ----

  const currentUrl = onStart || onLocal ? null : shown?.url || entry.url
  const site = currentUrl ? siteKey(currentUrl) : null
  useEffect(() => {
    if (!site) return
    if (spark.site === site && (spark.data || spark.error)) return
    let live = true
    setSpark({ site, data: null, error: null })
    getSparkline(site).then(
      (data) => live && setSpark({ site, data, error: null }),
      (error) => live && setSpark({ site, data: null, error })
    )
    return () => {
      live = false
    }
  }, [site])

  const sparkData = spark.site === site ? spark.data : null
  const neverArchived = sparkData && !sparkData.first
  const notYet = sparkData?.first && sparkData.first > dateToStamp(date).slice(0, 6)

  // ---- earlier / later capture ----

  const pageKey = (url) => url.replace(/^https?:\/\//i, "").replace(/^www\d*\./i, "")

  const stepCapture = async (dir) => {
    if (!currentUrl || stepping) return
    setStepping(true)
    setStatus(dir < 0 ? "Finding an earlier copy..." : "Finding a later copy...")
    const from = shown?.ts || dateToStamp(date).padEnd(14, "0")
    try {
      const years = sparkData ? Object.keys(sparkData.years).map(Number).filter((y) => sparkData.years[y].some(Boolean)) : []
      let year = Number(from.slice(0, 4))
      let target = null
      for (let tries = 0; tries < 30 && !target; tries++) {
        const { timestamps } = await getCaptures(pageKey(currentUrl), year)
        target = dir < 0 ? [...timestamps].reverse().find((t) => t < from) : timestamps.find((t) => t > from)
        if (target) break
        const nextYears = years.filter((y) => (dir < 0 ? y < year : y > year))
        if (years.length && !nextYears.length) break
        year = years.length ? (dir < 0 ? Math.max(...nextYears) : Math.min(...nextYears)) : year + dir
        if (year < 1996 || year > new Date().getFullYear()) break
      }
      if (!target) {
        setStatus(dir < 0 ? "This is the earliest copy." : "This is the latest copy.")
        return
      }
      const iso = stampToDate(target).toISOString().slice(0, 10)
      setDateState(iso)
      write(DATE_KEY, iso)
      navigate({ kind: "web", url: currentUrl, ts: target })
    } catch {
      // the calendar service is down: step the date by a month instead
      const d = new Date(`${date}T12:00:00Z`)
      d.setUTCMonth(d.getUTCMonth() + dir)
      setDate(d.toISOString().slice(0, 10))
    } finally {
      setStepping(false)
    }
  }

  // ---- favorites ----

  const addFavorite = (name) => {
    if (!shown) return
    const next = [{ name: name.trim() || shown.title || shown.url, url: shown.url, ts: shown.ts }, ...favorites.filter((f) => !(samePage(f.url, shown.url) && f.ts === shown.ts))].slice(0, 200)
    setFavorites(next)
    write(FAVORITES_KEY, next)
  }
  const removeFavorite = (fav) => {
    const next = favorites.filter((f) => f !== fav)
    setFavorites(next)
    write(FAVORITES_KEY, next)
  }
  const openAt = (url, ts) => {
    const iso = stampToDate(ts).toISOString().slice(0, 10)
    setDateState(iso)
    write(DATE_KEY, iso)
    navigate({ kind: "web", url, ts })
  }

  // ---- fit 800px-wide pages into narrow windows (phones) ----

  useLayoutEffect(() => {
    const el = viewRef.current
    const observer = new ResizeObserver(() => setView({ width: el.clientWidth, height: el.clientHeight }))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const scale = view.width && view.width < VIRTUAL_WIDTH ? view.width / VIRTUAL_WIDTH : 1
  const frameStyle =
    scale < 1
      ? { width: VIRTUAL_WIDTH, height: view.height / scale, transform: `scale(${scale})`, transformOrigin: "0 0" }
      : undefined

  // ---- notices ----

  let notice = null
  if (!onStart && sparkData && notYet && !neverArchived) {
    notice = {
      kind: "warn",
      text: `${site} wasn't archived until ${formatYearMonth(sparkData.first)}, so it probably didn't exist yet on ${formatIso(date)}. You're seeing its earliest copy.`,
    }
  } else if (!onStart && shown) {
    const gap = describeGap(shown.ts, date)
    if (Math.abs(gap.days) > 60) notice = { kind: "info", text: `The closest copy of this page was captured ${formatStamp(shown.ts)}, ${gap.text}.` }
  }

  const menus = [
    {
      label: "File",
      items: [
        { label: "New Window", onClick: () => onNewWindow?.(currentUrl) },
        { label: "Open...", onClick: () => setDialog({ kind: "open", text: currentUrl || "" }) },
        "-",
        { label: "View on archive.org", disabled: !currentUrl, onClick: () => window.open(archivePageUrl(currentUrl, shown?.ts || dateToStamp(date)), "_blank", "noopener") },
        "-",
        { label: "Close", onClick: () => onClose?.() },
      ],
    },
    {
      label: "View",
      items: [
        { label: "Favorites", checked: panel === "favorites", onClick: () => setPanel(panel === "favorites" ? null : "favorites") },
        { label: "History", checked: panel === "history", onClick: () => setPanel(panel === "history" ? null : "history") },
        { label: "Captures", checked: panel === "captures", onClick: () => setPanel(panel === "captures" ? null : "captures") },
        "-",
        { label: "Refresh", onClick: refresh },
      ],
    },
    {
      label: "Go",
      items: [
        { label: "Back", disabled: nav.index === 0, onClick: () => go(-1) },
        { label: "Forward", disabled: nav.index === nav.entries.length - 1, onClick: () => go(1) },
        { label: "Home Page", onClick: () => goHome() },
        "-",
        { label: "Earlier Copy", disabled: !currentUrl, onClick: () => stepCapture(-1) },
        { label: "Later Copy", disabled: !currentUrl, onClick: () => stepCapture(1) },
      ],
    },
    {
      label: "Favorites",
      items: [
        { label: "Add to Favorites...", disabled: !shown, onClick: () => setDialog({ kind: "favorite", text: shown?.title || "" }) },
        { label: "Organize Favorites...", onClick: () => setPanel("favorites") },
        ...(favorites.length ? ["-"] : []),
        ...favorites.slice(0, 15).map((fav) => ({ label: `${fav.name} (${stampToDate(fav.ts).getUTCFullYear()})`, onClick: () => openAt(fav.url, fav.ts) })),
      ],
    },
    {
      label: "Help",
      items: [{ label: "About Internet Explorer", onClick: () => setDialog({ kind: "about" }) }],
    },
  ]

  return (
    <div className="ieRoot">
      <MenuBar menus={menus} />

      <div className="ieToolbar">
        <ToolButton icon="back" label="Back" disabled={nav.index === 0} onClick={() => go(-1)} />
        <ToolButton icon="forward" label="Forward" disabled={nav.index === nav.entries.length - 1} onClick={() => go(1)} />
        <ToolButton icon="stop" label="Stop" disabled={!loading} onClick={stop} />
        <ToolButton icon="refresh" label="Refresh" onClick={refresh} />
        <ToolButton icon="home" label="Home" onClick={() => goHome()} />
        <span className="ieToolSep" />
        <ToolButton icon="favorites" label="Favorites" active={panel === "favorites"} onClick={() => setPanel(panel === "favorites" ? null : "favorites")} />
        <ToolButton icon="history" label="History" active={panel === "history"} onClick={() => setPanel(panel === "history" ? null : "history")} />
        <ToolButton icon="captures" label="Captures" active={panel === "captures"} onClick={() => setPanel(panel === "captures" ? null : "captures")} />
        <div className={loading ? "ieThrobber is-busy" : "ieThrobber"} aria-hidden="true">
          e
        </div>
      </div>

      <form
        className="ieAddress"
        onSubmit={(e) => {
          e.preventDefault()
          submitAddress(address)
        }}
      >
        <label htmlFor="ie-address">Address</label>
        <input
          id="ie-address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onFocus={(e) => e.target.select()}
          list="ie-history"
          spellCheck="false"
          autoCapitalize="off"
          autoCorrect="off"
          inputMode="url"
        />
        <datalist id="ie-history">
          {historyLog.slice(0, 30).map((h) => (
            <option key={`${h.url}${h.ts}`} value={h.url} />
          ))}
        </datalist>
        <button type="submit">Go</button>
      </form>

      <div className="ieTimeBar">
        <label htmlFor="ie-date" className="ieTimeLabel">
          Browsing the Web as of
        </label>
        <input
          id="ie-date"
          type="date"
          min={MIN_DATE}
          max={todayIso()}
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <button type="button" disabled={!currentUrl || stepping} onClick={() => stepCapture(-1)} title="The copy before this one">
          &#9664;&#xFE0E; Earlier
        </button>
        <button type="button" disabled={!currentUrl || stepping} onClick={() => stepCapture(1)} title="The copy after this one">
          Later &#9654;&#xFE0E;
        </button>
        {shown && <span className="ieCaptured">Captured {formatStamp(shown.ts, true)}</span>}
      </div>

      <div className="ieLinks">
        <span>Links</span>
        {LINKS_BAR.map((link) => (
          <button key={link.name} type="button" onClick={() => openUrl(link.url)}>
            {link.name}
          </button>
        ))}
      </div>

      {notice && (
        <div className={`ieNotice ieNotice--${notice.kind}`} role="status">
          <span className="ieNoticeIcon">{notice.kind === "warn" ? "!" : "i"}</span>
          <span>{notice.text}</span>
        </div>
      )}

      <div className="ieBody">
        {panel && (
          <aside className="ieExplorerBar">
            <div className="ieBarTitle">
              <span>{{ favorites: "Favorites", history: "History", captures: "Captures" }[panel]}</span>
              <button type="button" aria-label="Close" onClick={() => setPanel(null)}>
                &times;
              </button>
            </div>
            {panel === "favorites" && (
              <div className="ieBarList">
                <button type="button" className="ieBarAction" disabled={!shown} onClick={() => setDialog({ kind: "favorite", text: shown?.title || "" })}>
                  Add this page...
                </button>
                {favorites.length === 0 && <p className="ieBarEmpty">No favorites yet.</p>}
                {favorites.map((fav) => (
                  <div key={`${fav.url}${fav.ts}`} className="ieBarItem">
                    <button type="button" onClick={() => openAt(fav.url, fav.ts)}>
                      <b>{fav.name}</b>
                      <small>{formatStamp(fav.ts)}</small>
                    </button>
                    <button type="button" className="ieBarRemove" aria-label={`Remove ${fav.name}`} onClick={() => removeFavorite(fav)}>
                      &times;
                    </button>
                  </div>
                ))}
              </div>
            )}
            {panel === "history" && (
              <div className="ieBarList">
                {historyLog.length > 0 && (
                  <button
                    type="button"
                    className="ieBarAction"
                    onClick={() => {
                      setHistoryLog([])
                      write(HISTORY_KEY, [])
                    }}
                  >
                    Clear History
                  </button>
                )}
                {historyLog.length === 0 && <p className="ieBarEmpty">Pages you visit will show up here.</p>}
                {historyLog.map((h) => (
                  <div key={`${h.url}${h.ts}${h.at}`} className="ieBarItem">
                    <button type="button" onClick={() => openAt(h.url, h.ts)}>
                      <b>{h.title}</b>
                      <small>{formatStamp(h.ts)}</small>
                    </button>
                  </div>
                ))}
              </div>
            )}
            {panel === "captures" && (
              <CapturesPanel
                url={currentUrl}
                site={site}
                sparkline={sparkData}
                sparkError={spark.site === site ? spark.error : null}
                shownTs={shown?.ts}
                date={date}
                pageKey={currentUrl ? pageKey(currentUrl) : null}
                onPick={(ts) => openAt(currentUrl, ts)}
              />
            )}
          </aside>
        )}

        <div className="ieView" ref={viewRef}>
          {onStart ? (
            <StartPage
              date={date}
              query={query}
              onQuery={setQuery}
              onDate={(iso) => setDate(iso, { reload: false })}
              onOpen={(url) => openUrl(url)}
              onAddress={submitAddress}
            />
          ) : onLocal ? (
            <LocalSite key={frame.key} url={entry.url} onOpen={(url) => openUrl(url)} onTitle={(title) => onTitleRef.current?.(`${title} - Internet Explorer`)} />
          ) : canceled ? (
            <div className="ieErrorPage">
              <h2>Action canceled</h2>
              <p>Internet Explorer was unable to link to the Web page you requested. The page might be temporarily unavailable.</p>
              <button type="button" onClick={refresh}>
                Try again
              </button>
            </div>
          ) : neverArchived ? (
            <div className="ieErrorPage">
              <h2>The page cannot be displayed</h2>
              <p>
                The Wayback Machine has never archived <b>{site}</b>, so there's no copy of it from {formatIso(date)} or any other date.
              </p>
              <ul>
                <li>Check the address for typing mistakes.</li>
                <li>Try the site's main address (for example, www.{site}).</li>
              </ul>
              <button type="button" onClick={() => navigate(START)}>
                Go to the Start Page
              </button>
            </div>
          ) : (
            frame.src && (
              <iframe
                key={frame.key}
                ref={frameRef}
                className="ieFrame"
                src={frame.src}
                style={frameStyle}
                title={shown?.title || "Web page"}
                // Old pages can't break out of the window (frame-busting scripts) or spam alert()
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
                referrerPolicy="no-referrer"
                onLoad={() => {
                  setLoading(false)
                  setStatus((s) => (s.startsWith("Opening") ? "Done" : s))
                }}
              />
            )
          )}
        </div>
      </div>

      <div className="status-bar ieStatus">
        <p className="status-bar-field ieStatusText">{status}</p>
        <p className="status-bar-field ieZone">
          {shown ? `Internet Archive · ${formatStamp(shown.ts)}` : onLocal ? "98ish Web Ring" : "Internet Archive"}
        </p>
      </div>

      {dialog?.kind === "favorite" && (
        <Dialog
          title="Add Favorite"
          onOk={() => {
            addFavorite(dialog.text)
            setDialog(null)
          }}
          onCancel={() => setDialog(null)}
        >
          <p className="dialogText">Internet Explorer will add this page, as captured on {shown && formatStamp(shown.ts)}, to your Favorites.</p>
          <label className="dialogLabel" htmlFor="ie-fav-name">
            Name:
          </label>
          <input id="ie-fav-name" value={dialog.text} maxLength={80} onChange={(e) => setDialog({ ...dialog, text: e.target.value })} />
        </Dialog>
      )}

      {dialog?.kind === "open" && (
        <Dialog
          title="Open"
          okDisabled={!dialog.text.trim()}
          onOk={() => {
            submitAddress(dialog.text)
            setDialog(null)
          }}
          onCancel={() => setDialog(null)}
        >
          <p className="dialogText">Type the Internet address of a document, and Internet Explorer will open it as it was on {formatIso(date)}.</p>
          <input value={dialog.text} onChange={(e) => setDialog({ ...dialog, text: e.target.value })} aria-label="Address" />
        </Dialog>
      )}

      {dialog?.kind === "about" && (
        <Dialog title="About Internet Explorer" onOk={() => setDialog(null)}>
          <p className="dialogText">
            <b>Internet Explorer</b> for 98ish, with a time machine.
            <br />
            <br />
            Pick any date since 1996 and browse the Web as it looked then. Pages come from the{" "}
            <a href="https://web.archive.org/" target="_blank" rel="noopener noreferrer">
              Internet Archive's Wayback Machine
            </a>
            , a nonprofit library that has been saving the Web since 1996.
          </p>
        </Dialog>
      )}
    </div>
  )
}

export default InternetExplorer
