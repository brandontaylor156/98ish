// Moving through the Start menu with the keyboard, as in Windows: Up/Down within a menu
// (skipping separators and grayed items, wrapping around), Right or Enter opens a submenu,
// Left or Escape goes back out, Enter on an item runs it, Home/End, and a letter jumps to
// the next item starting with it. No React, so Node can test it (startNav.test.js).
//
// path: the highlighted item, as indexes from the top menu down ([] = nothing yet;
// [3, 0] = the first item in the 4th item's submenu). itemsAt(prefix) gives the items of
// the menu that `prefix` opens ([] = the top menu): "-" for a separator, or
// { label, disabled, sub: true when it has a submenu }.
// Returns { path, activate: true } to run the item at path, { path, close: true } to close
// the whole menu, or just { path }.

const usable = (item) => item && item !== "-" && !item.disabled

const step = (items, from, dir) => {
  const n = items.length
  for (let k = 1; k <= n; k++) {
    const i = (((from + dir * k) % n) + n) % n
    if (usable(items[i])) return i
  }
  return -1
}

const firstUsable = (items) => step(items, -1, 1)
const lastUsable = (items) => step(items, items.length, -1)

export const navigate = (path, key, itemsAt) => {
  const level = path.slice(0, -1)
  const items = itemsAt(level) || []
  const at = path.length ? path[path.length - 1] : -1
  const item = at >= 0 ? items[at] : null

  switch (key) {
    case "ArrowDown":
    case "ArrowUp": {
      if (!path.length) {
        const top = itemsAt([]) || []
        const i = key === "ArrowDown" ? firstUsable(top) : lastUsable(top)
        return { path: i < 0 ? [] : [i] }
      }
      const i = step(items, at, key === "ArrowDown" ? 1 : -1)
      return { path: i < 0 ? path : [...level, i] }
    }
    case "Home":
    case "End": {
      const list = path.length ? items : itemsAt([]) || []
      const i = key === "Home" ? firstUsable(list) : lastUsable(list)
      return { path: i < 0 ? path : [...level, i] }
    }
    case "ArrowRight":
    case "Enter":
    case " ": {
      if (!path.length) {
        if (key !== "ArrowRight") return { path }
        const i = firstUsable(itemsAt([]) || [])
        return { path: i < 0 ? [] : [i] }
      }
      if (usable(item) && item.sub) {
        const sub = itemsAt(path) || []
        const i = firstUsable(sub)
        return { path: i < 0 ? path : [...path, i] }
      }
      if (key === "ArrowRight") return { path }
      return usable(item) ? { path, activate: true } : { path }
    }
    case "ArrowLeft":
      return { path: path.length > 1 ? level : path }
    case "Escape":
      return path.length > 1 ? { path: level } : { path: [], close: true }
    default: {
      // a letter: the next item at this level whose name starts with it
      if (typeof key !== "string" || key.length !== 1 || !/\S/.test(key)) return { path }
      const list = path.length ? items : itemsAt([]) || []
      const want = key.toLowerCase()
      const n = list.length
      for (let k = 1; k <= n; k++) {
        const i = (((at + k) % n) + n) % n
        if (usable(list[i]) && String(list[i].label || "").trim().toLowerCase().startsWith(want)) return { path: [...level, i] }
      }
      return { path }
    }
  }
}
