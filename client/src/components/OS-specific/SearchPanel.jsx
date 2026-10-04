import React, { useEffect, useMemo, useRef, useState } from "react"
import { launch } from "../../utils/programs"
import "./SearchPanel.css"

// The Start menu's search results: what matches, grouped (Programs, Settings, Files, Contacts,
// Calendar, Messages, Mail, Photos, Help Topics), best first. Arrow keys move through them from the search
// box, Enter opens one (the first if none is picked), "See all results" opens Find with a tab
// per kind. On phones it fills the screen under the search box. The searching itself
// (utils/search.js) loads with the first letter typed.

const PER_TYPE = { programs: 4, settings: 3, files: 5, contacts: 3, events: 3, messages: 3, mail: 3, photos: 3, help: 3 }
const PER_TYPE_PHONE = { programs: 5, settings: 4, files: 6, contacts: 4, events: 4, messages: 4, mail: 4, photos: 4, help: 4 }

let engine = null
const loadEngine = () => (engine ??= import("../../utils/search"))

const SearchPanel = ({ query, dispatch, closeMenu, keysRef, mobile }) => {
  const [search, setSearch] = useState(null) // the loaded module
  const [found, setFound] = useState({ groups: [], ms: 0 })
  const [active, setActive] = useState(0)
  const listRef = useRef(null)

  useEffect(() => {
    let live = true
    loadEngine().then((m) => live && setSearch(m))
    return () => {
      live = false
    }
  }, [])

  // a moment after the last key, so fast typing doesn't search every letter
  useEffect(() => {
    if (!search) return
    const limits = mobile ? PER_TYPE_PHONE : PER_TYPE
    const run = () => {
      const result = search.searchAll(query)
      setFound({ ...result, groups: result.groups.map((g) => ({ ...g, shown: g.results.slice(0, limits[g.type] || 3) })) })
      setActive(0)
    }
    const timer = setTimeout(run, found.groups.length ? 60 : 0)
    return () => clearTimeout(timer)
  }, [query, search])

  const flat = useMemo(() => found.groups.flatMap((g) => g.shown), [found])
  const total = found.groups.reduce((n, g) => n + g.total, 0)

  const open = (result) => {
    if (!result || !search) return
    closeMenu()
    search.openResult(result, dispatch)
  }
  const seeAll = () => {
    closeMenu()
    dispatch({ type: "open_window", payload: launch("Find", { query, handoff: { id: Date.now(), query } }) })
  }

  // keys from the search box (it keeps the focus)
  keysRef.current = (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      if (!flat.length) return true
      const next = (active + (e.key === "ArrowDown" ? 1 : -1) + flat.length + 1) % (flat.length + 1) // the last stop is "See all"
      setActive(next)
      listRef.current?.querySelector(`[data-sr="${next}"]`)?.scrollIntoView({ block: "nearest" })
      return true
    }
    if (e.key === "Enter") {
      e.preventDefault()
      if (active === flat.length || !flat.length) seeAll()
      else open(flat[active])
      return true
    }
    return false
  }
  useEffect(() => () => (keysRef.current = null), [])

  let n = -1
  return (
    <div id="srResults" className={`window liveSearch srPanel${mobile ? " srPhone" : ""}`} ref={listRef} onClick={(e) => e.stopPropagation()} role="listbox" aria-label="Search results">
      {!search && <p className="srEmpty">Searching...</p>}
      {search && !flat.length && (
        <p className="srEmpty">
          No results for <b>{query}</b>.
        </p>
      )}
      {found.groups.map((g) => (
        <section key={g.type} className="srGroup" aria-label={g.label}>
          <h3 className="srHead">
            <span>{g.label}</span>
            {g.total > g.shown.length && <span className="srCount">{g.total}</span>}
          </h3>
          {g.shown.map((r) => {
            n++
            const i = n
            return (
              <div
                key={r.id}
                data-sr={i}
                role="option"
                aria-selected={i === active}
                className={`srItem liveSearchItem${i === active ? " is-active" : ""}`}
                title={r.detail || r.subtitle || r.title}
                onMouseEnter={(e) => e.nativeEvent.pointerType !== "touch" && setActive(i)}
                onClick={() => open(r)}
              >
                <img src={r.icon} alt="" draggable="false" className={r.round ? "srRound" : undefined} />
                <p className="srTitle">{r.title}</p>
                <span className="srSub">{r.subtitle}</span>
              </div>
            )
          })}
        </section>
      ))}
      {search && (
        <button type="button" data-sr={flat.length} className={`srAll${active === flat.length && flat.length ? " is-active" : ""}`} onClick={seeAll}>
          <img src="/assets/program_icons/find.svg" alt="" draggable="false" />
          {flat.length ? `See all results (${total})` : "Search with Find..."}
          {!mobile && found.ms > 0 && <span className="srMs">{found.ms < 1 ? "<1" : Math.round(found.ms)} ms</span>}
        </button>
      )}
    </div>
  )
}

export default SearchPanel
