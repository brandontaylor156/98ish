import React, { useEffect, useRef } from "react"
import { playSystemSound } from "../../utils/systemSounds"
import "./shared.css"

// A small 98-style dialog floating over the window it belongs to (Add Buddy, Away
// Message, Custom Field...). Enter submits, Escape cancels. The window's content root
// must be position: relative.
// onNo adds a middle button ("Yes / No / Cancel", as in "Save changes?"); sound plays a
// system sound when it appears ("ding", "chord", "critical")
const Dialog = ({ title, onOk, onNo, onCancel, okLabel = "OK", noLabel = "No", cancelLabel = "Cancel", okDisabled, sound, children }) => {
  const ref = useRef(null)

  useEffect(() => {
    if (sound) playSystemSound(sound)
    // the first field (text selected, ready to type over), else the OK button: never the
    // title bar's Close button, or Enter would cancel
    const field = ref.current?.querySelector(".dialogBody input:not([type=checkbox]):not([type=radio]):not([type=hidden]), .dialogBody textarea, .dialogBody select")
    const target = field || ref.current?.querySelector(".dialogBody input, .dialogButtons button")
    target?.focus({ preventScroll: true })
    if (field?.select && field.type !== "file") field.select()
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
            {onNo && (
              <button type="button" onClick={onNo}>
                {noLabel}
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
