// Keeping the phone's own keyboard down, and bringing it back for one field.
// inputmode="none" lets a field focus for real (caret, selection, copy/paste) without the
// phone's keyboard. The app's own inputmode is kept in data-kb-inputmode (the keyboard reads
// it to pick a layout) and put back when the field lets go.

// When the user last touched the screen (or a key). Like iOS, a field that takes focus long
// after any touch (an IM window opening by itself, an app that loaded slowly) doesn't pop
// the keyboard up: tapping the field does.
let lastGesture = 0
let tapped = null // the field the last touch landed on (the keyboard may still be loading)
export const noteGesture = (field) => {
  lastGesture = performance.now()
  if (field !== undefined) tapped = field
}
// Runs fn once the tap in progress is over: just after its click (or shortly after the finger
// lifts when no click comes: a hold, a scroll). Bringing the keyboard up during the tap moves
// the page (phone windows end above the keyboard), and the mouse events a phone makes up at
// the end of a tap then landed on whatever had moved under the finger: in Appward's sign-in
// (a centered box with an autofocused field) the tap's mousedown hit the text above the
// field, focus left it, and the keyboard went away again. Returns a cancel function.
export const afterTap = (fn, win = globalThis.window) => {
  let done = false
  let timer = 0
  const cleanup = () => {
    clearTimeout(timer)
    win.removeEventListener("click", onClick, true)
    win.removeEventListener("pointerup", onUp, true)
    win.removeEventListener("pointercancel", onUp, true)
  }
  const go = () => {
    if (done) return
    done = true
    cleanup()
    fn()
  }
  const onClick = () => setTimeout(go, 0)
  const onUp = () => {
    clearTimeout(timer)
    timer = setTimeout(go, 450)
  }
  win.addEventListener("click", onClick, true)
  win.addEventListener("pointerup", onUp, true)
  win.addEventListener("pointercancel", onUp, true)
  timer = setTimeout(go, 2000) // a press that never ends (the app went to the background)
  return () => {
    done = true
    cleanup()
  }
}

// A field marked data-kb-auto (Speed Typist's race box) always wants the keyboard when it's
// typable and focused, touch or no touch: typing is the whole point of the screen. Our
// keyboard is a page element, so unlike the phone's it can come up without a gesture.
export const isAuto = (el) => !!el?.closest?.("[data-kb-auto]")

// App code: "this field has focus and wants the keyboard now" (it just turned typable, so no
// focus event came). Does nothing without the 98ish keyboard (a mouse, the phone's keyboard).
export const KB_WANT = "98ish:kb-want"
export const requestKeyboard = (el) => {
  if (el && el === document.activeElement) el.dispatchEvent(new CustomEvent(KB_WANT, { bubbles: true }))
}

// should a field that just took focus get the keyboard?
export const wantsKeyboard = (el, ms = 1000) => {
  if (isAuto(el)) return true
  const since = performance.now() - lastGesture
  return since < ms || (!!el && el === tapped && since < 15000)
}

export const suppress = (el) => {
  if (!el || el.dataset.kbNative) return
  if (el.getAttribute("inputmode") === "none" && "kbInputmode" in el.dataset) return
  if (!("kbInputmode" in el.dataset)) el.dataset.kbInputmode = el.getAttribute("inputmode") ?? ""
  el.setAttribute("inputmode", "none")
}

export const restore = (el) => {
  if (!el || !("kbInputmode" in el.dataset)) return
  const original = el.dataset.kbInputmode
  if (original) el.setAttribute("inputmode", original)
  else el.removeAttribute("inputmode")
  delete el.dataset.kbInputmode
}

// every field still marked (the setting changed, or the keyboard went away)
export const restoreAll = () => {
  document.querySelectorAll("[data-kb-inputmode]").forEach(restore)
  document.querySelectorAll("[data-kb-native]").forEach((el) => delete el.dataset.kbNative)
}

// Runs fn (a blur and re-focus) without the app seeing the focus events: nothing saves,
// closes or commits on that blur (Paint's text box, rename boxes...).
const FOCUS_EVENTS = ["blur", "focus", "focusin", "focusout"]
export const quietly = (fn) => {
  const stop = (e) => e.stopImmediatePropagation()
  FOCUS_EVENTS.forEach((type) => window.addEventListener(type, stop, true))
  try {
    fn()
  } finally {
    FOCUS_EVENTS.forEach((type) => window.removeEventListener(type, stop, true))
  }
}

// the selection, to put back after a quiet re-focus
const saveSelection = (el) => {
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
    try {
      return { start: el.selectionStart, end: el.selectionEnd, dir: el.selectionDirection }
    } catch {
      return null
    }
  }
  const sel = window.getSelection()
  return sel?.rangeCount ? { range: sel.getRangeAt(0).cloneRange() } : null
}

const putSelection = (el, saved) => {
  if (!saved) return
  try {
    if (saved.range) {
      const sel = window.getSelection()
      sel.removeAllRanges()
      sel.addRange(saved.range)
    } else if (saved.start != null) el.setSelectionRange(saved.start, saved.end, saved.dir || "none")
  } catch {
    // the field changed under us
  }
}

// The phone's keyboard for this field until it loses focus (emoji, dictation, other
// languages, password AutoFill). Must run inside a tap (iOS only shows its keyboard for a
// focus made during a user gesture).
export const switchToPhoneKeyboard = (el) => {
  if (!el) return
  el.dataset.kbNative = "1"
  restore(el)
  const saved = saveSelection(el)
  quietly(() => {
    el.blur()
    el.focus({ preventScroll: true })
  })
  putSelection(el, saved)
}
