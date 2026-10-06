import React, { useEffect, useRef, useState } from "react"
import Dialog from "../../shared/Dialog"
import { useAim } from "../aim/AimContext"
import { clearCache, videoIdFrom, watchUrl } from "./api"
import { Logo } from "./parts"
import { Favorites, Home, Results, Watch } from "./pages"
import "./YouTube98.css"

// YouTube '98: classic YouTube in an Internet Explorer window. Pages live in an in-app
// history (Back/Forward), the address bar shows each page's URL and accepts a YouTube
// link or a search, and Favorites are kept on this device.

const FAVORITES_KEY = "98ish.youtube.favorites"
const HOME = { type: "home" }

const urlFor = (page) => {
  switch (page.type) {
    case "results":
      return `http://www.youtube.com/results?search_query=${encodeURIComponent(page.q).replace(/%20/g, "+")}`
    case "watch":
      return `http://www.youtube.com/watch?v=${page.id}`
    case "favorites":
      return "http://www.youtube.com/my_favorites"
    default:
      return "http://www.youtube.com/"
  }
}

const loadFavorites = () => {
  try {
    return JSON.parse(localStorage.getItem(FAVORITES_KEY)) || []
  } catch {
    return []
  }
}

// Toolbar glyphs (pixel arrows / house / refresh / star)
const Glyph = ({ d }) => (
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" shapeRendering="crispEdges">
    <path d={d} />
  </svg>
)
const GLYPHS = {
  back: "M2 8l6-6v4h6v4H8v4z",
  forward: "M14 8l-6-6v4H2v4h6v4z",
  refresh: "M8 2a6 6 0 1 0 6 6h-2a4 4 0 1 1-4-4v2l4-3-4-3z",
  home: "M8 1l7 7h-2v7H9v-4H7v4H3V8H1z",
  favorites: "M8 1l2 5h5l-4 3 2 6-5-4-5 4 2-6-4-3h5z",
}

const ToolButton = ({ icon, label, disabled, onClick }) => (
  <button type="button" className="ytTool" disabled={disabled} onClick={onClick} title={label}>
    <Glyph d={GLYPHS[icon]} />
    <span>{label}</span>
  </button>
)

const VideoPlayer = () => {
  const aim = useAim()
  const [history, setHistory] = useState({ stack: [HOME], index: 0, key: 0 })
  const [address, setAddress] = useState(urlFor(HOME))
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState("Done")
  const [favorites, setFavorites] = useState(loadFavorites)
  const [lastResults, setLastResults] = useState([]) // for "Related Videos" on the watch page
  const [share, setShare] = useState(null)
  const pageRef = useRef(null)

  const page = history.stack[history.index]

  useEffect(() => {
    setAddress(urlFor(page))
    if (page.type === "results") setQuery(page.q)
    pageRef.current?.scrollTo(0, 0)
  }, [history.index, history.key])

  const navigate = (next) =>
    setHistory(({ stack, index, key }) => ({ stack: [...stack.slice(0, index + 1), next], index: index + 1, key: key + 1 }))
  const go = (delta) =>
    setHistory(({ stack, index, key }) => ({ stack, index: Math.min(stack.length - 1, Math.max(0, index + delta)), key: key + 1 }))
  const refresh = () => {
    clearCache()
    setHistory((h) => ({ ...h, key: h.key + 1 }))
  }

  const search = (text) => {
    const q = text.trim()
    if (!q) return
    const id = videoIdFrom(q)
    navigate(id ? { type: "watch", id } : { type: "results", q })
  }

  // Address bar: a YouTube link opens the video, youtube.com goes home, anything else searches
  const openAddress = (text) => {
    const value = text.trim()
    const id = videoIdFrom(value)
    if (id) return navigate({ type: "watch", id })
    const q = value.match(/search_query=([^&]+)/)
    if (q) return navigate({ type: "results", q: decodeURIComponent(q[1].replace(/\+/g, " ")) })
    if (/^(https?:\/\/)?(www\.)?youtube\.com\/?$/i.test(value) || !value) return navigate(HOME)
    if (/my_favorites/.test(value)) return navigate({ type: "favorites" })
    search(value.replace(/^https?:\/\//, ""))
  }

  const isFavorite = (id) => favorites.some((v) => v.id === id)
  const toggleFavorite = (video) => {
    const next = isFavorite(video.id)
      ? favorites.filter((v) => v.id !== video.id)
      : [{ ...video, description: undefined, favoritedAt: Date.now() }, ...favorites].slice(0, 200)
    setFavorites(next)
    try {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(next))
    } catch {
      // storage unavailable: favorites last for this visit
    }
  }

  const shared = {
    navigate,
    setStatus,
    favorites,
    isFavorite,
    toggleFavorite,
    lastResults,
    setLastResults,
    onShare: (video) => setShare({ video, to: "", note: null }),
  }

  const signedOn = aim?.status === "online"

  return (
    <div className="ytRoot">
      <div className="ytToolbar">
        <ToolButton icon="back" label="Back" disabled={history.index === 0} onClick={() => go(-1)} />
        <ToolButton icon="forward" label="Forward" disabled={history.index === history.stack.length - 1} onClick={() => go(1)} />
        <ToolButton icon="refresh" label="Refresh" onClick={refresh} />
        <ToolButton icon="home" label="Home" onClick={() => navigate(HOME)} />
        <ToolButton icon="favorites" label="Favorites" onClick={() => navigate({ type: "favorites" })} />
        <div className={status === "Done" ? "ytThrobber" : "ytThrobber is-busy"} aria-hidden="true">
          e
        </div>
      </div>
      <form
        className="ytAddressBar"
        onSubmit={(e) => {
          e.preventDefault()
          openAddress(address)
        }}
      >
        <label htmlFor="yt-address">Address</label>
        <input
          id="yt-address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onFocus={(e) => e.target.select()}
          spellCheck="false"
          autoCapitalize="off"
          autoCorrect="off"
          inputMode="url"
          enterKeyHint="go"
        />
        <button type="submit">Go</button>
      </form>

      <div className="ytPage" ref={pageRef}>
        <header className="ytMasthead">
          <button type="button" className="ytLogoLink" onClick={() => navigate(HOME)} aria-label="YouTube '98 home">
            <Logo />
          </button>
          <form
            className="ytSearch"
            onSubmit={(e) => {
              e.preventDefault()
              search(query)
            }}
          >
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search videos" aria-label="Search videos" enterKeyHint="search" />
            <button type="submit">Search</button>
          </form>
        </header>
        <nav className="ytTabs">
          <button type="button" className={page.type === "home" ? "is-active" : ""} onClick={() => navigate(HOME)}>
            Videos
          </button>
          <button type="button" className={page.type === "favorites" ? "is-active" : ""} onClick={() => navigate({ type: "favorites" })}>
            Favorites{favorites.length ? ` (${favorites.length})` : ""}
          </button>
        </nav>

        <main className="ytContent" key={history.key}>
          {page.type === "home" && <Home {...shared} />}
          {page.type === "results" && <Results {...shared} q={page.q} />}
          {page.type === "watch" && <Watch {...shared} id={page.id} />}
          {page.type === "favorites" && <Favorites {...shared} />}
        </main>

        <footer className="ytFooter">
          Copyright &copy; 1998 YouTube '98 &middot; Broadcast Yourself&trade; &middot; Best viewed in Internet Explorer 4.0 at 800&times;600
        </footer>
      </div>

      <div className="status-bar ytStatus">
        <p className="status-bar-field">{status}</p>
        <p className="status-bar-field ytZone">Internet zone</p>
      </div>

      {share && (
        <Dialog
          title="Share Video"
          okLabel="Close"
          onOk={() => setShare(null)}
        >
          <p className="dialogText">
            <b>{share.video.title}</b>
          </p>
          {!signedOn ? (
            <p className="dialogText">Sign on to 98 Messenger to share videos with your buddies.</p>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  aim.openTogether({ video: share.video.id, title: share.video.title })
                  setShare(null)
                }}
              >
                Watch Together...
              </button>{" "}
              <button
                type="button"
                onClick={async () => {
                  const result = await aim.shareVideo(watchUrl(share.video.id))
                  setShare({ ...share, note: result.ok ? "Posted to the 98ish Lobby chat room!" : result.error })
                }}
              >
                Post to the 98ish Lobby
              </button>
              <label className="dialogLabel" htmlFor="yt-share-to">
                Or send it to a buddy (screen name):
              </label>
              <div className="ytShareRow">
                <input id="yt-share-to" value={share.to} maxLength={16} onChange={(e) => setShare({ ...share, to: e.target.value })} />
                <button
                  type="button"
                  disabled={!share.to.trim()}
                  onClick={async () => {
                    const to = share.to.trim()
                    aim.openIm(to)
                    const result = await aim.sendIm(to, `Check out this video: ${share.video.title} ${watchUrl(share.video.id)}`)
                    setShare({ ...share, note: result.ok ? `Sent to ${to}!` : result.error })
                  }}
                >
                  Send
                </button>
              </div>
            </>
          )}
          {share.note && <p className="dialogText ytShareNote">{share.note}</p>}
        </Dialog>
      )}
    </div>
  )
}

export default VideoPlayer
