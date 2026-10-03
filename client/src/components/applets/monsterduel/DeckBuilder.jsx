import React, { useMemo, useState } from "react"
import { Card, MiniCard } from "./Card"
import { ATTRS, CARD, POOL, RARITY_NAMES, THEMES, themeOf } from "./engine/cards"
import { DECK_MAX, DECK_MIN, EXTRA_MAX, STARTERS, countIds, limitOf, validateDeck } from "./engine/decks"
import { deleteDeck, owned, saveDeck, update } from "./storage"

// Monster Duel's deck builder: your decks on the left; pick one (or start a new deck, or
// copy a starter) and add cards from your collection with filters and search. A deck
// needs 30 to 60 cards, at most 3 copies of a card (limited cards: 1), and only cards you
// own. Saved in this browser.

const KINDS = [
  ["all", "All"],
  ["monster", "Monsters"],
  ["spell", "Spells"],
  ["trap", "Traps"],
  ["fusion", "Fusion"],
]
const SORTS = [
  ["type", "Type"],
  ["name", "Name"],
  ["atk", "ATK"],
  ["level", "Level"],
  ["rarity", "Rarity"],
]
const KIND_ORDER = { monster: 0, spell: 1, trap: 2 }
const RARITY_ORDER = { UR: 0, SR: 1, R: 2, C: 3 }
const RACES = [...new Set(POOL.filter((c) => c.kind === "monster").map((c) => c.race))].sort()

const byType = (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (a.sub === "fusion") - (b.sub === "fusion") || (b.level || 0) - (a.level || 0) || a.name.localeCompare(b.name)

const DeckBuilder = ({ data, setData, mobile, onBack }) => {
  const [editing, setEditing] = useState(null) // { id?, name, main, extra }
  const [tab, setTab] = useState("cards")
  const [filters, setFilters] = useState({ q: "", kind: "all", attr: "", race: "", theme: "", sort: "type", mine: true })
  const [inspect, setInspect] = useState(null)
  const [message, setMessage] = useState(null)
  const [zoom, setZoom] = useState(null)

  const set = (patch) => setFilters((f) => ({ ...f, ...patch }))

  const list = useMemo(() => {
    const q = filters.q.trim().toLowerCase()
    let cards = POOL.filter((c) => {
      if (filters.kind === "fusion" ? c.sub !== "fusion" : filters.kind !== "all" && (c.kind !== filters.kind || c.sub === "fusion")) return false
      if (filters.attr && c.attr !== filters.attr) return false
      if (filters.race && c.race !== filters.race) return false
      if (filters.theme && themeOf(c.id) !== filters.theme) return false
      if (filters.mine && !owned(data, c.id)) return false
      if (q && !`${c.name} ${c.text} ${c.race || ""} ${c.attr || ""}`.toLowerCase().includes(q)) return false
      return true
    })
    const sorts = {
      type: byType,
      name: (a, b) => a.name.localeCompare(b.name),
      atk: (a, b) => (b.atk ?? -1) - (a.atk ?? -1) || a.name.localeCompare(b.name),
      level: (a, b) => (b.level ?? 0) - (a.level ?? 0) || a.name.localeCompare(b.name),
      rarity: (a, b) => RARITY_ORDER[a.rarity] - RARITY_ORDER[b.rarity] || byType(a, b),
    }
    return cards.sort(sorts[filters.sort] || byType)
  }, [filters, data])

  const counts = editing ? countIds([...editing.main, ...editing.extra]) : {}
  const check = editing ? validateDeck(editing) : null
  const lacking = editing ? Object.entries(counts).filter(([id, n]) => n > owned(data, id)) : []
  const problem = !editing ? null : check.error || (lacking.length ? `You don't own enough copies of "${CARD[lacking[0][0]].name}".` : null)

  const add = (id) => {
    if (!editing) return
    const c = CARD[id]
    const have = counts[id] || 0
    if (have >= limitOf(id)) return setMessage(limitOf(id) === 1 ? `"${c.name}" is limited to 1 copy.` : `At most ${limitOf(id)} copies of a card.`)
    if (have >= owned(data, id)) return setMessage(`You only own ${owned(data, id)} cop${owned(data, id) === 1 ? "y" : "ies"} of "${c.name}". Open packs for more!`)
    if (c.extra) {
      if (editing.extra.length >= EXTRA_MAX) return setMessage(`The Extra Deck holds ${EXTRA_MAX} cards.`)
      setEditing({ ...editing, extra: [...editing.extra, id] })
    } else {
      if (editing.main.length >= DECK_MAX) return setMessage(`A deck holds at most ${DECK_MAX} cards.`)
      setEditing({ ...editing, main: [...editing.main, id] })
    }
    setMessage(null)
  }
  const remove = (id) => {
    if (!editing) return
    const from = CARD[id].extra ? "extra" : "main"
    const i = editing[from].lastIndexOf(id)
    if (i < 0) return
    const next = [...editing[from]]
    next.splice(i, 1)
    setEditing({ ...editing, [from]: next })
  }

  const save = () => {
    if (problem) return setMessage(problem)
    const id = editing.id || `deck${Date.now().toString(36)}`
    setData(saveDeck({ ...editing, id }))
    setEditing({ ...editing, id })
    setMessage(`Saved "${editing.name}".`)
  }

  // ---------- picking a deck ----------

  if (!editing) {
    return (
      <div className="mdPage mdBuilder is-list">
        <div className="mdPageHead">
          <h2>Deck Builder</h2>
          <div className="mdPageBtns">
            <button type="button" onClick={onBack}>
              Back
            </button>
          </div>
        </div>
        <div className="mdDeckMenu">
          <section>
            <h3>Your decks</h3>
            {data.decks.length === 0 && <p className="mdMuted">No decks yet. Start a new one, or copy a starter deck and change it.</p>}
            <div className="mdDeckTiles">
              <button type="button" className="mdDeckTile is-new" onClick={() => setEditing({ name: `My Deck ${data.decks.length + 1}`, main: [], extra: [] })} data-new-deck>
                <b>+ New Deck</b>
                <small>Start from nothing</small>
              </button>
              {data.decks.map((d) => {
                const v = validateDeck(d)
                const icon = d.main.find((id) => CARD[id]?.kind === "monster")
                return (
                  <div key={d.id} className="mdDeckTile">
                    <button type="button" className="mdDeckTileMain" onClick={() => setEditing({ ...d })} data-deck-id={d.id}>
                      {icon && <MiniCard id={icon} />}
                      <b>{d.name}</b>
                      <small className={v.error ? "mdError" : ""}>{v.error ? "Not ready" : `${d.main.length} cards`}</small>
                    </button>
                    <button type="button" className="mdDeckTileX" title="Delete" aria-label={`Delete ${d.name}`} onClick={() => setData(deleteDeck(d.id))}>
                      ×
                    </button>
                  </div>
                )
              })}
            </div>
          </section>
          <section>
            <h3>Copy a starter deck</h3>
            <div className="mdDeckTiles">
              {STARTERS.map((s) => (
                <button key={s.id} type="button" className="mdDeckTile is-starter" style={{ "--deck": s.color }} onClick={() => setEditing({ name: `${s.name} (copy)`, main: [...s.main], extra: [...s.extra] })} data-copy={s.id}>
                  <MiniCard id={s.icon} />
                  <b>{s.name}</b>
                  <small>{s.blurb}</small>
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    )
  }

  // ---------- editing ----------

  const groups = [
    ["Monsters", editing.main.filter((id) => CARD[id].kind === "monster")],
    ["Spells", editing.main.filter((id) => CARD[id].kind === "spell")],
    ["Traps", editing.main.filter((id) => CARD[id].kind === "trap")],
    ["Extra Deck", editing.extra],
  ]
  const show = (id) => (mobile ? setZoom(id) : setInspect(id))

  const deckPanel = (
    <div className="mdDeckPanel">
      {groups.map(([title, ids]) => {
        const c = countIds(ids)
        const uniq = Object.keys(c).sort((a, b) => byType(CARD[a], CARD[b]))
        return (
          <div key={title} className="mdDeckGroup">
            <h4>
              {title} <span>{ids.length}</span>
            </h4>
            {uniq.map((id) => (
              <div key={id} className="mdDeckRow" onPointerEnter={() => setInspect(id)}>
                <span className={`mdDeckRowDot is-${CARD[id].kind === "monster" ? (CARD[id].sub === "fusion" ? "fusion" : CARD[id].sub) : CARD[id].kind}`} />
                <button type="button" className="mdDeckRowName" onClick={() => show(id)}>
                  {CARD[id].name}
                </button>
                <span className="mdDeckRowN">x{c[id]}</span>
                <button type="button" className="mdTiny" onClick={() => remove(id)} aria-label={`Remove ${CARD[id].name}`} data-remove={id}>
                  -
                </button>
                <button type="button" className="mdTiny" onClick={() => add(id)} aria-label={`Add ${CARD[id].name}`}>
                  +
                </button>
              </div>
            ))}
          </div>
        )
      })}
      {!editing.main.length && <p className="mdMuted">Click cards in your collection to add them.</p>}
    </div>
  )

  const grid = (
    <div className="mdCollection">
      <div className="mdFilters">
        <input type="search" placeholder="Search names and text" value={filters.q} onChange={(e) => set({ q: e.target.value })} aria-label="Search" data-search />
        <select value={filters.kind} onChange={(e) => set({ kind: e.target.value })} aria-label="Card kind" data-filter="kind">
          {KINDS.map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        <select value={filters.attr} onChange={(e) => set({ attr: e.target.value })} aria-label="Attribute">
          <option value="">Any attribute</option>
          {ATTRS.map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
        <select value={filters.race} onChange={(e) => set({ race: e.target.value })} aria-label="Type">
          <option value="">Any type</option>
          {RACES.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
        <select value={filters.theme} onChange={(e) => set({ theme: e.target.value })} aria-label="Theme">
          <option value="">Any theme</option>
          {THEMES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select value={filters.sort} onChange={(e) => set({ sort: e.target.value })} aria-label="Sort by">
          {SORTS.map(([k, label]) => (
            <option key={k} value={k}>
              Sort: {label}
            </option>
          ))}
        </select>
        <span className="mdCheck">
          <input type="checkbox" id="md-owned" checked={filters.mine} onChange={(e) => set({ mine: e.target.checked })} />
          <label htmlFor="md-owned">Owned only</label>
        </span>
      </div>
      <div className="mdGrid" role="list">
        {list.map((c) => {
          const own = owned(data, c.id)
          const inDeck = counts[c.id] || 0
          const fresh = data.fresh.includes(c.id)
          return (
            <div key={c.id} role="listitem" className={`mdGridCard${own ? "" : " is-missing"}${inDeck ? " is-in" : ""}`} onPointerEnter={() => setInspect(c.id)} data-card-id={c.id}>
              <button type="button" className="mdGridAdd" onClick={() => add(c.id)} onContextMenu={(e) => (e.preventDefault(), remove(c.id))} title={`${c.name} (click to add, right-click to remove)`}>
                <MiniCard id={c.id} />
              </button>
              <div className="mdGridMeta">
                <span className={`mdRarity is-${c.rarity}`} title={RARITY_NAMES[c.rarity]}>
                  {c.rarity}
                </span>
                <span>
                  {inDeck}/{Math.min(own, limitOf(c.id))}
                </span>
                {mobile && (
                  <button type="button" className="mdTiny" onClick={() => setZoom(c.id)} aria-label="View card">
                    ?
                  </button>
                )}
              </div>
              {fresh && <span className="mdNew">NEW</span>}
              {c.limit === 1 && <span className="mdLimited">1</span>}
            </div>
          )
        })}
        {!list.length && <p className="mdMuted">No cards match. {filters.mine ? "Untick Owned only to see every card." : ""}</p>}
      </div>
    </div>
  )

  return (
    <div className={`mdPage mdBuilder is-edit${mobile ? " is-mobile" : ""}`}>
      <div className="mdBuilderHead">
        <input className="mdDeckName" value={editing.name} maxLength={40} onChange={(e) => setEditing({ ...editing, name: e.target.value })} aria-label="Deck name" data-deck-name />
        <span className={`mdDeckCount${problem ? " is-bad" : " is-good"}`} data-count={editing.main.length}>
          {editing.main.length} cards{editing.extra.length ? ` + ${editing.extra.length} Extra` : ""}
        </span>
        <span className="mdDeckCheck">{problem ? problem : "Ready to duel!"}</span>
        <div className="mdPageBtns">
          <button type="button" onClick={save} className="mdPrimaryBtn" data-save>
            Save
          </button>
          <button
            type="button"
            onClick={() => {
              setData(update((x) => ({ ...x, fresh: [] })))
              setEditing(null)
              setMessage(null)
            }}
            data-done
          >
            Done
          </button>
        </div>
      </div>
      {message && <div className="mdNote">{message}</div>}
      {mobile && (
        <div className="mdTabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "cards"} className={tab === "cards" ? "is-on" : ""} onClick={() => setTab("cards")}>
            Collection
          </button>
          <button type="button" role="tab" aria-selected={tab === "deck"} className={tab === "deck" ? "is-on" : ""} onClick={() => setTab("deck")} data-tab="deck">
            Deck ({editing.main.length}
            {editing.extra.length ? `+${editing.extra.length}` : ""})
          </button>
        </div>
      )}
      <div className="mdBuilderBody">
        {(!mobile || tab === "cards") && grid}
        {(!mobile || tab === "deck") && (
          <aside className="mdBuilderSide">
            {!mobile && <div className="mdBuilderCard">{inspect ? <Card id={inspect} /> : null}</div>}
            {deckPanel}
          </aside>
        )}
      </div>
      {zoom && (
        <div className="mdZoomPage" onClick={() => setZoom(null)}>
          <Card id={zoom} />
          <div className="mdZoomBtns" onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => add(zoom)}>
              Add
            </button>
            <button type="button" onClick={() => remove(zoom)}>
              Remove
            </button>
            <button type="button" onClick={() => setZoom(null)}>
              Close
            </button>
          </div>
        </div>
      )}
      <p className="mdBuilderFoot mdMuted">
        Decks need {DECK_MIN} to {DECK_MAX} cards. At most 3 copies of a card; cards marked 1 are limited to one copy.
      </p>
    </div>
  )
}

export default DeckBuilder
