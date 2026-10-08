// node --test client/src/components/applets/lanparty/pcKeys.test.js
import test from "node:test"
import assert from "node:assert/strict"
import { CODE_SCAN, breakOf, charKey, createPcKeyboard, pressCodes, textCodes } from "./pcKeys.js"

const hex = (codes) => codes.map((c) => c.toString(16).padStart(2, "0")).join(" ")

test("Virtual PC keys: scancode set 1 makes and breaks, extended keys keep their E0", () => {
  assert.equal(hex(pressCodes("KeyD")), "20 a0")
  assert.equal(hex(pressCodes("Enter")), "1c 9c")
  assert.equal(hex(pressCodes("ArrowUp")), "e0 48 e0 c8")
  assert.equal(hex(breakOf(CODE_SCAN.Delete)), "e0 d3")
  assert.equal(hex(pressCodes("KeyD", { shift: true })), "2a 20 a0 aa", "a capital: Shift held around it")
  assert.equal(hex(pressCodes("KeyC", { ctrl: true })), "1d 2e ae 9d", "Ctrl+C")
  assert.deepEqual(charKey(":"), { code: "Semicolon", shift: true })
  assert.deepEqual(charKey("\\"), { code: "Backslash", shift: false })
  assert.equal(charKey("é"), null)
})

test("Virtual PC keys: typed text (the phone's keyboard, paste) is one press per character", () => {
  assert.equal(hex(textCodes("dir\n")), "20 a0 17 97 13 93 1c 9c")
  assert.equal(hex(textCodes("C:")), "2a 2e ae aa 2a 27 a7 aa")
  assert.equal(hex(textCodes("“é”")), "2a 28 a8 aa 2a 28 a8 aa", "curly quotes as straight ones, é skipped")
})

test("Virtual PC keys: the 98ish keyboard's made-up keys, a real keyboard's downs and ups, the phone's input", () => {
  const sent = []
  const kb = createPcKeyboard((codes) => sent.push(hex(codes)))
  // the 98ish keyboard: untrusted events, Shift only as a flag
  assert.equal(kb.keydown({ isTrusted: false, key: "d", code: "KeyD" }), true)
  assert.equal(kb.keydown({ isTrusted: false, key: "D", code: "KeyD", shiftKey: true }), true)
  assert.equal(kb.keydown({ isTrusted: false, key: "Enter", code: "Enter" }), true)
  assert.equal(kb.keydown({ isTrusted: false, key: "c", code: "KeyC", ctrlKey: true }), true)
  assert.equal(kb.keydown({ isTrusted: false, key: ":", code: "" }), true, "a symbol with no code of its own")
  assert.equal(kb.keyup({ isTrusted: false, key: "d", code: "KeyD" }), false, "its key up was already sent")
  assert.deepEqual(sent.splice(0), ["20 a0", "2a 20 a0 aa", "1c 9c", "1d 2e ae 9d", "2a 27 a7 aa"])
  // a real keyboard: down now, up later; Shift is its own key, so no extra Shift
  kb.keydown({ isTrusted: true, key: "Shift", code: "ShiftLeft" })
  kb.keydown({ isTrusted: true, key: "D", code: "KeyD", shiftKey: true })
  kb.keyup({ isTrusted: true, key: "D", code: "KeyD" })
  kb.keyup({ isTrusted: true, key: "Shift", code: "ShiftLeft" })
  assert.deepEqual(sent.splice(0), ["2a", "20", "a0", "aa"])
  // held when the box loses focus: let go in the PC too
  kb.keydown({ isTrusted: true, key: "ArrowUp", code: "ArrowUp" })
  kb.releaseAll()
  assert.deepEqual(sent.splice(0), ["e0 48", "e0 c8"])
  // the phone's own keyboard: key "Unidentified", then the text as input
  assert.equal(kb.keydown({ isTrusted: true, key: "Unidentified", keyCode: 229, code: "" }), false)
  kb.beforeinput({ inputType: "insertText", data: "ok" })
  kb.beforeinput({ inputType: "deleteContentBackward" })
  kb.beforeinput({ inputType: "insertLineBreak" })
  assert.deepEqual(sent.splice(0), ["18 98 25 a5", "0e 8e", "1c 9c"])
})
