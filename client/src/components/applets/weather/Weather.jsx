import React, { useEffect, useRef, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import Dialog from "../../shared/Dialog"
import { helpItem } from "../../../utils/help"
import { setSettings, useSettings } from "../../../utils/settings"
import { formatHour, formatTime, tempUnit } from "../../../utils/region"
import { setWeatherPrefs, useWeatherPrefs } from "../../../utils/weatherPrefs"
import WeatherIcon from "./WeatherIcon"
import { ATTRIBUTION, ATTRIBUTION_URL, compass, conditionOf, parseLocal, placeLabel, temp, tempNumber, uvLabel, weekdayOf, wind } from "./weatherCore"
import { choosePlace, currentPlace, ensureForecast, forgetPlace, locate, savePlace, searchPlaces, useForecast } from "./weatherStore"
import "./Weather.css"

// 98ish Weather: the weather now, the next 24 hours and 7 days for your saved places, from
// Open-Meteo (free, no key). Opens on the place you looked at last; Places > Add Place...
// finds a city (or uses your location, from a tap). °F or °C follow Regional Settings
// (View switches them). View > Show in Taskbar / Show on Desktop put a small forecast in
// the tray and on the desktop.

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const ERRORS = {
  offline: "You're offline.",
  busy: "The weather service is busy.",
  server: "The weather service didn't answer.",
}

const clockOf = (iso) => {
  const t = parseLocal(iso)
  return t ? formatTime(t.h, t.mi) : "--"
}
const timeOfDay = (ms) => {
  const d = new Date(ms)
  return formatTime(d.getHours(), d.getMinutes())
}

// "Updated 2:14 PM" or "Offline: showing the forecast from 2:14 PM"
export const statusLine = (entry, error, now = Date.now()) => {
  if (!entry) return error ? ERRORS[error] || ERRORS.server : "Getting the forecast..."
  const d = new Date(entry.at)
  const when = new Date(now).toDateString() === d.toDateString() ? timeOfDay(entry.at) : `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${timeOfDay(entry.at)}`
  return error ? `${ERRORS[error] || ERRORS.server} Showing the forecast from ${when}.` : `Updated ${when}`
}

// ---- finding a place ----

const AddPlace = ({ onClose, first = false }) => {
  const [text, setText] = useState("")
  const [results, setResults] = useState(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)

  const search = async () => {
    if (text.trim().length < 2) return setMessage("Type at least two letters of a city or town.")
    setBusy(true)
    setMessage(null)
    const r = await searchPlaces(text)
    setBusy(false)
    if (!r.ok) return setMessage(r.error === "offline" ? "You're offline. Connect to the Internet and try again." : "The place finder didn't answer. Try again in a moment.")
    setResults(r.places)
    if (!r.places.length) setMessage(`No places called "${text.trim()}". Check the spelling, or try a bigger town nearby.`)
  }
  const pick = (place) => {
    savePlace(place)
    onClose()
  }
  // straight from the tap (phones only ask from one)
  const here = async () => {
    setBusy(true)
    setMessage("Finding where you are...")
    const r = await locate()
    setBusy(false)
    if (!r.ok) return setMessage(r.error)
    pick(r.place)
  }

  return (
    <Dialog title="Add a Place" onOk={search} okLabel="Search" onCancel={onClose} okDisabled={busy}>
      <div className="wxAdd">
        <p className="dialogText">{first ? "Which place's weather would you like? " : ""}Type a city or town, then choose it from the list.</p>
        <div className="field-row wxAddRow">
          <input type="text" aria-label="City or town" placeholder="City or town" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" enterKeyHint="search" maxLength={80} />
        </div>
        {results && results.length > 0 && (
          <ul className="wxResults" aria-label="Places found">
            {results.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => pick(p)} data-place={p.id}>
                  <b>{p.name}</b>
                  <span>{[p.admin, p.country].filter(Boolean).join(", ")}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {message && (
          <p className="dialogText wxMessage" role="status">
            {message}
          </p>
        )}
        <button type="button" className="wxHere" onClick={here} disabled={busy}>
          📍 Use My Location
        </button>
        <p className="dialogText wxPrivacy">98ish keeps only the place's name and its position rounded to about a kilometer.</p>
      </div>
    </Dialog>
  )
}

// ---- the window ----

const Weather = ({ mobile }) => {
  const prefs = useWeatherPrefs()
  const settings = useSettings()
  const unit = tempUnit(settings.region)
  const place = currentPlace(prefs)
  const { entry, loading, error } = useForecast(place?.id)
  const [dialog, setDialog] = useState(null) // "add" | "about" | "remove"
  const [, setTick] = useState(0)
  const hourlyRef = useRef(null)

  // fetch when stale: now, every 10 minutes while open, and when the connection comes back
  useEffect(() => {
    if (!place) return
    ensureForecast(place.id)
    const again = () => ensureForecast(place.id)
    const timer = setInterval(() => {
      again()
      setTick((n) => n + 1)
    }, 10 * 60_000)
    window.addEventListener("online", again)
    return () => {
      clearInterval(timer)
      window.removeEventListener("online", again)
    }
  }, [place?.id])

  // no place yet: ask for one
  useEffect(() => {
    if (!prefs.places.length) setDialog("add")
  }, [prefs.places.length])

  const setUnit = (u) => setSettings({ region: { ...settings.region, temp: u } })
  const data = entry?.data
  const cur = data?.current
  const today = data?.daily?.[0]
  const now = cur ? conditionOf(cur.code, { isDay: cur.isDay, windKmh: cur.windKmh }) : null

  const menus = [
    {
      label: "File",
      items: [
        { label: "Refresh F5", onClick: () => place && ensureForecast(place.id, { force: true }), disabled: !place },
        { label: "Add Place...", onClick: () => setDialog("add") },
      ],
    },
    {
      label: "View",
      items: [
        { label: "Fahrenheit (°F)", checked: unit === "F", onClick: () => setUnit("F") },
        { label: "Celsius (°C)", checked: unit === "C", onClick: () => setUnit("C") },
        "-",
        { label: "Show in Taskbar", checked: prefs.tray, onClick: () => setWeatherPrefs({ tray: !prefs.tray }) },
        { label: "Show on Desktop", checked: prefs.widget, onClick: () => setWeatherPrefs({ widget: !prefs.widget }) },
      ],
    },
    {
      label: "Places",
      items: [
        ...prefs.places.map((p) => ({ label: placeLabel(p, { short: true }), checked: p.id === place?.id, onClick: () => choosePlace(p.id) })),
        ...(prefs.places.length ? ["-"] : []),
        { label: "Add Place...", onClick: () => setDialog("add") },
        { label: `Remove ${place ? place.name : "Place"}...`, disabled: !place, onClick: () => setDialog("remove") },
      ],
    },
    {
      label: "Help",
      items: [helpItem({ program: "Weather" }), "-", { label: "About 98ish Weather", onClick: () => setDialog("about") }],
    },
  ]

  const onKeyDown = (e) => {
    if (e.key === "F5" && place) {
      e.preventDefault()
      ensureForecast(place.id, { force: true })
    }
  }

  return (
    <div className={`wxRoot${mobile ? " is-mobile" : ""}`} onKeyDown={onKeyDown} tabIndex={-1}>
      <MenuBar menus={menus} />
      <div className="wxBar">
        {prefs.places.length > 0 ? (
          <select aria-label="Place" className="wxPlace" value={place?.id || ""} onChange={(e) => choosePlace(e.target.value)}>
            {prefs.places.map((p) => (
              <option key={p.id} value={p.id}>
                {placeLabel(p)}
              </option>
            ))}
          </select>
        ) : (
          <span className="wxNoPlace">No place yet</span>
        )}
        <button type="button" className="wxAddBtn" onClick={() => setDialog("add")} title="Add a place" aria-label="Add a place">
          +
        </button>
        <span className="wxUnits" role="group" aria-label="Units">
          <button type="button" aria-pressed={unit === "F"} onClick={() => setUnit("F")}>
            °F
          </button>
          <button type="button" aria-pressed={unit === "C"} onClick={() => setUnit("C")}>
            °C
          </button>
        </span>
      </div>

      <div className="wxBody">
        {!place && (
          <div className="wxEmpty">
            <WeatherIcon icon="partly-day" size={96} />
            <p>Add a place to see its weather: your city, or someone's you're thinking of.</p>
            <button type="button" onClick={() => setDialog("add")}>
              Add a Place...
            </button>
          </div>
        )}

        {place && !data && (
          <div className="wxEmpty" role="status">
            <WeatherIcon icon="cloudy" size={64} />
            <p>{loading ? "Getting the forecast..." : statusLine(null, error)}</p>
            {!loading && (
              <button type="button" onClick={() => ensureForecast(place.id, { force: true })}>
                Try Again
              </button>
            )}
          </div>
        )}

        {place && data && cur && (
          <>
            <section className="wxNow" aria-label={`Weather now in ${place.name}`}>
              <WeatherIcon icon={now.icon} size={mobile ? 80 : 96} label={now.label} className="wxNowIcon" />
              <div className="wxNowMain">
                <div className="wxPlaceName">{place.name}</div>
                <div className="wxTemp" data-temp={tempNumber(cur.tempC, unit)}>
                  {temp(cur.tempC, unit)}
                  <span className="wxUnit">{unit}</span>
                </div>
                <div className="wxCond">{now.label}</div>
                <div className="wxHiLo">
                  H {temp(today?.maxC, unit)} · L {temp(today?.minC, unit)} · Feels like {temp(cur.feelsC, unit)}
                </div>
              </div>
            </section>

            <dl className="wxDetails">
              <div>
                <dt>Wind</dt>
                <dd>
                  {wind(cur.windKmh, unit)} {compass(cur.windDeg)}
                  {Number.isFinite(cur.gustKmh) && cur.gustKmh > (cur.windKmh || 0) + 8 ? `, gusts ${wind(cur.gustKmh, unit)}` : ""}
                </dd>
              </div>
              <div>
                <dt>Humidity</dt>
                <dd>{Number.isFinite(cur.humidity) ? `${Math.round(cur.humidity)}%` : "--"}</dd>
              </div>
              <div>
                <dt>UV index</dt>
                <dd>
                  {Number.isFinite(cur.uv) ? `${Math.round(cur.uv)} ${uvLabel(cur.uv)}` : `${uvLabel(today?.uv)}`}
                </dd>
              </div>
              <div>
                <dt>Rain chance</dt>
                <dd>{Number.isFinite(today?.pop) ? `${Math.round(today.pop)}%` : "--"}</dd>
              </div>
              <div>
                <dt>Sunrise</dt>
                <dd>{clockOf(today?.sunrise)}</dd>
              </div>
              <div>
                <dt>Sunset</dt>
                <dd>{clockOf(today?.sunset)}</dd>
              </div>
            </dl>

            <fieldset className="wxGroup">
              <legend>Next 24 hours</legend>
              <ol className="wxHours" ref={hourlyRef} aria-label="Hourly forecast">
                {data.hourly.map((h, i) => {
                  const t = parseLocal(h.time)
                  const c = conditionOf(h.code, { isDay: h.isDay })
                  return (
                    <li key={h.time} className="wxHour">
                      <span className="wxHourTime">{i === 0 ? "Now" : t ? formatHour(t.h) : ""}</span>
                      <WeatherIcon icon={c.icon} size={32} label={c.label} />
                      <span className="wxHourTemp">{temp(h.tempC, unit)}</span>
                      <span className="wxPop" title="Chance of rain or snow">
                        {Number.isFinite(h.pop) && h.pop >= 10 ? `${Math.round(h.pop)}%` : " "}
                      </span>
                    </li>
                  )
                })}
              </ol>
            </fieldset>

            <fieldset className="wxGroup">
              <legend>7 days</legend>
              <ol className="wxDays" aria-label="Daily forecast">
                {data.daily.map((d, i) => {
                  const c = conditionOf(d.code)
                  return (
                    <li key={d.date} className="wxDay">
                      <span className="wxDayName">{i === 0 ? "Today" : DAY_NAMES[weekdayOf(d.date)]}</span>
                      <WeatherIcon icon={c.icon} size={32} label={c.label} />
                      <span className="wxDayCond">{c.label}</span>
                      <span className="wxPop" title="Chance of rain or snow">
                        {Number.isFinite(d.pop) && d.pop >= 10 ? `💧${Math.round(d.pop)}%` : ""}
                      </span>
                      <span className="wxDayTemps">
                        <b>{temp(d.maxC, unit)}</b> <span>{temp(d.minC, unit)}</span>
                      </span>
                    </li>
                  )
                })}
              </ol>
            </fieldset>
          </>
        )}
      </div>

      <div className="wxStatus">
        <span className="wxStatusText" role="status" data-error={error || ""}>
          {place ? (loading && entry ? "Updating..." : statusLine(entry, error)) : "Ready"}
        </span>
        <a className="wxCredit" href={ATTRIBUTION_URL} target="_blank" rel="noreferrer noopener">
          {ATTRIBUTION}
        </a>
      </div>

      {dialog === "add" && <AddPlace first={!prefs.places.length} onClose={() => setDialog(null)} />}
      {dialog === "remove" && place && (
        <Dialog
          title="Remove Place"
          okLabel="Remove"
          onOk={() => {
            forgetPlace(place.id)
            setDialog(null)
          }}
          onCancel={() => setDialog(null)}
        >
          <p className="dialogText">Remove {placeLabel(place)} from your places?</p>
        </Dialog>
      )}
      {dialog === "about" && (
        <Dialog title="About 98ish Weather" onOk={() => setDialog(null)}>
          <div className="wxAbout">
            <WeatherIcon icon="partly-day" size={48} />
            <p className="dialogText">
              98ish Weather. Forecasts from <b>Open-Meteo.com</b>, free and open data under the CC BY 4.0 license, fetched straight from your browser. Forecasts are kept for 30 minutes, and the last one stays readable offline.
            </p>
          </div>
        </Dialog>
      )}
    </div>
  )
}

export default Weather
