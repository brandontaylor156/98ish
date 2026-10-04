import React, { forwardRef } from "react"
import { useIsTouch } from "../../../hooks/useMediaQuery"

// A password or PIN box for the lock screen, Log On and Passwords Properties.
// Passwords type with the 98ish keyboard on phones (or a physical keyboard). A PIN on a
// touch screen gets its own big number pad instead (the field stays focusable, so a
// Bluetooth keyboard still types; no on-screen keyboard opens over the pad).
const SecretField = forwardRef(({ id, kind, value, onChange, disabled, autoFocus, label, autoComplete = "current-password" }, ref) => {
  const touch = useIsTouch()
  const pad = kind === "pin" && touch
  const press = (key) => {
    if (disabled) return
    if (key === "back") onChange(value.slice(0, -1))
    else if (value.length < 12) onChange(value + key)
  }
  return (
    <div className="secretField">
      <input
        ref={ref}
        id={id}
        type="password"
        className="secretInput"
        value={value}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-label={label}
        autoComplete={autoComplete}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        inputMode={pad ? "none" : kind === "pin" ? "numeric" : undefined}
        pattern={kind === "pin" ? "[0-9]*" : undefined}
        enterKeyHint="go"
        maxLength={kind === "pin" ? 12 : 128}
        data-kb={pad ? "off" : undefined}
        onChange={(e) => onChange(kind === "pin" ? e.target.value.replace(/\D/g, "") : e.target.value)}
      />
      {pad && (
        <div className="pinPad" role="group" aria-label="PIN pad">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "back", "0", "ok"].map((key) =>
            key === "ok" ? (
              <button key={key} type="submit" className="pinKey pinOk" disabled={disabled} onPointerDown={(e) => e.preventDefault()}>
                OK
              </button>
            ) : (
              <button
                key={key}
                type="button"
                className={key === "back" ? "pinKey pinBack" : "pinKey"}
                aria-label={key === "back" ? "Delete" : key}
                disabled={disabled}
                // keep the focus (and the caret) in the field
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => press(key)}
              >
                {key === "back" ? "Del" : key}
              </button>
            )
          )}
        </div>
      )}
    </div>
  )
})

export default SecretField
