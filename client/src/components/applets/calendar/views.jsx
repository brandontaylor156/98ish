import React, { useEffect, useLayoutEffect, useMemo, useRef } from "react"
import { MONTHS, WEEKDAYS_SHORT, addDays, dateIn, dateLabel, endMs, monthGrid, onDate, parseDate, shortTime, startMs, timeLabel, weekdayOf, zoneParts } from "./recur"
import { calendarById } from "./store"
import { colorFor } from "./util"

// The Calendar's views: Month (with dots on phones), Week and Day (an hour grid), Agenda
// (a list), Memos (notes and to-do lists with no date), and the little month in the sidebar.

// Horizontal swipes (phones): change month/week without scrolling the page
export const useSwipe = (onSwipe) => {
  const start = useRef(null)
  return {
    onTouchStart: (e) => {
      const t = e.touches[0]
      start.current = e.touches.length === 1 ? { x: t.clientX, y: t.clientY, at: Date.now() } : null
    },
    onTouchEnd: (e) => {
      const s = start.current
      start.current = null
      if (!s) return
      const t = e.changedTouches[0]
      const dx = t.clientX - s.x
      const dy = t.clientY - s.y
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - s.at < 800) onSwipe(dx < 0 ? 1 : -1)
    },
  }
}

const Check = ({ done }) => (
  <span className={`calTick${done ? " calTickDone" : ""}`} aria-hidden="true">
    {done ? "✓" : ""}
  </span>
)

// one event in a month cell
const Chip = ({ occ, zone, onOpen, date }) => {
  const color = colorFor(occ)
  const continues = occ.allDay ? occ.start < date : dateIn(occ.start, zone) < date
  return (
    <button
      type="button"
      className={`calChip${occ.allDay ? " calChipAllDay" : ""}${occ.done ? " calChipDone" : ""}`}
      style={occ.allDay ? { background: color, borderColor: color } : { "--chip": color }}
      title={occ.title}
      onClick={(e) => {
        e.stopPropagation()
        onOpen(occ)
      }}
    >
      {occ.event.todo && <Check done={occ.done} />}
      {!occ.allDay && !continues && <span className="calChipTime">{shortTime(occ.start, zone)}</span>}
      <span className="calChipTitle">{occ.title}</span>
    </button>
  )
}

export const MonthView = ({ year, month, today, selected, byDate, zone, mobile, onSelect, onOpen, onNew, onSwipe }) => {
  const days = useMemo(() => monthGrid(year, month), [year, month])
  const swipe = useSwipe(onSwipe)
  const max = mobile ? 3 : 4
  return (
    <div className="calMonth" {...swipe}>
      <div className="calMonthHead" aria-hidden="true">
        {WEEKDAYS_SHORT.map((d) => (
          <div key={d}>{mobile ? d[0] : d}</div>
        ))}
      </div>
      <div className="calMonthGrid" role="grid" aria-label={`${MONTHS[month - 1]} ${year}`}>
        {days.map((date) => {
          const p = parseDate(date)
          const list = byDate.get(date) || []
          const other = p.m !== month
          return (
            <div
              key={date}
              role="gridcell"
              aria-selected={date === selected}
              data-date={date}
              className={`calDay${other ? " calOther" : ""}${date === today ? " calToday" : ""}${date === selected ? " calSelected" : ""}${weekdayOf(date) % 6 === 0 ? " calWeekend" : ""}`}
              onClick={() => onSelect(date)}
              onDoubleClick={() => !mobile && onNew(date)}
            >
              <span className="calDayNum">{p.d === 1 && !mobile ? `${MONTHS[p.m - 1].slice(0, 3)} 1` : p.d}</span>
              {mobile ? (
                list.length > 0 && (
                  <span className="calDots" aria-label={`${list.length} event${list.length === 1 ? "" : "s"}`}>
                    {list.slice(0, max).map((o) => (
                      <span key={`${o.id}${o.key}`} className="calDot" style={{ background: colorFor(o) }} />
                    ))}
                    {list.length > max && <span className="calDotMore">+</span>}
                  </span>
                )
              ) : (
                <div className="calChips">
                  {list.slice(0, list.length > max ? max - 1 : max).map((o) => (
                    <Chip key={`${o.id}${o.key}`} occ={o} zone={zone} onOpen={onOpen} date={date} />
                  ))}
                  {list.length > max && (
                    <button
                      type="button"
                      className="calMore"
                      onClick={(e) => {
                        e.stopPropagation()
                        onSelect(date, true)
                      }}
                    >
                      +{list.length - max + 1} more
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// A list of occurrences (a day's events on phones, the agenda)
export const EventRows = ({ list, zone, date, onOpen, empty = "Nothing planned." }) => {
  if (!list.length) return <p className="calEmpty">{empty}</p>
  return (
    <ul className="calRows">
      {list.map((o) => {
        const calendar = calendarById(o.calendarId)
        let when = "All day"
        if (!o.allDay) {
          const a = dateIn(o.start, zone)
          const b = dateIn(Math.max(o.start, o.end - 1), zone)
          when = a === b ? `${timeLabel(o.start, zone)}${o.end > o.start ? ` - ${timeLabel(o.end, zone)}` : ""}` : a === date ? `${timeLabel(o.start, zone)} →` : b === date ? `→ ${timeLabel(o.end, zone)}` : "All day"
        }
        return (
          <li key={`${o.id}${o.key}`}>
            <button type="button" className={`calRow${o.done ? " calRowDone" : ""}`} onClick={() => onOpen(o)}>
              <span className="calRowBar" style={{ background: colorFor(o, calendar) }} />
              <span className="calRowWhen">{when}</span>
              <span className="calRowMain">
                <span className="calRowTitle">
                  {o.event.todo && <Check done={o.done} />}
                  {o.title}
                  {o.recurring && <span className="calRepeatMark" title="Repeats"> ⟳</span>}
                </span>
                <span className="calRowSub">
                  {[o.location, calendar && calendar.members.length > 1 ? `${calendar.name} · ${o.event.createdByName || ""}` : calendar?.name].filter(Boolean).join(" · ")}
                  {o.event.comments > 0 && <span className="calRowComments"> 💬 {o.event.comments}</span>}
                </span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

export const DayList = ({ date, list, zone, onOpen, onNew, today }) => (
  <div className="calDayList">
    <div className="calDayListHead">
      <b>{date === today ? `Today, ${dateLabel(date, { weekday: false })}` : dateLabel(date)}</b>
      <button type="button" onClick={() => onNew(date)}>
        + Add
      </button>
    </div>
    <EventRows list={list} zone={zone} date={date} onOpen={onOpen} empty="Nothing planned. Tap + Add." />
  </div>
)

// ---- Week and Day: an hour grid ----

// side-by-side columns for events that overlap
const layout = (items) => {
  const sorted = [...items].sort((a, b) => a.top - b.top || b.bottom - a.bottom)
  const out = []
  let cluster = []
  let clusterEnd = -1
  const flush = () => {
    const columns = []
    for (const it of cluster) {
      let col = columns.findIndex((end) => end <= it.top)
      if (col < 0) col = columns.length
      columns[col] = it.bottom
      it.col = col
    }
    for (const it of cluster) out.push({ ...it, cols: columns.length })
    cluster = []
  }
  for (const it of sorted) {
    if (it.top >= clusterEnd && cluster.length) flush()
    cluster.push(it)
    clusterEnd = Math.max(clusterEnd, it.bottom)
  }
  if (cluster.length) flush()
  return out
}

export const HourGrid = ({ dates, today, byDate, zone, mobile, onOpen, onNew, onSwipe, selected, onSelect }) => {
  const hour = mobile ? 48 : 40
  const scroller = useRef(null)
  const swipe = useSwipe(onSwipe)
  useLayoutEffect(() => {
    // open at 7:00, or a bit before now when today is showing
    const now = zoneParts(Date.now(), zone)
    const h = dates.includes(now.date) ? Math.max(0, Math.min(now.h - 1, 15)) : 7
    if (scroller.current) scroller.current.scrollTop = h * hour
  }, [dates[0]])
  const nowLine = useMemo(() => {
    const p = zoneParts(Date.now(), zone)
    return { date: p.date, top: (p.h + p.mi / 60) * hour }
  }, [dates[0], zone])
  return (
    <div className="calWeek" {...swipe}>
      <div className="calWeekHead">
        <div className="calGutter" />
        {dates.map((date) => {
          const p = parseDate(date)
          return (
            <button type="button" key={date} className={`calWeekDay${date === today ? " calToday" : ""}${date === selected ? " calSelected" : ""}`} onClick={() => onSelect(date)}>
              <span>{WEEKDAYS_SHORT[weekdayOf(date)]}</span> <b>{p.d}</b>
            </button>
          )
        })}
      </div>
      <div className="calAllDayRow">
        <div className="calGutter">all-day</div>
        {dates.map((date) => (
          <div key={date} className="calAllDayCell" onDoubleClick={() => onNew(date, null, true)}>
            {(byDate.get(date) || [])
              .filter((o) => o.allDay)
              .map((o) => (
                <button key={`${o.id}${o.key}`} type="button" className={`calChip calChipAllDay${o.done ? " calChipDone" : ""}`} style={{ background: colorFor(o), borderColor: colorFor(o) }} onClick={() => onOpen(o)}>
                  {o.event.todo && <Check done={o.done} />}
                  <span className="calChipTitle">{o.title}</span>
                </button>
              ))}
          </div>
        ))}
      </div>
      <div className="calHours" ref={scroller}>
        <div className="calHoursInner" style={{ height: hour * 24 }}>
          <div className="calGutter calHourLabels">
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} style={{ top: h * hour }}>
                {h === 0 ? "" : `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`}
              </span>
            ))}
          </div>
          {dates.map((date) => {
            const dayStart = startMs({ allDay: true, start: date }, zone)
            const dayEnd = endMs({ allDay: true, start: date, end: date }, zone)
            const span = dayEnd - dayStart // 23 or 25 hours on the days the clocks change
            const items = layout(
              (byDate.get(date) || [])
                .filter((o) => !o.allDay)
                .map((o) => {
                  const a = Math.max(o.start, dayStart)
                  const b = Math.min(Math.max(o.end, o.start + 20 * 60_000), dayEnd)
                  return { occ: o, top: ((a - dayStart) / span) * 24 * hour, bottom: ((b - dayStart) / span) * 24 * hour }
                })
            )
            return (
              <div
                key={date}
                className={`calHourCol${date === today ? " calToday" : ""}`}
                onDoubleClick={(e) => {
                  if (mobile) return
                  const r = e.currentTarget.getBoundingClientRect()
                  onNew(date, Math.floor((e.clientY - r.top) / hour))
                }}
                onClick={(e) => {
                  if (!mobile || e.target !== e.currentTarget) return
                  const r = e.currentTarget.getBoundingClientRect()
                  onNew(date, Math.floor((e.clientY - r.top) / hour))
                }}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <div key={h} className="calHourLine" style={{ top: h * hour }} />
                ))}
                {nowLine.date === date && <div className="calNowLine" style={{ top: nowLine.top }} />}
                {items.map(({ occ, top, bottom, col, cols }) => (
                  <button
                    key={`${occ.id}${occ.key}`}
                    type="button"
                    className={`calBlock${occ.done ? " calChipDone" : ""}`}
                    style={{ top, height: Math.max(18, bottom - top - 1), left: `${(col / cols) * 100}%`, width: `calc(${100 / cols}% - 2px)`, "--chip": colorFor(occ) }}
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpen(occ)
                    }}
                  >
                    <span className="calBlockTitle">
                      {occ.event.todo && <Check done={occ.done} />}
                      {occ.title}
                    </span>
                    {bottom - top > 30 && <span className="calBlockTime">{timeLabel(occ.start, zone)}</span>}
                  </button>
                ))}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export const AgendaView = ({ from, days = 60, byDate, zone, onOpen, today }) => {
  const dates = useMemo(() => Array.from({ length: days }, (_, i) => addDays(from, i)), [from, days])
  const groups = dates.map((date) => ({ date, list: byDate.get(date) || [] })).filter((g) => g.list.length)
  return (
    <div className="calAgenda">
      {groups.length === 0 && <p className="calEmpty">Nothing planned in the next {days} days.</p>}
      {groups.map((g) => (
        <section key={g.date} className="calAgendaDay">
          <h3 className={g.date === today ? "calToday" : ""}>{g.date === today ? `Today · ${dateLabel(g.date)}` : dateLabel(g.date, { year: parseDate(g.date).y !== parseDate(today).y })}</h3>
          <EventRows list={g.list} zone={zone} date={g.date} onOpen={onOpen} />
        </section>
      ))}
    </div>
  )
}

export const MemoView = ({ memos, onOpen, onNew }) => (
  <div className="calMemos">
    <div className="calMemosHead">
      <p>Memos are notes and lists with no date: gift ideas, a packing list, places to try. Everyone in the calendar can see and tick them.</p>
      <button type="button" onClick={onNew}>
        + New Memo
      </button>
    </div>
    {memos.length === 0 && <p className="calEmpty">No memos yet.</p>}
    <div className="calMemoGrid">
      {memos.map((m) => {
        const calendar = calendarById(m.calendarId)
        const done = (m.checklist || []).filter((c) => c.done).length
        return (
          <button key={m.id} type="button" className="calMemo" style={{ "--chip": colorFor({ ...m, event: m }, calendar) }} onClick={() => onOpen(m)}>
            <b>{m.title}</b>
            {m.notes && <span className="calMemoNotes">{m.notes}</span>}
            {(m.checklist || []).slice(0, 5).map((c, i) => (
              <span key={i} className={`calMemoItem${c.done ? " calRowDone" : ""}`}>
                <Check done={c.done} /> {c.text}
              </span>
            ))}
            <span className="calRowSub">
              {calendar?.name}
              {m.checklist?.length ? ` · ${done}/${m.checklist.length} done` : ""}
              {m.comments > 0 ? ` · 💬 ${m.comments}` : ""}
            </span>
          </button>
        )
      })}
    </div>
  </div>
)

export const MiniMonth = ({ year, month, selected, today, busy, onPick, onMonth }) => {
  const days = useMemo(() => monthGrid(year, month), [year, month])
  return (
    <div className="calMini">
      <div className="calMiniHead">
        <button type="button" aria-label="Previous month" onClick={() => onMonth(-1)}>
          ◀
        </button>
        <span>
          {MONTHS[month - 1]} {year}
        </span>
        <button type="button" aria-label="Next month" onClick={() => onMonth(1)}>
          ▶
        </button>
      </div>
      <div className="calMiniGrid">
        {WEEKDAYS_SHORT.map((d) => (
          <span key={d} className="calMiniDow">
            {d[0]}
          </span>
        ))}
        {days.map((date) => (
          <button
            key={date}
            type="button"
            className={`calMiniDay${parseDate(date).m !== month ? " calOther" : ""}${date === today ? " calToday" : ""}${date === selected ? " calSelected" : ""}${busy.has(date) ? " calBusy" : ""}`}
            onClick={() => onPick(date)}
            aria-label={dateLabel(date, { year: true })}
          >
            {parseDate(date).d}
          </button>
        ))}
      </div>
    </div>
  )
}

// Bucket occurrences by the dates they touch
export const byDates = (occs, dates, zone) => {
  const map = new Map(dates.map((d) => [d, []]))
  for (const o of occs) {
    for (const d of dates) if (onDate(o, d, zone)) map.get(d).push(o)
  }
  return map
}

// keeps a value fresh in an effect without re-running it
export const useLatest = (value) => {
  const ref = useRef(value)
  useEffect(() => {
    ref.current = value
  })
  return ref
}
