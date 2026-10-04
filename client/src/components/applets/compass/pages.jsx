import React, { useMemo, useState } from "react"
import { SEARCH_ENGINES, displayUrl, formatBytes, hostOf, searchHistory } from "./urls"
import { clearDownloads, clearHistory, moveBookmark, removeBookmark, removeHistory, updateBookmark } from "./store"

// Compass's own pages (compass://...) and the pages it shows instead of a site.

export const Favicon = ({ src, size = 16 }) => {
  const [broken, setBroken] = useState(false)
  if (!src || broken)
    return (
      <svg className="cmpFavicon" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" shapeRendering="crispEdges">
        <circle cx="8" cy="8" r="6.5" fill="#3a78c9" stroke="#123" />
        <path d="M2 8h12M8 1.5v13M4 4c2 1.5 6 1.5 8 0M4 12c2-1.5 6-1.5 8 0" stroke="#bfe0ff" fill="none" />
      </svg>
    )
  return <img className="cmpFavicon" src={src} width={size} height={size} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
}

const faviconOf = (url) => {
  try {
    return new URL("/favicon.ico", url).href
  } catch {
    return null
  }
}

const dayLabel = (at) => {
  const d = new Date(at)
  const today = new Date()
  const yesterday = new Date(Date.now() - 86400000)
  if (d.toDateString() === today.toDateString()) return "Today"
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday"
  return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" })
}
const timeLabel = (at) => new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })

export const NewTabPage = ({ store, engine, onOpen, onSearch, phone }) => {
  const [query, setQuery] = useState("")
  const tiles = store.bookmarks.slice(0, phone ? 8 : 12)
  const recent = useMemo(() => {
    const seen = new Set()
    return store.history.filter((h) => (seen.has(hostOf(h.url)) ? false : seen.add(hostOf(h.url)))).slice(0, 6)
  }, [store.history])
  return (
    <div className="cmpPage cmpHome">
      <div className="cmpBrand">
        <CompassLogo size={phone ? 44 : 56} />
        <div>
          <h1>Compass</h1>
          <p>The real Web, 98ish style.</p>
        </div>
      </div>
      <form
        className="cmpBigSearch"
        onSubmit={(e) => {
          e.preventDefault()
          if (query.trim()) onSearch(query)
        }}
      >
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${SEARCH_ENGINES[engine]?.name || "the Web"} or type an address`} aria-label="Search or address" enterKeyHint="go" autoCapitalize="off" autoCorrect="off" spellCheck="false" />
        <button type="submit">Search</button>
      </form>
      {tiles.length > 0 && (
        <>
          <h2>Bookmarks</h2>
          <div className="cmpTiles">
            {tiles.map((b) => (
              <button key={b.id} type="button" className="cmpTile" onClick={() => onOpen(b.url)} title={b.url}>
                <Favicon src={faviconOf(b.url)} size={32} />
                <span>{b.title}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {recent.length > 0 && (
        <>
          <h2>Recently visited</h2>
          <ul className="cmpList">
            {recent.map((h) => (
              <li key={h.at}>
                <button type="button" onClick={() => onOpen(h.url)}>
                  <Favicon src={faviconOf(h.url)} />
                  <b>{h.title || displayUrl(h.url)}</b>
                  <small>{displayUrl(h.url)}</small>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

export const HistoryPage = ({ store, onOpen }) => {
  const [query, setQuery] = useState("")
  const found = useMemo(() => searchHistory(store.history, query).slice(0, 500), [store.history, query])
  let lastDay = null
  return (
    <div className="cmpPage">
      <h1>History</h1>
      <div className="cmpPageTools">
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search history" aria-label="Search history" enterKeyHint="search" />
        <button type="button" disabled={!store.history.length} onClick={() => window.confirm("Clear all of your Compass history?") && clearHistory()}>
          Clear History
        </button>
      </div>
      {!store.history.length && <p className="cmpEmpty">Pages you visit will show up here.</p>}
      {store.history.length > 0 && !found.length && <p className="cmpEmpty">No pages match &quot;{query}&quot;.</p>}
      <ul className="cmpList">
        {found.map((h) => {
          const day = dayLabel(h.at)
          const header = day !== lastDay ? (lastDay = day) : null
          return (
            <React.Fragment key={h.at + h.url}>
              {header && <li className="cmpDay">{header}</li>}
              <li>
                <button type="button" onClick={() => onOpen(h.url)}>
                  <span className="cmpTime">{timeLabel(h.at)}</span>
                  <Favicon src={faviconOf(h.url)} />
                  <b>{h.title || displayUrl(h.url)}</b>
                  <small>{displayUrl(h.url)}</small>
                </button>
                <button type="button" className="cmpRemove" aria-label={`Remove ${h.title || h.url} from history`} onClick={() => removeHistory(h.at)}>
                  &times;
                </button>
              </li>
            </React.Fragment>
          )
        })}
      </ul>
    </div>
  )
}

export const BookmarksPage = ({ store, onOpen, onImport }) => {
  const [editing, setEditing] = useState(null)
  return (
    <div className="cmpPage">
      <h1>Bookmarks</h1>
      <div className="cmpPageTools">
        <button type="button" onClick={onImport}>
          Import from Internet Explorer
        </button>
      </div>
      {!store.bookmarks.length && <p className="cmpEmpty">Tap the star in the address bar to bookmark a page.</p>}
      <ul className="cmpList">
        {store.bookmarks.map((b, i) => (
          <li key={b.id}>
            {editing === b.id ? (
              <form
                className="cmpEdit"
                onSubmit={(e) => {
                  e.preventDefault()
                  const data = new FormData(e.currentTarget)
                  updateBookmark(b.id, { title: String(data.get("title") || b.title), url: /^https?:\/\//.test(String(data.get("url"))) ? String(data.get("url")) : b.url })
                  setEditing(null)
                }}
              >
                <input name="title" defaultValue={b.title} aria-label="Name" />
                <input name="url" defaultValue={b.url} aria-label="Address" inputMode="url" autoCapitalize="off" />
                <button type="submit">Save</button>
                <button type="button" onClick={() => setEditing(null)}>
                  Cancel
                </button>
              </form>
            ) : (
              <>
                <button type="button" onClick={() => onOpen(b.url)}>
                  <Favicon src={faviconOf(b.url)} />
                  <b>{b.title}</b>
                  <small>{displayUrl(b.url)}</small>
                </button>
                <label className="cmpBarToggle" title="Show on the bookmarks bar">
                  <input type="checkbox" checked={!!b.bar} onChange={(e) => updateBookmark(b.id, { bar: e.target.checked })} /> Bar
                </label>
                <button type="button" className="cmpSmall" aria-label={`Move ${b.title} up`} disabled={i === 0} onClick={() => moveBookmark(b.id, i - 1)}>
                  &#9650;&#xFE0E;
                </button>
                <button type="button" className="cmpSmall" aria-label={`Move ${b.title} down`} disabled={i === store.bookmarks.length - 1} onClick={() => moveBookmark(b.id, i + 1)}>
                  &#9660;&#xFE0E;
                </button>
                <button type="button" className="cmpSmall" onClick={() => setEditing(b.id)}>
                  Edit
                </button>
                <button type="button" className="cmpRemove" aria-label={`Delete ${b.title}`} onClick={() => removeBookmark(b.id)}>
                  &times;
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

export const DownloadsPage = ({ store, onOpen }) => (
  <div className="cmpPage">
    <h1>Downloads</h1>
    <div className="cmpPageTools">
      <button type="button" disabled={!store.downloads.length} onClick={clearDownloads}>
        Clear List
      </button>
    </div>
    {!store.downloads.length && <p className="cmpEmpty">Files you download show up here. Small files can be saved to the 98ish drive (C:\Downloads); anything else goes to your device.</p>}
    <ul className="cmpList">
      {store.downloads.map((d) => (
        <li key={d.at}>
          <button type="button" onClick={() => onOpen(d.url)}>
            <span className="cmpTime">{timeLabel(d.at)}</span>
            <b>{d.name}</b>
            <small>{d.where === "drive" ? `Saved to ${d.path || "C:\\Downloads"}` : "Sent to your device"} {d.size ? `· ${formatBytes(d.size)}` : ""}</small>
          </button>
        </li>
      ))}
    </ul>
  </div>
)

export const AboutPage = ({ session }) => (
  <div className="cmpPage cmpAbout">
    <div className="cmpBrand">
      <CompassLogo size={48} />
      <div>
        <h1>About Compass</h1>
        <p>Version 1.1 for 98ish</p>
      </div>
    </div>
    <h2>How Compass shows the real Web</h2>
    <p>Most sites won&apos;t let other pages show them in a frame, so Compass shows each site in one of three ways, always inside Compass:</p>
    <ul>
      <li>
        <b>Through the 98ish server (the &quot;relay&quot;)</b>: {session?.mode === "on" && !session?.guest ? "any site, now that you're signed on." : "Wikipedia and its sister sites (Wiktionary, Wikivoyage, Wikibooks, Wikiquote, Wikimedia Commons), OpenStreetMap and example.com."} The server fetches the page and passes it on. Pages come from the server&apos;s address; pictures and scripts usually load straight from the sites, so they can still see yours (View &gt; Relay Pictures Too sends those through the server as well). <b>Anything you type into a relayed page, passwords included, passes through the 98ish server.</b>
      </li>
      <li>
        <b>Straight from the site</b>, for other sites that allow being shown in a frame. The page loads from the site over your own connection (the site sees your address), not through 98ish; the 98ish server only looks at the site&apos;s headers first to see whether it allows frames.
      </li>
      <li>
        <b>A saved copy from the Internet Archive</b> (the Wayback Machine), for sites that don&apos;t. A slim bar above the page says so and gives its date. The copy loads from web.archive.org over your own connection (the Archive sees your address), not through 98ish. Links inside it lead to more saved pages.
      </li>
    </ul>
    <p>Every page runs in a locked-down frame: it can&apos;t read your 98ish files, settings or sign-in, can&apos;t use your 98 Messenger account and can&apos;t take over the 98ish window.</p>
    <ul>
      {session?.mode === "on" && session?.guest && <li>Sign on with your 98 Messenger screen name to see other sites live through the relay.</li>}
      <li>Cookies for relayed sites (so you can stay signed in to simple sites) are kept in the server&apos;s memory for your 98 Messenger account (a guest&apos;s only until the browsing session ends), only for the site that set them, and are gone after a day unused or when the server restarts. Tools &gt; Clear Cookies forgets them.</li>
      <li>To see a site live outside 98ish (videos, sign-ins, banks), use File &gt; Open in your browser, or the small link on a saved copy&apos;s bar.</li>
      <li>The server has a daily data allowance (shared with everyone), and a monthly one: the 98ish server&apos;s free plan includes a fixed amount of data a month for everything (Messenger, file sync, games and Compass). When Compass has used its share, the relay rests until the 1st of the next month; sites still show straight from the site or as saved copies, and the rest of 98ish keeps working.</li>
    </ul>
    {session && (
      <p className="cmpUsage">
        Data used today: {formatBytes(session.used) || "0 KB"} of {formatBytes(session.limit)}
        {session.guest ? " (guest)" : ` (${session.name || "signed on"})`}
        {session.closed ? `. Resting until ${new Date(session.closed).toLocaleDateString(undefined, { month: "long", day: "numeric", timeZone: "UTC" })}.` : ""}
      </p>
    )}
    <p>Searches go to Wikipedia while Compass relays only its list of sites (with every site open to you, Tools &gt; Compass Options picks the search engine).</p>
  </div>
)

// Instead of a site: a file, a sign-on prompt, an error, or a site that can't be shown at all
export const StubPage = ({ info, openIn = "Open in Your Browser", onReal, onRetry, onTimeMachine, onSignOn, onWithoutSignOn, onSearch, onSave }) => {
  const title = info.title || "Compass can't show this page"
  const web = info.url && /^https?:/.test(info.url)
  return (
    <div className="cmpPage cmpStub">
      <div className="cmpStubIcon" aria-hidden="true">
        {info.kind === "signon" ? <img src="/assets/program_icons/aim2-48.png" width="48" height="48" alt="" draggable="false" /> : info.kind === "download" ? "\u{1F4BE}" : info.kind === "media" ? "\u{1F3AC}" : info.kind === "nosnapshot" ? "\u{1F310}" : info.kind === "monthly" ? "\u{1F4C5}" : "!"}
      </div>
      <h1>{title}</h1>
      {info.text && <p>{info.text}</p>}
      {info.url && <p className="cmpStubUrl">{displayUrl(info.url)}</p>}
      {info.kind === "download" && info.size ? <p>Size: {formatBytes(info.size)}</p> : null}
      <div className="cmpStubButtons">
        {info.kind === "download" && !info.tooBig && onSave && (
          <button type="button" className="cmpPrimary" onClick={onSave}>
            Save to 98ish Drive
          </button>
        )}
        {info.kind === "download" && web && (
          <button type="button" onClick={onReal}>
            Save to My Device
          </button>
        )}
        {info.kind === "signon" && onSignOn && (
          <>
            <button type="button" className="cmpPrimary" onClick={() => onSignOn(false)}>
              Sign On
            </button>
            <button type="button" onClick={() => onSignOn(true)}>
              Get a Screen Name
            </button>
            {onWithoutSignOn && (
              <button type="button" onClick={onWithoutSignOn}>
                Show It Without Signing On
              </button>
            )}
          </>
        )}
        {info.kind === "nosnapshot" && info.term && onSearch && (
          <button type="button" className="cmpPrimary" onClick={() => onSearch(info.term)}>
            Search Wikipedia for &quot;{info.term}&quot;
          </button>
        )}
        {["error", "expired", "budget", "offline", "unavailable", "nosnapshot"].includes(info.kind) && onRetry && (
          <button type="button" onClick={onRetry}>
            Try Again
          </button>
        )}
      </div>
      {info.kind === "nosnapshot" && <p className="cmpStubAlt">The Internet Archive saves copies of many pages over time, so a saved copy may be there later.</p>}
      {info.kind !== "download" && web && (
        <p className="cmpStubAlt">
          {onTimeMachine && (
            <>
              Older copies are in the{" "}
              <button type="button" className="cmpLink" onClick={onTimeMachine}>
                Internet Explorer time machine
              </button>
              .{" "}
            </>
          )}
          <button type="button" className="cmpLink" onClick={onReal}>
            {openIn}
          </button>
        </p>
      )}
    </div>
  )
}

export const CompassLogo = ({ size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" shapeRendering="crispEdges">
    <circle cx="16" cy="16" r="14" fill="#c0c0c0" stroke="#000" strokeWidth="2" />
    <circle cx="16" cy="16" r="11" fill="#fff" stroke="#808080" strokeWidth="1" />
    <path d="M16 6l3 10h-6z" fill="#c00000" stroke="#600" />
    <path d="M16 26l-3-10h6z" fill="#000080" stroke="#002" />
    <circle cx="16" cy="16" r="1.6" fill="#ffd400" stroke="#000" strokeWidth="0.8" />
    <path d="M16 3v2M16 27v2M3 16h2M27 16h2" stroke="#000" strokeWidth="1.5" />
  </svg>
)
