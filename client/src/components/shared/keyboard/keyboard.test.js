// Tests for the 98ish keyboard's pure parts: text editing on value + selection, which fields
// it types into and with which layout, what Enter says and does, the pages and long-press
// alternates, the iPhone geometry (key places per screen width, hit testing, the balloon),
// Delete's repeat timing.
// Run: node --test client/src/components/shared/keyboard/keyboard.test.js
import test from "node:test"
import assert from "node:assert/strict"
import { charBefore, deleteBackward, deleteWordBackward, insertText, moveCaret, moveLine, wantsCapital, wantsPeriod, wordStartBefore } from "./editing.js"
import { afterEnter, allowsShortcuts, capsMode, enterAction, enterLabel, isCredential, layoutFor, takesKeyboard } from "./fields.js"
import { ACCENTS, alternatesFor, rowsFor } from "./layouts.js"
import { WORDS_AFTER, balloonFor, deleteRepeat, hitTest, keysHeight, layoutKeys, metricsFor, stripFor, stripIndex } from "./geometry.js"

const field = (over = {}) => ({ tag: "input", type: "", inputMode: "", enterKeyHint: "", autocapitalize: "", autocomplete: "", pattern: "", layout: "", kb: "", editable: false, readOnly: false, disabled: false, inForm: false, ...over })

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
  // iOS: type=number is the full keyboard on its 123 page; a digits pattern gets the pad
  assert.deepEqual(layoutFor(field({ type: "number" })), { page: "numbers", variant: "text" })
  assert.deepEqual(layoutFor(field({ type: "number", pattern: "[0-9]*" })), { page: "numpad", variant: "number" })
  assert.deepEqual(layoutFor(field({ type: "number", pattern: "\\d*" })), { page: "numpad", variant: "number" })
  assert.deepEqual(layoutFor(field({ type: "number", inputMode: "numeric" })), { page: "numpad", variant: "number" })
  assert.deepEqual(layoutFor(field({ inputMode: "numeric" })),{ page: "numpad", variant: "number" })
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

test("pages have the iPhone's keys", () => {
  const flat = (rows) => rows.flat()
  const values = (row) => row.map((key) => key.value).join(" ")
  const letters = rowsFor("letters", "text")
  assert.equal(values(letters[0]), "q w e r t y u i o p")
  assert.equal(values(letters[1]), "a s d f g h j k l")
  assert.equal(values(letters[2]), "Shift z x c v b n m Backspace")
  assert.deepEqual(letters[3].map((key) => key.kind), ["page", "space", "enter"])
  const numbers = rowsFor("numbers")
  assert.equal(values(numbers[0]), "1 2 3 4 5 6 7 8 9 0")
  assert.equal(values(numbers[1]), "- / : ; ( ) $ & @ \"")
  assert.equal(values(numbers[2]), "symbols . , ? ! ' Backspace")
  assert.deepEqual(numbers[3].map((key) => key.label || key.kind), ["ABC", "space", "enter"])
  const symbols = rowsFor("symbols")
  assert.equal(values(symbols[0]), "[ ] { } # % ^ * + =")
  assert.equal(values(symbols[1]), "_ \\ | ~ < > € £ ¥ •")
  assert.equal(values(symbols[2]), "numbers . , ? ! ' Backspace")
  // no emoji/globe slot (it switched to the phone's keyboard, with no way back): the space bar
  // takes it. email: @ and . beside the space bar; url: . / .com and no space bar (as iOS)
  assert.deepEqual(rowsFor("letters", "email")[3].map((key) => key.value), ["numbers", " ", "@", ".", "Enter"])
  assert.deepEqual(rowsFor("letters", "url")[3].map((key) => key.value), ["numbers", ".", "/", ".com", "Enter"])
  // phones have no arrow keys (tablets do)
  assert.ok(!flat(rowsFor("letters", "text")).some((key) => key.value === "ArrowLeft"))
  assert.ok(flat(rowsFor("letters", "text", true)).some((key) => key.value === "ArrowLeft"))
  const dos = flat(rowsFor("dos"))
  for (const value of ["Escape", "Tab", "Control", "ArrowUp", "ArrowDown", "\\", ":"]) assert.ok(dos.some((key) => key.value === value), value)
  // number pads: 1-9, then the corner, 0, Delete; no return key (the title bar has it)
  for (const variant of ["number", "decimal", "tel"]) {
    const pad = rowsFor("numpad", variant)
    assert.equal(values(pad[0]) + " " + values(pad[1]) + " " + values(pad[2]), "1 2 3 4 5 6 7 8 9", variant)
    assert.deepEqual(pad[3].slice(1).map((key) => key.value), ["0", "Backspace"], variant)
  }
  assert.equal(rowsFor("numpad", "number")[3][0].kind, "blank")
  assert.equal(rowsFor("numpad", "decimal")[3][0].value, ".")
  assert.equal(rowsFor("numpad", "tel")[3][0].label, "+*#")
  assert.ok(flat(rowsFor("telsym")).some((key) => key.value === "#"))
})

test("long-press alternates: the key's own first, then iOS's list", () => {
  assert.deepEqual(alternatesFor("e"), ["e", "è", "é", "ê", "ë", "ē", "ė", "ę"])
  assert.ok(alternatesFor("n").includes("ñ"))
  assert.ok(alternatesFor("u").includes("ü"))
  assert.deepEqual(alternatesFor("E", true).slice(0, 3), ["E", "È", "É"])
  assert.ok(!alternatesFor("s", true).includes("SS"))
  assert.ok(alternatesFor("$").includes("€"))
  assert.ok(alternatesFor(".com").includes(".org"))
  assert.ok(alternatesFor("0").includes("°"))
  assert.ok(alternatesFor("=").includes("≠"))
  assert.deepEqual(alternatesFor("q"), [])
  // every alternate is different from its key
  for (const [key, list] of Object.entries(ACCENTS)) for (const alt of list) assert.notEqual(alt, key)
})

// ---- geometry ----

const near = (a, b, label, tol = 2) => assert.ok(Math.abs(a - b) <= tol, `${label}: ${a} vs ${b}`)
const place = (page, width, opts = {}) => {
  const rows = rowsFor(page, opts.variant || "text")
  const m = metricsFor({ width, landscape: !!opts.landscape, numpad: page === "numpad" })
  return { keys: layoutKeys(rows, m), m, rows }
}
const capOf = (keys, value) => keys.find((k) => k.key.value === value || k.key.label === value).cap

// The iPhone reference, worked out by hand from the published iOS measurements (see the top
// of geometry.js): x and width of the drawn keys, and the rows' tops.
//   375 (iPhone 13 mini / SE): the classic 3 + 10 x 31.5 + 9 x 6 + 3
//   390 (iPhone 12-16): letter slot 39, key 33; Shift 13% = 50.7 (key 44.7); 123 12.3% =
//       47.97 (key 41.97); return 25% = 97.5 (key 91.5)
//   430 (Pro Max): letter 37; rows 56 apart, keys 45 tall
const IOS_REF = {
  375: { q: [3, 31.5], w: [40.5, 31.5], p: [340.5, 31.5], a: [21.75, 31.5], shift: [3, 42.75], z: [59.25, 31.5], Backspace: [329.25, 42.75], 123: [3, 40.13], ret: [284.25, 87.75], rows: [6, 60, 114, 168], keyH: 42 },
  390: { q: [3, 33], w: [42, 33], p: [354, 33], a: [22.5, 33], l: [334.5, 33], shift: [3, 44.7], z: [61.5, 33], m: [295.5, 33], Backspace: [342.3, 44.7], 123: [3, 41.97], space: [50.97, 238.53], ret: [295.5, 91.5], rows: [6, 60, 114, 168], keyH: 42 },
  393: { q: [3, 33.3], p: [356.7, 33.3], a: [22.65, 33.3], shift: [3, 45.09], ret: [297.75, 92.25], rows: [6, 60, 114, 168], keyH: 42 },
  402: { q: [3, 34.2], p: [364.8, 34.2], a: [23.1, 34.2], shift: [3, 46.26], ret: [304.5, 94.5], rows: [6, 60, 114, 168], keyH: 42 },
  430: { q: [3, 37], p: [390, 37], a: [24.5, 37], shift: [3, 49.9], ret: [325.5, 101.5], rows: [5.5, 61.5, 117.5, 173.5], keyH: 45 },
}

test("letter keys sit where the iPhone's do (375, 390, 393, 402, 430 wide)", () => {
  for (const [width, ref] of Object.entries(IOS_REF)) {
    const { keys, m, rows } = place("letters", Number(width))
    for (const [name, spot] of Object.entries(ref)) {
      if (name === "rows" || name === "keyH") continue
      const [x, w] = spot
      const cap = name === "ret" ? keys.find((k) => k.key.kind === "enter").cap : name === "space" ? keys.find((k) => k.key.kind === "space").cap : name === "shift" ? keys.find((k) => k.key.kind === "shift").cap : capOf(keys, name)
      near(cap.x, x, `${width} ${name} x`)
      near(cap.w, w, `${width} ${name} width`)
      assert.equal(cap.h, ref.keyH, `${width} ${name} height`)
    }
    ref.rows.forEach((y, r) => near(keys.find((k) => k.row === r).cap.y, y, `${width} row ${r} top`))
    // the four rows are 216pt (224 on the Pro Max), the iOS keys area
    assert.equal(keysHeight(rows, m), Number(width) >= 420 ? 224 : 216)
  }
})

test("every row spans the keyboard: touch areas tile it with no holes", () => {
  for (const width of [375, 390, 393, 402, 430, 844]) {
    for (const [page, variant] of [["letters", "text"], ["letters", "email"], ["letters", "url"], ["numbers"], ["symbols"], ["dos", "dos"]]) {
      const { keys } = place(page, width, { variant, landscape: width > 500 })
      const rowCount = keys[keys.length - 1].row + 1
      for (let r = 0; r < rowCount; r++) {
        const row = keys.filter((k) => k.row === r)
        near(row[0].touch.x, 0, `${width} ${page} row ${r} starts at the edge`, 0.01)
        near(row[row.length - 1].touch.x + row[row.length - 1].touch.w, width, `${width} ${page} row ${r} ends at the edge`, 0.05)
        for (let i = 1; i < row.length; i++) near(row[i].touch.x, row[i - 1].touch.x + row[i - 1].touch.w, `${width} ${page} row ${r} key ${i} touches its neighbour`, 0.05)
        // keys 6pt apart, like iOS
        for (let i = 1; i < row.length; i++) near(row[i].cap.x - (row[i - 1].cap.x + row[i - 1].cap.w), 6, `${width} ${page} row ${r} gap ${i}`, row[i].slot.x === row[i - 1].slot.x + row[i - 1].slot.w ? 0.05 : 40)
      }
    }
  }
})

test("landscape: 40pt rows, 32pt keys, 9.5% / 19.5% system keys", () => {
  const { keys, m, rows } = place("letters", 844, { landscape: true })
  assert.equal(m.pitch, 40)
  assert.equal(keysHeight(rows, m), 160)
  near(capOf(keys, "q").w, 78.4, "844 letter")
  near(capOf(keys, "q").y, 4, "844 first row top")
  near(keys.find((k) => k.key.kind === "page").cap.w, 844 * 0.095 - 6, "844 123")
  near(keys.find((k) => k.key.kind === "enter").cap.w, 844 * 0.195 - 6, "844 return")
})

test("the 123 page's . , ? ! ' keys are 14% wide, #+= and Delete 13%", () => {
  const { keys } = place("numbers", 390)
  const third = keys.filter((k) => k.row === 2)
  near(third[0].cap.w, 390 * 0.13 - 6, "#+=")
  for (const k of third.slice(1, 6)) near(k.cap.w, 390 * 0.14 - 6, k.key.value)
  near(third[6].cap.w, 390 * 0.13 - 6, "Delete")
})

test("hit testing: gaps go to the nearest key, row ends to the end keys", () => {
  const { keys, m } = place("letters", 390)
  const at = (x, y) => hitTest(keys, x, y, m)?.key.value
  // q's key is 3..36, w's 42..75: the gap splits at 39
  assert.equal(at(20, 27), "q")
  assert.equal(at(38.9, 27), "q")
  assert.equal(at(39.1, 27), "w")
  // the half-key margin left of a types a
  assert.equal(at(2, 81), "a")
  assert.equal(at(388, 81), "l")
  // between rows: q's bottom is 48, a's top 60, the line is 54
  assert.equal(at(25, 53), "q")
  assert.equal(at(25, 55), "a")
  // above the first row and below the last stay on them
  assert.equal(at(20, -10), "q")
  assert.equal(at(200, 230), " ")
  // the gap between Shift and z
  assert.equal(at(50, 135), "Shift")
  assert.equal(at(55, 135), "z")
  // past the right edge
  assert.equal(at(400, 27), "p")
  // the number pad's empty corner types nothing
  const pad = place("numpad", 390)
  assert.equal(hitTest(pad.keys, 30, 190, pad.m), null)
  assert.equal(hitTest(pad.keys, 195, 190, pad.m).key.value, "0")
})

test("the balloon stands over its key and stays on the screen at the edges", () => {
  const { keys } = place("letters", 390)
  for (const k of keys.filter((p) => p.key.kind === "char")) {
    const b = balloonFor(k.cap, 390)
    assert.ok(b.head.x >= 1 && b.head.x + b.head.w <= 389, `${k.key.value} head inside`)
    assert.ok(b.head.w > k.cap.w + 20, `${k.key.value} head wider than the key`)
    assert.ok(b.head.y + b.head.h <= k.cap.y, `${k.key.value} head above the key`)
    assert.equal(b.stem.x, Math.round(k.cap.x))
    // the head covers the key's middle, centered unless at an edge
    const center = k.cap.x + k.cap.w / 2
    assert.ok(b.head.x <= center && b.head.x + b.head.w >= center, `${k.key.value} over its key`)
  }
  const w = balloonFor(capOf(keys, "t"), 390)
  near(w.head.x + w.head.w / 2, capOf(keys, "t").x + capOf(keys, "t").w / 2, "t centered", 1)
  // q's head leans right, p's left
  assert.equal(balloonFor(capOf(keys, "q"), 390).head.x, 1)
  assert.equal(balloonFor(capOf(keys, "p"), 390).head.x + balloonFor(capOf(keys, "p"), 390).head.w, 389)
})

test("the accents strip opens rightward on the left half, leftward on the right", () => {
  const { keys } = place("letters", 390)
  const e = stripFor(capOf(keys, "e"), alternatesFor("e"), 390)
  assert.equal(e.leftward, false)
  assert.equal(e.shown[0], "e")
  assert.equal(stripIndex(e, capOf(keys, "e").x + 5), 0)
  assert.equal(stripIndex(e, e.x + e.pad + e.cell * 2 + 1), 2)
  const o = stripFor(capOf(keys, "o"), alternatesFor("o"), 390)
  assert.equal(o.leftward, true)
  assert.equal(o.shown[o.shown.length - 1], "o")
  assert.ok(o.x >= 1 && o.x + o.w <= 389)
  // the key's own letter stays over the key
  assert.equal(o.shown[stripIndex(o, capOf(keys, "o").x + capOf(keys, "o").w / 2)], "o")
})

test("Delete held: repeats after the delay, speeds up, then deletes words", () => {
  const s = { delay: 500, rate: 60 }
  assert.deepEqual(deleteRepeat(1, s), { wait: 500, word: false })
  let last = Infinity
  for (let n = 2; n < WORDS_AFTER; n++) {
    const step = deleteRepeat(n, s)
    assert.equal(step.word, false, `delete ${n + 1} is a character`)
    assert.ok(step.wait <= last && step.wait >= 60, `delete ${n + 1} wait ${step.wait}`)
    last = step.wait
  }
  assert.ok(deleteRepeat(2, s).wait > deleteRepeat(9, s).wait, "it speeds up")
  assert.equal(deleteRepeat(WORDS_AFTER, s).word, true)
  assert.equal(deleteRepeat(30, s).word, true)
  assert.ok(deleteRepeat(WORDS_AFTER, s).wait > deleteRepeat(9, s).wait, "words come slower than characters")
  // the time until words: about 1.3 s, as on iOS
  let t = 0
  for (let n = 1; n < WORDS_AFTER; n++) t += deleteRepeat(n, s).wait
  assert.ok(t > 1000 && t < 1700, `words start after ${t} ms`)
})
