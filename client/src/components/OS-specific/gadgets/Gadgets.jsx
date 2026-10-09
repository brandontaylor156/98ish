import React, { useEffect, useMemo, useState } from "react"
import { launch } from "../../../utils/programs"
import { currentZone } from "../../../utils/clock"
import { gadgets } from "../../../utils/gadgets"
import { handAngles, megabytes, meterPoints, nextAlarm } from "../../../utils/gadgetsCore"
import { useClockApp } from "../../applets/calendar/clockStore"
import { dateIn, dateLabel, expandAll, shortTime, startMs, endMs, addDays } from "../../applets/calendar/recur"
import { openCalendar, openClock, useCalendar, visibleEvents } from "../../applets/calendar/store"
import { useSettings } from "../../../utils/settings"
import { tempUnit } from "../../../utils/region"
import { currentPlace, useWeatherPrefs } from "../../../utils/weatherPrefs"
import { ensureForecast, useForecast } from "../../applets/weather/weatherStore"
import { conditionOf, temp } from "../../applets/weather/weatherCore"
import WeatherIcon from "../../applets/weather/WeatherIcon"
import { createNote, getNote, setNoteField, useNotes } from "../../../utils/notes"
import { PAPER } from "../../applets/notes/notesCore"
import { createMonitor } from "../../applets/taskManager/realStats"

// The five desktop gadgets' insides (GadgetHost draws the 98 window around each). They read
// the stores the programs already keep: Clock's alarms, Weather's places and forecast cache,
// Calendar's events, Notes, and Task Manager's real meter. Nothing new is stored here.

// a clock that ticks once a second, only while the page is visible
const useNow = (every = 1000) => {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    let timer = null
    const tick = () => {
      setNow(new Date())
      timer = setTimeout(tick, every - (Date.now() % every) + 5)
    }
    const onVis = () => {
      clearTimeout(timer)
      if (document.visibilityState === "visible") tick()
    }
    tick()
    document.addEventListener("visibilitychange", onVis)
    return () => {
      clearTimeout(timer)
      document.removeEventListener("visibilitychange", onVis)
    }
  }, [every])
  return now
}

const zoneNow = () => {
  try {
    return currentZone()
  } catch {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  }
}

// ---- Clock ----
export const ClockGadget = () => {
  const now = useNow(1000)
  const app = useClockApp()
  const a = handAngles(now.getHours(), now.getMinutes(), now.getSeconds())
  const zone = zoneNow()
  const next = nextAlarm(app.alarms, now)
  const hand = (deg, len, width, color) => <line x1="50" y1="50" x2={50 + len * Math.sin((deg * Math.PI) / 180)} y2={50 - len * Math.cos((deg * Math.PI) / 180)} stroke={color} strokeWidth={width} strokeLinecap="square" />
  const nextText = next ? `${new Date(next.at).getDate() === now.getDate() ? "" : `${dateLabel(dateIn(next.at, zone), { weekday: true }).split(",")[0]} `}${shortTime(next.at, zone)}` : null
  return (
    <button type="button" className="gdgBody gdgClock" onClick={() => openClock({ tab: "alarm" })} aria-label={`${shortTime(now.getTime(), zone)}. ${next ? `Next alarm ${nextText}` : "No alarms on"}. Open Clock`}>
      <svg viewBox="0 0 100 100" className="gdgFace" aria-hidden="true">
        <circle cx="50" cy="50" r="47" fill="#fff" stroke="#808080" strokeWidth="3" />
        <circle cx="50" cy="50" r="44" fill="none" stroke="#000" strokeWidth="1" />
        {Array.from({ length: 12 }, (_, i) => {
          const r = (i * 30 * Math.PI) / 180
          const big = i % 3 === 0
          return <rect key={i} x={50 + 38 * Math.sin(r) - (big ? 2.5 : 1.5)} y={50 - 38 * Math.cos(r) - (big ? 2.5 : 1.5)} width={big ? 5 : 3} height={big ? 5 : 3} fill={big ? "#000080" : "#000"} />
        })}
        {hand(a.hour, 22, 4, "#000")}
        {hand(a.minute, 32, 3, "#000")}
        {hand(a.second, 36, 1, "#c00000")}
        <rect x="47.5" y="47.5" width="5" height="5" fill="#000" />
      </svg>
      <span className="gdgDigital">{shortTime(now.getTime(), zone)}</span>
      <span className="gdgSmall">{next ? `Alarm: ${nextText}` : "No alarms on"}</span>
    </button>
  )
}

// ---- Weather ----
export const WeatherGadget = ({ dispatch }) => {
  const prefs = useWeatherPrefs()
  const settings = useSettings()
  const place = currentPlace(prefs)
  const { entry } = useForecast(place?.id)
  useEffect(() => {
    if (!place) return
    ensureForecast(place.id)
    const timer = setInterval(() => document.visibilityState === "visible" && ensureForecast(place.id), 15 * 60_000)
    return () => clearInterval(timer)
  }, [place?.id])
  const unit = tempUnit(settings.region)
  const cur = entry?.data?.current
  const c = cur ? conditionOf(cur.code, { isDay: cur.isDay, windKmh: cur.windKmh }) : null
  const today = entry?.data?.daily?.[0]
  return (
    <button type="button" className="gdgBody gdgWeather" onClick={() => dispatch?.({ type: "open_window", payload: launch("Weather") })}>
      {!place && <span className="gdgSmall">Pick a place in Weather...</span>}
      {place && !cur && <span className="gdgSmall">Getting the weather...</span>}
      {cur && (
        <>
          <span className="gdgWxRow">
            <WeatherIcon icon={c.icon} size={40} />
            <span className="gdgWxTemp">{temp(cur.tempC, unit)}</span>
          </span>
          <span className="gdgSmall">{c.label}</span>
          {today && (
            <span className="gdgSmall">
              H {temp(today.maxC, unit)} · L {temp(today.minC, unit)}
            </span>
          )}
          <span className="gdgPlace">{place.name}</span>
        </>
      )}
    </button>
  )
}

// ---- Calendar ----
export const CalendarGadget = () => {
  const cal = useCalendar()
  const now = useNow(60_000)
  const zone = zoneNow()
  const today = dateIn(now.getTime(), zone)
  const next = useMemo(() => {
    const t = now.getTime()
    const events = visibleEvents(cal).filter((e) => !e.todo)
    return expandAll(events, t - 86_400_000, t + 14 * 86_400_000, zone)
      .filter((o) => endMs(o, zone) > t)
      .slice(0, 3)
  }, [cal, now.getMinutes(), zone])
  const dayOf = (o) => {
    const d = o.allDay ? o.start : dateIn(startMs(o, zone), zone)
    const day = d <= today ? "Today" : d === addDays(today, 1) ? "Tomorrow" : dateLabel(d)
    return o.allDay ? day : `${day} ${shortTime(o.start, zone)}`
  }
  const d = Number(today.split("-")[2])
  return (
    <button type="button" className="gdgBody gdgCal" onClick={() => openCalendar({ date: today })}>
      <span className="gdgCalPage" aria-label={dateLabel(today, { year: true })}>
        <span className="gdgCalMonth">{dateLabel(today).split(", ")[1]?.split(" ")[0] || ""}</span>
        <span className="gdgCalDay">{d}</span>
        <span className="gdgCalWeek">{dateLabel(today).split(",")[0]}</span>
      </span>
      <span className="gdgCalList">
        {!next.length && <span className="gdgSmall">Nothing in the next two weeks.</span>}
        {next.map((o) => (
          <span key={`${o.eventId || o.id}-${o.key || o.start}`} className="gdgCalItem">
            <b>{o.title || "(No title)"}</b>
            <span>{dayOf(o)}</span>
          </span>
        ))}
      </span>
    </button>
  )
}

// ---- Notes ----
export const NotesGadget = ({ config, dispatch }) => {
  useNotes()
  const note = config.noteId ? getNote(config.noteId) : null
  const gone = !note || !!note.trashedAt?.v
  if (gone)
    return (
      <div className="gdgBody gdgNoteEmpty">
        <span className="gdgSmall">A sticky note on your desktop. It's one of your Notes, so it syncs like them.</span>
        <button
          type="button"
          onClick={() => {
            const id = createNote({ title: "Desktop note", color: "yellow" })
            gadgets.configure("notes", { noteId: id })
          }}
        >
          New Sticky Note
        </button>
      </div>
    )
  const paper = PAPER[note.color?.v] || PAPER.yellow
  return (
    <div className="gdgBody gdgNote" style={{ background: paper.paper, borderColor: paper.edge }}>
      <textarea
        className="gdgNoteText"
        aria-label="Sticky note"
        value={note.body?.v || ""}
        maxLength={4000}
        placeholder="Type a note..."
        onChange={(e) => setNoteField(note.id, "body", e.target.value)}
        style={{ color: paper.ink }}
      />
      <button type="button" className="gdgNoteOpen" onClick={() => dispatch?.({ type: "open_window", payload: launch("Notes", { handoff: { id: Date.now(), note: note.id } }) })}>
        Open in Notes
      </button>
    </div>
  )
}

// ---- CPU Meter ----
export const MeterGadget = ({ dispatch }) => {
  const [sample, setSample] = useState(null)
  const [history, setHistory] = useState([])
  useEffect(() => {
    let monitor = null
    let timer = null
    const start = () => {
      if (monitor) return
      monitor = createMonitor({ ping: false, frames: false })
      timer = setInterval(() => {
        const s = monitor.sample()
        setSample(s)
        setHistory((h) => [...h.slice(-29), s.busy])
      }, 1000)
    }
    const stop = () => {
      clearInterval(timer)
      monitor?.stop()
      monitor = null
    }
    const onVis = () => (document.visibilityState === "visible" ? start() : stop())
    start()
    document.addEventListener("visibilitychange", onVis)
    return () => {
      stop()
      document.removeEventListener("visibilitychange", onVis)
    }
  }, [])
  const busy = sample?.busy ?? 0
  const heap = sample?.heap
  const memShare = heap ? Math.min(100, Math.round((heap.used / heap.limit) * 100)) : null
  const device = typeof navigator !== "undefined" && navigator.deviceMemory ? `${navigator.deviceMemory} GB device` : null
  return (
    <button type="button" className="gdgBody gdgMeter" onClick={() => dispatch?.({ type: "open_window", payload: launch("Task Manager") })} aria-label={`CPU ${busy}%. ${heap ? `Memory ${megabytes(heap.used)}` : "Memory not reported"}. Open Task Manager`}>
      <span className="gdgMeterRow">
        <span>CPU</span>
        <span className="gdgLevel" aria-hidden="true">
          <span style={{ width: `${busy}%` }} />
        </span>
        <span className="gdgNum">{busy}%</span>
      </span>
      <svg className="gdgGraph" viewBox="0 0 120 36" preserveAspectRatio="none" aria-hidden="true">
        <polyline points={meterPoints(history, 120, 36)} fill="none" stroke="#00ff00" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="gdgMeterRow">
        <span>Mem</span>
        <span className="gdgLevel" aria-hidden="true">
          <span style={{ width: `${memShare ?? 0}%` }} />
        </span>
        <span className="gdgNum">{heap ? megabytes(heap.used) : "-"}</span>
      </span>
      <span className="gdgSmall">{heap ? `of ${megabytes(heap.limit)} for pages` : device || "This browser doesn't report memory."}</span>
    </button>
  )
}

export const GADGET_VIEWS = { clock: ClockGadget, weather: WeatherGadget, calendar: CalendarGadget, notes: NotesGadget, meter: MeterGadget }
