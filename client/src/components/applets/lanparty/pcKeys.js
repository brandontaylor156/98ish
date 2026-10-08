// Virtual PC 98's keyboard: keys and typed text -> PC scancodes (set 1) for v86.
//
// v86 reads keys from the page by itself, but it skips key events aimed at text fields, and
// a phone types into a text field: the 98ish keyboard's keys (made-up key events, with no
// Shift key of their own) and the phone's own keyboard (key "Unidentified", the text arrives
// as input) never reached the PC. So v86's own keyboard is off (disable_keyboard) and every
// key goes through here, from Virtual PC's hidden type-in box:
//   - a real keyboard (computer, iPad, Bluetooth): each key down and up by its position
//     (event.code), so held keys, Shift, Ctrl and games work as on a PC
//   - the 98ish keyboard: each key is a whole press (down + up), with Shift held around
//     capitals and symbols, Ctrl around Ctrl+C
//   - the phone's keyboard, dictation and paste: the text typed, one press per character
// Pure, with a send(codes) callback: unit tested in lanparty.test.js.

const E0 = 0xe0

// event.code -> make code (set 1); two bytes for the extended keys
export const CODE_SCAN = {
  Escape: [0x01],
  Digit1: [0x02], Digit2: [0x03], Digit3: [0x04], Digit4: [0x05], Digit5: [0x06],
  Digit6: [0x07], Digit7: [0x08], Digit8: [0x09], Digit9: [0x0a], Digit0: [0x0b],
  Minus: [0x0c], Equal: [0x0d], Backspace: [0x0e], Tab: [0x0f],
  KeyQ: [0x10], KeyW: [0x11], KeyE: [0x12], KeyR: [0x13], KeyT: [0x14], KeyY: [0x15],
  KeyU: [0x16], KeyI: [0x17], KeyO: [0x18], KeyP: [0x19], BracketLeft: [0x1a], BracketRight: [0x1b],
  Enter: [0x1c], ControlLeft: [0x1d],
  KeyA: [0x1e], KeyS: [0x1f], KeyD: [0x20], KeyF: [0x21], KeyG: [0x22], KeyH: [0x23],
  KeyJ: [0x24], KeyK: [0x25], KeyL: [0x26], Semicolon: [0x27], Quote: [0x28], Backquote: [0x29],
  ShiftLeft: [0x2a], Backslash: [0x2b],
  KeyZ: [0x2c], KeyX: [0x2d], KeyC: [0x2e], KeyV: [0x2f], KeyB: [0x30], KeyN: [0x31], KeyM: [0x32],
  Comma: [0x33], Period: [0x34], Slash: [0x35], ShiftRight: [0x36], NumpadMultiply: [0x37],
  AltLeft: [0x38], Space: [0x39], CapsLock: [0x3a],
  F1: [0x3b], F2: [0x3c], F3: [0x3d], F4: [0x3e], F5: [0x3f], F6: [0x40], F7: [0x41], F8: [0x42], F9: [0x43], F10: [0x44],
  NumLock: [0x45], ScrollLock: [0x46],
  Numpad7: [0x47], Numpad8: [0x48], Numpad9: [0x49], NumpadSubtract: [0x4a], Numpad4: [0x4b], Numpad5: [0x4c],
  Numpad6: [0x4d], NumpadAdd: [0x4e], Numpad1: [0x4f], Numpad2: [0x50], Numpad3: [0x51], Numpad0: [0x52], NumpadDecimal: [0x53],
  F11: [0x57], F12: [0x58],
  NumpadEnter: [E0, 0x1c], ControlRight: [E0, 0x1d], NumpadDivide: [E0, 0x35], AltRight: [E0, 0x38],
  Home: [E0, 0x47], ArrowUp: [E0, 0x48], PageUp: [E0, 0x49], ArrowLeft: [E0, 0x4b], ArrowRight: [E0, 0x4d],
  End: [E0, 0x4f], ArrowDown: [E0, 0x50], PageDown: [E0, 0x51], Insert: [E0, 0x52], Delete: [E0, 0x53],
}

// the break code: the make code with the top bit set (after the E0 prefix)
export const breakOf = (make) => make.map((b, i) => (i === make.length - 1 ? b | 0x80 : b))

// key names (event.key) the phone's keyboards send -> the key's code
const NAMED = {
  Enter: "Enter", Backspace: "Backspace", Tab: "Tab", Escape: "Escape", Esc: "Escape", " ": "Space",
  ArrowUp: "ArrowUp", ArrowDown: "ArrowDown", ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight",
  Delete: "Delete", Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown", Insert: "Insert",
  F1: "F1", F2: "F2", F3: "F3", F4: "F4", F5: "F5", F6: "F6", F7: "F7", F8: "F8", F9: "F9", F10: "F10", F11: "F11", F12: "F12",
}

// characters on a US keyboard: [code, shift]
const PLAIN = { "-": "Minus", "=": "Equal", "[": "BracketLeft", "]": "BracketRight", ";": "Semicolon", "'": "Quote", "`": "Backquote", "\\": "Backslash", ",": "Comma", ".": "Period", "/": "Slash", " ": "Space", "\n": "Enter", "\t": "Tab" }
const SHIFTED = { "!": "Digit1", "@": "Digit2", "#": "Digit3", $: "Digit4", "%": "Digit5", "^": "Digit6", "&": "Digit7", "*": "Digit8", "(": "Digit9", ")": "Digit0", _: "Minus", "+": "Equal", "{": "BracketLeft", "}": "BracketRight", ":": "Semicolon", '"': "Quote", "~": "Backquote", "|": "Backslash", "<": "Comma", ">": "Period", "?": "Slash" }
// typed characters a PC keyboard doesn't have, the closest it does
const NEAR = { "‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-", "…": "...", " ": " " }

export const charKey = (ch) => {
  if (/^[a-z]$/.test(ch)) return { code: `Key${ch.toUpperCase()}`, shift: false }
  if (/^[A-Z]$/.test(ch)) return { code: `Key${ch}`, shift: true }
  if (/^[0-9]$/.test(ch)) return { code: `Digit${ch}`, shift: false }
  if (PLAIN[ch]) return { code: PLAIN[ch], shift: false }
  if (SHIFTED[ch]) return { code: SHIFTED[ch], shift: true }
  return null
}

// One whole key press (down and up), with Shift and Ctrl held around it when asked and not
// already held: the scancodes in order.
export const pressCodes = (code, { shift = false, ctrl = false } = {}) => {
  const make = CODE_SCAN[code]
  if (!make) return []
  const out = []
  if (ctrl) out.push(...CODE_SCAN.ControlLeft)
  if (shift) out.push(...CODE_SCAN.ShiftLeft)
  out.push(...make, ...breakOf(make))
  if (shift) out.push(...breakOf(CODE_SCAN.ShiftLeft))
  if (ctrl) out.push(...breakOf(CODE_SCAN.ControlLeft))
  return out
}

// text -> scancodes, one press per character (unknown characters are skipped)
export const textCodes = (text, held = new Set()) => {
  const out = []
  for (const raw of String(text)) {
    for (const ch of NEAR[raw] || raw) {
      const k = charKey(ch)
      if (k) out.push(...pressCodes(k.code, { shift: k.shift && !held.has("ShiftLeft") && !held.has("ShiftRight") }))
    }
  }
  return out
}

const SHIFTS = ["ShiftLeft", "ShiftRight"]
const CTRLS = ["ControlLeft", "ControlRight"]

// The type-in box's keyboard: call keydown/keyup/beforeinput with the events (or plain
// objects like them); `send(codes)` gets the scancodes. The handlers return true when they
// used the event (the caller then cancels it, so nothing is typed into the box itself).
export const createPcKeyboard = (send) => {
  const held = new Set() // codes held down on a real keyboard
  const any = (list) => list.some((c) => held.has(c))
  return {
    keydown(e) {
      if (e.isComposing || e.keyCode === 229 || e.key === "Unidentified" || e.key === "Process" || e.key === "Dead") return false
      // a real keyboard: by the key's position, down now and up on keyup
      if (e.isTrusted !== false && CODE_SCAN[e.code]) {
        held.add(e.code)
        send([...CODE_SCAN[e.code]])
        return true
      }
      // the 98ish keyboard's made-up events: a whole press for what the key says
      const named = NAMED[e.key]
      const k = named ? { code: named, shift: false } : e.key?.length === 1 ? charKey(NEAR[e.key] || e.key) : null
      if (!k) return false
      const shift = (k.shift || (e.shiftKey && named && named !== "Space")) && !any(SHIFTS)
      const ctrl = !!e.ctrlKey && !any(CTRLS)
      // Ctrl + a letter: the letter's own key (Ctrl+C is Ctrl and C), not a capital
      const codes = pressCodes(k.code, { shift: ctrl && /^Key/.test(k.code) ? false : shift, ctrl })
      if (!codes.length) return false
      send(codes)
      return true
    },
    keyup(e) {
      if (e.isTrusted === false || !held.has(e.code)) return false
      held.delete(e.code)
      send(breakOf(CODE_SCAN[e.code]))
      return true
    },
    // the phone's keyboard, dictation, paste: what was typed
    beforeinput(e) {
      const t = e.inputType || ""
      if (t.startsWith("delete")) return send(pressCodes(t === "deleteContentForward" ? "Delete" : "Backspace")), true
      if (t === "insertLineBreak" || t === "insertParagraph") return send(pressCodes("Enter")), true
      if (t.startsWith("insert") && e.data) {
        const codes = textCodes(e.data, held)
        if (codes.length) send(codes)
        return true
      }
      return false
    },
    // the box lost focus (or the window closed): no key stays down in the PC
    releaseAll() {
      const codes = [...held].flatMap((c) => breakOf(CODE_SCAN[c]))
      held.clear()
      if (codes.length) send(codes)
    },
    held: () => [...held],
  }
}
