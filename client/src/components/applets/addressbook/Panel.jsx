import React, { useEffect, useRef } from "react"

// A dialog over the Address Book window (a contact's Properties, Import, the picture chooser):
// centered on a computer, the whole window on a phone. Escape closes the top one.
const Panel = ({ title, mobile, onClose, footer, className = "", children }) => {
  const ref = useRef(null)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return
      const panels = [...document.querySelectorAll(".abPanel")]
      if (panels[panels.length - 1] !== ref.current) return
      e.stopPropagation()
      onClose()
    }
    document.addEventListener("keydown", onKey, true)
    return () => document.removeEventListener("keydown", onKey, true)
  }, [onClose])
  return (
    <div className={`abBackdrop${mobile ? " abBackdropPhone" : ""}`} onMouseDown={(e) => e.stopPropagation()}>
      <div ref={ref} className={`window abPanel${mobile ? " abPanelPhone" : ""} ${className}`} role="dialog" aria-label={title}>
        <div className="title-bar">
          <div className="title-bar-text">{title}</div>
          <div className="title-bar-controls">
            <button type="button" aria-label="Close" onClick={onClose} />
          </div>
        </div>
        <div className="abPanelBody">{children}</div>
        {footer && <div className="abPanelFooter">{footer}</div>}
      </div>
    </div>
  )
}

export default Panel
