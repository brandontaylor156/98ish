import React, { useEffect, useRef, useState } from "react"
import { getSettings } from "../../utils/settings"
import { onInputReset, swallowNextClick } from "../../utils/inputGuard"

// Phone desktop icons: tap to open, drag to move. Icons snap to a grid; dropping onto
// another icon swaps the two. The arrangement is remembered on this device.

const CELL_W = 88
const CELL_H = 100
const PAD = 8
const DRAG_THRESHOLD = 8 // px a finger must travel before a tap becomes a drag
const STORAGE_KEY = "98ish.mobileIcons"

const loadCells = () => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}
  } catch {
    return {}
  }
}

const saveCells = (cells) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cells))
  } catch {
    // storage unavailable: the arrangement lasts for this visit
  }
}

const cellKey = ({ col, row }) => `${col},${row}`

// After a tap opens an app, the browser still sends a click to whatever is now under the
// finger: the window that just opened. Swallow that one click (swallowNextClick, in
// utils/inputGuard.js, which drops it if the page goes to the background first).

// Every program gets a cell: its saved one if still on screen and free, else the first gap
const arrange = (programs, saved, columns, rows) => {
  const taken = new Set()
  const cells = {}
  for (const { name } of programs) {
    const cell = saved[name]
    if (cell && cell.col < columns && cell.row < rows && !taken.has(cellKey(cell))) {
      cells[name] = cell
      taken.add(cellKey(cell))
    }
  }
  let next = 0
  for (const { name } of programs) {
    if (cells[name]) continue
    while (taken.has(cellKey({ col: next % columns, row: Math.floor(next / columns) }))) next++
    cells[name] = { col: next % columns, row: Math.floor(next / columns) }
    taken.add(cellKey(cells[name]))
  }
  return cells
}

// Arrange Icons: lay the icons out again in this order (remount MobileIcons after)
export const resetMobileIcons = (names) => {
  const columns = Math.max(1, Math.floor((document.documentElement.clientWidth - PAD * 2) / CELL_W))
  saveCells(arrange(names.map((name) => ({ name })), {}, columns, Infinity))
}

const MobileIcons = ({ programs, onOpen }) => {
  const ref = useRef(null)
  const [size, setSize] = useState({ columns: 4, rows: 6 })
  const [saved, setSaved] = useState(loadCells)
  const [drag, setDrag] = useState(null) // { name, dx, dy }
  const gesture = useRef(null)

  useEffect(() => {
    const el = ref.current
    const measure = () =>
      setSize({
        columns: Math.max(1, Math.floor((el.clientWidth - PAD * 2) / CELL_W)),
        rows: Math.max(1, Math.floor((el.clientHeight - PAD * 2) / CELL_H)),
      })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // a press the page lost (put away mid-drag, the phone turned): the icon goes back
  useEffect(
    () =>
      onInputReset(() => {
        gesture.current = null
        setDrag(null)
      }),
    []
  )

  const cells = arrange(programs, saved, size.columns, size.rows)

  const onPointerDown = (event, program) => {
    gesture.current = { name: program.name, x: event.clientX, y: event.clientY, dragging: false, id: event.pointerId, at: performance.now() }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event) => {
    const g = gesture.current
    if (!g || g.id !== event.pointerId) return
    const dx = event.clientX - g.x
    const dy = event.clientY - g.y
    if (!g.dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
    g.dragging = true
    setDrag({ name: g.name, dx, dy })
  }

  const onPointerUp = (event, program) => {
    const g = gesture.current
    gesture.current = null
    if (!g || g.id !== event.pointerId) return
    if (!g.dragging) {
      // held still: that was a long press (the desktop shows its menu), not a tap
      if (performance.now() - g.at > (getSettings().longPressMs || 500) - 50) return
      swallowNextClick()
      return onOpen(program)
    }

    // Drop: snap to the nearest cell, swapping with whatever icon is there
    const from = cells[program.name]
    const to = {
      col: Math.min(size.columns - 1, Math.max(0, from.col + Math.round((event.clientX - g.x) / CELL_W))),
      row: Math.min(size.rows - 1, Math.max(0, from.row + Math.round((event.clientY - g.y) / CELL_H))),
    }
    const occupant = Object.keys(cells).find((name) => name !== program.name && cellKey(cells[name]) === cellKey(to))
    const next = { ...cells, [program.name]: to }
    if (occupant) next[occupant] = from
    setSaved(next)
    saveCells(next)
    setDrag(null)
  }

  const onPointerCancel = () => {
    gesture.current = null
    setDrag(null)
  }

  return (
    <div className="mobileIcons" ref={ref}>
      {programs.map((program) => {
        const cell = cells[program.name]
        const dragging = drag?.name === program.name
        return (
          <div
            key={program.name}
            data-program={program.name}
            className={(dragging ? "mobileIcon is-dragging" : "mobileIcon") + (program.item?.type === "shortcut" ? " isShortcut" : "")}
            style={{
              left: PAD + cell.col * CELL_W,
              top: PAD + cell.row * CELL_H,
              transform: dragging ? `translate(${drag.dx}px, ${drag.dy}px)` : undefined,
            }}
            onPointerDown={(e) => onPointerDown(e, program)}
            onPointerMove={onPointerMove}
            onPointerUp={(e) => onPointerUp(e, program)}
            onPointerCancel={onPointerCancel}
            onContextMenu={(e) => e.preventDefault()}
            role="button"
            tabIndex={0}
            aria-label={program.label ?? program.name}
            onKeyDown={(e) => {
              if (e.key !== "Enter" && e.key !== " ") return
              e.preventDefault()
              onOpen(program)
            }}
          >
            <img src={program.icon} alt="" draggable="false" />
            <label className="desktopIconLabel text-light">{program.label ?? program.name}</label>
          </div>
        )
      })}
    </div>
  )
}

export default MobileIcons
