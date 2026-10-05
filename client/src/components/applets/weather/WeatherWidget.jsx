import React, { useEffect, useRef, useState } from "react"
import { launch } from "../../../utils/programs"
import { tempUnit } from "../../../utils/region"
import { useSettings } from "../../../utils/settings"
import { setWeatherPrefs, useWeatherPrefs } from "../../../utils/weatherPrefs"
import WeatherIcon from "./WeatherIcon"
import { conditionOf, temp, weekdayOf } from "./weatherCore"
import { currentPlace, ensureForecast, useForecast } from "./weatherStore"
import "./Weather.css"

// A little weather panel on the desktop, Active Desktop style (Weather's View > Show on
// Desktop): now and the next three days. Drag it by its title bar on a computer (it sits at
// the top of the icons on phones); click it for Weather; its X takes it away.

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const REFRESH_MS = 15 * 60_000

const WeatherWidget = ({ mobile, dispatch }) => {
  const prefs = useWeatherPrefs()
  const settings = useSettings()
  const place = currentPlace(prefs)
  const { entry } = useForecast(place?.id)
  const [pos, setPos] = useState(prefs.widgetPos)
  const ref = useRef(null)
  const drag = useRef(null)

  useEffect(() => {
    if (!place) return
    ensureForecast(place.id)
    const timer = setInterval(() => document.visibilityState === "visible" && ensureForecast(place.id), REFRESH_MS)
    return () => clearInterval(timer)
  }, [place?.id])

  const open = () => dispatch?.({ type: "open_window", payload: launch("Weather") })

  // computers: drag by the title bar, kept inside the desktop
  const onPointerDown = (e) => {
    if (mobile || e.button !== 0 || e.target.closest("button")) return
    const box = ref.current.getBoundingClientRect()
    const parent = ref.current.parentElement.getBoundingClientRect()
    drag.current = { dx: e.clientX - box.left, dy: e.clientY - box.top, parent, w: box.width, h: box.height }
    e.currentTarget.setPointerCapture?.(e.pointerId)
    e.stopPropagation()
  }
  const onPointerMove = (e) => {
    const d = drag.current
    if (!d) return
    setPos({
      x: Math.min(Math.max(0, e.clientX - d.parent.left - d.dx), d.parent.width - d.w),
      y: Math.min(Math.max(0, e.clientY - d.parent.top - d.dy), d.parent.height - d.h),
    })
  }
  const onPointerUp = () => {
    if (!drag.current) return
    drag.current = null
    if (pos) setWeatherPrefs({ widgetPos: pos })
  }

  const unit = tempUnit(settings.region)
  const data = entry?.data
  const cur = data?.current
  const c = cur ? conditionOf(cur.code, { isDay: cur.isDay, windKmh: cur.windKmh }) : null
  const style = !mobile && pos ? { left: pos.x, top: pos.y, right: "auto" } : undefined

  return (
    <div ref={ref} className={`window wxWidget${mobile ? " is-mobile" : ""}`} style={style} data-weather-widget onContextMenu={(e) => e.stopPropagation()}>
      <div className="title-bar" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
        <div className="title-bar-text">{place ? place.name : "Weather"}</div>
        <div className="title-bar-controls">
          <button type="button" aria-label="Close" title="Take Weather off the desktop" onClick={() => setWeatherPrefs({ widget: false })} />
        </div>
      </div>
      <div className="window-body wxWidgetBody" role="button" tabIndex={0} onClick={open} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && open()} aria-label={cur ? `Weather in ${place.name}: ${temp(cur.tempC, unit)}, ${c.label}. Open Weather` : "Open Weather"}>
        {!place && <span>Click to choose a place.</span>}
        {place && !cur && <span>Getting the weather...</span>}
        {cur && (
          <>
            <WeatherIcon icon={c.icon} size={40} />
            <div className="wxWidgetText">
              <span className="wxWidgetTemp">{temp(cur.tempC, unit)}</span>
              <span>{c.label}</span>
            </div>
          </>
        )}
      </div>
      {data && (
        <div className="wxWidgetDays">
          {data.daily.slice(1, 4).map((d) => {
            const dc = conditionOf(d.code)
            return (
              <span key={d.date} title={dc.label}>
                {DAY_NAMES[weekdayOf(d.date)]}
                <WeatherIcon icon={dc.icon} size={20} />
                {temp(d.maxC, unit)}/{temp(d.minC, unit)}
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default WeatherWidget
