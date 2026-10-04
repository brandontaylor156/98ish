import React, { useEffect, useMemo, useRef, useState } from "react"
import { launch } from "../../../utils/programs"
import { shellAction } from "../../../utils/shell"
import { BOOKS, TOPICS, HOME } from "./topics/index.js"
import { bookPath, buildIndex, buildToc, indexLookup, parseInline, prepareTopics, searchTopics, searchWords, topicForProgram, blockKind } from "./helpCore.js"
import { BookIcon, PageIcon, ToolIcon, TipIcon, NoteIcon, WarnIcon, PhoneIcon, MouseIcon } from "./art"
import "./register"
import "./Help.css"

// 98ish Help, after Windows 98's HTML Help viewer: a toolbar (Hide/Show, Back, Forward, Home,
// Print, Options), tabs on the left (Contents: books and pages; Index: keywords with a
// type-to-find box; Search: every word of every page, best first; Favorites) and the topic
// on the right. Phones show the list, then the topic with a Back button.
// Opened with a handoff ({ topic } | { program } | { query }) from utils/help.js openHelp().

const TOPIC = new Map(TOPICS.map((t) => [t.id, t]))
const TOC = buildToc(BOOKS, TOPICS)
const INDEX = buildIndex(TOPICS)
let prepared = null
const searchable = () => (prepared ??= prepareTopics(BOOKS, TOPICS))

const FAV_KEY = "98ish.help.favorites"
const PREFS_KEY = "98ish.help.prefs"
const readJson = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback
  } catch {
    return fallback
  }
}
const writeJson = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // storage full or blocked: for this visit only
  }
}

const TABS = [
  ["contents", "Contents"],
  ["index", "Index"],
  ["search", "Search"],
  ["favorites", "Favorites"],
]

// where a handoff should go
const resolve = (handoff) => {
  if (!handoff) return null
  if (handoff.topic && TOPIC.has(handoff.topic)) return handoff.topic
  if (handoff.program) return topicForProgram(TOPICS, handoff.program) || HOME
  return handoff.query ? null : HOME
}

// ---- a topic's text ----

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const Marked = ({ text, marks }) => {
  if (!marks?.length) return text
  const re = new RegExp(`(${marks.map(escapeRe).join("|")})`, "gi")
  return String(text)
    .split(re)
    .map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part))
}

const Inline = ({ text, go, marks }) =>
  parseInline(text).map((s, i) => {
    if (s.bold !== undefined) return <b key={i}><Marked text={s.bold} marks={marks} /></b>
    if (s.key !== undefined)
      return (
        <kbd key={i} className="hlpKey">
          {s.key}
        </kbd>
      )
    if (s.link !== undefined)
      return (
        <a key={i} href={`#help-${s.link}`} className="hlpLink" onClick={(e) => (e.preventDefault(), go(s.link))}>
          {s.text || TOPIC.get(s.link)?.title || s.link}
        </a>
      )
    return <Marked key={i} text={s.text} marks={marks} />
  })

const Block = ({ block, go, marks, onOpen, mobile }) => {
  const kind = blockKind(block)
  const t = (text) => <Inline text={text} go={go} marks={marks} />
  switch (kind) {
    case "p":
      return <p>{t(typeof block === "string" ? block : block.p)}</p>
    case "h":
      return <h2 className="hlpH">{t(block.h)}</h2>
    case "steps":
      return (
        <div className="hlpSteps">
          <p className="hlpStepsTitle">
            <span className="hlpArrow" aria-hidden="true">{"►"}</span>
            {t(block.title || "To do this:")}
          </p>
          <ol>
            {block.steps.map((s, i) => (
              <li key={i}>{t(s)}</li>
            ))}
          </ol>
        </div>
      )
    case "list":
      return (
        <ul className="hlpList">
          {block.list.map((s, i) => (
            <li key={i}>{t(s)}</li>
          ))}
        </ul>
      )
    case "tip":
    case "note":
    case "warning": {
      const Icon = kind === "tip" ? TipIcon : kind === "note" ? NoteIcon : WarnIcon
      const label = kind === "tip" ? "Tip" : kind === "note" ? "Note" : "Caution"
      return (
        <aside className={`hlpBox hlp-${kind}`} aria-label={label}>
          <Icon />
          <div>
            <b className="hlpBoxLabel">{label}</b>
            <p>{t(block[kind])}</p>
          </div>
        </aside>
      )
    }
    case "phone": {
      // the one for this device first
      const parts = [
        block.phone && ["phone", "On a phone or tablet", PhoneIcon, block.phone],
        block.computer && ["computer", "On a computer", MouseIcon, block.computer],
      ].filter(Boolean)
      if (!mobile) parts.reverse()
      return (
        <div className="hlpDevices">
          {parts.map(([id, label, Icon, text]) => (
            <div key={id} className={`hlpDevice hlp-${id}`}>
              <b>
                <Icon /> {label}
              </b>
              <p>{t(text)}</p>
            </div>
          ))}
        </div>
      )
    }
    case "keys":
      return (
        <div className="hlpKeys">
          {block.title && <p className="hlpStepsTitle">{t(block.title)}</p>}
          <table>
            <tbody>
              {block.keys.map(([k, what], i) => (
                <tr key={i}>
                  <th scope="row">
                    {String(k)
                      .split(/\s*,\s*|\s+or\s+/)
                      .map((one, j, all) => (
                        <React.Fragment key={j}>
                          <kbd className="hlpKey">{one}</kbd>
                          {j < all.length - 1 ? " or " : ""}
                        </React.Fragment>
                      ))}
                  </th>
                  <td>{t(what)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case "table":
      return (
        <div className="hlpTableWrap">
          <table className="hlpTable">
            <thead>
              <tr>
                {block.table.head.map((h, i) => (
                  <th key={i}>{t(h)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.table.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((c, j) => (
                    <td key={j}>{t(c)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case "open":
    case "shell":
      return (
        <p className="hlpShortcut">
          <button type="button" className="hlpOpen" onClick={() => onOpen(block)}>
            <span className="hlpOpenArrow" aria-hidden="true" />
            {block.label || `Open ${block.open}`}
          </button>
        </p>
      )
    case "img":
      return (
        <figure className="hlpFig">
          <img src={block.img} alt={block.alt} draggable="false" />
          {block.caption && <figcaption>{t(block.caption)}</figcaption>}
        </figure>
      )
    default:
      return null
  }
}

const TopicPage = React.forwardRef(({ topic, go, marks, onOpen, mobile }, ref) => (
  <article className="hlpTopic" ref={ref} aria-labelledby="hlp-title" data-selectable>
    <h1 id="hlp-title" className="hlpTitle">
      {topic.title}
    </h1>
    {topic.body.map((block, i) => (
      <Block key={i} block={block} go={go} marks={marks} onOpen={onOpen} mobile={mobile} />
    ))}
    {!!topic.related?.length && (
      <nav className="hlpRelated" aria-label="Related topics">
        <h2>Related Topics</h2>
        <ul>
          {topic.related
            .filter((id) => TOPIC.has(id))
            .map((id) => (
              <li key={id}>
                <a href={`#help-${id}`} className="hlpLink" onClick={(e) => (e.preventDefault(), go(id))}>
                  {TOPIC.get(id).title}
                </a>
              </li>
            ))}
        </ul>
      </nav>
    )}
  </article>
))

// ---- printing: just the topic, in its own little page ----

const PRINT_CSS = `body{font:12pt Georgia,serif;margin:2em;color:#000}h1{font:bold 18pt Arial,sans-serif}h2{font:bold 13pt Arial,sans-serif;margin-top:1.4em}
kbd{font:10pt monospace;border:1px solid #888;padding:0 3px}aside,.hlpDevice{border:1px solid #999;padding:6px 10px;margin:10px 0}aside svg,.hlpDevice svg,.hlpArrow,.hlpOpenArrow{display:none}
table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:3px 8px;text-align:left}button{border:0;background:none;font:inherit;padding:0}a{color:#000;text-decoration:none}
.hlpShortcut{display:none}figure img{max-width:64px}`
const printTopic = (node, title) => {
  if (!node) return
  const frame = document.createElement("iframe")
  frame.setAttribute("aria-hidden", "true")
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0"
  document.body.appendChild(frame)
  const doc = frame.contentDocument
  doc.open()
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title.replace(/</g, "&lt;")} - 98ish Help</title><style>${PRINT_CSS}</style></head><body>${node.innerHTML}</body></html>`)
  doc.close()
  const done = () => setTimeout(() => frame.remove(), 1000)
  setTimeout(() => {
    try {
      frame.contentWindow.focus()
      frame.contentWindow.print()
    } catch {
      window.print()
    }
    done()
  }, 50)
}

// ---- the Contents tree ----

const visibleRows = (nodes, open, depth = 0, out = []) => {
  for (const n of nodes) {
    out.push({ ...n, depth })
    if (n.kind === "book" && open.has(n.id)) visibleRows(n.children, open, depth + 1, out)
  }
  return out
}
const parentOf = (nodes, id, parent = null) => {
  for (const n of nodes) {
    if (n.id === id) return parent
    if (n.kind === "book") {
      const p = parentOf(n.children, id, n.id)
      if (p !== undefined) return p
    }
  }
  return undefined
}

const ContentsTree = ({ open, setOpen, current, onTopic, focusId, setFocusId }) => {
  const rows = visibleRows(TOC, open)
  const ref = useRef(null)
  const toggle = (id) => {
    const next = new Set(open)
    next.has(id) ? next.delete(id) : next.add(id)
    setOpen(next)
  }
  const keyOf = (r) => `${r.kind}:${r.id}`
  const focusRow = (r) => {
    setFocusId(keyOf(r))
    requestAnimationFrame(() => ref.current?.querySelector(`[data-node="${keyOf(r)}"]`)?.focus({ preventScroll: false }))
  }
  const onKeyDown = (e) => {
    const at = rows.findIndex((r) => keyOf(r) === focusId)
    const row = rows[at]
    if (!row) return
    if (e.key === "ArrowDown" && at < rows.length - 1) focusRow(rows[at + 1])
    else if (e.key === "ArrowUp" && at > 0) focusRow(rows[at - 1])
    else if (e.key === "Home") focusRow(rows[0])
    else if (e.key === "End") focusRow(rows[rows.length - 1])
    else if (e.key === "ArrowRight" && row.kind === "book") {
      if (!open.has(row.id)) toggle(row.id)
      else if (row.children[0]) focusRow(row.children[0])
    } else if (e.key === "ArrowLeft") {
      if (row.kind === "book" && open.has(row.id)) toggle(row.id)
      else {
        const p = parentOf(TOC, row.id)
        if (p) focusRow({ kind: "book", id: p })
      }
    } else if (e.key === "Enter" || e.key === " ") {
      if (row.kind === "book") toggle(row.id)
      else onTopic(row.id)
    } else return
    e.preventDefault()
  }
  return (
    <ul className="hlpTree" role="tree" aria-label="Contents" ref={ref} onKeyDown={onKeyDown}>
      {rows.map((r) => {
        const isBook = r.kind === "book"
        const selected = !isBook && r.id === current
        return (
          <li
            key={`${r.kind}:${r.id}`}
            role="treeitem"
            aria-level={r.depth + 1}
            aria-expanded={isBook ? open.has(r.id) : undefined}
            aria-selected={selected}
            tabIndex={keyOf(r) === focusId || (!rows.some((x) => keyOf(x) === focusId) && r === rows[0]) ? 0 : -1}
            data-node={keyOf(r)}
            className={`hlpNode${isBook ? " is-book" : ""}${selected ? " is-selected" : ""}`}
            style={{ paddingLeft: 4 + r.depth * 16 }}
            onClick={() => {
              setFocusId(keyOf(r))
              isBook ? toggle(r.id) : onTopic(r.id)
            }}
          >
            {isBook ? <BookIcon open={open.has(r.id)} /> : <PageIcon />}
            <span>{r.title}</span>
          </li>
        )
      })}
    </ul>
  )
}

// ---- the viewer ----

const HelpViewer = ({ handoff, mobile, dispatch }) => {
  const prefs = useMemo(() => readJson(PREFS_KEY, {}), [])
  const [tab, setTab] = useState(handoff?.query ? "search" : "contents")
  const [history, setHistory] = useState(() => {
    const first = resolve(handoff) || HOME
    return { list: [first], at: 0 }
  })
  const current = history.list[history.at]
  const topic = TOPIC.get(current) || TOPIC.get(HOME) || TOPICS[0]
  // phones: the list ("list") or a topic ("topic")
  const [view, setView] = useState(() => (handoff?.topic || handoff?.program ? "topic" : "list"))
  const [hidden, setHidden] = useState(!!prefs.hidden)
  const [highlight, setHighlight] = useState(prefs.highlight !== false)
  const [open, setOpen] = useState(() => new Set(current === HOME ? [] : bookPath(BOOKS, topic)))
  const [focusId, setFocusId] = useState(null)
  const [favorites, setFavorites] = useState(() => readJson(FAV_KEY, []).filter((id) => TOPIC.has(id)))
  const [favSel, setFavSel] = useState(null)
  // Index
  const [typed, setTyped] = useState("")
  const [indexAt, setIndexAt] = useState(0)
  const [chooser, setChooser] = useState(null) // { term, topics } for a keyword with several topics
  const [chooserSel, setChooserSel] = useState(0)
  // Search
  const [query, setQuery] = useState(handoff?.query || "")
  const [found, setFound] = useState(null) // { query, results }
  const [resultSel, setResultSel] = useState(0)
  const [marks, setMarks] = useState([])
  const [menu, setMenu] = useState(false)
  const topicRef = useRef(null)
  const paneRef = useRef(null)
  const indexListRef = useRef(null)

  useEffect(() => writeJson(PREFS_KEY, { hidden, highlight }), [hidden, highlight])
  useEffect(() => writeJson(FAV_KEY, favorites), [favorites])

  // a new topic: to the top, and its books open in Contents
  useEffect(() => {
    paneRef.current?.scrollTo?.(0, 0)
    setOpen((was) => {
      // the home page leaves Contents as a short list of closed books (docs/simplicity.md)
      if (current === HOME) return was
      const need = bookPath(BOOKS, topic).filter((id) => !was.has(id))
      return need.length ? new Set([...was, ...need]) : was
    })
    setFocusId(`topic:${current}`)
  }, [current])

  const go = (id, { marked = [] } = {}) => {
    const next = TOPIC.has(id) ? id : HOME
    setMarks(marked)
    setHistory((h) => (h.list[h.at] === next ? h : { list: [...h.list.slice(0, h.at + 1), next].slice(-100), at: Math.min(h.at + 1, 99) }))
    if (mobile) setView("topic")
  }
  const back = () => history.at > 0 && (setMarks([]), setHistory((h) => ({ ...h, at: h.at - 1 })), mobile && setView("topic"))
  const forward = () => history.at < history.list.length - 1 && (setMarks([]), setHistory((h) => ({ ...h, at: h.at + 1 })), mobile && setView("topic"))
  const home = () => go(HOME)

  const runSearch = (q = query) => {
    const words = String(q).trim()
    if (!words) return setFound(null)
    setFound({ query: words, results: searchTopics(searchable(), words, 60) })
    setResultSel(0)
  }

  // opened again (Help Topics in a program, F1, a search): go there
  const lastHandoff = useRef(handoff?.id)
  useEffect(() => {
    if (!handoff?.id || handoff.id === lastHandoff.current) return
    lastHandoff.current = handoff.id
    if (handoff.query) {
      setTab("search")
      setQuery(handoff.query)
      runSearch(handoff.query)
      if (mobile) setView("list")
      return
    }
    go(resolve(handoff) || HOME)
    // just "Help" (Start > Help > Help Topics): the list, on phones
    if (mobile && !handoff.topic && !handoff.program) setView("list")
  }, [handoff?.id])
  // a search handed over when the window opened
  useEffect(() => {
    if (handoff?.query) runSearch(handoff.query)
  }, [])

  const onOpen = (block) => {
    if (block.shell) return shellAction(block.shell)
    dispatch?.({ type: "open_window", payload: launch(block.open, block.extra || {}) })
  }

  // ---- Index ----
  const openTerm = (entry) => {
    if (!entry) return
    if (entry.topics.length === 1) return go(entry.topics[0])
    setChooser(entry)
    setChooserSel(0)
  }
  const typeIndex = (value) => {
    setTyped(value)
    const at = indexLookup(INDEX, value)
    setIndexAt(at)
    requestAnimationFrame(() => indexListRef.current?.querySelector(`[data-i="${at}"]`)?.scrollIntoView({ block: "nearest" }))
  }
  const moveIndex = (delta) => {
    const at = Math.max(0, Math.min(INDEX.length - 1, indexAt + delta))
    setIndexAt(at)
    setTyped(INDEX[at].term)
    requestAnimationFrame(() => indexListRef.current?.querySelector(`[data-i="${at}"]`)?.scrollIntoView({ block: "nearest" }))
  }

  const isFav = favorites.includes(current)
  const addFav = () => !isFav && setFavorites([...favorites, current])
  const removeFav = (id) => setFavorites(favorites.filter((f) => f !== id))

  // keys: Alt+Left/Right go back and forward
  const onKeyDown = (e) => {
    if (e.altKey && e.key === "ArrowLeft") (e.preventDefault(), back())
    else if (e.altKey && e.key === "ArrowRight") (e.preventDefault(), forward())
    else if (e.key === "Escape" && menu) setMenu(false)
  }

  const options = [
    { label: hidden ? "Show Tabs" : "Hide Tabs", onClick: () => setHidden(!hidden), hide: mobile },
    { label: "Back", onClick: back, disabled: history.at === 0 },
    { label: "Forward", onClick: forward, disabled: history.at >= history.list.length - 1 },
    { label: "Home", onClick: home },
    { label: isFav ? "Remove from Favorites" : "Add to Favorites", onClick: () => (isFav ? removeFav(current) : addFav()) },
    "-",
    { label: "Print...", onClick: () => printTopic(topicRef.current, topic.title) },
    { label: highlight ? "Search Highlight Off" : "Search Highlight On", onClick: () => setHighlight(!highlight) },
  ].filter((o) => o === "-" || !o.hide)

  const toolbar = (
    <div className="hlpToolbar" role="toolbar" aria-label="Help toolbar">
      {!mobile && (
        <button type="button" className="hlpTool" onClick={() => setHidden(!hidden)} aria-pressed={hidden}>
          <ToolIcon kind={hidden ? "show" : "hide"} />
          <span>{hidden ? "Show" : "Hide"}</span>
        </button>
      )}
      <button type="button" className="hlpTool" onClick={back} disabled={history.at === 0}>
        <ToolIcon kind="back" />
        <span>Back</span>
      </button>
      {/* the baseline toolbar (docs/simplicity.md): Forward once there's somewhere to go;
          Print on a computer (both always in Options) */}
      {history.at < history.list.length - 1 && (
        <button type="button" className="hlpTool" onClick={forward}>
          <ToolIcon kind="forward" />
          <span>Forward</span>
        </button>
      )}
      <button type="button" className="hlpTool" onClick={home}>
        <ToolIcon kind="home" />
        <span>Home</span>
      </button>
      {!mobile && (
        <button type="button" className="hlpTool" onClick={() => printTopic(topicRef.current, topic.title)}>
          <ToolIcon kind="print" />
          <span>Print</span>
        </button>
      )}
      <div className="hlpOptionsWrap">
        <button type="button" className="hlpTool" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
          <ToolIcon kind="options" />
          <span>Options</span>
        </button>
        {menu && (
          <>
            <div className="hlpMenuCatch" onClick={() => setMenu(false)} />
            <ul className="hlpMenu window" role="menu">
              {options.map((o, i) =>
                o === "-" ? (
                  <li key={i} className="hlpMenuSep" role="separator" />
                ) : (
                  <li key={o.label} role="none">
                    <button type="button" role="menuitem" disabled={o.disabled} onClick={() => (setMenu(false), o.onClick())}>
                      {o.label}
                    </button>
                  </li>
                )
              )}
            </ul>
          </>
        )}
      </div>
    </div>
  )

  const contentsPanel = (
    <ContentsTree open={open} setOpen={setOpen} current={current} onTopic={(id) => go(id)} focusId={focusId} setFocusId={setFocusId} />
  )

  const indexPanel = (
    <div className="hlpPanelCol">
      <label htmlFor="hlp-index-box" className="hlpLabel">
        Type in the keyword to find:
      </label>
      <input
        id="hlp-index-box"
        type="text"
        autoComplete="off"
        value={typed}
        onChange={(e) => typeIndex(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") (e.preventDefault(), moveIndex(1))
          else if (e.key === "ArrowUp") (e.preventDefault(), moveIndex(-1))
          else if (e.key === "Enter") (e.preventDefault(), openTerm(INDEX[indexAt]))
        }}
      />
      <ul className="hlpListBox" role="listbox" aria-label="Index" ref={indexListRef}>
        {INDEX.map((e, i) => (
          <li
            key={e.term}
            data-i={i}
            role="option"
            aria-selected={i === indexAt}
            className={i === indexAt ? "is-selected" : undefined}
            onClick={() => {
              setIndexAt(i)
              setTyped(e.term)
              if (mobile) openTerm(e)
            }}
            onDoubleClick={() => openTerm(e)}
          >
            {e.term}
          </li>
        ))}
      </ul>
      {!mobile && (
        <div className="hlpPanelButtons">
          <button type="button" onClick={() => openTerm(INDEX[indexAt])}>
            Display
          </button>
        </div>
      )}
    </div>
  )

  const results = found?.results || []
  const searchPanel = (
    <div className="hlpPanelCol">
      <form
        className="hlpSearchForm"
        onSubmit={(e) => {
          e.preventDefault()
          runSearch()
        }}
      >
        <label htmlFor="hlp-search-box" className="hlpLabel">
          Type in the word(s) to search for:
        </label>
        <div className="hlpSearchRow">
          <input id="hlp-search-box" type="search" autoComplete="off" value={query} onChange={(e) => setQuery(e.target.value)} />
          <button type="submit">List Topics</button>
        </div>
      </form>
      <p className="hlpFound" aria-live="polite">
        {found ? (results.length ? `Found: ${results.length}` : `No topics found for "${found.query}". Try fewer or different words.`) : "Select topic to display:"}
      </p>
      <ul className="hlpListBox hlpResults" role="listbox" aria-label="Topics found">
        {results.map((r, i) => (
          <li
            key={r.id}
            role="option"
            aria-selected={i === resultSel}
            className={i === resultSel ? "is-selected" : undefined}
            onClick={() => {
              setResultSel(i)
              if (mobile) go(r.id, { marked: highlight ? searchWords(found.query) : [] })
            }}
            onDoubleClick={() => go(r.id, { marked: highlight ? searchWords(found.query) : [] })}
          >
            <span className="hlpResTitle">{r.title}</span>
            <span className="hlpResBook">{r.book}</span>
            {mobile && r.snippet && <span className="hlpResSnip">{r.snippet}</span>}
          </li>
        ))}
      </ul>
      {!mobile && (
        <div className="hlpPanelButtons">
          <button type="button" disabled={!results.length} onClick={() => results[resultSel] && go(results[resultSel].id, { marked: highlight ? searchWords(found.query) : [] })}>
            Display
          </button>
        </div>
      )}
    </div>
  )

  const favoritesPanel = (
    <div className="hlpPanelCol">
      <p className="hlpLabel">Topics:</p>
      <ul className="hlpListBox" role="listbox" aria-label="Favorite topics">
        {favorites.map((id) => (
          <li
            key={id}
            role="option"
            aria-selected={id === favSel}
            className={id === favSel ? "is-selected" : undefined}
            onClick={() => (setFavSel(id), mobile && go(id))}
            onDoubleClick={() => go(id)}
          >
            {TOPIC.get(id).title}
          </li>
        ))}
        {!favorites.length && <li className="hlpEmpty">No favorites yet. Open a topic you like and choose Add.</li>}
      </ul>
      <div className="hlpPanelButtons">
        <button type="button" disabled={!favSel || !favorites.includes(favSel)} onClick={() => (removeFav(favSel), setFavSel(null))}>
          Remove
        </button>
        {!mobile && (
          <button type="button" disabled={!favSel || !favorites.includes(favSel)} onClick={() => go(favSel)}>
            Display
          </button>
        )}
      </div>
      <p className="hlpLabel">Current topic:</p>
      <div className="hlpCurrent">{topic.title}</div>
      <div className="hlpPanelButtons">
        <button type="button" disabled={isFav} onClick={addFav}>
          Add
        </button>
      </div>
    </div>
  )

  const panels = { contents: contentsPanel, index: indexPanel, search: searchPanel, favorites: favoritesPanel }
  const navPane = (
    <div className="hlpNav">
      <menu role="tablist" className="hlpTabs" aria-label="Find help by">
        {TABS.map(([id, label]) => (
          <li key={id} role="tab" aria-selected={tab === id} data-tab={id}>
            <a
              href={`#${id}`}
              onClick={(e) => {
                e.preventDefault()
                setTab(id)
              }}
            >
              {label}
            </a>
          </li>
        ))}
      </menu>
      <div className="window hlpTabPanel" role="tabpanel" aria-label={TABS.find(([id]) => id === tab)[1]}>
        {panels[tab]}
      </div>
    </div>
  )

  const topicPane = (
    <div className="hlpPane" ref={paneRef} tabIndex={-1}>
      {mobile && (
        <button type="button" className="hlpBackToList" onClick={() => setView("list")}>
          {"◂"} Back to {TABS.find(([id]) => id === tab)[1]}
        </button>
      )}
      <TopicPage ref={topicRef} topic={topic} go={go} marks={highlight ? marks : []} onOpen={onOpen} mobile={mobile} />
    </div>
  )

  return (
    <div className={`hlpRoot${mobile ? " hlpPhone" : ""}${hidden && !mobile ? " is-hidden" : ""}`} onKeyDown={onKeyDown} data-topic={topic.id}>
      {toolbar}
      <div className="hlpBody">
        {mobile ? (view === "list" ? navPane : topicPane) : (
          <>
            {!hidden && navPane}
            {topicPane}
          </>
        )}
      </div>
      {chooser && (
        <div className="hlpDim" onClick={() => setChooser(null)}>
          <div className="window hlpChooser" role="dialog" aria-modal="true" aria-labelledby="hlp-chooser-title" onClick={(e) => e.stopPropagation()}>
            <div className="title-bar">
              <div className="title-bar-text" id="hlp-chooser-title">
                Topics Found
              </div>
              <div className="title-bar-controls">
                <button aria-label="Close" onClick={() => setChooser(null)} />
              </div>
            </div>
            <div className="window-body">
              <p>
                Click a topic, then click Display. (<b>{chooser.term}</b>)
              </p>
              <ul className="hlpListBox" role="listbox" aria-label="Topics found">
                {chooser.topics.map((id, i) => (
                  <li
                    key={id}
                    role="option"
                    aria-selected={i === chooserSel}
                    className={i === chooserSel ? "is-selected" : undefined}
                    onClick={() => (setChooserSel(i), mobile && (setChooser(null), go(id)))}
                    onDoubleClick={() => (setChooser(null), go(id))}
                  >
                    {TOPIC.get(id)?.title}
                  </li>
                ))}
              </ul>
              <div className="hlpPanelButtons">
                <button type="button" onClick={() => (setChooser(null), go(chooser.topics[chooserSel]))}>
                  Display
                </button>
                <button type="button" onClick={() => setChooser(null)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default HelpViewer
