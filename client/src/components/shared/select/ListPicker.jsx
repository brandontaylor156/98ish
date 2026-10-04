import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { listKey, pickable, readItems, rowOfIndex } from "./list"
import { chooseIndex } from "./fields"

const MAX_ROWS = 12 // rows shown before the list scrolls (with a mouse)

// A select's options as a Windows 98 list: navy highlight that follows the mouse, groups as
// bold headers, disabled options greyed. Choosing writes the select's value and closes.
const ListPicker = ({ id, el, sheet, via, keyRef, onDone, room = 300 }) => {
  const items = useMemo(() => readItems(el), [el])
  const [state, setState] = useState(() => ({ active: rowOfIndex(items, el.selectedIndex), query: "", typedAt: 0 }))
  const listRef = useRef(null)
  const live = useRef(state)
  live.current = state
  const openedAt = useRef(performance.now())

  const rowId = (i) => `${id}-row-${i}`

  const choose = (row) => {
    const it = items[row]
    if (!pickable(it)) return
    onDone()
    chooseIndex(el, it.index)
  }

  // the field tells screen readers which row is highlighted
  useEffect(() => {
    if (state.active >= 0) el.setAttribute("aria-activedescendant", rowId(state.active))
  }, [state.active])

  // keep the highlighted row in view (the chosen one in the middle when the list opens)
  const first = useRef(true)
  useLayoutEffect(() => {
    const list = listRef.current
    const row = list?.querySelector(`[data-row="${state.active}"]`)
    if (!list || !row) return
    const top = row.offsetTop
    const bottom = top + row.offsetHeight
    if (first.current) {
      first.current = false
      list.scrollTop = Math.max(0, top - (list.clientHeight - row.offsetHeight) / 2)
    } else if (top < list.scrollTop) list.scrollTop = top
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight
  }, [state.active])

  const page = () => {
    const list = listRef.current
    const row = list?.querySelector("[data-row]")
    return row ? Math.max(1, Math.floor(list.clientHeight / row.offsetHeight) - 1) : 8
  }

  keyRef.current = (e) => {
    const next = listKey(items, live.current, e.key, { now: performance.now(), page: page(), alt: e.altKey })
    if (next.action === "commit") {
      if (pickable(items[next.active])) choose(next.active)
      else onDone()
      return next.keepKey ? "pass" : true
    }
    if (next.action === "cancel") {
      onDone()
      return true
    }
    if (next === live.current) return false
    live.current = next
    setState(next)
    return true
  }

  // rows: a mouse highlights as it moves and chooses on release (press on the field, drag
  // down, let go: as in Windows); a tap chooses
  const rowHeightCap = sheet ? undefined : MAX_ROWS
  return (
    <ul
      ref={listRef}
      id={id}
      className={`selList${sheet ? " selList--sheet" : ""}`}
      role="listbox"
      aria-label={el.getAttribute("aria-label") || undefined}
      style={{ maxHeight: sheet ? Math.min(room, 440) : `min(${room}px, calc(${rowHeightCap} * var(--sel-row) + 2px))` }}
    >
      {items.map((it, i) =>
        it.kind === "group" ? (
          <li key={i} className={`selGroup${it.disabled ? " is-disabled" : ""}`} role="presentation" data-group={i}>
            {it.label}
          </li>
        ) : (
          <li
            key={i}
            id={rowId(i)}
            data-row={i}
            role="option"
            aria-selected={i === state.active}
            aria-disabled={it.disabled || undefined}
            className={`selRow${i === state.active ? " is-active" : ""}${it.disabled ? " is-disabled" : ""}${it.inGroup ? " is-grouped" : ""}${it.index === el.selectedIndex ? " is-current" : ""}`}
            onMouseMove={() => {
              if (pickable(it) && live.current.active !== i) setState((s) => ({ ...s, active: i, query: "" }))
            }}
            onPointerUp={(e) => {
              // (a release right after the opening press, still on the row under it, isn't a choice)
              if (e.pointerType === "mouse" && performance.now() - openedAt.current > 250) choose(i)
            }}
            onClick={() => choose(i)}
          >
            {it.label || " "}
          </li>
        )
      )}
    </ul>
  )
}

export default ListPicker
