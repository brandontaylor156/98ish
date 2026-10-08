// Which form controls the 98-style pickers take over, and how a choice is written back so
// React (and any other listener) sees it as the user's own change.

export const DATE_TYPES = new Set(["date", "time", "datetime-local", "month"])

// "list" for a drop-down <select>, the input type for date/time fields, or null for anything
// the pickers leave alone: list boxes (multiple or size > 1), disabled or read-only fields,
// and anything inside [data-native-select]
export const pickerKind = (el) => {
  if (!el || el.nodeType !== 1 || el.disabled) return null
  if (el.closest?.("[data-native-select]")) return null
  if (el.tagName === "SELECT") return el.multiple || el.size > 1 ? null : "list"
  if (el.tagName === "INPUT") {
    // the attribute: a browser without "month" fields reports type "text"
    const type = (el.getAttribute("type") || "").toLowerCase()
    return DATE_TYPES.has(type) && !el.readOnly ? type : null
  }
  return null
}

// The control an event target stands for: the select/date field itself, or the one a
// <label> tap would focus (but not when the tap was on another control inside the label)
export const controlFor = (target) => {
  if (!target || target.nodeType !== 1) return null
  const own = target.closest?.("select, input")
  if (own) return pickerKind(own) ? own : null
  const label = target.closest?.("label")
  if (!label) return null
  if (target.closest("button, a, textarea, [contenteditable]")) return null
  const control = label.control
  return control && pickerKind(control) ? control : null
}

// On touch screens the fields themselves take no touches at all (Select.css: pointer-events
// none), so the phone can never open its own picker for them, whatever order an iPhone sends
// a tap's events in. A tap lands on what's under the field instead (its row, its label, the
// window): this finds the field at that point: the target's own field, or one inside the
// target whose box holds the point. (Only inside it: a dialog's backdrop over a window must
// not reach the window's fields behind it.)
export const controlAt = (target, x, y) => {
  const own = controlFor(target)
  if (own) return own
  if (!target || target.nodeType !== 1 || !target.querySelectorAll) return null
  for (const el of target.querySelectorAll("select, input")) {
    if (!pickerKind(el)) continue
    const r = el.getBoundingClientRect()
    if (x >= r.left - 1 && x <= r.right + 1 && y >= r.top - 1 && y <= r.bottom + 1) return el
  }
  return null
}

// set a value through the element's own (prototype) setter, the way typing would, so
// React's value tracking notices; then the events a real choice fires
const setThrough = (el, prop, value) => {
  const proto = Object.getPrototypeOf(el)
  const desc = Object.getOwnPropertyDescriptor(proto, prop) || Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop)
  if (desc?.set) desc.set.call(el, value)
  else el[prop] = value
}

const fire = (el) => {
  el.dispatchEvent(new Event("input", { bubbles: true }))
  el.dispatchEvent(new Event("change", { bubbles: true }))
}

// choose option number `index` in a select; nothing happens if it's already chosen
export const chooseIndex = (select, index) => {
  if (select.selectedIndex === index) return false
  setThrough(select, "selectedIndex", index)
  fire(select)
  return true
}

export const setInputValue = (input, value) => {
  if (input.value === value) return false
  setThrough(input, "value", value)
  fire(input)
  return true
}

// what the field is called, for the phone sheet's title bar
export const fieldName = (el) => {
  const aria = el.getAttribute("aria-label")
  if (aria) return aria.trim()
  const by = el.getAttribute("aria-labelledby")
  if (by) {
    const text = by
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent || "")
      .join(" ")
      .trim()
    if (text) return text
  }
  const label = el.labels?.[0]
  if (label) {
    // the label's own words, without the control's text inside it
    const copy = label.cloneNode(true)
    copy.querySelectorAll("select, input, textarea, option").forEach((n) => n.remove())
    const text = copy.textContent.replace(/\s+/g, " ").trim()
    if (text) return text.replace(/:$/, "")
  }
  return (el.getAttribute("title") || "").trim()
}

// the focused field that would keep a keyboard (phone or 98ish) up over the sheet
export const isTextEntry = (el) => {
  if (!el || el.nodeType !== 1) return false
  if (el.tagName === "TEXTAREA" || el.isContentEditable) return true
  if (el.tagName !== "INPUT") return false
  const t = (el.getAttribute("type") || "text").toLowerCase()
  return ["text", "search", "email", "url", "tel", "password", "number"].includes(t)
}
