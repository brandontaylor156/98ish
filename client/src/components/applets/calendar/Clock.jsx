import React, { useEffect, useMemo, useState } from "react"
import { AnalogClock } from "../datetime/DateTimeProperties"
import { ZONES, currentZone, getClockSettings, useClock, wallClock, zoneOffset } from "../../../utils/clock"
import { WEEKDAYS_SHORT } from "./recur"
import { VIEW_EVENT, openCalendar } from "./store"
import {
  addAlarm,
  addCity,
  cancelTimer,
  pauseTimer,
  removeAlarm,
  removeCity,
  resumeTimer,
  startTimer,
  stopwatchElapsed,
  stopwatchLap,
  stopwatchReset,
  stopwatchStart,
  stopwatchStop,
  timerLeft,
  updateAlarm,
  useClockApp,
} from "./clockStore"
import CheckBox from "./CheckBox"
import { formatTime, uses24h } from "../../../utils/region"
import { useSettings } from "../../../utils/settings"
import "./Calendar.css"
import "./Clock.css"

// Clock: world clocks, alarms, a timer and a stopwatch. They run on 98ish's clock (Date/Time
// Properties); alarms and the timer ring from CalendarBridge, so closing this window doesn't
// stop them (closing 98ish does).

const TABS = [
  ["world", "World Clock"],
  ["alarm", "Alarm"],
  ["timer", "Timer"],
  ["stopwatch", "Stopwatch"],
]

const pad = (n) => String(n).padStart(2, "0")
const cityName = (zone) => zone.split("/").pop().replace(/_/g, " ")
// (12- or 24-hour, as Regional Settings say)
const time12 = (d) => formatTime(d.getHours(), d.getMinutes())
const clockText = (ms, tenths = false) => {
  const total = Math.max(0, ms)
  const h = Math.floor(total / 3_600_000)
  const m = Math.floor(total / 60_000) % 60
  const s = Math.floor(total / 1000) % 60
  const t = Math.floor(total / 100) % 10
  return `${h ? `${h}:${pad(m)}` : pad(m)}:${pad(s)}${tenths ? `.${t}` : ""}`
}

// re-render often while something counts
const useFrames = (on) => {
  const [, set] = useState(0)
  useEffect(() => {
    if (!on) return
    let id
    const loop = () => {
      set((n) => n + 1)
      id = requestAnimationFrame(loop)
    }
    id = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(id)
  }, [on])
}

const World = ({ mobile }) => {
  const app = useClockApp()
  const here = useClock()
  const [adding, setAdding] = useState("")
  const zone = currentZone()
  const real = Date.now() + (getClockSettings().offset || 0)
  const options = useMemo(() => [...ZONES].sort((a, b) => zoneOffset(a.id, real) - zoneOffset(b.id, real)), [])
  const hereDay = here.getDate()
  const rows = [{ zone, here: true }, ...app.cities.filter((c) => c !== zone).map((c) => ({ zone: c }))]
  return (
    <div className="ckWorld">
      <ul className="ckCities">
        {rows.map(({ zone: z, here: isHere }) => {
          const d = isHere ? here : wallClock({ ...getClockSettings(), zone: z, autoDst: true })
          const diff = Math.round((zoneOffset(z, real) - zoneOffset(zone, real)) / 3_600_000 * 2) / 2
          const day = d.getDate() === hereDay ? "Today" : d > here ? "Tomorrow" : "Yesterday"
          return (
            <li key={z} className={isHere ? "ckHere" : ""}>
              <div className="ckFace">
                <AnalogClock time={d} />
              </div>
              <div className="ckCity">
                <b>{isHere ? `${cityName(z)} (here)` : cityName(z)}</b>
                <span>
                  {day}
                  {isHere ? "" : `, ${diff === 0 ? "same time" : `${diff > 0 ? "+" : ""}${diff} hr${Math.abs(diff) === 1 ? "" : "s"}`}`}
                </span>
              </div>
              <div className="ckDigital">{time12(d)}</div>
              {!isHere && (
                <button type="button" className="ckRemove" aria-label={`Remove ${cityName(z)}`} onClick={() => removeCity(z)}>
                  ✕
                </button>
              )}
            </li>
          )
        })}
      </ul>
      {app.cities.length < 12 && (
        <div className="ckAdd">
          <select aria-label="Add a city" value={adding} onChange={(e) => setAdding(e.target.value)}>
            <option value="">Add a city...</option>
            {options
              .filter((z) => !app.cities.includes(z.id) && z.id !== zone)
              .map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
          </select>
          <button type="button" disabled={!adding} onClick={() => (addCity(adding), setAdding(""))}>
            Add
          </button>
        </div>
      )}
    </div>
  )
}

const DAY_SETS = [
  ["Once", []],
  ["Every day", [0, 1, 2, 3, 4, 5, 6]],
  ["Weekdays", [1, 2, 3, 4, 5]],
  ["Weekends", [0, 6]],
]

const daysText = (days) => {
  if (!days?.length) return "Once"
  const key = [...days].sort().join()
  const named = DAY_SETS.find(([, d]) => d.join() === key)
  return named ? named[0] : days.map((d) => WEEKDAYS_SHORT[d]).join(" ")
}

const Alarms = () => {
  const app = useClockApp()
  const [time, setTime] = useState("07:00")
  const [label, setLabel] = useState("")
  const [days, setDays] = useState([1, 2, 3, 4, 5])
  const sorted = [...app.alarms].sort((a, b) => a.time.localeCompare(b.time))
  return (
    <div className="ckAlarms">
      {sorted.length === 0 && <p className="calNote">No alarms yet. They ring while 98ish is open, even with this window closed.</p>}
      <ul className="ckAlarmList">
        {sorted.map((a) => {
          const [h, m] = a.time.split(":").map(Number)
          return (
            <li key={a.id} className={a.on ? "" : "ckOff"}>
              <CheckBox label={`Alarm ${a.time} on`} checked={a.on} onChange={(on) => updateAlarm(a.id, { on, lastRang: on ? null : a.lastRang })} />
              <span className="ckAlarmTime">
                {uses24h() ? `${pad(h)}:${pad(m)}` : `${h % 12 || 12}:${pad(m)}`}
                {!uses24h() && <small> {h < 12 ? "AM" : "PM"}</small>}
              </span>
              <span className="ckAlarmInfo">
                <b>{a.label || "Alarm"}</b>
                <span>{daysText(a.days)}</span>
              </span>
              <button type="button" aria-label={`Delete alarm ${a.time}`} onClick={() => removeAlarm(a.id)}>
                Delete
              </button>
            </li>
          )
        })}
      </ul>
      <fieldset className="calGroup ckNewAlarm">
        <legend>New alarm</legend>
        <div className="calWhen">
          <input type="time" aria-label="Alarm time" value={time} onChange={(e) => setTime(e.target.value)} />
          <input type="text" aria-label="Alarm label" value={label} maxLength={40} placeholder="Label (Wake up!)" onChange={(e) => setLabel(e.target.value)} />
        </div>
        <div className="calWeekdays" role="group" aria-label="Repeat on">
          {WEEKDAYS_SHORT.map((d, i) => {
            const on = days.includes(i)
            return (
              <button key={d} type="button" aria-pressed={on} className={on ? "calOn" : ""} onClick={() => setDays(on ? days.filter((x) => x !== i) : [...days, i].sort())}>
                {d.slice(0, 2)}
              </button>
            )
          })}
        </div>
        <p className="calNote">{days.length ? `Repeats: ${daysText(days)}` : "Rings once, then switches off."}</p>
        <button type="button" disabled={!time} onClick={() => addAlarm({ time, label: label.trim(), days })}>
          Add alarm
        </button>
      </fieldset>
    </div>
  )
}

const PRESETS = [1, 3, 5, 10, 15, 30, 60]

const Timer = () => {
  const app = useClockApp()
  const timer = app.timer
  useFrames(!!timer?.endsAt)
  const [h, setH] = useState(0)
  const [m, setM] = useState(5)
  const [s, setS] = useState(0)
  const [label, setLabel] = useState("")
  const left = timerLeft(timer)
  const number = (value, set, max, name) => (
    <label className="ckNum">
      <input type="number" aria-label={name} min="0" max={max} value={value} onChange={(e) => set(Math.max(0, Math.min(max, Math.floor(Number(e.target.value) || 0))))} />
      <span>{name}</span>
    </label>
  )
  return (
    <div className="ckTimer">
      <div className="ckLcd" role="timer" aria-live="off">
        {clockText(timer ? left : (h * 3600 + m * 60 + s) * 1000)}
      </div>
      {timer ? (
        <>
          {timer.label && <p className="ckLabel">{timer.label}</p>}
          <div className="ckButtons">
            {timer.endsAt ? (
              <button type="button" onClick={pauseTimer}>
                Pause
              </button>
            ) : (
              <button type="button" onClick={resumeTimer}>
                Resume
              </button>
            )}
            <button type="button" onClick={cancelTimer}>
              Cancel
            </button>
          </div>
          <div className="ckBar" aria-hidden="true">
            <div style={{ width: `${100 - (left / timer.duration) * 100}%` }} />
          </div>
        </>
      ) : (
        <>
          <div className="ckSetter">
            {number(h, setH, 23, "hours")}
            {number(m, setM, 59, "minutes")}
            {number(s, setS, 59, "seconds")}
          </div>
          <div className="ckPresets">
            {PRESETS.map((p) => (
              <button key={p} type="button" onClick={() => startTimer(p * 60_000, label.trim())}>
                {p < 60 ? `${p} min` : "1 hour"}
              </button>
            ))}
          </div>
          <input type="text" aria-label="Timer label" className="ckTimerLabel" value={label} maxLength={40} placeholder="Label (Pasta!)" onChange={(e) => setLabel(e.target.value)} />
          <div className="ckButtons">
            <button type="button" className="calPrimary" disabled={!(h || m || s)} onClick={() => startTimer((h * 3600 + m * 60 + s) * 1000, label.trim())}>
              Start
            </button>
          </div>
        </>
      )}
    </div>
  )
}

const Stopwatch = () => {
  const app = useClockApp()
  const sw = app.stopwatch
  const running = !!sw?.startedAt
  useFrames(running)
  const elapsed = stopwatchElapsed(sw)
  const laps = sw?.laps || []
  return (
    <div className="ckTimer">
      <div className="ckLcd" role="timer" aria-live="off">
        {clockText(elapsed, true)}
      </div>
      <div className="ckButtons">
        {running ? (
          <button type="button" className="calPrimary" onClick={stopwatchStop}>
            Stop
          </button>
        ) : (
          <button type="button" className="calPrimary" onClick={stopwatchStart}>
            {elapsed ? "Continue" : "Start"}
          </button>
        )}
        <button type="button" disabled={!running} onClick={stopwatchLap}>
          Lap
        </button>
        <button type="button" disabled={running || !elapsed} onClick={stopwatchReset}>
          Reset
        </button>
      </div>
      {laps.length > 0 && (
        <ol className="ckLaps" reversed>
          {laps.map((t, i) => (
            <li key={laps.length - i}>
              <span>Lap {laps.length - i}</span>
              <span>{clockText(t - (laps[i + 1] || 0), true)}</span>
              <span className="calNote">{clockText(t, true)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

const Clock = ({ mobile, clockTab }) => {
  useSettings() // Regional Settings: 12/24-hour times
  const [tab, setTab] = useState(clockTab || "world")
  useEffect(() => {
    const onView = (e) => e.detail?.program === "Clock" && e.detail.tab && setTab(e.detail.tab)
    window.addEventListener(VIEW_EVENT, onView)
    return () => window.removeEventListener(VIEW_EVENT, onView)
  }, [])
  return (
    <div className={`ckRoot${mobile ? " ckPhone" : ""}`}>
      <menu role="tablist" className="calTabs ckTabs">
        {TABS.map(([id, label]) => (
          <li key={id} role="tab" aria-selected={tab === id}>
            <a href="#" onClick={(e) => (e.preventDefault(), setTab(id))}>
              {label}
            </a>
          </li>
        ))}
      </menu>
      <div className="window ckPanel" role="tabpanel">
        <div className="window-body ckPanelBody">
          {tab === "world" && <World mobile={mobile} />}
          {tab === "alarm" && <Alarms />}
          {tab === "timer" && <Timer />}
          {tab === "stopwatch" && <Stopwatch />}
        </div>
      </div>
      <div className="ckFooter">
        <button type="button" onClick={() => openCalendar()}>
          Calendar...
        </button>
      </div>
    </div>
  )
}

export default Clock
