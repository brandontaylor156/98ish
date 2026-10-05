import React, { useEffect, useState } from "react"
import ContextMenu from "../../shared/ContextMenu"
import { launch } from "../../../utils/programs"
import { tempUnit } from "../../../utils/region"
import { useSettings } from "../../../utils/settings"
import { setWeatherPrefs, useWeatherPrefs } from "../../../utils/weatherPrefs"
import WeatherIcon from "./WeatherIcon"
import { conditionOf, temp } from "./weatherCore"
import { currentPlace, ensureForecast, useForecast } from "./weatherStore"
import "./Weather.css"

// The taskbar tray's weather (View > Show in Taskbar in Weather, or Taskbar Properties):
// the icon and temperature for the place Weather shows (just the icon on phones, to keep
// the taskbar tidy). Click opens Weather; right-click to refresh or hide it.

const REFRESH_MS = 15 * 60_000

const WeatherTray = ({ mobile, dispatch }) => {
  const prefs = useWeatherPrefs()
  const settings = useSettings()
  const place = currentPlace(prefs)
  const { entry } = useForecast(place?.id)
  const [menu, setMenu] = useState(null)

  useEffect(() => {
    if (!place) return
    ensureForecast(place.id)
    const timer = setInterval(() => document.visibilityState === "visible" && ensureForecast(place.id), REFRESH_MS)
    return () => clearInterval(timer)
  }, [place?.id])

  if (!place) return null
  const unit = tempUnit(settings.region)
  const cur = entry?.data?.current
  const c = cur ? conditionOf(cur.code, { isDay: cur.isDay, windKmh: cur.windKmh }) : { icon: "cloudy", label: "Getting the weather..." }
  const label = cur ? `${place.name}: ${temp(cur.tempC, unit)}${unit}, ${c.label}` : `${place.name}: ${c.label}`
  const open = () => dispatch?.({ type: "open_window", payload: launch("Weather") })
  const showMenu = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY })
  }

  return (
    <>
      <button type="button" className="trayIcon wxTray" title={label} aria-label={`Weather. ${label}`} data-temp={cur ? temp(cur.tempC, unit) : ""} onClick={open} onContextMenu={showMenu}>
        <WeatherIcon icon={c.icon} size={16} />
        {!mobile && cur && <span className="wxTrayTemp">{temp(cur.tempC, unit)}</span>}
      </button>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: "Open Weather", bold: true, onClick: open },
            { label: "Refresh", onClick: () => ensureForecast(place.id, { force: true }) },
            "-",
            { label: "Hide from Taskbar", onClick: () => setWeatherPrefs({ tray: false }) },
          ]}
        />
      )}
    </>
  )
}

export default WeatherTray
