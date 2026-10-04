import React from "react"
import { useClock } from "../../utils/clock"
import { useOpenGesture } from "../../hooks/useMediaQuery"
import { useSettings } from "../../utils/settings"
import { dateOrder, formatShortDate, formatTime } from "../../utils/region"

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

// The taskbar clock. It shows 98ish's clock (the time zone and time set in Date/Time
// Properties) in Regional Settings' 12- or 24-hour style, and opens Date/Time Properties on
// a double-click (a tap on touch screens).
const DateAndTime = ({ onOpen }) => {
  const dt = useClock()
  const openGesture = useOpenGesture()
  const { region } = useSettings()
  // the date beside it (wide screens): as before, unless a date order was chosen
  const date = region?.dateOrder && region.dateOrder !== "auto" ? `${DAY[dt.getDay()]} ${formatShortDate(dt.getFullYear(), dt.getMonth() + 1, dt.getDate(), region)}` : dt.toDateString()
  const time = formatTime(dt.getHours(), dt.getMinutes(), region)

  return (
    <div className="status-bar" {...(onOpen ? openGesture(onOpen) : {})}>
      <p
        className="mb-0 small text-end status-bar-field date-and-time"
        title={dt.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
        data-order={dateOrder(region)}
      >
        <span className="date-and-time-date">{date} </span>
        {time}
      </p>
    </div>
  )
}

export default React.memo(DateAndTime)
