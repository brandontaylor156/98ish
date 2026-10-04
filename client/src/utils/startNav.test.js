// The Start menu's keyboard navigation. Run: node --test client/src/utils/startNav.test.js
import test from "node:test"
import assert from "node:assert/strict"
import { navigate } from "./startNav.js"

// Windows Update, -, Programs > (Accessories > (Notepad, Paint), Games > (Tetris)), Documents >,
// Settings > (Control Panel, (grayed) Printers, Taskbar), Run..., -, Shut Down...
const MENU = [
  { label: "Windows Update" },
  "-",
  {
    label: "Programs",
    sub: [
      { label: "Accessories", sub: [{ label: "Notepad" }, { label: "Paint" }] },
      { label: "Games", sub: [{ label: "Tetris" }] },
    ],
  },
  { label: "Documents", sub: [] },
  { label: "Settings", sub: [{ label: "Control Panel" }, { label: "Printers", disabled: true }, { label: "Taskbar" }] },
  { label: "Run..." },
  "-",
  { label: "Shut Down..." },
]

const itemsAt = (prefix) => {
  let items = MENU
  for (const i of prefix) items = items[i]?.sub
  return (items || []).map((it) => (it === "-" ? "-" : { label: it.label, disabled: it.disabled, sub: !!it.sub }))
}
const go = (path, ...keys) => {
  let r = { path }
  for (const k of keys) r = navigate(r.path, k, itemsAt)
  return r
}

test("Down/Up from nothing: the first or the last item", () => {
  assert.deepEqual(go([], "ArrowDown").path, [0])
  assert.deepEqual(go([], "ArrowUp").path, [7])
})

test("Down/Up skip separators and wrap around", () => {
  assert.deepEqual(go([0], "ArrowDown").path, [2])
  assert.deepEqual(go([2], "ArrowUp").path, [0])
  assert.deepEqual(go([7], "ArrowDown").path, [0], "wraps to the top")
  assert.deepEqual(go([0], "ArrowUp").path, [7], "wraps to the bottom")
  assert.deepEqual(go([5], "ArrowDown").path, [7])
})

test("Right/Enter open a submenu at its first item; Left/Escape come back", () => {
  assert.deepEqual(go([2], "ArrowRight").path, [2, 0])
  assert.deepEqual(go([2], "Enter").path, [2, 0])
  assert.deepEqual(go([2, 0], "ArrowRight").path, [2, 0, 0])
  assert.deepEqual(go([2, 0, 0], "ArrowLeft").path, [2, 0])
  assert.deepEqual(go([2, 0, 0], "Escape").path, [2, 0])
  assert.deepEqual(go([2], "ArrowLeft").path, [2], "nothing to go back to at the top")
})

test("an empty submenu doesn't open", () => {
  assert.deepEqual(go([3], "ArrowRight").path, [3])
  assert.equal(go([3], "Enter").activate, undefined)
})

test("grayed items are skipped", () => {
  assert.deepEqual(go([4], "ArrowRight", "ArrowDown").path, [4, 2])
  assert.deepEqual(go([4, 2], "ArrowUp").path, [4, 0])
})

test("Enter on an item runs it; Escape at the top closes the menu", () => {
  const run = go([4], "ArrowRight", "Enter")
  assert.deepEqual(run.path, [4, 0])
  assert.equal(run.activate, true)
  assert.equal(go([5], "Enter").activate, true)
  assert.equal(go([5], "Escape").close, true)
  assert.equal(go([], "Escape").close, true)
  assert.equal(go([2, 0], "Escape").close, undefined)
})

test("Right on a plain item and Enter with nothing highlighted do nothing", () => {
  assert.deepEqual(go([5], "ArrowRight"), { path: [5] })
  assert.deepEqual(go([], "Enter"), { path: [] })
  assert.deepEqual(go([], "ArrowRight").path, [0])
})

test("Home/End and letters", () => {
  assert.deepEqual(go([5], "Home").path, [0])
  assert.deepEqual(go([0], "End").path, [7])
  assert.deepEqual(go([0], "s").path, [4], "S: Settings")
  assert.deepEqual(go([4], "s").path, [7], "S again: Shut Down")
  assert.deepEqual(go([7], "S").path, [4], "wraps, any case")
  assert.deepEqual(go([], "r").path, [5])
  assert.deepEqual(go([2, 0], "p").path, [2, 0], "no other P in Programs")
  assert.deepEqual(go([2, 0], "g").path, [2, 1])
  assert.deepEqual(go([0], "z").path, [0])
  assert.deepEqual(go([0], "Tab").path, [0], "other keys are ignored")
})
