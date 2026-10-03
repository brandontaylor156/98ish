import React, { useEffect, useId, useRef } from "react"
import { playSystemSound } from "../../utils/systemSounds"
import { flashOnBackdrop, useFloating } from "../../hooks/useFloating"
import "./shared.css"

const FOCUSABLE = "button:not(:disabled), input:not(:disabled):not([type=hidden]), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex='-1'])"

// A small 98-style dialog over the window it belongs to (Add Buddy, Away Message, Custom
// Field...). Enter submits, Escape cancels, Tab stays inside it. It opens centered over
// the window's content root (which must be position: relative) and drags by its title
// bar anywhere on the screen (hooks/useFloating.js). It is modal to its window: a
// see-through backdrop blocks the window's content, and a click there flashes the dialog.
// onNo adds a middle button ("Yes / No / Cancel", as in "Save changes?"); sound plays a
// system sound when it appears ("ding", "chord", "critical")
const Dialog = ({ title, onOk, onNo, onCancel, okLabel = "OK", noLabel = "No", cancelLabel = "Cancel", okDisabled, sound, children }) => {
  const ref = useRef(null)
  const floating = useFloating({ center: true, also: ref })
  const titleId = useId()
  // focus goes back where it was when the dialog closes
  const opener = useRef(undefined)
  if (opener.current === undefined) opener.current = typeof document === "undefined" ? null : document.activeElement

  useEffect(() => {
    if (sound) playSystemSound(sound)
    // the first field (text selected, ready to type over), else the OK button: never the
    // title bar's Close button, or Enter would cancel
    const form = ref.current
    const field = form?.querySelector(".dialogBody input:not([type=checkbox]):not([type=radio]):not([type=hidden]), .dialogBody textarea, .dialogBody select")
    const target = field || form?.querySelector(".dialogBody input, .dialogButtons button")
    target?.focus({ preventScroll: true })
    if (field?.select && field.type !== "file") field.select()
    const owner = form?.closest("[data-window-index]")
    return () => {
      // only if focus was left in the dialog (now gone): not if the app moved it on
      const now = document.activeElement
      if (now && now !== document.body && !form?.contains(now)) return
      // what had focus before, unless that was a title bar button (the Close that asked
      // "Save changes?") or is gone (a menu item): then the window's text box, if any
      let back = opener.current
      if (!back?.isConnected || form?.contains(back) || back === document.body || back.closest(".title-bar")) {
        back = !owner?.isConnected ? null : [...owner.querySelectorAll("textarea, [contenteditable='true'], input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file])")].find((el) => !el.closest(".dialog, [data-floating]") && (el.offsetWidth || el.offsetHeight))
      }
      back?.focus({ preventScroll: true })
    }
  }, [])

  // keep Tab inside the dialog, as Windows does
  const trapTab = (e) => {
    const all = [...ref.current.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetWidth || el.offsetHeight)
    if (!all.length) return
    const first = all[0]
    const last = all[all.length - 1]
    const at = document.activeElement
    if (e.shiftKey ? at === first || !ref.current.contains(at) : at === last) {
      e.preventDefault()
      ;(e.shiftKey ? last : first).focus({ preventScroll: true })
    }
  }

  return (
    <div
      className="dialogBackdrop"
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={flashOnBackdrop}
    >
      <form
        ref={floating}
        className="window dialog"
        role="dialog"
        aria-labelledby={titleId}
        onSubmit={(e) => {
          e.preventDefault()
          if (!okDisabled) onOk?.()
        }}
        onKeyDown={(e) => {
          // a plain message with only OK (alerts, Properties) closes on Escape too, as in
          // Windows; one with fields to fill in never submits that way
          if (e.key === "Escape") {
            if (onCancel) onCancel()
            else if (!onNo && !ref.current?.querySelector(".dialogBody input, .dialogBody textarea, .dialogBody select")) onOk?.()
          }
          if (e.key === "Tab") trapTab(e)
        }}
      >
        <div className="title-bar">
          <div className="title-bar-text" id={titleId}>{title}</div>
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
