import React, { useEffect, useMemo, useRef, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import { SEARCH_TYPES } from "../../../utils/searchIndex"
import { fold, scoreEntry, tokenize } from "../../../utils/searchCore"
import { formatSize } from "../../../utils/fileInfo"
import "./Find.css"

// Find: All Files, after Windows 98's (Start > Find, or "See all results" in the Start menu):
// Named, Containing text, Look in (Name & Location), a date range (Date) and the kind and size
// of file (Advanced). It searches everything Start menu search does, with a tab per kind of
// result (Programs, Settings, Files, Contacts, Calendar, Messages, Mail, Photos).

const LOOK_IN = [
  ["", "Everywhere (everything 98ish has)"],
  ["C:", "My Computer (C:)"],
  ["C:\\Documents", "My Documents"],
  ["C:\\Desktop", "Desktop"],
  ["C:\\My Pictures", "My Pictures"],
  ["C:\\My Music", "My Music"],
]
const KINDS = [
  ["", "All files and folders"],
  ["folder", "Folder"],
  ["text", "Text Document"],
  ["richtext", "Rich Text Document"],
  ["image", "Picture"],
  ["sound", "Wave Sound"],
  ["music", "MIDI Sequence"],
  ["vcard", "vCard File"],
  ["internet", "Internet Shortcut"],
]
const CRITERIA = [
  ["name", "Name & Location"],
  ["date", "Date"],
  ["advanced", "Advanced"],
]
const DAY = 86_400_000
const FILE_TYPES = ["files", "photos"]
const isoDay = (t) => new Date(t - new Date(t).getTimezoneOffset() * 60_000).toISOString().slice(0, 10)

const typeLabel = (id) => SEARCH_TYPES.find((t) => t.id === id)?.label || id
const when = (t, allDay) => (t ? new Date(t).toLocaleString([], { year: "numeric", month: "numeric", day: "numeric", ...(allDay ? {} : { hour: "numeric", minute: "2-digit" }) }) : "")

const Find = ({ mobile, dispatch, query: firstQuery = "", handoff, onTitle, onClose }) => {
  const [criteria, setCriteria] = useState("name")
  const [named, setNamed] = useState(firstQuery || "")
  const [containing, setContaining] = useState("")
  const [lookIn, setLookIn] = useState("")
  const [subfolders, setSubfolders] = useState(true)
  const [dateMode, setDateMode] = useState("all") // all | between | months | days
  const [from, setFrom] = useState(() => isoDay(Date.now() - 30 * DAY))
  const [to, setTo] = useState(() => isoDay(Date.now()))
  const [months, setMonths] = useState(1)
  const [days, setDays] = useState(1)
  const [kind, setKind] = useState("")
  const [sizeMode, setSizeMode] = useState("") // "" | atleast | atmost
  const [sizeKb, setSizeKb] = useState(1)
  const [found, setFound] = useState(null) // { list, ms } after Find Now
  const [tab, setTab] = useState("all")
  const [selected, setSelected] = useState(null)
  const [note, setNote] = useState(null)
  const [searching, setSearching] = useState(false)
  const engine = useRef(null)
  const namedRef = useRef(null)

  useEffect(() => onTitle?.(found && named ? `Find: Files named ${named}` : "Find: All Files"), [found, named])

  const filesOnly = !!lookIn || !!kind || !!sizeMode
  const dated = dateMode !== "all"

  const run = async (overrides = {}) => {
    const n = overrides.named ?? named
    const words = [n, containing].filter((s) => s.trim()).join(" ")
    if (!words.trim() && !filesOnly && !dated) {
      setNote("Type a name or some words to look for, or pick a date, kind or size.")
      namedRef.current?.focus()
      return
    }
    setNote(null)
    setSearching(true)
    engine.current ??= await import("../../../utils/search")
    const started = performance.now()
    const { groups } = engine.current.searchAll(words, { all: !words.trim(), types: filesOnly ? FILE_TYPES : SEARCH_TYPES.map((t) => t.id) })
    // from the Start menu ("See all results"): the same matches it had, anywhere in each item
    const namedTokens = overrides.loose ? [] : tokenize(n)
    const phrase = overrides.loose ? "" : fold(containing).trim()
    const now = Date.now()
    const range =
      dateMode === "between"
        ? [new Date(`${from}T00:00`).getTime(), new Date(`${to}T00:00`).getTime() + DAY]
        : dateMode === "months"
        ? [now - Math.max(1, months) * 30.44 * DAY, now + 60_000]
        : dateMode === "days"
        ? [now - Math.max(1, days) * DAY, now + 60_000]
        : null
    const list = []
    for (const g of groups) {
      for (const r of g.results) {
        const isFile = FILE_TYPES.includes(g.type)
        if (namedTokens.length && !scoreEntry({ title: r.search.title, keywords: r.search.keywords, detail: "", body: "" }, namedTokens)) continue
        if (phrase && !(isFile ? r.search.body : `${r.search.title} ${r.search.detail} ${r.search.body}`).includes(phrase)) continue
        if (range && !(r.time && r.time >= range[0] && r.time < range[1])) continue
        if (isFile) {
          const path = r.detail || ""
          if (lookIn) {
            const parent = path.slice(0, path.lastIndexOf("\\")) || path
            if (subfolders ? !(path.startsWith(lookIn + "\\") || path === lookIn) : parent !== lookIn) continue
          }
          if (kind && !(kind === "folder" ? r.isDirectory : r.item?.type === kind || (kind === "text" && r.item?.type === "note"))) continue
          if (sizeMode && (r.isDirectory || (sizeMode === "atleast" ? r.size < sizeKb * 1024 : r.size > sizeKb * 1024))) continue
        }
        list.push({ ...r, group: g.type })
      }
    }
    setFound({ list, ms: performance.now() - started })
    setSelected(list[0]?.id || null)
    setTab((t) => (t === "all" || list.some((r) => r.group === t) ? t : "all"))
    setSearching(false)
  }

  // "See all results" from the Start menu
  useEffect(() => {
    const q = handoff?.query ?? firstQuery
    if (!q) return
    setNamed(q)
    setContaining("")
    setTab("all")
    run({ named: q, loose: true })
  }, [handoff?.id])

  const newSearch = () => {
    setNamed("")
    setContaining("")
    setLookIn("")
    setDateMode("all")
    setKind("")
    setSizeMode("")
    setFound(null)
    setNote(null)
    setCriteria("name")
    setTimeout(() => namedRef.current?.focus(), 0)
  }

  const counts = useMemo(() => {
    const c = { all: found?.list.length || 0 }
    for (const r of found?.list || []) c[r.group] = (c[r.group] || 0) + 1
    return c
  }, [found])
  const shown = (found?.list || []).filter((r) => tab === "all" || r.group === tab)
  const current = shown.find((r) => r.id === selected) || null

  const open = (r) => r && engine.current?.openResult(r, dispatch)

  const onKey = (e) => {
    if (!shown.length) return
    const i = shown.findIndex((r) => r.id === selected)
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      const next = shown[Math.max(0, Math.min(shown.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))]
      setSelected(next.id)
      e.currentTarget.querySelector(`[data-id="${CSS.escape(next.id)}"]`)?.scrollIntoView({ block: "nearest" })
    } else if (e.key === "Enter" && current) {
      e.preventDefault()
      open(current)
    }
  }

  const menus = [
    {
      label: "File",
      items: [
        { label: "Open", onClick: () => open(current), disabled: !current },
        "-",
        { label: "New Search", onClick: newSearch },
        { label: "Close", onClick: () => onClose?.() },
      ],
    },
    { label: "View", items: [{ label: "All", checked: tab === "all", onClick: () => setTab("all") }, ...SEARCH_TYPES.map((t) => ({ label: t.label, checked: tab === t.id, onClick: () => setTab(t.id), disabled: !counts[t.id] }))] },
    { label: "Help", items: [{ label: "About Find", onClick: () => setNote("Find looks through your programs, settings, files (their names and the words in them), contacts, calendar, messages, mail and photos. Only your own things: nobody else's on this device.") }] },
  ]

  return (
    <div className={`fnRoot${mobile ? " fnPhone" : ""}`}>
      {!mobile && <MenuBar menus={menus} />}
      <form
        className="fnTop"
        onSubmit={(e) => {
          e.preventDefault()
          run()
        }}
      >
        <div className="fnCriteria">
          <menu role="tablist" className="fnTabs">
            {CRITERIA.map(([id, label]) => (
              <li key={id} role="tab" aria-selected={criteria === id}>
                <a href="#" onClick={(e) => (e.preventDefault(), setCriteria(id))}>
                  {label}
                </a>
              </li>
            ))}
          </menu>
          <div className="window fnPanel" role="tabpanel">
            {criteria === "name" && (
              <div className="fnRows">
                <label htmlFor="fn-named">Named:</label>
                <input id="fn-named" ref={namedRef} type="search" value={named} autoComplete="off" onChange={(e) => setNamed(e.target.value)} autoFocus={!mobile} />
                <label htmlFor="fn-containing">Containing text:</label>
                <input id="fn-containing" type="search" value={containing} autoComplete="off" onChange={(e) => setContaining(e.target.value)} />
                <label htmlFor="fn-lookin">Look in:</label>
                <select id="fn-lookin" value={lookIn} onChange={(e) => setLookIn(e.target.value)}>
                  {LOOK_IN.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
                <span />
                <span className="fnCheck">
                  <input id="fn-sub" type="checkbox" checked={subfolders} disabled={!lookIn} onChange={(e) => setSubfolders(e.target.checked)} />
                  <label htmlFor="fn-sub">Include subfolders</label>
                </span>
              </div>
            )}
            {criteria === "date" && (
              <div className="fnDate">
                <div className="fnRadio">
                  <input id="fn-d-all" type="radio" name="fn-date" checked={dateMode === "all"} onChange={() => setDateMode("all")} />
                  <label htmlFor="fn-d-all">All files</label>
                </div>
                <div className="fnRadio">
                  <input id="fn-d-between" type="radio" name="fn-date" checked={dateMode === "between"} onChange={() => setDateMode("between")} />
                  <label htmlFor="fn-d-between">Find all files changed or happening between</label>
                </div>
                <div className="fnIndent">
                  <input type="date" aria-label="From" value={from} onChange={(e) => (setFrom(e.target.value), setDateMode("between"))} /> and{" "}
                  <input type="date" aria-label="To" value={to} onChange={(e) => (setTo(e.target.value), setDateMode("between"))} />
                </div>
                <div className="fnRadio">
                  <input id="fn-d-months" type="radio" name="fn-date" checked={dateMode === "months"} onChange={() => setDateMode("months")} />
                  <label htmlFor="fn-d-months">during the previous</label>
                  <input type="number" min="1" max="120" aria-label="Months" value={months} onChange={(e) => (setMonths(Number(e.target.value) || 1), setDateMode("months"))} /> month(s)
                </div>
                <div className="fnRadio">
                  <input id="fn-d-days" type="radio" name="fn-date" checked={dateMode === "days"} onChange={() => setDateMode("days")} />
                  <label htmlFor="fn-d-days">during the previous</label>
                  <input type="number" min="1" max="999" aria-label="Days" value={days} onChange={(e) => (setDays(Number(e.target.value) || 1), setDateMode("days"))} /> day(s)
                </div>
                <p className="fnHint">Files are dated from when 98ish first saw them change; events by when they happen; mail and messages by when they were sent.</p>
              </div>
            )}
            {criteria === "advanced" && (
              <div className="fnRows">
                <label htmlFor="fn-kind">Of type:</label>
                <select id="fn-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
                  {KINDS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
                <label htmlFor="fn-size">Size is:</label>
                <span className="fnSize">
                  <select id="fn-size" value={sizeMode} onChange={(e) => setSizeMode(e.target.value)}>
                    <option value="">(any size)</option>
                    <option value="atleast">At least</option>
                    <option value="atmost">At most</option>
                  </select>
                  <input type="number" min="0" aria-label="Size in KB" value={sizeKb} disabled={!sizeMode} onChange={(e) => setSizeKb(Math.max(0, Number(e.target.value) || 0))} /> KB
                </span>
              </div>
            )}
          </div>
        </div>
        <div className="fnButtons">
          <button type="submit" className="fnDefault">
            Find Now
          </button>
          <button type="button" disabled>
            Stop
          </button>
          <button type="button" onClick={newSearch}>
            New Search
          </button>
          <img src="/assets/program_icons/find.svg" alt="" className={`fnGlass${searching ? " is-searching" : ""}`} draggable="false" />
        </div>
      </form>
      {note && <p className="fnNote">{note}</p>}
      {found && (
        <>
          <menu role="tablist" className="fnTabs fnTypeTabs">
            {[{ id: "all", label: "All" }, ...SEARCH_TYPES].filter((t) => t.id === "all" || counts[t.id]).map((t) => (
              <li key={t.id} role="tab" aria-selected={tab === t.id}>
                <a href="#" onClick={(e) => (e.preventDefault(), setTab(t.id))}>
                  {t.id === "all" ? "All" : t.label} ({counts[t.id] || 0})
                </a>
              </li>
            ))}
          </menu>
          <div className="fnResults" role="listbox" aria-label="Results" tabIndex={0} onKeyDown={onKey}>
            {!mobile && (
              <div className="fnHead" aria-hidden="true">
                <span>Name</span>
                <span>In Folder</span>
                <span>Size</span>
                <span>Type</span>
                <span>Modified</span>
              </div>
            )}
            {shown.map((r) => (
              <div
                key={r.id}
                data-id={r.id}
                role="option"
                aria-selected={r.id === selected}
                className={`fnRow${r.id === selected ? " is-selected" : ""}`}
                onClick={() => (mobile ? open(r) : setSelected(r.id))}
                onDoubleClick={() => open(r)}
                title={r.subtitle || r.title}
              >
                <span className="fnName">
                  <img src={r.icon} alt="" draggable="false" className={r.round ? "fnRound" : undefined} />
                  <span>{r.title}</span>
                </span>
                <span className="fnSub">{FILE_TYPES.includes(r.group) ? (r.detail || "").slice(0, (r.detail || "").lastIndexOf("\\")) || r.detail : r.subtitle}</span>
                {!mobile && <span>{FILE_TYPES.includes(r.group) && !r.isDirectory ? formatSize(r.size || 0) : ""}</span>}
                {!mobile && <span>{FILE_TYPES.includes(r.group) ? r.kind : typeLabel(r.group).replace(/s$/, "").replace("Files and Folder", "File")}</span>}
                {!mobile && <span>{when(r.time, r.allDay)}</span>}
              </div>
            ))}
            {!shown.length && <p className="fnEmpty">There are no items to show in this view.</p>}
          </div>
        </>
      )}
      <div className="status-bar fnStatus">
        <p className="status-bar-field">{found ? `${shown.length} item${shown.length === 1 ? "" : "s"} found` : "Enter your search criteria"}</p>
        {found && !mobile && <p className="status-bar-field">{found.ms < 1 ? "<1" : Math.round(found.ms)} ms</p>}
      </div>
    </div>
  )
}

export default Find
