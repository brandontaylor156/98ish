// Text editing on a plain { value, start, end } (a field's text and its selection), for the
// keyboard's fallback path (when the browser won't execCommand into a field) and for moving
// the caret. Pure: no DOM.

const segmenter = typeof Intl !== "undefined" && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null

const clampSel = ({ value, start, end }) => {
  const s = Math.max(0, Math.min(start ?? value.length, value.length))
  const e = Math.max(s, Math.min(end ?? s, value.length))
  return { value, start: s, end: e }
}

// the length of the character (grapheme: emoji, accented letters, flags) just before `at`
export const charBefore = (value, at) => {
  if (at <= 0) return 0
  if (segmenter) {
    let last = 0
    for (const { index } of segmenter.segment(value.slice(0, at))) last = index
    return at - last
  }
  const code = value.charCodeAt(at - 1)
  return code >= 0xdc00 && code <= 0xdfff && at > 1 ? 2 : 1
}

// Types `text` over the selection. maxLength (as on the field; -1 or missing = none) cuts
// what doesn't fit, as browsers do when you type.
export const insertText = (state, text, maxLength = -1) => {
  const { value, start, end } = clampSel(state)
  let add = text
  if (maxLength >= 0) {
    const room = maxLength - (value.length - (end - start))
    if (room <= 0) return { value, start, end, changed: false }
    if (add.length > room) add = add.slice(0, room)
  }
  const next = value.slice(0, start) + add + value.slice(end)
  const at = start + add.length
  return { value: next, start: at, end: at, changed: next !== value }
}

// Backspace: the selection, else the character before the caret
export const deleteBackward = (state) => {
  const { value, start, end } = clampSel(state)
  if (start !== end) return { value: value.slice(0, start) + value.slice(end), start, end: start, changed: true }
  const n = charBefore(value, start)
  if (!n) return { value, start, end, changed: false }
  return { value: value.slice(0, start - n) + value.slice(start), start: start - n, end: start - n, changed: true }
}

// where the word before `at` starts (spaces first, then the word, as Ctrl+Backspace)
export const wordStartBefore = (value, at) => {
  let i = at
  while (i > 0 && /\s/.test(value[i - 1])) i--
  if (i > 0 && /[\p{L}\p{N}_]/u.test(value[i - 1])) {
    while (i > 0 && /[\p{L}\p{N}_']/u.test(value[i - 1])) i--
  } else if (i > 0) i--
  return i
}

export const deleteWordBackward = (state) => {
  const { value, start, end } = clampSel(state)
  if (start !== end) return deleteBackward(state)
  const from = wordStartBefore(value, start)
  if (from === start) return { value, start, end, changed: false }
  return { value: value.slice(0, from) + value.slice(start), start: from, end: from, changed: true }
}

// the caret `by` characters left (negative) or right; a selection collapses toward the move
export const moveCaret = (state, by) => {
  const { value, start, end } = clampSel(state)
  if (start !== end && by) {
    const at = by < 0 ? start : end
    return { value, start: at, end: at }
  }
  let at = start
  for (let i = 0; i < Math.abs(by); i++) {
    if (by < 0) at -= charBefore(value, at) || 0
    else if (at < value.length) {
      // the grapheme after the caret
      let n = 1
      if (segmenter) {
        const first = segmenter.segment(value.slice(at)).containing(0)
        n = first ? first.segment.length : 1
      }
      at += n
    }
  }
  at = Math.max(0, Math.min(at, value.length))
  return { value, start: at, end: at }
}

// up (-1) or down (+1) a line in multi-line text, keeping the column (or `column` if given,
// as editors remember it across short lines). Returns the state plus the column used.
export const moveLine = (state, dir, column) => {
  const { value, start } = clampSel(state)
  const lineStart = value.lastIndexOf("\n", start - 1) + 1
  const col = column ?? start - lineStart
  let target
  if (dir < 0) {
    if (lineStart === 0) return { value, start: 0, end: 0, column: col }
    const prevStart = value.lastIndexOf("\n", lineStart - 2) + 1
    target = Math.min(prevStart + col, lineStart - 1)
  } else {
    const lineEnd = value.indexOf("\n", start)
    if (lineEnd < 0) return { value, start: value.length, end: value.length, column: col }
    const nextEnd = value.indexOf("\n", lineEnd + 1)
    target = Math.min(lineEnd + 1 + col, nextEnd < 0 ? value.length : nextEnd)
  }
  return { value, start: target, end: target, column: col }
}

// Should the next letter be a capital? `before` is the text before the caret; mode is the
// field's autocapitalize: "sentences" (default for text), "words", "characters", "none"
export const wantsCapital = (before, mode = "sentences") => {
  if (mode === "characters") return true
  if (mode === "none" || mode === "off") return false
  if (mode === "words") return before === "" || /\s$/.test(before)
  return before.trim() === "" || /[.!?]["')\]]*\s+$/.test(before) || /\n\s*$/.test(before)
}

// iOS's double-space shortcut: a second space right after a word turns the first into ". "
export const wantsPeriod = (before) => /[\p{L}\p{N}"')\]] $/u.test(before) && !/[.!?,;:] $/.test(before)
