import React, { useId, useMemo, useRef, useState } from "react"
import WorldMap from "./WorldMap"
import { ZONES, currentZone, getClockSettings, gmtLabel, localZone, observesDst, setClockSettings, standardOffset, useClock, wallClock, zoneName } from "../../../utils/clock"
import "./DateTimeProperties.css"

// Date/Time Properties, as opened from the taskbar clock: a calendar, a ticking analog clock
// and a time field on one tab, the time zone and its map on the other. A web page can't set
// the real clock, so OK and Apply set 98ish's own (utils/clock.js), which the taskbar shows.

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
const DAYS = ["S", "M", "T", "W", "T", "F", "S"]
const MIN_YEAR = 1980
const MAX_YEAR = 2099

const pad = (n) => String(n).padStart(2, "0")
const daysIn = (year, month) => new Date(year, month + 1, 0).getDate()

// a wall-clock Date (local fields = wall time) as plain milliseconds, free of this
// browser's own daylight saving
const wallMs = (d) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds())

// the zone list: the classic ones, plus this browser's own zone if it isn't one of them
const zoneOptions = () => {
  const here = localZone()
  const list = ZONES.map((z) => ({ ...z }))
  if (!list.some((z) => z.id === here)) list.push({ id: here, name: here.replace(/_/g, " ").replace(/\//g, " / "), lon: null, lat: null })
  return list
    .map((z) => ({ ...z, std: standardOffset(z.id) }))
    .sort((a, b) => a.std - b.std || a.name.localeCompare(b.name))
}

// ---- the clock face ----

const hand = (angle, length, width, tail = 6) => {
  // a long diamond, pointing at `angle` (degrees, clockwise from 12)
  const a = ((angle - 90) * Math.PI) / 180
  const px = Math.cos(a)
  const py = Math.sin(a)
  const nx = -py
  const ny = px
  const pt = (along, across) => `${(50 + px * along + nx * across).toFixed(2)},${(50 + py * along + ny * across).toFixed(2)}`
  return [pt(length, 0), pt(length * 0.3, width), pt(-tail, 0), pt(length * 0.3, -width)].join(" ")
}

export const AnalogClock = ({ time }) => {
  const s = time.getSeconds()
  const m = time.getMinutes() + s / 60
  const h = (time.getHours() % 12) + m / 60
  const second = ((s * 6 - 90) * Math.PI) / 180
  return (
    <svg className="dtClock" viewBox="0 0 100 100" role="img" aria-label={`Clock showing ${time.toLocaleTimeString("en-US")}`}>
      {Array.from({ length: 60 }, (_, i) => {
        const a = ((i * 6 - 90) * Math.PI) / 180
        const cx = 50 + Math.cos(a) * 42
        const cy = 50 + Math.sin(a) * 42
        return i % 5 ? (
          <rect key={i} x={cx - 0.8} y={cy - 0.8} width="1.6" height="1.6" fill="#000" />
        ) : (
          <g key={i}>
            <rect x={cx - 2.6} y={cy - 2.6} width="5.2" height="5.2" fill="#008080" />
            <rect x={cx - 2.6} y={cy - 2.6} width="5.2" height="1" fill="#80ffff" />
            <rect x={cx - 2.6} y={cy - 2.6} width="1" height="5.2" fill="#80ffff" />
            <rect x={cx - 2.6} y={cy + 1.6} width="5.2" height="1" fill="#004040" />
            <rect x={cx + 1.6} y={cy - 2.6} width="1" height="5.2" fill="#004040" />
          </g>
        )
      })}
      <polygon className="dtHourHand" points={hand(h * 30, 24, 3.6)} fill="#008080" stroke="#000" strokeWidth="0.8" strokeLinejoin="round" />
      <polygon className="dtMinuteHand" points={hand(m * 6, 35, 3.2)} fill="#008080" stroke="#000" strokeWidth="0.8" strokeLinejoin="round" />
      <line className="dtSecondHand" x1={50 - Math.cos(second) * 6} y1={50 - Math.sin(second) * 6} x2={50 + Math.cos(second) * 37} y2={50 + Math.sin(second) * 37} stroke="#000" strokeWidth="0.8" />
      <circle cx="50" cy="50" r="1.4" fill="#000" />
    </svg>
  )
}

// ---- spinners ----

const SpinButtons = ({ onStep, label }) => (
  <div className="dtSpinButtons">
    <button type="button" aria-label={`Increase ${label}`} onMouseDown={(e) => e.preventDefault()} onClick={() => onStep(1)}>
      <span className="dtArrow dtArrow--up" />
    </button>
    <button type="button" aria-label={`Decrease ${label}`} onMouseDown={(e) => e.preventDefault()} onClick={() => onStep(-1)}>
      <span className="dtArrow dtArrow--down" />
    </button>
  </div>
)

const YearSpinner = ({ year, onChange }) => {
  const [typed, setTyped] = useState(null)
  const commit = () => {
    const n = parseInt(typed, 10)
    if (n >= MIN_YEAR && n <= MAX_YEAR) onChange(n)
    setTyped(null)
  }
  return (
    <div className="dtSpin dtYear">
      <input
        aria-label="Year"
        inputMode="numeric"
        value={typed ?? year}
        maxLength={4}
        onChange={(e) => setTyped(e.target.value.replace(/\D/g, ""))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            commit()
          }
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault()
            setTyped(null)
            onChange(Math.min(MAX_YEAR, Math.max(MIN_YEAR, year + (e.key === "ArrowUp" ? 1 : -1))))
          }
        }}
      />
      <SpinButtons label="year" onStep={(d) => onChange(Math.min(MAX_YEAR, Math.max(MIN_YEAR, year + d)))} />
    </div>
  )
}

// h:mm:ss AM, one part at a time: click a part, then type or use the arrows
const TimeField = ({ time, onSet }) => {
  const [part, setPart] = useState(0)
  const typed = useRef({ part: -1, text: "", at: 0 })
  const refs = useRef([])
  const h24 = time.getHours()
  const pm = h24 >= 12
  const h12 = h24 % 12 || 12

  const step = (p, d) => {
    if (p === 0) {
      const next = ((h12 - 1 + d + 12) % 12) + 1
      onSet({ hours: (next % 12) + (pm ? 12 : 0) })
    }
    if (p === 1) onSet({ minutes: (time.getMinutes() + d + 60) % 60 })
    if (p === 2) onSet({ seconds: (time.getSeconds() + d + 60) % 60 })
    if (p === 3) onSet({ hours: (h24 + 12) % 24 })
  }

  const type = (p, digit) => {
    const now = Date.now()
    const t = typed.current
    let text = t.part === p && now - t.at < 1500 ? t.text + digit : digit
    const max = p === 0 ? 12 : 59
    if (Number(text) > max || text.length > 2) text = digit
    typed.current = { part: p, text, at: now }
    const n = Number(text)
    if (p === 0) {
      if (n < 1) return
      onSet({ hours: (n % 12) + (pm ? 12 : 0) })
    } else onSet(p === 1 ? { minutes: n } : { seconds: n })
    // two digits typed: on to the next part
    if (text.length === 2 && p < 2) focusPart(p + 1)
  }

  const focusPart = (p) => {
    setPart(p)
    refs.current[p]?.focus()
  }

  const onKeyDown = (p) => (e) => {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault()
      step(p, e.key === "ArrowUp" ? 1 : -1)
    } else if (e.key === "ArrowLeft" && p > 0) {
      e.preventDefault()
      focusPart(p - 1)
    } else if (e.key === "ArrowRight" && p < 3) {
      e.preventDefault()
      focusPart(p + 1)
    } else if (/^\d$/.test(e.key) && p < 3) {
      e.preventDefault()
      type(p, e.key)
    } else if (p === 3 && /^[ap]$/i.test(e.key)) {
      e.preventDefault()
      if ((e.key.toLowerCase() === "p") !== pm) step(3, 1)
    }
  }

  const texts = [String(h12), pad(time.getMinutes()), pad(time.getSeconds()), pm ? "PM" : "AM"]
  const labels = ["Hour", "Minute", "Second", "AM/PM"]

  return (
    <div className="dtSpin dtTimeField">
      <div className="dtTimeText" role="group" aria-label="Time">
        {texts.map((text, p) => (
          <React.Fragment key={p}>
            {p === 1 || p === 2 ? <span className="dtTimeSep">:</span> : p === 3 ? <span className="dtTimeSep">&nbsp;</span> : null}
            <span
              ref={(el) => (refs.current[p] = el)}
              className={part === p ? "dtTimePart is-active" : "dtTimePart"}
              role="spinbutton"
              aria-label={labels[p]}
              aria-valuetext={text}
              tabIndex={0}
              onFocus={() => setPart(p)}
              onPointerDown={() => setPart(p)}
              onKeyDown={onKeyDown(p)}
            >
              {text}
            </span>
          </React.Fragment>
        ))}
      </div>
      <SpinButtons label={labels[part].toLowerCase()} onStep={(d) => step(part, d)} />
    </div>
  )
}

// ---- the calendar ----

const Calendar = ({ year, month, day, onPick }) => {
  const first = new Date(year, month, 1).getDay()
  const count = daysIn(year, month)
  const cells = [...Array(first).fill(null), ...Array.from({ length: count }, (_, i) => i + 1)]
  while (cells.length < 42) cells.push(null)

  const onKeyDown = (e) => {
    const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }
    if (moves[e.key] === undefined) return
    e.preventDefault()
    const next = day + moves[e.key]
    if (next >= 1 && next <= count) onPick(next)
  }

  return (
    <div className="dtCalendar" role="grid" aria-label={`${MONTHS[month]} ${year}`} tabIndex={0} onKeyDown={onKeyDown}>
      {DAYS.map((d, i) => (
        <div key={`h${i}`} className="dtCalHead" role="columnheader">
          {d}
        </div>
      ))}
      {cells.map((d, i) =>
        d ? (
          <button key={i} type="button" tabIndex={-1} role="gridcell" aria-selected={d === day} className={d === day ? "dtDay is-selected" : "dtDay"} onClick={() => onPick(d)}>
            {d}
          </button>
        ) : (
          <div key={i} className="dtDay is-blank" />
        )
      )}
    </div>
  )
}

// ---- the dialog ----

const DateTimeProperties = ({ onClose }) => {
  useClock() // re-render every second
  const id = useId()
  const saved = getClockSettings()
  const zones = useMemo(zoneOptions, [])
  const [tab, setTab] = useState("date")
  const [zone, setZone] = useState(() => currentZone(saved))
  const [autoDst, setAutoDst] = useState(saved.autoDst !== false)
  const [delta, setDelta] = useState(0) // ms added to the saved offset by edits here

  const draft = { zone, autoDst, offset: saved.offset + delta }
  const time = wallClock(draft)
  const changed = delta !== 0 || zone !== currentZone(saved) || autoDst !== (saved.autoDst !== false)
  const zoneInfo = zones.find((z) => z.id === zone) || zones[0]
  const dst = observesDst(zone)

  // change some fields of the wall time (year, month, day, hours...), keeping the rest
  const setWall = (fields) => {
    const t = new Date(time)
    if (fields.year !== undefined || fields.month !== undefined) {
      const year = fields.year ?? t.getFullYear()
      const month = fields.month ?? t.getMonth()
      t.setDate(1)
      t.setFullYear(year)
      t.setMonth(month)
      t.setDate(Math.min(time.getDate(), daysIn(year, month)))
    }
    if (fields.day !== undefined) t.setDate(fields.day)
    if (fields.hours !== undefined) t.setHours(fields.hours)
    if (fields.minutes !== undefined) t.setMinutes(fields.minutes)
    if (fields.seconds !== undefined) t.setSeconds(fields.seconds)
    setDelta((d) => d + (wallMs(t) - wallMs(time)))
  }

  const apply = () => {
    setClockSettings({ zone: zone === localZone() ? null : zone, autoDst, offset: saved.offset + delta })
    setDelta(0)
  }

  const realTime = () => setDelta(-saved.offset)

  // clicking the map picks the nearest city
  const pickOnMap = ([lon, lat]) => {
    const near = zones
      .filter((z) => z.lon !== null)
      .map((z) => {
        const dl = Math.min(Math.abs(z.lon - lon), 360 - Math.abs(z.lon - lon))
        return [dl * dl + (z.lat - lat) * (z.lat - lat) * 0.5, z]
      })
      .sort((a, b) => a[0] - b[0])[0]
    if (near) setZone(near[1].id)
  }

  const now = Date.now() + saved.offset + delta
  // the map lights up where the zone is: its standard offset, 15 degrees an hour
  const mapHours = zoneInfo.std / 3600000

  return (
    <div className="dtRoot">
      <menu role="tablist" className="dtTabs">
        {[
          ["date", "Date & Time"],
          ["zone", "Time Zone"],
        ].map(([t, label]) => (
          <li key={t} role="tab" aria-selected={tab === t}>
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault()
                setTab(t)
              }}
            >
              {label}
            </a>
          </li>
        ))}
      </menu>

      <div className="window dtPanel" role="tabpanel">
        {tab === "date" && (
          <>
            <div className="dtDateTime">
              <fieldset className="dtGroup dtDate">
                <legend>Date</legend>
                <div className="dtDateRow">
                  <select aria-label="Month" value={time.getMonth()} onChange={(e) => setWall({ month: Number(e.target.value) })}>
                    {MONTHS.map((m, i) => (
                      <option key={m} value={i}>
                        {m}
                      </option>
                    ))}
                  </select>
                  <YearSpinner year={time.getFullYear()} onChange={(year) => setWall({ year })} />
                </div>
                <Calendar year={time.getFullYear()} month={time.getMonth()} day={time.getDate()} onPick={(day) => setWall({ day })} />
              </fieldset>
              <fieldset className="dtGroup dtTime">
                <legend>Time</legend>
                <AnalogClock time={time} />
                <TimeField time={time} onSet={setWall} />
                <button type="button" className="dtRealTime" disabled={Math.abs(saved.offset + delta) < 1000} onClick={realTime}>
                  Use real time
                </button>
              </fieldset>
            </div>
            <p className="dtZoneLine">Current time zone: {zoneName(zone, now, autoDst)}</p>
          </>
        )}

        {tab === "zone" && (
          <div className="dtZoneTab">
            <select aria-label="Time zone" className="dtZoneSelect" value={zone} onChange={(e) => setZone(e.target.value)}>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {gmtLabel(z.std)} {z.name}
                </option>
              ))}
            </select>
            <div className="dtMapFrame">
              <WorldMap offsetHours={mapHours} marker={zoneInfo.lon !== null ? zoneInfo : null} onPick={pickOnMap} />
            </div>
            <div className="field-row dtDstRow">
              <input id={`${id}-dst`} type="checkbox" checked={autoDst && dst} disabled={!dst} onChange={(e) => setAutoDst(e.target.checked)} />
              <label htmlFor={`${id}-dst`}>Automatically adjust clock for daylight saving changes</label>
            </div>
          </div>
        )}
      </div>

      <div className="dtButtons">
        <button
          type="button"
          className="default"
          onClick={() => {
            if (changed) apply()
            onClose?.()
          }}
        >
          OK
        </button>
        <button type="button" onClick={() => onClose?.()}>
          Cancel
        </button>
        <button type="button" disabled={!changed} onClick={apply}>
          Apply
        </button>
      </div>
    </div>
  )
}

export default DateTimeProperties
