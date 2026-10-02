import React from "react"
import { useClock } from "../../utils/clock"
import { useOpenGesture } from "../../hooks/useMediaQuery"

const pad = (n) => String(n).padStart(2, "0")

// The taskbar clock. It shows 98ish's clock (the time zone and time set in Date/Time
// Properties), and opens Date/Time Properties on a double-click (a tap on touch screens).
const DateAndTime = ({ onOpen }) => {
  const dt = useClock()
  const openGesture = useOpenGesture()

  return (
    <div className="status-bar" {...(onOpen ? openGesture(onOpen) : {})}>
      <p
        className="mb-0 small text-end status-bar-field date-and-time"
        title={dt.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
      >
        <span className="date-and-time-date">{dt.toDateString()} </span>
        {pad(dt.getHours())}:{pad(dt.getMinutes())}
      </p>
    </div>
  )
}

export default React.memo(DateAndTime)
