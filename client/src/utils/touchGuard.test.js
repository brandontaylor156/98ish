import { test } from "node:test"
import assert from "node:assert/strict"
import { isEditable, nativeAt, onTouchSurface } from "./touchGuard.js"

// A tiny stand-in for DOM elements: tag, attributes, classes, parent; `matches` knows the
// simple selectors touchGuard uses ([attr], .class, tag, "ancestor-class tag").
const el = (tag, { attrs = {}, cls = [], editable = false } = {}, parent = null) => {
  const node = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    parentElement: parent,
    isContentEditable: editable,
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    classList: { contains: (c) => cls.includes(c) },
  }
  const one = (n, s) => {
    if (s.startsWith("[")) return n.getAttribute(s.slice(1, -1)) !== null
    if (s.startsWith(".")) return n.classList.contains(s.slice(1))
    return n.tagName === s.toUpperCase()
  }
  node.matches = (sel) =>
    sel.split(",").some((part) => {
      const [a, b] = part.trim().split(/\s+/)
      if (!b) return one(node, a)
      if (!one(node, b)) return false
      for (let p = node.parentElement; p; p = p.parentElement) if (one(p, a)) return true
      return false
    })
  return node
}

const desk = el("div", { cls: ["os-root"] })
const win = el("div", { cls: ["window"] }, desk)

test("text fields are editable, other inputs are not", () => {
  assert.equal(isEditable(el("textarea", {}, win)), true)
  assert.equal(isEditable(el("input", {}, win)), true)
  assert.equal(isEditable(el("input", { attrs: { type: "email" } }, win)), true)
  assert.equal(isEditable(el("input", { attrs: { type: "checkbox" } }, win)), false)
  assert.equal(isEditable(el("input", { attrs: { type: "range" } }, win)), false)
  assert.equal(isEditable(el("div", { editable: true }, win)), true)
  assert.equal(isEditable(el("button", {}, win)), false)
  assert.equal(isEditable(null), false)
})

test("off everywhere by default", () => {
  assert.equal(nativeAt(el("span", {}, el("button", {}, win))), "none")
  assert.equal(nativeAt(el("canvas", {}, win)), "none")
  assert.equal(nativeAt(desk), "none")
})

test("fields and opted-in reading areas allow the phone's own menus", () => {
  assert.equal(nativeAt(el("textarea", {}, win)), "edit")
  const mail = el("div", { attrs: { "data-selectable": "" } }, win)
  assert.equal(nativeAt(el("b", {}, mail)), "select")
  assert.equal(nativeAt(el("p", {}, el("div", { cls: ["selectable"] }, win))), "select")
  assert.equal(nativeAt(el("p", {}, el("div", { cls: ["dialogBody"] }, win))), "select")
  // a text node reports its element
  assert.equal(nativeAt({ nodeType: 3, parentElement: el("b", {}, mail) }), "select")
})

test("data-selectable=false turns it off again inside a reading area", () => {
  const help = el("article", { attrs: { "data-selectable": "" } }, win)
  const box = el("div", { attrs: { "data-selectable": "false" } }, help)
  assert.equal(nativeAt(el("span", {}, box)), "none")
  // but a field in there still edits
  assert.equal(nativeAt(el("input", {}, box)), "edit")
})

test("data-selectable=mouse selects with a mouse only", () => {
  const transcript = el("div", { attrs: { "data-selectable": "mouse" } }, win)
  const line = el("span", {}, transcript)
  assert.equal(nativeAt(line, { touch: true }), "none")
  assert.equal(nativeAt(line, { touch: false }), "select")
})

test("touch surfaces: canvases and controls, not the buttons on them", () => {
  const stage = el("div", { attrs: { "data-touch-surface": "" } }, win)
  assert.equal(onTouchSurface(stage), true)
  assert.equal(onTouchSurface(el("span", {}, stage)), true)
  assert.equal(onTouchSurface(el("span", {}, el("button", {}, stage))), false)
  assert.equal(onTouchSurface(el("input", {}, stage)), false)
  assert.equal(onTouchSurface(el("div", { cls: ["tcZone"] }, win)), true)
  // a touch-controls button is itself the surface
  assert.equal(onTouchSurface(el("button", { cls: ["tcButton"] }, win)), true)
  assert.equal(onTouchSurface(el("canvas", { cls: ["pkCanvas"] }, win)), true)
  // a plain canvas or button elsewhere is not
  assert.equal(onTouchSurface(el("canvas", {}, win)), false)
  assert.equal(onTouchSurface(el("button", {}, win)), false)
})
