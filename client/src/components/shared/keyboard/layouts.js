// The keyboard's pages and keys. A key is { kind, value, label, w } where w is its width in
// letter-key units (a row of letters is 10). Kinds:
//   char   types `value` (letters follow Shift)      shift, back, enter, space, undo
//   page   switches to the page in `value`            ctrl (MS-DOS: the next key is Ctrl+key)
//   key    a named key with no text (Escape, Tab, ArrowUp...): only its key events

const chars = (s) => [...s].map((c) => ({ kind: "char", value: c }))
const k = (kind, value, label, w = 1) => ({ kind, value, label, w })

const LETTER_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"]

// the letters' bottom row by field: plain text, email, url (and MS-DOS)
const bottomRow = (variant, wide) => {
  const arrows = wide ? [k("key", "ArrowLeft", "Left", 1), k("key", "ArrowRight", "Right", 1)] : []
  const left = [k("page", "numbers", "123", 1.3)]
  if (variant === "email") return [...left, k("char", "@", "@"), k("space", " ", "space", 4.7 - arrows.length), ...(arrows[0] ? [arrows[0]] : []), k("char", "."), ...(arrows[1] ? [arrows[1]] : []), k("enter", "Enter", null, 2)]
  if (variant === "url") return [...left, k("char", "/"), k("space", " ", "space", 3.2 - arrows.length), ...(arrows[0] ? [arrows[0]] : []), k("char", "."), ...(arrows[1] ? [arrows[1]] : []), k("char", ".com", ".com", 1.5), k("enter", "Enter", null, 2)]
  if (variant === "dos") return [...left, k("char", "-"), k("space", " ", "space", 4.7), k("char", "/"), k("enter", "Enter", null, 2)]
  return [...left, k("char", ","), k("space", " ", "space", 4.7 - arrows.length), ...(arrows[0] ? [arrows[0]] : []), k("char", "."), ...(arrows[1] ? [arrows[1]] : []), k("enter", "Enter", null, 2)]
}

const letters = (variant, wide) => [
  chars(LETTER_ROWS[0]),
  chars(LETTER_ROWS[1]),
  [k("shift", "Shift", null, 1.5), ...chars(LETTER_ROWS[2]), k("back", "Backspace", null, 1.5)],
  bottomRow(variant, wide),
]

// 123 and #+= share their bottom row: back to letters, Undo, space, Enter
const symbolsBottom = (wide) => [
  k("page", "letters", "ABC", 1.3),
  k("undo", "undo", "Undo", 1.5),
  ...(wide ? [k("key", "ArrowLeft", "Left", 1)] : []),
  k("space", " ", "space", wide ? 3.2 : 5.2),
  ...(wide ? [k("key", "ArrowRight", "Right", 1)] : []),
  k("enter", "Enter", null, 2),
]

const numbers = (wide) => [
  chars("1234567890"),
  chars("-/:;()$&@\""),
  [k("page", "symbols", "#+=", 1.5), ...chars(".,?!'").map((c) => ({ ...c, w: 1.4 })), k("back", "Backspace", null, 1.5)],
  symbolsBottom(wide),
]

const symbols = (wide) => [
  chars("[]{}#%^*+="),
  chars("_\\|~<>€£¥•"),
  [k("page", "numbers", "123", 1.5), ...chars(".,?!'").map((c) => ({ ...c, w: 1.4 })), k("back", "Backspace", null, 1.5)],
  symbolsBottom(wide),
]

// the number pad: number/numeric ("-" "."), decimal ("," "."), tel ("*" "#", hold 0 for +)
const numpad = (variant) => {
  const [a, b] = variant === "tel" ? ["*", "#"] : variant === "decimal" ? [",", "."] : ["-", "."]
  return [
    [...chars("123"), k("back", "Backspace", null)],
    [...chars("456"), k("page", "letters", "ABC")],
    [...chars("789"), k("space", " ", "space")],
    [k("char", a), k("char", "0"), k("char", b), k("enter", "Enter", null)],
  ]
}

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
// wide: landscape or a tablet, with room for arrow keys
export const rowsFor = (page, variant = "text", wide = false) => {
  switch (page) {
    case "numbers":
      return numbers(wide)
    case "symbols":
      return symbols(wide)
    case "numpad":
      return numpad(variant)
    case "dos":
      return [DOS_ROW, ...letters("dos", false)]
    default:
      return letters(variant, wide)
  }
}

// a page's rows add up to these many units (the widest row), for sizing keys
export const rowUnits = (rows) => Math.max(...rows.map((row) => row.reduce((sum, key) => sum + (key.w || 1), 0)))

// Long-press alternates, as on phone keyboards (the key's own character comes first in the
// list shown). Capitals are made from the lowercase list.
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
  "0": "°+",
  "-": "–—•",
  "/": "\\",
  "$": "¢€£¥₩",
  "&": "§",
  ".": "…",
  "?": "¿",
  "!": "¡",
  "'": "‘’`",
  "\"": "“”„«»",
  "%": "‰",
  ".com": [".net", ".org", ".edu", ".gov", ".co.uk"],
}

// the choices a long press offers for a key's value (shift: capitals), or []
export const alternatesFor = (value, upper = false) => {
  const list = ACCENTS[value.toLowerCase?.() ?? value] ?? ACCENTS[value]
  if (!list) return []
  const items = typeof list === "string" ? [...list] : list
  if (!upper) return items
  // ß has no single capital: leave it out
  return items.filter((c) => c !== "ß").map((c) => c.toUpperCase())
}
