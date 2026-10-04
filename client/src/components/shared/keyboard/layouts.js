// The keyboard's pages and keys, as the iPhone's English keyboard has them. A key is
// { kind, value, label, w } where w is its width: a number of letter slots (a tenth of the
// keyboard), or "shift" (Shift, Delete, #+=), "wide" (. , ? ! ' on the 123 page), "sys"
// (123, ABC), "ret" (return), "third" (number pad), "fill" (the rest: space). geometry.js
// turns them into places. There's no emoji/globe key: switching to the phone's own keyboard
// left no way back, so the space bar takes that slot. Kinds:
//   char   types `value` (letters follow Shift)      shift, back, enter, space
//   page   switches to the page in `value`            ctrl (MS-DOS: the next key is Ctrl+key)
//   key    a named key with no text (Escape, Tab, ArrowUp...): only its key events
//   blank  an empty cell (the number pad's corner)

const chars = (s, w) => [...s].map((c) => ({ kind: "char", value: c, ...(w ? { w } : {}) }))
const k = (kind, value, label, w = 1) => ({ kind, value, label, w })

const LETTER_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"]

const SPACE = k("space", " ", "space", "fill")
const ENTER = k("enter", "Enter", null, "ret")

// the bottom row by field: plain text, email, url (and MS-DOS); tablets add arrow keys
// around the space bar
const bottomRow = (variant, tablet, left = k("page", "numbers", "123", "sys")) => {
  const space = tablet ? [k("key", "ArrowLeft", "Left", 1), SPACE, k("key", "ArrowRight", "Right", 1)] : [SPACE]
  // iOS's URL keyboard has no space bar: . / .com
  if (variant === "url") return [left, k("char", ".", ".", 1.4), k("char", "/", "/", 1.4), k("char", ".com", ".com", "fill"), ENTER]
  if (variant === "email") return [left, ...space, k("char", "@"), k("char", "."), ENTER]
  if (variant === "dos") return [left, ...space, k("char", "/"), ENTER]
  return [left, ...space, ENTER]
}

const letters = (variant, tablet) => [
  chars(LETTER_ROWS[0]),
  chars(LETTER_ROWS[1]),
  [k("shift", "Shift", null, "shift"), ...chars(LETTER_ROWS[2]), k("back", "Backspace", null, "shift")],
  bottomRow(variant, tablet),
]

// 123 and #+= share the third row's shape and the bottom row (ABC, space, return)
const numbers = (tablet) => [
  chars("1234567890"),
  chars("-/:;()$&@\""),
  [k("page", "symbols", "#+=", "shift"), ...chars(".,?!'", "wide"), k("back", "Backspace", null, "shift")],
  bottomRow("text", tablet, k("page", "letters", "ABC", "sys")),
]

const symbols = (tablet) => [
  chars("[]{}#%^*+="),
  chars("_\\|~<>€£¥•"),
  [k("page", "numbers", "123", "shift"), ...chars(".,?!'", "wide"), k("back", "Backspace", null, "shift")],
  bottomRow("text", tablet, k("page", "letters", "ABC", "sys")),
]

// the letters printed under the number pad's digits, as on iOS
export const PAD_LETTERS = { 2: "ABC", 3: "DEF", 4: "GHI", 5: "JKL", 6: "MNO", 7: "PQRS", 8: "TUV", 9: "WXYZ" }

// the number pad: numeric (an empty corner), decimal ("."), tel ("+*#" opens the phone
// symbols; hold 0 for +). Like iOS there's no return key on it: the title bar has one.
const numpad = (variant) => {
  const corner = variant === "tel" ? k("page", "telsym", "+*#", "third") : variant === "decimal" ? k("char", ".", ".", "third") : k("blank", "", "", "third")
  return [chars("123", "third"), chars("456", "third"), chars("789", "third"), [corner, k("char", "0", "0", "third"), k("back", "Backspace", null, "third")]]
}

// the phone pad's other page (after +*#)
const telsym = () => [
  chars("+*#", "third"),
  chars("(-)", "third"),
  chars(",;/", "third"),
  [k("page", "numpad", "123", "third"), k("char", "0", "0", "third"), k("back", "Backspace", null, "third")],
]

// MS-DOS: a row of PC keys over the letters (history, completion, Ctrl+C)
const DOS_ROW = [
  k("key", "Escape", "Esc"),
  k("key", "Tab", "Tab"),
  k("ctrl", "Control", "Ctrl"),
  k("char", "\\"),
  k("char", ":"),
  k("char", "."),
  k("char", "*"),
  k("char", "?"),
  k("key", "ArrowUp", "Up"),
  k("key", "ArrowDown", "Down"),
]

// rows for a page. variant: the field's (text, email, url, dos, or the numpad's kind);
// tablet: a big screen, with room for arrow keys
export const rowsFor = (page, variant = "text", tablet = false) => {
  switch (page) {
    case "numbers":
      return numbers(tablet)
    case "symbols":
      return symbols(tablet)
    case "numpad":
      return numpad(variant)
    case "telsym":
      return telsym()
    case "dos":
      return [DOS_ROW, ...letters("dos", false)]
    default:
      return letters(variant, tablet)
  }
}

// the number pad's pages
export const isPad = (page) => page === "numpad" || page === "telsym"

// Long-press alternates, the iPhone's US English lists (as KeyboardKit's English callouts
// reproduce them). The strip shows the key's own character first. Capitals are made from
// the lowercase list.
export const ACCENTS = {
  a: "àáâäæãåā",
  c: "çćč",
  e: "èéêëēėę",
  i: "îïíīįì",
  l: "ł",
  n: "ñń",
  o: "ôöòóœøōõ",
  s: "ßśš",
  u: "ûüùúū",
  y: "ÿ",
  z: "žźż",
  "0": "°",
  "-": "–—•",
  "/": "\\",
  "$": "€£¥₩₽¢",
  "&": "§",
  ".": "…",
  "?": "¿",
  "!": "¡",
  "'": "’‘`",
  "\"": "”“„»«",
  "%": "‰",
  "=": "≠≈",
  ".com": [".net", ".org", ".edu", ".us", ".co.uk"],
}

// the choices a long press offers for a key's value (the key's own first; shift: capitals),
// or [] when it has none
export const alternatesFor = (value, upper = false) => {
  const list = ACCENTS[value.toLowerCase?.() ?? value] ?? ACCENTS[value]
  if (!list) return []
  const items = [value.toLowerCase?.() ?? value, ...(typeof list === "string" ? [...list] : list)]
  if (!upper) return items
  // ß has no single capital: leave it out
  return items.filter((c) => c !== "ß").map((c) => c.toUpperCase())
}
