import React, { useEffect, useRef } from "react"
import "./shared.css"

// A small 98-style dialog floating over the window it belongs to (Add Buddy, Away
// Message, Custom Field...). Enter submits, Escape cancels. The window's content root
// must be position: relative.
const Dialog = ({ title, onOk, onCancel, okLabel = "OK", cancelLabel = "Cancel", okDisabled, children }) => {
  const ref = useRef(null)

  useEffect(() => {
    const first = ref.current?.querySelector("input, textarea, select, button")
    first?.focus({ preventScroll: true })
  }, [])

  return (
    <div className="dialogBackdrop" onMouseDown={(e) => e.stopPropagation()}>
      <form
        ref={ref}
        className="window dialog"
        onSubmit={(e) => {
          e.preventDefault()
          if (!okDisabled) onOk?.()
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel?.()
        }}
      >
        <div className="title-bar">
          <div className="title-bar-text">{title}</div>
          {onCancel && (
            <div className="title-bar-controls">
              <button type="button" aria-label="Close" onClick={onCancel}></button>
            </div>
          )}
        </div>
        <div className="window-body dialogBody">
          {children}
          <div className="dialogButtons">
            {onOk && (
              <button type="submit" disabled={okDisabled}>
                {okLabel}
              </button>
            )}
            {onCancel && (
              <button type="button" onClick={onCancel}>
                {cancelLabel}
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  )
}

export default Dialog
