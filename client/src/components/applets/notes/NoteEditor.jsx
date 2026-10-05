import React, { useEffect, useRef } from "react"
import { COLORS, COLOR_NAMES, PAPER, checkedToBottom, daysLeft, isTrashed, liveItems, removeChecked, uncheckAll } from "./notesCore"
import { setNoteColor, setNoteField, shareLabel, updateNote, useNotes } from "../../../utils/notes"
import Checklist from "./Checklist"
import MoreOptions from "../../shared/MoreOptions"

// One note, open for writing: a sticky-note sheet with its title, words and checklist.
// Everyday controls show; the rest (colors, checklist tidying, pin, share, delete) waits
// under More options. In the Recycle Bin it's read-only, with Restore.

export const Swatches = ({ value, onPick }) => (
  <div className="ntSwatches" role="radiogroup" aria-label="Color">
    {COLORS.map((c) => (
      <button key={c} type="button" role="radio" aria-checked={value === c} aria-label={COLOR_NAMES[c]} title={COLOR_NAMES[c]} className={`ntSwatch${value === c ? " is-on" : ""}`} style={{ background: PAPER[c].paper, borderColor: PAPER[c].edge }} onClick={() => onPick(c)} />
    ))}
  </div>
)

// a textarea that grows with its words
const Grow = ({ value, onChange, ...rest }) => {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.max(80, el.scrollHeight + 2)}px`
  }, [value])
  return <textarea ref={ref} value={value} onChange={onChange} {...rest} />
}

const NoteEditor = ({ note, mobile, onBack, onAction, autoFocus }) => {
  const state = useNotes()
  const share = state.share[note.id]
  const trashed = isTrashed(note)
  const color = note.color?.v || "yellow"
  const items = liveItems(note)
  const doneCount = items.filter((i) => i.done).length
  const pinned = state.pinned.has(note.id)
  const titleRef = useRef(null)
  useEffect(() => {
    if (autoFocus && !trashed) titleRef.current?.focus({ preventScroll: true })
  }, [note.id])

  const where = !state.account && !state.signedOn ? "Only on this device" : state.rejected[note.id] ? `Not synced: ${state.rejected[note.id]}` : state.signedOn ? (state.sync === "error" ? "Saved here; will sync later" : "Saved and synced") : "Saved here; syncs when you sign on"
  const summary = [COLOR_NAMES[color], pinned ? "Pinned to desktop" : null, share ? shareLabel(share, state.account) : null].filter(Boolean).join(" · ")

  return (
    <section className={`ntEditor${mobile ? " is-phone" : ""}`} style={{ "--nt-paper": PAPER[color].paper, "--nt-edge": PAPER[color].edge }} aria-label="Note">
      <div className="ntSheetBar">
        {mobile && (
          <button type="button" className="ntBack" onClick={onBack}>
            ‹ Notes
          </button>
        )}
        {share && (
          <span className="ntBadge" title={share.members.map((m) => m.name).join(", ")}>
            {shareLabel(share, state.account)}
          </span>
        )}
        {pinned && !trashed && <span className="ntBadge ntBadge--pin">Pinned</span>}
        <span className="ntSheetSpacer" />
        {!trashed && (
          <button type="button" className="ntBarBtn" onClick={() => onAction("share", note)} title="Share with a buddy">
            Share...
          </button>
        )}
      </div>

      {trashed ? (
        <div className="ntTrashBar" role="status">
          In the Recycle Bin: deleted for good in {daysLeft(note)} day{daysLeft(note) === 1 ? "" : "s"}.
          <button type="button" onClick={() => onAction("restore", note)}>
            Restore
          </button>
          <button type="button" onClick={() => onAction("purge", note)}>
            Delete Now
          </button>
        </div>
      ) : null}

      <div className="ntSheet">
        <input ref={titleRef} className="ntTitle" type="text" value={note.title?.v || ""} placeholder="Title" aria-label="Title" maxLength={120} readOnly={trashed} onChange={(e) => setNoteField(note.id, "title", e.target.value)} />
        <Grow className="ntBody" value={note.body?.v || ""} placeholder={items.length ? "Notes" : "Take a note..."} aria-label="Note" maxLength={16000} readOnly={trashed} onChange={(e) => setNoteField(note.id, "body", e.target.value)} />
        <Checklist note={note} readOnly={trashed} />
      </div>

      {!trashed && (
        <MoreOptions id="notes.note" className="ntMore" summary={summary}>
          <div className="ntMoreRow">
            <span className="ntMoreLabel">Color:</span>
            <Swatches value={color} onPick={(c) => setNoteColor(note.id, c)} />
          </div>
          {items.length > 0 && (
            <div className="ntMoreRow">
              <button type="button" disabled={!doneCount} onClick={() => updateNote(note.id, (n, now) => checkedToBottom(n, now))}>
                Move checked to bottom
              </button>
              <button type="button" disabled={!doneCount} onClick={() => updateNote(note.id, (n, now) => uncheckAll(n, now))}>
                Uncheck all
              </button>
              <button type="button" disabled={!doneCount} onClick={() => updateNote(note.id, (n, now) => removeChecked(n, now))}>
                Remove checked
              </button>
            </div>
          )}
          <div className="ntMoreRow">
            <button type="button" onClick={() => onAction(pinned ? "unpin" : "pin", note)}>
              {pinned ? "Unpin from desktop" : "Pin to desktop"}
            </button>
            <button type="button" onClick={() => onAction("share", note)}>
              {share ? "Sharing..." : "Share with a buddy..."}
            </button>
            <button type="button" onClick={() => onAction("delete", note)}>
              {share ? "Leave and delete..." : "Delete"}
            </button>
          </div>
        </MoreOptions>
      )}
      <p className="ntWhere" role="status">
        {where}
      </p>
    </section>
  )
}

export default NoteEditor
