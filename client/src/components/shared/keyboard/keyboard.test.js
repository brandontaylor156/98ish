// Tests for the 98ish keyboard's pure parts: text editing on value + selection, which fields
// it types into and with which layout, what Enter says and does, the pages and long-press
// alternates.
// Run: node --test client/src/components/shared/keyboard/keyboard.test.js
import test from "node:test"
import assert from "node:assert/strict"
import { charBefore, deleteBackward, deleteWordBackward, insertText, moveCaret, moveLine, wantsCapital, wantsPeriod, wordStartBefore } from "./editing.js"
import { afterEnter, allowsShortcuts, capsMode, enterAction, enterLabel, isCredential, layoutFor, takesKeyboard } from "./fields.js"
import { ACCENTS, alternatesFor, rowUnits, rowsFor } from "./layouts.js"

const field = (over = {}) => ({ tag: "input", type: "", inputMode: "", enterKeyHint: "", autocapitalize: "", autocomplete: "", layout: "", kb: "", editable: false, readOnly: false, disabled: false, inForm: false, ...over })

// ---- editing ----

test("insertText types at the caret and replaces a selection", () => {
  assert.deepEqual(insertText({ value: "helo", start: 3, end: 3 }, "l"), { value: "hello", start: 4, end: 4, changed: true })
  assert.deepEqual(insertText({ value: "hello world", start: 6, end: 11 }, "there"), { value: "hello there", start: 11, end: 11, changed: true })
  assert.equal(insertText({ value: "", start: 0, end: 0 }, "é").value, "é")
})

test("insertText respects maxlength like typing does", () => {
  assert.equal(insertText({ value: "abcd", start: 4, end: 4 }, "e", 4).changed, false)
  assert.equal(insertText({ value: "abc", start: 3, end: 3 }, ".com", 5).value, "abc.c")
  // replacing a selection frees room
  assert.equal(insertText({ value: "abcd", start: 0, end: 4 }, "xy", 4).value, "xy")
})

test("insertText clamps a stale selection", () => {
  assert.equal(insertText({ value: "ab", start: 9, end: 9 }, "c").value, "abc")
})

test("deleteBackward removes the selection or one whole character", () => {
  assert.deepEqual(deleteBackward({ value: "hello", start: 5, end: 5 }), { value: "hell", start: 4, end: 4, changed: true })
  assert.deepEqual(deleteBackward({ value: "hello", start: 1, end: 4 }), { value: "ho", start: 1, end: 1, changed: true })
  assert.equal(deleteBackward({ value: "hi", start: 0, end: 0 }).changed, false)
  // an emoji with a skin tone, and a flag, are one character each
  assert.equal(deleteBackward({ value: "ok👍🏽", start: 6, end: 6 }).value, "ok")
  assert.equal(deleteBackward({ value: "x🇺🇸", start: 5, end: 5 }).value, "x")
  assert.equal(charBefore("e\u0301", 2), 2)
})

test("deleteWordBackward takes the word and the spaces after it", () => {
  assert.equal(deleteWordBackward({ value: "hello big world", start: 15, end: 15 }).value, "hello big ")
  assert.equal(deleteWordBackward({ value: "hello big ", start: 10, end: 10 }).value, "hello ")
  assert.equal(deleteWordBackward({ value: "C:\\GAMES", start: 8, end: 8 }).value, "C:\\")
  assert.equal(deleteWordBackward({ value: "don't", start: 5, end: 5 }).value, "")
  assert.equal(wordStartBefore("a !!", 4), 3)
})

test("moveCaret steps by characters and collapses selections", () => {
  assert.deepEqual(moveCaret({ value: "abc", start: 1, end: 1 }, 1), { value: "abc", start: 2, end: 2 })
  assert.deepEqual(moveCaret({ value: "abc", start: 0, end: 0 }, -1), { value: "abc", start: 0, end: 0 })
  assert.deepEqual(moveCaret({ value: "abc", start: 3, end: 3 }, 5), { value: "abc", start: 3, end: 3 })
  assert.deepEqual(moveCaret({ value: "abcdef", start: 1, end: 4 }, -1), { value: "abcdef", start: 1, end: 1 })
  assert.deepEqual(moveCaret({ value: "abcdef", start: 1, end: 4 }, 1), { value: "abcdef", start: 4, end: 4 })
  assert.equal(moveCaret({ value: "a👍🏽b", start: 1, end: 1 }, 1).start, 5)
})

test("moveLine keeps the column, clamps to short lines, and stops at the ends", () => {
  const text = "first line\nab\nthird line"
  const up = moveLine({ value: text, start: text.length, end: text.length }, -1)
  assert.equal(up.start, 13) // the end of "ab"
  assert.equal(up.column, 10)
  const upAgain = moveLine(up, -1, up.column)
  assert.equal(upAgain.start, 10) // column 10 of "first line"
  assert.equal(moveLine({ value: text, start: 3, end: 3 }, -1).start, 0)
  assert.equal(moveLine({ value: text, start: 1, end: 1 }, 1).start, 12)
  assert.equal(moveLine({ value: text, start: 20, end: 20 }, 1).start, text.length)
})

test("wantsCapital follows autocapitalize", () => {
  assert.equal(wantsCapital(""), true)
  assert.equal(wantsCapital("Hi there"), false)
  assert.equal(wantsCapital("Hi there. "), true)
  assert.equal(wantsCapital("Really?! "), true)
  assert.equal(wantsCapital("He said \"no.\" "), true)
  assert.equal(wantsCapital("line one\n"), true)
  assert.equal(wantsCapital("e.g."), false)
  assert.equal(wantsCapital("", "none"), false)
  assert.equal(wantsCapital("abc", "characters"), true)
  assert.equal(wantsCapital("new ", "words"), true)
  assert.equal(wantsCapital("new", "words"), false)
})

test("wantsPeriod: double space after a word", () => {
  assert.equal(wantsPeriod("hello "), true)
  assert.equal(wantsPeriod("hello. "), false)
  assert.equal(wantsPeriod("hello  "), false)
  assert.equal(wantsPeriod(" "), false)
  assert.equal(wantsPeriod("42 "), true)
})

// ---- fields ----

test("takesKeyboard: text fields yes; pickers, readonly and opted-out fields no", () => {
  for (const type of ["", "text", "search", "email", "url", "tel", "password", "number"]) assert.equal(takesKeyboard(field({ type })), true, type)
  for (const type of ["checkbox", "radio", "range", "color", "date", "time", "file", "submit", "button", "hidden"]) assert.equal(takesKeyboard(field({ type })), false, type)
  assert.equal(takesKeyboard(field({ tag: "textarea" })), true)
  assert.equal(takesKeyboard(field({ tag: "div", editable: true })), true)
  assert.equal(takesKeyboard(field({ tag: "div" })), false)
  assert.equal(takesKeyboard(field({ tag: "select" })), false)
  assert.equal(takesKeyboard(field({ readOnly: true })), false)
  assert.equal(takesKeyboard(field({ disabled: true })), false)
  assert.equal(takesKeyboard(field({ kb: "off" })), false)
  assert.equal(takesKeyboard(null), false)
})

test("layoutFor picks the page from type and inputmode", () => {
  assert.deepEqual(layoutFor(field()), { page: "letters", variant: "text" })
  assert.deepEqual(layoutFor(field({ type: "email" })), { page: "letters", variant: "email" })
  assert.deepEqual(layoutFor(field({ inputMode: "url" })), { page: "letters", variant: "url" })
  assert.deepEqual(layoutFor(field({ type: "url" })), { page: "letters", variant: "url" })
  assert.deepEqual(layoutFor(field({ type: "number" })), { page: "numpad", variant: "number" })
  assert.deepEqual(layoutFor(field({ inputMode: "numeric" })), { page: "numpad", variant: "number" })
  assert.deepEqual(layoutFor(field({ inputMode: "decimal" })), { page: "numpad", variant: "decimal" })
  assert.deepEqual(layoutFor(field({ type: "tel" })), { page: "numpad", variant: "tel" })
  assert.deepEqual(layoutFor(field({ layout: "dos" })), { page: "dos", variant: "dos" })
  assert.deepEqual(layoutFor(field({ tag: "textarea" })), { page: "letters", variant: "text" })
})

test("enterLabel: the hint, else what the field is", () => {
  assert.equal(enterLabel(field({ enterKeyHint: "send", tag: "textarea" })), "Send")
  assert.equal(enterLabel(field({ enterKeyHint: "go" })), "Go")
  assert.equal(enterLabel(field({ enterKeyHint: "next" })), "Next")
  assert.equal(enterLabel(field({ type: "search" })), "Search")
  assert.equal(enterLabel(field({ inputMode: "url" })), "Go")
  assert.equal(enterLabel(field({ tag: "textarea" })), "Return")
  assert.equal(enterLabel(field({ tag: "div", editable: true })), "Return")
  assert.equal(enterLabel(field({ layout: "dos", enterKeyHint: "go" })), "Enter")
  assert.equal(enterLabel(field()), "Enter")
})

test("enterAction and afterEnter", () => {
  assert.equal(enterAction(field({ tag: "textarea" })), "newline")
  assert.equal(enterAction(field({ tag: "div", editable: true })), "paragraph")
  assert.equal(enterAction(field({ inForm: true })), "submit")
  assert.equal(enterAction(field()), "none")
  assert.equal(afterEnter(field({ inForm: true })), "hide")
  assert.equal(afterEnter(field({ inForm: true, enterKeyHint: "send" })), "keep")
  assert.equal(afterEnter(field({ enterKeyHint: "next" })), "next")
  assert.equal(afterEnter(field({ enterKeyHint: "go" })), "hide")
  assert.equal(afterEnter(field()), "keep")
  assert.equal(afterEnter(field({ tag: "textarea", inForm: true })), "keep")
  assert.equal(afterEnter(field({ layout: "dos" })), "keep")
})

test("capsMode: browser defaults and the field's own say", () => {
  assert.equal(capsMode(field()), "sentences")
  assert.equal(capsMode(field({ tag: "textarea" })), "sentences")
  assert.equal(capsMode(field({ autocapitalize: "off" })), "none")
  assert.equal(capsMode(field({ autocapitalize: "none" })), "none")
  assert.equal(capsMode(field({ autocapitalize: "words" })), "words")
  assert.equal(capsMode(field({ type: "email" })), "none")
  assert.equal(capsMode(field({ type: "password" })), "none")
  assert.equal(capsMode(field({ inputMode: "url" })), "none")
  assert.equal(capsMode(field({ autocomplete: "username" })), "none")
  assert.equal(capsMode(field({ layout: "dos" })), "none")
  assert.equal(allowsShortcuts(field()), true)
  assert.equal(allowsShortcuts(field({ type: "password" })), false)
})

test("isCredential: password fields and sign-in autocomplete", () => {
  assert.equal(isCredential(field({ type: "password" })), true)
  assert.equal(isCredential(field({ autocomplete: "username" })), true)
  assert.equal(isCredential(field({ autocomplete: "one-time-code" })), true)
  assert.equal(isCredential(field({ autocomplete: "off" })), false)
  assert.equal(isCredential(field()), false)
})

// ---- layouts ----

test("every page's rows fill the same width", () => {
  for (const wide of [false, true]) {
    for (const [page, variant] of [["letters", "text"], ["letters", "email"], ["letters", "url"], ["numbers"], ["symbols"]]) {
      const rows = rowsFor(page, variant, wide)
      assert.equal(rows.length, 4, `${page} ${variant}`)
      const top = rowUnits([rows[0]])
      for (const row of [rows[0], rows[2], rows[3]]) {
        const units = row.reduce((s, key) => s + (key.w || 1), 0)
        assert.ok(Math.abs(units - top) < 0.01, `${page} ${variant} ${wide}: ${units} vs ${top}`)
      }
    }
  }
})

test("pages have the keys they need", () => {
  const flat = (rows) => rows.flat()
  const letters = flat(rowsFor("letters", "text"))
  assert.equal(letters.filter((key) => key.kind === "char" && /[a-z]/.test(key.value)).length, 26)
  for (const kind of ["shift", "back", "enter", "space", "page"]) assert.ok(letters.some((key) => key.kind === kind), kind)
  assert.ok(flat(rowsFor("letters", "email")).some((key) => key.value === "@"))
  assert.ok(flat(rowsFor("letters", "url")).some((key) => key.value === ".com"))
  assert.ok(flat(rowsFor("letters", "text", true)).some((key) => key.value === "ArrowLeft"))
  assert.equal(flat(rowsFor("numbers")).filter((key) => /[0-9]/.test(key.value) && key.kind === "char").length, 10)
  assert.ok(flat(rowsFor("numbers")).some((key) => key.kind === "undo"))
  const dos = flat(rowsFor("dos"))
  for (const value of ["Escape", "Tab", "Control", "ArrowUp", "ArrowDown", "\\", ":"]) assert.ok(dos.some((key) => key.value === value), value)
  for (const variant of ["number", "decimal", "tel"]) {
    const pad = flat(rowsFor("numpad", variant))
    assert.equal(pad.filter((key) => /^[0-9]$/.test(key.value)).length, 10, variant)
    assert.ok(pad.some((key) => key.kind === "back") && pad.some((key) => key.kind === "enter") && pad.some((key) => key.value === "letters"), variant)
  }
  assert.ok(flat(rowsFor("numpad", "tel")).some((key) => key.value === "#"))
  assert.ok(flat(rowsFor("numpad", "decimal")).some((key) => key.value === "."))
})

test("long-press alternates", () => {
  assert.ok(alternatesFor("e").includes("é"))
  assert.ok(alternatesFor("n").includes("ñ"))
  assert.ok(alternatesFor("u").includes("ü"))
  assert.ok(alternatesFor("E", true).includes("É"))
  assert.ok(!alternatesFor("s", true).includes("SS"))
  assert.ok(alternatesFor("$").includes("€"))
  assert.ok(alternatesFor(".com").includes(".org"))
  assert.ok(alternatesFor("0").includes("+"))
  assert.deepEqual(alternatesFor("q"), [])
  // every alternate is different from its key
  for (const [key, list] of Object.entries(ACCENTS)) for (const alt of list) assert.notEqual(alt, key)
})
