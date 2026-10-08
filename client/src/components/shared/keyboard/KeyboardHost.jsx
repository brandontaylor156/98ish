import React, { Suspense, lazy, useEffect, useState } from "react"
import { useIsTouch } from "../../../hooks/useMediaQuery"
import { useSettings } from "../../../utils/settings"
import { textFieldFor } from "./fields"
import { KB_WANT, afterTap, noteGesture, restore, restoreAll, suppress } from "./native"

// The keyboard itself loads on the first tap into a text field
const Keyboard = lazy(() => import("./Keyboard"))

// Mounted once in App. On touch screens (unless Keyboard Properties says to use the phone's
// keyboard) it keeps the phone's keyboard down on every text field, from the touch that
// focuses it or the focus() call itself, and shows the 98ish keyboard. With a mouse it does
// nothing at all. See docs/keyboard.md.
const KeyboardHost = () => {
  const touch = useIsTouch()
  const { keyboard } = useSettings()
  const active = touch && keyboard !== "phone"
  const [wanted, setWanted] = useState(false)

  useEffect(() => {
    if (!active) return
    // before the tap focuses the field (iOS focuses on touchend)
    const onTouch = (e) => {
      const el = textFieldFor(e.target)
      noteGesture(el)
      if (!el) return
      suppress(el)
      // a field that was focused while read-only (Speed Typist's box during the countdown)
      // gets no new focus event when it's tapped: the tap itself asks for the keyboard
      // (once the tap is over: see afterTap)
      if (el === document.activeElement) afterTap(() => el === document.activeElement && setWanted(true))
    }
    const onUp = () => noteGesture()
    // focus from code (autoFocus, dialogs, MS-DOS): the attribute is in place before the
    // browser asks for a keyboard, after this task
    const onFocus = (e) => {
      const el = textFieldFor(e.target)
      if (!el) return
      suppress(el)
      setWanted(true)
    }
    // an app asking for the keyboard on its focused field (requestKeyboard)
    const onWant = (e) => {
      const el = textFieldFor(e.target)
      if (!el || el !== document.activeElement) return
      suppress(el)
      setWanted(true)
    }
    const onBlur = (e) => {
      const el = textFieldFor(e.target)
      if (!el) return
      // after the focus settles: a field that kept (or got back) focus stays as it is
      setTimeout(() => {
        if (document.activeElement === el) return
        restore(el)
        delete el.dataset.kbNative
      }, 0)
    }
    document.addEventListener("pointerdown", onTouch, true)
    document.addEventListener("touchstart", onTouch, { capture: true, passive: true })
    document.addEventListener("pointerup", onUp, true)
    document.addEventListener("focusin", onFocus, true)
    document.addEventListener("focusout", onBlur, true)
    document.addEventListener(KB_WANT, onWant)
    // a field focused before this ran
    const now = textFieldFor(document.activeElement)
    if (now) {
      suppress(now)
      setWanted(true)
    }
    return () => {
      document.removeEventListener("pointerdown", onTouch, true)
      document.removeEventListener("touchstart", onTouch, { capture: true })
      document.removeEventListener("pointerup", onUp, true)
      document.removeEventListener("focusin", onFocus, true)
      document.removeEventListener("focusout", onBlur, true)
      document.removeEventListener(KB_WANT, onWant)
      restoreAll()
    }
  }, [active])

  if (!active || !wanted) return null
  return (
    <Suspense fallback={null}>
      <Keyboard />
    </Suspense>
  )
}

export default KeyboardHost
