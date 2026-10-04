import React, { useLayoutEffect, useMemo, useRef, useState } from "react"
import {
  MONTHS,
  MONTHS_SHORT,
  WEEKDAY_LETTERS,
  addMonths,
  clampDay,
  dayAllowed,
  dayKey,
  formatFor,
  from12,
  minuteChoices,
  minuteStep,
  monthGrid,
  parseDate,
  parseFor,
  roundTime,
  sameDay,
  shortDate,
  timeLabel,
  to12,
  uses12Hour,
} from "./dates"
import { setInputValue } from "./fields"
import { now as clockNow } from "../../../utils/clock"
import { Arrow } from "./icons"

const pad = (n) => String(n).padStart(2, "0")

// the field's min/max as days (a datetime's date part; a month's first day)
const boundOf = (kind, s) => {
  if (!s) return null
  if (kind === "datetime-local") return parseDate(s.split("T")[0])
  if (kind === "month") return parseFor("month", s)
  if (kind === "date") return parseDate(s)
  return null
}

// is a whole month inside the bounds (for the month view)?
const monthAllowed = (y, m, min, max) =>
  (!min || y * 12 + m >= min.y * 12 + min.m) && (!max || y * 12 + m <= max.y * 12 + max.m)

// A list of values in a sunken box (hours, minutes, AM/PM), the chosen one in navy
const Column = ({ label, values, value, format, onPick, focused, sheet, rows }) => {
  const ref = useRef(null)
  const first = useRef(true)
  useLayoutEffect(() => {
    const list = ref.current
    const row = list?.querySelector(".is-active")
    if (!list || !row) return
    const top = row.offsetTop
    if (first.current) {
      first.current = false
      list.scrollTop = Math.max(0, top - (list.clientHeight - row.offsetHeight) / 2)
    } else if (top < list.scrollTop) list.scrollTop = top
    else if (top + row.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + row.offsetHeight - list.clientHeight
  }, [value])
  return (
    <div className="selColWrap">
      <div className="selColLabel">{label}</div>
      <ul ref={ref} className={`selCol${focused ? " is-focused" : ""}`} role="listbox" aria-label={label} style={{ height: `calc(${rows} * var(--sel-row) + 4px)` }}>
        {values.map((v) => (
          <li key={v} role="option" aria-selected={v === value} className={`selRow${v === value ? " is-active" : ""}`} onClick={() => onPick(v)}>
            {format(v)}
          </li>
        ))}
      </ul>
    </div>
  )
}

// Windows 98's calendar drop-down (as in Date/Time Properties and the date pickers of its
// programs) for date, month and datetime fields, and hour/minute lists for times.
const DatePicker = ({ id, el, kind, sheet, keyRef, onDone }) => {
  const today = useMemo(() => {
    const t = clockNow()
    return { y: t.getFullYear(), m: t.getMonth(), d: t.getDate(), h: t.getHours(), min: t.getMinutes() }
  }, [])
  const min = boundOf(kind, el.min)
  const max = boundOf(kind, el.max)
  const step = minuteStep(el.getAttribute("step"))
  const h12 = useMemo(() => uses12Hour(), [])
  const parsed = parseFor(kind, el.value)
  const hasDate = kind !== "time"
  const hasTime = kind === "time" || kind === "datetime-local"

  const [sel, setSel] = useState(() => {
    if (parsed && kind !== "time") return { y: parsed.y, m: parsed.m, d: parsed.d }
    const t = clampDay({ y: today.y, m: today.m, d: kind === "month" ? 1 : today.d }, min, max)
    return t
  })
  const [view, setView] = useState(() => ({ y: sel.y, m: sel.m }))
  const [mode, setMode] = useState(kind === "month" ? "months" : "days")
  const [time, setTime] = useState(() => (parsed && hasTime ? { h: parsed.h, min: parsed.min } : roundTime(today, step)))
  const parts = [...(hasDate ? ["cal"] : []), ...(hasTime ? ["h", "m", ...(h12 ? ["ap"] : [])] : [])]
  const [part, setPart] = useState(0)

  const valid = kind === "month" ? monthAllowed(sel.y, sel.m, min, max) : !hasDate || dayAllowed(sel, min, max)

  const commit = () => {
    if (!valid) return
    const value = formatFor(kind, { ...sel, ...time, s: 0 })
    el.__selWriting = true
    onDone()
    try {
      setInputValue(el, value)
    } finally {
      el.__selWriting = false
    }
  }

  const pickDay = (day) => {
    if (!dayAllowed(day, min, max)) return
    setSel(day)
    setView({ y: day.y, m: day.m })
  }

  const minutes = minuteChoices(step, time.min)
  const hourValues = h12 ? [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] : Array.from({ length: 24 }, (_, i) => i)
  const hourNow = h12 ? to12(time.h).h12 : time.h
  const pm = time.h >= 12
  const setHour = (v) => setTime((t) => ({ ...t, h: h12 ? from12(v, t.h >= 12) : v }))
  const setMinute = (v) => setTime((t) => ({ ...t, min: v }))
  const setPm = (v) => setTime((t) => ({ ...t, h: from12(to12(t.h).h12, v === "PM") }))

  // the arrows in a column move to the next value round the list
  const cycle = (values, current, dir) => values[(values.indexOf(current) + dir + values.length) % values.length]

  const nav = (dir) => {
    if (mode === "days") setView((v) => addMonths({ ...v, d: 1 }, dir))
    else if (mode === "months") setView((v) => ({ ...v, y: v.y + dir }))
    else setView((v) => ({ ...v, y: v.y + dir * 12 }))
  }

  keyRef.current = (e) => {
    const k = e.key
    if (k === "Escape") {
      if (mode !== "days" && kind !== "month") setMode("days")
      else onDone()
      return true
    }
    if (k === "Enter") {
      commit()
      return true
    }
    if (k === "Tab") {
      setPart((p) => (p + (e.shiftKey ? -1 : 1) + parts.length) % parts.length)
      return true
    }
    if ((e.altKey && (k === "ArrowUp" || k === "ArrowDown")) || k === "F4") {
      commit()
      return true
    }
    const which = parts[part]
    if (which === "cal") {
      if (kind === "month") {
        const dm = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3, PageUp: -12, PageDown: 12 }[k]
        if (dm === undefined) return false
        const next = addMonths(sel, dm)
        if (monthAllowed(next.y, next.m, min, max)) setSel(next), setView({ y: next.y, m: next.m })
        return true
      }
      if (mode !== "days") return false
      const next = dayKey(sel, k, { shift: e.shiftKey })
      if (!next) return false
      pickDay(clampDay(next, min, max))
      return true
    }
    if (k === "ArrowLeft" || k === "ArrowRight") {
      setPart((p) => Math.max(0, Math.min(parts.length - 1, p + (k === "ArrowLeft" ? -1 : 1))))
      return true
    }
    if (k !== "ArrowUp" && k !== "ArrowDown") return false
    const dir = k === "ArrowUp" ? -1 : 1
    if (which === "h") setHour(cycle(hourValues, hourNow, dir))
    else if (which === "m") setMinute(cycle(minutes, time.min, dir))
    else if (which === "ap") setPm(pm ? "AM" : "PM")
    return true
  }

  const title = mode === "days" ? `${MONTHS[view.m]} ${view.y}` : mode === "months" ? `${view.y}` : `${view.y - (((view.y % 12) + 12) % 12)}-${view.y - (((view.y % 12) + 12) % 12) + 11}`
  const canZoomOut = mode === "days" || mode === "months"
  const calFocused = parts[part] === "cal"

  const calendar = hasDate && (
    <div className="selCal">
      <div className="selCalHead">
        <button type="button" className="selNav" aria-label={mode === "days" ? "Previous month" : mode === "months" ? "Previous year" : "Earlier years"} onClick={() => nav(-1)}>
          <Arrow dir="left" />
        </button>
        <button type="button" className="selCalTitle" disabled={!canZoomOut} title={canZoomOut ? (mode === "days" ? "Pick a month" : "Pick a year") : undefined} onClick={() => setMode(mode === "days" ? "months" : "years")}>
          {title}
        </button>
        <button type="button" className="selNav" aria-label={mode === "days" ? "Next month" : mode === "months" ? "Next year" : "Later years"} onClick={() => nav(1)}>
          <Arrow dir="right" />
        </button>
      </div>
      {mode === "days" && (
        <div className={`selDays${calFocused ? " is-focused" : ""}`} role="grid" aria-label={title}>
          <div className="selWeek selWeekHead" role="row">
            {WEEKDAY_LETTERS.map((w, i) => (
              <span key={i} role="columnheader" className="selWeekday">
                {w}
              </span>
            ))}
          </div>
          {Array.from({ length: 6 }, (_, row) => (
            <div key={row} className="selWeek" role="row">
              {monthGrid(view.y, view.m)
                .slice(row * 7, row * 7 + 7)
                .map((day) => {
                  const ok = dayAllowed(day, min, max)
                  const on = sameDay(day, sel)
                  return (
                    <span
                      key={`${day.m}-${day.d}`}
                      role="gridcell"
                      aria-selected={on}
                      aria-disabled={!ok || undefined}
                      aria-label={`${MONTHS[day.m]} ${day.d}, ${day.y}`}
                      className={`selDay${on ? " is-active" : ""}${day.inMonth ? "" : " is-other"}${ok ? "" : " is-disabled"}${sameDay(day, today) ? " is-today" : ""}`}
                      onClick={() => pickDay(day)}
                      onDoubleClick={() => ok && commit()}
                    >
                      {day.d}
                    </span>
                  )
                })}
            </div>
          ))}
        </div>
      )}
      {mode === "months" && (
        <div className={`selMonths${calFocused ? " is-focused" : ""}`} role="grid" aria-label={`${view.y}`}>
          {MONTHS_SHORT.map((name, m) => {
            const ok = monthAllowed(view.y, m, min, max)
            const on = kind === "month" ? sel.y === view.y && sel.m === m : view.m === m
            return (
              <span
                key={name}
                role="gridcell"
                aria-selected={on}
                aria-disabled={!ok || undefined}
                className={`selMonth${on ? " is-active" : ""}${ok ? "" : " is-disabled"}${today.y === view.y && today.m === m ? " is-today" : ""}`}
                onClick={() => {
                  if (!ok) return
                  if (kind === "month") setSel({ y: view.y, m, d: 1 }), setView({ y: view.y, m })
                  else setView({ y: view.y, m }), setMode("days")
                }}
                onDoubleClick={() => kind === "month" && ok && commit()}
              >
                {name}
              </span>
            )
          })}
        </div>
      )}
      {mode === "years" && (
        <div className="selMonths" role="grid" aria-label={title}>
          {Array.from({ length: 12 }, (_, i) => view.y - (((view.y % 12) + 12) % 12) + i).map((y) => (
            <span
              key={y}
              role="gridcell"
              aria-selected={y === view.y}
              className={`selMonth${y === view.y ? " is-active" : ""}${y === today.y ? " is-today" : ""}`}
              onClick={() => {
                setView((v) => ({ ...v, y }))
                setMode("months")
              }}
            >
              {y}
            </span>
          ))}
        </div>
      )}
    </div>
  )

  const rows = sheet ? (kind === "time" ? 5 : 3) : kind === "time" ? 8 : 7
  const clock = hasTime && (
    <div className="selTime">
      <Column label="Hour" values={hourValues} value={hourNow} format={(v) => (h12 ? String(v) : pad(v))} onPick={setHour} focused={parts[part] === "h"} sheet={sheet} rows={rows} />
      <Column label="Minute" values={minutes} value={time.min} format={pad} onPick={setMinute} focused={parts[part] === "m"} sheet={sheet} rows={rows} />
      {h12 && <Column label="" values={["AM", "PM"]} value={pm ? "PM" : "AM"} format={(v) => v} onPick={setPm} focused={parts[part] === "ap"} sheet={sheet} rows={rows} />}
    </div>
  )

  const todayOk = kind === "month" ? monthAllowed(today.y, today.m, min, max) : dayAllowed(today, min, max)
  return (
    <div id={id} className={`selPicker selPicker--${kind}`} role="dialog" aria-label={kind === "time" ? "Time" : "Date"}>
      <div className="selPickerMain">
        {calendar}
        {clock}
      </div>
      {hasTime && <div className="selPreview" aria-live="polite">{hasDate ? `${shortDate(sel)}  ${timeLabel(time, h12)}` : timeLabel(time, h12)}</div>}
      <div className="selFoot">
        {hasDate && (
          <button
            type="button"
            className="selToday"
            disabled={!todayOk}
            onClick={() => {
              const t = { y: today.y, m: today.m, d: kind === "month" ? 1 : today.d }
              setSel(t)
              setView({ y: t.y, m: t.m })
              if (kind !== "month") setMode("days")
            }}
          >
            <span className="selTodayMark" aria-hidden="true" />
            Today: {kind === "month" ? `${MONTHS_SHORT[today.m]} ${today.y}` : shortDate(today)}
          </button>
        )}
        <span className="selFootButtons">
          <button type="button" className="default" disabled={!valid} onClick={commit}>
            OK
          </button>
          <button type="button" onClick={onDone}>
            Cancel
          </button>
        </span>
      </div>
    </div>
  )
}

export default DatePicker
