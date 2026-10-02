import React, { useEffect, useState } from "react"

const pad = (n) => String(n).padStart(2, "0")

const DateAndTime = () => {
  const [dt, setDt] = useState(new Date())

  useEffect(() => {
    const id = setInterval(() => setDt(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="status-bar">
      <p className="mb-0 small text-end status-bar-field date-and-time">
        <span className="date-and-time-date">{dt.toDateString()} </span>
        {pad(dt.getHours())}:{pad(dt.getMinutes())}
      </p>
    </div>
  )
}

export default React.memo(DateAndTime)
