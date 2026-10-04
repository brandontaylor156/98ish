// Which elements the 98ish keyboard types into, and how: the layout, what Enter says and does.
// readField() is the only part that touches the DOM; the rest works on its plain result so it
// can be unit tested.

// input types that take typed text (no type = text)
const TEXT_TYPES = new Set(["", "text", "search", "email", "url", "tel", "password", "number"])

// what an element says about itself (attributes as the app set them: the inputmode we
// replaced is kept in data-kb-inputmode)
export const readField = (el) => {
  if (!el || el.nodeType !== 1) return null
  const tag = el.tagName.toLowerCase()
  const attr = (name) => el.getAttribute(name)
  return {
    tag,
    type: tag === "input" ? (attr("type") || "").toLowerCase() : "",
    inputMode: (el.dataset?.kbInputmode ?? attr("inputmode") ?? "").toLowerCase(),
    enterKeyHint: (attr("enterkeyhint") || "").toLowerCase(),
    autocapitalize: (attr("autocapitalize") || "").toLowerCase(),
    autocomplete: (attr("autocomplete") || "").toLowerCase(),
    pattern: attr("pattern") || "",
    layout: el.closest?.("[data-kb-layout]")?.getAttribute("data-kb-layout") || "",
    kb: el.closest?.("[data-kb]")?.getAttribute("data-kb") || "",
    editable: tag !== "input" && tag !== "textarea" && !!el.isContentEditable,
    readOnly: !!el.readOnly,
    disabled: !!el.disabled,
    inForm: !!el.form || !!el.closest?.("form"),
  }
}

// does the keyboard type into this field?
export const takesKeyboard = (f) => {
  if (!f || f.kb === "off" || f.disabled || f.readOnly) return false
  if (f.tag === "textarea") return true
  if (f.tag === "input") return TEXT_TYPES.has(f.type)
  return f.editable
}

// The element the keyboard should type into for an event target (the editing host for a
// tap inside rich text), or null
export const textFieldFor = (target) => {
  if (!target || target.nodeType !== 1) return null
  let el = target
  if (el.tagName !== "INPUT" && el.tagName !== "TEXTAREA") {
    if (!el.isContentEditable) return null
    // the outermost editable ancestor: the editing host
    while (el.parentElement?.isContentEditable) el = el.parentElement
  }
  return takesKeyboard(readField(el)) ? el : null
}

export const isPassword = (f) => f.type === "password"

// sign-in fields, where password managers' AutoFill lives (on the phone's keyboard)
export const isCredential = (f) =>
  isPassword(f) || /\b(username|current-password|new-password|one-time-code)\b/.test(f.autocomplete)

export const isMultiline = (f) => f.tag === "textarea" || f.editable

// { page, variant }: the page the keyboard opens on and the letters' bottom row
//   page: "letters" | "numbers" | "numpad" | "dos"; variant: "text" | "email" | "url" | numpad kind
export const layoutFor = (f) => {
  if (f.layout === "dos") return { page: "dos", variant: "dos" }
  const mode = f.inputMode
  if (mode === "numeric" || mode === "decimal") return { page: "numpad", variant: mode === "decimal" ? "decimal" : "number" }
  if (f.type === "tel" || mode === "tel") return { page: "numpad", variant: "tel" }
  // iOS gives type=number the full keyboard on its 123 page; the number pad only with a
  // digits-only pattern ("[0-9]*", "\d*") or inputmode numeric
  if (f.type === "number") return /^(\[0-9\]|\\d)[*+]$/.test(f.pattern || "") ? { page: "numpad", variant: "number" } : { page: "numbers", variant: "text" }
  if (f.type === "email" || mode === "email") return { page: "letters", variant: "email" }
  if (f.type === "url" || mode === "url") return { page: "letters", variant: "url" }
  return { page: "letters", variant: "text" }
}

const HINTS = { enter: "Enter", done: "Done", go: "Go", next: "Next", previous: "Prev", search: "Search", send: "Send" }

// what the Enter key says
export const enterLabel = (f) => {
  // a PC's Enter key, whatever the box tells phone keyboards
  if (f.layout === "dos") return "Enter"
  if (HINTS[f.enterKeyHint]) return HINTS[f.enterKeyHint]
  if (f.type === "search" || f.inputMode === "search") return "Search"
  if (f.type === "url" || f.inputMode === "url") return "Go"
  if (isMultiline(f)) return "Return"
  return "Enter"
}

// What Enter does when the app doesn't take it: "newline" (textarea), "paragraph" (rich
// text), "submit" (a single-line field in a form), or "none"
export const enterAction = (f) => {
  if (f.tag === "textarea") return "newline"
  if (f.editable) return "paragraph"
  return f.inForm ? "submit" : "none"
}

// After Enter in a single-line field that still has focus: "keep" the keyboard (chat: Send,
// MS-DOS), move to the "next" field, or "hide" it (Go, Search, Done, a plain form's Enter)
export const afterEnter = (f) => {
  if (isMultiline(f) || f.layout === "dos") return "keep"
  if (f.enterKeyHint === "send") return "keep"
  if (f.enterKeyHint === "next") return "next"
  if (["go", "search", "done"].includes(f.enterKeyHint) || f.type === "search" || f.type === "url" || f.inForm) return "hide"
  return "keep"
}

// The field's autocapitalize, with the browsers' defaults: off for emails, URLs, passwords
// and number pads; sentences for other text
export const capsMode = (f) => {
  const a = f.autocapitalize
  if (a === "off" || a === "none") return "none"
  if (a === "on") return "sentences"
  if (a === "words" || a === "characters" || a === "sentences") return a
  if (f.layout === "dos") return "none"
  if (["email", "url", "password", "number", "tel"].includes(f.type)) return "none"
  if (["email", "url", "numeric", "decimal", "tel"].includes(f.inputMode)) return "none"
  if (/\b(username|email|url)\b/.test(f.autocomplete)) return "none"
  return "sentences"
}

// text fields are where the ". " shortcut and key previews make sense
export const allowsShortcuts = (f) => capsMode(f) === "sentences" && !isPassword(f)
