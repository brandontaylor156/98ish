// The drop-down list's model and keyboard handling, kept free of React and the page so it
// can be unit tested. readItems() is the only part that reads a real <select>.

// A select's rows in order: option groups as headers, then their options.
//   { kind: "group", label, disabled }
//   { kind: "option", index, label, value, disabled, inGroup }
// index is the option's place in select.options (what selectedIndex uses).
export const readItems = (select) => {
  const items = []
  let index = 0
  const option = (o, group) => {
    const at = index++
    // options the app hid aren't offered (they still count for selectedIndex)
    if (o.hidden) return
    items.push({
      kind: "option",
      index: at,
      label: o.label || o.textContent || "",
      value: o.value,
      disabled: !!(o.disabled || group?.disabled),
      inGroup: !!group,
    })
  }
  for (const child of select.children || []) {
    if (child.tagName === "OPTGROUP") {
      if (child.hidden) {
        index += child.querySelectorAll ? child.querySelectorAll("option").length : 0
        continue
      }
      items.push({ kind: "group", label: child.label || child.getAttribute?.("label") || "", disabled: !!child.disabled })
      for (const o of child.children || []) if (o.tagName === "OPTION") option(o, child)
    } else if (child.tagName === "OPTION") option(child, null)
  }
  return items
}

export const pickable = (item) => !!item && item.kind === "option" && !item.disabled

// the row (into items) of the select's chosen option, or the first pickable row
export const rowOfIndex = (items, selectedIndex) => {
  const row = items.findIndex((it) => it.kind === "option" && it.index === selectedIndex)
  if (row >= 0) return row
  return items.findIndex(pickable)
}

// the next pickable row from `from` in steps of `dir` (+1/-1), or `from` if there's none
const step = (items, from, dir, count = 1) => {
  let best = from
  let i = from
  let left = count
  while (left > 0) {
    i += dir
    if (i < 0 || i >= items.length) break
    if (pickable(items[i])) {
      best = i
      left--
    }
  }
  return best
}

const first = (items) => items.findIndex(pickable)
const last = (items) => {
  for (let i = items.length - 1; i >= 0; i--) if (pickable(items[i])) return i
  return -1
}

// the row a type-ahead query lands on: the next row starting with it (a repeated single
// letter cycles through the rows starting with that letter, as Windows does)
export const findTyped = (items, from, query) => {
  if (!query) return -1
  const q = query.toLowerCase()
  const cycling = q.length > 1 && [...q].every((c) => c === q[0])
  const prefix = cycling ? q[0] : q
  const start = cycling || q.length === 1 ? from + 1 : from
  for (let n = 0; n < items.length; n++) {
    const i = (((start + n) % items.length) + items.length) % items.length
    const it = items[i]
    if (pickable(it) && it.label.trim().toLowerCase().startsWith(prefix)) return i
  }
  return -1
}

// How long a pause ends a type-ahead word
export const TYPE_PAUSE = 1000

// The open list's keyboard: state { active, query, typedAt } and a key -> the next state
// plus what to do: "commit" (choose the active row and close), "cancel", or nothing.
// page is how many rows a Page Up/Down moves.
export const listKey = (items, state, key, { now = 0, page = 8, alt = false } = {}) => {
  const { active } = state
  const moved = (row) => ({ ...state, active: row < 0 ? active : row, query: "" })
  switch (key) {
    case "ArrowDown":
      if (alt) return { ...state, action: "commit" }
      return moved(active < 0 ? first(items) : step(items, active, 1))
    case "ArrowUp":
      if (alt) return { ...state, action: "commit" }
      return moved(active < 0 ? first(items) : step(items, active, -1))
    case "PageDown":
      return moved(active < 0 ? first(items) : step(items, active, 1, page))
    case "PageUp":
      return moved(active < 0 ? first(items) : step(items, active, -1, page))
    case "Home":
      return moved(first(items))
    case "End":
      return moved(last(items))
    case "Enter":
    case "F4":
      return { ...state, action: "commit" }
    case "Tab":
      return { ...state, action: "commit", keepKey: true }
    case "Escape":
      return { ...state, action: "cancel" }
    default:
      break
  }
  if (key.length === 1) {
    const fresh = now - (state.typedAt || 0) > TYPE_PAUSE
    // Space chooses, unless it's part of a word being typed
    if (key === " " && (fresh || !state.query)) return { ...state, action: "commit" }
    const query = (fresh ? "" : state.query || "") + key
    const row = findTyped(items, active, query)
    return { ...state, active: row < 0 ? active : row, query, typedAt: now }
  }
  return state
}
