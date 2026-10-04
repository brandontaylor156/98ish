import React, { useEffect, useRef } from "react"

// A panel over the Calendar or Clock window: a 98-style dialog on a computer, a sheet that
// slides up from the bottom on a phone. Escape closes it; so does a tap above a phone sheet
// when `dismissable` (details, not editors that would lose typing).
const Sheet = ({ title, mobile, onClose, footer, className = "", dismissable = false, children, label }) => {
  const ref = useRef(null)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return
      // the innermost sheet only
      const sheets = [...document.querySelectorAll(".calSheet")]
      if (sheets[sheets.length - 1] !== ref.current) return
      e.stopPropagation()
      onClose()
    }
    document.addEventListener("keydown", onKey, true)
    return () => document.removeEventListener("keydown", onKey, true)
  }, [onClose])
  return (
    <div
      className={`calBackdrop${mobile ? " calBackdropPhone" : ""}`}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && dismissable) onClose()
      }}
    >
      <div ref={ref} className={`window calSheet${mobile ? " calSheetPhone" : ""} ${className}`} role="dialog" aria-label={label || title}>
        <div className="title-bar">
          <div className="title-bar-text">{title}</div>
          <div className="title-bar-controls">
            <button type="button" aria-label="Close" onClick={onClose} />
          </div>
        </div>
        <div className="calSheetBody">{children}</div>
        {footer && <div className="calSheetFooter">{footer}</div>}
      </div>
    </div>
  )
}

export default Sheet
