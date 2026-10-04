import React from "react"
import "./Simple.css"

// The row with a window's main action (Save, OK, Send). It sticks to the bottom of whatever
// scrolls (and above the home bar on phones), so the main action is never cut off however
// long the form above gets. Put it last inside the scrolling box, or after it.
//   align  "end" (OK Cancel, the Win98 way) or "stretch" (big buttons sharing the row)
const PrimaryBar = ({ children, align = "end", className = "", label = "Actions", ...rest }) => (
  <div className={`primaryBar primaryBar--${align} ${className}`} role="group" aria-label={label} {...rest}>
    {children}
  </div>
)

export default PrimaryBar
