// Typing into the focused field the way a hardware keyboard does: key events first (apps that
// handle keys see them), then, unless the app cancelled the key, its default action through
// the browser's editing commands (selection, maxlength, undo, beforeinput/input events), with
// a value-setter fallback for fields the browser won't edit that way.

import { deleteBackward, deleteWordBackward, insertText, moveCaret, moveLine, wordStartBefore } from "./editing"
import { afterEnter, enterAction, readField } from "./fields"

const CODES = {
  Enter: ["Enter", 13],
  Backspace: ["Backspace", 8],
  Tab: ["Tab", 9],
  Escape: ["Escape", 27],
  " ": ["Space", 32],
  ArrowLeft: ["ArrowLeft", 37],
  ArrowUp: ["ArrowUp", 38],
  ArrowRight: ["ArrowRight", 39],
  ArrowDown: ["ArrowDown", 40],
  Control: ["ControlLeft", 17],
  Shift: ["ShiftLeft", 16],
}

const PUNCT = { "-": ["Minus", 189], "=": ["Equal", 187], "[": ["BracketLeft", 219], "]": ["BracketRight", 221], "\\": ["Backslash", 220], ";": ["Semicolon", 186], "'": ["Quote", 222], ",": ["Comma", 188], ".": ["Period", 190], "/": ["Slash", 191], "`": ["Backquote", 192] }

// KeyboardEvent code and keyCode for a key, as a US keyboard reports them
export const codeFor = (key) => {
  if (CODES[key]) return CODES[key]
  if (key.length === 1) {
    const up = key.toUpperCase()
    if (/[A-Z]/.test(up) && up.length === 1) return [`Key${up}`, up.charCodeAt(0)]
    if (/[0-9]/.test(key)) return [`Digit${key}`, key.charCodeAt(0)]
    if (PUNCT[key]) return PUNCT[key]
  }
  return ["", 0]
}

// fires a key event on el; true if the app let it through (didn't preventDefault)
const fire = (el, type, key, mods = {}) => {
  const [code, keyCode] = codeFor(key)
  const charCode = type === "keypress" ? (key === "Enter" ? 13 : key.codePointAt(0)) : 0
  const ev = new KeyboardEvent(type, { key, code, bubbles: true, cancelable: true, composed: true, view: window, shiftKey: !!mods.shift, ctrlKey: !!mods.ctrl, metaKey: false, altKey: false, repeat: !!mods.repeat })
  // the legacy fields some code still reads (the constructor can't set them)
  const legacy = type === "keypress" ? charCode : keyCode
  try {
    Object.defineProperty(ev, "keyCode", { get: () => legacy })
    Object.defineProperty(ev, "which", { get: () => legacy })
    if (type === "keypress") Object.defineProperty(ev, "charCode", { get: () => charCode })
  } catch {
    // read-only in some browsers: fine
  }
  return el.dispatchEvent(ev)
}

const isTextControl = (el) => el.tagName === "INPUT" || el.tagName === "TEXTAREA"

// selection APIs throw on type=number/email in some browsers
const selectionOf = (el) => {
  try {
    if (typeof el.selectionStart === "number") return { start: el.selectionStart, end: el.selectionEnd }
  } catch {
    // no selection API on this type
  }
  return { start: el.value.length, end: el.value.length, none: true }
}

const setSelection = (el, start, end = start) => {
  try {
    el.setSelectionRange(start, end)
  } catch {
    // number/email: no caret to place
  }
}

// set a field's value so React notices: the prototype's setter (React's tracker wraps the
// instance's) and an input event
const setValue = (el, value, inputType, data = null) => {
  const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, "value").set
  setter.call(el, value)
  el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType, data }))
}

const maxLengthOf = (el) => (el.maxLength >= 0 ? el.maxLength : -1)

// does document.execCommand work in this field? (it does in text inputs, textareas and rich
// text in today's browsers; not in every input type everywhere)
const exec = (el, command, value) => {
  if (document.activeElement !== el && !el.contains(document.activeElement)) return false
  try {
    return document.execCommand(command, false, value)
  } catch {
    return false
  }
}

// ---- default actions ----

export const insert = (el, text) => {
  if (!isTextControl(el)) return exec(el, "insertText", text)
  const before = el.value
  const sel = selectionOf(el)
  // number fields too: their value reads "" while what's typed isn't a number yet ("-",
  // "12."), so only the browser's own editing can build one up
  if (exec(el, "insertText", text)) return true
  // the browser declined
  if (el.value !== before) return true
  const next = insertText({ value: before, ...sel }, text, maxLengthOf(el))
  if (!next.changed) return false
  setValue(el, next.value, "insertText", text)
  setSelection(el, next.start)
  return true
}

export const backspace = (el, word = false) => {
  if (!isTextControl(el)) {
    if (word) {
      const sel = window.getSelection()
      if (sel?.isCollapsed && sel.modify) sel.modify("extend", "backward", "word")
    }
    return exec(el, "delete")
  }
  const before = el.value
  const sel = selectionOf(el)
  if (word && !sel.none && sel.start === sel.end) setSelection(el, wordStartBefore(before, sel.start), sel.start)
  if (exec(el, "delete")) return true
  if (el.value !== before) return true
  const state = { value: before, ...selectionOf(el) }
  const next = word ? deleteWordBackward(state) : deleteBackward(state)
  if (!next.changed) return false
  setValue(el, next.value, word ? "deleteWordBackward" : "deleteContentBackward")
  setSelection(el, next.start)
  return true
}

// moves the caret: dx characters sideways, dy lines (multi-line fields). column: remembered
// across lines; returns the new column
export const moveBy = (el, dx, dy = 0, column) => {
  if (!isTextControl(el)) {
    const sel = window.getSelection()
    if (!sel?.modify) return column
    for (let i = 0; i < Math.abs(dx); i++) sel.modify("move", dx < 0 ? "backward" : "forward", "character")
    for (let i = 0; i < Math.abs(dy); i++) sel.modify("move", dy < 0 ? "backward" : "forward", "line")
    return column
  }
  const sel = selectionOf(el)
  if (sel.none) return column
  let state = { value: el.value, ...sel }
  let col = column
  if (dx) state = moveCaret(state, dx)
  if (dy && el.tagName === "TEXTAREA") {
    for (let i = 0; i < Math.abs(dy); i++) {
      state = moveLine(state, dy < 0 ? -1 : 1, col)
      col = state.column
    }
  }
  setSelection(el, state.start, state.end)
  return dx ? undefined : col
}

// the text before the caret (what auto-capitals and the ". " shortcut look at)
export const textBefore = (el, chars = 40) => {
  if (isTextControl(el)) {
    const sel = selectionOf(el)
    return el.value.slice(Math.max(0, sel.start - chars), sel.start)
  }
  const sel = window.getSelection()
  if (!sel?.rangeCount || !el.contains(sel.anchorNode)) return ""
  try {
    const range = document.createRange()
    range.selectNodeContents(el)
    const caret = sel.getRangeAt(0)
    range.setEnd(caret.startContainer, caret.startOffset)
    const text = range.toString()
    // at the start of a paragraph counts as after a new line
    const node = caret.startContainer.nodeType === 1 ? caret.startContainer : caret.startContainer.parentElement
    const block = node?.closest("p, div, li, h1, h2, h3, h4, h5, h6, blockquote, pre, td")
    if (block && el.contains(block)) {
      const head = document.createRange()
      head.selectNodeContents(block)
      head.setEnd(caret.startContainer, caret.startOffset)
      if (!head.toString()) return (text + "\n").slice(-chars)
    }
    return text.slice(-chars)
  } catch {
    return ""
  }
}

// the next text field in the same form (Enter on "Next")
const nextField = (el) => {
  const scope = el.form || el.closest("form, .dialog, [data-window-index]") || document
  const all = [...scope.querySelectorAll("input, textarea")].filter((f) => {
    const info = readField(f)
    return !info.disabled && !info.readOnly && (f.tagName === "TEXTAREA" || ["", "text", "search", "email", "url", "tel", "password", "number"].includes(info.type)) && (f.offsetWidth || f.offsetHeight)
  })
  return all[all.indexOf(el) + 1] || null
}

// a form's implicit submission, as Enter does in a single-line field
const submitForm = (el) => {
  const form = el.form || el.closest("form")
  if (!form) return false
  const button = form.querySelector("button[type=submit], button:not([type]), input[type=submit]")
  if (button?.disabled) return false
  if (form.requestSubmit) form.requestSubmit()
  else form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  return true
}

// ---- keys ----

// One key press on `el`. key: a character ("a", "É", ".com") or a key name (Enter,
// Backspace, Tab, Escape, Arrow*). mods: { shift, ctrl, repeat, word }. Returns what happened
// for the keyboard to follow up on: { typed, prevented, then: "hide" | "next" | null }
export const pressKey = (el, key, mods = {}) => {
  const result = { typed: false, prevented: false, then: null }
  if (!el) return result
  // ".com" and other strings: one keydown for the first character, as pasting-like keys do
  const eventKey = key.length > 1 && !CODES[key] ? "Unidentified" : key
  const down = fire(el, "keydown", eventKey, mods)
  let allowed = down
  const printable = key.length >= 1 && !CODES[key] ? true : key === " " || key === "Enter"
  if (allowed && printable && !mods.ctrl) allowed = fire(el, "keypress", eventKey === "Unidentified" ? key[0] : eventKey, mods)
  if (!allowed) {
    result.prevented = true
    fire(el, "keyup", eventKey, mods)
    return result
  }
  if (mods.ctrl) {
    // the editing shortcuts a phone has no other way to reach
    const letter = key.toLowerCase()
    if (letter === "a") isTextControl(el) ? el.select() : exec(el, "selectAll")
    if (letter === "z") exec(el, "undo")
    if (letter === "y") exec(el, "redo")
  } else if (key === "Backspace") {
    result.typed = backspace(el, mods.word)
  } else if (key === "Enter") {
    const info = readField(el)
    const action = enterAction(info)
    if (action === "newline") result.typed = insert(el, "\n")
    else if (action === "paragraph") result.typed = exec(el, mods.shift ? "insertLineBreak" : "insertParagraph")
    else if (action === "submit") submitForm(el)
    if (action === "submit" || action === "none") result.then = afterEnter(info)
  } else if (key === "Tab") {
    result.then = "next"
  } else if (key.startsWith("Arrow")) {
    const dx = key === "ArrowLeft" ? -1 : key === "ArrowRight" ? 1 : 0
    const dy = key === "ArrowUp" ? -1 : key === "ArrowDown" ? 1 : 0
    moveBy(el, dx, dy)
  } else if (key === " " || !CODES[key]) {
    result.typed = insert(el, key)
  }
  fire(el, "keyup", eventKey, mods)
  return result
}

// focus the field after el (Next, Tab); true if there was one
export const focusNext = (el) => {
  const next = nextField(el)
  if (!next) return false
  next.focus({ preventScroll: true })
  return true
}

export const undo = (el) => exec(el, "undo")
