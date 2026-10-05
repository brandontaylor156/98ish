import React, { useEffect, useId, useRef, useState } from "react"
import { addItem, editItem, liveItems, moveItem, removeItem } from "./notesCore"
import { updateNote } from "../../../utils/notes"
import "./Notes.css"

// A note's checklist: tap the box to tick, type to change, Enter for a new item after this
// one, Backspace in an empty item removes it, drag the grip (mouse or finger) to reorder,
// Alt+Up/Down moves an item from the keyboard. `compact` (the sticky notes on the desktop):
// ticking only, no editing.

const Grip = () => (
  <svg width="8" height="14" viewBox="0 0 8 14" aria-hidden="true">
    {[1, 5, 9].map((y) => (
      <g key={y} fill="#606060">
        <rect x="1" y={y} width="2" height="2" />
        <rect x="5" y={y} width="2" height="2" />
      </g>
    ))}
  </svg>
)

// a 98-style check box (98.css draws the box on the label after the input)
export const Tick = ({ checked, onChange, label, disabled, children }) => {
  const id = useId()
  return (
    <span className="ntTickWrap">
      <input id={id} type="checkbox" className="ntTick" checked={!!checked} disabled={disabled} aria-label={label} onChange={(e) => onChange(e.target.checked)} />
      <label htmlFor={id} className="ntTickLabel">
        {children}
      </label>
    </span>
  )
}

const Checklist = ({ note, compact = false, readOnly = false }) => {
  const items = liveItems(note)
  const listRef = useRef(null)
  const [focusId, setFocusId] = useState(null)
  const [drag, setDrag] = useState(null) // { id, y0, dy, index, target }

  useEffect(() => {
    if (!focusId) return
    const input = listRef.current?.querySelector(`[data-item="${focusId}"] input[type=text]`)
    if (input) {
      input.focus({ preventScroll: false })
      const end = input.value.length
      input.setSelectionRange?.(end, end)
    }
    setFocusId(null)
  }, [focusId])

  const change = (fn) => updateNote(note.id, fn)
  const tick = (id, done) => change((n, now) => editItem(n, id, { done }, now))

  const onKeyDown = (e, item, index) => {
    if (e.key === "Enter") {
      e.preventDefault()
      let added = null
      change((n, now) => {
        const r = addItem(n, "", now, { afterId: item.id })
        added = r.id
        return r.note
      })
      setFocusId(added)
    } else if (e.key === "Backspace" && !e.currentTarget.value) {
      e.preventDefault()
      const prev = items[index - 1]
      change((n, now) => removeItem(n, item.id, now))
      if (prev) setFocusId(prev.id)
    } else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault()
      change((n, now) => moveItem(n, item.id, index + (e.key === "ArrowUp" ? -1 : 1), now))
      setFocusId(item.id)
    }
  }

  // ---- drag to reorder (pointer events: mouse and touch alike) ----
  const startDrag = (e, item, index) => {
    if (readOnly) return
    e.preventDefault()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    setDrag({ id: item.id, y0: e.clientY, dy: 0, index, target: index })
  }
  const moveDrag = (e) => {
    if (!drag) return
    const rows = [...(listRef.current?.querySelectorAll("[data-item]") || [])]
    const dy = e.clientY - drag.y0
    let target = drag.index
    rows.forEach((row, i) => {
      const r = row.getBoundingClientRect()
      const mid = r.top + r.height / 2
      if (i < drag.index && e.clientY < mid) target = Math.min(target, i)
      if (i > drag.index && e.clientY > mid) target = Math.max(target, i)
    })
    setDrag({ ...drag, dy, target })
  }
  const endDrag = () => {
    if (!drag) return
    if (drag.target !== drag.index) change((n, now) => moveItem(n, drag.id, drag.target, now))
    setDrag(null)
  }

  return (
    <ul className={`ntChecklist${compact ? " is-compact" : ""}`} ref={listRef} aria-label="Checklist">
      {items.map((item, index) => {
        const dragging = drag?.id === item.id
        const shift = drag && !dragging ? (drag.index < index && drag.target >= index ? -1 : drag.index > index && drag.target <= index ? 1 : 0) : 0
        return (
          <li
            key={item.id}
            data-item={item.id}
            className={`ntItem${item.done ? " is-done" : ""}${dragging ? " is-dragging" : ""}`}
            style={dragging ? { transform: `translateY(${drag.dy}px)` } : shift ? { transform: `translateY(${shift * 100}%)` } : undefined}
          >
            {!compact && !readOnly && (
              <span
                className="ntGrip"
                role="button"
                tabIndex={-1}
                aria-label={`Drag to move ${item.text || "item"}`}
                title="Drag to move (Alt+Up/Down)"
                onPointerDown={(e) => startDrag(e, item, index)}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={() => setDrag(null)}
              >
                <Grip />
              </span>
            )}
            {compact || readOnly ? (
              <Tick checked={item.done} label={`Done: ${item.text || "item"}`} disabled={readOnly} onChange={(done) => tick(item.id, done)}>
                <span className="ntItemText">{item.text || " "}</span>
              </Tick>
            ) : (
              <Tick checked={item.done} label={`Done: ${item.text || "item"}`} onChange={(done) => tick(item.id, done)} />
            )}
            {compact || readOnly ? null : (
              <input type="text" className="ntItemInput" value={item.text} maxLength={500} placeholder="List item" aria-label="List item" onChange={(e) => change((n, now) => editItem(n, item.id, { text: e.target.value }, now))} onKeyDown={(e) => onKeyDown(e, item, index)} />
            )}
            {!compact && !readOnly && (
              <button type="button" className="ntItemDel" aria-label={`Remove ${item.text || "item"}`} title="Remove" onClick={() => change((n, now) => removeItem(n, item.id, now))}>
                ×
              </button>
            )}
          </li>
        )
      })}
      {!compact && !readOnly && (
        <li className="ntAddRow">
          <button
            type="button"
            className="ntAddItem"
            onClick={() => {
              let added = null
              change((n, now) => {
                const r = addItem(n, "", now)
                added = r.id
                return r.note
              })
              setFocusId(added)
            }}
          >
            + {items.length ? "Add item" : "Add a checklist"}
          </button>
        </li>
      )}
    </ul>
  )
}

export default Checklist
