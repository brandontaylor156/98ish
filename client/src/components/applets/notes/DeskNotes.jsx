import React, { useEffect, useState } from "react"
import { Rnd } from "react-rnd"
import ContextMenu from "../../shared/ContextMenu"
import { useLongPress } from "../../../hooks/useLongPress"
import { launch } from "../../../utils/programs"
import { getNote, moveDesk, setNoteColor, setNoteField, shareLabel, unpin, useNotes } from "../../../utils/notes"
import { COLORS, COLOR_NAMES, PAPER, liveItems, noteTitle, progress } from "./notesCore"
import Checklist from "./Checklist"
import "./Notes.css"

// Notes pinned to the desktop (this device only: utils/notes.js `desk`). On a computer each
// is a sticky note on the wallpaper, under every window: drag it by its top strip, resize it
// from the corner, type straight into it, tick its checklist; right-click for its menu,
// double-click the strip to open it in Notes. On a phone they're listed in a small "Notes"
// panel in the corner instead (tap one to open it).

const W = 210
const H = 210
const PANEL_KEY = "98ish.notes.panel"

const openInNotes = (dispatch, id) => dispatch({ type: "open_window", payload: launch("Notes", { handoff: { id: Date.now(), note: id } }) })

const Sticky = ({ note, rect, index, dispatch, share, me, onMenu }) => {
  const color = note.color?.v || "yellow"
  const [size, setSize] = useState({ width: rect.w || W, height: rect.h || H })
  const auto = rect.x === null || rect.x === undefined
  const vw = typeof window === "undefined" ? 1024 : document.documentElement.clientWidth
  const pos = auto ? { x: Math.max(8, vw - (rect.w || W) - 24 - (index % 5) * 28), y: 12 + (index % 5) * 28 } : { x: rect.x, y: rect.y }
  useEffect(() => setSize({ width: rect.w || W, height: rect.h || H }), [rect.w, rect.h])
  const items = liveItems(note)
  return (
    <Rnd
      className="deskNoteWrap"
      position={pos}
      size={size}
      minWidth={140}
      minHeight={100}
      bounds="parent"
      dragHandleClassName="deskNoteBar"
      cancel=".deskNoteBtn"
      enableResizing={{ bottomRight: true, right: true, bottom: true }}
      onDragStop={(e, d) => moveDesk(note.id, { x: Math.round(d.x), y: Math.round(d.y) })}
      onResizeStop={(e, dir, ref, delta, p) => {
        setSize({ width: ref.offsetWidth, height: ref.offsetHeight })
        moveDesk(note.id, { w: ref.offsetWidth, h: ref.offsetHeight, x: Math.round(p.x), y: Math.round(p.y) })
      }}
    >
      <div
        className="deskNote"
        data-desk-note={note.id}
        style={{ "--nt-paper": PAPER[color].paper, "--nt-edge": PAPER[color].edge, width: "100%", height: "100%" }}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => {
          if (e.target.closest("textarea, input")) return e.stopPropagation()
          e.preventDefault()
          e.stopPropagation()
          onMenu(note, e.clientX, e.clientY)
        }}
      >
        <div className="deskNoteBar" title={share ? shareLabel(share, me) : "Drag to move. Double-click to open in Notes."} onDoubleClick={() => openInNotes(dispatch, note.id)}>
          <span className="deskNoteTitle">{noteTitle(note)}</span>
          <button
            type="button"
            className="deskNoteBtn"
            aria-label="Note menu"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              onMenu(note, r.left, r.bottom)
            }}
          >
            ▾
          </button>
          <button type="button" className="deskNoteBtn" aria-label="Unpin from desktop" title="Unpin from desktop" onClick={() => unpin(note.id)}>
            ×
          </button>
        </div>
        <div className="deskNoteBody">
          {(note.body?.v || !items.length) && <textarea className="deskNoteText" value={note.body?.v || ""} placeholder="Take a note..." aria-label={`${noteTitle(note)}: note`} onChange={(e) => setNoteField(note.id, "body", e.target.value)} />}
          {items.length > 0 && <Checklist note={note} compact />}
        </div>
      </div>
    </Rnd>
  )
}

const PanelItem = ({ note, onOpen, onMenu }) => {
  const color = note.color?.v || "yellow"
  const longPress = useLongPress((x, y) => onMenu(note, x, y))
  const p = progress(note)
  const line = (note.body?.v || "").split("\n").find((l) => l.trim()) || liveItems(note).filter((i) => !i.done).slice(0, 3).map((i) => `☐ ${i.text}`).join("  ")
  return (
    <li>
      <button type="button" className="deskNotesItem" style={{ background: PAPER[color].paper, borderColor: PAPER[color].edge }} onClick={() => onOpen(note.id)} {...longPress}>
        <b>
          {noteTitle(note)}
          {p.total ? ` (${p.done}/${p.total})` : ""}
        </b>
        {line && <span>{line}</span>}
      </button>
    </li>
  )
}

const DeskNotes = ({ dispatch, mobile }) => {
  const state = useNotes()
  const [menu, setMenu] = useState(null)
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(PANEL_KEY) === "open"
    } catch {
      return false
    }
  })
  const pinned = [...state.pinned].map((id) => getNote(id)).filter(Boolean)
  if (!pinned.length) return null

  const menuFor = (note) => [
    { label: "Open in Notes", bold: true, onClick: () => openInNotes(dispatch, note.id) },
    { label: "Color", items: COLORS.map((c) => ({ label: COLOR_NAMES[c], checked: note.color?.v === c, onClick: () => setNoteColor(note.id, c) })) },
    { label: "Unpin from Desktop", onClick: () => unpin(note.id) },
  ]
  const showMenu = (note, x, y) => setMenu({ x, y, items: menuFor(note) })
  const contextMenu = menu && <ContextMenu items={menu.items} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />

  if (mobile) {
    const toggle = () => {
      setOpen(!open)
      try {
        localStorage.setItem(PANEL_KEY, open ? "closed" : "open")
      } catch {
        // ignore
      }
    }
    return (
      <div className="deskNotesPanel" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="deskNotesPill" aria-expanded={open} onClick={toggle}>
          <img src="/assets/program_icons/notes.svg" alt="" width="16" height="16" style={{ verticalAlign: "-3px", marginRight: 4 }} />
          Notes · {pinned.length}
        </button>
        {open && (
          <div className="deskNotesSheet" role="region" aria-label="Pinned notes">
            <div className="deskNotesHead">
              <span>Pinned notes</span>
              <span>
                <button type="button" onClick={() => dispatch({ type: "open_window", payload: launch("Notes") })}>
                  Open Notes
                </button>{" "}
                <button type="button" aria-label="Close" onClick={toggle}>
                  ×
                </button>
              </span>
            </div>
            <ul className="deskNotesList">
              {pinned.map((n) => (
                <PanelItem key={n.id} note={n} onOpen={(id) => openInNotes(dispatch, id)} onMenu={showMenu} />
              ))}
            </ul>
          </div>
        )}
        {contextMenu}
      </div>
    )
  }

  return (
    <>
      {pinned.map((n, i) => (
        <Sticky key={n.id} note={n} rect={state.desk[n.id] || {}} index={i} dispatch={dispatch} share={state.share[n.id]} me={state.account} onMenu={showMenu} />
      ))}
      {contextMenu}
    </>
  )
}

export default DeskNotes
