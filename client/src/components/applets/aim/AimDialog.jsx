import React, { useEffect, useRef } from "react"

// A small 98-style dialog floating over the window it belongs to (Add Buddy, Away
// Message, Warn...). Enter submits, Escape cancels.
const AimDialog = ({ title, onOk, onCancel, okLabel = "OK", cancelLabel = "Cancel", okDisabled, children }) => {
  const ref = useRef(null)

  useEffect(() => {
    const first = ref.current?.querySelector("input, textarea, select, button")
    first?.focus({ preventScroll: true })
  }, [])

  return (
    <div className="aimDialogBackdrop" onMouseDown={(e) => e.stopPropagation()}>
      <form
        ref={ref}
        className="window aimDialog"
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
        <div className="window-body aimDialogBody">
          {children}
          <div className="aimDialogButtons">
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

export default AimDialog
